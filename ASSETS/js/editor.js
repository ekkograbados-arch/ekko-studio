

import "./modules/selection.js";
import { startTextEditing } from "./modules/textEditor.js";
import { loadMockup } from "./modules/mockupLoader.js";


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
  const undoStack = [];
  const redoStack = [];
  
window.loadToken = 0;
  window.selectedItem = null;
  let lastSizeField = "width";
window.dragOffset = null;
window.dragging = false;
  let clipboardItem = null;
  const FONTS = [
  {
    name: "Billie James",
    family: "ekko_billie"
  },
  {
    name: "Romantic Sunrise",
    family: "ekko_romantic"
  },
  {
    name: "Farmhouse",
    family: "ekko_farmhouse"
  },
  {
    name: "Chocolate",
    family: "ekko_chocolate"
  },
  {
    name: "Disney",
    family: "ekko_disney"
  },
  {
    name: "Simpson",
    family: "ekko_simpson"
  },
  {
    name: "Milk Water",
    family: "ekko_milk"
  }
];

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
    btnApplySize: document.getElementById("btnApplySize"),
    btnToggleLock: document.getElementById("btnToggleLock"),
    btnAlignLeft: document.getElementById("btnAlignLeft"),
    btnAlignCenterH: document.getElementById("btnAlignCenterH"),
    btnAlignRight: document.getElementById("btnAlignRight"),
    btnAlignTop: document.getElementById("btnAlignTop"),
    btnAlignCenterV: document.getElementById("btnAlignCenterV"),
    btnAlignBottom: document.getElementById("btnAlignBottom"),

    btnRotateLeft: document.getElementById("btnRotateLeft"),
    btnRotateRight: document.getElementById("btnRotateRight"),
    btnRotate180: document.getElementById("btnRotate180"),
    btnCenterH: document.getElementById("btnCenterH"),
    btnCenterV: document.getElementById("btnCenterV"),
    btnCenterBoth: document.getElementById("btnCenterBoth"),
    btnForward: document.getElementById("btnForward"),
    btnBackward: document.getElementById("btnBackward"),
    btnCenterBoth: document.getElementById("btnCenterBoth"),

    fontSelector: document.getElementById("fontSelector"),
    btnApplyFont: document.getElementById("btnApplyFont")
    
  };

  function clearCanvas() {
    paper.project.activeLayer.removeChildren();
    paper.view.update();
  }

    function saveHistory() {
        undoStack.push(
          paper.project.exportJSON({ asString: true })
        );
      
        if (undoStack.length > 50) {
          undoStack.shift();
        }
      
        redoStack.length = 0;
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
    updateLockButton();
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
function updateLockButton() {
  if (!ui.btnToggleLock) return;

  if (!selectedItem) {
    ui.btnToggleLock.textContent = "Bloquear / Desbloquear";
    return;
  }

  ui.btnToggleLock.textContent = isLockedItem(selectedItem)
    ? "Desbloquear"
    : "Bloquear";
}

function toggleLockSelected() {
  if (!selectedItem) return;

  selectedItem.data = selectedItem.data || {};
  selectedItem.data.locked = !selectedItem.data.locked;

  updateSelectionInfo();
  updateLockButton();
  paper.view.update();
}

function alignSelected(mode) {
  if (!selectedItem || isLockedItem(selectedItem)) return;

  const canvasBounds = paper.view.bounds;
  const itemBounds = selectedItem.bounds.clone();
  const center = selectedItem.position.clone();

  let newX = center.x;
  let newY = center.y;

  if (mode === "left") {
    newX = canvasBounds.left + itemBounds.width / 2;
  }

  if (mode === "centerH") {
    newX = canvasBounds.center.x;
  }

  if (mode === "right") {
    newX = canvasBounds.right - itemBounds.width / 2;
  }

  if (mode === "top") {
    newY = canvasBounds.top + itemBounds.height / 2;
  }

  if (mode === "centerV") {
    newY = canvasBounds.center.y;
  }

  if (mode === "bottom") {
    newY = canvasBounds.bottom - itemBounds.height / 2;
  }

  saveHistory();
  selectedItem.position = new paper.Point(newX, newY);
  updateSelectionInfo();
  paper.view.update();
}

  function centerSelected(mode) {

  if (!selectedItem) return;

  if (isLockedItem(selectedItem)) return;

  const center = paper.view.bounds.center;

  saveHistory();

  if (mode === "horizontal") {
    selectedItem.position.x = center.x;
  }

  if (mode === "vertical") {
    selectedItem.position.y = center.y;
  }

  if (mode === "both") {
    selectedItem.position = center.clone();
  }

  updateSelectionInfo();
  paper.view.update();
}

  function rotateSelected(angle) {

  if (!selectedItem) return;

  if (isLockedItem(selectedItem)) return;

  saveHistory();

  selectedItem.rotate(angle);

  updateSelectionInfo();

  paper.view.update();
}
  function applySelectedFont() {

  if (!selectedItem) return;

  if (!(selectedItem instanceof paper.PointText)) {
    alert("Seleccione un texto");
    return;
  }

  const font = ui.fontSelector.value;

  saveHistory();

  selectedItem.fontFamily = font;

  paper.view.update();
}

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


  saveHistory();
  selectedItem.scale(scaleX, scaleY);
  selectedItem.position = center;
  updateSelectionInfo();
  paper.view.update();
}

function selectItem(item) {
  if (!item) {
    window.deselectItem();
    return;
  }

  if (selectedItem) {
    selectedItem.selected = false;
  }

  selectedItem = item;
  selectedItem.selected = true;

    if (item instanceof paper.PointText) {
    ui.fontSelector.value = item.fontFamily || ui.fontSelector.value;
  }
  updateSelectionInfo();
  updateLockButton();
  paper.view.update();
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

  window.deselectItem();

  if (sceneStates[key]) {
      paper.project.clear();
  
      paper.project.importJSON(sceneStates[key]);
  
      selectedItem = null;
      window.deselectItem();
  
      paper.view.update();
      return;
  }
loadMockup(surface.svg);
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
 
    saveHistory();
    selectedItem.remove();
    selectedItem = null;
    updateSelectionInfo();
    paper.view.update();
  }


  function duplicateSelected() {
    if (!selectedItem || isLockedItem(selectedItem)) return;
    saveHistory();
    const clone = selectedItem.clone();
    clone.position = clone.position.add(new paper.Point(20, 20));
    clone.data = clone.data || {};
    clone.data.locked = false;
    clone.data.label = `${selectedItem.data?.label || "Objeto"} copia`;

    paper.project.activeLayer.addChild(clone);
    selectItem(clone);
  }
  function copySelected() {

  if (!selectedItem) return;

  if (isLockedItem(selectedItem)) return;

  clipboardItem = selectedItem.clone();
}

function pasteSelected() {

  if (!clipboardItem) return;

  saveHistory();

  const clone = clipboardItem.clone();

  clone.position = clone.position.add(
    new paper.Point(20, 20)
  );

  clone.data = {
    ...(clone.data || {}),
    locked: false
  };

  paper.project.activeLayer.addChild(clone);

  selectItem(clone);

  paper.view.update();
}

  function renderFontGallery() {

  const list = document.getElementById("fontList");

  if (!list) return;

  list.innerHTML = "";

  FONTS.forEach(font => {

    const item = document.createElement("div");

    item.className = "font-item";

    item.innerHTML = `
      <div
        class="font-preview"
        style="font-family:'${font.family}'">
        Feliz Día Pá
      </div>

      <div class="font-name">
        ${font.name}
      </div>
    `;

    item.onclick = () => {

      if (
        selectedItem &&
        selectedItem instanceof paper.PointText
      ) {

        selectedItem.fontFamily = font.family;

        paper.view.update();
      }

    };

    list.appendChild(item);

  });

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
function bringForward() {

  if (!selectedItem || isLockedItem(selectedItem)) return;

  selectedItem.insertAbove(
    selectedItem.nextSibling
  );

  paper.view.update();
}

function sendBackward() {

  if (!selectedItem || isLockedItem(selectedItem)) return;

  selectedItem.insertBelow(
    selectedItem.previousSibling
  );

  paper.view.update();
}



function addImageFromFile(file) {

    if (!file) return;

    saveHistory();

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

            const area = paper.view.bounds;

            const maxWidth = area.width * 0.60;
            const maxHeight = area.height * 0.60;

            const scale = Math.min(
                maxWidth / raster.width,
                maxHeight / raster.height
            );

            raster.scale(scale);

            raster.position = area.center;



const objeto = clipItem(raster);

if (window.currentMockup) {
    objeto.insertBelow(window.currentMockup);
}

window.selectItem(objeto);

paper.view.update();

window.selectItem(objeto);

paper.view.update();
        };

    };

    reader.readAsDataURL(file);

}


  function addSVGFromFile(file) {
    if (!file) return;
    saveHistory();
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
        window.selectItem(item);

if (window.currentMockup) {
    item.insertBelow(window.currentMockup);
}
        
        paper.view.update();
        item.bringToFront();
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

function undo() {
  if (undoStack.length === 0) return;

  redoStack.push(
    paper.project.exportJSON({ asString: true })
  );

  const state = undoStack.pop();

  paper.project.clear();
  paper.project.importJSON(state);

  window.deselectItem();
  paper.view.update();
}

function redo() {
  if (redoStack.length === 0) return;

  undoStack.push(
    paper.project.exportJSON({ asString: true })
  );

  const state = redoStack.pop();

  paper.project.clear();
  paper.project.importJSON(state);

  window.deselectItem();
  paper.view.update();
}


//======================================
// ACTIVA EL MODO TEXTO
//======================================

function activateTextMode(){

    insertTextMode = true;

    paper.view.element.style.cursor = "text";

}

function createEditableText(point){

    saveHistory();

    const txt = new paper.PointText({

        point,

        content: "",

        fontSize: 42,

        fillColor: new paper.Color(0),

        justification: "center",

        fontFamily: "Arial"

    });

    txt.data = {

        locked:false,

        label:"Texto"

    };

    paper.project.activeLayer.addChild(txt);


if (window.currentMockup) {
    txt.insertBelow(window.currentMockup);
}
  
    selectItem(txt);

    startTextEditing(txt);
}
  
  let insertTextMode = false;
  const tool = new paper.Tool();

tool.onMouseDown = function(event){

    const hit = paper.project.hitTest(event.point,{
        fill:true,
        stroke:true,
        segments:true,
        tolerance:6
    });
    if(!hit){
        window.deselectItem();
        return;
    }
    let item = window.getSelectableItem(hit.item);

    if(!item){
        return;
    }
    window.selectItem(item);
    window.dragOffset =
        event.point.subtract(item.position);
    window.dragging = true;
};
    tool.onMouseDrag = function(event){
    if(
        !window.dragging ||
        !window.selectedItem
    ){
        return;
    }
    window.selectedItem.position =
        event.point.subtract(window.dragOffset);
    paper.view.update();
};

tool.onMouseUp = function () {
    window.dragging = false;
    if (window.selectedItem) {

        saveHistory();
    }
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

    if (event.modifiers.control && event.key === "z") {
      undo();
      return;
    }
  if (event.modifiers.control && event.key === "c") {
  copySelected();
  return;
}

if (event.modifiers.control && event.key === "v") {
  pasteSelected();
  return;
}
    
    if (
      event.modifiers.control &&
      (event.key === "y" ||
        (event.modifiers.shift && event.key === "z"))
    ) {
      redo();
      return;
    }
  
  if (event.key === "delete") {
    deleteSelected();
  }
  if (
  selectedItem &&
  !isLockedItem(selectedItem)
) {

  const step = event.modifiers.shift ? 10 : 1;

  if (event.key === "left") {
    selectedItem.position.x -= step;
    event.preventDefault();
  }

  if (event.key === "right") {
    selectedItem.position.x += step;
    event.preventDefault();
  }

  if (event.key === "up") {
    selectedItem.position.y -= step;
    event.preventDefault();
  }

  if (event.key === "down") {
    selectedItem.position.y += step;
    event.preventDefault();
  }

  updateSelectionInfo();
  paper.view.update();
}
};


  document.getElementById("btnAddText").addEventListener("click", activateTextMode);

  document
    .getElementById("fontGallery")
    .classList.remove("hidden");

  renderFontGallery();



  document.getElementById("btnDelete").addEventListener("click", deleteSelected);
  document.getElementById("btnDuplicate").addEventListener("click", duplicateSelected);
  document.getElementById("btnBringFront").addEventListener("click", bringFront);
  document.getElementById("btnSendBack").addEventListener("click", sendBack);
  ui.btnForward.addEventListener("click", bringForward);
  ui.btnBackward.addEventListener("click", sendBackward);

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
  ui.btnToggleLock.addEventListener("click", toggleLockSelected);
  ui.btnAlignLeft.addEventListener("click", () => alignSelected("left"));
  ui.btnAlignCenterH.addEventListener("click", () => alignSelected("centerH"));
  ui.btnAlignRight.addEventListener("click", () => alignSelected("right"));
  ui.btnAlignTop.addEventListener("click", () => alignSelected("top"));
  ui.btnAlignCenterV.addEventListener("click", () => alignSelected("centerV"));
  ui.btnAlignBottom.addEventListener("click", () => alignSelected("bottom"));
  ui.btnRotateLeft.addEventListener("click", () => {
  rotateSelected(-90);
});

ui.btnRotateRight.addEventListener("click", () => {
  rotateSelected(90);
});

ui.btnRotate180.addEventListener("click", () => {
  rotateSelected(180);
});
  
ui.objWidth.addEventListener("input", () => {
  lastSizeField = "width";
});

ui.objHeight.addEventListener("input", () => {
  lastSizeField = "height";
});

ui.btnCenterH.addEventListener("click", () => {
  centerSelected("horizontal");
});

ui.btnCenterV.addEventListener("click", () => {
  centerSelected("vertical");
});

ui.btnCenterBoth.addEventListener("click", () => {
  centerSelected("both");
});
 
    window.addEventListener("resize", () => {
    paper.view.viewSize = new paper.Size(
      canvasEl.clientWidth,
      canvasEl.clientHeight
    );
  });
  
  ui.btnApplyFont.addEventListener("click", applySelectedFont);
  
  document.getElementById("btnAddText").addEventListener("click", activateTextMode);

  document.getElementById("fontGallery").classList.remove("hidden");
  renderFontGallery();
  
  renderCategories();
});
