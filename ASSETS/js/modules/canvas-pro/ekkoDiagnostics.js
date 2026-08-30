/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v2.0 Real-Time Diagnostic Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js

Descripción:
Sistema de Instrumentación, Diagnóstico y Auditoría Vectorial en Tiempo Real para EKKO Studio.
Observador independiente no destructivo para diagnosticar en caliente:
- Fallos en desagrupación (grupos que no se rompen, pérdida de elementos).
- Consistencia topológica de capas y orden Z reactivo.
- Preservación de geomBase vs geometrías perforadas CSG.
- Errores de selección y arrastre (huérfanos, locked, clipGroup).
========================================================================= */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.EKKO_DIAG = factory();
    }
}(typeof window !== 'undefined' ? window : this, function () {

    const diagState = {
        active: true, // Activado automáticamente en tiempo real
        opCounter: 0,
        currentOp: null,
        operations: [],
        maxHistory: 200,
        originalMethods: {},
        activeInterceptors: false,
        callDepth: 0
    };

    function extractBounds(bounds) {
        if (!bounds) return null;
        return {
            x: Number(bounds.x.toFixed(2)),
            y: Number(bounds.y.toFixed(2)),
            width: Number(bounds.width.toFixed(2)),
            height: Number(bounds.height.toFixed(2))
        };
    }

    function countSegments(item) {
        if (!item) return 0;
        if (item.segments) return item.segments.length;
        if (item.children && Array.isArray(item.children)) {
            return item.children.reduce((acc, c) => acc + countSegments(c), 0);
        }
        return 0;
    }

    function snapshotSelection() {
        const item = typeof window !== 'undefined' ? (window.selectedItem || null) : null;
        const selectedItems = typeof window !== 'undefined' ? (window.selectedItems || []) : [];

        if (!item && selectedItems.length === 0) {
            return { hasSelection: false, primary: null, count: 0, ids: [] };
        }

        const primary = item || selectedItems[0];
        let zIndex = -1;
        if (primary && primary.parent && primary.parent.children) {
            zIndex = primary.parent.children.indexOf(primary);
        }

        const primaryData = primary ? {
            id: primary.id,
            className: primary.className || (primary.constructor ? primary.constructor.name : 'Unknown'),
            label: (primary.data && primary.data.label) || 'Sin etiqueta',
            zIndex: zIndex,
            isHole: !!(primary.data && primary.data.isHole),
            hasGeomBase: !!(primary.data && primary.data.geomBase),
            geomBaseSegments: (primary.data && primary.data.geomBase) ? countSegments(primary.data.geomBase) : 0,
            visibleSegments: countSegments(primary),
            bounds: extractBounds(primary.bounds),
            position: primary.position ? { x: Number(primary.position.x.toFixed(2)), y: Number(primary.position.y.toFixed(2)) } : null,
            rotation: primary.data ? (primary.data.rotation || 0) : 0,
            isLocked: !!(primary.data && primary.data.locked),
            isClipGroup: !!(primary.data && primary.data.clipGroup),
            isOrphan: !primary.project || !primary.parent
        } : null;

        return {
            hasSelection: true,
            count: selectedItems.length > 0 ? selectedItems.length : 1,
            ids: selectedItems.length > 0 ? selectedItems.map(i => i.id) : [primary.id],
            primary: primaryData
        };
    }

    function snapshotGeometricState() {
        if (typeof paper === 'undefined' || !paper.project) {
            return { error: 'Paper.js no inicializado' };
        }

        const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        if (!designLayer || !designLayer.children) {
            return { totalChildren: 0, items: [] };
        }

        const items = [];
        let massCount = 0;
        let holeCount = 0;
        let missingGeomBaseCount = 0;

        designLayer.children.forEach((child, index) => {
            if (!child) return;
            const isUI = child.data && (
                child.data.isSelectionBox ||
                child.data.isHandle ||
                child.data.isNodeHandle ||
                child.data.isCurveHandle ||
                child.data.isNodeEditOverlay ||
                child.data.isSmartGuide ||
                child.data.isMeasurement ||
                child.data.isTracePreview ||
                child.data.mockup ||
                child.data.isMask
            );

            if (isUI) return;

            const isHole = !!(child.data && child.data.isHole);
            const hasGeomBase = !!(child.data && child.data.geomBase);

            if (isHole) {
                holeCount++;
            } else {
                massCount++;
            }

            if (!hasGeomBase) {
                missingGeomBaseCount++;
            }

            items.push({
                index: index,
                id: child.id,
                name: child.name || null,
                className: child.className || (child.constructor ? child.constructor.name : 'Unknown'),
                label: (child.data && child.data.label) || 'Item ' + child.id,
                isHole: isHole,
                hasGeomBase: hasGeomBase,
                geomBaseSegments: hasGeomBase ? countSegments(child.data.geomBase) : 0,
                visibleSegments: countSegments(child),
                bounds: extractBounds(child.bounds)
            });
        });

        return {
            timestamp: Date.now(),
            totalUsefulItems: items.length,
            massCount: massCount,
            holeCount: holeCount,
            missingGeomBaseCount: missingGeomBaseCount,
            zOrderIds: items.map(it => it.id),
            itemsSummary: items
        };
    }

    function auditConsistency(beforeGeo, afterGeo, beforeSel, afterSel, callLog, opType) {
        const inconsistencies = [];
        const checks = {
            geomBasePreserved: true,
            zOrderPreserved: true,
            selectionValid: true,
            csgExecuted: true,
            holeClassificationValid: true,
            noElementLoss: true,
            ungroupEffective: true
        };

        if (beforeGeo.error || afterGeo.error) {
            inconsistencies.push('Paper.js no estuvo disponible para calcular la geometría.');
            return { checks, inconsistencies, pass: false };
        }

        // 1. Detección de pérdida de elementos o desagrupación inefectiva
        if (opType === 'UNGROUP') {
            const beforeCount = beforeGeo.totalUsefulItems;
            const afterCount = afterGeo.totalUsefulItems;

            if (beforeSel.hasSelection && beforeSel.primary && beforeSel.primary.className === 'Group') {
                const groupStillExists = afterGeo.itemsSummary.some(it => it.id === beforeSel.primary.id);
                if (groupStillExists && afterCount <= beforeCount) {
                    checks.ungroupEffective = false;
                    inconsistencies.push(
                        `[DESAGRUPACIÓN FALLIDA] Se solicitó desagrupar el grupo ID: ${beforeSel.primary.id}, pero sigue existiendo intacto y el número de elementos útiles no aumentó.`
                    );
                }
            }

            if (afterCount < beforeCount) {
                checks.noElementLoss = false;
                const afterIds = new Set(afterGeo.zOrderIds);
                const missingIds = beforeGeo.zOrderIds.filter(id => !afterIds.has(id));
                inconsistencies.push(
                    `[PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN] Se perdieron ${beforeCount - afterCount} elementos del diseño. IDs desaparecidos: [${missingIds.join(', ')}].`
                );
            }
        }

        // 2. Verificación de integridad de geomBase
        const beforeItemMap = new Map();
        beforeGeo.itemsSummary.forEach(item => beforeItemMap.set(item.id, item));

        afterGeo.itemsSummary.forEach(afterItem => {
            const beforeItem = beforeItemMap.get(afterItem.id);
            if (beforeItem && beforeItem.hasGeomBase && afterItem.hasGeomBase) {
                if (opType !== 'NODE_EDIT' && beforeItem.geomBaseSegments !== afterItem.geomBaseSegments) {
                    checks.geomBasePreserved = false;
                    inconsistencies.push(
                        `[CORRUPCIÓN GEOMBASE] Item ID: ${afterItem.id} ("${afterItem.label}"): geomBase mutó de ${beforeItem.geomBaseSegments} a ${afterItem.geomBaseSegments} segmentos durante "${opType}". geomBase fue contaminado por la operación CSG.`
                    );
                }
            }
        });

        // 3. Verificación de Selección Huérfana o Inválida
        if (afterSel.hasSelection && afterSel.primary) {
            if (afterSel.primary.isOrphan) {
                checks.selectionValid = false;
                inconsistencies.push(
                    `[SELECCIÓN HUÉRFANA] window.selectedItem apunta a un elemento desvinculado del proyecto (ID: ${afterSel.primary.id}). No podrá manipularse.`
                );
            }
            if (afterSel.primary.isLocked) {
                inconsistencies.push(
                    `[ITEM BLOQUEADO] El elemento seleccionado (ID: ${afterSel.primary.id}) tiene data.locked=true. No podrá arrastrarse ni editarse.`
                );
            }
        }

        // 4. Verificación de Calados sin geomBase
        if (opType === 'UNGROUP') {
            const unbackedHoles = afterGeo.itemsSummary.filter(it => it.isHole && !it.hasGeomBase);
            if (unbackedHoles.length > 0) {
                checks.holeClassificationValid = false;
                inconsistencies.push(
                    `[CALADO SIN RESPALDO] Se crearon ${unbackedHoles.length} calados (isHole=true) sin geomBase de control.`
                );
            }
        }

        // 5. Verificación de Recálculo CSG Reactivo
        const csgTriggerOps = ['UNGROUP', 'GROUP', 'BRING_FORWARD', 'SEND_BACKWARD', 'BRING_FRONT', 'SEND_BACK', 'DELETE', 'DUPLICATE', 'DRAG_END'];
        if (csgTriggerOps.includes(opType)) {
            const csgExecuted = callLog.some(c => c.fnName === 'recalculateDynamicSubtractions');
            if (!csgExecuted) {
                checks.csgExecuted = false;
                inconsistencies.push(
                    `[OMISIÓN CSG] La operación "${opType}" debió invocar recalculateDynamicSubtractions(), pero no figura en el grafo de ejecución.`
                );
            }
        }

        return {
            checks,
            inconsistencies,
            pass: inconsistencies.length === 0
        };
    }

    function beginOperation(actionName, triggerSource) {
        if (!diagState.active) return null;

        diagState.opCounter++;
        const opId = 'OP-' + String(diagState.opCounter).padStart(5, '0');

        const opRecord = {
            id: opId,
            action: actionName,
            source: triggerSource || 'UI',
            timestamp: Date.now(),
            startTime: performance.now(),
            endTime: null,
            durationMs: 0,
            selectionBefore: snapshotSelection(),
            selectionAfter: null,
            geometryBefore: snapshotGeometricState(),
            geometryAfter: null,
            callGraph: [],
            consistency: null
        };

        diagState.currentOp = opRecord;
        return opRecord;
    }

    function endOperation() {
        if (!diagState.active || !diagState.currentOp) return null;

        const op = diagState.currentOp;
        op.endTime = performance.now();
        op.durationMs = Number((op.endTime - op.startTime).toFixed(2));
        op.selectionAfter = snapshotSelection();
        op.geometryAfter = snapshotGeometricState();

        op.consistency = auditConsistency(
            op.geometryBefore,
            op.geometryAfter,
            op.selectionBefore,
            op.selectionAfter,
            op.callGraph,
            op.action
        );

        diagState.operations.push(op);
        if (diagState.operations.length > diagState.maxHistory) {
            diagState.operations.shift();
        }

        // ALERTA VISUAL DIRECTA EN CONSOLA EN TIEMPO REAL
        if (!op.consistency.pass) {
            console.group(`%c🚨 [EKKO_DIAG ALERTA EN TIEMPO REAL] ${op.id} | Acción: ${op.action} | ❌ INCONSISTENCIAS DETECTADAS`, 'color: #ffffff; background: #dc2626; font-weight: bold; font-size: 13px; padding: 4px 8px; border-radius: 4px;');
            console.log(`%cOrigen: ${op.source} | Duración: ${op.durationMs}ms`, 'color: #f87171; font-weight: bold;');
            op.consistency.inconsistencies.forEach(msg => {
                console.warn('%c⚠️ ' + msg, 'color: #f59e0b; font-weight: bold;');
            });
            console.log('%cPara copiar diagnóstico completo escribe: EKKO_DIAG.dump()', 'color: #38bdf8; font-style: italic;');
            console.groupEnd();
        }

        diagState.currentOp = null;
        return op;
    }

    function recordCall(moduleFile, fnName, args, result, executionTimeMs, error) {
        if (!diagState.active) return;

        const callEntry = {
            order: (diagState.currentOp ? diagState.currentOp.callGraph.length + 1 : 0),
            timestamp: Date.now(),
            module: moduleFile,
            fnName: fnName,
            argsSummary: summarizeArgs(args),
            status: error ? 'ERROR' : 'OK',
            executionTimeMs: Number(executionTimeMs.toFixed(2)),
            error: error ? error.message : null
        };

        if (diagState.currentOp) {
            diagState.currentOp.callGraph.push(callEntry);
        }
    }

    function summarizeArgs(args) {
        if (!args || args.length === 0) return [];
        return Array.from(args).map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'object') {
                if (arg.id) return `{ id: ${arg.id}, class: ${arg.className || 'Item'} }`;
                if (arg.name) return `{ name: "${arg.name}" }`;
                return `{ keys: ${Object.keys(arg).slice(0, 3).join(', ')} }`;
            }
            return String(arg);
        });
    }

    function wrapFunction(targetObject, fnName, modulePath, actionType) {
        if (!targetObject || typeof targetObject[fnName] !== 'function') return;

        const original = targetObject[fnName];
        diagState.originalMethods[`${modulePath}:${fnName}`] = {
            target: targetObject,
            name: fnName,
            fn: original
        };

        targetObject[fnName] = function (...args) {
            const hasExistingOp = !!diagState.currentOp;
            let op = null;

            if (diagState.active && !hasExistingOp && actionType) {
                op = beginOperation(actionType, `${modulePath} -> ${fnName}`);
            }

            const tStart = performance.now();
            let result;
            let errCaught = null;

            diagState.callDepth++;
            try {
                result = original.apply(this, args);
            } catch (err) {
                errCaught = err;
                throw err;
            } finally {
                diagState.callDepth--;
                const tEnd = performance.now();
                if (diagState.active) {
                    recordCall(modulePath, fnName, args, result, tEnd - tStart, errCaught);
                }

                if (op) {
                    endOperation();
                }
            }

            return result;
        };
    }

    function installInterceptors() {
        if (diagState.activeInterceptors || typeof window === 'undefined') return;

        // 1. geometricUngroup.js y CSG
        wrapFunction(window, 'decomposeByContainmentHierarchy', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'geometricUngroupCompound', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'geometricUngroupOneLevel', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'recalculateDynamicSubtractions', 'geometricUngroup.js', null);
        wrapFunction(window, 'getGlobalUnsubtractedPath', 'geometricUngroup.js', null);

        // 2. selection.js
        wrapFunction(window, 'selectItem', 'selection.js', 'SELECT');
        wrapFunction(window, 'deselectItem', 'selection.js', 'DESELECT');
        wrapFunction(window, 'updateSelectionBox', 'selection.js', null);

        // 3. contextualMenu.js
        wrapFunction(window, 'ungroupSelectedItem', 'contextualMenu.js', 'UNGROUP');
        wrapFunction(window, 'groupSelectedItems', 'contextualMenu.js', 'GROUP');

        // 4. nodeEditor.js
        wrapFunction(window, 'enterNodeEditMode', 'nodeEditor.js', 'NODE_EDIT');
        wrapFunction(window, 'exitNodeEditMode', 'nodeEditor.js', 'EXIT_NODE_EDIT');

        // 5. editor.js (Z-Order, Undo, Redo, Portapapeles)
        wrapFunction(window, 'bringFront', 'editor.js', 'BRING_FRONT');
        wrapFunction(window, 'sendBack', 'editor.js', 'SEND_BACK');
        wrapFunction(window, 'bringForward', 'editor.js', 'BRING_FORWARD');
        wrapFunction(window, 'sendBackward', 'editor.js', 'SEND_BACKWARD');
        wrapFunction(window, 'undo', 'editor.js', 'UNDO');
        wrapFunction(window, 'redo', 'editor.js', 'REDO');
        wrapFunction(window, 'copySelected', 'editor.js', 'COPY');
        wrapFunction(window, 'pasteSelected', 'editor.js', 'PASTE');

        // 6. exportSVG.js
        wrapFunction(window, 'prepareSVGForExport', 'exportSVG.js', 'EXPORT_SVG');

        // 7. Paper.js import
        if (typeof paper !== 'undefined' && paper.project) {
            wrapFunction(paper.project, 'importSVG', 'paper.project', 'IMPORT_SVG');
        }

        diagState.activeInterceptors = true;
    }

    function uninstallInterceptors() {
        if (!diagState.activeInterceptors) return;

        Object.keys(diagState.originalMethods).forEach(key => {
            const entry = diagState.originalMethods[key];
            if (entry && entry.target && entry.name) {
                entry.target[entry.name] = entry.fn;
            }
        });

        diagState.originalMethods = {};
        diagState.activeInterceptors = false;
    }

    // API PÚBLICA
    const publicAPI = {
        start: function () {
            diagState.active = true;
            installInterceptors();
            console.log(
                '%c[EKKO_DIAG] Sistema de Auditoría Vectorial ACTIVADO 🟢',
                'color: #10b981; font-weight: bold; font-size: 13px; background: #ecfdf5; padding: 4px 8px; border-radius: 4px; border: 1px solid #a7f3d0;'
            );
            return 'EKKO_DIAG activo en tiempo real.';
        },

        stop: function () {
            diagState.active = false;
            uninstallInterceptors();
            console.log(
                '%c[EKKO_DIAG] Sistema de Auditoría DETENIDO 🔴',
                'color: #ef4444; font-weight: bold; font-size: 13px; background: #fef2f2; padding: 4px 8px; border-radius: 4px;'
            );
            return 'EKKO_DIAG detenido.';
        },

        clear: function () {
            diagState.operations = [];
            diagState.opCounter = 0;
            diagState.currentOp = null;
            console.log('[EKKO_DIAG] Historial limpiado.');
            return true;
        },

        report: function () {
            const ops = diagState.operations;
            console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
            console.log('║                   EKKO STUDIO DIAGNOSTIC - INFORME CONSOLIDADO                   ║');
            console.log('╚══════════════════════════════════════════════════════════════════════════════════╝');

            if (ops.length === 0) {
                console.log('No hay operaciones registradas aún. Opera sobre el lienzo.');
                return;
            }

            const summaryTable = ops.map(op => ({
                'ID': op.id,
                'Acción': op.action,
                'Origen': op.source,
                'Duración': `${op.durationMs} ms`,
                'Items Antes': op.geometryBefore.totalUsefulItems || 0,
                'Items Después': op.geometryAfter.totalUsefulItems || 0,
                'Masas': op.geometryAfter.massCount || 0,
                'Calados': op.geometryAfter.holeCount || 0,
                'CSG OK': op.consistency ? (op.consistency.checks.csgExecuted ? '✓' : '✗') : 'N/A',
                'geomBase OK': op.consistency ? (op.consistency.checks.geomBasePreserved ? '✓' : '✗') : 'N/A',
                'Consistencia': op.consistency ? (op.consistency.pass ? '✓ OK' : '⚠ ALERTA') : 'N/A'
            }));

            console.table(summaryTable);
            return ops;
        },

        last: function () {
            if (diagState.operations.length === 0) {
                console.warn('[EKKO_DIAG] No hay operaciones previas.');
                return null;
            }
            const op = diagState.operations[diagState.operations.length - 1];
            console.group(`[EKKO_DIAG ÚLTIMA OPERACIÓN] ${op.id} (${op.action})`);
            console.log('Origen:', op.source);
            console.log('Duración:', `${op.durationMs} ms`);
            console.log('Selección Previa:', op.selectionBefore);
            console.log('Selección Posterior:', op.selectionAfter);
            console.log('Estado Geométrico Previo:', op.geometryBefore);
            console.log('Estado Geométrico Posterior:', op.geometryAfter);
            console.log('Grafo de Llamadas:', op.callGraph);
            console.log('Consistencia:', op.consistency);
            console.groupEnd();
            return op;
        },

        dump: function () {
            const lastOp = diagState.operations.length > 0 ? diagState.operations[diagState.operations.length - 1] : null;
            const geoCurrent = snapshotGeometricState();
            const selCurrent = snapshotSelection();

            const dumpData = {
                timestamp: new Date().toISOString(),
                currentSelection: selCurrent,
                currentGeometricState: geoCurrent,
                lastOperation: lastOp,
                recentOperationsSummary: diagState.operations.slice(-5).map(o => ({
                    id: o.id,
                    action: o.action,
                    source: o.source,
                    durationMs: o.durationMs,
                    pass: o.consistency ? o.consistency.pass : false,
                    inconsistencies: o.consistency ? o.consistency.inconsistencies : []
                }))
            };

            const dumpString = JSON.stringify(dumpData, null, 2);

            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(dumpString).then(() => {
                    console.log('%c📋 [EKKO_DIAG] Diagnóstico copiado al portapapeles con éxito. Pégalo directamente en el chat.', 'color: #10b981; font-weight: bold;');
                }).catch(() => {
                    console.log('[EKKO_DIAG] Copia el objeto impreso abajo:');
                });
            }

            console.log(dumpString);
            return dumpData;
        },

        export: function () {
            return JSON.stringify(diagState.operations, null, 2);
        }
    };

    // Auto-inicialización en tiempo real
    if (typeof window !== 'undefined') {
        const init = () => {
            installInterceptors();
            console.log(
                '%c[EKKO_DIAG v2.0 Real-Time] Motor de Diagnóstico y Auditoría Vectorial ACTIVO 🟢',
                'color: #10b981; font-weight: bold; font-size: 12px; background: #ecfdf5; padding: 3px 6px; border-radius: 4px; border: 1px solid #a7f3d0;'
            );
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            setTimeout(init, 50);
        }
    }

    return publicAPI;
}));
