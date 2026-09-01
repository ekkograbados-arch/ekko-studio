/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v8.0 Universal Dynamic Button Standard)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
Sistema Universal de Diagnóstico, Auditoría Forense y Trazabilidad de 5 Niveles para EKKO Studio.
Implementa el Estándar Universal de Contratos Funcionales para evaluar inconsistencias
en cualquier botón existente o nuevo (Barra Emergente, Panel Superior Fijo, Cabecera o Lienzo).

Cumple estrictamente con:
- PROMPT MAESTRO — EKKO UNIVERSAL DIAGNOSTIC & TOOL INTEGRATION SYSTEM
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- Diagnostico_v2.txt (Protocolo Universal de 11 Fases y 20 Puntos)
- nuevos comandos a crear.txt (Auditoría Forense de 5 Niveles con ID de Operación)
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

  // Canal seguro de salida de consola
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

  // Estado interno del motor de diagnóstico
  const diagState = {
    active: true,
    operations: [],
    currentOp: null,
    opCounter: 0,
    interceptorsInstalled: false,
    lastMouseDownPoint: null,
    lastMouseDownSelection: null,
    lastMouseDownGeo: null
  };

  // =========================================================================
  // ESTÁNDAR UNIVERSAL DE CONTRATOS FUNCIONALES DE BOTONES (REGISTRO CENTRAL)
  // =========================================================================
  const buttonContractsRegistry = new Map();

  function registerContract(idOrSelector, contractDef) {
    if (!idOrSelector || !contractDef) return;
    const cleanKey = String(idOrSelector).trim().toLowerCase();
    buttonContractsRegistry.set(cleanKey, Object.assign({
      requiresSelection: true,
      minSelectionCount: 1,
      allowLocked: false,
      expectedTopologyDelta: 'EQUAL', // 'INCREMENT', 'DECREMENT', 'EQUAL', 'DECREASE_OR_EQUAL', 'ANY'
      expectedSelectionChange: 'PRESERVED', // 'NEW_ITEM', 'CLEARED', 'PRESERVED', 'ANY'
      expectedTransformChange: 'ANY', // 'MOVED', 'SCALED', 'ROTATED', 'ANY'
      verifyDisplacement: false,
      preserveClipping: true,
      customValidator: null
    }, contractDef));
  }

  // Precarga estándar de botones existentes
  // A) Barra Emergente / Menú Contextual (#contextual-toolbar)
    registerContract('#btnctxdeletenode', {
    name: 'DELETE_NODE',
    label: 'Barra Emergente: Eliminar Nodo (#btnCtxDeleteNode)',
    requiresSelection: false,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnctxdetachsubpath', {
    name: 'DETACH_SUBPATH',
    label: 'Barra Emergente: Desprender Nodos (#btnCtxDetachSubpath)',
    requiresSelection: false,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnctxaddnode', {
    name: 'TOGGLE_ADD_NODE',
    label: 'Barra Emergente: Añadir Nodo (#btnCtxAddNode)',
    requiresSelection: false,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnctxexitnodeedit', {
    name: 'EXIT_NODE_EDIT',
    label: 'Barra Emergente: Salir Edición Nodos (#btnCtxExitNodeEdit)',
    requiresSelection: false,
    expectedTopologyDelta: 'ANY'
  });

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

  registerContract('#btnctxscaledown', {
    name: 'SCALE_DOWN',
    label: 'Barra Emergente: Achicar (#btnCtxScaleDown)',
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

  registerContract('#btnctxforward', {
    name: 'BRING_FORWARD',
    label: 'Barra Emergente: Subir Capa (#btnCtxForward)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxbackward', {
    name: 'SEND_BACKWARD',
    label: 'Barra Emergente: Bajar Capa (#btnCtxBackward)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxgroup', {
    name: 'GROUP',
    label: 'Barra Emergente: Agrupar (#btnCtxGroup)',
    requiresSelection: true,
    minSelectionCount: 2,
    expectedTopologyDelta: 'DECREASE_OR_EQUAL',
    expectedSelectionChange: 'PRESERVED'
  });

  registerContract('#btnctxungroup', {
    name: 'UNGROUP',
    label: 'Barra Emergente: Desagrupar (#btnCtxUngroup)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'ANY',
    expectedSelectionChange: 'PRESERVED'
  });

  registerContract('#btnctxnodeedit', {
    name: 'NODE_EDIT',
    label: 'Barra Emergente: Editar Nodos (#btnCtxNodeEdit)',
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

  registerContract('#btnctxfliph', {
    name: 'FLIP_H',
    label: 'Barra Emergente: Espejo Horizontal (#btnCtxFlipH)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#btnctxflipv', {
    name: 'FLIP_V',
    label: 'Barra Emergente: Espejo Vertical (#btnCtxFlipV)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
  });

  // B) Panel Superior Fijo (#pro-layout-toolbar)
  registerContract('#probtnalignleft', {
    name: 'ALIGN_LEFT',
    label: 'Panel Superior: Alinear Izquierda (#proBtnAlignLeft)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtnaligncenterh', {
    name: 'ALIGN_CENTER_H',
    label: 'Panel Superior: Centrar Horizontal (#proBtnAlignCenterH)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtnalignright', {
    name: 'ALIGN_RIGHT',
    label: 'Panel Superior: Alinear Derecha (#proBtnAlignRight)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtnaligntop', {
    name: 'ALIGN_TOP',
    label: 'Panel Superior: Alinear Arriba (#proBtnAlignTop)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtnaligncenterv', {
    name: 'ALIGN_CENTER_V',
    label: 'Panel Superior: Centrar Vertical (#proBtnAlignCenterV)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtnalignbottom', {
    name: 'ALIGN_BOTTOM',
    label: 'Panel Superior: Alinear Abajo (#proBtnAlignBottom)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtncenterh', {
    name: 'CENTER_MOCKUP_H',
    label: 'Panel Superior: Centrar Mockup H (#proBtnCenterH)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtncenterv', {
    name: 'CENTER_MOCKUP_V',
    label: 'Panel Superior: Centrar Mockup V (#proBtnCenterV)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtncenterboth', {
    name: 'CENTER_MOCKUP_BOTH',
    label: 'Panel Superior: Centrar Mockup Total (#proBtnCenterBoth)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL',
    expectedTransformChange: 'MOVED'
  });

  registerContract('#probtndistributeh', {
    name: 'DISTRIBUTE_H',
    label: 'Panel Superior: Distribuir Horizontal (#proBtnDistributeH)',
    requiresSelection: true,
    minSelectionCount: 3,
    expectedTopologyDelta: 'EQUAL'
  });

  registerContract('#probtndistributev', {
    name: 'DISTRIBUTE_V',
    label: 'Panel Superior: Distribuir Vertical (#proBtnDistributeV)',
    requiresSelection: true,
    minSelectionCount: 3,
    expectedTopologyDelta: 'EQUAL'
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

  // C) Barra de Cabecera (#topBar)
  registerContract('#btnaddimage', {
    name: 'ADD_IMAGE',
    label: 'Cabecera: Cargar Imagen (#btnAddImage)',
    requiresSelection: false,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnaddtext', {
    name: 'ADD_TEXT',
    label: 'Cabecera: Agregar Texto (#btnAddText)',
    requiresSelection: false,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnaddsvg', {
    name: 'ADD_SVG',
    label: 'Cabecera: Cargar SVG (#btnAddSVG)',
    requiresSelection: false,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnaddqr', {
    name: 'ADD_QR',
    label: 'Cabecera: Cargar QR (#btnAddQR)',
    requiresSelection: false,
    expectedTopologyDelta: 'ANY'
  });

  // Resolución Dinámica Universal (para botones existentes o NUEVOS creados)
  function resolveButtonContract(domElement) {
    if (!domElement || !(domElement instanceof Element)) return null;

    // 1. Búsqueda por ID directo
    if (domElement.id) {
      const byId = buttonContractsRegistry.get('#' + domElement.id.toLowerCase());
      if (byId) return { contract: byId, matchedBy: '#' + domElement.id };
    }

    // 2. Búsqueda por atributo data-action o comando
    const actionAttr = domElement.getAttribute('data-action') ||
                       domElement.getAttribute('data-ekko-action') ||
                       domElement.getAttribute('data-command');
    if (actionAttr) {
      const byAttr = buttonContractsRegistry.get(actionAttr.toLowerCase().trim());
      if (byAttr) return { contract: byAttr, matchedBy: `[data-action="${actionAttr}"]` };
    }

    // 3. Búsqueda por selector registrado en padres
    for (const [key, contract] of buttonContractsRegistry.entries()) {
      if (key.startsWith('#') || key.startsWith('.') || key.startsWith('[')) {
        try {
          if (domElement.matches(key) || domElement.closest(key)) {
            return { contract: contract, matchedBy: key };
          }
        } catch (e) {}
      }
    }

    // 4. Inferencia Dinámica Universal para botones NUEVOS no registrados
    const isContextual = !!domElement.closest('#contextual-toolbar, .contextual-toolbar');
    const isProLayout = !!domElement.closest('#pro-layout-toolbar, .pro-layout-toolbar');
    const isTopBar = !!domElement.closest('#topBar, .topBar, #mainNavbar');

    if (isContextual || isProLayout || isTopBar) {
      const containerName = isContextual ? 'Barra Emergente' : (isProLayout ? 'Panel Superior Fijo' : 'Barra de Cabecera');
      const textLabel = domElement.textContent ? domElement.textContent.trim().substring(0, 25) : '';
      const actionName = (actionAttr || domElement.id || textLabel || 'DYNAMIC_BUTTON')
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_');

      return {
        contract: {
          name: actionName,
          label: `${containerName}: Botón Dinámico '${textLabel || domElement.id || '<button>'}'`,
          requiresSelection: isContextual || isProLayout,
          minSelectionCount: 1,
          allowLocked: false,
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

  // --- HELPERS DE EXTRACCIÓN Y SNAPSHOT ---

  function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
      if (!item.children) return item;
      const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
      if (content) return content;
      const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
      if (fallback) return fallback;
      return item.children[1] || item.children[0] || item;
    }
    return item;
  }

  function isLockedItem(item) {
    return !!(item && item.data && item.data.locked === true);
  }

  function extractBounds(bounds) {
    if (!bounds) return null;
    return {
      x: Number(bounds.x.toFixed(1)),
      y: Number(bounds.y.toFixed(1)),
      width: Number(bounds.width.toFixed(1)),
      height: Number(bounds.height.toFixed(1))
    };
  }

  function countSegments(item) {
    if (!item) return 0;
    if (item.segments) return item.segments.length;
    if (item.children && Array.isArray(item.children)) {
      return item.children.reduce((acc, c) => acc + countSegments(c), 0);
    }
    return 0;
  }

  function calculateItemArea(item) {
    if (!item) return 0;
    if (typeof item.area === 'number' && !isNaN(item.area)) {
      return Math.abs(item.area);
    }
    if (item.children && Array.isArray(item.children)) {
      return item.children.reduce((acc, c) => acc + calculateItemArea(c), 0);
    }
    if (item.bounds && item.bounds.width > 0 && item.bounds.height > 0) {
      return item.bounds.width * item.bounds.height;
    }
    return 0;
  }

  function isMockupOrUI(item) {
    let curr = item;
    while (curr) {
      const d = curr.data || {};
      if (d.mockup || d.isMask || d.wasClipMask || d.isSelectionBox || d.isHandle ||
          d.isNodeHandle || d.isCurveHandle || d.isNodeEditOverlay || d.isSmartGuide ||
          d.isMeasurement || d.isTracePreview) {
        return true;
      }
      curr = curr.parent;
    }
    return false;
  }

  // Snapshot de Nivel 2: Selección y contexto del objeto
  function snapshotSelection() {
    const item = typeof window !== 'undefined' ? (window.selectedItem || null) : null;
    const selectedItems = typeof window !== 'undefined' ? (window.selectedItems || []) : [];

    if (!item && selectedItems.length === 0) {
      return { hasSelection: false, primary: null, count: 0, ids: [] };
    }

    const primary = item || selectedItems[0];
    const target = getContentItem(primary);

    const targetPos = target && target.position ? {
      x: Number(target.position.x.toFixed(1)),
      y: Number(target.position.y.toFixed(1))
    } : null;

    const primaryData = primary ? {
      id: primary.id,
      contentId: target ? target.id : primary.id,
      className: target ? target.className : primary.className,
      label: (target && target.data && target.data.label) || (primary.data && primary.data.label) || 'Objeto',
      zIndex: typeof primary.index === 'number' ? primary.index : 0,
      isHole: !!(target && target.data && target.data.isHole),
      isClipped: !!(primary.data && primary.data.clipGroup),
      hasGeomBase: !!(target && target.data && target.data.geomBase),
      geomBaseSegments: countSegments(target && target.data && target.data.geomBase),
      visibleSegments: countSegments(target || primary),
      visibleArea: Number(calculateItemArea(target || primary).toFixed(1)),
      bounds: target ? extractBounds(target.bounds) : extractBounds(primary.bounds),
      position: targetPos,
      isLocked: isLockedItem(primary),
      fontSize: (target && target.fontSize) || (target && target.data && target.data.fontSize) || null,
      fontWeight: (target && target.fontWeight) || (target && target.data && target.data.fontWeight) || null,
      fontStyle: (target && target.fontStyle) || (target && target.data && target.data.fontStyle) || null
    } : null;

    return {
      hasSelection: true,
      count: selectedItems.length > 0 ? selectedItems.length : 1,
      ids: selectedItems.length > 0 ? selectedItems.map(i => i.id) : [primary.id],
      primary: primaryData
    };
  }

  // Snapshot de Nivel 4: Estado Geométrico y Topología del Lienzo
  function snapshotGeometricState() {
    if (typeof paper === 'undefined' || !paper.project) {
      return { totalUsefulItems: 0, itemsSummary: [], massCount: 0, holeCount: 0, zOrderIds: [], error: 'Paper.js no inicializado' };
    }

    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    if (!designLayer || !designLayer.children) {
      return { totalUsefulItems: 0, itemsSummary: [], massCount: 0, holeCount: 0, zOrderIds: [] };
    }

    const items = [];
    let massCount = 0;
    let holeCount = 0;

    designLayer.children.forEach((child, index) => {
      if (isMockupOrUI(child)) return;
      const target = getContentItem(child);
      if (!target) return;

      const isHole = !!(target.data && target.data.isHole);
      if (isHole) holeCount++; else massCount++;

      const gBase = target.data && target.data.geomBase;
      const vArea = calculateItemArea(target);

      items.push({
        index: index,
        id: child.id,
        contentId: target.id,
        className: target.className,
        label: (target.data && target.data.label) || (child.data && child.data.label) || 'Objeto',
        isHole: isHole,
        isClipped: !!(child.data && child.data.clipGroup),
        hasGeomBase: !!gBase,
        geomBaseSegments: countSegments(gBase),
        visibleSegments: countSegments(target),
        visibleArea: Number(vArea.toFixed(1)),
        bounds: extractBounds(target.bounds),
        position: target.position ? { x: Number(target.position.x.toFixed(1)), y: Number(target.position.y.toFixed(1)) } : null
      });
    });

    return {
      timestamp: Date.now(),
      totalUsefulItems: items.length,
      massCount: massCount,
      holeCount: holeCount,
      zOrderIds: items.map(it => it.id),
      itemsSummary: items
    };
  }

  // =========================================================================
  // NIVEL 5 — MOTOR DE CONSISTENCIA Y AUDITORÍA UNIVERSAL DE CONTRATOS
  // =========================================================================
  function auditConsistency(op) {
    const beforeGeo = op.geometryBefore;
    const afterGeo = op.geometryAfter;
    const beforeSel = op.selectionBefore;
    const afterSel = op.selectionAfter;
    const callLog = op.callGraph || [];
    const opType = op.action;
    const opMeta = op.meta || {};
    const contract = op.buttonContract || null;
    const uiSource = op.source || 'UI';

    const inconsistencies = [];
    const checks = {
      actionExecuted: true,
      buttonResponded: true,
      selectionPreconditionValid: true,
      itemLossDetected: false,
      dragDisplacementValid: true,
      geomBasePreserved: true,
      selectionValid: true,
      productClippingValid: true,
      deadClickDetected: false,
      zOrderConsistent: true
    };

    if (beforeGeo.error || afterGeo.error) {
      return { checks, inconsistencies, pass: true };
    }

    // --- REGLA 1: VALIDACIÓN DE CONTRATOS ESTÁNDAR (EXISTENTES O DINÁMICOS) ---
    if (contract) {
      // A) Precondición de selección
      if (contract.requiresSelection) {
        if (!beforeSel.hasSelection || beforeSel.count < (contract.minSelectionCount || 1)) {
          checks.selectionPreconditionValid = false;
          inconsistencies.push(
            `[INCONSISTENCIA CLIC: SELECCIÓN INSUFICIENTE] Se hizo clic en '${uiSource}', pero requiere al menos ${contract.minSelectionCount || 1} objeto(s) seleccionado(s) (Detectados: ${beforeSel.count}).`
          );
        }
      }

      // B) Objeto bloqueado
      if (!contract.allowLocked && beforeSel.primary && beforeSel.primary.isLocked) {
        checks.actionExecuted = false;
        inconsistencies.push(
          `[INCONSISTENCIA CLIC: OBJETO BLOQUEADO] Clic en '${uiSource}' sobre objeto bloqueado ID: ${beforeSel.primary.id} ('${beforeSel.primary.label}', locked: true). La acción fue rechazada.`
        );
      }

      // C) Mutación topológica esperada (INCREMENT, DECREMENT, EQUAL, etc.)
      const deltaUseful = afterGeo.totalUsefulItems - beforeGeo.totalUsefulItems;
      if (contract.expectedTopologyDelta === 'INCREMENT') {
        if (deltaUseful <= 0) {
          checks.actionExecuted = false;
          inconsistencies.push(
            `[INCONSISTENCIA CLIC: NO SE DUPLICÓ/CREÓ] Se hizo clic en '${uiSource}' sobre '${beforeSel.primary ? beforeSel.primary.label : 'Objeto'}' (ID: ${beforeSel.primary ? beforeSel.primary.id : 'N/A'}), pero la cantidad de elementos en el lienzo no aumentó (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}). Fallo de clonación o evento desvinculado.`
          );
        }
      } else if (contract.expectedTopologyDelta === 'DECREMENT') {
        if (deltaUseful >= 0) {
          checks.actionExecuted = false;
          inconsistencies.push(
            `[INCONSISTENCIA CLIC: NO SE ELIMINÓ] Se hizo clic en '${uiSource}', pero el elemento sigue existiendo en el lienzo (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
          );
        }
      } else if (contract.expectedTopologyDelta === 'EQUAL') {
        if (deltaUseful !== 0) {
          inconsistencies.push(
            `[INCONSISTENCIA CLIC: TOPOLOGÍA ALTERADA] La acción '${opType}' alteró inesperadamente la cantidad de capas (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
          );
        }
      } else if (contract.expectedTopologyDelta === 'DECREASE_OR_EQUAL') {
        if (deltaUseful > 0) {
          inconsistencies.push(
            `[INCONSISTENCIA CLIC: AGRUPACIÓN ANÓMALA] La acción '${opType}' incrementó capas en lugar de consolidarlas.`
          );
        }
      }

      // D) Cambio de Selección Esperado
      if (contract.expectedSelectionChange === 'NEW_ITEM') {
        if (afterSel.primary && beforeSel.primary && afterSel.primary.id === beforeSel.primary.id && beforeSel.count === 1) {
          checks.selectionValid = false;
          inconsistencies.push(
            `[INCONSISTENCIA CLIC: SELECCIÓN NO ACTUALIZADA] El objeto fue procesado/duplicado pero la selección permanece en el original (ID: ${beforeSel.primary.id}) en lugar de enfocarse en el nuevo clon.`
          );
        }
      } else if (contract.expectedSelectionChange === 'CLEARED') {
        if (afterSel.hasSelection && beforeSel.primary && afterSel.primary && afterSel.primary.id === beforeSel.primary.id) {
          checks.selectionValid = false;
          inconsistencies.push(
            `[INCONSISTENCIA CLIC: SELECCIÓN HUÉRFANA] El elemento ID: ${beforeSel.primary.id} fue eliminado pero window.selectedItem sigue apuntando a él.`
          );
        }
      }

      // E) Desplazamiento visual (caso Duplicar)
      if (contract.verifyDisplacement && afterSel.primary && beforeSel.primary && afterSel.primary.position && beforeSel.primary.position) {
        const dx = Math.abs(afterSel.primary.position.x - beforeSel.primary.position.x);
        const dy = Math.abs(afterSel.primary.position.y - beforeSel.primary.position.y);
        if (dx < 1 && dy < 1) {
          inconsistencies.push(
            `[INCONSISTENCIA CLIC: SIN DESPLAZAMIENTO] El objeto duplicado ID: ${afterSel.primary.id} fue insertado en las mismas coordenadas exactas del original (x:${afterSel.primary.position.x}, y:${afterSel.primary.position.y}) sin desfase visual.`
          );
        }
      }

      // F) Preservación de recorte de Mockup
      if (contract.preserveClipping && beforeSel.primary && beforeSel.primary.isClipped && afterSel.primary && !afterSel.primary.isClipped) {
        checks.productClippingValid = false;
        inconsistencies.push(
          `[INCONSISTENCIA CLIC: PÉRDIDA DE RECORTE] El original ID: ${beforeSel.primary.id} estaba contenido en producto (clipGroup: true), pero el resultado ID: ${afterSel.primary.id} quedó huérfano sin máscara.`
        );
      }

      // G) Validador personalizado del contrato
      if (typeof contract.customValidator === 'function') {
        try {
          const customRes = contract.customValidator(op, beforeGeo, afterGeo, beforeSel, afterSel);
          if (customRes && customRes.inconsistency) {
            inconsistencies.push(customRes.inconsistency);
          }
        } catch (e) {
          inconsistencies.push(`[ERROR EN VALIDADOR DE CONTRATO] ${e.message}`);
        }
      }
    }

    // --- REGLA 2: DETECCIÓN UNIVERSAL DE CLIC FANTASMA / BOTÓN DESCONECTADO ---
    const totalCalls = callLog.length;
    let canvasMutated = false;

    if (beforeGeo.totalUsefulItems !== afterGeo.totalUsefulItems ||
        beforeGeo.massCount !== afterGeo.massCount ||
        beforeGeo.holeCount !== afterGeo.holeCount) {
      canvasMutated = true;
    }

    if (!canvasMutated && beforeSel.primary && afterSel.primary && beforeSel.primary.position && afterSel.primary.position) {
      const dx = Math.abs(beforeSel.primary.position.x - afterSel.primary.position.x);
      const dy = Math.abs(beforeSel.primary.position.y - afterSel.primary.position.y);
      if (dx > 0.1 || dy > 0.1) canvasMutated = true;
    }

    if (opMeta.isButtonClick && totalCalls === 0 && !canvasMutated && !opType.includes('TOGGLE') && !opType.includes('MODAL')) {
      checks.deadClickDetected = true;
      checks.buttonResponded = false;
      inconsistencies.push(
        `[INCONSISTENCIA CLIC: BOTÓN DESCONECTADO / FANTASMA] Se hizo clic en '${uiSource}', pero ninguna función controladora fue ejecutada y no hubo mutación en el lienzo. Verifica el listener onclick o el selector DOM del botón.`
      );
    }

    // --- REGLA 3: AUDITORÍA DE PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN ---
    if (opType === 'UNGROUP') {
      if (beforeGeo.totalUsefulItems > 0 && afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
        checks.itemLossDetected = true;
        const lostCount = beforeGeo.totalUsefulItems - afterGeo.totalUsefulItems;
        const afterIds = new Set(afterGeo.zOrderIds);
        const lostIds = beforeGeo.zOrderIds.filter(id => !afterIds.has(id));
        inconsistencies.push(
          `[PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN] Se perdieron ${lostCount} elementos útiles. IDs desaparecidos: [${lostIds.join(', ')}].`
        );
      }
    }

    // --- REGLA 4: ARRASTRE BLOQUEADO (DRAG) ---
    if (opType === 'DRAG') {
      if (beforeSel.primary && afterSel.primary && beforeSel.primary.id === afterSel.primary.id) {
        const p0 = beforeSel.primary.position;
        const p1 = afterSel.primary.position;
        if (p0 && p1) {
          const dx = Math.abs(p1.x - p0.x);
          const dy = Math.abs(p1.y - p0.y);
          if (dx < 0.1 && dy < 0.1) {
            checks.dragDisplacementValid = false;
            inconsistencies.push(
              `[ARRASTRE BLOQUEADO] El objeto ID: ${afterSel.primary.id} (${afterSel.primary.label}) no modificó su posición física durante el arrastre.`
            );
          }
        }
      }
    }

    const pass = inconsistencies.length === 0;
    return { checks, inconsistencies, pass };
  }

  // Iniciar Operación Forense
  function beginOperation(actionName, sourceDesc, meta) {
    if (!diagState.active) return null;

    diagState.opCounter++;
    const padId = String(diagState.opCounter).padStart(5, '0');
    const opId = `OP-${padId}`;

    const op = {
      id: opId,
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

  // Finalizar Operación Forense
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
    const selDesc = sel ? `ID: ${sel.id} (${sel.className}) | Z: ${sel.zIndex} | ${sel.isHole ? '🕳️ CALADO' : '⬛ MASA'}` : 'Sin selección';
    const geoDesc = `Capas: ${op.geometryAfter.totalUsefulItems} (Masas: ${op.geometryAfter.massCount}, Calados: ${op.geometryAfter.holeCount})`;

    if (pass) {
      rawConsole.log(
        `%c[${op.id}] ${op.action}%c | ✓ OK (${op.durationMs}ms) | Origen: ${op.source} | ${selDesc} | ${geoDesc}`,
        'color: #0284c7; font-weight: bold;',
        'color: #10b981;'
      );
    } else {
      rawConsole.warn(
        `%c[${op.id}] ${op.action}%c | ⚠️ INCONSISTENCIA DETECTADA (${op.durationMs}ms) | Origen: ${op.source} | ${selDesc}`,
        'color: #ea580c; font-weight: bold;',
        'color: #ef4444;'
      );
      op.consistency.inconsistencies.forEach(inc => {
        rawConsole.error(`   ↳ ${inc}`);
      });
    }
  }

  // --- INTERCEPTORES DE FUNCIONES GLOBALES ---
  function forceWrapWindowFunction(fnName, modulePath, actionType) {
    if (typeof window === 'undefined') return;
    let original = window[fnName];
    if (typeof original !== 'function') return;

    const wrapped = function (...args) {
      const hasExisting = !!diagState.currentOp;
      let op = null;

      if (diagState.active && !hasExisting && actionType) {
        op = beginOperation(actionType, `${modulePath} -> ${fnName}`);
      }

      const t0 = performance.now();
      let res, err = null;

      try {
        res = original.apply(this, args);
      } catch (e) {
        err = e;
        throw e;
      } finally {
        const t1 = performance.now();
        if (diagState.currentOp) {
          diagState.currentOp.callGraph.push({
            fnName: fnName,
            module: modulePath,
            durationMs: Number((t1 - t0).toFixed(1)),
            error: err ? err.message : null
          });
        }
        if (op) {
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
  // CAPTURA UNIVERSAL DE CLICS EN UI (ESTÁNDAR PARA CUALQUIER BOTÓN)
  // =========================================================================
  function installDOMCaptureListeners() {
    if (typeof document === 'undefined') return;

    document.addEventListener('click', function (e) {
      if (!diagState.active) return;
      const target = e.target;
      if (!target) return;

      // Buscar si el clic fue sobre un botón interactivo
      const interactiveEl = target.closest('button, [role="button"], .ctx-btn, .pro-btn, [data-action], a.btn');
      if (!interactiveEl) return;

      // Resolver contrato funcional (registrado o inferido dinámicamente)
      const resolved = resolveButtonContract(interactiveEl);
      if (!resolved) return;

      const contract = resolved.contract;
      const actionName = contract.name || 'BUTTON_CLICK';
      const triggerSource = contract.label || `Botón (${resolved.matchedBy})`;

      const op = beginOperation(actionName, triggerSource, {
        isButtonClick: true,
        domElementId: interactiveEl.id || null,
        domClass: interactiveEl.className || null,
        resolvedContract: contract,
        matchedBy: resolved.matchedBy
      });

      // Ventana de captura asíncrona para registrar la propagación completa
      setTimeout(() => {
        if (diagState.currentOp === op) {
          endOperation();
        }
      }, 120);
    }, true);

    // Intercepción de interacciones en el lienzo (#editorCanvas)
    const canvasEl = document.getElementById('editorCanvas');
    if (canvasEl) {
      canvasEl.addEventListener('mousedown', function (e) {
        if (!diagState.active) return;
        diagState.lastMouseDownPoint = { x: e.clientX, y: e.clientY };
        diagState.lastMouseDownSelection = snapshotSelection();
        diagState.lastMouseDownGeo = snapshotGeometricState();
      }, true);

      canvasEl.addEventListener('mouseup', function (e) {
        if (!diagState.active) return;
        const ptDown = diagState.lastMouseDownPoint;
        if (!ptDown) return;

        const dx = Math.abs(e.clientX - ptDown.x);
        const dy = Math.abs(e.clientY - ptDown.y);
        const isDrag = (dx > 3 || dy > 3);

        setTimeout(() => {
          const selNow = snapshotSelection();
          const geoNow = snapshotGeometricState();
          const selBefore = diagState.lastMouseDownSelection || selNow;

          if (isDrag) {
            if (window.nodeEditMode) {
              const op = beginOperation('NODE_DRAG', 'Arrastre de Nodos (#editorCanvas)');
              op.selectionBefore = selBefore;
              op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
              endOperation();
              return;
            }
            const op = beginOperation('DRAG', 'Arrastre en Lienzo (#editorCanvas)');
            op.selectionBefore = selBefore;
            op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
            endOperation();
          } else {
            const idBefore = (selBefore.primary && selBefore.primary.id) || null;
            const idNow = (selNow.primary && selNow.primary.id) || null;
            if (idBefore !== idNow) {
              const action = idNow ? 'SELECT' : 'DESELECT';
              const op = beginOperation(action, 'Clic en Lienzo (#editorCanvas)');
              op.selectionBefore = selBefore;
              op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
              endOperation();
            }
          }
        }, 60);
      }, true);
    }
  }

  // Instalación de hooks en módulos del repositorio
  function installAllInterceptors() {
    if (diagState.interceptorsInstalled) return;

    forceWrapWindowFunction('decomposeByContainmentHierarchy', 'geometricUngroup.js', 'UNGROUP');
    forceWrapWindowFunction('recalculateDynamicSubtractions', 'geometricUngroup.js', null);
    forceWrapWindowFunction('selectItem', 'selection.js', 'SELECT');
    forceWrapWindowFunction('deselectItem', 'selection.js', 'DESELECT');
    forceWrapWindowFunction('ungroupSelectedItem', 'contextualMenu.js', 'UNGROUP');
    forceWrapWindowFunction('groupSelectedItems', 'contextualMenu.js', 'GROUP');
    forceWrapWindowFunction('enterNodeEditMode', 'nodeEditor.js', 'NODE_EDIT');
    forceWrapWindowFunction('exitNodeEditMode', 'nodeEditor.js', 'EXIT_NODE_EDIT');
    forceWrapWindowFunction('bringFront', 'editor.js', 'BRING_FRONT');
    forceWrapWindowFunction('sendBack', 'editor.js', 'SEND_BACK');
    forceWrapWindowFunction('bringForward', 'editor.js', 'BRING_FORWARD');
    forceWrapWindowFunction('sendBackward', 'editor.js', 'SEND_BACKWARD');
    forceWrapWindowFunction('duplicateImage', 'imageToolbar.js', 'DUPLICATE');
    forceWrapWindowFunction('copySelected', 'editor.js', 'COPY');
    forceWrapWindowFunction('pasteSelected', 'editor.js', 'DUPLICATE');
    forceWrapWindowFunction('deleteImage', 'imageToolbar.js', 'DELETE');
    forceWrapWindowFunction('scaleImage', 'imageToolbar.js', 'SCALE');
    forceWrapWindowFunction('toggleBold', 'textToolbar.js', 'BOLD');
    forceWrapWindowFunction('toggleItalic', 'textToolbar.js', 'ITALIC');
    forceWrapWindowFunction('toggleUnderline', 'textToolbar.js', 'UNDERLINE');
    forceWrapWindowFunction('weldText', 'textToolbar.js', 'WELD');
    forceWrapWindowFunction('createEditableText', 'editor.js', 'ADD_TEXT');
    forceWrapWindowFunction('addQRToCanvas', 'editor.js', 'ADD_QR');

    installDOMCaptureListeners();

    if (typeof paper !== 'undefined' && paper.project && !paper.project._diagWrapped) {
      const origImportSVG = paper.project.importSVG;
      paper.project.importSVG = function (...args) {
        const op = beginOperation('IMPORT_SVG', 'paper.project.importSVG');
        const cb = args[1];
        if (typeof cb === 'function') {
          args[1] = function (item) {
            const res = cb(item);
            setTimeout(() => { endOperation(); }, 50);
            return res;
          };
        }
        return origImportSVG.apply(this, args);
      };
      paper.project._diagWrapped = true;
    }

    diagState.interceptorsInstalled = true;
  }

  // =========================================================================
  // API PÚBLICA EKKO_DIAG (CON REGISTRO UNIVERSAL DE CONTRATOS)
  // =========================================================================
  const publicAPI = {
    start: function () {
      diagState.active = true;
      installAllInterceptors();
      rawConsole.log('%c[EKKO_DIAG v8.0 Universal Dynamic Standard] Activo 🟢', 'color: #10b981; font-weight: bold; font-size: 13px;');
      return 'EKKO_DIAG Activo. Monitoreando automáticamente cualquier botón existente o nuevo.';
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

    // Registro formal de nuevos botones para desarrolladores
    registerButtonContract: function (idOrSelector, contractConfig) {
      registerContract(idOrSelector, contractConfig);
      rawConsole.log(`%c[EKKO_DIAG] Contrato registrado para '${idOrSelector}'`, 'color: #0284c7;');
      return true;
    },

    report: function () {
      const ops = diagState.operations;
      let outputText = '╔══════════════════════════════════════════════════════════════════════════════════╗\n';
      outputText += '║      EKKO STUDIO DIAGNOSTIC v8.0 - ESTÁNDAR UNIVERSAL DE CONTRATOS FORENSES      ║\n';
      outputText += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';
      outputText += `Total Operaciones Auditadas: ${ops.length}\n\n`;

      ops.forEach(op => {
        const pass = op.consistency && op.consistency.pass ? '✓ OK' : '⚠ INCONSISTENCIA';
        const sel = op.selectionAfter && op.selectionAfter.primary;
        const selStr = sel ? `ID: ${sel.id} (${sel.className}, Z:${sel.zIndex})` : 'Sin selección';
        outputText += `[${op.id}] ${op.action.padEnd(16)} | ${pass.padEnd(16)} | ${op.durationMs}ms | Origen: ${op.source} | Capas: ${op.geometryAfter.totalUsefulItems} | Sel: ${selStr}\n`;
        if (op.consistency && !op.consistency.pass) {
          op.consistency.inconsistencies.forEach(inc => {
            outputText += `   ↳ ⚠️ ${inc}\n`;
          });
        }
      });

      rawConsole.log(outputText);
      return outputText;
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
    setTimeout(() => {
      publicAPI.start();
    }, 300);
  }

  return publicAPI;
}));

