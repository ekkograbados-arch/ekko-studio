/* EKKO Studio — Single Interaction Owner
 * Fuente única para el modo activo y la sesión actual del puntero.
 * Los módulos pueden conservar su motor interno, pero no pueden procesar un
 * evento si no son el dueño registrado aquí.
 */

const VALID_MODES = new Set([
  "select", "transform", "node-edit", "fusion-edit", "text-insert", "text-edit"
]);

let state = {
  mode: "select",
  owner: "selection",
  payload: null,
  pointer: null,
  claimedAt: 0
};

function resetPointerFlags() {
  if (typeof window === "undefined") return;
  window.dragging = false;
  window.resizeActive = false;
  window.rotationActive = false;
  window._mouseDragOccurred = false;
  window.rotationTarget = null;
  window.rotationTargets = [];
}

function publish() {
  if (typeof window === "undefined") return;
  window._ekkoInteractionMode = state.mode;
  window.EKKO_OWNER_STATE = snapshot();
}

function snapshot() {
  return {
    mode: state.mode,
    owner: state.owner,
    claimedAt: state.claimedAt,
    pointer: state.pointer ? {
      token: state.pointer.token,
      owner: state.pointer.owner,
      phase: state.pointer.phase
    } : null
  };
}

function endPrevious(previous, reason) {
  if (!previous?.payload || typeof previous.payload.onExit !== "function") return;
  try { previous.payload.onExit(reason); } catch (error) {
    if (typeof window !== "undefined" && window.EKKO_DEBUG) {
      console.warn("[EKKO OWNER] Error al cerrar el owner anterior", error);
    }
  }
}

const interactionOwner = {
  get mode() { return state.mode; },
  get owner() { return state.owner; },

  claim(mode, payload = {}) {
    if (!VALID_MODES.has(mode)) return false;
    if (state.mode === mode && state.owner === (payload.owner || state.owner)) {
      state.payload = { ...state.payload, ...payload };
      resetPointerFlags();
      publish();
      return true;
    }
    const previous = state;
    state = {
      mode,
      owner: payload.owner || mode,
      payload,
      pointer: null,
      claimedAt: Date.now()
    };
    // El estado nuevo queda publicado antes del callback: si el callback
    // intenta liberar su modo antiguo, no puede liberar al nuevo owner.
    publish();
    resetPointerFlags();
    endPrevious(previous, "superseded-by-" + mode);
    return true;
  },

  release(mode = null, reason = "released") {
    if (mode && state.mode !== mode) return false;
    const previous = state;
    state = {
      mode: "select",
      owner: "selection",
      payload: null,
      pointer: null,
      claimedAt: 0
    };
    publish();
    resetPointerFlags();
    endPrevious(previous, reason);
    return true;
  },

  beginPointer(owner, payload = {}) {
    if (!owner || (state.mode !== owner && !(state.mode === "transform" && owner === "select"))) {
      return null;
    }
    const token = "ptr_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    state.pointer = { token, owner, phase: "down", payload };
    publish();
    return token;
  },

  updatePointer(owner, phase, token = null) {
    if (!state.pointer || state.pointer.owner !== owner) return false;
    if (token && state.pointer.token !== token) return false;
    state.pointer.phase = phase;
    publish();
    return true;
  },

  endPointer(owner, token = null) {
    if (!state.pointer || state.pointer.owner !== owner) return false;
    if (token && state.pointer.token !== token) return false;
    state.pointer = null;
    publish();
    return true;
  },

  owns(mode) {
    return state.mode === mode;
  },

  canHandle(owner) {
    if (owner === "select") {
      return state.mode === "select" || state.mode === "transform";
    }
    return state.mode === owner;
  },

  isPointerExclusive() {
    return state.mode !== "select";
  },

  resetPointerFlags,
  snapshot
};

if (typeof window !== "undefined") {
  window.EKKO_INTERACTION = interactionOwner;
  publish();
}

export { interactionOwner, VALID_MODES };
export default interactionOwner;
