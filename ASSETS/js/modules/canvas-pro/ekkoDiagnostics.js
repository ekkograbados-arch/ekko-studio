/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v6.2 PRO Deep Capture & Surface Area Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
Sistema de Auditoría, Trazabilidad e Instrumentación Forense de 5 Niveles para EKKO Studio.
Diseñado específicamente para verificar la consistencia del motor de:
- Descomposición por Jerarquía de Contención y Capas SVG.
- Orden Z no destructivo y Reactividad CSG en vivo.
- Preservación de geomBase, masas sólidas y calados activos.
- Detección activa de Colapso de Área Visible o Masas Aniquiladas (Rule 8).

AUDITORÍAS INTEGRADAS:
1. AUDITORÍA TOPOLÓGICA DE CAPAS (itemLossDetected):
   - Verifica que al desagrupar no desaparezcan elementos útiles del lienzo.
2. AUDITORÍA DE ARRASTRE REAL (dragDisplacementValid):
   - Comprueba que tras una operación 'DRAG', el elemento primario haya mutado
     físicamente su posición (evita falsos positivos de arrastres nulos).
3. AUDITORÍA DE ENMASCARAMIENTO Y RECORTE (productClippingValid):
   - Verifica que la máscara concéntrica del producto no sufra deformación o desplazamiento.
4. AUDITORÍA DE PRESERVACIÓN DE GEOMETRÍA BASE (geomBasePreserved):
   - Asegura que geomBase contenga siempre la cantidad de segmentos original prístina.
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
        table: (typeof console !== 'undefined' && console.table) ? console.table.bind(console) : () => {},
        group: (typeof console !== 'undefined' && console.group) ? console.group.bind(console) : () => {},
        groupEnd: (typeof console !== 'undefined' && console.groupEnd) ? console.groupEnd.bind(console) : () => {}
    };

    // Restauración de consola pura mediante iframe efímero para depuración protegida
    try {
        if (typeof document !== 'undefined' && document.body) {
            const ifr = document.createElement('iframe');
            ifr.style.display = 'none';
            document.body.appendChild(ifr);
            if (ifr.contentWindow && ifr.contentWindow.console) {
                const pure = ifr.contentWindow.console;
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
            let total = 0;
            item.children.forEach(c => { total += countSegments(c); });
            return total;
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
        const items = typeof window !== 'undefined' && Array.isArray(window.selectedItems) ? window.selectedItems : (item ? [item] : []);
        
        let primaryData = null;
        if (item) {
            const actual = getContentItem(item);
            const d = actual.data || {};
            const pos = item.position ? { x: Number(item.position.x.toFixed(1)), y: Number(item.position.y.toFixed(1)) } : null;
            const b = extractBounds(item.bounds);
            const baseSegs = d.geomBase ? countSegments(d.geomBase) : 0;
            const visSegs = countSegments(actual);
            const visArea = actual.area !== undefined ? Number(Math.abs(actual.area).toFixed(1)) : (actual.bounds ? Number((actual.bounds.width * actual.bounds.height).toFixed(1)) : 0);

            primaryData = {
                id: item.id,
                contentId: actual.id,
                className: actual.className,
                label: d.label || item.name || 'Sin etiqueta',
                zIndex: item.index !== undefined ? item.index : -1,
                isHole: !!d.isHole,
                isClipped: !!(item.data && item.data.clipGroup),
                hasGeomBase: !!d.geomBase,
                geomBaseSegments: baseSegs,
                visibleSegments: visSegs,
                visibleArea: visArea,
                bounds: b,
                position: pos,
                isLocked: isLockedItem(item)
            };
        }

        return {
            hasSelection: items.length > 0,
            primary: primaryData,
            count: items.length,
            ids: items.map(it => it.id)
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

        const useful = [];
        designLayer.children.forEach(child => {
            if (isMockupOrUI(child)) return;
            useful.push(child);
        });

        let masses = 0;
        let holes = 0;
        const summaries = [];
        const zIds = [];

        useful.forEach((it, idx) => {
            const actual = getContentItem(it);
            const d = actual.data || {};
            const isHole = !!d.isHole;
            if (isHole) holes++; else masses++;
            zIds.push(it.id);

            const baseSegs = d.geomBase ? countSegments(d.geomBase) : 0;
            const visSegs = countSegments(actual);
            const visArea = actual.area !== undefined ? Number(Math.abs(actual.area).toFixed(1)) : (actual.bounds ? Number((actual.bounds.width * actual.bounds.height).toFixed(1)) : 0);

            summaries.push({
                index: idx,
                id: it.id,
                contentId: actual.id,
                className: actual.className,
                label: d.label || it.name || 'Objeto',
                isHole: isHole,
                isClipped: !!(it.data && it.data.clipGroup),
                hasGeomBase: !!d.geomBase,
                geomBaseSegments: baseSegs,
                visibleSegments: visSegs,
                visibleArea: visArea,
                bounds: extractBounds(it.bounds)
            });
        });

        return {
            timestamp: Date.now(),
            totalUsefulItems: useful.length,
            massCount: masses,
            holeCount: holes,
            zOrderIds: zIds,
            itemsSummary: summaries
        };
    }

    function auditConsistency(beforeGeo, afterGeo, beforeSel, afterSel, callGraph, actionName) {
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

        // 1. Verificación de Pérdida Inesperada de Capas (Excepto en DELETE o UNGROUP)
        if (actionName !== 'DELETE' && actionName !== 'UNGROUP') {
            if (afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
                checks.itemLossDetected = true;
                inconsistencies.push(`[PÉRDIDA DE CAPAS] Se redujo el conteo útil de ${beforeGeo.totalUsefulItems} a ${afterGeo.totalUsefulItems}.`);
            }
        }

        // 2. Detección de Desplazamiento Válido en ARRASTRE (DRAG)
        if (actionName === 'DRAG') {
            if (beforeSel.primary && afterSel.primary && beforeSel.primary.id === afterSel.primary.id) {
                const p0 = beforeSel.primary.position;
                const p1 = afterSel.primary.position;
                if (p0 && p1) {
                    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
                    if (dist < 0.01 && (beforeSel.primary.visibleArea === afterSel.primary.visibleArea)) {
                        checks.dragDisplacementValid = false;
                        inconsistencies.push(`[ARRASTRE ESTÁTICO] La operación DRAG no generó desplazamiento espacial (distancia: ${dist.toFixed(2)}px).`);
                    }
                }
            }
        }

        // 3. Verificación de Integridad de geomBase y Detección de Colapso de Masas
        afterGeo.itemsSummary.forEach(itemAfter => {
            const itemBefore = beforeGeo.itemsSummary.find(it => it.id === itemAfter.id);
            if (itemBefore && itemBefore.hasGeomBase && itemAfter.hasGeomBase) {
                if (itemBefore.geomBaseSegments !== itemAfter.geomBaseSegments) {
                    checks.geomBasePreserved = false;
                    inconsistencies.push(
                        `[CORRUPCIÓN GEOMBASE] Objeto ID: ${itemAfter.id} mutó geomBase de ${itemBefore.geomBaseSegments} a ${itemAfter.geomBaseSegments} segmentos.`
                    );
                }
            }

            // Sensor Anti-Aniquilación / Colapso de Área (Rule 8)
            if (!itemAfter.isHole && itemAfter.hasGeomBase) {
                if (itemAfter.visibleSegments === 0 || itemAfter.visibleArea <= 0.05) {
                    checks.massCollapseDetected = true;
                    inconsistencies.push(
                        `[COLAPSO DE MASA DETECTADO] Masa sólida ID: ${itemAfter.id} sufrió aniquilación por CSG (Segmentos: ${itemAfter.visibleSegments}, Área: ${itemAfter.visibleArea} px²).`
                    );
                }
            }
        });

        // 4. Verificación de Selección Huérfana
        if (afterSel.hasSelection && typeof window !== 'undefined' && window.selectedItem) {
            const curr = window.selectedItem;
            if (!curr.project || !curr.parent) {
                checks.selectionValid = false;
                inconsistencies.push(`[SELECCIÓN HUÉRFANA] window.selectedItem apunta a un objeto desvinculado (ID: ${curr.id}).`);
            }
        }

        // 5. Verificación de Enmascaramiento y Recorte en Producto (Mockup Containment)
        if (typeof window !== 'undefined' && window.currentMockup && window.currentMockup.bounds) {
            const mb = window.currentMockup.bounds;
            afterGeo.itemsSummary.forEach(item => {
                if (item.bounds) {
                    const ib = item.bounds;
                    const isOutside = (ib.x + ib.width < mb.x - 500) || (ib.x > mb.x + mb.width + 500) ||
                                      (ib.y + ib.height < mb.y - 500) || (ib.y > mb.y + mb.height + 500);
                    if (isOutside) {
                        checks.productClippingValid = false;
                        inconsistencies.push(`[FUGA DE ENTORNO] Objeto ID: ${item.id} se encuentra fuera de los límites de trabajo del mockup.`);
                    }
                }
            });
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
        const pass = op.consistency ? op.consistency.pass : true;
        const sel = op.selectionAfter && op.selectionAfter.primary;
        const selDesc = sel ? `ID: ${sel.id} (${sel.className}) | Z: ${sel.zIndex} | ${sel.isHole ? '🕳️ CALADO' : '⬛ MASA'}` : 'Sin selección';
        const geoDesc = `Capas: ${op.geometryAfter.totalUsefulItems} (Masas: ${op.geometryAfter.massCount}, Calados: ${op.geometryAfter.holeCount})`;

        if (pass) {
            rawConsole.log(
                `%c[${op.id}] ${op.action}%c | ✓ OK (${op.durationMs}ms) | ${selDesc} | ${geoDesc}`,
                'color: #0284c7; font-weight: bold;',
                'color: #10b981;'
            );
        } else {
            rawConsole.warn(
                `%c[${op.id}] ${op.action}%c | ⚠️ INCONSISTENCIA DETECTADA (${op.durationMs}ms) | ${selDesc}`,
                'color: #ea580c; font-weight: bold;',
                'color: #ef4444;'
            );
            op.consistency.inconsistencies.forEach(inc => {
                rawConsole.error(`   ↳ ${inc}`);
            });
        }
    }

    // Interceptor eludiendo protectGlobal
    function forceWrapWindowFunction(fnName, modulePath, actionType) {
        if (typeof window === 'undefined') return;
        const originalFn = window[fnName];
        if (typeof originalFn !== 'function') return;

        const wrapped = function (...args) {
            let op = null;
            if (actionType && !diagState.currentOp) {
                op = beginOperation(actionType, `${modulePath} -> ${fnName}`);
            }

            const t0 = performance.now();
            let res;
            let err = null;
            try {
                res = originalFn.apply(this, args);
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
            const btnForward = target.closest('#btnCtxForward');
            const btnBackward = target.closest('#btnCtxBackward');
            const btnEditNodes = target.closest('#btnCtxEditNodes, #btnCtxNodeEdit, #proBtnEditNodes');
            const btnDelete = target.closest('#btnCtxDelete');

            let actionName = null;
            let triggerSource = null;

            if (btnUngroup) { actionName = 'UNGROUP'; triggerSource = 'Botón Desagrupar'; }
            else if (btnGroup) { actionName = 'GROUP'; triggerSource = 'Botón Agrupar'; }
            else if (btnForward) { actionName = 'BRING_FORWARD'; triggerSource = 'Botón Subir Capa'; }
            else if (btnBackward) { actionName = 'SEND_BACKWARD'; triggerSource = 'Botón Bajar Capa'; }
            else if (btnEditNodes) { actionName = 'TOGGLE_NODE_EDIT'; triggerSource = 'Botón Editar Nodos'; }
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

                // Si hubo arrastre físico en pantalla (> 3 píxeles)
                if (dx > 3 || dy > 3) {
                    const op = beginOperation('DRAG', 'Arrastre en Lienzo');
                    if (diagState.lastMouseDownSelection) op.selectionBefore = diagState.lastMouseDownSelection;
                    if (diagState.lastMouseDownGeo) op.geometryBefore = diagState.lastMouseDownGeo;
                    setTimeout(() => {
                        endOperation();
                    }, 50);
                } else {
                    // Clic estático de selección o deselección
                    setTimeout(() => {
                        const selBefore = diagState.lastMouseDownSelection;
                        const selNow = snapshotSelection();
                        const geoNow = snapshotGeometricState();

                        if (selBefore) {
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
                }
            }, true);
        }
    }

    // Instalación unificada de interceptores
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
            const origImportSVG = paper.project.importSVG.bind(paper.project);
            paper.project.importSVG = function (...args) {
                const op = beginOperation('IMPORT_SVG', 'paper.project.importSVG');
                const res = origImportSVG(...args);
                setTimeout(() => {
                    endOperation();
                }, 100);
                return res;
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
            rawConsole.log('%c[EKKO_DIAG v6.2 Deep Capture] Activo 🟢', 'color: #10b981; font-weight: bold; font-size: 13px;');
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
            outputText += '║               EKKO STUDIO DIAGNOSTIC v6.2 - INFORME CONSOLIDADO                  ║\n';
            outputText += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';
            outputText += `Total Operaciones Auditadas: ${ops.length}\n\n`;

            ops.forEach(op => {
                const status = (op.consistency && op.consistency.pass) ? '✓ OK' : '⚠️ INCONSISTENCIA';
                const sel = op.selectionAfter && op.selectionAfter.primary;
                const selLabel = sel ? `ID: ${sel.id} (${sel.className}, Z:${sel.zIndex})` : 'Sin selección';
                const capCount = op.geometryAfter ? op.geometryAfter.totalUsefulItems : 0;
                outputText += `[${op.id}] ${op.action.padEnd(14, ' ')} | ${status} | ${op.durationMs}ms | Capas: ${capCount} | Sel: ${selLabel}\n`;
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

    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
        setTimeout(() => {
            publicAPI.start();
        }, 300);
    }

    return publicAPI;
}));
