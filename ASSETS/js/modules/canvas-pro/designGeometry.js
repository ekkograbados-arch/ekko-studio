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
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
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

function isWrapperChild(wrapper, candidate) {
  if (!wrapper || !candidate || wrapper === candidate) return false;
  if (Array.isArray(wrapper.children) && wrapper.children.includes(candidate)) return true;
  // Paper items normally have a parent link. Walk it defensively so a
  // nested public child is accepted without ever following a cyclic graph.
  const visited = new Set([wrapper]);
  let current = candidate.parent;
  while (current && !visited.has(current)) {
    if (current === wrapper) return true;
    visited.add(current);
    current = current.parent;
  }
  return false;
}

function explicitWrapperOwner(wrapper, visited = new Set(), allowCandidate = null) {
  const d = dataOf(wrapper);
  const accept = candidate => candidate && candidate !== wrapper &&
    (!visited.has(candidate) || candidate === allowCandidate) && isWrapperChild(wrapper, candidate) &&
    !isMockupOrMask(candidate) ? candidate : null;

  // Never trust an arbitrary object reference: a publicOwner object is valid
  // only when it is an actual descendant of this containment wrapper.
  const referenced = accept(d.publicOwner && typeof d.publicOwner === "object" ? d.publicOwner : null);
  if (referenced) return referenced;

  const id = d.publicOwnerId;
  if (id != null && Array.isArray(wrapper.children)) {
    const match = wrapper.children.find(child => child &&
      (child.id === id || child.data?.ownerId === id || child.data?.semanticId === id));
    const accepted = accept(match);
    if (accepted) return accepted;
  }
  if (Array.isArray(wrapper.children)) {
    const marked = wrapper.children.filter(child => child?.data?.publicOwner === true);
    if (marked.length === 1) return accept(marked[0]);
  }
  return null;
}

/** Resolve exactly one public owner; never infer ownership from child order. */
export function getPublicOwner(item, visited = new Set()) {
  const seen = visited instanceof Set ? visited : new Set();
  if (!item || seen.has(item) || isUI(item)) return null;
  if (isMaskSelf(item)) return null;
  seen.add(item);
  if (isFusionOwner(item)) return item;
  if (isContainmentWrapper(item)) {
    const owner = explicitWrapperOwner(item, seen);
    if (!owner || isMockupOrMask(owner)) return null;
    const resolved = getPublicOwner(owner, seen);
    return resolved || null;
  }
  // Internal children of fusion/mask wrappers are not public unless an
  // explicit owner marker made them public. Do not use a generic child scan.
  if (item.data?.publicOwner === false) return null;
  const lineage = new Set(seen);
  let current = item.parent;
  while (current) {
    // A cyclic parent graph is malformed. The sole safe exception is the
    // wrapper already on the resolution path whose owner is this child.
    if (lineage.has(current)) {
      if (isContainmentWrapper(current) && explicitWrapperOwner(current, lineage, item) === item) {
        return item;
      }
      // A caller-supplied path may legitimately contain a plain group
      // ancestor while collecting its children. Fusion/mask ancestors stay
      // blocked; a local parent cycle (including self-parenting) terminates.
      if (current !== item && seen.has(current) && !isFusionOwner(current) &&
          !isMaskSelf(current) && !isUI(current)) return item;
      return null;
    }
    lineage.add(current);
    if (isContainmentWrapper(current)) {
      const owner = explicitWrapperOwner(current, lineage, item);
      if (!owner || !isWrapperChild(current, owner) || isMockupOrMask(owner)) return null;
      if (owner === item) return item;
      if (lineage.has(owner)) return null;
      const resolved = getPublicOwner(owner, lineage);
      return resolved || null;
    }
    if (isMaskSelf(current) || isUI(current)) return null;
    if (isFusionOwner(current)) return current;
    current = current.parent;
  }
  return item;
}

export function getPublicOwners(items, visited = new Set()) {
  const result = [];
  const seenObjects = new Set();
  const seenIds = new Set();
  const basePath = visited instanceof Set ? visited : new Set();
  const append = (item, path) => {
    const owner = getPublicOwner(item, new Set(path));
    if (!owner || path.has(owner) || isMockupOrMask(owner) || isContainmentWrapper(owner)) return;
    const data = dataOf(owner);
    const hasSemanticGeometry = !!data.geomBase || data.semanticKind === 'solid' ||
      data.semanticKind === 'hole' || data.isHole === true || data.isSolidShape === true;
    // A regular imported/user group is a selection/transform container, not a
    // closed vector owner. Marquee and geometry consumers must descend to its
    // public children instead of collapsing the result to the group.
    if (owner.children?.length && !hasSemanticGeometry && !isFusionOwner(owner)) {
      const nextPath = new Set(path); nextPath.add(owner);
      Array.from(owner.children).forEach(child => append(child, nextPath));
      return;
    }
    const id = data.ownerId || data.semanticId || data.fusionId;
    if (seenObjects.has(owner) || (id != null && seenIds.has(id))) return;
    seenObjects.add(owner); if (id != null) seenIds.add(id); result.push(owner);
  };
  (Array.isArray(items) ? items : [items]).forEach(item => append(item, basePath));
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

export function getOwnerLocalGeometry(owner, visited = new Set()) {
  const path = visited instanceof Set ? visited : new Set();
  if (!owner || path.has(owner)) return null;
  const resolved = getPublicOwner(owner, new Set(path));
  if (!resolved || path.has(resolved) || isMockupOrMask(resolved)) return null;
  const nextPath = new Set(path);
  nextPath.add(owner);
  nextPath.add(resolved);

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
    // The visited path contains both the requested item and its canonical
    // owner. This prevents a wrapper/publicOwner cycle from re-entering the
    // same group or an ancestor while preserving valid sibling children.
    const children = getPublicOwners(resolved.children, nextPath);
    const paths = [];
    children.forEach(child => {
      if (!child || nextPath.has(child)) return;
      const geometry = getOwnerLocalGeometry(child, nextPath);
      if (geometry) paths.push(geometry);
    });
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

  // Prefer Paper's native hit test before reconstructing a clone. Imported SVG
  // groups and CompoundPaths can carry child matrices/fill rules that are not
  // faithfully represented by a flattened owner clone. Without this pass a
  // visible SVG may render correctly but remain impossible to select, which
  // also prevents Shift-selection and Fusionar from ever reaching the owner.
  try {
    const nativeHit = resolved.hitTest?.(worldPoint, {
      fill: true,
      stroke: true,
      segments: true,
      tolerance
    });
    if (nativeHit) return resolved;
  } catch (_) {}

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
