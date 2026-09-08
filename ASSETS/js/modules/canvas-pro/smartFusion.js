// ============================================================
// VERSIÓN: v10.9 — IGNORA BOUNDS VACÍOS Y DETECTA POR POSICIÓN
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 35, // Un poco más amplio

  COLORS: {
    ANCLADO: '#00FFFF',
    FUSIONADO: '#FF00FF',
    LIBRE: '#4488FF'
  },

  state: {
    draggingItem: null,
    activeHole: null,
    isSnapped: false,
    mouseOffset: null,
    lastScanTime: 0
  },

  init() {
    this.enhanceDragBehavior();
    console.log('[SMART FUSION v10.9] ✅ IGNORA BOUNDS VACÍOS — DETECCIÓN MEJORADA');
  },

  enhanceDragBehavior() {
    const self = this;

    paper.tools.forEach(tool => {
      const originalOnMouseDown = tool.onMouseDown;
      const originalOnMouseDrag = tool.onMouseDrag;
      const originalOnMouseUp = tool.onMouseUp;

      tool.onMouseDown = function(e) {
        if (originalOnMouseDown) originalOnMouseDown.call(this, e);

        setTimeout(() => {
          const hit = paper.project.hitTest(e.point);
          if (hit && hit.item) {
            const item = hit.item;
            if (item.className === 'Raster' || item.data?.isClientImage === true) {
              self.state.draggingItem = item;
              console.log('🖱️ IMAGEN SELECCIONADA');
            }
          }
        }, 0);
      };

      tool.onMouseDrag = function(e) {
        if (originalOnMouseDrag) originalOnMouseDrag.call(this, e);
        if (!self.state.draggingItem) return;

        const ahora = Date.now();
        if (ahora - self.state.lastScanTime < 30) return;
        self.state.lastScanTime = ahora;

        const huecoCercano = self.encontrarHuecoMasCercano(e.point);

        if (huecoCercano) {
          // ✅ OBTENER CENTRO — aunque bounds esté vacío
          let centro;
          try {
            centro = huecoCercano.position;
            if (!centro || isNaN(centro.x) || isNaN(centro.y)) {
              centro = huecoCercano.bounds ? huecoCercano.bounds.center : null;
            }
          } catch {
            centro = null;
          }

          if (!centro) {
            console.log('⚠️ Hueco sin posición → ignorado');
            return;
          }

          if (!self.state.isSnapped || self.state.activeHole !== huecoCercano) {
            self.state.isSnapped = true;
            self.state.activeHole = huecoCercano;
            self.state.mouseOffset = e.point.subtract(centro);
            self.aplicarBrillo(huecoCercano, self.COLORS.ANCLADO);
            self.state.draggingItem.opacity = 0.75;
            console.log('🧲 IMÁN ACTIVO en', huecoCercano.className, '@', Math.round(centro.x) + ',' + Math.round(centro.y));
          }

          self.state.draggingItem.position = centro.subtract(self.state.mouseOffset);
        }
        else if (self.state.isSnapped) {
          console.log('🔓 Liberado');
          self.restaurarBrillo(self.state.activeHole);
          if (self.state.draggingItem) self.state.draggingItem.opacity = 1.0;
          self.resetState();
        }
      };

      tool.onMouseUp = function(e) {
        if (originalOnMouseUp) originalOnMouseUp.call(this, e);

        if (self.state.isSnapped && self.state.activeHole && self.state.draggingItem) {
          const foto = self.state.draggingItem;
          const hueco = self.state.activeHole;

          self.fusionarSinModificarOriginal(foto, hueco);
          self.aplicarBrillo(hueco, self.COLORS.FUSIONADO);
          console.log('✅ FUSIÓN 💜 EXITOSA');
        }

        if (self.state.draggingItem) self.state.draggingItem.opacity = 1.0;
        self.resetState();
      };
    });
  },

  encontrarHuecoMasCercano(punto) {
    const todos = this.descomponerGrupos(paper.project.activeLayer.children);
    let masCercano = null;
    let menorDist = Infinity;

    for (const item of todos) {
      // Ignorar grupos y resultados anteriores
      if (item.className === 'Group') continue;
      if (item.data?.isMaskCopy || item.data?.isFusionResult) continue;

      // ✅ ES CALADO? → sin relleno
      if (!this.esCalado(item)) continue;

      // ✅ OBTENER POSICIÓN DE CUALQUIER FORMA
      let pos;
      try {
        pos = item.position;
        if (!pos || isNaN(pos.x) || isNaN(pos.y)) {
          if (item.bounds && !item.bounds.isEmpty) {
            pos = item.bounds.center;
          }
        }
      } catch {
        continue;
      }
      if (!pos || isNaN(pos.x) || isNaN(pos.y)) continue;

      // ✅ CALCULAR DISTANCIA
      const dist = Math.sqrt(Math.pow(punto.x - pos.x, 2) + Math.pow(punto.y - pos.y, 2));

      if (dist < this.MAGNETIC_THRESHOLD && dist < menorDist) {
        menorDist = dist;
        masCercano = item;
      }
    }
    return masCercano;
  },

  esCalado(item) {
    if (item.data?.isHole === true) return true;
    const tipo = item.className;
    if (tipo === 'Path' || tipo === 'CompoundPath' || tipo === 'Shape') {
      if (!item.fillColor || item.fillColor.alpha === 0) return true;
    }
    if (item.clipMask === true) return true;
    if (item.blendMode === 'subtract') return true;
    return false;
  },

  fusionarSinModificarOriginal(foto, huecoOriginal) {
    let centro;
    try {
      centro = huecoOriginal.position;
      if (!centro || isNaN(centro.x)) centro = huecoOriginal.bounds.center;
    } catch {
      return;
    }

    const mascara = huecoOriginal.clone();
    mascara.position = centro;
    mascara.data = { isMaskCopy: true };

    // Usar bounds si existen, sino mantener tamaño original
    if (huecoOriginal.bounds && !huecoOriginal.bounds.isEmpty) {
      foto.bounds = huecoOriginal.bounds.clone();
    } else {
      foto.position = centro;
    }
    foto.opacity = 1.0;
    foto.data.isClientImage = true;

    const grupo = new paper.Group([mascara, foto]);
    grupo.clipped = true;
    grupo.data = { isFusionResult: true };
    grupo.insertBelow(huecoOriginal);
  },

  aplicarBrillo(item, color) {
    if (!item.data._strokeOrig) {
      item.data._strokeOrig = item.strokeColor ? item.strokeColor.toCSS() : null;
      item.data._widthOrig = item.strokeWidth || 0;
    }
    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
  },

  restaurarBrillo(item) {
    if (!item.data) return;
    item.strokeColor = item.data._strokeOrig ? new paper.Color(item.data._strokeOrig) : null;
    item.strokeWidth = item.data._widthOrig || 0;
    delete item.data._strokeOrig;
    delete item.data._widthOrig;
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

  resetState() {
    this.state.isSnapped = false;
    this.state.activeHole = null;
    this.state.mouseOffset = null;
  }
};

export function initSmartFusionListeners() {
  SMART_FUSION.init();
}

window.SMART_FUSION = SMART_FUSION;
window.initSmartFusionListeners = initSmartFusionListeners;
