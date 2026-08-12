/**
 * ASSETS/js/modules/canvas-pro/textToolbar.js
 * Módulo independiente para el procesamiento, carga dinámica de fuentes y control de textos (Estilo LightBurn).
 */

let loadedFontsCache = [];

// Cargar fuentes dinámicamente desde el endpoint del backend /api/fonts
export async function loadDynamicFonts() {
    if (loadedFontsCache.length > 0) return loadedFontsCache;

    const fallbacks = [
        { name: "Nostalgic Letter", family: "ekko_nostalgic_letter", file: "Nostalgic Letter.otf" },
        { name: "Please write me a song", family: "ekko_please_write_me_a_song", file: "Please write me a song.ttf" },
        { name: "SimpleHandmade", family: "ekko_simplehandmade", file: "SimpleHandmade.ttf" }
    ];

    try {
        const response = await fetch('/api/fonts');
        if (!response.ok) throw new Error("Endpoint api/fonts no disponible");
        
        const fontFiles = await response.json(); // Se espera un array de strings ["SimpleHandmade.ttf", ...]
        const loaded = [];

        for (const file of fontFiles) {
            const fontName = file.replace(/\.[^/.]+$/, ""); // Quitar extensión
            const family = "ekko_" + fontName.toLowerCase().replace(/[^a-z0-9]/g, "_");
            
            try {
                const fontFace = new FontFace(family, `url(/ASSETS/fonts/${encodeURIComponent(file)})`);
                const loadedFace = await fontFace.load();
                document.fonts.add(loadedFace);
                loaded.push({ name: fontName, family: family, file: file });
            } catch (err) {
                console.warn(`No se pudo cargar la tipografía dinámica: ${file}`, err);
            }
        }

        // Ordenar alfabéticamente
        loaded.sort((a, b) => a.name.localeCompare(b.name));
        loadedFontsCache = loaded;
        return loaded;
    } catch (e) {
        console.warn("Usando fuentes locales de respaldo por error de red o backend:", e);
        // Registrar fuentes fallback de forma segura
        for (const f of fallbacks) {
            try {
                const fontFace = new FontFace(f.family, `url(/ASSETS/fonts/${encodeURIComponent(f.file)})`);
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
    // Eliminar tirador previo si existe
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

    // Convertimos la tipografía a formas vectoriales individuales mediante exportSVG / importSVG de Paper.js
    const svgElement = target.exportSVG({ asString: false });
    paper.project.activeLayer.importSVG(svgElement, (vectorGroup) => {
        if (!vectorGroup) return;

        // Limpiar el lienzo de textos nativos y trabajar sobre sus siluetas vectoriales
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

        // Realizar la soldadura por unión booleana (Unite) de todas las curvas cruzadas
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

        // Insertar dentro del clipGroup original de corte SVG si aplica
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

// Alternar estilo de negrita (Bold)
export function toggleBold(item) {
    if (!item || item.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (target) {
        const isBold = target.fontWeight === 'bold' || target.fontWeight === 700;
        target.fontWeight = isBold ? 'normal' : 'bold';
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
            // Si es un objeto flotante libre, los agrupamos para que se muevan juntos
            const containerGroup = new paper.Group([target, line]);
            containerGroup.data = { ...target.data, clipGroup: false };
            window.selectItem(containerGroup);
        }
    }
    paper.view.update();
}
Paso 2: Reemplaza tu archivo de menú emergente
Reemplaza por completo el código de tu archivo ASSETS/js/modules/canvas-pro/contextualMenu.js con la versión actualizada para admitir las nuevas herramientas y el deslizador de curvatura:
import { openImageTraceModal } from "./imageTracer.js";
import { 
    scaleImage, 
    duplicateImage, 
    deleteImage, 
    bringImageForward, 
    sendImageBackward, 
    applyBrightnessContrast 
} from "./imageToolbar.js";
import {
    loadDynamicFonts,
    applyTextCurve,
    weldText,
    toggleBold,
    toggleUnderline
} from "./textToolbar.js";

// --- REMOVE OVERLAP TAB (EVITAR SUPERPOSICION) ---
function removeOverlapTab() {
    const btnSubtract = document.getElementById('btnCtxSubtract');
    if (btnSubtract) {
        btnSubtract.style.display = 'none';
        btnSubtract.remove();
    }
    const allElements = document.querySelectorAll('button, div, span, a, p, li');
    allElements.forEach(el => {
        if (el.textContent) {
            const normalizedText = el.textContent.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
            if (normalizedText.includes('EVITAR SUPERPOSICION')) {
                el.remove();
            }
        }
    });
}

// Cargar las fuentes dinámicas del sistema y poblar los dropdowns de forma ordenada
async function populateFontDropdowns() {
    const fonts = await loadDynamicFonts();
    const dropdowns = [
        document.getElementById('ctxFontSelector'),
        document.getElementById('fontSelector')
    ];

    dropdowns.forEach(dropdown => {
        if (!dropdown) return;
        dropdown.innerHTML = ""; // Limpiar hardcodeados

        fonts.forEach(font => {
            const opt = document.createElement('option');
            opt.value = font.family;
            opt.textContent = font.name;
            dropdown.appendChild(opt);
        });
    });

    // Actualizar también la galería lateral si existe
    renderSidebarFontGallery(fonts);
}

function renderSidebarFontGallery(fonts) {
    const list = document.getElementById("fontList");
    if (!list) return;
    list.innerHTML = "";

    fonts.forEach(font => {
        const item = document.createElement("div");
        item.className = "font-item";
        item.innerHTML = `<div class="font-preview" style="font-family: ${font.family}">Feliz Día Papá</div><div class="font-name">${font.name}</div>`;
        item.onclick = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup 
                    ? window.selectedItem.children.find(c => !c.clipMask) 
                    : window.selectedItem;

                if (target) {
                    if (typeof window.saveHistory === 'function') window.saveHistory();
                    target.fontFamily = font.family;
                    window.updateSelectionBox(window.selectedItem);
                    paper.view.update();
                }
            }
        };
        list.appendChild(item);
    });
}

export function initContextualMenu() {
    const toolbar = document.getElementById('contextual-toolbar');
    if (!toolbar) return;

    removeOverlapTab();
    populateFontDropdowns();

    const setClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };

    // --- 1. ACCIONES GENERALES ---
    setClick('btnCtxDelete', () => {
        if (window.selectedItem) {
            deleteImage(window.selectedItem);
            hideContextualMenu();
        }
    });

    setClick('btnCtxDuplicate', () => {
        if (window.selectedItem) {
            duplicateImage(window.selectedItem);
        }
    });

    setClick('btnCtxForward', () => {
        if (window.selectedItem) {
            bringImageForward(window.selectedItem);
        }
    });

    setClick('btnCtxBackward', () => {
        if (window.selectedItem) {
            sendImageBackward(window.selectedItem);
        }
    });

    // --- 2. ACCIONES DE TEXTO AVANZADAS ---
    const fontSelector = document.getElementById('ctxFontSelector');
    if (fontSelector) {
        fontSelector.onchange = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup 
                    ? window.selectedItem.children.find(c => !c.clipMask) 
                    : window.selectedItem;
                if (target) {
                    if (typeof window.saveHistory === 'function') window.saveHistory();
                    target.fontFamily = fontSelector.value;
                    if (typeof window.updateSelectionBox === 'function') {
                        window.updateSelectionBox(window.selectedItem);
                    }
                    paper.view.update();
                }
            }
        };
    }

    setClick('btnCtxBold', () => {
        if (window.selectedItem) {
            toggleBold(window.selectedItem);
        }
    });

    setClick('btnCtxItalic', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                const isItalic = target.fontStyle === 'italic';
                target.fontStyle = isItalic ? 'normal' : 'italic';
                paper.view.update();
            }
        }
    });

    setClick('btnCtxUnderline', () => {
        if (window.selectedItem) {
            toggleUnderline(window.selectedItem);
        }
    });

    setClick('btnCtxWeld', () => {
        if (window.selectedItem) {
            weldText(window.selectedItem);
        }
    });

    // Control Deslizante de Curvatura de Texto (Estilo LightBurn)
    const curveSlider = document.getElementById('ctxTextCurve');
    if (curveSlider) {
        curveSlider.oninput = () => {
            if (window.selectedItem) {
                const val = parseFloat(curveSlider.value);
                applyTextCurve(window.selectedItem, val);
            }
        };
    }

    // --- 3. ACCIONES DE IMAGEN ---
    setClick('btnCtxFlipH', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                target.scale(-1, 1);
                paper.view.update();
            }
        }
    });

    setClick('btnCtxFlipV', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                target.scale(1, -1);
                paper.view.update();
            }
        }
    });

    // --- ACCIONES DE ESCALADO INTERACTIVO (ACHICAR / AGRANDAR) ---
    const bindScaleDown = () => { if (window.selectedItem) scaleImage(window.selectedItem, 0.9); };
    const bindScaleUp = () => { if (window.selectedItem) scaleImage(window.selectedItem, 1.1); };

    setClick('btnCtxAchicar', bindScaleDown);
    setClick('btnCtxScaleDown', bindScaleDown);
    setClick('btnCtxShrink', bindScaleDown);
    
    setClick('btnCtxAgrandar', bindScaleUp);
    setClick('btnCtxScaleUp', bindScaleUp);
    setClick('btnCtxGrow', bindScaleUp);

    // --- SLIDERS DE BRILLO Y CONTRASTE EN TIEMPO REAL ---
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');

    const handleFilterInput = () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                const bVal = briSlider ? parseFloat(briSlider.value) : 0;
                const cVal = conSlider ? parseFloat(conSlider.value) : 0;
                
                target.data = target.data || {};
                target.data.brightness = bVal;
                target.data.contrast = cVal;

                applyBrightnessContrast(target, bVal, cVal);
            }
        }
    };

    if (briSlider) briSlider.oninput = handleFilterInput;
    if (conSlider) conSlider.oninput = handleFilterInput;
}

export function updateContextualMenu(item) {
    const toolbar = document.getElementById('contextual-toolbar');
    if (!toolbar) return;

    removeOverlapTab();

    if (!item || (item.data && item.data.mockup)) {
        toolbar.classList.remove('active');
        return;
    }

    toolbar.classList.add('active');

    // Ocultar subgrupos por defecto
    const hideSubgroup = (id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    };
    hideSubgroup('ctxTextControls');
    hideSubgroup('ctxImageControls');
    hideSubgroup('ctxVectorControls');

    const btnTrace = document.getElementById('btnCtxTrace');
    if (btnTrace) btnTrace.style.display = 'none';

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    // Mostrar subgrupos y restaurar valores de sliders e inputs según el objeto activo
    if (target instanceof paper.PointText || target.data?.isCurvedGroup) {
        const textControls = document.getElementById('ctxTextControls');
        if (textControls) textControls.classList.remove('hidden');
        
        const fontSelector = document.getElementById('ctxFontSelector');
        if (fontSelector && target.fontFamily) {
            fontSelector.value = target.fontFamily;
        }

        const curveSlider = document.getElementById('ctxTextCurve');
        if (curveSlider) {
            curveSlider.value = target.data?.curvature || 0;
        }
    } else if (target instanceof paper.Raster) {
        const imageControls = document.getElementById('ctxImageControls');
        if (imageControls) imageControls.classList.remove('hidden');

        const briSlider = document.getElementById('ctxBrightness');
        const conSlider = document.getElementById('ctxContrast');
        if (briSlider) briSlider.value = target.data?.brightness || 0;
        if (conSlider) conSlider.value = target.data?.contrast || 0;
    } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
        const vectorControls = document.getElementById('ctxVectorControls');
        if (vectorControls) vectorControls.classList.remove('hidden');
    }

    // Posicionamiento Canva Style sobre el objeto
    const bounds = item.bounds;
    if (!bounds) return;

    const viewPoint = paper.view.projectToView(bounds.topCenter);
    const toolbarWidth = toolbar.offsetWidth || 350;
    const toolbarHeight = toolbar.offsetHeight || 45;

    const posX = viewPoint.x - (toolbarWidth / 2);
    const posY = viewPoint.y - toolbarHeight - 20;

    const maxLeft = paper.view.element.clientWidth - toolbarWidth - 10;
    const maxTop = paper.view.element.clientHeight - toolbarHeight - 10;

    toolbar.style.left = `${Math.max(10, Math.min(posX, maxLeft))}px`;
    toolbar.style.top = `${Math.max(10, Math.min(posY, maxTop))}px`;
}

export function hideContextualMenu() {
    const toolbar = document.getElementById('contextual-toolbar');
    if (toolbar) toolbar.classList.remove('active');
}
