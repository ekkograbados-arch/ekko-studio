// ============================================================
// VERSIÓN: v10.7 — NO BLOQUEA EVENTOS DEL SISTEMA
// REGLA: Paper.js gestiona el arrastre normal → nosotros SOLO ayudamos con el imán
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 25,

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
    lastScanTime: 0,
    originalDragHandler: null
  },

  init() {
    this.enhanceDragBehavior();
    console.log('[SMART FUSION v10.7] ✅ IMÁN ASISTENTE — NO BLOQUEA MOVIMIENTO NI ESCALA');
  },

  enhanceDragBehavior() {
    const self = this;

    // Interceptamos el movimiento PERO sin anular el comportamiento original
    paper.tools.forEach(tool => {
      // Guardamos los manejadores ORIGINALES para llamarlos SIEMPRE
      const originalOnMouseDown = tool.onMouseDown;
      const originalOnMouseDrag = tool.onMouseDrag;
      const originalOnMouseUp = tool.onMouseUp;

      // 🖱️ AL PRESIONAR: detectar si es imagen del cliente
      tool.onMouseDown = function(e) {
        // Llamar SIEMPRE al comportamiento original PRIMERO
        if (originalOnMouseDown) originalOnMouseDown.call(this, e);

        setTimeout(() => {
          const hit = paper.project.hitTest(e.point);
          if (hit && hit.item) {
            const item = hit.item;
            if (item.className === 'Raster' || item.data?.isClientImage === true) {
              self.state.draggingItem = item;
              console.log('🖱️ Imagen seleccionada — arrastre libre habilitado');
            }
          }
        }, 0);
      };

      // 🖱️ AL ARRASTRAR: SOLO corregir posición si está cerca del hueco
      tool.onMouseDrag = function(e) {
        // Llamar SIEMPRE al arrastre original → permite mover y escalar
        if (originalOnMouseDrag) originalOnMouseDrag.call(this, e);

        // Solo aplicar imán si tenemos una imagen seleccionada
        if (!self.state.draggingItem) return;

        const ahora = Date.now();
        if (ahora - self.state.lastScanTime < 20) return;
        self.state.lastScanTime = ahora;

        // Buscar hueco cercano
        const huecoCercano = self.encontrarHuecoMasCercano(e.point);

        if (huecoCercano) {
          const centro = huecoCercano.bounds.center;

          if (!self.state.isSnapped || self.state.activeHole !== huecoCercano) {
            // ✅ ENCENDIMOS IMÁN + BRILLO CIAN
            self.state.isSnapped = true;
            self.state.activeHole = huecoCercano;
            self.state.mouseOffset = e.point.subtract(centro);
            self.aplicarBrillo(huecoCercano, self.COLORS.ANCLADO);
            self.state.draggingItem.opacity = 0.75;
            console.log('🧲 IMÁN ACTIVO → alineando...');
          }

          // 🧲 CORREGIR POSICIÓN: centrar la imagen
          self.state.draggingItem.position = centro.subtract(self.state.mouseOffset);
        }
        else if (self.state.isSnapped) {
          // 🔓 SE ALEJÓ → DESCONECTAR IMÁN
          console.log('🔓 Imán liberado — arrastre libre');
          self.restaurarBrillo(self.state.activeHole);
          if (self.state.draggingItem) self.state.draggingItem.opacity = 1.0;
          self.resetState();
        }
      };

      // ✅ AL SOLTAR: si está pegado → fusionar
      tool.onMouseUp = function(e) {
        if (originalOnMouseUp) originalOnMouseUp.call(this, e);

        if (self.state.isSnapped && self.state.activeHole && self.state.draggingItem) {
          const foto = self.state.draggingItem;
          const hueco = self.state.activeHole;

          if (self.esFormaValida(hueco)) {
            self.fusionarSinModificarOriginal(foto, hueco);
            self.aplicarBrillo(hueco, self.COLORS.FUSIONADO);
            console.log('✅ FUSIÓN 💜 — foto recortada, letra intacta');
          }
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
      if (!item.bounds || item.bounds.isEmpty) continue;
      if (item.className === 'Group') continue;
      if (item.data?.isMaskCopy || item.data?.isFusionResult) continue;
      if (!this.esCalado(item)) continue;
      if (!this.esFormaValida(item)) continue;

      const dist = this.distanciaHastaBorde(punto, item.bounds);
      if (dist < this.MAGNETIC_THRESHOLD && dist < menorDist) {
        menorDist = dist;
        masCercano = item;
      }
    }
    return masCercano;
  },

  esFormaValida(item) {
    if (!item) return false;
    const tipo = item.className;
    return (tipo === 'Path' || tipo === 'CompoundPath') && item.bounds && !item.bounds.isEmpty;
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

  distanciaHastaBorde(punto, bounds) {
    const dx = Math.max(bounds.left - punto.x, punto.x - bounds.right, 0);
    const dy = Math.max(bounds.top - punto.y, punto.y - bounds.bottom, 0);
    return Math.sqrt(dx * dx + dy * dy);
  },

  fusionarSinModificarOriginal(foto, huecoOriginal) {
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
    if (!item.data._strokeOrig) {
      item.data._strokeOrig = item.strokeColor ? item.strokeColor.toCSS() : null;
      item.data._widthOrig = item.strokeWidth || 0;
    }
    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
  },

  restaurarBrillo(item) {
    if (!item || !item.data) return;
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
