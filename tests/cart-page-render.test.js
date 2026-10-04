const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const cartJs = fs.readFileSync(path.join(root, "assets", "js", "cart.js"), "utf8");
const shippingJs = fs.readFileSync(path.join(root, "assets", "js", "shipping.js"), "utf8");
const sepetJs = fs.readFileSync(path.join(root, "assets", "js", "sepet.js"), "utf8");

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attrs: {},
    hidden: false,
    parentNode: null,
    nextSibling: null,
    classList: { add() {}, remove() {} },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    insertBefore(child) {
      return el.appendChild(child);
    },
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    removeAttribute(k) {
      delete el.attrs[k];
    },
    addEventListener() {},
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get: () => text,
    set: (v) => {
      text = String(v);
      el.children = [];
    },
  });
  return el;
}

function findAll(node, tag, out = []) {
  for (const child of node.children) {
    if (child.tagName === tag) out.push(child);
    findAll(child, tag, out);
  }
  return out;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

function memoryStorage(store) {
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
}

function bootCartPage(cartItems, shippingSettings = {}) {
  const summary = makeEl("div");
  const ids = {};
  for (const id of [
    "cartMinimumHint",
    "cartLines",
    "cartNote",
    "cartCheckout",
    "cartSub",
    "cartVat",
    "cartTotal",
    "cartShippingLabel",
    "cartShipping",
  ]) {
    ids[id] = makeEl("div");
  }
  ids.cartShippingRow = summary.appendChild(makeEl("div"));
  const listeners = {};
  const catalogReady = deferred();
  const window = {
    addEventListener(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    dispatchEvent(evt) {
      (listeners[evt.type] || []).forEach((fn) => fn(evt));
    },
    PatygoCatalog: {
      byId: {},
      ready: catalogReady.promise,
      formatPrice: (n) => String(n),
      productHref: (p) => "/urun/" + p.id,
      priceInclVat: (p) => p.price,
    },
  };
  const context = {
    window,
    document: {
      getElementById: (id) => ids[id] || null,
      createElement: makeEl,
      addEventListener() {},
      querySelectorAll: () => [],
    },
    sessionStorage: memoryStorage({ patygo_cart: JSON.stringify(cartItems) }),
    localStorage: memoryStorage({}),
    CustomEvent: function (type) {
      this.type = type;
    },
    confirm: () => true,
    AbortSignal,
    setTimeout,
    fetch: async () => ({ ok: true, json: async () => shippingSettings }),
  };
  vm.createContext(context);
  vm.runInContext(cartJs, context);
  vm.runInContext(shippingJs, context);
  vm.runInContext(sepetJs, context);
  return { window, ids, lines: ids.cartLines, catalogReady };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("cart repaints with catalog images once the catalog arrives after shipping", async () => {
  const page = bootCartPage([{ id: "sup-1", qty: 1, brand: "Acer", name: "Acer Klavye", price: 100 }]);
  await settle();
  assert.equal(findAll(page.lines, "IMG").length, 0, "before the catalog only the snapshot exists");

  page.window.PatygoCatalog.byId["sup-1"] = {
    id: "sup-1",
    brand: "Acer",
    name: "Acer Klavye",
    price: 120,
    image: "https://patygoteknoloji.com/media/catalog/acer.webp",
    images: ["https://patygoteknoloji.com/media/catalog/acer.webp"],
  };
  page.catalogReady.resolve([]);
  await settle();
  await settle();

  const imgs = findAll(page.lines, "IMG");
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].src, "https://patygoteknoloji.com/media/catalog/acer.webp");
});

test("cart below the minimum order blocks checkout and says how much is missing", async () => {
  const page = bootCartPage(
    [{ id: "sup-1", qty: 1, brand: "Acer", name: "Acer Klavye", price: 500, vatPercent: 20 }],
    { shippingFee: 199, freeShippingThreshold: 1500, minOrderAmount: 750, enabled: true }
  );
  page.catalogReady.resolve([]);
  await settle();
  await settle();

  const hint = page.ids.cartMinimumHint;
  const checkout = page.ids.cartCheckout;
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /Minimum sepet tutarı ₺?750/);
  assert.match(hint.textContent, /150 daha ürün ekleyin/);
  assert.equal(checkout.attrs["aria-disabled"], "true");

  page.window.PatygoCart.setQty("sup-1", 2);
  await settle();
  await settle();
  assert.equal(hint.hidden, true);
  assert.equal(checkout.attrs["aria-disabled"], undefined);
  assert.equal(checkout.href, "/odeme");
});

test("cart repaints when the quantity changes", async () => {
  const page = bootCartPage([{ id: "sup-1", qty: 1, brand: "Acer", name: "Acer Klavye", price: 100 }]);
  page.catalogReady.resolve([]);
  await settle();
  await settle();

  page.window.PatygoCart.setQty("sup-1", 3);
  await settle();
  await settle();

  const qtyInput = findAll(page.lines, "INPUT")[0];
  assert.equal(qtyInput.value, "3");
});
