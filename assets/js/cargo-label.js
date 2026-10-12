(function () {
  var btn = document.getElementById("cargoLabelPrint");
  if (btn) btn.addEventListener("click", function () { window.print(); });
  window.addEventListener("load", function () { window.print(); });
})();
