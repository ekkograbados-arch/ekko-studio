/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
   Versión: v9.1 PRO Universal Diagnostic, Forensic Audit & Zero-False-Positive Engine
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
   
   Descripción:
   Sistema Universal de Diagnóstico, Auditoría Forense y Trazabilidad de 5 Niveles
   para EKKO Studio. Monitorea y audita de forma no invasiva todas las operaciones
   del lienzo (Paper.js), eventos del DOM (botones fijos, barras flotantes y atajos),
   contratos funcionales, topología de masas/calados y consistencia Z-order.
   
   Mejoras v9.1 PRO:
   1. Soporte de Diálogos Asíncronos (isDialogOpener) para erradicar falsos positivos en apertura de selectores de archivo (SVG, Imagen, etc.).
   2. Intercepción global de openSVGFileDialog, addSVGFromFile y selectores modales en Call Graph.
   3. Blindaje Anti-Doble Importación (evita duplicación si se carga en index.html y editor.js).
   2. Auto-Copia al Portapapeles (navigator.clipboard con fallback execCommand) ante cualquier
      inconsistencia geométrica o de contrato detectada.
   3. Formateador forense estructurado para ingesta directa por Gemini Studio.
   4. Métodos de consola interactivos: EKKO_DIAG.copyLast(), EKKO_DIAG.copyErrors(), EKKO_DIAG.dump().
   5. Preservación absoluta de la geometría y estado (100% observador y pasivo).
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

  // 1. BLINDAJE CONTRA DOBLE INICIALIZACIÓN (index.html + editor.js import)
  if (typeof window !== 'undefined' && window.__EKKO_DIAG_ACTIVE_INSTANCE__) {
    return window.__EKKO_DIAG_ACTIVE_INSTANCE__;
  }

  // Canal seguro de salida de consola desacoplado
  const rawConsole = {
    log: (typeof console !== 'undefined' && console.log) ? console.log.bind(console) : () => {},
    warn: (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : () => {},
    error: (typeof console !== 'undefined' && console.error) ? console.error.bind(console) : () => {},
    table: (typeof console !== 'undefined' && console.table) ? console.table.bind(console) : () => {}
  };

  // Estado interno del motor de diagnóstico
  const diagState = {
    active: true,
    autoCopyOnError: true,
    operations: [],
    currentOp: null,
    opCounter: 0,
    interceptorsInstalled: false,
    lastMouseDownPoint: null,
    lastMouseDownSelection: null,
    lastMouseDownGeo: null
  };

  // =========================================================================
  // MOTOR DE COPIA ROBUSTO (Portapapeles con Fallback de Activación)
  // =========================================================================
  function safeCopyToClipboard(text, notifyMsg = null) {
    if (typeof text !== 'string' || text.trim() === '') return false;

    // Intento 1: API moderna asíncrona
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (notifyMsg) {
          rawConsole.log(`%c[EKKO_DIAG] ${notifyMsg}`, 'color: #10b981; font-weight: bold;');
        }
      }).catch(() => {
        fallbackCopy(text, notifyMsg);
      });
      return true;
    }

    return fallbackCopy(text, notifyMsg);
  }

  function fallbackCopy(text, notifyMsg) {
    if (typeof document === 'undefined') return false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok && notifyMsg) {
        rawConsole.log(`%c[EKKO_DIAG] ${notifyMsg} (vía buffer alternativo)`, 'color: #10b981; font-weight: bold;');
      }
      return ok;
    } catch (err) {
      rawConsole.warn('[EKKO_DIAG] No se pudo transferir al portapapeles automáticamente:', err);
      return false;
    }
  }

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
      expectedTopologyDelta: 'EQUAL',
      expectedSelectionChange: 'PRESERVED',
      expectedTransformChange: 'NONE',
      verifyDisplacement: false,
      preserveClipping: true,
      isDialogOpener: false,
      customValidator: null
    }, contractDef));
  }

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

  registerContract('#btnctxtofront', {
    name: 'BRING_TO_FRONT',
    label: 'Barra Emergente: Al Frente (#btnCtxToFront)',
    requiresSelection: true,
    minSelectionCount: 1,
    expectedTopologyDelta: 'EQUAL'
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

  registerContract('#btnctxtoback', {
    name: 'SEND_TO_BACK',
    label: 'Barra Emergente: Al Fondo (#btnCtxToBack)',
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

  registerContract('#btnctxeditnodes', {
    name: 'NODE_EDIT',
    label: 'Barra Emergente: Editar Nodos (#btnCtxEditNodes)',
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
    isDialogOpener: true,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnaddimage', {
    name: 'ADD_IMAGE',
    label: 'Cabecera: Cargar Imagen (#btnAddImage)',
    requiresSelection: false,
    isDialogOpener: true,
    expectedTopologyDelta: 'ANY'
  });

  registerContract('#btnaddqr', {
    name: 'ADD_QR',
    label: 'Cabecera: Cargar QR (#btnAddQR)',
    requiresSelection: false,
    isDialogOpener: true,
    expectedTopologyDelta: 'ANY'
  });

  // Resolución Dinámica Universal
  function resolveButtonContract(domElement) {
    if (!domElement) return null;

    if (domElement.id) {
      const idKey = '#' + domElement.id.trim().toLowerCase();
      if (buttonContractsRegistry.has(idKey)) {
        return { contract: buttonContractsRegistry.get(idKey), matchedBy: idKey };
      }
    }

    if (domElement.dataset && domElement.dataset.action) {
      const actKey = String(domElement.dataset.action).trim().toLowerCase();
      if (buttonContractsRegistry.has(actKey)) {
        return { contract: buttonContractsRegistry.get(actKey), matchedBy: `data-action="${actKey}"` };
      }
    }

    for (const [selector, contract] of buttonContractsRegistry.entries()) {
      if (selector.startsWith('.')) {
        try {
          if (domElement.matches(selector)) {
            return { contract, matchedBy: selector };
          }
        } catch (e) {}
      }
    }

    // Inferencia Universal para botones no registrados previamente
    const isContextual = !!domElement.closest('#contextual-toolbar, .contextual-toolbar');
    const isProLayout = !!domElement.closest('#pro-layout-toolbar, .pro-layout-toolbar');
    const isTopBar = !!domElement.closest('#topBar, .topBar, #mainNavbar');

    if (isContextual || isProLayout || isTopBar) {
      const containerName = isContextual ? 'Barra Emergente' : (isProLayout ? 'Panel Superior Fijo' : 'Barra de Cabecera');
      const textLabel = (domElement.textContent || domElement.title || domElement.id || 'Botón').trim();
      const inferredName = (domElement.id || textLabel).replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();

      return {
        contract: {
          name: inferredName,
          label: `${containerName}: ${textLabel} (${domElement.id ? '#' + domElement.id : 'dinámico'})`,
          requiresSelection: isContextual,
          minSelectionCount: isContextual ? 1 : 0,
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
    }
    return item;
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

  // Snapshot de Nivel 2: Selección
  function snapshotSelection() {
    const selectedItems = (typeof window !== 'undefined' && window.selectedItems && window.selectedItems.length > 0)
      ? window.selectedItems
      : (typeof window !== 'undefined' && window.selectedItem ? [window.selectedItem] : []);

    if (selectedItems.length === 0) {
      return { hasSelection: false, count: 0, ids: [], primary: null };
    }

    const primary = selectedItems[0];
    const target = getContentItem(primary);

    const primaryData = primary ? {
      id: primary.id,
      className: primary.className,
      label: (primary.data && primary.data.label) || 'Objeto',
      zIndex: (primary.parent && primary.parent.children) ? primary.parent.children.indexOf(primary) : -1,
      isHole: !!(primary.data && primary.data.isHole),
      isCompound: primary.className === 'CompoundPath',
      isGroup: primary.className === 'Group' && !(primary.data && primary.data.clipGroup),
      isClipGroup: !!(primary.data && primary.data.clipGroup),
      isLocked: !!(primary.data && primary.data.locked),
      hasGeomBase: !!(primary.data && primary.data.geomBase),
      bounds: extractBounds(primary.bounds),
      position: primary.position ? { x: Number(primary.position.x.toFixed(1)), y: Number(primary.position.y.toFixed(1)) } : null,
      rotation: Number((primary.rotation || 0).toFixed(1)),
      segmentsCount: countSegments(target),
      fontFamily: (target && target.fontFamily) || (target && target.data && target.data.fontFamily) || null,
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

  // Snapshot de Nivel 4: Topología y Estado Geométrico del Lienzo
  function snapshotGeometricState() {
    if (typeof paper === 'undefined' || !paper.project) {
      return { totalUsefulItems: 0, massCount: 0, holeCount: 0, zOrderIds: [], itemsSummary: [], error: 'Paper.js no cargado' };
    }

    const layer = (paper.project.layers && paper.project.layers.find(l => l.name === 'designLayer')) || paper.project.activeLayer;
    if (!layer || !layer.children) {
      return { totalUsefulItems: 0, massCount: 0, holeCount: 0, zOrderIds: [], itemsSummary: [], error: 'Capa no encontrada' };
    }

    const items = [];
    let massCount = 0;
    let holeCount = 0;

    layer.children.forEach((c, idx) => {
      if (!c) return;
      const d = c.data || {};
      if (d.mockup || d.isMask || d.wasClipMask || d.isSelectionBox || d.isHandle ||
          d.isSmartGuide || d.isMeasurement || d.isTracePreview || d.isNodeHandle ||
          d.isNodeEditOverlay || d.isCurveHandle) {
        return;
      }

      const isHole = !!d.isHole;
      if (isHole) holeCount++; else massCount++;

      items.push({
        id: c.id,
        zIndex: idx,
        className: c.className,
        label: d.label || 'Objeto',
        isHole: isHole,
        isClipGroup: !!d.clipGroup,
        isLocked: !!d.locked,
        hasGeomBase: !!d.geomBase,
        bounds: extractBounds(c.bounds)
      });
    });

    return {
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

    // --- REGLA 1: VALIDACIÓN DE CONTRATOS ESTÁNDAR ---
    if (contract) {
      // A) Precondición de selección
      if (contract.requiresSelection) {
        if (!beforeSel.hasSelection || beforeSel.count < (contract.minSelectionCount || 1)) {
          checks.selectionPreconditionValid = false;
          inconsistencies.push(
            `[SELECCIÓN INSUFICIENTE] '${uiSource}' requiere al menos ${contract.minSelectionCount || 1} objeto(s) seleccionado(s) (Detectados: ${beforeSel.count}).`
          );
        }
      }

      // B) Objeto bloqueado
      if (!contract.allowLocked && beforeSel.primary && beforeSel.primary.isLocked) {
        checks.actionExecuted = false;
        inconsistencies.push(
          `[OBJETO BLOQUEADO] Clic en '${uiSource}' sobre objeto bloqueado ID: ${beforeSel.primary.id} ('${beforeSel.primary.label}'). Acción rechazada.`
        );
      }

      // C) Mutación topológica esperada
      const deltaUseful = afterGeo.totalUsefulItems - beforeGeo.totalUsefulItems;
      if (contract.expectedTopologyDelta === 'INCREMENT') {
        if (deltaUseful <= 0) {
          checks.actionExecuted = false;
          inconsistencies.push(
            `[NO SE CREÓ/DUPLICÓ] Se activó '${uiSource}' pero el número de elementos no aumentó (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
          );
        }
      } else if (contract.expectedTopologyDelta === 'DECREMENT') {
        if (deltaUseful >= 0) {
          checks.actionExecuted = false;
          inconsistencies.push(
            `[NO SE ELIMINÓ] Se activó '${uiSource}', pero el elemento permanece en el lienzo (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
          );
        }
      } else if (contract.expectedTopologyDelta === 'EQUAL') {
        if (deltaUseful !== 0) {
          inconsistencies.push(
            `[TOPOLOGÍA ALTERADA] La acción '${opType}' alteró inesperadamente el conteo de capas (${beforeGeo.totalUsefulItems} -> ${afterGeo.totalUsefulItems}).`
          );
        }
      } else if (contract.expectedTopologyDelta === 'DECREASE_OR_EQUAL') {
        if (deltaUseful > 0) {
          inconsistencies.push(
            `[AGRUPACIÓN ANÓMALA] La acción '${opType}' incrementó capas en lugar de consolidarlas.`
          );
        }
      }

      // D) Cambio de selección esperado
      if (contract.expectedSelectionChange === 'NEW_ITEM') {
        if (afterSel.primary && beforeSel.primary && afterSel.primary.id === beforeSel.primary.id && beforeSel.count === 1) {
          checks.selectionValid = false;
          inconsistencies.push(
            `[SELECCIÓN NO ACTUALIZADA] El objeto fue procesado pero la selección sigue apuntando al elemento original (ID: ${beforeSel.primary.id}) en vez del nuevo.`
          );
        }
      } else if (contract.expectedSelectionChange === 'CLEARED') {
        if (afterSel.hasSelection && beforeSel.primary && afterSel.primary && afterSel.primary.id === beforeSel.primary.id) {
          checks.selectionValid = false;
          inconsistencies.push(
            `[SELECCIÓN HUÉRFANA] Elemento ID: ${beforeSel.primary.id} eliminado pero window.selectedItem permanece activo.`
          );
        }
      }

      // E) Desplazamiento visual (caso Duplicar)
      if (contract.verifyDisplacement && afterSel.primary && beforeSel.primary && afterSel.primary.position && beforeSel.primary.position) {
        const dx = Math.abs(afterSel.primary.position.x - beforeSel.primary.position.x);
        const dy = Math.abs(afterSel.primary.position.y - beforeSel.primary.position.y);
        if (dx < 1 && dy < 1) {
          inconsistencies.push(
            `[SIN DESPLAZAMIENTO] Objeto duplicado ID: ${afterSel.primary.id} se superpuso exactamente sobre el original sin desfase visible.`
          );
        }
      }

      // F) Validador personalizado del contrato
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

    // --- REGLA 2: DETECCIÓN DE CLIC FANTASMA / BOTÓN DESCONECTADO ---
    const totalCalls = callLog.length;
    let canvasMutated = beforeGeo.totalUsefulItems !== afterGeo.totalUsefulItems;
    if (beforeSel.primary && afterSel.primary && beforeSel.primary.position && afterSel.primary.position) {
      const dx = Math.abs(afterSel.primary.position.x - beforeSel.primary.position.x);
      const dy = Math.abs(afterSel.primary.position.y - beforeSel.primary.position.y);
      if (dx > 0.1 || dy > 0.1) canvasMutated = true;
    }
    const zBeforeStr = (beforeGeo.zOrderIds || []).join(',');
    const zAfterStr = (afterGeo.zOrderIds || []).join(',');
    if (zBeforeStr !== zAfterStr) {
      canvasMutated = true;
    }

    const isDialogOpener = (contract && contract.isDialogOpener) || 
                           opType.includes('ADD_SVG') || 
                           opType.includes('ADD_IMAGE') || 
                           opType.includes('OPEN_DIALOG') ||
                           opType.includes('FILE_PICKER');

    if (opMeta.isButtonClick && !canvasMutated && !opType.includes('TOGGLE') && !opType.includes('MODAL')) {
      if (isDialogOpener) {
        // En botones que disparan selectores de archivos o modales externos nativos,
        // el usuario tarda segundos en elegir el archivo en el sistema operativo.
        // La validación exige que la función controladora de apertura haya respondido.
        if (totalCalls === 0 && !window.__EKKO_FILE_PICKER_TRIGGERED__) {
          checks.deadClickDetected = true;
          checks.buttonResponded = false;
          inconsistencies.push(
            `[SELECTOR DESCONECTADO] Se hizo clic en '${uiSource}', pero no se invocó ningún controlador de apertura de diálogo ni input file.`
          );
        } else {
          // El diálogo fue lanzado con éxito hacia el sistema operativo. La mutación se audita al cargar el archivo.
          checks.buttonResponded = true;
        }
      } else if (totalCalls === 0) {
        checks.deadClickDetected = true;
        checks.buttonResponded = false;
        inconsistencies.push(
          `[BOTÓN DESCONECTADO / FANTASMA] Se hizo clic en '${uiSource}', pero ninguna función controladora fue ejecutada y no hubo mutación en el lienzo.`
        );
      }
    }

    // --- REGLA 3: AUDITORÍA DE PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN ---
    if (opType === 'UNGROUP') {
      if (beforeGeo.totalUsefulItems > 0 && afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
        checks.itemLossDetected = true;
        inconsistencies.push(
          `[PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN] Se perdieron ${beforeGeo.totalUsefulItems - afterGeo.totalUsefulItems} elemento(s) durante la operación.`
        );
      }
    }

    const pass = inconsistencies.length === 0;
    return { checks, inconsistencies, pass };
  }

  // =========================================================================
  // FORMATEADOR FORENSE (Estructurado para Gemini Studio & Prompts Maestros)
  // =========================================================================
  function formatOpForRemediation(op) {
    let out = `\n================================================================================\n`;
    out += `INFORME FORENSE EKKO_DIAG (Para Gemini Studio)\n`;
    out += `================================================================================\n`;
    out += `[ID OPERACIÓN] : ${op.id}\n`;
    out += `[ACCIÓN]       : ${op.action}\n`;
    out += `[ORIGEN UI]    : ${op.source}\n`;
    out += `[DURACIÓN]     : ${op.durationMs} ms\n`;
    out += `[ELEMENTO DOM] : Tag: <${op.meta?.domTag || 'N/A'}> | ID: "${op.meta?.domElementId || 'N/A'}" | Class: "${op.meta?.domClass || 'N/A'}"\n\n`;

    out += `--- NIVEL 2: SELECCIÓN PREVIA Y POSTERIOR ---\n`;
    out += `Antes : ${op.selectionBefore?.hasSelection ? JSON.stringify(op.selectionBefore.primary) : 'Sin selección'}\n`;
    out += `Después: ${op.selectionAfter?.hasSelection ? JSON.stringify(op.selectionAfter.primary) : 'Sin selección'}\n\n`;

    out += `--- NIVEL 3: TRAZA DE EJECUCIÓN (CALL GRAPH) ---\n`;
    if (op.callGraph && op.callGraph.length > 0) {
      op.callGraph.forEach(c => {
        out += `  ↳ [${c.order}] ${c.module} -> ${c.function}() [${c.durationMs}ms] ${c.error ? 'ERROR: ' + c.error : 'OK'}\n`;
      });
    } else {
      out += `  (Sin llamadas registradas a controladores globales interceptados)\n`;
    }

    out += `\n--- NIVEL 4: TOPOLOGÍA GEOMÉTRICA (ANTES -> DESPUÉS) ---\n`;
    out += `Total Capas Útiles : ${op.geometryBefore?.totalUsefulItems} -> ${op.geometryAfter?.totalUsefulItems}\n`;
    out += `Masas / Calados    : (${op.geometryBefore?.massCount}M / ${op.geometryBefore?.holeCount}C) -> (${op.geometryAfter?.massCount}M / ${op.geometryAfter?.holeCount}C)\n`;
    out += `Z-Order IDs Antes  : [${(op.geometryBefore?.zOrderIds || []).join(', ')}]\n`;
    out += `Z-Order IDs Después: [${(op.geometryAfter?.zOrderIds || []).join(', ')}]\n\n`;

    out += `--- NIVEL 5: AUDITORÍA DE CONSISTENCIA Y CONTRATOS ---\n`;
    if (op.consistency && !op.consistency.pass) {
      out += `ESTADO: ⚠️ INCONSISTENCIAS DETECTADAS (${op.consistency.inconsistencies.length})\n`;
      op.consistency.inconsistencies.forEach(inc => {
        out += `  ❌ ${inc}\n`;
      });
    } else {
      out += `ESTADO: ✓ OPERACIÓN VÁLIDA (Sin inconsistencias detectadas)\n`;
    }
    out += `================================================================================\n`;
    return out;
  }

  // =========================================================================
  // GESTIÓN DEL CICLO DE VIDA DE LA OPERACIÓN FORENSE
  // =========================================================================
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

    // Auto-Copia al portapapeles si hay error y la función está activa
    if (diagState.autoCopyOnError && op.consistency && !op.consistency.pass) {
      const forensicTxt = formatOpForRemediation(op);
      safeCopyToClipboard(forensicTxt, `Inconsistencia en [${op.id}] copiada al portapapeles para Gemini Studio.`);
    }

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

      if (!hasExisting) {
        op = beginOperation(actionType || fnName, `${modulePath} -> window.${fnName}()`);
      }

      const activeOp = diagState.currentOp;
      const order = activeOp ? activeOp.callGraph.length + 1 : 1;
      const t0 = performance.now();
      let res, err = null;

      try {
        res = original.apply(this, args);
      } catch (e) {
        err = e;
        throw e;
      } finally {
        const t1 = performance.now();
        if (activeOp) {
          activeOp.callGraph.push({
            order: order,
            function: fnName,
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
  // CAPTURA UNIVERSAL DE CLICS EN UI
  // =========================================================================
  function installDOMCaptureListeners() {
    if (typeof document === 'undefined') return;

    document.addEventListener('click', function (e) {
      if (!diagState.active) return;
      const target = e.target;
      if (!target) return;

      const interactiveEl = target.closest('button, [role="button"], .ctx-btn, .pro-btn, [data-action], a.btn, input[type="button"]');
      if (!interactiveEl) return;

      // Monitoreo de disparadores de input de archivos
      if (interactiveEl.id === 'btnAddSVG' || interactiveEl.id === 'btnAddImage' || interactiveEl.getAttribute('data-action') === 'load-svg') {
        window.__EKKO_FILE_PICKER_TRIGGERED__ = true;
        setTimeout(() => { window.__EKKO_FILE_PICKER_TRIGGERED__ = false; }, 1000);
      }

      const resolved = resolveButtonContract(interactiveEl);
      if (!resolved) return;

      const contract = resolved.contract;
      const actionName = contract.name || 'BUTTON_CLICK';
      const triggerSource = contract.label || `Botón (${resolved.matchedBy})`;

      const op = beginOperation(actionName, triggerSource, {
        isButtonClick: true,
        domTag: interactiveEl.tagName.toLowerCase(),
        domElementId: interactiveEl.id || null,
        domClass: interactiveEl.className || null,
        resolvedContract: contract,
        matchedBy: resolved.matchedBy
      });

      setTimeout(() => {
        if (diagState.currentOp === op) {
          endOperation();
        }
      }, 120);
    }, true);

    // Intercepción en el lienzo (#editorCanvas)
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

        setTimeout(() => {
          const selBefore = diagState.lastMouseDownSelection;
          const selNow = snapshotSelection();
          const geoNow = snapshotGeometricState();

          if (dx > 4 || dy > 4) {
            const op = beginOperation('DRAG_MOVE', 'Arrastre en Lienzo (#editorCanvas)');
            op.selectionBefore = selBefore;
            op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
            endOperation();
          } else {
            const idBefore = (selBefore && selBefore.primary) ? selBefore.primary.id : null;
            const idNow = (selNow && selNow.primary) ? selNow.primary.id : null;

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

  function installAllInterceptors() {
    if (diagState.interceptorsInstalled) return;

    // Envoltura de funciones críticas de editor y módulos
    forceWrapWindowFunction('selectItem', 'editor.js', 'SELECT');
    forceWrapWindowFunction('deselectItem', 'editor.js', 'DESELECT');
    forceWrapWindowFunction('saveHistory', 'editor.js', 'SAVE_HISTORY');
    forceWrapWindowFunction('undo', 'editor.js', 'UNDO');
    forceWrapWindowFunction('redo', 'editor.js', 'REDO');
    forceWrapWindowFunction('copySelected', 'editor.js', 'COPY');
    forceWrapWindowFunction('pasteClipboard', 'editor.js', 'PASTE');
    forceWrapWindowFunction('bringFront', 'editor.js', 'BRING_TO_FRONT');
    forceWrapWindowFunction('sendBack', 'editor.js', 'SEND_TO_BACK');
    forceWrapWindowFunction('bringForward', 'editor.js', 'BRING_FORWARD');
    forceWrapWindowFunction('sendBackward', 'editor.js', 'SEND_BACKWARD');
    forceWrapWindowFunction('bringImageToFront', 'imageToolbar.js', 'BRING_TO_FRONT');
    forceWrapWindowFunction('sendImageToBack', 'imageToolbar.js', 'SEND_TO_BACK');
    forceWrapWindowFunction('bringImageForward', 'imageToolbar.js', 'BRING_FORWARD');
    forceWrapWindowFunction('sendImageBackward', 'imageToolbar.js', 'SEND_BACKWARD');
    forceWrapWindowFunction('createEditableText', 'editor.js', 'ADD_TEXT');
    forceWrapWindowFunction('addQRToCanvas', 'editor.js', 'ADD_QR');
    forceWrapWindowFunction('openSVGFileDialog', 'editor.js', 'OPEN_SVG_DIALOG');
    forceWrapWindowFunction('addSVGFromFile', 'editor.js', 'PROCESS_SVG_FILE');
    forceWrapWindowFunction('enterNodeEditMode', 'nodeEditor.js', 'NODE_EDIT');
    forceWrapWindowFunction('exitNodeEditMode', 'nodeEditor.js', 'EXIT_NODE_EDIT');
    forceWrapWindowFunction('deleteSelectedNodes', 'nodeEditor.js', 'DELETE_NODE');
    forceWrapWindowFunction('duplicateSelectedItem', 'contextualMenu.js', 'DUPLICATE');

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
  // API PÚBLICA EKKO_DIAG
  // =========================================================================
  const publicAPI = {
    start: function () {
      diagState.active = true;
      installAllInterceptors();
      rawConsole.log('%c[EKKO_DIAG v9.0 Universal Standard] Activo 🟢', 'color: #10b981; font-weight: bold; font-size: 13px;');
      return 'EKKO_DIAG Activo. Monitoreando automáticamente con auto-copia forense habilitada.';
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

    setAutoCopyOnError: function (enabled) {
      diagState.autoCopyOnError = !!enabled;
      rawConsole.log(`%c[EKKO_DIAG] Auto-copia ante error: ${diagState.autoCopyOnError ? 'HABILITADA' : 'DESHABILITADA'}`, 'color: #0284c7;');
      return diagState.autoCopyOnError;
    },

    registerButtonContract: function (idOrSelector, contractConfig) {
      registerContract(idOrSelector, contractConfig);
      rawConsole.log(`%c[EKKO_DIAG] Contrato registrado para '${idOrSelector}'`, 'color: #0284c7;');
      return true;
    },

    report: function () {
      const ops = diagState.operations;
      let outputText = '╔══════════════════════════════════════════════════════════════════════════════════╗\n';
      outputText += '║      EKKO STUDIO DIAGNOSTIC v9.0 - ESTÁNDAR UNIVERSAL DE CONTRATOS FORENSES      ║\n';
      outputText += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';
      outputText += `Total Operaciones Auditadas: ${ops.length}\n\n`;

      ops.forEach(op => {
        const pass = op.consistency && op.consistency.pass ? '✓ OK' : '⚠️ INCONSISTENCIA';
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

    copyLast: function () {
      if (diagState.operations.length === 0) {
        rawConsole.warn('[EKKO_DIAG] No hay operaciones registradas para copiar.');
        return false;
      }
      const lastOp = diagState.operations[diagState.operations.length - 1];
      const forensicTxt = formatOpForRemediation(lastOp);
      safeCopyToClipboard(forensicTxt, `Última operación [${lastOp.id}] copiada al portapapeles.`);
      return forensicTxt;
    },

    copyErrors: function () {
      const errorOps = diagState.operations.filter(op => op.consistency && !op.consistency.pass);
      if (errorOps.length === 0) {
        rawConsole.log('%c[EKKO_DIAG] No hay inconsistencias registradas en la sesión activa.', 'color: #10b981;');
        return false;
      }

      let combined = `================================================================================\n`;
      combined += `REPORTE COMBINADO DE INCONSISTENCIAS EKKO STUDIO (${errorOps.length} OPERACIONES FALLIDAS)\n`;
      combined += `================================================================================\n`;
      errorOps.forEach(op => {
        combined += formatOpForRemediation(op) + '\n';
      });

      safeCopyToClipboard(combined, `${errorOps.length} inconsistencia(s) copiadas al portapapeles.`);
      return combined;
    },

    dump: function () {
      const rep = this.report();
      const payload = rep + '\n\n--- DETALLE FORENSE COMPLETO (JSON) ---\n' + JSON.stringify(diagState.operations, null, 2);
      safeCopyToClipboard(payload, 'Diagnóstico forense completo copiado al portapapeles.');
      return payload;
    },

    last: function () {
      if (diagState.operations.length === 0) return 'No hay operaciones registradas.';
      return diagState.operations[diagState.operations.length - 1];
    }
  };

  // Asignación global con centinela anti-duplicación
  if (typeof window !== 'undefined') {
    window.__EKKO_DIAG_ACTIVE_INSTANCE__ = publicAPI;
    window.EKKO_DIAG = publicAPI;
    setTimeout(() => {
      publicAPI.start();
    }, 300);
  }

  return publicAPI;
}));
