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

/** Douglas-Peucker sobre un poligono cerrado.
 *
 *  POR QUE EXISTE: la silueta de una imagen sale del canal alfa con un punto
 *  cada 0,06 unidades (miles de nodos para una pieza de 240). Correr un
 *  offset de 12 unidades sobre esa nube de nodos es degenerado: cada par de
 *  segmentos casi paralelos genera una interseccion de chaflan fuera de
 *  lugar y la booleana devuelve cientos de esquirlas (medido: 164 subcaminos
 *  y 161 esquirlas a grosor 24, 375 ms). Simplificar ANTES de offsetear es
 *  lo que hace LightBurn: la tolerancia es una fraccion de la pieza (0,25%),
 *  invisible al ojo y muy por debajo de lo que el laser resuelve. Medido con
 *  la misma pieza: 5 subcaminos y 5 ms. */
function simplifyClosed(points, tolerance) {
    const source = points || [];
    if (source.length < 5 || !(tolerance > 0)) return source;
    // El ultimo punto de un loop cerrado repite el primero: DP trabaja sobre
    // la polilinea sin ese duplicado y se lo vuelve a agregar al final.
    const cerrado = source[0].getDistance(source[source.length - 1]) <= 1e-9;
    const pts = cerrado ? source.slice(0, -1) : source.slice();
    if (pts.length < 4) return source;
    let lejos = 0, dmax = -1;
    for (let i = 1; i < pts.length; i += 1) {
        const d = pts[i].getDistance(pts[0]);
        if (d > dmax) { dmax = d; lejos = i; }
    }
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[lejos] = 1;
    const tramo = (a, b) => {
        const pila = [[a, b]];
        while (pila.length) {
            const [i, j] = pila.pop();
            if (j <= i + 1) continue;
            const ax = pts[i].x, ay = pts[i].y;
            const dx = pts[j].x - ax, dy = pts[j].y - ay;
            const largo = Math.hypot(dx, dy) || 1;
            let peor = -1, peorD = -1;
            for (let k = i + 1; k < j; k += 1) {
                const d = Math.abs((pts[k].x - ax) * dy - (pts[k].y - ay) * dx) / largo;
                if (d > peorD) { peorD = d; peor = k; }
            }
            if (peorD > tolerance && peor > 0) { keep[peor] = 1; pila.push([i, peor], [peor, j]); }
        }
    };
    tramo(0, lejos);
    tramo(lejos, pts.length - 1);
    const out = [];
    for (let i = 0; i < pts.length; i += 1) if (keep[i]) out.push(pts[i]);
    if (out.length < 3) return source;
    if (cerrado) out.push(out[0]);
    return out;
}

/** Tolerancia de simplificado previo al offset: 0,25% de la pieza. Una
 *  silueta de 240 unidades se simplifica a ~0,6 unidades de error maximo;
 *  una caja dibujada a mano no pierde ni una esquina. */
function simplifyTolerance(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (points || []).forEach(p => {
        if (!p) return;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    });
    const escala = Math.max(maxX - minX, maxY - minY);
    if (!(escala > 0)) return 0;
    return Math.max(0.1, escala / 400);
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
            fillColor: new paper.Color("#000000"),
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
    compound.fillColor = new paper.Color("#000000");
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
 * `scope` decide que contornos generan banda:
 *   all   -> exterior + huecos + islas (comportamiento de siempre)
 *   outer -> solo el contorno de mayor area (el borde externo)
 *   holes -> todos menos el mayor (huecos e islas internas)
 */
export function buildOutlineGeometry(source, width = 2, side = "center", radius = 0, smoothing = 0, scope = "all") {
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
    const alcance = ["outer", "holes"].includes(String(scope || "").toLowerCase())
        ? String(scope).toLowerCase() : "all";
    // El filtro es por AREA: el contorno que encierra todo lo demas es el
    // borde externo; el resto son huecos e islas. Con un solo contorno no hay
    // nada que filtrar.
    let contornosActivos = contours;
    if (alcance !== "all" && contours.length > 1) {
        let mayor = 0;
        contours.forEach((c, i) => { if (c.area > contours[mayor].area) mayor = i; });
        contornosActivos = alcance === "outer" ? [contours[mayor]] : contours.filter((c, i) => i !== mayor);
    }
    const amount = Math.abs(Number(width) || 0);
    // POLVO: un contorno cuya area no alcanza la superficie de la propia banda
    // no deja tinta en el grabado (la banda se lo traga) y cada uno paga una
    // booleana completa. Medido con el material recortado del cliente: una
    // pieza de 39 loops, 36 de ellos polvo, tardaba 464 ms en el canal alfa;
    // descartando el polvo, 31 ms con el mismo borde visible. El umbral es
    // grosor al cuadrado: lo que abarca un trazo de ese ancho.
    if (contornosActivos.length > 1 && amount > 0) {
        const minimo = amount * amount;
        const limpios = contornosActivos.filter(contour => contour.area >= minimo);
        if (limpios.length) contornosActivos = limpios;
    }
    if (amount <= EPSILON) {
        if (ownsWorld) world.remove?.();
        return null;
    }
    const mode = ["inside", "outside", "center"].includes(String(side).toLowerCase())
        ? String(side).toLowerCase() : "center";
    // RADIO: separación del contorno respecto del borde original. 0 deja la
    // línea justo sobre el borde; positivo la corre hacia afuera, negativo la
    // acerca hacia adentro. Equivale a "Offset Distance" de LightBurn y a
    // "Expandir/Contraer" de Photoshop. Se aplica ANTES de engrosar: primero
    // se decide dónde va la línea, después qué tan gruesa es.
    const offset = Number(radius) || 0;
    // SUAVIDAD: cuanto mayor, menos puntos. Un contorno de pelo o de bigote
    // trae cientos de nodos que no aportan nada al grabado. Equivale a
    // "Optimize/Simplify results" de LightBurn y a "Suavizar" de Photoshop.
    const smooth = Math.max(0, Number(smoothing) || 0);

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
        // CRITERIO PHOTOSHOP para el grosor, medido y aprobado: con Posicion
        // Centro la banda ocupa el GROSOR completo (grosor/2 a cada lado del
        // borde), igual que Exterior/Interior aplican el grosor hacia su lado.
        // Antes Centro duplicaba: offsets a +-grosor producian una banda del
        // doble del valor del control.
        const medio = mode === "center" ? amount / 2 : amount;
        contornosActivos.forEach(contour => {
            // El borde de trabajo es el original corrido por el Radio. El
            // engrosamiento se mide desde ahi, no desde el borde original.
            const limpio = simplifyClosed(contour.points, simplifyTolerance(contour.points));
            const working = (Math.abs(offset) > EPSILON)
                ? (offsetPolygon(limpio, offset) || limpio)
                : limpio;
            const base = track(makeClosedPath(working));
            const firstOffset = track(makeClosedPath(offsetPolygon(working, medio)));
            const secondOffset = track(makeClosedPath(offsetPolygon(working, -medio)));
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
        // Limpieza de esquirlas: las booleanas de Paper dejan a veces subcaminos
        // degenerados cuando la banda pasa cerca de esquinas en chaflan de un
        // contorno con escalones de pixel. No se ven, no aportan nada al
        // grabado y ensucian el export. El umbral escala con el grosor: una
        // esquirla real mide menos que una fraccion de la banda (medido: 0,08
        // por pieza a grosor 24), mientras que un fragmento legitimo siempre
        // pesa al menos grosor x largo. Tambien se descarta lo minusculo en
        // caja, aunque su area se haya calculado con error de redondeo.
        if (result.className === "CompoundPath" && result.children?.length) {
            const areaEsquirla = Math.max(0.01, amount * 0.4);
            [...result.children].forEach(child => {
                const box = child.bounds;
                const area = Math.abs(Number(child.area) || 0);
                const degenerado = area <= EPSILON ||
                    (box && box.width < 1e-6 && box.height < 1e-6) ||
                    (area < areaEsquirla && box && box.width < amount && box.height < amount);
                if (degenerado) child.remove();
            });
            if (!result.children.length) {
                release(null);
                return null;
            }
        }
        try { result.applyMatrix = true; } catch (_) {}
        if (result.fillRule !== undefined) result.fillRule = "evenodd";
        result.fillColor = new paper.Color("#000000");
        result.strokeColor = null;
        result.strokeWidth = 0;
        // Suavidad: se aplica al final, sobre la geometria ya resuelta, para
        // que simplifique el contorno entregado y no las siluetas intermedias
        // con las que se calcularon las bandas.
        if (smooth > 0) applySmoothing(result, smooth);
        result.data = {
            ...(result.data || {}),
            outlineWidth: amount,
            outlineSide: mode,
            outlineRadius: offset,
            outlineSmoothing: smooth,
            outlineScope: alcance,
            source: "vector-outline"
        };
        release(result);
        return result;
    } catch (_) {
        release(null);
        return null;
    }
}

/**
 * SUAVIDAD: reduce los nodos de cada contorno sin cambiar la forma visible.
 *
 * No usa una tolerancia fija en unidades porque el mismo 0,5 seria invisible
 * con la vista alejada y un desorden con la vista cerca. Se escala con la
 * dimension del contorno: un pelo de 3 unidades y una caja de 800 no pueden
 * simplificarse con la misma tolerancia.
 *
 * simplify() reescribe los segmentos sin vuelta atras y, sobre geometria que
 * recien salio de una booleana, puede deformar la silueta en vez de limpiarla.
 * Por eso la operacion es LO QUE SI O LO QUE NO: se mide el area y la caja
 * antes y despues, y si la forma se movio mas de lo permitido se revierte
 * entera. Suavizar nunca puede alterar el diseno del cliente.
 */
export function applySmoothing(geometry, level) {
    if (!geometry || !(level > 0)) return geometry;
    const leaves = (geometry.className === "CompoundPath" && geometry.children?.length)
        ? geometry.children
        : [geometry];
    const scale = leaves.reduce((max, leaf) => Math.max(max, leaf.bounds?.width || 0, leaf.bounds?.height || 0), 0);
    if (!(scale > 0)) return geometry;
    // level 0..10 -> tolerancia relativa, de muy suave a muy agresiva.
    const tolerance = (scale / 2600) * level;
    if (!(tolerance > 0)) return geometry;

    const areaBefore = areaMagnitude(geometry);
    const boxBefore = geometry.bounds?.clone?.() || null;
    // Respaldo completo: si hay que revertir, se restaura desde aca.
    const backup = cloneDetached(geometry);
    const applied = [];
    try {
        leaves.forEach(leaf => {
            const before = leaf.segments?.length || 0;
            if (before <= 3 || typeof leaf.simplify !== "function") return;
            leaf.simplify(tolerance);
            if ((leaf.segments?.length || 0) >= 3) applied.push(leaf);
        });
    } catch (_) { applied.length = 0; }

    const areaAfter = areaMagnitude(geometry);
    const boxAfter = geometry.bounds?.clone?.() || null;
    const grew = areaBefore > EPSILON ? Math.abs(areaAfter - areaBefore) / areaBefore : 1;
    const movedX = boxBefore && boxAfter ? Math.abs(boxAfter.x - boxBefore.x) : 0;
    const movedY = boxBefore && boxAfter ? Math.abs(boxAfter.y - boxBefore.y) : 0;
    const drift = Math.max(movedX, movedY);
    // Un 2% de area o mas de 1% de la dimension cuenta como deformacion.
    if (!applied.length || grew > 0.02 || drift > scale * 0.01) {
        if (backup) {
            try { geometry.removeSegments?.(); } catch (_) {}
            if (geometry.className === "CompoundPath") {
                geometry.removeChildren?.();
                backup.children?.forEach(child => geometry.addChild(child));
            } else {
                geometry.addSegments?.(backup.segments.map(seg => seg.clone()));
            }
            try { geometry.applyMatrix = true; } catch (_) {}
            if (geometry.fillRule !== undefined) geometry.fillRule = "evenodd";
        }
        try { backup?.remove?.(); } catch (_) {}
        return geometry;
    }
    try { backup?.remove?.(); } catch (_) {}
    return geometry;
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
        // Radio y Suavidad quedan registrados con el resultado: si el cliente
        // vuelve a tocar un control, el contorno tiene que saber con que
        // parametros se hizo.
        outlineRadius: Number(result.data?.outlineRadius) || 0,
        outlineSmoothing: Number(result.data?.outlineSmoothing) || 0,
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
    // UN solo duenio del estado (contorno.js): panel abierto > la banda de la
    // pieza > ultimo ajuste > default. Antes cada modulo leia el DOM con sus
    // propios defaults y el grosor dependia de que camino se habia tomado.
    const estado = (typeof window !== "undefined" && window.EKKO?.contornoEstado?.()) || {};
    const width = Number(options.width ?? estado.width ?? 1) || 1;
    const side = options.side ?? estado.side ?? "center";
    const radius = Number(options.radius ?? estado.radius ?? 0) || 0;
    const smoothing = Number(options.smoothing ?? estado.smoothing ?? 0) || 0;
    const scope = options.scope ?? estado.scope ?? "all";
    const source = options.restore ? null : toWorldGeometry(owner);
    if (!source) return null;
    const result = buildOutlineGeometry(source, width, side, radius, smoothing, scope);
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

/**
 * Refresca el anillo de un contorno de vector SIN toggle: la banda se
 * reconstruye desde la forma original guardada (outlineSourceGeomBase) con
 * los valores actuales del panel. Es lo que hace vivo al panel de Contorno
 * para vectores y texto: mover Grosor/Radio/Suavidad/Lado rehace el anillo
 * en el instante, igual que ya pasaba con los contornos de imagen.
 */
export function refreshOwnerOutline(ownerLike, options = {}) {
    const owner = resolveVectorOwner(ownerLike);
    if (!owner || !owner.parent || owner.data?.isOutline !== true) return null;
    const snapshot = owner.data?.outlineSourceGeomBase;
    if (!snapshot) return null;
    // UN solo duenio del estado (contorno.js): panel abierto > la banda de la
    // pieza > ultimo ajuste > default. Antes cada modulo leia el DOM con sus
    // propios defaults y el grosor dependia de que camino se habia tomado.
    const estado = (typeof window !== "undefined" && window.EKKO?.contornoEstado?.()) || {};
    const width = Number(options.width ?? estado.width ?? 1) || 1;
    const side = options.side ?? estado.side ?? "center";
    const radius = Number(options.radius ?? estado.radius ?? 0) || 0;
    const smoothing = Number(options.smoothing ?? estado.smoothing ?? 0) || 0;
    const scope = options.scope ?? estado.scope ?? "all";
    // La fuente SIEMPRE es la forma original guardada, nunca la banda actual:
    // construir sobre la banda apilaria anillos sobre anillos.
    const world = snapshot.clone({ insert: false });
    try {
        world.applyMatrix = false;
        world.transform(owner.globalMatrix || new paper.Matrix());
        world.applyMatrix = true;
    } catch (_) {}
    const result = buildOutlineGeometry(world, width, side, radius, smoothing, scope);
    world.remove?.();
    if (!result) return null;
    // Se reinstala la banda sin pasar por applyOutlineResult: ese camino
    // pisaria outlineSourceGeomBase con la banda recien creada y el toggle
    // ya no podria restaurar la forma original del cliente.
    const installed = installOwnerGeometry(owner, result);
    if (!installed) {
        result.remove?.();
        return null;
    }
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
        outlineSide: side,
        outlineWidth: width,
        outlineRadius: radius,
        outlineSmoothing: smoothing,
        outlineScope: scope,
        // La forma original se preserva tal cual: el toggle sigue pudiendo
        // devolverle al cliente su pieza de antes.
        outlineSourceGeomBase: snapshot,
        isFusionReceptor: true,
        isCalado: false,
        isHole: false,
        csgMaterialized: false
    };
    installed.visible = true;
    result.remove?.();
    try { paper.view?.update?.(); } catch (_) {}
    return installed;
}

/* ------------------------------------------------------------------
   PREVIEW FLUIDO (fase C). Durante el arrastre de un control del panel
   no se puede pagar el stitcher + booleanas en cada tick: el preview
   pinta la linea central de la banda como trazo magenta (la misma
   convencion "Magenta de LightBurn" del calco de imageTracer) y la
   geometria real la entrega buildOutlineGeometry al soltar.

   Misma algebra que el motor, en el mismo orden: primero el Radio corre
   la linea, despues el Lado decide donde cae el centro del trazo y el
   Grosor es el ancho del trazo. Con Centro el trazo va sobre el borde
   corrido y cubre +-grosor/2, que es EXACTAMENTE la banda real del
   criterio Photoshop. Con Exterior/Interior el trazo corre +-grosor/2
   hacia su lado, tambien exacto. Lo unico que el preview no reproduce
   es el recorte contra la pieza (esas son las booleanas caras).
   ------------------------------------------------------------------ */

const PREVIEW_COLOR = "#ff00ff"; // Magenta de LightBurn, como el calco.

function modoDeSide(side) {
    const modo = String(side || "").toLowerCase();
    return ["inside", "outside"].includes(modo) ? modo : "center";
}

function alcanceDeScope(scope) {
    const alcance = String(scope || "").toLowerCase();
    return ["outer", "holes"].includes(alcance) ? alcance : "all";
}

function grupoDePreview() {
    const grupo = new paper.Group({ insert: false });
    grupo.applyMatrix = false;
    // Mismas banderas que el preview del calco: para la app esto es un
    // overlay de UI (no seleccionable, no exporta, no cuenta en capacidades).
    grupo.data = { isOutlinePreview: true, isSelectionBox: true };
    return grupo;
}

function trazoDeLoop(puntos, strokeW) {
    const limpios = dedupeClosed(puntos);
    if (limpios.length < 3) return null;
    try {
        const path = new paper.Path({
            insert: false,
            segments: limpios,
            closed: true,
            fillColor: null,
            strokeColor: new paper.Color(PREVIEW_COLOR),
            strokeWidth: Math.max(0.5, strokeW),
            strokeJoin: "round",
            strokeCap: "round"
        });
        path.applyMatrix = true;
        return path;
    } catch (_) { return null; }
}

/**
 * Preview barato de la banda para geometria vectorial (o texto ya
 * convertido). Devuelve un Group de trazos magenta SIN insertar; el que
 * llama decide donde colgarlo y cuando quitarlo.
 */
export function previsualizarBanda(source, width = 2, side = "center", radius = 0, scope = "all") {
    if (!source || typeof paper === "undefined") return null;
    const amount = Math.abs(Number(width) || 0);
    if (!(amount > EPSILON)) return null;
    const mode = modoDeSide(side);
    const offset = Number(radius) || 0;
    const contours = collectContours(source);
    if (!contours.length) return null;
    const alcance = alcanceDeScope(scope);
    let activos = contours;
    if (alcance !== "all" && contours.length > 1) {
        let mayor = 0;
        contours.forEach((c, i) => { if (c.area > contours[mayor].area) mayor = i; });
        activos = alcance === "outer" ? [contours[mayor]] : contours.filter((c, i) => i !== mayor);
    }
    // Mismo corte de polvo y misma pre-simplificacion que el motor real: si el
    // preview mostrara lo que la banda final descarta, el cliente veria una
    // linea magenta distinta de la que termina obteniendo.
    if (activos.length > 1) {
        const limpios = activos.filter(contour => contour.area >= amount * amount);
        if (limpios.length) activos = limpios;
    }
    activos = activos.map(contour => ({ ...contour, points: simplifyClosed(contour.points, simplifyTolerance(contour.points)) }));
    // El centro del trazo siempre cae a grosor/2 del borde de trabajo: el
    // trazo mide `amount` de ancho, asi cubre exactamente [0, amount] del
    // lado elegido. (En el motor real `medio` vale `amount` para
    // outside/inside porque ahi construye el anillo simetrico completo y
    // recorta despues; el preview no tiene ese paso.)
    const medio = amount / 2;
    const grupo = grupoDePreview();
    activos.forEach(contour => {
        const working = (Math.abs(offset) > EPSILON)
            ? (offsetPolygon(contour.points, offset) || contour.points)
            : contour.points;
        // De que lado del contorno esta el material lo dice la pieza misma:
        // el centroide de un borde exterior cae dentro de la pieza y el de un
        // hueco, fuera de ella. Un contains por contorno es barato y no se
        // equivoca de lado como una heuristica de winding.
        let dir = 1;
        try {
            let suma = point(0, 0);
            working.forEach(p => { suma = suma.add(p); });
            const centro = suma.divide(working.length || 1);
            dir = source.contains?.(centro) === true ? 1 : -1;
        } catch (_) { dir = 1; }
        const corrida = mode === "center" ? 0 : (mode === "outside" ? dir * medio : -dir * medio);
        const linea = (Math.abs(corrida) > EPSILON)
            ? (offsetPolygon(working, corrida) || working)
            : working;
        const trazo = trazoDeLoop(linea, amount);
        if (trazo) grupo.addChild(trazo);
    });
    if (!grupo.children.length) { grupo.remove?.(); return null; }
    return grupo;
}

/**
 * Preview para una banda YA resuelta (la del motor de mascara de imagen): el
 * overlay magenta es la banda misma, no una aproximacion sobre la silueta.
 * Mismas banderas de UI que grupoDePreview.
 */
export function previsualizarBandaGeom(band) {
    if (!band || typeof paper === "undefined") return null;
    const grupo = grupoDePreview();
    const hojas = (band.className === "CompoundPath" && band.children?.length)
        ? band.children : [band];
    hojas.forEach(hoja => {
        try {
            const trazo = new paper.Path({
                insert: false,
                segments: (hoja.segments || []).map(seg => seg.point.clone ? seg.point.clone() : seg.point),
                closed: hoja.closed !== false,
                fillColor: new paper.Color(PREVIEW_COLOR),
                strokeColor: null,
                opacity: 0.55
            });
            trazo.applyMatrix = true;
            grupo.addChild(trazo);
        } catch (_) {}
    });
    if (!grupo.children.length) { grupo.remove?.(); return null; }
    return grupo;
}

if (typeof window !== "undefined") {
    window.EKKO_OUTLINE_GEOMETRY = {
        buildOutlineGeometry,
        createOwnerOutline,
        toggleOwnerOutline,
        refreshOwnerOutline,
        previsualizarBanda,
        previsualizarBandaGeom,
        applySmoothing
    };
}
