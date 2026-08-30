/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (PRO Node Engine v30)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/nodeEditor.js
   
   Descripción:
   Motor de edición interactiva de nodos vectoriales (vértices y tiradores Bézier)
   para EKKO Studio basado en Paper.js.
   
   Cumple rigurosamente con:
   - CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
   - REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
   - DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt):
     Resuelve de raíz el bug crítico donde 'activeNodeItem.clone({ insert: false })'
     sobreescribía 'geomBase' con la geometría visible ya mutilada/perforada por CSG.
   - Preservación inmaculada de 'geomBase' en coordenadas locales neutras.
   - Sincronización reactiva del motor CSG durante el arrastre y salida de nodos.
   ========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

/**
 * Obtiene el elemento de contenido real si el item está encapsulado en un grupo de recorte.
 * @param {paper.Item} item
 * @returns {paper.Item|null}
 */
function getContentItem(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
    if (!item.children) return item;
    const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    return content || item.children || item;
  }
  return item;
}

// Variables de estado del editor de nodos
let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set();
let isDraggingNode = false;
let dragStartPoint = null;
let nodeEditTool = null;
let previousTool = null;

/**
 * Extrae todos los trazados terminales (paper.Path) de un elemento o grupo compuesto.
 * @param {paper.Item} item
 * @returns {Array<paper.Path>}
 */
function getTargetPaths(item) {
  const paths = [];
  if (item instanceof paper.Path) {
    paths.push(item);
  } else if (item instanceof paper.CompoundPath) {
    if (item.children) {
      item.children.forEach(c => {
        if (c instanceof paper.Path) paths.push(c);
      });
    }
  }
  return paths;
}

/**
 * Sincroniza la mutación de los segmentos directamente sobre 'geomBase'.
 * 
 * Corrección de Arquitectura Fundamental:
 * Jamás clona 'activeNodeItem' directamente para asignarlo a 'geomBase', porque el item
 * visible puede contener perforaciones booleanas activas causadas por capas superiores en Z.
 * En su lugar, transforma los trazados editados a su espacio local neutro invirtiendo
 * la matriz de transformación del elemento y reconstruye 'geomBase' inmaculada.
 * 
 * @param {paper.Item} item
 */
function syncGeometryToGeomBase(item) {
  if (!item || !item.data || !item.data.geomBase) return;
  const target = getContentItem(item);
  if (!target) return;

  const newGeomBase = new paper.CompoundPath({ insert: false });
  const paths = getTargetPaths(target);

  paths.forEach(p => {
    const pClone = p.clone({ insert: false });
    // Proyectar de vuelta al espacio local neutro (matriz identidad)
    if (item.matrix && !item.matrix.isIdentity()) {
      pClone.matrix = item.matrix.inverted();
      pClone.applyMatrix = true;
    }
    newGeomBase.addChild(pClone);
  });

  newGeomBase.matrix = new paper.Matrix();

  if (item.data.geomBase) {
    item.data.geomBase.remove();
  }
  item.data.geomBase = newGeomBase;
}

/**
 * Ingresa al modo de edición de nodos para el elemento seleccionado.
 * @param {paper.Item} item
 */
export function enterNodeEditMode(item) {
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return;
  const target = getContentItem(item);
  if (!target) return;

  // Conversión automática de texto a curvas si se intenta editar nodos de un PointText
  if (target instanceof paper.PointText) {
    if (confirm("Para editar los nodos de este texto, primero debes convertirlo a curvas. ¿Deseas continuar?")) {
      const converted = convertTextToPath(target);
      if (converted) {
        const parent = target.parent;
        parent.addChild(converted);
        target.remove();
        item = converted;
      } else {
        return;
      }
    } else {
      return;
    }
  }

  activeNodeItem = item;
  window.nodeEditMode = true;
  window.nodeEditTarget = item;

  // Ocultar caja envolvente de selección global
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(null);
  }

  // Si el elemento es un sólido afectado por CSG, mostramos temporalmente su silueta completa
  // para permitir al operador editar su masa íntegra sin deformaciones visuales parásitas
  if (activeNodeItem.data && activeNodeItem.data.geomBase && !activeNodeItem.data.isHole) {
    const pristine = activeNodeItem.data.geomBase.clone({ insert: false });
    pristine.matrix = activeNodeItem.matrix.clone();
    activeNodeItem.removeChildren();
    if (pristine instanceof paper.CompoundPath) {
      const cl = pristine.clone({ insert: false });
      activeNodeItem.addChildren(cl.removeChildren());
      cl.remove();
    } else if (pristine instanceof paper.Path) {
      activeNodeItem.addChild(pristine.clone({ insert: false }));
    }
    pristine.remove();
  }

  drawNodeHandles();
  setupNodeEditTool();

  const nodeEl = document.getElementById('ctxNodeEditControls');
  if (nodeEl) nodeEl.classList.remove('hidden');

  paper.view.update();
}

/**
 * Sale del modo de edición de nodos y restaura el estado interactivo general.
 * @param {boolean} skipSelect Si es true, no vuelve a seleccionar el item automáticamente
 */
export function exitNodeEditMode(skipSelect = false) {
  window.nodeEditMode = false;
  window.nodeEditTarget = null;
  const itemToRestore = activeNodeItem;
  activeNodeItem = null;

  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
    nodeHandlesGroup = null;
  }
  selectedNodes.clear();

  if (previousTool) {
    previousTool.activate();
  }

  const nodeEl = document.getElementById('ctxNodeEditControls');
  if (nodeEl) nodeEl.classList.add('hidden');

  // Recalcular sustracciones dinámicas CSG para restablecer calados físicos exactos
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }

  if (itemToRestore && !skipSelect && typeof window.selectItem === 'function') {
    window.selectItem(itemToRestore);
  }

  paper.view.update();
}

/**
 * Renderiza los tiradores visuales de los nodos sobre el lienzo.
 */
function drawNodeHandles() {
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
    nodeHandlesGroup = null;
  }
  if (!activeNodeItem) return;

  const target = getContentItem(activeNodeItem);
  if (!target) return;

  nodeHandlesGroup = new paper.Group();
  nodeHandlesGroup.data = { isSelectionBox: true, isNodeOverlay: true, isNodeEditOverlay: true };

  const paths = getTargetPaths(target);
  const zoom = paper.view.zoom;
  const handleSize = 6 / zoom;
  let globalPointIdx = 0;

  paths.forEach(path => {
    path.segments.forEach(seg => {
      const pt = path.localToGlobal(seg.point);
      const isSelected = selectedNodes.has(globalPointIdx);

      const handle = new paper.Path.Rectangle({
        center: pt,
        size: new paper.Size(handleSize, handleSize),
        fillColor: isSelected ? '#3b82f6' : '#ffffff',
        strokeColor: '#1d4ed8',
        strokeWidth: 1.5 / zoom,
        insert: false
      });

      handle.data = {
        isNodeHandle: true,
        pathId: path.id,
        pointIndex: globalPointIdx,
        segment: seg,
        ownerPath: path
      };

      nodeHandlesGroup.addChild(handle);
      globalPointIdx++;
    });
  });

  nodeHandlesGroup.bringToFront();
}

/**
 * Configura la herramienta de interacción con nodos (Paper.js Tool).
 */
function setupNodeEditTool() {
  if (!nodeEditTool) {
    nodeEditTool = new paper.Tool();
    nodeEditTool.name = 'nodeEditTool';

    nodeEditTool.onMouseDown = function(e) {
      const hit = paper.project.hitTest(e.point, {
        segments: false,
        stroke: false,
        fill: false,
        tolerance: 8 / paper.view.zoom,
        match: hitResult => hitResult.item && hitResult.item.data && hitResult.item.data.isNodeHandle
      });

      if (hit && hit.item) {
        isDraggingNode = true;
        dragStartPoint = e.point.clone();
        const ptIdx = hit.item.data.pointIndex;
        if (!e.modifiers.shift) {
          if (!selectedNodes.has(ptIdx)) {
            selectedNodes.clear();
            selectedNodes.add(ptIdx);
          }
        } else {
          if (selectedNodes.has(ptIdx)) {
            selectedNodes.delete(ptIdx);
          } else {
            selectedNodes.add(ptIdx);
          }
        }
        drawNodeHandles();
      } else {
        selectedNodes.clear();
        drawNodeHandles();
      }
    };

    nodeEditTool.onMouseDrag = function(e) {
      if (!isDraggingNode || selectedNodes.size === 0 || !activeNodeItem) return;
      const delta = e.point.subtract(dragStartPoint);
      dragStartPoint = e.point.clone();

      nodeHandlesGroup.children.forEach(handle => {
        if (handle.data && handle.data.isNodeHandle && selectedNodes.has(handle.data.pointIndex)) {
          const seg = handle.data.segment;
          const ownerPath = handle.data.ownerPath;
          const localDelta = ownerPath.globalToLocal(ownerPath.localToGlobal(seg.point).add(delta)).subtract(seg.point);
          seg.point = seg.point.add(localDelta);
          handle.position = ownerPath.localToGlobal(seg.point);
        }
      });

      // Sincronizar las mutaciones sobre la geomBase original
      syncGeometryToGeomBase(activeNodeItem);

      // Si el elemento mutado es un calado activo, recalcula las perforaciones dinámicas en tiempo real
      if (activeNodeItem.data && activeNodeItem.data.isHole) {
        recalculateDynamicSubtractions();
      }

      paper.view.update();
    };

    nodeEditTool.onMouseUp = function() {
      if (isDraggingNode) {
        isDraggingNode = false;
        syncGeometryToGeomBase(activeNodeItem);
        recalculateDynamicSubtractions();
        if (typeof window.saveHistory === 'function') window.saveHistory();
        paper.view.update();
      }
    };
  }

  previousTool = paper.tool;
  nodeEditTool.activate();
}

/**
 * Convierte texto tipográfico a curvas vectoriales compuestas con su geomBase inicializada.
 * @param {paper.PointText} pointText
 * @returns {paper.CompoundPath|null}
 */
function convertTextToPath(pointText) {
  if (!pointText) return null;
  const compound = pointText.createPath({ insert: false });
  compound.fillColor = pointText.fillColor;
  compound.strokeColor = pointText.strokeColor;
  compound.strokeWidth = pointText.strokeWidth;
  compound.data = {
    label: "Texto Convertido",
    isHole: false,
    geomBase: compound.clone({ insert: false })
  };
  return compound;
}

/**
 * Actualiza la escala visual de los tiradores de nodos frente a eventos de zoom.
 */
export function updateNodeHandlesScale() {
  if (!nodeHandlesGroup || !window.paper) return;
  drawNodeHandles();
}

// Exposición global segura
if (typeof window !== 'undefined') {
  window.enterNodeEditMode = enterNodeEditMode;
  window.exitNodeEditMode = exitNodeEditMode;
  window.updateNodeHandlesScale = updateNodeHandlesScale;
}
