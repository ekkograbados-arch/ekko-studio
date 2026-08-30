/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (Auditoría v1.0 PRO)
Ruta: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
Descripción:
Sistema de Instrumentación, Telemetría y Diagnóstico en 5 Niveles para EKKO Studio.
Implementa:
- Nivel 1: Acción de Usuario (Click, Drag, Ungroup, Group, NodeEdit, Z-Order, etc.)
- Nivel 2: Selección y Estado de Objetos (ID, Tipo, Bounds, Z, isHole, geomBase)
- Nivel 3: Cadena de Ejecución (Módulos, Funciones, Timestamps, Errores)
- Nivel 4: Estado Geométrico Delta (Antes/Después en capas, masas, calados, Z-order)
- Nivel 5: Auditor de Consistencia (Detección de geomBase corrupto, depth fallbacks,
           desconexiones CSG, objetos huérfanos)
Comandos F12:
  EKKO_DIAG.start()  -> Inicia sesión de registro
  EKKO_DIAG.stop()   -> Detiene sesión de registro
  EKKO_DIAG.report() -> Imprime reporte completo estructurado y tablas
  EKKO_DIAG.last()   -> Detalle exhaustivo de la última operación
  EKKO_DIAG.clear()  -> Limpia buffer de operaciones
========================================================================= */

(function () {
  'use strict';

  class EkkoDiagnosticsEngine {
    constructor() {
      this.active = false;
      this.operations = [];
      this.currentOp = null;
      this.opCounter = 0;
      this.hooksInstalled = false;
      this.maxHistory = 100;
    }

    start() {
      this.active = true;
      this.installHooks();
      console.log(
        "%c[EKKO DIAGNOSTICS] ▶ Grabación de operaciones ACTIVADA. Trabaja normalmente en el lienzo.",
        "background: #0284c7; color: #ffffff; font-weight: bold; padding: 4px 10px; border-radius: 4px;"
      );
    }

    stop() {
      this.active = false;
      console.log(
        "%c[EKKO DIAGNOSTICS] ⏹ Grabación de operaciones DETENIDA.",
        "background: #475569; color: #ffffff; font-weight: bold; padding: 4px 10px; border-radius: 4px;"
      );
    }

    clear() {
      this.operations = [];
      this.currentOp = null;
      this.opCounter = 0;
      console.log("%c[EKKO DIAGNOSTICS] 🗑 Historial de diagnóstico limpio.", "color: #64748b;");
    }

    // Snapshot del estado actual de la capa de diseño (Nivel 2 y 4)
    captureGeometrySnapshot(label = "snapshot") {
      const snapshot = {
        label,
        timestamp: performance.now(),
        layerItemsCount: 0,
        massesCount: 0,
        holesCount: 0,
        zOrderMap: [],
        selectedItem: null,
        selectedCount: 0
      };

      if (typeof paper === 'undefined' || !paper.project || !paper.project.activeLayer) {
        return snapshot;
      }

      const layer = paper.project.activeLayer;
      const validChildren = (layer.children || []).filter(
        it => it && !it.data?.mockup && !it.data?.isMask && !it.data?.isSelectionBox && !it.data?.isHandle
      );

      snapshot.layerItemsCount = validChildren.length;

      validChildren.forEach((item, idx) => {
        const isHole = !!item.data?.isHole;
        if (isHole) snapshot.holesCount++;
        else snapshot.massesCount++;

        snapshot.zOrderMap.push({
          index: idx,
          id: item.id,
          className: item.className,
          label: item.data?.label || "Sin Etiqueta",
          isHole: isHole,
          layerDepth: item.data?.layerDepth ?? null,
          hasGeomBase: !!item.data?.geomBase,
          geomBaseSegments: item.data?.geomBase ? this.countSegments(item.data.geomBase) : 0,
          currentSegments: this.countSegments(item),
          bounds: item.bounds ? {
            x: Math.round(item.bounds.x),
            y: Math.round(item.bounds.y),
            width: Math.round(item.bounds.width),
            height: Math.round(item.bounds.height)
          } : null
        });
      });

      const sel = window.selectedItem;
      if (sel) {
        snapshot.selectedItem = {
          id: sel.id,
          className: sel.className,
          label: sel.data?.label || "Sin Etiqueta",
          isHole: !!sel.data?.isHole,
          hasGeomBase: !!sel.data?.geomBase,
          index: sel.index,
          parentAttached: !!sel.parent
        };
      }

      if (window.selectedItems && Array.isArray(window.selectedItems)) {
        snapshot.selectedCount = window.selectedItems.length;
      } else {
        snapshot.selectedCount = sel ? 1 : 0;
      }

      return snapshot;
    }

    countSegments(item) {
      if (!item) return 0;
      if (item.segments) return item.segments.length;
      if (item.children) {
        return item.children.reduce((acc, c) => acc + this.countSegments(c), 0);
      }
      return 0;
    }

    beginOperation(toolName, userAction = "USER_EVENT") {
      if (!this.active) return null;

      this.opCounter++;
      const opId = `OP-${String(this.opCounter).padStart(5, '0')}`;
      const beforeState = this.captureGeometrySnapshot("BEFORE");

      this.currentOp = {
        id: opId,
        tool: toolName,
        userAction: userAction,
        startTime: performance.now(),
        executionChain: [],
        beforeState: beforeState,
        afterState: null,
        inconsistencies: [],
        status: "RUNNING"
      };

      return this.currentOp;
    }

    logStep(moduleName, functionName, detail = {}) {
      if (!this.active || !this.currentOp) return;
      this.currentOp.executionChain.push({
        step: this.currentOp.executionChain.length + 1,
        time: performance.now() - this.currentOp.startTime,
        module: moduleName,
        function: functionName,
        detail: detail
      });
    }

    endOperation(success = true, errorInfo = null) {
      if (!this.active || !this.currentOp) return;

      this.currentOp.afterState = this.captureGeometrySnapshot("AFTER");
      this.currentOp.endTime = performance.now();
      this.currentOp.durationMs = Math.round((this.currentOp.endTime - this.currentOp.startTime) * 100) / 100;
      this.currentOp.status = success ? "SUCCESS" : "FAILED";
      if (errorInfo) this.currentOp.error = errorInfo;

      // Nivel 5: Verificación de Inconsistencias de Arquitectura
      this.auditOperationConsistency(this.currentOp);

      this.operations.push(this.currentOp);
      if (this.operations.length > this.maxHistory) {
        this.operations.shift();
      }

      const finishedOp = this.currentOp;
      this.currentOp = null;
      return finishedOp;
    }

    // Auditor de Consistencia Técnica (Nivel 5)
    auditOperationConsistency(op) {
      const b = op.beforeState;
      const a = op.afterState;

      // Inconsistencia 1: Selección huérfana
      if (a.selectedItem && !a.selectedItem.parentAttached) {
        op.inconsistencies.push({
          code: "ERR_ORPHAN_SELECTION",
          severity: "CRITICAL",
          message: `La selección apunta al objeto ID ${a.selectedItem.id} que ha sido eliminado de la escena.`
        });
      }

      // Inconsistencia 2: Detección de clasificación errónea de calados
      const depthReliance = op.executionChain.find(
        c => c.detail && c.detail.rule && c.detail.rule.includes("depth % 2")
      );
      if (depthReliance) {
        op.inconsistencies.push({
          code: "WARN_DEPTH_ODD_EVEN_USED",
          severity: "HIGH",
          message: "El tipo de calado fue determinado puramente mediante (depth % 2 === 1) sin considerar la identidad semántica ni el orden Z relativo."
        });
      }

      // Inconsistencia 3: Contaminación de geomBase
      a.zOrderMap.forEach(afterItem => {
        const beforeItem = b.zOrderMap.find(bi => bi.id === afterItem.id);
        if (beforeItem && beforeItem.hasGeomBase && afterItem.hasGeomBase) {
          // Si no fue edición de nodos explícita y geomBase cambió de tamaño o segmentos
          if (op.tool !== "NODE_EDIT" && beforeItem.geomBaseSegments !== afterItem.geomBaseSegments) {
            op.inconsistencies.push({
              code: "ERR_GEOMBASE_POLLUTED",
              severity: "CRITICAL",
              message: `El item ID ${afterItem.id} (${afterItem.label}) sufrió alteración en geomBase: de ${beforeItem.geomBaseSegments} a ${afterItem.geomBaseSegments} segmentos durante ${op.tool}.`
            });
          }
        }
      });

      // Inconsistencia 4: Desconexión de recálculo CSG
      const createsHoles = a.holesCount > 0;
      const ranCsg = op.executionChain.some(
        c => c.function === "recalculateDynamicSubtractions"
      );
      if (createsHoles && (op.tool === "DESAGRUPAR" || op.tool === "BRING_FORWARD" || op.tool === "SEND_BACKWARD") && !ranCsg) {
        op.inconsistencies.push({
          code: "ERR_CSG_NOT_CALLED",
          severity: "HIGH",
          message: "La operación modificó orden/capas con calados activos pero no disparó recalculateDynamicSubtractions()."
        });
      }
    }

    // Instalación segura y no intrusiva de interceptores (Monkey Patching defensivo)
    installHooks() {
      if (this.hooksInstalled) return;
      const self = this;

      // 1. Interceptar ungroupSelectedItem en contextualMenu
      if (typeof window.ungroupSelectedItem === 'function') {
        const origUngroup = window.ungroupSelectedItem;
        window.ungroupSelectedItem = function (...args) {
          if (!self.active) return origUngroup.apply(this, args);
          self.beginOperation("DESAGRUPAR", "CLICK_UNGROUP");
          self.logStep("contextualMenu.js", "ungroupSelectedItem", { selected: window.selectedItem?.id });
          try {
            const res = origUngroup.apply(this, args);
            self.endOperation(true);
            return res;
          } catch (err) {
            self.endOperation(false, err.message);
            throw err;
          }
        };
      }

      // 2. Interceptar groupSelectedItems
      if (typeof window.groupSelectedItems === 'function') {
        const origGroup = window.groupSelectedItems;
        window.groupSelectedItems = function (...args) {
          if (!self.active) return origGroup.apply(this, args);
          self.beginOperation("AGRUPAR", "CLICK_GROUP");
          self.logStep("contextualMenu.js", "groupSelectedItems", { count: window.selectedItems?.length });
          try {
            const res = origGroup.apply(this, args);
            self.endOperation(true);
            return res;
          } catch (err) {
            self.endOperation(false, err.message);
            throw err;
          }
        };
      }

      // 3. Interceptar recalculateDynamicSubtractions en window
      if (typeof window.recalculateDynamicSubtractions === 'function') {
        const origCSG = window.recalculateDynamicSubtractions;
        window.recalculateDynamicSubtractions = function (...args) {
          if (self.active && self.currentOp) {
            self.logStep("geometricUngroup.js", "recalculateDynamicSubtractions", { targetLayer: args?.name || "activeLayer" });
          }
          return origCSG.apply(this, args);
        };
      }

      // 4. Interceptar decomposeByContainmentHierarchy
      if (typeof window.decomposeByContainmentHierarchy === 'function') {
        const origDecompose = window.decomposeByContainmentHierarchy;
        window.decomposeByContainmentHierarchy = function (...args) {
          if (self.active && self.currentOp) {
            self.logStep("geometricUngroup.js", "decomposeByContainmentHierarchy", { targetId: args?.id });
          }
          return origDecompose.apply(this, args);
        };
      }

      // 5. Interceptar Z-order en editor.js (bringFront, sendBack, etc.)
      ['bringFront', 'sendBack', 'bringForward', 'sendBackward'].forEach(fnName => {
        if (typeof window[fnName] === 'function') {
          const origFn = window[fnName];
          window[fnName] = function (...args) {
            if (!self.active) return origFn.apply(this, args);
            self.beginOperation(fnName.toUpperCase(), `CLICK_${fnName.toUpperCase()}`);
            self.logStep("editor.js", fnName, { target: window.selectedItem?.id });
            try {
              const res = origFn.apply(this, args);
              self.endOperation(true);
              return res;
            } catch (err) {
              self.endOperation(false, err.message);
              throw err;
            }
          };
        }
      });

      this.hooksInstalled = true;
      console.log("%c[EKKO DIAGNOSTICS] Interceptores de telemetría instalados limpiamente.", "color: #10b981;");
    }

    // Generación de Reporte Visual en Consola (F12)
    report() {
      console.log("%c╔══════════════════════════════════════════════════════════════════════════════╗", "color: #0284c7; font-weight: bold;");
      console.log("%c║                          EKKO STUDIO DIAGNOSTIC REPORT                       ║", "color: #0284c7; font-weight: bold;");
      console.log("%c╚══════════════════════════════════════════════════════════════════════════════╝", "color: #0284c7; font-weight: bold;");
      console.log(`Total operaciones registradas: ${this.operations.length} | Monitor activo: ${this.active}`);

      if (this.operations.length === 0) {
        console.warn("[EKKO DIAGNOSTICS] No hay operaciones registradas. Ejecuta EKKO_DIAG.start(), interactúa con el canvas y luego EKKO_DIAG.report().");
        return;
      }

      // Tabla resumen
      const summaryTable = this.operations.map(op => ({
        "ID": op.id,
        "HERRAMIENTA": op.tool,
        "DURACIÓN (ms)": op.durationMs,
        "PASOS": op.executionChain.length,
        "MASAS": `${op.beforeState.massesCount} ➔ ${op.afterState.massesCount}`,
        "CALADOS": `${op.beforeState.holesCount} ➔ ${op.afterState.holesCount}`,
        "INCONSISTENCIAS": op.inconsistencies.length > 0 ? `⚠ ${op.inconsistencies.length}` : "✓ 0",
        "ESTADO": op.status
      }));
      console.table(summaryTable);

      // Desglose de inconsistencias críticas
      const withIssues = this.operations.filter(op => op.inconsistencies.length > 0);
      if (withIssues.length > 0) {
        console.group("%c⚠ DETALLE DE INCONSISTENCIAS DETECTADAS", "color: #ef4444; font-weight: bold;");
        withIssues.forEach(op => {
          console.group(`Operación ${op.id} [${op.tool}]`);
          op.inconsistencies.forEach(inc => {
            console.warn(`[${inc.severity}] ${inc.code}: ${inc.message}`);
          });
          console.groupEnd();
        });
        console.groupEnd();
      } else {
        console.log("%c✓ Todas las operaciones conservaron integridad geométrica, semántica de capas y CSG.", "color: #10b981; font-weight: bold;");
      }
    }

    last() {
      if (this.operations.length === 0) {
        console.warn("[EKKO DIAGNOSTICS] No hay operaciones en el historial.");
        return;
      }
      const op = this.operations[this.operations.length - 1];
      console.log(`%c════════════════ DETALLE DE ÚLTIMA OPERACIÓN: ${op.id} ════════════════`, "color: #0284c7; font-weight: bold;");
      console.log("Herramienta:", op.tool, "| Acción:", op.userAction, "| Tiempo:", `${op.durationMs} ms`);

      console.group("NIVEL 3 — CADENA DE EJECUCIÓN");
      op.executionChain.forEach(step => {
        console.log(`[${String(step.step).padStart(2, '0')}] +${step.time.toFixed(1)}ms | ${step.module} ➔ ${step.function}()`, step.detail);
      });
      console.groupEnd();

      console.group("NIVEL 4 — ESTADO GEOMÉTRICO (BEFORE vs AFTER)");
      console.log("Elementos en capa:", `${op.beforeState.layerItemsCount} ➔ ${op.afterState.layerItemsCount}`);
      console.log("Masas sólidas:", `${op.beforeState.massesCount} ➔ ${op.afterState.massesCount}`);
      console.log("Calados activos:", `${op.beforeState.holesCount} ➔ ${op.afterState.holesCount}`);
      console.log("Z-Order final:", op.afterState.zOrderMap);
      console.groupEnd();

      console.group("NIVEL 5 — CONSISTENCIA");
      if (op.inconsistencies.length === 0) {
        console.log("%c✓ 100% Consistente. Sin anomalías.", "color: #10b981;");
      } else {
        op.inconsistencies.forEach(inc => {
          console.error(`[${inc.severity}] ${inc.code}: ${inc.message}`);
        });
      }
      console.groupEnd();
    }
  }

  // Instanciar y exponer globalmente
  const diagInstance = new EkkoDiagnosticsEngine();
  window.EKKO_DIAG = diagInstance;

  // Auto-inicializar ganchos defensivos al cargar
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => diagInstance.installHooks(), 300);
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => diagInstance.installHooks(), 300);
    });
  }
})();
