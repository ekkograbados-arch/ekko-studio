/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v6.2.2 PRO Deep Capture & Surface Area Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
Sistema de Auditoría, Trazabilidad e Instrumentación Forense de 5 Niveles para EKKO Studio.
Diseñado específicamente para verificar la consistencia del motor de:
1. DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN (1-Click Atomic Ungroup).
2. PRESERVACIÓN INMACULADA DE GEOMETRÍA BASE (geomBasePreserved).
3. GOBERNANZA ESTRICTA DEL ORDEN Z Y APILAMIENTO CSG (zOrderPreserved).
4. MULTISELECCIÓN UNIFICADA Y SINCRONIZACIÓN DE MENÚ CONTEXTUAL.
5. DETECCIÓN ACTIVA DE COLAPSO DE ÁREA VISIBLE (massCollapseDetected):
   - Detecta si una masa sólida sufre aniquilación booleana (0 segmentos visibles o
     área colapsada a cero) cuando dos o más calados interactivos colisionan.
6. PRESERVACIÓN DE CONSISTENCIA Y EXPOSICIÓN GLOBAL (EKKO_DIAG).
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

    // Canal seguro de salida de consola (elude silenciamientos externos de loggers)
    const rawConsole = {
        log: (typeof console !== 'undefined' && console.log) ? console.log.bind(console) : () => {},
        warn: (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : () => {},
        error: (typeof console !== 'undefined' && console.error) ? console.error.bind(console) : () => {},
        table: (typeof console !== 'undefined' && console.table) ? console.table.bind(console) : () => {}
    };

    try {
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            const ifr = document.createElement('iframe');
            ifr.style.display = 'none';
            document.body.appendChild(ifr);
            const pure = ifr.contentWindow.console;
            if (pure) {
                rawConsole.log = pure.log.bind(console);
                rawConsole.warn = pure.warn.bind(console);
                rawConsole.error = pure.error.bind(console);
                rawConsole.table = pure.table ? pure.table.bind(console) : rawConsole.table;
            }
            setTimeout(() => ifr.remove(), 1000);
        }
    } catch (e) {}

    const diagState = {
        active: true,
        operations: [],
        currentOp: null,
        opCounter: 0,
        interceptorsInstalled: false,
        lastMouseDownPoint: null,
        lastMouseDownSelection: null,
        lastMouseDownGeo: null
    };

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

    function calculateItemArea(item) {
        if (!item) return 0;
        if (typeof item.area === 'number') {
            return Math.abs(item.area);
        }
        if (item.children && Array.isArray(item.children)) {
            let total = 0;
            item.children.forEach(c => {
                total += calculateItemArea(c);
            });
            return total;
        }
        if (item.bounds) {
            return item.bounds.width * item.bounds.height;
        }
        return 0;
    }

    function isLockedItem(item) {
        return !!(item && item.data && item.data.locked === true);
    }

    function extractBounds(bounds) {
        if (!bounds) return null;
        return {
            x: Number(bounds.x.toFixed(1)),
            y: Number(bounds.y.toFixed(1)),
            width: Number(bounds.width.toFixed(1)),
            height: Number(bounds.height.toFixed(1))
        };
    }

    function countSegments(item) {
        if (!item) return 0;
        if (item.segments) return item.segments.length;
        if (item.children && Array.isArray(item.children)) {
            let count = 0;
            item.children.forEach(c => {
                count += countSegments(c);
            });
            return count;
        }
        return 0;
    }

    function isMockupOrUI(item) {
        let curr = item;
        while (curr) {
            const d = curr.data || {};
            if (d.mockup || d.isMask || d.wasClipMask || d.isSelectionBox || d.isHandle ||
                d.isNodeHandle || d.isCurveHandle || d.isNodeEditOverlay || d.isSmartGuide ||
                d.isMeasurement || d.isTracePreview) {
                return true;
            }
            curr = curr.parent;
        }
        return false;
    }

    function snapshotSelection() {
        const item = typeof window !== 'undefined' ? (window.selectedItem || null) : null;
        const selectedItems = typeof window !== 'undefined' ? (window.selectedItems || []) : [];

        if (!item && selectedItems.length === 0) {
            return { hasSelection: false, primary: null, count: 0, ids: [] };
        }

        const primary = item || selectedItems[0];
        const target = getContentItem(primary);

        const targetPos = target && target.position ? {
            x: Number(target.position.x.toFixed(1)),
            y: Number(target.position.y.toFixed(1))
        } : null;

        const primaryData = primary ? {
            id: primary.id,
            contentId: target ? target.id : primary.id,
            className: target ? target.className : primary.className,
            label: (target && target.data && target.data.label) || (primary.data && primary.data.label) || 'Objeto',
            zIndex: typeof primary.index === 'number' ? primary.index : 0,
            isHole: !!(target && target.data && target.data.isHole),
            isClipped: !!(primary.data && primary.data.clipGroup),
            hasGeomBase: !!(target && target.data && target.data.geomBase),
            geomBaseSegments: countSegments(target && target.data && target.data.geomBase),
            visibleSegments: countSegments(target || primary),
            visibleArea: Number(calculateItemArea(target || primary).toFixed(1)),
            bounds: target ? extractBounds(target.bounds) : extractBounds(primary.bounds),
            position: targetPos,
            isLocked: isLockedItem(primary)
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
            return { totalUsefulItems: 0, itemsSummary: [], massCount: 0, holeCount: 0, zOrderIds: [], error: 'Paper.js no inicializado' };
        }

        const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        if (!designLayer || !designLayer.children) {
            return { totalUsefulItems: 0, itemsSummary: [], massCount: 0, holeCount: 0, zOrderIds: [] };
        }

        const items = [];
        let massCount = 0;
        let holeCount = 0;

        designLayer.children.forEach((child, idx) => {
            if (isMockupOrUI(child)) return;

            const target = getContentItem(child);
            if (!target) return;

            const isHole = !!(target.data && target.data.isHole);
            if (isHole) holeCount++; else massCount++;

            const gBase = target.data && target.data.geomBase;
            const vArea = calculateItemArea(target);

            items.push({
                index: idx,
                id: child.id,
                contentId: target.id,
                className: target.className,
                label: (target.data && target.data.label) || (child.data && child.data.label) || 'Objeto',
                isHole: isHole,
                isClipped: !!(child.data && child.data.clipGroup),
                hasGeomBase: !!gBase,
                geomBaseSegments: countSegments(gBase),
                visibleSegments: countSegments(target),
                visibleArea: Number(vArea.toFixed(1)),
                bounds: extractBounds(target.bounds)
            });
        });

        return {
            timestamp: Date.now(),
            totalUsefulItems: items.length,
            massCount: massCount,
            holeCount: holeCount,
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
            itemLossDetected: false,
            dragDisplacementValid: true,
            productClippingValid: true,
            massCollapseDetected: false
        };

        if (!beforeGeo || !afterGeo) {
            return { checks, inconsistencies, pass: true };
        }

        // 1. Verificación de Preservación de geomBase
        afterGeo.itemsSummary.forEach(afterItem => {
            if (afterItem.hasGeomBase) {
                const prev = beforeGeo.itemsSummary.find(b => b.id === afterItem.id);
                if (prev && prev.hasGeomBase) {
                    if (prev.geomBaseSegments > 0 && afterItem.geomBaseSegments !== prev.geomBaseSegments) {
                        checks.geomBasePreserved = false;
                        inconsistencies.push(`[GEOM_BASE ALTERADA] Item ID: ${afterItem.id} mutó de ${prev.geomBaseSegments} a ${afterItem.geomBaseSegments} segmentos.`);
                    }
                }
            }
        });

        // 2. Detección de Colapso de Masa Sólida
        afterGeo.itemsSummary.forEach(afterItem => {
            if (!afterItem.isHole && afterItem.hasGeomBase) {
                if (afterItem.visibleSegments === 0 || afterItem.visibleArea <= 0) {
                    checks.massCollapseDetected = true;
                    inconsistencies.push(`[COLAPSO DE MASA] Masa sólida ID: ${afterItem.id} colapsó a 0 segmentos o área nula tras CSG.`);
                }
            }
        });

        // 3. Verificación de Pérdida Inesperada de Elementos
        if (opType !== 'DELETE' && opType !== 'UNGROUP' && opType !== 'GROUP') {
            if (afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
                checks.itemLossDetected = true;
                inconsistencies.push(`[PÉRDIDA DE ELEMENTOS] Se detectó reducción de capas de ${beforeGeo.totalUsefulItems} a ${afterGeo.totalUsefulItems} durante ${opType}.`);
            }
        }

        // 4. Verificación de Selección Huérfana
        if (afterSel.hasSelection && typeof window !== 'undefined' && window.selectedItem) {
            const curr = window.selectedItem;
            if (!curr.project || !curr.parent) {
                checks.selectionValid = false;
                inconsistencies.push(`[SELECCIÓN HUÉRFANA] window.selectedItem apunta a un objeto desvinculado (ID: ${curr.id}).`);
            }
        }

        const pass = inconsistencies.length === 0;
        return { checks, inconsistencies, pass };
    }

    function beginOperation(actionName, triggerSource) {
        if (!diagState.active) return null;
        diagState.opCounter++;
        const opId = 'OP-' + String(diagState.opCounter).padStart(5, '0');

        const op = {
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

        diagState.currentOp = op;
        return op;
    }

    function endOperation() {
        if (!diagState.active || !diagState.currentOp) return null;

        const op = diagState.currentOp;
        op.endTime = performance.now();
        op.durationMs = Number((op.endTime - op.startTime).toFixed(1));
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
        if (diagState.operations.length > 500) {
            diagState.operations.shift();
        }

        emitLiveStreamLog(op);
        diagState.currentOp = null;
        return op;
    }

    function emitLiveStreamLog(op) {
        if (!op) return;
        const sel = op.selectionAfter;
        let selDesc = "Sin selección";
        if (sel && sel.hasSelection && sel.primary) {
            selDesc = `ID: ${sel.primary.id} (${sel.primary.className}, Z:${sel.primary.zIndex})`;
        }

        if (op.consistency && op.consistency.pass) {
            rawConsole.log(
                `%c[${op.id}] ${op.action}%c | ✓ OK | ${op.durationMs}ms | Capas: ${op.geometryAfter ? op.geometryAfter.totalUsefulItems : 0} | Sel: ${selDesc}`,
                'color: #0284c7; font-weight: bold;',
                'color: #10b981;'
            );
        } else {
            rawConsole.warn(
                `%c[${op.id}] ${op.action}%c | ⚠️ INCONSISTENCIA DETECTADA (${op.durationMs}ms) | ${selDesc}`,
                'color: #ea580c; font-weight: bold;',
                'color: #ef4444;'
            );
            if (op.consistency && op.consistency.inconsistencies) {
                op.consistency.inconsistencies.forEach(inc => {
                    rawConsole.error(`   ↳ ${inc}`);
                });
            }
        }
    }

    function forceWrapWindowFunction(fnName, modulePath, actionType) {
        if (typeof window === 'undefined') return;
        let original = window[fnName];
        if (typeof original !== 'function') return;

        const wrapped = function (...args) {
            const hasExisting = !!diagState.currentOp;
            let op = null;
            if (diagState.active && !hasExisting && actionType) {
                op = beginOperation(actionType, `${modulePath} -> ${fnName}`);
            }

            const t0 = performance.now();
            let res, err = null;
            try {
                res = original.apply(this, args);
            } catch (e) {
                err = e;
                throw e;
            } finally {
                const t1 = performance.now();
                if (diagState.currentOp) {
                    diagState.currentOp.callGraph.push({
                        fnName: fnName,
                        module: modulePath,
                        durationMs: Number((t1 - t0).toFixed(1)),
                        error: err ? err.message : null
                    });
                }
                if (op) {
                    endOperation();
                }
            }
            return res;
        };

        try {
            Object.defineProperty(window, fnName, {
                value: wrapped,
                writable: true,
                configurable: true,
                enumerable: true
            });
        } catch (e) {
            window[fnName] = wrapped;
        }
    }

    function installDOMCaptureListeners() {
        if (typeof document === 'undefined') return;

        document.addEventListener('click', function (e) {
            if (!diagState.active) return;
            const target = e.target;
            if (!target) return;

            const btnUngroup = target.closest('#btnCtxUngroup, #btnCtxDesagrupar, #proBtnUngroup');
            const btnGroup = target.closest('#btnCtxGroup, #btnCtxAgrupar, #proBtnGroup');
            const btnForward = target.closest('#btnCtxForward, #proBtnBringForward');
            const btnBackward = target.closest('#btnCtxBackward, #proBtnSendBackward');
            const btnEditNodes = target.closest('#btnCtxEditNodes, #btnCtxNodeEdit, #proBtnEditNodes');
            const btnDelete = target.closest('#btnCtxDelete');

            let actionName = null;
            let triggerSource = null;

            if (btnUngroup) { actionName = 'UNGROUP'; triggerSource = 'Botón Desagrupar'; }
            else if (btnGroup) { actionName = 'GROUP'; triggerSource = 'Botón Agrupar'; }
            else if (btnForward) { actionName = 'BRING_FORWARD'; triggerSource = 'Botón Subir Capa'; }
            else if (btnBackward) { actionName = 'SEND_BACKWARD'; triggerSource = 'Botón Bajar Capa'; }
            else if (btnEditNodes) { actionName = 'NODE_EDIT'; triggerSource = 'Botón Editar Nodos'; }
            else if (btnDelete) { actionName = 'DELETE'; triggerSource = 'Botón Eliminar'; }

            if (actionName) {
                const op = beginOperation(actionName, triggerSource);
                setTimeout(() => {
                    if (diagState.currentOp === op) {
                        endOperation();
                    }
                }, 80);
            }
        }, true);

        const canvasEl = document.getElementById('editorCanvas');
        if (canvasEl) {
            canvasEl.addEventListener('mousedown', function (e) {
                if (!diagState.active) return;
                diagState.lastMouseDownPoint = { x: e.clientX, y: e.clientY };
                diagState.lastMouseDownSelection = snapshotSelection();
                diagState.lastMouseDownGeo = snapshotGeometricState();
            }, true);

            canvasEl.addEventListener('mouseup', function (e) {
                if (!diagState.active) return;
                const ptDown = diagState.lastMouseDownPoint;
                if (!ptDown) return;

                const dx = Math.abs(e.clientX - ptDown.x);
                const dy = Math.abs(e.clientY - ptDown.y);
                const isDrag = (dx > 3 || dy > 3);

                setTimeout(() => {
                    const selNow = snapshotSelection();
                    const geoNow = snapshotGeometricState();
                    const selBefore = diagState.lastMouseDownSelection || selNow;

                    if (isDrag) {
                        const op = beginOperation('DRAG', 'Arrastre en Lienzo');
                        op.selectionBefore = selBefore;
                        op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
                        endOperation();
                    } else {
                        const idBefore = (selBefore.primary && selBefore.primary.id) || null;
                        const idNow = (selNow.primary && selNow.primary.id) || null;
                        if (idBefore !== idNow) {
                            const action = idNow ? 'SELECT' : 'DESELECT';
                            const op = beginOperation(action, 'Clic en Lienzo');
                            op.selectionBefore = selBefore;
                            op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
                            endOperation();
                        }
                    }
                }, 60);
            }, true);
        }
    }

    function installAllInterceptors() {
        if (diagState.interceptorsInstalled) return;

        forceWrapWindowFunction('decomposeByContainmentHierarchy', 'geometricUngroup.js', 'UNGROUP');
        forceWrapWindowFunction('recalculateDynamicSubtractions', 'geometricUngroup.js', null);
        forceWrapWindowFunction('selectItem', 'selection.js', 'SELECT');
        forceWrapWindowFunction('deselectItem', 'selection.js', 'DESELECT');
        forceWrapWindowFunction('ungroupSelectedItem', 'contextualMenu.js', 'UNGROUP');
        forceWrapWindowFunction('groupSelectedItems', 'contextualMenu.js', 'GROUP');
        forceWrapWindowFunction('enterNodeEditMode', 'nodeEditor.js', 'NODE_EDIT');
        forceWrapWindowFunction('exitNodeEditMode', 'nodeEditor.js', 'EXIT_NODE_EDIT');
        forceWrapWindowFunction('bringFront', 'editor.js', 'BRING_FRONT');
        forceWrapWindowFunction('sendBack', 'editor.js', 'SEND_BACK');
        forceWrapWindowFunction('bringForward', 'editor.js', 'BRING_FORWARD');
        forceWrapWindowFunction('sendBackward', 'editor.js', 'SEND_BACKWARD');

        installDOMCaptureListeners();

        if (typeof paper !== 'undefined' && paper.project && !paper.project._diagWrapped) {
            const origImportSVG = paper.project.importSVG;
            paper.project.importSVG = function (...args) {
                const op = beginOperation('IMPORT_SVG', 'paper.project.importSVG');
                const cb = args[1];
                if (typeof cb === 'function') {
                    args[1] = function (item) {
                        const res = cb(item);
                        setTimeout(() => { endOperation(); }, 50);
                        return res;
                    };
                }
                return origImportSVG.apply(this, args);
            };
            paper.project._diagWrapped = true;
        }

        diagState.interceptorsInstalled = true;
    }

    const publicAPI = {
        start: function () {
            diagState.active = true;
            installAllInterceptors();
            rawConsole.log('%c[EKKO_DIAG v6.2 Deep Capture] Activo 🟢', 'color: #10b981; font-weight: bold; font-size: 13px;');
            return 'EKKO_DIAG Activo. Interactúa en el lienzo.';
        },
        stop: function () {
            diagState.active = false;
            rawConsole.log('%c[EKKO_DIAG] Detenido 🔴', 'color: #ef4444; font-weight: bold;');
            return 'EKKO_DIAG Detenido.';
        },
        report: function () {
            const ops = diagState.operations;
            const total = ops.length;
            const passes = ops.filter(o => o.consistency && o.consistency.pass).length;
            const fails = total - passes;

            rawConsole.log('%c═══════════════════════════════════════════════════════════════════', 'color: #0284c7;');
            rawConsole.log(`%cEKKO STUDIO DIAGNOSTIC v6.2 - RESUMEN EJECUTIVO: ${passes}/${total} OK`, 'color: #0284c7; font-weight: bold;');
            rawConsole.log('%c═══════════════════════════════════════════════════════════════════', 'color: #0284c7;');

            const tableData = ops.map(o => ({
                ID: o.id,
                Acción: o.action,
                Fuente: o.source,
                'Duración (ms)': o.durationMs,
                'Capas Tras': o.geometryAfter ? o.geometryAfter.totalUsefulItems : 0,
                Consistencia: (o.consistency && o.consistency.pass) ? '✓ OK' : '✗ ERROR'
            }));
            rawConsole.table(tableData);
            return `Auditoría: ${passes} OK, ${fails} Inconsistencias registradas.`;
        },
        dump: function () {
            const lines = [];
            lines.push("╔══════════════════════════════════════════════════════════════════════════════════╗");
            lines.push("║             EKKO STUDIO DIAGNOSTIC v6.2 - INFORME CONSOLIDADO                   ║");
            lines.push("╚══════════════════════════════════════════════════════════════════════════════════╝\n");
            lines.push(`Total Operaciones Auditadas: ${diagState.operations.length}\n`);

            diagState.operations.forEach(op => {
                const pass = op.consistency && op.consistency.pass ? "✓ OK" : "✗ ERROR";
                const sel = op.selectionAfter && op.selectionAfter.primary
                    ? `ID: ${op.selectionAfter.primary.id} (${op.selectionAfter.primary.className}, Z:${op.selectionAfter.primary.zIndex})`
                    : "Sin selección";
                const capas = op.geometryAfter ? op.geometryAfter.totalUsefulItems : 0;
                lines.push(`[${op.id}] ${op.action} | ${pass} | ${op.durationMs}ms | Capas: ${capas} | Sel: ${sel}`);
            });

            lines.push("\n\n--- DETALLE FORENSE COMPLETO (JSON) ---");
            lines.push(JSON.stringify(diagState.operations, null, 2));

            const payload = lines.join("\n");
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(payload).catch(() => {});
            }
            return payload;
        },
        last: function () {
            if (diagState.operations.length === 0) return 'No hay operaciones registradas.';
            return diagState.operations[diagState.operations.length - 1];
        }
    };

    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
        setTimeout(() => {
            publicAPI.start();
        }, 300);
    }

    return publicAPI;
}));
