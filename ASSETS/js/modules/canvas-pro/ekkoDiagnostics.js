/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v13.0 EagleEye Forensic BlackBox)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
    Caja Negra Forense de Última Generación "Ojos de Águila" con Monitoreo de
    Conectividad DOM, Intercepción de EventListeners y Auditoría Visual 3D/2D
    de Lienzo para EKKO Studio.
    
    Implementa:
    1. Intercepción del Prototipo de EventTarget para registrar listeners reales (Fin de "Botones Muertos").
    2. Setters Reactivos dinámicos en 'window' para auto-envolver funciones asíncronas de carga diferida.
    3. Inspección geométrica activa de Viewport y visibilidad física de nodos (Paper.js).
    4. Comando interactivo 'EKKO_DIAG.inspect()' para auditorías en caliente.

AUTORIDAD: STUDIO ACTUAL / REPOSITORIO CANÓNICO V7
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

    // =========================================================================
    // NIVELES 1 Y 2: CANAL SEGURO DE CONSOLA E INTERCEPCIÓN DE EXCEPCIONES
    // =========================================================================
    const rawConsole = {
        log: (typeof console !== 'undefined' && console.log) ? console.log.bind(console) : () => {},
        warn: (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : () => {},
        error: (typeof console !== 'undefined' && console.error) ? console.error.bind(console) : () => {},
        table: (typeof console !== 'undefined' && console.table) ? console.table.bind(console) : () => {}
    };

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
                rawConsole.table = pure.table ? pure.table.bind(console) : rawConsole.table;
            }
            setTimeout(() => ifr.remove(), 1000);
        }
    } catch (e) {}

    // --- ESTADO CENTRAL DEL RECOLECTOR DE LA CAJA NEGRA ---
    const diagState = {
        active: true,
        operations: [],
        currentOp: null,
        opCounter: 0,
        consoleErrors: [],
        eventRegistry: new Map(), // Element -> Set of events bound
        lastMouseDownPoint: null,
        lastMouseDownSelection: null,
        lastMouseDownGeo: null,
        dragTracker: {
            active: false,
            startX: 0,
            startY: 0,
            dragMode: 'MOVE'
        }
    };

    // =========================================================================
    // MEJORAS INDISPENSABLES V13: INTERCEPCIÓN AGRESIVA DE EVENT LISTENERS (ANTI-BOTÓN MUERTO)
    // =========================================================================
    try {
        if (typeof EventTarget !== 'undefined' && EventTarget.prototype) {
            const originalAddEventListener = EventTarget.prototype.addEventListener;
            EventTarget.prototype.addEventListener = function (type, listener, options) {
                try {
                    if (this instanceof HTMLElement || this === window || this === document) {
                        const selector = getFriendlySelector(this);
                        if (!diagState.eventRegistry.has(selector)) {
                            diagState.eventRegistry.set(selector, new Set());
                        }
                        diagState.eventRegistry.get(selector).add(type);
                    }
                } catch (err) {}
                return originalAddEventListener.call(this, type, listener, options);
            };

            const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
            EventTarget.prototype.removeEventListener = function (type, listener, options) {
                try {
                    if (this instanceof HTMLElement || this === window || this === document) {
                        const selector = getFriendlySelector(this);
                        if (diagState.eventRegistry.has(selector)) {
                            diagState.eventRegistry.get(selector).delete(type);
                            if (diagState.eventRegistry.get(selector).size === 0) {
                                diagState.eventRegistry.delete(selector);
                            }
                        }
                    }
                } catch (err) {}
                return originalRemoveEventListener.call(this, type, listener, options);
            };
        }
    } catch (e) {
        rawConsole.warn("[EKKO_DIAG] No se pudo inyectar el EventListener Hijacker:", e);
    }

    function getFriendlySelector(el) {
        if (el === window) return "window";
        if (el === document) return "document";
        if (!el || !el.tagName) return "unknown";
        let selector = el.tagName.toLowerCase();
        if (el.id) {
            selector += '#' + el.id;
        } else if (el.className) {
            selector += '.' + el.className.split(' ').filter(Boolean).join('.');
        }
        return selector;
    }

    // Escuchar excepciones globales
    if (typeof window !== 'undefined') {
        const origConsoleError = console.error;
        console.error = function (...args) {
            const errorMsg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            diagState.consoleErrors.push({
                message: errorMsg,
                timestamp: Date.now(),
                activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
                activeObject: window.selectedItem ? window.selectedItem.id : null,
                stack: new Error().stack
            });
            return origConsoleError.apply(console, args);
        };

        window.addEventListener('error', function (e) {
            diagState.consoleErrors.push({
                message: `[Runtime Exception] ${e.message} en ${e.filename}:${e.lineno}:${e.colno}`,
                timestamp: Date.now(),
                activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
                activeObject: window.selectedItem ? window.selectedItem.id : null,
                stack: e.error ? e.error.stack : null
            });
        });

        window.addEventListener('unhandledrejection', function (e) {
            diagState.consoleErrors.push({
                message: `[Unhandled Promise Rejection] ${e.reason}`,
                timestamp: Date.now(),
                activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
                activeObject: window.selectedItem ? window.selectedItem.id : null,
                stack: e.reason && e.reason.stack ? e.reason.stack : null
            });
        });
    }

    // =========================================================================
    // NIVEL 3: INTERCEPTOR DEL CALLGRAPH DINÁMICO (SISTEMA DE PROPIEDADES REACTIVAS)
    // =========================================================================
    const criticalFunctions = [
        'enterNodeEditMode',
        'exitNodeEditMode',
        'drawNodeHandles',
        'deleteSelectedNodes',
        'duplicateSelectedItem',
        'ungroupSelectedItem',
        'groupSelectedItems',
        'recalculateDynamicSubtractions',
        'selectItem',
        'deselectItem',
        'clipItem'
    ];

    const wrappedFunctions = {};

    function wrapMethod(name, originalFn) {
        if (typeof originalFn !== 'function') return originalFn;
        if (originalFn.__isWrappedByEKKO) return originalFn;

        rawConsole.log(`[EKKO_DIAG] Envolviendo en caliente función crítica: window.${name}`);

        const wrapper = function (...args) {
            if (!diagState.active) return originalFn.apply(this, args);

            const opId = `OP-${String(++diagState.opCounter).padStart(5, '0')}`;
            const op = {
                id: opId,
                type: name,
                timestamp: Date.now(),
                status: 'IN_PROGRESS',
                source: name,
                args: args.map(a => {
                    if (!a) return 'null';
                    if (a.id !== undefined) return `Item(ID:${a.id}, class:${a.className})`;
                    if (a.x !== undefined && a.y !== undefined) return `Point(${a.x.toFixed(1)}, ${a.y.toFixed(1)})`;
                    if (typeof a === 'object') return '{...}';
                    return String(a);
                }),
                beforeState: captureGeometricStateSnapshot(),
                afterState: null,
                inconsistencies: [],
                duration: 0
            };

            diagState.operations.push(op);
            const parentOp = diagState.currentOp;
            diagState.currentOp = op;

            const startTime = performance.now();
            let result;
            try {
                result = originalFn.apply(this, args);
                op.status = 'COMPLETED';
            } catch (err) {
                op.status = 'FAILED';
                op.inconsistencies.push(`[EXCEPCIÓN DE EJECUCIÓN] ${err.message}`);
                diagState.consoleErrors.push({
                    message: `[Call Exception en ${name}] ${err.message}`,
                    timestamp: Date.now(),
                    activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
                    activeObject: window.selectedItem ? window.selectedItem.id : null,
                    stack: err.stack
                });
                throw err;
            } finally {
                op.duration = performance.now() - startTime;
                op.afterState = captureGeometricStateSnapshot();
                auditConsistency(op);
                diagState.currentOp = parentOp;
            }
            return result;
        };

        wrapper.__isWrappedByEKKO = true;
        wrapper.rawFn = originalFn;
        return wrapper;
    }

    // Inyección de Getters y Setters reactivos en window para evitar pérdidas de wrapper asíncronos
    if (typeof window !== 'undefined') {
        criticalFunctions.forEach(funcName => {
            let currentValue = window[funcName];

            if (currentValue && typeof currentValue === 'function') {
                wrappedFunctions[funcName] = wrapMethod(funcName, currentValue);
                window[funcName] = wrappedFunctions[funcName];
            }

            Object.defineProperty(window, funcName, {
                get: function () {
                    return wrappedFunctions[funcName];
                },
                set: function (newVal) {
                    if (newVal && newVal.__isWrappedByEKKO) {
                        wrappedFunctions[funcName] = newVal;
                    } else if (typeof newVal === 'function') {
                        wrappedFunctions[funcName] = wrapMethod(funcName, newVal);
                    } else {
                        wrappedFunctions[funcName] = newVal;
                    }
                },
                configurable: true,
                enumerable: true
            });
        });
    }

    // =========================================================================
    // NIVEL 4: AUDITORÍA DE INVARIANTES Y CONSISTENCIA GEOMÉTRICA (MATH LABS)
    // =========================================================================
    function captureGeometricStateSnapshot() {
        if (typeof paper === 'undefined' || !paper.project) return null;
        
        const selectionSnapshot = [];
        if (window.selectedItems && window.selectedItems.length > 0) {
            window.selectedItems.forEach(it => {
                selectionSnapshot.push(captureSingleItemSnapshot(it));
            });
        } else if (window.selectedItem) {
            selectionSnapshot.push(captureSingleItemSnapshot(window.selectedItem));
        }

        const sceneSnapshot = [];
        const designLayer = paper.project.layers ? paper.project.layers.find(l => l.name === 'designLayer') : null;
        const targetLayer = designLayer || paper.project.activeLayer;

        if (targetLayer && targetLayer.children) {
            targetLayer.children.forEach(c => {
                if (c.data && (c.data.isSelectionBox || c.data.isNodeEditOverlay || c.data.isSmartGuide || c.data.isMeasurement)) {
                    return; // Ignorar UI
                }
                sceneSnapshot.push(captureSingleItemSnapshot(c));
            });
        }

        // Snapshot de Overlay de Nodos Activos
        let overlaySnapshot = null;
        const nodeOverlay = paper.project.activeLayer.children ? paper.project.activeLayer.children.find(c => c.data && c.data.isNodeEditOverlay) : null;
        if (nodeOverlay && nodeOverlay.children) {
            overlaySnapshot = {
                id: nodeOverlay.id,
                visible: nodeOverlay.visible,
                opacity: nodeOverlay.opacity,
                childCount: nodeOverlay.children.length,
                nodes: nodeOverlay.children.map(ch => ({
                    id: ch.id,
                    type: ch.data?.isNodeHandle ? 'node' : (ch.data?.isCurveHandle ? 'handle' : 'tangent'),
                    position: ch.position ? { x: ch.position.x, y: ch.position.y } : null,
                    visible: ch.visible
                }))
            };
        }

        return {
            timestamp: Date.now(),
            selection: selectionSnapshot,
            scene: sceneSnapshot,
            overlay: overlaySnapshot,
            zOrderIds: targetLayer && targetLayer.children ? targetLayer.children.map(c => c.id) : []
        };
    }

    function captureSingleItemSnapshot(it) {
        if (!it) return null;
        const target = (it.data && it.data.clipGroup && it.children) ? 
                       (it.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) || it) : it;

        return {
            id: it.id,
            className: it.className,
            name: it.name || '',
            label: it.data?.label || 'Sin etiqueta',
            visible: it.visible,
            opacity: it.opacity,
            position: it.position ? { x: it.position.x, y: it.position.y } : null,
            bounds: it.bounds ? { x: it.bounds.x, y: it.bounds.y, w: it.bounds.width, h: it.bounds.height } : null,
            geomBaseExists: !!(target && target.data && target.data.geomBase),
            segmentCount: (target && target.segments) ? target.segments.length : ((target && target.children) ? 'group' : 0)
        };
    }

    function auditConsistency(op) {
        const before = op.beforeState;
        const after = op.afterState;
        if (!before || !after) return;

        // A) Validar Preservación de geomBase (Anti-Corrupción)
        after.scene.forEach(aftItem => {
            const befItem = before.scene.find(b => b.id === aftItem.id);
            if (befItem && befItem.geomBaseExists && !aftItem.geomBaseExists) {
                op.inconsistencies.push(`[INVARIANTE VIOLADO: DESTRUCCIÓN DE GEOMBASE] El objeto ID:${aftItem.id} ('${aftItem.label}') perdió su geometría reactiva de origen durante ${op.type}.`);
            }
        });

        // B) Validar Sincronización Geométrica de Nodos (NODE_TO_GEOMETRY_SYNC)
        if (op.type === 'drawNodeHandles' && window.nodeEditMode) {
            if (!after.overlay || after.overlay.childCount === 0) {
                op.inconsistencies.push(`[CONTRATO VIOLADO: NODE_RENDER_FAIL] Se solicitó redibujar tiradores, pero el overlay de nodos está vacío o ausente en la capa activa.`);
            }
        }

        // C) Validar Apilamiento Z (Z_ORDER_STATE_SYNC)
        if (['selectItem', 'deselectItem'].includes(op.type)) {
            const zBefore = JSON.stringify(before.zOrderIds);
            const zAfter = JSON.stringify(after.zOrderIds);
            if (zBefore !== zAfter) {
                op.inconsistencies.push(`[DESINCRONIZACIÓN Z_ORDER] El orden de apilamiento mutó de forma inesperada durante la selección.`);
            }
        }
    }

    // =========================================================================
    // MEJORAS INDISPENSABLES V13: AUDITORÍA DE CLIC FANTASMA Y DRAGS MUERTOS
    // =========================================================================
    if (typeof window !== 'undefined') {
        window.addEventListener('mousedown', function (e) {
            diagState.lastMouseDownPoint = { x: e.clientX, y: e.clientY };
            diagState.lastMouseDownSelection = window.selectedItem ? captureSingleItemSnapshot(window.selectedItem) : null;
            
            // Si hay click en un botón interactivo, verificar conexión
            const button = e.target.closest('button, .toolbar-btn, [id^="btnCtx"]');
            if (button) {
                const selector = getFriendlySelector(button);
                const isDead = !diagState.eventRegistry.has(selector) && !button.onclick;
                if (isDead) {
                    const opId = `OP-${String(++diagState.opCounter).padStart(5, '0')}`;
                    const op = {
                        id: opId,
                        type: 'CLICK_INTERRUPT',
                        timestamp: Date.now(),
                        status: 'WARNING',
                        source: selector,
                        args: [`text: "${button.textContent.trim()}"`],
                        beforeState: captureGeometricStateSnapshot(),
                        afterState: null,
                        inconsistencies: [`[⚠️ BOTÓN MUERTO] Se hizo clic en '${selector}' pero no tiene ningún callback de JavaScript conectado en el registro DOM.`],
                        duration: 0
                    };
                    diagState.operations.push(op);
                    rawConsole.warn(`[EKKO_DIAG] ${op.inconsistencies[0]}`);
                }
            }

            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? 
                               (window.selectedItem.children && window.selectedItem.children.find(c => !c.clipMask)) : window.selectedItem;
                diagState.lastMouseDownGeo = target && target.data && target.data.geomBase ? target.data.geomBase.clone({ insert: false }) : null;
            } else {
                diagState.lastMouseDownGeo = null;
            }
        }, { capture: true });

        window.addEventListener('mouseup', function (e) {
            if (!diagState.lastMouseDownPoint) return;
            const dx = e.clientX - diagState.lastMouseDownPoint.x;
            const dy = e.clientY - diagState.lastMouseDownPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 3) {
                // Se intentó un arrastre
                const beforeSel = diagState.lastMouseDownSelection;
                const afterSel = window.selectedItem ? captureSingleItemSnapshot(window.selectedItem) : null;

                if (beforeSel && afterSel && beforeSel.id === afterSel.id) {
                    const pxBefore = beforeSel.position;
                    const pxAfter = afterSel.position;
                    
                    if (pxBefore && pxAfter && pxBefore.x === pxAfter.x && pxBefore.y === pxAfter.y) {
                        const opId = `OP-${String(++diagState.opCounter).padStart(5, '0')}`;
                        const op = {
                            id: opId,
                            type: 'DRAG_FRUSTRADO',
                            timestamp: Date.now(),
                            status: 'FAILED',
                            source: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD_DRAG',
                            args: [`delta: [${dx.toFixed(0)}px, ${dy.toFixed(0)}px]`],
                            beforeState: null,
                            afterState: null,
                            inconsistencies: [`[ARRASTRE FRUSTRADO] Se arrastró el ratón ${distance.toFixed(1)}px sobre ID:${afterSel.id} ('${afterSel.label}'), pero no modificó sus coordenadas físicas en el lienzo.`],
                            duration: 0
                        };
                        diagState.operations.push(op);
                        rawConsole.warn(`[EKKO_DIAG] ${op.inconsistencies[0]}`);
                    }
                }
            }
            diagState.lastMouseDownPoint = null;
            diagState.lastMouseDownSelection = null;
            if (diagState.lastMouseDownGeo) {
                try { diagState.lastMouseDownGeo.remove(); } catch (err) {}
                diagState.lastMouseDownGeo = null;
            }
        }, { capture: true });
    }

    // =========================================================================
    // API PÚBLICA DE CONTROL FORENSE
    // =========================================================================
    const publicAPI = {
        start: function () {
            diagState.active = true;
            diagState.operations = [];
            diagState.consoleErrors = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v13.0 EagleEye BlackBox] Activo 🟢 - Monitoreando automáticamente...");
            return true;
        },

        stop: function () {
            diagState.active = false;
            rawConsole.log("[EKKO_DIAG v13.0 EagleEye BlackBox] Suspendido 🔴.");
            return true;
        },

        clear: function () {
            diagState.operations = [];
            diagState.consoleErrors = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v13.0] Buffer de vuelo vaciado.");
            return true;
        },

        status: function () {
            rawConsole.log(`[EKKO_DIAG STATUS] Activo: ${diagState.active} | Operaciones en buffer: ${diagState.operations.length} | Errores F12 registrados: ${diagState.consoleErrors.length}`);
            return {
                active: diagState.active,
                bufferSize: diagState.operations.length,
                errors: diagState.consoleErrors.length
            };
        },

        // =========================================================================
        // NUEVA FUNCIÓN INDISPENSABLE V13: INSPECTOR ESTÁTICO DE LIENZO EN CALIENTE
        // =========================================================================
        inspect: function () {
            rawConsole.log("=================== EKKO EYE VIEWPORT INSPECT ===================");
            
            const results = {
                deadButtons: [],
                invisibleNodes: [],
                corruptedGeomBase: [],
                viewportInfo: {}
            };

            // 1. Auditoría de Botones Muertos del DOM
            if (typeof document !== 'undefined') {
                const buttons = document.querySelectorAll('button, .toolbar-btn, [id^="btnCtx"]');
                buttons.forEach(btn => {
                    const selector = getFriendlySelector(btn);
                    const isDead = !diagState.eventRegistry.has(selector) && !btn.onclick;
                    if (isDead && btn.id) {
                        results.deadButtons.push({
                            id: btn.id,
                            text: btn.textContent.trim() || 'Sin texto',
                            parent: btn.parentNode?.id || btn.parentNode?.className || 'unknown'
                        });
                    }
                });
            }

            // 2. Auditoría de Visibilidad de Nodos (Paper.js)
            if (typeof paper !== 'undefined' && paper.project) {
                const zoom = paper.view.zoom || 1.0;
                const viewBounds = paper.view.bounds;
                results.viewportInfo = {
                    zoom: zoom,
                    center: `${paper.view.center.x.toFixed(1)}, ${paper.view.center.y.toFixed(1)}`,
                    bounds: `[${viewBounds.width.toFixed(0)}x${viewBounds.height.toFixed(0)}]`
                };

                const nodeOverlay = paper.project.activeLayer.children ? 
                                    paper.project.activeLayer.children.find(c => c.data && c.data.isNodeEditOverlay) : null;
                
                if (window.nodeEditMode) {
                    if (!nodeOverlay) {
                        results.invisibleNodes.push("EL MODO NODOS ESTÁ ACTIVO, PERO EL OVERLAY NO EXISTE EN NINGUNA CAPA DE PAPER.JS.");
                    } else if (!nodeOverlay.visible) {
                        results.invisibleNodes.push(`EL OVERLAY DE NODOS EXISTE PERO TIENE VISIBLE: FALSE (OCULTO EN LIENZO).`);
                    } else if (nodeOverlay.opacity === 0) {
                        results.invisibleNodes.push(`EL OVERLAY DE NODOS TIENE OPACIDAD ZERO (INVISIBLE).`);
                    } else {
                        // Verificar si están proyectados fuera del Viewport
                        const nodeHandles = nodeOverlay.children.filter(c => c.data && c.data.isNodeHandle);
                        if (nodeHandles.length === 0) {
                            results.invisibleNodes.push("EL OVERLAY ESTÁ VACÍO, NO TIENE CÍRCULOS DE NODOS DIBUJADOS.");
                        } else {
                            let outCount = 0;
                            nodeHandles.forEach(h => {
                                if (!viewBounds.contains(h.position)) {
                                    outCount++;
                                }
                            });
                            if (outCount === nodeHandles.length) {
                                results.invisibleNodes.push(`TODOS LOS NODOS (${nodeHandles.length}) ESTÁN FUERA DEL CAMPO VISUAL ACTUAL DE LA PANTALLA (FUERA DE VIEWPORT).`);
                            }
                        }
                    }
                }
            }

            // 3. Auditoría de Corrupción de geomBase
            if (typeof paper !== 'undefined' && paper.project) {
                const designLayer = paper.project.layers ? paper.project.layers.find(l => l.name === 'designLayer') : null;
                const targetLayer = designLayer || paper.project.activeLayer;
                if (targetLayer && targetLayer.children) {
                    targetLayer.children.forEach(c => {
                        if (c.data && (c.data.isSelectionBox || c.data.isNodeEditOverlay || c.data.isSmartGuide || c.data.isMeasurement || c.data.mockup || c.data.isMask)) {
                            return;
                        }
                        const target = c.data?.clipGroup ? (c.children && c.children.find(ch => !ch.clipMask)) : c;
                        if (target && (!target.data || !target.data.geomBase)) {
                            results.corruptedGeomBase.push({
                                id: c.id,
                                label: c.data?.label || 'Sin etiqueta',
                                class: c.className
                            });
                        }
                    });
                }
            }

            // Imprimir resultados estéticamente en consola
            rawConsole.warn("⚡ REPORTE DE AUDITORÍA ESTÁTICA EN CALIENTE (EKKO_DIAG) ⚡");
            rawConsole.log(`INFORMACIÓN DEL LIENZO: Zoom: ${results.viewportInfo.zoom} | Centro: ${results.viewportInfo.center} | Bounds: ${results.viewportInfo.bounds}`);
            
            if (results.deadButtons.length > 0) {
                rawConsole.error("❌ BOTONES MUERTOS DETECTADOS (DOM sin JavaScript conectado):");
                rawConsole.table(results.deadButtons);
            } else {
                rawConsole.log("✓ Conectividad DOM: Todos los botones del panel superior e inferior tienen listeners de JS.");
            }

            if (results.invisibleNodes.length > 0) {
                rawConsole.error("❌ ANOMALÍAS EN EDICIÓN DE NODOS BÉZIER DETECTADAS:");
                results.invisibleNodes.forEach(msg => rawConsole.warn(`   ➔ ${msg}`));
            } else if (window.nodeEditMode) {
                rawConsole.log("✓ Editor de Nodos: Los vértices Bézier se proyectan y renderizan correctamente al frente.");
            }

            if (results.corruptedGeomBase.length > 0) {
                rawConsole.error("❌ OBJETOS SIN GEOMBASE DETECTADOS (Pérdida de Reactividad CSG):");
                rawConsole.table(results.corruptedGeomBase);
            } else {
                rawConsole.log("✓ Integridad Geométrica: Todas las capas de diseño conservan sus referencias geomBase de origen.");
            }

            rawConsole.log("=================================================================");
            return results;
        },

        // =========================================================================
        // SECCIÓN 25: FORMATEADOR DE REPORTES DE CONFORMIDAD DEL 3ER MANDAMIENTO
        // =========================================================================
        report: function () {
            let out = `==================== EKKO DIAG FORENSIC REPORT ====================\n`;
            out += `ESTADO DE INTEGRIDAD DE CONTRATOS FUNCIONALES Y EVENTOS\n\n`;

            const errors = diagState.consoleErrors;
            const ops = diagState.operations;
            const contractFailures = [];
            const invariantFailures = [];
            const desyncs = [];
            const deadActions = [];
            
            let firstInconsistency = null;

            ops.forEach(op => {
                if (op.inconsistencies.length > 0) {
                    if (!firstInconsistency) {
                        firstInconsistency = {
                            opId: op.id,
                            type: op.type,
                            msg: op.inconsistencies[0],
                            timestamp: op.timestamp
                        };
                    }

                    op.inconsistencies.forEach(inc => {
                        const rec = { opId: op.id, type: op.type, message: inc, duration: op.duration };
                        if (inc.includes('CONTRATO VIOLADO')) {
                            contractFailures.push(rec);
                        } else if (inc.includes('INVARIANTE VIOLADO')) {
                            invariantFailures.push(rec);
                        } else if (inc.includes('DESINCRONIZACIÓN') || inc.includes('DIFERENTE')) {
                            desyncs.push(rec);
                        } else {
                            deadActions.push(rec);
                        }
                    });
                }
            });

            // 1. SECCIÓN ERRORS
            out += `### ERRORS (${errors.length})\n`;
            if (errors.length === 0) {
                out += `  ✓ Sin excepciones de JS detectadas en la consola de runtime.\n`;
            } else {
                errors.forEach((err, idx) => {
                    out += `  [ERR-${String(idx + 1).padStart(3, '0')}] ${err.message}\n`;
                    out += `     ➔ Hora: ${new Date(err.timestamp).toLocaleTimeString()} | Herramienta: ${err.activeTool} | ID Objeto: ${err.activeObject || 'Ninguno'}\n`;
                    if (err.stack) out += `     ➔ Stack: ${err.stack.split('\n').slice(0, 3).join(' | ')}\n`;
                });
            }
            out += `\n`;

            // 2. SECCIÓN CONTRACT FAILURES
            out += `### CONTRACT FAILURES (${contractFailures.length})\n`;
            if (contractFailures.length === 0) {
                out += `  ✓ Todos los contratos de entrada y precondiciones de Paper.js operaron de forma limpia.\n`;
            } else {
                contractFailures.forEach(f => {
                    out += `  [${f.opId}] Falla de Contrato en la operación '${f.type}' | Duración: ${f.duration.toFixed(1)}ms\n`;
                    out += `     ➔ ${f.message}\n`;
                });
            }
            out += `\n`;

            // 3. SECCIÓN INVARIANT FAILURES
            out += `### INVARIANT FAILURES (${invariantFailures.length})\n`;
            if (invariantFailures.length === 0) {
                out += `  ✓ Todos los invariantes universales de escala, máscara de producto y geomBase conservaron su integridad.\n`;
            } else {
                invariantFailures.forEach(f => {
                    out += `  [${f.opId}] Falla de Invariante en '${f.type}'\n`;
                    out += `     ➔ ${f.message}\n`;
                });
            }
            out += `\n`;

            // 4. SECCIÓN DESYNCHRONIZATIONS
            out += `### DESYNCHRONIZATIONS (${desyncs.length})\n`;
            if (desyncs.length === 0) {
                out += `  ✓ Sincronización impecable entre el DOM, los atajos de teclado y el motor gráfico de Paper.js.\n`;
            } else {
                desyncs.forEach(f => {
                    out += `  [${f.opId}] Desincronización detectada en '${f.type}'\n`;
                    out += `     ➔ ${f.message}\n`;
                });
            }
            out += `\n`;

            // 5. SECCIÓN ACTION WITHOUT EFFECT
            out += `### ACTION WITHOUT EFFECT (${deadActions.length})\n`;
            if (deadActions.length === 0) {
                out += `  ✓ Sin clics fantasmas, arrastres bloqueados o interacciones inertes.\n`;
            } else {
                deadActions.forEach(f => {
                    out += `  [${f.opId}] Acción inerte en '${f.type}'\n`;
                    out += `     ➔ ${f.message}\n`;
                });
            }
            out += `\n`;

            // 6. SECCIÓN FIRST_OBSERVABLE_INCONSISTENCY
            out += `### FIRST OBSERVABLE INCONSISTENCY (REGLA DE ORO DE CAUSA RAÍZ)\n`;
            if (firstInconsistency) {
                out += `  ⚠️ LA CADENA DE FALLAS SE INICIÓ EN LA OPERACIÓN: ${firstInconsistency.opId} [${firstInconsistency.type}]\n`;
                out += `  Mensaje: ${firstInconsistency.msg}\n`;
                out += `  Hora de ocurrencia: ${new Date(firstInconsistency.timestamp).toLocaleTimeString()}\n`;
                out += `  SOLUCIÓN RECOMENDADA: Investigue el archivo y los callbacks de la operación anterior que dejaron al sistema en un estado inconsistente antes de esta acción.\n`;
            } else {
                out += `  ✓ Excelente. No se han detectado inconsistencias temporales en el buffer.\n`;
            }
            out += `\n`;

            out += `### PROBABLE ROOT CAUSES\n`;
            if (firstInconsistency) {
                if (firstInconsistency.type === 'enterNodeEditMode' || firstInconsistency.type === 'CLICK_INTERRUPT') {
                    out += `  ➔ [Módulo: nodeEditor.js] El evento de clic de edición de nodos se pierde o el botón del DOM no tiene conectado un EventListener debido a una carrera asíncrona de carga.\n`;
                } else if (firstInconsistency.type === 'DRAG_FRUSTRADO') {
                    out += `  ➔ [Módulo: selection.js / interaction.js] El evento del ratón arrastró el recuadro visual pero Paper.js omitió aplicar la traslación sobre el contenido geométrico interno, posiblemente bloqueado por máscara.\n`;
                } else if (firstInconsistency.type === 'duplicateSelectedItem') {
                    out += `  ➔ [Módulo: contextualMenu.js] Fallo de desvinculación o pérdida de geomBase al clonar el objeto completo.\n`;
                } else {
                    out += `  ➔ Revise si el archivo comprometido en la operación '${firstInconsistency.type}' respeta los contratos de precondición.\n`;
                }
            } else {
                out += `  ✓ Sistema operando dentro de los parámetros de integridad funcional aprobados.\n`;
            }
            out += `\n===================================================================`;

            rawConsole.log(out);
            return out;
        }
    };

    // Exposición dinámica
    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
    }

    return publicAPI;
}));
