/* EKKO Studio - outside-in geometric ungroup engine. */

function areaOf(path) {
  return Math.abs(path.area || path.bounds?.area || 0);
}

function contains(parent, child) {
  if (!parent || !child) return false;
  const p = child.bounds?.center;
  if (!p) return false;
  try { return parent.contains(p); } catch (_) { return parent.bounds.contains(p); }
}

function buildTree(paths) {
  const nodes = paths.map(path => ({ path, parent: null, children: [], depth: 0 }));
  for (const node of nodes) {
    let best = null;
    let bestArea = Infinity;
    for (const candidate of nodes) {
      if (candidate === node) continue;
      const ca = areaOf(candidate.path);
      if (ca <= areaOf(node.path) || ca >= bestArea) continue;
      if (contains(candidate.path, node.path)) { best = candidate; bestArea = ca; }
    }
    node.parent = best;
  }
  const roots = nodes.filter(n => !n.parent).sort((a,b) => areaOf(b.path)-areaOf(a.path));
  const assign = (node, depth) => {
    node.depth = depth;
    node.children = nodes.filter(n => n.parent === node).sort((a,b) => areaOf(b.path)-areaOf(a.path));
    node.children.forEach(child => assign(child, depth + 1));
  };
  roots.forEach(root => assign(root, 0));
  return roots;
}

function clonePath(path) {
  return path.clone({ insert: false });
}

function makeShell(node) {
  const shell = new paper.CompoundPath({ insert: false });
  const outer = clonePath(node.path);
  shell.addChild(outer);
  // Even depth = filled contour; odd depth = transparent cutout.
  if (node.depth % 2 === 1) {
    shell.remove();
    return null;
  }
  node.children.filter(child => child.depth % 2 === 1).forEach(hole => shell.addChild(clonePath(hole.path)));
  shell.fillColor = node.path.fillColor ? node.path.fillColor.clone() : null;
  shell.strokeColor = node.path.strokeColor ? node.path.strokeColor.clone() : null;
  shell.strokeWidth = node.path.strokeWidth || 0;
  return shell;
}

function makeNode(node) {
  const hasChildren = node.children.length > 0;
  if (!hasChildren && node.depth % 2 === 1) {
    const hole = clonePath(node.path);
    hole.fillColor = null;
    hole.strokeColor = node.path.strokeColor ? node.path.strokeColor.clone() : null;
    hole.data = { ...(hole.data || {}), geometricRole: 'hole', geometricHierarchy: 'simple' };
    return hole;
  }

  if (!hasChildren) {
    const leaf = clonePath(node.path);
    leaf.data = { ...(leaf.data || {}), geometricRole: 'solid', geometricHierarchy: 'simple' };
    return leaf;
  }

  const group = new paper.Group({ insert: false });
  group.data = {
    ...(node.path.data || {}),
    geometricHierarchy: 'compound',
    geometricDepth: node.depth,
    geometricRole: node.depth % 2 === 0 ? 'solid' : 'hole'
  };

  const shell = makeShell(node);
  if (shell) group.addChild(shell);

  // Preserve every deeper level. The next click acts on this group only.
  node.children.forEach(child => {
    const childItem = makeNode(child);
    if (childItem) group.addChild(childItem);
  });
  return group;
}

export function geometricUngroupCompound(item) {
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return null;
  const target = item.data?.clipGroup && typeof window.getContentItem === 'function'
    ? window.getContentItem(item) : item;
  if (!(target instanceof paper.CompoundPath)) return null;

  const paths = [...target.children].filter(p => p && p.bounds && !p.data?.mockup && !p.data?.isMask);
  if (paths.length <= 1) return { handled: true, simple: true, items: [item] };

  const roots = buildTree(paths);
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const global = typeof window.getGlobalMatrix === 'function' ? window.getGlobalMatrix(target) : target.matrix.clone();
  const result = [];

  roots.forEach(root => {
    const built = makeNode(root);
    if (!built) return;
    built.matrix = global.clone().chain(built.matrix);
    parent.addChild(built);
    result.push(built);
  });

  item.remove();
  result.forEach((child, i) => parent.insertChild(index + i, child));
  return { handled: true, simple: false, items: result };
}

export function geometricUngroupOneLevel(item) {
  if (!item || item.data?.geometricHierarchy !== 'compound' || !(item instanceof paper.Group)) return null;
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const children = [...item.children];
  const matrix = typeof window.getGlobalMatrix === 'function' ? window.getGlobalMatrix(item) : item.matrix.clone();
  children.forEach(child => {
    child.remove();
    child.matrix = matrix.clone().chain(child.matrix);
    parent.addChild(child);
  });
  item.remove();
  children.forEach((child, i) => parent.insertChild(index + i, child));
  return { handled: true, items: children };
}
