// ============================================================
// RUTA: ASSETS/js/modules/canvas-pro/smartFusion.js
// ACCIÓN: REEMPLAZAR todo el contenido por este
// VERSIÓN: v10.3 — ETAPA 2: ADHERENCIA MAGNÉTICA
// COMPORTAMIENTO: Al acercar → se pega y centra sola
// ============================================================

export const SMART_FUSION = {
  // Umbral de influencia magnética en píxeles
  MAGNETIC_THRESHOLD: 20,

  // Estado del sistema
  state: {
    scanning: false,
    draggedItem: null,
    nearHole: null,
    isAttached: false,
    originalOffset: null,
    mouseOffset: null
  },

  // Inicializar escuchadores
  init() {
    this.attachDragListeners();
    console.log('[SMART FUSION v10.3] ✅ ANCLAJE + ADHERENCIA ACTIVA');
  },

  // Conectar al evento de arrastre del lienzo
  attachDragListeners() {
    const self = this;

    paper.tools.forEach(tool => {
      // Al iniciar arrastre
      if (tool.onMouseDown) {
        const originalDown = tool.onMouseDown.bind(tool);
        tool.onMouseDown = function(e) {
          const hit = paper.project.hitTest(e.point);
          if (hit && hit.item && hit.item.className === 'Raster') {
            self.state.draggedItem = hit.item;
            self.state.scanning = true;
            self.state.isAttached = false;
            self.state.originalOffset = null;
            self.scanNearbyHoles(e.point);
          }
          return originalDown(e);
        };
      }

      // Durante el arrastre → ¡AQUÍ OCURRE EL IMÁN!
      if (tool.onMouseDrag) {
        tool.onMouseDrag = function(e) {
          if (self.state.scanning && self.state.draggedItem) {
            self.scanNearbyHoles(e.point);

            if (self.state.nearHole) {
              // ✅ HAY HUECO CERCANO → ACTIVAR ANCLAJE
              const hueco = self.state.nearHole;
              const centroHueco = hueco.bounds.center;

              // Guardar desplazamiento inicial SOLO UNA VEZ al adherir
              if (!self.state.isAttached) {
                self.state.isAttached = true;
                // Distancia entre el ratón y el centro del hueco en el momento de adherir
                self.state.mouseOffset = e.point.subtract(centroHueco);
                console.log(`🧲 ANCLADO a: "${hueco.name || 'letra'}" → SE CENTRA`);
              }

              // ✅ MANTENER LA IMAGEN FIJA EN EL CENTRO DEL HUECO
              self.state.draggedItem.position = centroHueco.subtract(self.state.mouseOffset);

              // ⛔ NO dejes que el arrastre normal mueva la foto
              return;
            }
            else {
              // ✅ SE ALEJÓ → DESANCLAR SUAVEMENTE
              if (self.state.isAttached) {
                console.log(`🧲 DESANCLADO → vuelve a arrastre libre`);
                self.state.isAttached = false;
                self.state.mouseOffset = null;
              }
            }
          }
        };
      }

      // Al soltar → desactivar todo
      if (tool.onMouseUp) {
        const originalUp = tool.onMouseUp.bind(tool);
        tool.onMouseUp = function(e) {
          if (self.state.isAttached && self.state.nearHole) {
            console.log(`✅ FUSIÓN PENDIENTE → Foto encajada en: "${self.state.nearHole.name || 'letra'}"`);
          }
          self.resetState();
          return originalUp(e);
        };
      }
    });
  },

  // Buscar huecos/calados cercanos al punto del ratón
  scanNearbyHoles(mousePoint) {
    const todos = this.descomponerGrupos(paper.project.activeLayer.children);
    let nearestHole = null;
    let nearestDistance = Infinity;

    for (const item of todos) {
      if (!item.bounds) continue;
      if (!this.esCalado(item)) continue;

      const distance = this.distanceToBounds(mousePoint, item.bounds);
      if (distance < this.MAGNETIC_THRESHOLD && distance < nearestDistance) {
        nearestDistance = distance;
        nearestHole = item;
      }
    }

    this.state.nearHole = nearestHole;
  },

  // Descomponer grupos
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

  // Reconocer calado
  esCalado(item) {
    if (item.data?.isHole === true) return true;
    if (item.className === 'Path' && (!item.fillColor || item.fillColor.alpha === 0)) return true;
    if (item.clipMask === true || item.blendMode === 'subtract') return true;
    return false;
  },

  // Distancia al borde
  distanceToBounds(point, bounds) {
    const dx = Math.max(bounds.left - point.x, point.x - bounds.right, 0);
    const dy = Math.max(bounds.top - point.y, point.y - bounds.bottom, 0);
    return Math.sqrt(dx * dx + dy * dy);
  },

  // Restablecer estado
  resetState() {
    this.state.scanning = false;
    this.state.draggedItem = null;
    this.state.nearHole = null;
    this.state.isAttached = false;
    this.state.mouseOffset = null;
  }
};

// ✅ Exportación requerida
export function initSmartFusionListeners() {
  SMART_FUSION.init();
}

window.SMART_FUSION = SMART_FUSION;
window.initSmartFusionListeners = initSmartFusionListeners;
