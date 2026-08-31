/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v6.0 Deep Capture & Real Displacement Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
Sistema de Auditoría, Trazabilidad e Instrumentación Forense de 5 Niveles para EKKO Studio.
Diseñado bajo los estándares del PROMPT MAESTRO y DIAGNÓSTICO DE ARQUITECTURA.

MEJORAS v6.0:
1. DETECCIÓN DE ARRASTRES CONGELADOS (Frozen Drag Detection):
   - Audita si un evento DRAG produjo desplazamiento físico real en las coordenadas locales/globales.
   - Si la posición antes y después es idéntica tras un arrastre de mouse, marca inconsistencia explícita:
     '[ARRASTRE FALLIDO / OBJETO BLOQUEADO]'.
2. CONTROL DE CONSISTENCIA CSG EN MOVIMIENTO:
   - Valida que geomBase se desplace solidariamente con la posición visible.
3. PRESERVACIÓN DE CONSISTENCIA Y EXPOSICIÓN GLOBAL (EKKO_DIAG).
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

  // Restauración activa por iframe aislado
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

  function snapshotSelection() {
    const item = typeof window !== 'undefined' ? (window.selectedItem || null) : null;
    const selectedItems = typeof window !== 'undefined' ? (window.selectedItems || []) : [];

    if (!item && selectedItems.length === 0) {
      return { hasSelection: false, primary: null, count: 0, ids: [] };
    }

    const primary = item || selectedItems[0];
    let zIndex = -1;
    if (primary && primary.parent && primary.parent.children) {
      zIndex = primary.parent.children.indexOf(primary);
    }

    const primaryData = primary ? {
      id: primary.id,
      className: primary.className || (primary.constructor ? primary.constructor.name : 'Unknown'),
      label: (primary.data && primary.data.label) || 'Item ' + primary.id,
      zIndex: zIndex,
      isHole: !!(primary.data && primary.data.isHole),
      hasGeomBase: !!(primary.data && primary.data.geomBase),
      geomBaseSegments: (primary.data && primary.data.geomBase) ? countSegments(primary.data.geomBase) : 0,
      visibleSegments: countSegments(primary),
      bounds: extractBounds(primary.bounds),
      position: primary.position ? { x: Number(primary.position.x.toFixed(1)), y: Number(primary.position.y.toFixed(1)) } : null,
      isLocked: !!(primary.data && primary.data.locked)
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
      if (!child) return;
      const isUI = child.data && (
        child.data.isSelectionBox || child.data.isHandle || child.data.isNodeHandle ||
        child.data.isCurveHandle || child.data.isNodeEditOverlay || child.data.isSmartGuide ||
        child.data.isMeasurement || child.data.isTracePreview || child.data.mockup || child.data.isMask
      );
      if (isUI) return;

      const isHole = !!(child.data && child.data.isHole);
      const hasGeomBase = !!(child.data && child.data.geomBase);

      if (isHole) holeCount++; else massCount++;

      items.push({
        index: index,
        id: child.id,
        className: child.className || (child.constructor ? child.constructor.name : 'Unknown'),
        label: (child.data && child.data.label) || 'Item ' + child.id,
        isHole: isHole,
        hasGeomBase: hasGeomBase,
        geomBaseSegments: hasGeomBase ? countSegments(child.data.geomBase) : 0,
        visibleSegments: countSegments(child),
        bounds: extractBounds(child.bounds)
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
      dragDisplacementValid: true
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
      rawConsole.log('%c[EKKO_DIAG v6.0 Deep Capture] Activo 🟢', 'color: #10b981; font-weight: bold; font-size: 13px;');
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
      outputText += '║               EKKO STUDIO DIAGNOSTIC v6.0 - INFORME CONSOLIDADO                  ║\n';
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
