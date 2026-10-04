const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "main.js"), "utf8");

// Any property is another stub, any call returns a stub, every list holds one stub element.
// That walks every top-level branch of main.js; a TDZ/ReferenceError aborts the IIFE and fails here.
function makeStub(overrides) {
  const extra = overrides || {};
  const target = function () {};
  let proxy;
  const handler = {
    get(_t, key) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) return extra[key];
      if (key === Symbol.toPrimitive) return () => "";
      if (key === Symbol.iterator) return function* () { yield proxy; };
      if (key === "forEach") return (cb) => cb(proxy, 0);
      if (key === "length") return 1;
      if (key === "then") return undefined;
      if (key === "contains") return () => false;
      if (key === "matches") return false;
      return proxy;
    },
    set() {
      return true;
    },
    apply() {
      return proxy;
    },
    construct() {
      return proxy;
    },
  };
  proxy = new Proxy(target, handler);
  return proxy;
}

function runMain(search) {
  const created = [];
  const inserted = [];
  const stub = makeStub();
  const element = () =>
    makeStub({
      setAttribute: () => {},
      appendChild: () => {},
      addEventListener: () => {},
      remove: () => {},
      classList: makeStub({ contains: () => false, add: () => {}, remove: () => {}, toggle: () => {} }),
    });
  const document = makeStub({
    createElement: () => {
      const el = element();
      created.push(el);
      return el;
    },
    querySelector: (sel) =>
      sel === "main"
        ? makeStub({ insertBefore: (node) => inserted.push(node), firstChild: null })
        : stub,
  });
  const window = makeStub({
    matchMedia: () => makeStub({ matches: false, addEventListener: () => {} }),
    addEventListener: () => {},
  });
  const context = {
    window,
    document,
    location: { search: search || "", pathname: "/urunler", hash: "", href: "https://patygoteknoloji.com/urunler" },
    history: { replaceState: () => {} },
    navigator: makeStub(),
    localStorage: makeStub({ getItem: () => null, setItem: () => {} }),
    sessionStorage: makeStub({ getItem: () => null, setItem: () => {} }),
    fetch: () => new Promise(() => {}),
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    IntersectionObserver: function () {
      return makeStub();
    },
    URLSearchParams,
    URL,
    console,
  };
  vm.runInNewContext(source, context, { filename: "main.js" });
  return { created, inserted };
}

test("main.js runs to the end of its IIFE (search suggest + alarm banner initialize)", () => {
  assert.doesNotThrow(() => runMain(""));
  const { inserted } = runMain("?alarm=onay");
  assert.equal(inserted.length, 1, "fiyat alarmı onay bandı sayfaya eklenir");
});
