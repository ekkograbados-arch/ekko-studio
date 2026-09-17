import { v4 as uuidv4 } from "https://cdn.skypack.dev/uuid@9.0.0";

// Almacén central de fusiones
const _fusionRegistry = new Map();

// ===== Clasificación de elementos =====
export function isProductElement(item) {
  if (!item?.data) return false;
  const d = item.data;
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
  const d = item.data;
  return !!(
    d.isFusionReceptor ||
    d.isHole === true ||
    d.hasInternalHoles === true
  );
}

export function isFusionItem(item) {
  return !!(item?.data?.isSmartFusion || item?.data?.fusionId);
}

// ===== Búsqueda de elementos dentro de fusión =====
export function findFusionRaster(fusionGroup) {
  if (!fusionGroup) return null;
  return fusionGroup.children?.find(c => 
    c.name === "fusion-image" || 
    c.className === "Raster" ||
    c instanceof paper.Raster
  ) || null;
}

export function findFusionVector(fusionGroup) {
  if (!fusionGroup) return null;
  const { maskGroup, originalVector } = fusionGroup.data || {};
  return maskGroup?.children?.[0] || originalVector || null;
}

// ===== Estampa semántica =====
export function stampDesignItem(item, meta = {}) {
  if (!item) return item;
  if (!item.data) item.data = {};
  const d = item.data;

  if (!d.containmentScope) d.containmentScope = uuidv4();
  if (!d.containmentKey) d.containmentKey = uuidv4();
  if (!d.ownerContainmentKey) d.ownerContainmentKey = d.containmentScope;
  if (!d.geomBase && item.pathData) d.geomBase = item.clone();

  d.source = meta.source || d.source || "unknown";
  d.role = meta.role || d.role || "surface";
  d.isFusionReceptor = meta.isFusionReceptor ?? d.isFusionReceptor ?? true;
  d.hasInternalHoles = meta.hasInternalHoles ?? d.hasInternalHoles ?? false;
  d.userImported = true;

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

export function registerFusionRecord(record) {
  if (!record?.fusionId) return null;
  _fusionRegistry.set(record.fusionId, record);
  return record;
}

export function updateFusionRecord(fusionId, updates) {
  const existing = _fusionRegistry.get(fusionId);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  _fusionRegistry.set(fusionId, updated);
  return updated;
}

export function unregisterFusion(fusionId) {
  return _fusionRegistry.delete(fusionId);
}

export function createFusionRecord(raster, receptor, mode) {
  return {
    fusionId: uuidv4(),
    mode,
    rasterId: raster.id,
    receptorId: receptor.id,
    receptorContainmentKey: receptor.data?.containmentKey,
    receptorScope: receptor.data?.containmentScope,
    timestamp: Date.now()
  };
}

// ===== Huecos virtuales =====
const _virtualHoles = new Map();

export function registerVirtualHole(geom, fusionId) {
  _virtualHoles.set(fusionId, { geom, fusionId, updatedAt: Date.now() });
}

export function updateVirtualHole(fusionId, newGeom) {
  if (!_virtualHoles.has(fusionId)) return false;
  _virtualHoles.set(fusionId, { geom: newGeom, fusionId, updatedAt: Date.now() });
  return true;
}

export function unregisterVirtualHole(fusionId) {
  return _virtualHoles.delete(fusionId);
}

export function getAllVirtualHoles() {
  return Array.from(_virtualHoles.values());
}

// ===== Validación =====
export function canFuse(raster, receptor) {
  if (!raster || !receptor) return { ok: false, reason: "missing-elements" };
  if (isProductElement(receptor)) return { ok: false, reason: "product-element" };
  if (!isValidFusionReceptor(receptor)) return { ok: false, reason: "not-a-receptor" };
  return { ok: true };
}

// ===== Calado =====
export function canConvertToCalado(item) {
  if (!item) return false;
  if (isProductElement(item)) return false;
  const d = item.data;
  return !!(
    d.isHole === true ||
    d.hasInternalHoles === true ||
    d.isFusionReceptor === true
  );
}
