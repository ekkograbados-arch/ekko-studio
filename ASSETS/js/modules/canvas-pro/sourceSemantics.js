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

function sourceRecords(svgText) {
  if (typeof DOMParser === "undefined") return { fillRule: DEFAULT_FILL_RULE, explicit: false, records: [] };
  let doc;
  try { doc = new DOMParser().parseFromString(svgText, "image/svg+xml"); }
  catch (_) { return { fillRule: DEFAULT_FILL_RULE, explicit: false, records: [] }; }
  const rootRule = presentationValue(doc.documentElement, "fill-rule");
  const root = normalizeFillRule(rootRule.value);
  const records = [];
  let index = 0;
  doc.querySelectorAll("path").forEach(pathNode => {
    const ruleInfo = presentationValue(pathNode, "fill-rule");
    const fillRule = normalizeFillRule(ruleInfo.value || root);
    const explicitRule = ruleInfo.explicit || rootRule.explicit;
    const explicitHole = parseBoolean(metadataValue(pathNode, ["data-original-is-hole", "data-is-hole", "data-hole"]));
    const explicitRole = metadataValue(pathNode, ["data-contour-role", "data-role"]);
    const sourceId = pathNode.getAttribute?.("id") || null;
    const count = countSubpaths(pathNode.getAttribute?.("d"));
    for (let offset = 0; offset < count; offset++) {
      records.push({
        sourceContourIndex: index++,
        originalFillRule: fillRule,
        sourceFillRuleExplicit: !!explicitRule,
        originalIsHole: explicitHole,
        contourRole: explicitRole === "hole" || explicitRole === "outer" ? explicitRole : null,
        sourceElementId: sourceId
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
      sourceElementId: null
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

  return {
    contourCount: leaves.length,
    sourceRecordCount: parsed.records.length,
    sourceFillRule: parsed.fillRule,
    sourceFillRuleExplicit: parsed.explicit
  };
}

export function normalizeSourceFillRule(value) {
  return normalizeFillRule(value);
}

if (typeof window !== "undefined") {
  window.stampClientSvgSourceSemantics = stampClientSvgSourceSemantics;
}
