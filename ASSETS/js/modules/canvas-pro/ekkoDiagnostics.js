/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v9.0 Universal Forensic BlackBox Standard)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
Caja Negra de Diagnóstico, Auditoría Forense y Trazabilidad de 5 Niveles para EKKO Studio.
Supervisa el 100% de los componentes del sistema de forma no invasiva:
- Detección inmediata de botones desconectados, fantasma o clics muertos.
- Validación de transformaciones en el lienzo: arrastre (DRAG), rotación (ROTATE), escalado (RESIZE).
- Auditoría atómica de duplicación (DUPLICATE) con verificación de desfase físico (+20, +20).
- Auditoría de eliminación (DELETE) y saneamiento de selección huérfana.
- Auditoría de descomposición por jerarquía de contención (UNGROUP) y reactividad CSG.
- Auditoría de edición de vértices y subtrazados vectoriales (NODE_EDIT).
- Validación de cada nuevo objeto cargado (texto, imagen, SVG, código QR).
- Registro estricto de CallGraph con duración en milisegundos, errores y módulos intervinientes.
- Compatibilidad absoluta con REPOSITORIO EKKO STUDIO V5 y el Estándar LightBurn / CNC.
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

  // --- CANAL SEGURO DE CONSOLA SIN INTERFERENCIAS ---
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

  // --- ESTADO INTERNO DE LA CAJA NEGRA ---
  const diagState = {
    active: true,
    operations: [],
    currentOp: null,
    opCounter: 0,
    interceptorsInstalled: false,
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

  // =========================================================================
  // REGISTRO UNIVERSAL DE CONTRATOS FUNCIONALES (BOTONES, ATAJOS Y HERRAMIENTAS)
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
  registerContract('#btnaddsvg', {
    name: 'ADD_SVG',
    label: 'Cabecera: Cargar SVG (#btnAddSVG)',
    requiresSelection: false,
    isModalOrPicker: true,
    expectedTopologyDelta: 'ANY',
    expectedSelectionChange: 'ANY'
  });

  registerContract('#btnaddimage', {
    name: 'ADD_IMAGE',
    label: 'Cabecera: Cargar Imagen (#btnAddImage)',
    requiresSelection: false,
    isModalOrPicker: true,
    expectedTopologyDelta: 'ANY',
    expectedSelectionChange: 'ANY'
  });

  registerContract('#btnaddtext', {
    name: 'ADD_TEXT',
    label: 'Cabecera: Agregar Texto (#btnAddText)',
    requiresSelection: false,
    expectedTopologyDelta: 'INCREMENT',
    expectedSelectionChange: 'NEW_ITEM'
  });

  registerContract('#btnaddqr', {
    name: 'ADD_QR',
    label: 'Cabecera: Cargar QR (#btnAddQR)',
    requiresSelection: false,
    isModalOrPicker: true,
    expectedTopologyDelta: 'ANY'
  });

  // 2. Barra Contextual Flotante (#contextual-toolbar)
  registerContract('#btnctxduplicate', {
    name: 'DUPLICATE',
    label: 'Barra Emergente: Duplicar (#btnCtxDuplicate)',
    requiresSelection: true,
    minSelectionCount: 1,
    allowLocked: false,
    expectedTopologyDelta: 'INCREMENT',
    expectedSelectionChange: 'NEW_ITEM',
    verifyDisplacement: true,
    preserveClipping: true
  });

  registerContract('#btnctxdelete', {
    name: 'DELETE',
    label: 'Barra Emergente: Eliminar (#btnCtxDelete)',
    requiresSelection: true,
    minSelectionCount: 1,
    allowLocked: false,
    expectedTopologyDelta: 'DECREMENT',
    expectedSelectionChange: 'CLEARED',
    preserveClipping: false
  });

  registerContract('#btnctxungroup', {
    name: 'UNGROUP',
    label: 'Barra Emergente: Desagrupar (#btnCtxUngroup)',
    requiresSelection: true,
    minSelectionCount: 1,
    allowLocked: false,
    expectedTopologyDelta: 'ANY',
    expectedSelectionChange: 'PRESERVED'
  });

  registerContract('#btnctxgroup', {
    name: 'GROUP',
    label: 'Barra Emergente: Agrupar (#btnCtxGroup)',
    requiresSelection: true,
    minSelectionCount: 2,
    allowLocked: false,
    expectedTopologyDelta: 'DECREASE_OR_EQUAL',
    expectedSelectionChange: 'PRESERVED'
  });

  registerContract('#btnctxtofront', {
    name: 'BRING_TO_FRONT',
    label: 'Barra Emergente: Al Frente (#btnCtxToFront)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedSelectionChange: 'PRESERVED'
  });

  registerContract('#btnctxforward', {
    name: 'BRING_FORWARD',
    label: 'Barra Emergente: Subir Capa (#btnCtxForward)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedSelectionChange: 'PRESERVED'
  });

  registerContract('#btnctxbackward', {
    name: 'SEND_BACKWARD',
    label: 'Barra Emergente: Bajar Capa (#btnCtxBackward)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedSelectionChange: 'PRESERVED'
  });

  registerContract('#btnctxtoback', {
    name: 'SEND_TO_BACK',
    label: 'Barra Emergente: Al Fondo (#btnCtxToBack)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedSelectionChange: 'PRESERVED'
  });

  registerContract('#btnctxnodeedit', {
    name: 'NODE_EDIT',
    label: 'Barra Emergente: Modo Nodos (#btnCtxNodeEdit)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxeditnodes', {
    name: 'NODE_EDIT',
    label: 'Barra Emergente: Editar Nodos (#btnCtxEditNodes)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxexitnodeedit', {
    name: 'EXIT_NODE_EDIT',
    label: 'Barra Emergente: Salir Nodos (#btnCtxExitNodeEdit)',
    requiresSelection: false,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxdeletenode', {
    name: 'DELETE_NODE',
    label: 'Barra Emergente: Eliminar Nodo (#btnCtxDeleteNode)',
    requiresSelection: false,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxdetachsubpath', {
    name: 'DETACH_SUBPATH',
    label: 'Barra Emergente: Desprender Subtrazado (#btnCtxDetachSubpath)',
    requiresSelection: false,
    expectedTopologyDelta: 'INCREMENT'
  });

  registerContract('#btnctxaddnode', {
    name: 'TOGGLE_ADD_NODE',
    label: 'Barra Emergente: Añadir Nodo (#btnCtxAddNode)',
    requiresSelection: false,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxscaledown', {
    name: 'SCALE_DOWN',
    label: 'Barra Emergente: Reducir (#btnCtxScaleDown)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'SCALED'
  });

  registerContract('#btnctxscaleup', {
    name: 'SCALE_UP',
    label: 'Barra Emergente: Agrandar (#btnCtxScaleUp)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'SCALED'
  });

  registerContract('#btnctxfliph', {
    name: 'FLIP_H',
    label: 'Barra Emergente: Volteo Horizontal (#btnCtxFlipH)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxflipv', {
    name: 'FLIP_V',
    label: 'Barra Emergente: Volteo Vertical (#btnCtxFlipV)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxbold', {
    name: 'BOLD',
    label: 'Barra Emergente: Negrita (#btnCtxBold)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxitalic', {
    name: 'ITALIC',
    label: 'Barra Emergente: Cursiva (#btnCtxItalic)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxunderline', {
    name: 'UNDERLINE',
    label: 'Barra Emergente: Subrayado (#btnCtxUnderline)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxweld', {
    name: 'WELD',
    label: 'Barra Emergente: Soldar Texto (#btnCtxWeld)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnctxtrace', {
    name: 'TRACE_IMAGE',
    label: 'Barra Emergente: Trazar Imagen (#btnCtxTrace)',
    requiresSelection: true,
    isModalOrPicker: true,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnctxapplymask', {
    name: 'REMOVE_BG',
    label: 'Barra Emergente: Recortar Fondo (#btnCtxApplyMask)',
    requiresSelection: true,
    isModalOrPicker: true,
    expectedTopologyDelta: 'ANY'
  });

  // 3. Panel Superior de Alineaciones y Distribución (#pro-layout-toolbar)
  ['proBtnAlignLeft', 'proBtnAlignCenterH', 'proBtnAlignRight', 'proBtnAlignTop', 'proBtnAlignCenterV', 'proBtnAlignBottom'].forEach(id => {
    registerContract('#' + id.toLowerCase(), {
      name: 'ALIGN',
      label: `Panel Superior: ${id}`,
      requiresSelection: true,
      minSelectionCount: 1,
      expectedTopologyDelta: 'EQUAL',
      expectedTransformChange: 'MOVED'
    });
  });

  ['proBtnCenterH', 'proBtnCenterV', 'proBtnCenterBoth'].forEach(id => {
    registerContract('#' + id.toLowerCase(), {
      name: 'CENTER_MOCKUP',
      label: `Panel Superior: ${id}`,
      requiresSelection: true,
      minSelectionCount: 1,
      expectedTopologyDelta: 'EQUAL',
      expectedTransformChange: 'MOVED'
    });
  });

  ['proBtnDistributeH', 'proBtnDistributeV'].forEach(id => {
    registerContract('#' + id.toLowerCase(), {
      name: 'DISTRIBUTE',
      label: `Panel Superior: ${id}`,
      requiresSelection: true,
      minSelectionCount: 3,
      expectedTopologyDelta: 'EQUAL',
      expectedTransformChange: 'MOVED'
    });
  });

  registerContract('#probtngroup', {
    name: 'GROUP',
    label: 'Panel Superior: Agrupar (#proBtnGroup)',
    requiresSelection: true,
    minSelectionCount: 2,
    expectedTopologyDelta: 'DECREASE_OR_EQUAL'
  });

  registerContract('#probtnungroup', {
    name: 'UNGROUP',
    label: 'Panel Superior: Desagrupar (#proBtnUngroup)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'ANY'
  });

  // 4. Inferencia Dinámica Universal (Para CUALQUIER herramienta o botón existente o nuevo)
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

    // Inferencia por contenedor si es un elemento interactivo nuevo
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
  // NIVEL 2: CAPTURA DE SELECCIÓN FORENSE
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
      visibleSegments: primary.segments ? primary.segments.length : 0,
      visibleArea: primary.area ? Number(Math.abs(primary.area).toFixed(1)) : 0,
      rotation: primary.rotation !== undefined ? Number(primary.rotation.toFixed(2)) : 0,
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
  // NIVEL 4: CAPTURA DE ESTADO GEOMÉTRICO Y TOPOLOGÍA DE CAPAS (LIENZO)
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
        visibleSegments: item.segments ? item.segments.length : 0,
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
  // NIVEL 5: MOTOR DE CONSISTENCIA Y AUDITORÍA DE CONTRATOS FORENSES
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
      csgIntegrityValid: true
    };

    // 1. Auditoría del Contrato Funcional del Botón
    if (contract) {
      // Precondición de selección
      if (contract.requiresSelection) {
        if (!beforeSel.hasSelection || beforeSel.count < (contract.minSelectionCount || 1)) {
          checks.selectionPreconditionValid = false;
          inconsistencies.push(
            `[PRECONDICIÓN INCUMPLIDA] '${uiSource}' requería al menos ${contract.minSelectionCount || 1} elemento(s) seleccionado(s) (Detectados: ${beforeSel.count}).`
          );
        }
      }

      // Objeto bloqueado
      if (!contract.allowLocked && beforeSel.primary && beforeSel.primary.isLocked) {
        checks.actionExecuted = false;
        inconsistencies.push(
          `[OBJETO BLOQUEADO] Clic en '${uiSource}' sobre objeto bloqueado ID: ${beforeSel.primary.id} ('${beforeSel.primary.label}', locked: true). Acción rechazada.`
        );
      }

      // Variación topológica esperada
      const deltaUseful = afterGeo.totalUsefulItems - beforeGeo.totalUsefulItems;
      if (contract.expectedTopologyDelta === 'INCREMENT') {
        if (deltaUseful <= 0) {
          checks.actionExecuted = false;
          inconsistencies.push(
            `[NO SE DUPLICÓ / CREÓ] La acción '${opType}' no incrementó elementos en el lienzo (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
          );
        }
      } else if (contract.expectedTopologyDelta === 'DECREMENT') {
        if (deltaUseful >= 0) {
          checks.actionExecuted = false;
          inconsistencies.push(
            `[NO SE ELIMINÓ] La acción '${opType}' no redujo la cantidad de capas (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
          );
        }
      } else if (contract.expectedTopologyDelta === 'EQUAL') {
        if (deltaUseful !== 0) {
          inconsistencies.push(
            `[MUTACIÓN TOPOLÓGICA INESPERADA] '${opType}' alteró las capas sin ser su propósito (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
          );
        }
      } else if (contract.expectedTopologyDelta === 'DECREASE_OR_EQUAL') {
        if (deltaUseful > 0) {
          inconsistencies.push(
            `[AGRUPACIÓN ANÓMALA] '${opType}' incrementó capas en vez de consolidarlas.`
          );
        }
      }

      // Selección esperada tras la acción
      if (contract.expectedSelectionChange === 'NEW_ITEM') {
        if (afterSel.primary && beforeSel.primary && afterSel.primary.id === beforeSel.primary.id && beforeSel.count === 1) {
          checks.selectionValid = false;
          inconsistencies.push(
            `[SELECCIÓN NO ACTUALIZADA] El nuevo elemento creado/duplicado no recibió el foco de selección (Sigue en ID: ${beforeSel.primary.id}).`
          );
        }
      } else if (contract.expectedSelectionChange === 'CLEARED') {
        if (afterSel.hasSelection && beforeSel.primary && afterSel.primary && afterSel.primary.id === beforeSel.primary.id) {
          checks.selectionValid = false;
          inconsistencies.push(
            `[SELECCIÓN HUÉRFANA] El elemento ID: ${beforeSel.primary.id} fue eliminado pero la selección activa no se limpió.`
          );
        }
      }

      // Desfase físico obligatorio en duplicación
      if (contract.verifyDisplacement && afterSel.primary && beforeSel.primary && afterSel.primary.position && beforeSel.primary.position) {
        const dx = Math.abs(afterSel.primary.position.x - beforeSel.primary.position.x);
        const dy = Math.abs(afterSel.primary.position.y - beforeSel.primary.position.y);
        if (dx < 1 && dy < 1) {
          inconsistencies.push(
            `[SIN DESFASE VECTORIAL] El clon ID: ${afterSel.primary.id} está superpuesto al original sin vector de desplazamiento (+20, +20).`
          );
        }
      }

      // Preservación de máscara del producto
      if (contract.preserveClipping && beforeSel.primary && beforeSel.primary.isClipped && afterSel.primary && !afterSel.primary.isClipped) {
        checks.productClippingValid = false;
        inconsistencies.push(
          `[PÉRDIDA DE MÁSCARA MOCKUP] El original ID: ${beforeSel.primary.id} estaba contenido en el producto, pero el resultado ID: ${afterSel.primary.id} perdió su máscara.`
        );
      }
    }

    // 2. Detección Universal de Botón Desconectado / Clic Fantasma
    const totalCalls = (op.callGraph && Array.isArray(op.callGraph)) ? op.callGraph.length : 0;
    const isModal = contract && contract.isModalOrPicker;
    let canvasMutated = beforeGeo.totalUsefulItems !== afterGeo.totalUsefulItems;
    if (!canvasMutated && beforeSel.primary && afterSel.primary) {
      const p0 = beforeSel.primary.position;
      const p1 = afterSel.primary.position;
      if (p0 && p1 && (Math.abs(p1.x - p0.x) > 0.1 || Math.abs(p1.y - p0.y) > 0.1)) canvasMutated = true;
    }

    if (opMeta.isButtonClick && totalCalls === 0 && !canvasMutated && !isModal && !opType.includes('TOGGLE')) {
      checks.deadClickDetected = true;
      checks.buttonResponded = false;
      inconsistencies.push(
        `[INCONSISTENCIA CLIC: BOTÓN DESCONECTADO / FANTASMA] Se hizo clic en '${uiSource}', pero ninguna función controladora fue ejecutada y no hubo mutación en el lienzo.`
      );
    }

    // 3. Auditoría de Arrastre en Lienzo (DRAG)
    if (opType === 'DRAG' && beforeSel.primary && afterSel.primary && beforeSel.primary.id === afterSel.primary.id) {
      const p0 = beforeSel.primary.position;
      const p1 = afterSel.primary.position;
      if (p0 && p1) {
        const dx = Math.abs(p1.x - p0.x);
        const dy = Math.abs(p1.y - p0.y);
        if (dx < 0.1 && dy < 0.1) {
          checks.dragDisplacementValid = false;
          inconsistencies.push(
            `[ARRASTRE BLOQUEADO] El objeto ID: ${afterSel.primary.id} (${afterSel.primary.label}) no modificó su posición física tras el arrastre.`
          );
        }
      }
    }

    // 4. Auditoría de Rotación (ROTATE)
    if (opType === 'ROTATE' && beforeSel.primary && afterSel.primary) {
      const r0 = beforeSel.primary.rotation || 0;
      const r1 = afterSel.primary.rotation || 0;
      if (Math.abs(r1 - r0) < 0.1) {
        checks.rotationValid = false;
        inconsistencies.push(
          `[ROTACIÓN BLOQUEADA] Se accionó el tirador de rotación pero el ángulo permaneció congelado (${r0}°).`
        );
      }
    }

    // 5. Auditoría de Escalado (RESIZE)
    if (opType === 'RESIZE' && beforeSel.primary && afterSel.primary && beforeSel.primary.bounds && afterSel.primary.bounds) {
      const dw = Math.abs(afterSel.primary.bounds.width - beforeSel.primary.bounds.width);
      const dh = Math.abs(afterSel.primary.bounds.height - beforeSel.primary.bounds.height);
      if (dw < 0.2 && dh < 0.2) {
        checks.scaleValid = false;
        inconsistencies.push(
          `[ESCALADO FALLIDO] Se arrastró el tirador de redimensionamiento pero las dimensiones permanecieron idénticas.`
        );
      }
    }

    // 6. Auditoría de Desagrupación y Pérdida de Capas (UNGROUP)
    if (opType === 'UNGROUP') {
      if (beforeGeo.totalUsefulItems > 0 && afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
        checks.itemLossDetected = true;
        const lostCount = beforeGeo.totalUsefulItems - afterGeo.totalUsefulItems;
        inconsistencies.push(
          `[PÉRDIDA DE PIEZAS EN DESAGRUPAR] Se destruyeron ${lostCount} elementos útiles durante la descomposición vectorial.`
        );
      }
    }

    // 7. Auditoría de Preservación de Geometría Base (geomBase)
    if (beforeSel.primary && beforeSel.primary.hasGeomBase && afterSel.primary && !afterSel.primary.hasGeomBase) {
      checks.geomBasePreserved = false;
      inconsistencies.push(
        `[DESTRUCCIÓN DE GEOMBASE] El elemento ID: ${afterSel.primary.id} perdió su geometría base local ('data.geomBase'). La reactividad CSG ha quedado inerte.`
      );
    }

    // 8. Auditoría de Creación de Objetos Nuevos (ADD_TEXT, ADD_IMAGE, IMPORT_SVG, ADD_QR)
    if (['ADD_TEXT', 'ADD_IMAGE', 'IMPORT_SVG', 'ADD_QR'].includes(opType)) {
      if (afterGeo.totalUsefulItems <= beforeGeo.totalUsefulItems && !isModal) {
        inconsistencies.push(
          `[OBJETO NO CARGADO] Se intentó ejecutar '${opType}', pero ningún objeto útil se incorporó a la capa de diseño.`
        );
      }
    }

    const pass = inconsistencies.length === 0;
    return { checks, inconsistencies, pass };
  }

  // =========================================================================
  // CICLO DE VIDA FORENSE (NIVELES 1 Y 3: OPERACIONES Y CALLGRAPH)
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
    if (diagState.operations.length > 500) diagState.operations.shift();

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
        `%c[${op.id}] ${op.action.padEnd(14)}%c | ✓ OK (${op.durationMs}ms) | Origen: ${op.source} | ${selDesc} | ${geoDesc}`,
        'color: #0284c7; font-weight: bold;',
        'color: #10b981;'
      );
    } else {
      rawConsole.warn(
        `%c[${op.id}] ${op.action.padEnd(14)}%c | ⚠️ INCONSISTENCIA DETECTADA (${op.durationMs}ms) | Origen: ${op.source} | ${selDesc}`,
        'color: #ea580c; font-weight: bold;',
        'color: #ef4444; font-weight: bold;'
      );
      op.consistency.inconsistencies.forEach(inc => {
        rawConsole.error(`   ↳ ${inc}`);
      });
    }
  }

  // Envoltorio de Funciones Globales para Registro en CallGraph
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
        if (!hasExisting && op) endOperation();
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
  // INTERCEPTORES GLOBALES DE EVENTOS (DOM, TECLADO Y LIENZO)
  // =========================================================================
  function installDOMCaptureListeners() {
    if (typeof document === 'undefined') return;

    // A) Clic en cualquier Botón o Elemento Interactivo
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
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (document.activeElement && document.activeElement.id === 'ekko-text-editor') return;

      const key = e.key;
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
      } else if (key === 'Delete' || key === 'Backspace') {
        action = 'DELETE';
      } else if (key === 'PageUp') {
        action = isCtrl ? 'BRING_TO_FRONT' : 'BRING_FORWARD';
      } else if (key === 'PageDown') {
        action = isCtrl ? 'SEND_TO_BACK' : 'SEND_BACKWARD';
      }

      if (action) {
        const op = beginOperation(action, `Atajo Teclado (${(isCtrl ? 'Ctrl+' : '') + key})`);
        setTimeout(() => { if (diagState.currentOp === op) endOperation(); }, 120);
      }
    }, true);

    // C) Eventos en el Lienzo (#editorCanvas)
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
            // Clic sin desplazamiento: Selección / Deselección
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

  // =========================================================================
  // INSTALACIÓN EXHAUSTIVA DE INTERCEPTORES EN MÓDULOS DE EKKO STUDIO V5
  // =========================================================================
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
      ['centerSelection', 'canvasControlsIntegration.js', 'CENTER'],
      ['undo', 'editor.js', 'UNDO'],
      ['redo', 'editor.js', 'REDO'],
      ['saveHistory', 'editor.js', 'SAVE_HISTORY'],
      ['prepareSVGForExport', 'exportSVG.js', 'PREPARE_EXPORT'],
      ['downloadExportedSVG', 'exportSVG.js', 'EXPORT_SVG'],
      ['traceRasterContours', 'imageTracer.js', 'TRACE_CONTOURS'],
      ['applyMaskToRaster', 'backgroundRemover.js', 'APPLY_MASK']
    ];

    functionsToWrap.forEach(([fn, mod, act]) => forceWrapWindowFunction(fn, mod, act));

    // Hook seguro en la importación de SVG de Paper.js
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
  // API PÚBLICA UNIVERSAL EKKO_DIAG
  // =========================================================================
  const publicAPI = {
    start: function () {
      diagState.active = true;
      installAllInterceptors();
      rawConsole.log('%c[EKKO_DIAG v9.0 Universal Forensic BlackBox] Activo 🟢 - Supervisión Continua sin Puntos Ciegos', 'color: #10b981; font-weight: bold; font-size: 13px;');
      return 'EKKO_DIAG v9.0 Activo. Monitoreando automáticamente herramientas, botones, transformaciones y objetos nuevos.';
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
      return 'Historial de operaciones limpiado.';
    },
    registerButtonContract: function (idOrSelector, contractConfig) {
      registerContract(idOrSelector, contractConfig);
      rawConsole.log(`%c[EKKO_DIAG] Contrato registrado para '${idOrSelector}'`, 'color: #0284c7;');
      return true;
    },
    report: function () {
      const ops = diagState.operations;
      let out = '╔══════════════════════════════════════════════════════════════════════════════════╗\n';
      out += '║      EKKO STUDIO DIAGNOSTIC v9.0 - ESTÁNDAR UNIVERSAL DE CONTRATOS FORENSES      ║\n';
      out += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';
      out += `Total Operaciones Auditadas: ${ops.length}\n\n`;

      ops.forEach(op => {
        const pass = op.consistency && op.consistency.pass ? '✓ OK' : '⚠ INCONSISTENCIA';
        out += `[${op.id}] ${op.action.padEnd(16)} | ${pass.padEnd(16)} | ${op.durationMs}ms | Origen: ${op.source}\n`;
        if (op.consistency && !op.consistency.pass) {
          op.consistency.inconsistencies.forEach(inc => {
            out += `   ↳ ${inc}\n`;
          });
        }
      });
      rawConsole.log(out);
      return out;
    },
    dump: function () {
      const rep = this.report();
      const payload = rep + '\n\n--- DETALLE FORENSE COMPLETO (JSON) ---\n' + JSON.stringify(diagState.operations, null, 2);
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload).then(() => {
          rawConsole.log('%c[EKKO_DIAG] Diagnóstico forense copiado al portapapeles con éxito.', 'color: #10b981; font-weight: bold;');
        }).catch(() => {});
      }
      return payload;
    },
    last: function () {
      if (diagState.operations.length === 0) return 'No hay operaciones registradas.';
      return diagState.operations[diagState.operations.length - 1];
    }
  };

  if (typeof window !== 'undefined') {
    window.EKKO_DIAG = publicAPI;
    setTimeout(() => { publicAPI.start(); }, 300);
  }

  return publicAPI;
}));
