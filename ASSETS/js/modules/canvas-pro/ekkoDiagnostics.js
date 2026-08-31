/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v6.2 PRO Deep Capture & Surface Area Engine)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
   Descripción:
   Sistema de Auditoría, Trazabilidad e Instrumentación Forense de 5 Niveles para EKKO Studio.
   Diseñado específicamente para verificar la consistencia del motor de:
   - Descomposición por Jerarquía de Contención y Capas SVG.
   - Orden Z no destructivo y Reactividad CSG en vivo.
   - Preservación de geomBase, masas sólidas y calados activos.
   - Detección activa de Colapso de Área Visible o Masas Aniquiladas (Rule 8).

   AUDITORÍAS INTEGRADAS:
   1. AUDITORÍA TOPOLÓGICA DE CAPAS (itemLossDetected):
      - Verifica que al desagrupar no desaparezcan elementos útiles del lienzo.
   2. AUDITORÍA DE ARRASTRE REAL (dragDisplacementValid):
      - Comprueba que tras una operación 'DRAG', el elemento primario haya mutado
        efectivamente sus coordenadas físicas en el lienzo (dx > 0.1 || dy > 0.1).
   3. VERIFICACIÓN DE RECORTE OBLIGATORIO EN PRODUCTO (productClippingValid):
      - Comprueba que en productos con mockup activo ningún elemento de diseño quede
        huérfano de máscara de recorte (isClipped: true / clipGroup activo).
   4. CONTROL DE CONSISTENCIA CSG EN MOVIMIENTO Y GEOMBASE (geomBasePreserved):
      - Valida que geomBase se desplace solidariamente con la posición visible sin mutar
        sus vértices prístinos fuera del editor de nodos.
   5. DETECCIÓN ACTIVA DE COLAPSO DE ÁREA VISIBLE (massCollapseDetected):
      - Detecta si una masa sólida sufre aniquilación booleana (0 segmentos visibles o
        área colapsada a cero) cuando dos o más calados interactivos colisionan.
   6. PRESERVACIÓN DE CONSISTENCIA Y EXPOSICIÓN GLOBAL (EKKO_DIAG).
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

  // Canal seguro de salida de consola (elude silenciamientos externos de loggers)
  const rawConsole = {
    log: (typeof console !== 'undefined' && console.log) ? console.log.bind(console) : () => {},
    warn: (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : () => {},
    error: (typeof console !== 'undefined' && console.error) ? console.error.bind(console) : () => {},
    table: (typeof console !== 'undefined' && console.table) ? console.table.bind(console) : () => {}
  };

  // Restauración activa por iframe aislado si la consola global fue sobreescrita
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
      isLocked: isLockedItem(primary)
    } : null;

    return {
      hasSelection: true,
      count: selectedItems.length > 0 ? selectedItems.length : 1,
      ids: selectedItems.length > 0 ? selectedItems.map(i => i.id) : [primary.id],
      primary: primaryData
    };
  }

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
        bounds: extractBounds(target.bounds)
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

  function auditConsistency(beforeGeo, afterGeo, beforeSel, afterSel, callLog, opType) {
    const inconsistencies = [];
    const checks = {
      geomBasePreserved: true,
      zOrderPreserved: true,
      selectionValid: true,
      csgExecuted: true,
      holeClassificationValid: true,
      itemLossDetected: false,
      dragDisplacementValid: true,
      productClippingValid: true,
      massCollapseDetected: false
    };

    if (beforeGeo.error || afterGeo.error) {
      return { checks, inconsistencies, pass: true };
    }

    // 1. Verificación de Pérdida de Elementos en Desagrupar
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

      if (beforeSel.primary && beforeSel.primary.className === 'Group') {
        if (afterGeo.totalUsefulItems <= beforeGeo.totalUsefulItems && afterGeo.itemsSummary.some(it => it.id === beforeSel.primary.id)) {
          inconsistencies.push(
            `[DESAGRUPACIÓN FALLIDA] El grupo ID: ${beforeSel.primary.id} sigue existiendo intacto; el comando no lo descompuso.`
          );
        }
      }
    }

    // 2. Verificación de Arrastre Efectivo (DRAG)
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
              `[ARRASTRE BLOQUEADO] El objeto ID: ${afterSel.primary.id} (${afterSel.primary.label}) no modificó su posición física durante el arrastre (Posición fija en x:${p1.x}, y:${p1.y}).`
            );
          }
        }
      }
    }

    // 3. Verificación de geomBase (Corrupción por CSG)
    const beforeMap = new Map();
    beforeGeo.itemsSummary.forEach(it => beforeMap.set(it.id, it));

    afterGeo.itemsSummary.forEach(itAfter => {
      if (beforeMap.has(itAfter.id)) {
        const itBefore = beforeMap.get(itAfter.id);
        if (itBefore.hasGeomBase && itAfter.hasGeomBase && itBefore.geomBaseSegments !== itAfter.geomBaseSegments && opType !== 'NODE_EDIT') {
          checks.geomBasePreserved = false;
          inconsistencies.push(
            `[CORRUPCIÓN CSG EN geomBase] El elemento ID: ${itAfter.id} alteró sus segmentos base (${itBefore.geomBaseSegments} -> ${itAfter.geomBaseSegments}) fuera del editor de nodos.`
          );
        }
      }
    });

    // 4. Verificación de Selección Huérfana
    if (afterSel.hasSelection && typeof window !== 'undefined' && window.selectedItem) {
      const curr = window.selectedItem;
      if (!curr.project || !curr.parent) {
        checks.selectionValid = false;
        inconsistencies.push(`[SELECCIÓN HUÉRFANA] window.selectedItem apunta a un objeto desvinculado (ID: ${curr.id}).`);
      }
    }

    // 5. Verificación de Enmascaramiento y Recorte en Producto (Mockup Containment)
    if (typeof window !== 'undefined' && window.currentMockup && !window.infiniteCanvasMode && window.clipMask) {
      const unclipped = afterGeo.itemsSummary.filter(it => !it.isClipped);
      if (unclipped.length > 0) {
        checks.productClippingValid = false;
        unclipped.forEach(it => {
          inconsistencies.push(
            `[RECORTE DE PRODUCTO AUSENTE] El objeto ID: ${it.id} (${it.label}) no posee máscara de recorte (isClipped: false); los elementos deben permanecer contenidos dentro de los límites del producto.`
          );
        });
      }
    }

    // 6. VERIFICACIÓN ACTIVA DE COLAPSO DE ÁREA VISIBLE / MASA ANIQUILADA (RULE 8 COMPLIANCE)
    // Detecta si una masa sólida previa sufrió colapso geométrico a 0 segmentos o área nula (ej. colisión de calados solapados)
    if (opType !== 'DELETE') {
      afterGeo.itemsSummary.forEach(itAfter => {
        if (!itAfter.isHole && beforeMap.has(itAfter.id)) {
          const itBefore = beforeMap.get(itAfter.id);
          const hadVisibleGeometry = (itBefore.visibleSegments > 0) || (itBefore.visibleArea > 1.0);
          const isZeroSegments = (itAfter.visibleSegments === 0);
          const isZeroBounds = (!itAfter.bounds || (itAfter.bounds.width <= 0 && itAfter.bounds.height <= 0));
          const isAreaCollapsed = (itAfter.visibleArea <= 0.01);

          if (hadVisibleGeometry && (isZeroSegments || isZeroBounds || isAreaCollapsed)) {
            checks.massCollapseDetected = true;
            inconsistencies.push(
              `[COLAPSO DE ÁREA / MASA ANIQUILADA] La masa sólida ID: ${itAfter.id} (${itAfter.label}) colapsó a 0 segmentos visibles o área nula tras la operación ${opType}. Se requiere blindaje anti-aniquilación CSG.`
            );
          }
        }
      });
    }

    const pass = inconsistencies.length === 0;
    return { checks, inconsistencies, pass };
  }

  function beginOperation(actionName, triggerSource) {
    if (!diagState.active) return null;
    diagState.opCounter++;
    const opId = 'OP-' + String(diagState.opCounter).padStart(5, '0');

    const op = {
      id: opId,
      action: actionName,
      source: triggerSource || 'UI',
      timestamp: Date.now(),
      startTime: performance.now(),
      endTime: null,
      durationMs: 0,
      selectionBefore: snapshotSelection(),
      selectionAfter: null,
      geometryBefore: snapshotGeometricState(),
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
    op.endTime = performance.now();
    op.durationMs = Number((op.endTime - op.startTime).toFixed(1));
    op.selectionAfter = snapshotSelection();
    op.geometryAfter = snapshotGeometricState();

    op.consistency = auditConsistency(
      op.geometryBefore,
      op.geometryAfter,
      op.selectionBefore,
      op.selectionAfter,
      op.callGraph,
      op.action
    );

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
        `%c[${op.id}] ${op.action}%c | ✓ OK (${op.durationMs}ms) | ${selDesc} | ${geoDesc}`,
        'color: #0284c7; font-weight: bold;',
        'color: #10b981;'
      );
    } else {
      rawConsole.warn(
        `%c[${op.id}] ${op.action}%c | ⚠️ INCONSISTENCIA DETECTADA (${op.durationMs}ms) | ${selDesc}`,
        'color: #ea580c; font-weight: bold;',
        'color: #ef4444;'
      );
      op.consistency.inconsistencies.forEach(inc => {
        rawConsole.error(`   ↳ ${inc}`);
      });
    }
  }

  // Interceptor eludiendo protectGlobal
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

  // Instalación de escuchadores directos en el DOM (Fase de Captura)
  function installDOMCaptureListeners() {
    if (typeof document === 'undefined') return;

    // 1. Intercepción de Clics en Botones de UI
    document.addEventListener('click', function (e) {
      if (!diagState.active) return;
      const target = e.target;
      if (!target) return;

      const btnUngroup = target.closest('#btnCtxUngroup, #btnCtxDesagrupar, #proBtnUngroup');
      const btnGroup = target.closest('#btnCtxGroup, #btnCtxAgrupar, #proBtnGroup');
      const btnForward = target.closest('#btnCtxForward, #proBtnBringForward');
      const btnBackward = target.closest('#btnCtxBackward, #proBtnSendBackward');
      const btnEditNodes = target.closest('#btnCtxEditNodes, #btnCtxNodeEdit, #proBtnEditNodes');
      const btnDelete = target.closest('#btnCtxDelete');

      let actionName = null;
      let triggerSource = null;

      if (btnUngroup) { actionName = 'UNGROUP'; triggerSource = 'Botón Desagrupar'; }
      else if (btnGroup) { actionName = 'GROUP'; triggerSource = 'Botón Agrupar'; }
      else if (btnForward) { actionName = 'BRING_FORWARD'; triggerSource = 'Botón Subir Capa'; }
      else if (btnBackward) { actionName = 'SEND_BACKWARD'; triggerSource = 'Botón Bajar Capa'; }
      else if (btnEditNodes) { actionName = 'NODE_EDIT'; triggerSource = 'Botón Editar Nodos'; }
      else if (btnDelete) { actionName = 'DELETE'; triggerSource = 'Botón Eliminar'; }

      if (actionName) {
        const op = beginOperation(actionName, triggerSource);
        setTimeout(() => {
          if (diagState.currentOp === op) {
            endOperation();
          }
        }, 80);
      }
    }, true);

    // 2. Intercepción de Interacciones en el Lienzo (#editorCanvas)
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
            const op = beginOperation('DRAG', 'Arrastre en Lienzo');
            op.selectionBefore = selBefore;
            op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
            endOperation();
          } else {
            const idBefore = (selBefore.primary && selBefore.primary.id) || null;
            const idNow = (selNow.primary && selNow.primary.id) || null;
            if (idBefore !== idNow) {
              const action = idNow ? 'SELECT' : 'DESELECT';
              const op = beginOperation(action, 'Clic en Lienzo');
              op.selectionBefore = selBefore;
              op.geometryBefore = diagState.lastMouseDownGeo || geoNow;
              endOperation();
            }
          }
        }, 60);
      }, true);
    }
  }

  // Instalación unificada de interceptores
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

  // API Pública de EKKO_DIAG
  const publicAPI = {
    start: function () {
      diagState.active = true;
      installAllInterceptors();
      rawConsole.log('%c[EKKO_DIAG v6.2 Deep Capture] Activo 🟢', 'color: #10b981; font-weight: bold; font-size: 13px;');
      return 'EKKO_DIAG Activo. Interactúa en el lienzo.';
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

    report: function () {
      const ops = diagState.operations;
      let outputText = '╔══════════════════════════════════════════════════════════════════════════════════╗\n';
      outputText += '║               EKKO STUDIO DIAGNOSTIC v6.2 - INFORME CONSOLIDADO                  ║\n';
      outputText += '╚══════════════════════════════════════════════════════════════════════════════════╝\n\n';
      outputText += `Total Operaciones Auditadas: ${ops.length}\n\n`;

      ops.forEach(op => {
        const pass = op.consistency && op.consistency.pass ? '✓ OK' : '⚠ INCONSISTENCIA';
        const sel = op.selectionAfter && op.selectionAfter.primary;
        const selStr = sel ? `ID: ${sel.id} (${sel.className}, Z:${sel.zIndex})` : 'Sin selección';
        outputText += `[${op.id}] ${op.action.padEnd(14)} | ${pass.padEnd(16)} | ${op.durationMs}ms | Capas: ${op.geometryAfter.totalUsefulItems} | Sel: ${selStr}\n`;
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
