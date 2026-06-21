window.addEventListener("DOMContentLoaded", () => {
  paper.setup("editorCanvas");

  const canvasEl = document.getElementById("editorCanvas");
  paper.view.viewSize = new paper.Size(canvasEl.clientWidth, canvasEl.clientHeight);

  const toolState = {
    currentCategory: 0,
    currentProduct: null,
    currentSurface: 0,
    zoom: 1
  };
  
  const sceneStates = {};
    function getSceneKey(product, surface) {
      return `${product.id}__${surface.nombre}`;
    }

  let loadToken = 0;
  let selectedItem = null;
  let lastSizeField = "width";
  let dragOffset = new paper.Point(0, 0);

  const ui = {
    categoryTabs: document.getElementById("categoryTabs"),
    productTabs: document.getElementById("productTabs"),
    surfaceTabs: document.getElementById("surfaceTabs"),
    selectionInfo: document.getElementById("selectionInfo"),
    imagePicker: document.getElementById("imagePicker"),
    svgPicker: document.getElementById("svgPicker"),
    objWidth: document.getElementById("objWidth"),
    objHeight: document.getElementById("objHeight"),
    lockRatio: document.getElementById("lockRatio"),
    btnApplySize: document.getElementById("btnApplySize")
  };

  function clearCanvas() {
    paper.project.activeLayer.removeChildren();
    paper.view.update();
  }

  function isLockedItem(item) {
    return item && item.data && item.data.locked === true;
  }

  function deselectItem() {
    if (selectedItem) {
      selectedItem.selected = false;
      selectedItem = null;
    }
    ui.selectionInfo.textContent = "Nada seleccionado";
    paper.view.update();
  }

  function updateSelectionInfo() {
  if (!selectedItem) {
    ui.selectionInfo.textContent = "Nada seleccionado";
    ui.objWidth.value = "";
    ui.objHeight.value = "";
    return;
  }

  const w = selectedItem.bounds.width.toFixed(1);
  const h = selectedItem.bounds.height.toFixed(1);

  ui.selectionInfo.textContent = `Seleccionado: ${selectedItem.data?.label || "Objeto"} | ${w} x ${h}`;
  ui.objWidth.value = w;
  ui.objHeight.value = h;
}

let lastSizeField = "width";

ui.objWidth.addEventListener("input", () => {
  lastSizeField = "width";
});

ui.objHeight.addEventListener("input", () => {
  lastSizeField = "height";
});

function applySelectedSize() {
  if (!selectedItem || isLockedItem(selectedItem)) return;

  const currentW = selectedItem.bounds.width;
  const currentH = selectedItem.bounds.height;

  if (currentW === 0 || currentH === 0) return;

  let newW = parseFloat(ui.objWidth.value);
  let newH = parseFloat(ui.objHeight.value);

  if (isNaN(newW) && isNaN(newH)) return;

  const keepRatio = ui.lockRatio.checked;
  const center = selectedItem.position.clone();
  const originalRatio = currentW / currentH;

  if (keepRatio) {
    if (lastSizeField === "width" && !isNaN(newW) && newW > 0) {
      newH = newW / originalRatio;
      ui.objHeight.value = newH.toFixed(1);
    } else if (lastSizeField === "height" && !isNaN(newH) && newH > 0) {
      newW = newH * originalRatio;
      ui.objWidth.value = newW.toFixed(1);
    } else {
      return;
    }
  } else {
    if (isNaN(newW) || isNaN(newH) || newW <= 0 || newH <= 0) return;
  }

  const scaleX = newW / currentW;
  const scaleY = newH / currentH;

  selectedItem.scale(scaleX, scaleY);
  selectedItem.position = center;
  updateSelectionInfo();
  paper.view.update();
}

  function selectItem(item) {
    if (!item || isLockedItem(item)) {
      deselectItem();
      return;
    }

    if (selectedItem) selectedItem.selected = false;

    selectedItem = item;
    selectedItem.selected = true;
    updateSelectionInfo();
    paper.view.update();
  }

  function loadSVG(svgPath) {
    const token = ++loadToken;

    clearCanvas();

    paper.project.importSVG(svgPath, (item) => {
      if (token !== loadToken) {
        if (item) item.remove();
        return;
      }

      if (!item) return;

      const bounds = item.bounds;
      const canvasBounds = paper.view.bounds;

      const scaleX = (canvasBounds.width * 0.75) / bounds.width;
      const scaleY = (canvasBounds.height * 0.75) / bounds.height;
      const scale = Math.min(scaleX, scaleY);

      item.scale(scale);
      item.position = canvasBounds.center;

      item.data = item.data || {};
      item.data.locked = true;
      item.data.label = "SVG base";

      deselectItem();
      paper.view.draw();
    });
  }
    
  function saveCurrentScene() {
      if (!toolState.currentProduct) return;
    
      const surface = toolState.currentProduct.superficies[toolState.currentSurface];
      if (!surface) return;
    
      const key = getSceneKey(toolState.currentProduct, surface);
      sceneStates[key] = paper.project.exportJSON({ asString: true });
    }
    
    function loadSurfaceScene(product, surface) {
      const key = getSceneKey(product, surface);
    
      deselectItem();
    
      if (sceneStates[key]) {
        clearCanvas();
        paper.project.importJSON(sceneStates[key]);
        paper.view.update();
        return;
      }
    
      loadSVG(surface.svg, () => {
        paper.view.update();
      });
    }
  

  function zoomBy(factor) {
    paper.view.zoom = Math.max(0.2, Math.min(10, paper.view.zoom * factor));
    paper.view.update();
  }

  function fitView() {
    paper.view.zoom = 1;
    paper.view.center = paper.view.bounds.center;
    paper.view.update();
  }

  function deleteSelected() {
    if (!selectedItem || isLockedItem(selectedItem)) return;
    selectedItem.remove();
    selectedItem = null;
    updateSelectionInfo();
    paper.view.update();
  }

  function duplicateSelected() {
    if (!selectedItem || isLockedItem(selectedItem)) return;

    const clone = selectedItem.clone();
    clone.position = clone.position.add(new paper.Point(20, 20));
    clone.data = clone.data || {};
    clone.data.locked = false;
    clone.data.label = `${selectedItem.data?.label || "Objeto"} copia`;

    paper.project.activeLayer.addChild(clone);
    selectItem(clone);
  }

  function bringFront() {
    if (!selectedItem || isLockedItem(selectedItem)) return;
    selectedItem.bringToFront();
    paper.view.update();
  }

  function sendBack() {
    if (!selectedItem || isLockedItem(selectedItem)) return;
    selectedItem.sendToBack();
    paper.view.update();
  }

  function addText() {
    const text = prompt("Escribí el texto:");
    if (!text) return;

    const obj = new paper.PointText({
      point: paper.view.center,
      content: text,
      fontSize: 36,
      fillColor: "black",
      justification: "center"
    });

    obj.data = {
      locked: false,
      label: "Texto"
    };

    paper.project.activeLayer.addChild(obj);
    selectItem(obj);
  }

  function addImageFromFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const raster = new paper.Raster({
        source: e.target.result
      });

      raster.onLoad = () => {
        raster.data = {
          locked: false,
          label: "Imagen"
        };

        const maxWidth = paper.view.bounds.width * 0.35;
        const ratio = maxWidth / raster.bounds.width;
        raster.scale(ratio);
        raster.position = paper.view.center;

        selectItem(raster);
        paper.view.update();
      };
    };
    reader.readAsDataURL(file);
  }

  function addSVGFromFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      paper.project.importSVG(e.target.result, (item) => {
        if (!item) return;

        item.data = {
          locked: false,
          label: file.name.replace(".svg", "")
        };

        const bounds = item.bounds;
        const canvasBounds = paper.view.bounds;

        const scaleX = (canvasBounds.width * 0.45) / bounds.width;
        const scaleY = (canvasBounds.height * 0.45) / bounds.height;
        const scale = Math.min(scaleX, scaleY);

        item.scale(scale);
        item.position = canvasBounds.center;

        paper.project.activeLayer.addChild(item);
        selectItem(item);
        paper.view.update();
      });
    };
    reader.readAsText(file);
  }

  function renderCategories() {
    ui.categoryTabs.innerHTML = "";

    window.EKKO_STUDIO_PRODUCTS.forEach((group, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (toolState.currentCategory === index ? " active" : "");
      btn.textContent = group.categoria;
      btn.onclick = () => {
        saveCurrentScene();
        toolState.currentCategory = index;
        toolState.currentProduct = null;
        toolState.currentSurface = 0;
        renderCategories();
        renderProducts(index);
      };
      ui.categoryTabs.appendChild(btn);
    });
  }

    function renderProducts(categoryIndex, activeProduct = null) {
      ui.productTabs.innerHTML = "";
      ui.surfaceTabs.innerHTML = "";
    
      const group = window.EKKO_STUDIO_PRODUCTS[categoryIndex];
      const selectedProduct = activeProduct || toolState.currentProduct || group.productos[0];
    
      group.productos.forEach((product) => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (selectedProduct === product ? " active" : "");
        btn.textContent = product.nombre;
        btn.onclick = () => {
          saveCurrentScene();
          toolState.currentProduct = product;
          toolState.currentSurface = 0;
          renderProducts(categoryIndex, product);
        };
        ui.productTabs.appendChild(btn);
      });
    
      toolState.currentProduct = selectedProduct;
      renderSurfaces(selectedProduct);
    }

  function renderSurfaces(product) {
    ui.surfaceTabs.innerHTML = "";

    product.superficies.forEach((surface, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (toolState.currentSurface === index ? " active" : "");
      btn.textContent = surface.nombre;
      btn.onclick = () => {
        saveCurrentScene();
        toolState.currentSurface = index;
        renderSurfaces(product);
        loadSurfaceScene(product, surface);
        ui.selectionInfo.textContent = `Seleccionado: ${product.nombre} / ${surface.nombre}`;
      };

      ui.surfaceTabs.appendChild(btn);
    });

      const firstSurface = product.superficies[toolState.currentSurface] || product.superficies[0];
      if (firstSurface) {
        loadSurfaceScene(product, firstSurface);
        ui.selectionInfo.textContent =
          `Seleccionado: ${product.nombre} / ${firstSurface.nombre}`;
      }
  }

  const tool = new paper.Tool();

  tool.onMouseDown = function (event) {
    const hit = paper.project.hitTest(event.point, {
      fill: true,
      stroke: true,
      segments: true,
      tolerance: 6
    });

    if (hit && hit.item && !isLockedItem(hit.item)) {
      selectItem(hit.item);
      dragOffset = event.point.subtract(hit.item.position);
    } else {
      deselectItem();
    }
  };

  tool.onMouseDrag = function (event) {
    if (!selectedItem || isLockedItem(selectedItem)) return;
    selectedItem.position = event.point.subtract(dragOffset);
    updateSelectionInfo();
    paper.view.update();
  };

tool.onKeyDown = function (event) {
  const active = document.activeElement;
  const isTyping =
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      active.isContentEditable);

  if (isTyping) return;

  if (event.key === "delete") {
    deleteSelected();
  }
};

  document.getElementById("btnAddText").addEventListener("click", addText);

  document.getElementById("btnDelete").addEventListener("click", deleteSelected);
  document.getElementById("btnDuplicate").addEventListener("click", duplicateSelected);
  document.getElementById("btnBringFront").addEventListener("click", bringFront);
  document.getElementById("btnSendBack").addEventListener("click", sendBack);

  document.getElementById("btnZoomIn").addEventListener("click", () => zoomBy(1.15));
  document.getElementById("btnZoomOut").addEventListener("click", () => zoomBy(1 / 1.15));
  document.getElementById("btnFit").addEventListener("click", fitView);

  document.getElementById("btnAddImage").addEventListener("click", () => {
    ui.imagePicker.value = "";
    ui.imagePicker.click();
  });

  document.getElementById("btnAddSVG").addEventListener("click", () => {
    ui.svgPicker.value = "";
    ui.svgPicker.click();
  });

  ui.imagePicker.addEventListener("change", (e) => {
    addImageFromFile(e.target.files[0]);
  });

  ui.svgPicker.addEventListener("change", (e) => {
    addSVGFromFile(e.target.files[0]);
  });

  ui.btnApplySize.addEventListener("click", applySelectedSize);
  ui.objWidth.addEventListener("input", () => {
  lastSizeField = "width";
});

ui.objHeight.addEventListener("input", () => {
  lastSizeField = "height";
});
  window.addEventListener("resize", () => {
    paper.view.viewSize = new paper.Size(
      canvasEl.clientWidth,
      canvasEl.clientHeight
    );
  });

  renderCategories();
});
