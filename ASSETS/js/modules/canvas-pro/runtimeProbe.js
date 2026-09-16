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
      matrix,
      index: typeof item.index === 'number' ? item.index : null,
      visible: item.visible !== false,
      selected: !!item.selected,
      data: {
        role: data.role ?? null,
        source: data.source ?? null,
        userImported: data.userImported ?? null,
        isHole: data.isHole ?? null,
        isCalado: data.isCalado ?? null,
        isSmartFusion: data.isSmartFusion ?? null,
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
      designLayer: null,
      fusionRecords: null,
      virtualHoles: null,
      transformTransaction: null
    };
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

  const api = {
    start() { state.active = true; return { ok: true }; },
    stop() { state.active = false; return { ok: true }; },
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
    report() {
      return {
        schema: 'ekko-runtime-probe/1',
        generatedAt: now(),
        ready: state.ready,
        active: state.active,
        operations: state.operations.slice(),
        errors: state.errors.slice(),
        clicks: state.clicks.slice(),
        final: documentSnapshot()
      };
    },
    _state: state,
    _snapshot: documentSnapshot
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
})(window);
