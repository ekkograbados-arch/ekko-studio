import { getPublicOwner } from "./designGeometry.js";
/*
 * Conversión de glifos OpenType a geometría Paper.js.
 * Requiere opentype.js cargado como window.opentype.
 */

const fontCache = new Map();
let fontCatalogPromise = null;

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^a-z0-9]/g, "");
}

async function getFontCatalog() {
    if (!fontCatalogPromise) {
        fontCatalogPromise = fetch("/api/fonts")
            .then(response => response.ok ? response.json() : [])
            .catch(() => []);
    }
    return fontCatalogPromise;
}

async function resolveFontFile(fontFamily) {
    const catalog = await getFontCatalog();
    const wanted = normalize(fontFamily);
    const matches = catalog.filter(font =>
        normalize(font.family) === wanted || normalize(font.name) === wanted
    );
    const match = matches.find(font => /\.(ttf|otf|woff)$/i.test(font.file));
    if (!match?.file) {
        throw new Error(`Fuente seleccionada sin formato vectorial compatible: ${fontFamily}`);
    }
    return match.file;
}

async function loadFont(fontFamily) {
    if (!window.opentype?.parse) {
        throw new Error("OpenType parse no está cargado");
    }
    const file = await resolveFontFile(fontFamily);
    const url = `/ASSETS/fonts/${encodeURIComponent(file)}`;
    let entry = fontCache.get(url);

    if (!entry) {
        const meta = {
            requestedFamily: fontFamily,
            resolvedFile: file,
            requestedUrl: url,
            httpStatus: null,
            parse: "pending"
        };
        const promise = fetch(url)
            .then(response => {
                meta.httpStatus = response.status;
                if (!response.ok) throw new Error(`Fuente no disponible: ${response.status}`);
                return response.arrayBuffer();
            })
            .then(buffer => {
                const parsed = window.opentype.parse(buffer);
                meta.parse = "success";
                return parsed;
            })
            .catch(error => {
                meta.parse = "error";
                meta.error = String(error?.message || error);
                throw error;
            });
        entry = { promise, meta };
        fontCache.set(url, entry);
    }

    try {
        const font = await entry.promise;
        window._ekkoFontResolution = {
            ...entry.meta,
            requestedFamily: fontFamily,
            resolvedFile: file,
            requestedUrl: url,
            httpStatus: entry.meta.httpStatus ?? 200,
            parse: "success"
        };
        return font;
    } catch (error) {
        window._ekkoFontResolution = {
            ...entry.meta,
            requestedFamily: fontFamily,
            resolvedFile: file,
            requestedUrl: url,
            parse: "error",
            error: String(error?.message || error)
        };
        throw error;
    }
}

function addContour(path, command, offsetX, baselineY) {
    switch (command.type) {
        case "M":
            path.moveTo(new paper.Point(offsetX + command.x, baselineY + command.y));
            break;
        case "L":
            path.lineTo(new paper.Point(offsetX + command.x, baselineY + command.y));
            break;
        case "C":
            path.cubicCurveTo(
                new paper.Point(offsetX + command.x1, baselineY + command.y1),
                new paper.Point(offsetX + command.x2, baselineY + command.y2),
                new paper.Point(offsetX + command.x, baselineY + command.y)
            );
            break;
        case "Q":
            path.quadraticCurveTo(
                new paper.Point(offsetX + command.x1, baselineY + command.y1),
                new paper.Point(offsetX + command.x, baselineY + command.y)
            );
            break;
        case "Z":
            path.closePath();
            break;
    }
}

export async function textToCompoundPath(textItem) {
    if (!textItem || !window.paper) return null;
    const content = String(textItem.content || "");
    if (!content) return null;

    const font = await loadFont(textItem.fontFamily);
    const size = Number(textItem.fontSize) || 42;
    const glyphPath = font.getPath(content, 0, 0, size, { kerning: true });
    const advance = font.getAdvanceWidth(content, size, { kerning: true });
    const justification = textItem.justification || "left";
    // Generar la geometría en el sistema local del PointText. La versión anterior
    // mezclaba bounds globales con point local y luego insertaba el resultado en
    // un clipGroup transformado, provocando el doble escalado al vectorizar.
    const anchor = textItem.point.clone ? textItem.point.clone() : new paper.Point(textItem.point.x, textItem.point.y);
    let offsetX = anchor.x;
    if (justification === "center") offsetX = anchor.x - advance / 2;
    if (justification === "right") offsetX = anchor.x - advance;
    const baselineY = anchor.y;

    const contours = [];
    let current = null;
    (glyphPath.commands || []).forEach(command => {
        if (command.type === "M") {
            current = new paper.Path({ insert: false });
            contours.push(current);
        }
        if (current) addContour(current, command, offsetX, baselineY);
    });

    const usable = contours.filter(path => path.segments.length > 1);
    if (!usable.length) return null;
    const compound = new paper.CompoundPath({ insert: false, children: usable });
    compound.fillRule = "evenodd";
    compound.fillColor = textItem.fillColor ? textItem.fillColor.clone() :
        new paper.Color("black");
    // The contour coordinates are in one explicit parent-local space. The
    // owner matrix is applied by the caller exactly once, never baked here.
    compound.applyMatrix = false;
    compound.matrix = new paper.Matrix();

    // Build semantic topology in the same local space. A contour's explicit
    // source metadata wins; otherwise parity of the containment tree does.
    const nodes = usable.map((path, index) => ({ path, index, area: Math.abs(path.area || 0), parent: null, depth: 0 }));
    nodes.forEach(node => {
        let best = null;
        nodes.forEach(candidate => {
            if (candidate === node || candidate.area <= node.area) return;
            if (!candidate.path.bounds.contains(node.path.bounds)) return;
            const probe = node.path.bounds.center;
            try {
                if (candidate.path.contains(probe) && (!best || candidate.area < best.area)) best = candidate;
            } catch (_) {}
        });
        node.parent = best;
        if (best) best.children = (best.children || []).concat(node);
    });
    const depthOf = node => { node.depth = node.parent ? depthOf(node.parent) + 1 : 0; return node.depth; };
    nodes.forEach(depthOf);
    const contourMeta = nodes.map(node => {
        const explicit = typeof node.path.data?.originalIsHole === "boolean" ? node.path.data.originalIsHole : null;
        const isHole = explicit !== null ? explicit : node.depth % 2 === 1;
        node.path.data = { ...(node.path.data || {}), contourIndex: node.index,
            contourDepth: node.depth, contourRole: isHole ? "hole" : "outer",
            originalIsHole: isHole, fillRule: "evenodd", source: "text-vector" };
        return { contourIndex: node.index, contourDepth: node.depth,
            contourRole: isHole ? "hole" : "outer", originalIsHole: isHole,
            fillRule: "evenodd" };
    });
    compound.data = { ...(compound.data || {}), source: "text-vector", fillRule: "evenodd",
        contours: contourMeta, hasInternalHoles: contourMeta.some(c => c.originalIsHole) };
    return compound;
}

if (typeof window !== "undefined") {
    window.EKKO_FONT_TO_PATH = { textToCompoundPath, resolveFontFile };
}
