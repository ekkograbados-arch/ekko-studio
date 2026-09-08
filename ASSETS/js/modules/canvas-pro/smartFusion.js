// ============================================================
// VERSIÓN: v10.VERIFICACION_TOTAL — F12 lo dice TODO
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 45,

  state: {
    imagenSeleccionada: null,
    ultimoHuecoId: null
  },

  init() {
    this.enhanceDragBehavior();
    console.log('========================================================');
    console.log('✅ SMART_FUSION v10.VERIFICACION — TODOS LOS DATOS EN F12');
    console.log('📋 Observa la consola mientras arrastras y sueltas');
    console.log('========================================================');
  },

  // ======================================
  // ✅ OBTENER POSICIÓN ABSOLUTA REAL EN LIENZO
  // ======================================
  posicionAbsoluta(item) {
    // Usamos la función oficial de Paper.js que ya convierte a coordenadas de lienzo
    const puntoCentro = item.position.clone();
    const puntoAbsoluto = item.layerToGlobal(puntoCentro); // ← CLAVE: convierte a coordenadas reales de pantalla

    return {
      x: Math.round(puntoAbsoluto.x),
      y: Math.round(puntoAbsoluto.y),
      punto: puntoAbsoluto,
      relativaX: Math.round(item.position.x),
      relativaY: Math.round(item.position.y)
    };
  },

  // ======================================
  // ✅ DETECTAR SI ES UN HUECO (Y NO ES PARTE DEL SVG DEL PRODUCTO)
  // ======================================
  esHuecoValido(item) {
    // ❌ IGNORAR TODO LO QUE PERTENEZCA AL PRODUCTO ORIGINAL
    if (item.data?.esPlantillaProducto === true || item.data?.origenProducto === true) {
      return false;
    }

    const tipo = item.className;
    if (tipo === 'Group') return false;

    // ✅ Detectar hueco por definición visual
    if (item.data?.isHole === true) return true;
    if (tipo === 'Path' || tipo === 'CompoundPath' || tipo === 'Shape') {
      if (!item.fillColor || item.fillColor.alpha === 0) return true;
    }
    if (item.clipMask === true) return true;
    if (item.blendMode === 'subtract') return true;

    return false;
  },

  // ======================================
  // ✅ BUSCAR HUECO MÁS CERCANO — COORDENADAS REALES
  // ======================================
  buscarHuecoCercano(puntoDelRaton) {
    const todos = this.desagruparTodo(paper.project.activeLayer.children);
    let masCercano = null;
    let menorDistancia = this.MAGNETIC_THRESHOLD;
    let informe = [];

    for (const item of todos) {
      if (!this.esHuecoValido(item)) continue;

      const pos = this.posicionAbsoluta(item);
      const distancia = Math.hypot(puntoDelRaton.x - pos.x, puntoDelRaton.y - pos.y);

      informe.push({
        id: item.id || item._id || 'sin_id',
        tipo: item.className,
        relativa: `${pos.relativaX},${pos.relativaY}`,
        absoluta: `${pos.x},${pos.y}`,
        distancia: Math.round(distancia)
      });

      if (distancia < menorDistancia) {
        menorDistancia = distancia;
        masCercano = { item, posicion: pos };
      }
    }

    // 📋 IMPRIMIR INFORME COMPLETO EN CONSOLA
    if (informe.length > 0) {
      console.log('📋 HUECOS DETECTADOS CERCA:');
      informe.forEach(h => {
        console.log(`   ├─ ${h.tipo} | Rel:${h.relativa} → Abs:${h.absoluta} | Dist:${h.distancia}px`);
      });
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

      // 🖱️ AL HACER CLIC
      tool.onMouseDown = function(e) {
        if (onDown) onDown.call(this, e);
        setTimeout(() => {
          const golpe = paper.project.hitTest(e.point);
          if (!golpe || !golpe.item) return;

          const item = golpe.item;
          const esImagen = (item.className === 'Raster' || item.data?.esImagen === true);
          const pos = self.posicionAbsoluta(item);

          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`🖱️ CLIC EN: ${esImagen ? '📸 IMAGEN' : item.className}`);
          console.log(`   Coordenadas RELATIVAS (dentro de su grupo): ${pos.relativaX}, ${pos.relativaY}`);
          console.log(`   Coordenadas REALES EN PANTALLA: ${pos.x}, ${pos.y}`);
          console.log(`   Punto del ratón: ${Math.round(e.point.x)}, ${Math.round(e.point.y)}`);

          if (esImagen) {
            self.state.imagenSeleccionada = item;
            console.log('   ✅ → Imagen lista para arrastrar y fusionar');
          } else {
            console.log('   ⚠️ → No es imagen — SOLO se arrastran imágenes');
            self.state.imagenSeleccionada = null;
          }
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }, 10);
      };

      // 🖱️ AL ARRASTRAR
      tool.onMouseDrag = function(e) {
        if (onDrag) onDrag.call(this, e);
        if (!self.state.imagenSeleccionada) return;

        const posImagen = self.posicionAbsoluta(self.state.imagenSeleccionada);
        const hueco = self.buscarHuecoCercano(e.point);

        // 📊 REGISTRO EN TIEMPO REAL
        console.log(`🖱️ RATÓN: ${Math.round(e.point.x)},${Math.round(e.point.y)}` +
                    ` | 📸 IMAGEN: ${posImagen.x},${posImagen.y}` +
                    (hueco ? ` | 🧲 HUECO REAL: ${hueco.posicion.x},${hueco.posicion.y}` : ' | 🔓 Sin hueco cercano'));

        // ✅ RESALTAR VISUALMENTE EL HUECO SELECCIONADO
        const huecoId = hueco ? (hueco.item.id || hueco.item._id) : null;
        if (huecoId !== self.state.ultimoHuecoId) {
          // Quitar resaltado anterior
          if (self.state.ultimoHueco && self.state.ultimoHueco.item) {
            self.restaurarResaltado(self.state.ultimoHueco.item);
          }
          // Resaltar nuevo
          self.state.ultimoHueco = hueco;
          self.state.ultimoHuecoId = huecoId;
          if (hueco) {
            self.resaltar(hueco.item, '#00FFFF');
            console.log('✨ HUECO RESALTADO EN PANTALLA — borde CIAN');
          }
        }
      };

      // ✅ AL SOLTAR → FUSIONAR
      tool.onMouseUp = function(e) {
        if (onUp) onUp.call(this, e);

        const hueco = self.state.ultimoHueco;
        const imagen = self.state.imagenSeleccionada;

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        if (hueco && imagen) {
          const dist = Math.hypot(e.point.x - hueco.posicion.x, e.point.y - hueco.posicion.y);
          console.log(`📍 SOLTADO A: ${Math.round(e.point.x)},${Math.round(e.point.y)}`);
          console.log(`🧲 Hueco más cercano REAL: ${hueco.posicion.x},${hueco.posicion.y}`);
          console.log(`📏 Distancia: ${Math.round(dist)}px (límite: ${self.MAGNETIC_THRESHOLD}px)`);

          if (dist < self.MAGNETIC_THRESHOLD) {
            // ✅ PEGAR EN COORDENADAS REALES
            imagen.position = hueco.posicion.punto;
            self.resaltar(hueco.item, '#FF00FF');
            self.crearFusion(imagen, hueco.item, hueco.posicion.punto);

            console.log('✅ ✅ ✅ FUSIÓN EXITOSA 💜');
            console.log(`   Imagen alineada en: ${hueco.posicion.x},${hueco.posicion.y}`);
            console.log('   El hueco queda en MAGENTA = FUSIONADO');
          } else {
            console.log('🔓 Demasiado lejos — NO se fusiona');
            self.restaurarResaltado(hueco.item);
          }
        } else {
          console.log('ℹ️ Sin hueco cerca al soltar');
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Limpiar
        self.state.imagenSeleccionada = null;
        self.state.ultimoHueco = null;
        self.state.ultimoHuecoId = null;
      };
    });
  },

  // ======================================
  // ✅ CREAR FUSIÓN SIN TOCAR EL ORIGINAL
  // ======================================
  crearFusion(imagen, hueco, centroReal) {
    // Clonar el hueco → la MÁSCARA, NO el original
    const mascara = hueco.clone();
    mascara.position = centroReal;
    mascara.data = { esCopiaMascara: true };

    // Ajustar imagen al tamaño real del hueco
    if (hueco.bounds && !hueco.bounds.isEmpty) {
      imagen.bounds = hueco.bounds.clone();
    } else {
      imagen.position = centroReal;
    }
    imagen.opacity = 1.0;
    imagen.data = { esImagenRecortada: true };

    // Crear grupo recortado → NUEVO objeto, NO toca el original
    const grupo = new paper.Group([mascara, imagen]);
    grupo.clipped = true;
    grupo.data = { esResultadoFusion: true };

    // Colocar DEBAJO del original → el producto sigue visible arriba
    grupo.insertBelow(hueco);

    console.log('📦 Grupo de fusión creado → NO se modificó el SVG original');
  },

  // ======================================
  // ✅ RESALTADO VISUAL
  // ======================================
  resaltar(item, color) {
    if (!item.data._colorBorde) {
      item.data._colorBorde = item.strokeColor ? item.strokeColor.toCSS() : null;
      item.data._grosorBorde = item.strokeWidth || 0;
    }
    item.strokeColor = new paper.Color(color);
    item.strokeWidth = 4;
    item.selected = false; // ✅ NO seleccionar visualmente → SOLO colorear borde
  },

  restaurarResaltado(item) {
    if (!item.data) return;
    item.strokeColor = item.data._colorBorde ? new paper.Color(item.data._colorBorde) : null;
    item.strokeWidth = item.data._grosorBorde || 0;
    delete item.data._colorBorde;
    delete item.data._grosorBorde;
  },

  desagruparTodo(elementos) {
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
