import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import urllib.request


class ContentBlobPublicTest(unittest.TestCase):
    def test_uploads_and_retrieves_one_blob(self):
        with tempfile.TemporaryDirectory(prefix="content-blob-mutation-public-") as root:
            process = subprocess.Popen(
                [sys.executable, "src/blob_server.py", "--storage-dir", root, "--port", "0"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                ready_line = process.stdout.readline()
                if not ready_line:
                    self.fail("server exited before readiness: " + process.stderr.read())
                ready = json.loads(ready_line)
                origin = "http://127.0.0.1:{}".format(ready["port"])
                body = b"python mutation campaign\n"
                digest = hashlib.sha256(body).hexdigest()
                request = urllib.request.Request(
                    origin + "/blobs/" + digest,
                    data=body,
                    method="PUT",
                    headers={"Content-Type": "application/octet-stream"},
                )
                with urllib.request.urlopen(request, timeout=3) as response:
                    self.assertEqual(response.status, 201)
                    created = json.load(response)
                self.assertTrue(created["created"])
                self.assertEqual(created["blob"], {"digest": digest, "size": len(body)})
                with urllib.request.urlopen(origin + "/blobs/" + digest, timeout=3) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers["ETag"], '"{}"'.format(digest))
                    self.assertEqual(response.read(), body)
                self.assertTrue((pathlib.Path(root) / "blobs" / digest).is_file())
            finally:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
                process.stdout.close()
                process.stderr.close()


if __name__ == "__main__":
    unittest.main()
