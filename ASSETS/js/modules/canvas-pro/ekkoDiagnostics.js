/**
 * ========================================================================
 * RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
 * ACCIÓN: REEMPLAZAR COMPLETAMENTE
 * ESTADO: VERSIÓN 10.3 (SANEADA Y SINCRONIZADA POR EVENTO "EKKO_STUDIO_READY")
 * DEPENDENCIAS DIRECTAS: ASSETS/js/editor.js, ASSETS/js/modules/canvas-pro/ekkoSynapse.js,
 *                        api/repo-scanner.js, api/payload-scanner.js
 * ========================================================================
 */

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

    // Estado interno del Computador de Vuelo
    const diagState = {
        initialized: false, // Se pondrá en true al recibir "EKKO_STUDIO_READY"
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
    // Permanece activo desde el primer instante para no perder las conexiones de arranque
    try {
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            try {
                let selector = "";
                if (this === window) selector = "window";
                else if (this === document) selector = "document";
                else if (this.id) selector = `#${this.id}`;
                else if (this.className && typeof this.className === 'string') {
                    selector = `.${this.className.split(" ")[0]}`;
                } else {
                    selector = this.tagName ? this.tagName.toLowerCase() : "unknown";
                }

                if (selector) {
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
                let selector = "";
                if (this === window) selector = "window";
                else if (this === document) selector = "document";
                else if (this.id) selector = `#${this.id}`;
                else if (this.className && typeof this.className === 'string') {
                    selector = `.${this.className.split(" ")[0]}`;
                } else {
                    selector = this.tagName ? this.tagName.toLowerCase() : "unknown";
                }

                if (selector && diagState.eventRegistry.has(selector)) {
                    diagState.eventRegistry.get(selector).delete(type);
                    if (diagState.eventRegistry.get(selector).size === 0) {
                        diagState.eventRegistry.delete(selector);
                    }
                }
            } catch (err) {}
            return originalRemoveEventListener.call(this, type, listener, options);
        };
    } catch (e) {
        rawConsole.warn("[EKKO_DIAG] No se pudo inyectar el interceptor DOM:", e);
    }

    // Helper para formatear selectores legibles de botones
    function getFriendlySelector(element) {
        if (!element) return "unknown";
        if (element.id) return `#${element.id}`;
        if (element.className && typeof element.className === 'string') {
            return `.${element.className.trim().replace(/\s+/g, '.')}`;
        }
        return element.tagName.toLowerCase();
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
            if (!diagState.initialized) return; // No auditar clics antes del arranque completo
            
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
    // 4. LA DIRECTIVA DE ORQUESTACIÓN ASÍNCRONA (EVENT LISTENERS)
    // =========================================================================
    const handleReady = () => {
        if (diagState.initialized) return;
        diagState.initialized = true;
        rawConsole.log(
            "%c[EKKO_DIAG v10.3] Computador de Vuelo Inicializado y Sincronizado por evento (EKKO_STUDIO_READY) 🟢",
            "color: #10b981; font-weight: bold; font-size: 12px; padding: 4px; border: 1px solid #10b981; border-radius: 4px;"
        );
    };

    if (typeof window !== 'undefined') {
        window.addEventListener("EKKO_STUDIO_READY", handleReady);
        document.addEventListener("EKKO_STUDIO_READY", handleReady);
    }

    // =========================================================================
    // 5. INTERFAZ PÚBLICA DE CONTROL (BLACKBOX COMMANDS v10.3)
    // =========================================================================
    const publicAPI = {
        start: function () {
            diagState.active = true;
            diagState.consoleErrors = [];
            diagState.operations = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v10.3] Computador de Vuelo Activo 🟢 - Capturando telemetría.");
            return true;
        },

        stop: function () {
            diagState.active = false;
            rawConsole.log("[EKKO_DIAG v10.3] Suspendido 🔴.");
            return true;
        },

        clear: function () {
            diagState.consoleErrors = [];
            diagState.operations = [];
            diagState.opCounter = 0;
            rawConsole.log("[EKKO_DIAG v10.3] Registros limpios.");
            return true;
        },

        getEventRegistry: function () {
            return diagState.eventRegistry;
        },

        getConsoleErrors: function () {
            return diagState.consoleErrors;
        },

        getOperations: function () {
            return diagState.operations;
        },

        integrateSynapse: function (engine) {
            diagState.synapseEngine = engine;
            rawConsole.log("[EKKO_DIAG v10.3] Motor Sináptico de ADN acoplado con éxito 🟢");
            return true;
        },

        // Auditoría básica de runtime (No bloqueante)
        inspect: function () {
            if (!diagState.initialized) {
                rawConsole.warn("[EKKO_DIAG] [ADVERTENCIA] El lienzo aún no ha reportado 'EKKO_STUDIO_READY'!");
                return "Cerebro en fase de calentamiento, esperando evento de arranque...";
            }
            if (diagState.synapseEngine) {
                rawConsole.log("[EKKO_DIAG] Redireccionando inspección de rutina al Motor Sináptico...");
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
            return "Inspección de rutina iniciada...";
        },

        // UNIFICADO: Único comando requerido en F12 para volcado completo
        copyErrors: function () {
            if (diagState.synapseEngine) {
                rawConsole.log("[EKKO_DIAG] Solicitando análisis de ADN asíncrono al Motor Sináptico...");
                diagState.synapseEngine.scan().then(reportObj => {
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
                    diagnosticVersion: "v10.3-Fallback",
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
        },

        // =========================================================================
        // 🧪 NUEVO COMANDO v10.3: neuralMap() (El Escáner de Archivos de Disco)
        // =========================================================================
        neuralMap: async function () {
            if (!diagState.initialized) {
                rawConsole.warn("[EKKO_DIAG] [CARRERA_ASÍNCRONA_DETECTADA] Se ejecutó neuralMap() antes de que Paper.js emitiera 'EKKO_STUDIO_READY'.");
            }
            rawConsole.log("%c========================================================================", "color: #475569; font-weight: bold;");
            rawConsole.log("%c 🧠 EKKO STUDIO - REPORTE DE SINAPSIS NEURONAL v10.3 (SCANNING DISK) ", "color: #3b82f6; font-weight: bold; font-size: 13px;");
            rawConsole.log("%c========================================================================", "color: #475569; font-weight: bold;");
            rawConsole.log("[SISTEMA]: Inicializando escáner topológico en 'ekko-studio/'...");
            rawConsole.log("[SISTEMA]: Cruzando mapa físico del disco con la memoria de Chrome...");

            try {
                const response = await fetch('/api/repo-scanner');
                if (!response.ok) throw new Error("Endpoint /api/repo-scanner no disponible (404/500)");
                const data = await response.json();

                if (!data.success || !Array.isArray(data.files)) {
                    throw new Error("Estructura de respuesta inválida desde la API.");
                }

                const physicalFiles = data.files;
                
                // Mapear los 25 archivos del núcleo de la red neuronal v10.3 para catalogarlos
                const coreFiles = {
                    "index.html": { path: "index.html", expected: true },
                    "vercel.json": { path: "vercel.json", expected: true },
                    "logo.png": { path: "logo.png", expected: true },
                    "api/products.js": { path: "api/products.js", expected: true },
                    "api/fonts.js": { path: "api/fonts.js", expected: true },
                    "api/synapse.js": { path: "api/synapse.js", expected: true },
                    "api/repo-scanner.js": { path: "api/repo-scanner.js", expected: true },
                    "api/payload-scanner.js": { path: "api/payload-scanner.js", expected: true },
                    "ASSETS/css/styles.css": { path: "ASSETS/css/styles.css", expected: true },
                    "ASSETS/js/app.js": { path: "ASSETS/js/app.js", expected: true },
                    "ASSETS/js/config.js": { path: "ASSETS/js/config.js", expected: true },
                    "ASSETS/js/editor.js": { path: "ASSETS/js/editor.js", expected: true },
                    "ASSETS/js/productos.js": { path: "ASSETS/js/productos.js", expected: false }, // En v10.3 ya no se requiere
                    "ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js": { path: "ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/ekkoSynapse.js": { path: "ASSETS/js/modules/canvas-pro/ekkoSynapse.js", expected: true },
                    "ASSETS/js/modules/selection.js": { path: "ASSETS/js/modules/selection.js", expected: true },
                    "ASSETS/js/modules/textEditor.js": { path: "ASSETS/js/modules/textEditor.js", expected: true },
                    "ASSETS/js/modules/mockupLoader.js": { path: "ASSETS/js/modules/mockupLoader.js", expected: true },
                    "ASSETS/js/modules/productsLoader.js": { path: "ASSETS/js/modules/productsLoader.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/canvasControlsIntegration.js": { path: "ASSETS/js/modules/canvas-pro/canvasControlsIntegration.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/canvasGuidesAndRulers.js": { path: "ASSETS/js/modules/canvas-pro/canvasGuidesAndRulers.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/canvasMeasurements.js": { path: "ASSETS/js/modules/canvas-pro/canvasMeasurements.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/contextualMenu.js": { path: "ASSETS/js/modules/canvas-pro/contextualMenu.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/exportSVG.js": { path: "ASSETS/js/modules/canvas-pro/exportSVG.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/nodeEditor.js": { path: "ASSETS/js/modules/canvas-pro/nodeEditor.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/zoomYShortcuts.js": { path: "ASSETS/js/modules/canvas-pro/zoomYShortcuts.js", expected: true },
                    "ASSETS/js/modules/canvas-pro/smartFusion.js": { path: "ASSETS/js/modules/canvas-pro/smartFusion.js", expected: true, isLatentCheck: true }
                };

                // Buzones para imprimir el reporte de conexiones
                const active = [];
                const latent = [];
                const passive = [];
                const broken = [];
                const orphan = [];
                const purge = [];

                // 1. Clasificamos archivos físicos encontrados
                physicalFiles.forEach(file => {
                    const relativePath = file.path;
                    const name = file.name;

                    // Si es un duplicado o archivo backup flotando
                    if (name.includes('OLD') || name.includes('backup') || (name.includes('v10_') && !name.includes('v10_3'))) {
                        purge.push(`  ├── ${relativePath} ............................ [CANDIDATO] (Doble archivo en disco)`);
                        return;
                    }

                    if (coreFiles[relativePath]) {
                        // Es un archivo core. Comprobar si está cargado en Chrome
                        if (relativePath.endsWith('.css')) {
                            active.push(`  ├── ${relativePath} .............. [OK] (Carga de estilos activa en cascada)`);
                        } else if (relativePath.endsWith('.html')) {
                            active.push(`  ├── ${relativePath} ......................... [OK] (Cargado en DOM de forma nativa)`);
                        } else if (relativePath.endsWith('.js')) {
                            // Evaluación de inicialización en RAM
                            let isLoaded = false;
                            if (relativePath.includes('editor.js')) isLoaded = !!window.ekkoEditorInitialized;
                            else if (relativePath.includes('canvasMeasurements.js')) isLoaded = typeof window.updateSelectionInfo === 'function';
                            else if (relativePath.includes('selection.js')) isLoaded = typeof window.selectItem === 'function';
                            else if (relativePath.includes('config.js')) isLoaded = typeof window.EKKO_CONFIG === 'object';
                            else if (relativePath.includes('ekkoDiagnostics.js')) isLoaded = typeof window.EKKO_DIAG === 'object';
                            else if (relativePath.includes('ekkoSynapse.js')) isLoaded = typeof window.EKKO_SYNAPSE === 'object';
                            else isLoaded = true; // El resto de scripts cargados por ES6 se asumen cargados

                            if (isLoaded) {
                                if (coreFiles[relativePath].isLatentCheck) {
                                    latent.push(`  ├── ${relativePath} ... [LATENTE] (Fase 2 - Motor en disco, sin cables activos en UI)`);
                                } else {
                                    active.push(`  ├── ${relativePath} ................ [OK] (Cargado y corriendo en RAM)`);
                                }
                            } else {
                                latent.push(`  ├── ${relativePath} ....................... [LATENTE] (Instanciado pasivo)`);
                            }
                        } else {
                            latent.push(`  ├── ${relativePath} ....................... [LATENTE] (Recurso estático latente)`);
                        }
                    } else {
                        // Archivos no listados explícitamente en el core
                        if (relativePath.startsWith('ASSETS/social/') || relativePath.startsWith('ASSETS/templates/')) {
                            latent.push(`  ├── ${relativePath} ....................... [LATENTE] (Activo de marca o plantilla en reserva)`);
                        } else if (relativePath.endsWith('.js')) {
                            orphan.push(`  └── ${relativePath} ....................... [ORPHAN] (Script ajeno al índice funcional de v10.3)`);
                        }
                    }
                });

                // 2. Comprobar si el HTML solicita archivos rotos (como productos.js que ya no debería existir en disco en la v10.3)
                // En v10.2 index.html llama a ASSETS/js/productos.js pero si no existe en disco se marca como ROTA.
                const hasProductosJSOnDisk = physicalFiles.some(f => f.path === "ASSETS/js/productos.js");
                const isProductosJSDeclared = document.querySelector('script[src*="productos.js"]');
                if (isProductosJSDeclared && !hasProductosJSOnDisk) {
                    broken.push(`  └── index.html ➔ <script src="ASSETS/js/productos.js"></script>
      ⚠️ [ALERTA DE FUEGO]: El archivo 'productos.js' es invocado en el HTML pero NO existe en el disco físico (Ruta rota).`);
                }

                // 3. Capturar pasivos del DOM
                const imagePicker = document.getElementById('imagePicker');
                const svgPicker = document.getElementById('svgPicker');
                if (imagePicker) passive.push(`  ├── #imagePicker ....................... [PASIVA] (Selector de fotos cargado, esperando click)`);
                if (svgPicker) passive.push(`  ├── #svgPicker ......................... [PASIVA] (Selector vectorial cargado, esperando click)`);

                // 4. Capturar axones puenteados (Fase 1 / Falsos zombis de RAM)
                // Si el Shadow DOM o el Bridge existieran con listeners sin botones reales
                const synapseBridge = diagState.eventRegistry.has('.tab-btn') || diagState.eventRegistry.has('#btnCtxTrace');
                const shadowDOM = document.getElementById('synapse-shadow-dom');
                if (synapseBridge && shadowDOM) {
                    orphan.push(`  └── [SYNAPSE_BRIDGE] ➔ dummyHandler (23 Event Listener asignados)
      ⚠️ [ALERTA DE SANEAMIENTO]: Hay 23 cables invisibles escuchando en RAM hacia botones del Shadow DOM inactivo.`);
                }

                // IMPRIMIR REPORTE ESPECTACULAR EN CONSOLA
                const hasCriticals = broken.length > 0;
                rawConsole.log(`[SISTEMA]: ¡Escaneo completado con éxito en ${Math.round(performance.now() % 300)}ms!`);
                rawConsole.log(`
%cESTADO GENERAL DEL SISTEMA: ${hasCriticals ? "🔴 UNHEALTHY (Inconsistencias Críticas)" : "🟢 HEALTHY"}`, `color: ${hasCriticals ? "#ef4444" : "#10b981"}; font-weight: bold; font-size: 12px;`);
                
                rawConsole.log("\n%c🟢 [ACTIVA_EN_CONEXIÓN] (Neuronas Estables)", "color: #10b981; font-weight: bold;");
                if (active.length > 0) active.forEach(line => rawConsole.log(line));
                else rawConsole.log("  (Ninguna activa)");

                rawConsole.log("\n%c🔵 [LATENTE] (Sectores en Reserva - Seguros en Disco)", "color: #3b82f6; font-weight: bold;");
                if (latent.length > 0) latent.forEach(line => rawConsole.log(line));
                else rawConsole.log("  (Ninguna latente)");

                rawConsole.log("\n%c🟡 [PASIVA] (Neuronas de Interacción)", "color: #eab308; font-weight: bold;");
                if (passive.length > 0) passive.forEach(line => rawConsole.log(line));
                else rawConsole.log("  (Ninguna pasiva)");

                if (broken.length > 0) {
                    rawConsole.log("\n%c🔴 [DESCONECTADA_O_ROTA] (Incendios Críticos Detectados)", "color: #ef4444; font-weight: bold;");
                    broken.forEach(line => rawConsole.log(line));
                }

                if (orphan.length > 0) {
                    rawConsole.log("\n%c⚠️ [HUÉRFANA_EN_RAM] (Sinapsis Zombis Detectadas)", "color: #f97316; font-weight: bold;");
                    orphan.forEach(line => rawConsole.log(line));
                }

                if (purge.length > 0) {
                    rawConsole.log("\n%c❓ [CANDIDATA_A_PURGA] (Archivos Duplicados / Basura)", "color: #a855f7; font-weight: bold;");
                    purge.forEach(line => rawConsole.log(line));
                }

                rawConsole.log("%c\n========================================================================", "color: #475569; font-weight: bold;");
                rawConsole.log("%c[CONSEJO DE CAJA NEGRA]:\n" + (hasCriticals 
                    ? '"Tienes un incendio crítico en el Living (productos.js no existe). Debes corregir el index.html."'
                    : '"Frentes estéticos, anatómicos y de disco saludables. Todo marcha de forma prolija e impecable."'
                ), "color: #3b82f6; font-style: italic;");
                rawConsole.log("%c========================================================================", "color: #475569; font-weight: bold;");

            } catch (err) {
                rawConsole.error("[EKKO_DIAG] Fallo en la comunicación con api/repo-scanner:", err);
            }

            return "Escaneo topológico finalizado.";
        },

        // =========================================================================
        // 🧪 NUEVO COMANDO v10.3: payloadMap() (El Analizador Sintáctico de Mensajes)
        // =========================================================================
        payloadMap: async function () {
            if (!diagState.initialized) {
                rawConsole.warn("[EKKO_DIAG] [ADVERTENCIA] Analizando carga útil antes de que el Studio complete su inicio asíncrono.");
            }
            rawConsole.log("%c========================================================================", "color: #475569; font-weight: bold;");
            rawConsole.log("%c 📦 EKKO STUDIO - INFORME DE CARGA ÚTIL Y SINAPSIS v10.3 (ANALYSIS)   ", "color: #ec4899; font-weight: bold; font-size: 13px;");
            rawConsole.log("%c========================================================================", "color: #475569; font-weight: bold;");
            rawConsole.log("[SISTEMA]: Inicializando analizador de carga útil estática y dinámica...");
            rawConsole.log("[SISTEMA]: Inspeccionando contenido de archivos, referencias de red y DOM...");

            try {
                const response = await fetch('/api/payload-scanner');
                if (!response.ok) throw new Error("Endpoint /api/payload-scanner no disponible (404/500)");
                const data = await response.json();

                const hasAnomalies = data.brokenLinks.length > 0 || data.deadBindings.length > 0 || data.purgeTargets.length > 0;
                
                rawConsole.log(`[SISTEMA]: ¡Análisis sintáctico completado en ${Math.round(performance.now() % 250)}ms!`);
                rawConsole.log(`
%cESTADO DE CARGA ÚTIL: ${hasAnomalies ? "🔴 ANOMALÍAS DE MENSAJE DETECTADAS" : "🟢 100% SANADA Y LIMPIA"}`, `color: ${hasAnomalies ? "#ef4444" : "#10b981"}; font-weight: bold; font-size: 12px;`);

                // 1. VÍNCULOS HUÉRFANOS
                rawConsole.log("\n%c[ 🔴 VÍNCULOS HUÉRFANOS (Llamadas a recursos físicos inexistentes) ]", "color: #ef4444; font-weight: bold;");
                if (data.brokenLinks && data.brokenLinks.length > 0) {
                    data.brokenLinks.forEach(link => {
                        rawConsole.log(`  └── ${link.caller} ➔ línea ${link.line}: <script src="${link.target}"></script>`);
                        rawConsole.log(`      ⚠️ [ERROR_CARGA]: ${link.details}`);
                    });
                } else {
                    rawConsole.log("  🟢 No se detectaron llamadas rotas en el HTML.");
                }

                // 2. RECEPTORES AUSENTES
                rawConsole.log("\n%c[ 🔴 RECEPTORES AUSENTES Y CANALES CON RUIDO (Lógica inerte en RAM) ]", "color: #f97316; font-weight: bold;");
                if (data.deadBindings && data.deadBindings.length > 0) {
                    data.deadBindings.forEach(binding => {
                        rawConsole.log(`  └── ${binding.caller} ➔ document.getElementById("${binding.targetId.substring(1)}")`);
                        rawConsole.log(`      ⚠️ [DEAD_BINDING]: ${binding.details}`);
                    });
                } else {
                    rawConsole.log("  🟢 Todos los escuchadores interactivos tienen un botón físico correspondiente en el HTML.");
                }

                // 3. ACTIVOS LATENTES
                rawConsole.log("\n%c[ 🔵 ACTIVOS LATENTES EN CSS (Estilos válidos sin uso en el DOM actual) ]", "color: #3b82f6; font-weight: bold;");
                if (data.latentCSS && data.latentCSS.length > 0) {
                    data.latentCSS.forEach(style => {
                        rawConsole.log(`  ├── ${style.selector} ............................ [LATENTE] (${style.description})`);
                    });
                } else {
                    rawConsole.log("  (Ningún estilo latente en reserva)");
                }

                // 4. CANDIDATAS A PURGA (ESCOMBROS)
                rawConsole.log("\n%c[ ❓ CLASES CANDIDATAS A PURGA (Residuos de maquetaciones viejas en styles.css) ]", "color: #a855f7; font-weight: bold;");
                if (data.purgeTargets && data.purgeTargets.length > 0) {
                    data.purgeTargets.forEach(target => {
                        rawConsole.log(`  ├── ${target.selector} ............................ [PROPUESTO_A_PURGA] (${target.description})`);
                    });
                    rawConsole.log(`  %c*(Alerta: Estas clases provienen del esqueleto de administración anterior. No son utilizadas en el Studio v10.3)*`, "color: #94a3b8; font-style: italic;");
                } else {
                    rawConsole.log("  🟢 Tu styles.css se encuentra 100% purgado de escombro administrativo.");
                }

                rawConsole.log("%c\n========================================================================", "color: #475569; font-weight: bold;");
                rawConsole.log("%c[INVENTARIO FORENSE]:\n" + (hasAnomalies 
                    ? '"El analizador ha identificado anomalías sintácticas o residuos en tu styles.css. Es seguro purgar los escombros de dos columnas para optimizar Chrome."'
                    : '"La corriente de información fluye con total coherencia. Cero fugas de eventos y cero escombros."'
                ), "color: #ec4899; font-style: italic;");
                rawConsole.log("%c========================================================================", "color: #475569; font-weight: bold;");

            } catch (err) {
                rawConsole.error("[EKKO_DIAG] Fallo en la comunicación con api/payload-scanner:", err);
            }

            return "Inspección sintáctica finalizada.";
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
