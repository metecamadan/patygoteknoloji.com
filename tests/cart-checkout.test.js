const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function memoryStorage(initial) {
  const store = new Map(initial || []);
  return {
    store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function loadCart(options) {
  const code = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "cart.js"), "utf8");
  const localStorage = memoryStorage(
    options && options.localCart ? [["patygo_cart", options.localCart]] : []
  );
  const sessionStorage = memoryStorage();
  const sandbox = {
    document: {
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
    },
    localStorage,
    sessionStorage,
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    },
    addEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);
  return {
    cart: sandbox.window.PatygoCart,
    localStorage,
    sessionStorage,
  };
}

test("cart totals use stored product snapshot when catalog missing", () => {
  const { cart } = loadCart();
  cart.clear();
  cart.add("sku-1", 2, { brand: "HP", name: "Laptop", price: 1000 });
  const emptyCatalog = cart.totals({});
  assert.equal(emptyCatalog.lines.length, 1);
  assert.equal(emptyCatalog.lines[0].product.name, "Laptop");
  assert.equal(emptyCatalog.sub, 2000);
  assert.equal(emptyCatalog.total, 2400);

  const withCatalog = cart.totals({
    "sku-1": { id: "sku-1", brand: "HP", name: "Laptop Pro", price: 1500, active: true },
  });
  assert.equal(withCatalog.lines[0].product.name, "Laptop Pro");
  assert.equal(withCatalog.sub, 3000);
});

test("cart lives in sessionStorage and drops leftover localStorage count", () => {
  const leftover = JSON.stringify([{ id: "old-1", qty: 2, name: "Eski", price: 10 }]);
  const { cart, localStorage, sessionStorage } = loadCart({ localCart: leftover });
  assert.equal(cart.count(), 0);
  assert.equal(localStorage.getItem("patygo_cart"), null);
  cart.add("sku-1", 2, { brand: "HP", name: "Laptop", price: 1000 });
  assert.equal(cart.count(), 2);
  assert.match(sessionStorage.getItem("patygo_cart") || "", /sku-1/);
  assert.equal(localStorage.getItem("patygo_cart"), null);
});

test("checkout waits for catalog and binds cart mode", () => {
  const checkout = fs.readFileSync(
    path.join(__dirname, "..", "assets", "js", "checkout.js"),
    "utf8"
  );
  assert.match(checkout, /tryBoot/);
  assert.match(checkout, /patygo:catalog/);
  assert.match(checkout, /Ürünler yükleniyor/);
});
