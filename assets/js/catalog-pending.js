/* Runs in <head> before first paint: category/search URLs must not flash the generic "Ürün kataloğu" heading. */
(function () {
  "use strict";
  var path = location.pathname || "";
  var qs = location.search || "";
  if (!/^\/urunler\/[a-z0-9-]+/i.test(path) && !/[?&](kategori|q)=/.test(qs)) return;
  var root = document.documentElement;
  root.classList.add("catalog-heading-pending");
  setTimeout(function () {
    root.classList.remove("catalog-heading-pending");
  }, 6000);
})();
