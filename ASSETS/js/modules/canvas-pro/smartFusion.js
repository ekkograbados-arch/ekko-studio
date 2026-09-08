// ============================================================
// RUTA: ASSETS/js/modules/canvas-pro/smartFusion.js
// ACCIÓN: REEMPLAZAR todo el contenido por este
// VERSIÓN: v10.3 — ANCLAJE MAGNÉTICO — BUSCA DENTRO DE GRUPOS
// ============================================================

export const SMART_FUSION = {
  // Umbral de influencia magnética en píxeles
  MAGNETIC_THRESHOLD: 20,

  // Estado del sistema
  state: {
    scanning: false,
    draggedItem: null,
    nearHole: null,
    originalPosition: null
  },

  // Inicializar escuchadores
  init() {
    this.attachDragListeners();
    console.log('[SMART FUSION v10.3] Anclaje magnético inicializado ✅');
  },

  // Conectar al evento de arrastre del lienzo
  attachDragListeners() {
    const self = this;

    // Al iniciar arrastre → guardar referencia y activar escáner
    paper.tools.forEach(tool => {
      if (tool.onMouseDown) {
        const originalDown = tool.onMouseDown.bind(tool);
        tool.onMouseDown = function(e) {
          const hit = paper.project.hitTest(e.point);
          if (hit && hit.item && hit.item.className === 'Raster') {
            self.state.draggedItem = hit.item;
            self.state.scanning = true;
            self.scanNearbyHoles(e.point);
          }
          return originalDown(e);
        };
      }

      // Durante el arrastre → escanear en tiempo real
      if (tool.onMouseDrag) {
        const originalDrag = tool.onMouseDrag.bind(tool);
        tool.onMouseDrag = function(e) {
          if (self.state.scanning && self.state.draggedItem) {
            self.scanNearbyHoles(e.point);
          }
          return originalDrag(e);
        };
      }

      // Al soltar → desactivar escáner
      if (tool.onMouseUp) {
        const originalUp = tool.onMouseUp.bind(tool);
        tool.onMouseUp = function(e) {
          self.resetState();
          return originalUp(e);
        };
      }
    });
  },

  // Buscar huecos/calados cercanos al punto del ratón
  scanNearbyHoles(mousePoint) {
    const allItems = paper.project.activeLayer.children;
    let nearestHole = null;
    let nearestDistance = Infinity;

    // Recorrer TODO incluyendo lo que está DENTRO DE GRUPOS
    const todosLosElementos = this.descomponerGrupos(allItems);

    for (const item of todosLosElementos) {
      if (!item.bounds) continue;

      // ✅ RECONOCER CALADO: por marca isHole O por nombre/tipo
      const esCalado = this.esCalado(item);
      if (!esCalado) continue;

      const distance = this.distanceToBounds(mousePoint, item.bounds);
      if (distance < this.MAGNETIC_THRESHOLD && distance < nearestDistance) {
        nearestDistance = distance;
        nearestHole = item;
      }
    }

    // Actualizar estado
    this.state.nearHole = nearestHole;
    if (nearestHole) {
      console.log(`🧲 ANCLAJE DETECTADO: a ${Math.round(nearestDistance)}px de "${nearestHole.name || 'letra/calado'}"`);
    }
  },

  // 🧩 DESCOMPONER GRUPOS: saca todos los elementos internos
  descomponerGrupos(elementos) {
    const resultado = [];
    const recorrer = (lista) => {
      for (const el of lista) {
        if (el.children && el.children.length > 0) {
          recorrer(el.children);
        } else {
          resultado.push(el);
        }
      }
    };
    recorrer(elementos);
    return resultado;
  },

  // 🔍 RECONOCER SI ES UN CALADO
  esCalado(item) {
    // 1. Si tiene la marca explícita
    if (item.data?.isHole === true) return true;
    
    // 2. Si es un trazado con relleno nulo o hueco
    if (item.className === 'Path' && (!item.fillColor || item.fillColor.alpha === 0)) return true;
    
    // 3. Si tiene nombre de letra o calado (A, F, letra-A, etc.)
    if (item.name && /^[AF]$|letra|calado|hueco/i.test(item.name)) return true;

    // 4. Si es Path y tiene operación de sustracción
    if (item.clipMask === true || item.blendMode === 'subtract') return true;

    return false;
  },

  // Calcular distancia desde punto al borde del objeto
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
  }
};

// ✅ EXPORTACIÓN QUE ESPERA editor.js
export function initSmartFusionListeners() {
  SMART_FUSION.init();
}

// Exponer globalmente por compatibilidad
window.SMART_FUSION = SMART_FUSION;
window.initSmartFusionListeners = initSmartFusionListeners;
