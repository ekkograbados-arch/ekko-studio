/*
 * EKKO Studio — canonical Desagrupar dispatcher.
 *
 * There are deliberately three routes and only this module chooses between
 * them.  A regular user group is structural; a client SVG is decomposed by
 * source topology; a fusion is released by the fusion controller.  Keeping
 * the choice here prevents a generic group operation from silently changing
 * contour semantics or releasing a fusion as if it were an ordinary group.
 */
import { getPublicOwners, isMockupOrMask } from "./designGeometry.js";
import { semanticKind } from "./vectorSemantics.js";
import { normalizePublicOwner } from "./ownerGraph.js";
import { decomposeByContainmentHierarchy, recalculateDynamicSubtractions } from "./geometricUngroup.js";

export const UNGROUP_ROUTE = Object.freeze({
  STRUCTURAL: "structural-ungroup",
  SVG: "svg-decompose",
  FUSION: "fusion-release",
  NONE: "none"
});

function dataOf(item) { return item?.data || {}; }
function classNameOf(item) { return item?.className || item?.constructor?.name || ""; }
function isGroupLike(item) {
  return ["Group", "CompoundPath", "SymbolItem", "PlacedSymbol"].includes(classNameOf(item));
}
function isStructuralGroup(item) {
  return ["Group", "SymbolItem", "PlacedSymbol"].includes(classNameOf(item));
}
function isClosedVectorOwner(item) {
  if (!item || isMockupOrMask(item)) return false;
  const className = classNameOf(item);
  if (!["Path", "CompoundPath", "Shape"].includes(className)) return false;
  if (item.data?.decomposedLayer === true) return false;
  if (item.data?.isSmartFusion || item.data?.fusionId) return false;
  return className === "CompoundPath" || item.closed === true || !!item.data?.geomBase;
}
function isVectorSourceContainer(item) {
  if (!item || !isGroupLike(item) || isUserStructuralGroup(item)) return false;
  const data = dataOf(item);
  return data.source === "client-svg" || data.originalSource === "svg" ||
    data.source === "svg-import" || data.importedSvg === true ||
    data.userImported === true || hasImportedSvgDescendant(item);
}
function isUserStructuralGroup(item) {
  if (!isStructuralGroup(item)) return false;
  const data = dataOf(item);
  return data.isUserGroup === true || data.source === "user-group" ||
    data.role === "user-group" || data.label === "Grupo";
}
function isFusionOwner(item) {
  const data = dataOf(item);
  return !!(data.isSmartFusion === true || data.fusionId || data.fusionGroup === true ||
    data.role === "fusion-group" || data.semanticKind === "fusion");
}
function isTextVector(item) {
  const data = dataOf(item);
  return data.source === "text-vector" || data.isTextVector === true;
}

function isImportedSvg(item) {
  const data = dataOf(item);
  // `userImported` is a broad client-design flag and is also stamped on
  // text-to-vector results. It must not route text vectors through the SVG
  // source classifier when they live inside an ordinary user group.
  if (isTextVector(item)) return false;
  return data.source === "client-svg" || data.originalSource === "svg" ||
    data.source === "svg-import" || data.importedSvg === true || data.userImported === true;
}
function hasImportedSvgDescendant(item, seen = new Set()) {
  if (!item || seen.has(item)) return false;
  seen.add(item);
  if (isImportedSvg(item)) return true;
  return Array.from(item.children || []).some(child => hasImportedSvgDescendant(child, seen));
}

function fusionOwnerInLineage(item) {
  let current = item;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (isFusionOwner(current)) return current;
    current = current.parent;
  }
  return null;
}

/** Resolve the one public owner used by all three routes. */
export function normalizeUngroupOwner(item) {
  return normalizePublicOwner(item);
}

export function getUngroupRoute(item) {
  const owner = normalizeUngroupOwner(item);
  if (!owner) return UNGROUP_ROUTE.NONE;
  if (fusionOwnerInLineage(owner)) return UNGROUP_ROUTE.FUSION;
  // Desagrupar only removes explicit user-created containers. Imported SVG
  // roots and closed vectors are handled by Descomponer Vector.
  if (!isUserStructuralGroup(owner)) return UNGROUP_ROUTE.NONE;
  return UNGROUP_ROUTE.STRUCTURAL;
}

function emitRoute(route, payload = {}) {
  if (typeof window === "undefined") return;
  window.EKKO_UNGROUP_LAST_ROUTE = {
    route, at: Date.now(), ...payload
  };
  if (!Array.isArray(window.EKKO_UNGROUP_ROUTE_HISTORY)) window.EKKO_UNGROUP_ROUTE_HISTORY = [];
  window.EKKO_UNGROUP_ROUTE_HISTORY.push(window.EKKO_UNGROUP_LAST_ROUTE);
  if (window.EKKO_UNGROUP_ROUTE_HISTORY.length > 50) window.EKKO_UNGROUP_ROUTE_HISTORY.shift();
  window.EKKO_DIAG?.logEvent?.("ungroup.route", {
    route, ownerCount: payload.ownerCount ?? null, itemCount: payload.itemCount ?? null
  });
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
    } catch (_) {}
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
      // Remove the nested container first, then place its public children at
      // exactly the nested container's world positions and order.
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

export function structuralUngroup(items) {
  const created = [];
  const roots = (Array.isArray(items) ? items : [items]).map(normalizeUngroupOwner).filter(Boolean);
  for (const root of roots) {
    if (!isStructuralContainer(root) || !root.parent) continue;
    const parent = root.parent;
    const index = typeof root.index === "number" ? root.index : parent.children.indexOf(root);
    root.remove();
    flattenStructuralGroup(root, parent, index, created);
  }
  return created.length ? created : roots.filter(Boolean);
}

export function decomposeVectorItems(items) {
  const created = [];
  for (const raw of (Array.isArray(items) ? items : [items])) {
    const owner = normalizeUngroupOwner(raw);
    if (!owner || isFusionOwner(owner)) continue;
    if (!isClosedVectorOwner(owner) && !isVectorSourceContainer(owner)) continue;
    const result = decomposeByContainmentHierarchy(owner, !!dataOf(raw).clipGroup);
    if (result?.items?.length) created.push(...result.items.map(normalizeUngroupOwner).filter(Boolean));
  }
  return created;
}

export const svgDecompose = decomposeVectorItems;

export function canDecomposeVector(item) {
  const owner = normalizeUngroupOwner(item);
  return !!owner && (isClosedVectorOwner(owner) || isVectorSourceContainer(owner));
}

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

function selectedVectorItems(items = null) {
  const selected = items == null ? selectedItems() : (Array.isArray(items) ? items : [items]);
  return selected.map(normalizeUngroupOwner).filter(owner => canDecomposeVector(owner));
}

export function dispatchVectorDecomposition(items = null) {
  const selected = selectedVectorItems(items);
  if (!selected.length) return null;
  emitRoute("vector-decompose", { itemCount: selected.length });
  window.saveHistory?.();
  const outputs = [];
  selected.forEach(owner => {
    const result = decomposeByContainmentHierarchy(owner, isInsideContainmentWrapper(owner));
    if (result?.items?.length) outputs.push(...result.items.map(normalizeUngroupOwner).filter(Boolean));
  });
  const owners = commitSelection(outputs);
  recalculateDynamicSubtractions?.();
  if (typeof paper !== "undefined") paper.view?.update?.();
  return owners.length ? owners : outputs;
}

function selectedItems() {
  if (Array.isArray(window.selectedItems) && window.selectedItems.length) return [...window.selectedItems].filter(Boolean);
  return window.selectedItem ? [window.selectedItem] : [];
}
function commitSelection(items) {
  const owners = Array.from(new Set((items || []).map(normalizeUngroupOwner).filter(Boolean)));
  if (!owners.length) return owners;
  window.deselectItem?.();
  if (typeof window.commitSelection === "function") {
    window.commitSelection(owners[owners.length - 1], owners);
  }
  owners.forEach(item => { try { item.selected = true; } catch (_) {} });
  window.updateSelectionBox?.(owners[owners.length - 1]);
  window.updateContextualMenu?.(owners[owners.length - 1]);
  return owners;
}

function releaseFusion(items) {
  const controller = window.EKKO_FUSION_CONTROLLER;
  if (typeof controller?.releaseFusion !== "function") return null;
  return controller.releaseFusion(items);
}

export function dispatchUngroup(items = null) {
  const selected = items == null ? selectedItems() : (Array.isArray(items) ? items : [items]);
  if (!selected.length) return null;
  const byRoute = new Map([
    [UNGROUP_ROUTE.FUSION, []],
    [UNGROUP_ROUTE.STRUCTURAL, []]
  ]);
  selected.forEach(item => {
    const route = getUngroupRoute(item);
    if (byRoute.has(route)) byRoute.get(route).push(item);
  });
  if (![...byRoute.values()].some(list => list.length)) return null;

  const outputs = [];
  const fusionItems = byRoute.get(UNGROUP_ROUTE.FUSION);
  if (fusionItems.length) {
    emitRoute(UNGROUP_ROUTE.FUSION, { itemCount: fusionItems.length });
    const result = releaseFusion(fusionItems.length === 1 ? fusionItems[0] : fusionItems);
    if (Array.isArray(result)) outputs.push(...result);
  }

  const structuralItems = byRoute.get(UNGROUP_ROUTE.STRUCTURAL);
  if (structuralItems.length) {
    // The two non-fusion operations form one history checkpoint even when a
    // multi-selection contains both imported SVGs and user-created groups.
    window.saveHistory?.();
    emitRoute(UNGROUP_ROUTE.STRUCTURAL, { itemCount: structuralItems.length });
    outputs.push(...structuralUngroup(structuralItems));
  }

  const owners = commitSelection(outputs);
  recalculateDynamicSubtractions?.();
  if (typeof paper !== "undefined") paper.view?.update?.();
  return owners.length ? owners : outputs;
}

if (typeof window !== "undefined") {
  window.EKKO_UNGROUP_ROUTES = {
    UNGROUP_ROUTE, getUngroupRoute, normalizeUngroupOwner,
    structuralUngroup, decomposeVectorItems, svgDecompose, canDecomposeVector,
    dispatchUngroup, dispatchVectorDecomposition
  };
  // Desagrupar and Descomponer vector are separate public commands.
  window.ungroupSelectedItem = dispatchUngroup;
  window.decomposeVectorSelectedItem = dispatchVectorDecomposition;
}
