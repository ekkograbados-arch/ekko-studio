import { auditScene } from "./vectorSemantics.js";

/* EKKO Studio — Runtime Probe / Fase 1
 * Instrumentación no destructiva para recorridos reales del cliente.
 * No modifica geometrías ni propietarios: solo captura evidencia.
 */
(function (global) {
  'use strict';
  if (global.EKKO_RUNTIME_PROBE) return;

  const state = {
    active: true,
    ready: false,
    sequence: 0,
    operations: [],
    errors: [],
    clicks: [],
    gestures: [],
    gestureSequence: 0,
    activeGesture: null,
    wrapped: [],
    activeWrappers: new Map(),
    wrappedFns: new Set(),
    pollTimer: null,
    startedAt: new Date().toISOString()
  };

  const now = () => new Date().toISOString();
  const REQUIRED_OPERATIONS = [
    'undo', 'redo', 'enterNodeEditMode', 'exitNodeEditMode',
    'enterFusionEditMode', 'exitFusionEditMode', 'convertSelectionToSolid',
    'convertSelectionToCalado', 'ungroupSelectedItem',
    'prepareSVGForExport', 'downloadExportedSVG'
  ];
  const operationCoverage = () => {
    const available = REQUIRED_OPERATIONS.filter(name => typeof global[name] === 'function');
    const wrapped = REQUIRED_OPERATIONS.filter(name => state.activeWrappers.has(name));
    return {
      required: REQUIRED_OPERATIONS.slice(), available, wrapped,
      missing: REQUIRED_OPERATIONS.filter(name => !available.includes(name)),
      unwrapped: available.filter(name => !wrapped.includes(name)),
      pass: available.length === REQUIRED_OPERATIONS.length && wrapped.length === REQUIRED_OPERATIONS.length
    };
  };
  const point = (p) => p && typeof p.x === 'number' && typeof p.y === 'number'
    ? { x: p.x, y: p.y } : null;
  const rect = (r) => r ? {
    x: Number(r.x) || 0, y: Number(r.y) || 0,
    width: Number(r.width) || 0, height: Number(r.height) || 0
  } : null;

  function itemRef(item) {
    if (!item) return null;
    const data = item.data || {};
    return {
      id: item.id ?? null,
      className: item.className || item.constructor?.name || null,
      name: item.name || null,
      semanticId: data.semanticId ?? null,
      ownerId: data.ownerId ?? null,
      fusionId: data.fusionId ?? item.fusionId ?? null,
      sourceContourIndex: data.sourceContourIndex ?? null,
      semanticKind: data.semanticKind ?? (data.isHole === true ? 'hole' : (data.isSolidShape === true ? 'solid' : null)),
      isHole: data.isHole === true,
      hasGeomBase: !!data.geomBase,
      visible: item.visible !== false,
      selected: !!item.selected
    };
  }

  function ownerChainSnapshot(chain) {
    if (!chain) return null;
    return {
      rawItem: itemRef(chain.rawItem),
      publicOwner: itemRef(chain.publicOwner),
      selectionUnit: itemRef(chain.selectionUnit),
      transformOwner: itemRef(chain.transformOwner),
      stackingUnit: itemRef(chain.stackingUnit),
      fusionOwner: itemRef(chain.fusionOwner),
      semanticKind: chain.semanticKind || null,
      data: chain.data || null,
      identity: chain.identity || null
    };
  }

  function selectionState() {
    const api = global.EKKO_SELECTION_API;
    if (api?.describeSelectionState) {
      try {
        const state = api.describeSelectionState();
        return {
          primary: ownerChainSnapshot(state.primary),
          items: Array.isArray(state.items) ? state.items.map(ownerChainSnapshot) : [],
          paperSelected: Array.isArray(state.paperSelected) ? state.paperSelected.map(ownerChainSnapshot) : [],
          interaction: state.interaction || null
        };
      } catch (_) {}
    }
    const items = Array.isArray(global.selectedItems) ? global.selectedItems : [];
    return {
      primary: itemRef(global.selectedItem),
      items: items.map(itemRef),
      paperSelected: [],
      interaction: global.EKKO_INTERACTION?.snapshot?.() || null
    };
  }

  function safe(value, depth = 0, seen = new WeakSet()) {
    if (depth > 2 || value == null) return value == null ? value : '[MaxDepth]';
    if (typeof value === 'function') return `[Function:${value.name || 'anonymous'}]`;
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 20).map(v => safe(v, depth + 1, seen));
    const out = {};
    Object.keys(value).slice(0, 40).forEach(k => {
      if (k === 'project' || k === 'parent' || k === 'children') return;
      try { out[k] = safe(value[k], depth + 1, seen); } catch (_) { out[k] = '[Unreadable]'; }
    });
    return out;
  }

  function itemSnapshot(item, depth = 0) {
    if (!item || depth > 3) return null;
    const data = item.data || {};
    let bounds = null, position = null, scaling = null, matrix = null;
    try { bounds = rect(item.bounds); } catch (_) {}
    try { position = point(item.position); } catch (_) {}
    try { scaling = point(item.scaling); } catch (_) {}
    try {
      const m = item.matrix;
      matrix = m ? { a: m.a, b: m.b, c: m.c, d: m.d, tx: m.tx, ty: m.ty } : null;
    } catch (_) {}
    const snap = {
      id: item.id ?? null,
      className: item.className || item.constructor?.name || null,
      name: item.name || null,
      bounds, position, scaling,
      rotation: typeof item.rotation === 'number' ? item.rotation : null,
      fillRule: item.fillRule || null,
      matrix,
      index: typeof item.index === 'number' ? item.index : null,
      visible: item.visible !== false,
      selected: !!item.selected,
      data: {
        role: data.role ?? null,
        source: data.source ?? null,
        userImported: data.userImported ?? null,
        isHole: data.isHole ?? null,
        semanticKind: data.semanticKind ?? null,
        isSolidShape: data.isSolidShape ?? null,
        hasGeomBase: !!data.geomBase,
        contourRole: data.contourRole ?? null,
        sourceContourIndex: data.sourceContourIndex ?? null,
        isCalado: data.isCalado ?? null,
        filledFromHole: data.filledFromHole ?? null,
        isSmartFusion: data.isSmartFusion ?? null,
        isTextVector: data.isTextVector ?? null,
        hasInternalHoles: data.hasInternalHoles ?? null,
        preserveCompoundTopology: data.preserveCompoundTopology ?? null,
        fusionId: data.fusionId ?? item.fusionId ?? null,
        isMask: data.isMask ?? null,
        mockup: data.mockup ?? null
      }
    };
    if (item.children) {
      try { snap.children = Array.from(item.children).slice(0, 20).map(c => itemSnapshot(c, depth + 1)); }
      catch (_) { snap.children = '[Unreadable]'; }
    }
    return snap;
  }

  function documentSnapshot() {
    const result = {
      capturedAt: now(),
      selectedItem: null,
      selectedItems: [],
      selectionContext: null,
      designLayer: null,
      fusionRecords: null,
      virtualHoles: null,
      transformTransaction: null,
      transformCsg: null,
      geomBaseErrors: null,
      textVectorDiag: null,
      commandState: null,
      csgReport: null,
      exportReport: null,
      semanticScene: null
    };
    try { result.selectedItem = itemSnapshot(global.selectedItem); } catch (_) {}
    try {
      result.selectedItems = Array.isArray(global.selectedItems)
        ? global.selectedItems.map(itemSnapshot) : [];
    } catch (_) {}
    try {
      result.selectionContext = selectionState();
    } catch (_) {}
    try {
      const p = global.paper;
      if (p?.project) {
        const layer = p.project.getItem?.({ name: 'designLayer' }) || p.project.activeLayer;
        result.designLayer = itemSnapshot(layer);
      }
    } catch (_) {}
    try { result.fusionRecords = safe(global._fusionRecords); } catch (_) {}
    try { result.virtualHoles = safe(global._fusionVirtualHoles); } catch (_) {}
    try { result.transformTransaction = safe(global._ekkoTransformTransaction); } catch (_) {}
    try { result.transformCsg = safe(global.EKKO_LAST_TRANSFORM_CSG); } catch (_) {}
    try { result.geomBaseErrors = safe(global.EKKO_GEOMBASE_ERRORS); } catch (_) {}
    try { result.textVectorDiag = safe(global._ekkoTextVectorDiag); } catch (_) {}
    try { result.commandState = safe(global.EKKO_COMMAND_STATE); } catch (_) {}
    try { result.csgReport = safe(global.EKKO_CSG_LAST_REPORT); } catch (_) {}
    try { result.exportReport = safe(global.EKKO_EXPORT_LAST_REPORT); } catch (_) {}
    try {
      const p = global.paper;
      const layer = p?.project?.getItem?.({ name: 'designLayer' }) || p?.project?.activeLayer;
      result.semanticScene = safe(auditScene(layer));
    } catch (_) {}
    return result;
  }

  function record(type, details = {}) {
    if (!state.active) return null;
    const op = {
      id: `RUNTIME-${String(++state.sequence).padStart(5, '0')}`,
      type: type || 'event',
      startedAt: now(),
      details: safe(details),
      before: documentSnapshot()
    };
    state.operations.push(op);
    return op.id;
  }

  function finish(id, result = {}) {
    const op = state.operations.find(x => x.id === id);
    if (!op) return null;
    op.finishedAt = now();
    op.result = safe(result);
    op.after = documentSnapshot();
    op.ok = result.ok !== false;
    return op;
  }

  function eventPoint(event) {
    try {
      const p = global.paper?.view?.getEventPoint?.(event);
      if (p) return { x: Number(p.x) || 0, y: Number(p.y) || 0 };
    } catch (_) {}
    return null;
  }

  function resolveCanvasHit(event) {
    const pointValue = eventPoint(event);
    let target = null;
    try {
      target = pointValue && global.EKKO_SELECTION_API?.resolveInteractionTarget
        ? global.EKKO_SELECTION_API.resolveInteractionTarget(pointValue, {
          button: event.button,
          shift: event.shiftKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          meta: event.metaKey
        }) : null;
    } catch (error) {
      state.errors.push({ at: now(), type: 'selection-resolver', message: String(error?.stack || error) });
    }
    return {
      point: pointValue,
      hit: target ? {
        identity: target.chain?.identity || null,
        semanticKind: target.chain?.semanticKind || null,
        chain: ownerChainSnapshot(target.chain)
      } : null
    };
  }

  function finishGesture(gesture, event, phase, hit) {
    if (!gesture) return null;
    gesture.phase = phase;
    gesture.eventType = event?.type || gesture.eventType || null;
    gesture.endPoint = hit?.point || null;
    gesture.endHit = hit?.hit || null;
    gesture.endModifiers = {
      shift: !!event?.shiftKey,
      ctrl: !!event?.ctrlKey,
      alt: !!event?.altKey,
      meta: !!event?.metaKey
    };
    gesture.selectionAfter = null;
    global.setTimeout(() => {
      gesture.selectionAfter = selectionState();
      gesture.interactionAfter = global.EKKO_INTERACTION?.snapshot?.() || null;
      gesture.finishedAt = now();
    }, 0);
    state.activeGesture = null;
    return gesture;
  }

  function recordCanvasGesture(phase, event) {
    if (!state.active || !event) return null;
    const hit = resolveCanvasHit(event);
    if (phase === 'pointermove') {
      const gesture = state.activeGesture;
      if (!gesture) return null;
      gesture.moveCount += 1;
      gesture.lastMove = {
        point: hit.point,
        hit: hit.hit,
        at: now()
      };
      if (gesture.moveTrace.length < 24 || gesture.moveCount % 10 === 0) {
        gesture.moveTrace.push(gesture.lastMove);
        if (gesture.moveTrace.length > 24) gesture.moveTrace.shift();
      }
      return gesture;
    }

    const isPointerStart = phase === 'pointerdown';
    const isPointerEnd = phase === 'pointerup';
    if (isPointerEnd && state.activeGesture) {
      return finishGesture(state.activeGesture, event, phase, hit);
    }

    const gesture = {
      id: `GESTURE-${String(++state.gestureSequence).padStart(5, '0')}`,
      at: now(),
      phase,
      eventType: event.type || null,
      button: typeof event.button === 'number' ? event.button : null,
      buttons: typeof event.buttons === 'number' ? event.buttons : null,
      point: hit.point,
      modifiers: {
        shift: !!event.shiftKey,
        ctrl: !!event.ctrlKey,
        alt: !!event.altKey,
        meta: !!event.metaKey
      },
      interaction: global.EKKO_INTERACTION?.snapshot?.() || null,
      hit: hit.hit,
      selectionBefore: selectionState(),
      selectionAfter: null,
      moveCount: 0,
      moveTrace: [],
      endPoint: null,
      endHit: null
    };
    state.gestures.push(gesture);
    if (state.gestures.length > 100) state.gestures.shift();
    if (isPointerStart) {
      state.activeGesture = gesture;
    } else {
      finishGesture(gesture, event, phase, hit);
    }
    return gesture;
  }

  let canvasListenersInstalled = false;
  function installCanvasListeners() {
    if (canvasListenersInstalled) return;
    const canvas = global.document?.getElementById('editorCanvas');
    if (!canvas) return;
    const handler = event => {
      const phase = event.type === 'mousedown' ? 'pointerdown'
        : event.type === 'mouseup' ? 'pointerup'
          : event.type === 'contextmenu' ? 'contextmenu'
            : event.type === 'dblclick' ? 'doubleclick'
              : 'pointermove';
      if (phase === 'pointermove' && !event.buttons) return;
      recordCanvasGesture(phase, event);
    };
    ['mousedown', 'mousemove', 'mouseup', 'contextmenu', 'dblclick'].forEach(type => {
      canvas.addEventListener(type, handler, true);
    });
    canvasListenersInstalled = true;
    state.wrapped.push({ name: 'canvas.pointer-trace', at: now(), active: true, original: 'editorCanvas' });
  }

  const WRAPPED_GLOBALS = [
    'performSmartFusion', 'applySmartFusion', 'applyFusionFromSelection',
    'handleMagneticDrop', 'releaseSmartFusion', 'recalculateSmartFusion',
    'transformFusion', 'transformPublicItem', 'beginTransformTransaction',
    'finalizeTransformTransaction', 'recalculateDynamicSubtractions',
    'convertTextToVector', 'convertSelectionToCalado', 'convertSelectionToSolid',
    'prepareSVGForExport', 'downloadExportedSVG', 'ungroupSelectedItem'
  ];

  function installGlobalWrappers() {
    if (!state.active) return;
    WRAPPED_GLOBALS.forEach(name => {
      const original = global[name];
      if (typeof original !== 'function' || original.__ekkoRuntimeProbeWrapped) return;
      const wrapped = function (...args) {
        const id = record(`runtime.${name}`, { argCount: args.length });
        try {
          const result = original.apply(this, args);
          if (result && typeof result.then === 'function') {
            return result.then(value => { finish(id, { ok: true, async: true, value }); return value; })
              .catch(error => { finish(id, { ok: false, async: true, error: String(error?.stack || error) }); throw error; });
          }
          finish(id, { ok: true, value: result });
          return result;
        } catch (error) {
          finish(id, { ok: false, error: String(error?.stack || error) });
          throw error;
        }
      };
      wrapped.__ekkoRuntimeProbeWrapped = true;
      wrapped.__ekkoRuntimeProbeOriginal = original;
      global[name] = wrapped;
      const previous = state.activeWrappers.get(name);
      if (previous) previous.active = false;
      const entry = {
        name,
        at: now(),
        active: true,
        original: original.name || 'anonymous'
      };
      state.wrapped.push(entry);
      state.activeWrappers.set(name, entry);
      state.wrappedFns.add(name);
    });
  }

  const api = {
    start() {
      state.active = true;
      if (!state.pollTimer) state.pollTimer = global.setInterval(() => {
        installGlobalWrappers();
        installCanvasListeners();
      }, 250);
      installGlobalWrappers();
      installCanvasListeners();
      return { ok: true };
    },
    stop() {
      state.active = false;
      if (state.pollTimer) {
        global.clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
      return { ok: true };
    },
    clear() { state.operations.length = 0; state.errors.length = 0; state.clicks.length = 0; state.gestures.length = 0; state.gestureSequence = 0; state.activeGesture = null; return { ok: true }; },
    ready(details = {}) {
      state.ready = true;
      return finish(record('studio.ready', details), { ok: true, ready: true });
    },
    snapshot(label = null) { return { label, ...documentSnapshot() }; },
    begin(type, details) { return record(type, details); },
    end(id, result) { return finish(id, result); },
    fail(id, error, details = {}) {
      const result = { ok: false, error: String(error?.stack || error), ...details };
      if (id) return finish(id, result);
      state.errors.push({ at: now(), ...result });
      return result;
    },
    trace(type, details, fn) {
      const id = record(type, details);
      try {
        const value = fn();
        finish(id, { ok: true, value });
        return value;
      } catch (error) {
        finish(id, { ok: false, error: String(error?.stack || error) });
        throw error;
      }
    },
    record,
    getOperations() { return state.operations.slice(); },
    getGestures() { return state.gestures.slice(); },
    getConsoleErrors() { return state.errors.slice(); },
    getWrapperState() {
      return {
        active: Array.from(state.activeWrappers.values()).map(entry => ({ ...entry })),
        history: state.wrapped.map(entry => ({ ...entry }))
      };
    },
    report() {
      return {
        schema: 'ekko-runtime-probe/3',
        generatedAt: now(),
        ready: state.ready,
        active: state.active,
        operations: state.operations.slice(),
        errors: state.errors.slice(),
        clicks: state.clicks.slice(),
        gestures: state.gestures.slice(),
        wrappers: api.getWrapperState(),
        operationCoverage: operationCoverage(),
        final: documentSnapshot()
      };
    },
    _state: state,
    _snapshot: documentSnapshot,
    installGlobalWrappers
  };

  global.EKKO_RUNTIME_PROBE = api;

  global.addEventListener?.('error', event => {
    state.errors.push({ at: now(), type: 'window.error', message: event.message || String(event.error || 'error'), source: event.filename || null, line: event.lineno || null });
  });
  global.addEventListener?.('unhandledrejection', event => {
    state.errors.push({ at: now(), type: 'unhandledrejection', message: String(event.reason?.stack || event.reason || 'rejection') });
  });
  global.document?.addEventListener('click', event => {
    if (!state.active) return;
    const el = event.target?.closest?.('button,[data-fusion-btn],[data-ekko-command]');
    if (!el) return;
    state.clicks.push({ at: now(), id: el.id || null, command: el.dataset?.ekkoCommand || null, fusionButton: el.dataset?.fusionBtn || null, text: (el.innerText || '').trim().slice(0, 120) });
  }, true);

  // Modo visible para validar desde el navegador sin depender de DevTools.
  // Activación: agregar ?runtimeDiag=1 a la URL de EKKO Studio.
  state.pollTimer = global.setInterval(() => {
    installGlobalWrappers();
    installCanvasListeners();
  }, 250);
  installGlobalWrappers();
  installCanvasListeners();

  if (global.location?.search?.includes('runtimeDiag=1')) {
    const panel = global.document?.createElement('pre');
    if (panel) {
      panel.id = 'ekkoRuntimeProbePanel';
      panel.setAttribute('aria-label', 'EKKO Runtime Probe');
      panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:420px;max-height:260px;overflow:auto;margin:0;padding:10px;border:1px solid #38bdf8;border-radius:8px;background:#0f172acc;color:#e2e8f0;font:11px/1.35 monospace;white-space:pre-wrap;pointer-events:none;';
      (global.document.body || global.document.documentElement).appendChild(panel);
      const render = () => {
        try {
          const report = api.report();
          installGlobalWrappers();
          const compact = { schema: report.schema, ready: report.ready, operations: report.operations.length, errors: report.errors.length, wrappers: report.wrappers, clicks: report.clicks.slice(-8), gestures: report.gestures.slice(-12), final: report.final };
          panel.textContent = JSON.stringify(compact, null, 2);
        } catch (error) { panel.textContent = `RUNTIME_PROBE_RENDER_ERROR: ${String(error)}`; }
      };
      global.setInterval(render, 250);
      render();
    }
  }
})(window);
