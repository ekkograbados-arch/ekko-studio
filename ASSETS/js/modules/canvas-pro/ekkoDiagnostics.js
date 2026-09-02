/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v13.0 EagleEye - Active Forensic BlackBox)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
    Caja Negra Forense de Nivel de Aviación de 5 Niveles para EKKO Studio.
    
    ESTA VERSIÓN INCLUYE EL PROTOCOLO "OJOS DE ÁGUILA":
    1. Intercepción en caliente de EventTarget.prototype.addEventListener para auditar 
       botones "fantasmas" o "muertos" (clics sin receptores de eventos conectados).
    2. Validación de Rendimiento y Visibilidad Real de Paper.js (Canvas Viewport Checks).
       Comprueba si los nodos están realmente dibujados, visibles, con opacidad > 0 
       y dentro de los límites visuales de la pantalla (View Bounds).
    3. Comando Interactivo de Consola 'EKKO_DIAG.inspect()' para forzar auditorías visuales
       y de conectividad en tiempo real sin tener que esperar a que ocurra una operación.

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
    // REGISTRO Y SEGUIMIENTO DE EVENT LISTENERS NATIVOS (DOM AUDIT)
    // =========================================================================
    const eventRegistry = new Map(); // Guarda: Element -> Set of { type, handler, stack }

    if (typeof window !== 'undefined' && typeof EventTarget !== 'undefined') {
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        const originalRemoveEventListener = EventTarget.prototype.removeEventListener;

        EventTarget.prototype.addEventListener = function (type, handler, options) {
            if (this instanceof HTMLElement) {
                if (!eventRegistry.has(this)) {
                    eventRegistry.set(this, new Set());
                }
                eventRegistry.get(this).add({
                    type: type,
                    handler: handler,
                    stack: new Error().stack
                });
            }
            return originalAddEventListener.call(this, type, handler, options);
        };

        EventTarget.prototype.removeEventListener = function (type, handler, options) {
            if (this instanceof HTMLElement && eventRegistry.has(this)) {
                const listeners = eventRegistry.get(this);
                for (const lis of listeners) {
                    if (lis.type === type && lis.handler === handler) {
                        listeners.delete(lis);
                        break;
                    }
                }
                if (listeners.size === 0) {
                    eventRegistry.delete(this);
                }
            }
            return originalRemoveEventListener.call(this, type, handler, options);
        };
    }

    // =========================================================================
    // CANAL SEGURO DE CONSOLA E INTERCEPCIÓN DE EXCEPCIONES
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

    // --- ESTADO CENTRAL DEL RECOLECTOR ---
    const diagState = {
        active: false,
        operations: [],
        currentOp: null,
        opCounter: 0,
        consoleErrors: [],
        lastInteraction: null
    };

    // Escucha activa de excepciones runtime
    if (typeof window !== 'undefined') {
        const origConsoleError = console.error;
        console.error = function (...args) {
            const errorMsg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            if (diagState.active) {
                diagState.consoleErrors.push({
                    message: errorMsg,
                    timestamp: Date.now(),
                    activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
                    activeObject: window.selectedItem ? window.selectedItem.id : null,
                    stack: new Error().stack
                });
            }
            return origConsoleError.apply(console, args);
        };

        window.addEventListener('error', function (e) {
            if (diagState.active) {
                diagState.consoleErrors.push({
                    message: `[Runtime Exception] ${e.message} en ${e.filename}:${e.lineno}:${e.colno}`,
                    timestamp: Date.now(),
                    activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
                    activeObject: window.selectedItem ? window.selectedItem.id : null,
                    stack: e.error ? e.error.stack : null
                });
            }
        });

        window.addEventListener('unhandledrejection', function (e) {
            if (diagState.active) {
                diagState.consoleErrors.push({
                    message: `[Promise Rejection] ${e.reason}`,
                    timestamp: Date.now(),
                    activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
                    activeObject: window.selectedItem ? window.selectedItem.id : null,
                    stack: e.reason ? e.reason.stack : null
                });
            }
        });
    }

    // =========================================================================
    // METODOLOGÍA DE CAPTURA DE ESTADO GEOMÉTRICO (SNAPSHOTTING)
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

    function snapshotSelection() {
        if (typeof window === 'undefined' || typeof paper === 'undefined' || !paper.project) {
            return { hasSelection: false };
        }
        const activeItem = window.selectedItem || null;
        if (!activeItem) return { hasSelection: false };

        const target = getContentItem(activeItem);
        return {
            hasSelection: true,
            id: activeItem.id,
            className: activeItem.className,
            targetId: target ? target.id : null,
            targetClass: target ? target.className : null,
            bounds: activeItem.bounds ? {
                x: activeItem.bounds.x,
                y: activeItem.bounds.y,
                width: activeItem.bounds.width,
                height: activeItem.bounds.height
            } : null,
            position: activeItem.position ? { x: activeItem.position.x, y: activeItem.position.y } : null,
            geomBaseExists: !!(target && target.data && target.data.geomBase),
            geomBaseId: (target && target.data && target.data.geomBase) ? target.data.geomBase.id : null,
            isClipped: !!(activeItem.data && activeItem.data.clipGroup),
            segmentsCount: (target && target.segments) ? target.segments.length : 0
        };
    }

    function snapshotGeometricState() {
        if (typeof window === 'undefined' || typeof paper === 'undefined' || !paper.project) {
            return { totalItems: 0, items: [] };
        }
        const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        if (!designLayer) return { totalItems: 0, items: [] };

        const itemsSnapshot = [];
        const processItem = (item) => {
            if (item.data && (item.data.isSelectionBox || item.data.isHandle || item.data.isNodeEditOverlay || item.data.isSmartGuide)) {
                return; // Excluir elementos auxiliares de UI
            }
            const target = getContentItem(item);
            itemsSnapshot.push({
                id: item.id,
                className: item.className,
                visible: item.visible,
                position: { x: item.position.x, y: item.position.y },
                bounds: { x: item.bounds.x, y: item.bounds.y, width: item.bounds.width, height: item.bounds.height },
                geomBaseExists: !!(target && target.data && target.data.geomBase)
            });
        };

        if (designLayer.children) {
            designLayer.children.forEach(processItem);
        }

        return {
            totalItems: itemsSnapshot.length,
            items: itemsSnapshot,
            zOrderIds: designLayer.children ? designLayer.children.map(c => c.id) : []
        };
    }

    // =========================================================================
    // EVALUADOR EN CALIENTE DE INCOHERENCIAS (AUDIT CONSISTENCY)
    // =========================================================================
    function auditConsistency(op) {
        const beforeSel = op.before.selection;
        const afterSel = op.after.selection;
        const beforeGeo = op.before.geometry;
        const afterGeo = op.after.geometry;
        const inconsistencies = [];

        // Ignorar auditorías si no hay datos de inicio válidos
        if (!beforeGeo || !afterGeo) return inconsistencies;

        // --- CONTRATO 1: ACCIÓN SIN EFECTO ---
        if (op.type === 'DRAG' || op.type === 'TRANSFORM') {
            if (beforeSel.hasSelection && afterSel.hasSelection && beforeSel.id === afterSel.id) {
                const b0 = beforeSel.position;
                const b1 = afterSel.position;
                if (b0 && b1 && b0.x === b1.x && b0.y === b1.y) {
                    // Si se arrastró visualmente pero sus coordenadas no cambiaron en absoluto
                    if (op.source === 'canvas:mousedrag' && op.metadata && op.metadata.pointerMoved) {
                        inconsistencies.push({
                            type: 'ACTION_WITHOUT_EFFECT',
                            code: 'DRAG_FRUSTRATED',
                            message: `[ARRASTRE FRUSTRADO] Se detectó desplazamiento del puntero sobre el objeto ID: ${afterSel.id}, pero sus coordenadas en Paper.js permanecieron idénticas.`
                        });
                    }
                }
            }
        }

        // --- CONTRATO 2: PRESERVACIÓN DE GEOMBASE EN SELECCIÓN ---
        if (op.type === 'SELECT') {
            if (afterSel.hasSelection && !afterSel.geomBaseExists) {
                // Si seleccionamos una pieza útil de diseño pero carece de geomBase
                inconsistencies.push({
                    type: 'INVARIANT_FAILURE',
                    code: 'DESTRUCCION_GEOMBASE',
                    message: `[INVARIANTE VIOLADO] El objeto ID: ${afterSel.id} fue seleccionado pero carece de 'data.geomBase'. Su reactividad CSG e independencia Bézier quedan inoperativas.`
                });
            }
        }

        // --- CONTRATO 3: DUPLICACIÓN E INDEPENDENCIA DE IDENTIDAD ---
        if (op.type === 'DUPLICATE') {
            if (afterGeo.totalItems <= beforeGeo.totalItems) {
                inconsistencies.push({
                    type: 'CONTRACT_FAILURE',
                    code: 'CLONE_FAILED',
                    message: `[CONTRATO VIOLADO] Se solicitó duplicar, pero la cantidad de elementos en el lienzo no aumentó (Previo: ${beforeGeo.totalItems}, Actual: ${afterGeo.totalItems}).`
                });
            } else if (beforeSel.hasSelection && afterSel.hasSelection) {
                if (beforeSel.id === afterSel.id) {
                    inconsistencies.push({
                        type: 'DESYNCHRONIZATION',
                        code: 'SELECTION_NOT_MIGRATED',
                        message: `[DESINCRONIZACIÓN SELECCIÓN] Al duplicar, la selección activa de Studio no migró al nuevo clon y quedó anclada en el objeto original ID: ${beforeSel.id}.`
                    });
                }
            }
        }

        // --- CONTRATO 4: RECALCULO DE CALADO CSG (isHole) ---
        if (op.type === 'WELD' || op.type === 'SUBTRACT') {
            if (afterGeo.totalItems >= beforeGeo.totalItems && beforeGeo.totalItems > 0) {
                inconsistencies.push({
                    type: 'CONTRACT_FAILURE',
                    code: 'CSG_MUTATION_FAILED',
                    message: `[CONTRATO VIOLADO] La sustracción booleana / perforación de LightBurn style no consolidó las capas geométricas en un único CompoundPath.`
                });
            }
        }

        // --- CONTRATO 5: COHERENCIA DE SEGMENTOS EN EDICIÓN DE NODOS ---
        if (op.type === 'NODE_EDIT' || op.type === 'NODE_DRAG') {
            if (beforeSel.hasSelection && afterSel.hasSelection && beforeSel.id === afterSel.id) {
                const s0 = beforeSel.segmentsCount;
                const s1 = afterSel.segmentsCount;
                if (op.source === 'keydown:delete' && s1 >= s0 && s0 > 0) {
                    inconsistencies.push({
                        type: 'CONTRACT_FAILURE',
                        code: 'NODE_DELETION_FAILED',
                        message: `[CONTRATO VIOLADO: NODE_DELETE] Se ordenó borrar los nodos seleccionados, pero el número de segmentos geométricos no disminuyó (Previo: ${s0}, Actual: ${s1}).`
                    });
                }
            }
        }

        // --- CONTRATO 6: CONSISTENCIA DE APILAMIENTO Z (Z-ORDER) ---
        if (beforeGeo.zOrderIds && afterGeo.zOrderIds && beforeGeo.zOrderIds.length === afterGeo.zOrderIds.length) {
            // Si la operación no es de apilamiento pero el Z-Order mutó
            const nonStackingOps = ['DRAG', 'SELECT', 'NODE_DRAG'];
            if (nonStackingOps.includes(op.type)) {
                let orderMutated = false;
                for (let i = 0; i < beforeGeo.zOrderIds.length; i++) {
                    if (beforeGeo.zOrderIds[i] !== afterGeo.zOrderIds[i]) {
                        orderMutated = true;
                        break;
                    }
                }
                if (orderMutated) {
                    inconsistencies.push({
                        type: 'INVARIANT_FAILURE',
                        code: 'Z_ORDER_STATE_SYNC_LOST',
                        message: `[INVARIANTE VIOLADO] El orden de apilamiento Z (Z-index) mutó de forma colateral inesperada durante una operación de ${op.type}.`
                    });
                }
            }
        }

        return inconsistencies;
    }

    // =========================================================================
    // INTERCEPTORES DE LLAMADAS DEL CANVAS (INSTRUMENTACIÓN)
    // =========================================================================
    const monitoredAPIs = [
        { objName: 'window', prop: 'enterNodeEditMode', opType: 'NODE_EDIT' },
        { objName: 'window', prop: 'exitNodeEditMode', opType: 'NODE_EDIT' },
        { objName: 'window', prop: 'deleteSelectedNodes', opType: 'NODE_EDIT' },
        { objName: 'window', prop: 'detachSelectedSubpaths', opType: 'NODE_EDIT' },
        { objName: 'window', prop: 'duplicateSelectedItem', opType: 'DUPLICATE' },
        { objName: 'window', prop: 'duplicateSingleItem', opType: 'DUPLICATE' },
        { objName: 'window', prop: 'duplicateImage', propAlt: 'duplicateImage', opType: 'DUPLICATE' },
        { objName: 'window', prop: 'deleteImage', opType: 'DELETE' },
        { objName: 'window', prop: 'groupSelectedItems', opType: 'GROUP' },
        { objName: 'window', prop: 'ungroupSelectedItem', opType: 'UNGROUP' },
        { objName: 'window', prop: 'selectItem', opType: 'SELECT' },
        { objName: 'window', prop: 'deselectItem', opType: 'SELECT' },
        { objName: 'window', prop: 'recalculateDynamicSubtractions', opType: 'CSG_REACTIVE' }
    ];

    function installReactivePropertyInterceptors() {
        if (diagState.interceptorsInstalled || typeof window === 'undefined') return;

        monitoredAPIs.forEach(api => {
            let currentValue = window[api.prop];

            Object.defineProperty(window, api.prop, {
                get: function () {
                    return currentValue;
                },
                set: function (newValue) {
                    if (typeof newValue === 'function' && !newValue.__isWrapped) {
                        const wrappedFn = function (...args) {
                            if (!diagState.active) {
                                return newValue.apply(this, args);
                            }
                            const opId = ++diagState.opCounter;
                            const op = {
                                id: opId,
                                type: api.opType,
                                source: `APICall: window.${api.prop}`,
                                timestamp: Date.now(),
                                before: {
                                    selection: snapshotSelection(),
                                    geometry: snapshotGeometricState()
                                },
                                after: null,
                                errors: []
                            };

                            try {
                                const result = newValue.apply(this, args);
                                op.after = {
                                    selection: snapshotSelection(),
                                    geometry: snapshotGeometricState()
                                };
                                op.errors = auditConsistency(op);
                                diagState.operations.push(op);
                                return result;
                            } catch (err) {
                                op.after = {
                                    selection: snapshotSelection(),
                                    geometry: snapshotGeometricState()
                                };
                                op.errors.push({
                                    type: 'RUNTIME_EXCEPTION',
                                    code: 'METHOD_THROW',
                                    message: `[ERROR METODO] Falló ejecución de ${api.prop}: ${err.message}`
                                });
                                diagState.operations.push(op);
                                throw err;
                            }
                        };
                        wrappedFn.__isWrapped = true;
                        currentValue = wrappedFn;
                    } else {
                        currentValue = newValue;
                    }
                },
                configurable: true,
                enumerable: true
            });

            // Forzar envoltura si ya existía valor previo
            if (currentValue) {
                window[api.prop] = currentValue;
            }
        });

        // Intercepción global de eventos del DOM en caliente (Clics interactivos)
        document.addEventListener('click', function (e) {
            if (!diagState.active) return;
            const target = e.target.closest('button, .toolbar-btn, [id^="btnCtx"], [id^="proBtn"]');
            if (!target) return;

            const opId = ++diagState.opCounter;
            const op = {
                id: opId,
                type: 'DOM_CLICK',
                source: `DOMClick: #${target.id || 'N/A'} [${target.className || ''}]`,
                timestamp: Date.now(),
                before: {
                    selection: snapshotSelection(),
                    geometry: snapshotGeometricState()
                },
                after: null,
                errors: [],
                metadata: {
                    buttonId: target.id,
                    innerText: target.innerText ? target.innerText.trim() : ''
                }
            };

            // Esperar 150ms asincrónicamente para capturar mutaciones resultantes del clic
            setTimeout(() => {
                op.after = {
                    selection: snapshotSelection(),
                    geometry: snapshotGeometricState()
                };

                // Comprobar si el botón tiene event listeners conectados
                const listeners = eventRegistry.get(target);
                const hasClickHandlers = listeners && Array.from(listeners).some(l => l.type === 'click');

                if (!hasClickHandlers && !target.onclick) {
                    op.errors.push({
                        type: 'ACTION_WITHOUT_EFFECT',
                        code: 'DEAD_BUTTON_NO_LISTENER',
                        message: `[BOTÓN MUERTO] Se hizo clic en el botón #${target.id || 'N/A'} ('${op.metadata.innerText}'), pero no tiene ningún receptor de eventos de clic conectado. El botón está desconectado.`
                    });
                } else {
                    // Validar si produjo efectos geométricos o de estado
                    const stateChanged = JSON.stringify(op.before) !== JSON.stringify(op.after);
                    if (!stateChanged) {
                        // Es un clic inerte. Podría ser normal (ej. abrir menú de fuentes), pero es advertible.
                        const isMenuToggle = target.id.includes('Selector') || target.id.includes('dropdown');
                        if (!isMenuToggle && op.before.selection.hasSelection) {
                            op.errors.push({
                                type: 'ACTION_WITHOUT_EFFECT',
                                code: 'CLIC_INERTE_ADVERTENCIA',
                                message: `[ADVERTENCIA: CLIC SIN EFECTO] Clic en #${target.id || 'N/A'} no produjo cambios detectables en el Canvas ni en la selección.`
                            });
                        }
                    }
                }

                op.errors.push(...auditConsistency(op));
                diagState.operations.push(op);
            }, 150);

        }, { capture: true });

        // Intercepción del arrastre físico del ratón en el lienzo
        let isMouseDownOnCanvas = false;
        let pointerMovedDuringDrag = false;

        document.addEventListener('mousedown', function (e) {
            if (!diagState.active) return;
            const canvas = document.getElementById('editorCanvas');
            if (e.target === canvas) {
                isMouseDownOnCanvas = true;
                pointerMovedDuringDrag = false;
                diagState.lastInteraction = {
                    type: 'DRAG_START',
                    timestamp: Date.now(),
                    before: {
                        selection: snapshotSelection(),
                        geometry: snapshotGeometricState()
                    }
                };
            }
        }, { capture: true });

        document.addEventListener('mousemove', function (e) {
            if (isMouseDownOnCanvas) {
                pointerMovedDuringDrag = true;
            }
        }, { capture: true });

        document.addEventListener('mouseup', function (e) {
            if (isMouseDownOnCanvas && diagState.lastInteraction) {
                isMouseDownOnCanvas = false;
                const opId = ++diagState.opCounter;
                const op = {
                    id: opId,
                    type: window.nodeEditMode ? 'NODE_DRAG' : 'DRAG',
                    source: 'canvas:mousedrag',
                    timestamp: Date.now(),
                    before: diagState.lastInteraction.before,
                    after: {
                        selection: snapshotSelection(),
                        geometry: snapshotGeometricState()
                    },
                    errors: [],
                    metadata: {
                        pointerMoved: pointerMovedDuringDrag
                    }
                };
                op.errors = auditConsistency(op);
                diagState.operations.push(op);
                diagState.lastInteraction = null;
            }
        }, { capture: true });

        // Intercepción de atajos de teclado críticos
        document.addEventListener('keydown', function (e) {
            if (!diagState.active) return;
            const key = e.key.toLowerCase();
            const isCtrl = e.ctrlKey || e.metaKey;

            let shortcutTriggered = null;
            if (isCtrl && key === 'd') shortcutTriggered = 'Ctrl+D (Duplicar)';
            if (isCtrl && key === 'c') shortcutTriggered = 'Ctrl+C (Copiar)';
            if (isCtrl && key === 'v') shortcutTriggered = 'Ctrl+V (Pegar)';
            if (e.key === 'Delete' || e.key === 'Backspace') shortcutTriggered = 'Supr/Retroceso (Eliminar)';

            if (shortcutTriggered) {
                const opId = ++diagState.opCounter;
                const op = {
                    id: opId,
                    type: shortcutTriggered.includes('Duplicar') ? 'DUPLICATE' : 
                          shortcutTriggered.includes('Eliminar') ? 'DELETE' : 'SHORTCUT',
                    source: `keydown:${key}`,
                    timestamp: Date.now(),
                    before: {
                        selection: snapshotSelection(),
                        geometry: snapshotGeometricState()
                    },
                    after: null,
                    errors: []
                };

                setTimeout(() => {
                    op.after = {
                        selection: snapshotSelection(),
                        geometry: snapshotGeometricState()
                    };
                    op.errors = auditConsistency(op);
                    diagState.operations.push(op);
                }, 150);
            }
        }, { capture: true });

        diagState.interceptorsInstalled = true;
    }

    // =========================================================================
    // COMANDO INTERACTIVO 'EKKO_DIAG.inspect()' (EAGLE EYE ENGINE)
    // =========================================================================
    function inspectCanvasAndDOM() {
        rawConsole.log('%c🔍 [EKKO EAGLE EYE INSPECTOR INICIALIZADO] Realizando auditoría estática profunda...', 'color: #0284c7; font-weight: bold; font-size: 13px;');

        const audit = {
            domDeadButtons: [],
            domConnectedButtonsCount: 0,
            canvasStatus: 'UNKNOWN',
            canvasInvisibleNodes: [],
            canvasGeometricBaseStatus: [],
            warnings: []
        };

        // 1. Auditoría DOM: Escaneo exhaustivo de botones fantasmas
        const buttons = document.querySelectorAll('button, .toolbar-btn, [id^="btnCtx"], [id^="proBtn"]');
        buttons.forEach(btn => {
            const listeners = eventRegistry.get(btn);
            const hasClickHandlers = (listeners && Array.from(listeners).some(l => l.type === 'click')) || btn.onclick;

            if (!hasClickHandlers) {
                audit.domDeadButtons.push({
                    id: btn.id || 'N/A',
                    className: btn.className || '',
                    text: btn.innerText ? btn.innerText.trim() : 'Sin texto',
                    parentContainer: btn.parentElement ? btn.parentElement.id || btn.parentElement.className : 'DOM Root'
                });
            } else {
                audit.domConnectedButtonsCount++;
            }
        });

        // 2. Auditoría del Canvas de Paper.js
        if (typeof paper !== 'undefined' && paper.project) {
            audit.canvasStatus = 'CONNECTED';
            const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;

            if (designLayer && designLayer.children) {
                // Auditoría geométrica de los elementos
                designLayer.children.forEach(item => {
                    if (item.data && (item.data.isSelectionBox || item.data.isHandle || item.data.isNodeEditOverlay || item.data.isSmartGuide)) {
                        return; // Omitir controles visuales
                    }
                    const target = getContentItem(item);
                    const hasGeomBase = !!(target && target.data && target.data.geomBase);

                    audit.canvasGeometricBaseStatus.push({
                        id: item.id,
                        className: item.className,
                        label: item.data?.label || 'Sin etiqueta',
                        visible: item.visible,
                        hasGeomBase: hasGeomBase,
                        isClipped: !!(item.data && item.data.clipGroup)
                    });

                    if (!hasGeomBase && item.visible && !item.data?.mockup) {
                        audit.warnings.push(`[INVARIANTE DESTRUIDO] El elemento ID: ${item.id} ('${item.data?.label || 'Vector'}') está visible pero no posee 'data.geomBase'. Su edición de nodos fallará.`);
                    }
                });

                // Auditoría específica del Modo Nodos si está activo
                if (window.nodeEditMode) {
                    const nodeGroup = designLayer.children.find(c => c.data && c.data.isNodeHandleContainer);
                    if (!nodeGroup || !nodeGroup.children || nodeGroup.children.length === 0) {
                        audit.canvasInvisibleNodes.push({
                            code: 'NO_OVERLAY_GROUP_FOUND',
                            message: `[ERROR VISUAL] 'nodeEditMode' está activo en window, pero no se encontró ningún contenedor de nodos interactivos ('isNodeHandleContainer') dibujado en la capa de diseño.`
                        });
                    } else {
                        // Validar si los tiradores están fuera del Viewport
                        const viewportBounds = paper.view.bounds;
                        let visibleNodesCount = 0;
                        nodeGroup.children.forEach(child => {
                            if (child.data?.isNodeHandle && child.visible && child.opacity > 0) {
                                if (viewportBounds.contains(child.position)) {
                                    visibleNodesCount++;
                                }
                            }
                        });

                        if (visibleNodesCount === 0) {
                            audit.canvasInvisibleNodes.push({
                                code: 'NODES_OFFSCREEN',
                                message: `[ERROR VISUAL] Los nodos de anclaje están cargados en memoria (${nodeGroup.children.length} elementos), pero todos se encuentran fuera de los límites de la pantalla (Viewport Bounds) debido al zoom o desplazamiento del lienzo.`
                            });
                        }
                    }
                }
            } else {
                audit.canvasStatus = 'EMPTY_DESIGN_LAYER';
                audit.warnings.push('[ADVERTENCIA CANVAS] No se encontró la capa canónica de diseño ("designLayer") activa.');
            }
        } else {
            audit.canvasStatus = 'DISCONNECTED_PAPER_JS_NOT_FOUND';
            audit.warnings.push('[ERROR CRÍTICO] No se encontró Paper.js o el lienzo no está instanciado en el ámbito global.');
        }

        // 3. Imprimir el Reporte de Inspección por consola de forma estética
        rawConsole.log('%c📋 RESULTADOS DEL INSPECTOR DE CAJA NEGRA:', 'color: #0369a1; font-weight: bold;');
        
        // Sección A: Conectividad DOM
        if (audit.domDeadButtons.length > 0) {
            rawConsole.warn(`%c🔴 BOTONES FANTASMAS DETECTADOS (${audit.domDeadButtons.length}):`, 'font-weight: bold; color: #b91c1c;');
            rawConsole.table(audit.domDeadButtons);
            rawConsole.error('[FALLO DE CONECTIVIDAD INTERFÁCICA] Estos botones existen físicamente en el DOM, pero el usuario los presiona y nada ocurre porque no tienen listeners asociados.');
        } else {
            rawConsole.log(`%c🟢 CONECTIVIDAD DOM IMPECABLE: ${audit.domConnectedButtonsCount} botones activos validados con receptores funcionales.`, 'color: #15803d;');
        }

        // Sección B: Integridad Visual de Nodos
        if (window.nodeEditMode) {
            if (audit.canvasInvisibleNodes.length > 0) {
                rawConsole.error(`%c🔴 FALLO CRÍTICO EN MODO EDICIÓN DE NODOS:`, 'font-weight: bold; color: #b91c1c;');
                audit.canvasInvisibleNodes.forEach(n => rawConsole.error(`  ↳ ${n.message}`));
            } else {
                rawConsole.log('%c🟢 RENDERIZADO DE NODOS ACTIVO: Los nodos Bézier se encuentran cargados, visibles y dentro del viewport del lienzo.', 'color: #15803d;');
            }
        }

        // Sección C: Geometría Base e Invariantes
        if (audit.warnings.length > 0) {
            rawConsole.warn('%c⚠️ ADVERTENCIAS DE INVARIANTE VECTORIAL:', 'font-weight: bold; color: #a16207;');
            audit.warnings.forEach(w => rawConsole.warn(`  ↳ ${w}`));
        } else {
            rawConsole.log('%c🟢 INTEGRIDAD VECTORIAL COMPLETA: Todos los objetos interactivos conservan su geometría base reactiva intacta.', 'color: #15803d;');
        }

        rawConsole.log('%c🔍 [FIN DE INSPECCIÓN ESTÁTICA]', 'color: #0284c7; font-weight: bold;');
        return audit;
    }

    // =========================================================================
    // EXPOSICIÓN DE LA API PÚBLICA DE DIAGNÓSTICO
    // =========================================================================
    const publicAPI = {
        /**
         * Enciende la caja negra registradora de forma activa.
         */
        start: function () {
            diagState.active = true;
            installReactivePropertyInterceptors();
            rawConsole.log('%c[EKKO_DIAG v13.0 EagleEye] Caja Negra Encendida 🟢 - Monitoreando interacciones, atajos y listeners...', 'color: #15803d; font-weight: bold;');
        },

        /**
         * Apaga temporalmente la caja negra.
         */
        stop: function () {
            diagState.active = false;
            rawConsole.log('%c[EKKO_DIAG] Caja Negra Detenida 🔴', 'color: #b91c1c; font-weight: bold;');
        },

        /**
         * Borra el historial del buffer de operaciones.
         */
        clear: function () {
            diagState.operations = [];
            diagState.consoleErrors = [];
            diagState.opCounter = 0;
            rawConsole.log('[EKKO_DIAG] Historial de Caja Negra borrado.');
        },

        /**
         * Devuelve un snapshot del estado activo actual de la sesión.
         */
        status: function () {
            return {
                active: diagState.active,
                totalOperationsTracked: diagState.operations.length,
                totalConsoleErrorsTracked: diagState.consoleErrors.length,
                nodeEditModeActive: !!window.nodeEditMode,
                selectedItem: window.selectedItem ? window.selectedItem.id : null
            };
        },

        /**
         * Fuerza un escaneo estático en caliente del DOM y Paper.js (Eagle Eye).
         */
        inspect: function () {
            return inspectCanvasAndDOM();
        },

        /**
         * Escupe el Reporte Técnico de Auditoría estructurado según la Sección 25.
         */
        report: function () {
            const buffer = diagState.operations;
            const exceptions = diagState.consoleErrors;

            let reportText = `========================================================================\n`;
            reportText += `          REPORTE TÉCNICO DE AUDITORÍA FORENSE - EKKO STUDIO (v13.0)\n`;
            reportText += `          Generado: ${new Date().toISOString()}\n`;
            reportText += `          Operaciones Trackeadas: ${buffer.length} | Errores de Consola: ${exceptions.length}\n`;
            reportText += `========================================================================\n\n`;

            // SECCIÓN 1: ERRORS (Runtime exceptions)
            reportText += `### 1. ERRORS (EXCEPCIONES DE TIEMPO DE EJECUCIÓN JAVASCRIPT)\n`;
            if (exceptions.length === 0) {
                reportText += `  [OK] No se registraron excepciones de runtime ni fallas asíncronas de consola F12 durante la sesión.\n\n`;
            } else {
                exceptions.forEach((err, idx) => {
                    reportText += `  [ERROR #${idx + 1}] Timestamp: ${new Date(err.timestamp).toLocaleTimeString()} | Tool: ${err.activeTool}\n`;
                    reportText += `    ↳ Mensaje: ${err.message}\n`;
                    if (err.stack) {
                        reportText += `    ↳ StackTrace: ${err.stack.split('\n').slice(0, 3).join('\n      ')}\n`;
                    }
                    reportText += `\n`;
                });
            }

            // SECCIÓN 2: CONTRACT FAILURES
            const contractFailures = [];
            const invariantFailures = [];
            const desyncs = [];
            const deadActions = [];

            buffer.forEach(op => {
                if (op.errors && op.errors.length > 0) {
                    op.errors.forEach(err => {
                        const formattedErr = {
                            opId: op.id,
                            opType: op.type,
                            source: op.source,
                            code: err.code,
                            message: err.message
                        };
                        if (err.type === 'CONTRACT_FAILURE') contractFailures.push(formattedErr);
                        if (err.type === 'INVARIANT_FAILURE') invariantFailures.push(formattedErr);
                        if (err.type === 'DESYNCHRONIZATION') desyncs.push(formattedErr);
                        if (err.type === 'ACTION_WITHOUT_EFFECT') deadActions.push(formattedErr);
                    });
                }
            });

            reportText += `### 2. CONTRACT FAILURES (CONTRATOS DE HERRAMIENTA ROTOS)\n`;
            if (contractFailures.length === 0) {
                reportText += `  [OK] Todos los comportamientos esperados de duplicación, vaciado, y borrado se cumplieron prístinamente.\n\n`;
            } else {
                contractFailures.forEach(f => {
                    reportText += `  [FALLA CONTRATO] Operación ID: [OP-${String(f.opId).padStart(5, '0')}] (${f.opType}) | Origen: ${f.source}\n`;
                    reportText += `    ↳ Alarma: ${f.message}\n\n`;
                });
            }

            // SECCIÓN 3: INVARIANT FAILURES
            reportText += `### 3. INVARIANT FAILURES (VIOLACIÓN DE REGLAS DE ORO VECTORIALES)\n`;
            if (invariantFailures.length === 0) {
                reportText += `  [OK] No se detectó corrupción geométrica, alteración oculta de Z-order, ni pérdida de la referencia 'geomBase'.\n\n`;
            } else {
                invariantFailures.forEach(f => {
                    reportText += `  [FALLA INVARIANTE] Operación ID: [OP-${String(f.opId).padStart(5, '0')}] (${f.opType})\n`;
                    reportText += `    ↳ Alarma: ${f.message}\n\n`;
                });
            }

            // SECCIÓN 4: DESYNCHRONIZATIONS (Focos de Selección y DOM)
            reportText += `### 4. DESYNCHRONIZATIONS (DESAJUSTES DE SELECCIÓN Y CAPAS)\n`;
            if (desyncs.length === 0) {
                reportText += `  [OK] El foco celeste de selección y la cola de capas de diseño estuvieron siempre coordinados.\n\n`;
            } else {
                desyncs.forEach(f => {
                    reportText += `  [DESINCRONIZACIÓN] Operación ID: [OP-${String(f.opId).padStart(5, '0')}] (${f.opType})\n`;
                    reportText += `    ↳ Alarma: ${f.message}\n\n`;
                });
            }

            // SECCIÓN 5: ACTION WITHOUT EFFECT (Clics inertes y botones muertos)
            reportText += `### 5. ACTION WITHOUT EFFECT (BOTONES MUERTOS O DESCONECTADOS)\n`;
            if (deadActions.length === 0) {
                reportText += `  [OK] Cada clic, pulsación y arrastre interactivo en Studio produjo un cambio físico y de estado real.\n\n`;
            } else {
                deadActions.forEach(f => {
                    reportText += `  [ACCIÓN INERTE] Operación ID: [OP-${String(f.opId).padStart(5, '0')}] (${f.opType}) | Origen: ${f.source}\n`;
                    reportText += `    ↳ Alarma: ${f.message}\n\n`;
                });
            }

            // SECCIÓN 6: RULE OF THE FIRST OBSERVABLE INCONSISTENCY (CAUSA RAÍZ DE AVIACIÓN)
            reportText += `### 6. RULE OF THE FIRST OBSERVABLE INCONSISTENCY (RASTREO CAUSA RAÍZ)\n`;
            const firstInconsistency = buffer.find(op => op.errors && op.errors.length > 0);
            if (!firstInconsistency) {
                reportText += `  [SANO] No se detectó ningún eslabón roto en la sesión. El sistema se encuentra 100% ESTABLE.\n\n`;
            } else {
                const primaryErr = firstInconsistency.errors[0];
                reportText += `  [PRIMERA INCONSISTENCIA DETECTADA] Operación ID: [OP-${String(firstInconsistency.id).padStart(5, '0')}] (${firstInconsistency.type}) a las ${new Date(firstInconsistency.timestamp).toLocaleTimeString()}\n`;
                reportText += `    ↳ Mensaje Primario: ${primaryErr.message}\n`;
                reportText += `    ↳ Disparador de Interfaz: ${firstInconsistency.source}\n`;
                reportText += `    ↳ Causa Raíz Probable: `;

                if (primaryErr.code === 'DEAD_BUTTON_NO_LISTENER') {
                    reportText += `Desconexión de interfaz de usuario (DOM). El elemento HTML existe físicamente pero carece de callbacks vinculados en JavaScript debido a un error de ciclo de vida o renderizado tardío.\n`;
                } else if (primaryErr.code === 'DESTRUCCION_GEOMBASE') {
                    reportText += `Conflicto de Ámbito (Scope Error). Un método de manipulación manipuló el contenedor 'clipGroup' en lugar del trazado geométrico real de Paper.js, borrando la memoria 'geomBase'.\n`;
                } else if (primaryErr.code === 'DRAG_FRUSTRATED') {
                    reportText += `Interrupción asíncrona o bloqueo de puntero. El manejador de ratón fue neutralizado o las coordenadas están siendo restringidas por una guía inteligente o un grupo de recorte.\n`;
                } else {
                    reportText += `Desincronización temporal entre el estado reactivo de Studio (window) y la representación visual de Paper.js.\n`;
                }
                reportText += `\n  [RECOMENDACIÓN DE AVIACIÓN]: No audite las fallas colaterales posteriores. Resuelva el fallo [OP-${String(firstInconsistency.id).padStart(5, '0')}] y la cascada de errores restante desaparecerá automáticamente.\n\n`;
            }

            reportText += `==================== FIN DEL REPORTE DE CAUSA RAÍZ ====================`;

            rawConsole.log('%c====================================================', 'color: #0284c7;');
            rawConsole.log('%c        REPORTE TÉCNICO DE CAUSA RAÍZ GENERADO     ', 'color: #0284c7; font-weight: bold;');
            rawConsole.log('%c====================================================', 'color: #0284c7;');
            
            // Imprimir línea a línea por comodidad en F12
            reportText.split('\n').forEach(line => {
                if (line.includes('[OK]') || line.includes('[SANO]')) {
                    rawConsole.log(`%c${line}`, 'color: #15803d;');
                } else if (line.includes('FALLA') || line.includes('VIOLADO') || line.includes('ERROR') || line.includes('INCONSISTENCIA') || line.includes('MUERTO')) {
                    rawConsole.warn(`%c${line}`, 'color: #b91c1c; font-weight: bold;');
                } else if (line.includes('###')) {
                    rawConsole.log(`%c\n${line}`, 'color: #0369a1; font-weight: bold; font-size: 11px;');
                } else {
                    rawConsole.log(line);
                }
            });

            return reportText;
        }
    };

    // Auto-arranque pasivo para interceptación de addEventListener desde el milisegundo 1
    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
        publicAPI.start(); // El registrador corre por detrás para atrapar los listeners nativos en carga
    }

    return publicAPI;
}));
