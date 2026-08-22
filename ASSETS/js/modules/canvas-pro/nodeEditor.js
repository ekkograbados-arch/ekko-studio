/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (Interactive Vector Node Editor)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripción: Motor avanzado de edición de puntos de anclaje y nodos vectoriales.
Permite seleccionar, arrastrar, deformar, multiseleccionar y eliminar nodos de
forma independiente para trazados simples y compuestos (CompoundPaths).
========================================================================= */

let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedSegmentRefs = [];
let isMarqueeDragging = false;
let marqueeRect = null;
let marqueeStart = null;

/**
 * Activa el modo de edición de nodos para el elemento seleccionado.
 * Si es un PointText, ofrece convertirlo a curvas primero de forma segura.
 */
export function enterNodeEditMode(item) {
  if (!item || item.data?.locked || item.data?.mockup) return;

  // Si es un PointText nativo, convertimos a curvas para poder editar nodos
  let target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  if (!target) return;

  if (target instanceof paper.PointText || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    const confirmConvert = confirm("¿Deseas convertir este texto a curvas vectoriales para poder deformar y editar sus nodos de forma independiente? (El texto dejará de ser editable por teclado)");
    if (!confirmConvert) return;
    
    target = convertTextToCurves(item);
    if (!target) return;
  }

  // Guardar estado e inicializar
  activeNodeItem = item;
  selectedSegmentRefs = [];
  
  if (typeof window.deselectItem === 'function') {
    window.deselectItem();
  }

  renderNodeHandles();
  
  // Registrar escuchador de teclado especial para borrar nodos
  if (!window.nodeEditorKeyBound) {
    window.nodeEditorKeyBound = true;
    document.addEventListener('keydown', handleNodeEditorKeys);
  }

  paper.view.update();
}

/**
 * Sale del modo de edición de nodos limpiando los controladores visuales
 */
export function exitNodeEditMode() {
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
    nodeHandlesGroup = null;
  }
  activeNodeItem = null;
  selectedSegmentRefs = [];
  paper.view.update();
}

/**
 * Convierte texto nativo a curvas vectoriales planas (CompoundPath o Group de Paths)
 */
function convertTextToCurves(item) {
  if (typeof window.saveHistory === 'function') window.saveHistory();

  let textItem = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  if (!textItem) return null;

  // Generamos el trazado vectorial a partir de las curvas del texto en Paper.js
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  
  // Crear un trazado compuesto a partir de la geometría del texto
  const textPath = textItem.createPath();
  textPath.fillColor = textItem.fillColor;
  textPath.data = { label: "Texto Convertido" };

  let finalItem;
  if (item.data?.clipGroup && typeof window.clipItem === 'function') {
    item.remove();
    finalItem = window.clipItem(textPath);
  } else {
    item.remove();
    finalItem = textPath;
    parent.addChild(finalItem);
  }

  if (finalItem.parent) {
    finalItem.parent.insertChild(index, finalItem);
  }

  return textPath;
}

/**
 * Dibuja círculos interactivos blancos con borde rojo sobre cada nodo del trazado
 */
function renderNodeHandles() {
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
  }

  if (!activeNodeItem) return;

  nodeHandlesGroup = new paper.Group();
  nodeHandlesGroup.data = { isNodeHandlesContainer: true };

  const target = activeNodeItem.data?.clipGroup ? activeNodeItem.children.find(c => !c.clipMask) : activeNodeItem;
  if (!target) return;

  // Obtener todos los trazados (pueden ser hijos de un CompoundPath)
  const paths = [];
  if (target instanceof paper.CompoundPath) {
    paths.push(...target.children);
  } else if (target instanceof paper.Path) {
    paths.push(target);
  }

  const zoom = paper.view.zoom;
  const radius = 4.5 / zoom;
  const strokeW = 1.5 / zoom;

  paths.forEach(path => {
    path.segments.forEach(segment => {
      const handleCircle = new paper.Path.Circle({
        center: segment.point,
        radius: radius,
        fillColor: 'white',
        strokeColor: '#ef4444',
        strokeWidth: strokeW,
        parent: nodeHandlesGroup
      });

      // Guardar referencias circulares seguras por ID para evitar crashes en el historial
      handleCircle.data = {
        isNodeHandle: true,
        segmentIndex: segment.index,
        parentPathId: path.id,
        targetItemId: activeNodeItem.id
      };

      // Interactividad individual del nodo
      handleCircle.onMouseEnter = () => {
        if (!selectedSegmentRefs.some(ref => ref.segment === segment)) {
          handleCircle.fillColor = '#fee2e2';
        }
        paper.view.element.style.cursor = 'pointer';
      };

      handleCircle.onMouseLeave = () => {
        if (!selectedSegmentRefs.some(ref => ref.segment === segment)) {
          handleCircle.fillColor = 'white';
        }
        paper.view.element.style.cursor = 'default';
      };

      handleCircle.onMouseDown = (e) => {
        e.stopPropagation();
        if (typeof window.saveHistory === 'function') window.saveHistory();

        const isAlreadySelected = selectedSegmentRefs.some(ref => ref.segment === segment);

        if (!e.modifiers.shift) {
          if (!isAlreadySelected) {
            selectedSegmentRefs = [{ segment, handleCircle, path }];
            nodeHandlesGroup.children.forEach(c => {
              if (c.data?.isNodeHandle) c.fillColor = 'white';
            });
            handleCircle.fillColor = '#ef4444'; // Pintar de rojo sólido (seleccionado)
          }
        } else {
          if (isAlreadySelected) {
            selectedSegmentRefs = selectedSegmentRefs.filter(ref => ref.segment !== segment);
            handleCircle.fillColor = 'white';
          } else {
            selectedSegmentRefs.push({ segment, handleCircle, path });
            handleCircle.fillColor = '#ef4444';
          }
        }
      };

      handleCircle.onMouseDrag = (e) => {
        e.stopPropagation();
        const delta = e.delta;

        // Mover todos los nodos seleccionados en conjunto
        selectedSegmentRefs.forEach(ref => {
          ref.segment.point = ref.segment.point.add(delta);
          ref.handleCircle.position = ref.segment.point;
        });

        // Actualizar el enmascarado/redibujado del lienzo
        paper.view.update();
      };
    });
  });

  nodeHandlesGroup.bringToFront();
}

/**
 * Escucha la tecla Suprimir/Retroceso para eliminar los nodos seleccionados
 */
function handleNodeEditorKeys(e) {
  if (!activeNodeItem || selectedSegmentRefs.length === 0) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (typeof window.saveHistory === 'function') window.saveHistory();

    // Eliminar los segmentos del trazado
    selectedSegmentRefs.forEach(ref => {
      ref.segment.remove();
    });

    selectedSegmentRefs = [];
    renderNodeHandles();
    paper.view.update();
  }
}

// Exposición global segura
if (typeof window !== 'undefined') {
  window.enterNodeEditMode = enterNodeEditMode;
  window.exitNodeEditMode = exitNodeEditMode;
}
