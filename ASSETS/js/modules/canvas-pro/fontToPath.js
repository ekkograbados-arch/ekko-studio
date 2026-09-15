/*
 * Conversión de glifos OpenType a geometría Paper.js.
 * Requiere opentype.js cargado como window.opentype.
 */

const DEFAULT_FONT_FILE = "MalvinasSans-Regular.ttf";
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
    const match = matches.find(font => /\.(ttf|otf|woff)$/i.test(font.file)) || matches[0];
    if (match?.file && /\.(ttf|otf|woff)$/i.test(match.file)) return match.file;
    return DEFAULT_FONT_FILE;
}

async function loadFont(fontFamily) {
    if (!window.opentype?.parse) {
        throw new Error("OpenType parse no está cargado");
    }
    const file = await resolveFontFile(fontFamily);
    const url = `/ASSETS/fonts/${encodeURIComponent(file)}`;
    if (!fontCache.has(url)) {
        fontCache.set(url, fetch(url)
            .then(response => {
                if (!response.ok) throw new Error(`Fuente no disponible: ${response.status}`);
                return response.arrayBuffer();
            })
            .then(buffer => window.opentype.parse(buffer)));
    }
    return fontCache.get(url);
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
    let offsetX = textItem.bounds.left;
    if (justification === "center") offsetX = textItem.point.x - advance / 2;
    if (justification === "right") offsetX = textItem.point.x - advance;

    const contours = [];
    let current = null;
    (glyphPath.commands || []).forEach(command => {
        if (command.type === "M") {
            current = new paper.Path({ insert: false });
            contours.push(current);
        }
        if (current) addContour(current, command, offsetX, textItem.point.y);
    });

    const usable = contours.filter(path => path.segments.length > 1);
    if (!usable.length) return null;
    const compound = new paper.CompoundPath({ insert: false, children: usable });
    compound.fillRule = "evenodd";
    compound.fillColor = textItem.fillColor ? textItem.fillColor.clone() : new paper.Color("#000");
    compound.strokeColor = textItem.strokeColor ? textItem.strokeColor.clone() : null;
    compound.strokeWidth = textItem.strokeWidth || 0;
    return compound;
}

window.EKKO_FONT_TO_PATH = { textToCompoundPath };
