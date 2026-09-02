/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v20.0 BlackBox Canon - Master Precision & Anti-Regresión)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
    Caja Negra Forense canónica, 100% reprogramada desde cero (Versión v20.0).
    Elimina por completo redundancias, variables contrapuestas y desfases asíncronos.
    
    Implementa un único motor de estado unificado con sensores de bajo nivel
    para auditar en tiempo real:
    - Invasión de nodos al producto/mockup (MOCKUP_NODES_GENERATED)
    - Rigidez o retrasos de deformación visual (WARP_NOT_REALTIME)
    - Desfase de nodos en clonaciones (DUPLICATE_NODES_OFFSET)
    - Desvinculación de nodos añadidos (LOOSE_NODE_DETECTED)

AUTORIDAD: REPOSITORIO CANÓNICO V8 / PROTOCOLO DE ESTABILIDAD
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
    // 1. CANAL DE CONSOLA SEGURO E INYECTOR DE EXCEPCIONES
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

    // --- ESTADO ÚNICO CENTRAL DE LA BLACKBOX ---
    const diagState = {
        active: true,
        operations: [],
        currentOp: null,
        opCounter: 0,
        consoleErrors: [],
        eventRegistry: new Map(), // Element -> Set of events bound
        
        // Tracking de Interacción (Ratón)
        lastMouseDownPoint: null,
        lastMouseDownSelection: null,
        lastMouseDownSegments: null,
        lastMouseDownGeo: null
    };

    // =========================================================================
    // 2. INTERCEPTOR AGRESIVO DE REGISTRO DOM (ANTI-BOTÓN MUERTO)
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
        rawConsole.warn("[EKKO_DIAG] No se pudo inyectar el interceptor DOM:", e);
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

    // Registro de errores y excepciones no controladas
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
    // 3. SECCIÓN DE HELPERS GEOMÉTRICOS Y DETECTORES INFALIBLES
    // =========================================================================
    
    // Resuelve de forma segura el elemento geométrico interior (inmune a errores de llamada)
    function getContentItem(item) {
        if (!item) return null;
        if (item.data && item.data.clipGroup && item.children) {
            // Convertir LinkedCollection de Paper.js a Array antes de operar
            const childrenArr = Array.from(item.children);
            const content = childrenArr.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
            if (content) return content;
            return item.children[1] || item.children[0] || item;
        }
        return item;
    }

    // Detecta si un elemento pertenece de forma implícita o explícita a la plantilla de fondo (Mockup)
    function isMockupOrProductElement(item) {
        let curr = item;
        while (curr) {
            if (curr.data && (
                curr.data.mockup ||
                curr.data.isMask ||
                curr.data.locked ||
                curr.data.isSelectionBox ||
                curr.data.isSmartGuide ||
                curr.data.isMeasurement
            )) {
                return true;
            }
            const label = (curr.data?.label || '').toLowerCase();
            if (label.includes('chapita') || label.includes('huesito') || label.includes('termo') || label.includes('mate') || label.includes('llavero') || label.includes('producto') || label.includes('plantilla')) {
                return true;
            }
            curr = curr.parent;
        }
        return false;
    }

    // Captura el string exacto de coordenadas vectoriales (Evita el desastroso error de LinkedCollection)
    function getPathSegmentsCoords(item) {
        if (!item || typeof paper === 'undefined') return "";
        const target = getContentItem(item);
        if (!target) return "";
        
        const segments = [];
        const extract = (node) => {
            if (!node) return;
            if (node.className === 'Path' && node.segments) {
                node.segments.forEach(s => {
                    segments.push(`${s.point.x.toFixed(1)},${s.point.y.toFixed(1)}`);
                });
            } else if (node.children) {
                const childrenArr = Array.from(node.children);
                childrenArr.forEach(extract);
            }
        };
        extract(target);
        return segments.join('|');
    }

    // =========================================================================
    // 4. INTERCEPTOR DEL CALLGRAPH DINÁMICO (CRITICAL WRAPPERS)
    // =========================================================================
    const criticalFunctions = [
        'enterNodeEditMode',
        'exitNodeEditMode',
        'drawNodeHandles',
        'deleteSelectedNodes',
        'duplicateSelectedItem',
        'groupSelectedItems',
        'ungroupSelectedItem',
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

    // Inyectar wrappers reactivos en window
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
    // 5. SISTEMA DE MONITOREO DE EVENTOS DE INTERACCIÓN (TIEMPO REAL)
    // =========================================================================
    if (typeof window !== 'undefined') {
        
        // Captura de Estado al mousedown
        window.addEventListener('mousedown', function (e) {
            diagState.lastMouseDownPoint = { x: e.clientX, y: e.clientY };
            diagState.lastMouseDownSelection = window.selectedItem ? captureSingleItemSnapshot(window.selectedItem) : null;
            diagState.lastMouseDownSegments = window.nodeEditTarget ? getPathSegmentsCoords(window.nodeEditTarget) : null;

            // Detección de clics inertes (Sin efecto)
            const button = e.target.closest('button, .toolbar-btn, [id^="btnCtx"], [class*="btn"]');
            if (button) {
                const selector = getFriendlySelector(button);
                const isDead = !diagState.eventRegistry.has(selector) && !button.onclick;
                const isNativeFileUploader = button.id === 'btnAddSVG' || button.id === 'btnAddImage' || selector.includes('file');

                if (isDead && !isNativeFileUploader) {
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
                const target = getContentItem(window.selectedItem);
                diagState.lastMouseDownGeo = target && target.data && target.data.geomBase ? target.data.geomBase.clone({ insert: false }) : null;
            } else {
                diagState.lastMouseDownGeo = null;
            }
        }, { capture: true });

        // Sensor Dinámico: Mousemove para verificar WARP_NOT_REALTIME
        window.addEventListener('mousemove', function (e) {
            if (!diagState.lastMouseDownPoint || !window.nodeEditMode || !window.isDraggingNode || !window.nodeEditTarget) return;

            const dx = e.clientX - diagState.lastMouseDownPoint.x;
            const dy = e.clientY - diagState.lastMouseDownPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Si se arrastra un nodo más de 5px
            if (distance > 5 && diagState.lastMouseDownSegments) {
                const currentSegments = getPathSegmentsCoords(window.nodeEditTarget);
                
                // Si hay arrastre físico del ratón pero las coordenadas internas siguen idénticas
                if (currentSegments === diagState.lastMouseDownSegments) {
                    const opId = `OP-${String(++diagState.opCounter).padStart(5, '0')}`;
                    const op = {
                        id: opId,
                        type: 'WARP_NOT_REALTIME',
                        timestamp: Date.now(),
                        status: 'FAILED',
                        source: 'NODE_EDIT_DRAG',
                        args: [`delta: [${dx.toFixed(0)}px, ${dy.toFixed(0)}px]`],
                        beforeState: null,
                        afterState: null,
                        inconsistencies: [`[❌ CONTRATO VIOLADO: WARP_NOT_REALTIME] Se están arrastrando nodos con el ratón (${distance.toFixed(0)}px), pero la geometría física del trazado '${window.nodeEditTarget.data?.label || 'Objeto'}' NO se deforma en tiempo real en la pantalla.`],
                        duration: 0
                    };
                    
                    const alreadyLogged = diagState.operations.some(o => o.type === 'WARP_NOT_REALTIME' && (Date.now() - o.timestamp < 1000));
                    if (!alreadyLogged) {
                        diagState.operations.push(op);
                        rawConsole.error(
                            `%c❌ [SÍNTOMA: EDICIÓN_NODOS_CONGELADA_REALTIME]%c\n` +
                            `Se están arrastrando nodos en la pantalla, pero la geometría de Paper.js permanece 100% estática.\n` +
                            `* Objeto Afectado: '${window.nodeEditTarget.data?.label || 'Objeto'}' (ID: ${window.nodeEditTarget.id})\n` +
                            `➔ [SÍNTOMA VISIBLE]: El usuario desplaza el nodo, pero la línea del trazado no se deforma en tiempo real sino que se actualiza de forma tardía o diferida.`,
                            "color: #dc2626; font-weight: bold; font-size: 13px;",
                            "color: #333; font-weight: normal;"
                        );
                    }
                }
            }
        }, { capture: true });

        // Sensor Dinámico: Mouseup para registrar DRAG_FRUSTRADO
        window.addEventListener('mouseup', function (e) {
            if (!diagState.lastMouseDownPoint) return;
            const dx = e.clientX - diagState.lastMouseDownPoint.x;
            const dy = e.clientY - diagState.lastMouseDownPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 3) {
                const beforeSel = diagState.lastMouseDownSelection;
                const afterSel = window.selectedItem ? captureSingleItemSnapshot(window.selectedItem) : null;

                if (beforeSel && afterSel && beforeSel.id === afterSel.id) {
                    const pxBefore = beforeSel.position;
                    const pxAfter = afterSel.position;
                    
                    if (pxBefore && pxAfter && pxBefore.x === pxAfter.x && pxBefore.y === pxAfter.y) {
                        // Excluir si estamos editando nodos para no levantar falsas alarmas
                        if (!window.nodeEditMode) {
                            const opId = `OP-${String(++diagState.opCounter).padStart(5, '0')}`;
                            const op = {
                                id: opId,
                                type: 'DRAG_FRUSTRADO',
                                timestamp: Date.now(),
                                status: 'FAILED',
                                source: 'STANDARD_DRAG',
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
            }
            diagState.lastMouseDownPoint = null;
            diagState.lastMouseDownSelection = null;
            diagState.lastMouseDownSegments = null;
            if (diagState.lastMouseDownGeo) {
                try { diagState.lastMouseDownGeo.remove(); } catch (err) {}
                diagState.lastMouseDownGeo = null;
            }
        }, { capture: true });
    }

    // =========================================================================
    // 6. SNAPSHOTS DE LIENZO E INTEGRIDAD GEOMÉTRICA (MATH AUDITS)
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
            const childrenArr = Array.from(targetLayer.children);
            childrenArr.forEach(c => {
                if (c.data && (c.data.isSelectionBox || c.data.isNodeEditOverlay || c.data.isSmartGuide || c.data.isMeasurement)) {
                    return; // Ignorar overlay de la UI
                }
                sceneSnapshot.push(captureSingleItemSnapshot(c));
            });
        }

        let overlaySnapshot = null;
        const activeLayerChildren = Array.from(paper.project.activeLayer.children || []);
        const nodeOverlay = activeLayerChildren.find(c => c.data && c.data.isNodeEditOverlay);
        if (nodeOverlay && nodeOverlay.children) {
            const oChildren = Array.from(nodeOverlay.children);
            overlaySnapshot = {
                id: nodeOverlay.id,
                visible: nodeOverlay.visible,
                opacity: nodeOverlay.opacity,
                childCount: oChildren.length,
                nodes: oChildren.map(ch => ({
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
            toolMode: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
            zOrderIds: targetLayer && targetLayer.children ? Array.from(targetLayer.children).map(c => c.id) : []
        };
    }

    function captureSingleItemSnapshot(it) {
        if (!it) return null;
        const target = getContentItem(it);

        return {
            id: it.id,
            className: it.className,
            label: it.data?.label || 'Sin etiqueta',
            visible: it.visible,
            opacity: it.opacity,
            position: target && target.position ? { x: target.position.x, y: target.position.y } : null,
            bounds: target && target.bounds ? { x: target.bounds.x, y: target.bounds.y, w: target.bounds.width, h: target.bounds.height } : null,
            geomBaseExists: !!(target && target.data && target.data.geomBase)
        };
    }

    function auditConsistency(op) {
        const before = op.beforeState;
        const after = op.afterState;
        if (!before || !after) return;

        after.scene.forEach(aftItem => {
            const befItem = before.scene.find(b => b.id === aftItem.id);
            if (befItem && befItem.geomBaseExists && !aftItem.geomBaseExists) {
                op.inconsistencies.push(`[INVARIANTE VIOLADO: DESTRUCCIÓN DE GEOMBASE] El objeto ID:${aftItem.id} ('${aftItem.label}') perdió su geometría reactiva de origen durante ${op.type}.`);
            }
        });

        // RECONCILIACIÓN DEL SENSOR DE NODOS TANTO EN enterNodeEditMode COMO EN drawNodeHandles
        if ((op.type === 'drawNodeHandles' || op.type === 'enterNodeEditMode') && window.nodeEditMode) {
            if (!after.overlay || after.overlay.childCount === 0) {
                op.inconsistencies.push(`[CONTRATO VIOLADO: NODE_RENDER_FAIL] Se solicitó redibujar tiradores, pero el overlay de nodos está vacío o ausente en la capa activa.`);
            } else {
                // Verificar si hay nodos del mockup dibujados en el overlay (SENSOR 1 en CallGraph)
                let mockupNodesInOverlay = 0;
                if (after.overlay.nodes && typeof paper !== 'undefined') {
                    after.overlay.nodes.forEach(n => {
                        const h = paper.project.getItem({ id: n.id });
                        if (h && h.data && h.data.pathId) {
                            const targetPath = paper.project.getItem({ id: h.data.pathId });
                            if (targetPath && isMockupOrProductElement(targetPath)) {
                                mockupNodesInOverlay++;
                            }
                        }
                    });
                }
                if (mockupNodesInOverlay > 0 || (window.nodeEditTarget && isMockupOrProductElement(window.nodeEditTarget))) {
                    op.inconsistencies.push(`[❌ INVARIANTE VIOLADO: MOCKUP_NODES_GENERATED] Se generaron nodos editables sobre el elemento de producto/mockup. ¡El cliente nunca debe poder editar el producto!`);
                }
            }
        }
    }

    // =========================================================================
    // 7. API PÚBLICA DE CONTROL (BLACKBOX COMMANDS)
    // =========================================================================
    const publicAPI = {
        start: function () {
            diagState.active = true;
            diagState.operations = [];
            diagState.consoleErrors = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v20.0 BlackBox Master] Activo 🟢 - Monitoreando automáticamente...");
            return true;
        },

        stop: function () {
            diagState.active = false;
            rawConsole.log("[EKKO_DIAG v20.0 BlackBox] Suspendido 🔴.");
            return true;
        },

        clear: function () {
            diagState.operations = [];
            diagState.consoleErrors = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v20.0] Buffer de vuelo vaciado.");
            return true;
        },

        status: function () {
            rawConsole.log(`[EKKO_DIAG STATUS] Activo: ${diagState.active} | Operaciones: ${diagState.operations.length} | Errores F12: ${diagState.consoleErrors.length}`);
            return {
                active: diagState.active,
                bufferSize: diagState.operations.length,
                errors: diagState.consoleErrors.length
            };
        },

        // AUDITORÍA ESTÁTICA EN CALIENTE (EVALÚA LOS ERRORES QUE TÚ VES A SIMPLE VISTA)
        inspect: function () {
            rawConsole.warn("⚡ REPORTE DE AUDITORÍA ESTÁTICA EN CALIENTE v20.0 (EKKO_DIAG) ⚡");
            
            const results = {
                deadButtons: [],
                invisibleNodes: [],
                corruptedGeomBase: [],
                viewportInfo: {},
                nodeViolations: []
            };

            if (typeof paper === 'undefined' || !paper.project) {
                rawConsole.error("Paper.js no se ha inicializado todavía.");
                return results;
            }

            const zoom = paper.view.zoom || 1.0;
            const viewBounds = paper.view.bounds;
            results.viewportInfo = {
                zoom: zoom,
                center: `${paper.view.center.x.toFixed(1)}, ${paper.view.center.y.toFixed(1)}`,
                bounds: `[${viewBounds.width.toFixed(0)}x${viewBounds.height.toFixed(0)}]`
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

            // 2. Auditoría de Visibilidad, Desfases e Invasión de Nodos
            const activeLayerChildren = Array.from(paper.project.activeLayer.children || []);
            const nodeOverlay = activeLayerChildren.find(c => c.data && c.data.isNodeEditOverlay);
            
            if (window.nodeEditMode) {
                if (!nodeOverlay) {
                    results.invisibleNodes.push("EL MODO NODOS ESTÁ ACTIVO, PERO EL OVERLAY NO EXISTE EN LA CAPA ACTIVA.");
                } else if (!nodeOverlay.visible) {
                    results.invisibleNodes.push("EL OVERLAY DE NODOS TIENE VISIBLE: FALSE (OCULTO).");
                } else if (nodeOverlay.opacity === 0) {
                    results.invisibleNodes.push("EL OVERLAY DE NODOS TIENE OPACIDAD ZERO (INVISIBLE).");
                } else {
                    const oChildren = Array.from(nodeOverlay.children || []);
                    const nodeHandles = oChildren.filter(c => c.data && c.data.isNodeHandle);
                    
                    if (nodeHandles.length === 0) {
                        results.invisibleNodes.push("EL OVERLAY ESTÁ VACÍO, NO TIENE CÍRCULOS DE NODOS DIBUJADOS.");
                    } else {
                        // SENSOR 1: MOCKUP_NODES_GENERATED, SENSOR 3: DUPLICATE_NODES_OFFSET & SENSOR 4: LOOSE_NODE_DETECTED
                        let offsetCount = 0;
                        let maxOffset = 0;
                        let looseCount = 0;
                        let mockupNodesInOverlayCount = 0;

                        nodeHandles.forEach(h => {
                            const targetPath = paper.project.getItem({ id: h.data.pathId });
                            if (targetPath) {
                                // SENSOR INTERCEPTOR 1: Detectar si este nodo pertenece a un trazado del mockup
                                if (isMockupOrProductElement(targetPath)) {
                                    mockupNodesInOverlayCount++;
                                }

                                if (targetPath.segments && targetPath.segments[h.data.localIdx]) {
                                    const segment = targetPath.segments[h.data.localIdx];
                                    const globalSegmentPt = targetPath.localToGlobal(segment.point);
                                    const dist = h.position.getDistance(globalSegmentPt);
                                    
                                    if (dist > 1.0) {
                                        offsetCount++;
                                        if (dist > maxOffset) maxOffset = dist;
                                    } else if (dist > 0.1) {
                                        looseCount++;
                                    }
                                }
                            }
                        });

                        if (mockupNodesInOverlayCount > 0) {
                            results.nodeViolations.push(`❌ [MOCKUP_NODES_GENERATED]: Se detectaron ${mockupNodesInOverlayCount} nodos interactivos dibujados sobre piezas del producto/mockup base. ¡Esto compromete el catálogo!`);
                        }

                        if (offsetCount > 0) {
                            results.nodeViolations.push(`❌ [DUPLICATE_NODES_OFFSET]: Se detectaron ${offsetCount} nodos desalineados de la geometría real. Desfase máximo: ${maxOffset.toFixed(1)}px (Nodos desplazados por clonación defectuosa).`);
                        }

                        if (looseCount > 0) {
                            results.nodeViolations.push(`❌ [LOOSE_NODE_DETECTED]: Se detectaron ${looseCount} nodos recién insertados que quedaron sueltos y no deforma la geometría real.`);
                        }

                        // Verificar fuera del campo visual
                        let outCount = 0;
                        nodeHandles.forEach(h => {
                            if (!viewBounds.contains(h.position)) {
                                outCount++;
                            }
                        });
                        if (outCount === nodeHandles.length) {
                            results.invisibleNodes.push(`TODOS LOS NODOS (${nodeHandles.length}) ESTÁN FUERA DE LA PANTALLA VISIBLE (VIEWPORT).`);
                        }
                    }
                }

                // SENSOR CRÍTICO 1: MOCKUP_NODES_GENERATED en inspect caliente por target global
                if (window.nodeEditTarget && isMockupOrProductElement(window.nodeEditTarget)) {
                    results.nodeViolations.push(`❌ [MOCKUP_NODES_GENERATED]: Se ha activado la edición sobre la plantilla de producto/mockup '${window.nodeEditTarget.data?.label || 'Mockup'}'. ¡El cliente nunca debe poder editar el producto base!`);
                }
            }

            // 3. Auditoría de Corrupción de geomBase (Filtrando UI)
            const designLayer = paper.project.layers ? paper.project.layers.find(l => l.name === 'designLayer') : null;
            const targetLayer = designLayer || paper.project.activeLayer;
            if (targetLayer && targetLayer.children) {
                const layerChildren = Array.from(targetLayer.children);
                layerChildren.forEach(c => {
                    if (c.data && (c.data.isSelectionBox || c.data.isNodeEditOverlay || c.data.isSmartGuide || c.data.isMeasurement || c.data.mockup || c.data.isMask)) {
                        return;
                    }
                    
                    const target = getContentItem(c);
                    const isVectorGeom = target && (target.className === 'Path' || target.className === 'CompoundPath');
                    if (isVectorGeom && (!target.data || !target.data.geomBase)) {
                        results.corruptedGeomBase.push({
                            id: c.id,
                            label: c.data?.label || 'Sin etiqueta',
                            class: c.className
                        });
                    }
                });
            }

            // Consola estructurada
            rawConsole.log(`INFORMACIÓN DEL LIENZO: Zoom: ${results.viewportInfo.zoom} | Centro: ${results.viewportInfo.center} | Bounds: ${results.viewportInfo.bounds}`);
            
            if (results.nodeViolations.length > 0) {
                rawConsole.error("❌ INCONSISTENCIAS DE RECONCILIACIÓN Y SEGURIDAD BÉZIER DETECTADAS:");
                results.nodeViolations.forEach(msg => rawConsole.warn(`   ➔ ${msg}`));
            } else if (window.nodeEditMode) {
                rawConsole.log("✓ Seguridad de Nodos: Los vértices no tocan el producto base y coinciden geométricamente.");
            }

            if (results.deadButtons.length > 0) {
                rawConsole.error("❌ BOTONES MUERTOS DETECTADOS (DOM sin JavaScript conectado):");
                rawConsole.table(results.deadButtons);
            } else {
                rawConsole.log("✓ Conectividad DOM: Todos los botones del panel superior e inferior tienen listeners de JS.");
            }

            if (results.invisibleNodes.length > 0) {
                rawConsole.error("❌ ANOMALÍAS EN EDICIÓN DE NODOS BÉZIER DETECTADAS:");
                results.invisibleNodes.forEach(msg => rawConsole.warn(`   ➔ ${msg}`));
            } else if (window.nodeEditMode && results.nodeViolations.length === 0) {
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

        // Redirección segura para copyErrors() (Fin del TypeError)
        copyErrors: function () {
            return this.dump();
        },

        dump: function () {
            const reportText = this.report();
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(reportText).then(() => {
                    rawConsole.log("%c✓ ¡Reporte forense v20.0 copiado automáticamente al portapapeles! Pégalo en tu chat con Gemini.", "color: #16a34a; font-weight: bold;");
                }).catch(err => {
                    rawConsole.error("No se pudo auto-copiar al portapapeles:", err);
                });
            } else {
                rawConsole.log("Por favor, copia manualmente el reporte impreso en la consola.");
            }
            return reportText;
        },

        report: function () {
            let out = `==================== EKKO DIAG FORENSIC REPORT v20.0 ====================\n`;
            out += `ESTADO DE INTEGRIDAD DE CONTRATOS FUNCIONALES, EVENTOS Y RELACIONES\n\n`;

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

            out += `### FIRST OBSERVABLE INCONSISTENCY (REGLA DE ORO DE CAUSA RAÍZ)\n`;
            if (firstInconsistency) {
                out += `  ⚠️ LA CADENA DE FALLAS SE INICIÓ EN LA OPERACIÓN: ${firstInconsistency.opId} [${firstInconsistency.type}]\n`;
                out += `  Mensaje: ${firstInconsistency.msg}\n`;
                out += `  Hora de ocurrencia: ${new Date(firstInconsistency.timestamp).toLocaleTimeString()}\n`;
                out += `  SOLUCIÓN RECOMENDADA: Investigue el archivo anterior que rompió el contrato geométrico.\n`;
            } else {
                out += `  ✓ Excelente. No se han detectado inconsistencias temporales en el buffer de vuelo.\n`;
            }
            out += `\n`;

            out += `### PROBABLE ROOT CAUSES\n`;
            if (firstInconsistency) {
                if (firstInconsistency.type === 'WARP_NOT_REALTIME') {
                    out += `  ➔ [Módulo: nodeEditor.js] Falla de recálculo en tiempo real: Se omite invocar recalculateDynamicSubtractions() de forma reactiva al arrastrar o modificar el geomBase.\n`;
                } else if (firstInconsistency.type === 'MOCKUP_NODES_GENERATED') {
                    out += `  ➔ [Módulo: nodeEditor.js] Invasión de la plantilla: Falta validación recursiva de ancestros en getTargetPaths() y enterNodeEditMode() para bloquear el mockup.\n`;
                } else if (firstInconsistency.type === 'DUPLICATE_NODES_OFFSET') {
                    out += `  ➔ [Módulo: contextualMenu.js] Doble aplicación de offset: El clon interior y el contenedor superior aplican el desplazamiento en paralelo, desalineando el geomBase.\n`;
                } else {
                    out += `  ➔ Revise la operación '${firstInconsistency.type}' en el módulo canónico correspondiente.\n`;
                }
            } else {
                out += `  ✓ Sistema operando dentro de los parámetros de integridad funcional aprobados.\n`;
            }
            out += `\n===================================================================`;

            rawConsole.log(out);
            return out;
        }
    };

    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
    }

    return publicAPI;
}));
