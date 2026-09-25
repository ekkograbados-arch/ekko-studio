/*
 * EKKO Studio — canonical client-SVG source semantics.
 *
 * SVG fill semantics are captured before clipping or geometric ungrouping.
 * The importer may expose one CompoundPath for a path element containing many
 * closed subpaths, so metadata is assigned to Paper.js leaf paths in source
 * order.  This module intentionally does not decide topology from depth;
 * geometricUngroup.js applies the captured fill rule and winding later.
 */

import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";

const DEFAULT_FILL_RULE = "nonzero";

function normalizeFillRule(value) {
  const rule = String(value || "").trim().toLowerCase();
  return rule === "evenodd" || rule === "even-odd" ? "evenodd" : DEFAULT_FILL_RULE;
}

function presentationValue(node, name) {
  if (!node) return { value: null, explicit: false };
  const attr = node.getAttribute?.(name);
  if (attr != null && String(attr).trim() !== "") {
    return { value: String(attr).trim(), explicit: true };
  }
  const style = node.getAttribute?.("style") || "";
  const match = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i"));
  if (match) return { value: match[1].trim(), explicit: true };
  const parent = node.parentElement;
  if (parent) return presentationValue(parent, name);
  return { value: null, explicit: false };
}

function metadataValue(node, names) {
  for (const name of names) {
    const value = node?.getAttribute?.(name);
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return null;
}

function parseBoolean(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function countSubpaths(d) {
  if (!d) return 1;
  // SVG path subpaths begin with M/m.  A path with malformed/no M still
  // receives one record so Paper.js and source indices remain aligned.
  const count = (String(d).match(/[Mm]/g) || []).length;
  return Math.max(1, count);
}

function paintValue(node, name) {
  const info = presentationValue(node, name);
  const value = String(info.value || "").trim().toLowerCase();
  return { value: value || null, explicit: info.explicit, none: value === "none" };
}

function sourceRecords(svgText) {
  if (typeof DOMParser === "undefined") return { fillRule: DEFAULT_FILL_RULE, explicit: false, records: [] };
  let doc;
  try { doc = new DOMParser().parseFromString(svgText, "image/svg+xml"); }
  catch (_) { return { fillRule: DEFAULT_FILL_RULE, explicit: false, records: [] }; }
  const rootRule = presentationValue(doc.documentElement, "fill-rule");
  const root = normalizeFillRule(rootRule.value);
  const records = [];
  let index = 0;

  // Paper.importSVG can materialize rect/circle/line/polyline/polygon as
  // Path items too. Capturing only <path> made those elements lose their
  // source fill/stroke intent and could turn fill="none" into a filled solid.
  const geometrySelector = "path,rect,circle,ellipse,line,polyline,polygon";
  doc.querySelectorAll(geometrySelector).forEach(node => {
    // Definitions are not rendered by Paper and must not consume a source
    // contour index. `<use>` instances are expanded by Paper later.
    if (node.closest?.("defs,clipPath,mask")) return;
    const ruleInfo = presentationValue(node, "fill-rule");
    const fillRule = normalizeFillRule(ruleInfo.value || root);
    const explicitRule = ruleInfo.explicit || rootRule.explicit;
    const explicitHole = parseBoolean(metadataValue(node, ["data-original-is-hole", "data-is-hole", "data-hole"]));
    const explicitRole = metadataValue(node, ["data-contour-role", "data-role"]);
    const sourceId = node.getAttribute?.("id") || null;
    const fill = paintValue(node, "fill");
    const stroke = paintValue(node, "stroke");
    const count = node.tagName?.toLowerCase() === "path"
      ? countSubpaths(node.getAttribute?.("d"))
      : 1;
    for (let offset = 0; offset < count; offset++) {
      records.push({
        sourceContourIndex: index++,
        originalFillRule: fillRule,
        sourceFillRuleExplicit: !!explicitRule,
        originalIsHole: explicitHole,
        contourRole: explicitRole === "hole" || explicitRole === "outer" ? explicitRole : null,
        sourceElementId: sourceId,
        sourceElementType: node.tagName?.toLowerCase() || null,
        sourceSubpathIndex: offset,
        sourceFill: fill.value,
        sourceStroke: stroke.value,
        sourceFillExplicit: fill.explicit,
        sourceStrokeExplicit: stroke.explicit,
        sourceFillNone: fill.none,
        sourceStrokeNone: stroke.none,
        sourcePaintMode: fill.none && !stroke.none ? "stroke-only" :
          (!fill.none && stroke.none ? "fill" : "fill-and-stroke")
      });
    }
  });
  return { fillRule: root, explicit: rootRule.explicit, records };
}

function isCompound(item) {
  return !!item && (item.className === "CompoundPath" ||
    (typeof paper !== "undefined" && paper.CompoundPath && item instanceof paper.CompoundPath));
}
function isPath(item) {
  return !!item && (item.className === "Path" ||
    (typeof paper !== "undefined" && paper.Path && item instanceof paper.Path));
}

function collectLeafPaths(item, result = []) {
  if (!item) return result;
  if (isCompound(item)) {
    (item.children || []).forEach(child => collectLeafPaths(child, result));
    return result;
  }
  if (isPath(item)) {
    result.push(item);
    return result;
  }
  (item.children || []).forEach(child => collectLeafPaths(child, result));
  return result;
}

function collectCompoundPaths(item, result = [], seen = new Set()) {
  if (!item || seen.has(item)) return result;
  seen.add(item);
  if (isCompound(item)) result.push(item);
  (item.children || []).forEach(child => collectCompoundPaths(child, result, seen));
  return result;
}

function applySourceData(item, data) {
  if (!item) return;
  item.data = { ...(item.data || {}), ...data };
}

/**
 * Stamps the imported Paper.js tree before clipping/geometricUngroup.
 * Returns a compact audit object for runtime diagnostics and tests.
 */
export function stampClientSvgSourceSemantics(item, svgText) {
  if (!item) return { contourCount: 0, sourceFillRule: DEFAULT_FILL_RULE };
  const parsed = sourceRecords(svgText);
  const rootData = {
    source: "client-svg",
    userImported: true,
    originalFillRule: parsed.fillRule,
    sourceFillRuleExplicit: parsed.explicit,
    originalSource: "svg"
  };
  applySourceData(item, rootData);

  const leaves = collectLeafPaths(item);
  leaves.forEach((leaf, leafIndex) => {
    const record = parsed.records[leafIndex] || {
      sourceContourIndex: leafIndex,
      originalFillRule: parsed.fillRule,
      sourceFillRuleExplicit: parsed.explicit,
      originalIsHole: null,
      contourRole: null,
      sourceElementId: null,
      sourceElementType: null,
      sourceSubpathIndex: 0,
      sourceFill: null,
      sourceStroke: null,
      sourceFillExplicit: false,
      sourceStrokeExplicit: false,
      sourceFillNone: false,
      sourceStrokeNone: false,
      sourcePaintMode: "fill"
    };
    const explicitIsHole = typeof record.originalIsHole === "boolean" ? record.originalIsHole : undefined;
    const explicitRole = record.contourRole || undefined;
    applySourceData(leaf, {
      ...rootData,
      ...record,
      sourceContourIndex: record.sourceContourIndex ?? leafIndex,
      ...(explicitIsHole === undefined ? {} : { originalIsHole: explicitIsHole }),
      ...(explicitRole ? { contourRole: explicitRole } : {})
    });
    if (explicitIsHole !== undefined) {
      setSemanticKind(leaf, explicitIsHole ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID);
    } else if (explicitRole === "hole" || explicitRole === "outer") {
      setSemanticKind(leaf, explicitRole === "hole" ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID);
    }
  });

  // CompoundPath containers are the actual public owners when Paper expands
  // a single SVG `d` attribute into several contour children. Mark the
  // container once; marking every child as an independent solid would destroy
  // the relationship between an outer contour and its real holes.
  const compoundPaths = collectCompoundPaths(item);
  compoundPaths.forEach(compound => {
    const data = compound.data || {};
    const explicitHole = typeof data.originalIsHole === "boolean"
      ? data.originalIsHole
      : (data.contourRole === "hole" ? true : data.contourRole === "outer" ? false : null);
    const strokeOnly = data.sourcePaintMode === "stroke-only" || data.sourceFillNone === true;
    if (!strokeOnly && explicitHole !== true) {
      setSemanticKind(compound, VECTOR_KIND.SOLID);
      compound.data = {
        ...(compound.data || {}),
        isFusionReceptor: true,
        isSolidShape: true,
        hasInternalHoles: (compound.children || []).length > 1
      };
    } else if (explicitHole === true) {
      setSemanticKind(compound, VECTOR_KIND.HOLE);
      compound.data = { ...(compound.data || {}), isFusionReceptor: true, hasInternalHoles: true };
    } else {
      compound.data = { ...(compound.data || {}), isCutLine: true, isSolidShape: false, isFusionReceptor: false };
    }
  });

  // A single imported vector is already a real vector owner even before the
  // client presses Descomponer. This is what makes a one-path SVG usable as
  // a solid immediately while preserving all of its internal contours in the
  // canonical CompoundPath/fillRule. Multi-path groups remain structural
  // containers until decomposition assigns topology owner by owner.
  if (leaves.length === 1 || isCompound(item)) {
    const onlyLeaf = leaves[0];
    const sourceData = item.data || {};
    const explicitHole = typeof sourceData.originalIsHole === "boolean"
      ? sourceData.originalIsHole
      : (sourceData.contourRole === "hole" ? true : sourceData.contourRole === "outer" ? false : null);
    const openOrStrokeOnly = onlyLeaf && (onlyLeaf.closed !== true ||
      onlyLeaf.data?.sourcePaintMode === "stroke-only" || onlyLeaf.data?.sourceFillNone === true);
    if (!openOrStrokeOnly && explicitHole !== true) {
      setSemanticKind(item, VECTOR_KIND.SOLID);
      if (leaves.length === 1 && onlyLeaf) setSemanticKind(onlyLeaf, VECTOR_KIND.SOLID);
      item.data = {
        ...(item.data || {}),
        isFusionReceptor: true,
        isSolidShape: true,
        hasInternalHoles: leaves.length > 1 || parsed.records.some(record => record.originalIsHole === true)
      };
    } else if (openOrStrokeOnly) {
      item.data = { ...(item.data || {}), isCutLine: true, isFusionReceptor: false, isSolidShape: false };
      if (leaves.length === 1 && onlyLeaf) onlyLeaf.data = { ...(onlyLeaf.data || {}), isCutLine: true };
    } else {
      setSemanticKind(item, VECTOR_KIND.HOLE);
      if (leaves.length === 1 && onlyLeaf) setSemanticKind(onlyLeaf, VECTOR_KIND.HOLE);
      item.data = { ...(item.data || {}), isFusionReceptor: true, hasInternalHoles: true };
    }
  }

  return {
    contourCount: leaves.length,
    sourceRecordCount: parsed.records.length,
    sourceFillRule: parsed.fillRule,
    sourceFillRuleExplicit: parsed.explicit,
    strokeOnlyRecords: parsed.records.filter(record => record.sourcePaintMode === "stroke-only").length,
    fillNoneRecords: parsed.records.filter(record => record.sourceFillNone).length
  };
}

export function normalizeSourceFillRule(value) {
  return normalizeFillRule(value);
}

if (typeof window !== "undefined") {
  window.stampClientSvgSourceSemantics = stampClientSvgSourceSemantics;
}
