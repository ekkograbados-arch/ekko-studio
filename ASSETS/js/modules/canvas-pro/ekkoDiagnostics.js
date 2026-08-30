/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v4.0 Live Stream Audit Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js

Descripción:
Sistema de Instrumentación, Diagnóstico y Auditoría Vectorial EN TIEMPO REAL para EKKO Studio.
Registra de forma instantánea y automática CADA CLIC, ARRASTRE, SELECCIÓN, DESAGRUPACIÓN,
CAMBIO DE Z Y EDICIÓN DE NODOS en la consola F12, sin necesidad de comandos manuales.

Cumple rigurosamente con:
- nuevos comandos a crear.txt (Auditoría estructurada de 5 niveles en tiempo real)
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- REPOSITORIO EKKO STUDIO V1 y Diagnostico.txt

NIVELES DE AUDITORÍA:
- NIVEL 1: Acción de Usuario (Click, Drag, Select, Deselect, Ungroup, Group, Z-Order, Node Edit)
- NIVEL 2: Estado de Selección (Item, tipo, ID, bounds, posición, rotación, escala, Z, isHole, geomBase)
- NIVEL 3: Grafo de Ejecución (Orden de llamadas, archivo, función, argumentos, duración, errores)
- NIVEL 4: Estado Geométrico (Antes/Después: children, masas, calados, Z-order, geomBase)
- NIVEL 5: Auditoría de Consistencia (Verificación automática de invariantes y alertas rojas inmediatas)

COMANDOS DISPONIBLES EN CONSOLA (F12):
- EKKO_DIAG.report()  : Imprime y retorna el informe consolidado tabular completo.
- EKKO_DIAG.dump()    : Imprime y COPIA AUTOMÁTICAMENTE el volcado al portapapeles.
- EKKO_DIAG.last()    : Analiza detalladamente la última operación registrada.
- EKKO_DIAG.clear()   : Limpia el historial de operaciones en memoria.
- EKKO_DIAG.stop()    : Pausa temporalmente el monitoreo en vivo.
- EKKO_DIAG.start()   : Reanuda el monitoreo en vivo.
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

    // 0. DESMUTEO Y PRESERVACIÓN ABSOLUTA DE CONSOLA NATIVA (Anti-Silenciador de EKKO)
    let nativeConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info ? console.info.bind(console) : console.log.bind(console),
        group: console.group ? console.group.bind(console) : console.log.bind(console),
        groupCollapsed: console.groupCollapsed ? console.groupCollapsed.bind(console) : console.log.bind(console),
        groupEnd: console.groupEnd ? console.groupEnd.bind(console) : function () {},
        table: console.table ? console.table.bind(console) : console.log.bind(console)
    };

    // Rescatar consola prístina del navegador mediante iframe neutro si fue silenciada con () => {}
    try {
        if (typeof document !== 'undefined' && document.body) {
            const tempIframe = document.createElement('iframe');
            tempIframe.style.display = 'none';
            document.body.appendChild(tempIframe);
            if (tempIframe.contentWindow && tempIframe.contentWindow.console) {
                const pureCon = tempIframe.contentWindow.console;
                nativeConsole = {
                    log: pureCon.log.bind(pureCon),
                    warn: pureCon.warn.bind(pureCon),
                    error: pureCon.error.bind(pureCon),
                    info: pureCon.info ? pureCon.info.bind(pureCon) : pureCon.log.bind(pureCon),
                    group: pureCon.group ? pureCon.group.bind(pureCon) : pureCon.log.bind(pureCon),
                    groupCollapsed: pureCon.groupCollapsed ? pureCon.groupCollapsed.bind(pureCon) : pureCon.log.bind(pureCon),
                    groupEnd: pureCon.groupEnd ? pureCon.groupEnd.bind(pureCon) : function () {},
                    table: pureCon.table ? pureCon.table.bind(pureCon) : pureCon.log.bind(pureCon)
                };
            }
            tempIframe.remove();
        }
    } catch (e) {
        // Fallback a la consola existente
    }

    // Proteger consola global para que otros módulos no la silencien
    try {
        window.console.log = nativeConsole.log;
        window.console.warn = nativeConsole.warn;
        window.console.error = nativeConsole.error;
        window.console.info = nativeConsole.info;
    } catch (e) {}

    // Estado interno del motor de diagnóstico
    const diagState = {
        active: true,
        opCounter: 0,
        currentOp: null,
        operations: [],
        maxHistory: 200,
        originalMethods: {},
        activeInterceptors: false,
        dragThrottleTimer: null,
        lastDragPoint: null,
        dragStartPoint: null,
        dragTargetItem: null
    };

    /**
     * Extrae límites espaciales (Bounds) resumidos
     */
    function extractBounds(bounds) {
        if (!bounds) return null;
        return {
            x: Number(bounds.x.toFixed(1)),
            y: Number(bounds.y.toFixed(1)),
            w: Number(bounds.width.toFixed(1)),
            h: Number(bounds.height.toFixed(1))
        };
    }

    /**
     * Cuenta de forma recursiva los segmentos de curvas de un elemento
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
     * Captura el snapshot de la selección activa (Nivel 2)
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
            className: primary.className || (primary.constructor ? primary.constructor.name : 'Item'),
            label: (primary.data && primary.data.label) || 'Item ' + primary.id,
            zIndex: zIndex,
            isHole: !!(primary.data && primary.data.isHole),
            hasGeomBase: !!(primary.data && primary.data.geomBase),
            geomBaseSegments: (primary.data && primary.data.geomBase) ? countSegments(primary.data.geomBase) : 0,
            visibleSegments: countSegments(primary),
            bounds: extractBounds(primary.bounds),
            position: primary.position ? { x: Number(primary.position.x.toFixed(1)), y: Number(primary.position.y.toFixed(1)) } : null,
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
            return { totalUsefulItems: 0, massCount: 0, holeCount: 0, itemsSummary: [] };
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

            if (isHole) holeCount++;
            else massCount++;

            if (!hasGeomBase) missingGeomBaseCount++;

            items.push({
                index: index,
                id: child.id,
                className: child.className || (child.constructor ? child.constructor.name : 'Item'),
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
     * Auditoría de Consistencia Automática (Nivel 5)
     */
    function auditConsistency(beforeGeo, afterGeo, beforeSel, afterSel, callLog, opType) {
        const inconsistencies = [];
        const checks = {
            geomBasePreserved: true,
            selectionValid: true,
            csgExecuted: true,
            holeClassificationValid: true,
            ungroupSucceeded: true,
            noItemsLost: true
        };

        if (beforeGeo.error || afterGeo.error) {
            inconsistencies.push('Paper.js no estuvo disponible durante la operación.');
            return { checks, inconsistencies, pass: false };
        }

        // 1. Verificación de Desagrupación (Ungroup)
        if (opType === 'UNGROUP') {
            const beforeCount = beforeGeo.totalUsefulItems || 0;
            const afterCount = afterGeo.totalUsefulItems || 0;

            if (beforeSel.hasSelection && beforeSel.primary && (beforeSel.primary.className === 'Group' || beforeSel.primary.className === 'CompoundPath')) {
                if (afterCount <= beforeCount) {
                    checks.ungroupSucceeded = false;
                    inconsistencies.push(
                        `[DESAGRUPACIÓN FALLIDA] Se solicitó desagrupar ID: ${beforeSel.primary.id} (${beforeSel.primary.className}), ` +
                        `pero los elementos útiles no aumentaron (Antes: ${beforeCount}, Después: ${afterCount}).`
                    );
                }
            }

            if (afterCount < beforeCount) {
                checks.noItemsLost = false;
                const beforeIds = new Set((beforeGeo.itemsSummary || []).map(i => i.id));
                const afterIds = new Set((afterGeo.itemsSummary || []).map(i => i.id));
                const missing = [...beforeIds].filter(id => !afterIds.has(id));
                inconsistencies.push(
                    `[PÉRDIDA DE ELEMENTOS EN DESAGRUPAR] Desaparecieron ${missing.length} elementos útiles del lienzo. IDs: [${missing.join(', ')}].`
                );
            }
        }

        // 2. Verificación de geomBase inmaculada
        const beforeItemMap = new Map();
        (beforeGeo.itemsSummary || []).forEach(item => beforeItemMap.set(item.id, item));

        (afterGeo.itemsSummary || []).forEach(afterItem => {
            const beforeItem = beforeItemMap.get(afterItem.id);
            if (beforeItem && beforeItem.hasGeomBase && afterItem.hasGeomBase) {
                if (opType !== 'NODE_EDIT' && opType !== 'EXIT_NODE_EDIT' && beforeItem.geomBaseSegments !== afterItem.geomBaseSegments) {
                    checks.geomBasePreserved = false;
                    inconsistencies.push(
                        `[CORRUPCIÓN GEOMBASE] [ID: ${afterItem.id} "${afterItem.label}"] geomBase mutó en "${opType}". ` +
                        `Segmentos antes: ${beforeItem.geomBaseSegments}, después: ${afterItem.geomBaseSegments}. ` +
                        `Posible contaminación de geomBase por geometría perforada CSG.`
                    );
                }
            }
        });

        // 3. Verificación de Selección Huérfana
        if (afterSel.hasSelection && typeof window !== 'undefined') {
            const cur = window.selectedItem;
            if (cur && (!cur.project || !cur.parent)) {
                checks.selectionValid = false;
                inconsistencies.push(
                    `[SELECCIÓN HUÉRFANA] window.selectedItem apunta a un elemento desvinculado o eliminado (ID: ${cur.id}).`
                );
            }
        }

        // 4. Verificación de Recálculo CSG
        const csgTriggerOps = ['UNGROUP', 'GROUP', 'BRING_FORWARD', 'SEND_BACKWARD', 'BRING_FRONT', 'SEND_BACK', 'DELETE', 'DUPLICATE', 'DRAG_END'];
        if (csgTriggerOps.includes(opType)) {
            const csgExecuted = callLog.some(c => c.fnName === 'recalculateDynamicSubtractions');
            if (!csgExecuted) {
                checks.csgExecuted = false;
                inconsistencies.push(
                    `[CSG OMITIDO] La operación "${opType}" debió recalcular sustracciones CSG (recalculateDynamicSubtractions), pero no figura en el flujo.`
                );
            }
        }

        const pass = inconsistencies.length === 0;
        return { checks, inconsistencies, pass };
    }

    /**
     * Inicia una transacción de diagnóstico
     */
    function beginOperation(actionName, triggerSource, emoji = '⚡') {
        if (!diagState.active) return null;

        diagState.opCounter++;
        const opId = 'OP-' + String(diagState.opCounter).padStart(5, '0');

        const opRecord = {
            id: opId,
            action: actionName,
            emoji: emoji,
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
     * Finaliza la transacción de diagnóstico Y EMITE LA SALIDA EN VIVO EN CONSOLA
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

        // =====================================================================
        // EMISIÓN EN TIEMPO REAL EN CONSOLA F12 (AUTO LIVE STREAMING)
        // =====================================================================
        emitRealTimeLog(op);

        diagState.currentOp = null;
        return op;
    }

    /**
     * Da formato y emite el registro en vivo a la consola nativa
     */
    function emitRealTimeLog(op) {
        const isAlert = !op.consistency.pass;
        const sel = op.selectionAfter.hasSelection && op.selectionAfter.primary ? op.selectionAfter.primary : null;
        const geo = op.geometryAfter;

        let selText = 'Ninguno';
        if (sel) {
            selText = `ID: ${sel.id} (${sel.className}) | Z: ${sel.zIndex} | ${sel.isHole ? '🕳️ CALADO' : '⬛ MASA'} | geomBase: ${sel.hasGeomBase ? '✓' : '✗'}`;
        }

        const geoText = `Capas: ${geo.totalUsefulItems || 0} (Masas: ${geo.massCount || 0}, Calados: ${geo.holeCount || 0})`;

        if (isAlert) {
            // ALERTA ROJA PROMINENTE EN TIEMPO REAL
            nativeConsole.group(
                `%c🚨 [EKKO_DIAG ALERTA] ${op.id} | ${op.action} | ❌ INCONSISTENCIAS DETECTADAS`,
                'color: #ffffff; background: #dc2626; font-weight: bold; font-size: 13px; padding: 4px 8px; border-radius: 4px;'
            );
            nativeConsole.log(`%cOrigen: ${op.source} | Duración: ${op.durationMs} ms`, 'color: #f87171; font-weight: bold;');
            nativeConsole.log(`%cSelección: ${selText}`, 'color: #fecaca;');
            nativeConsole.log(`%cEstado Geométrico: ${geoText}`, 'color: #fecaca;');
            op.consistency.inconsistencies.forEach(msg => {
                nativeConsole.warn(`%c⚠️ ${msg}`, 'color: #f59e0b; font-weight: bold; font-size: 12px;');
            });
            nativeConsole.log('%c💡 Tip: Escribe EKKO_DIAG.dump() para copiar el diagnóstico completo y pegarlo en el chat.', 'color: #38bdf8; font-style: italic;');
            nativeConsole.groupEnd();
        } else {
            // NOTIFICACIÓN VERDE / AZUL ELEGANTE EN TIEMPO REAL
            const badgeStyle = 'color: #ffffff; background: #0284c7; font-weight: bold; font-size: 11px; padding: 2px 6px; border-radius: 3px;';
            const actionStyle = 'color: #0369a1; font-weight: bold; font-size: 11px;';
            const textStyle = 'color: #334155; font-size: 11px;';

            nativeConsole.groupCollapsed(
                `%c[EKKO_DIAG ${op.id}]%c ${op.emoji} ${op.action} %c| ${selText} | ${geoText} (${op.durationMs}ms) ✓`,
                badgeStyle, actionStyle, textStyle
            );
            nativeConsole.log(`• Origen: ${op.source}`);
            nativeConsole.log(`• Selección Después:`, op.selectionAfter);
            nativeConsole.log(`• Geometría Después:`, op.geometryAfter);
            if (op.callGraph.length > 0) {
                nativeConsole.log(`• Grafo de Llamadas (${op.callGraph.length}):`);
                nativeConsole.table(op.callGraph);
            }
            nativeConsole.groupEnd();
        }
    }

    /**
     * Registra una invocación de función en el grafo de ejecución (Nivel 3)
     */
    function recordCall(moduleFile, fnName, args, result, executionTimeMs, error) {
        if (!diagState.active) return;

        const callEntry = {
            order: (diagState.currentOp ? diagState.currentOp.callGraph.length + 1 : 0),
            timestamp: Date.now(),
            module: moduleFile,
            fnName: fnName,
            status: error ? 'ERROR' : 'OK',
            executionTimeMs: Number(executionTimeMs.toFixed(2)),
            error: error ? error.message : null
        };

        if (diagState.currentOp) {
            diagState.currentOp.callGraph.push(callEntry);
        }
    }

    /**
     * Envoltorio (Proxy Interceptor) para registrar la ejecución de funciones
     */
    function wrapFunction(targetObject, fnName, modulePath, actionType, emoji = '⚡') {
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
                op = beginOperation(actionType, `${modulePath} -> ${fnName}`, emoji);
            }

            const tStart = performance.now();
            let result;
            let errCaught = null;

            try {
                result = original.apply(this, args);
            } catch (err) {
                errCaught = err;
                throw err;
            } finally {
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
     * Intercepta directamente los eventos del ratón del lienzo para registrar Clics y Arrastres
     */
    function hookCanvasInteraction() {
        const canvasEl = document.getElementById('editorCanvas');
        if (!canvasEl || canvasEl.dataset.ekkoDiagHooked) return;

        canvasEl.dataset.ekkoDiagHooked = 'true';

        // 1. Clic en lienzo (MouseDown)
        canvasEl.addEventListener('mousedown', (e) => {
            if (!diagState.active) return;
            diagState.dragStartPoint = { x: e.clientX, y: e.clientY };
            diagState.lastDragPoint = { x: e.clientX, y: e.clientY };

            setTimeout(() => {
                const sel = snapshotSelection();
                if (sel.hasSelection && sel.primary) {
                    diagState.dragTargetItem = sel.primary;
                } else {
                    diagState.dragTargetItem = null;
                }
            }, 30);
        }, { capture: true });

        // 2. Arrastre en lienzo (MouseMove)
        canvasEl.addEventListener('mousemove', (e) => {
            if (!diagState.active || !diagState.dragStartPoint) return;
            if (e.buttons !== 1) return; // Solo clic izquierdo presionado

            const dist = Math.hypot(e.clientX - diagState.dragStartPoint.x, e.clientY - diagState.dragStartPoint.y);
            if (dist > 6 && !diagState.currentOp) {
                // Registrar micro-operación de arrastre
                diagState.lastDragPoint = { x: e.clientX, y: e.clientY };
            }
        });

        // 3. Fin de Arrastre o Clic (MouseUp)
        window.addEventListener('mouseup', (e) => {
            if (!diagState.active || !diagState.dragStartPoint) return;

            const dist = Math.hypot(e.clientX - diagState.dragStartPoint.x, e.clientY - diagState.dragStartPoint.y);
            const wasDrag = dist > 6;
            const startPt = diagState.dragStartPoint;
            diagState.dragStartPoint = null;

            if (wasDrag) {
                // Finalizó un arrastre
                const op = beginOperation('DRAG_END', 'editorCanvas -> mouseup', '↔️');
                setTimeout(() => {
                    if (op) {
                        endOperation();
                    }
                }, 40);
            } else {
                // Clic simple en el lienzo
                const op = beginOperation('CANVAS_CLICK', 'editorCanvas -> click', '🖱️');
                setTimeout(() => {
                    if (op) {
                        endOperation();
                    }
                }, 40);
            }
        }, { capture: true });
    }

    /**
     * Instala interceptores en las funciones clave de EKKO Studio
     */
    function installInterceptors() {
        if (diagState.activeInterceptors || typeof window === 'undefined') return;

        // 1. geometricUngroup.js y CSG
        wrapFunction(window, 'decomposeByContainmentHierarchy', 'geometricUngroup.js', 'UNGROUP', '🔓');
        wrapFunction(window, 'geometricUngroupCompound', 'geometricUngroup.js', 'UNGROUP', '🔓');
        wrapFunction(window, 'geometricUngroupOneLevel', 'geometricUngroup.js', 'UNGROUP', '🔓');
        wrapFunction(window, 'recalculateDynamicSubtractions', 'geometricUngroup.js', null);
        wrapFunction(window, 'getGlobalUnsubtractedPath', 'geometricUngroup.js', null);

        // 2. selection.js
        wrapFunction(window, 'selectItem', 'selection.js', 'SELECT', '🎯');
        wrapFunction(window, 'deselectItem', 'selection.js', 'DESELECT', '⚪');
        wrapFunction(window, 'updateSelectionBox', 'selection.js', null);

        // 3. contextualMenu.js
        wrapFunction(window, 'ungroupSelectedItem', 'contextualMenu.js', 'UNGROUP', '🔓');
        wrapFunction(window, 'groupSelectedItems', 'contextualMenu.js', 'GROUP', '📦');

        // 4. nodeEditor.js
        wrapFunction(window, 'enterNodeEditMode', 'nodeEditor.js', 'NODE_EDIT', '✏️');
        wrapFunction(window, 'exitNodeEditMode', 'nodeEditor.js', 'EXIT_NODE_EDIT', '🚪');

        // 5. editor.js (Z-Order, Undo, Redo, Clipboard)
        wrapFunction(window, 'bringFront', 'editor.js', 'BRING_FRONT', '⏫');
        wrapFunction(window, 'sendBack', 'editor.js', 'SEND_BACK', '⏬');
        wrapFunction(window, 'bringForward', 'editor.js', 'BRING_FORWARD', '🔼');
        wrapFunction(window, 'sendBackward', 'editor.js', 'SEND_BACKWARD', '🔽');
        wrapFunction(window, 'undo', 'editor.js', 'UNDO', '↩️');
        wrapFunction(window, 'redo', 'editor.js', 'REDO', '↪️');
        wrapFunction(window, 'copySelected', 'editor.js', 'COPY', '📋');
        wrapFunction(window, 'pasteSelected', 'editor.js', 'PASTE', '📑');

        // 6. exportSVG.js
        wrapFunction(window, 'prepareSVGForExport', 'exportSVG.js', 'EXPORT_SVG', '💾');

        // 7. Paper.js importSVG
        if (typeof paper !== 'undefined' && paper.project) {
            wrapFunction(paper.project, 'importSVG', 'paper.project', 'IMPORT_SVG', '📥');
        }

        hookCanvasInteraction();
        diagState.activeInterceptors = true;
    }

    // Inicialización automática y periódica para engancharse apenas Paper.js y el DOM estén listos
    if (typeof window !== 'undefined') {
        installInterceptors();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                installInterceptors();
                setTimeout(installInterceptors, 500);
            });
        } else {
            setTimeout(installInterceptors, 500);
        }
    }

    // =========================================================================
    // API PÚBLICA DE EKKO_DIAG
    // =========================================================================

    const publicAPI = {
        start: function () {
            diagState.active = true;
            installInterceptors();
            nativeConsole.log('%c[EKKO_DIAG v4.0 Live Stream] Monitoreo en tiempo real ACTIVADO 🟢', 'color: #10b981; font-weight: bold;');
            return 'EKKO_DIAG activo. Cada clic, arrastre o comando se reportará en la consola.';
        },

        stop: function () {
            diagState.active = false;
            nativeConsole.log('%c[EKKO_DIAG v4.0 Live Stream] Monitoreo en tiempo real PAUSADO 🔴', 'color: #ef4444; font-weight: bold;');
            return 'EKKO_DIAG pausado. Escribe EKKO_DIAG.start() para reanudar.';
        },

        clear: function () {
            diagState.operations = [];
            diagState.opCounter = 0;
            diagState.currentOp = null;
            nativeConsole.log('[EKKO_DIAG] Historial de transacciones reiniciado.');
            return true;
        },

        last: function () {
            if (diagState.operations.length === 0) {
                nativeConsole.log('No hay operaciones registradas aún.');
                return null;
            }
            const lastOp = diagState.operations[diagState.operations.length - 1];
            nativeConsole.log(`[EKKO_DIAG] Última Operación: ${lastOp.id} (${lastOp.action})`, lastOp);
            return lastOp;
        },

        report: function () {
            const ops = diagState.operations;
            let outputText = '╔══════════════════════════════════════════════════════════════════════════════════╗\n';
            outputText += '║               EKKO STUDIO DIAGNOSTIC v4.0 - INFORME CONSOLIDADO                  ║\n';
            outputText += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';

            if (ops.length === 0) {
                outputText += 'No hay operaciones registradas aún. Interactúa en el lienzo o carga un SVG.\n';
                nativeConsole.log(outputText);
                return outputText;
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

            nativeConsole.log(outputText);
            nativeConsole.table(summaryTable);

            // Generar versión textual para copia directa
            summaryTable.forEach(row => {
                outputText += `[${row.ID}] ${row.Acción} | Items: ${row['Items Antes']} -> ${row['Items Después']} (M:${row.Masas} C:${row.Calados}) | CSG: ${row['CSG OK']} | geomBase: ${row['geomBase OK']} | ${row.Consistencia}\n`;
            });

            return outputText;
        },

        dump: function () {
            const reportStr = publicAPI.report();
            let fullJSON = '';
            try {
                fullJSON = JSON.stringify(diagState.operations, null, 2);
            } catch (e) {
                fullJSON = 'Error al serializar JSON completo.';
            }

            const forensicDump = `${reportStr}\n\n--- DETALLE FORENSE COMPLETO (JSON) ---\n${fullJSON}`;

            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(forensicDump).then(() => {
                    nativeConsole.log('%c📋 [EKKO_DIAG] ¡Reporte copiado automáticamente al portapapeles! Haz Ctrl+V en el chat.', 'color: #10b981; font-weight: bold; font-size: 12px;');
                }).catch(() => {
                    nativeConsole.log('Copia manual: Selecciona el texto del reporte en la consola.');
                });
            }

            return forensicDump;
        }
    };

    // Mensaje de bienvenida inicial
    nativeConsole.log(
        '%c[EKKO_DIAG v4.0 Live Stream] Motor de Diagnóstico en Tiempo Real ACTIVO 🟢',
        'color: #10b981; font-weight: bold; font-size: 13px; background: #ecfdf5; padding: 4px 8px; border-radius: 4px; border: 1px solid #a7f3d0;'
    );
    nativeConsole.log('📡 Modo Live Stream activo: Cada clic, arrastre, selección y desagrupación se mostrará automáticamente en F12.');

    return publicAPI;
}));
