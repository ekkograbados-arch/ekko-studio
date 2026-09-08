// ============================================================
// VERSIÓN: v10.FINAL — NO se reposiciona el clon
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 45,

  state: {
    imagenSeleccionada: null,
    ultimoHueco: null
  },

  init() {
    this.enhanceDragBehavior();
    console.log('✅ SMART_FUSION v10.FINAL — La máscara se mantiene en su lugar');
  },

  // ✅ USAMOS bounds.center → Paper.js nos da la posición REAL
  centroReal(item) {
    const b = item.bounds;
    return {
      x: Math.round(b.center.x),
      y: Math.round(b.center.y),
      punto: b.center,
      bounds: b
    };
  },

  esHuecoValido(item) {
    if (item.data?.esPlantillaProducto || item.data?.origenProducto) return false;
    if (item.className === 'Group') return false;
    if (item.data?.isHole) return true;
    if (!item.fillColor || (item.fillColor.alpha !== undefined && item.fillColor.alpha === 0)) return true;
    return false;
  },

  buscarHuecoCercano(puntoRaton) {
    const todos = this.desagrupar(paper.project.activeLayer.children);
    let masCercano = null;
    let minDist = this.MAGNETIC_THRESHOLD;

    for (const item of todos) {
      if (!this.esHuecoValido(item)) continue;
      const c = this.centroReal(item);
      const dist = Math.hypot(puntoRaton.x - c.x, puntoRaton.y - c.y);

      console.log(`   🧲 Hueco: ${c.x},${c.y} | Dist: ${Math.round(dist)}px`);

      if (dist < minDist) {
        minDist = dist;
        masCercano = { item, centro: c };
      }
    }
    return masCercano;
  },

  enhanceDragBehavior() {
    const self = this;
    paper.tools.forEach(tool => {
      tool.onMouseDown = function(e) {
        const golpe = paper.project.hitTest(e.point);
        if (!golpe) return;
        const esImagen = golpe.item.className === 'Raster' || golpe.item.data?.esImagen;
        if (esImagen) {
          self.state.imagenSeleccionada = golpe.item;
          const c = self.centroReal(golpe.item);
          console.log(`📸 Imagen en: ${c.x}, ${c.y}`);
        }
      };

      tool.onMouseDrag = function(e) {
        if (!self.state.imagenSeleccionada) return;
        console.log(`🖱️ Ratón en: ${Math.round(e.point.x)}, ${Math.round(e.point.y)}`);
        const hueco = self.buscarHuecoCercano(e.point);
        if (hueco) {
          self.resaltar(hueco.item, '#00FFFF');
          console.log(`✨ Hueco detectado en: ${hueco.centro.x}, ${hueco.centro.y}`);
        }
      };

      tool.onMouseUp = function(e) {
        const hueco = self.buscarHuecoCercano(e.point);
        const imagen = self.state.imagenSeleccionada;
        if (hueco && imagen) {
          const dist = Math.hypot(e.point.x - hueco.centro.x, e.point.y - hueco.centro.y);
          console.log(`📍 Soltado en: ${Math.round(e.point.x)}, ${Math.round(e.point.y)}`);
          console.log(`🧲 Hueco en:   ${hueco.centro.x}, ${hueco.centro.y}`);
          console.log(`📏 Distancia: ${Math.round(dist)}px`);

          if (dist < self.MAGNETIC_THRESHOLD) {
            // ✅ MOVER LA IMAGEN AL CENTRO DEL HUECO
            imagen.position = hueco.centro.punto;
            
            // ✅ AJUSTAR TAMAÑO DE IMAGEN AL HUECO
            imagen.bounds = hueco.centro.bounds.clone();
            
            // ✅ CREAR MÁSCARA — SIN TOCAR SU POSICIÓN
            self.crearFusion(imagen, hueco.item);
            console.log('✅ FUSIÓN — Máscara en su lugar ORIGINAL ✅');
          }
        }
        self.state.imagenSeleccionada = null;
      };
    });
  },

  // ======================================
  // ✅ LA CLAVE: CLONAR SIN REPOSICIONAR
  // ======================================
  crearFusion(imagen, huecoOriginal) {
    // ❌ NO hagas: mascara.position = ... → eso lo DESCUADRA
    // ✅ SOLO clona → Paper.js mantiene la posición EXACTA automáticamente
    const mascara = huecoOriginal.clone();
    mascara.data = { esCopiaMascara: true };

    // Crear grupo → la máscara YA está en su lugar correcto
    const grupo = new paper.Group([mascara, imagen]);
    grupo.clipped = true;
    grupo.data = { esResultadoFusion: true };

    // ✅ Colocar DEBAJO del original → el original queda arriba INTACTO
    grupo.insertBelow(huecoOriginal);

    console.log('📦 Máscara clonada en posición ORIGINAL → SIN DESFASE ✅');
  },

  resaltar(item, color) {
    if (!item.data._color) {
      item.data._color = item.strokeColor;
      item.data._grosor = item.strokeWidth;
    }
    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
    item.selected = false;
  },

  restaurar(item) {
    if (!item.data) return;
    item.strokeColor = item.data._color;
    item.strokeWidth = item.data._grosor;
  },

  desagrupar(lista) {
    let res = [];
    const rec = arr => {
      for (const el of arr) {
        if (el.children?.length) rec(el.children);
        else res.push(el);
      }
    };
    rec(lista);
    return res;
  }
};

export function initSmartFusionListeners() {
  SMART_FUSION.init();
}
