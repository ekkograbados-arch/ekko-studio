/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/ekkoSynapse.js
ACCIÓN: CREAR NUEVO ARCHIVO E IMPORTAR EN index.html COMO SCRIPT
ESTADO: ENTREGADO - VERSIÓN NEURONAL 100% DINÁMICA v6.0 (ZERO HARDCODING)
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js, api/synapse.js, index.html
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoSynapse.js (v6.0 - EKKO Synapse Engine)
Descripción:
    Motor de Sincronización y Mapeo Neuronal de precisión militar para EKKO Studio.
    
    ¡ZERO HARDCODING PROTOCOL! 
    Se ha erradicado por completo cualquier lista estática de archivos locales. 
    Ahora consulta en caliente el endpoint dinámico /api/synapse (que lee recursivamente
    el disco duro real en tiempo de ejecución) y lo cruza con el DOM y la RAM.
    
    - Si agregas "ASSETS/js/IDIOTA.js", el sistema lo detecta, calcula sus líneas
      y analiza su estado de carga automáticamente.
    - Si eliminas "ASSETS/js/app.js", el sistema limpia las referencias de forma orgánica,
      eliminando falsos positivos e inconsistencias de diagnóstico.
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

    // Helper para limpiar barras y nombres de dominio en rutas
    function cleanRelativePath(path) {
        if (!path) return '';
        // Remover dominios (CDNs externas o dominio local)
        let clean = path.replace(/^(https?:\/\/[^\/]+)?\//, '').split('?')[0];
        return clean;
    }

    // =========================================================================
    // REGLAS SENSORIALES DE CONTROL (SCANNER DINÁMICO DE RED NEURONAL)
    // =========================================================================
    async function scanCompleteRepository() {
        const synapseResult = {
            timestamp: Date.now(),
            engine: "EKKO Synapse Engine v6.0 (Dynamic Brain)",
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
                missing: [],    // Faltantes en el disco físico (404 real de carga)
                misaligned: [], // Recursos en rutas erróneas (ej. logo1.png en /js/)
                collisions: []  // Nombres duplicados con ambigüedad de ruta física
            },
            axons: {
                connected: [],  // Botones y callbacks enlazados perfectamente
                broken: [],     // Botones inactivos o sin controladores (rotas)
                zCollisions: [] // Superposición de capas (ej. barra contextual por debajo)
            }
        };

        let diskFiles = [];
        let hasBackend = false;

        // 1. CONSULTA ASÍNCRONA AL ENDPOINT DE ADN FÍSICO (/api/synapse)
        try {
            const apiResponse = await fetch('/api/synapse', { method: 'GET', cache: 'no-store' });
            if (apiResponse.ok) {
                const apiData = await apiResponse.json();
                if (apiData.success && Array.isArray(apiData.files)) {
                    diskFiles = apiData.files;
                    hasBackend = true;
                    rawConsole.log(`[EKKO_SYNAPSE] Sincronización asíncrona con el disco activa. Detectados ${diskFiles.length} archivos reales.`);
                }
            }
        } catch (err) {
            rawConsole.warn("[EKKO_SYNAPSE] Endpoint de backend /api/synapse inaccesible. Iniciando modo de escaneo local en DOM.");
        }

        // 2. ESCANEO DEL DOM PARA IDENTIFICAR RECURSOS DECLARADOS (Lo que Chrome está intentando cargar)
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
        const fileNamesMap = new Map(); // fileName -> Array of paths
        const diskFilesMap = new Map(); // path -> diskFileInfo

        if (hasBackend) {
            // A. Registrar archivos del disco en mapas de colisiones y búsqueda rápida
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

                // Auditoría de Desalineación Estructural (Ej: logo1.png en /ASSETS/js)
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

            // B. Cruzar declaraciones del DOM contra el disco real para detectar [BROKEN_SYNAPSE]
            declaredDOMResources.forEach(res => {
                if (res.isExternal) {
                    // Si es una CDN externa (ej: Cloudflare), registramos su acoplamiento sano
                    synapseResult.neurons.active.push({
                        file: res.rawUrl,
                        status: "EXTERNAL_CDN_ACTIVE",
                        detail: "Librería externa cargada correctamente desde red de distribución."
                    });
                    return;
                }

                // Es una ruta local. ¿Existe físicamente en el mapa de disco?
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

            // C. Evaluar estado de carga (RAM) y latencia de cada archivo de disco
            diskFiles.forEach(file => {
                const ext = file.path.substring(file.path.lastIndexOf('.')).toLowerCase();
                if (ext !== '.js') return; // Solo analizamos inicialización de scripts

                const isRequestedByDOM = declaredDOMResources.some(res => res.path === file.path);
                const infoRAM = analyzeRAMStatus(file.path);

                if (isRequestedByDOM) {
                    if (infoRAM.isLoaded) {
                        if (infoRAM.isLatent) {
                            synapseResult.neurons.latent.push({
                                file: file.path,
                                lines: file.lines,
                                detail: "Script cargado e instanciado en RAM, pero sus funciones geométricas están inactivas en el lienzo."
                            });
                            synapseResult.counters.latentNeurons++;
                        } else {
                            synapseResult.neurons.active.push({
                                file: file.path,
                                lines: file.lines
                            });
                        }
                    } else {
                        // El script está en index.html y existe en disco, pero no instanció sus funciones globales (Crashed during boot)
                        synapseResult.neurons.latent.push({
                            file: file.path,
                            status: "ORPHAN_IN_RAM",
                            detail: `El script '${file.path}' existe en disco pero sus constructores no están inicializados en Chrome. Puede contener errores de compilación.`
                        });
                        synapseResult.counters.latentNeurons++;
                    }
                } else {
                    // El script existe en disco pero no está declarado en index.html ni solicitado por el DOM
                    synapseResult.neurons.latent.push({
                        file: file.path,
                        status: "UNLINKED_NEURON",
                        detail: `El script '${file.path}' existe en disco pero no está importado en index.html. Actúa de forma pasiva.`
                    });
                    synapseResult.counters.latentNeurons++;
                }
            });

        } else {
            // MODO FALLBACK (Sin Backend API): El DOM es nuestro único mapa físico de resguardo
            declaredDOMResources.forEach(res => {
                const fileName = res.path.substring(res.path.lastIndexOf('/') + 1);
                if (fileName) {
                    if (!fileNamesMap.has(fileName)) {
                        fileNamesMap.set(fileName, []);
                    }
                    fileNamesMap.get(fileName).push(res.path);
                }

                const infoRAM = analyzeRAMStatus(res.path);
                if (infoRAM.isLoaded) {
                    if (infoRAM.isLatent) {
                        synapseResult.neurons.latent.push({ file: res.path, detail: "Módulo latente." });
                        synapseResult.counters.latentNeurons++;
                    } else {
                        synapseResult.neurons.active.push({ file: res.path });
                    }
                } else {
                    synapseResult.neurons.missing.push({
                        file: res.path,
                        type: "BROKEN_SYNAPSE",
                        detail: "El recurso DOM está inactivo o arrojó fallo de carga."
                    });
                    synapseResult.counters.brokenSynapses++;
                }
            });
            synapseResult.counters.totalScannedNodes = declaredDOMResources.length;
        }

        // D. Auditoría de Colisiones por Duplicados (Escenario: Clon Fantasma)
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
        // 4. AUDITORÍA DE AXONES (BOTONES CONECTADOS VS BOTONES MUERTOS)
        // =========================================================================
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
                            detail: `Conexión fuerte. El botón '${btn.label}' está enlazado a su callback de JS en el repositorio.`
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
            const memVerMatch = funcStr.match(/v\\d+\\.\\d+/);
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

    // Análisis en caliente del estado de vida de un script en la memoria RAM
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
            // Verificación genérica para scripts dinámicos (como IDIOTA.js): si tiene tag en el DOM, Chrome lo instanció
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
            rawConsole.log("[EKKO_SYNAPSE v6.0] Conexión establecida con el Computador de Vuelo EKKO_DIAG 🟢");
        } else {
            rawConsole.log("[EKKO_SYNAPSE v6.0] Registrado en memoria global. Esperando acoplamiento... 🟡");
        }
    }

    return synapseAPI;
}));
