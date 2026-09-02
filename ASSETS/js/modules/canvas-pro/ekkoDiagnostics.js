/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v12.0 Canonical Forensic BlackBox)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
    Caja Negra de Diagnóstico, Observabilidad Integral, Auditoría Forense y
    Control de Regresiones de 5 Niveles para EKKO Studio.
    
    Implementa el Estándar Técnico de la Biblia de EKKO Studio, el 1er Mandamiento (Protocolo Maestro), 
    el 3er Mandamiento (Estándar de Diagnóstico), el 4to Mandamiento (Contratos Funcionales)
    y la Regla de Oro de la Primera Inconsistencia Observable.

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
        interceptorsInstalled: false,
        consoleErrors: [],
        dragTracker: {
            active: false,
            startX: 0,
            startY: 0,
            startRotation: 0,
            startWidth: 0,
            startHeight: 0,
            startGeo: null,
            startSel: null,
            dragMode: 'MOVE' // 'MOVE', 'ROTATE', 'RESIZE', 'NODE_DRAG'
        },
        lastMouseDownPoint: null,
        lastMouseDownSelection: null,
        lastMouseDownGeo: null
    };

    // Escuchar excepciones de JavaScript globales en tiempo de ejecución
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
                message: `[Unhandled Promise Rejection] ${e.reason ? (e.reason.message || e.reason) : 'Desconocido'}`,
                timestamp: Date.now(),
                activeTool: window.nodeEditMode ? 'NODE_EDIT' : 'STANDARD',
                activeObject: window.selectedItem ? window.selectedItem.id : null
            });
        });
    }

    // =========================================================================
    // REGISTRO DE CONTRATOS FUNCIONALES (BOTONES, TECLAS Y ATAJOS)
    // =========================================================================
    const buttonContractsRegistry = new Map();

    function registerContract(idOrSelector, contractDef) {
        if (!idOrSelector || !contractDef) return;
        const cleanKey = String(idOrSelector).trim().toLowerCase();
        buttonContractsRegistry.set(cleanKey, Object.assign({
            name: 'UNKNOWN_ACTION',
            label: 'Acción Desconocida',
            requiresSelection: true,
            minSelectionCount: 1,
            allowLocked: false,
            isModalOrPicker: false,
            expectedTopologyDelta: 'EQUAL', // 'INCREMENT', 'DECREMENT', 'EQUAL', 'DECREASE_OR_EQUAL', 'ANY'
            expectedSelectionChange: 'PRESERVED', // 'NEW_ITEM', 'CLEARED', 'PRESERVED', 'ANY'
            expectedTransformChange: 'ANY', // 'MOVED', 'ROTATED', 'SCALED', 'ANY'
            verifyDisplacement: false,
            preserveClipping: true,
            customValidator: null
        }, contractDef));
    }

    // 1. Barra de Cabecera (#topBar)
    registerContract('#btnaddsvg', { name: 'ADD_SVG', label: 'Cabecera: Cargar SVG (#btnAddSVG)', requiresSelection: false, isModalOrPicker: true, expectedTopologyDelta: 'ANY', expectedSelectionChange: 'ANY' });
    registerContract('#btnaddimage', { name: 'ADD_IMAGE', label: 'Cabecera: Cargar Imagen (#btnAddImage)', requiresSelection: false, isModalOrPicker: true, expectedTopologyDelta: 'ANY', expectedSelectionChange: 'ANY' });
    registerContract('#btnaddtext', { name: 'ADD_TEXT', label: 'Cabecera: Agregar Texto (#btnAddText)', requiresSelection: false, expectedTopologyDelta: 'INCREMENT', expectedSelectionChange: 'NEW_ITEM' });
    registerContract('#btnaddqr', { name: 'ADD_QR', label: 'Cabecera: Cargar QR (#btnAddQR)', requiresSelection: false, isModalOrPicker: true, expectedTopologyDelta: 'ANY' });

    // 2. Barra Contextual Flotante (#contextual-toolbar)
    registerContract('#btnctxduplicate', { name: 'DUPLICATE', label: 'Barra Emergente: Duplicar (#btnCtxDuplicate)', requiresSelection: true, minSelectionCount: 1, allowLocked: false, expectedTopologyDelta: 'INCREMENT', expectedSelectionChange: 'NEW_ITEM', verifyDisplacement: true, preserveClipping: true });
    registerContract('#btnctxdelete', { name: 'DELETE', label: 'Barra Emergente: Eliminar (#btnCtxDelete)', requiresSelection: true, minSelectionCount: 1, allowLocked: false, expectedTopologyDelta: 'DECREMENT', expectedSelectionChange: 'CLEARED', preserveClipping: false });
    registerContract('#btnctxungroup', { name: 'UNGROUP', label: 'Barra Emergente: Desagrupar (#btnCtxUngroup)', requiresSelection: true, minSelectionCount: 1, allowLocked: false, expectedTopologyDelta: 'ANY', expectedSelectionChange: 'PRESERVED' });
    registerContract('#btnctxdesagrupar', { name: 'UNGROUP', label: 'Barra Emergente: Desagrupar (#btnCtxDesagrupar)', requiresSelection: true, minSelectionCount: 1, allowLocked: false, expectedTopologyDelta: 'ANY', expectedSelectionChange: 'PRESERVED' });
    registerContract('#btnctxgroup', { name: 'GROUP', label: 'Barra Emergente: Agrupar (#btnCtxGroup)', requiresSelection: true, minSelectionCount: 2, allowLocked: false, expectedTopologyDelta: 'DECREASE_OR_EQUAL', expectedSelectionChange: 'PRESERVED' });
    registerContract('#btnctxagrupar', { name: 'GROUP', label: 'Barra Emergente: Agrupar (#btnCtxAgrupar)', requiresSelection: true, minSelectionCount: 2, allowLocked: false, expectedTopologyDelta: 'DECREASE_OR_EQUAL', expectedSelectionChange: 'PRESERVED' });
    registerContract('#btnctxtofront', { name: 'BRING_TO_FRONT', label: 'Barra Emergente: Al Frente (#btnCtxToFront)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL', expectedSelectionChange: 'PRESERVED' });
    registerContract('#btnctxforward', { name: 'BRING_FORWARD', label: 'Barra Emergente: Subir Capa (#btnCtxForward)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL', expectedSelectionChange: 'PRESERVED' });
    registerContract('#btnctxbackward', { name: 'SEND_BACKWARD', label: 'Barra Emergente: Bajar Capa (#btnCtxBackward)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL', expectedSelectionChange: 'PRESERVED' });
    registerContract('#btnctxtoback', { name: 'SEND_TO_BACK', label: 'Barra Emergente: Al Fondo (#btnCtxToBack)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL', expectedSelectionChange: 'PRESERVED' });
    registerContract('#btnctxnodeedit', { name: 'ENTER_NODE_EDIT', label: 'Barra Emergente: Modo Nodos (#btnCtxNodeEdit)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxeditnodes', { name: 'ENTER_NODE_EDIT', label: 'Barra Emergente: Editar Nodos (#btnCtxEditNodes)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxexitnodeedit', { name: 'EXIT_NODE_EDIT', label: 'Barra Emergente: Salir Nodos (#btnCtxExitNodeEdit)', requiresSelection: false, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxdeletenode', { name: 'DELETE_NODE', label: 'Barra Emergente: Eliminar Nodo (#btnCtxDeleteNode)', requiresSelection: false, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxdetachsubpath', { name: 'DETACH_SUBPATH', label: 'Barra Emergente: Desprender Subtrazado (#btnCtxDetachSubpath)', requiresSelection: false, expectedTopologyDelta: 'INCREMENT' });
    registerContract('#btnctxaddnode', { name: 'TOGGLE_ADD_NODE', label: 'Barra Emergente: Añadir Nodo (#btnCtxAddNode)', requiresSelection: false, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxscaledown', { name: 'SCALE_DOWN', label: 'Barra Emergente: Reducir (#btnCtxScaleDown)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL', expectedTransformChange: 'SCALED' });
    registerContract('#btnctxscaleup', { name: 'SCALE_UP', label: 'Barra Emergente: Agrandar (#btnCtxScaleUp)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL', expectedTransformChange: 'SCALED' });
    registerContract('#btnctxfliph', { name: 'FLIP_H', label: 'Barra Emergente: Volteo Horizontal (#btnCtxFlipH)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxflipv', { name: 'FLIP_V', label: 'Barra Emergente: Volteo Vertical (#btnCtxFlipV)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxbold', { name: 'BOLD', label: 'Barra Emergente: Negrita (#btnCtxBold)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxitalic', { name: 'ITALIC', label: 'Barra Emergente: Cursiva (#btnCtxItalic)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxunderline', { name: 'UNDERLINE', label: 'Barra Emergente: Subrayado (#btnCtxUnderline)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL' });
    registerContract('#btnctxweld', { name: 'WELD', label: 'Barra Emergente: Soldar Texto (#btnCtxWeld)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'ANY' });
    registerContract('#btnctxtrace', { name: 'TRACE_IMAGE', label: 'Barra Emergente: Trazar Imagen (#btnCtxTrace)', requiresSelection: true, isModalOrPicker: true, expectedTopologyDelta: 'ANY' });
    registerContract('#btnctxapplymask', { name: 'REMOVE_BG', label: 'Barra Emergente: Recortar Fondo (#btnCtxApplyMask)', requiresSelection: true, isModalOrPicker: true, expectedTopologyDelta: 'ANY' });

    // 3. Panel Superior de Alineaciones y Distribución (#pro-layout-toolbar)
    ['proBtnAlignLeft', 'proBtnAlignCenterH', 'proBtnAlignRight', 'proBtnAlignTop', 'proBtnAlignCenterV', 'proBtnAlignBottom'].forEach(id => {
        registerContract('#' + id.toLowerCase(), { name: 'ALIGN', label: `Panel Superior: ${id}`, requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL', expectedTransformChange: 'MOVED' });
    });
    ['proBtnCenterH', 'proBtnCenterV', 'proBtnCenterBoth'].forEach(id => {
        registerContract('#' + id.toLowerCase(), { name: 'CENTER_MOCKUP', label: `Panel Superior: ${id}`, requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL', expectedTransformChange: 'MOVED' });
    });
    ['proBtnDistributeH', 'proBtnDistributeV'].forEach(id => {
        registerContract('#' + id.toLowerCase(), { name: 'DISTRIBUTE', label: `Panel Superior: ${id}`, requiresSelection: true, minSelectionCount: 3, expectedTopologyDelta: 'EQUAL', expectedTransformChange: 'MOVED' });
    });
    registerContract('#probtngroup', { name: 'GROUP', label: 'Panel Superior: Agrupar (#proBtnGroup)', requiresSelection: true, minSelectionCount: 2, expectedTopologyDelta: 'DECREASE_OR_EQUAL' });
    registerContract('#probtnungroup', { name: 'UNGROUP', label: 'Panel Superior: Desagrupar (#proBtnUngroup)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'ANY' });
    registerContract('#probtneditnodes', { name: 'ENTER_NODE_EDIT', label: 'Panel Superior: Editar Nodos (#proBtnEditNodes)', requiresSelection: true, minSelectionCount: 1, expectedTopologyDelta: 'EQUAL' });

    // Inferencia de contratos para elementos interactivos dinámicos o futuros
    function resolveButtonContract(domElement) {
        if (!domElement || !(domElement instanceof Element)) return null;
        if (domElement.id) {
            const byId = buttonContractsRegistry.get('#' + domElement.id.toLowerCase());
            if (byId) return { contract: byId, matchedBy: '#' + domElement.id };
        }
        const actionAttr = domElement.getAttribute('data-action') || domElement.getAttribute('data-command');
        if (actionAttr) {
            const byAttr = buttonContractsRegistry.get(actionAttr.toLowerCase().trim());
            if (byAttr) return { contract: byAttr, matchedBy: `[data-action="${actionAttr}"]` };
        }
        for (const [key, contract] of buttonContractsRegistry.entries()) {
            if (key.startsWith('#') || key.startsWith('.')) {
                try {
                    if (domElement.matches(key) || domElement.closest(key)) {
                        return { contract: contract, matchedBy: key };
                    }
                } catch (e) {}
            }
        }
        const isContextual = !!domElement.closest('#contextual-toolbar, .contextual-toolbar');
        const isProLayout = !!domElement.closest('#pro-layout-toolbar, .pro-layout-toolbar');
        const isTopBar = !!domElement.closest('#topBar, .topBar, #mainNavbar');
        const isSidebar = !!domElement.closest('#leftSidebar, .sidebar, #categoryTabs, #productTabs');
        
        if (isContextual || isProLayout || isTopBar || isSidebar) {
            const containerName = isContextual ? 'Barra Emergente' : (isProLayout ? 'Panel Superior' : (isTopBar ? 'Cabecera' : 'Catálogo Lateral'));
            const textLabel = domElement.textContent ? domElement.textContent.trim().substring(0, 24) : '';
            const actionName = (domElement.id || textLabel || 'DYNAMIC_TOOL').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            return {
                contract: {
                    name: actionName,
                    label: `${containerName}: '${textLabel || domElement.id}'`,
                    requiresSelection: isContextual || isProLayout,
                    minSelectionCount: 1,
                    allowLocked: false,
                    isModalOrPicker: domElement.tagName === 'INPUT' || domElement.classList.contains('modal-trigger'),
                    expectedTopologyDelta: 'ANY',
                    expectedSelectionChange: 'ANY',
                    expectedTransformChange: 'ANY',
                    verifyDisplacement: false,
                    preserveClipping: true,
                    isDynamicInferred: true
                },
                matchedBy: `${containerName} (Inferencia Dinámica Universal)`
            };
        }
        return null;
    }

    function getContentItem(item) {
        if (!item) return null;
        if (item.data && item.data.clipGroup) {
            return (item.children && item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)))) || item;
        }
        return item;
    }

    // =========================================================================
    // NIVEL 3: CAPTURA DE SELECCIÓN FORENSE
    // =========================================================================
    function snapshotSelection() {
        if (typeof window === 'undefined') return { hasSelection: false, count: 0, ids: [], primary: null };
        const selectedItems = window.selectedItems || (window.selectedItem ? [window.selectedItem] : []);
        const primary = window.selectedItem || (selectedItems.length > 0 ? selectedItems[0] : null);
        if (!primary) return { hasSelection: false, count: 0, ids: [], primary: null };
        const content = getContentItem(primary);
        
        const primaryData = {
            id: primary.id,
            contentId: content ? content.id : primary.id,
            className: primary.className,
            label: (primary.data && primary.data.label) || primary.name || 'Elemento',
            zIndex: primary.index !== undefined ? primary.index : 0,
            isHole: !!(primary.data && primary.data.isHole),
            isClipped: !!(primary.data && primary.data.isClipped),
            hasGeomBase: !!(primary.data && primary.data.geomBase),
            geomBaseSegments: (primary.data && primary.data.geomBase && primary.data.geomBase.segments) ? primary.data.geomBase.segments.length : 0,
            visibleSegments: primary.segments ? primary.segments.length : (content && content.segments ? content.segments.length : 0),
            visibleArea: primary.area ? Number(Math.abs(primary.area).toFixed(1)) : 0,
            rotation: primary.rotation !== undefined ? Number(primary.rotation.toFixed(2)) : (primary.data?.rotation || 0),
            bounds: primary.bounds ? {
                x: Number(primary.bounds.x.toFixed(1)),
                y: Number(primary.bounds.y.toFixed(1)),
                width: Number(primary.bounds.width.toFixed(1)),
                height: Number(primary.bounds.height.toFixed(1))
            } : null,
            position: content && content.position ? {
                x: Number(content.position.x.toFixed(1)),
                y: Number(content.position.y.toFixed(1))
            } : (primary.position ? {
                x: Number(primary.position.x.toFixed(1)),
                y: Number(primary.position.y.toFixed(1))
            } : null),
            isLocked: !!(primary.data && primary.data.locked),
            isText: !!(primary.className === 'PointText' || (primary.data && primary.data.isText)),
            textContent: primary.content || (primary.data && primary.data.text) || null,
            fontFamily: primary.fontFamily || (primary.data && primary.data.fontFamily) || null
        };

        return {
            hasSelection: true,
            count: selectedItems.length > 0 ? selectedItems.length : 1,
            ids: selectedItems.length > 0 ? selectedItems.map(i => i.id) : [primary.id],
            primary: primaryData
        };
    }

    // =========================================================================
    // NIVEL 4: CAPTURA DE ESTADO GEOMÉTRICO Y TOPOLOGÍA DEL LIENZO
    // =========================================================================
    function snapshotGeometricState() {
        if (typeof paper === 'undefined' || !paper.project) {
            return { timestamp: Date.now(), totalUsefulItems: 0, massCount: 0, holeCount: 0, zOrderIds: [], itemsSummary: [] };
        }
        const layer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        if (!layer || !layer.children) {
            return { timestamp: Date.now(), totalUsefulItems: 0, massCount: 0, holeCount: 0, zOrderIds: [], itemsSummary: [] };
        }
        let useful = [];
        let massCount = 0;
        let holeCount = 0;
        
        layer.children.forEach(item => {
            if (item.data && (
                item.data.mockup ||
                item.data.isMask ||
                item.data.isSelectionBox ||
                item.data.isHandle ||
                item.data.isSmartGuide ||
                item.data.isMeasurement ||
                item.data.isNodeEditOverlay ||
                item.data.isGuide ||
                item.data.isTracePreview
            )) {
                return;
            }
            const isHole = !!(item.data && item.data.isHole);
            if (isHole) holeCount++; else massCount++;
            const content = getContentItem(item);
            useful.push({
                id: item.id,
                contentId: content ? content.id : item.id,
                className: item.className,
                label: (item.data && item.data.label) || item.name || (isHole ? 'Calado Activo' : 'Masa Sólida'),
                isHole: isHole,
                isClipped: !!(item.data && item.data.isClipped),
                hasGeomBase: !!(item.data && item.data.geomBase),
                geomBaseSegments: (item.data && item.data.geomBase && item.data.geomBase.segments) ? item.data.geomBase.segments.length : 0,
                visibleSegments: item.segments ? item.segments.length : (content && content.segments ? content.segments.length : 0),
                visibleArea: item.area ? Number(Math.abs(item.area).toFixed(1)) : 0,
                bounds: item.bounds ? {
                    x: Number(item.bounds.x.toFixed(1)),
                    y: Number(item.bounds.y.toFixed(1)),
                    width: Number(item.bounds.width.toFixed(1)),
                    height: Number(item.bounds.height.toFixed(1))
                } : null,
                position: content && content.position ? {
                    x: Number(content.position.x.toFixed(1)),
                    y: Number(content.position.y.toFixed(1))
                } : (item.position ? {
                    x: Number(item.position.x.toFixed(1)),
                    y: Number(item.position.y.toFixed(1))
                } : null)
            });
        });

        return {
            timestamp: Date.now(),
            totalUsefulItems: useful.length,
            massCount: massCount,
            holeCount: holeCount,
            zOrderIds: useful.map(i => i.id),
            itemsSummary: useful
        };
    }

    // =========================================================================
    // NIVEL 5: MOTOR DE CONSISTENCIA Y VALIDACIÓN DE CONTRATOS (FORENSIC AUDIT)
    // =========================================================================
    function auditConsistency(op) {
        const beforeGeo = op.geometryBefore;
        const afterGeo = op.geometryAfter;
        const beforeSel = op.selectionBefore;
        const afterSel = op.selectionAfter;
        const contract = op.buttonContract;
        const opMeta = op.meta || {};
        const opType = op.action;
        const uiSource = op.source || 'Sistema';
        const inconsistencies = [];

        const checks = {
            actionExecuted: true,
            buttonResponded: true,
            selectionPreconditionValid: true,
            itemLossDetected: false,
            dragDisplacementValid: true,
            rotationValid: true,
            scaleValid: true,
            geomBasePreserved: true,
            selectionValid: true,
            productClippingValid: true,
            deadClickDetected: false,
            zOrderConsistent: true,
            textIntegrityValid: true,
            csgIntegrityValid: true,
            nodeIntegrityValid: true
        };

        // 1. Auditoría del Contrato Funcional Declarado
        if (contract) {
            // Precondición de selección
            if (contract.requiresSelection) {
                if (!beforeSel.hasSelection || beforeSel.count < (contract.minSelectionCount || 1)) {
                    checks.selectionPreconditionValid = false;
                    inconsistencies.push(
                        `[CONTRATO VIOLADO: PRECONDICIÓN] '${uiSource}' requería al menos ${contract.minSelectionCount || 1} elementos seleccionados (Se detectaron: ${beforeSel.count}).`
                    );
                }
            }

            // Bloqueo de escritura
            if (!contract.allowLocked && beforeSel.primary && beforeSel.primary.isLocked) {
                checks.actionExecuted = false;
                inconsistencies.push(
                    `[CONTRATO VIOLADO: ACCIÓN EN OBJETO BLOQUEADO] Se solicitó '${opType}' sobre el objeto bloqueado ID: ${beforeSel.primary.id} ('${beforeSel.primary.label}', locked: true).`
                );
            }

            // Delta topológico esperado
            const deltaUseful = afterGeo.totalUsefulItems - beforeGeo.totalUsefulItems;
            if (contract.expectedTopologyDelta === 'INCREMENT' && deltaUseful <= 0) {
                checks.actionExecuted = false;
                inconsistencies.push(
                    `[CONTRATO VIOLADO: GEOMETRÍA NO CREADA] Se esperaba la creación de una capa por '${opType}', pero la cantidad de elementos útiles no aumentó (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
                );
            } else if (contract.expectedTopologyDelta === 'DECREMENT' && deltaUseful >= 0) {
                checks.actionExecuted = false;
                inconsistencies.push(
                    `[CONTRATO VIOLADO: GEOMETRÍA NO ELIMINADA] Se esperaba la eliminación de una capa por '${opType}', pero la cantidad de elementos útiles no se redujo (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
                );
            } else if (contract.expectedTopologyDelta === 'EQUAL' && deltaUseful !== 0) {
                inconsistencies.push(
                    `[INVARIANTE VIOLADO: MUTACIÓN TOPOLÓGICA] La acción '${opType}' alteró inesperadamente el conteo total de capas en el lienzo (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
                );
            } else if (contract.expectedTopologyDelta === 'DECREASE_OR_EQUAL' && deltaUseful > 0) {
                inconsistencies.push(
                    `[CONTRATO VIOLADO: CAPA EXCEDENTE EN AGRUPACIÓN] Se agrupó con '${opType}' pero se añadieron capas extra en lugar de consolidarse.`
                );
            }

            // Enfoque de selección esperado
            if (contract.expectedSelectionChange === 'NEW_ITEM') {
                if (afterSel.primary && beforeSel.primary && afterSel.primary.id === beforeSel.primary.id && beforeSel.count === 1) {
                    checks.selectionValid = false;
                    inconsistencies.push(
                        `[CONTRATO VIOLADO: SELECCIÓN NO TRANSMITIDA] El clon/elemento nuevo creado por '${opType}' no recibió el foco de selección activa.`
                    );
                }
            } else if (contract.expectedSelectionChange === 'CLEARED') {
                if (afterSel.hasSelection && beforeSel.primary && afterSel.primary && afterSel.primary.id === beforeSel.primary.id) {
                    checks.selectionValid = false;
                    inconsistencies.push(
                        `[CONTRATO VIOLADO: SELECCIÓN HUÉRFANA] El objeto ID: ${beforeSel.primary.id} fue removido por '${opType}' pero sigue figurando como selección activa.`
                    );
                }
            }

            // Desfase obligatorio de duplicados (CNC/LightBurn anti-superposición)
            if (contract.verifyDisplacement && afterSel.primary && beforeSel.primary && afterSel.primary.position && beforeSel.primary.position) {
                const dx = Math.abs(afterSel.primary.position.x - beforeSel.primary.position.x);
                const dy = Math.abs(afterSel.primary.position.y - beforeSel.primary.position.y);
                if (dx < 1.0 && dy < 1.0) {
                    inconsistencies.push(
                        `[CONTRATO VIOLADO: CLON SUPERPUESTO] Duplicado exitoso ID: ${afterSel.primary.id}, pero se insertó concéntrico al original (sin vector de offset +20px, +20px).`
                    );
                }
            }

            // Preservación de máscara de corte en productos
            if (contract.preserveClipping && beforeSel.primary && beforeSel.primary.isClipped && afterSel.primary && !afterSel.primary.isClipped) {
                checks.productClippingValid = false;
                inconsistencies.push(
                    `[INVARIANTE VIOLADO: PÉRDIDA DE MÁSCARA] El objeto ID: ${afterSel.primary.id} perdió su clipGroup / máscara de contención del mockup al ejecutar '${opType}'.`
                );
            }
        }

        // 2. Detección Universal de Clic Muerto / Botón Desconectado
        const totalCalls = (op.callGraph && Array.isArray(op.callGraph)) ? op.callGraph.length : 0;
        const isModal = contract && contract.isModalOrPicker;
        let canvasMutated = beforeGeo.totalUsefulItems !== afterGeo.totalUsefulItems;
        if (!canvasMutated && beforeSel.primary && afterSel.primary) {
            const p0 = beforeSel.primary.position;
            const p1 = afterSel.primary.position;
            if (p0 && p1 && (Math.abs(p1.x - p0.x) > 0.1 || Math.abs(p1.y - p0.y) > 0.1)) canvasMutated = true;
        }

        const isNodeEditAction = opType.includes('NODE') || opType.includes('EDIT');
    if (opMeta.isButtonClick && totalCalls === 0 && !canvasMutated && !isModal && !opType.includes('TOGGLE') && !isNodeEditAction) {
            checks.deadClickDetected = true;
            checks.buttonResponded = false;
            inconsistencies.push(
                `[INCONSISTENCIA CLIC: BOTÓN FANTASMA] Se pulsó el elemento '${uiSource}' pero ningún callback se enlazó a la acción y el canvas quedó inerte.`
            );
        }

        // 3. Auditoría de Arrastre Interactiva (DRAG)
        if (opType === 'DRAG' && beforeSel.primary && afterSel.primary && beforeSel.primary.id === afterSel.primary.id) {
            const p0 = beforeSel.primary.position;
            const p1 = afterSel.primary.position;
            if (p0 && p1) {
                const dx = Math.abs(p1.x - p0.x);
                const dy = Math.abs(p1.y - p0.y);
                if (dx < 0.1 && dy < 0.1) {
                    checks.dragDisplacementValid = false;
                    inconsistencies.push(
                        `[ARRASTRE FRUSTRADO] Se arrastró visualmente el objeto ID: ${afterSel.primary.id} ('${afterSel.primary.label}'), pero no modificó sus coordenadas físicas.`
                    );
                }
            }
        }

        // 4. Auditoría de Rotación Interactiva (ROTATE)
        if (opType === 'ROTATE' && beforeSel.primary && afterSel.primary) {
            const r0 = beforeSel.primary.rotation || 0;
            const r1 = afterSel.primary.rotation || 0;
            if (Math.abs(r1 - r0) < 0.1) {
                checks.rotationValid = false;
                inconsistencies.push(
                    `[ROTACIÓN FRUSTRADA] Se accionó el tirador rotativo pero el ángulo del objeto quedó congelado en ${r0}°.`
                );
            }
        }

        // 5. Auditoría de Redimensionamiento (RESIZE)
        if (opType === 'RESIZE' && beforeSel.primary && afterSel.primary && beforeSel.primary.bounds && afterSel.primary.bounds) {
            const dw = Math.abs(afterSel.primary.bounds.width - beforeSel.primary.bounds.width);
            const dh = Math.abs(afterSel.primary.bounds.height - beforeSel.primary.bounds.height);
            if (dw < 0.2 && dh < 0.2) {
                checks.scaleValid = false;
                inconsistencies.push(
                    `[ESCALADO FRUSTRADO] Se arrastró un tirador de tamaño pero las dimensiones del objeto quedaron estáticas.`
                );
            }
        }

        // 6. Auditoría de Pérdida Geométrica en Desagrupado (UNGROUP)
        if (opType === 'UNGROUP' && beforeGeo.totalUsefulItems > 0 && afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
            checks.itemLossDetected = true;
            const lost = beforeGeo.totalUsefulItems - afterGeo.totalUsefulItems;
            inconsistencies.push(
                `[CONTRATO VIOLADO: ANIQUILACIÓN EN DESAGRUPAR] Se perdieron/destruyeron ${lost} elementos vectoriales en la fragmentación.`
            );
        }

        // 7. Auditoría de Conservación de Silueta Inmaculada (geomBase)
        if (beforeSel.primary && beforeSel.primary.hasGeomBase && afterSel.primary && !afterSel.primary.hasGeomBase) {
            checks.geomBasePreserved = false;
            inconsistencies.push(
                `[INVARIANTE VIOLADO: DESTRUCCIÓN DE GEOMBASE] El objeto ID: ${afterSel.primary.id} perdió 'data.geomBase'. Su reactividad de sustracciones CSG ha quedado inoperativa.`
            );
        }

        // 8. Auditoría de Creación de Texto, SVG, Imagen y QR (Efecto Real)
        if (['ADD_TEXT', 'ADD_IMAGE', 'IMPORT_SVG', 'ADD_QR'].includes(opType)) {
            const isSystemCall = (op.source === 'paper.project.importSVG' && !op.buttonContract);
            if (afterGeo.totalUsefulItems <= beforeGeo.totalUsefulItems && !isModal && !isSystemCall) {
                inconsistencies.push(
                    `[CONTRATO VIOLADO: CREACIÓN FALLIDA] Se invocó '${opType}' pero ningún elemento físico ingresó al lienzo.`
                );
            }
        }

        // =========================================================================
        // ADICIÓN REQUERIDA POR EL 3ER Y 4TO MANDAMIENTO: COMPROBACIONES GEOMÉTRICAS PROFUNDAS
        // =========================================================================

        // A) Sincronización Interactiva de Nodos y Vértices (NODE_EDIT y NODE_DRAG)
        if (opType === 'NODE_EDIT' && beforeSel.primary && afterSel.primary) {
            const b0 = beforeSel.primary.bounds;
            const b1 = afterSel.primary.bounds;
            
            // Caso 1: Se arrastró un nodo visual, pero las coordenadas o dimensiones de la geometría del objeto padre no variaron en absoluto
            if (b0 && b1 && b0.x === b1.x && b0.y === b1.y && b0.width === b1.width && b0.height === b1.height) {
                checks.nodeIntegrityValid = false;
                inconsistencies.push(
                    `[CONTRATO VIOLADO: NODE_TO_GEOMETRY_SYNC] El nodo se desplazó visualmente, pero la geometría del objeto padre ID: ${afterSel.primary.id} (bounds: [${b1.width}x${b1.height}]) quedó inalterada.`
                );
            }

            // Caso 2: Se eliminaron nodos, pero el conteo total de segmentos en el objeto padre no se redujo
            if (op.source.includes('deleteSelectedNodes') || op.source.includes('DELETE_NODE')) {
                if (afterSel.primary.visibleSegments >= beforeSel.primary.visibleSegments) {
                    checks.nodeIntegrityValid = false;
                    inconsistencies.push(
                        `[CONTRATO VIOLADO: NODE_DELETION_FAILED] Se ordenó borrar vértices seleccionados, pero el conteo de segmentos del trazado persistió idéntico (${beforeSel.primary.visibleSegments} segmentos).`
                    );
                }
            }
        }

        // B) Invariante de Apilamiento Z (Z_ORDER_STATE_SYNC)
        const zOrderAlterableActions = ['BRING_TO_FRONT', 'SEND_TO_BACK', 'BRING_FORWARD', 'SEND_BACKWARD', 'UNGROUP', 'GROUP', 'DELETE', 'DUPLICATE', 'SELECT', 'DESELECT', 'IMPORT_SVG', 'ADD_TEXT', 'ADD_IMAGE', 'ADD_QR'];
        if (!zOrderAlterableActions.includes(opType)) {
            const beforeZ = beforeGeo.zOrderIds || [];
            const afterZ = afterGeo.zOrderIds || [];
            if (beforeZ.length === afterZ.length) {
                const zShiftIdx = beforeZ.findIndex((id, idx) => id !== afterZ[idx]);
                if (zShiftIdx !== -1) {
                    checks.zOrderConsistent = false;
                    inconsistencies.push(
                        `[INVARIANTE VIOLADO: Z_ORDER_STATE_SYNC] La acción de transformación '${opType}' alteró colateralmente el orden de apilamiento Z en el lienzo (Desvío detectado en índice Z: ${zShiftIdx}).`
                    );
                }
            }
        }

        const pass = inconsistencies.length === 0;
        return { checks, inconsistencies, pass };
    }

    // =========================================================================
    // CICLO DE VIDA OPERACIONAL DE LA CAJA NEGRA (BEGIN, END Y LIVE-LOG)
    // =========================================================================
    function beginOperation(actionName, sourceDesc, meta) {
        if (!diagState.active) return null;
        diagState.opCounter++;
        const padId = String(diagState.opCounter).padStart(5, '0');
        const op = {
            id: `OP-${padId}`,
            action: actionName,
            source: sourceDesc || 'Sistema',
            meta: meta || {},
            buttonContract: (meta && meta.resolvedContract) ? meta.resolvedContract : null,
            startTime: performance.now(),
            durationMs: 0,
            selectionBefore: snapshotSelection(),
            geometryBefore: snapshotGeometricState(),
            selectionAfter: null,
            geometryAfter: null,
            callGraph: [],
            consistency: null
        };
        diagState.currentOp = op;
        return op;
    }

    function endOperation() {
        if (!diagState.active || !diagState.currentOp) return null;
        const op = diagState.currentOp;
        op.durationMs = Number((performance.now() - op.startTime).toFixed(1));
        op.selectionAfter = snapshotSelection();
        op.geometryAfter = snapshotGeometricState();
        op.consistency = auditConsistency(op);
        
        diagState.operations.push(op);
        if (diagState.operations.length > 500) {
            diagState.operations.shift();
        }
        
        emitLiveStreamLog(op);
        diagState.currentOp = null;
        return op;
    }

    function emitLiveStreamLog(op) {
        const pass = op.consistency ? op.consistency.pass : true;
        const sel = op.selectionAfter && op.selectionAfter.primary;
        const selDesc = sel ? `ID: ${sel.id} (${sel.className}) | Z:${sel.zIndex} | ${sel.isHole ? '🕳️ CALADO' : '⬛ MASA'}` : 'Sin selección';
        const geoDesc = `Capas: ${op.geometryAfter.totalUsefulItems} (Masas: ${op.geometryAfter.massCount}, Calados: ${op.geometryAfter.holeCount})`;

        if (pass) {
            rawConsole.log(
                `%c[${op.id}] ${op.action.padEnd(16)}%c | ✓ OK (${op.durationMs}ms) | Origen: ${op.source} | ${selDesc} | ${geoDesc}`,
                'color: #0284c7; font-weight: bold;',
                'color: #10b981;'
            );
        } else {
            rawConsole.warn(
                `%c[${op.id}] ${op.action.padEnd(16)}%c | ⚠️ INCONSISTENCIA DETECTADA (${op.durationMs}ms) | Origen: ${op.source} | ${selDesc}`,
                'color: #ea580c; font-weight: bold;',
                'color: #ef4444; font-weight: bold;'
            );
            op.consistency.inconsistencies.forEach(inc => {
                rawConsole.error(`   ↳ ${inc}`);
            });
        }
    }

    // =========================================================================
    // ENVOLTORIO SISTÉMICO Y SEGURO DE FUNCIONES (CALLGRAPH TRACING)
    // =========================================================================
    function forceWrapWindowFunction(fnName, modulePath, actionType) {
        if (typeof window === 'undefined') return;
        const original = window[fnName];
        if (typeof original !== 'function') return;

        const wrapped = function (...args) {
            const hasExisting = !!diagState.currentOp;
            let op = hasExisting ? diagState.currentOp : beginOperation(actionType || fnName, `${modulePath} -> ${fnName}()`);
            const t0 = performance.now();
            let res, err = null;

            try {
                res = original.apply(this, args);
            } catch (e) {
                err = e;
                throw e;
            } finally {
                const t1 = performance.now();
                if (op && Array.isArray(op.callGraph)) {
                    op.callGraph.push({
                        fnName: fnName,
                        module: modulePath,
                        durationMs: Number((t1 - t0).toFixed(1)),
                        error: err ? err.message : null
                    });
                }
                if (!hasExisting && op) {
                    endOperation();
                }
            }
            return res;
        };

        try {
            Object.defineProperty(window, fnName, {
                value: wrapped,
                writable: true,
                configurable: true,
                enumerable: true
            });
        } catch (e) {
            window[fnName] = wrapped;
        }
    }

    // =========================================================================
    // INTERCEPTORES DE EVENTOS (DOM, TECLADO Y LIENZO)
    // =========================================================================
    function installDOMCaptureListeners() {
        if (typeof document === 'undefined') return;

        // A) Eventos Click en Botones e interactivos del DOM
        document.addEventListener('click', function (e) {
            if (!diagState.active) return;
            const target = e.target;
            if (!target) return;
            const interactiveEl = target.closest('button, [role="button"], .btn-action, .toolbar-btn, .pro-btn, .tab-btn, [data-action], a.btn');
            if (!interactiveEl) return;

            const resolved = resolveButtonContract(interactiveEl);
            if (!resolved) return;
            const contract = resolved.contract;

            const op = beginOperation(contract.name || 'CLICK', contract.label, {
                isButtonClick: true,
                domElementId: interactiveEl.id || null,
                domClass: interactiveEl.className || null,
                resolvedContract: contract,
                matchedBy: resolved.matchedBy
            });

            setTimeout(() => {
                if (diagState.currentOp === op) endOperation();
            }, 150);
        }, true);

        // B) Atajos de Teclado Universales
        window.addEventListener('keydown', function (e) {
            if (!diagState.active) return;
            const activeTag = document.activeElement ? document.activeElement.tagName.toUpperCase() : '';
            if (['INPUT', 'TEXTAREA'].includes(activeTag)) return;
            if (document.activeElement && document.activeElement.id === 'ekko-text-editor') return;

            const key = e.key.toLowerCase();
            const isCtrl = e.ctrlKey || e.metaKey;
            let action = null;

            if (isCtrl) {
                if (key === 'z') action = e.shiftKey ? 'REDO' : 'UNDO';
                else if (key === 'y') action = 'REDO';
                else if (key === 'c') action = 'COPY';
                else if (key === 'v') action = 'PASTE';
                else if (key === 'd') action = 'DUPLICATE';
                else if (key === 'g') action = 'GROUP';
                else if (key === 'u') action = 'UNGROUP';
            } else if (key === 'delete' || key === 'backspace') {
                action = 'DELETE';
            } else if (e.key === 'PageUp') {
                action = isCtrl ? 'BRING_TO_FRONT' : 'BRING_FORWARD';
            } else if (e.key === 'PageDown') {
                action = isCtrl ? 'SEND_TO_BACK' : 'SEND_BACKWARD';
            }

            if (action) {
                const op = beginOperation(action, `Atajo Teclado (${(isCtrl ? 'Ctrl+' : '') + e.key})`);
                setTimeout(() => {
                    if (diagState.currentOp === op) endOperation();
                }, 120);
            }
        }, true);

        // C) Ciclo de Vida del Canvas de Paper.js (#editorCanvas)
        const canvasEl = document.getElementById('editorCanvas');
        if (canvasEl) {
            canvasEl.addEventListener('mousedown', function (e) {
                if (!diagState.active) return;
                const sel = snapshotSelection();
                diagState.lastMouseDownPoint = { x: e.clientX, y: e.clientY };
                diagState.lastMouseDownSelection = sel;
                diagState.lastMouseDownGeo = snapshotGeometricState();

                diagState.dragTracker = {
                    active: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    startRotation: sel.primary ? sel.primary.rotation : 0,
                    startWidth: (sel.primary && sel.primary.bounds) ? sel.primary.bounds.width : 0,
                    startHeight: (sel.primary && sel.primary.bounds) ? sel.primary.bounds.height : 0,
                    startSel: sel,
                    startGeo: diagState.lastMouseDownGeo,
                    dragMode: window.rotationActive ? 'ROTATE' : (window.resizeActive ? 'RESIZE' : (window.nodeEditMode ? 'NODE_DRAG' : 'MOVE'))
                };
            }, true);

            window.addEventListener('mouseup', function (e) {
                if (!diagState.active || !diagState.dragTracker.active) return;
                const tracker = diagState.dragTracker;
                tracker.active = false;
                const dx = Math.abs(e.clientX - tracker.startX);
                const dy = Math.abs(e.clientY - tracker.startY);

                setTimeout(() => {
                    const selNow = snapshotSelection();
                    const geoNow = snapshotGeometricState();

                    if (dx > 3 || dy > 3) {
                        let actionName = 'DRAG';
                        if (tracker.dragMode === 'ROTATE' || window.rotationActive) actionName = 'ROTATE';
                        else if (tracker.dragMode === 'RESIZE' || window.resizeActive) actionName = 'RESIZE';
                        else if (tracker.dragMode === 'NODE_DRAG' || window.nodeEditMode) actionName = 'NODE_EDIT';

                        const op = beginOperation(actionName, `Lienzo: ${actionName}`);
                        op.selectionBefore = tracker.startSel;
                        op.geometryBefore = tracker.startGeo;
                        endOperation();
                    } else {
                        // Click simple sin desplazamiento: Detección de Selección/Deselección
                        const idBefore = tracker.startSel.primary ? tracker.startSel.primary.id : null;
                        const idNow = selNow.primary ? selNow.primary.id : null;
                        if (idBefore !== idNow || (!tracker.startSel.hasSelection && selNow.hasSelection) || (tracker.startSel.hasSelection && !selNow.hasSelection)) {
                            const op = beginOperation(idNow ? 'SELECT' : 'DESELECT', 'Clic en Lienzo (#editorCanvas)');
                            op.selectionBefore = tracker.startSel;
                            op.geometryBefore = tracker.startGeo || geoNow;
                            endOperation();
                        }
                    }
                }, 50);
            }, true);
        }
    }

    function installAllInterceptors() {
        if (diagState.interceptorsInstalled) return;

        const functionsToWrap = [
            ['openSVGFileDialog', 'editor.js', 'OPEN_FILE_DIALOG'],
            ['openImageFileDialog', 'editor.js', 'OPEN_FILE_DIALOG'],
            ['addQRToCanvas', 'editor.js', 'ADD_QR'],
            ['startTextEditing', 'textEditor.js', 'START_TEXT_EDIT'],
            ['selectItem', 'selection.js', 'SELECT'],
            ['deselectItem', 'selection.js', 'DESELECT'],
            ['updateSelectionBox', 'selection.js', 'UPDATE_SELECTION_BOX'],
            ['initSelectionTool', 'selection.js', 'INIT_SELECTION_TOOL'],
            ['ungroupSelectedItem', 'geometricUngroup.js', 'UNGROUP'],
            ['groupSelectedItems', 'contextualMenu.js', 'GROUP'],
            ['duplicateImage', 'imageToolbar.js', 'DUPLICATE'],
            ['deleteImage', 'imageToolbar.js', 'DELETE'],
            ['cloneSingleItem', 'contextualMenu.js', 'CLONE_ITEM'],
            ['bringFront', 'editor.js', 'BRING_TO_FRONT'],
            ['sendBack', 'editor.js', 'SEND_TO_BACK'],
            ['bringForward', 'editor.js', 'BRING_FORWARD'],
            ['sendBackward', 'editor.js', 'SEND_BACKWARD'],
            ['enterNodeEditMode', 'nodeEditor.js', 'ENTER_NODE_EDIT'],
            ['exitNodeEditMode', 'nodeEditor.js', 'EXIT_NODE_EDIT'],
            ['deleteSelectedNodes', 'nodeEditor.js', 'DELETE_NODES'],
            ['detachSelectedSubpaths', 'nodeEditor.js', 'DETACH_SUBPATH'],
            ['recalculateDynamicSubtractions', 'geometricUngroup.js', 'RECALCULATE_CSG'],
            ['alignSelection', 'canvasControlsIntegration.js', 'ALIGN'],
            ['distributeSpacing', 'canvasControlsIntegration.js', 'DISTRIBUTE'],
            ['duplicateSelectedItem', 'contextualMenu.js', 'DUPLICATE'],
            ['copySelected', 'editor.js', 'COPY'],
            ['pasteSelected', 'editor.js', 'PASTE']
        ];

        functionsToWrap.forEach(item => {
            forceWrapWindowFunction(item[0], item[1], item[2]);
        });

        // Gancho seguro en la importación asíncrona de SVG nativa de Paper.js
        if (typeof paper !== 'undefined' && paper.project && paper.project.importSVG && !paper.project._diagWrapped) {
            const origImportSVG = paper.project.importSVG;
            paper.project.importSVG = function (...args) {
                beginOperation('IMPORT_SVG', 'paper.project.importSVG');
                const cbIndex = args.findIndex(a => typeof a === 'function');
                if (cbIndex >= 0) {
                    const originalCb = args[cbIndex];
                    args[cbIndex] = function (item) {
                        const res = originalCb(item);
                        setTimeout(() => { endOperation(); }, 60);
                        return res;
                    };
                }
                return origImportSVG.apply(this, args);
            };
            paper.project._diagWrapped = true;
        }

        installDOMCaptureListeners();
        diagState.interceptorsInstalled = true;
    }

    // =========================================================================
    // SISTEMA DE CORRELACIÓN Y ANÁLISIS DE CASCADA (MANDAMIENTOS DE INTEGRIDAD)
    // =========================================================================
    function analyzeCascadeErrors() {
        const ops = diagState.operations;
        const failedOps = ops.filter(op => op.consistency && !op.consistency.pass);
        if (failedOps.length === 0) return null;

        // La regla de la primera inconsistencia observable:
        const firstFailure = failedOps[0];
        const chain = [];
        
        // Unificar fallas que dependan temporalmente de la primera ruptura
        for (let i = ops.indexOf(firstFailure); i < ops.length; i++) {
            const current = ops[i];
            if (current.consistency && !current.consistency.pass) {
                chain.push({
                    id: current.id,
                    action: current.action,
                    source: current.source,
                    failures: current.consistency.inconsistencies
                });
            }
        }

        // Deducir causa raíz probabilística y sistemas involucrados
        let probableRoot = "No se puede confirmar causa raíz de forma automatizada.";
        let relatedSystems = ["N/A"];

        if (firstFailure.action === 'NODE_EDIT' || firstFailure.action === 'NODE_DRAG') {
            probableRoot = "La edición de vértices actualiza la posición del tirador visual de Paper.js, pero la mutación no se propaga a la geometría base 'data.geomBase' ni se recalculan los bounds del trazado real.";
            relatedSystems = ["nodeEditor.js", "geometricUngroup.js -> recalculateDynamicSubtractions()"];
        } else if (firstFailure.action === 'DUPLICATE') {
            probableRoot = "La duplicación de objetos clona las entidades del lienzo pero asocia los handles visuales o referencias del editor de nodos al objeto de origen anterior (Ownership desincronizado).";
            relatedSystems = ["contextualMenu.js -> duplicateSelectedItem()", "nodeEditor.js"];
        } else if (firstFailure.action === 'UNGROUP') {
            probableRoot = "El despiece booleano por jerarquía de contención aniquila capas cerradas debido a intersecciones asimétricas o desecha subcapas inactivas durante el aplanamiento de CompoundPaths.";
            relatedSystems = ["geometricUngroup.js -> decomposeByContainmentHierarchy()", "exportSVG.js"];
        } else if (firstFailure.consistency.checks.deadClickDetected) {
            probableRoot = "Se asignó un elemento interactivo en el DOM (ID o clase de acción) pero carece de un addEventListener activo en editor.js o canvasControlsIntegration.js (Clic Muerto).";
            relatedSystems = ["editor.js -> bootstrapEKKO()", "index.html"];
        }

        return {
            firstFailure,
            chain,
            probableRoot,
            relatedSystems
        };
    }

    // =========================================================================
    // API PÚBLICA UNIVERSAL EKKO_DIAG
    // =========================================================================
    const publicAPI = {
        start: function () {
            diagState.active = true;
            installAllInterceptors();
            rawConsole.log('%c[EKKO_DIAG v10.0 Canonical Forensic BlackBox] Activo 🟢 - Supervisión del 100% sin Puntos Ciegos', 'color: #10b981; font-weight: bold; font-size: 13px;');
            return 'EKKO_DIAG v10.0 Activo. Monitoreando automáticamente herramientas, botones, transformaciones, clics y excepciones.';
        },
        
        stop: function () {
            diagState.active = false;
            rawConsole.log('%c[EKKO_DIAG] Detenido 🔴', 'color: #ef4444; font-weight: bold;');
            return 'EKKO_DIAG Detenido.';
        },
        
        clear: function () {
            diagState.operations = [];
            diagState.opCounter = 0;
            diagState.currentOp = null;
            diagState.consoleErrors = [];
            return 'Caja negra vaciada. Historial de sesión e inconsistencias limpio.';
        },
        
        registerButtonContract: function (idOrSelector, contractConfig) {
            registerContract(idOrSelector, contractConfig);
            rawConsole.log(`%c[EKKO_DIAG] Contrato funcional registrado para '${idOrSelector}'`, 'color: #0284c7;');
            return true;
        },

        status: function () {
            return {
                activo: diagState.active,
                totalOperaciones: diagState.operations.length,
                conteoExcepciones: diagState.consoleErrors.length,
                interceptoresAcoplados: diagState.interceptorsInstalled
            };
        },

        snapshot: function (label) {
            const op = beginOperation('MANUAL_SNAPSHOT', `F12 -> snapshot('${label || 'Manual'}')`);
            setTimeout(() => endOperation(), 10);
            return 'Snapshot manual registrado en la cola operacional.';
        },

        report: function () {
            const ops = diagState.operations;
            const exceptions = diagState.consoleErrors;
            const cascadeAnalysis = analyzeCascadeErrors();

            let out = '╔══════════════════════════════════════════════════════════════════════════════════╗\n';
            out += '║     EKKO STUDIO DIAGNOSTIC v11.0 - ESTÁNDAR CANÓNICO DE CONTRATOS FORENSES       ║\n';
            out += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';

            out += `Duración de Sesión: ${ops.length > 0 ? Math.round((performance.now() - ops[0].startTime) / 1000) : 0} segundos\n`;
            out += `Operaciones Auditadas: ${ops.length}\n`;
            out += `Excepciones de JavaScript en F12: ${exceptions.length}\n\n`;

            // SECCIÓN: FIRST OBSERVABLE INCONSISTENCY (REGLA DE ORO DE LA INTEGRIDAD)
            if (cascadeAnalysis) {
                const first = cascadeAnalysis.firstFailure;
                out += '================================================================================\n';
                out += '🔴 FIRST OBSERVABLE INCONSISTENCY DETECTED (PUNTO DE RUPTURA PRIMARIO)          \n';
                out += '================================================================================\n';
                out += `Operación Crítica: ${first.id} | Acción: ${first.action} | Origen: ${first.source}\n`;
                out += `Inconsistencias de la primera ruptura:\n`;
                first.consistency.inconsistencies.forEach(inc => {
                    out += `   ↳ ${inc}\n`;
                });
                out += `\nProbable Causa Raíz:\n   👉 ${cascadeAnalysis.probableRoot}\n`;
                out += `\nMódulos y Archivos Comprometidos:\n`;
                cascadeAnalysis.relatedSystems.forEach(sys => {
                    out += `   📁 ${sys}\n`;
                });
                out += '================================================================================\n\n';
            } else {
                out += '💚 [SIN RUPTURAS] No se han detectado desincronizaciones de contratos vectoriales en esta sesión.\n\n';
            }

            // SECCIÓN: #### ERRORS
            out += '--------------------------------------------------------------------------------\n';
            out += '#### ERRORS\n';
            out += '--------------------------------------------------------------------------------\n';
            if (exceptions.length === 0) {
                out += ' (Ningún error o excepción de JavaScript fue registrado en la consola de F12)\n';
            } else {
                exceptions.forEach((err, idx) => {
                    out += `[ERR-${String(idx + 1).padStart(3, '0')}] ${err.message}\n`;
                    if (err.stack) {
                        out += `   ↳ Traceback: ${err.stack.split('\n')[1] || ''}\n`;
                    }
                });
            }
            out += '\n';

            // SECCIÓN: #### CONTRACT FAILURES
            out += '--------------------------------------------------------------------------------\n';
            out += '#### CONTRACT FAILURES\n';
            out += '--------------------------------------------------------------------------------\n';
            let contractFails = ops.filter(op => op.consistency && (!op.consistency.checks.selectionPreconditionValid || !op.consistency.checks.actionExecuted || op.consistency.inconsistencies.some(i => i.includes('PRECONDICIÓN') || i.includes('BLOQUEADO'))));
            if (contractFails.length === 0) {
                out += ' (Ninguna violación de precondiciones de selección o restricciones de bloqueo fue detectada)\n';
            } else {
                contractFails.forEach(op => {
                    out += `[${op.id}] ${op.action} | Origen: ${op.source}\n`;
                    op.consistency.inconsistencies.filter(i => i.includes('PRECONDICIÓN') || i.includes('BLOQUEADO')).forEach(inc => {
                        out += `   ↳ ${inc}\n`;
                    });
                });
            }
            out += '\n';

            // SECCIÓN: #### INVARIANT FAILURES
            out += '--------------------------------------------------------------------------------\n';
            out += '#### INVARIANT FAILURES\n';
            out += '--------------------------------------------------------------------------------\n';
            let invariantFails = ops.filter(op => op.consistency && (!op.consistency.checks.geomBasePreserved || !op.consistency.checks.productClippingValid || !op.consistency.checks.zOrderConsistent || !op.consistency.checks.nodeIntegrityValid));
            if (invariantFails.length === 0) {
                out += ' (Todos los invariantes de geomBase, máscara de producto, Z-order y nodos Bézier se mantuvieron coherentes)\n';
            } else {
                invariantFails.forEach(op => {
                    out += `[${op.id}] ${op.action} | Origen: ${op.source}\n`;
                    op.consistency.inconsistencies.filter(i => i.includes('INVARIANTE') || i.includes('DESTRUCCIÓN') || i.includes('MÁSCARA') || i.includes('Z_ORDER') || i.includes('NODE_TO_GEOMETRY') || i.includes('NODE_DELETION')).forEach(inc => {
                        out += `   ↳ ${inc}\n`;
                    });
                });
            }
            out += '\n';

            // SECCIÓN: #### DESYNCHRONIZATIONS
            out += '--------------------------------------------------------------------------------\n';
            out += '#### DESYNCHRONIZATIONS\n';
            out += '--------------------------------------------------------------------------------\n';
            let desyncs = ops.filter(op => op.consistency && (!op.consistency.checks.selectionValid || op.consistency.inconsistencies.some(i => i.includes('SELECCIÓN') || i.includes('DESINCRONIZACIÓN') || i.includes('CLON'))));
            if (desyncs.length === 0) {
                out += ' (Los focos de selección, tiradores interactivos y duplicaciones permanecieron sincronizados)\n';
            } else {
                desyncs.forEach(op => {
                    out += `[${op.id}] ${op.action} | Origen: ${op.source}\n`;
                    op.consistency.inconsistencies.filter(i => i.includes('SELECCIÓN') || i.includes('DESINCRONIZACIÓN') || i.includes('CLON')).forEach(inc => {
                        out += `   ↳ ${inc}\n`;
                    });
                });
            }
            out += '\n';

            // SECCIÓN: #### ACTION WITHOUT EFFECT
            out += '--------------------------------------------------------------------------------\n';
            out += '#### ACTION WITHOUT EFFECT\n';
            out += '--------------------------------------------------------------------------------\n';
            let deadActions = ops.filter(op => op.consistency && (op.consistency.checks.deadClickDetected || !op.consistency.checks.dragDisplacementValid || !op.consistency.checks.rotationValid || !op.consistency.checks.scaleValid || op.consistency.inconsistencies.some(i => i.includes('FANTASMA') || i.includes('FRUSTRADO'))));
            if (deadActions.length === 0) {
                out += ' (Cada clic e interacción del lienzo produjo transformaciones geométricas reales y efectos observables)\n';
            } else {
                deadActions.forEach(op => {
                    out += `[${op.id}] ${op.action} | Origen: ${op.source}\n`;
                    op.consistency.inconsistencies.filter(i => i.includes('FANTASMA') || i.includes('FRUSTRADO') || i.includes('BLOQUEADO') || i.includes('FALLIDO')).forEach(inc => {
                        out += `   ↳ ${inc}\n`;
                    });
                });
            }
            out += '\n';

            // SECCIÓN: #### STATE TRANSITIONS
            out += '--------------------------------------------------------------------------------\n';
            out += '#### STATE TRANSITIONS\n';
            out += '--------------------------------------------------------------------------------\n';
            if (ops.length === 0) {
                out += ' (No hay operaciones registradas en el buffer de la sesión actual)\n';
            } else {
                const tailOps = ops.slice(-12); // Últimas 12 operaciones para no colapsar la consola
                tailOps.forEach(op => {
                    const status = op.consistency && op.consistency.pass ? '✓ OK' : '⚠️ FALLA';
                    const detail = op.selectionAfter && op.selectionAfter.primary 
                        ? `ID: ${op.selectionAfter.primary.id} (${op.selectionAfter.primary.label})` 
                        : 'Sin selección';
                    out += `[${op.id}] ${op.action.padEnd(14)} | ${status.padEnd(8)} | Duración: ${op.durationMs}ms | ${detail}\n`;
                });
                if (ops.length > 12) {
                    out += ` ... (Se omitieron ${ops.length - 12} operaciones anteriores de la línea de tiempo)\n`;
                }
            }
            out += '\n';

            // SECCIÓN: #### CORRELATED FAILURE CHAINS
            out += '--------------------------------------------------------------------------------\n';
            out += '#### CORRELATED FAILURE CHAINS\n';
            out += '--------------------------------------------------------------------------------\n';
            if (cascadeAnalysis && cascadeAnalysis.chain.length > 1) {
                out += `Cadena de fallas en cascada originadas por el Punto de Ruptura Primario (${cascadeAnalysis.firstFailure.id}):\n\n`;
                cascadeAnalysis.chain.forEach((link, idx) => {
                    const indent = ' '.repeat(idx * 3);
                    out += `${indent}⚡ [${link.id}] ${link.action} (Origen: ${link.source})\n`;
                    link.failures.forEach(fail => {
                        out += `${indent}   ↳ Error: ${fail}\n`;
                    });
                });
            } else {
                out += ' (No se detectaron secuencias de fallas en cascada correlacionadas en esta sesión)\n';
            }
            out += '\n';

            // SECCIÓN: #### PROBABLE ROOT CAUSES
            out += '--------------------------------------------------------------------------------\n';
            out += '#### PROBABLE ROOT CAUSES\n';
            out += '--------------------------------------------------------------------------------\n';
            if (cascadeAnalysis) {
                out += `1. ANÁLISIS DE LA CAUSA RAÍZ PRIMARIA (Forense):\n`;
                out += `   👉 ${cascadeAnalysis.probableRoot}\n\n`;
                out += `2. DIAGNÓSTICO DEL CALLGRAPH INTERNO:\n`;
                const cg = cascadeAnalysis.firstFailure.callGraph || [];
                if (cg.length === 0) {
                    out += `   (El flujo se interrumpió de forma asíncrona antes de invocar funciones controladoras wrapped en CallGraph)\n`;
                } else {
                    cg.forEach(call => {
                        const errText = call.error ? ` [❌ FALLÓ: "${call.error}"]` : ' [✓ COMPILADO OK]';
                        out += `   🌐 Función: window.${call.fnName}() en Módulo: '${call.module}' en ${call.durationMs}ms${errText}\n`;
                    });
                }
            } else {
                out += ' (Sin inconsistencias activas, el CallGraph se encuentra al 100% de salud)\n';
            }
            out += '\n';

            // SECCIÓN: #### RELATED SYSTEMS
            out += '--------------------------------------------------------------------------------\n';
            out += '#### RELATED SYSTEMS\n';
            out += '--------------------------------------------------------------------------------\n';
            if (cascadeAnalysis) {
                out += `Los archivos de Studio que contienen las funciones comprometidas que rompen el contrato son:\n`;
                cascadeAnalysis.relatedSystems.forEach(sys => {
                    out += `   📁 ekko-studio/ASSETS/js/modules/canvas-pro/${sys}\n`;
                });
                out += `\n👉 Se sugiere auditar el flujo de sincronización de Paper.js en estos archivos utilizando el Protocolo Maestro.\n`;
            } else {
                out += ' (Todos los sistemas e integraciones se encuentran estables y validados)\n';
            }
            out += '\n';

            // SECCIÓN: #### EVIDENCE
            out += '--------------------------------------------------------------------------------\n';
            out += '#### EVIDENCE\n';
            out += '--------------------------------------------------------------------------------\n';
            if (cascadeAnalysis) {
                const first = cascadeAnalysis.firstFailure;
                out += `Evidencia técnica detallada de la primera inconsistencia detectada:\n`;
                out += `   - ID de Operación: ${first.id}\n`;
                out += `   - Acción de Interfaz: ${first.action}\n`;
                out += `   - Duración física de ejecución: ${first.durationMs} milisegundos\n`;
                out += `   - Selección de Capas - Conteo previo: ${first.selectionBefore.count} | Conteo posterior: ${first.selectionAfter.count}\n`;
                out += `   - Topología de Diseño - Capas previas: ${first.geometryBefore.totalUsefulItems} | Capas posteriores: ${first.geometryAfter.totalUsefulItems}\n`;
                if (first.selectionBefore.primary && first.selectionAfter.primary) {
                    out += `   - Geometría de Letras / SVG antes: bounds: [${first.selectionBefore.primary.bounds?.width}x${first.selectionBefore.primary.bounds?.height}] | pos: [X:${first.selectionBefore.primary.position?.x}, Y:${first.selectionBefore.primary.position?.y}]\n`;
                    out += `   - Geometría de Letras / SVG después: bounds: [${first.selectionAfter.primary.bounds?.width}x${first.selectionAfter.primary.bounds?.height}] | pos: [X:${first.selectionAfter.primary.position?.x}, Y:${first.selectionAfter.primary.position?.y}]\n`;
                }
            } else {
                out += `   - Operaciones registradas en cola de vuelo: ${ops.length} ejecuciones exitosas.\n`;
                out += `   - Todas las precondiciones, bounds e invariantes de Paper.js devolvieron PASS.\n`;
            }
            out += '================================================================================\n';

            rawConsole.log(out);
            return out;
        },

        dump: function () {
            const rep = this.report();
            const payload = rep + '\n\n--- VOLCADO COMPLETO DETALLADO DE CAJA NEGRA (JSON) ---\n' + JSON.stringify(diagState, null, 2);
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(payload).then(() => {
                    rawConsole.log('%c[EKKO_DIAG] Copia completa de caja negra (v10.0) volcada en portapapeles.', 'color: #10b981; font-weight: bold;');
                }).catch(() => {});
            }
            return payload;
        },

        inconsistencies: function (actionFilter) {
            let fallas = diagState.operations.filter(op => op.consistency && !op.consistency.pass);
            if (typeof actionFilter === 'string' && actionFilter.trim().length > 0) {
                const query = actionFilter.trim().toUpperCase();
                fallas = fallas.filter(op => (op.action && op.action.toUpperCase().includes(query)) || (op.source && op.source.toUpperCase().includes(query)));
            }

            if (fallas.length === 0) {
                const msg = actionFilter
                    ? `[EKKO_DIAG v10.0] ✓ Sin inconsistencias detectadas para el filtro: "${actionFilter}".`
                    : `[EKKO_DIAG v10.0] ✓ Sin inconsistencias de contratos vectoriales detectadas en las ${diagState.operations.length} operaciones registradas.`;
                rawConsole.log(`%c${msg}`, 'color: #10b981; font-weight: bold;');
                return [];
            }

            rawConsole.log(
                `%c[EKKO_DIAG] ⚠️ SE DETECTARON ${fallas.length} OPERACIÓN(ES) CON INCONSISTENCIAS DE CONTRATO:` + (actionFilter ? ` (Filtro: "${actionFilter}")` : ''),
                'color: #ef4444; font-weight: bold; font-size: 13px;'
            );

            const rows = fallas.map(op => ({
                'ID': op.id,
                'Acción': op.action,
                'Duración': `${op.durationMs}ms`,
                'Origen': op.source || 'N/A',
                'Fallas Registradas': (op.consistency.inconsistencies || []).join(' | ')
            }));

            rawConsole.table(rows);
            return fallas;
        },

        dumpInconsistencies: function (actionFilter) {
            let fallas = diagState.operations.filter(op => op.consistency && !op.consistency.pass);
            if (typeof actionFilter === 'string' && actionFilter.trim().length > 0) {
                const query = actionFilter.trim().toUpperCase();
                fallas = fallas.filter(op => (op.action && op.action.toUpperCase().includes(query)) || (op.source && op.source.toUpperCase().includes(query)));
            }

            if (fallas.length === 0) {
                rawConsole.log('%c[EKKO_DIAG v10.0] ✓ No hay inconsistencias registradas en caliente para exportar.', 'color: #10b981; font-weight: bold;');
                return 'Sin inconsistencias.';
            }

            let out = '╔══════════════════════════════════════════════════════════════════════════════════╗\n';
            out += '║       EKKO STUDIO DIAGNOSTIC - REPORTE EXCLUSIVO DE INCONSISTENCIAS              ║\n';
            out += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';
            out += `Total de Fallas Reportadas: ${fallas.length} / ${diagState.operations.length} operaciones\n\n`;

            fallas.forEach(op => {
                out += `[${op.id}] ${op.action.padEnd(16)} | ⚠️ INCONSISTENCIA | ${op.durationMs}ms | Origen: ${op.source}\n`;
                (op.consistency.inconsistencies || []).forEach(inc => {
                    out += `   ↳ ${inc}\n`;
                });
            });

            const payload = out + '\n--- VOLCADO COMPLETO DETALLADO DE INCONSISTENCIAS DE CONTRATO (JSON) ---\n' + JSON.stringify(fallas, null, 2);
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(payload).then(() => {
                    rawConsole.log('%c[EKKO_DIAG] Reporte de inconsistencias forense copiado al portapapeles con éxito.', 'color: #10b981; font-weight: bold;');
                }).catch(() => {});
            }
            rawConsole.log(out);
            return payload;
        },

        summary: function () {
            const total = diagState.operations.length;
            const fallas = diagState.operations.filter(op => op.consistency && !op.consistency.pass);
            const exitos = total - fallas.length;
            const rate = total > 0 ? ((exitos / total) * 100).toFixed(1) : '100.0';

            rawConsole.log(
                `%c[EKKO_DIAG] 📊 Resumen Forense: ${total} Operaciones | ✓ ${exitos} OK (${rate}%) | ⚠️ ${fallas.length} Inconsistencias`,
                fallas.length > 0 ? 'color: #f59e0b; font-weight: bold;' : 'color: #10b981; font-weight: bold;'
            );

            const porAccion = {};
            diagState.operations.forEach(op => {
                const act = op.action || 'DESCONOCIDO';
                if (!porAccion[act]) porAccion[act] = { 'Total': 0, '✓ OK': 0, '⚠️ Inconsistencias': 0 };
                porAccion[act]['Total']++;
                if (op.consistency && !op.consistency.pass) {
                    porAccion[act]['⚠️ Inconsistencias']++;
                } else {
                    porAccion[act]['✓ OK']++;
                }
            });

            rawConsole.table(porAccion);
            return { total, exitos, fallas: fallas.length, tasaExito: `${rate}%`, desglose: porAccion };
        },

        last: function () {
            if (diagState.operations.length === 0) return 'No hay operaciones registradas en el buffer todavía.';
            return diagState.operations[diagState.operations.length - 1];
        }
    };

    if (typeof window !== 'undefined') {
        window.EKKO_DIAG = publicAPI;
        setTimeout(() => { publicAPI.start(); }, 300);
    }

    return publicAPI;
}));
