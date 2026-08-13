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
            throw new Error("Ninguna tipografía dinámica pudo registrarse.");
        }
        loaded.sort((a, b) => a.name.localeCompare(b.name));
        loadedFontsCache = loaded;
        return loaded;
    } catch (e) {
        console.warn("Inyectando fuentes locales de respaldo por error de red o backend vacío:", e);
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
    
    // Quitar el tirador temporalmente para que no ensucie la matemática de posición
    if (target.data?.isCurvedGroup) {
        const handle = target.children.find(c => c.data?.isCurveHandle);
        if (handle) handle.remove();
    }
    
    const origCenter = target.position.clone();
    
    // Obtener los datos de estilo y texto de forma persistente para evitar la caída a Arial
    const textStr = target.data?.textString || target.content || "Texto";
    const fontFamily = target.data?.fontFamily || target.fontFamily || (target.children && target.children.find(c => c instanceof paper.PointText)?.fontFamily) || "Arial";
    const fontSize = target.data?.fontSize || target.fontSize || 42;
    const fillColor = target.data?.fillColor || target.fillColor || new paper.Color(0);
    const hspace = target.data?.hspace || 0;
    
    target.data = target.data || {};
    target.data.curvature = curvature;
    target.data.fontFamily = fontFamily;
    target.data.fontSize = fontSize;
    target.data.fillColor = fillColor;
    
    // Si la curvatura es casi cero, restaurar a texto plano normal
    if (Math.abs(curvature) < 0.001) {
        if (target.data?.isCurvedGroup) {
            restoreFlatText(item, target);
        }
        return;
    }
    
    let glyphGroup;
    if (target.data?.isCurvedGroup) {
        glyphGroup = target;
        glyphGroup.clear();
    } else {
        glyphGroup = new paper.Group();
        glyphGroup.data = { 
            ...target.data, 
            isCurvedGroup: true, 
            textString: textStr,
            fontFamily: fontFamily,
            fontSize: fontSize,
            fillColor: fillColor
        };
        
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
    
    // Matemática del Arco de Circunferencia estilo LightBurn con soporte de espaciado
    const radius = 2000 / curvature;
    const centerPoint = new paper.Point(0, radius);
    
    // Calcular ancho estimado de carácter
    const charWidth = fontSize * 0.6;
    const totalArcWidth = (numChars * charWidth) + ((numChars - 1) * hspace);
    const arcAngle = totalArcWidth / radius;
    const startAngle = -Math.PI / 2 - (arcAngle / 2);
    
    for (let i = 0; i < numChars; i++) {
        const char = chars[i];
        if (char === " ") continue;
        
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
        
        if (target.data?.fontWeight) {
            glyph.fontWeight = target.data.fontWeight;
        }
        
        const rotationAngle = (angle * 180 / Math.PI) + 90;
        glyph.rotate(rotationAngle, glyph.bounds.bottomCenter);
        
        if (target.data?.isItalicSkewed) {
            glyph.shear(-0.22, 0, glyph.bounds.bottomCenter);
        }
        
        glyphGroup.addChild(glyph);
    }
    
    // Reposicionar el grupo de glifos en la coordenada original exacta del texto plano
    glyphGroup.position = origCenter;
    drawBlueCurveHandle(glyphGroup);
    
    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(item.data?.clipGroup ? item : glyphGroup);
    }
    paper.view.update();
}

function restoreFlatText(item, curvedGroup) {
    const textStr = curvedGroup.data.textString || "Texto";
    const fontFamily = curvedGroup.data.fontFamily || "Arial";
    const fontSize = curvedGroup.data.fontSize || 42;
    const fillColor = curvedGroup.data.fillColor || new paper.Color(0);
    
    const flatText = new paper.PointText({
        point: curvedGroup.bounds.bottomCenter,
        content: textStr,
        fontSize: fontSize,
        fontFamily: fontFamily,
        fillColor: fillColor,
        justification: "center"
    });
    
    flatText.data = { 
        ...curvedGroup.data, 
        isCurvedGroup: false 
    };
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
    blueCircle.data = { isCurveHandle: true, mockup: true };
    group.addChild(blueCircle);
}

// Control de Espaciado de Letras Horizontal (HSpace) - Estilo LightBurn
export function applyTextSpacing(item, hspace) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    
    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;
    
    target.data = target.data || {};
    target.data.hspace = hspace;
    
    if (target instanceof paper.Group) {
        if (target.data.isCurvedGroup) {
            applyTextCurve(item, target.data.curvature || 0);
            return;
        }
        
        // Distribución horizontal plana persistente
        let currentX = 0;
        target.children.forEach(child => {
            if (child.data?.isCurveHandle || child.data?.underlineId) return;
            child.position.x = currentX + child.bounds.width / 2;
            currentX += child.bounds.width + hspace;
        });
    } else if (target instanceof paper.PointText) {
        const textStr = target.content || "Texto";
        if (Math.abs(hspace) < 0.001) return;
        
        const fontFamily = target.data?.fontFamily || target.fontFamily || "Arial";
        const fontSize = target.data?.fontSize || target.fontSize || 42;
        const fillColor = target.data?.fillColor || target.fillColor || new paper.Color(0);
        
        const glyphGroup = new paper.Group();
        glyphGroup.data = { 
            ...target.data, 
            isSpacedGroup: true, 
            textString: textStr,
            fontFamily: fontFamily,
            fontSize: fontSize,
            fillColor: fillColor
        };
        
        const chars = textStr.split("");
        const origCenter = target.position.clone();
        let currentX = 0;
        
        chars.forEach(char => {
            const glyph = new paper.PointText({
                point: [currentX, 0],
                content: char,
                fontFamily: fontFamily,
                fontSize: fontSize,
                fillColor: fillColor,
                justification: "left"
            });
            if (target.data?.fontWeight) {
                glyph.fontWeight = target.data.fontWeight;
            }
            if (target.data?.isItalicSkewed) {
                glyph.shear(-0.22, 0, glyph.bounds.bottomCenter);
            }
            glyphGroup.addChild(glyph);
            currentX += glyph.bounds.width + hspace;
        });
        
        glyphGroup.position = origCenter;
        
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
    
    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(item);
    }
    paper.view.update();
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
        if (vectorGroup.children) {
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
        } else {
            if (vectorGroup instanceof paper.Path || vectorGroup instanceof paper.CompoundPath) {
                childrenPaths.push(vectorGroup);
            }
        }
        if (childrenPaths.length === 0) {
            vectorGroup.remove();
            return;
        }
        let weldedPath = childrenPaths[0];
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
        target.data = target.data || {};
        if (target instanceof paper.PointText) {
            const isBold = target.fontWeight === 'bold' || target.fontWeight === 700;
            target.fontWeight = isBold ? 'normal' : 'bold';
            target.data.fontWeight = target.fontWeight;
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
            target.data.fontWeight = anyBold ? 'normal' : 'bold';
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
    const existingLine = isGroup ? item.children.find(c => c.data?.underlineId === underlineId) : paper.project.activeLayer.children.find(c => c.data?.underlineId === underlineId);
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
