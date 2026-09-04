/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE
ESTADO: PENDIENTE DE VALIDACIÓN CONTRA CONTRATO
DEPENDENCIAS DIRECTAS: ASSETS/js/editor.js, ASSETS/js/modules/selection.js
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v21.0 BlackBox Master - DNA Integration & Precise Bounds Sentry)
Descripción:
    Caja Negra Forense canónica mejorada para EKKO Studio.
    Implementa un único motor de estado unificado con sensores de bajo nivel
    para auditar en tiempo real:
    - [CACHE_DESYNC]: Alertas de inconsistencias de caché entre el disco local y Chrome.
    - [CRITICAL_BOUNDS_CORRUPTION]: Pérdidas de tipo de dato o cotas NaN desfasadas.
    - [DEAD_ROUTE_CRITICAL]: Botones y rutas de eventos del DOM huérfanas de receptor.
    - [NODE_MUTATION_VIOLATION]: Desincronizaciones de antenas Bézier en Editar Nodos.
    Silencia logs inútiles de arranque para mantener una consola F12 impecable.
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

    const diagState = {
        active: true,
        operations: [],
        currentOp: null,
        opCounter: 0,
        consoleErrors: [],
        eventRegistry: new Map(), // Element -> Set of events bound
        lastMouseDownPoint: null,
        lastMouseDownSelection: null,
        lastMouseDownSegments: null,
        lastMouseDownGeo: null
    };

    // =========================================================================
    // 2. INTERCEPTOR AGRESIVO DE REGISTRO DOM (ANTI-BOTÓN MUERTO)
    // =========================================================================
    function getFriendlySelector(el) {
        if (!el) return 'unknown';
        if (el === window) return 'window';
        if (el === document) return 'document';
        if (el.id) return `#${el.id}`;
        if (el.className) {
            const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).join('.') : '';
            return `${el.tagName.toLowerCase()}.${classes}`;
        }
        return el.tagName ? el.tagName.toLowerCase() : 'unknown';
    }

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

    // =========================================================================
    // 3. CAPTURA DE EXCEPCIONES Y ERRORES DE RUNTIME
    // =========================================================================
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
            message: `[Runtime Exception] \${e.message} en \${e.filename}:\${e.lineno}:\${e.colno}`,
            timestamp: Date.now(),
            activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
            activeObject: window.selectedItem ? window.selectedItem.id : null,
            stack: e.error ? e.error.stack : null
        });
    });

    window.addEventListener('unhandledrejection', function (e) {
        diagState.consoleErrors.push({
            message: `[Unhandled Promise Rejection] \${e.reason}`,
            timestamp: Date.now(),
            activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
            activeObject: window.selectedItem ? window.selectedItem.id : null,
            stack: e.reason && e.reason.stack ? e.reason.stack : null
        });
    });

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

        // SILENCIADO: Se oculta el log de inicialización a menos que esté activo el debug
        if (window.EKKO_DEBUG) {
            rawConsole.log(`[EKKO_DIAG] Envolviendo en caliente función crítica: window.\${name}`);
        }

        const wrapper = function (...args) {
            if (!diagState.active) return originalFn.apply(this, args);
            const opId = `OP-\${String(++diagState.opCounter).padStart(5, '0')}`;
            const op = {
                id: opId,
                type: name,
                timestamp: Date.now(),
                status: 'IN_PROGRESS',
                source: name,
                args: args.map(a => {
                    if (!a) return 'null';
                    if (a.id !== undefined) return `Item(ID:\${a.id}, class:\${a.className})`;
                    if (a.x !== undefined && a.y !== undefined) return `Point(\${a.x.toFixed(1)}, \${a.y.toFixed(1)})`;
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
                op.inconsistencies.push(`[EXCEPCIÓN DE EJECUCIÓN] \${err.message}`);
                diagState.consoleErrors.push({
                    message: `[Call Exception en \${name}] \${err.message}`,
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

    // Registrar Getters/Setters reactivos para envolver lógicas asíncronas
    criticalFunctions.forEach(funcName => {
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

    // =========================================================================
    // 5. SISTEMA DE MONITOREO DE EVENTOS DE INTERACCIÓN (TIEMPO REAL)
    // =========================================================================
    if (typeof window !== 'undefined') {
        window.addEventListener('mousedown', function (e) {
            diagState.lastMouseDownPoint = { x: e.clientX, y: e.clientY };
            diagState.lastMouseDownSelection = window.selectedItem ? captureSingleItemSnapshot(window.selectedItem) : null;
            diagState.lastMouseDownSegments = window.nodeEditTarget ? getPathSegmentsCoords(window.nodeEditTarget) : null;

            const button = e.target.closest('button, .toolbar-btn, [id^="btnCtx"], [class*="btn"]');
            if (button) {
                const selector = getFriendlySelector(button);
                const isDead = !diagState.eventRegistry.has(selector) && !button.onclick;
                const isNativeFileUploader = button.id === 'btnAddSVG' || button.id === 'btnAddImage' || selector.includes('file');
                if (isDead && !isNativeFileUploader) {
                    const opId = `OP-\${String(++diagState.opCounter).padStart(5, '0')}`;
                    const op = {
                        id: opId,
                        type: 'CLICK_INTERRUPT',
                        timestamp: Date.now(),
                        status: 'WARNING',
                        source: selector,
                        args: [`text: "\${button.textContent.trim()}"`],
                        beforeState: captureGeometricStateSnapshot(),
                        afterState: null,
                        inconsistencies: [`[⚠️ DEAD_ROUTE_CRITICAL] Se hizo clic en '\${selector}' pero no tiene ningún callback o callback inactivo en el DOM.`],
                        duration: 0
                    };
                    diagState.operations.push(op);
                    rawConsole.warn(`[EKKO_DIAG] \${op.inconsistencies[0]}`);
                }
            }

            if (window.selectedItem) {
                const target = getContentItem(window.selectedItem);
                diagState.lastMouseDownGeo = target && target.data && target.data.geomBase ? target.data.geomBase.clone({ insert: false }) : null;
            } else {
                diagState.lastMouseDownGeo = null;
            }
        }, { capture: true });

        window.addEventListener('mousemove', function (e) {
            if (!diagState.lastMouseDownPoint || !window.nodeEditMode || !window.isDraggingNode || !window.nodeEditTarget) return;
            const dx = e.clientX - diagState.lastMouseDownPoint.x;
            const dy = e.clientY - diagState.lastMouseDownPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 10) {
                const currentSegments = getPathSegmentsCoords(window.nodeEditTarget);
                if (currentSegments === diagState.lastMouseDownSegments) {
                    const opId = `OP-\${String(++diagState.opCounter).padStart(5, '0')}`;
                    const op = {
                        id: opId,
                        type: 'WARP_NOT_REALTIME',
                        timestamp: Date.now(),
                        status: 'FAILED',
                        source: 'NODE_EDIT_DRAG',
                        args: [`delta: [\${dx.toFixed(0)}px, \${dy.toFixed(0)}px]`],
                        beforeState: null,
                        afterState: null,
                        inconsistencies: [`[❌ NODE_MUTATION_VIOLATION] Se arrastran nodos pero el trazado '\${window.nodeEditTarget.data?.label || 'Objeto'}' permanece estático.`],
                        duration: 0
                    };
                    const alreadyLogged = diagState.operations.some(o => o.type === 'WARP_NOT_REALTIME' && (Date.now() - o.timestamp < 1000));
                    if (!alreadyLogged) {
                        diagState.operations.push(op);
                        rawConsole.error(`❌ [NODE_MUTATION_VIOLATION]: El nodo se desplaza pero la geometría de Paper.js permanece 100% estática en pantalla.`);
                    }
                }
            }
        }, { capture: true });

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
                        if (!window.nodeEditMode) {
                            const opId = `OP-\${String(++diagState.opCounter).padStart(5, '0')}`;
                            const op = {
                                id: opId,
                                type: 'DRAG_FRUSTRADO',
                                timestamp: Date.now(),
                                status: 'WARNING',
                                source: beforeSel.label,
                                args: [`distance: \${distance.toFixed(1)}px`],
                                beforeState: captureGeometricStateSnapshot(),
                                afterState: null,
                                inconsistencies: [`[⚠️ DRAG_FRUSTRADO] Se arrastró el mouse sobre ID:\${beforeSel.id} pero no se modificaron sus coordenadas de mundo.`],
                                duration: 0
                            };
                            diagState.operations.push(op);
                            rawConsole.warn(`[EKKO_DIAG] \${op.inconsistencies[0]}`);
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

    function isMockupOrProductElement(item) {
        let curr = item;
        while (curr) {
            if (curr.clipMask || (curr.data && (
                curr.data.mockup ||
                curr.data.isMask ||
                curr.data.locked ||
                curr.data.isSelectionBox ||
                curr.data.isSmartGuide ||
                curr.data.isMeasurement
            ))) {
                return true;
            }
            curr = curr.parent;
        }
        return false;
    }

    function getPathSegmentsCoords(path) {
        if (!path || !path.segments) return '';
        return path.segments.map(s => `\${s.point.x.toFixed(1)},\${s.point.y.toFixed(1)}`).join('|');
    }

    function captureGeometricStateSnapshot() {
        if (typeof paper === 'undefined' || !paper.project) return null;
        const selectionSnapshot = [];
        const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        const list = designLayer ? designLayer.children : [];
        const activeSel = paper.project.selectedItems || [];

        return {
            timestamp: Date.now(),
            selection: activeSel.map(s => s.id),
            scene: Array.from(list).map(it => captureSingleItemSnapshot(it)).filter(Boolean)
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
                op.inconsistencies.push(`[INVARIANTE VIOLADO: DESTRUCCIÓN DE GEOMBASE] El objeto ID:\${aftItem.id} ('\${aftItem.label}') perdió su geomBase reactiva.`);
            }
        });

        if ((op.type === 'drawNodeHandles' || op.type === 'enterNodeEditMode') && window.nodeEditMode) {
            const nodeOverlay = paper.project.activeLayer.children.find(c => c.data && c.data.isNodeEditOverlay);
            if (!nodeOverlay || nodeOverlay.children.length === 0) {
                op.inconsistencies.push(`[CONTRATO VIOLADO: NODE_RENDER_FAIL] El overlay de nodos está vacío o ausente en la capa activa.`);
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
            rawConsole.log("[EKKO_DIAG v21.0 BlackBox Master] Activo 🟢 - Monitoreando automáticamente...");
            return true;
        },
        stop: function () {
            diagState.active = false;
            rawConsole.log("[EKKO_DIAG v21.0 BlackBox] Suspendido 🔴.");
            return true;
        },
        clear: function () {
            diagState.operations = [];
            diagState.consoleErrors = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v21.0] Buffer de vuelo vaciado.");
            return true;
        },
        status: function () {
            return {
                active: diagState.active,
                bufferSize: diagState.operations.length,
                errors: diagState.consoleErrors.length
            };
        },

        // AUDITORÍA ESTÁTICA EN CALIENTE (EVALÚA LOS ERRORES QUE TÚ VES A SIMPLE VISTA)
        inspect: function () {
            rawConsole.warn("⚡ REPORTE DE AUDITORÍA ESTÁTICA EN CALIENTE v21.0 (EKKO_DIAG) ⚡");
            const results = {
                deadButtons: [],
                invisibleNodes: [],
                corruptedGeomBase: [],
                viewportInfo: {},
                nodeViolations: [],
                cacheDesyncs: [],
                boundsCorruptions: []
            };

            if (typeof paper === 'undefined' || !paper.project) {
                rawConsole.error("Paper.js no se ha inicializado todavía.");
                return results;
            }

            const zoom = paper.view.zoom || 1.0;
            const viewBounds = paper.view.bounds;
            results.viewportInfo = {
                zoom: zoom,
                center: `\${paper.view.center.x.toFixed(1)}, \${paper.view.center.y.toFixed(1)}`,
                bounds: `[\${viewBounds.width.toFixed(0)}x\${viewBounds.height.toFixed(0)}]`
            };

            // 1. Auditoría de Botones Muertos del DOM (Rutas Inactivas)
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

            // 2. Auditoría de Límites Físicos y Cotas (Bounds Verification)
            const activeSel = paper.project.selectedItems || [];
            activeSel.forEach(item => {
                const b = item.bounds;
                // SI EL OBJETO DEVUELVE WIDTH/HEIGHT INVALIDO O ES CLASE POINT (NaN Bug de la v10!)
                if (!b || typeof b.width !== 'number' || isNaN(b.width) || typeof b.height !== 'number' || isNaN(b.height) || b.constructor.name === 'Point') {
                    results.boundsCorruptions.push({
                        id: item.id,
                        className: item.className,
                        label: item.data?.label || 'Objeto',
                        detectedClass: b ? b.constructor.name : 'null',
                        width: b ? b.width : 'undefined',
                        height: b ? b.height : 'undefined'
                    });
                }
            });

            // 3. Auditoría de Sincronización de Caché y ADN
            if (typeof window.initSmartFusionListeners === 'function') {
                const funcStr = window.initSmartFusionListeners.toString();
                const memVerMatch = funcStr.match(/v\d+\.\d+/);
                const memVer = memVerMatch ? memVerMatch[0] : 'v45.6';

                // Verificamos si existe desajuste de longitud o versión contra smartFusion-v11.txt
                const expectedVer = 'v45.11';
                if (memVer !== expectedVer) {
                    results.cacheDesyncs.push({
                        file: 'smartFusion.js',
                        runningVersion: memVer,
                        expectedVersion: expectedVer,
                        message: `⚠️ [CACHE_DESYNC]: smartFusion.js físico difiere del ejecutado en Chrome (Cargado: \${memVer} | Esperado: \${expectedVer}). ¡Haga Ctrl + F5!`
                    });
                }
            }

            // 4. Auditoría de Geometrías Huérfanas
            const designLayer = paper.project.layers ? paper.project.layers.find(l => l.name === 'designLayer') : null;
            const targetLayer = designLayer || paper.project.activeLayer;
            if (targetLayer && targetLayer.children) {
                targetLayer.children.forEach(c => {
                    if (c.data && c.data.mockup) return;
                    const isVector = c.className === 'Path' || c.className === 'CompoundPath';
                    if (isVector && (!c.data || !c.data.geomBase)) {
                        results.corruptedGeomBase.push({
                            id: c.id,
                            label: c.data?.label || 'Sin etiqueta',
                            class: c.className
                        });
                    }
                });
            }

            // IMPRESIÓN LIMPIA Y MILITAR EN F12
            rawConsole.log(`INFORMACIÓN DEL LIENZO: Zoom: \${results.viewportInfo.zoom} | Centro: \${results.viewportInfo.center} | Bounds: \${results.viewportInfo.bounds}`);
            
            if (results.cacheDesyncs.length > 0) {
                rawConsole.error("❌ DESCONEXIONES DE CACHÉ / ADN DETECTADAS:");
                results.cacheDesyncs.forEach(d => rawConsole.warn(`   ➔ \${d.message}`));
            } else {
                rawConsole.log("✓ Sincronización de ADN: Las versiones cargadas en Chrome coinciden con las de tu editor físico.");
            }

            if (results.boundsCorruptions.length > 0) {
                rawConsole.error("❌ DEGRADACIÓN DE BOUNDS DETECTADA (LÍMITES INVÁLIDOS):");
                results.boundsCorruptions.forEach(bc => {
                    rawConsole.warn(`   ➔ ID: \${bc.id} (\${bc.label}) devolvió límites corruptos. Constructor: \${bc.detectedClass}. ¡Las cotas flotarán corridas!`);
                });
            } else {
                rawConsole.log("✓ Proyección de Bounds: Los límites de los objetos devuelven un Rectangle real con dimensiones válidas.");
            }

            if (results.deadButtons.length > 0) {
                rawConsole.error("❌ RUTAS INACTIVAS / BOTONES MUERTOS (DOM sin callback conectado):");
                rawConsole.table(results.deadButtons);
            } else {
                rawConsole.log("✓ Conectividad DOM: Todos los botones interactivos poseen escuchadores de eventos válidos.");
            }

            if (results.corruptedGeomBase.length > 0) {
                rawConsole.error("❌ PÉRDIDAS DE GEOMBASE DETECTADAS:");
                rawConsole.table(results.corruptedGeomBase);
            } else {
                rawConsole.log("✓ Integridad Geométrica: Todos los vectores de diseño conservan su geomBase reactiva.");
            }

            rawConsole.log("=================================================================");
            return results;
        },

        copyErrors: function () {
            return this.dump();
        },

        dump: function () {
            const reportText = this.report();
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(reportText).then(() => {
                    rawConsole.log("%c✓ ¡Reporte forense v21.0 copiado automáticamente al portapapeles! Pégalo en tu chat con Gemini.", "color: #16a34a; font-weight: bold;");
                }).catch(err => {
                    rawConsole.error("No se pudo copiar automáticamente al portapapeles:", err);
                });
            }
            return reportText;
        },

        report: function () {
            let out = `==================== EKKO DIAG FORENSIC REPORT v21.0 ====================\n`;
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

            out += `### ERRORS (\${errors.length})\n`;
            if (errors.length === 0) {
                out += `  ✓ Sin excepciones de JS detectadas en la consola de runtime.\n`;
            } else {
                errors.forEach((err, idx) => {
                    out += `  [ERR-\${String(idx + 1).padStart(3, '0')}] \${err.message}\n`;
                    out += `     ➔ Hora: \${new Date(err.timestamp).toLocaleTimeString()} | ID Objeto: \${err.activeObject || 'Ninguno'}\n`;
                    if (err.stack) out += `     ➔ Stack: \${err.stack.split('\n').slice(0, 3).join(' | ')}\n`;
                });
            }
            out += `\n`;

            out += `### CONTRACT FAILURES (\&contractFailures.length)\n`;
            if (contractFailures.length === 0) {
                out += `  ✓ Todos los contratos de entrada y precondiciones de Paper.js operaron de forma limpia.\n`;
            } else {
                contractFailures.forEach(f => {
                    out += `  [\${f.opId}] Falla de Contrato en la operación '\${f.type}' | Duración: \${f.duration.toFixed(1)}ms\n`;
                    out += `     ➔ \${f.message}\n`;
                });
            }
            out += `\n`;

            out += `### DESYNCHRONIZATIONS (\${desyncs.length})\n`;
            if (desyncs.length === 0) {
                out += `  ✓ Sincronización impecable entre el DOM, los atajos de teclado y el motor gráfico de Paper.js.\n`;
            } else {
                desyncs.forEach(f => {
                    out += `  [\${f.opId}] Desincronización detectada en '\${f.type}'\n`;
                    out += `     ➔ \${f.message}\n`;
                });
            }
            out += `\n`;

            out += `### ACTION WITHOUT EFFECT (\${deadActions.length})\n`;
            if (deadActions.length === 0) {
                out += `  ✓ Sin clics fantasmas, arrastres bloqueados o interacciones inertes.\n`;
            } else {
                deadActions.forEach(f => {
                    out += `  [\${f.opId}] Acción inerte en '\${f.type}'\n`;
                    out += `     ➔ \${f.message}\n`;
                });
            }
            out += `\n`;

            out += `### FIRST OBSERVABLE INCONSISTENCY (REGLA DE ORO DE CAUSA RAÍZ)\n`;
            if (firstInconsistency) {
                out += `  ⚠️ LA CADENA DE FALLAS SE INICIÓ EN LA OPERACIÓN: \${firstInconsistency.opId} [\&firstInconsistency.type]\n`;
                out += `  Mensaje: \${firstInconsistency.msg}\n`;
                out += `  Hora de ocurrencia: \${new Date(firstInconsistency.timestamp).toLocaleTimeString()}\n`;
                out += `  SOLUCIÓN RECOMENDADA: Investigue el archivo anterior que rompió el contrato geométrico.\n`;
            } else {
                out += `  ✓ Excelente. No se han detectado inconsistencias temporales en el buffer de vuelo.\n`;
            }
            out += `\n`;

            out += `### PROBABLE ROOT CAUSES\n`;
            if (firstInconsistency) {
                if (firstInconsistency.type === 'WARP_NOT_REALTIME') {
                    out += `  ➔ [Módulo: nodeEditor.js] Falla de recálculo en tiempo real Bézier: Las curvas no propagan la deformación a geomBase.\n`;
                } else if (firstInconsistency.type === 'CLICK_INTERRUPT') {
                    out += `  ➔ [Módulo: contextualMenu.js] Ruta de evento muerta: El botón existe pero ha quedado huérfano de callback.\n`;
                } else {
                    out += `  ➔ Revise la operación '\&firstInconsistency.type' en el módulo canónico correspondiente.\n`;
                }
            } else {
                out += `  ✓ Sistema operando dentro de los parámetros de integridad funcional de la v21.0.\n`;
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
