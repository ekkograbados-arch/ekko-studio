/* =========================================================================
Módulo: js/modules/canvas-pro/textToolbar.js (v7 PRO - LAZY LOADING OPTIMIZED)
Ruta de reemplazo: js/modules/canvas-pro/textToolbar.js
Descripción: Gestión de tipografías dinámicas con registro perezoso (Lazy Loading)
para eliminar por completo el delay de red de 2 minutos.
========================================================================= */

// 🚀 SILENCIADOR DE CONSOLA GLOBAL: Mantener la consola limpia de logs informativos o repetitivos


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

    const fallbacks = [
        { name: "Nostalgic Letter", family: "ekko_nostalgic_letter", file: "Nostalgic Letter.woff2" },
        { name: "Please write me a song", family: "ekko_please_write_me_a_song", file: "Please write me a song.woff2" },
        { name: "SimpleHandmade", family: "ekko_simplehandmade", file: "SimpleHandmade.woff2" }
    ];

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
        // Fallback local perezoso
        for (const f of fallbacks) {
            try {
                const fontFace = new FontFace(f.family, `url(/ASSETS/fonts/${encodeURIComponent(f.file)})`, { display: 'swap' });
                document.fonts.add(fontFace);
            } catch (err) {
                // Ignorar
            }
        }
        fallbacks.sort((a, b) => a.name.localeCompare(b.name));
        loadedFontsCache = fallbacks;
        return fallbacks;
    }
}

/**
 * Aplica deformación curva al texto distribuyendo letras sobre un arco (Estilo LightBurn)
 */
export function applyTextCurve(item, curvature) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    if (Math.abs(curvature) < 0.1) {
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
        const textChild = item.children.find(c => c instanceof paper.PointText || c.data?.isCurvedGroup);
        if (textChild) {
            applyTextCurve(textChild, curvature);
            window.updateSelectionBox(item);
            paper.view.update();
        }
        return;
    }

    const oldHandle = targetItem.children ? targetItem.children.find(c => c.data?.isCurveHandle) : null;
    if (oldHandle) oldHandle.remove();

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
        curvature: curvature
    };

    const charCount = textString.length;
    if (charCount === 0) return;

    const radius = 10000 / curvature;
    const centerPoint = targetItem.bounds.center.clone();
    const arcCenter = new paper.Point(centerPoint.x, centerPoint.y + radius);

    const textWidth = textString.length * fontSize * 0.6;
    const totalAngleRad = textWidth / radius;
    const totalAngleDeg = totalAngleRad * (180 / Math.PI);
    const startAngle = -90 - (totalAngleDeg / 2);
    const angleStep = totalAngleDeg / (charCount - 1 || 1);

    for (let i = 0; i < charCount; i++) {
        const char = textString[i];
        const angle = startAngle + (i * angleStep);
        const angleRad = angle * (Math.PI / 180);
        const x = arcCenter.x + radius * Math.cos(angleRad);
        const y = arcCenter.y + radius * Math.sin(angleRad);

        const charText = new paper.PointText({
            point: new paper.Point(x, y),
            content: char,
            fontSize: fontSize,
            fontFamily: fontFamily,
            fillColor: fillColor,
            fontWeight: fontWeight,
            fontStyle: fontStyle,
            justification: "center"
        });

        const normalAngle = angle + 90;
        charText.rotate(normalAngle, charText.point);
        curvedGroup.addChild(charText);
    }

    drawBlueCurveHandle(curvedGroup);

    const parent = targetItem.parent;
    if (parent) {
        const index = parent.children.indexOf(targetItem);
        parent.insertChild(index, curvedGroup);
    }
    targetItem.remove();

    if (window.selectedItem === targetItem) {
        window.selectedItem = curvedGroup;
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
    flatText.data = { ...curvedGroup.data, isCurvedGroup: false };
    delete flatText.data.curvature;

    const parent = curvedGroup.parent;
    if (parent) {
        const index = parent.children.indexOf(curvedGroup);
        parent.insertChild(index, flatText);
    }
    curvedGroup.remove();
    return flatText;
}

export function drawBlueCurveHandle(group) {
    const oldHandle = group.children.find(c => c.data?.isCurveHandle);
    if (oldHandle) oldHandle.remove();

    const bounds = group.bounds;
    const handlePoint = new paper.Point(bounds.center.x, bounds.bottom + 15);
    const handle = new paper.Path.Circle({
        center: handlePoint,
        radius: 6 / paper.view.zoom,
        fillColor: '#00d2ff',
        strokeColor: '#007bff',
        strokeWidth: 1.5 / paper.view.zoom
    });
    handle.data = { isCurveHandle: true, isHandle: true };
    group.addChild(handle);
}

export function applyTextSpacing(item, hspace) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = item;
    if (item.data?.clipGroup) {
        target = item.children.find(c => !c.clipMask);
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
            window.selectedItem = spacedGroup;
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

export function weldText(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = item;
    if (item.data?.clipGroup) {
        target = item.children.find(c => !c.clipMask);
    }

    if (target instanceof paper.PointText || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
        const pathGroup = target.clone();
        const converted = pathGroup.createShape ? pathGroup.toPath() : pathGroup;
        if (converted.children && converted.children.length > 0) {
            let resultPath = converted.children[0].clone();
            for (let i = 1; i < converted.children.length; i++) {
                const child = converted.children[i];
                const union = resultPath.unite(child);
                if (union) {
                    resultPath.remove();
                    resultPath = union;
                }
            }
            resultPath.fillColor = target.fillColor || new paper.Color(0);
            resultPath.strokeColor = null;
            resultPath.data = { ...target.data, locked: false, label: "Texto Unido (Weld)" };

            const parent = target.parent;
            if (parent) {
                const index = parent.children.indexOf(target);
                parent.insertChild(index, resultPath);
            }
            target.remove();
            converted.remove();

            if (window.selectedItem === item) {
                window.selectedItem = resultPath;
                window.updateSelectionBox(resultPath);
            }
        }
    }
    paper.view.update();
}

export function toggleBold(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = item;
    if (item.data?.clipGroup) {
        target = item.children.find(c => !c.clipMask);
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
        target = item.children.find(c => !c.clipMask);
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
        target = item.children.find(c => !c.clipMask);
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
                window.selectedItem = originalText;
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
            window.selectedItem = group;
            window.updateSelectionBox(group);
        }
    }
    paper.view.update();
}
