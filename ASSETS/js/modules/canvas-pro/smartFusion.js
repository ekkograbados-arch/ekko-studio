// ============================================================
// VERSIÓN: v10.8 — DIAGNÓSTICO TOTAL 🔍
// OBJETIVO: Ver EXACTAMENTE qué hay en el SVG y por qué no se detectan huecos
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 30, // Un poquito más amplio para pruebas

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
    inventarioHecho: false
  },

  init() {
    this.enhanceDragBehavior();
    console.log('=============================================');
    console.log('[SMART FUSION v10.8] 🔍 MODO DIAGNÓSTICO ACTIVO');
    console.log('=============================================');
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
          // 📋 LA PRIMERA VEZ QUE SELECCIONAS ALGO → ESCANEA TODO EL SVG
          if (!self.state.inventarioHecho) {
            self.escanearTodoElSVG();
            self.state.inventarioHecho = true;
          }

          const hit = paper.project.hitTest(e.point);
          if (hit && hit.item) {
            const item = hit.item;
            if (item.className === 'Raster' || item.data?.isClientImage === true) {
              self.state.draggingItem = item;
              console.log('🖱️ IMAGEN SELECCIONADA → arrastre libre habilitado');
            } else {
              console.log('📍 CLIC EN:', item.className, '| nombre:', item.name || '(sin nombre)');
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
          const centro = huecoCercano.bounds.center;

          if (!self.state.isSnapped || self.state.activeHole !== huecoCercano) {
            self.state.isSnapped = true;
            self.state.activeHole = huecoCercano;
            self.state.mouseOffset = e.point.subtract(centro);
            self.aplicarBrillo(huecoCercano, self.COLORS.ANCLADO);
            self.state.draggingItem.opacity = 0.75;
            console.log('🧲 IMÁN ACTIVO ENCONTRADO →', huecoCercano.className, huecoCercano.name || '');
          }

          self.state.draggingItem.position = centro.subtract(self.state.mouseOffset);
        }
        else if (self.state.isSnapped) {
          console.log('🔓 SE ALEJÓ → imán liberado');
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

          if (self.esFormaValida(hueco)) {
            self.fusionarSinModificarOriginal(foto, hueco);
            self.aplicarBrillo(hueco, self.COLORS.FUSIONADO);
            console.log('✅ ✅ FUSIÓN EXITOSA 💜');
          } else {
            console.log('⚠️ Hueco NO válido para fusión');
          }
        }

        if (self.state.draggingItem) self.state.draggingItem.opacity = 1.0;
        self.resetState();
      };
    });
  },

  // 📋 ESCANEA TODO EL SVG Y LO MUESTRA EN CONSOLA
  escanearTodoElSVG() {
    console.log('\n📋 === INVENTARIO COMPLETO DEL SVG DEL PRODUCTO ===');
    const todos = this.descomponerGrupos(paper.project.activeLayer.children);
    console.log(`Total elementos encontrados: ${todos.length}`);

    let contadorCalados = 0;

    todos.forEach((item, indice) => {
      const tipo = item.className;
      const nombre = item.name || '(sin nombre)';
      const tieneRelleno = item.fillColor ? `SÍ (alfa=${item.fillColor.alpha})` : 'NO';
      const tieneTrazo = item.strokeColor ? 'SÍ' : 'NO';
      const esGrupo = tipo === 'Group';
      const boundsOk = item.bounds && !item.bounds.isEmpty;

      let esCalado = false;
      let razonCalado = '';

      if (item.data?.isHole === true) { esCalado = true; razonCalado = 'data.isHole=true'; }
      else if ((tipo === 'Path' || tipo === 'CompoundPath') && (!item.fillColor || item.fillColor.alpha === 0)) {
        esCalado = true; razonCalado = 'sin relleno';
      }
      else if (item.clipMask === true) { esCalado = true; razonCalado = 'clipMask'; }
      else if (item.blendMode === 'subtract') { esCalado = true; razonCalado = 'subtract'; }

      if (esCalado) contadorCalados++;

      // Mostrar SOLO los que pueden ser calados + resumen al final
      if (esCalado || indice < 5) {
        console.log(`[${indice}] ${tipo.padEnd(14)} | ${nombre.padEnd(25)} | relleno: ${tieneRelleno} | calado: ${esCalado ? '✅ SÍ → ' + razonCalado : '❌ NO'} | bounds: ${boundsOk ? '✅' : '❌'}`);
      }
    });

    console.log(`\n🎯 TOTAL CALADOS DETECTADOS: ${contadorCalados}`);
    if (contadorCalados === 0) {
      console.log('⚠️ ⚠️ ⚠️ NO SE DETECTÓ NINGÚN CALADO → AQUÍ ESTÁ EL PROBLEMA');
      console.log('💡 Posibles causas:');
      console.log('   1. Los huecos TIENEN relleno (aunque parezcan transparentes)');
      console.log('   2. Están todos dentro de un Grupo sin desagrupar');
      console.log('   3. Usan otra propiedad para marcar calados');
    }
    console.log('===============================================\n');
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
    if (item.clipMask === true) return true;
    if (item.blendMode === 'subtract') return true;
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
