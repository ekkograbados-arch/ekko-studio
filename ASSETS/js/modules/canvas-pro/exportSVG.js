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

import { recalculateDynamicSubtractions, interiorPointOf, evenOddContains } from "./geometricUngroup.js";
import { getVirtualHoleEntries } from "./fusionCore.js";
import { textToCompoundPath } from "./fontToPath.js";
import { getPublicOwner } from "./designGeometry.js";
import { getCanonicalDesignLayer, collectVectorOwners, semanticKind, VECTOR_KIND } from "./vectorSemantics.js";

/**
 * Obtiene el elemento de contenido real si el item está encapsulado en un grupo de recorte.
 * @param {paper.Item} item
 * @returns {paper.Item|null}
 */
function getContentItem(item) {
    if (!item) return null;
    // Owner resolution is semantic and centralized. A containment wrapper
    // without an explicit public owner is not exportable design geometry.
    const owner = getPublicOwner(item);
    if (owner) return owner;
    return item.data?.clipGroup ? null : item;
}

/**
 * Aplica recursivamente una matriz a los segmentos de un trazado
 */
function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix || matrix.isIdentity()) return;
    if (path.segments) {
        path.segments.forEach(seg => {
            const originalPoint = seg.point.clone();
            const originalHandleIn = seg.handleIn ? seg.handleIn.clone() : null;
            const originalHandleOut = seg.handleOut ? seg.handleOut.clone() : null;
            seg.point = matrix.transform(originalPoint);
            if (originalHandleIn) {
                const absoluteHandle = originalPoint.add(originalHandleIn);
                seg.handleIn = matrix.transform(absoluteHandle).subtract(seg.point);
            }
            if (originalHandleOut) {
                const absoluteHandle = originalPoint.add(originalHandleOut);
                seg.handleOut = matrix.transform(absoluteHandle).subtract(seg.point);
            }
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
async function vectorizeTextItem(textItem) {
    if (!textItem) return null;
    try {
        const path = await textToCompoundPath(textItem);
        if (!path) return null;
        path.data = {
            ...(textItem.data || {}),
            label: (textItem.data?.label || "Texto") + " (Vectorizado)",
            isTextVector: true,
            source: "text-vector"
        };
        return path;
    } catch (err) {
        console.warn("[EKKO EXPORT WARNING] Falló la conversión OpenType:", err);
        return null;
    }
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
export async function prepareSVGForExport(options = {}) {
    if (typeof paper === "undefined" || !paper.project) {
        console.error("[EKKO EXPORT] Error crítico: Paper.js no está inicializado.");
        return "";
    }

    const precision = typeof options.precision === "number" ? options.precision : 5;
    const asString = options.asString !== false;

    // 1. SELECCIÓN DEFENSIVA DE LA CAPA DE DISEÑO ÚTIL
    const designLayer = getCanonicalDesignLayer();
    if (!designLayer) {
        console.error("[EKKO EXPORT] Error: No se encontró la capa de diseño para exportar.");
        return "";
    }

    // Clonado aislado de la capa (insert: false para no contaminar el lienzo interactivo)
    const tempLayer = designLayer.clone({ insert: false });
    tempLayer.name = "designLayer";

    // Contorno del producto como grupo separado y fácilmente eliminable.
    // Se captura ANTES del purgado de artefactos. Solo se incluye si el
    // llamador lo pide (options.includeMockup): es referencia, no material.
    let mockupOutline = null;
    if (options.includeMockup === true) {
        try {
            const mockup = tempLayer.getItems({
                match: item => item && (item.data?.mockup === true || item === window.currentMockup) &&
                    (item instanceof paper.Path || item instanceof paper.CompoundPath)
            })?.[0] || null;
            const source = mockup || window.clipMask;
            if (source) {
                const outline = source.clone({ insert: false });
                const flat = [];
                (function collect(node) {
                    if (!node) return;
                    if (node instanceof paper.Path) flat.push(node);
                    else if (node.children) Array.from(node.children).forEach(collect);
                })(outline);
                if (flat.length) {
                    mockupOutline = new paper.Group({ insert: false });
                    mockupOutline.data = { id: "EKKO-mockup", isMockupOutline: true };
                    flat.forEach(path => {
                        path.fillColor = null;
                        path.strokeColor = new paper.Color("#0000ff");
                        path.strokeWidth = 0.5;
                        path.opacity = 1;
                        mockupOutline.addChild(path);
                    });
                    try { outline.remove(); } catch (_) {}
                } else {
                    try { outline.remove(); } catch (_) {}
                }
            }
        } catch (_) {
            mockupOutline = null;
        }
    }

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
            if (!item.data || item.data.clipGroup !== true) return false;
            if (item.data.isSmartFusion === true) return false;
            const fusionMasks = item.getItems?.({
                match: child => child.data?.isFusionMask === true
            }) || [];
            return fusionMasks.length === 0;
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

    for (const item of textItems) {
        if (item.data && (item.data.isCurvedGroup || item.data.isSpacedGroup)) {
            // Grupo de texto compuesto: vectorizar cada hijo PointText
            if (item.children) {
                const subTexts = [...item.children].filter(c => c instanceof paper.PointText);
                for (const st of subTexts) {
                    const vec = await vectorizeTextItem(st);
                    if (vec) {
                        item.insertChild(st.index, vec);
                        st.remove();
                    }
                }
            }
        } else if (item instanceof paper.PointText) {
            const vec = await vectorizeTextItem(item);
            if (vec) {
                const parent = item.parent || tempLayer;
                parent.insertChild(item.index, vec);
                item.remove();
            }
        }
    }

    // 5. MATERIALIZACIÓN BOOLEANA CSG EN LA CAPA CLONADA
    // El export usa copias de los huecos virtuales, nunca las geometrías del
    // lienzo interactivo. Se conserva ownerContainmentKey para aislar fusiones.
    // unionReport se declara aquí porque el informe de compuerta (más abajo)
    // lo referencia antes de que corra la unión 5b.
    const unionReport = { mergedPairs: 0, skippedPairs: 0, dedupedStrokes: 0, timedOut: false, filledCount: 0, evaluatedPairs: 0 };
      const exportVirtualHoles = [];
    let exportCsgReport = null;
    let exportCsgError = null;
    try {
        getVirtualHoleEntries().forEach(entry => {
            if (!entry || !entry.geom) return;
            const geom = entry.geom.clone({ insert: false });
            const cloneGroup = tempLayer.getItems?.({
                match: item => item?.data?.isSmartFusion === true &&
                    item?.data?.fusionId === entry.fusionId
            })?.[0] || null;
            exportVirtualHoles.push({
                geom,
                fusionId: entry.fusionId,
                group: cloneGroup,
                ownerContainmentKey: entry.ownerContainmentKey || null
            });
        });

        if (typeof recalculateDynamicSubtractions === "function") {
            exportCsgReport = recalculateDynamicSubtractions(tempLayer, exportVirtualHoles);
        } else if (typeof window.recalculateDynamicSubtractions === "function") {
            exportCsgReport = window.recalculateDynamicSubtractions(tempLayer, exportVirtualHoles);
        } else {
            exportCsgError = "csg-recalculator-unavailable";
        }
    } catch (err) {
        exportCsgError = String(err?.stack || err);
        console.warn("[EKKO EXPORT CSG RECALC ERROR]", exportCsgError);
    } finally {
        exportVirtualHoles.forEach(entry => {
            try { entry.geom.remove(); } catch (e) {}
        });
    }
    // Export gate: hole owners are EXPECTED in the scene (they are purged
    // after materialization in step 6). The gate must use the CSG report,
    // not the mere presence of cutters: a hole with no unresolved targets
    // (fully cut, or over a material-free notch) must not block export.
    const exportOwners = collectVectorOwners(tempLayer);
    const holeOwners = exportOwners.filter(owner => semanticKind(owner) === VECTOR_KIND.HOLE);
    const materializationUnresolvedHoles = Number(exportCsgReport?.unresolvedHoles || 0);
    const failedBooleans = [
        ...(exportCsgReport?.failedBooleans || []),
        ...(exportCsgError ? [{ operation: "csg-recalculate", error: exportCsgError }] : [])
    ];
    const csgCompleted = exportCsgReport?.completed === true && !exportCsgError;
    exportCsgReport = {
        ...(exportCsgReport || {}),
        holeOwners: holeOwners.length,
        solidOwners: exportOwners.filter(owner => semanticKind(owner) === VECTOR_KIND.SOLID).length,
        outOfProductHoles: (exportCsgReport?.outOfProductHoleKeys || []).length,
        unresolvedHoles: materializationUnresolvedHoles,
        unresolvedOwnerIds: [...(exportCsgReport?.unresolvedHoleKeys || [])],
        union: unionReport,
        mockupIncluded: !!mockupOutline,
        failedBooleans,
        csgCompleted,
        exportReady: csgCompleted && failedBooleans.length === 0 && materializationUnresolvedHoles === 0
    };
    if (typeof window !== "undefined") window.EKKO_EXPORT_LAST_REPORT = exportCsgReport;
    if (!exportCsgReport.exportReady) {
        console.error("[EKKO EXPORT] CSG no pudo materializar todos los huecos", exportCsgReport);
        tempLayer.remove();
        return "";
    }



    // 5b. UNIÓN ANTI DOBLE-GRABADO (solo modo grabado)
    // Dos rellenos superpuestos del mismo estilo se grabarían dos veces en
    // la intersección. Se fusionan por estilo con tope de tiempo/pares; lo
    // no unido se informa en el reporte en vez de bloquear la exportación.
    // Las líneas de corte abiertas duplicadas exactas se deduplican por
    // pathData normalizado.
    if (options.uniteOverlaps !== false) {
        try {
            const styleKey = item => {
                const fill = item.fillColor ? item.fillColor.toCSS(true) : "none";
                const stroke = item.strokeColor ? item.strokeColor.toCSS(true) : "none";
                return `${fill}|${stroke}|${item.strokeWidth || 0}`;
            };
            // Only top-level public owners: getItems descends into compound
            // children, which would double-count (and wrongly merge) the
            // internal contours of every solid.
            const filled = [];
            tempLayer.getItems({
                match: item => (item instanceof paper.Path || item instanceof paper.CompoundPath) &&
                    !(item.parent instanceof paper.Path) && !(item.parent instanceof paper.CompoundPath) &&
                    !item.data?.isHole && !item.data?.isFusionMask && !item.data?.mockup &&
                    !item.data?.isMask && !item.data?.wasClipMask && !item.clipMask &&
                    !!item.fillColor && item.closed !== false
            }).forEach(item => filled.push(item));
            // Interior probes of every hole owner: a union must never fill a
            // previously empty hole (e.g. swallowing an island solid that
            // sits inside a hole region).
            const holeProbes = [];
            tempLayer.getItems({
                match: item => item?.data?.isHole === true &&
                    (item instanceof paper.Path || item instanceof paper.CompoundPath)
            }).forEach(hole => {
                try {
                    const probe = interiorPointOf(hole);
                    if (probe) holeProbes.push(probe);
                } catch (_) {}
            });
            const byStyle = new Map();
            filled.forEach(item => {
                const key = styleKey(item);
                if (!byStyle.has(key)) byStyle.set(key, []);
                byStyle.get(key).push(item);
            });
            unionReport.filledCount = filled.length;
            const bakeWorld = item => {
                // Paper booleans read raw segments and ignore .matrix when
                // applyMatrix is false. Bake the FULL world transform (owner
                // plus ancestors) into a detached clone so the union runs in
                // project coordinates.
                const clone = item.clone({ insert: false });
                try {
                    const matrix = item.globalMatrix?.clone?.() || clone.matrix?.clone?.();
                    clone.applyMatrix = false;
                    clone.matrix = new paper.Matrix();
                    if (matrix && !matrix.isIdentity()) clone.transform(matrix);
                    clone.applyMatrix = true;
                } catch (_) {}
                return clone;
            };
            const toLocalOf = (geometry, owner) => {
                // Bring world-baked result back to the keeper's local frame.
                try {
                    const inverse = owner.globalMatrix?.inverted?.();
                    if (inverse && typeof geometry.transform === "function") geometry.transform(inverse);
                } catch (_) {}
                return geometry;
            };
            const deadline = Date.now() + (Number.isFinite(options.uniteBudgetMs) ? options.uniteBudgetMs : 4000);
            let pairCount = 0;
            const maxPairs = Number.isFinite(options.uniteMaxPairs) ? options.uniteMaxPairs : 2000;
            byStyle.forEach(group => {
                for (let a = 0; a < group.length && Date.now() < deadline && pairCount < maxPairs; a++) {
                    let first = group[a];
                    if (!first || !first.project) continue;
                    for (let b = a + 1; b < group.length && Date.now() < deadline && pairCount < maxPairs; b++) {
                        const second = group[b];
                        if (!second || !second.project) continue;
                        try {
                            if (!first.bounds.intersects(second.bounds)) continue;
                        } catch (_) { continue; }
                        pairCount += 1;
                        unionReport.evaluatedPairs += 1;
                        let united = null;
                        const worldA = bakeWorld(first);
                        const worldB = bakeWorld(second);
                        try {
                            united = worldA.unite(worldB, { insert: false });
                        } catch (_) { united = null; }
                        // Validate in the world frame: Item.area ignores the
                        // owner matrix, so live areas and baked areas differ
                        // under transforms.
                        const unitedArea = united ? Math.abs(united.area || 0) : 0;
                        const sumArea = Math.abs(worldA.area || 0) + Math.abs(worldB.area || 0);
                        try { worldA.remove(); } catch (_) {}
                        try { worldB.remove(); } catch (_) {}
                        let preservesHoles = true;
                        if (united && unitedArea > 1e-9 && unitedArea <= sumArea * (1 + 1e-6)) {
                            try {
                                united.fillRule = "evenodd";
                                for (const probe of holeProbes) {
                                    const wasEmpty = !evenOddContains(first, probe) && !evenOddContains(second, probe);
                                    if (wasEmpty && evenOddContains(united, probe)) {
                                        preservesHoles = false;
                                        break;
                                    }
                                }
                            } catch (_) {
                                preservesHoles = false;
                            }
