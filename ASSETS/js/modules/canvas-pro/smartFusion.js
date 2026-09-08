// ============================================================
// VERSIÓN: v10.DIAG — COMANDO DE INSPECCIÓN EN TIEMPO REAL
// ============================================================

export const SMART_FUSION = {
  MAGNETIC_THRESHOLD: 40,
  state: { draggingItem: null, lastLogTime: 0 },

  init() {
    this.enhanceDragBehavior();
    console.log('✅ SMART_FUSION CARGADO — COMANDO DISPONIBLE:');
    console.log('   EKKO_DIAG.INSPECT()          → Estado completo de la imagen');
    console.log('   EKKO_DIAG.POSICION()         → Solo coordenadas');
    console.log('   EKKO_DIAG.REINICIAR()        → Liberar imagen');
  },

  enhanceDragBehavior() {
    const self = this;

    // EXPOSER COMANDOS EN CONSOLA
    window.EKKO_DIAG = {
      INSPECT: () => self.inspeccionCompleta(),
      POSICION: () => self.mostrarPosicion(),
      REINICIAR: () => { self.state.draggingItem = null; console.log('✅ Imagen liberada'); }
    };

    paper.tools.forEach(tool => {
      const originalOnMouseDown = tool.onMouseDown;
      const originalOnMouseDrag = tool.onMouseDrag;

      tool.onMouseDown = function(e) {
        if (originalOnMouseDown) originalOnMouseDown.call(this, e);
        setTimeout(() => {
          const hit = paper.project.hitTest(e.point);
          if (hit && hit.item) {
            const item = hit.item;
            if (item.className === 'Raster' || item.data?.isClientImage === true) {
              self.state.draggingItem = item;
              console.log('\n🖱️ IMAGEN SELECCIONADA — Comando: EKKO_DIAG.INSPECT()');
            }
          }
        }, 0);
      };

      // 🔴 EN TIEMPO REAL: LO QUE LE SUCEDE AL ARRASTRAR
      tool.onMouseDrag = function(e) {
        if (originalOnMouseDrag) originalOnMouseDrag.call(this, e);
        if (!self.state.draggingItem) return;

        const ahora = Date.now();
        if (ahora - self.state.lastLogTime < 150) return;
        self.state.lastLogTime = ahora;

        const img = self.state.draggingItem;
        console.log('🔵 ARRASTRE → Ratón:', Math.round(e.point.x)+','+Math.round(e.point.y), 
                    '| Imagen:', Math.round(img.position.x)+','+Math.round(img.position.y),
                    '| Diferencia:', Math.round(e.point.x-img.position.x)+','+Math.round(e.point.y-img.position.y));
      };
    });
  },

  inspeccionCompleta() {
    const img = this.state.draggingItem;
    if (!img) return console.log('❌ Ninguna imagen seleccionada — haz clic primero en la imagen');

    console.log('\n🔍 =================================================');
    console.log('🔍 INSPECCIÓN COMPLETA DE LA IMAGEN');
    console.log('🔍 =================================================');
    console.log('📦 Tipo:', img.className);
    console.log('📍 Posición absoluta:', Math.round(img.position.x) + ', ' + Math.round(img.position.y));
    console.log('📏 Tamaño / Bounds:', img.bounds ? 
      `${Math.round(img.bounds.width)}x${Math.round(img.bounds.height)} @ ${Math.round(img.bounds.x)},${Math.round(img.bounds.y)}` 
      : 'SIN BOUNDS');
    console.log('🔗 Opacidad:', img.opacity);
    console.log('🔄 Rotación:', Math.round(img.rotation || 0) + '°');
    console.log('📊 Escala:', img.scaling ? `${Math.round(img.scaling.x*100)}%` : '100%');
    console.log('👶 Padre directo:', img.parent ? img.parent.className : 'Ninguno (raíz)');
    console.log('🏠 Camino completo:', this.obtenerCamino(img));
    console.log('🔒 Bloqueada:', img.locked ? 'SÍ' : 'NO');
    console.log('👁️ Visible:', img.visible ? 'SÍ' : 'NO');
    console.log('🔍 =================================================\n');
  },

  mostrarPosicion() {
    const img = this.state.draggingItem;
    if (!img) return console.log('❌ Ninguna imagen seleccionada');
    console.log('📍 Imagen:', Math.round(img.position.x)+','+Math.round(img.position.y));
  },

  obtenerCamino(item) {
    const camino = [];
    let actual = item;
    while (actual) {
      camino.unshift(actual.className + (actual.name ? `("${actual.name}")` : ''));
      actual = actual.parent;
    }
    return camino.join(' → ');
  }
};

export function initSmartFusionListeners() {
  SMART_FUSION.init();
}

window.SMART_FUSION = SMART_FUSION;
window.initSmartFusionListeners = initSmartFusionListeners;
