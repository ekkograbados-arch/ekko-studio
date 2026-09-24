/*
 * EKKO Studio — single semantic scene contract for closed vector owners.
 * This module does not paint holes. It resolves public owners, stacking units
 * and dynamic solid/cutter relations for every consumer.
 */
import {
  getPublicOwner,
  getPublicOwners,
  isContainmentWrapper,
  isMockupOrMask,
  getOwnerLocalGeometry,
  toWorldGeometry
} from "./designGeometry.js";

export const VECTOR_KIND = Object.freeze({ SOLID: "solid", HOLE: "hole" });

export function semanticKind(item) {
  const owner = getPublicOwner(item) || item;
  const data = owner?.data || {};
  if (data.semanticKind === VECTOR_KIND.HOLE || data.isHole === true) return VECTOR_KIND.HOLE;
  if (data.semanticKind === VECTOR_KIND.SOLID || data.isSolidShape === true) return VECTOR_KIND.SOLID;
  return null;
}

export function setSemanticKind(item, kind) {
  if (!item || (kind !== VECTOR_KIND.SOLID && kind !== VECTOR_KIND.HOLE)) return item;
  item.data = {
    ...(item.data || {}),
    semanticKind: kind,
    isHole: kind === VECTOR_KIND.HOLE,
    isSolidShape: kind === VECTOR_KIND.SOLID
  };
  return item;
}

/** Return the wrapper that must move with a public owner in the layer stack. */
export function getStackingUnit(item) {
  const owner = getPublicOwner(item) || item;
  if (!owner) return null;
  let unit = owner;
  let parent = unit.parent;
  const visited = new Set();
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    if (!isContainmentWrapper(parent)) break;
    unit = parent;
    parent = parent.parent;
  }
  return unit;
}

export function isAboveInRenderOrder(candidate, reference) {
  const a = getStackingUnit(candidate);
  const b = getStackingUnit(reference);
  if (!a || !b || a === b) return false;
  if (a.parent && a.parent === b.parent) return a.index > b.index;

  const chain = item => {
    const result = [];
    let current = item;
    while (current && current.parent) {
      result.unshift(current);
      current = current.parent;
    }
    return result;
  };
  const ca = chain(a), cb = chain(b);
  const length = Math.min(ca.length, cb.length);
  let common = 0;
  while (common < length && ca[common] === cb[common]) common++;
  if (common === 0) return false;
  if (common < length) {
    const ai = typeof ca[common].index === "number" ? ca[common].index : -1;
    const bi = typeof cb[common].index === "number" ? cb[common].index : -1;
    return ai > bi;
  }
  return ca.length > cb.length;
}

export function realGeometryIntersects(a, b) {
  if (!a?.bounds || !b?.bounds || !a.bounds.intersects(b.bounds)) return false;
  try {
    // Nested holes are normally fully contained and have no boundary
    // crossing. Test containment first; calling intersects/getIntersections
    // on large imported SVG/text paths first can be needlessly expensive and
    // may block the UI before the actual CSG subtraction is attempted.
    const probes = [b.bounds.center, a.bounds.center];
    for (const point of probes) {
      if (a.contains?.(point) || b.contains?.(point)) return true;
    }

    // The boolean overlap is the authoritative fallback for partial overlap.
    // It is intentionally run before the more expensive curve intersection
    // enumeration and its temporary result is always removed.
    try {
      const overlap = a.intersect?.(b, { insert: false });
      const area = Math.abs(overlap?.area || 0);
      overlap?.remove?.();
      if (area > 1e-12) return true;
    } catch (_) {}

    return !!(
      a.intersects?.(b) || b.intersects?.(a) ||
      a.getIntersections?.(b)?.length || b.getIntersections?.(a)?.length
    );
  } catch (_) {
    return false;
  }
}


/**
 * The only accepted render layer for design geometry.  Consumers may pass a
 * layer only as a diagnostic hint; they must never silently switch to the
 * active overlay layer.
 */
export function getCanonicalDesignLayer({ targetLayer = null, create = false } = {}) {
  const project = typeof paper !== "undefined" ? paper.project : null;
  if (targetLayer?.name === "designLayer") return targetLayer;
  const named = project?.layers?.find(layer => layer?.name === "designLayer") || null;
  if (named) return named;
  if (!create || !project || typeof paper === "undefined" || !paper.Layer) return null;
  const layer = new paper.Layer({ insert: true });
  layer.name = "designLayer";
  return layer;
}

/**
 * Resolve exactly one public owner per design-layer item and deduplicate it.
 * Every consumer uses designGeometry.getPublicOwners; no second recursive
 * extractor is allowed to invent a different owner set.
 */
export function collectVectorOwners(layer = null, { requireGeomBase = false } = {}) {
  const canonical = getCanonicalDesignLayer({ targetLayer: layer });
  if (!canonical) return [];
  const owners = getPublicOwners(canonical.children || []);
  const seen = new Set();
  return owners.filter(owner => {
    if (!owner || seen.has(owner) || isMockupOrMask(owner) || isContainmentWrapper(owner)) return false;
    if (!semanticKind(owner)) return false;
    if (requireGeomBase && !owner.data?.geomBase) return false;
    seen.add(owner);
    return true;
  });
}

function geometryArea(geometry) {
  if (!geometry) return null;
  if (Number.isFinite(geometry.area)) return Math.abs(geometry.area);
  if (Array.isArray(geometry.children)) {
    const values = geometry.children.map(geometryArea).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  return null;
}

function geometryMetrics(geometry) {
  if (!geometry) return null;
  return {
    area: geometryArea(geometry),
    bounds: geometry.bounds ? {
      x: geometry.bounds.x, y: geometry.bounds.y,
      width: geometry.bounds.width, height: geometry.bounds.height
    } : null,
    segments: Array.isArray(geometry.segments) ? geometry.segments.length :
      (Array.isArray(geometry.children) ? geometry.children.reduce((n, child) => n + (geometryMetrics(child)?.segments || 0), 0) : 0)
  };
}

function visibleWorldGeometry(owner) {
  if (!owner?.clone) return null;
  try {
    const clone = owner.clone({ insert: false });
    const matrix = owner.globalMatrix?.clone?.() || owner.matrix?.clone?.();
    clone.applyMatrix = false;
    clone.matrix = new paper.Matrix();
    if (matrix && !matrix.isIdentity()) clone.transform(matrix);
    return clone;
  } catch (_) { return null; }
}

/**
 * Build dynamic cutter pairs. A pair is valid only when the hole is above the
 * solid and the current world geometries really intersect.
 */
export function buildCutterPairs(owners) {
  const solids = owners.filter(item => semanticKind(item) === VECTOR_KIND.SOLID);
  const holes = owners.filter(item => semanticKind(item) === VECTOR_KIND.HOLE);
  const targets = owners.filter(item =>
    semanticKind(item) === VECTOR_KIND.SOLID || semanticKind(item) === VECTOR_KIND.HOLE
  );
  const pairs = [];
  const skipped = [];
  for (const hole of holes) {
    for (const target of targets) {
      if (hole === target) continue;
      const targetKind = semanticKind(target);
      if (!isAboveInRenderOrder(hole, target)) {
        skipped.push({ hole, target, targetKind, reason: "z-order" });
        continue;
      }
      const holeGeom = toWorldGeometry(hole);
      const targetGeom = toWorldGeometry(target);
      const intersects = realGeometryIntersects(holeGeom, targetGeom);
      try { holeGeom?.remove?.(); } catch (_) {}
      try { targetGeom?.remove?.(); } catch (_) {}
      if (!intersects) {
        skipped.push({ hole, target, targetKind, reason: "no-intersection" });
        continue;
      }
      pairs.push({ hole, target, targetKind });
    }
  }
  return { solids, holes, targets, pairs, skipped };
}

export function auditScene(layer, options = {}) {
  const owners = collectVectorOwners(layer, options);
  const plan = buildCutterPairs(owners);
  const id = item => item?.data?.semanticId || item?.data?.containmentKey || item?.id || null;
  return {
    ownerCount: owners.length,
    solidOwners: plan.solids.length,
    holeOwners: plan.holes.length,
    holeToSolidPairs: plan.pairs.filter(pair => pair.targetKind === VECTOR_KIND.SOLID).length,
    holeToHolePairs: plan.pairs.filter(pair => pair.targetKind === VECTOR_KIND.HOLE).length,
    owners: owners.map(item => {
      const base = toWorldGeometry(item);
      const visible = visibleWorldGeometry(item);
      const baseMetrics = geometryMetrics(base);
      const visibleMetrics = geometryMetrics(visible);
      try { base?.remove?.(); } catch (_) {}
      try { visible?.remove?.(); } catch (_) {}
      return {
        id: id(item),
        semanticKind: semanticKind(item),
        isHole: item.data?.isHole === true,
        hasGeomBase: !!item.data?.geomBase,
        sourceContourIndex: item.data?.sourceContourIndex ?? null,
        sourceDocumentOrder: item.data?.sourceDocumentOrder ?? null,
        zIndex: getStackingUnit(item)?.index ?? null,
        base: baseMetrics,
        visible: visibleMetrics,
        visibleDiffersFromBase: !!(baseMetrics && visibleMetrics && (
          baseMetrics.area !== visibleMetrics.area ||
          baseMetrics.bounds?.x !== visibleMetrics.bounds?.x ||
          baseMetrics.bounds?.y !== visibleMetrics.bounds?.y ||
          baseMetrics.bounds?.width !== visibleMetrics.bounds?.width ||
          baseMetrics.bounds?.height !== visibleMetrics.bounds?.height
        ))
      };
    }),
    candidatePairs: plan.pairs.map(pair => ({
      hole: id(pair.hole), target: id(pair.target), targetKind: pair.targetKind
    })),
    skippedPairs: plan.skipped.map(pair => ({
      hole: id(pair.hole), target: id(pair.target), targetKind: pair.targetKind,
      reason: pair.reason
    }))
  };
}

if (typeof window !== "undefined") {
  window.EKKO_VECTOR_SEMANTICS = {
    VECTOR_KIND, semanticKind, setSemanticKind, getCanonicalDesignLayer,
    getStackingUnit, isAboveInRenderOrder, collectVectorOwners,
    buildCutterPairs, auditScene
  };
}
