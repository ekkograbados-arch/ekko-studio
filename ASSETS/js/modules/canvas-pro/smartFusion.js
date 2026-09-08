// ============================================================
// RUTA: ASSETS/js/modules/canvas-pro/smartFusion.js
// ACCIÓN: REEMPLAZAR todo el contenido por este
// VERSIÓN: v10.3 — ETAPA 3: FUSIÓN REAL + COLORES DE ESTADO
// COLORES: CIAN = ANCLADO | FUCSIA = FUSIONADO | AZUL = DESANCLADO
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 20,

  // 🎨 PALETA DE COLORES DE ESTADO
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
    console.log('[SMART FUSION v10.3] ✅ FUSIÓN + COLORES DE ESTADO ACTIVOS');
  },

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
            self.state.mouseOffset = null;
            self.scanNearbyHoles(e.point);
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

                // ✨ BRILLO CIAN NEÓN — PENDIENTE DE FUSIÓN
                self.aplicarBrillo(hueco, self.COLORS.ANCLADO);
                // 🪟 IMAGEN TRANSLÚCIDA MIENTRAS AJUSTA
                self.state.draggedItem.opacity = 0.75;

                console.log(`🧲 ANCLADO → BRILLO CIAN ✨ — listo para fusionar`);
              }

              // MANTENER CENTRADO
              self.state.draggedItem.position = centroHueco.subtract(self.state.mouseOffset);
              return;
            }
            else {
              // SE ALEJÓ → DESANCLAR CON BRILLO AZUL
              if (self.state.isAttached) {
                console.log(`🔓 DESANCLADO → BRILLO AZUL 💙 — libre`);
                self.restaurarBrillo(self.state.activeHole, self.COLORS.LIBRE);
                self.state.draggedItem.opacity = 1.0;
                self.resetState();
              }
            }
          }
        };
      }

      // AL SOLTAR → FUSIÓN REAL + BRILLO FUCSIA
      if (tool.onMouseUp) {
        const originalUp = tool.onMouseUp.bind(tool);
        tool.onMouseUp = function(e) {
          if (self.state.isAttached && self.state.activeHole) {
            const foto = self.state.draggedItem;
            const hueco = self.state.activeHole;

            // ✅ APLICAR MÁSCARA → FUSIÓN REAL
            self.fusionar(foto, hueco);

            // 💜 BRILLO FUCSIA NEÓN → FUSIÓN CONFIRMADA
            self.aplicarBrillo(hueco, self.COLORS.FUSIONADO);

            console.log(`✅ FUSIÓN CONFIRMADA → BRILLO FUCSIA 💜 — foto recortada dentro de la letra`);
          }
          else {
            // Restaurar si se soltó libre
            if (self.state.draggedItem) self.state.draggedItem.opacity = 1.0;
          }

          self.resetState();
          return originalUp(e);
        };
      }
    });
  },

  // 🔗 FUSIÓN REAL — Aplica máscara y agrupa
  fusionar(foto, hueco) {
    // Ocultar brillo de contorno
    this.limpiarBrillo(hueco);

    // Alinear foto al tamaño exacto del hueco
    foto.bounds = hueco.bounds.clone();

    // Crear grupo con máscara: hueco encima, foto debajo
    const grupo = new paper.Group([hueco, foto]);
    grupo.clipped = true; // ✅ EL HUECO RECORTA LA FOTO
    grupo.data = grupo.data || {};
    grupo.data.isFusion = true; // Marcar como fusionado
    grupo.data.maskSource = hueco;
    grupo.data.photoSource = foto;

    // Restaurar opacidad
    foto.opacity = 1.0;

    // Guardar referencia para "Quitar Fusión"
    hueco.data.fusionGroup = grupo;
    foto.data.fusionGroup = grupo;
  },

  // ✨ Aplicar brillo de contorno
  aplicarBrillo(item, color) {
    this.limpiarBrillo(item);
    item.data.strokeBackup = item.strokeColor;
    item.data.strokeWidthBackup = item.strokeWidth;
    item.data.opacityBackup = item.opacity;

    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
    item.opacity = 0.95;
  },

  // 💙 Transición al desanclar
  restaurarBrillo(item, color) {
    if (!item) return;
    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 2;
    // Se desvanece en 500ms
    paper.view.onFrame = () => {
      if (item.strokeWidth > 0.1) {
        item.strokeWidth *= 0.92;
      } else {
        this.limpiarBrillo(item);
        paper.view.onFrame = null;
      }
    };
  },

  // 🧹 Quitar todo brillo
  limpiarBrillo(item) {
    if (!item || !item.data) return;
    if (item.data.strokeBackup !== undefined) item.strokeColor = item.data.strokeBackup;
    if (item.data.strokeWidthBackup !== undefined) item.strokeWidth = item.data.strokeWidthBackup;
    if (item.data.opacityBackup !== undefined) item.opacity = item.data.opacityBackup;
  },

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
