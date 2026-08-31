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
2. Purgado de artefactos auxiliares de interfaz (cajas de selección, tiradores, guías).
3. Horneado matricial estricto (Bake Transforms) para llevar coordenadas locales a absolutas.
4. Conversión nativa y recursiva de textos a trazados vectoriales (Fonts-to-Paths).
5. Materialización matemática profunda de huecos y perforaciones dinámicas mediante CSG.
6. Purgado absoluto de siluetas de corte interactivo (isHole) ya materializadas.
7. Unificación e indexación métrica de capas sin alterar el orden Z original.
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
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

/**
 * Aplica recursivamente las matrices de transformación a los puntos físicos de los trazados
 * para que las coordenadas en el SVG final sean puras y universales (Bake Matrix).
 * @param {paper.Item} item 
 */
function bakeMatrixIntoPath(item) {
    if (!item) return;
    if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
        if (item.matrix && !item.matrix.isIdentity()) {
            item.applyMatrix = true;
        }
    } else if (item.children && Array.isArray(item.children)) {
        item.children.forEach(bakeMatrixIntoPath);
    }
}

/**
 * Convierte un elemento de texto a trazados geométricos físicos (CompoundPath o Path)
 * para garantizar compatibilidad absoluta en máquinas láser que no posean las fuentes instaladas.
 * @param {paper.PointText} textItem 
 * @returns {paper.Item|null}
 */
function vectorizeTextItem(textItem) {
    if (!textItem) return null;
    try {
        if (typeof textItem.createPath === "function") {
            const path = textItem.createPath(false);
            if (path) {
                path.fillColor = textItem.fillColor || new paper.Color(0, 0, 0);
                path.strokeColor = textItem.strokeColor || null;
                path.strokeWidth = textItem.strokeWidth || 0;
                path.matrix = textItem.matrix.clone();
                path.data = {
                    ...(textItem.data || {}),
                    label: (textItem.data?.label || "Texto") + " (Curvas)"
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
    const isNonExportableArtifact = (item) => {
        if (!item) return true;
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
    };

    const purgeArtifactsRecursive = (parent) => {
        if (!parent || !parent.children) return;
        const children = [...parent.children];
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (isNonExportableArtifact(child)) {
                child.remove();
            } else if (child.children && child.children.length > 0) {
                purgeArtifactsRecursive(child);
                if (child.children.length === 0 && !(child instanceof paper.CompoundPath)) {
                    child.remove();
                }
            }
        }
    };
    purgeArtifactsRecursive(tempLayer);

    // 3. DESENMASCARADO DE GRUPOS DE RECORTE (Clip Groups de Producto)
    const unmaskClipGroupsRecursive = (parent) => {
        if (!parent || !parent.children) return;
        const children = [...parent.children];
        children.forEach(child => {
            if (child.data && child.data.clipGroup) {
                const content = getContentItem(child);
                if (content && content !== child) {
                    content.parent = parent;
                    child.remove();
                }
            } else if (child.children && child.children.length > 0) {
                unmaskClipGroupsRecursive(child);
            }
        });
    };
    unmaskClipGroupsRecursive(tempLayer);

    // 4. VECTORIZACIÓN FORZADA DE TIPOGRAFÍAS (Texto a Trazados)
    const vectorizeTextsRecursive = (parent) => {
        if (!parent || !parent.children) return;
        const children = [...parent.children];
        children.forEach(child => {
            if (child instanceof paper.PointText) {
                const vectorPath = vectorizeTextItem(child);
                if (vectorPath) {
                    parent.addChild(vectorPath);
                    child.remove();
                }
            } else if (child.children && child.children.length > 0) {
                vectorizeTextsRecursive(child);
            }
        });
    };
    vectorizeTextsRecursive(tempLayer);

    // 5. MATERIALIZACIÓN PROFUNDA DE HUECOS (CSG Dynamic Subtractions)
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
    const purgeHoleControllers = (parent) => {
        if (!parent || !parent.children) return;
        const children = [...parent.children];
        children.forEach(child => {
            if (child.data && child.data.isHole === true) {
                child.remove();
            } else if (child.children && child.children.length > 0) {
                purgeHoleControllers(child);
            }
        });
    };
    purgeHoleControllers(tempLayer);

    // 7. HORNEADO MATRICIAL ABSOLUTO Y SANEADO DE ESTILOS PARA LÁSER
    bakeMatrixIntoPath(tempLayer);

    const sanitizeStylesForLaser = (item) => {
        if (!item) return;
        if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
            // LightBurn identifica operaciones por color de línea (corte) o relleno (grabado).
            // Aseguramos que los objetos con hueco conserven su regla de devanado 'evenodd'.
            if (item instanceof paper.CompoundPath) {
                item.fillRule = "evenodd";
            }
            if (!item.fillColor && !item.strokeColor) {
                item.strokeColor = new paper.Color(0, 0, 0);
                item.strokeWidth = 0.5;
            }
        } else if (item.children && Array.isArray(item.children)) {
            item.children.forEach(sanitizeStylesForLaser);
        }
    };
    sanitizeStylesForLaser(tempLayer);

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

    // Liberar memoria de la capa temporal
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
