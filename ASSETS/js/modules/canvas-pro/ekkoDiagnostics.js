/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v5.0 Deep Capture Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js

Descripción:
Sistema de Auditoría, Trazabilidad e Instrumentación Forense de 5 Niveles para EKKO Studio.
Diseñado bajo los estándares del PROMPT MAESTRO y DIAGNÓSTICO DE ARQUITECTURA.

CAPTURADORES ACTIVOS:
1. DOM Capture Phase (Nivel Hardware/Eventos de Usuario):
   Intercepta clics directamente en los botones físicos (#btnCtxDesagrupar, #btnCtxAgrupar,
   #proBtnUngroup, #btnCtxForward, etc.) en fase de captura antes de la ejecución léxica.
2. Canvas Interaction Observer (Lienzo Paper.js):
   Registra clics, arrastres y selecciones comparando estados antes y después de cada mousedown/mouseup.
3. Desbloqueador de protectGlobal:
   Re-define descriptores de propiedades en window con Object.defineProperty para eludir
   los setters vacíos de selection.js.
4. Auto-Exposición y Resiliencia de Consola:
   Bypassea filtros de consola de Chrome emitiendo los eventos y asegurando persistencia
   completa para EKKO_DIAG.report() y EKKO_DIAG.dump().
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

    // Canal seguro de salida de consola
    const rawConsole = {
        log: (typeof console !== 'undefined' && console.log) ? console.log.bind(console) : () => {},
        warn: (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : () => {},
        error: (typeof console !== 'undefined' && console.error) ? console.error.bind(console) : () => {},
        info: (typeof console !== 'undefined' && console.info) ? console.info.bind(console) : () => {},
        group: (typeof console !== 'undefined' && console.group) ? console.group.bind(console) : () => {},
        groupEnd: (typeof console !== 'undefined' && console.groupEnd) ? console.groupEnd.bind(console) : () => {}
    };

    // Restauración activa por iframe aislado
    try {
        if (typeof document !== 'undefined') {
            const ifr = document.createElement('iframe');
            ifr.style.display = 'none';
            document.documentElement.appendChild(ifr);
            if (ifr.contentWindow && ifr.contentWindow.console) {
                const pure = ifr.contentWindow.console;
                rawConsole.log = pure.log.bind(console);
                rawConsole.warn = pure.warn.bind(console);
                rawConsole.error = pure.error.bind(console);
                rawConsole.info = pure.info.bind(console);
            }
            setTimeout(() => { try { ifr.remove(); } catch(e){} }, 100);
        }
    } catch (e) {}

    // Estado del motor de diagnóstico
    const diagState = {
        active: true,
        opCounter: 0,
        currentOp: null,
        operations: [],
        maxHistory: 250,
        originalMethods: {},
        interceptorsInstalled: false,
        pendingDOMOp: null,
        lastMouseDownPoint: null,
        lastMouseDownSelection: null,
        lastMouseDownGeo: null
    };

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
            label: (primary.data && primary.data.label) || 'Item ' + primary.id,
            zIndex: zIndex,
            isHole: !!(primary.data && primary.data.isHole),
            hasGeomBase: !!(primary.data && primary.data.geomBase),
            geomBaseSegments: (primary.data && primary.data.geomBase) ? countSegments(primary.data.geomBase) : 0,
            visibleSegments: countSegments(primary),
            bounds: extractBounds(primary.bounds),
            position: primary.position ? { x: Number(primary.position.x.toFixed(1)), y: Number(primary.position.y.toFixed(1)) } : null,
            isLocked: !!(primary.data && primary.data.locked)
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

        designLayer.children.forEach((child, index) => {
            if (!child) return;
            const isUI = child.data && (
                child.data.isSelectionBox || child.data.isHandle || child.data.isNodeHandle ||
                child.data.isCurveHandle || child.data.isNodeEditOverlay || child.data.isSmartGuide ||
                child.data.isMeasurement || child.data.isTracePreview || child.data.mockup || child.data.isMask
            );
            if (isUI) return;

            const isHole = !!(child.data && child.data.isHole);
            const hasGeomBase = !!(child.data && child.data.geomBase);

            if (isHole) holeCount++; else massCount++;

            items.push({
                index: index,
                id: child.id,
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
            itemLossDetected: false
        };

        if (beforeGeo.error || afterGeo.error) {
            return { checks, inconsistencies, pass: true };
        }

        // 1. Verificación de Pérdida de Elementos en Desagrupar
        if (opType === 'UNGROUP') {
            if (beforeGeo.totalUsefulItems > 0 && afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
                checks.itemLossDetected = true;
                const lostCount = beforeGeo.totalUsefulItems - afterGeo.totalUsefulItems;
                const afterIds = new Set(afterGeo.zOrderIds);
                const lostIds = beforeGeo.zOrderIds.filter(id => !afterIds.has(id));
                inconsistencies.push(
                    `[PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN] Se perdieron ${lostCount} elementos útiles. IDs desaparecidos: [${lostIds.join(', ')}].`
                );
            }
            if (beforeSel.primary && beforeSel.primary.className === 'Group') {
                if (afterGeo.totalUsefulItems <= beforeGeo.totalUsefulItems && afterGeo.itemsSummary.some(it => it.id === beforeSel.primary.id)) {
                    inconsistencies.push(
                        `[DESAGRUPACIÓN FALLIDA] El grupo ID: ${beforeSel.primary.id} sigue existiendo intacto; el comando no lo descompuso.`
                    );
                }
            }
        }

        // 2. Verificación de geomBase (Corrupción por CSG)
        const beforeMap = new Map();
        beforeGeo.itemsSummary.forEach(it => beforeMap.set(it.id, it));
        afterGeo.itemsSummary.forEach(afterIt => {
            const beforeIt = beforeMap.get(afterIt.id);
            if (beforeIt && beforeIt.hasGeomBase && afterIt.hasGeomBase) {
                if (opType !== 'NODE_EDIT' && beforeIt.geomBaseSegments !== afterIt.geomBaseSegments) {
                    checks.geomBasePreserved = false;
                    inconsistencies.push(
                        `[CORRUPCIÓN GEOMBASE] [ID: ${afterIt.id} "${afterIt.label}"] geomBase mutó fuera de edición de nodos. Antes: ${beforeIt.geomBaseSegments}, Después: ${afterIt.geomBaseSegments} segs. Contaminación CSG.`
                    );
                }
            }
        });

        // 3. Verificación de Selección Huérfana
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
        if (diagState.operations.length > diagState.maxHistory) {
            diagState.operations.shift();
        }

        emitLiveStreamLog(op);
        diagState.currentOp = null;
        return op;
    }

    function emitLiveStreamLog(op) {
        const pass = op.consistency ? op.consistency.pass : true;
        const sel = op.selectionAfter && op.selectionAfter.primary;
        const selDesc = sel ? `ID: ${sel.id} (${sel.className}) | Z: ${sel.zIndex} | ${sel.isHole ? '🕳️ CALADO' : '⬛ MASA'}` : 'Sin selección';
        const geoDesc = `Capas: ${op.geometryAfter.totalUsefulItems} (Masas: ${op.geometryAfter.massCount}, Calados: ${op.geometryAfter.holeCount})`;

        if (pass) {
            rawConsole.info(
                `%c▶ [EKKO_DIAG ${op.id}] %c${op.action}%c | ${selDesc} | ${geoDesc} (${op.durationMs}ms) ✓`,
                'color: #0ea5e9; font-weight: bold;',
                'color: #10b981; font-weight: bold;',
                'color: #334155;'
            );
        } else {
            rawConsole.group(
                `%c🚨 [EKKO_DIAG ALERTA ${op.id}] ${op.action} | ❌ INCONSISTENCIAS DETECTADAS (${op.durationMs}ms)`,
                'color: #ffffff; background: #dc2626; font-weight: bold; font-size: 12px; padding: 3px 6px; border-radius: 4px;'
            );
            rawConsole.warn(`• Origen: ${op.source}`);
            rawConsole.warn(`• Estado previo: ${op.geometryBefore.totalUsefulItems} capas | Estado posterior: ${op.geometryAfter.totalUsefulItems} capas`);
            op.consistency.inconsistencies.forEach(msg => {
                rawConsole.error('  ⚠️ ' + msg);
            });
            rawConsole.info('Tip: Escribe EKKO_DIAG.dump() para copiar el diagnóstico completo.');
            rawConsole.groupEnd();
        }
    }

    // Interceptor eludiendo protectGlobal
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

        // Redefinir sobreescribiendo protectGlobal con configurable: true
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

    // Instalación de escuchadores directos en el DOM (Fase de Captura)
    function installDOMCaptureListeners() {
        if (typeof document === 'undefined') return;

        // 1. Intercepción de Clics en Botones de UI
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
        }, true); // true = Capture Phase (corre antes de cualquier listener local)

        // 2. Intercepción de Interacciones en el Lienzo (#editorCanvas)
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
                        // Fue un arrastre
                        const op = beginOperation('DRAG', 'Arrastre en Lienzo');
                        op.selectionBefore = selBefore;
                        op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
                        endOperation();
                    } else {
                        // Fue un clic de selección / deselección
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

    // Instalación unificada de interceptores
    function installAllInterceptors() {
        if (diagState.interceptorsInstalled) return;

        // Desbloqueo y envoltura de funciones de window
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

        // Escuchadores del DOM y del Canvas
        installDOMCaptureListeners();

        // Envoltura de importSVG en Paper.js
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

    // API Pública de EKKO_DIAG
    const publicAPI = {
        start: function () {
            diagState.active = true;
            installAllInterceptors();
            rawConsole.log('%c[EKKO_DIAG v5.0 Deep Capture] Activo 🟢', 'color: #10b981; font-weight: bold; font-size: 13px;');
            return 'EKKO_DIAG Activo. Interactúa en el lienzo.';
        },

        stop: function () {
            diagState.active = false;
            rawConsole.log('%c[EKKO_DIAG] Detenido 🔴', 'color: #ef4444; font-weight: bold;');
            return 'EKKO_DIAG Detenido.';
        },

        clear: function () {
            diagState.operations = [];
            diagState.opCounter = 0;
            diagState.currentOp = null;
            return 'Historial de operaciones limpiado.';
        },

        report: function () {
            const ops = diagState.operations;
            let outputText = '╔══════════════════════════════════════════════════════════════════════════════════╗\n';
            outputText += '║               EKKO STUDIO DIAGNOSTIC v5.0 - INFORME CONSOLIDADO                  ║\n';
            outputText += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';

            if (ops.length === 0) {
                outputText += 'No hay operaciones registradas aún. Carga un SVG o interactúa en el lienzo.\n';
                rawConsole.log(outputText);
                return outputText;
            }

            outputText += `Total Operaciones Auditadas: ${ops.length}\n\n`;
            ops.forEach(op => {
                const pass = op.consistency ? (op.consistency.pass ? '✓ OK' : '⚠ INCONSISTENCIA') : 'N/A';
                const sel = op.selectionAfter && op.selectionAfter.primary;
                const selStr = sel ? `ID: ${sel.id} (${sel.className}, Z:${sel.zIndex})` : 'Sin selección';
                outputText += `[${op.id}] ${op.action.padEnd(14)} | ${pass.padEnd(16)} | ${op.durationMs}ms | Capas: ${op.geometryAfter.totalUsefulItems} | Sel: ${selStr}\n`;
                if (op.consistency && !op.consistency.pass) {
                    op.consistency.inconsistencies.forEach(inc => {
                        outputText += `   ↳ ⚠️ ${inc}\n`;
                    });
                }
            });

            rawConsole.log(outputText);
            return outputText;
        },

        dump: function () {
            const rep = this.report();
            const payload = rep + '\n\n--- DETALLE FORENSE COMPLETO (JSON) ---\n' + JSON.stringify(diagState.operations, null, 2);
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(payload).then(() => {
                    rawConsole.log('%c[EKKO_DIAG] Diagnóstico forense copiado al portapapeles con éxito.', 'color: #10b981; font-weight: bold;');
                }).catch(() => {});
            }
            return payload;
        },

        last: function () {
            if (diagState.operations.length === 0) return 'No hay operaciones registradas.';
            return diagState.operations[diagState.operations.length - 1];
        }
    };

    // Auto-instalación inmediata y persistente
    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(installAllInterceptors, 200);
            });
        } else {
            setTimeout(installAllInterceptors, 200);
        }
        window.addEventListener('load', () => {
            setTimeout(installAllInterceptors, 500);
            setTimeout(installAllInterceptors, 1500);
        });
    }

    return publicAPI;
}));
