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

function realGeometryIntersects(a, b) {
  if (!a?.bounds || !b?.bounds || !a.bounds.intersects(b.bounds)) return false;
  try {
    // Bounds are only a cheap pre-filter. A bounding-box overlap alone must
    // never create a cutter pair.
    if (a.intersects?.(b) || b.intersects?.(a)) return true;
    if (a.getIntersections?.(b)?.length || b.getIntersections?.(a)?.length) return true;
    const points = [
      a.bounds.center, b.bounds.center,
      a.bounds.topLeft, a.bounds.topRight,
      a.bounds.bottomLeft, a.bounds.bottomRight,
      b.bounds.topLeft, b.bounds.topRight,
      b.bounds.bottomLeft, b.bounds.bottomRight
    ].filter(Boolean);
    return points.some(point => a.contains?.(point) || b.contains?.(point));
  } catch (_) {
    return false;
  }
}

/**
 * Resolve exactly one public owner per design-layer item and deduplicate it.
 * Wrappers, masks and UI objects never enter the public scene.
 */
export function collectVectorOwners(layer) {
  const owners = [];
  const seen = new Set();
  const walk = item => {
    if (!item || isMockupOrMask(item)) return;
    const owner = getPublicOwner(item);
    if (owner && !isMockupOrMask(owner) && !isContainmentWrapper(owner) &&
        owner.data?.geomBase && semanticKind(owner) && !seen.has(owner)) {
      seen.add(owner);
      owners.push(owner);
      return;
    }
    item.children?.forEach(walk);
  };
  layer?.children?.forEach(walk);
  return owners;
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

export function auditScene(layer) {
  const owners = collectVectorOwners(layer);
  const plan = buildCutterPairs(owners);
  const id = item => item?.data?.semanticId || item?.data?.containmentKey || item?.id || null;
  return {
    ownerCount: owners.length,
    solidOwners: plan.solids.length,
    holeOwners: plan.holes.length,
    holeToSolidPairs: plan.pairs.filter(pair => pair.targetKind === VECTOR_KIND.SOLID).length,
    holeToHolePairs: plan.pairs.filter(pair => pair.targetKind === VECTOR_KIND.HOLE).length,
    owners: owners.map(item => ({
      id: id(item),
      semanticKind: semanticKind(item),
      isHole: item.data?.isHole === true,
      hasGeomBase: !!item.data?.geomBase,
      sourceContourIndex: item.data?.sourceContourIndex ?? null,
      sourceDocumentOrder: item.data?.sourceDocumentOrder ?? null,
      zIndex: getStackingUnit(item)?.index ?? null
    })),
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
    VECTOR_KIND, semanticKind, setSemanticKind, getStackingUnit,
    isAboveInRenderOrder, collectVectorOwners, buildCutterPairs, auditScene
  };
}
