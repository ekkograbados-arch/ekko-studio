// ============================================================
// RUTA: ASSETS/js/modules/canvas-pro/smartFusion.js
// VERSIÓN: v10.5 — FILTROS ESTRICTOS + DIAGNÓSTICO EN CONSOLA
// SOLUCIÓN: Evita llamadas a .getCurves() sobre elementos que NO son Path
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 20,

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
    activeHole: null
  },

  init() {
    this.attachDragListeners();
    console.log('[SMART FUSION v10.5] ✅ SISTEMA CARGADO — FILTROS ACTIVOS');
  },

  attachDragListeners() {
    const self = this;

    paper.tools.forEach(tool => {
      // AL PRESIONAR CLIC
      if (tool.onMouseDown) {
        const originalDown = tool.onMouseDown.bind(tool);
        tool.onMouseDown = function(e) {
          try {
            const hit = paper.project.hitTest(e.point);
            if (hit && hit.item) {
              const item = hit.item;
              // ✅ FILTRO: SOLO imágenes del cliente (Raster)
              if (item.className === 'Raster' || item.data?.isClientImage === true) {
                self.state.draggedItem = item;
                self.state.scanning = true;
                self.state.isAttached = false;
                self.state.mouseOffset = null;
                self.scanNearbyHoles(e.point);
                console.log('🖱️ Imagen detectada y lista para arrastre');
              } else {
                console.log('ℹ️ Elemento ignorado (no es imagen del cliente):', item.className);
              }
            }
          } catch (err) {
            console.error('❌ Error en onMouseDown:', err.message);
          }
          return originalDown(e);
        };
      }

      // DURANTE ARRASTRE
      if (tool.onMouseDrag) {
        tool.onMouseDrag = function(e) {
          try {
            if (!self.state.scanning || !self.state.draggedItem) return;

            self.scanNearbyHoles(e.point);

            if (self.state.nearHole) {
              const hueco = self.state.nearHole;
              const centroHueco = hueco.bounds.center;

              if (!self.state.isAttached) {
                self.state.isAttached = true;
                self.state.activeHole = hueco;
                self.state.mouseOffset = e.point.subtract(centroHueco);
                self.aplicarBrillo(hueco, self.COLORS.ANCLADO);
                self.state.draggedItem.opacity = 0.75;
                console.log('🧲 ANCLADO a hueco válido ✨');
              }
              self.state.draggedItem.position = centroHueco.subtract(self.state.mouseOffset);
              return;
            } else {
              if (self.state.isAttached) {
                console.log('🔓 Desanclado — vuelve a libre');
                self.restaurarBrillo(self.state.activeHole);
                if (self.state.draggedItem) self.state.draggedItem.opacity = 1.0;
                self.resetState();
              }
            }
          } catch (err) {
            console.error('❌ Error en arrastre:', err.message);
          }
        };
      }

      // AL SOLTAR → FUSIÓN
      if (tool.onMouseUp) {
        const originalUp = tool.onMouseUp.bind(tool);
        tool.onMouseUp = function(e) {
          try {
            if (self.state.isAttached && self.state.activeHole) {
              const foto = self.state.draggedItem;
              const hueco = self.state.activeHole;

              // ✅ VERIFICACIÓN DE SEGURIDAD ANTES DE FUSIONAR
              if (!self.esPathValido(hueco)) {
                console.error('🚫 Hueco NO válido como Path — fusión cancelada');
                self.restaurarBrillo(hueco);
                self.resetState();
                return originalUp(e);
              }

              self.fusionarSinModificarOriginal(foto, hueco);
              self.aplicarBrillo(hueco, self.COLORS.FUSIONADO);
              console.log('✅ FUSIÓN EXITOSA 💜 — SVG DEL PRODUCTO INTACTO');
            } else {
              if (self.state.draggedItem) self.state.draggedItem.opacity = 1.0;
            }
          } catch (err) {
            console.error('❌ Error en fusión:', err.message);
          }

          self.resetState();
          return originalUp(e);
        };
      }
    });
  },

  // ✅ VERIFICACIÓN CRÍTICA: ¿Es un Path real con curvas?
  esPathValido(item) {
    if (!item) return false;
    if (item.className !== 'Path') return false;
    if (typeof item.getCurves !== 'function') return false;
    if (!item.bounds || item.bounds.isEmpty) return false;
    return true;
  },

  // FUSIÓN SEGURA
  fusionarSinModificarOriginal(foto, huecoOriginal) {
    // ✅ Solo proceder si el hueco es un Path válido
    if (!this.esPathValido(huecoOriginal)) {
      throw new Error('El hueco no es un Path válido');
    }

    // Clonar SOLO la forma, sin referencias cruzadas
    const mascara = huecoOriginal.clone();
    mascara.position = huecoOriginal.position;
    mascara.data = {};
    mascara.data.isMaskCopy = true;

    // Ajustar foto
    foto.bounds = huecoOriginal.bounds.clone();
    foto.opacity = 1.0;
    foto.data.isClientImage = true;

    // Crear grupo
    const grupo = new paper.Group([mascara, foto]);
    grupo.clipped = true;
    grupo.data = { isFusionResult: true };

    // Colocar detrás del original
    grupo.insertBelow(huecoOriginal);

    console.log('📦 Grupo fusionado creado sin afectar el original');
  },

  aplicarBrillo(item, color) {
    if (!item || !item.bounds) return;
    if (!this.esPathValido(item)) return;

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

  // 🔍 ESCANEAR HUECOS CON FILTRO ESTRICTO
  scanNearbyHoles(mousePoint) {
    const todos = this.descomponerGrupos(paper.project.activeLayer.children);
    let nearestHole = null;
    let nearestDistance = Infinity;

    console.log(`🔍 Escaneando ${todos.length} elementos...`);

    for (const item of todos) {
      // ✅ FILTRO 1: ¿Tiene límites válidos?
      if (!item.bounds || item.bounds.isEmpty) continue;

      // ✅ FILTRO 2: ¿Es un hueco/calado?
      if (!this.esCalado(item)) continue;

      // ✅ FILTRO 3: Ignorar máscaras clonadas y grupos
      if (item.data?.isMaskCopy || item.data?.isFusionResult) continue;
      if (item.className === 'Group') continue;

      // ✅ FILTRO 4: ¿Es un Path real con curvas? ← ESTO SOLUCIONA EL ERROR
      if (!this.esPathValido(item)) {
        console.log('⚠️ Elemento NO es Path válido → ignorado:', item.className);
        continue;
      }

      // ✅ Si llega acá → es un hueco REAL del producto
      const distance = this.distanceToBounds(mousePoint, item.bounds);
      if (distance < this.MAGNETIC_THRESHOLD && distance < nearestDistance) {
        nearestDistance = distance;
        nearestHole = item;
      }
    }

    this.state.nearHole = nearestHole;
    if (nearestHole) {
      console.log(`🎯 Hueco válido encontrado a ${Math.round(nearestDistance)}px`);
    }
  },

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

  esCalado(item) {
    if (item.data?.isHole === true) return true;
    if (item.className === 'Path') {
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
