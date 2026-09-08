// ============================================================
// VERSIÓN: v10.FUSION_DIRECTA — Objetivo principal
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 45,

  state: { imagenSeleccionada: null, huecoCercano: null },

  init() {
    this.enhanceDragBehavior();
    console.log('✅ SMART_FUSION — ARRASTRE → DETECCIÓN → IMÁN → FUSIÓN');
  },

  // ======================================
  // OBTENER POSICIÓN REAL EN PANTALLA
  // ======================================
  posicionReal(item) {
    let x = 0, y = 0;
    let actual = item;
    while (actual) {
      try {
        if (actual.position && !isNaN(actual.position.x)) {
          x += actual.position.x;
          y += actual.position.y;
        }
        actual = actual.parent;
      } catch { break; }
    }
    return { x: Math.round(x), y: Math.round(y), punto: new paper.Point(x, y) };
  },

  // ======================================
  // DETECTAR SI ES UN HUECO/FORMA VACÍA
  // ======================================
  esHueco(item) {
    if (item.data?.isHole === true) return true;
    const t = item.className;
    if ((t === 'Path' || t === 'CompoundPath' || t === 'Shape')) {
      if (!item.fillColor || item.fillColor.alpha === 0) return true;
    }
    if (item.clipMask === true) return true;
    if (item.blendMode === 'subtract') return true;
    return false;
  },

  // ======================================
  // ENCONTRAR HUECO MÁS CERCANO A UN PUNTO
  // ======================================
  buscarHuecoCerca(punto) {
    const todos = this.desagrupar(paper.project.activeLayer.children);
    let masCercano = null;
    let menorDist = this.MAGNETIC_THRESHOLD;

    for (const item of todos) {
      if (item.className === 'Group') continue;
      if (item.data?.isMaskCopy || item.data?.isResultadoFusion) continue;
      if (!this.esHueco(item)) continue;

      const real = this.posicionReal(item);
      const dist = Math.hypot(punto.x - real.x, punto.y - real.y);

      if (dist < menorDist) {
        menorDist = dist;
        masCercano = { item, posicion: real };
      }
    }
    return masCercano;
  },

  // ======================================
  // LÓGICA PRINCIPAL
  // ======================================
  enhanceDragBehavior() {
    const self = this;
    paper.tools.forEach(tool => {
      const onDown = tool.onMouseDown;
      const onDrag = tool.onMouseDrag;
      const onUp   = tool.onMouseUp;

      // 🖱️ AL PRESIONAR → Identificar qué se está moviendo
      tool.onMouseDown = function(e) {
        if (onDown) onDown.call(this, e);
        setTimeout(() => {
          const golpe = paper.project.hitTest(e.point);
          if (!golpe || !golpe.item) return;

          const item = golpe.item;
          const tipo = item.className;
          const esImagen = (tipo === 'Raster' || item.data?.esImagen === true);

          console.log('\n🖱️ SELECCIONADO:', esImagen ? '📸 IMAGEN' : tipo);
          console.log('   Posición en pantalla:', Math.round(item.position.x) + ',' + Math.round(item.position.y));

          if (esImagen) {
            self.state.imagenSeleccionada = item;
            console.log('✅ → Imagen lista para fusionar');
          } else {
            self.state.imagenSeleccionada = null;
          }
        }, 10);
      };

      // 🖱️ AL ARRASTRAR → Solo DETECTAR hueco cercano, NO mover la imagen
      tool.onMouseDrag = function(e) {
        if (onDrag) onDrag.call(this, e);
        if (!self.state.imagenSeleccionada) return;

        const hueco = self.buscarHuecoCerca(e.point);
        const anterior = self.state.huecoCercano;

        // Si cambió de hueco cercano
        if ((hueco?.item) !== (anterior?.item)) {
          // Restaurar anterior
          if (anterior?.item) {
            self.restaurarResaltado(anterior.item);
          }
          // Resaltar nuevo
          self.state.huecoCercano = hueco;
          if (hueco) {
            self.resaltar(hueco.item, '#00FFFF');
            console.log('🧲 HUECO DETECTADO en:', hueco.posicion.x + ',' + hueco.posicion.y);
          } else {
            console.log('🔓 Lejos de todo');
          }
        }
      };

      // ✅ AL SOLTAR → Si está cerca → PEGAR Y FUSIONAR
      tool.onMouseUp = function(e) {
        if (onUp) onUp.call(this, e);

        const hueco = self.state.huecoCercano;
        const imagen = self.state.imagenSeleccionada;

        if (hueco && imagen) {
          const dist = Math.hypot(e.point.x - hueco.posicion.x, e.point.y - hueco.posicion.y);

          if (dist < self.MAGNETIC_THRESHOLD) {
            // ✅ PEGAR AL CENTRO
            imagen.position = hueco.posicion.punto;
            self.resaltar(hueco.item, '#FF00FF');

            // ✅ FUSIONAR → Crear máscara recortada
            self.crearFusion(imagen, hueco.item, hueco.posicion.punto);

            console.log('✅ FUSIÓN COMPLETA 💜 en:', hueco.posicion.x + ',' + hueco.posicion.y);
          }
        }

        // Limpiar
        if (hueco?.item) self.restaurarResaltado(hueco.item);
        self.state.imagenSeleccionada = null;
        self.state.huecoCercano = null;
      };
    });
  },

  // ======================================
  // CREAR LA FUSIÓN (máscara + imagen)
  // ======================================
  crearFusion(imagen, hueco, centro) {
    const mascara = hueco.clone();
    mascara.position = centro;
    mascara.data = { esCopiaMascara: true };

    // Ajustar tamaño si se conocen los límites
    if (hueco.bounds && !hueco.bounds.isEmpty) {
      imagen.bounds = hueco.bounds.clone();
    } else {
      imagen.position = centro;
    }
    imagen.opacity = 1.0;
    imagen.data = { esImagenRecortada: true };

    // Agrupar y recortar
    const grupo = new paper.Group([mascara, imagen]);
    grupo.clipped = true;
    grupo.data = { esResultadoFusion: true };
    grupo.insertBelow(hueco);
  },

  // ======================================
  // UTILIDADES
  // ======================================
  resaltar(item, color) {
    if (!item.data._colorOriginal) {
      item.data._colorOriginal = item.strokeColor ? item.strokeColor.toCSS() : null;
      item.data._grosorOriginal = item.strokeWidth || 0;
    }
    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
  },

  restaurarResaltado(item) {
    if (!item.data) return;
    item.strokeColor = item.data._colorOriginal ? new paper.Color(item.data._colorOriginal) : null;
    item.strokeWidth = item.data._grosorOriginal || 0;
    delete item.data._colorOriginal;
    delete item.data._grosorOriginal;
  },

  desagrupar(elementos) {
    const resultado = [];
    const recorrer = (lista) => {
      for (const el of lista) {
        if (el.children && el.children.length > 0) recorrer(el.children);
        else resultado.push(el);
      }
    };
    recorrer(elementos);
    return resultado;
  }
};

export function initSmartFusionListeners() {
  SMART_FUSION.init();
}

window.SMART_FUSION = SMART_FUSION;
window.initSmartFusionListeners = initSmartFusionListeners;
