import "./modules/selection.js"; 
import { startTextEditing } from "./modules/textEditor.js"; 
import { loadMockup, restoreMockupReferences } from "./modules/mockupLoader.js"; 

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
    { name: "Billie James", family: "ekko_billie" }, 
    { name: "Romantic Sunrise", family: "ekko_romantic" }, 
    { name: "Farmhouse", family: "ekko_farmhouse" }, 
    { name: "Chocolate", family: "ekko_chocolate" }, 
    { name: "Disney", family: "ekko_disney" }, 
    { name: "Simpson", family: "ekko_simpson" }, 
    { name: "Milk Water", family: "ekko_milk" } 
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
    fontSelector: document.getElementById("fontSelector"), 
    btnApplyFont: document.getElementById("btnApplyFont") 
  }; 

  function clearCanvas() { 
    paper.project.activeLayer.removeChildren(); 
    paper.view.update(); 
  } 

  function saveHistory() { 
    undoStack.push( paper.project.exportJSON({ asString: true }) ); 
    if (undoStack.length > 50) { 
      undoStack.shift(); 
    } 
    redoStack.length = 0; 
  } 

  function isLockedItem(item) { 
    return item && item.data && item.data.locked === true; 
  } 

  // UNIFICACIÓN GLOBAL DE DESELECCIÓN
  window.deselectItem = function() { 
    if (window.selectedItem) { 
      window.selectedItem.selected = false; 
      if (window.selectedItem.children) { 
        window.selectedItem.children.forEach(function(c) { c.selected = false; }); 
      } 
      window.selectedItem = null; 
    } 
    if (ui.selectionInfo) ui.selectionInfo.textContent = "Nada seleccionado"; 
    updateLockButton(); 
    paper.view.update(); 
  }; 

  function deselectItem() {
    window.deselectItem();
  }

  function updateSelectionInfo() { 
    if (!window.selectedItem) { 
      ui.selectionInfo.textContent = "Nada seleccionado"; 
      ui.objWidth.value = ""; 
      ui.objHeight.value = ""; 
      return; 
    } 
    const displayItem = (window.selectedItem.data && window.selectedItem.data.clipGroup) 
      ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) 
      : window.selectedItem; 
      
    if (!displayItem) return; 
    const w = displayItem.bounds.width.toFixed(1); 
    const h = displayItem.bounds.height.toFixed(1); 
    ui.selectionInfo.textContent = "Seleccionado: " + (displayItem.data && displayItem.data.label ? displayItem.data.label : "Objeto") + " | " + w + " x " + h; 
    ui.objWidth.value = w; 
    ui.objHeight.value = h; 
  } 

  function updateLockButton() { 
    if (!ui.btnToggleLock) return; 
    if (!window.selectedItem) { 
      ui.btnToggleLock.textContent = "Bloquear / Desbloquear"; 
      return; 
    } 
    ui.btnToggleLock.textContent = isLockedItem(window.selectedItem) ? "Desbloquear" : "Bloquear"; 
  } 

  function toggleLockSelected() { 
    if (!window.selectedItem) return; 
    window.selectedItem.data = window.selectedItem.data || {}; 
    window.selectedItem.data.locked = !window.selectedItem.data.locked; 
    updateSelectionInfo(); 
    updateLockButton(); 
    paper.view.update(); 
  } 

  // UNIFICACIÓN GLOBAL DE SELECCIÓN (SOLUCIONA EL CONTORNO CELESTE Y NODOS VISIBLES)
  window.selectItem = function(item) { 
    if (!item) { 
      window.deselectItem(); 
      return; 
    } 
    if (window.selectedItem) { 
      window.selectedItem.selected = false; 
      if (window.selectedItem.children) { 
        window.selectedItem.children.forEach(function(c) { c.selected = false; }); 
      } 
    } 
    
    window.selectedItem = item; 
    
    // CORRECCIÓN VISUAL DE SELECCIÓN:
    // Si es un grupo de recorte (clipGroup), NO seleccionamos el grupo completo.
    // Seleccionar el grupo completo en Paper.js colorea el contorno de la máscara en celeste y muestra sus nodos.
    // En su lugar, seleccionamos ÚNICAMENTE el elemento de contenido (la foto de fondo) para ver su caja azul limpia.
    if (item.data && item.data.clipGroup) { 
      item.selected = false; 
      const contentItem = item.children.find(function(c) { return !c.clipMask; }); 
      const maskItem = item.children.find(function(c) { return c.clipMask; }); 
      if (contentItem) { 
        contentItem.selected = true; // Solo la foto muestra su caja de edición rectangular
      } 
      if (maskItem) { 
        maskItem.selected = false; // El contorno del producto se mantiene perfectamente limpio sin nodos
      } 
    } else { 
      item.selected = true; 
    } 

    if (item instanceof paper.PointText) { 
      ui.fontSelector.value = item.fontFamily || ui.fontSelector.value; 
    } 
    updateSelectionInfo(); 
    updateLockButton(); 
    paper.view.update(); 
  }; 

  function selectItem(item) {
    window.selectItem(item);
  }

  function alignSelected(mode) { 
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return; 
    saveHistory(); 
    if (window.selectedItem.data && window.selectedItem.data.clipGroup) { 
      const mask = window.selectedItem.children.find(c => c.clipMask); 
      const content = window.selectedItem.children.find(c => !c.clipMask); 
      if (mask && content) { 
        const maskBounds = mask.bounds; 
        const contentBounds = content.bounds.clone(); 
        let newX = content.position.x; 
        let newY = content.position.y; 
        if (mode === "left") newX = maskBounds.left + contentBounds.width / 2; 
        if (mode === "centerH") newX = maskBounds.center.x; 
        if (mode === "right") newX = maskBounds.right - contentBounds.width / 2; 
        if (mode === "top") newY = maskBounds.top + contentBounds.height / 2; 
        if (mode === "centerV") newY = maskBounds.center.y; 
        if (mode === "bottom") newY = maskBounds.bottom - contentBounds.height / 2; 
        content.position = new paper.Point(newX, newY); 
      } 
    } else { 
      const canvasBounds = paper.view.bounds; 
      const itemBounds = window.selectedItem.bounds.clone(); 
      const center = window.selectedItem.position.clone(); 
      let newX = center.x; 
      let newY = center.y; 
      if (mode === "left") newX = canvasBounds.left + itemBounds.width / 2; 
      if (mode === "centerH") newX = canvasBounds.center.x; 
      if (mode === "right") newX = canvasBounds.right - itemBounds.width / 2; 
      if (mode === "top") newY = canvasBounds.top + itemBounds.height / 2; 
      if (mode === "centerV") newY = canvasBounds.center.y; 
      if (mode === "bottom") newY = canvasBounds.bottom - itemBounds.height / 2; 
      window.selectedItem.position = new paper.Point(newX, newY); 
    } 
    updateSelectionInfo(); 
    paper.view.update(); 
  } 

  function centerSelected(mode) { 
    if (!window.selectedItem) return; 
    if (isLockedItem(window.selectedItem)) return; 
    saveHistory(); 
    if (window.selectedItem.data && window.selectedItem.data.clipGroup) { 
      const mask = window.selectedItem.children.find(function(c) { return c.clipMask; }); 
      const content = window.selectedItem.children.find(function(c) { return !c.clipMask; }); 
      if (mask && content) { 
        if (mode === "horizontal") content.position.x = mask.position.x; 
        if (mode === "vertical") content.position.y = mask.position.y; 
        if (mode === "both") content.position = mask.position.clone(); 
      } 
    } else { 
      const center = paper.view.bounds.center; 
      if (mode === "horizontal") window.selectedItem.position.x = center.x; 
      if (mode === "vertical") window.selectedItem.position.y = center.y; 
      if (mode === "both") window.selectedItem.position = center.clone(); 
    } 
    updateSelectionInfo(); 
    paper.view.update(); 
  } 

  function rotateSelected(angle) { 
    if (!window.selectedItem) return; 
    if (isLockedItem(window.selectedItem)) return; 
    saveHistory(); 
    if (window.selectedItem.data && window.selectedItem.data.clipGroup) { 
      const content = window.selectedItem.children.find(c => !c.clipMask); 
      if (content) content.rotate(angle); 
    } else { 
      window.selectedItem.rotate(angle); 
    } 
    updateSelectionInfo(); 
    paper.view.update(); 
  } 

  function applySelectedFont() { 
    if (!window.selectedItem) return; 
    if (!(window.selectedItem instanceof paper.PointText)) { 
      alert("Seleccione un texto"); 
      return; 
    } 
    const font = ui.fontSelector.value; 
    saveHistory(); 
    window.selectedItem.fontFamily = font; 
    paper.view.update(); 
  } 

  ui.objWidth.addEventListener("input", () => { lastSizeField = "width"; }); 
  ui.objHeight.addEventListener("input", () => { lastSizeField = "height"; }); 

  function applySelectedSize() { 
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return; 
    const targetItem = (window.selectedItem.data && window.selectedItem.data.clipGroup) 
      ? window.selectedItem.children.find(c => !c.clipMask) 
      : window.selectedItem; 
    if (!targetItem) return; 
    const currentW = targetItem.bounds.width; 
    const currentH = targetItem.bounds.height; 
    if (currentW === 0 || currentH === 0) return; 
    let newW = parseFloat(ui.objWidth.value); 
    let newH = parseFloat(ui.objHeight.value); 
    if (isNaN(newW) && isNaN(newH)) return; 
    const keepRatio = ui.lockRatio.checked; 
    const center = targetItem.position.clone(); 
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
    targetItem.scale(scaleX, scaleY); 
    targetItem.position = center; 
    updateSelectionInfo(); 
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
      window.deselectItem(); 
      if (typeof restoreMockupReferences === "function") { 
        restoreMockupReferences(); 
      } 
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
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return; 
    saveHistory(); 
    window.selectedItem.remove(); 
    window.selectedItem = null; 
    updateSelectionInfo(); 
    paper.view.update(); 
  } 

  function duplicateSelected() { 
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return; 
    saveHistory(); 
    const clone = window.selectedItem.clone(); 
    clone.position = clone.position.add(new paper.Point(20, 20)); 
    clone.data = clone.data || {}; 
    clone.data.locked = false; 
    clone.data.label = `${window.selectedItem.data?.label || "Objeto"} copia`; 
    paper.project.activeLayer.addChild(clone); 
    window.selectItem(clone); 
  } 

  function copySelected() { 
    if (!window.selectedItem) return; 
    if (isLockedItem(window.selectedItem)) return; 
    clipboardItem = window.selectedItem.clone(); 
  } 

  function pasteSelected() { 
    if (!clipboardItem) return; 
    saveHistory(); 
    const clone = clipboardItem.clone(); 
    clone.position = clone.position.add( new paper.Point(20, 20) ); 
    clone.data = { ...(clone.data || {}), locked: false }; 
    paper.project.activeLayer.addChild(clone); 
    window.selectItem(clone); 
    paper.view.update(); 
  } 

  function renderFontGallery() { 
    const list = document.getElementById("fontList"); 
    if (!list) return; 
    list.innerHTML = ""; 
    FONTS.forEach(font => { 
      const item = document.createElement("div"); 
      item.className = "font-item"; 
      item.innerHTML = ` Feliz Día Pá ${font.name} `; 
      item.onclick = () => { 
        if ( window.selectedItem && window.selectedItem instanceof paper.PointText ) { 
          window.selectedItem.fontFamily = font.family; 
          paper.view.update(); 
        } 
      }; 
      list.appendChild(item); 
    }); 
  } 

  function bringFront() { 
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return; 
    window.selectedItem.bringToFront(); 
    paper.view.update(); 
  } 

  function sendBack() { 
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return; 
    window.selectedItem.sendToBack(); 
    paper.view.update(); 
  } 

  function bringForward() { 
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return; 
    window.selectedItem.insertAbove( window.selectedItem.nextSibling ); 
    paper.view.update(); 
  } 

  function sendBackward() { 
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return; 
    window.selectedItem.insertBelow( window.selectedItem.previousSibling ); 
    paper.view.update(); 
  } 

  function addImageFromFile(file) { 
    if (!file) return; 
    saveHistory(); 
    const reader = new FileReader(); 
    reader.onload = (e) => { 
      const raster = new paper.Raster({ source: e.target.result }); 
      raster.onLoad = () => { 
        raster.data = { locked: false, label: "Imagen" }; 
        const area = paper.view.bounds; 
        const maxWidth = area.width * 0.60; 
        const maxHeight = area.height * 0.60; 
        const scale = Math.min( maxWidth / raster.width, maxHeight / raster.height ); 
        raster.scale(scale); 
        raster.position = area.center; 
        const objeto = window.clipItem(raster); 
        if (window.currentMockup) { 
          objeto.insertBelow(window.currentMockup); 
        } 
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
        item.data = { locked: false, label: file.name.replace(".svg", "") }; 
        const bounds = item.bounds; 
        const canvasBounds = paper.view.bounds; 
        const scaleX = (canvasBounds.width * 0.45) / bounds.width; 
        const scaleY = (canvasBounds.height * 0.45) / bounds.height; 
        const scale = Math.min(scaleX, scaleY); 
        item.scale(scale); 
        item.position = canvasBounds.center; 
        paper.project.activeLayer.addChild(item); 
        window.selectItem( window.getSelectableItem(item) ); 
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
    const selectedProduct = activeProduct || toolState.currentProduct || group.productos; 
    
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

  function renderSurfacesOnly(product) {
    ui.surfaceTabs.innerHTML = "";
    product.superficies.forEach((surface, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (toolState.currentSurface === index ? " active" : "");
      btn.textContent = surface.nombre;
      btn.onclick = () => {
        saveCurrentScene();
        toolState.currentSurface = index;
        renderSurfacesOnly(product);
        loadSurfaceScene(product, surface);
        ui.selectionInfo.textContent = "Seleccionado: " + product.nombre + " / " + surface.nombre;
      };
      ui.surfaceTabs.appendChild(btn);
    });
  }

  function renderSurfaces(product) { 
    renderSurfacesOnly(product);
    const firstSurface = product.superficies[toolState.currentSurface] || product.superficies; 
    if (firstSurface) { 
      loadSurfaceScene(product, firstSurface); 
      ui.selectionInfo.textContent = "Seleccionado: " + product.nombre + " / " + firstSurface.nombre; 
    } 
  } 

  function undo() { 
    if (undoStack.length === 0) return; 
    redoStack.push( paper.project.exportJSON({ asString: true }) ); 
    const state = undoStack.pop(); 
    paper.project.clear(); 
    paper.project.importJSON(state); 
    window.deselectItem(); 
    paper.view.update(); 
  } 

  function redo() { 
    if (redoStack.length === 0) return; 
    undoStack.push( paper.project.exportJSON({ asString: true }) ); 
    const state = redoStack.pop(); 
    paper.project.clear(); 
    paper.project.importJSON(state); 
    window.deselectItem(); 
    paper.view.update(); 
  } 

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
    txt.data = { locked:false, label:"Texto" }; 
    paper.project.activeLayer.addChild(txt); 
    if (window.currentMockup) { 
      txt.insertBelow(window.currentMockup); 
    } 
    window.selectItem(txt); 
    startTextEditing(txt); 
  } 

  let insertTextMode = false; 
  const tool = new paper.Tool(); 

  tool.onMouseDown = function(event){ 
    const hit = paper.project.hitTest(event.point, { 
      fill: true, 
      stroke: true, 
      segments: true, 
      tolerance: 8, 
      match: function(hitResult) { 
        return !hitResult.item.data || !hitResult.item.data.mockup; 
      } 
    }); 

    if(!hit){ 
      window.deselectItem(); 
      return; 
    } 
    
    const item = window.getSelectableItem(hit.item || hit); 
    if(!item) return; 
    window.selectItem(item); 
    
    if (item.data && item.data.clipGroup) { 
      const contentItem = item.children.find(function(c) { return !c.clipMask; }); 
      if (contentItem) { 
        window.dragOffset = event.point.subtract(contentItem.position); 
      } else { 
        window.dragOffset = event.point.subtract(item.position); 
      } 
    } else { 
      window.dragOffset = event.point.subtract(item.position); 
    } 
    window.dragging = true; 
  }; 

  tool.onMouseDrag = function(event){ 
    if( !window.dragging || !window.selectedItem ){ 
      return; 
    } 
    
    if (window.selectedItem.data && window.selectedItem.data.clipGroup) { 
      const contentItem = window.selectedItem.children.find(function(c) { return !c.clipMask; }); 
      if (contentItem) { 
        contentItem.position = event.point.subtract(window.dragOffset); 
      } 
    } else { 
      window.selectedItem.position = event.point.subtract(window.dragOffset); 
    } 
    paper.view.update(); 
  }; 

  tool.onMouseUp = function(){ 
    if(window.dragging){ 
      saveHistory(); 
    } 
    window.dragging = false; 
  }; 

  tool.onKeyDown = function (event) { 
    const active = document.activeElement; 
    const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable); 
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
    if ( event.modifiers.control && (event.key === "y" || (event.modifiers.shift && event.key === "z")) ) { 
      redo(); 
      return; 
    } 
    if (event.key === "delete") { 
      deleteSelected(); 
    } 
    if ( window.selectedItem && !isLockedItem(window.selectedItem) ) { 
      const step = event.modifiers.shift ? 10 : 1; 
      if (event.key === "left") { 
        window.selectedItem.position.x -= step; 
        event.preventDefault(); 
      } 
      if (event.key === "right") { 
        window.selectedItem.position.x += step; 
        event.preventDefault(); 
      } 
      if (event.key === "up") { 
        window.selectedItem.position.y -= step; 
        event.preventDefault(); 
      } 
      if (event.key === "down") { 
        window.selectedItem.position.y += step; 
        event.preventDefault(); 
      } 
      updateSelectionInfo(); 
      paper.view.update(); 
    } 
  }; 

  document.getElementById("btnAddText").addEventListener("click", activateTextMode); 
  document.getElementById("fontGallery").classList.remove("hidden"); 
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
    addImageFromFile(e.target.files); 
  }); 
  ui.svgPicker.addEventListener("change", (e) => { 
    addSVGFromFile(e.target.files); 
  }); 
  ui.btnApplySize.addEventListener("click", applySelectedSize); 
  ui.btnToggleLock.addEventListener("click", toggleLockSelected); 
  ui.btnAlignLeft.addEventListener("click", () => alignSelected("left")); 
  ui.btnAlignCenterH.addEventListener("click", () => alignSelected("centerH")); 
  ui.btnAlignRight.addEventListener("click", () => alignSelected("right")); 
  ui.btnAlignTop.addEventListener("click", () => alignSelected("top")); 
  ui.btnAlignCenterV.addEventListener("click", () => alignSelected("centerV")); 
  ui.btnAlignBottom.addEventListener("click", () => alignSelected("bottom")); 
  ui.btnRotateLeft.addEventListener("click", () => { rotateSelected(-90); }); 
  ui.btnRotateRight.addEventListener("click", () => { rotateSelected(90); }); 
  ui.btnRotate180.addEventListener("click", () => { rotateSelected(180); }); 
  ui.objWidth.addEventListener("input", () => { lastSizeField = "width"; }); 
  ui.objHeight.addEventListener("input", () => { lastSizeField = "height"; }); 
  ui.btnCenterH.addEventListener("click", () => { centerSelected("horizontal"); }); 
  ui.btnCenterV.addEventListener("click", () => { centerSelected("vertical"); }); 
  ui.btnCenterBoth.addEventListener("click", () => { centerSelected("both"); }); 
  window.addEventListener("resize", () => { 
    paper.view.viewSize = new paper.Size( canvasEl.clientWidth, canvasEl.clientHeight ); 
  }); 
  ui.btnApplyFont.addEventListener("click", applySelectedFont); 
  renderCategories(); 
});
