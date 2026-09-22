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
    wrapped: [],
    activeWrappers: new Map(),
    wrappedFns: new Set(),
    pollTimer: null,
    startedAt: new Date().toISOString()
  };

  const now = () => new Date().toISOString();
  const point = (p) => p && typeof p.x === 'number' && typeof p.y === 'number'
    ? { x: p.x, y: p.y } : null;
  const rect = (r) => r ? {
    x: Number(r.x) || 0, y: Number(r.y) || 0,
    width: Number(r.width) || 0, height: Number(r.height) || 0
  } : null;

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
      semanticKind: data.semanticKind ?? null,
      csgMaterialized: data.csgMaterialized ?? null,
      originalIsHole: data.originalIsHole ?? null,
      geomBase: !!data.geomBase,
      containmentKey: data.containmentKey ?? null,
      ownerContainmentKey: data.ownerContainmentKey ?? null,
      selected: !!item.selected,
      data: {
        role: data.role ?? null,
        source: data.source ?? null,
        userImported: data.userImported ?? null,
        semanticKind: data.semanticKind ?? null,
        geomBasePathData: typeof data.geomBasePathData === "string",
        isHole: data.isHole ?? null,
        isCalado: data.isCalado ?? null,
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

  function csgTraceSnapshot() {
    try {
      const trace = global.EKKO_CSG_TRACE;
      if (!trace || trace.enabled !== true) return null;
      return typeof trace.report === 'function' ? trace.report() : trace;
    } catch (error) {
      return { schema: 'ekko-csg-trace/error', error: String(error?.stack || error) };
    }
  }

  function documentSnapshot() {
    const result = {
      capturedAt: now(),
      csgTrace: csgTraceSnapshot(),
      csgReport: null,
      decomposition: null,
      selectedItem: null,
      selectedItems: [],
      designLayer: null,
      fusionRecords: null,
      virtualHoles: null,
      transformTransaction: null,
      textVectorDiag: null,
      commandState: null,
      ungroupRoute: null,
      ungroupRouteHistory: []
    };
    try { result.csgReport = safe(global.EKKO_CSG_LAST_REPORT); } catch (_) {}
    try { result.decomposition = safe(global.EKKO_DECOMPOSITION_LAST); } catch (_) {}
    try { result.selectedItem = itemSnapshot(global.selectedItem); } catch (_) {}
    try {
      result.selectedItems = Array.isArray(global.selectedItems)
        ? global.selectedItems.map(itemSnapshot) : [];
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
    try { result.textVectorDiag = safe(global._ekkoTextVectorDiag); } catch (_) {}
    try { result.commandState = safe(global.EKKO_COMMAND_STATE); } catch (_) {}
    try { result.ungroupRoute = safe(global.EKKO_UNGROUP_LAST_ROUTE); } catch (_) {}
    try { result.ungroupRouteHistory = safe(global.EKKO_UNGROUP_ROUTE_HISTORY || []); } catch (_) {}
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

  const WRAPPED_GLOBALS = [
    'performSmartFusion', 'applySmartFusion', 'applyFusionFromSelection',
    'handleMagneticDrop', 'releaseSmartFusion', 'recalculateSmartFusion',
    'transformFusion', 'transformPublicItem', 'beginTransformTransaction',
    'finalizeTransformTransaction', 'recalculateDynamicSubtractions',
    'convertTextToVector', 'convertSelectionToCalado', 'ungroupSelectedItem'
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
      if (!state.pollTimer) state.pollTimer = global.setInterval(installGlobalWrappers, 250);
      installGlobalWrappers();
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
    clear() { state.operations.length = 0; state.errors.length = 0; state.clicks.length = 0; return { ok: true }; },
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
    getConsoleErrors() { return state.errors.slice(); },
    getWrapperState() {
      return {
        active: Array.from(state.activeWrappers.values()).map(entry => ({ ...entry })),
        history: state.wrapped.map(entry => ({ ...entry }))
      };
    },
    report() {
      return {
        schema: 'ekko-runtime-probe/1',
        generatedAt: now(),
        ready: state.ready,
        active: state.active,
        operations: state.operations.slice(),
        errors: state.errors.slice(),
        clicks: state.clicks.slice(),
        wrappers: api.getWrapperState(),
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
  state.pollTimer = global.setInterval(installGlobalWrappers, 250);
  installGlobalWrappers();

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
          const csg = report.final?.csgTrace;
          const compact = { schema: report.schema, ready: report.ready, operations: report.operations.length, errors: report.errors.length,
            wrappers: report.wrappers, clicks: report.clicks.slice(-8),
            csgTrace: csg ? { schema: csg.schema, enabled: csg.enabled, passes: Array.isArray(csg.passes) ? csg.passes.length : 0,
              lastPass: csg.passes?.length ? { id: csg.passes[csg.passes.length - 1].id, reason: csg.passes[csg.passes.length - 1].reason,
                candidates: csg.passes[csg.passes.length - 1].candidatePairs?.length || 0,
                operations: csg.passes[csg.passes.length - 1].operations?.length || 0 } : null } : null,
            decomposition: report.final?.decomposition ? { sourceCount: report.final.decomposition.sourceCount, ownerCount: report.final.decomposition.ownerCount,
              sourceOrderPreserved: report.final.decomposition.sourceOrderPreserved, allBasesSerializable: report.final.decomposition.allBasesSerializable } : null,
            csgReport: report.final?.csgReport ? { status: report.final.csgReport.status, completed: report.final.csgReport.completed,
              owners: report.final.csgReport.subtractiveItemCount, candidates: report.final.csgReport.candidatePairs,
              intersections: report.final.csgReport.intersectionPairs, appliedPairs: report.final.csgReport.appliedPairs,
              appliedHoles: report.final.csgReport.appliedHoleCount, unresolvedHoles: report.final.csgReport.unresolvedHoles,
              failedBooleans: report.final.csgReport.failedBooleans?.length || 0 } : null,
            final: report.final };
          panel.textContent = JSON.stringify(compact, null, 2);
        } catch (error) { panel.textContent = `RUNTIME_PROBE_RENDER_ERROR: ${String(error)}`; }
      };
      global.setInterval(render, 250);
      render();
    }
  }
})(window);
