import { v4 as uuidv4 } from "https://cdn.skypack.dev/uuid@9.0.0";
import { getPublicOwner, getPublicOwners } from "./designGeometry.js";
import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";

// Almacén central de fusiones
const _fusionRegistry = new Map();

// ===== Clasificación de elementos =====
export function isProductElement(item) {
  if (!item) return false;
  const d = item.data || {};
  if (item.locked === true || d.locked === true) return true;
  return !!(
    d.productTemplate ||
    d.systemGenerated ||
    d.source === "product-catalog" ||
    d.isMockup ||
    d.isMask ||
    d.wasClipMask ||
    d.clipGroup
  );
}

export function isClientDesignElement(item) {
  if (!item?.data) return false;
  const d = item.data;
  return !isProductElement(item) && !!(
    d.userImported ||
    d.source === "client-svg" ||
    d.source === "text-vector" ||
    d.source === "traced" ||
    d.source === "calado"
  );
}

export function isValidFusionReceptor(item) {
  if (!item) return false;
  if (isProductElement(item)) return false;
  const d = item.data || {};
  if (d.isFusionMask === true || d.isSmartFusion === true) return false;
  return !!(
    d.isFusionReceptor ||
    d.isHole === true ||
    d.hasInternalHoles === true
  );
}

export function isFusionItem(item) {
  return !!(item?.data?.isSmartFusion || item?.data?.fusionId);
}

export function isClosedClientVector(item) {
  if (!item) return false;
  if (isProductElement(item)) return false;
  if (item.closed !== true) return false;
  const d = item.data;
  return !!(
    d.source === "client-svg" ||
    d.source === "text-vector" ||
    d.source === "traced" ||
    d.isFusionReceptor
  );
}

// ===== Búsqueda de elementos =====
export function getContentItem(item) {
  if (!item) return null;
  // Public-owner resolution is centralized in designGeometry. Never infer
  // ownership from child order: clip masks, fusion children and wrappers can
  // all occupy different positions after import or undo/redo.
  const owner = getPublicOwner(item);
  if (owner) return owner;
  return item.data?.clipGroup ? null : item;
}

function isRasterItem(item) {
  return !!item && (item.className === "Raster" ||
    (typeof paper !== "undefined" && paper.Raster && item instanceof paper.Raster));
}

function isVectorItem(item) {
  return !!item && ["Path", "CompoundPath", "Shape"].includes(item.className);
}

export function findFusionRaster(item) {
  if (!item) return null;
  const directOwner = getPublicOwner(item) || item;
  if (isRasterItem(directOwner)) return directOwner;

  // A selected imported SVG can be a structural Group whose public vector
  // owner is one of its descendants. Resolve that owner for the raster
  // lookup as well, but never treat a product/mockup as an operand.
  const directFusion = directOwner?.data?.isSmartFusion ? directOwner :
    (item?.data?.isSmartFusion ? item : null);
  if (directFusion) {
    return Array.from(directFusion.children || []).find(child =>
      child?.name === "fusion-image" || isRasterItem(child)
    ) || null;
  }
  const candidates = getPublicOwners([item]);
  for (const candidate of candidates) {
    if (!candidate || isProductElement(candidate)) continue;
    if (isRasterItem(candidate)) return candidate;
    if (candidate.data?.isSmartFusion) {
      const nested = Array.from(candidate.children || []).find(child =>
        child?.name === "fusion-image" || isRasterItem(child));
      if (nested) return nested;
    }
  }
  return null;
}

export function findFusionVector(item) {
  if (!item) return null;
  const directOwner = getPublicOwner(item) || item;
  if (isVectorItem(directOwner) && !directOwner.clipMask && !directOwner.data?.isFusionMask) return directOwner;

  const directFusion = directOwner?.data?.isSmartFusion ? directOwner :
    (item?.data?.isSmartFusion ? item : null);
  if (directFusion) {
    const { maskGroup, originalVector } = directFusion.data || {};
    const markedMask = maskGroup?.children?.find(child =>
      child?.clipMask || child?.data?.isFusionMask || child?.data?.publicOwner === true
    ) || null;
    return originalVector || markedMask ||
      Array.from(directFusion.children || []).find(child =>
        child?.clipMask || child?.data?.isFusionMask
      ) || null;
  }

  // Resolve a vector inside a selected structural SVG group. Only public
  // vector owners are accepted; product paths and mask children are excluded.
  const candidates = getPublicOwners([item]);
  for (const candidate of candidates) {
    if (!candidate || isProductElement(candidate) || candidate.clipMask || candidate.data?.isFusionMask) continue;
    if (isVectorItem(candidate)) return candidate;
    if (candidate.data?.isSmartFusion) {
      const mask = candidate.data?.originalVectorData ||
        Array.from(candidate.children || []).find(child => child?.clipMask || child?.data?.isFusionMask);
      if (mask) return mask;
    }
  }
  return null;
}

// ===== Operación de fusión =====
// Canonical order: receptor, raster, mode, options.
// The legacy raster,receptor,options shape remains accepted for compatibility.
export function applySmartFusion(first, second, third = "intersecar", fourth = {}) {
  let receptor = first;
  let raster = second;
  let mode = typeof third === "string" ? third : (third?.mode || "intersecar");
  let options = typeof third === "object" && third !== null ? third : (fourth || {});

  if (isRasterItem(first) && !isRasterItem(second)) {
    raster = first;
    receptor = second;
  }

  return import("./smartFusion.js").then(mod =>
    mod.applySmartFusion(receptor, raster, mode, options)
  );
}

// ===== Estampa semántica =====
export function stampDesignItem(item, meta = {}) {
  if (!item) return item;
  if (!item.data) item.data = {};
  const d = item.data;

  if (!d.containmentScope) d.containmentScope = uuidv4();
  if (!d.containmentKey) d.containmentKey = uuidv4();
  if (!d.ownerContainmentKey) d.ownerContainmentKey = d.containmentScope;
  if (!d.geomBase && item.pathData) {
    const base = item.clone({ insert: false });
    base.applyMatrix = false;
    base.matrix = new paper.Matrix();
    d.geomBase = base;
  }

  d.source = meta.source || d.source || "unknown";
  d.role = meta.role || d.role || "surface";
  d.isTextVector = meta.isTextVector ?? d.isTextVector ?? false;
  d.isFusionReceptor = meta.isFusionReceptor ?? d.isFusionReceptor ?? true;
  d.hasInternalHoles = meta.hasInternalHoles ?? d.hasInternalHoles ?? false;
  const kind = meta.semanticKind || (meta.isHole === true ? VECTOR_KIND.HOLE :
    meta.isSolidShape === true ? VECTOR_KIND.SOLID : d.semanticKind);
  if (kind) setSemanticKind(item, kind);
  item.data.userImported = true;

  return item;
}

// ===== Geometría =====
export function cloneAbsolute(item) {
  if (!item) return null;
  const clone = item.clone({ insert: false });
  clone.applyMatrix = true;
  clone.matrix = item.globalMatrix;
  return clone;
}

export function getCurrentFusionMask(fusionGroup) {
  if (!fusionGroup?.data) return null;
  const mask = findFusionVector(fusionGroup);
  if (!mask) return null;
  try {
    return cloneAbsolute(mask);
  } catch (e) {
    return null;
  }
}

export function calculateFusionPlacement(image, receptor, mode = "cover") {
  const rBounds = receptor.bounds;
  const iBounds = image.bounds;
  const scaleX = rBounds.width / iBounds.width;
  const scaleY = rBounds.height / iBounds.height;
  const scale = mode === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  return {
    scale,
    center: rBounds.center,
    finalBounds: {
      x: rBounds.center.x - (iBounds.width * scale) / 2,
      y: rBounds.center.y - (iBounds.height * scale) / 2,
      width: iBounds.width * scale,
      height: iBounds.height * scale
    }
  };
}

export function calculateCoverPlacement(image, receptor) {
  return calculateFusionPlacement(image, receptor, "cover");
}

// ===== Registro de fusiones =====
export function getFusionById(fusionId) {
  return _fusionRegistry.get(fusionId) || null;
}

export function getAllFusions() {
  return Array.from(_fusionRegistry.values());
}

function syncPublicFusionRegistry() {
  if (typeof window !== "undefined") window._fusionRecords = getAllFusions();
}

export function registerFusionRecord(record) {
  if (!record?.fusionId) return null;
  _fusionRegistry.set(record.fusionId, record);
  syncPublicFusionRegistry();
  return record;
}

export function updateFusionRecord(fusionOrId, updates = {}) {
  const fusionId = typeof fusionOrId === "string"
    ? fusionOrId
    : (fusionOrId?.data?.fusionId || fusionOrId?.fusionId || updates.fusionId);
  if (!fusionId) return null;
  const existing = _fusionRegistry.get(fusionId);
  if (!existing) {
    if (typeof fusionOrId === "object") {
      return registerFusionRecord(createFusionRecord(fusionOrId, { ...updates, fusionId }));
    }
    return null;
  }
  const group = typeof fusionOrId === "object" && fusionOrId?.data?.isSmartFusion
    ? fusionOrId : existing.group;
  const updated = {
    ...existing,
    ...updates,
    fusionId,
    group: group || existing.group,
    updatedAt: Date.now()
  };
  _fusionRegistry.set(fusionId, updated);
  syncPublicFusionRegistry();
  return updated;
}

export function unregisterFusion(fusionId) {
  const removed = _fusionRegistry.delete(fusionId);
  syncPublicFusionRegistry();
  return removed;
}

export function clearFusionRegistry() {
  _fusionRegistry.clear();
  syncPublicFusionRegistry();
}

/* Canonical signature: createFusionRecord(fusionGroup, overrides).
 * The legacy raster/receptor/mode signature remains accepted so old callers
 * cannot silently create records with the wrong identity. */
export function createFusionRecord(first, second = {}, third = null) {
  const isGroup = !!(first?.data?.isSmartFusion);
  const group = isGroup ? first : null;
  const overrides = isGroup ? (second || {}) : {};
  const raster = isGroup ? findFusionRaster(group) : first;
  const receptor = isGroup ? findFusionVector(group) : second;
  const mode = isGroup
    ? (overrides.mode || group.data?.fusionMode || "intersecar")
    : third;
  const data = group?.data || {};
  const fusionId = overrides.fusionId || data.fusionId || uuidv4();
  const record = {
    fusionId,
    group,
    mode,
    originalIsHole: overrides.originalIsHole ?? data.originalIsHole === true,
    semanticKind: overrides.semanticKind || data.semanticKind ||
      (data.semanticKind === VECTOR_KIND.HOLE || data.originalIsHole === true ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID),
    receiverKind: overrides.receiverKind || data.receiverKind ||
      (data.semanticKind === VECTOR_KIND.HOLE || data.originalIsHole === true ? "hole" : "solid"),
    rasterId: overrides.rasterId ?? raster?.id ?? data.rasterId ?? null,
    receptorId: overrides.receptorId ?? receptor?.id ?? data.vectorId ?? null,
    containmentKey: overrides.containmentKey ?? data.containmentKey ?? receptor?.data?.containmentKey ?? null,
    ownerContainmentKey: overrides.ownerContainmentKey ?? data.ownerContainmentKey ?? receptor?.data?.ownerContainmentKey ?? null,
    containmentScope: overrides.containmentScope ?? data.containmentScope ?? receptor?.data?.containmentScope ?? null,
    originalVectorData: data.originalVectorData || null,
    originalRasterData: data.originalRasterData || null,
    timestamp: Date.now(),
    ...overrides,
    fusionId
  };
  return registerFusionRecord(record);
}

// ===== Huecos virtuales =====
const _virtualHoles = new Map();

export function registerVirtualHole(first, second, group = null) {
  const fusionId = typeof first === "string" ? first : second;
  const geom = typeof first === "string" ? second : first;
  if (!fusionId || !geom) return null;
  const storedGeom = geom.clone?.({ insert: false }) || geom;
  const data = group?.data || {};
  const entry = {
    geom: storedGeom,
    fusionId,
    group,
    ownerContainmentKey: data.ownerContainmentKey || null,
    containmentKey: data.containmentKey || null,
    containmentScope: data.containmentScope || null,
    semanticKind: data.semanticKind || (data.originalIsHole === true ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID),
    originalIsHole: data.originalIsHole === true,
    updatedAt: Date.now()
  };
  _virtualHoles.set(fusionId, entry);
  if (typeof window !== "undefined") window._fusionVirtualHoles = getAllVirtualHoles();
  return entry;
}

export function updateVirtualHole(fusionId, newGeom, group = null) {
  if (!fusionId || !newGeom) return false;
  const previous = _virtualHoles.get(fusionId);
  const storedGeom = newGeom.clone?.({ insert: false }) || newGeom;
  if (previous?.geom && previous.geom !== newGeom) {
    try { previous.geom.remove?.(); } catch (e) {}
  }
  const currentGroup = group || previous?.group || null;
  const data = currentGroup?.data || {};
  _virtualHoles.set(fusionId, {
    ...(previous || {}),
    geom: storedGeom,
    group: currentGroup,
    fusionId,
    ownerContainmentKey: data.ownerContainmentKey || previous?.ownerContainmentKey || null,
    containmentKey: data.containmentKey || previous?.containmentKey || null,
    containmentScope: data.containmentScope || previous?.containmentScope || null,
    semanticKind: data.semanticKind || previous?.semanticKind || (data.originalIsHole === true ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID),
    originalIsHole: data.originalIsHole === true || previous?.originalIsHole === true,
    updatedAt: Date.now()
  });
  if (typeof window !== "undefined") window._fusionVirtualHoles = getAllVirtualHoles();
  return true;
}

export function unregisterVirtualHole(fusionId) {
  const removed = _virtualHoles.delete(fusionId);
  if (typeof window !== "undefined") window._fusionVirtualHoles = getAllVirtualHoles();
  return removed;
}

export function getAllVirtualHoles() {
  return Array.from(_virtualHoles.values());
}

export function clearVirtualHoles() {
  _virtualHoles.clear();
  if (typeof window !== "undefined") window._fusionVirtualHoles = [];
}

export function getVirtualHoleEntries() {
  return getAllVirtualHoles();
}

// ===== Validación =====
export function canFuse(raster, receptor) {
  if (!raster || !receptor) return { ok: false, reason: "missing-elements" };
  const resolvedRaster = findFusionRaster(raster) || raster;
  const resolvedReceptor = findFusionVector(receptor) || receptor;
  if (!isRasterItem(resolvedRaster)) return { ok: false, reason: "not-a-raster" };
  if (isProductElement(resolvedRaster) || isProductElement(resolvedReceptor)) return { ok: false, reason: "product-element" };
  if (!isValidFusionReceptor(resolvedReceptor)) return { ok: false, reason: "not-a-receptor" };
  return { ok: true };
}

// ===== Calado =====
export function canConvertToCalado(item) {
  if (!item || isProductElement(item)) return false;
  const d = item.data || {};

  // Original/source-derived holes are already physical cutters.  Calado must
  // never mutate their identity into a synthetic calado or alpha-zero path.
  if (d.originalIsHole === true || d.contourRole === "hole" || d.isHole === true) return false;
  if (d.isCalado === true) return false;

  // A fusion is eligible only when it is a genuine solid fusion.  Being a
  // receptor alone is not evidence that a solid can be converted.
  if (d.isSmartFusion || d.fusionId) {
    return d.originalIsHole !== true && d.receiverKind !== "hole" &&
      d.isHole !== true && (d.fusionMode !== "calar" || d.isSolidShape === true || d.originalIsHole === false);
  }

  // Decomposed/imported vectors carry isSolidShape.  The source/type fallback
  // covers a closed client vector that has not yet been decomposed, but never
  // relies on isFusionReceptor by itself.
  const isClientVector = d.userImported === true &&
    ["client-svg", "text-vector", "traced", "calado"].includes(d.source);
  return d.isSolidShape === true ||
    (isClientVector && d.originalIsHole !== true && d.contourRole !== "hole" &&
      d.hasInternalHoles !== false);
}

// La API pública de fusión se expone desde smartFusion.js; no se instala un
// segundo registro global de helpers de diagnóstico en el runtime normal.
