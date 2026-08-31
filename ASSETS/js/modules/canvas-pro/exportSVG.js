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

function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        if (!item.children) return item;
        const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
        if (content) return content;
        return item.children[1] || item.children[0] || item;
    }
    return null;
}

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

    const tempLayer = designLayer.clone({ insert: false });

    // 2. PURGADO INICIAL DE ARTEFACTOS AUXILIARES Y ELEMENTOS NO GRABABLES
    const itemsToRemove = [];
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
    }).forEach(it => itemsToRemove.push(it));

    itemsToRemove.forEach(it => {
        try { it.remove(); } catch (e) {}
    });

    // 3. DESEMPAQUETADO SEGURO DE GRUPOS DE RECORTE (clipGroup)
    const clipGroups = [];
    tempLayer.getItems({
        match: function(item) {
            return item instanceof paper.Group && item.data && item.data.clipGroup;
        }
    }).forEach(cg => clipGroups.push(cg));

    clipGroups.forEach(group => {
        const parent = group.parent || tempLayer;
        const groupIndex = parent.children.indexOf(group);
        const childrenCopy = [...group.children];

        childrenCopy.forEach(child => {
            if (child.clipMask || (child.data && (child.data.isMask || child.data.wasClipMask))) {
                child.remove();
                return;
            }
            if (group.matrix && !group.matrix.isIdentity()) {
                child.transform(group.matrix);
            }
            parent.insertChild(groupIndex, child);
        });
        group.remove();
    });

    // 4. VECTORIZACIÓN TIPOGRÁFICA RECURSIVA (FONTS-TO-PATHS)
    const textItems = [];
    tempLayer.getItems({
        match: function(item) {
            return item instanceof paper.PointText;
        }
    }).forEach(t => textItems.push(t));

    textItems.forEach(textItem => {
        try {
            const pathForm = textItem.createPath({ insert: false });
            if (pathForm) {
                pathForm.fillColor = textItem.fillColor || new paper.Color(0);
                pathForm.strokeColor = textItem.strokeColor || null;
                pathForm.strokeWidth = textItem.strokeWidth || 0;
                pathForm.transform(textItem.matrix);
                pathForm.data = { ...(textItem.data || {}), isVectorizedText: true };
                textItem.parent.insertChild(textItem.index, pathForm);
                textItem.remove();
            }
        } catch (err) {
            console.warn("[EKKO EXPORT] Error al vectorizar tipografía nativa:", err);
        }
    });

    // 5. MATERIALIZACIÓN FÍSICA DE SUSTRACCIONES BOOLEANAS CSG
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
    const holeEntities = [];
    tempLayer.getItems({
        match: function(item) {
            return item.data && item.data.isHole === true;
        }
    }).forEach(h => holeEntities.push(h));

    holeEntities.forEach(h => {
        try { h.remove(); } catch (e) {}
    });

    // 7. SANITIZACIÓN INDUSTRIAL: fillRule evenodd y purga de degenerados
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
        item.fillRule = "evenodd";
        if (!item.fillColor && !item.strokeColor) {
            item.fillColor = new paper.Color(0);
        }
        if (item.strokeColor && (!item.strokeWidth || item.strokeWidth <= 0)) {
            item.strokeWidth = 0.1;
        }
    });

    // 8. EXPORTACIÓN NATIVA A SVG CON PRECISIÓN INDUSTRIAL
    const exportConfig = {
        asString: true,
        bounds: "content",
        precision: precision
    };
    let svgString = tempLayer.exportSVG(exportConfig);

    // 9. INYECCIÓN DE DIMENSIONES FÍSICAS EN MILÍMETROS
    if (typeof svgString === "string" && window.mmPerPaperUnit) {
        const bounds = tempLayer.bounds;
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            const widthMm = (bounds.width * window.mmPerPaperUnit).toFixed(2);
            const heightMm = (bounds.height * window.mmPerPaperUnit).toFixed(2);

            svgString = svgString.replace(
                /<svg([^>]*)>/i,
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

    tempLayer.remove();

    if (window.EKKO_DEBUG) {
        console.log("[EKKO EXPORT SUCCESS] El diseño vectorial ha sido industrializado exitosamente para LightBurn.");
    }

    return asString ? svgString : new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;
}

export function downloadExportedSVG(filename = "diseno-ekko.svg") {
    const svgCode = prepareSVGForExport({ asString: true, precision: 5 });
    if (!svgCode || svgCode.trim() === "") {
        alert("No se pudo generar el SVG para exportar.");
        return;
    }

    const blob = new Blob([svgCode], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

if (typeof window !== "undefined") {
    window.prepareSVGForExport = prepareSVGForExport;
    window.downloadExportedSVG = downloadExportedSVG;
}
