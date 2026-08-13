/**
 * ASSETS/js/modules/canvas-pro/textToolbar.js
 * Módulo independiente para el procesamiento, carga dinámica de fuentes y control de textos (Estilo LightBurn).
 */

let loadedFontsCache = [];

// Cargar fuentes dinámicamente desde el endpoint del backend /api/fonts
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
        
        // CORRECCIÓN SENSACIONAL: Si el backend responde exitosamente pero devuelve un array vacío (ej. en Vercel)
        // forzamos el lanzamiento de un error para que la carga salte al bloque catch e inyecte los woff2 de respaldo.
        if (!fontFiles || fontFiles.length === 0) {
            throw new Error("No se devolvieron tipografías desde el servidor.");
        }

        const loaded = [];

        for (const item of fontFiles) {
            let name, family, file;
            if (typeof item === 'string') {
                file = item;
                name = file.replace(/\.[^/.]+$/, "");
                family = "ekko_" + name.toLowerCase().replace(/[^a-z0-9]/g, "_");
            } else if (item && typeof item === 'object') {
                name = item.name;
                family = item.family;
                file = item.file;
            } else {
                continue;
            }
            
            try {
                const fontFace = new FontFace(family, `url(/ASSETS/fonts/${encodeURIComponent(file)})`, { display: 'swap' });
                const loadedFace = await fontFace.load();
                document.fonts.add(loadedFace);
                loaded.push({ name: name, family: family, file: file });
            } catch (err) {
                console.warn(`No se pudo cargar la tipografía dinámica: ${file}`, err);
            }
        }

        if (loaded.length === 0) {
            throw new Error("Ninguna tipografía dinámica pudo registrarse de forma exitosa.");
        }

        // Ordenar alfabéticamente
        loaded.sort((a, b) => a.name.localeCompare(b.name));
        loadedFontsCache = loaded;
        return loaded;
    } catch (e) {
        console.warn("Inyectando fuentes locales de respaldo por error de red o backend vacío:", e);
        // Registrar fuentes fallback de forma segura
        for (const f of fallbacks) {
            try {
                const fontFace = new FontFace(f.family, `url(/ASSETS/fonts/${encodeURIComponent(f.file)})`, { display: 'swap' });
                const loadedFace = await fontFace.load();
                document.fonts.add(loadedFace);
            } catch (err) {
                console.error("Error cargando fuente estática local:", err);
            }
        }
        fallbacks.sort((a, b) => a.name.localeCompare(b.name));
        loadedFontsCache = fallbacks;
        return fallbacks;
    }
}

// Aplicar deformación curva al texto distribuyendo letras sobre un arco (Estilo LightBurn)
export function applyTextCurve(item, curvature) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    // Guardar el estado de curvatura en los metadatos del objeto
    target.data = target.data || {};
    target.data.curvature = curvature;

    // Si la curvatura es casi cero, restaurar a texto plano normal
    if (Math.abs(curvature) < 0.001) {
        if (target.data.isCurvedGroup) {
            restoreFlatText(item, target);
        }
        return;
    }

    const textStr = target.data.textString || target.content || "Texto";
    const fontFamily = target.fontFamily || "Arial";
    const fontSize = target.fontSize || 42;
    const fillColor = target.fillColor || new paper.Color(0);

    // Si ya es un grupo de letras curvas, trabajamos sobre él; si no, creamos la estructura
    let glyphGroup;
    if (target.data.isCurvedGroup) {
        glyphGroup = target;
        glyphGroup.clear();
    } else {
        // Convertir PointText plano a un Grupo de glifos deformados
        glyphGroup = new paper.Group();
        glyphGroup.data = { ...target.data, isCurvedGroup: true, textString: textStr };
        
        // Reemplazar el target plano en el lienzo o dentro de la máscara de recorte
        if (item.data?.clipGroup) {
            const idx = item.children.indexOf(target);
            item.insertChild(idx, glyphGroup);
            target.remove();
        } else {
            const idx = paper.project.activeLayer.children.indexOf(item);
            paper.project.activeLayer.insertChild(idx, glyphGroup);
            item.remove();
            window.selectItem(glyphGroup);
        }
    }

    const chars = textStr.split("");
    const numChars = chars.length;
    if (numChars === 0) return;

    // Radio de curvatura inverso
    const radius = 2000 / curvature; 
    const centerPoint = new paper.Point(0, radius);
    const arcAngle = (numChars * fontSize * 0.6) / radius; // Ángulo total ocupado por el arco en radianes
    const startAngle = -Math.PI / 2 - (arcAngle / 2);

    for (let i = 0; i < numChars; i++) {
        const char = chars[i];
        if (char === " ") continue; // Omitir espacios pero mantener separación física

        const t = numChars > 1 ? i / (numChars - 1) : 0.5;
        const angle = startAngle + (t * arcAngle);

        const x = centerPoint.x + radius * Math.cos(angle);
        const y = centerPoint.y + radius * Math.sin(angle);

        const glyph = new paper.PointText({
            point: [x, y],
            content: char,
            fontFamily: fontFamily,
            fontSize: fontSize,
            fillColor: fillColor,
            justification: "center"
        });

        // Rotar cada glifo para que sea perpendicular al radio (frente de grabado láser perpendicular)
        const rotationAngle = (angle * 180 / Math.PI) + 90;
        glyph.rotate(rotationAngle, glyph.bounds.bottomCenter);
        glyphGroup.addChild(glyph);
    }

    // Dibujar el tirador o punto azul de doblado de LightBurn en el extremo superior derecho del arco
    drawBlueCurveHandle(glyphGroup);

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(glyphGroup);
    }
    paper.view.update();
}

function restoreFlatText(item, curvedGroup) {
    const textStr = curvedGroup.data.textString || "Texto";
    const flatText = new paper.PointText({
        point: curvedGroup.bounds.bottomCenter,
        content: textStr,
        fontSize: curvedGroup.data.fontSize || 42,
        fontFamily: curvedGroup.data.fontFamily || "Arial",
        fillColor: curvedGroup.data.fillColor || new paper.Color(0),
        justification: "center"
    });
    flatText.data = { ...curvedGroup.data, isCurvedGroup: false };
    delete flatText.data.curvature;

    if (item.data?.clipGroup) {
        const idx = item.children.indexOf(curvedGroup);
        item.insertChild(idx, flatText);
        curvedGroup.remove();
    } else {
        const idx = paper.project.activeLayer.children.indexOf(item);
        paper.project.activeLayer.insertChild(idx, flatText);
        item.remove();
        window.selectItem(flatText);
    }
}

function drawBlueCurveHandle(group) {
    const oldHandle = group.children.find(c => c.data?.isCurveHandle);
    if (oldHandle) oldHandle.remove();

    const bounds = group.bounds;
    const handlePoint = bounds.topRight.add(new paper.Point(10, -10));

    const blueCircle = new paper.Path.Circle({
        center: handlePoint,
        radius: 6 / paper.view.zoom,
        fillColor: '#00d2ff',
        strokeColor: '#ffffff',
        strokeWidth: 1.5
    });
    blueCircle.data = { isCurveHandle: true, mockup: true }; // 'mockup: true' para que no sea exportado en el grabado láser
    group.addChild(blueCircle);
}

// Convertir las fuentes tipográficas superpuestas o cursivas a trazados vectoriales unidos (Soldadura de curvas)
export function weldText(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    const svgElement = target.exportSVG({ asString: false });
    paper.project.activeLayer.importSVG(svgElement, (vectorGroup) => {
        if (!vectorGroup) return;

        const childrenPaths = [];
        vectorGroup.children.forEach(child => {
            if (child instanceof paper.Path || child instanceof paper.CompoundPath) {
                childrenPaths.push(child);
            } else if (child instanceof paper.Group) {
                child.children.forEach(subChild => {
                    if (subChild instanceof paper.Path || subChild instanceof paper.CompoundPath) {
                        childrenPaths.push(subChild);
                    }
                });
            }
        });

        if (childrenPaths.length === 0) {
            vectorGroup.remove();
            return;
        }

        let weldedPath = childrenPaths;
        for (let i = 1; i < childrenPaths.length; i++) {
            const nextPath = childrenPaths[i];
            const temp = weldedPath.unite(nextPath);
            weldedPath.remove();
            nextPath.remove();
            weldedPath = temp;
        }

        weldedPath.fillColor = target.fillColor || new paper.Color(0);
        weldedPath.strokeColor = target.strokeColor || null;
        weldedPath.data = { ...target.data, label: "Texto Soldado" };

        if (item.data?.clipGroup) {
            const idx = item.children.indexOf(target);
            item.insertChild(idx, weldedPath);
            target.remove();
            vectorGroup.remove();
        } else {
            const idx = paper.project.activeLayer.children.indexOf(item);
            paper.project.activeLayer.insertChild(idx, weldedPath);
            item.remove();
            vectorGroup.remove();
            window.selectItem(weldedPath);
        }

        paper.view.update();
    });
}

// Alternar estilo de negrita (Bold) con soporte para grupos de texto curvo
export function toggleBold(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (target) {
        if (target instanceof paper.PointText) {
            const isBold = target.fontWeight === 'bold' || target.fontWeight === 700;
            target.fontWeight = isBold ? 'normal' : 'bold';
        } else if (target instanceof paper.Group) {
            let anyBold = false;
            target.children.forEach(child => {
                if (child instanceof paper.PointText && (child.fontWeight === 'bold' || child.fontWeight === 700)) {
                    anyBold = true;
                }
            });
            target.children.forEach(child => {
                if (child instanceof paper.PointText) {
                    child.fontWeight = anyBold ? 'normal' : 'bold';
                }
            });
        }
        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(item);
        }
        paper.view.update();
    }
}

// Alternar estilo de cursiva (Italic / Inclinado) inclinando hacia la DERECHA (Estilo LightBurn)
export function toggleItalic(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (target) {
        target.data = target.data || {};
        const isItalic = target.data.isItalicSkewed || false;
        
        // slantAngle negativo para que la inclinación sea HACIA LA DERECHA (italics convencionales)
        const slantAngle = -0.22; 

        if (isItalic) {
            target.shear(-slantAngle, 0, target.bounds.bottomCenter);
            target.data.isItalicSkewed = false;
        } else {
            target.shear(slantAngle, 0, target.bounds.bottomCenter);
            target.data.isItalicSkewed = true;
        }

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(item);
        }
        paper.view.update();
    }
}

// Alternar subrayado (Underline) de forma geométrica compatible con corte
export function toggleUnderline(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const isGroup = item.data?.clipGroup;
    const parentGroup = isGroup ? item : null;
    const target = isGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    const underlineId = "underline_path_" + target.id;
    const existingLine = isGroup 
        ? item.children.find(c => c.data?.underlineId === underlineId)
        : paper.project.activeLayer.children.find(c => c.data?.underlineId === underlineId);

    if (existingLine) {
        existingLine.remove();
    } else {
        const bounds = target.bounds;
        const start = new paper.Point(bounds.bottomLeft.x, bounds.bottomLeft.y + 4);
        const end = new paper.Point(bounds.bottomRight.x, bounds.bottomRight.y + 4);

        const line = new paper.Path.Line({
            from: start,
            to: end,
            strokeColor: target.fillColor || new paper.Color(0),
            strokeWidth: Math.max(1.5, target.fontSize * 0.05)
        });
        line.data = { underlineId: underlineId, mockup: false };

        if (isGroup && parentGroup) {
            parentGroup.addChild(line);
        } else {
            const containerGroup = new paper.Group([target, line]);
            containerGroup.data = { ...target.data, clipGroup: false };
            window.selectItem(containerGroup);
        }
    }
    paper.view.update();
}
