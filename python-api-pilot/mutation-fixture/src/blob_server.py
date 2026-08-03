import argparse
import hashlib
import json
import os
import re
import signal
import stat
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


MUTATION = os.environ.get("CONTENT_BLOB_MUTATION", "")
DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")
RANGE_PATTERN = re.compile(r"^bytes=([0-9]+)-([0-9]+)$")


class InvalidStorage(Exception):
    pass


def active(name):
    return MUTATION == name


def hash_file(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(64 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


class BlobStore:
    def __init__(self, storage_dir):
        self.blob_dir = Path(storage_dir) / "blobs"
        self.blob_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self._validate()

    def _validate(self):
        paths = list(self.blob_dir.iterdir())
        if active("restart_forgets_blobs") and paths:
            for path in paths:
                if path.is_file() and not path.is_symlink():
                    path.unlink()
            return
        for path in paths:
            if DIGEST_PATTERN.fullmatch(path.name) is None:
                if active("skip_invalid_name_validation"):
                    continue
                raise InvalidStorage()
            if path.is_symlink() or not path.is_file():
                if active("skip_nonregular_validation"):
                    continue
                raise InvalidStorage()
            if not active("skip_hash_validation") and hash_file(path) != path.name:
                if active("mutate_invalid_storage"):
                    path.unlink()
                raise InvalidStorage()

    def path(self, digest):
        return self.blob_dir / digest

    def put(self, digest, body):
        with self.lock:
            final_path = self.path(digest)
            if final_path.exists():
                return active("duplicate_reports_created")
            if active("no_atomic_replace"):
                final_path.write_bytes(body)
                return True
            descriptor, temporary_name = tempfile.mkstemp(prefix=".blob-", dir=str(self.blob_dir))
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(body)
                    if not active("no_file_fsync"):
                        stream.flush()
                        os.fsync(stream.fileno())
                os.replace(temporary_name, final_path)
                if active("leftover_temp_file"):
                    (self.blob_dir / ".leftover").write_bytes(b"temporary")
            except BaseException:
                try:
                    os.unlink(temporary_name)
                except FileNotFoundError:
                    pass
                raise
            return True

    def list(self):
        paths = [
            path
            for path in self.blob_dir.iterdir()
            if DIGEST_PATTERN.fullmatch(path.name) is not None and path.is_file()
        ]
        paths.sort(key=lambda item: item.name, reverse=active("reverse_listing"))
        values = [{"digest": path.name, "size": path.stat().st_size} for path in paths]
        if active("omit_zero_size_listing"):
            values = [value for value in values if value["size"] != 0]
        return values


def json_bytes(value):
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


def make_handler(store, max_body_bytes):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, _format, *_args):
            return

        def send_json(self, status_code, value, extra_headers=None, include_body=True):
            body = json_bytes(value)
            self.send_response(status_code)
            content_type = "text/plain" if active("json_content_type_text") else "application/json"
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            for name, header_value in (extra_headers or {}).items():
                self.send_header(name, header_value)
            self.end_headers()
            if include_body:
                self.wfile.write(body)
            if active("readiness_extra_stdout"):
                print(json.dumps({"request": self.command}), flush=True)

        def send_empty(self, status_code, headers=None):
            self.send_response(status_code)
            for name, header_value in (headers or {}).items():
                self.send_header(name, header_value)
            self.end_headers()

        def route(self):
            path = urlsplit(self.path).path
            if path == "/blobs" or (active("trailing_slash_lists") and path == "/blobs/"):
                return "list", None
            match = re.fullmatch(r"/blobs/([^/]+)", path)
            if match is None:
                if active("extra_path_invalid_digest") and path.startswith("/blobs/"):
                    return "invalid", None
                return "missing", None
            digest = match.group(1)
            pattern = r"[0-9A-Fa-f]{64}" if active("allow_uppercase_digest") else r"[0-9a-f]{64}"
            if re.fullmatch(pattern, digest) is None:
                return "invalid", None
            return "blob", digest

        def do_PUT(self):
            route, digest = self.route()
            if route == "list" and active("put_collection_succeeds"):
                self.close_connection = True
                self.send_json(200, {"blobs": store.list()})
                return
            if route == "invalid":
                self.close_connection = True
                self.send_json(400, {"error": "invalid_digest"})
                return
            if route != "blob":
                self.close_connection = True
                self.send_json(404, {"error": "not_found"})
                return
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/octet-stream" and not active("accept_wrong_media_type"):
                self.close_connection = True
                self.send_json(415, {"error": "unsupported_media_type"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.close_connection = True
                self.send_json(400, {"error": "invalid_request"})
                return
            if length < 0:
                self.close_connection = True
                self.send_json(400, {"error": "invalid_request"})
                return
            limit = max_body_bytes
            too_large = length > limit
            if active("body_limit_off_by_one"):
                too_large = length > limit + 1
            if active("ignore_body_limit") or (active("zero_limit_unlimited") and limit == 0):
                too_large = False
            reject_after_read = active("read_oversize_before_reject") and too_large
            if too_large and not reject_after_read:
                self.close_connection = True
                self.send_json(413, {"error": "body_too_large"})
                return
            body = self.rfile.read(length)
            if len(body) != length:
                self.close_connection = True
                self.send_json(400, {"error": "invalid_request"})
                return
            if reject_after_read:
                self.send_json(413, {"error": "body_too_large"})
                return
            mismatch = hashlib.sha256(body).hexdigest() != digest.lower()
            if mismatch and not active("accept_digest_mismatch"):
                self.send_json(422, {"error": "digest_mismatch"})
                return
            created = store.put(digest, body)
            reported_size = 0 if active("wrong_reported_size") else len(body)
            self.send_json(
                201 if created else 200,
                {"created": created, "blob": {"digest": digest, "size": reported_size}},
            )

        def do_GET(self):
            self.handle_read(include_body=True)

        def do_HEAD(self):
            if active("head_lists_blobs") and urlsplit(self.path).path == "/blobs":
                self.send_json(200, {"blobs": store.list()}, include_body=False)
                return
            self.handle_read(include_body=False)

        def handle_read(self, include_body):
            route, digest = self.route()
            if route == "list" and self.command == "GET":
                self.send_json(200, {"blobs": store.list()}, include_body=include_body)
                return
            if route != "blob":
                self.send_json(404, {"error": "not_found"}, include_body=include_body)
                return
            path = store.path(digest)
            if not path.is_file() or path.is_symlink():
                status_code = 400 if active("missing_blob_bad_request") else 404
                self.send_json(status_code, {"error": "not_found"}, include_body=include_body)
                return
            size = path.stat().st_size
            etag = digest if active("unquoted_etag") else '"{}"'.format(digest)
            if_none_match = self.headers.get("If-None-Match")
            matches = if_none_match == etag
            if active("weak_etag_matches") and if_none_match == "W/{}".format(etag):
                matches = True
            if active("any_etag_matches") and if_none_match is not None:
                matches = True
            if matches:
                headers = {} if active("missing_etag") else {"ETag": etag}
                self.send_empty(304, headers)
                return
            range_header = self.headers.get("Range")
            if active("head_range_ignored") and self.command == "HEAD":
                range_header = None
            if active("range_ignored"):
                range_header = None
            start = 0
            end = size - 1
            status_code = 204 if active("head_status_no_content") and self.command == "HEAD" else 200
            extra_headers = {
                "Content-Type": "text/plain" if active("wrong_blob_content_type") else "application/octet-stream"
            }
            if not active("missing_etag"):
                extra_headers["ETag"] = etag
            if range_header is not None:
                match = RANGE_PATTERN.fullmatch(range_header)
                if match is None and active("range_open_ended_accepted"):
                    open_match = re.fullmatch(r"bytes=([0-9]+)-", range_header)
                    if open_match is not None:
                        match = (int(open_match.group(1)), size - 1)
                if match is None:
                    self.send_invalid_range(size, include_body)
                    return
                if isinstance(match, tuple):
                    start, end = match
                else:
                    start, end = int(match.group(1)), int(match.group(2))
                if start > end or start >= size or end >= size:
                    self.send_invalid_range(size, include_body)
                    return
                status_code = 200 if active("range_partial_status_200") else 206
                if not active("omit_partial_content_range"):
                    extra_headers["Content-Range"] = "bytes {}-{}/{}".format(start, end, size)
            if range_header is not None and active("range_end_exclusive"):
                end -= 1
            length = 0 if size == 0 else end - start + 1
            if not active("omit_blob_content_length"):
                extra_headers["Content-Length"] = str(length)
            else:
                self.close_connection = True
                extra_headers["Connection"] = "close"
            self.send_response(status_code)
            for name, header_value in extra_headers.items():
                self.send_header(name, header_value)
            self.end_headers()
            should_write = include_body or active("head_writes_body")
            if should_write and length:
                with path.open("rb") as stream:
                    stream.seek(start)
                    self.wfile.write(stream.read(length))

        def send_invalid_range(self, size, include_body):
            status_code = 400 if active("invalid_range_bad_request") else 416
            headers = {}
            if not active("omit_unsatisfied_content_range"):
                headers["Content-Range"] = "bytes */{}".format(size)
            self.send_json(status_code, {"error": "invalid_range"}, headers, include_body)

        def unsupported(self):
            if active("unknown_method_405"):
                self.send_json(405, {"error": "method_not_allowed"})
                return
            self.send_json(404, {"error": "not_found"})

        def do_POST(self):
            if active("post_aliases_put"):
                self.do_PUT()
                return
            self.unsupported()

        def do_DELETE(self):
            if active("delete_existing_allowed"):
                route, digest = self.route()
                path = store.path(digest) if route == "blob" else None
                if path is not None and path.is_file():
                    path.unlink()
                    self.send_json(200, {"deleted": True})
                    return
            self.unsupported()

        do_PATCH = unsupported

    return Handler


def non_negative(value):
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return parsed


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    if active("storage_dir_optional"):
        parser.add_argument("--storage-dir", default=".blob-store")
    else:
        parser.add_argument("--storage-dir", required=True)
    default_port = -1 if active("default_port_negative") else 0
    parser.add_argument("--port", type=int, default=default_port)
    max_type = int if active("allow_negative_max") else non_negative
    parser.add_argument("--max-body-bytes", type=max_type, default=65_536)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        store = BlobStore(args.storage_dir)
    except InvalidStorage:
        output = sys.stdout if active("invalid_storage_stdout") else sys.stderr
        print(json.dumps({"error": "invalid_storage"}), file=output, flush=True)
        return 0 if active("invalid_storage_exit_zero") else 2
    bind_host = "0.0.0.0" if active("bind_wildcard") else "127.0.0.1"
    server = ThreadingHTTPServer((bind_host, args.port), make_handler(store, args.max_body_bytes))
    server.daemon_threads = True
    if active("ignore_sigterm"):
        signal.signal(signal.SIGTERM, lambda *_args: None)
    else:
        signal.signal(
            signal.SIGTERM,
            lambda *_args: threading.Thread(target=server.shutdown, daemon=True).start(),
        )
    ready_host = "0.0.0.0" if active("readiness_wrong_host") else "127.0.0.1"
    print(json.dumps({"host": ready_host, "port": server.server_address[1]}), flush=True)
    if active("readiness_extra_stdout"):
        print(json.dumps({"unexpected": "stdout"}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
