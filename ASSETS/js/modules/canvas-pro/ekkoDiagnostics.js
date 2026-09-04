/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE
ESTADO: ENTREGADO PARA VALIDACIÓN CIENTÍFICA (v23.0 "SYNAPSE INTEGRATION")
DEPENDENCIAS DIRECTAS: ASSETS/js/editor.js, ASSETS/js/modules/selection.js, ASSETS/js/modules/canvas-pro/ekkoSynapse.js
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v23.0 - EKKO Diagnostics Core)
Descripción:
    Computador de Vuelo de precisión militar para EKKO Studio.
    Intercepta errores de consola, excepciones asíncronas y eventos DOM.
    Proporciona la interfaz de control global y el portal de acoplamiento 
    asíncrono para el motor de Red Neuronal (ekkoSynapse.js).
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

    const rawConsole = {
        log: (typeof console !== 'undefined' && console.log) ? console.log.bind(console) : () => {},
        warn: (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : () => {},
        error: (typeof console !== 'undefined' && console.error) ? console.error.bind(console) : () => {}
    };

    const diagState = {
        active: true,
        operations: [],
        opCounter: 0,
        consoleErrors: [],
        eventRegistry: new Map(), // Element selector -> Set of event types
        lastMouseDownPoint: null,
        synapseEngine: null
    };

    // =========================================================================
    // 1. INTERCEPTOR DE EVENTOS DOM (Mapeo de Axones / Escuchadores)
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
    // 2. CAPTURA DE EXCEPCIONES Y ERRORES DE RUNTIME
    // =========================================================================
    const origConsoleError = console.error;
    console.error = function (...args) {
        const errorMsg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        diagState.consoleErrors.push({
            message: errorMsg,
            timestamp: Date.now(),
            activeObject: window.selectedItem ? window.selectedItem.id : null,
            stack: new Error().stack
        });
        return origConsoleError.apply(console, args);
    };

    window.addEventListener('error', function (e) {
        diagState.consoleErrors.push({
            message: `[Runtime Exception] ${e.message} en ${e.filename}:${e.lineno}:${e.colno}`,
            timestamp: Date.now(),
            activeObject: window.selectedItem ? window.selectedItem.id : null,
            stack: e.error ? e.error.stack : null
        });
    });

    window.addEventListener('unhandledrejection', function (e) {
        diagState.consoleErrors.push({
            message: `[Unhandled Promise Rejection] ${e.reason}`,
            timestamp: Date.now(),
            activeObject: window.selectedItem ? window.selectedItem.id : null,
            stack: e.reason && e.reason.stack ? e.reason.stack : null
        });
    });

    // =========================================================================
    // 3. SEGUIMIENTO DE CLICS PARA INTERRUPCIONES DE BOTÓN MUERTO
    // =========================================================================
    if (typeof window !== 'undefined') {
        window.addEventListener('mousedown', function (e) {
            diagState.lastMouseDownPoint = { x: e.clientX, y: e.clientY };
            const button = e.target.closest('button, .toolbar-btn, [id^="btnCtx"], [class*="btn"]');
            if (button) {
                const selector = getFriendlySelector(button);
                const isDead = !diagState.eventRegistry.has(selector) && !button.onclick;
                const isNativeFileUploader = button.id === 'btnAddSVG' || button.id === 'btnAddImage' || selector.includes('file');
                if (isDead && !isNativeFileUploader) {
                    const opId = `OP-${String(++diagState.opCounter).padStart(5, '0')}`;
                    diagState.operations.push({
                        id: opId,
                        type: 'CLICK_INTERRUPT',
                        timestamp: Date.now(),
                        status: 'WARNING',
                        source: selector,
                        args: [`text: "${button.textContent.trim()}"`],
                        inconsistencies: [`[⚠️ DEAD_ROUTE_CRITICAL] Se hizo clic en '${selector}' pero no tiene ningún callback o callback inactivo en el DOM.`]
                    });
                    rawConsole.warn(`[EKKO_DIAG] [DEAD_ROUTE_CRITICAL] Clic inerte detectado en: ${selector}`);
                }
            }
        }, { capture: true });
    }

    // =========================================================================
    // 4. INTERFAZ PÚBLICA DE CONTROL (BLACKBOX COMMANDS)
    // =========================================================================
    const publicAPI = {
        start: function () {
            diagState.active = true;
            diagState.consoleErrors = [];
            diagState.operations = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v23.0] Computador de Vuelo Activo 🟢 - Capturando telemetría.");
            return true;
        },
        stop: function () {
            diagState.active = false;
            rawConsole.log("[EKKO_DIAG v23.0] Suspendido 🔴.");
            return true;
        },
        clear: function () {
            diagState.consoleErrors = [];
            diagState.operations = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v23.0] Registros limpios.");
            return true;
        },

        // Métodos de comunicación interna para el motor de sinapsis
        getEventRegistry: function () {
            return diagState.eventRegistry;
        },
        getConsoleErrors: function () {
            return diagState.consoleErrors;
        },
        getOperations: function () {
            return diagState.operations;
        },

        // Registro del Motor Sináptico
        integrateSynapse: function (engine) {
            diagState.synapseEngine = engine;
            rawConsole.log("[EKKO_DIAG v23.0] Motor Sináptico de ADN acoplado con éxito 🟢");
            return true;
        },

        inspect: function () {
            if (diagState.synapseEngine) {
                rawConsole.log("[EKKO_DIAG] Redireccionando inspección al Motor Sináptico...");
                diagState.synapseEngine.scan().then(r => {
                    rawConsole.log("Estado de la Red Neuronal (Synapse):", r);
                });
            } else {
                rawConsole.warn("[EKKO_DIAG] Motor Sináptico no detectado. Cargando diagnóstico básico...");
                rawConsole.log({
                    active: diagState.active,
                    errorsCount: diagState.consoleErrors.length,
                    registeredSelectors: Array.from(diagState.eventRegistry.keys())
                });
            }
            return "Inspección iniciada...";
        },

        // UNIFICADO: Único comando requerido en F12
        copyErrors: function () {
            if (diagState.synapseEngine) {
                rawConsole.log("[EKKO_DIAG] Solicitando análisis de ADN asíncrono al Motor Sináptico...");
                diagState.synapseEngine.scan().then(reportObj => {
                    // Anexar telemetría en caliente de runtime
                    reportObj.runtimeErrors = diagState.consoleErrors;
                    reportObj.operationsLog = diagState.operations;

                    const reportString = JSON.stringify(reportObj, null, 4);
                    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(reportString).then(() => {
                            rawConsole.log("%c✓ ¡El mapa de ADN sináptico de EKKO Studio se copió automáticamente al portapapeles! Pégalo en tu chat con Gemini.", "color: #10b981; font-weight: bold; font-size: 13px;");
                        }).catch(err => {
                            rawConsole.error("Fallo de seguridad del navegador. Haz clic en el lienzo del Studio para enfocar la página y vuelve a ejecutar copyErrors().", err);
                        });
                    } else {
                        rawConsole.log("Portapapeles no disponible. Copie manualmente el siguiente objeto JSON impreso debajo:\n", reportString);
                    }
                });
            } else {
                rawConsole.warn("[EKKO_DIAG] Motor Sináptico no conectado. Generando reporte de runtime básico...");
                const reportString = JSON.stringify({
                    timestamp: Date.now(),
                    diagnosticVersion: "v23.0-Fallback",
                    runtimeErrors: diagState.consoleErrors,
                    operations: diagState.operations
                }, null, 4);
                if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(reportString).then(() => {
                        rawConsole.log("%c✓ ¡Reporte básico de runtime copiado al portapapeles! Pégalo en tu chat.", "color: #eab308; font-weight: bold;");
                    });
                } else {
                    rawConsole.log(reportString);
                }
            }
            return "Procesando diagnóstico...";
        }
    };

    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
        if (window.EKKO_SYNAPSE) {
            publicAPI.integrateSynapse(window.EKKO_SYNAPSE);
        }
    }
    return publicAPI;
}));
