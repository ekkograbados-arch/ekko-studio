/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v17.0 EagleEye Ultra-Precision Forensic BlackBox)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
    Caja Negra Forense de Última Generación "Ojos de Águila v17.0" con Monitoreo de
    Conectividad DOM, Intercepción de EventListeners, Auditoría de Invariantes Bézier
    y de Producto/Mockup para EKKO Studio.
    
    Implementa:
    1. Intercepción del Prototipo de EventTarget para registrar listeners reales (Fin de "Botones Muertos").
    2. Setters Reactivos dinámicos en 'window' para auto-envolver funciones asíncronas de carga diferida.
    3. Inspección geométrica activa de Viewport y visibilidad física de nodos (Paper.js).
    4. Comando interactivo 'EKKO_DIAG.inspect()' para auditorías en caliente.
    5. NUEVOS SENSORES CANÓNICOS V17.0:
       - MOCKUP_NODES_GENERATED: Alerta si se generan nodos en elementos del producto/mockup/chapitas.
       - WARP_NOT_REALTIME: Alerta si el arrastre/edición de nodos no deforma el trazado físico en tiempo real.
       - DESFASE_NODOS_GEOMETRIA: Detecta desalineación visual entre los círculos dibujados y los puntos Bézier reales.

AUTORIDAD: STUDIO ACTUAL / REPOSITORIO CANÓNICO V8
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

    // Canal seguro de consola para evitar recursiones
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

    // --- ESTADO CENTRAL DE LA CAJA NEGRA ---
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
        lastMouseDownSegments: null, // Guardar coordenadas de segmentos en mousedown para detectar tiempo real
        dragTracker: {
            active: false,
            startX: 0,
            startY: 0
        }
    };

    // Intercepción de Event Listeners para detectar botones muertos
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

    // --- CALLGRAPH DINÁMICO ---
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

    // Helper: Detecta de manera infalible si un elemento es parte de la plantilla del producto/mockup
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
            // Comprobación heurística de etiquetas para chapitas, huesitos, termo, mate, llaveros
            const label = (curr.data?.label || '').toLowerCase();
            if (label.includes('chapita') || label.includes('huesito') || label.includes('termo') || label.includes('mate') || label.includes('llavero') || label.includes('producto')) {
                return true;
            }
            curr = curr.parent;
        }
        return false;
    }

    // Helper: Obtiene el string de coordenadas de segmentos para auditar tiempo real
    function getPathSegmentsCoords(item) {
        if (!item || typeof paper === 'undefined') return "";
        const segments = [];
        const extract = (target) => {
            if (!target) return;
            if (target.className === 'Path' && target.segments) {
                target.segments.forEach(s => {
                    segments.push(`${s.point.x.toFixed(1)},${s.point.y.toFixed(1)}`);
                });
            } else if (target.children) {
                // Compatible con LinkedCollection
                for (let i = 0; i < target.children.length; i++) {
                    extract(target.children[i]);
                }
            }
        };
        extract(item);
        return segments.join('|');
    }

    // --- SNAPSHOTS GEOMÉTRICOS ---
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
            for (let i = 0; i < targetLayer.children.length; i++) {
                const c = targetLayer.children[i];
                if (c.data && (c.data.isSelectionBox || c.data.isNodeEditOverlay || c.data.isSmartGuide || c.data.isMeasurement)) {
                    continue;
                }
                sceneSnapshot.push(captureSingleItemSnapshot(c));
            }
        }

        let overlaySnapshot = null;
        const nodeOverlay = paper.project.activeLayer.children ? 
                            paper.project.activeLayer.children.find(c => c.data && c.data.isNodeEditOverlay) : null;
        if (nodeOverlay && nodeOverlay.children) {
            const nodesArray = [];
            for (let i = 0; i < nodeOverlay.children.length; i++) {
                const ch = nodeOverlay.children[i];
                nodesArray.push({
                    id: ch.id,
                    type: ch.data?.isNodeHandle ? 'node' : (ch.data?.isCurveHandle ? 'handle' : 'tangent'),
                    position: ch.position ? { x: ch.position.x, y: ch.position.y } : null,
                    visible: ch.visible,
                    pathId: ch.data?.pathId,
                    localIdx: ch.data?.localIdx,
                    globalIdx: ch.data?.globalIdx
                });
            }
            overlaySnapshot = {
                id: nodeOverlay.id,
                visible: nodeOverlay.visible,
                opacity: nodeOverlay.opacity,
                childCount: nodeOverlay.children.length,
                nodes: nodesArray
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
        
        let target = it;
        if (it.data && it.data.clipGroup && it.children) {
            // Recorrer LinkedCollection de forma segura sin usar .find()
            for (let i = 0; i < it.children.length; i++) {
                const c = it.children[i];
                if (!c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) {
                    target = c;
                    break;
                }
            }
        }

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

    // --- AUDITORÍA DE CONSISTENCIA Y CONTRATOS (AVIÓN CENTRAL) ---
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

        // B) Validar Sincronización Geométrica de Nodos (NODE_RENDER_FAIL)
        if (op.type === 'drawNodeHandles' && window.nodeEditMode) {
            if (!after.overlay || after.overlay.childCount === 0) {
                op.inconsistencies.push(`[CONTRATO VIOLADO: NODE_RENDER_FAIL] Se solicitó redibujar tiradores, pero el overlay de nodos está vacío o ausente en la capa activa.`);
            } else if (window.nodeEditTarget && isMockupOrProductElement(window.nodeEditTarget)) {
                // SENSOR CRÍTICO 1: MOCKUP_NODES_GENERATED
                op.inconsistencies.push(`[❌ INVARIANTE VIOLADO: MOCKUP_NODES_GENERATED] Se generaron nodos editables en el elemento de producto/mockup '${window.nodeEditTarget.data?.label || 'Mockup'}' (ID: ${window.nodeEditTarget.id}). ¡El cliente nunca debe poder editar el producto!`);
            }
        }
    }

    // --- INYECTORES DE INTERCEPCIÓN EN TIEMPO REAL ---
    if (typeof window !== 'undefined') {
        
        // Listener de Mousedown
        window.addEventListener('mousedown', function (e) {
            diagState.lastMouseDownPoint = { x: e.clientX, y: e.clientY };
            diagState.lastMouseDownSelection = window.selectedItem ? captureSingleItemSnapshot(window.selectedItem) : null;
            diagState.lastMouseDownSegments = window.nodeEditTarget ? getPathSegmentsCoords(window.nodeEditTarget) : null;

            const button = e.target.closest('button, .toolbar-btn, [id^="btnCtx"], [class*="btn"]');
            if (button) {
                const selector = getFriendlySelector(button);
                const isDead = !diagState.eventRegistry.has(selector) && !button.onclick;
                
                // Excluir de análisis de clics inertes botones que abren exploradores asíncronos nativos
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
                let target = window.selectedItem;
                if (window.selectedItem.data?.clipGroup && window.selectedItem.children) {
                    for (let i = 0; i < window.selectedItem.children.length; i++) {
                        const c = window.selectedItem.children[i];
                        if (!c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) {
                            target = c;
                            break;
                        }
                    }
                }
                diagState.lastMouseDownGeo = target && target.data && target.data.geomBase ? target.data.geomBase.clone({ insert: false }) : null;
            } else {
                diagState.lastMouseDownGeo = null;
            }
        }, { capture: true });

        // Listener de Mousemove para detectar WARP_NOT_REALTIME
        window.addEventListener('mousemove', function (e) {
            if (!diagState.lastMouseDownPoint || !window.nodeEditMode || !window.isDraggingNode || !window.nodeEditTarget) return;

            const dx = e.clientX - diagState.lastMouseDownPoint.x;
            const dy = e.clientY - diagState.lastMouseDownPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Si el mouse se desplazó más de 5px arrastrando un nodo
            if (distance > 5 && diagState.lastMouseDownSegments) {
                const currentSegments = getPathSegmentsCoords(window.nodeEditTarget);
                
                // Si el ratón se mueve pero la geometría física tiene exactamente las mismas coordenadas
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
                    
                    // Registrar si no existe ya una alerta de tiempo real en esta ráfaga de mousedown
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

        // Listener de Mouseup para auditar arrastres (DRAG FRUSTRADO)
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
                        // Excluir si estamos en modo edición de nodos para evitar interferencias
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

    // --- API PÚBLICA ---
    const publicAPI = {
        start: function () {
            diagState.active = true;
            diagState.operations = [];
            diagState.consoleErrors = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v17.0 EagleEye Ultra-Precision BlackBox] Activo 🟢 - Monitoreando automáticamente...");
            return true;
        },

        stop: function () {
            diagState.active = false;
            rawConsole.log("[EKKO_DIAG v17.0 EagleEye BlackBox] Suspendido 🔴.");
            return true;
        },

        clear: function () {
            diagState.operations = [];
            diagState.consoleErrors = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v17.0] Buffer de vuelo vaciado.");
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

        // AUDITORÍA ESTÁTICA EN CALIENTE (EVALÚA LOS ERRORES QUE TÚ VES A SIMPLE VISTA)
        inspect: function () {
            rawConsole.log("=================== EKKO EYE VIEWPORT INSPECT (v17.0) ===================");
            
            const results = {
                deadButtons: [],
                invisibleNodes: [],
                corruptedGeomBase: [],
                viewportInfo: {},
                nodeViolations: [] // SENSOR DE DESFASE Y PRODUCTO
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

            // 2. Auditoría de Visibilidad y Desfases de Nodos (Paper.js)
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
                        const nodeHandles = nodeOverlay.children.filter(c => c.data && c.data.isNodeHandle);
                        if (nodeHandles.length === 0) {
                            results.invisibleNodes.push("EL OVERLAY ESTÁ VACÍO, NO TIENE CÍRCULOS DE NODOS DIBUJADOS.");
                        } else {
                            // SENSOR CRÍTICO 3: DESFASE_NODOS_GEOMETRIA
                            let offsetCount = 0;
                            let maxOffset = 0;

                            nodeHandles.forEach(h => {
                                const targetPath = paper.project.getItem({ id: h.data.pathId });
                                if (targetPath && targetPath.segments && targetPath.segments[h.data.localIdx]) {
                                    const segment = targetPath.segments[h.data.localIdx];
                                    const globalSegmentPt = targetPath.localToGlobal(segment.point);
                                    const dist = h.position.getDistance(globalSegmentPt);
                                    
                                    if (dist > 0.5) {
                                        offsetCount++;
                                        if (dist > maxOffset) maxOffset = dist;
                                    }
                                }
                            });

                            if (offsetCount > 0) {
                                results.nodeViolations.push(`❌ [DESFASE CRÍTICO DE GEOMETRÍA]: Se detectaron ${offsetCount} tiradores visuales de nodos desalineados físicamente de las curvas reales del trazado. Desfase máximo: ${maxOffset.toFixed(1)}px (Zoom: ${zoom.toFixed(1)}).`);
                            }

                            // Verificar fuera de Viewport
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

                    // SENSOR CRÍTICO 1: MOCKUP_NODES_GENERATED en inspect caliente
                    if (window.nodeEditTarget && isMockupOrProductElement(window.nodeEditTarget)) {
                        results.nodeViolations.push(`❌ [MOCKUP_NODES_GENERATED]: Se ha activado la edición sobre el producto/plantilla de fondo '${window.nodeEditTarget.data?.label || 'Mockup'}'. ¡ESTO ES UN ERROR CRÍTICO DE NEGOCIO! El cliente nunca debe poder alterar los contornos o agujeros del mockup.`);
                    }
                }
            }

            // 3. Auditoría de Corrupción de geomBase (Filtro de grupos inteligentes)
            if (typeof paper !== 'undefined' && paper.project) {
                const designLayer = paper.project.layers ? paper.project.layers.find(l => l.name === 'designLayer') : null;
                const targetLayer = designLayer || paper.project.activeLayer;
                if (targetLayer && targetLayer.children) {
                    for (let i = 0; i < targetLayer.children.length; i++) {
                        const c = targetLayer.children[i];
                        if (c.data && (c.data.isSelectionBox || c.data.isNodeEditOverlay || c.data.isSmartGuide || c.data.isMeasurement || c.data.mockup || c.data.isMask)) {
                            continue;
                        }
                        
                        let target = c;
                        if (c.data?.clipGroup && c.children) {
                            for (let j = 0; j < c.children.length; j++) {
                                const ch = c.children[j];
                                if (!ch.clipMask && !(ch.data && (ch.data.wasClipMask || ch.data.isMask))) {
                                    target = ch;
                                    break;
                                }
                            }
                        }

                        // Filtrar contenedores vacíos o elementos que no son Paths/CompoundPaths
                        const isVectorGeom = target && (target.className === 'Path' || target.className === 'CompoundPath');
                        if (isVectorGeom && (!target.data || !target.data.geomBase)) {
                            results.corruptedGeomBase.push({
                                id: c.id,
                                label: c.data?.label || 'Sin etiqueta',
                                class: c.className
                            });
                        }
                    }
                }
            }

            // Imprimir resultados estéticamente en consola
            rawConsole.warn("⚡ REPORTE DE AUDITORÍA ESTÁTICA EN CALIENTE v17.0 (EKKO_DIAG) ⚡");
            rawConsole.log(`INFORMACIÓN DEL LIENZO: Zoom: ${results.viewportInfo.zoom} | Centro: ${results.viewportInfo.center} | Bounds: ${results.viewportInfo.bounds}`);
            
            if (results.nodeViolations.length > 0) {
                rawConsole.error("❌ ANOMALÍAS DE RECONCILIACIÓN Y SEGURIDAD BÉZIER DETECTADAS:");
                results.nodeViolations.forEach(msg => rawConsole.warn(`   ➔ ${msg}`));
            } else {
                rawConsole.log("✓ Seguridad de Nodos: Los vértices no tocan la plantilla del mockup y coinciden geométricamente.");
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

        // EXPORTACIÓN AL PORTAPAPELES DE WINDOWS LISTA PARA COPIAR EN EL CHAT DE GEMINI
        dump: function () {
            const reportText = this.report();
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(reportText).then(() => {
                    rawConsole.log("%c✓ ¡Reporte forense v17.0 copiado automáticamente al portapapeles! Pégalo en tu chat con Gemini.", "color: #16a34a; font-weight: bold;");
                }).catch(err => {
                    rawConsole.error("No se pudo auto-copiar al portapapeles:", err);
                });
            } else {
                rawConsole.log("Copia manualmente el reporte impreso arriba.");
            }
            return reportText;
        },

        report: function () {
            let out = `==================== EKKO DIAG FORENSIC REPORT v17.0 ====================\n`;
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

            // 2. SECCIÓN CONTRACT FAILURES (INCLUYE WARP_NOT_REALTIME)
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

            // 3. SECCIÓN INVARIANT FAILURES (INCLUYE MOCKUP_NODES_GENERATED)
            out += `### INVARIANT FAILURES (${invariantFailures.length})\n`;
            if (invariantFailures.length === 0) {
                out += `  ✓ Todos los invariantes universales de escala, máscara de producto, geomBase y seguridad del mockup conservaron su integridad.\n`;
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
            out += `\n===================================================================`;

            rawConsole.log(out);
            return out;
        }
    };

    // Exposición de API e alias históricos
    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
        window.EKKO_DIAG.copyErrors = publicAPI.dump; // Redirigir alias histórico para evitar TypeErrors
    }

    return publicAPI;
}));
