/*
 * EKKO Studio canonical public-owner and geometry-space contract.
 * This module is deliberately dependency-free: Paper.js is provided by the
 * editor runtime.  All callers must resolve an owner before reading bounds,
 * hit testing, marquee testing, CSG, or publishing selection.
 */

const UI_FLAGS = [
  "isSelectionBox", "isHandle", "isNodeHandle", "isCurveHandle",
  "isNodeEditOverlay", "isSmartGuide", "isMeasurement", "isTracePreview"
];

function dataOf(item) { return item && item.data ? item.data : {}; }
function hasPaperType(item, name) {
  return typeof paper !== "undefined" && paper[name] && item instanceof paper[name];
}
function isFusionOwner(item) {
  const d = dataOf(item);
  return !!(item && (d.isSmartFusion || d.fusionGroup === true || d.role === "fusion-group"));
}
function isUI(item) {
  const d = dataOf(item);
  return UI_FLAGS.some(flag => d[flag] === true);
}
function isMaskSelf(item) {
  const d = dataOf(item);
  return !!(item && (item.clipMask === true || d.isMask === true || d.mockup === true ||
    d.wasClipMask === true || d.role === "mockup-mask" || d.isFusionMask === true));
}

/** True only for masks/mockups/UI, not for a public child inside a containment wrapper. */
export function isMockupOrMask(item) {
  let current = item;
  while (current) {
    if (isUI(current) || isMaskSelf(current)) return true;
    // A containment wrapper is a public-owner indirection, not a mask. Its
    // public child must remain selectable and is therefore not rejected here.
    if (isContainmentWrapper(current)) break;
    current = current.parent;
  }
  if (typeof window !== "undefined") {
    if (item === window.currentMockup || item === window.selectionBoxGroup ||
        item === window.nodeHandlesGroup) return true;
  }
  return false;
}

export function isContainmentWrapper(item) {
  const d = dataOf(item);
  return !!(item && d.clipGroup === true &&
    (d.role === "mockup-containment" || d.role === "containment-wrapper" || d.role === "mockup-clip"));
}

function explicitWrapperOwner(wrapper) {
  const d = dataOf(wrapper);
  if (d.publicOwner && typeof d.publicOwner === "object") return d.publicOwner;
  const id = d.publicOwnerId;
  if (id != null && wrapper.children) {
    const match = wrapper.children.find(child => child && (
      child === d.publicOwner || child.id === id || child.data?.ownerId === id ||
      child.data?.semanticId === id));
    if (match) return match;
  }
  if (wrapper.children) {
    const marked = wrapper.children.filter(child => child?.data?.publicOwner === true);
    if (marked.length === 1) return marked[0];
  }
  return null;
}

/** Resolve exactly one public owner; never infer ownership from child order. */
export function getPublicOwner(item) {
  if (!item || isUI(item)) return null;
  if (isMaskSelf(item)) return null;
  if (isFusionOwner(item)) return item;
  if (isContainmentWrapper(item)) {
    const owner = explicitWrapperOwner(item);
    return owner && !isMockupOrMask(owner) ? getPublicOwner(owner) : null;
  }
  // Internal children of fusion/mask wrappers are not public unless an
  // explicit owner marker made them public. Do not use a generic child scan.
  if (item.data?.publicOwner === false) return null;
  let current = item.parent;
  while (current) {
    if (isContainmentWrapper(current)) {
      const owner = explicitWrapperOwner(current);
      return owner === item ? item : (owner ? getPublicOwner(owner) : null);
    }
    if (isMaskSelf(current) || isUI(current)) return null;
    if (isFusionOwner(current)) return current;
    current = current.parent;
  }
  return item;
}

export function getPublicOwners(items) {
  const result = [];
  const seenObjects = new Set();
  const seenIds = new Set();
  (Array.isArray(items) ? items : [items]).forEach(item => {
    const owner = getPublicOwner(item);
    if (!owner || isMockupOrMask(owner) || isContainmentWrapper(owner)) return;
    const id = dataOf(owner).ownerId || dataOf(owner).semanticId || dataOf(owner).fusionId;
    if (seenObjects.has(owner) || (id != null && seenIds.has(id))) return;
    seenObjects.add(owner); if (id != null) seenIds.add(id); result.push(owner);
  });
  return result;
}

function flattenIdentityClone(source) {
  if (!source || typeof source.clone !== "function") return null;
  const clone = source.clone({ insert: false });
  try {
    const matrix = clone.matrix?.clone?.();
    clone.applyMatrix = false;
    clone.matrix = new paper.Matrix();
    if (matrix && !matrix.isIdentity()) clone.transform(matrix);
    clone.applyMatrix = false;
    clone.matrix = new paper.Matrix();
  } catch (_) {}
  return clone;
}

export function getOwnerLocalGeometry(owner) {
  const resolved = getPublicOwner(owner);
  if (!resolved || isMockupOrMask(resolved)) return null;
  const base = dataOf(resolved).geomBase;
  if (base) return flattenIdentityClone(base);
  if (hasPaperType(resolved, "Path") || hasPaperType(resolved, "CompoundPath") ||
      hasPaperType(resolved, "PointText") || hasPaperType(resolved, "Raster")) {
    return flattenIdentityClone(resolved);
  }
  // Paper plug-ins/custom design items may not expose a concrete class name,
  // but a leaf with clone/bounds is still a valid owner geometry.
  if (!resolved.children && typeof resolved.clone === "function" && resolved.bounds) {
    return flattenIdentityClone(resolved);
  }
  if (resolved.children) {
    const children = getPublicOwners(resolved.children);
    const paths = children.map(getOwnerLocalGeometry).filter(Boolean);
    if (!paths.length) return null;
    if (paths.length === 1) return paths[0];
    const group = new paper.Group({ insert: false });
    group.applyMatrix = false; paths.forEach(path => group.addChild(path));
    group.matrix = new paper.Matrix(); return group;
  }
  return null;
}

export function toWorldGeometry(owner) {
  const resolved = getPublicOwner(owner);
  if (!resolved) return null;
  const local = getOwnerLocalGeometry(resolved);
  if (!local) return null;
  try {
    const world = resolved.globalMatrix?.clone?.() || resolved.matrix?.clone?.() || new paper.Matrix();
    local.applyMatrix = false; local.matrix = new paper.Matrix();
    local.transform(world);
  } catch (_) {}
  return local;
}

export function worldPointToOwner(owner, point) {
  const resolved = getPublicOwner(owner);
  if (!resolved || !point) return null;
  try { return resolved.globalToLocal ? resolved.globalToLocal(point) : point; }
  catch (_) { return point; }
}

export function getOwnerLocalBounds(owner) {
  const geometry = getOwnerLocalGeometry(owner);
  return geometry?.bounds?.clone?.() || null;
}
export function getPublicWorldBounds(owner) {
  const geometry = toWorldGeometry(owner);
  const bounds = geometry?.bounds?.clone?.() || null;
  try { geometry?.remove?.(); } catch (_) {}
  return bounds;
}

function geometryHitLocal(geometry, localPoint, tolerance) {
  if (!geometry || !localPoint) return false;
  try {
    if (geometry.bounds?.expand && !geometry.bounds.expand(tolerance).contains(localPoint)) return false;
    if (geometry.contains?.(localPoint)) return true;
    return !!geometry.hitTest?.(localPoint, { fill: true, stroke: true, segments: true, tolerance });
  } catch (_) { return false; }
}

export function hitTestOwner(owner, worldPoint, tolerance = 0) {
  const resolved = getPublicOwner(owner);
  if (!resolved || isMockupOrMask(resolved)) return null;
  const localPoint = worldPointToOwner(resolved, worldPoint);
  const local = getOwnerLocalGeometry(resolved);
  if (geometryHitLocal(local, localPoint, tolerance)) {
    try { local.remove?.(); } catch (_) {}
    return resolved;
  }
  try { local?.remove?.(); } catch (_) {}
  return null;
}

export function intersectsMarquee(owner, marqueeWorldPath) {
  const resolved = getPublicOwner(owner);
  if (!resolved || isMockupOrMask(resolved) || !marqueeWorldPath) return false;
  const world = toWorldGeometry(resolved);
  if (!world) return false;
  try {
    if (marqueeWorldPath.bounds && !marqueeWorldPath.bounds.intersects(world.bounds)) return false;
    if (world.intersects?.(marqueeWorldPath) || marqueeWorldPath.intersects?.(world)) return true;
    if (marqueeWorldPath.contains?.(world.bounds.center) || world.contains?.(marqueeWorldPath.bounds.center)) return true;
    return !!world.segments?.some(segment => marqueeWorldPath.contains?.(segment.point));
  } catch (_) { return false; }
  finally { try { world.remove?.(); } catch (_) {} }
}

export function selectionFrame(ownerOrOwners) {
  const owners = getPublicOwners(ownerOrOwners);
  if (!owners.length) return null;
  if (owners.length === 1) {
    const owner = owners[0]; const local = getOwnerLocalBounds(owner);
    const matrix = owner.globalMatrix || owner.matrix;
    if (!local || !matrix) return null;
    const map = point => matrix.transform(point);
    return { owner, points: [map(local.topLeft), map(local.topRight), map(local.bottomRight), map(local.bottomLeft)] };
  }
  return owners.map(getPublicWorldBounds).filter(Boolean).reduce((a, b) => a ? a.unite(b) : b.clone(), null);
}

function assertGeometry(condition, message, payload) {
  if (condition || typeof window === "undefined" || !window.EKKO_GEOMETRY_ASSERT) return;
  window.EKKO_GEOMETRY_ASSERT.errors = window.EKKO_GEOMETRY_ASSERT.errors || [];
  window.EKKO_GEOMETRY_ASSERT.errors.push({ message, payload, at: Date.now() });
}

if (typeof window !== "undefined") {
  window.EKKO_GEOMETRY_API = { isMockupOrMask, isContainmentWrapper, getPublicOwner, getPublicOwners,
    getOwnerLocalGeometry, toWorldGeometry, worldPointToOwner, getOwnerLocalBounds,
    getPublicWorldBounds, hitTestOwner, intersectsMarquee, selectionFrame };
  window.EKKO_GEOMETRY_ASSERT = window.EKKO_GEOMETRY_ASSERT || { errors: [] };
  window.EKKO_GEOMETRY_ASSERT.validateOwner = owner => {
    const resolved = getPublicOwner(owner); const base = dataOf(resolved).geomBase;
    assertGeometry(!!resolved && !isMockupOrMask(resolved) && !isContainmentWrapper(resolved), "invalid public owner", owner);
    if (base?.matrix?.isIdentity) assertGeometry(base.matrix.isIdentity(), "non-identity geomBase", resolved);
  };
}
