import { getPublicOwner } from "./designGeometry.js";
import { buildContourRelations, applyContourRecord } from "./holeSemantics.js";
import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";
/*
 * Conversión de glifos OpenType a geometría Paper.js.
 * Requiere opentype.js cargado como window.opentype.
 */

const fontCache = new Map();
let fontCatalogPromise = null;

/*
 * The editor is normally deployed on Vercel, where /api/fonts supplies the
 * catalogue.  It is also used from a plain static server (and in automated
 * tests), where that endpoint does not exist.  Text-to-path must not silently
 * depend on the API: the repository already contains the fonts, so keep a
 * small deterministic fallback catalogue and use it when the endpoint is
 * unavailable or empty.
 */
const BUILTIN_FONT_CATALOG = [
    { name: "MalvinasSans-Regular", family: "ekko_malvinassans_regular", file: "MalvinasSans-Regular.ttf" },
    { name: "waltographUI", family: "ekko_waltograph_ui", file: "waltographUI.ttf" },
    { name: "waltograph42", family: "ekko_waltograph42", file: "waltograph42.otf" },
    { name: "Vartigo", family: "ekko_vartigo", file: "Vartigo.ttf" },
    { name: "Thesignature", family: "ekko_thesignature", file: "Thesignature.ttf" },
    { name: "Study Night", family: "ekko_study_night", file: "Study Night.otf" },
    { name: "SimpleHandmade", family: "ekko_simplehandmade", file: "SimpleHandmade.ttf" },
    { name: "Romantic Sunrise", family: "ekko_romantic_sunrise", file: "Romantic Sunrise.otf" },
    { name: "Photograph Signature", family: "ekko_photograph_signature", file: "Photograph Signature.ttf" },
    { name: "Papernotes", family: "ekko_papernotes", file: "Papernotes.ttf" },
    { name: "Papernotes Bold", family: "ekko_papernotes_bold", file: "Papernotes Bold.ttf" },
    { name: "Mayonice", family: "ekko_mayonice", file: "Mayonice.ttf" },
    { name: "Love", family: "ekko_love", file: "Love.ttf" },
    { name: "Little", family: "ekko_little", file: "Little.ttf" },
    { name: "Milky Matcha", family: "ekko_milky_matcha", file: "Milky Matcha.otf" },
    { name: "Nostalgic Letter", family: "ekko_nostalgic_letter", file: "Nostalgic Letter.otf" },
    { name: "Farmhouse", family: "ekko_farmhouse", file: "Farmhouse.ttf" },
    { name: "Chocolate", family: "ekko_chocolate", file: "Chocolate.ttf" },
    { name: "bromello", family: "ekko_bromello_regular", file: "bromello-Regular.ttf" }
];

const BUILTIN_FONT_ALIASES = {
    arial: "MalvinasSans-Regular.ttf",
    helvetica: "MalvinasSans-Regular.ttf",
    sans: "MalvinasSans-Regular.ttf",
    sansserif: "MalvinasSans-Regular.ttf",
    systemui: "MalvinasSans-Regular.ttf",
    ekko_malvinassans_regular: "MalvinasSans-Regular.ttf",
    ekko_malvinassans: "MalvinasSans-Regular.ttf",
    waltograph: "waltograph42.otf",
    waltographui: "waltographUI.ttf",
    simplehandmade: "SimpleHandmade.ttf",
    study_night: "Study Night.otf",
    study_person: "Study Person.otf",
    nostalgic: "Nostalgic Letter.otf",
    please_writ: "Please write me a song.ttf"
};

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^a-z0-9]/g, "");
}

function normalizeFileName(file) {
    const value = String(file || "").replace(/^\/+/, "");
    return value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
}

function localFontCatalog() {
    return BUILTIN_FONT_CATALOG.map(font => ({
        ...font,
        file: normalizeFileName(font.file)
    }));
}

async function getFontCatalog() {
    if (!fontCatalogPromise) {
        fontCatalogPromise = fetch("/api/fonts")
            .then(response => response.ok ? response.json() : [])
            .then(catalog => Array.isArray(catalog) && catalog.length ? catalog : localFontCatalog())
            .catch(() => localFontCatalog());
    }
    return fontCatalogPromise;
}

export function getBuiltinFontCatalog() {
    return localFontCatalog();
}

async function resolveFontFile(fontFamily) {
    const catalog = await getFontCatalog();
    const wanted = normalize(fontFamily);
    const matches = catalog.filter(font =>
        normalize(font.family) === wanted || normalize(font.name) === wanted
    );
    const match = matches.find(font => /\.(ttf|otf|woff)$/i.test(font.file));
    if (match?.file) return normalizeFileName(match.file);

    // A CSS family may be an alias rather than the family returned by the API.
    // Resolve aliases before giving up so a project can still be vectorized
    // offline and with a previously selected font.
    const alias = BUILTIN_FONT_ALIASES[wanted];
    if (alias) return alias;

    // The default font used by the editor is deliberately deterministic.
    if (!fontFamily || ["arial", "helvetica", "sans-serif", "sansserif"].includes(wanted)) {
        return "MalvinasSans-Regular.ttf";
    }

    throw new Error(`Fuente seleccionada sin formato vectorial compatible: ${fontFamily}`);
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

    // Build semantic topology through the shared contour contract. The old
    // route used a private bounds/center heuristic and then assumed depth
    // parity; that made multi-glyph strings such as OO ambiguous.
    const { nodes } = buildContourRelations(usable, { fillRule: "evenodd" });
    const contourMeta = nodes.map(node => {
        const record = {
            ...node.contourRecord,
            contourIndex: node.index,
            contourDepth: node.depth,
            isHole: node.isHole,
            originalIsHole: node.isHole,
            fillRule: "evenodd"
        };
        applyContourRecord(node.path, record);
        setSemanticKind(node.path, node.isHole ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID);
        node.path.data = { ...(node.path.data || {}),
            contourIndex: node.index,
            contourDepth: node.depth,
            contourRole: node.isHole ? "hole" : "outer",
            originalIsHole: node.isHole,
            fillRule: "evenodd", source: "text-vector" };
        return record;
    });
    compound.data = { ...(compound.data || {}), source: "text-vector", fillRule: "evenodd",
        originalFillRule: "evenodd", contours: contourMeta,
        hasInternalHoles: contourMeta.some(c => c.originalIsHole) };
    return compound;
}

if (typeof window !== "undefined") {
    window.EKKO_FONT_TO_PATH = { textToCompoundPath, resolveFontFile, getBuiltinFontCatalog };
}
