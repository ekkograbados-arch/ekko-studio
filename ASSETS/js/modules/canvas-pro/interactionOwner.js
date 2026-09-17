/* ============================================================================
   MÓDULO NUEVO — Single Interaction Owner (Árbitro único de puntero/modo)
   Ruta destino: ASSETS/js/modules/canvas-pro/interactionOwner.js

   PROPÓSITO (Bug 2 y Bug 4 resueltos):
   Hasta hoy existían ~16 flags globales sueltos (dragging, resizeActive,
   rotationActive, fusionEditActive, nodeEditMode, insertTextMode, ...) y
   varios dueños del puntero simultáneos (selectTool + fusionEditMode DOM
   capture + textEditor outside-click). No había "quién manda".

   Este módulo es EL ÚNICO lugar que conoce el modo de interacción activo.
   Toda herramienta nueva (Fusionar, Texto a Vector, Trazado, Calado, ...)
   DEBE registrarse aquí mediante claim()/release(). Todo handler de puntero
   debe consultar isPointerExclusive() antes de procesar un evento.

   MODOS:
     select        — modo normal (selectTool dueño del puntero)
     fusion-edit   — edición interna de fusión (selectTool sigue activo para
                     transformar la imagen libre; NO es exclusivo)
     node-edit     — edición de nodos (paper.Tool propio, exclusivo)
     text-insert   — inserción de texto (clic crea PointText, exclusivo)
     text-edit     — edición de texto existente (overlay DOM, exclusivo)

   MODOS EXCLUSIVOS (isPointerExclusive() === true): selectTool NO procesa
   el clic. Modos no exclusivos ("fusion-edit") conviven con selectTool.
   ============================================================================ */

const POINTER_EXCLUSIVE_MODES = new Set(["node-edit", "text-insert", "text-edit"]);

let _state = {
  mode: "select",
  owner: null,          // identificador del dueño actual (string)
  onExit: null,         // callback que llama el dueño anterior al ser desplazado
  claimedAt: 0
};

function resetPointerFlags() {
  // Defensa contra flags huérfanos (Bug 4): un doble clic con movimiento
  // podía dejar window.dragging === true y el "clic fuera para salir" nunca
  // disparaba. Todo claim() limpia estos flags.
  try {
    window.dragging = false;
    window.resizeActive = false;
    window.rotationActive = false;
    window._mouseDragOccurred = false;
    if (window.rotationTarget) window.rotationTarget = null;
    if (window.rotationTargets) window.rotationTargets = [];
  } catch (e) { /* no-op */ }
}

const interactionOwner = {
  /** Modo activo actual. */
  get mode() { return _state.mode; },

  /** Devuelve true si el modo actual excluye a selectTool del puntero. */
  isPointerExclusive() {
    return POINTER_EXCLUSIVE_MODES.has(_state.mode);
  },

  /**
   * Un módulo reclama el control de la interacción.
   * @param {string} mode  uno de los modos declarados arriba
   * @param {{owner?: string, onExit?: Function}} [meta]
   * @returns {boolean} true si el claim procedió
   */
  claim(mode, meta = {}) {
    // Si ya está activo el mismo modo, no dispara onExit de nuevo.
    if (_state.mode === mode) { resetPointerFlags(); return true; }
    // Llama al onExit del dueño anterior (limpieza simétrica).
    if (typeof _state.onExit === "function") {
      try { _state.onExit("superseded-by-" + mode); } catch (e) { /* no-op */ }
    }
    _state = {
      mode,
      owner: meta.owner || mode,
      onExit: typeof meta.onExit === "function" ? meta.onExit : null,
      claimedAt: Date.now()
    };
    resetPointerFlags();
    window._ekkoInteractionMode = mode;
    return true;
  },

  /**
   * Un módulo libera el control. Solo libera si es el dueño actual (o si no
   * se especifica mode, fuerza liberación a "select").
   */
  release(mode) {
    if (mode && _state.mode !== mode) return false;
    if (typeof _state.onExit === "function") {
      try { _state.onExit("released"); } catch (e) { /* no-op */ }
    }
    _state = { mode: "select", owner: null, onExit: null, claimedAt: 0 };
    resetPointerFlags();
    window._ekkoInteractionMode = "select";
    return true;
  },

  /** Limpia los flags de puntero (puede llamarse standalone). */
  resetPointerFlags,

  /** Estado actual (para diagnóstico / runtimeProbe). */
  snapshot() {
    return { mode: _state.mode, owner: _state.owner, claimedAt: _state.claimedAt,
             pointerExclusive: this.isPointerExclusive() };
  }
};

// Exposición global: todos los módulos lo consumen vía window.EKKO_INTERACTION
// (no necesitan importarlo, igual que EKKO_ROTATION_CONTROLLER).
if (typeof window !== "undefined") {
  window.EKKO_INTERACTION = interactionOwner;
  window._ekkoInteractionMode = "select";
}

console.log("%c[EKKO INTERACTION OWNER v1.0] Árbitro único de modo/puntero cargado. Modo inicial: select.",
  "color: #00e676; font-weight: bold;");

export { interactionOwner, POINTER_EXCLUSIVE_MODES };
export default interactionOwner;
