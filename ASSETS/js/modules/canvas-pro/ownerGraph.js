/* EKKO Studio — Owner Graph / contrato único de ownership
 * Resuelve una sola cadena para cada interacción pública sin sustituir los
 * objetos Paper.js ni duplicar el estado de selección.
 */
import {
  getPublicOwner,
  getPublicOwners,
  isMockupOrMask,
  isContainmentWrapper
} from "./designGeometry.js";
import { semanticKind, getStackingUnit } from "./vectorSemantics.js";

function isUiOwner(item) {
  const data = item?.data || {};
  return !!(
    isMockupOrMask(item) ||
    isContainmentWrapper(item) ||
    data.isSelectionBox || data.isHandle || data.isNodeHandle ||
    data.isNodeEditOverlay || data.isSmartGuide || data.isMeasurement ||
    data.isTracePreview || item === window.currentMockup ||
    item === window.selectionBoxGroup || item === window.nodeHandlesGroup
  );
}

function isSemanticOwner(item) {
  const data = item?.data || {};
  return !!(
    data.geomBase || data.semanticKind === "solid" ||
    data.semanticKind === "hole" || data.isHole === true ||
    data.isSolidShape === true || data.isTextVector === true ||
    data.isSmartFusion === true
  );
}

function getRegularSelectionUnit(owner) {
  if (!owner) return null;
  if (owner.data?.isSmartFusion) return owner;
  let unit = owner;
  let current = owner.parent;
  let designLayer = null;
  try {
    designLayer = paper?.project?.layers?.find(layer => layer.name === "designLayer") || null;
  } catch (_) {}
  while (current && current !== designLayer && current !== paper?.project) {
    if (isContainmentWrapper(current) || isUiOwner(current)) break;
    if (current.className === "Group" || current.constructor?.name === "Group") unit = current;
    current = current.parent;
  }
  return unit;
}

function resolveTransformOwner(owner) {
  try {
    const resolver = window.EKKO_FUSION_CONTROLLER?.resolvePublicTransformOwner;
    return typeof resolver === "function" ? (resolver(owner) || owner) : owner;
  } catch (_) { return owner; }
}

function resolveFusionOwner(owner) {
  if (!owner) return null;
  if (owner.data?.isSmartFusion) return owner;
  try {
    return typeof window.findSmartFusionContainer === "function"
      ? (window.findSmartFusionContainer(owner) || null)
      : null;
  } catch (_) { return null; }
}

function identityOf(owner) {
  const data = owner?.data || {};
  return {
    id: owner?.id ?? null,
    semanticId: data.semanticId ?? null,
    ownerId: data.ownerId ?? null,
    fusionId: data.fusionId ?? owner?.fusionId ?? null,
    sourceContourIndex: data.sourceContourIndex ?? null,
    className: owner?.className || owner?.constructor?.name || null
  };
}

/** Canonical public-owner normalization shared by command routes and diagnostics. */
function normalizePublicOwner(rawItem) {
  const owner = getPublicOwner(rawItem);
  if (!owner || isUiOwner(owner) || isMockupOrMask(owner) || isContainmentWrapper(owner)) return null;
  return owner;
}

function resolveOwnerChain(rawItem) {
  const publicOwner = normalizePublicOwner(rawItem);
  if (!publicOwner || isUiOwner(publicOwner)) return null;
  const selectionUnit = getRegularSelectionUnit(publicOwner) || publicOwner;
  const transformOwner = resolveTransformOwner(publicOwner);
  const stackingUnit = getStackingUnit(publicOwner) || publicOwner;
  const fusionOwner = resolveFusionOwner(publicOwner);
  const data = publicOwner.data || {};
  return {
    rawItem,
    publicOwner,
    selectionUnit,
    transformOwner,
    stackingUnit,
    fusionOwner,
    semanticKind: semanticKind(publicOwner) || null,
    geomBase: data.geomBase || null,
    identity: identityOf(publicOwner),
    data: {
      isHole: data.isHole === true,
      hasGeomBase: !!data.geomBase,
      source: data.source ?? null,
      contourRole: data.contourRole ?? null,
      isSmartFusion: data.isSmartFusion === true
    }
  };
}

function collectOwners(root) {
  return getPublicOwners(root).filter(owner => owner && !isUiOwner(owner));
}

function resolvePoint(point, resolver) {
  const raw = typeof resolver === "function" ? resolver(point) : null;
  const chain = resolveOwnerChain(raw);
  return { rawItem: raw, chain };
}

const api = {
  resolveOwnerChain,
  normalizePublicOwner,
  collectOwners,
  resolvePoint,
  isSemanticOwner,
  identityOf
};

if (typeof window !== "undefined") window.EKKO_OWNER_GRAPH = api;
export { resolveOwnerChain, normalizePublicOwner, collectOwners, resolvePoint, isSemanticOwner, identityOf };
export default api;
