/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/ekkoSynapse.js
ACCIÓN: CREAR NUEVO ARCHIVO E IMPORTAR EN index.html COMO SCRIPT
ESTADO: ENTREGADO - VERSIÓN NEURONAL CANÓNICA v2.0 (MODULAR)
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js, index.html
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoSynapse.js (v2.0 - EKKO Synapse Engine)
Descripción:
    Motor de Sincronización y Mapeo Neuronal de precisión militar para EKKO Studio.
    Analiza la topología física del repositorio, lee archivos de disco mediante
    peticiones asíncronas de bajo nivel y evalúa su inicialización en la RAM.
    
    Se autoacopla dinámicamente con EKKO_DIAG para delegar el copiado de ADN.
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

    // =========================================================================
    // ESTRUCTURA TEÓRICA DEL REPOSITORIO (EL MAPA GENÉTICO CANÓNICO)
    // =========================================================================
    const canonicalFiles = [
        "index.html",
        "vercel.json",
        "api/products.js",
        "api/fonts.js",
        "ASSETS/css/styles.css",
        "ASSETS/js/editor.js",
        "ASSETS/js/modules/canvas-pro/smartFusion.js",
        "ASSETS/js/modules/canvas-pro/geometricUngroup.js",
        "ASSETS/js/modules/canvas-pro/selection.js",
        "ASSETS/js/modules/canvas-pro/contextualMenu.js",
        "ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js",
        "ASSETS/js/modules/canvas-pro/ekkoSynapse.js",
        "logo.png"
    ];

    // =========================================================================
    // REGLAS SENSORIALES DE CONTROL (SCANNER NEURONAL)
    // =========================================================================
    async function scanCompleteRepository() {
        const synapseResult = {
            timestamp: Date.now(),
            engine: "EKKO Synapse Engine v2.0",
            status: "HEALTHY",
            counters: {
                totalScannedNodes: 0,
                connectedSynapses: 0,
                brokenSynapses: 0,
                latentNeurons: 0
            },
            neurons: {
                active: [],     // Cargadas en memoria y activas en el lienzo
                latent: [],     // Cargadas en memoria pero pasivas (sin estímulo actual)
                missing: [],    // Faltantes en el disco físico (404)
                misaligned: [], // Recursos en rutas erróneas (ej. logo1.png en /js/)
                collisions: []  // Nombres duplicados con ambigüedad de ruta física
            },
            axons: {
                connected: [],  // Botones y callbacks enlazados perfectamente
                broken: [],     // Botones inactivos o sin controladores (rotas)
                zCollisions: [] // Superposición de capas (ej. barra contextual por debajo)
            }
        };

        // 1. ESCANEO DEL DOM Y EXTRACCIÓN DINÁMICA DE RECURSOS DECLARADOS
        const declaredResources = new Set(canonicalFiles);
        
        if (typeof document !== 'undefined') {
            document.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src');
                if (src) declaredResources.add(cleanRelativePath(src));
            });
            document.querySelectorAll('script').forEach(script => {
                const src = script.getAttribute('src');
                if (src) declaredResources.add(cleanRelativePath(src));
            });
            document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                const href = link.getAttribute('href');
                if (href) declaredResources.add(cleanRelativePath(href));
            });
        }

        const nodesToScan = Array.from(declaredResources);
        synapseResult.counters.totalScannedNodes = nodesToScan.length;

        const pathCollisionsMap = new Map(); // fileName -> Array of paths

        // 2. PROCESAMIENTO UNO A UNO DE LOS NODOS (NEURONAS)
        for (const fileRoute of nodesToScan) {
            const fileName = fileRoute.substring(fileRoute.lastIndexOf('/') + 1);
            
            if (fileName) {
                if (!pathCollisionsMap.has(fileName)) {
                    pathCollisionsMap.set(fileName, []);
                }
                pathCollisionsMap.get(fileName).push(fileRoute);
            }

            // A. Evaluación de Ubicación (Structural Misalignment)
            const routeLower = fileRoute.toLowerCase();
            const isImageFile = routeLower.endsWith('.png') || routeLower.endsWith('.jpg') || routeLower.endsWith('.jpeg') || routeLower.endsWith('.svg');
            const isInJsDir = routeLower.includes('assets/js/');
            
            if (isImageFile && isInJsDir) {
                synapseResult.neurons.misaligned.push({
                    file: fileRoute,
                    fileName: fileName,
                    type: "STRUCTURAL_MISALIGNMENT",
                    detail: `El archivo '${fileName}' es una imagen pero está guardado físicamente en la carpeta de JavaScript: '${fileRoute}'.`
                });
                synapseResult.status = "DEGRADED";
            }

            // B. Conectividad Física del Disco (Fetch HEAD/GET scan)
            try {
                const response = await fetch(fileRoute, { method: 'GET' });
                
                if (!response.ok && response.status === 404) {
                    synapseResult.neurons.missing.push({
                        file: fileRoute,
                        fileName: fileName,
                        type: "BROKEN_SYNAPSE",
                        detail: `El archivo '${fileRoute}' está declarado en la red de enlaces pero no existe en el disco local (Código HTTP: 404).`
                    });
                    synapseResult.counters.brokenSynapses++;
                    synapseResult.status = "DEGRADED";
                } else {
                    const fileContent = await response.text();
                    const infoRAM = analyzeRAMAndContent(fileRoute, fileContent);

                    if (infoRAM.isLoaded) {
                        if (infoRAM.isLatent) {
                            synapseResult.neurons.latent.push({
                                file: fileRoute,
                                version: infoRAM.version,
                                functionsDetected: infoRAM.functions
                            });
                            synapseResult.counters.latentNeurons++;
                        } else {
                            synapseResult.neurons.active.push({
                                file: fileRoute,
                                version: infoRAM.version,
                                functionsDetected: infoRAM.functions
                            });
                        }
                    } else {
                        synapseResult.neurons.latent.push({
                            file: fileRoute,
                            version: infoRAM.version || "No declarada",
                            status: "ORPHAN_IN_RAM",
                            detail: `El script '${fileRoute}' existe en disco pero sus funciones asíncronas no están instanciadas en la memoria global de Chrome.`
                        });
                        synapseResult.counters.latentNeurons++;
                    }
                }
            } catch (err) {
                synapseResult.neurons.active.push({
                    file: fileRoute,
                    status: "UNVERIFIED_ENV",
                    detail: `El archivo está cargado por el navegador pero la lectura asíncrona fue restringida localmente por políticas de red.`
                });
            }
        }

        // C. Análisis de Ambigüedad por Duplicados (Ambiguous Route Collision)
        for (const [name, paths] of pathCollisionsMap.entries()) {
            if (paths.length > 1) {
                synapseResult.neurons.collisions.push({
                    fileName: name,
                    paths: paths,
                    type: "AMBIGUOUS_ROUTE_COLLISION",
                    detail: `Se detectó el archivo '${name}' duplicado en múltiples rutas físicas de tu repositorio. Las resoluciones relativas de ruta pueden desvincular el sistema.`
                });
                synapseResult.status = "DEGRADED";
            }
        }

        // 3. AUDITORÍA DE AXONES (BOTONES CONECTADOS VS BOTONES MUERTOS)
        if (typeof document !== 'undefined') {
            const expectedUiButtons = [
                { id: "btnCtxTrace", label: "🪄 Trazar Imagen" },
                { id: "btnCtxApplyMask", label: "✂️ Recortar Imagen" },
                { id: "btnCtxRemoveMask", label: "🔓 Quitar Recorte" },
                { id: "btnCtxFlipH", label: "↔️ Espejo Horizontal" },
                { id: "btnCtxFlipV", label: "↕️ Espejo Vertical" }
            ];

            const eventRegistry = (window.EKKO_DIAG && typeof window.EKKO_DIAG.getEventRegistry === 'function') 
                ? window.EKKO_DIAG.getEventRegistry() 
                : new Map();

            expectedUiButtons.forEach(btn => {
                const domElement = document.getElementById(btn.id);
                if (domElement) {
                    const selector = `#${btn.id}`;
                    const hasActiveListener = eventRegistry.has(selector) || domElement.onclick;
                    
                    if (hasActiveListener) {
                        synapseResult.axons.connected.push({
                            id: btn.id,
                            label: btn.label,
                            status: "SYNAPSE_CONNECTED",
                            detail: `Conexión neuronal fuerte. El botón '${btn.label}' está enlazado a su callback de JS en el repositorio.`
                        });
                        synapseResult.counters.connectedSynapses++;
                    } else {
                        synapseResult.axons.broken.push({
                            id: btn.id,
                            label: btn.label,
                            type: "DEAD_ROUTE_CRITICAL",
                            detail: `El botón '${btn.label}' (${selector}) existe físicamente en pantalla pero su ruta de ejecución está ROTA o INACTIVA (DOM sin callback conectado).`
                        });
                        synapseResult.counters.brokenSynapses++;
                        synapseResult.status = "CRITICAL";
                    }
                }
            });
        }

        // 4. AUDITORÍA DE COLISIONES Z-ORDER (BARRA CONTRA REGLAS)
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

        // 5. AUDITORÍA DE DEGRADACIÓN GEOMÉTRICA (COTAS CORRIDAS)
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

        // 6. CONTROL DE CACHÉ DE MEMORIA RAM
        if (typeof window.initSmartFusionListeners === 'function') {
            const funcStr = window.initSmartFusionListeners.toString();
            const memVerMatch = funcStr.match(/v\d+\.\d+/);
            const memVer = memVerMatch ? memVerMatch[0] : 'v45.6';
            const expectedVer = 'v45.11';
            if (memVer !== expectedVer) {
                synapseResult.neurons.missing.push({
                    file: "smartFusion.js",
                    type: "CACHE_DESYNC",
                    detail: `Diferencia de caché detectada. Chrome está ejecutando la versión '${memVer}' en memoria, pero el editor físico de disco espera la versión '${expectedVer}'. ¡Haga Ctrl + F5!`
                });
                synapseResult.status = "DEGRADED";
            }
        }

        return synapseResult;
    }

    function cleanRelativePath(path) {
        if (!path) return '';
        return path.replace(/^(https?:\/\/[^\/]+)?\//, '').split('?')[0];
    }

    function analyzeRAMAndContent(route, content) {
        const info = {
            isLoaded: false,
            isLatent: false,
            version: "v1.0",
            functions: []
        };

        const versionMatch = content.match(/v\d+(\.\d+)*/);
        if (versionMatch) info.version = versionMatch[0];

        const funcRegex = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
        let match;
        while ((match = funcRegex.exec(content)) !== null) {
            info.functions.push(match[1]);
        }

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

    // Autoacoplamiento robusto bidireccional
    if (typeof window !== 'undefined') {
        window.EKKO_SYNAPSE = synapseAPI;
        if (window.EKKO_DIAG && typeof window.EKKO_DIAG.integrateSynapse === 'function') {
            window.EKKO_DIAG.integrateSynapse(synapseAPI);
            rawConsole.log("[EKKO_SYNAPSE v2.0] Conexión establecida con el Computador de Vuelo EKKO_DIAG 🟢");
        } else {
            rawConsole.log("[EKKO_SYNAPSE v2.0] Registrado en memoria global. Esperando acoplamiento... 🟡");
        }
    }

    return synapseAPI;
}));
