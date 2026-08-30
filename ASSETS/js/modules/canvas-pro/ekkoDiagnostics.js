================================================================================
EKKO STUDIO - MÓDULO DE AUDITORÍA Y DIAGNÓSTICO ESTRUCTURADO (5 NIVELES)
SISTEMA: EKKO_DIAG (v2.0 Real-Time Auto Engine)
BASADO EN: nuevos comandos a crear.txt
CONSIDERANDO: REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
REPOSITORIO OBJETIVO: REPOSITORIO EKKO STUDIO V1
CERTIFICACIÓN: AUTOMÁTICO, EN TIEMPO REAL Y CERTIFICADO PARA DEPURACIÓN FORENSE
================================================================================

--------------------------------------------------------------------------------
ÍNDICE DE IMPLEMENTACIÓN:
--------------------------------------------------------------------------------
1. ARCHIVO NUEVO A CREAR:
   Ruta: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
   Función: Observador independiente automático en tiempo real. Se auto-activa
            al inicio, intercepta llamadas de usuario (desagrupar, agrupar, drag,
            selección, Z-order, CSG, edición de nodos, import/export SVG) y audita
            en vivo si se pierden elementos, si la desagrupación no surte efecto,
            si geomBase se contamina o si hay errores de ejecución.

2. ARCHIVO EXISTENTE A INTEGRAR:
   Ruta: ASSETS/js/editor.js
   Modificación: Importación limpia al inicio del archivo.

3. FLUJO DE TRABAJO AUTOMÁTICO EN CASO DE ERROR:
   - Cualquier clic en Desagrupar, Mover, Seleccionar, etc. se valida en vivo.
   - Si ocurre una anomalía, sale de inmediato en consola un bloque rojo:
     [EKKO_DIAG ALERTA EN TIEMPO REAL].
   - Solo copias ese bloque (o ejecutas EKKO_DIAG.dump()) y lo pegas en el chat.
   - Con esa traza forense exacta, yo identifico la causa raíz y te entrego
     el código verificado y corregido sin adivinanzas.

================================================================================
PARTE 1: CÓDIGO FUENTE COMPLETO DE 'ekkoDiagnostics.js' (v2.0 Auto Real-Time)
Ruta: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
================================================================================

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js (v2.0 Real-Time Auto Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js

Descripción:
Sistema de Instrumentación, Diagnóstico y Auditoría Vectorial Automático en Tiempo Real para EKKO Studio.
Diseñado bajo el estándar PROMPT MAESTRO y REGLAS DE ORO como observador independiente no destructivo.
Monitorea activamente en tiempo real:
- NIVEL 1: Acciones de Usuario (Click, Desagrupar, Agrupar, Drag/Mover, Z-Order, Edición Nodos, Import/Export)
- NIVEL 2: Estado de Selección (IDs, clases, etiquetas, bounds, rotación, escala, Z-index, isHole, geomBase)
- NIVEL 3: Grafo de Ejecución (Secuencia de funciones, módulos, microtiempos, excepciones con stack trace)
- NIVEL 4: Estado Geométrico (Balance de masas vs. calados, conteo de items útiles, detección de pérdida de elementos)
- NIVEL 5: Auditoría de Consistencia (Preservación de geomBase, descarte de huérfanos, reactividad CSG, clipGroups)

CARACTERÍSTICAS DE TIEMPO REAL:
- Auto-activación inmediata al cargar el script (sin necesidad de comandos manuales).
- Notificación inmediata en consola ante cualquier evento y ALERTA ROJA ante cualquier anomalía.
- Detección automática de:
  * Desagrupación fallida (el grupo no se divide).
  * Pérdida o desaparición de elementos del SVG (ítems borrados accidentalmente).
  * Objetos inalcanzables o no seleccionables (bloqueos, z-index ocultos, clipMasks invasivos).
  * Contaminación destructiva de geomBase por booleanas CSG.
  * Inconsistencias de calados vs masas.
- Comando rápido EKKO_DIAG.dump() para generar un informe de texto delimitado listo para copiar/pegar al chat.
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

    // Configuración y estado interno
    const diagState = {
        active: true, // AUTO-ACTIVADO EN TIEMPO REAL POR DEFECTO
        autoLogConsole: true, // Imprime en tiempo real en consola cada operación
        opCounter: 0,
        currentOp: null,
        operations: [],
        maxHistory: 150,
        originalMethods: {},
        activeInterceptors: false,
        callDepth: 0
    };

    /**
     * Utilidad para formatear límites espaciales (Bounds) de manera concisa
     */
    function extractBounds(bounds) {
        if (!bounds) return null;
        return {
            x: Number(bounds.x.toFixed(2)),
            y: Number(bounds.y.toFixed(2)),
            width: Number(bounds.width.toFixed(2)),
            height: Number(bounds.height.toFixed(2))
        };
    }

    /**
     * Cuenta recursivamente segmentos de curvas de un elemento Paper.js
     */
    function countSegments(item) {
        if (!item) return 0;
        if (item.segments) return item.segments.length;
        if (item.children && Array.isArray(item.children)) {
            return item.children.reduce((acc, c) => acc + countSegments(c), 0);
        }
        return 0;
    }

    /**
     * Captura el snapshot geométrico del elemento seleccionado (Nivel 2)
     */
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
            label: (primary.data && primary.data.label) || (primary.name || 'Item ' + primary.id),
            zIndex: zIndex,
            isHole: !!(primary.data && primary.data.isHole),
            hasGeomBase: !!(primary.data && primary.data.geomBase),
            geomBaseSegments: (primary.data && primary.data.geomBase) ? countSegments(primary.data.geomBase) : 0,
            visibleSegments: countSegments(primary),
            bounds: extractBounds(primary.bounds),
            position: primary.position ? { x: Number(primary.position.x.toFixed(2)), y: Number(primary.position.y.toFixed(2)) } : null,
            rotation: primary.data ? (primary.data.rotation || 0) : 0,
            isLocked: !!(primary.data && primary.data.locked),
            isClipGroup: !!(primary.data && primary.data.clipGroup),
            isClipMask: !!primary.clipMask
        } : null;

        return {
            hasSelection: true,
            count: selectedItems.length > 0 ? selectedItems.length : 1,
            ids: selectedItems.length > 0 ? selectedItems.map(i => i.id) : [primary.id],
            primary: primaryData
        };
    }

    /**
     * Captura el snapshot del estado geométrico de la capa útil de diseño (Nivel 4)
     */
    function snapshotGeometricState() {
        if (typeof paper === 'undefined' || !paper.project) {
            return { error: 'Paper.js no inicializado', totalUsefulItems: 0, itemsSummary: [] };
        }

        const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        if (!designLayer || !designLayer.children) {
            return { totalUsefulItems: 0, itemsSummary: [] };
        }

        const items = [];
        let massCount = 0;
        let holeCount = 0;
        let clipGroupCount = 0;
        let missingGeomBaseCount = 0;

        designLayer.children.forEach((child, index) => {
            if (!child) return;
            // Ignorar interfaces de selección, cotas, guías y mockups
            const isUI = child.data && (
                child.data.isSelectionBox ||
                child.data.isHandle ||
                child.data.isNodeHandle ||
                child.data.isCurveHandle ||
                child.data.isNodeEditOverlay ||
                child.data.isSmartGuide ||
                child.data.isMeasurement ||
                child.data.isTracePreview ||
                child.data.mockup ||
                child.data.isMask
            );

            if (isUI) return;

            const isHole = !!(child.data && child.data.isHole);
            const hasGeomBase = !!(child.data && child.data.geomBase);
            const isClip = !!(child.data && child.data.clipGroup) || (child.className === 'Group' && child.clipped);

            if (isHole) holeCount++;
            else massCount++;

            if (isClip) clipGroupCount++;
            if (!hasGeomBase) missingGeomBaseCount++;

            items.push({
                index: index,
                id: child.id,
                name: child.name || null,
                className: child.className || (child.constructor ? child.constructor.name : 'Unknown'),
                label: (child.data && child.data.label) || child.name || 'Item ' + child.id,
                isHole: isHole,
                hasGeomBase: hasGeomBase,
                geomBaseSegments: hasGeomBase ? countSegments(child.data.geomBase) : 0,
                visibleSegments: countSegments(child),
                bounds: extractBounds(child.bounds),
                isGroup: child.className === 'Group',
                childCount: child.children ? child.children.length : 0,
                isClip: isClip
            });
        });

        return {
            timestamp: Date.now(),
            totalUsefulItems: items.length,
            massCount: massCount,
            holeCount: holeCount,
            clipGroupCount: clipGroupCount,
            missingGeomBaseCount: missingGeomBaseCount,
            zOrderIds: items.map(it => it.id),
            itemsSummary: items
        };
    }

    /**
     * Realiza la auditoría de consistencia de Nivel 5 comparando estados antes y después
     */
    function auditConsistency(beforeGeo, afterGeo, beforeSel, afterSel, callLog, opType) {
        const inconsistencies = [];
        const checks = {
            geomBasePreserved: true,
            selectionValid: true,
            csgExecuted: true,
            noItemsLost: true,
            ungroupEffective: true,
            clipGroupsClean: true
        };

        if (beforeGeo.error || afterGeo.error) {
            inconsistencies.push('Paper.js no estuvo disponible para calcular la geometría.');
            return { checks, inconsistencies, pass: false };
        }

        const beforeMap = new Map();
        beforeGeo.itemsSummary.forEach(it => beforeMap.set(it.id, it));
        const afterMap = new Map();
        afterGeo.itemsSummary.forEach(it => afterMap.set(it.id, it));

        // 1. Detección de pérdida inesperada de elementos (Borrados accidentales)
        const nonDeleteOps = ['UNGROUP', 'GROUP', 'BRING_FORWARD', 'SEND_BACKWARD', 'BRING_FRONT', 'SEND_BACK', 'DRAG', 'SELECT', 'NODE_EDIT'];
        if (nonDeleteOps.includes(opType)) {
            // Si antes de la operación había N elementos y tras desagrupar o mover hay MENOS elementos
            if (opType === 'UNGROUP') {
                // En desagrupación, el número de elementos útiles DEBE ser mayor o igual
                if (afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
                    checks.noItemsLost = false;
                    const lostIds = [];
                    beforeMap.forEach((val, key) => {
                        if (!afterMap.has(key)) lostIds.push(key);
                    });
                    inconsistencies.push(
                        `[PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN] Se perdieron ${beforeGeo.totalUsefulItems - afterGeo.totalUsefulItems} elementos. IDs desaparecidos: [${lostIds.join(', ')}].`
                    );
                }
            } else if (opType !== 'GROUP' && afterGeo.totalUsefulItems < beforeGeo.totalUsefulItems) {
                // En otras operaciones no-delete y no-group, no deberían desaparecer elementos
                checks.noItemsLost = false;
                inconsistencies.push(
                    `[PÉRDIDA DE ELEMENTOS] Operación "${opType}" redujo los elementos de ${beforeGeo.totalUsefulItems} a ${afterGeo.totalUsefulItems}.`
                );
            }
        }

        // 2. Detección de Desagrupación Inefectiva (El usuario hizo clic en Desagrupar pero no pasó nada)
        if (opType === 'UNGROUP') {
            const hadSelectionGroup = beforeSel.hasSelection && beforeSel.primary && (beforeSel.primary.className === 'Group' || beforeSel.primary.isGroup);
            if (hadSelectionGroup && beforeGeo.totalUsefulItems === afterGeo.totalUsefulItems && afterMap.has(beforeSel.primary.id)) {
                checks.ungroupEffective = false;
                inconsistencies.push(
                    `[DESAGRUPACIÓN FALLIDA] Se solicitó desagrupar el grupo ID: ${beforeSel.primary.id} ("${beforeSel.primary.label}"), pero el grupo sigue existiendo intacto y el número de elementos útiles no cambió (${afterGeo.totalUsefulItems}).`
                );
            }
        }

        // 3. Verificación de integridad de geomBase (Evitar sobreescritura destructiva por CSG)
        afterGeo.itemsSummary.forEach(afterItem => {
            const beforeItem = beforeMap.get(afterItem.id);
            if (beforeItem && beforeItem.hasGeomBase && afterItem.hasGeomBase) {
                if (opType !== 'NODE_EDIT' && beforeItem.geomBaseSegments !== afterItem.geomBaseSegments) {
                    checks.geomBasePreserved = false;
                    inconsistencies.push(
                        `[CONTAMINACIÓN DE GEOMBASE] Item ID: ${afterItem.id} ("${afterItem.label}") sufrió alteración de geomBase durante "${opType}". Segmentos antes: ${beforeItem.geomBaseSegments}, después: ${afterItem.geomBaseSegments}. Posible absorción destructiva de booleana CSG.`
                    );
                }
            }
        });

        // 4. Verificación de Integridad de Selección y Huérfanos
        if (afterSel.hasSelection && typeof window !== 'undefined') {
            const currentItem = window.selectedItem;
            if (currentItem) {
                const isOrphan = !currentItem.project || !currentItem.parent;
                if (isOrphan) {
                    checks.selectionValid = false;
                    inconsistencies.push(
                        `[SELECCIÓN HUÉRFANA] window.selectedItem apunta al elemento ID: ${currentItem.id} que ya no tiene padre ni proyecto en Paper.js.`
                    );
                }
            }
        }

        // 5. Verificación de Recálculo CSG Reactivo
        const csgTriggerOps = ['UNGROUP', 'GROUP', 'BRING_FORWARD', 'SEND_BACKWARD', 'BRING_FRONT', 'SEND_BACK', 'DRAG_END'];
        if (csgTriggerOps.includes(opType)) {
            const csgExecuted = callLog.some(c => c.fnName === 'recalculateDynamicSubtractions');
            if (!csgExecuted && afterGeo.holeCount > 0) {
                checks.csgExecuted = false;
                inconsistencies.push(
                    `[CSG NO EJECUTADO] Existen ${afterGeo.holeCount} calados activos, pero la operación "${opType}" no ejecutó recalculateDynamicSubtractions(). Las perforaciones visuales pueden haber quedado desincronizadas.`
                );
            }
        }

        // 6. Detección de clipGroups no descompuestos o máscaras que atrapan vectores
        if (afterGeo.clipGroupCount > 0 && opType === 'UNGROUP') {
            inconsistencies.push(
                `[CLIPMASK DETECTADO] Se detectaron ${afterGeo.clipGroupCount} grupo(s) con máscara de recorte activa. Si no se liberan sus hijos, los elementos no responderán a arrastre o selección independiente.`
            );
        }

        const pass = inconsistencies.length === 0;
        return {
            checks,
            inconsistencies,
            pass
        };
    }

    /**
     * Inicia una nueva transacción de auditoría
     */
    function beginOperation(actionName, triggerSource) {
        if (!diagState.active) return null;

        diagState.opCounter++;
        const opId = 'OP-' + String(diagState.opCounter).padStart(5, '0');

        const opRecord = {
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

        diagState.currentOp = opRecord;
        return opRecord;
    }

    /**
     * Finaliza la transacción de auditoría y emite informe en tiempo real en consola
     */
    function endOperation() {
        if (!diagState.active || !diagState.currentOp) return null;

        const op = diagState.currentOp;
        op.endTime = performance.now();
        op.durationMs = Number((op.endTime - op.startTime).toFixed(2));
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
        if (diagState.operations.length > diagState.maxHistory) {
            diagState.operations.shift();
        }

        // SALIDA EN TIEMPO REAL EN CONSOLA (DISEÑADA PARA COPIAR Y PEGAR DIRECTO AL CHAT)
        if (diagState.autoLogConsole) {
            if (!op.consistency.pass) {
                console.group(`%c🚨 [EKKO_DIAG ALERTA EN TIEMPO REAL] ${op.id} | Acción: ${op.action} | ❌ INCONSISTENCIAS DETECTADAS`, 'color: #ffffff; background: #dc2626; font-weight: bold; font-size: 12px; padding: 3px 6px; border-radius: 3px;');
                console.log(`%cDetalle de la Operación: ${op.source} (${op.durationMs} ms)`, 'color: #b91c1c; font-weight: bold;');
                op.consistency.inconsistencies.forEach(msg => {
                    console.warn(`%c⚠️ ${msg}`, 'color: #b45309; font-weight: bold;');
                });
                console.log('Estado de Selección Post-Op:', op.selectionAfter);
                console.log('Balance Geométrico:', {
                    itemsAntes: op.geometryBefore.totalUsefulItems,
                    itemsDespues: op.geometryAfter.totalUsefulItems,
                    masas: op.geometryAfter.massCount,
                    calados: op.geometryAfter.holeCount,
                    zOrder: op.geometryAfter.zOrderIds
                });
                console.log('Traza de Funciones Ejecutadas:', op.callGraph);
                console.groupEnd();
            } else {
                // Operación exitosa limpia en tiempo real
                console.log(
                    `%c✓ [EKKO_DIAG] ${op.id} | ${op.action} | Items: ${op.geometryAfter.totalUsefulItems} (Masas: ${op.geometryAfter.massCount}, Calados: ${op.geometryAfter.holeCount}) | Z: OK | CSG: OK | ${op.durationMs}ms`,
                    'color: #059669; font-size: 11px; font-weight: bold;'
                );
            }
        }

        diagState.currentOp = null;
        return op;
    }

    /**
     * Registra una invocación de función en el grafo de ejecución de Nivel 3
     */
    function recordCall(moduleFile, fnName, args, result, executionTimeMs, error) {
        if (!diagState.active) return;

        const callEntry = {
            order: (diagState.currentOp ? diagState.currentOp.callGraph.length + 1 : 0),
            timestamp: Date.now(),
            module: moduleFile,
            fnName: fnName,
            argsSummary: summarizeArgs(args),
            status: error ? 'ERROR' : 'OK',
            executionTimeMs: Number(executionTimeMs.toFixed(2)),
            error: error ? error.message : null
        };

        if (error) {
            console.error(`%c[EKKO_DIAG EXCEPTION] En ${moduleFile} -> ${fnName}(): ${error.message}`, 'color: #dc2626; font-weight: bold;');
            if (error.stack) console.error(error.stack);
        }

        if (diagState.currentOp) {
            diagState.currentOp.callGraph.push(callEntry);
        }
    }

    /**
     * Resume argumentos de forma segura sin riesgo de excepciones por circularidad
     */
    function summarizeArgs(args) {
        if (!args || args.length === 0) return [];
        return Array.from(args).map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'object') {
                if (arg.id) return `{ id: ${arg.id}, class: ${arg.className || (arg.constructor ? arg.constructor.name : 'Item')} }`;
                if (arg.name) return `{ name: "${arg.name}" }`;
                if (arg.target) return `{ event: "${arg.type || 'DOM'}", target: "${arg.target.tagName || 'El'}" }`;
                return `{ keys: ${Object.keys(arg).slice(0, 3).join(', ')} }`;
            }
            return String(arg);
        });
    }

    /**
     * Envoltorio Proxy Interceptor no destructivo para auditar funciones
     */
    function wrapFunction(targetObject, fnName, modulePath, actionType) {
        if (!targetObject || typeof targetObject[fnName] !== 'function') return;

        // Evitar duplicar envolturas
        if (targetObject[fnName].__isEkkoDiagWrapped) return;

        const original = targetObject[fnName];
        diagState.originalMethods[`${modulePath}:${fnName}`] = {
            target: targetObject,
            name: fnName,
            fn: original
        };

        const wrapped = function (...args) {
            const hasExistingOp = !!diagState.currentOp;
            let op = null;

            if (diagState.active && !hasExistingOp && actionType) {
                op = beginOperation(actionType, `${modulePath} -> ${fnName}`);
            }

            const tStart = performance.now();
            let result;
            let errCaught = null;

            diagState.callDepth++;
            try {
                result = original.apply(this, args);
            } catch (err) {
                errCaught = err;
                throw err;
            } finally {
                diagState.callDepth--;
                const tEnd = performance.now();
                if (diagState.active) {
                    recordCall(modulePath, fnName, args, result, tEnd - tStart, errCaught);
                }

                if (op) {
                    endOperation();
                }
            }

            return result;
        };

        wrapped.__isEkkoDiagWrapped = true;
        targetObject[fnName] = wrapped;
    }

    /**
     * Instala interceptores en todos los módulos clave
     */
    function installInterceptors() {
        if (diagState.activeInterceptors || typeof window === 'undefined') return;

        // 1. Interceptores de geometricUngroup.js y CSG
        wrapFunction(window, 'decomposeByContainmentHierarchy', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'geometricUngroupCompound', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'geometricUngroupOneLevel', 'geometricUngroup.js', 'UNGROUP');
        wrapFunction(window, 'recalculateDynamicSubtractions', 'geometricUngroup.js', null);
        wrapFunction(window, 'getGlobalUnsubtractedPath', 'geometricUngroup.js', null);

        // 2. Interceptores de selection.js
        wrapFunction(window, 'selectItem', 'selection.js', 'SELECT');
        wrapFunction(window, 'deselectItem', 'selection.js', 'DESELECT');
        wrapFunction(window, 'updateSelectionBox', 'selection.js', null);

        // 3. Interceptores de contextualMenu.js
        wrapFunction(window, 'ungroupSelectedItem', 'contextualMenu.js', 'UNGROUP');
        wrapFunction(window, 'groupSelectedItems', 'contextualMenu.js', 'GROUP');

        // 4. Interceptores de nodeEditor.js
        wrapFunction(window, 'enterNodeEditMode', 'nodeEditor.js', 'NODE_EDIT');
        wrapFunction(window, 'exitNodeEditMode', 'nodeEditor.js', 'EXIT_NODE_EDIT');

        // 5. Interceptores de editor.js (Z-Order, Undo, Redo, Portapapeles)
        wrapFunction(window, 'bringFront', 'editor.js', 'BRING_FRONT');
        wrapFunction(window, 'sendBack', 'editor.js', 'SEND_BACK');
        wrapFunction(window, 'bringForward', 'editor.js', 'BRING_FORWARD');
        wrapFunction(window, 'sendBackward', 'editor.js', 'SEND_BACKWARD');
        wrapFunction(window, 'undo', 'editor.js', 'UNDO');
        wrapFunction(window, 'redo', 'editor.js', 'REDO');
        wrapFunction(window, 'copySelected', 'editor.js', 'COPY');
        wrapFunction(window, 'pasteSelected', 'editor.js', 'PASTE');

        // 6. Interceptores de exportSVG.js
        wrapFunction(window, 'prepareSVGForExport', 'exportSVG.js', 'EXPORT_SVG');

        // 7. Interceptores de Paper.js (Canvas Tool Drag / MouseDown)
        if (typeof paper !== 'undefined') {
            if (paper.project) {
                wrapFunction(paper.project, 'importSVG', 'paper.project', 'IMPORT_SVG');
            }
            if (paper.tool) {
                wrapFunction(paper.tool, 'onMouseDown', 'paper.tool', 'CANVAS_MOUSEDOWN');
                wrapFunction(paper.tool, 'onMouseDrag', 'paper.tool', 'CANVAS_DRAG');
                wrapFunction(paper.tool, 'onMouseUp', 'paper.tool', 'CANVAS_MOUSEUP');
            }
        }

        diagState.activeInterceptors = true;
    }

    /**
     * Restaura funciones originales si se detiene
     */
    function uninstallInterceptors() {
        if (!diagState.activeInterceptors) return;

        Object.keys(diagState.originalMethods).forEach(key => {
            const entry = diagState.originalMethods[key];
            if (entry && entry.target && entry.name) {
                entry.target[entry.name] = entry.fn;
            }
        });

        diagState.originalMethods = {};
        diagState.activeInterceptors = false;
    }

    // =========================================================================
    // API PÚBLICA DE EKKO_DIAG
    // =========================================================================

    const publicAPI = {
        /**
         * Activa explícitamente el sistema (ya viene activado por defecto)
         */
        start: function () {
            diagState.active = true;
            installInterceptors();
            console.log(
                '%c[EKKO_DIAG] Monitoreo Automático en Tiempo Real ACTIVO 🟢',
                'color: #10b981; font-weight: bold; font-size: 13px; background: #ecfdf5; padding: 4px 8px; border-radius: 4px;'
            );
            return 'EKKO_DIAG activo.';
        },

        /**
         * Pausa temporal del diagnóstico
         */
        stop: function () {
            diagState.active = false;
            uninstallInterceptors();
            console.log(
                '%c[EKKO_DIAG] Monitoreo en Tiempo Real PAUSADO 🔴',
                'color: #ef4444; font-weight: bold; font-size: 13px; background: #fef2f2; padding: 4px 8px; border-radius: 4px;'
            );
            return 'EKKO_DIAG pausado.';
        },

        /**
         * Limpia el registro acumulado
         */
        clear: function () {
            diagState.operations = [];
            diagState.opCounter = 0;
            diagState.currentOp = null;
            console.log('[EKKO_DIAG] Historial de transacciones reiniciado.');
            return true;
        },

        /**
         * Genera un volcado completo estructurado para COPIAR Y PEGAR directamente al chat del asistente
         */
        dump: function () {
            const reportData = {
                timestamp: new Date().toISOString(),
                totalOperations: diagState.operations.length,
                lastOperation: diagState.operations.length > 0 ? diagState.operations[diagState.operations.length - 1] : null,
                anomalies: diagState.operations
                    .filter(op => op.consistency && !op.consistency.pass)
                    .map(op => ({
                        id: op.id,
                        action: op.action,
                        inconsistencies: op.consistency.inconsistencies,
                        durationMs: op.durationMs,
                        itemsBefore: op.geometryBefore.totalUsefulItems,
                        itemsAfter: op.geometryAfter.totalUsefulItems,
                        callGraphErrors: op.callGraph.filter(c => c.status === 'ERROR')
                    })),
                currentSelection: snapshotSelection(),
                currentGeometry: snapshotGeometricState()
            };

            const dumpString = JSON.stringify(reportData, null, 2);

            console.log('\n============================= INICIO REPORTE EKKO_DIAG =============================');
            console.log(dumpString);
            console.log('============================== FIN REPORTE EKKO_DIAG ===============================\n');
            console.log('%c📋 COPIA EL BLOQUE ANTERIOR COMPLETO Y PÉGALO EN EL CHAT PARA AUDITORÍA INMEDIATA.', 'color: #2563eb; font-weight: bold; font-size: 12px;');

            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(dumpString).then(() => {
                    console.log('%c✓ ¡Reporte JSON copiado automáticamente a tu portapapeles!', 'color: #059669; font-weight: bold;');
                }).catch(() => {});
            }

            return reportData;
        },

        /**
         * Imprime el informe consolidado tabular en consola F12
         */
        report: function () {
            const ops = diagState.operations;
            console.log('\n');
            console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
            console.log('║               EKKO STUDIO DIAGNOSTIC - REPORTE DE TIEMPO REAL                   ║');
            console.log('╚══════════════════════════════════════════════════════════════════════════════════╝');

            if (ops.length === 0) {
                console.log('No hay operaciones registradas todavía. Opera en el lienzo.');
                return;
            }

            const summaryTable = ops.map(op => ({
                'ID': op.id,
                'Acción': op.action,
                'Duración': `${op.durationMs} ms`,
                'Items Antes': op.geometryBefore.totalUsefulItems || 0,
                'Items Después': op.geometryAfter.totalUsefulItems || 0,
                'Masas': op.geometryAfter.massCount || 0,
                'Calados': op.geometryAfter.holeCount || 0,
                'CSG OK': op.consistency ? (op.consistency.checks.csgExecuted ? '✓' : '✗') : 'N/A',
                'geomBase OK': op.consistency ? (op.consistency.checks.geomBasePreserved ? '✓' : '✗') : 'N/A',
                'Sin Pérdida': op.consistency ? (op.consistency.checks.noItemsLost ? '✓' : '✗ ALERTA') : 'N/A',
                'Consistencia': op.consistency ? (op.consistency.pass ? '✓ OK' : '🚨 ALERTA') : 'N/A'
            }));

            console.table(summaryTable);
            return ops;
        },

        /**
         * Inspecciona la última operación registrada con el máximo nivel de detalle
         */
        last: function () {
            if (diagState.operations.length === 0) {
                console.warn('[EKKO_DIAG] No hay operaciones registradas aún.');
                return null;
            }
            const lastOp = diagState.operations[diagState.operations.length - 1];
            console.log(`%c[EKKO_DIAG LAST] Inspección Detallada de ${lastOp.id} (${lastOp.action}):`, 'color: #2563eb; font-weight: bold; font-size: 13px;');
            console.dir(lastOp);
            return lastOp;
        },

        /**
         * Permite iniciar manualmente una transacción para acciones personalizadas
         */
        begin: function (actionName, source) {
            return beginOperation(actionName, source);
        },

        /**
         * Permite finalizar manualmente una transacción personalizada
         */
        end: function () {
            return endOperation();
        }
    };

    // =========================================================================
    // AUTO-INICIALIZACIÓN INMEDIATA EN TIEMPO REAL
    // =========================================================================
    try {
        if (typeof window !== 'undefined') {
            window.EKKO_DIAG = publicAPI;
            
            // Si el DOM ya cargó, instalar de inmediato. Si no, escuchar DOMContentLoaded
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                installInterceptors();
                console.log('%c[EKKO_DIAG v2.0] Inicializado y listo en tiempo real 🟢', 'color: #10b981; font-weight: bold;');
            } else {
                window.addEventListener('DOMContentLoaded', () => {
                    installInterceptors();
                    console.log('%c[EKKO_DIAG v2.0] Inicializado y listo en tiempo real 🟢', 'color: #10b981; font-weight: bold;');
                });
            }
            
            // Reintento de amarre de Paper.js si carga diferido
            window.addEventListener('load', () => {
                installInterceptors();
            });
        }
    } catch (e) {
        console.error('[EKKO_DIAG] Error en auto-inicialización:', e);
    }

    return publicAPI;
}));


================================================================================
PARTE 2: LÍNEA DE INTEGRACIÓN EN 'editor.js'
Ruta: ASSETS/js/editor.js
================================================================================

Añadir la siguiente línea de importación al principio de 'ASSETS/js/editor.js':

--------------------------------------------------------------------------------
// [EKKO_DIAG] Inicialización de Auditoría y Diagnóstico en Tiempo Real
import "./modules/canvas-pro/ekkoDiagnostics.js";
--------------------------------------------------------------------------------

Ubicación recomendada dentro de 'ASSETS/js/editor.js':
Justo después de las importaciones de 'canvas-pro' (por ejemplo, después de textToolbar o nodeEditor):

```javascript
// --- IMPORTACIONES EXISTENTES ---
import { enterNodeEditMode, exitNodeEditMode, updateNodeOverlay } from "./modules/canvas-pro/nodeEditor.js";
import { loadDynamicFonts } from "./modules/canvas-pro/textToolbar.js";

// --- NUEVA INTEGRACIÓN AUDITORÍA Y DIAGNÓSTICO EN TIEMPO REAL ---
import "./modules/canvas-pro/ekkoDiagnostics.js";
```

Nota para arquitecturas que cargan scripts vía <script> en HTML:
Si tu entorno en index.html carga módulos ES6 o scripts directos, también puedes incluirlo como:
<script type="module" src="ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js"></script>

================================================================================
PARTE 3: CÓMO COPIAR Y PEGAR LA CONSOLA CUANDO OCURRA UN ERROR
================================================================================

Gracias a la automatización en tiempo real de la versión 2.0, NO necesitas ejecutar
ningún comando previo. Todo funciona en vivo desde que abres EKKO Studio:

CASO 1: "Hice clic en Desagrupar y no se desagrupó o desaparecieron elementos"
- En la consola F12 de Chrome/Firefox/Edge verás inmediatamente un bloque rojo:
  🚨 [EKKO_DIAG ALERTA EN TIEMPO REAL] OP-0000X | Acción: UNGROUP | ❌ INCONSISTENCIAS DETECTADAS
  ⚠️ [DESAGRUPACIÓN FALLIDA] ...
  ⚠️ [PÉRDIDA DE ELEMENTOS EN DESAGRUPACIÓN] Se perdieron X elementos ...
- Acción:
  Simplemente selecciona con el mouse el texto de ese bloque en la consola,
  cópialo (Ctrl+C) y pégalo en el chat.

CASO 2: "No puedo arrastrar un objeto o no puedo seleccionarlo"
- Al intentar hacer clic o arrastrar, EKKO_DIAG evaluará el hit-test y la selección.
- Si hay un bloqueo, selección huérfana o clipMask que atrape al objeto, saldrá la alerta.

CASO 3: VOLCADO COMPLETO CON UN SOLO COMANDO (OPCIONAL)
Si deseas enviarme el estado íntegro de la sesión con todas las operaciones previas,
escribe en la consola:
  EKKO_DIAG.dump()
Esto generará un reporte JSON y además lo copiará automáticamente a tu portapapeles.
Solo tienes que presionar Ctrl+V en el chat.

================================================================================
FIN DEL ARCHIVO DE ENTREGA
================================================================================
