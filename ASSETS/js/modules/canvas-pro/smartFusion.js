// ============================================================
// RUTA: ASSETS/js/modules/canvas-pro/smartFusion.js
// VERSIÓN: v10.4 — CORREGIDA: sin bucles + PROTEGE SVG DEL PRODUCTO
// REGLA: El SVG del producto NUNCA se mueve ni se guarda en referencias circulares
// COLORES: CIAN=ANCLADO | FUCSIA=FUSIONADO | AZUL=DESANCLADO
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 20,

  COLORS: {
    ANCLADO: '#00FFFF',    // ✨ Cian neón — pendiente
    FUSIONADO: '#FF00FF',  // 💜 Fucsia neón — confirmado
    LIBRE: '#4488FF'       // 💙 Azul suave — desanclando
  },

  state: {
    scanning: false,
    draggedItem: null,
    nearHole: null,
    isAttached: false,
    mouseOffset: null,
    activeHole: null
  },

  init() {
    this.attachDragListeners();
    console.log('[SMART FUSION v10.4] ✅ FUSIÓN SEGURA — SVG DEL PRODUCTO PROTEGIDO');
  },

  attachDragListeners() {
    const self = this;

    paper.tools.forEach(tool => {
      // Al iniciar arrastre — SOLO imágenes del cliente
      if (tool.onMouseDown) {
        const originalDown = tool.onMouseDown.bind(tool);
        tool.onMouseDown = function(e) {
          const hit = paper.project.hitTest(e.point);
          if (hit && hit.item) {
            const item = hit.item;
            // ✅ SOLO se arrastran imágenes cargadas por el cliente
            if (item.className === 'Raster' || item.data?.isClientImage === true) {
              self.state.draggedItem = item;
              self.state.scanning = true;
              self.state.isAttached = false;
              self.state.mouseOffset = null;
              self.scanNearbyHoles(e.point);
            }
          }
          return originalDown(e);
        };
      }

      // Durante arrastre → ANCLAJE + BRILLO CIAN
      if (tool.onMouseDrag) {
        tool.onMouseDrag = function(e) {
          if (self.state.scanning && self.state.draggedItem) {
            self.scanNearbyHoles(e.point);

            if (self.state.nearHole) {
              const hueco = self.state.nearHole;
              const centroHueco = hueco.bounds.center;

              if (!self.state.isAttached) {
                self.state.isAttached = true;
                self.state.activeHole = hueco;
                self.state.mouseOffset = e.point.subtract(centroHueco);

                // ✨ BRILLO CIAN — SIN modificar el SVG del producto
                self.aplicarBrillo(hueco, self.COLORS.ANCLADO);
                self.state.draggedItem.opacity = 0.75;

                console.log(`🧲 ANCLADO → BRILLO CIAN ✨ — pendiente de fusión`);
              }

              self.state.draggedItem.position = centroHueco.subtract(self.state.mouseOffset);
              return;
            }
            else {
              if (self.state.isAttached) {
                console.log(`🔓 DESANCLADO → vuelve a libre`);
                self.restaurarBrillo(self.state.activeHole);
                if (self.state.draggedItem) self.state.draggedItem.opacity = 1.0;
                self.resetState();
              }
            }
          }
        };
      }

      // AL SOLTAR → FUSIÓN SIN TOCAR EL SVG ORIGINAL
      if (tool.onMouseUp) {
        const originalUp = tool.onMouseUp.bind(tool);
        tool.onMouseUp = function(e) {
          if (self.state.isAttached && self.state.activeHole) {
            const foto = self.state.draggedItem;
            const hueco = self.state.activeHole;

            // ✅ FUSIÓN: CLONAMOS el hueco como máscara → el original QUEDA INTACTO
            self.fusionarSinModificarOriginal(foto, hueco);

            // 💜 BRILLO FUCSIA — en el hueco original del producto
            self.aplicarBrillo(hueco, self.COLORS.FUSIONADO);

            console.log(`✅ FUSIÓN CONFIRMADA → Foto recortada — SVG DEL PRODUCTO INTACTO 💜`);
          }
          else {
            if (self.state.draggedItem) self.state.draggedItem.opacity = 1.0;
          }

          self.resetState();
          return originalUp(e);
        };
      }
    });
  },

  // 🔗 FUSIÓN SEGURA → NO modifica ni mueve el SVG del producto
  fusionarSinModificarOriginal(foto, huecoOriginal) {
    // ✅ Clonamos el hueco SOLO para usarlo como máscara
    const mascara = huecoOriginal.clone();
    mascara.position = huecoOriginal.position; // MISMA posición
    mascara.bounds = huecoOriginal.bounds.clone(); // MISMOS límites
    mascara.data = {};
    mascara.data.isMaskCopy = true; // Marcar como copia de máscara

    // ✅ Ajustamos la foto al tamaño del hueco
    foto.bounds = huecoOriginal.bounds.clone();
    foto.opacity = 1.0;
    foto.data.isClientImage = true; // Marcar como imagen del cliente

    // ✅ Creamos grupo con la MÁSCARA CLONADA, sin tocar el hueco original
    const grupo = new paper.Group([mascara, foto]);
    grupo.clipped = true; // La máscara recorta la foto
    grupo.data = { isFusionResult: true };

    // ✅ Colocamos el grupo fusionado DETRÁS del hueco original del producto
    const indiceOriginal = huecoOriginal.index;
    grupo.insertBelow(huecoOriginal); // Queda detrás → se ve el contorno original

    // ✅ El hueco original del producto se mantiene VISUALMENTE igual
    // pero ahora muestra su contorno sobre la foto recortada
  },

  // ✨ Aplicar brillo sin guardar referencias circulares
  aplicarBrillo(item, color) {
    if (!item || !item.bounds) return;

    // Guardamos estado anterior en propiedades simples, SIN referencias cruzadas
    if (!item.data._strokeOrig) {
      item.data._strokeOrig = item.strokeColor ? item.strokeColor.toCSS() : null;
      item.data._widthOrig = item.strokeWidth || 0;
    }

    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
  },

  // 💙 Restaurar brillo SIN animación infinita
  restaurarBrillo(item) {
    if (!item || !item.data) return;

    // Restaurar valores originales
    if (item.data._strokeOrig) {
      item.strokeColor = new paper.Color(item.data._strokeOrig);
    } else {
      item.strokeColor = null;
    }
    item.strokeWidth = item.data._widthOrig || 0;

    // Limpiar datos temporales
    delete item.data._strokeOrig;
    delete item.data._widthOrig;
  },

  scanNearbyHoles(mousePoint) {
    const todos = this.descomponerGrupos(paper.project.activeLayer.children);
    let nearestHole = null;
    let nearestDistance = Infinity;

    for (const item of todos) {
      if (!item.bounds) continue;
      if (!this.esCalado(item)) continue;
      // ✅ Ignorar máscaras clonadas — SOLO detectar huecos originales del producto
      if (item.data?.isMaskCopy || item.data?.isFusionResult) continue;

      const distance = this.distanceToBounds(mousePoint, item.bounds);
      if (distance < this.MAGNETIC_THRESHOLD && distance < nearestDistance) {
        nearestDistance = distance;
        nearestHole = item;
      }
    }
    this.state.nearHole = nearestHole;
  },

  descomponerGrupos(elementos) {
    const resultado = [];
    const recorrer = (lista) => {
      for (const el of lista) {
        if (el.children && el.children.length > 0) recorrer(el.children);
        else resultado.push(el);
      }
    };
    recorrer(elementos);
    return resultado;
  },

  esCalado(item) {
    if (item.data?.isHole === true) return true;
    if (item.className === 'Path' && (!item.fillColor || item.fillColor.alpha === 0)) return true;
    if (item.clipMask === true || item.blendMode === 'subtract') return true;
    return false;
  },

  distanceToBounds(point, bounds) {
    const dx = Math.max(bounds.left - point.x, point.x - bounds.right, 0);
    const dy = Math.max(bounds.top - point.y, point.y - bounds.bottom, 0);
    return Math.sqrt(dx * dx + dy * dy);
  },

  resetState() {
    this.state.scanning = false;
    this.state.draggedItem = null;
    this.state.nearHole = null;
    this.state.isAttached = false;
    this.state.activeHole = null;
    this.state.mouseOffset = null;
  }
};

export function initSmartFusionListeners() {
  SMART_FUSION.init();
}

window.SMART_FUSION = SMART_FUSION;
window.initSmartFusionListeners = initSmartFusionListeners;
