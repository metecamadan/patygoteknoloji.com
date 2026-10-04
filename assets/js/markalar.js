(function () {
  "use strict";

  document.querySelectorAll(".brand-cat").forEach((category, index) => {
    const head = category.querySelector(".brand-cat-head");
    const grid = category.querySelector(".brand-grid");
    if (!head || !grid) return;

    const title = head.querySelector("h3");
    const meta = head.querySelector("span");
    const panelId = "brand-category-" + (index + 1);
    const button = document.createElement("button");
    const label = document.createElement("span");
    const expanded = index === 0;

    label.className = "brand-cat-label";
    if (title) label.appendChild(title);
    if (meta) label.appendChild(meta);

    button.type = "button";
    button.className = "brand-cat-toggle";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-controls", panelId);
    button.appendChild(label);
    button.insertAdjacentHTML(
      "beforeend",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );

    grid.id = panelId;
    grid.hidden = !expanded;
    category.classList.toggle("is-collapsed", !expanded);
    head.replaceChildren(button);

    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!isOpen));
      grid.hidden = isOpen;
      category.classList.toggle("is-collapsed", isOpen);
    });
  });

  function foldBrand(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "");
  }

  /** Only brands with live products become links; the rest stay as plain showcase tiles. */
  function linkBrandTiles(brands) {
    const byKey = new Map();
    brands.forEach((row) => {
      if (row && row.name && row.count > 0) byKey.set(foldBrand(row.name), row);
    });
    document.querySelectorAll(".brand-tile").forEach((tile) => {
      if (tile.querySelector("a")) return;
      const img = tile.querySelector("img");
      const word = tile.querySelector(".logo-word");
      const label = (img && img.getAttribute("alt")) || (word && word.textContent) || "";
      const row = byKey.get(foldBrand(label));
      if (!row) return;
      const link = document.createElement("a");
      link.className = "brand-tile-link";
      link.href = "/urunler?marka=" + encodeURIComponent(row.name);
      link.setAttribute("aria-label", row.name + " ürünleri (" + row.count + ")");
      while (tile.firstChild) link.appendChild(tile.firstChild);
      const count = document.createElement("span");
      count.className = "brand-tile-count";
      count.textContent = row.count + " ürün";
      link.appendChild(count);
      tile.appendChild(link);
      tile.classList.add("brand-tile--linked");
    });
  }

  fetch("/api/brands", { cache: "default" })
    .then((res) => (res.ok ? res.json() : { brands: [] }))
    .then((data) => linkBrandTiles(Array.isArray(data.brands) ? data.brands : []))
    .catch(() => {});
})();
