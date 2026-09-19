import { getPublicOwner, getPublicOwners, isMockupOrMask } from "./designGeometry.js";
/* =========================================================================
Módulo: js/modules/canvas-pro/textToolbar.js (v7 PRO - LAZY LOADING OPTIMIZED)
Ruta de reemplazo: js/modules/canvas-pro/textToolbar.js
Descripción: Gestión de tipografías dinámicas con registro perezoso (Lazy Loading)
para eliminar por completo el delay de red de 2 minutos.
========================================================================= */

// 🚀 SILENCIADOR DE CONSOLA GLOBAL: Mantener la consola limpia de logs informativos o repetitivos


import { textToCompoundPath } from "./fontToPath.js";
import { stampDesignItem } from "./fusionCore.js";
import { buildContourRelations, applyContourRecord } from "./holeSemantics.js";
import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";

let loadedFontsCache = [];

// Diccionario de mapeo de alias tipográficos históricos para retrocompatibilidad absoluta
const LEGACY_FONT_ALIASES = {
    "billiejames": ["ekko_billie", "ekko_billiejames_regular"],
    "romantic": ["ekko_romantic", "ekko_romantic_sunrise"],
    "farmhouse": ["ekko_farmhouse"],
    "chocolate": ["ekko_chocolate"],
    "waltograph": ["ekko_disney", "ekko_waltograph", "ekko_waltograph42"],
    "simpson": ["ekko_simpson", "ekko_simpsonfont_demo"],
    "milk": ["ekko_milk", "ekko_milk_water"],
    "simplehandmade": ["ekko_simple"],
    "studynight": ["ekko_studynight"],
    "studyperson": ["ekko_studyperson"],
    "nostalgic": ["ekko_nostalgic"],
    "please writ": ["ekko_song"]
};

/**
 * Carga fuentes dinámicamente desde el endpoint del backend /api/fonts
 * ⚡ OPTIMIZACIÓN v7: Registro perezoso de FontFace (Lazy Loading) sin llamar a .load() de forma síncrona.
 * Esto elimina por completo el delay de 2 minutos al arrancar la página.
 */
export async function loadDynamicFonts() {
    if (loadedFontsCache.length > 0) return loadedFontsCache;

    try {
        const response = await fetch('/api/fonts');
        if (!response.ok) throw new Error("Endpoint api/fonts no disponible");
        const fontFiles = await response.json();
        if (!fontFiles || fontFiles.length === 0) {
            throw new Error("No se devolvieron tipografías desde el servidor.");
        }

        const loaded = [];
        for (const item of fontFiles) {
            let name, family, file;
            if (typeof item === 'string') {
                file = item;
                name = file.replace(/^.*[\/]/, '').replace(/\.[^/.]+$/, "");
                family = "ekko_" + name.toLowerCase().replace(/[^a-z0-9]/g, "_");
            } else if (item && typeof item === 'object') {
                name = item.name;
                family = item.family;
                file = item.file;
            } else {
                continue;
            }

            try {
                // 🚀 OPTIMIZACIÓN CLAVE (LAZY-LOADING): No descargamos la fuente de forma bloqueante conawait .load()
                // Solo creamos el objeto FontFace y lo registramos en document.fonts. El navegador la descargará
                // de forma transparente únicamente cuando el lienzo intente pintar un texto con dicha tipografía.
                const fontFace = new FontFace(family, `url(/ASSETS/fonts/${encodeURIComponent(file)})`, { display: 'swap' });
                document.fonts.add(fontFace);
                loaded.push({ name: name, family: family, file: file });

                // Registrar Alias Históricos de forma perezosa instantánea
                const lowerFile = file.toLowerCase();
                for (const [pattern, aliases] of Object.entries(LEGACY_FONT_ALIASES)) {
                    if (lowerFile.includes(pattern)) {
                        for (const alias of aliases) {
                            if (alias !== family) {
                                try {
                                    const aliasFace = new FontFace(alias, `url(/ASSETS/fonts/${encodeURIComponent(file)})`, { display: 'swap' });
                                    document.fonts.add(aliasFace);
                                } catch (aliasErr) {
                                    // Ignorar en silencio
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                // Ignorar error individual de fuente
            }
        }

        if (loaded.length === 0) {
            throw new Error("Ninguna tipografía dinámica pudo registrarse.");
        }
        loaded.sort((a, b) => a.name.localeCompare(b.name));
        loadedFontsCache = loaded;
        return loaded;
    } catch (e) {
        // No crear fuentes fantasma ni usar rutas alternativas: el catálogo único es /api/fonts.
        loadedFontsCache = [];
        if (typeof window !== 'undefined') window._ekkoFontCatalogError = String(e?.message || e);
        return loadedFontsCache;
    }
}

/**
 * Aplica deformación curva al texto distribuyendo letras sobre un arco (Estilo LightBurn)
 */
export async function applyTextCurve(item, curvature, options = {}) {
    if (!item || item.data?.locked) return;
    if (!options.skipHistory && typeof window.saveHistory === 'function') window.saveHistory();
    const numericCurvature = Number(curvature) || 0;

    if (Math.abs(numericCurvature) < 0.1) {
        if (item.data?.isCurvedGroup) {
            const flatText = restoreFlatText(window.selectedItem, item);
            if (flatText) {
                if (window.selectedItem === item) {
                    window.selectItem(flatText);
                }
                paper.view.update();
            }
        }
        return;
    }

    let textString = "";
    let fontSize = 42;
    let fontFamily = "Arial";
    let fillColor = new paper.Color(0);
    let fontWeight = "normal";
    let fontStyle = "normal";
    let targetItem = item;

    if (item.data?.isCurvedGroup) {
        textString = item.data.textString || "";
        fontSize = item.data.fontSize || 42;
        fontFamily = item.data.fontFamily || "Arial";
        fillColor = item.data.fillColor || new paper.Color(0);
        fontWeight = item.data.fontWeight || "normal";
        fontStyle = item.data.fontStyle || "normal";
    } else if (item instanceof paper.PointText) {
        textString = item.content;
        fontSize = item.fontSize;
        fontFamily = item.fontFamily;
        fillColor = item.fillColor;
        fontWeight = item.fontWeight || "normal";
        fontStyle = item.fontStyle || "normal";
        item.data = item.data || {};
        item.data.textString = textString;
        item.data.fontSize = fontSize;
        item.data.fontFamily = fontFamily;
        item.data.fillColor = fillColor;
        item.data.fontWeight = fontWeight;
        item.data.fontStyle = fontStyle;
    } else {
        const textChild = item.children.map(getPublicOwner).filter(Boolean).find(c => c instanceof paper.PointText || c.data?.isCurvedGroup);
        if (textChild) {
            applyTextCurve(textChild, curvature, options);
            window.updateSelectionBox(item);
            paper.view.update();
        }
        return;
    }

    removeCurveHandle();

    const curvedGroup = new paper.Group();
    curvedGroup.data = {
        ...targetItem.data,
        isCurvedGroup: true,
        textString: textString,
        fontSize: fontSize,
        fontFamily: fontFamily,
        fillColor: fillColor,
        fontWeight: fontWeight,
        fontStyle: fontStyle,
        curvature: numericCurvature,
        radius: Number(options.radius) || (Math.abs(numericCurvature) > 0.001 ? 10000 / Math.abs(numericCurvature) : 10000),
        hspace: Number(options.hspace ?? targetItem.data?.hspace ?? 0) || 0,
        // Curved text remains editable text, not a final Text-to-Vector owner.
        isTextVector: false,
        preserveCompoundTopology: true
    };

    const charCount = textString.length;
    if (charCount === 0) return;

    const signedRadius = Number(options.radius) || (10000 / numericCurvature);
    const radius = Math.abs(signedRadius) * (numericCurvature < 0 ? -1 : 1);
    const centerPoint = targetItem.bounds.center.clone();
    const arcCenter = new paper.Point(centerPoint.x, centerPoint.y + radius);
    const textWidth = textString.length * fontSize * 0.6 +
        Math.max(0, textString.length - 1) * (Number(options.hspace ?? targetItem.data?.hspace ?? 0) * fontSize * 0.02);
    const totalAngleRad = textWidth / radius;
    const totalAngleDeg = totalAngleRad * (180 / Math.PI);
    const startAngle = -90 - (totalAngleDeg / 2);
    const angleStep = totalAngleDeg / (charCount - 1 || 1);

    // Curved text must be geometry, not a group of PointText objects. Build each
    // glyph through the same OpenType path converter used by Text to Vector,
    // then map its world geometry into the eventual parent's local space.
    const parent = targetItem.parent;
    const toParent = (point) => parent?.globalToLocal ? parent.globalToLocal(point) : point;
    const worldToParent = (() => {
        if (!parent?.globalToLocal) return null;
        const o = parent.globalToLocal(new paper.Point(0, 0));
        const x = parent.globalToLocal(new paper.Point(1, 0)).subtract(o);
        const y = parent.globalToLocal(new paper.Point(0, 1)).subtract(o);
        return new paper.Matrix(x.x, x.y, y.x, y.y, o.x, o.y);
    })();

    for (let i = 0; i < charCount; i++) {
        const char = textString[i];
        const angle = startAngle + (i * angleStep);
        const angleRad = angle * (Math.PI / 180);
        const point = new paper.Point(arcCenter.x + radius * Math.cos(angleRad), arcCenter.y + radius * Math.sin(angleRad));
        const temp = new paper.PointText({ insert: false, point, content: char, fontSize, fontFamily,
            fillColor, fontWeight, fontStyle, justification: "center" });
        temp.rotate(angle + 90, temp.point);
        const glyph = await textToCompoundPath(temp);
        temp.remove();
        if (!glyph) continue;
        glyph.fillRule = "evenodd";
        if (worldToParent) glyph.transform(worldToParent);
        curvedGroup.addChild(glyph);
    }

    curvedGroup.data.fillRule = "evenodd";
    curvedGroup.data.isTextVector = false;
    delete curvedGroup.data.isTextVector;
    drawBlueCurveHandle(curvedGroup);

    if (parent) {
        const index = parent.children.indexOf(targetItem);
        parent.insertChild(index, curvedGroup);
    }
    targetItem.remove();

    if (window.selectedItem === targetItem) {
        window.commitSelection?.(curvedGroup, window.selectedItems);
        window.updateSelectionBox(curvedGroup);
    }
    paper.view.update();
}

export function restoreFlatText(item, curvedGroup) {
    const textStr = curvedGroup.data.textString || "Texto";
    const flatText = new paper.PointText({
        point: curvedGroup.bounds.bottomCenter,
        content: textStr,
        fontSize: curvedGroup.data.fontSize || 42,
        fontFamily: curvedGroup.data.fontFamily || "Arial",
        fillColor: curvedGroup.data.fillColor || new paper.Color(0),
        fontWeight: curvedGroup.data.fontWeight || "normal",
        fontStyle: curvedGroup.data.fontStyle || "normal",
        justification: "center"
    });
    flatText.data = { ...curvedGroup.data, isCurvedGroup: false, isTextVector: false };
    delete flatText.data.isTextVector;
    delete flatText.data.curvature;
    delete flatText.data.radius;

    const parent = curvedGroup.parent;
    if (parent) {
        const index = parent.children.indexOf(curvedGroup);
        parent.insertChild(index, flatText);
    }
    removeCurveHandle();
    curvedGroup.remove();
    return flatText;
}

function removeCurveHandle() {
    const handle = typeof window !== 'undefined' ? window._ekkoCurveHandle : null;
    if (handle?.project) {
        try { handle.remove(); } catch (e) {}
    }
    if (typeof window !== 'undefined') window._ekkoCurveHandle = null;
}

export function drawBlueCurveHandle(group) {
    removeCurveHandle();

    // El handle es overlay de edición, no geometría del texto. Mantenerlo
    // fuera del curvedGroup evita contaminar bounds, restauración y exportación.
    const bounds = group.bounds;
    const handlePoint = new paper.Point(bounds.center.x, bounds.bottom + 15);
    const handle = new paper.Path.Circle({
        center: handlePoint,
        radius: 6 / paper.view.zoom,
        fillColor: '#00d2ff',
        strokeColor: '#007bff',
        strokeWidth: 1.5 / paper.view.zoom
    });
    handle.data = { isCurveHandle: true, isHandle: true, curveOwnerId: group.id };
    const overlayLayer = paper.project.layers?.find(layer => layer.data?.isOverlayLayer) || paper.project.activeLayer;
    overlayLayer.addChild(handle);
    handle.bringToFront();
    if (typeof window !== 'undefined') window._ekkoCurveHandle = handle;
}

export function applyTextSpacing(item, hspace) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = item;
    if (item.data?.clipGroup) {
        target = getPublicOwner(item);
    }

    if (target instanceof paper.PointText) {
        target.data = target.data || {};
        target.data.hspace = hspace;
        const content = target.content;
        const fontSize = target.fontSize;
        const fontFamily = target.fontFamily;
        const fillColor = target.fillColor;
        const fontWeight = target.fontWeight;
        const fontStyle = target.fontStyle;

        const spacedGroup = new paper.Group();
        spacedGroup.data = {
            ...target.data,
            isSpacedGroup: true,
            textString: content,
            fontSize: fontSize,
            fontFamily: fontFamily,
            fillColor: fillColor,
            fontWeight: fontWeight,
            fontStyle: fontStyle,
            hspace: hspace
        };

        let currentX = target.bounds.left;
        const y = target.point.y;

        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            const charText = new paper.PointText({
                point: new paper.Point(currentX, y),
                content: char,
                fontSize: fontSize,
                fontFamily: fontFamily,
                fillColor: fillColor,
                fontWeight: fontWeight,
                fontStyle: fontStyle
            });
            spacedGroup.addChild(charText);
            currentX += charText.bounds.width + (hspace * fontSize * 0.02);
        }

        const parent = target.parent;
        if (parent) {
            const index = parent.children.indexOf(target);
            parent.insertChild(index, spacedGroup);
        }
        target.remove();

        if (window.selectedItem === item) {
            window.commitSelection?.(spacedGroup, window.selectedItems);
            window.updateSelectionBox(spacedGroup);
        }
    } else if (target.data?.isCurvedGroup) {
        target.data.hspace = hspace;
        applyTextCurve(target, target.data.curvature);
    } else if (target.data?.isSpacedGroup) {
        const flat = restoreFlatText(item, target);
        applyTextSpacing(flat, hspace);
    }
    paper.view.update();
}

function findTextTarget(item) {
    const owner = getPublicOwner(item);
    if (!owner || isMockupOrMask(owner)) return null;
    if (owner instanceof paper.PointText || owner.data?.isCurvedGroup || owner.data?.isSpacedGroup) return owner;
    if (owner.children) {
        for (const child of owner.children) {
            const publicChild = getPublicOwner(child);
            if (publicChild && publicChild !== owner && !isMockupOrMask(publicChild)) {
                const found = findTextTarget(publicChild);
                if (found) return found;
            }
        }
    }
    return null;
}

export async function weldText(item) {
    const describe = (value) => value ? {
        className: value.className || value.constructor?.name || null,
        id: value.id ?? null,
        label: value.data?.label ?? null,
        clipGroup: !!value.data?.clipGroup,
        isTextVector: !!value.data?.isTextVector,
        isCurvedGroup: !!value.data?.isCurvedGroup,
        isSpacedGroup: !!value.data?.isSpacedGroup,
        parentClass: value.parent?.className || value.parent?.constructor?.name || null
    } : null;
    const diag = window._ekkoTextVectorDiag = {
        phase: "weldText:start",
        item: describe(item),
        selectedItem: describe(window.selectedItem),
        selectedItems: Array.isArray(window.selectedItems) ? window.selectedItems.map(describe) : [],
        target: null,
        fontFamily: null,
        resolution: null,
        acceptedTarget: false,
        convertedClass: null,
        resultClass: null,
        returnValue: null,
        geometry: null
    };
    if (!item || item.data?.locked) {
        diag.phase = "weldText:rejected-item";
        diag.returnValue = null;
        return null;
    }
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = findTextTarget(item);
    if (!target && item && (item.data?.isCurvedGroup || item.data?.isSpacedGroup)) target = item;
    diag.target = describe(target);
    diag.fontFamily = target?.fontFamily || null;
    diag.acceptedTarget = !!(target && (
        target instanceof paper.PointText ||
        target.data?.isCurvedGroup ||
        target.data?.isSpacedGroup
    ));

    if (!diag.acceptedTarget) {
        diag.phase = "weldText:rejected-target";
        diag.returnValue = null;
        return null;
    }

    const pathGroup = target.clone({ insert: false });
    // Paper.js no ofrece contornos para PointText. La ruta OpenType genera
    // CompoundPath real y conserva los contornos internos de los glifos.
    let converted = null;
    let referenceBounds = null;
    try {
        if (target instanceof paper.PointText && document.fonts?.load) {
            await document.fonts.load(`${Number(target.fontSize) || 42}px "${target.fontFamily}"`, target.content || "");
            paper.view.update();
            // Referencia visual después de cargar la familia real.
            referenceBounds = target.bounds.clone();
        }
        converted = target instanceof paper.PointText
            ? await textToCompoundPath(target)
            : pathGroup;
    } catch (error) {
        diag.phase = "weldText:font-load-failed";
        diag.error = String(error?.message || error);
        try { pathGroup.remove(); } catch (e) {}
        diag.returnValue = null;
        return null;
    }
    diag.resolution = window._ekkoFontResolution || null;
    diag.phase = "weldText:converted";
    diag.convertedClass = converted?.className || converted?.constructor?.name || null;
    const usable = converted?.children?.length
        ? Array.from(converted.children).filter(Boolean)
        : (converted ? [converted] : []);
    if (!usable.length) {
        diag.phase = "weldText:no-usable-geometry";
        try { pathGroup.remove(); } catch (e) {}
        try { converted?.remove?.(); } catch (e) {}
        diag.returnValue = null;
        return null;
    }

    // Nunca unir los subtrazados del CompoundPath: unite() convierte los
    // contornos internos de A/O/P/R en sólidos y rellena sus huecos.
    // La topología evenodd del CompoundPath es la autoridad geométrica.
    const resultPath = converted.clone({ insert: false });
    resultPath.fillRule = "evenodd";
    resultPath.fillColor = target.fillColor || new paper.Color(0);
    resultPath.strokeColor = null;
    resultPath.strokeWidth = 0;
    // geomBase is the canonical hit-test/CSG geometry. It must be captured
    // only after the final world calibration below; taking it before scale /
    // translation leaves pointer selection and the visible owner divergent.

    const parent = target.parent;
    if (parent) {
        const index = parent.children.indexOf(target);
        parent.insertChild(index, resultPath);
        // PointText's transform belongs to the public owner. Apply it once to
        // the new owner; fontToPath intentionally returned identity-local data.
        if (target.matrix && resultPath.matrix) resultPath.matrix = target.matrix.clone();
    }

    // Calibración final contra la geometría visual del PointText. Esto evita
    // que una matriz del clipGroup, un fallback previo o las métricas de un
    // glifo en mayúscula/minúscula reduzcan la selección al vectorizar.
    const beforeNormalize = resultPath.bounds.clone();
    if (referenceBounds && beforeNormalize.width > 0 && beforeNormalize.height > 0) {
        const sx = referenceBounds.width / beforeNormalize.width;
        const sy = referenceBounds.height / beforeNormalize.height;
        // Paper.js interpreta position/translate de forma local al parent.
        // Convertir directamente a position global desplaza el texto cuando
        // el owner vive dentro de clipGroup. Escalamos y luego trasladamos con
        // delta global convertido al sistema local del parent.
        resultPath.scale(sx, sy);
        const globalDelta = referenceBounds.center.subtract(resultPath.bounds.center);
        const ownerParent = resultPath.parent;
        if (ownerParent?.globalToLocal && resultPath.localToGlobal) {
            const globalOrigin = resultPath.localToGlobal(new paper.Point(0, 0));
            const globalMoved = globalOrigin.add(globalDelta);
            const localOrigin = ownerParent.globalToLocal(globalOrigin);
            const localMoved = ownerParent.globalToLocal(globalMoved);
            resultPath.translate(localMoved.subtract(localOrigin));
        } else {
            resultPath.translate(globalDelta);
        }
        diag.geometry = {
            reference: { width: referenceBounds.width, height: referenceBounds.height, center: referenceBounds.center },
            before: { width: beforeNormalize.width, height: beforeNormalize.height },
            after: { width: resultPath.bounds.width, height: resultPath.bounds.height },
            scale: { x: sx, y: sy }
        };
    }
    // Snapshot the calibrated geometry in the same local space as the public
    // owner.  Cloning now preserves rotation/scale/position for frame and
    // hit-test consumers; the snapshot itself is intentionally identity-local.
    const calibratedBase = resultPath.clone({ insert: false });
    calibratedBase.fillRule = "evenodd";
    const baseMatrix = calibratedBase.matrix?.clone?.();
    calibratedBase.applyMatrix = false;
    calibratedBase.matrix = new paper.Matrix();
    if (baseMatrix && !baseMatrix.isIdentity()) calibratedBase.transform(baseMatrix);
    calibratedBase.applyMatrix = false;
    calibratedBase.matrix = new paper.Matrix();
    resultPath.data.geomBase = calibratedBase;
    resultPath.data.fillRule = "evenodd";
    // Never infer "all contours after index zero are holes". That fallback
    // turns the outer contour of the second glyph in OO into a false hole.
    const resultChildren = Array.from(resultPath.children || []).filter(Boolean);
    let contourRecords = Array.isArray(converted.data?.contours)
        ? converted.data.contours.map((record, index) => ({ ...record, contourIndex: record.contourIndex ?? index }))
        : null;
    if (!contourRecords?.length && resultChildren.length) {
        const classified = buildContourRelations(resultChildren, { fillRule: "evenodd" });
        contourRecords = classified.nodes.map(node => {
            const record = {
                ...node.contourRecord,
                contourIndex: node.index,
                contourDepth: node.depth,
                originalIsHole: node.isHole,
                contourRole: node.isHole ? "hole" : "outer",
                fillRule: "evenodd"
            };
            applyContourRecord(node.path, record);
            setSemanticKind(node.path, node.isHole ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID);
            return record;
        });
    }
    if (!contourRecords?.length) {
        diag.phase = "weldText:missing-contour-semantics";
        try { resultPath.remove(); } catch (_) {}
        try { converted.remove(); } catch (_) {}
        try { pathGroup.remove(); } catch (_) {}
        diag.returnValue = null;
        return null;
    }
    resultPath.data.contours = contourRecords;
    // La identidad semántica se estampa después de calibrar la geometría y
    // antes de publicarla. Nunca se publica un vector a medio registrar.
    setSemanticKind(resultPath, VECTOR_KIND.SOLID);
    stampDesignItem(resultPath, {
        source: "text-vector",
        role: "letter",
        isTextVector: true,
        isFusionReceptor: true,
        hasInternalHoles: true
    });
    resultPath.data = { ...(resultPath.data || {}), source: "text-vector", role: "letter",
        isTextVector: true, isFusionReceptor: true, hasInternalHoles: true,
        fillRule: "evenodd", geomBase: resultPath.data.geomBase };
    target.remove();
    try { converted.remove(); } catch (e) {}
    try { pathGroup.remove(); } catch (e) {}

    // La conversión fue invocada sobre la selección pública; siempre debe
    // publicar el nuevo vector, aunque el target sea un hijo de clipGroup.
    if (typeof window.selectItem === "function") {
        window.selectItem(resultPath);
        // La selección central puede resolver wrappers históricos. El owner
        // recién creado es el CompoundPath y debe quedar publicado como tal.
        if (window.selectedItem !== resultPath && typeof window.commitSelection === "function") {
            window.commitSelection(resultPath, [resultPath]);
            window.updateContextualMenu?.(resultPath);
        }
    } else {
        window.commitSelection?.(resultPath, [resultPath]);
    }
    window.updateSelectionBox?.(resultPath);
    window.refreshEKKOSharedCommands?.();
    diag.phase = "weldText:success";
    diag.resultClass = resultPath.className || resultPath.constructor?.name || null;
    diag.returnValue = describe(resultPath);
    paper.view.update();
    return resultPath;
}

export function convertTextToVector(item = null) {
    const selected = item || window.selectedItem ||
        (Array.isArray(window.selectedItems) ? window.selectedItems[window.selectedItems.length - 1] : null);
    window._ekkoTextVectorDispatch = {
        selected: selected ? {
            className: selected.className || selected.constructor?.name || null,
            label: selected.data?.label ?? null,
            clipGroup: !!selected.data?.clipGroup,
            childCount: selected.children?.length ?? 0
        } : null,
        at: Date.now()
    };
    return weldText(selected);
}

export function toggleBold(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = item;
    if (item.data?.clipGroup) {
        target = getPublicOwner(item);
    }

    const toggleBoldState = (txtItem) => {
        const currentWeight = txtItem.fontWeight || "normal";
        txtItem.fontWeight = currentWeight === "bold" ? "normal" : "bold";
    };

    if (target instanceof paper.PointText) {
        toggleBoldState(target);
    } else if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
        const currentWeight = target.data.fontWeight || "normal";
        const newWeight = currentWeight === "bold" ? "normal" : "bold";
        target.data.fontWeight = newWeight;
        target.children.forEach(child => {
            if (child instanceof paper.PointText) {
                child.fontWeight = newWeight;
            }
        });
    }
    paper.view.update();
}

export function toggleItalic(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = item;
    if (item.data?.clipGroup) {
        target = getPublicOwner(item);
    }

    const toggleItalicState = (txtItem) => {
        const currentStyle = txtItem.fontStyle || "normal";
        txtItem.fontStyle = currentStyle === "italic" ? "normal" : "italic";
    };

    if (target instanceof paper.PointText) {
        toggleItalicState(target);
    } else if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
        const currentStyle = target.data.fontStyle || "normal";
        const newStyle = currentStyle === "italic" ? "normal" : "italic";
        target.data.fontStyle = newStyle;
        target.children.forEach(child => {
            if (child instanceof paper.PointText) {
                child.fontStyle = newStyle;
            }
        });
    }
    paper.view.update();
}

export function toggleUnderline(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = item;
    if (item.data?.clipGroup) {
        target = getPublicOwner(item);
    }

    if (target instanceof paper.Group && target.data?.isUnderlinedGroup) {
        const line = target.children.find(c => c.data?.isUnderlineLine);
        const originalText = target.children.find(c => c !== line);
        if (originalText && line) {
            const parent = target.parent;
            const index = parent.children.indexOf(target);
            parent.insertChild(index, originalText);
            line.remove();
            target.remove();
            if (window.selectedItem === item) {
                window.commitSelection?.(originalText, window.selectedItems);
                window.updateSelectionBox(originalText);
            }
        }
    } else {
        const bounds = target.bounds;
        const y = bounds.bottom + 2;
        const underlineLine = new paper.Path.Line({
            from: new paper.Point(bounds.left, y),
            to: new paper.Point(bounds.right, y),
            strokeColor: target.fillColor || target.strokeColor || new paper.Color(0),
            strokeWidth: 2 / paper.view.zoom
        });
        underlineLine.data = { isUnderlineLine: true };

        const group = new paper.Group();
        group.data = { ...target.data, isUnderlinedGroup: true };
        const parent = target.parent;
        if (parent) {
            const index = parent.children.indexOf(target);
            parent.insertChild(index, group);
        }
        group.addChild(target);
        group.addChild(underlineLine);

        if (window.selectedItem === item) {
            window.commitSelection?.(group, window.selectedItems);
            window.updateSelectionBox(group);
        }
    }
    paper.view.update();
}
