import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const candidateUrl = pathToFileURL(resolve(process.cwd(), "src/checkout.mjs")).href;
const { calculateOrder } = await import(`${candidateUrl}?run=${encodeURIComponent(process.env.DELIVERY_GATE_RUN_ID ?? "local")}`);

test("multiplies integer cents by quantity", () => {
  assert.equal(calculateOrder({ items: [{ unitPriceCents: 750, quantity: 3 }] }).subtotalCents, 2_250);
});

test("floors percentage discounts expressed in basis points", () => {
  assert.deepEqual(
    calculateOrder({ items: [{ unitPriceCents: 105, quantity: 1 }], coupon: { type: "percent", basisPoints: 1_000 } }),
    { subtotalCents: 105, discountCents: 10, taxCents: 0, shippingCents: 0, totalCents: 95 },
  );
});

test("caps a fixed coupon at the merchandise subtotal", () => {
  assert.deepEqual(
    calculateOrder({ items: [{ unitPriceCents: 1_000, quantity: 1 }], coupon: { type: "fixed", amountCents: 2_000 }, shippingCents: 300 }),
    { subtotalCents: 1_000, discountCents: 1_000, taxCents: 0, shippingCents: 300, totalCents: 300 },
  );
});

test("calculates tax after allocating discount", () => {
  assert.deepEqual(
    calculateOrder({ items: [{ unitPriceCents: 2_000, quantity: 1 }], coupon: { type: "percent", basisPoints: 2_500 }, taxRateBasisPoints: 1_000 }),
    { subtotalCents: 2_000, discountCents: 500, taxCents: 150, shippingCents: 0, totalCents: 1_650 },
  );
});

test("excludes non-taxable merchandise from the allocated tax base", () => {
  assert.deepEqual(
    calculateOrder({
      items: [
        { unitPriceCents: 1_000, quantity: 1, taxable: true },
        { unitPriceCents: 2_000, quantity: 1, taxable: false },
      ],
      coupon: { type: "percent", basisPoints: 1_000 },
      taxRateBasisPoints: 1_000,
    }),
    { subtotalCents: 3_000, discountCents: 300, taxCents: 90, shippingCents: 0, totalCents: 2_790 },
  );
});

test("grants free shipping at the exact post-discount threshold", () => {
  assert.equal(calculateOrder({ items: [{ unitPriceCents: 5_000, quantity: 1 }], shippingCents: 600 }).shippingCents, 0);
});

test("evaluates free shipping after discount", () => {
  assert.equal(
    calculateOrder({ items: [{ unitPriceCents: 5_200, quantity: 1 }], coupon: { type: "fixed", amountCents: 300 }, shippingCents: 600 }).shippingCents,
    600,
  );
});

test("does not charge shipping on an empty order", () => {
  assert.deepEqual(
    calculateOrder({ items: [], shippingCents: 800, taxRateBasisPoints: 1_000 }),
    { subtotalCents: 0, discountCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0 },
  );
});

test("rounds tax half-up", () => {
  assert.equal(calculateOrder({ items: [{ unitPriceCents: 101, quantity: 1 }], taxRateBasisPoints: 5_000 }).taxCents, 51);
});

test("does not include shipping in the taxable base", () => {
  assert.deepEqual(
    calculateOrder({ items: [{ unitPriceCents: 1_000, quantity: 1 }], shippingCents: 500, taxRateBasisPoints: 1_000 }),
    { subtotalCents: 1_000, discountCents: 0, taxCents: 100, shippingCents: 500, totalCents: 1_600 },
  );
});

test("rejects invalid integer and range inputs", () => {
  const invalidOrders = [
    { items: [{ unitPriceCents: -1, quantity: 1 }] },
    { items: [{ unitPriceCents: 100, quantity: 0 }] },
    { items: [{ unitPriceCents: 100, quantity: 100 }] },
    { items: [{ unitPriceCents: 100.5, quantity: 1 }] },
    { items: [{ unitPriceCents: 100, quantity: 1, taxable: "yes" }] },
    { items: [{ unitPriceCents: 100, quantity: 1 }], shippingCents: -1 },
    { items: [{ unitPriceCents: 100, quantity: 1 }], taxRateBasisPoints: 10_001 },
    { items: [{ unitPriceCents: 100, quantity: 1 }], coupon: { type: "percent", basisPoints: 5_001 } },
  ];
  for (const order of invalidOrders) assert.throws(() => calculateOrder(order));
});

test("rejects unsupported coupon types", () => {
  assert.throws(() => calculateOrder({ items: [], coupon: { type: "mystery", amountCents: 1 } }));
});

test("does not mutate the input", () => {
  const order = {
    items: [
      { unitPriceCents: 900, quantity: 2, taxable: true },
      { unitPriceCents: 200, quantity: 3, taxable: false },
    ],
    coupon: { type: "fixed", amountCents: 100 },
    shippingCents: 250,
    taxRateBasisPoints: 825,
  };
  const before = structuredClone(order);
  calculateOrder(order);
  assert.deepEqual(order, before);
});
