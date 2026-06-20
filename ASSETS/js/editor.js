window.addEventListener("DOMContentLoaded", () => {
  paper.setup("editorCanvas");

  const view = paper.view;
  view.viewSize = new paper.Size(900, 720);

  const toolState = {
    currentCategory: 0,
    currentProduct: null,
    currentSurface: 0
  };

  function clearCanvas() {
    paper.project.activeLayer.removeChildren();
  }

  function loadSVG(svgPath) {
    clearCanvas();

    paper.project.importSVG(svgPath, (item) => {
      if (!item) return;

      const bounds = item.bounds;
      const canvasBounds = paper.view.bounds;

      const scaleX = (canvasBounds.width * 0.75) / bounds.width;
      const scaleY = (canvasBounds.height * 0.75) / bounds.height;
      const scale = Math.min(scaleX, scaleY);

      item.scale(scale);

      const center = canvasBounds.center;
      item.position = center;

      item.data = item.data || {};
      item.data.baseBounds = item.bounds.clone();

      paper.view.draw();
    });
  }

  function renderCategories() {
    const categoryTabs = document.getElementById("categoryTabs");
    categoryTabs.innerHTML = "";

    window.EKKO_STUDIO_PRODUCTS.forEach((group, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (index === 0 ? " active" : "");
      btn.textContent = group.categoria;
      btn.onclick = () => {
        toolState.currentCategory = index;
        renderCategories();
        renderProducts(index);
      };
      categoryTabs.appendChild(btn);
    });
  }

  function renderProducts(categoryIndex) {
    const productTabs = document.getElementById("productTabs");
    productTabs.innerHTML = "";

    const group = window.EKKO_STUDIO_PRODUCTS[categoryIndex];

    group.productos.forEach((product, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (index === 0 ? " active" : "");
      btn.textContent = product.nombre;
      btn.onclick = () => {
        toolState.currentProduct = product;
        toolState.currentSurface = 0;
        renderProducts(categoryIndex);
        renderSurfaces(product);
      };
      productTabs.appendChild(btn);
    });

    toolState.currentProduct = group.productos[0];
    renderSurfaces(group.productos[0]);
  }

  function renderSurfaces(product) {
    const surfaceTabs = document.getElementById("surfaceTabs");
    surfaceTabs.innerHTML = "";

    product.superficies.forEach((surface, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (index === 0 ? " active" : "");
      btn.textContent = surface.nombre;
      btn.onclick = () => {
        toolState.currentSurface = index;
        renderSurfaces(product);
        loadSVG(surface.svg);
        document.getElementById("selectionInfo").textContent =
          `Seleccionado: ${product.nombre} / ${surface.nombre}`;
      };
      surfaceTabs.appendChild(btn);
    });

    const firstSurface = product.superficies[toolState.currentSurface] || product.superficies[0];
    if (firstSurface) {
      loadSVG(firstSurface.svg);
      document.getElementById("selectionInfo").textContent =
        `Seleccionado: ${product.nombre} / ${firstSurface.nombre}`;
    }
  }

  window.addEventListener("resize", () => {
    paper.view.viewSize = new paper.Size(
      document.getElementById("editorCanvas").clientWidth,
      document.getElementById("editorCanvas").clientHeight
    );
  });

  renderCategories();
});
