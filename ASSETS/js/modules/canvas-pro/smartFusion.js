// ============================================================
// VERSIÓN: v10.1 — POSICIÓN REAL SUMANDO GRUPO PADRE
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 40,

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
    console.log('[SMART FUSION v10.1] ✅ POSICIÓN REAL DESDE GRUPO PADRE');
  },

  // 🔑 OBTENER POSICIÓN ABSOLUTA EN EL LIENZO
  obtenerPosicionReal(item) {
    let x = 0, y = 0;
    let actual = item;
    while (actual) {
      try {
        const pos = actual.position;
        if (pos && !isNaN(pos.x) && !isNaN(pos.y)) {
          x += pos.x;
          y += pos.y;
        }
        actual = actual.parent;
      } catch { break; }
    }
    return new paper.Point(x, y);
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
          const centroReal = self.obtenerPosicionReal(huecoCercano);

          if (!self.state.isSnapped || self.state.activeHole !== huecoCercano) {
            self.state.isSnapped = true;
            self.state.activeHole = huecoCercano;
            self.state.mouseOffset = e.point.subtract(centroReal);
            self.aplicarBrillo(huecoCercano, self.COLORS.ANCLADO);
            self.state.draggingItem.opacity = 0.75;
            console.log('🧲 IMÁN →', huecoCercano.className, 'en', Math.round(centroReal.x) + ',' + Math.round(centroReal.y));
          }

          self.state.draggingItem.position = centroReal.subtract(self.state.mouseOffset);
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
          const centroReal = self.obtenerPosicionReal(hueco);

          self.fusionarEnPosicion(foto, hueco, centroReal);
          self.aplicarBrillo(hueco, self.COLORS.FUSIONADO);
          console.log('✅ FUSIÓN 💜 en posición', Math.round(centroReal.x) + ',' + Math.round(centroReal.y));
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
      if (item.className === 'Group') continue;
      if (item.data?.isMaskCopy || item.data?.isFusionResult) continue;
      if (!this.esCalado(item)) continue;

      const centroReal = this.obtenerPosicionReal(item);
      const dist = Math.sqrt(Math.pow(punto.x - centroReal.x, 2) + Math.pow(punto.y - centroReal.y, 2));

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

  fusionarEnPosicion(foto, huecoOriginal, centroReal) {
    const mascara = huecoOriginal.clone();
    mascara.position = centroReal;
    mascara.data = { isMaskCopy: true };

    if (huecoOriginal.bounds && !huecoOriginal.bounds.isEmpty) {
      foto.bounds = huecoOriginal.bounds.clone();
    } else {
      foto.position = centroReal;
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
