// ============================================================
// VERSIÓN: v10.6 — RECONOCE COMPOUNDPath + SIN SOBRECARGA
// SOLUCIÓN: Las letras son CompoundPath, NO Path simple
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 25, // Un poquito más amplio para facilitar

  COLORS: {
    ANCLADO: '#00FFFF',
    FUSIONADO: '#FF00FF',
    LIBRE: '#4488FF'
  },

  state: {
    scanning: false,
    draggedItem: null,
    nearHole: null,
    isAttached: false,
    mouseOffset: null,
    activeHole: null,
    lastScanTime: 0
  },

  init() {
    this.attachDragListeners();
    console.log('[SMART FUSION v10.6] ✅ COMPOUNDPath RECONOCIDO + OPTIMIZADO');
  },

  attachDragListeners() {
    const self = this;

    paper.tools.forEach(tool => {
      if (tool.onMouseDown) {
        const originalDown = tool.onMouseDown.bind(tool);
        tool.onMouseDown = function(e) {
          try {
            const hit = paper.project.hitTest(e.point);
            if (hit && hit.item) {
              const item = hit.item;
              if (item.className === 'Raster' || item.data?.isClientImage === true) {
                self.state.draggedItem = item;
                self.state.scanning = true;
                self.state.isAttached = false;
                self.state.mouseOffset = null;
                self.scanNearbyHoles(e.point);
                console.log('🖱️ Imagen lista para arrastre');
              }
            }
          } catch (err) {
            console.error('❌ onMouseDown:', err.message);
          }
          return originalDown(e);
        };
      }

      if (tool.onMouseDrag) {
        tool.onMouseDrag = function(e) {
          try {
            if (!self.state.scanning || !self.state.draggedItem) return;

            // ✅ LIMITAR ESCANEO: 1 vez cada 20ms → NO 144x por cada píxel
            const ahora = Date.now();
            if (ahora - self.state.lastScanTime > 20) {
              self.state.lastScanTime = ahora;
              self.scanNearbyHoles(e.point);
            }

            if (self.state.nearHole) {
              const hueco = self.state.nearHole;
              const centroHueco = hueco.bounds.center;

              if (!self.state.isAttached) {
                self.state.isAttached = true;
                self.state.activeHole = hueco;
                self.state.mouseOffset = e.point.subtract(centroHueco);
                self.aplicarBrillo(hueco, self.COLORS.ANCLADO);
                self.state.draggedItem.opacity = 0.75;
                console.log('🧲 ANCLADO → CIAN ✨');
              }
              self.state.draggedItem.position = centroHueco.subtract(self.state.mouseOffset);
              return;
            } else {
              if (self.state.isAttached) {
                console.log('🔓 DESANCLADO → libre');
                self.restaurarBrillo(self.state.activeHole);
                if (self.state.draggedItem) self.state.draggedItem.opacity = 1.0;
                self.resetState();
              }
            }
          } catch (err) {
            console.error('❌ onMouseDrag:', err.message);
          }
        };
      }

      if (tool.onMouseUp) {
        const originalUp = tool.onMouseUp.bind(tool);
        tool.onMouseUp = function(e) {
          try {
            if (self.state.isAttached && self.state.activeHole) {
              const foto = self.state.draggedItem;
              const hueco = self.state.activeHole;

              if (!self.esFormaValida(hueco)) {
                console.error('🚫 Forma no válida → cancelado');
                self.restaurarBrillo(hueco);
                self.resetState();
                return originalUp(e);
              }

              self.fusionarSinModificarOriginal(foto, hueco);
              self.aplicarBrillo(hueco, self.COLORS.FUSIONADO);
              console.log('✅ FUSIÓN 💜 — LETRA INTACTA');
            } else {
              if (self.state.draggedItem) self.state.draggedItem.opacity = 1.0;
            }
          } catch (err) {
            console.error('❌ FUSIÓN ERROR:', err.message);
          }

          self.resetState();
          return originalUp(e);
        };
      }
    });
  },

  // ✅ AHORA ACEPTA Path Y CompoundPath → TUS LETRAS
  esFormaValida(item) {
    if (!item) return false;
    const tipo = item.className;
    if (tipo !== 'Path' && tipo !== 'CompoundPath') return false;
    if (!item.bounds || item.bounds.isEmpty) return false;
    return true;
  },

  fusionarSinModificarOriginal(foto, huecoOriginal) {
    // Clonar SOLO la forma para máscara → original INTACTO
    const mascara = huecoOriginal.clone();
    mascara.position = huecoOriginal.position;
    mascara.data = { isMaskCopy: true };

    foto.bounds = huecoOriginal.bounds.clone();
    foto.opacity = 1.0;
    foto.data.isClientImage = true;

    const grupo = new paper.Group([mascara, foto]);
    grupo.clipped = true;
    grupo.data = { isFusionResult: true };
    grupo.insertBelow(huecoOriginal);
  },

  aplicarBrillo(item, color) {
    if (!item || !item.bounds) return;
    if (!this.esFormaValida(item)) return;

    if (!item.data._strokeOrig) {
      item.data._strokeOrig = item.strokeColor ? item.strokeColor.toCSS() : null;
      item.data._widthOrig = item.strokeWidth || 0;
    }
    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
  },

  restaurarBrillo(item) {
    if (!item || !item.data) return;
    if (item.data._strokeOrig) {
      item.strokeColor = new paper.Color(item.data._strokeOrig);
    } else {
      item.strokeColor = null;
    }
    item.strokeWidth = item.data._widthOrig || 0;
    delete item.data._strokeOrig;
    delete item.data._widthOrig;
  },

  scanNearbyHoles(mousePoint) {
    const todos = this.descomponerGrupos(paper.project.activeLayer.children);
    let nearestHole = null;
    let nearestDistance = Infinity;

    for (const item of todos) {
      if (!item.bounds || item.bounds.isEmpty) continue;

      // Ignorar grupos, máscaras y resultados fusionados
      if (item.className === 'Group') continue;
      if (item.data?.isMaskCopy || item.data?.isFusionResult) continue;

      // ✅ AHORA DETECTA CompoundPath = TUS LETRAS
      if (!this.esCalado(item)) continue;

      if (!this.esFormaValida(item)) continue;

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
    const tipo = item.className;
    if (tipo === 'Path' || tipo === 'CompoundPath') {
      if (!item.fillColor || item.fillColor.alpha === 0) return true;
    }
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
