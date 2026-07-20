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
})();
