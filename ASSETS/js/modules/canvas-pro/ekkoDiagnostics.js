/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v3.0 Real-Time Auto-Audit)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js

Descripción:
Sistema de Diagnóstico, Instrumentación y Auditoría Vectorial de 5 Niveles en Tiempo Real.
Diseñado para EKKO Studio bajo las REGLAS DE ORO del Prompt Maestro y nuevos comandos a crear.txt.

CARACTERÍSTICAS INDUSTRIALES:
- Auto-desbloqueo de consola (Anti-Silenciamiento): Restaura automáticamente console.log,
  console.warn, console.info si fueron sobreescritos por otros módulos.
- Detección automática en caliente de anomalías (Desagrupación fallida, pérdida de elementos,
  huérfanos de selección, mutación de geomBase y falta de recálculo reactivo CSG).
- API Global inmediata en consola F12: EKKO_DIAG.report(), EKKO_DIAG.last(), EKKO_DIAG.dump().
========================================================================= */

(function (global) {
    // 0. MECANISMO DE DESMUTEO DE CONSOLA (Anti-Silenciamiento Activo)
    // Protege contra: console.log = () => {} en textToolbar.js o mockupLoader.js
    let nativeLog = console.log;
    let nativeWarn = console.warn;
    let nativeInfo = console.info;
    let nativeError = console.error;

    function restoreNativeConsole() {
        try {
            if (typeof document !== 'undefined' && document.createElement) {
                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                (document.body || document.documentElement).appendChild(iframe);
                if (iframe.contentWindow && iframe.contentWindow.console) {
                    const freshConsole = iframe.contentWindow.console;
                    nativeLog = freshConsole.log.bind(console);
                    nativeWarn = freshConsole.warn.bind(console);
                    nativeInfo = freshConsole.info.bind(console);
                    nativeError = freshConsole.error.bind(console);

                    // Blindar métodos de consola para que no puedan ser silenciados
                    try {
                        Object.defineProperty(console, 'log', { value: nativeLog, writable: true, configurable: true });
                        Object.defineProperty(console, 'warn', { value: nativeWarn, writable: true, configurable: true });
                        Object.defineProperty(console, 'info', { value: nativeInfo, writable: true, configurable: true });
                    } catch (e) {}
                }
                iframe.remove();
            }
        } catch (err) {}
    }

    // Ejecutar desmuto inicial
    restoreNativeConsole();

    // Estado interno del motor de diagnóstico
    const diagState = {
        active: true,
        opCounter: 0,
        currentOp: null,
        operations: [],
        maxHistory: 200,
        originalMethods: {},
        activeInterceptors: false,
        callDepth: 0
    };

    /**
     * Utilidad para extraer límites de forma limpia
     */
    function extractBounds(bounds) {
        if (!bounds) return null;
        return {
            x: Number(bounds.x.toFixed(2)),
            y: Number(bounds.y.toFixed(2)),
            width: Number(bounds.width.toFixed(2)),
            height: Number(bounds.height.toFixed(2))
        };
    }

    /**
     * Cuenta recursivamente segmentos de trazados
     */
    function countSegments(item) {
        if (!item) return 0;
        if (item.segments) return item.segments.length;
        if (item.children && Array.isArray(item.children)) {
            return item.children.reduce((acc, c) => acc + countSegments(c), 0);
        }
        return 0;
    }

    /**
     * Captura el estado de la selección (Nivel 2)
     */
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
            isClipGroup: !!(primary.data && primary.data.clipGroup)
        } : null;

        return {
            hasSelection: true,
            count: selectedItems.length > 0 ? selectedItems.length : 1,
            ids: selectedItems.length > 0 ? selectedItems.map(i => i.id) : [primary.id],
            primary: primaryData
        };
    }

    /**
     * Captura el estado geométrico de la capa activa (Nivel 4)
     */
    function snapshotGeometricState() {
        if (typeof paper === 'undefined' || !paper.project) {
            return { error: 'Paper.js no inicializado', totalUsefulItems: 0, itemsSummary: [] };
        }

        const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        if (!designLayer || !designLayer.children) {
            return { totalUsefulItems: 0, massCount: 0, holeCount: 0, missingGeomBaseCount: 0, itemsSummary: [] };
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

    /**
     * Auditoría de Consistencia de Nivel 5 (Invariantes y Reglas de Oro)
     */
    function auditConsistency(beforeGeo, afterGeo, beforeSel, afterSel, callLog, opType) {
        const inconsistencies = [];
        const checks = {
            geomBasePreserved: true,
            selectionValid: true,
            csgExecuted: true,
            holeClassificationValid: true,
            itemsPreserved: true,
            ungroupEffective: true
        };

        if (beforeGeo.error || afterGeo.error) {
            inconsistencies.push('Paper.js no estuvo disponible para calcular la geometría.');
            return { checks, inconsistencies, pass: false };
        }

        // 1. Verificación de Preservación de geomBase
        const beforeItemMap = new Map();
        beforeGeo.itemsSummary.forEach(item => beforeItemMap.set(item.id, item));

        afterGeo.itemsSummary.forEach(afterItem => {
            const beforeItem = beforeItemMap.get(afterItem.id);
            if (beforeItem && beforeItem.hasGeomBase && afterItem.hasGeomBase) {
                if (opType !== 'NODE_EDIT' && beforeItem.geomBaseSegments !== afterItem.geomBaseSegments) {
                    checks.geomBasePreserved = false;
                    inconsistencies.push(
                        `[ID: ${afterItem.id} "${afterItem.label}"] geomBase mutó inesperadamente en operación "${opType}". ` +
                        `Segmentos antes: ${beforeItem.geomBaseSegments}, después: ${afterItem.geomBaseSegments}. ` +
                        `Posible contaminación destructiva de geomBase por geometría perforada CSG.`
                    );
                }
            }
        });

        // 2. Verificación de Desagrupación Efectiva y Pérdida de Elementos
        if (opType === 'UNGROUP') {
            if (beforeGeo.totalUsefulItems > 0 && afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
                checks.itemsPreserved = false;
                const lostCount = beforeGeo.totalUsefulItems - afterGeo.totalUsefulItems;
                const afterIds = new Set(afterGeo.itemsSummary.map(it => it.id));
                const missingIds = beforeGeo.itemsSummary.filter(it => !afterIds.has(it.id)).map(it => it.id);
                inconsistencies.push(
                    `[PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN] Se perdieron ${lostCount} elementos de diseño. IDs desaparecidos: [${missingIds.join(', ')}].`
                );
            }

            if (beforeSel.hasSelection && beforeSel.count === 1) {
                const selId = beforeSel.ids[0];
                const stillExists = afterGeo.itemsSummary.some(it => it.id === selId && it.className === 'Group');
                if (stillExists && afterGeo.totalUsefulItems === beforeGeo.totalUsefulItems) {
                    checks.ungroupEffective = false;
                    inconsistencies.push(
                        `[DESAGRUPACIÓN FALLIDA] Se solicitó desagrupar el grupo ID: ${selId}, pero el grupo sigue existiendo y no se liberaron sus capas internas.`
                    );
                }
            }
        }

        // 3. Verificación de Integridad de Selección (Huérfanos)
        if (afterSel.hasSelection && typeof window !== 'undefined') {
            const currentItem = window.selectedItem;
            if (currentItem) {
                const isOrphan = !currentItem.project || !currentItem.parent;
                if (isOrphan) {
                    checks.selectionValid = false;
                    inconsistencies.push(
                        `[SELECCIÓN HUÉRFANA] window.selectedItem apunta a un elemento desvinculado de Paper.js (ID: ${currentItem.id}).`
                    );
                }
            }
        }

        // 4. Verificación de Calados sin geomBase
        if (opType === 'UNGROUP') {
            const unbackedHoles = afterGeo.itemsSummary.filter(it => it.isHole && !it.hasGeomBase);
            if (unbackedHoles.length > 0) {
                checks.holeClassificationValid = false;
                inconsistencies.push(
                    `Se generaron ${unbackedHoles.length} calados activos (isHole) sin objeto 'geomBase' inmaculado de respaldo.`
                );
            }
        }

        // 5. Verificación de Recálculo CSG
        const csgTriggerOps = ['UNGROUP', 'GROUP', 'BRING_FORWARD', 'SEND_BACKWARD', 'BRING_FRONT', 'SEND_BACK', 'DRAG_END', 'DELETE', 'PASTE'];
        if (csgTriggerOps.includes(opType)) {
            const csgExecuted = callLog.some(c => c.fnName === 'recalculateDynamicSubtractions');
            if (!csgExecuted) {
                checks.csgExecuted = false;
                inconsistencies.push(
                    `La operación "${opType}" debió disparar el recálculo CSG dinámico (recalculateDynamicSubtractions), pero no figura en el grafo de llamadas.`
                );
            }
        }

        return {
            checks,
            inconsistencies,
            pass: inconsistencies.length === 0
        };
    }

    /**
     * Inicia una transacción de auditoría
     */
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

    /**
     * Finaliza la transacción de auditoría y emite alertas en caliente
     */
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

        // SALIDA FORENSE AUTOMÁTICA EN TIEMPO REAL
        restoreNativeConsole();
        if (!op.consistency.pass) {
            nativeWarn(
                `%c🚨 [EKKO_DIAG ALERTA EN TIEMPO REAL] ${op.id} | Acción: ${op.action} | ❌ INCONSISTENCIAS DETECTADAS`,
                'color: #ffffff; background: #dc2626; font-weight: bold; padding: 4px 8px; border-radius: 4px; font-size: 12px;'
            );
            op.consistency.inconsistencies.forEach(msg => {
                nativeWarn(`   ⚠️ ${msg}`);
            });
            nativeInfo(
                `   ℹ️ Diagnóstico rápido: Escribe EKKO_DIAG.dump() en consola para copiar el informe forense completo.`
            );
        } else {
            nativeLog(
                `%c✓ [EKKO_DIAG] ${op.id} | ${op.action} (${op.durationMs} ms) | Geometría: ${op.geometryAfter.totalUsefulItems} items | Masas: ${op.geometryAfter.massCount} | Calados: ${op.geometryAfter.holeCount} | Consistencia: OK ✓`,
                'color: #059669; font-weight: 500; font-size: 11px;'
            );
        }

        diagState.currentOp = null;
        return op;
    }

    /**
     * Registra llamadas de funciones en el grafo de Nivel 3
     */
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
                return `{ Object keys: ${Object.keys(arg).slice(0, 3).join(', ')} }`;
            }
            return String(arg);
        });
    }

    /**
     * Proxy Wrapper para interceptar llamadas clave
     */
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

    /**
     * Instala interceptores en el entorno global y Paper.js
     */
    function installInterceptors() {
        if (typeof window === 'undefined') return;

        // geometricUngroup.js y CSG
        wrapFunction(window, 'decomposeByContainmentHierarchy', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'geometricUngroupCompound', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'geometricUngroupOneLevel', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'recalculateDynamicSubtractions', 'geometricUngroup.js', null);
        wrapFunction(window, 'getGlobalUnsubtractedPath', 'geometricUngroup.js', null);

        // selection.js
        wrapFunction(window, 'selectItem', 'selection.js', 'SELECT');
        wrapFunction(window, 'deselectItem', 'selection.js', 'DESELECT');
        wrapFunction(window, 'updateSelectionBox', 'selection.js', null);

        // contextualMenu.js
        wrapFunction(window, 'ungroupSelectedItem', 'contextualMenu.js', 'UNGROUP');
        wrapFunction(window, 'groupSelectedItems', 'contextualMenu.js', 'GROUP');

        // nodeEditor.js
        wrapFunction(window, 'enterNodeEditMode', 'nodeEditor.js', 'NODE_EDIT');
        wrapFunction(window, 'exitNodeEditMode', 'nodeEditor.js', 'EXIT_NODE_EDIT');

        // editor.js (Z-Order, Undo, Redo, Portapapeles)
        wrapFunction(window, 'bringFront', 'editor.js', 'BRING_FRONT');
        wrapFunction(window, 'sendBack', 'editor.js', 'SEND_BACK');
        wrapFunction(window, 'bringForward', 'editor.js', 'BRING_FORWARD');
        wrapFunction(window, 'sendBackward', 'editor.js', 'SEND_BACKWARD');
        wrapFunction(window, 'undo', 'editor.js', 'UNDO');
        wrapFunction(window, 'redo', 'editor.js', 'REDO');
        wrapFunction(window, 'copySelected', 'editor.js', 'COPY');
        wrapFunction(window, 'pasteSelected', 'editor.js', 'PASTE');

        // exportSVG.js
        wrapFunction(window, 'prepareSVGForExport', 'exportSVG.js', 'EXPORT_SVG');

        // Paper.js Importación
        if (typeof paper !== 'undefined' && paper.project) {
            wrapFunction(paper.project, 'importSVG', 'paper.project', 'IMPORT_SVG');
        }

        // Eventos de arrastre en Paper.js Tool
        if (typeof paper !== 'undefined' && paper.tools && paper.tools.length > 0) {
            paper.tools.forEach((t, idx) => {
                if (t.onMouseUp && !t._diagHooked) {
                    const origUp = t.onMouseUp;
                    t.onMouseUp = function (event) {
                        const wasDragging = !!(window.dragging || window.resizeActive || window.rotationActive);
                        let op = null;
                        if (wasDragging) {
                            op = beginOperation('DRAG_END', `paper.tool[${idx}].onMouseUp`);
                        }
                        const r = origUp.call(this, event);
                        if (op) {
                            endOperation();
                        }
                        return r;
                    };
                    t._diagHooked = true;
                }
            });
        }

        diagState.activeInterceptors = true;
    }

    // =========================================================================
    // API PÚBLICA DE EKKO_DIAG
    // =========================================================================
    const publicAPI = {
        start: function () {
            diagState.active = true;
            installInterceptors();
            restoreNativeConsole();
            nativeLog(
                '%c[EKKO_DIAG v3.0] Sistema de Auditoría y Diagnóstico Vectorial ACTIVADO 🟢',
                'color: #10b981; font-weight: bold; font-size: 13px; background: #ecfdf5; padding: 4px 8px; border-radius: 4px; border: 1px solid #a7f3d0;'
            );
            nativeLog('Comandos listos: EKKO_DIAG.report() | EKKO_DIAG.last() | EKKO_DIAG.dump() | EKKO_DIAG.clear()');
            return 'EKKO_DIAG activo. Todo evento en el lienzo es auditado en tiempo real.';
        },

        stop: function () {
            diagState.active = false;
            restoreNativeConsole();
            nativeLog(
                '%c[EKKO_DIAG] Sistema de Auditoría DETENIDO 🔴',
                'color: #ef4444; font-weight: bold; font-size: 13px; background: #fef2f2; padding: 4px 8px; border-radius: 4px;'
            );
            return 'EKKO_DIAG detenido. Usa EKKO_DIAG.report() para ver el registro histórico.';
        },

        clear: function () {
            diagState.operations = [];
            diagState.opCounter = 0;
            diagState.currentOp = null;
            restoreNativeConsole();
            nativeLog('[EKKO_DIAG] Historial de transacciones limpiado.');
            return true;
        },

        report: function () {
            restoreNativeConsole();
            const ops = diagState.operations;
            nativeLog('\n');
            nativeLog('╔══════════════════════════════════════════════════════════════════════════════════╗');
            nativeLog('║                   EKKO STUDIO DIAGNOSTIC - INFORME CONSOLIDADO                   ║');
            nativeLog('╚══════════════════════════════════════════════════════════════════════════════════╝');

            if (ops.length === 0) {
                nativeLog('No hay operaciones registradas aún. Opera en el lienzo (Desagrupar, Mover, etc.) y vuelve a ejecutar EKKO_DIAG.report().');
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

            if (console.table) {
                console.table(summaryTable);
            } else {
                nativeLog(JSON.stringify(summaryTable, null, 2));
            }

            const issues = ops.filter(op => op.consistency && !op.consistency.pass);
            if (issues.length > 0) {
                nativeLog(`\n%cSe detectaron ${issues.length} operaciones con anomalías o inconsistencias:`, 'color: #dc2626; font-weight: bold;');
                issues.forEach(op => {
                    nativeLog(`\n--- [${op.id}] ${op.action} (${op.durationMs} ms) ---`);
                    op.consistency.inconsistencies.forEach(err => nativeLog(`   ❌ ${err}`));
                });
            } else {
                nativeLog('\n%cTodas las operaciones registradas cumplieron con las invariantes y Reglas de Oro ✓', 'color: #059669; font-weight: bold;');
            }
        },

        last: function () {
            restoreNativeConsole();
            if (diagState.operations.length === 0) {
                nativeLog('[EKKO_DIAG] No hay operaciones registradas.');
                return null;
            }
            const lastOp = diagState.operations[diagState.operations.length - 1];
            nativeLog(`\n=== DETALLE DE ÚLTIMA OPERACIÓN: ${lastOp.id} (${lastOp.action}) ===`);
            nativeLog('Duración:', `${lastOp.durationMs} ms`);
            nativeLog('Disparador:', lastOp.source);
            nativeLog('Selección Antes:', lastOp.selectionBefore);
            nativeLog('Selección Después:', lastOp.selectionAfter);
            nativeLog('Geometría Antes:', lastOp.geometryBefore);
            nativeLog('Geometría Después:', lastOp.geometryAfter);
            nativeLog('Grafo de llamadas internas (Nivel 3):', lastOp.callGraph);
            nativeLog('Auditoría de Consistencia (Nivel 5):', lastOp.consistency);
            return lastOp;
        },

        dump: function () {
            restoreNativeConsole();
            const payload = {
                timestamp: new Date().toISOString(),
                totalOperations: diagState.operations.length,
                operations: diagState.operations
            };
            const jsonText = JSON.stringify(payload, null, 2);

            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(jsonText).then(() => {
                    nativeLog('%c[EKKO_DIAG] El reporte forense completo fue COPIADO AL PORTAPAPELES exitosamente 📋. Puedes pegarlo (Ctrl+V) en el chat.', 'color: #059669; font-weight: bold; font-size: 12px;');
                }).catch(() => {
                    nativeLog('%c[EKKO_DIAG] Copia el siguiente JSON forense:', 'color: #0284c7; font-weight: bold;');
                    nativeLog(jsonText);
                });
            } else {
                nativeLog('%c[EKKO_DIAG] Copia el siguiente JSON forense:', 'color: #0284c7; font-weight: bold;');
                nativeLog(jsonText);
            }
            return 'Reporte exportado.';
        }
    };

    // Exposición global absoluta
    global.EKKO_DIAG = publicAPI;
    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
    }

    // Inicialización automática y periódica de hooks
    function autoInit() {
        installInterceptors();
        restoreNativeConsole();
        nativeLog(
            '%c[EKKO_DIAG v3.0 Real-Time] Motor de Diagnóstico y Auditoría Vectorial ACTIVO 🟢',
            'color: #059669; font-weight: bold; font-size: 13px; background: #ecfdf5; padding: 4px 8px; border-radius: 4px; border: 1px solid #a7f3d0;'
        );
        nativeLog('Comandos listos en F12: EKKO_DIAG.report() | EKKO_DIAG.dump() | EKKO_DIAG.last()');
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', autoInit);
        } else {
            autoInit();
        }
        // Segundo chequeo por si Paper.js u otros módulos tardan en inicializarse
        setTimeout(installInterceptors, 1000);
        setTimeout(installInterceptors, 3000);
    }
})(typeof window !== 'undefined' ? window : this);
