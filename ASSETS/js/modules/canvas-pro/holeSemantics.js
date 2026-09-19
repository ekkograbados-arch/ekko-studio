/*
 * EKKO Studio — canonical contour / real-hole semantics.
 *
 * A contour's identity (solid vs real hole) is independent from its current
 * render order. Render order is consumed later by CSG to decide which solids
 * the hole cuts. This module is deliberately Paper.js-light and is shared by
 * SVG import, font-to-path, geometric ungroup and diagnostics.
 */

export const DEFAULT_FILL_RULE = "nonzero";

export function normalizeFillRule(value) {
  const rule = String(value || "").trim().toLowerCase();
  return rule === "evenodd" || rule === "even-odd" ? "evenodd" : DEFAULT_FILL_RULE;
}

export function explicitHoleOf(item) {
  const data = item?.data || {};
  if (typeof data.originalIsHole === "boolean") return data.originalIsHole;
  if (data.contourRole === "hole") return true;
  if (data.contourRole === "outer") return false;
  if (typeof data.explicitHole === "boolean") return data.explicitHole;
  return null;
}

function boundsContain(parent, child) {
  try { return !!parent?.bounds?.contains?.(child?.bounds); } catch (_) { return false; }
}

function interiorPoint(path) {
  if (!path?.bounds) return null;
  try {
    const center = path.bounds.center;
    if (path.contains?.(center)) return center;
    for (const curve of Array.from(path.curves || [])) {
      const point = curve.getPointAtTime(0.5);
      const normal = curve.getNormalAtTime(0.5);
      if (normal?.length) {
        const n = normal.normalize(1.5);
        const a = point.add(n), b = point.subtract(n);
        if (path.contains?.(a)) return a;
        if (path.contains?.(b)) return b;
      }
    }
    for (const segment of Array.from(path.segments || [])) {
      if (path.contains?.(segment.point)) return segment.point;
    }
    return center;
  } catch (_) { return null; }
}

export function geometricallyContains(parent, child) {
  if (!parent || !child || parent === child) return false;
  if (!boundsContain(parent, child) && !parent?.bounds?.intersects?.(child?.bounds)) return false;
  const samples = [];
  const point = interiorPoint(child);
  if (point) samples.push(point);
  const segments = Array.from(child.segments || []);
  const step = Math.max(1, Math.floor(segments.length / 8));
  for (let i = 0; i < segments.length; i += step) samples.push(segments[i].point);
  if (!samples.length) return false;
  let inside = 0;
  for (const sample of samples) {
    try { if (parent.contains?.(sample)) inside += 1; } catch (_) {}
  }
  return inside >= Math.ceil(samples.length * 0.5);
}

function windingSign(node) {
  const data = node?.path?.data || node?.data || {};
  if (typeof data.sourceWinding === "boolean") return data.sourceWinding ? 1 : -1;
  if (typeof data.originalClockwise === "boolean") return data.originalClockwise ? 1 : -1;
  try { return node?.path?.clockwise ? 1 : -1; } catch (_) { return 1; }
}

function ancestorList(node) {
  const result = [];
  let parent = node?.parent || null;
  const seen = new Set();
  while (parent && !seen.has(parent)) {
    seen.add(parent); result.unshift(parent); parent = parent.parent;
  }
  return result;
}

export function classifyContour(node, options = {}) {
  const path = node?.path || node;
  const data = path?.data || {};
  const explicit = explicitHoleOf(path);
  if (typeof explicit === "boolean") {
    return { isHole: explicit, confidence: "explicit", reason: "source-metadata" };
  }

  const fillRule = normalizeFillRule(
    data.originalFillRule || data.fillRule || options.fillRule || ""
  );
  if (fillRule === "nonzero" && node?.parent) {
    const ancestors = ancestorList(node);
    const before = ancestors.reduce((sum, ancestor) => sum + windingSign(ancestor), 0);
    const after = before + windingSign(node);
    if (before !== 0) {
      return { isHole: after === 0, confidence: "winding", reason: "nonzero-winding" };
    }
  }

  const depth = Number(node?.depth ?? options.depth ?? 0) || 0;
  return { isHole: depth % 2 === 1, confidence: "topology-fallback", reason: "containment-depth" };
}

export function buildContourRelations(paths, options = {}) {
  const list = Array.from(paths || []).filter(Boolean);
  const nodes = list.map((path, index) => ({
    path, index,
    area: Math.abs(Number(path.area) || 0),
    parent: null,
    children: [],
    depth: 0,
    sourceContourIndex: path.data?.sourceContourIndex ?? index
  }));

  for (const node of nodes) {
    let best = null;
    for (const candidate of nodes) {
      if (candidate === node || candidate.area <= node.area) continue;
      if (!geometricallyContains(candidate.path, node.path)) continue;
      if (!best || candidate.area < best.area) best = candidate;
    }
    node.parent = best;
    if (best) best.children.push(node);
  }

  const visit = (node, depth = 0) => {
    node.depth = depth;
    node.children.sort((a, b) => a.sourceContourIndex - b.sourceContourIndex);
    node.children.forEach(child => visit(child, depth + 1));
  };
  nodes.filter(node => !node.parent)
    .sort((a, b) => a.sourceContourIndex - b.sourceContourIndex)
    .forEach(node => visit(node, 0));

  const fillRule = normalizeFillRule(options.fillRule || list[0]?.data?.originalFillRule);
  nodes.forEach(node => {
    const classification = classifyContour(node, { ...options, fillRule });
    node.isHole = classification.isHole;
    node.classification = classification;
    node.contourRecord = {
      sourceContourIndex: node.sourceContourIndex,
      sourceElementId: node.path.data?.sourceElementId ?? null,
      sourceDocumentOrder: node.path.data?.docOrder ?? node.index,
      sourceZOrder: node.path.data?.sourceZOrder ?? node.index,
      fillRule,
      winding: windingSign(node) > 0 ? "clockwise" : "counterclockwise",
      explicitHole: explicitHoleOf(node.path),
      contourRole: classification.isHole ? "hole" : "outer",
      containmentParent: node.parent?.sourceContourIndex ?? null,
      containmentDepth: node.depth,
      confidence: classification.confidence,
      reason: classification.reason
    };
  });
  return { nodes, fillRule };
}

export function applyContourRecord(item, record = {}) {
  if (!item) return item;
  item.data = {
    ...(item.data || {}),
    sourceContourIndex: record.sourceContourIndex ?? item.data?.sourceContourIndex ?? null,
    sourceElementId: record.sourceElementId ?? item.data?.sourceElementId ?? null,
    sourceDocumentOrder: record.sourceDocumentOrder ?? item.data?.sourceDocumentOrder ?? null,
    sourceZOrder: record.sourceZOrder ?? item.data?.sourceZOrder ?? null,
    originalFillRule: record.fillRule || item.data?.originalFillRule || DEFAULT_FILL_RULE,
    sourceWinding: record.winding === "clockwise",
    explicitHole: record.explicitHole,
    originalIsHole: !!record.isHole,
    contourRole: record.contourRole || (record.isHole ? "hole" : "outer"),
    containmentParent: record.containmentParent ?? null,
    containmentDepth: record.containmentDepth ?? 0,
    holeClassification: record.confidence || "unknown"
  };
  return item;
}

if (typeof window !== "undefined") {
  window.EKKO_HOLE_SEMANTICS = {
    normalizeFillRule, explicitHoleOf, geometricallyContains,
    classifyContour, buildContourRelations, applyContourRecord
  };
}
