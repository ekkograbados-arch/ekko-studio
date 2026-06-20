console.log("EKKO Studio iniciado");

function renderCategories() {
  const container = document.getElementById("categoryTabs");
  container.innerHTML = "";

  window.EKKO_STUDIO_PRODUCTS.forEach((grupo, index) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (index === 0 ? " active" : "");
    btn.textContent = grupo.categoria;
    btn.onclick = () => renderProducts(index);
    container.appendChild(btn);
  });

  renderProducts(0);
}

function renderProducts(categoryIndex) {
  const productContainer = document.getElementById("productTabs");
  const surfaceContainer = document.getElementById("surfaceTabs");

  productContainer.innerHTML = "";
  surfaceContainer.innerHTML = "";

  const grupo = window.EKKO_STUDIO_PRODUCTS[categoryIndex];

  grupo.productos.forEach((prod, index) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (index === 0 ? " active" : "");
    btn.textContent = prod.nombre;
    btn.onclick = () => renderSurfaces(prod);
    productContainer.appendChild(btn);
  });

  renderSurfaces(grupo.productos[0]);
}

function renderSurfaces(producto) {
  const surfaceContainer = document.getElementById("surfaceTabs");
  surfaceContainer.innerHTML = "";

  producto.superficies.forEach((s, index) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (index === 0 ? " active" : "");
    btn.textContent = s.nombre;
    surfaceContainer.appendChild(btn);
  });

  document.getElementById("selectionInfo").textContent =
    "Seleccionado: " + producto.nombre;
}

window.addEventListener("DOMContentLoaded", () => {
  renderCategories();
});
