import { v4 as uuidv4 } from "https://cdn.skypack.dev/uuid@9.0.0";

// Única fuente de verdad: clasificación de elementos
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

// Estampa semántica completa — TODO objeto nuevo la recibe
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

// Geometría virtual sincronizada
export function getCurrentFusionMask(fusionGroup) {
  if (!fusionGroup?.data) return null;
  const { maskGroup, originalVector } = fusionGroup.data;
  let mask = maskGroup?.children?.[0] || originalVector;
  if (!mask) return null;
  try {
    return mask.clone();
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

export function canFuse(raster, receptor) {
  if (!raster || !receptor) return { ok: false, reason: "missing-elements" };
  if (isProductElement(receptor)) return { ok: false, reason: "product-element" };
  if (!isValidFusionReceptor(receptor)) return { ok: false, reason: "not-a-receptor" };
  return { ok: true };
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
