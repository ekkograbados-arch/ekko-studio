// ============================================================
// RUTA: ASSETS/js/modules/canvas-pro/smartFusion.js
// ACCIÓN: REEMPLAZAR todo el contenido por este
// VERSIÓN: v10.3 — ANCLAJE MAGNÉTICO — ETAPA 1 (CORREGIDA)
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

    for (const item of allItems) {
      // Solo considerar calados activos
      if (item.data && item.data.isHole === true && item.bounds) {
        const distance = this.distanceToBounds(mousePoint, item.bounds);
        if (distance < this.MAGNETIC_THRESHOLD && distance < nearestDistance) {
          nearestDistance = distance;
          nearestHole = item;
        }
      }
    }

    // Actualizar estado
    this.state.nearHole = nearestHole;
    if (nearestHole) {
      console.log(`🧲 ANCLAJE DETECTADO: a ${Math.round(nearestDistance)}px de ${nearestHole.name || 'hueco'}`);
    }
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
