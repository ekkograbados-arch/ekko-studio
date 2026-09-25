/*
 * EKKO Studio — real vector outline geometry.
 *
 * A stroke is useful for a UI preview, but it is not a reliable fabrication
 * primitive: LightBurn, a CNC and a later operator correction need a closed
 * region (or a real cut line), not a display-only stroke.  This module turns
 * a closed Paper.js contour into a real ring and supports the same three
 * placements offered by common design tools: centered, inside and outside.
 *
 * The polygon offset is intentionally conservative.  It samples curves and
 * creates a closed offset contour before using Paper's boolean operations;
 * callers can still refine the result with node editing.  No laser parameters
 * are stored here.
 */
import { getPublicOwner, getPublicOwners, getOwnerLocalGeometry, toWorldGeometry } from "./designGeometry.js";
import { installOwnerGeometry } from "./geometricUngroup.js";
import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";

const EPSILON = 1e-7;

function asPath(item) {
    if (!item) return null;
    if (item.className === "Path" || (typeof paper !== "undefined" && paper.Path && item instanceof paper.Path)) return item;
    return null;
}

function asCompound(item) {
    if (!item) return null;
    return item.className === "CompoundPath" ||
        (typeof paper !== "undefined" && paper.CompoundPath && item instanceof paper.CompoundPath) ? item : null;
}

function point(x, y) {
    return new paper.Point(Number(x) || 0, Number(y) || 0);
}

function signedArea(points) {
    if (!points || points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
}

function dedupeClosed(points, tolerance = 1e-5) {
    const result = [];
    (points || []).forEach(p => {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        const previous = result[result.length - 1];
        if (!previous || previous.getDistance(p) > tolerance) result.push(point(p.x, p.y));
    });
    while (result.length > 1 && result[0].getDistance(result[result.length - 1]) <= tolerance) result.pop();
    return result;
}

function samplePath(path, tolerance = 1.2) {
    if (!path || !Array.isArray(path.segments) || path.segments.length < 2) return [];
    if (path.closed !== true) return [];
    try {
        const flattened = path.flatten(tolerance);
        if (Array.isArray(flattened) && flattened.length >= 3) return dedupeClosed(flattened);
    } catch (_) {
        // Fall through to curve sampling for older Paper builds.
    }
    const points = [];
    (path.curves || []).forEach(curve => {
        const length = Number(curve?.length) || 0;
        const steps = Math.max(3, Math.min(32, Math.ceil(length / Math.max(tolerance, 0.25))));
        for (let i = 0; i < steps; i += 1) {
            try { points.push(curve.getPointAtTime(i / steps)); } catch (_) {}
        }
    });
    if (!points.length) path.segments.forEach(segment => points.push(segment.point));
    return dedupeClosed(points);
}

function collectContours(geometry, result = []) {
    if (!geometry) return result;
    const path = asPath(geometry);
    if (path) {
        const points = samplePath(path);
        if (points.length >= 3 && Math.abs(signedArea(points)) > EPSILON) {
            result.push({ points, area: Math.abs(signedArea(points)), clockwise: signedArea(points) < 0 });
        }
        return result;
    }
    const compound = asCompound(geometry);
    if (compound) {
        (compound.children || []).forEach(child => collectContours(child, result));
        return result;
    }
    (geometry.children || []).forEach(child => collectContours(child, result));
    return result;
}

function lineIntersection(a, aDir, b, bDir) {
    const denominator = aDir.x * bDir.y - aDir.y * bDir.x;
    if (Math.abs(denominator) < 1e-9) return null;
    const delta = b.subtract(a);
    const t = (delta.x * bDir.y - delta.y * bDir.x) / denominator;
    return a.add(aDir.multiply(t));
}

function removeCollinear(points, tolerance = 1e-4) {
    const source = dedupeClosed(points);
    if (source.length < 4) return source;
    const result = [];
    for (let i = 0; i < source.length; i += 1) {
        const previous = source[(i - 1 + source.length) % source.length];
        const current = source[i];
        const next = source[(i + 1) % source.length];
        const cross = (current.x - previous.x) * (next.y - current.y) -
            (current.y - previous.y) * (next.x - current.x);
        const scale = Math.max(1, current.getDistance(previous) * current.getDistance(next));
        if (Math.abs(cross) / scale > tolerance) result.push(current);
    }
    return result.length >= 3 ? result : source;
}

function offsetPolygon(points, distance) {
    const source = removeCollinear(points);
    if (source.length < 3 || !Number.isFinite(distance) || Math.abs(distance) < EPSILON) return source;
    const area = signedArea(source);
    const orientation = area >= 0 ? 1 : -1;
    const result = [];
    const maxMiter = Math.max(Math.abs(distance) * 8, 1);
    for (let i = 0; i < source.length; i += 1) {
        const previous = source[(i - 1 + source.length) % source.length];
        const current = source[i];
        const next = source[(i + 1) % source.length];
        const incoming = current.subtract(previous);
        const outgoing = next.subtract(current);
        if (incoming.length < EPSILON || outgoing.length < EPSILON) continue;
        // Paper's screen-coordinate winding is opposite to the usual
        // Cartesian convention. Negate the normal so a positive distance
        // expands the contour and a negative distance shrinks it.
        const n1 = point(-incoming.y, incoming.x).normalize().multiply(-distance * orientation);
        const n2 = point(-outgoing.y, outgoing.x).normalize().multiply(-distance * orientation);
        const p1 = current.add(n1);
        const p2 = current.add(n2);
        let intersection = lineIntersection(p1, incoming.normalize(), p2, outgoing.normalize());
        if (!intersection || intersection.getDistance(current) > maxMiter) {
            intersection = current.add(n1.add(n2).divide(2));
        }
        result.push(intersection);
    }
    return dedupeClosed(result);
}

function makeClosedPath(points) {
    const clean = dedupeClosed(points);
    if (clean.length < 3) return null;
    try {
        const path = new paper.Path({
            insert: false,
            segments: clean,
            closed: true,
            fillColor: new paper.Color("#111827"),
            strokeColor: null
        });
        path.applyMatrix = true;
        return path;
    } catch (_) { return null; }
}

function makeCompoundFromPaths(paths, fillRule = "evenodd") {
    const usable = (paths || []).filter(Boolean);
    if (!usable.length) return null;
    if (usable.length === 1) {
        const only = usable[0];
        if (only.fillRule !== undefined) only.fillRule = fillRule;
        return only;
    }
    const compound = new paper.CompoundPath({ insert: false });
    usable.forEach(path => {
        if (asCompound(path)) {
            const children = path.removeChildren ? path.removeChildren() : [];
            children.forEach(child => compound.addChild(child));
            path.remove?.();
        } else {
            compound.addChild(path);
        }
    });
    compound.fillRule = fillRule;
    compound.fillColor = new paper.Color("#111827");
    compound.strokeColor = null;
    return compound;
}

function areaMagnitude(geometry) {
    return Math.abs(Number(geometry?.area) || 0);
}

function cloneDetached(geometry) {
    try { return geometry?.clone?.({ insert: false }) || null; } catch (_) { return null; }
}

function unionPositiveParts(parts) {
    const usable = (parts || []).filter(part => part && areaMagnitude(part) > EPSILON);
    if (!usable.length) return null;
    let result = usable.shift();
    while (usable.length) {
        const candidate = usable.shift();
        try {
            const united = result.unite(candidate, { insert: false });
            if (!united || areaMagnitude(united) <= EPSILON) {
                united?.remove?.();
                candidate.remove?.();
                continue;
            }
            result.remove?.();
            candidate.remove?.();
            united.applyMatrix = true;
            result = united;
        } catch (_) {
            // A self-intersecting/complex contour must not discard the bands
            // that were already built; retain the valid prefix and continue.
            candidate.remove?.();
        }
    }
    return result;
}

function intersectPositiveParts(left, right) {
    if (!left || !right) return null;
    try {
        const result = left.intersect(right, { insert: false });
        if (result && areaMagnitude(result) > EPSILON) {
            result.applyMatrix = true;
            return result;
        }
        result?.remove?.();
    } catch (_) {}
    return null;
}

function subtractPositiveParts(left, right) {
    if (!left) return null;
    if (!right) return left;
    try {
        const result = left.subtract(right, { insert: false });
        if (result && areaMagnitude(result) > EPSILON) {
            result.applyMatrix = true;
            return result;
        }
        result?.remove?.();
    } catch (_) {}
    return null;
}

/**
 * Create a closed outline in the same world/project space as `source`.
 * `side` is one of center, inside or outside and `width` is in Paper units.
 */
export function buildOutlineGeometry(source, width = 2, side = "center") {
    if (!source || typeof paper === "undefined") return null;
    const worldClone = source?.clone?.({ insert: false }) || null;
    const world = worldClone || source;
    const ownsWorld = world !== source;
    try { world.applyMatrix = true; } catch (_) {}
    const contours = collectContours(world);
    if (!contours.length) {
        if (ownsWorld) world.remove?.();
        return null;
    }
    const amount = Math.abs(Number(width) || 0);
    if (amount <= EPSILON) {
        if (ownsWorld) world.remove?.();
        return null;
    }
    const mode = ["inside", "outside", "center"].includes(String(side).toLowerCase())
        ? String(side).toLowerCase() : "center";

    const cleanup = new Set();
    const track = geometry => { if (geometry) cleanup.add(geometry); return geometry; };
    const release = result => {
        cleanup.forEach(geometry => {
            if (geometry === result) return;
            try { geometry.remove?.(); } catch (_) {}
        });
        cleanup.clear();
    };

    try {
        // Keep the source's actual fill rule/topology. Rebuilding a compound
        // from sampled contours and forcing `evenodd` loses nonzero SVG
        // islands and makes inside/outside bands swallow real holes.
        let sourcePath = ownsWorld ? world : cloneDetached(world);
        if (!asPath(sourcePath) && !asCompound(sourcePath)) {
            const rebuilt = makeCompoundFromPaths(
                contours.map(contour => makeClosedPath(contour.points)),
                world.fillRule || "nonzero"
            );
            if (sourcePath && sourcePath !== rebuilt) sourcePath.remove?.();
            if (ownsWorld && rebuilt && rebuilt !== world) world.remove?.();
            sourcePath = rebuilt;
        }
        if (!sourcePath) { release(null); return null; }
        track(sourcePath);
        try {
            sourcePath.applyMatrix = true;
            if (sourcePath.fillRule !== undefined) sourcePath.fillRule = world.fillRule || sourcePath.fillRule || "nonzero";
        } catch (_) {}

        const records = [];
        contours.forEach(contour => {
            const base = track(makeClosedPath(contour.points));
            const firstOffset = track(makeClosedPath(offsetPolygon(contour.points, amount)));
            const secondOffset = track(makeClosedPath(offsetPolygon(contour.points, -amount)));
            if (!base || !firstOffset || !secondOffset) return;
            const expanded = areaMagnitude(firstOffset) >= areaMagnitude(secondOffset) ? firstOffset : secondOffset;
            const contracted = expanded === firstOffset ? secondOffset : firstOffset;
            if (areaMagnitude(expanded) - areaMagnitude(contracted) <= EPSILON) return;
            records.push({
                base,
                expanded,
                contracted
            });
        });
        if (!records.length) { release(null); return null; }

        let result = null;
        const bands = records.map(record => {
            // The symmetric ring is the union of the two sides of the real
            // boundary. Selecting a side against the original source mask
            // works for outer contours, holes and nested islands alike; no
            // winding guess or cosmetic fill is involved.
            const ring = track(subtractPositiveParts(
                track(cloneDetached(record.expanded)),
                track(cloneDetached(record.contracted))
            ));
            if (!ring || mode === "center") return ring;
            if (mode === "inside") {
                return track(intersectPositiveParts(ring, track(cloneDetached(sourcePath))));
            }
            return track(subtractPositiveParts(ring, track(cloneDetached(sourcePath))));
        }).filter(Boolean);
        result = unionPositiveParts(bands);
        if (result) track(result);

        if (!result || areaMagnitude(result) <= EPSILON) {
            release(null);
            return null;
        }
        try { result.applyMatrix = true; } catch (_) {}
        if (result.fillRule !== undefined) result.fillRule = "evenodd";
        result.fillColor = new paper.Color("#111827");
        result.strokeColor = null;
        result.strokeWidth = 0;
        result.data = { ...(result.data || {}), outlineWidth: amount, outlineSide: mode, source: "vector-outline" };
        release(result);
        return result;
    } catch (_) {
        release(null);
        return null;
    }
}

function localSnapshotFromWorld(geometry, owner) {
    if (!geometry || !owner) return null;
    const local = geometry.clone({ insert: false });
    try {
        const inverse = owner.globalMatrix?.inverted?.();
        if (inverse) local.transform(inverse);
        local.applyMatrix = false;
        local.matrix = new paper.Matrix();
    } catch (_) {}
    return local;
}

function restoreOutlineSource(owner) {
    const snapshot = owner?.data?.outlineSourceGeomBase;
    if (!snapshot || !owner.parent) return null;
    const world = snapshot.clone({ insert: false });
    try {
        world.applyMatrix = false;
        world.transform(owner.globalMatrix || new paper.Matrix());
        world.applyMatrix = true;
    } catch (_) {}
    const restored = installOwnerGeometry(owner, world);
    if (restored) {
        const local = snapshot.clone({ insert: false });
        local.applyMatrix = false;
        local.matrix = new paper.Matrix();
        restored.data.geomBase = local;
    }
    return restored;
}

function applyOutlineResult(owner, result) {
    if (!owner || !result) return null;
    const before = owner.data?.geomBase?.clone?.({ insert: false }) ||
        getOwnerLocalGeometry(owner);
    if (before) owner.data.outlineSourceGeomBase = before;
    const installed = installOwnerGeometry(owner, result);
    if (!installed) return null;
    const local = localSnapshotFromWorld(result, installed);
    if (local) {
        installed.data.geomBase = local;
        local.remove?.();
    }
    setSemanticKind(installed, VECTOR_KIND.SOLID);
    installed.data = {
        ...(installed.data || {}),
        source: "vector-outline",
        isOutline: true,
        outlineSide: result.data?.outlineSide || "center",
        outlineWidth: Number(result.data?.outlineWidth) || 0,
        isFusionReceptor: true,
        isCalado: false,
        isHole: false,
        csgMaterialized: false
    };
    installed.visible = true;
    return installed;
}

function resolveVectorOwner(item) {
    const direct = getPublicOwner(item);
    const candidates = getPublicOwners([item]);
    return candidates.find(candidate => candidate &&
        ["Path", "CompoundPath", "Shape"].includes(candidate.className) &&
        candidate.data?.geomBase && candidate.data?.isCutLine !== true) || direct;
}

export function createOwnerOutline(ownerLike, options = {}) {
    const owner = resolveVectorOwner(ownerLike);
    if (!owner || !owner.parent || owner.data?.locked || owner.data?.isCutLine) return null;
    if (owner.data?.isOutline === true && options.restore === true) return null;
    const widthControl = typeof document !== "undefined" ? document.getElementById("ctxOutlineWidth")?.value : null;
    const sideControl = typeof document !== "undefined" ? document.getElementById("ctxOutlineSide")?.value : null;
    const width = Number(options.width ?? widthControl ?? 2) || 2;
    const side = options.side ?? sideControl ?? "center";
    const source = options.restore ? null : toWorldGeometry(owner);
    if (!source) return null;
    const result = buildOutlineGeometry(source, width, side);
    if (!result) return null;
    // buildOutlineGeometry returns a detached result; applyOutlineResult
    // installs a defensive copy, so keep it alive until that call returns.
    const installed = applyOutlineResult(owner, result);
    result.remove?.();
    return installed;
}

export function toggleOwnerOutline(ownerLike, options = {}) {
    const owner = resolveVectorOwner(ownerLike);
    if (!owner) return null;
    if (owner.data?.isOutline === true) {
        if (typeof window.saveHistory === "function" && options.skipHistory !== true) window.saveHistory();
        const restored = restoreOutlineSource(owner);
        if (restored) {
            restored.data = { ...(restored.data || {}), isOutline: false };
            delete restored.data.outlineSourceGeomBase;
            delete restored.data.outlineSide;
            delete restored.data.outlineWidth;
        }
        return restored;
    }
    if (typeof window.saveHistory === "function" && options.skipHistory !== true) window.saveHistory();
    return createOwnerOutline(owner, options);
}

if (typeof window !== "undefined") {
    window.EKKO_OUTLINE_GEOMETRY = {
        buildOutlineGeometry,
        createOwnerOutline,
        toggleOwnerOutline
    };
}
