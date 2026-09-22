/*
 * EKKO Studio — canonical organization command routes.
 *
 * Desagrupar is structural only. It removes an explicit user-created
 * container and preserves every public child as-is. It never classifies
 * contours, decomposes an SVG, or releases a fusion.
 *
 * Descomponer Vector is the only topology route. It delegates source
 * fill-rule/winding interpretation to geometricUngroup.js and publishes
 * closed solid/cutter owners with their matrices, geomBase and Z-order.
 * Quitar Fusión remains owned by the fusion controller and is intentionally
 * not callable through this module's Desagrupar route.
 */
import { getPublicOwners, isMockupOrMask } from "./designGeometry.js";
import { semanticKind } from "./vectorSemantics.js";
import { normalizePublicOwner } from "./ownerGraph.js";
import { decomposeByContainmentHierarchy, recalculateDynamicSubtractions } from "./geometricUngroup.js";

export const UNGROUP_ROUTE = Object.freeze({
  STRUCTURAL: "structural-ungroup",
  SVG: "svg-decompose",
  VECTOR_DECOMPOSE: "vector-decompose",
  FUSION: "fusion-release",
  NONE: "none"
});

export const ORGANIZATION_COMMAND = Object.freeze({
  UNGROUP: "ungroup",
  DECOMPOSE_VECTOR: "decomposeVector",
  RELEASE_FUSION: "releaseSmartFusion"
});

function dataOf(item) { return item?.data || {}; }
function classNameOf(item) { return item?.className || item?.constructor?.name || ""; }
function isGroupLike(item) {
  return ["Group", "CompoundPath", "SymbolItem", "PlacedSymbol"].includes(classNameOf(item));
}
function isStructuralGroup(item) {
  return ["Group", "SymbolItem", "PlacedSymbol"].includes(classNameOf(item));
}

/** Explicit metadata is required: a generic Group is not an ungroup target. */
export function isUserStructuralGroup(item) {
  if (!isStructuralGroup(item)) return false;
  const data = dataOf(item);
  return data.isUserGroup === true || data.structuralGroup === true ||
    data.source === "user-group" || data.role === "user-group" ||
    data.label === "Grupo";
}

export function isFusionOwner(item) {
  const data = dataOf(item);
  return !!(item && (data.isSmartFusion === true || data.fusionId ||
    data.fusionGroup === true || data.role === "fusion-group" ||
    data.semanticKind === "fusion"));
}

function isTextVector(item) {
  const data = dataOf(item);
  return data.source === "text-vector" || data.isTextVector === true;
}

function isImportedSvg(item) {
  const data = dataOf(item);
  // Text-to-vector is a deliberate vector owner, not an imported SVG source
  // container. This prevents a user group containing text from being routed
  // to topology decomposition merely because it has userImported metadata.
  if (isTextVector(item)) return false;
  return data.source === "client-svg" || data.originalSource === "svg" ||
    data.source === "svg-import" || data.importedSvg === true ||
    data.userImported === true;
}

function hasImportedSvgDescendant(item, seen = new Set()) {
  if (!item || seen.has(item)) return false;
  seen.add(item);
  if (isImportedSvg(item)) return true;
  return Array.from(item.children || []).some(child => hasImportedSvgDescendant(child, seen));
}

function isClosedVectorOwner(item) {
  if (!item || isMockupOrMask(item) || isFusionOwner(item)) return false;
  const className = classNameOf(item);
  if (!["Path", "CompoundPath", "Shape"].includes(className)) return false;
  // A decomposed public owner is already a leaf. Running the topology route
  // again would duplicate it and is therefore deliberately rejected.
  if (dataOf(item).decomposedLayer === true) return false;
  return className === "CompoundPath" || item.closed === true || !!dataOf(item).geomBase;
}

function isVectorSourceContainer(item) {
  if (!item || !isGroupLike(item) || isUserStructuralGroup(item) || isFusionOwner(item)) return false;
  const data = dataOf(item);
  return isImportedSvg(item) || data.source === "svg-import" ||
    data.importedSvg === true || hasImportedSvgDescendant(item);
}

/** Resolve the one public owner used by every organization route. */
export function normalizeUngroupOwner(item) {
  return normalizePublicOwner(item);
}

export function canUngroupStructural(item) {
  const owner = normalizeUngroupOwner(item);
  return !!owner && isUserStructuralGroup(owner) && !isFusionOwner(owner);
}

export function canDecomposeVector(item) {
  const owner = normalizeUngroupOwner(item);
  if (!owner || isFusionOwner(owner) || isUserStructuralGroup(owner)) return false;
  return isClosedVectorOwner(owner) || isVectorSourceContainer(owner);
}

export function canReleaseFusion(item) {
  const owner = normalizeUngroupOwner(item);
  return !!owner && isFusionOwner(owner);
}

/**
 * Compatibility route query for existing toolbar consumers. It intentionally
 * reports NONE for vectors and fusions: Desagrupar has one meaning only.
 */
export function getUngroupRoute(item) {
  return canUngroupStructural(item) ? UNGROUP_ROUTE.STRUCTURAL : UNGROUP_ROUTE.NONE;
}

export function getCommandRoute(command, item) {
  const owner = normalizeUngroupOwner(item);
  if (!owner) return UNGROUP_ROUTE.NONE;
  if (command === ORGANIZATION_COMMAND.UNGROUP) return getUngroupRoute(owner);
  if (command === ORGANIZATION_COMMAND.DECOMPOSE_VECTOR) {
    return canDecomposeVector(owner) ? UNGROUP_ROUTE.VECTOR_DECOMPOSE : UNGROUP_ROUTE.NONE;
  }
  if (command === ORGANIZATION_COMMAND.RELEASE_FUSION) {
    return canReleaseFusion(owner) ? UNGROUP_ROUTE.FUSION : UNGROUP_ROUTE.NONE;
  }
  return UNGROUP_ROUTE.NONE;
}

function selectedItems() {
  if (Array.isArray(window.selectedItems) && window.selectedItems.length) {
    return [...window.selectedItems].filter(Boolean);
  }
  return window.selectedItem ? [window.selectedItem] : [];
}

function emitDecision(command, route, accepted, rejected = [], extra = {}) {
  if (typeof window === "undefined") return;
  const payload = {
    command, route, acceptedCount: accepted.length, rejectedCount: rejected.length,
    rejectedReasons: rejected.map(({ owner, reason }) => ({
      ownerId: owner?.data?.ownerId ?? owner?.data?.semanticId ?? owner?.id ?? null,
      reason
    })),
    at: Date.now(), ...extra
  };
  window.EKKO_COMMAND_ROUTE_LAST = payload;
  window.EKKO_UNGROUP_LAST_ROUTE = { route, command, at: payload.at, itemCount: accepted.length };
  if (!Array.isArray(window.EKKO_UNGROUP_ROUTE_HISTORY)) window.EKKO_UNGROUP_ROUTE_HISTORY = [];
  window.EKKO_UNGROUP_ROUTE_HISTORY.push(window.EKKO_UNGROUP_LAST_ROUTE);
  if (window.EKKO_UNGROUP_ROUTE_HISTORY.length > 50) window.EKKO_UNGROUP_ROUTE_HISTORY.shift();
  window.EKKO_DIAG?.logEvent?.("command.route", payload);
}

function worldMatrix(item) {
  return item?.globalMatrix?.clone?.() || item?.matrix?.clone?.() || null;
}
function parentWorldMatrix(parent) {
  return parent?.globalMatrix?.clone?.() || new paper.Matrix();
}

/** Move a child without changing its world transform or semantic metadata. */
function detachPreservingWorld(child, parent, index) {
  if (!child || !parent) return null;
  const world = worldMatrix(child);
  child.remove();
  if (typeof parent.insertChild === "function") parent.insertChild(Math.max(0, index), child);
  else parent.addChild(child);
  if (world && child.matrix) {
    try {
      const local = parentWorldMatrix(parent).inverted().concatenate(world);
      child.matrix = local;
    } catch (_) { /* malformed matrices do not change the owner contract */ }
  }
  return child;
}

function isStructuralContainer(item) {
  if (!item || classNameOf(item) !== "Group") return false;
  const data = dataOf(item);
  if (isFusionOwner(item) || data.geomBase || semanticKind(item)) return false;
  return isUserStructuralGroup(item);
}

function flattenStructuralGroup(group, destination, insertionIndex, result, seen = new Set()) {
  if (!group || seen.has(group)) return insertionIndex;
  seen.add(group);
  const children = Array.from(group.children || []);
  for (const child of children) {
    if (!child || isMockupOrMask(child)) continue;
    if (isStructuralContainer(child)) {
      const nestedChildren = Array.from(child.children || []);
      child.remove();
      for (const nested of nestedChildren) {
        if (isStructuralContainer(nested)) {
          insertionIndex = flattenStructuralGroup(nested, destination, insertionIndex, result, seen);
        } else {
          const moved = detachPreservingWorld(nested, destination, insertionIndex++);
          if (moved) result.push(...getPublicOwners(moved));
        }
      }
      continue;
    }
    const moved = detachPreservingWorld(child, destination, insertionIndex++);
    if (moved) result.push(...getPublicOwners(moved));
  }
  return insertionIndex;
}

/** Structural-only operation. It cannot reach geometricUngroup or Fusion. */
export function structuralUngroup(items) {
  const created = [];
  const roots = Array.from(new Set((Array.isArray(items) ? items : [items])
    .map(normalizeUngroupOwner).filter(owner => canUngroupStructural(owner))));
  for (const root of roots) {
    if (!root.parent) continue;
    const parent = root.parent;
    const index = typeof root.index === "number" ? root.index : parent.children.indexOf(root);
    root.remove();
    flattenStructuralGroup(root, parent, index, created);
  }
  return created.length ? created : roots;
}

/** Low-level topology operation; callers must gate it with canDecomposeVector. */
export function decomposeVectorItems(items) {
  const created = [];
  const owners = Array.from(new Set((Array.isArray(items) ? items : [items])
    .map(normalizeUngroupOwner).filter(owner => canDecomposeVector(owner))));
  for (const owner of owners) {
    const result = decomposeByContainmentHierarchy(owner, isInsideContainmentWrapper(owner), { deferCSG: true });
    if (result?.items?.length) created.push(...result.items.map(normalizeUngroupOwner).filter(Boolean));
  }
  return created;
}

export const svgDecompose = decomposeVectorItems;

function isInsideContainmentWrapper(item) {
  let current = item?.parent || null;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.data?.clipGroup === true) return true;
    current = current.parent;
  }
  return false;
}

function commitSelection(items) {
  const owners = Array.from(new Set((items || []).map(normalizeUngroupOwner).filter(Boolean)));
  if (!owners.length) return owners;
  window.deselectItem?.();
  if (typeof window.commitSelection === "function") {
    window.commitSelection(owners[owners.length - 1], owners);
  } else {
    owners.forEach(item => { try { item.selected = true; } catch (_) {} });
    window.selectedItems = owners;
    window.selectedItem = owners[owners.length - 1];
    window.updateSelectionBox?.(owners[owners.length - 1]);
    window.updateContextualMenu?.(owners[owners.length - 1]);
  }
  return owners;
}

/**
 * Quitar Fusión: the only route allowed to release a FusionGroup. The
 * controller still owns the actual release mutation; this wrapper only gates
 * owners and records the command decision for diagnostics.
 */
export function dispatchFusionRelease(items = null) {
  const selected = items == null ? selectedItems() : (Array.isArray(items) ? items : [items]);
  const owners = Array.from(new Set(selected.map(normalizeUngroupOwner).filter(Boolean)));
  const accepted = owners.filter(owner => canReleaseFusion(owner));
  const rejected = owners.filter(owner => !canReleaseFusion(owner)).map(owner => ({
    owner, reason: "not-fusion-owner"
  }));
  emitDecision(ORGANIZATION_COMMAND.RELEASE_FUSION, UNGROUP_ROUTE.FUSION, accepted, rejected);
  if (!accepted.length || typeof window.releaseSmartFusion !== "function") return null;
  return window.releaseSmartFusion(accepted.length === 1 ? accepted[0] : accepted);
}

/** Descomponer Vector: one or more vector owners, never a fusion. */
export function dispatchVectorDecomposition(items = null) {
  const selected = items == null ? selectedItems() : (Array.isArray(items) ? items : [items]);
  const owners = Array.from(new Set(selected.map(normalizeUngroupOwner).filter(Boolean)));
  const accepted = owners.filter(owner => canDecomposeVector(owner));
  const rejected = owners.filter(owner => !canDecomposeVector(owner)).map(owner => ({
    owner, reason: isFusionOwner(owner) ? "fusion-requires-release-fusion" : "not-vector-source-owner"
  }));
  emitDecision(ORGANIZATION_COMMAND.DECOMPOSE_VECTOR, UNGROUP_ROUTE.VECTOR_DECOMPOSE, accepted, rejected);
  if (!accepted.length) return null;

  window.saveHistory?.();
  const outputs = decomposeVectorItems(accepted);
  const committed = commitSelection(outputs);
  if (typeof paper !== "undefined") paper.view?.update?.();
  return committed.length ? committed : outputs;
}

/** Desagrupar: explicit user groups only; no topology and no fusion release. */
export function dispatchUngroup(items = null) {
  const selected = items == null ? selectedItems() : (Array.isArray(items) ? items : [items]);
  const owners = Array.from(new Set(selected.map(normalizeUngroupOwner).filter(Boolean)));
  const accepted = owners.filter(owner => canUngroupStructural(owner));
  const rejected = owners.filter(owner => !canUngroupStructural(owner)).map(owner => ({
    owner,
    reason: isFusionOwner(owner) ? "fusion-requires-release-fusion" :
      (canDecomposeVector(owner) ? "vector-requires-decompose-vector" : "not-user-structural-group")
  }));
  emitDecision(ORGANIZATION_COMMAND.UNGROUP, UNGROUP_ROUTE.STRUCTURAL, accepted, rejected);
  if (!accepted.length) return null;

  window.saveHistory?.();
  const outputs = structuralUngroup(accepted);
  const committed = commitSelection(outputs);
  recalculateDynamicSubtractions?.();
  if (typeof paper !== "undefined") paper.view?.update?.();
  return committed.length ? committed : outputs;
}

if (typeof window !== "undefined") {
  window.EKKO_UNGROUP_ROUTES = {
    UNGROUP_ROUTE, ORGANIZATION_COMMAND, getCommandRoute, getUngroupRoute,
    canUngroupStructural, canDecomposeVector, canReleaseFusion,
    isUserStructuralGroup, isFusionOwner, normalizeUngroupOwner,
    structuralUngroup, decomposeVectorItems, svgDecompose,
    dispatchUngroup, dispatchVectorDecomposition, dispatchFusionRelease
  };
  window.ungroupSelectedItem = dispatchUngroup;
  window.decomposeVectorSelectedItem = dispatchVectorDecomposition;
}
