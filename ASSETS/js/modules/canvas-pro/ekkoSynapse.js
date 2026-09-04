/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/ekkoSynapse.js
ACCIÓN: REEMPLAZAR ARCHIVO EXISTENTE E INICIALIZAR DESDE EL GRAFO DE IMPORTACIONES EN editor.js
ESTADO: ENTREGADO - VERSIÓN NEURONAL UNIVERSAL CONTEXTUAL v9.0 (UNIVERSAL SMOKE DETECTOR)
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js, api/synapse.js, editor.js
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoSynapse.js (v9.0 - Universal Contextual Core)
Descripción:
    El Detector de Humo Universal de EKKO Studio.
    Audita en tiempo de ejecución las 5 dimensiones sensoriales del Studio:
    1. CONTEXTO IMAGEN (Trazado, Recorte, Espejos y el nuevo Contorno/Offset estilo LightBurn)
    2. CONTEXTO TEXTO (Fuentes, Tamaño, Formato, Curvatura de Texto)
    3. CONTEXTO SVG/VECTORIAL (Agrupación y Operaciones Booleanas de Fusión)
    4. CONTEXTO MULTI-SELECCIÓN (Alineaciones y Distribuciones Canva-style)
    5. CONTROL DE PANEL SUPERIOR DINÁMICO (Word/Canva-style Dynamic Tabs)

    No solo reporta si los cables están cortados (DEAD_ROUTE_CRITICAL), sino que te
    avisa de inmediato si los botones/pestañas físicos NO existen en el HTML (MISSING_NODE_CRITICAL)
    o si están solapados visualmente en pantalla (Z_ORDER_COLLISION).
========================================================================= */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['EKKO_DIAG'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./ekkoDiagnostics'));
    } else {
        root.EKKO_SYNAPSE = factory(root.EKKO_DIAG);
    }
}(typeof window !== 'undefined' ? window : this, function (EKKO_DIAG) {

    const rawConsole = {
        log: (typeof console !== 'undefined' && console.log) ? console.log.bind(console) : () => {},
        warn: (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : () => {},
        error: (typeof console !== 'undefined' && console.error) ? console.error.bind(console) : () => {}
    };

    function cleanRelativePath(path) {
        if (!path) return '';
        let clean = path.replace(/^(https?:\/\/[^\/]+)?\//, '').split('?')[0];
        return clean;
    }

    async function scanCompleteRepository() {
        const synapseResult = {
            timestamp: Date.now(),
            engine: "EKKO Synapse Engine v9.0 (Universal Contextual Core)",
            status: "HEALTHY",
            counters: {
                totalScannedNodes: 0,
                totalLinesOfCode: 0,
                connectedSynapses: 0,
                brokenSynapses: 0,
                latentNeurons: 0
            },
            neurons: {
                active: [],     // Cargadas en memoria y activas en el lienzo
                latent: [],     // Cargadas en memoria pero pasivas (sin estímulo actual)
                missing: [],    // Faltantes en el disco físico (404 real)
                misaligned: [], // Recursos en rutas erróneas (ej. logo en /js/)
                collisions: []  // Duplicados físicos en disco (Clones Fantasma)
            },
            axons: {
                connected: [],     // Botones y callbacks enlazados perfectamente
                broken: [],        // Botones inactivos (DEAD_ROUTE_CRITICAL) o ausentes en HTML (MISSING_NODE_CRITICAL)
                zCollisions: [],   // Superposición de capas de interfaz (Z_ORDER_COLLISION)
                contextualState: { // Estado de los controladores en caliente
                    currentContext: "NONE",
                    activeSelectionCount: 0,
                    dynamicTabsActive: false
                }
            }
        };

        let diskFiles = [];
        let hasBackend = false;

        // 1. CONSULTA ASÍNCRONA AL BACKEND DE DISCO REAL
        try {
            const apiResponse = await fetch('/api/synapse', { method: 'GET', cache: 'no-store' });
            if (apiResponse.ok) {
                const apiData = await apiResponse.json();
                if (apiData.success && Array.isArray(apiData.files)) {
                    diskFiles = apiData.files;
                    hasBackend = true;
                    rawConsole.log(`[EKKO_SYNAPSE] Sincronización asíncrona v9.0 activa. Detectados ${diskFiles.length} archivos reales.`);
                }
            }
        } catch (err) {
            rawConsole.warn("[EKKO_SYNAPSE] Endpoint /api/synapse inaccesible. Modo de escaneo restringido al DOM.");
        }

        // 2. ESCANEO DEL DOM PARA IDENTIFICAR RECURSOS DECLARADOS
        const declaredDOMResources = [];
        if (typeof document !== 'undefined') {
            document.querySelectorAll('img, script, link[rel="stylesheet"]').forEach(el => {
                const src = el.getAttribute('src') || el.getAttribute('href');
                if (src) {
                    const cleanPath = cleanRelativePath(src);
                    const isExternal = src.startsWith('http') && !src.includes(window.location.host);
                    declaredDOMResources.push({
                        path: cleanPath,
                        rawUrl: src,
                        tag: el.tagName.toLowerCase(),
                        isExternal: isExternal
                    });
                }
            });
        }

        // 3. ANÁLISIS DE RUTAS Y VINCULACIÓN NEURONAL
        const fileNamesMap = new Map();
        const diskFilesMap = new Map();

        if (hasBackend) {
            diskFiles.forEach(file => {
                diskFilesMap.set(file.path, file);
                synapseResult.counters.totalLinesOfCode += (file.lines || 0);

                const fileName = file.path.substring(file.path.lastIndexOf('/') + 1);
                if (fileName) {
                    if (!fileNamesMap.has(fileName)) {
                        fileNamesMap.set(fileName, []);
                    }
                    fileNamesMap.get(fileName).push(file.path);
                }

                // Auditoría de desalineación
                const pathLower = file.path.toLowerCase();
                const isImage = pathLower.endsWith('.png') || pathLower.endsWith('.jpg') || pathLower.endsWith('.jpeg') || pathLower.endsWith('.svg');
                const isInJsFolder = pathLower.includes('assets/js/');
                if (isImage && isInJsFolder) {
                    synapseResult.neurons.misaligned.push({
                        file: file.path,
                        fileName: fileName,
                        type: "STRUCTURAL_MISALIGNMENT",
                        detail: `El archivo '${fileName}' es una imagen pero está guardado físicamente en la carpeta de JavaScript: '${file.path}'.`
                    });
                    synapseResult.status = "DEGRADED";
                }
            });

            synapseResult.counters.totalScannedNodes = diskFiles.length;

            declaredDOMResources.forEach(res => {
                if (res.isExternal) {
                    synapseResult.neurons.active.push({
                        file: res.rawUrl,
                        status: "EXTERNAL_CDN_ACTIVE",
                        detail: "Librería externa cargada correctamente desde red de distribución."
                    });
                    return;
                }

                const fileExistsOnDisk = diskFilesMap.has(res.path);
                if (!fileExistsOnDisk) {
                    synapseResult.neurons.missing.push({
                        file: res.path,
                        type: "BROKEN_SYNAPSE",
                        detail: `El archivo '${res.path}' está declarado en el HTML (${res.tag}) pero no existe en el disco local.`
                    });
                    synapseResult.counters.brokenSynapses++;
                    synapseResult.status = "CRITICAL";
                }
            });

            // Cruzar contra la RAM para evitar falsos unlinks (ES6 imports)
            diskFiles.forEach(file => {
                const ext = file.path.substring(file.path.lastIndexOf('.')).toLowerCase();
                if (ext !== '.js') return;

                const isRequestedByDOM = declaredDOMResources.some(res => res.path === file.path);
                const infoRAM = analyzeRAMStatus(file.path);

                if (isRequestedByDOM || infoRAM.isLoaded) {
                    if (infoRAM.isLoaded) {
                        if (infoRAM.isLatent) {
                            synapseResult.neurons.latent.push({
                                file: file.path,
                                lines: file.lines,
                                detail: "Script cargado e instanciado en RAM (vía ES6 o DOM), pero sus funciones están inactivas en el lienzo."
                            });
                            synapseResult.counters.latentNeurons++;
                        } else {
                            synapseResult.neurons.active.push({
                                file: file.path,
                                lines: file.lines
                            });
                        }
                    } else {
                        synapseResult.neurons.latent.push({
                            file: file.path,
                            status: "ORPHAN_IN_RAM",
                            detail: `El script '${file.path}' existe en disco pero sus constructores no están inicializados en Chrome.`
                        });
                        synapseResult.counters.latentNeurons++;
                    }
                } else {
                    synapseResult.neurons.latent.push({
                        file: file.path,
                        status: "UNLINKED_NEURON",
                        detail: `El script '${file.path}' existe en disco pero no está importado en index.html ni cargado en memoria.`
                    });
                    synapseResult.counters.latentNeurons++;
                }
            });
        }

        // Colisiones
        for (const [name, paths] of fileNamesMap.entries()) {
            if (paths.length > 1) {
                synapseResult.neurons.collisions.push({
                    fileName: name,
                    paths: paths,
                    type: "AMBIGUOUS_ROUTE_COLLISION",
                    detail: `Se detectó el archivo '${name}' duplicado en múltiples rutas físicas de tu disco: [${paths.join(', ')}].`
                });
                synapseResult.status = "DEGRADED";
            }
        }

        // =========================================================================
        // 4. DETECTOR DE HUMO UNIVERSAL: AUDITORÍA DE AXONES DE CONTEXTOS MULTI-ZONA
        // =========================================================================
        if (typeof document !== 'undefined') {
            const expectedUiButtons = [
                // A. CONTEXTO IMAGEN (Filtros, vectorizado, máscaras y contorno LightBurn)
                { id: "btnCtxTrace", label: "🪄 Trazar Imagen", context: "IMAGE" },
                { id: "btnCtxApplyMask", label: "✂️ Recortar Imagen", context: "IMAGE" },
                { id: "btnCtxRemoveMask", label: "🔓 Quitar Recorte", context: "IMAGE" },
                { id: "btnCtxFlipH", label: "↔️ Espejo Horizontal Imagen", context: "IMAGE" },
                { id: "btnCtxFlipV", label: "↕️ Espejo Vertical Imagen", context: "IMAGE" },
                { id: "btnCtxContour", label: "🎯 Aplicar Contorno/Offset (LightBurn style)", context: "IMAGE" },

                // B. CONTEXTO TEXTO (Formatos, tipografías y curvatura de texto)
                { id: "ctxFontSelector", label: "🔤 Selector de Fuentes", context: "TEXT" },
                { id: "ctxFontSize", label: "📏 Tamaño de Fuente (Input)", context: "TEXT" },
                { id: "btnCtxBold", label: "<b> Negrita", context: "TEXT" },
                { id: "btnCtxItalic", label: "<i> Cursiva", context: "TEXT" },
                { id: "btnCtxUnderline", label: "<u> Subrayado", context: "TEXT" },
                { id: "ctxTextCurvature", label: "↩️ Curvatura de Texto (Curved Path Slider)", context: "TEXT" },

                // C. CONTEXTO SVG / VECTORIAL (Operaciones Booleanas y unión de nodos)
                { id: "btnCtxGroup", label: "📦 Agrupar Elementos SVG", context: "SVG" },
                { id: "btnCtxUngroup", label: "🔓 Desagrupar Elementos SVG", context: "SVG" },
                { id: "btnCtxBooleanUnion", label: "➕ Unión Booleana SVG (Fusión)", context: "SVG" },
                { id: "btnCtxBooleanSubtract", label: "➖ Sustracción Booleana SVG", context: "SVG" },

                // D. CONTEXTO SELECCIÓN MÚLTIPLE (Alineaciones y Distribuciones Canva/Word style)
                { id: "btnAlignLeft", label: "⬅️ Alineación Izquierda Múltiple", context: "MULTI" },
                { id: "btnAlignCenter", label: "center-h Alineación Centro Horizontal Múltiple", context: "MULTI" },
                { id: "btnAlignRight", label: "➡️ Alineación Derecha Múltiple", context: "MULTI" },
                { id: "btnAlignTop", label: "⬆️ Alineación Superior Múltiple", context: "MULTI" },
                { id: "btnAlignMiddle", label: "center-v Alineación Centro Vertical Múltiple", context: "MULTI" },
                { id: "btnAlignBottom", label: "⬇️ Alineación Inferior Múltiple", context: "MULTI" },
                { id: "btnDistributeH", label: "↔️ Distribución Horizontal Equitativa", context: "MULTI" },
                { id: "btnDistributeV", label: "↕️ Distribución Vertical Equitativa", context: "MULTI" },

                // E. CONTEXTO PANEL SUPERIOR DINÁMICO (Word/Canva-style Dynamic Tabs / Pestañas)
                { id: "tabImageTools", label: "🖼️ Pestaña de Herramientas de Imagen", context: "DYNAMIC_PANEL" },
                { id: "tabTextTools", label: "✍️ Pestaña de Herramientas de Texto", context: "DYNAMIC_PANEL" },
                { id: "tabSvgTools", label: "📐 Pestaña de Herramientas de SVG/Vectorial", context: "DYNAMIC_PANEL" },
                { id: "tabMultiTools", label: "👥 Pestaña de Selección Múltiple", context: "DYNAMIC_PANEL" }
            ];

            const eventRegistry = (window.EKKO_DIAG && typeof window.EKKO_DIAG.getEventRegistry === 'function')
                ? window.EKKO_DIAG.getEventRegistry()
                : new Map();

            expectedUiButtons.forEach(btn => {
                const domElement = document.getElementById(btn.id);
                const selector = `#${btn.id}`;

                if (!domElement) {
                    // ALARMA AUTOMÁTICA: El nodo no existe en el HTML
                    synapseResult.axons.broken.push({
                        id: btn.id,
                        label: btn.label,
                        context: btn.context,
                        type: "MISSING_NODE_CRITICAL",
                        detail: `El componente '${btn.label}' (${selector}) no existe físicamente en tu HTML. Tienes que declararlo para habilitar su contexto.`
                    });
                    synapseResult.counters.brokenSynapses++;
                    synapseResult.status = "CRITICAL";
                    return;
                }

                // El elemento existe en el HTML. ¿Tiene cable de JS soldado?
                const hasActiveListener = eventRegistry.has(selector) ||
                                          domElement.onclick ||
                                          domElement.onchange ||
                                          domElement.oninput;

                if (hasActiveListener) {
                    synapseResult.axons.connected.push({
                        id: btn.id,
                        label: btn.label,
                        context: btn.context,
                        status: "SYNAPSE_CONNECTED",
                        detail: `Conexión fuerte. El elemento '${btn.label}' está enlazado a su callback de JS.`
                    });
                    synapseResult.counters.connectedSynapses++;
                } else {
                    // ALARMA AUTOMÁTICA: El nodo está sordo (sin callback)
                    synapseResult.axons.broken.push({
                        id: btn.id,
                        label: btn.label,
                        context: btn.context,
                        type: "DEAD_ROUTE_CRITICAL",
                        detail: `El componente '${btn.label}' (${selector}) existe físicamente pero su cable de lógica está ROTA (sin callback de JS conectado).`
                    });
                    synapseResult.counters.brokenSynapses++;
                    synapseResult.status = "CRITICAL";
                }
            });

            // Capturar en caliente el estado contextual activo en tu lienzo de Paper.js
            if (typeof paper !== 'undefined' && paper.project) {
                const selectedItems = paper.project.selectedItems || [];
                synapseResult.axons.contextualState.activeSelectionCount = selectedItems.length;

                if (selectedItems.length === 1) {
                    const tgt = selectedItems[0];
                    if (tgt.className === 'Raster') {
                        synapseResult.axons.contextualState.currentContext = "IMAGE";
                    } else if (tgt.className === 'PointText') {
                        synapseResult.axons.contextualState.currentContext = "TEXT";
                    } else if (tgt.className === 'Path' || tgt.className === 'CompoundPath' || tgt.className === 'Group') {
                        synapseResult.axons.contextualState.currentContext = "SVG";
                    }
                } else if (selectedItems.length > 1) {
                    synapseResult.axons.contextualState.currentContext = "MULTI";
                }

                // ¿Están las pestañas de Canva/Word activas en el DOM?
                const tabContainer = document.getElementById('topBar') || document.getElementById('pro-layout-toolbar');
                if (tabContainer) {
                    synapseResult.axons.contextualState.dynamicTabsActive = true;
                }
            }
        }

        // =========================================================================
        // 5. AUDITORÍA DE COLISIONES Z-ORDER (BARRA CONTRA REGLAS)
        // =========================================================================
        if (typeof document !== 'undefined') {
            const toolbar = document.getElementById('contextual-toolbar');
            const rulerTop = document.getElementById('ekko-ruler-top');
            const rulerLeft = document.getElementById('ekko-ruler-left');

            if (toolbar && (rulerTop || rulerLeft)) {
                const tStyle = window.getComputedStyle(toolbar);
                const tZ = parseInt(tStyle.zIndex) || 0;

                const rulerStyle = rulerTop ? window.getComputedStyle(rulerTop) : window.getComputedStyle(rulerLeft);
                const rZ = parseInt(rulerStyle.zIndex) || 0;

                if (tZ <= rZ) {
                    synapseResult.axons.zCollisions.push({
                        toolbarZIndex: tZ,
                        rulerZIndex: rZ,
                        type: "Z_ORDER_COLLISION",
                        detail: `La barra contextual (#contextual-toolbar, z-index: ${tZ}) posee un nivel de apilamiento inferior o igual a las reglas de la interfaz (z-index: ${rZ}). La barra se renderizará físicamente oculta por debajo de las reglas.`
                    });
                    synapseResult.status = "CRITICAL";
                }
            }
        }

        // =========================================================================
        // 6. AUDITORÍA DE DEGRADACIÓN GEOMÉTRICA (COTAS CORRIDAS)
        // =========================================================================
        if (typeof paper !== 'undefined' && paper.project) {
            const selectedItems = paper.project.selectedItems || [];
            selectedItems.forEach(item => {
                const b = item.bounds;
                if (!b || typeof b.width !== 'number' || isNaN(b.width) || typeof b.height !== 'number' || isNaN(b.height) || b.constructor.name === 'Point') {
                    synapseResult.axons.broken.push({
                        id: item.id,
                        className: item.className,
                        type: "CRITICAL_BOUNDS_CORRUPTION",
                        detail: `El elemento seleccionado ID: ${item.id} (${item.className}) devolvió límites corruptos de clase '${b ? b.constructor.name : "null"}'. Las cotas de mm flotarán corridas.`
                    });
                    synapseResult.status = "CRITICAL";
                }
            });
        }

        // =========================================================================
        // 7. CONTROL DE CACHÉ DE MEMORIA RAM (CACHE_DESYNC)
        // =========================================================================
        if (typeof window.initSmartFusionListeners === 'function') {
            const funcStr = window.initSmartFusionListeners.toString();
            const memVerMatch = funcStr.match(/v\d+\.\d+/);
            const memVer = memVerMatch ? memVerMatch[0] : 'v45.6';
            const expectedVer = 'v45.11';
            if (memVer !== expectedVer) {
                synapseResult.neurons.missing.push({
                    file: "smartFusion.js",
                    type: "CACHE_DESYNC",
                    detail: `Diferencia de caché detectada. Chrome está ejecutando la versión '${memVer}' en memoria, pero el editor físico de disco espera la versión '${expectedVer}'.`
                });
                synapseResult.status = "DEGRADED";
            }
        }

        return synapseResult;
    }

    function analyzeRAMStatus(route) {
        const info = {
            isLoaded: false,
            isLatent: false
        };

        if (route.endsWith('smartFusion.js')) {
            info.isLoaded = typeof window.initSmartFusionListeners === 'function';
            if (info.isLoaded && typeof paper !== 'undefined' && paper.project) {
                const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
                const hasActiveFusion = designLayer ? designLayer.children.some(c => c.data && c.data.isSmartFusion) : false;
                if (!hasActiveFusion) info.isLatent = true;
            }
        } else if (route.endsWith('geometricUngroup.js')) {
            info.isLoaded = typeof window.recalculateDynamicSubtractions === 'function';
            if (info.isLoaded && typeof paper !== 'undefined' && paper.project) {
                const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
                const hasClipGroup = designLayer ? designLayer.children.some(c => c.data && c.data.clipGroup) : false;
                if (!hasClipGroup) info.isLatent = true;
            }
        } else if (route.endsWith('selection.js')) {
            info.isLoaded = typeof window.selectItem === 'function';
        } else if (route.endsWith('contextualMenu.js')) {
            info.isLoaded = typeof window.updateContextualMenu === 'function' || typeof window.renderContextualMenu === 'function';
        } else if (route.endsWith('ekkoDiagnostics.js')) {
            info.isLoaded = typeof window.EKKO_DIAG === 'object';
        } else if (route.endsWith('ekkoSynapse.js')) {
            info.isLoaded = true;
        } else {
            info.isLoaded = true;
        }

        return info;
    }

    const synapseAPI = {
        scan: scanCompleteRepository
    };

    if (typeof window !== 'undefined') {
        window.EKKO_SYNAPSE = synapseAPI;
        if (window.EKKO_DIAG && typeof window.EKKO_DIAG.integrateSynapse === 'function') {
            window.EKKO_DIAG.integrateSynapse(synapseAPI);
            rawConsole.log("[EKKO_SYNAPSE v9.0] Conexión establecida con el Computador de Vuelo EKKO_DIAG 🟢");
        } else {
            rawConsole.log("[EKKO_SYNAPSE v9.0] Registrado en memoria global. Esperando acoplamiento... 🟡");
        }
    }

    return synapseAPI;
}));
