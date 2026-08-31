/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/exportSVG.js (Industrial Laser Edition - v35 PRO)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/exportSVG.js

Descripción:
Procesador y exportador de SVG optimizado para corte y grabado láser
en LightBurn, CNC y maquinaria industrial.

Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt)
- RESULTADO ESPERADO (Huecos físicos reales sin transparencias cosméticas,
  purgado de controladores isHole para evitar dobles líneas de quemado,
  vectorización recursiva tipográfica Fonts-to-Paths y limpieza de artefactos).

FASE DE OPERACIÓN:
1. Selección y clonado defensivo de la capa de diseño (designLayer o activeLayer).
2. Purgado inicial de artefactos auxiliares (mockups, guías, cotas, reglas, cajas de selección).
3. Desempaquetado seguro de grupos de recorte (clipGroup) preservando transformaciones globales.
4. Vectorización recursiva de tipografías (PointText, CurvedText, SpacedText a CompoundPath/Path).
5. Materialización booleana CSG física de calados activos sobre masas sólidas inferiores.
6. Purgado total de entidades de calado interactivo (isHole) para anular dobles cortes en láser.
7. Sanitización de reglas de relleno (fillRule = "evenodd") y eliminación de trazados degenerados.
8. Asignación de estilos visibles (fill/stroke) para reconocimiento de capas en LightBurn.
9. Inyección de unidades físicas métricas reales (mm) y precisión micrométrica (5 decimales).
========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

/**
 * Obtiene el elemento de contenido real si el item está encapsulado en un grupo de recorte.
 * @param {paper.Item} item
 * @returns {paper.Item|null}
 */
function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        if (!item.children) return item;
        const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
        if (content) return content;
        const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
        if (fallback) return fallback;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

/**
 * Aplica recursivamente una matriz a los segmentos de un trazado
 */
function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix || matrix.isIdentity()) return;
    if (path.segments) {
        path.segments.forEach(seg => {
            seg.point = matrix.transform(seg.point);
            if (seg.handleIn) seg.handleIn = matrix.transform(seg.handleIn).subtract(matrix.transform(new paper.Point(0, 0)));
            if (seg.handleOut) seg.handleOut = matrix.transform(seg.handleOut).subtract(matrix.transform(new paper.Point(0, 0)));
        });
    }
    if (path.children && Array.isArray(path.children)) {
        path.children.forEach(child => bakeMatrixIntoPath(child, matrix));
    }
}

/**
 * Convierte un PointText o grupo tipográfico a un CompoundPath/Path vectorial horneado.
 * @param {paper.Item} textItem
 * @returns {paper.Item|null}
 */
function vectorizeTextItem(textItem) {
    if (!textItem) return null;
    try {
        if (typeof textItem.createPath === "function") {
            const path = textItem.createPath({ insert: false });
            if (path) {
                path.fillColor = textItem.fillColor ? textItem.fillColor.clone() : new paper.Color("#000000");
                path.strokeColor = textItem.strokeColor ? textItem.strokeColor.clone() : null;
                path.strokeWidth = textItem.strokeWidth || 0;
                path.matrix = textItem.matrix ? textItem.matrix.clone() : new paper.Matrix();
                path.data = {
                    ...(textItem.data || {}),
                    label: (textItem.data?.label || "Texto") + " (Vectorizado)"
                };
                return path;
            }
        } else if (typeof textItem.toPath === "function") {
            const path = textItem.toPath();
            if (path) {
                path.data = {
                    ...(textItem.data || {}),
                    label: (textItem.data?.label || "Texto") + " (Vectorizado)"
                };
                return path;
            }
        }
    } catch (err) {
        console.warn("[EKKO EXPORT WARNING] Falló la conversión de texto a trazado:", err);
    }
    return null;
}

/**
 * Prepara y exporta el diseño vectorial activo a un formato SVG estricto para corte/grabado láser.
 * Garantiza vacíos geométricos reales (sustracciones booleanas materializadas) y la purga
 * completa de controladores interactivos para evitar quemados dobles en LightBurn.
 *
 * @param {Object} [options] Opciones de exportación
 * @param {number} [options.precision=5] Precisión decimal para coordenadas vectoriales
 * @param {boolean} [options.asString=true] Retorna el SVG como string XML
 * @returns {string|SVGElement} Código XML SVG puro listo para manufactura o elemento SVG
 */
export function prepareSVGForExport(options = {}) {
    if (typeof paper === "undefined" || !paper.project) {
        console.error("[EKKO EXPORT] Error crítico: Paper.js no está inicializado.");
        return "";
    }

    const precision = typeof options.precision === "number" ? options.precision : 5;
    const asString = options.asString !== false;

    // 1. SELECCIÓN DEFENSIVA DE LA CAPA DE DISEÑO ÚTIL
    const designLayer = (paper.project.layers && paper.project.layers.find(l => l.name === "designLayer")) || paper.project.activeLayer;
    if (!designLayer) {
        console.error("[EKKO EXPORT] Error: No se encontró la capa de diseño para exportar.");
        return "";
    }

    // Clonado aislado de la capa (insert: false para no contaminar el lienzo interactivo)
    const tempLayer = designLayer.clone({ insert: false });

    // 2. PURGADO INICIAL DE ARTEFACTOS AUXILIARES Y ELEMENTOS NO GRABABLES
    // Elimina de inmediato mockups, fondos, guías inteligentes, cotas, reglas, marcas de agua y cajas de selección
    const artifactsToRemove = [];
    tempLayer.getItems({
        match: function(item) {
            const data = item.data || {};
            return (
                data.mockup === true ||
                data.isMask === true ||
                data.wasClipMask === true ||
                data.isSelectionBox === true ||
                data.isHandle === true ||
                data.isNodeHandle === true ||
                data.isCurveHandle === true ||
                data.isSmartGuide === true ||
                data.isMeasurement === true ||
                data.isTracePreview === true ||
                data.isNodeEditOverlay === true ||
                data.isGuide === true ||
                data.isWatermark === true ||
                data.isUnderlineLine === true ||
                (window.currentMockup && item.id === window.currentMockup.id) ||
                (item instanceof paper.PointText && item.content === window.EKKO_CONFIG?.seguridad?.watermarkText)
            );
        }
    }).forEach(it => artifactsToRemove.push(it));

    artifactsToRemove.forEach(it => {
        try { it.remove(); } catch (e) {}
    });

    // 3. DESEMPAQUETADO SEGURO DE GRUPOS DE RECORTE (clipGroup)
    // Extrae el contenido útil al nivel raíz de tempLayer horneando matrices para evitar pérdidas por máscaras
    const clipGroups = [];
    tempLayer.getItems({
        match: function(item) {
            return item.data && item.data.clipGroup === true;
        }
    }).forEach(cg => clipGroups.push(cg));

    clipGroups.forEach(group => {
        const groupParent = group.parent || tempLayer;
        const groupIndex = group.index;
        const groupMatrix = group.matrix ? group.matrix.clone() : new paper.Matrix();
        
        const usefulChildren = [];
        if (group.children) {
            [...group.children].forEach(child => {
                if (child.clipMask || (child.data && (child.data.isMask || child.data.mockup || child.data.wasClipMask))) {
                    child.remove();
                } else {
                    usefulChildren.push(child);
                }
            });
        }

        usefulChildren.forEach(child => {
            if (child.matrix && !groupMatrix.isIdentity()) {
                child.matrix = groupMatrix.chain(child.matrix);
            }
            groupParent.insertChild(groupIndex, child);
        });

        group.remove();
    });

    // 4. VECTORIZACIÓN RECURSIVA DE TIPOGRAFÍAS (Fonts-to-Paths)
    // Convierte todos los PointText y grupos de texto curvo a CompoundPaths cerrados horneados
    // para independizar el archivo de las fuentes del sistema o de la máquina láser
    const textItems = [];
    tempLayer.getItems({
        match: function(item) {
            return (
                item instanceof paper.PointText ||
                item.className === "PointText" ||
                (item.data && (item.data.isCurvedGroup || item.data.isSpacedGroup))
            );
        }
    }).forEach(item => textItems.push(item));

    textItems.forEach(item => {
        if (item.data && (item.data.isCurvedGroup || item.data.isSpacedGroup)) {
            // Grupo de texto compuesto: vectorizar cada hijo PointText
            if (item.children) {
                const subTexts = [...item.children].filter(c => c instanceof paper.PointText);
                subTexts.forEach(st => {
                    const vec = vectorizeTextItem(st);
                    if (vec) {
                        item.insertChild(st.index, vec);
                        st.remove();
                    }
                });
            }
        } else if (item instanceof paper.PointText) {
            const vec = vectorizeTextItem(item);
            if (vec) {
                const parent = item.parent || tempLayer;
                parent.insertChild(item.index, vec);
                item.remove();
            }
        }
    });

    // 5. MATERIALIZACIÓN BOOLEANA CSG EN LA CAPA CLONADA
    // Hornea las perforaciones físicas reales de los calados activos sobre las masas sólidas inferiores
    try {
        if (typeof recalculateDynamicSubtractions === "function") {
            recalculateDynamicSubtractions(tempLayer);
        } else if (typeof window.recalculateDynamicSubtractions === "function") {
            window.recalculateDynamicSubtractions(tempLayer);
        }
    } catch (err) {
        console.warn("[EKKO EXPORT CSG RECALC ERROR]", err);
    }

    // 6. PURGADO DE CALADOS ACTIVOS (isHole)
    // Dado que el corte booleano ya fue materializado en la geometría de las masas sólidas inferiores,
    // se eliminan todas las entidades de calado interactivo para no generar líneas de corte duplicadas en LightBurn
    const holesToRemove = [];
    tempLayer.getItems({
        match: function(item) {
            return item.data && (item.data.isHole === true || item.data.isHoleController === true);
        }
    }).forEach(hole => holesToRemove.push(hole));

    holesToRemove.forEach(hole => {
        try { hole.remove(); } catch (e) {}
    });

    // 7. SANITIZACIÓN VECTORIAL Y ASIGNACIÓN DE ESTILOS PARA CORTE/GRABADO LÁSER
    // - Asigna fillRule "evenodd" en todos los CompoundPaths para renderizado de huecos estándar
    // - Asegura colores visibles (negro para grabado / trazo fino) evitando paths invisibles ignorados por LightBurn
    // - Descarta geometrías vacías o degeneradas (sin área ni segmentos)
    const emptyItems = [];
    tempLayer.getItems({
        match: function(item) {
            if (item instanceof paper.PathItem) {
                const segCount = item.segments ? item.segments.length : 
                    (item.children ? item.children.reduce((acc, c) => acc + (c.segments ? c.segments.length : 0), 0) : 0);
                const area = Math.abs(item.area || 0);
                if (segCount < 2 || area < 1e-4) {
                    return true;
                }
            }
            return false;
        }
    }).forEach(it => emptyItems.push(it));

    emptyItems.forEach(it => {
        try { it.remove(); } catch (e) {}
    });

    tempLayer.getItems({
        match: function(item) {
            return item instanceof paper.PathItem;
        }
    }).forEach(item => {
        // Regla de relleno estándar industrial
        if (item instanceof paper.CompoundPath) {
            item.fillRule = "evenodd";
        }
        // Asignación de estilo por defecto si carece de color
        if (!item.fillColor && !item.strokeColor) {
            item.fillColor = new paper.Color("#000000");
        }
        // Garantizar trazo mínimo si es un path abierto de corte
        if (!item.closed && (!item.strokeWidth || item.strokeWidth <= 0)) {
            item.strokeWidth = 1.0;
            if (!item.strokeColor) item.strokeColor = new paper.Color("#000000");
        }
    });

    // 8. EXPORTACIÓN NATIVA A SVG CON PRECISIÓN INDUSTRIAL
    const exportConfig = {
        asString: true,
        bounds: "content",
        precision: precision
    };

    let svgString = tempLayer.exportSVG(exportConfig);

    // 9. INYECCIÓN DE DIMENSIONES FÍSICAS EN MILÍMETROS (Garantía de Escala 1:1 en LightBurn)
    if (typeof svgString === "string" && window.mmPerPaperUnit) {
        const bounds = tempLayer.bounds;
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            const widthMm = (bounds.width * window.mmPerPaperUnit).toFixed(2);
            const heightMm = (bounds.height * window.mmPerPaperUnit).toFixed(2);
            
            // Reemplazar o inyectar width y height con sufijo "mm" en el tag raíz <svg>
            svgString = svgString.replace(
                /<svg\b([^>]*)>/i,
                (match, attrs) => {
                    let newAttrs = attrs;
                    if (/\bwidth="[^"]*"/i.test(newAttrs)) {
                        newAttrs = newAttrs.replace(/\bwidth="[^"]*"/i, `width="${widthMm}mm"`);
                    } else {
                        newAttrs += ` width="${widthMm}mm"`;
                    }
                    if (/\bheight="[^"]*"/i.test(newAttrs)) {
                        newAttrs = newAttrs.replace(/\bheight="[^"]*"/i, `height="${heightMm}mm"`);
                    } else {
                        newAttrs += ` height="${heightMm}mm"`;
                    }
                    return `<svg${newAttrs}>`;
                }
            );
        }
    }

    // 10. LIBERACIÓN DE MEMORIA DEL LIENZO TEMPORAL
    tempLayer.remove();

    if (window.EKKO_DEBUG) {
        console.log("[EKKO EXPORT SUCCESS] El diseño vectorial ha sido industrializado exitosamente para LightBurn.");
    }

    return asString ? svgString : new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;
}

/**
 * Dispara la descarga del SVG preparado directamente en el navegador del usuario.
 * @param {string} [filename="diseno-ekko.svg"] Nombre del archivo de salida
 */
export function downloadExportedSVG(filename = "diseno-ekko.svg") {
    const svgContent = prepareSVGForExport({ asString: true });
    if (!svgContent || svgContent.trim() === "") {
        alert("No hay elementos válidos para exportar en el lienzo.");
        return;
    }

    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".svg") ? filename : (filename + ".svg");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Exposición global segura
if (typeof window !== "undefined") {
    window.prepareSVGForExport = prepareSVGForExport;
    window.downloadExportedSVG = downloadExportedSVG;
}

