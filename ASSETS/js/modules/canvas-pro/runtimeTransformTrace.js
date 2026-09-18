/* EKKO Studio — opt-in transform/history hierarchy trace (dev/test only).
 * This module is read-only. It is inert unless runtimeDiag=1 or
 * runtimeTransformTrace=1 is present in the URL.
 */
(function (global) {
  'use strict';
  const params = (() => { try { return new URLSearchParams(global.location?.search || ''); } catch (_) { return new URLSearchParams(); } })();
  const active = params.get('runtimeDiag') === '1' || params.get('runtimeTransformTrace') === '1';
  if (!active) return;

  const state = {
    schema: 'ekko-transform-trace/1', active: true, startedAt: new Date().toISOString(),
    sequence: 0, events: [], preRotate: null, last: null, maxEvents: 80
  };
  const now = () => new Date().toISOString();
  const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const point = value => value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))
    ? { x: num(value.x), y: num(value.y) } : null;
  const bounds = value => value && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(Number(value[k])))
    ? { x: num(value.x), y: num(value.y), width: num(value.width), height: num(value.height) } : null;
  const matrix = value => value && ['a', 'b', 'c', 'd', 'tx', 'ty'].every(k => Number.isFinite(Number(value[k])))
    ? { a: num(value.a), b: num(value.b), c: num(value.c), d: num(value.d), tx: num(value.tx), ty: num(value.ty) } : null;
  const dataOf = item => item?.data || {};
  const matrixDelta = (actual, expected) => actual && expected
    ? Object.fromEntries(['a', 'b', 'c', 'd', 'tx', 'ty'].map(k => [k, num(actual[k]) != null && num(expected[k]) != null ? num(actual[k]) - num(expected[k]) : null]))
    : null;
  const boundsDelta = (actual, expected) => actual && expected
    ? Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, num(actual[k]) != null && num(expected[k]) != null ? num(actual[k]) - num(expected[k]) : null]))
    : null;
  const safe = value => {
    try { return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'function' ? `[Function:${v.name || 'anonymous'}]` : v)); }
    catch (_) { return '[Unserializable]'; }
  };
  function itemPath(item) {
    const path = [], semanticPath = [];
    let current = item;
    while (current && current !== global.paper?.project) {
      path.unshift(Number.isFinite(current.index) ? current.index : null);
      const data = dataOf(current);
      semanticPath.unshift(`${current.className || current.constructor?.name || 'Item'}:${data.label || current.name || current.id || '?'}`);
      current = current.parent;
    }
    return { indexPath: path, semanticPath };
  }
  function itemSnapshot(item, path = null) {
    if (!item) return null;
    const data = dataOf(item);
    let local = null, world = null, itemBounds = null, position = null, scaling = null;
    try { local = matrix(item.matrix); } catch (_) {}
    try { world = matrix(item.globalMatrix); } catch (_) {}
    try { itemBounds = bounds(item.bounds); } catch (_) {}
    try { position = point(item.position); } catch (_) {}
    try { scaling = point(item.scaling); } catch (_) {}
    return {
      id: num(item.id), className: item.className || item.constructor?.name || null,
      name: item.name || null, index: num(item.index), path: path || itemPath(item),
      parent: item.parent ? { id: num(item.parent.id), className: item.parent.className || null, label: dataOf(item.parent).label || null } : null,
      childCount: Array.isArray(item.children) ? item.children.length : (item.children?.length || 0),
      applyMatrix: typeof item.applyMatrix === 'boolean' ? item.applyMatrix : null,
      localMatrix: local, globalMatrix: world, position, rotation: num(item.rotation), scaling, bounds: itemBounds,
      data: {
        label: data.label || null, source: data.source || null, fusionId: data.fusionId || item.fusionId || null,
        clipGroup: data.clipGroup === true, clipMask: item.clipMask === true, isMask: data.isMask === true,
        wasClipMask: data.wasClipMask === true, isFusionMask: data.isFusionMask === true,
        isSmartFusion: data.isSmartFusion === true, mockup: data.mockup === true,
        role: data.role || null
      }
    };
  }
  function walk(item, callback, path = []) {
    if (!item) return;
    callback(item, path);
    try { Array.from(item.children || []).forEach((child, index) => walk(child, callback, path.concat(index))); } catch (_) {}
  }
  function nearestClipGroup(item) {
    let current = item;
    while (current && current !== global.paper?.project) {
      if (dataOf(current).clipGroup === true) return current;
      current = current.parent;
    }
    return null;
  }
  function publicOwner(item) {
    try { return global.EKKO_ROTATION_CONTROLLER?.resolveOwner?.(item) || global.EKKO_FUSION_CONTROLLER?.resolvePublicTransformOwner?.(item) || item; }
    catch (_) { return item; }
  }
  function descendantTrace(root) {
    const result = [];
    walk(root, (item, childPath) => {
      const data = dataOf(item), isRaster = item.className === 'Raster';
      const isMask = item.clipMask === true || data.isMask === true || data.isFusionMask === true || data.wasClipMask === true;
      const isFusion = data.isSmartFusion === true;
      if (isRaster || isMask || isFusion || item === root) result.push(itemSnapshot(item, { ...itemPath(item), childPath }));
    });
    return result;
  }
  function overlaySnapshot() {
    const measurements = [];
    try {
      global.paper?.project?.getItems?.({ match: item => item?.data?.isMeasurement === true }).forEach(item => measurements.push(itemSnapshot(item)));
    } catch (_) {}
    return {
      selectionBox: itemSnapshot(global.selectionBoxGroup),
      measurementsState: safe(global._ekkoMeasurementsState || null),
      measurementItems: measurements.slice(0, 20)
    };
  }
  function ownerRecord(selected) {
    const owner = publicOwner(selected), clip = nearestClipGroup(selected) || nearestClipGroup(owner);
    const roots = [selected, owner, clip].filter(Boolean), seen = new Set(), hierarchy = [];
    roots.forEach(root => walk(root, (item, childPath) => {
      if (seen.has(item)) return; seen.add(item);
      const data = dataOf(item), isRaster = item.className === 'Raster';
      const isMask = item.clipMask === true || data.isMask === true || data.isFusionMask === true || data.wasClipMask === true;
      if (isRaster || isMask || data.isSmartFusion === true) hierarchy.push(itemSnapshot(item, { ...itemPath(item), childPath }));
    }));
    const ownerSnap = itemSnapshot(owner), rendered = hierarchy.filter(x => x?.className === 'Raster' || x?.data?.clipMask || x?.data?.isMask || x?.data?.isFusionMask || x?.data?.wasClipMask);
    return {
      selected: itemSnapshot(selected), publicOwner: ownerSnap,
      nearestClipGroup: itemSnapshot(clip), hierarchy, renderedDescendants: rendered,
      ownerVsRendered: rendered.map(child => ({ childId: child.id, childPath: child.path, globalMatrixDelta: matrixDelta(child.globalMatrix, ownerSnap?.globalMatrix), boundsDelta: boundsDelta(child.bounds, ownerSnap?.bounds) }))
    };
  }
  function selectedRecords() {
    const raw = Array.isArray(global.selectedItems) && global.selectedItems.length ? global.selectedItems : (global.selectedItem ? [global.selectedItem] : []);
    const seen = new Set();
    return raw.filter(Boolean).filter(item => { if (seen.has(item)) return false; seen.add(item); return true; }).map(ownerRecord);
  }
  function historyPath(owner) { return itemPath(owner).indexPath; }
  function score(owner, descriptor) {
    if (!owner || !descriptor) return -1;
    const data = dataOf(owner); let value = 0;
    if (descriptor.id != null && owner.id === descriptor.id) value += 1000;
    if (descriptor.fusionId && data.fusionId === descriptor.fusionId) value += 500;
    if (descriptor.label && data.label === descriptor.label) value += 100;
    if (descriptor.source && data.source === descriptor.source) value += 40;
    if (descriptor.className && owner.className === descriptor.className) value += 20;
    if (descriptor.isRaster && owner.className === 'Raster') value += 10;
    if (descriptor.path?.length && historyPath(owner).join('/') === descriptor.path.join('/')) value += 80;
    return value;
  }
  function historyMatches(descriptors) {
    if (!Array.isArray(descriptors) || !global.paper?.project) return [];
    let items = []; try { items = global.paper.project.getItems({ match: () => true }) || []; } catch (_) {}
    return descriptors.map(descriptor => {
      const candidates = items.map(item => ({ owner: publicOwner(item), item })).filter(x => x.owner).map(x => ({ owner: x.owner, score: score(x.owner, descriptor) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
      const best = candidates[0];
      return { descriptor: safe(descriptor), match: best ? { score: best.score, owner: itemSnapshot(best.owner) } : null, candidateCount: candidates.length };
    });
  }
  function compareTo(snapshot) {
    if (!snapshot) return null;
    const current = selectedRecords();
    return current.map((record, index) => {
      const before = snapshot[index];
      const ownerMatrixDelta = matrixDelta(record.publicOwner?.globalMatrix, before?.publicOwner?.globalMatrix);
      const ownerBoundsDelta = boundsDelta(record.publicOwner?.bounds, before?.publicOwner?.bounds);
      const rendered = record.renderedDescendants.map(child => {
        const previous = before?.renderedDescendants?.find(x => (x.data?.fusionId && x.data.fusionId === child.data?.fusionId) || (x.data?.label && x.data.label === child.data?.label) || x.className === child.className);
        return { childId: child.id, globalMatrixDelta: matrixDelta(child.globalMatrix, previous?.globalMatrix), boundsDelta: boundsDelta(child.bounds, previous?.bounds) };
      });
      return { ownerMatrixDelta, ownerBoundsDelta, renderedChildDeltas: rendered };
    });
  }
  function descriptorSummary(details) {
    const entry = details?.historyEntry;
    const descriptors = details?.historyDescriptors || entry?.transforms;
    return { transformOnly: entry?.transformOnly ?? details?.transformOnly ?? null, label: entry?.label || null, count: Array.isArray(descriptors) ? descriptors.length : 0, matches: historyMatches(descriptors) };
  }
  function traceDetails(details) {
    const copy = { ...(details || {}) };
    ['historyEntry', 'currentEntry'].forEach(key => {
      const entry = copy[key];
      if (entry) copy[key] = { transformOnly: entry.transformOnly ?? null, label: entry.label || null, at: entry.at || null, transforms: Array.isArray(entry.transforms) ? entry.transforms : [] };
    });
    return safe(copy);
  }
  function render(event) {
    let panel = global.document?.getElementById('ekkoTransformTracePanel');
    if (!panel) {
      panel = global.document?.createElement('pre');
      if (!panel) return;
      panel.id = 'ekkoTransformTracePanel';
      panel.setAttribute('aria-label', 'EKKO transform trace');
      panel.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483647;max-width:44vw;max-height:34vh;overflow:auto;background:#17212b;color:#d8f3ff;border:1px solid #38bdf8;border-radius:6px;padding:8px;font:11px/1.35 monospace;white-space:pre-wrap;pointer-events:none;opacity:.94;';
      global.document.body?.appendChild(panel);
    }
    panel.textContent = `EKKO_TRANSFORM_TRACE ${state.events.length} events\n${event.type}\n${JSON.stringify({ phase: event.details?.phase || null, selected: event.snapshot?.selected?.length || 0, transformOnly: event.history?.transformOnly, restore: event.details?.restore || null }, null, 2)}`;
  }
  function boundary(type, details = {}) {
    try {
      const selected = selectedRecords();
      const descriptors = details.historyDescriptors || details.historyEntry?.transforms || null;
      const event = {
        id: `TRANSFORM-${String(++state.sequence).padStart(5, '0')}`, type, at: now(),
        details: traceDetails(details), selected, overlays: overlaySnapshot(),
        history: descriptorSummary(details), comparisonToPreRotate: compareTo(state.preRotate)
      };
      if (type === 'before-rotate') state.preRotate = safe(event);
      event.comparisonToPrevious = compareTo(state.last);
      state.last = event; state.events.push(event); if (state.events.length > state.maxEvents) state.events.shift();
      render(event);
      return event;
    } catch (error) {
      const fallback = { id: `TRANSFORM-${String(++state.sequence).padStart(5, '0')}`, type, at: now(), error: String(error?.stack || error) };
      state.events.push(fallback); return fallback;
    }
  }
  const api = {
    active: true, state,
    boundary,
    clear() { state.events.length = 0; state.preRotate = null; state.last = null; return { ok: true }; },
    snapshot(label = null) { return { schema: state.schema, label, selected: selectedRecords(), overlays: overlaySnapshot(), comparisonToPreRotate: compareTo(state.preRotate), at: now() }; },
    report() { return safe({ schema: state.schema, active: true, startedAt: state.startedAt, events: state.events, latest: state.last, at: now() }); }
  };
  global.EKKO_TRANSFORM_TRACE = api;
  try { if (global.EKKO_RUNTIME_PROBE) global.EKKO_RUNTIME_PROBE.transformTrace = api; } catch (_) {}
  try { if (global.EKKO_DIAG) global.EKKO_DIAG.transformTrace = api; } catch (_) {}
  global.addEventListener?.('beforeunload', () => { try { global.__EKKO_TRANSFORM_TRACE_LAST__ = api.report(); } catch (_) {} });
})(typeof window !== 'undefined' ? window : globalThis);
