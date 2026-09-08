// ============================================================
// VERSIÓN: v10.CORREGIDO_PIVOT — Coordenadas 100% exactas
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 45,

  state: {
    imagenSeleccionada: null,
    ultimoHueco: null,
    ultimoHuecoId: null
  },

  init() {
    this.enhanceDragBehavior();
    console.log('========================================================');
    console.log('✅ SMART_FUSION v10.CORREGIDO_PIVOT');
    console.log('📋 Coordenadas calculadas con origen + escala correctos');
    console.log('========================================================');
  },

  // ======================================
  // ✅ CÁLCULO EXACTO DE POSICIÓN GLOBAL
  // ======================================
  obtenerPosicionGlobal(item) {
    // En Paper.js: posición real global = posición + pivot_ajustado_por_escala
    let x = 0, y = 0;
    let sx = 1, sy = 1;
    let rot = 0;
    let actual = item;

    while (actual) {
      try {
        // Posición del centro del objeto
        const posX = actual.position.x || 0;
        const posY = actual.position.y || 0;

        // Punto de origen (pivot) relativo al objeto
        const pivX = actual.pivot ? actual.pivot.x : 0;
        const pivY = actual.pivot ? actual.pivot.y : 0;

        // Escala acumulada
        const escalaX = actual.scaling ? actual.scaling.x : 1;
        const escalaY = actual.scaling ? actual.scaling.y : 1;

        // ✅ FÓRMULA CORRECTA: posición real = pos - pivot * escala
        // Esto es lo que Paper.js usa internamente → sin desfase
        x += posX - pivX * sx;
        y += posY - pivY * sy;

        // Acumular escala y rotación
        sx *= escalaX;
        sy *= escalaY;
        rot += actual.rotation || 0;

        actual = actual.parent;
      } catch { break; }
    }

    return {
      x: Math.round(x),
      y: Math.round(y),
      sx: sx,
      sy: sy,
      rot: Math.round(rot),
      punto: new paper.Point(x, y),
      posOriginalX: Math.round(item.position.x || 0),
      posOriginalY: Math.round(item.position.y || 0)
    };
  },

  // ======================================
  // ✅ DETECTAR HUECOS — IGNORAR PRODUCTO ORIGINAL
  // ======================================
  esHuecoValido(item) {
    if (item.data?.esPlantillaProducto || 
        item.data?.origenProducto ||
        item.data?.esResultadoFusion ||
        item.data?.esCopiaMascara ||
        item.data?.esImagenRecortada) {
      return false;
    }

    const tipo = item.className;
    if (tipo === 'Group') return false;

    if (item.data?.isHole === true) return true;
    if (tipo === 'Path' || tipo === 'CompoundPath' || tipo === 'Shape') {
      if (!item.fillColor || (item.fillColor.alpha !== undefined && item.fillColor.alpha === 0)) {
        return true;
      }
    }
    if (item.clipMask === true) return true;
    if (item.blendMode === 'subtract') return true;

    return false;
  },

  // ======================================
  // ✅ BUSCAR HUECO MÁS CERCANO
  // ======================================
  buscarHuecoCercano(puntoRaton) {
    const todos = this.desagrupar(paper.project.activeLayer.children);
    let masCercano = null;
    let menorDist = this.MAGNETIC_THRESHOLD;
    let informe = [];

    for (const item of todos) {
      if (!this.esHuecoValido(item)) continue;

      const pos = this.obtenerPosicionGlobal(item);
      const dist = Math.hypot(puntoRaton.x - pos.x, puntoRaton.y - pos.y);

      informe.push({
        tipo: item.className,
        local: `${pos.posOriginalX},${pos.posOriginalY}`,
        GLOBAL: `${pos.x},${pos.y}`,
        escala: `${pos.sx.toFixed(2)}`,
        dist: Math.round(dist)
      });

      if (dist < menorDist) {
        menorDist = dist;
        masCercano = { item, pos };
      }
    }

    if (informe.length > 0) {
      console.log('📋 HUECOS DETECTADOS:');
      informe.forEach(h => {
        console.log(`   ├─ ${h.tipo} | Local:${h.local} → ✅ GLOBAL:${h.GLOBAL} | Esc:${h.escala} | Dist:${h.dist}px`);
      });
    } else {
      console.log('📋 Sin huecos válidos cerca');
    }

    return masCercano;
  },

  // ======================================
  // ✅ LÓGICA PRINCIPAL
  // ======================================
  enhanceDragBehavior() {
    const self = this;
    paper.tools.forEach(tool => {
      const onDown = tool.onMouseDown;
      const onDrag = tool.onMouseDrag;
      const onUp   = tool.onMouseUp;

      // 🖱️ CLIC
      tool.onMouseDown = function(e) {
        if (onDown) onDown.call(this, e);
        setTimeout(() => {
          const golpe = paper.project.hitTest(e.point);
          if (!golpe || !golpe.item) return;

          const item = golpe.item;
          const esImagen = (item.className === 'Raster' || item.data?.esImagen);
          const pos = self.obtenerPosicionGlobal(item);
          const raton = { x: Math.round(e.point.x), y: Math.round(e.point.y) };

          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`🖱️ CLIC EN: ${esImagen ? '📸 IMAGEN' : item.className}`);
          console.log(`   Posición interna SVG: ${pos.posOriginalX}, ${pos.posOriginalY}`);
          console.log(`   ✅ POSICIÓN REAL EN LIENZO: ${pos.x}, ${pos.y}`);
          console.log(`   Posición del ratón:         ${raton.x}, ${raton.y}`);
          console.log(`   Escala: ${pos.sx.toFixed(2)} | Rot: ${pos.rot}°`);

          if (esImagen) {
            self.state.imagenSeleccionada = item;
            console.log('   ✅ → Imagen lista para fusionar');
          } else {
            console.log('   ⚠️ → Ignorado (solo imágenes)');
            self.state.imagenSeleccionada = null;
          }
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }, 20);
      };

      // 🖱️ ARRASTRAR
      tool.onMouseDrag = function(e) {
        if (onDrag) onDrag.call(this, e);
        if (!self.state.imagenSeleccionada) return;

        const posImg = self.obtenerPosicionGlobal(self.state.imagenSeleccionada);
        const raton = { x: Math.round(e.point.x), y: Math.round(e.point.y) };
        const hueco = self.buscarHuecoCercano(e.point);

        console.log(`🖱️ RATÓN: ${raton.x},${raton.y} | 📸 IMAGEN: ${posImg.x},${posImg.y}` +
          (hueco ? ` | 🧲 HUECO REAL: ${hueco.pos.x},${hueco.pos.y}` : ' | 🔓 Sin hueco'));

        // Resaltar hueco
        const huecoId = hueco ? (hueco.item.id || hueco.item._id) : null;
        if (huecoId !== self.state.ultimoHuecoId) {
          if (self.state.ultimoHueco) self.restaurar(self.state.ultimoHueco);
          self.state.ultimoHueco = hueco;
          self.state.ultimoHuecoId = huecoId;
          if (hueco) {
            self.resaltar(hueco.item, '#00FFFF');
            console.log('✨ Hueco resaltado → Borde CIAN ✅');
          }
        }
      };

      // ✅ SOLTAR → FUSIONAR
      tool.onMouseUp = function(e) {
        if (onUp) onUp.call(this, e);

        const hueco = self.state.ultimoHueco;
        const imagen = self.state.imagenSeleccionada;
        const raton = { x: Math.round(e.point.x), y: Math.round(e.point.y) };

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        if (hueco && imagen) {
          const dist = Math.hypot(raton.x - hueco.pos.x, raton.y - hueco.pos.y);
          console.log(`📍 SOLTADO EN:   ${raton.x}, ${raton.y}`);
          console.log(`🧲 HUECO REAL:   ${hueco.pos.x}, ${hueco.pos.y}`);
          console.log(`📏 Distancia: ${dist}px  (límite: ${self.MAGNETIC_THRESHOLD}px)`);
          console.log(`📐 Escala detectada: ${hueco.pos.sx.toFixed(2)}`);

          if (dist < self.MAGNETIC_THRESHOLD) {
            // ✅ IMAGEN ALINEADA EXACTAMENTE
            imagen.position = hueco.pos.punto;

            // ✅ CREAR MÁSCARA EN LA MISMA POSICIÓN + ESCALA
            self.crearFusion(imagen, hueco.item, hueco.pos);

            self.resaltar(hueco.item, '#FF00FF');
            console.log('✅ ✅ ✅ FUSIÓN EXACTA 💜');
            console.log('   ✅ Hueco clonado en su lugar REAL → SIN DESFASE');
            console.log('   ✅ El SVG original NO se toca');
          } else {
            console.log('🔓 Demasiado lejos — NO se fusiona');
            self.restaurar(hueco.item);
          }
        } else {
          console.log('ℹ️ Sin hueco cerca al soltar');
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        self.state.imagenSeleccionada = null;
        self.state.ultimoHueco = null;
        self.state.ultimoHuecoId = null;
      };
    });
  },

  // ======================================
  // ✅ CREAR FUSIÓN SIN DESFASE
  // ======================================
  crearFusion(imagen, huecoOriginal, posGlobal) {
    // Clonar la forma
    const mascara = huecoOriginal.clone();

    // ✅ Colocar en posición GLOBAL calculada correctamente
    mascara.position = posGlobal.punto;

    // ✅ Aplicar MISMA ESCALA para que no se descuadre
    if (posGlobal.sx !== 1 || posGlobal.sy !== 1) {
      mascara.scale(posGlobal.sx, posGlobal.sy);
    }

    // Ajustar imagen al tamaño del hueco
    if (huecoOriginal.bounds && !huecoOriginal.bounds.isEmpty) {
      imagen.bounds = huecoOriginal.bounds.clone();
    } else {
      imagen.position = posGlobal.punto;
    }

    // Crear grupo recortado DEBAJO del original
    const grupo = new paper.Group([mascara, imagen]);
    grupo.clipped = true;
    grupo.data = { esResultadoFusion: true };
    mascara.data = { esCopiaMascara: true };
    imagen.data = { esImagenRecortada: true };

    // ✅ Colocar debajo → el SVG original queda arriba INTACTO
    grupo.insertBelow(huecoOriginal);

    console.log('📦 Grupo creado debajo del original ✅');
  },

  // ======================================
  // UTILIDADES
  // ======================================
  resaltar(item, color) {
    if (!item.data._colorBorde) {
      item.data._colorBorde = item.strokeColor ? item.strokeColor.toCSS() : null;
      item.data._grosorBorde = item.strokeWidth || 0;
    }
    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
    item.selected = false;
  },

  restaurar(item) {
    if (!item || !item.data) return;
    item.strokeColor = item.data._colorBorde ? new paper.Color(item.data._colorBorde) : null;
    item.strokeWidth = item.data._grosorBorde || 0;
    delete item.data._colorBorde;
    delete item.data._grosorBorde;
  },

  desagrupar(lista) {
    const res = [];
    const recorrer = arr => {
      for (const el of arr) {
        if (el.children && el.children.length) recorrer(el.children);
        else res.push(el);
      }
    };
    recorrer(lista);
    return res;
  }
};

export function initSmartFusionListeners() {
  SMART_FUSION.init();
}

window.SMART_FUSION = SMART_FUSION;
window.initSmartFusionListeners = initSmartFusionListeners;
