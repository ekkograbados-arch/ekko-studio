/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (PRO Node Engine v32 - CSG Reactive & Clean Stacking)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripción:
Motor de edición interactiva de nodos vectoriales (vértices y tiradores Bézier)
para EKKO Studio basado en Paper.js.
Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt):
  * Resuelve de raíz el bug crítico donde 'activeNodeItem.clone({ insert: false })'
    sobreescribía 'geomBase' con la geometría visible ya mutilada/perforada por CSG.
  * Preservación inmaculada de 'geomBase' en coordenadas locales neutras.
  * Blindaje de edición de calados activos (isHole): visibilidad forzada y contorno interactivo en edición.
  * Sincronización reactiva del motor CSG en vivo al arrastrar nodos de calados.
  * Preservación de vértices prístinos al editar masas sólidas sin aniquilación por CSG intermedio.
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
        if (content) return content;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

function isPlacedSymbol(item) {
    return item && (item.className === 'PlacedSymbol' || item.className === 'SymbolItem' ||
        (typeof paper !== 'undefined' && ((paper.PlacedSymbol && item instanceof paper.PlacedSymbol) || (paper.SymbolItem && item instanceof paper.SymbolItem))));
}

/**
 * Obtiene la matriz acumulada de transformación de un elemento ascendiendo
 * hasta llegar a la capa activa (Layer), evitando desfasajes por jerarquías intermedias.
 */
function getMatrixRelativeTo(item, targetAncestor) {
    let matrix = new paper.Matrix();
    let current = item;
    while (current && current !== targetAncestor && !(current instanceof paper.Layer)) {
        if (current.matrix) {
            matrix = current.matrix.chain(matrix);
        }
        current = current.parent;
    }
    return matrix;
}

function getGlobalMatrix(item) {
    if (!item) return new paper.Matrix();
    if (item.data && item.data.globalMatrix) {
        return item.data.globalMatrix.clone();
    }
    return getMatrixRelativeTo(item, null);
}

// Variables de estado del editor de nodos
let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set();
let isDraggingNode = false;
let isDraggingHandle = false;
let activeHandleData = null;
let dragStartPoint = null;
let marqueeRect = null;
let nodeEditTool = null;
let previousTool = null;
let disabledClipGroups = [];
let isAddNodeActive = false;

/**
 * Extrae todos los trazados terminales (paper.Path) de un elemento o compuesto.
 * @param {paper.Item} item
 * @returns {Array<paper.Path>}
 */
function getTargetPaths(item) {
    const target = getContentItem(item);
    if (!target) return [];
    const paths = [];

    const findPathsRecursive = (el) => {
        if (el instanceof paper.Path) {
            paths.push(el);
        } else if (el instanceof paper.CompoundPath) {
            if (el.children && el.children.length > 0) {
                el.children.forEach(c => findPathsRecursive(c));
            }
        } else if (el instanceof paper.Group) {
            if (el.children && el.children.length > 0) {
                el.children.forEach(c => findPathsRecursive(c));
            }
        }
    };

    findPathsRecursive(target);
    return paths;
}

/**
 * SINCRONIZACIÓN IMPECABLE DE GEOMETRÍA BASE (ANTI-CORRUPCIÓN CSG)
 * Transforma los trazados editados a su espacio local neutro invirtiendo
 * la matriz de transformación del elemento y reconstruye 'geomBase' inmaculada.
 *
 * @param {paper.Item} item
 */
function syncGeometryToGeomBase(item) {
    if (!item || !item.data || !item.data.geomBase) return;
    const target = getContentItem(item);
    if (!target) return;

    // Clonar la geometría directamente en neutro sin insertarla en el canvas
    const newGeomBase = target.clone({ insert: false });

    // Invertir la matriz actual para preservar las coordenadas locales inmaculadas
    const currentMatrix = target.matrix ? target.matrix.clone() : new paper.Matrix();
    if (!currentMatrix.isIdentity()) {
        newGeomBase.matrix = currentMatrix.inverted();
    } else {
        newGeomBase.matrix = new paper.Matrix();
    }

    if (item.data.geomBase) {
        try {
            item.data.geomBase.remove();
        } catch (e) {}
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
        if (confirm("Para editar los puntos de este texto, primero debemos convertirlo en curvas vectoriales. ¿Deseas convertirlo?")) {
            const converted = convertTextToPath(target);
            if (converted) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                const parent = item.parent || paper.project.activeLayer;
                if (item.data && item.data.clipGroup && typeof window.clipItem === 'function') {
                    const clipped = window.clipItem(converted);
                    clipped.matrix = item.matrix.clone();
                    parent.addChild(clipped);
                    activeNodeItem = clipped;
                } else {
                    converted.matrix = item.matrix.clone();
                    parent.addChild(converted);
                    activeNodeItem = converted;
                }
                item.remove();
            }
            if (typeof window.deselectItem === 'function') window.deselectItem();
            window.selectedItem = activeNodeItem;
            activeNodeItem.selected = true;
        } else {
            return;
        }
    } else {
        activeNodeItem = item;
    }

    // Desactivar temporalmente clipping de grupos para permitir arrastrar nodos fuera de los límites
    disabledClipGroups = [];
    function disableClipGroup(g) {
        if (disabledClipGroups.includes(g)) return;
        disabledClipGroups.push(g);
        g.clipped = false;
        const mask = g.children.find(c => c.clipMask);
        if (mask) {
            mask.clipMask = false;
            mask.data = mask.data || {};
            mask.data.wasClipMask = true;
            mask.strokeColor = new paper.Color('#38bdf8');
            mask.strokeWidth = 1 / paper.view.zoom;
            mask.dashArray = [4, 4];
        }
    }

    let currParent = target.parent;
    while (currParent && !(currParent instanceof paper.Layer)) {
        if (currParent instanceof paper.Group && currParent.clipped && !currParent.data?.clipGroup) {
            disableClipGroup(currParent);
        }
        currParent = currParent.parent;
    }

    const disableDescendantClips = (node) => {
        if (node instanceof paper.Group && node.clipped && !node.data?.clipGroup) {
            disableClipGroup(node);
        }
        if (node.children) {
            for (let i = 0; i < node.children.length; i++) {
                disableDescendantClips(node.children[i]);
            }
        }
    };
    disableDescendantClips(target);

    window.nodeEditMode = true;
    window.nodeEditTarget = activeNodeItem;
    window.isDraggingNode = false;
    isDraggingHandle = false;
    activeHandleData = null;

    // Clic derecho en el canvas para salir del modo de edición de nodos
    const canvasEl = document.getElementById('editorCanvas');
    const handleNodeContextMenu = (e) => {
        if (window.nodeEditMode) {
            e.preventDefault();
            exitNodeEditMode();
        }
    };
    if (canvasEl) {
        canvasEl.addEventListener('contextmenu', handleNodeContextMenu);
    }
    window._handleNodeContextMenu = handleNodeContextMenu;

    const btnTopNodes = document.getElementById('proBtnEditNodes');
    if (btnTopNodes) btnTopNodes.classList.add('active');

    // Ocultar caja de selección global
    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(null);
    }

    // 1. Si el elemento es un sólido afectado por CSG, mostramos temporalmente su masa base original
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
        activeNodeItem.visible = true;
    } else if (activeNodeItem.data && activeNodeItem.data.isHole) {
        // 2. Si el elemento es un calado activo (isHole), hacerlo visible para que el usuario vea la silueta que edita
        activeNodeItem.visible = true;
        if (!activeNodeItem.strokeColor) {
            activeNodeItem.strokeColor = new paper.Color('#0284c7');
            activeNodeItem.strokeWidth = 1.5 / paper.view.zoom;
            activeNodeItem.dashArray = [4, 4];
        }
    }

    drawNodeHandles();

    // Herramienta interactiva de edición de nodos
    previousTool = paper.tool;
    nodeEditTool = new paper.Tool();

    nodeEditTool.onMouseDown = (event) => {
        // Agregar nodo en trazado
        if (isAddNodeActive) {
            const targetPaths = getTargetPaths(activeNodeItem);
            let nearestLoc = null;
            let minDistance = 8 / paper.view.zoom;

            for (const path of targetPaths) {
                const loc = path.getNearestLocation(event.point);
                if (loc) {
                    const dist = loc.point.getDistance(event.point);
                    if (dist < minDistance) {
                        minDistance = dist;
                        nearestLoc = loc;
                    }
                }
            }

            if (nearestLoc) {
                const path = nearestLoc.path;
                const newSegment = nearestLoc.curve.divideAt(nearestLoc);
                if (newSegment) {
                    syncGeometryToGeomBase(activeNodeItem);
                    if (activeNodeItem.data?.isHole && typeof recalculateDynamicSubtractions === 'function') {
                        recalculateDynamicSubtractions();
                        activeNodeItem.visible = true;
                    }
                    selectedNodes.clear();
                    drawNodeHandles();
                    const globalIdx = findGlobalIdxForSegment(path, newSegment.index);
                    if (globalIdx !== -1) {
                        selectedNodes.add(globalIdx);
                        drawNodeHandles();
                    }
                }
            }

            isAddNodeActive = false;
            const btnAddNode = document.getElementById('btnCtxAddNode');
            if (btnAddNode) {
                btnAddNode.classList.remove('active');
                btnAddNode.style.backgroundColor = '';
            }
            paper.view.element.style.cursor = 'default';
            paper.view.update();
            return;
        }

        // Hit-test sobre tiradores de nodos o tiradores Bézier
        let hit = null;
        if (nodeHandlesGroup) {
            hit = nodeHandlesGroup.hitTest(event.point, {
                fill: true,
                stroke: true,
                tolerance: 6 / paper.view.zoom
            });
        }

        if (hit && hit.item && hit.item.data) {
            if (hit.item.data.isTangentHandle) {
                isDraggingHandle = true;
                activeHandleData = hit.item.data;
                return;
            }

            if (hit.item.data.isNodeHandle) {
                isDraggingNode = true;
                window.isDraggingNode = true;
                dragStartPoint = event.point.clone();

                if (event.modifiers.shift) {
                    if (selectedNodes.has(hit.item.data.globalIdx)) {
                        selectedNodes.delete(hit.item.data.globalIdx);
                    } else {
                        selectedNodes.add(hit.item.data.globalIdx);
                    }
                } else {
                    if (!selectedNodes.has(hit.item.data.globalIdx)) {
                        selectedNodes.clear();
                        selectedNodes.add(hit.item.data.globalIdx);
                    }
                }
                drawNodeHandles();
                paper.view.update();
                return;
            }
        }

        // Clic en vacío: Iniciar recuadro de selección (Marquee)
        if (!event.modifiers.shift) {
            selectedNodes.clear();
        }
        dragStartPoint = event.point.clone();
        drawNodeHandles();
        paper.view.update();
    };

    nodeEditTool.onMouseDrag = (event) => {
        // Arrastre de tirador Bézier (curvatura)
        if (isDraggingHandle && activeHandleData) {
            const targetPath = paper.project.getItem({ id: activeHandleData.pathId });
            if (targetPath && targetPath.segments[activeHandleData.localIdx]) {
                const seg = targetPath.segments[activeHandleData.localIdx];
                const localMouse = targetPath.globalToLocal(event.point);
                const delta = localMouse.subtract(seg.point);

                if (activeHandleData.type === 'handleIn') {
                    seg.handleIn = delta;
                    if (!event.modifiers.alt) {
                        seg.handleOut = delta.negate();
                    }
                } else if (activeHandleData.type === 'handleOut') {
                    seg.handleOut = delta;
                    if (!event.modifiers.alt) {
                        seg.handleIn = delta.negate();
                    }
                }

                syncGeometryToGeomBase(activeNodeItem);
                if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
                    if (typeof recalculateDynamicSubtractions === 'function') {
                        recalculateDynamicSubtractions();
                        activeNodeItem.visible = true;
                    }
                }
                drawNodeHandles();
                paper.view.update();
                return;
            }
        }

        // Arrastre de vértices seleccionados
        if (isDraggingNode && dragStartPoint) {
            const deltaGlobal = event.point.subtract(dragStartPoint);
            dragStartPoint = event.point.clone();

            const targetPaths = getTargetPaths(activeNodeItem);
            let currentGlobalIdx = 0;

            targetPaths.forEach(targetPath => {
                const localDelta = targetPath.globalToLocal(targetPath.localToGlobal(new paper.Point(0, 0)).add(deltaGlobal));

                targetPath.segments.forEach((seg, sIdx) => {
                    const gIdx = currentGlobalIdx + sIdx;
                    if (selectedNodes.has(gIdx)) {
                        seg.point = seg.point.add(localDelta);
                    }
                });
                currentGlobalIdx += targetPath.segments.length;
            });

            syncGeometryToGeomBase(activeNodeItem);
            if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
                if (typeof recalculateDynamicSubtractions === 'function') {
                    recalculateDynamicSubtractions();
                    activeNodeItem.visible = true;
                }
            }
            drawNodeHandles();
            paper.view.update();
            return;
        }

        // Arrastre de Marquee de selección
        if (dragStartPoint) {
            if (marqueeRect) marqueeRect.remove();
            const rect = new paper.Rectangle(dragStartPoint, event.point);
            marqueeRect = new paper.Path.Rectangle(rect);
            marqueeRect.strokeColor = new paper.Color('#0284c7');
            marqueeRect.fillColor = new paper.Color(2, 132, 199, 0.08);
            marqueeRect.strokeWidth = 1 / paper.view.zoom;
            marqueeRect.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];

            if (nodeHandlesGroup) {
                nodeHandlesGroup.children.forEach(handle => {
                    if (handle.data?.isNodeHandle) {
                        if (rect.contains(handle.position)) {
                            selectedNodes.add(handle.data.globalIdx);
                        } else if (!event.modifiers.shift) {
                            selectedNodes.delete(handle.data.globalIdx);
                        }
                    }
                });
            }
            drawNodeHandles();
            paper.view.update();
        }
    };

    nodeEditTool.onMouseUp = (event) => {
        if (isDraggingHandle) {
            isDraggingHandle = false;
            activeHandleData = null;
            if (typeof window.saveHistory === 'function') window.saveHistory();
            syncGeometryToGeomBase(activeNodeItem);
            if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
                if (typeof recalculateDynamicSubtractions === 'function') {
                    recalculateDynamicSubtractions();
                    activeNodeItem.visible = true;
                }
            }
        }

        if (isDraggingNode) {
            isDraggingNode = false;
            window.isDraggingNode = false;
            if (typeof window.saveHistory === 'function') {
                window.saveHistory();
            }
            syncGeometryToGeomBase(activeNodeItem);
            if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
                if (typeof recalculateDynamicSubtractions === 'function') {
                    recalculateDynamicSubtractions();
                    activeNodeItem.visible = true;
                }
            }
        }

        if (marqueeRect) {
            marqueeRect.remove();
            marqueeRect = null;
        }
        dragStartPoint = null;
        drawNodeHandles();
        paper.view.update();
    };

    nodeEditTool.activate();

    // Inyectar botones en la barra de herramientas de edición de nodos
    const parentControls = document.getElementById('ctxNodeEditControls');
    if (parentControls) {
        let btnAddNode = document.getElementById('btnCtxAddNode');
        if (!btnAddNode) {
            btnAddNode = document.createElement('button');
            btnAddNode.className = 'toolbar-btn';
            btnAddNode.id = 'btnCtxAddNode';
            btnAddNode.title = 'Añadir puntos de anclaje haciendo clic en el contorno';
            btnAddNode.style.cssText = 'color: #0284c7; background: #f0f9ff; border-color: #e0f2fe; font-weight: bold; margin-right: 8px;';
            btnAddNode.innerHTML = '<i class="fas fa-plus"></i> Añadir Nodo';
            parentControls.insertBefore(btnAddNode, parentControls.firstChild);
        }
        btnAddNode.onclick = () => {
            isAddNodeActive = !isAddNodeActive;
            if (isAddNodeActive) {
                btnAddNode.classList.add('active');
                btnAddNode.style.backgroundColor = '#bae6fd';
                paper.view.element.style.cursor = 'crosshair';
            } else {
                btnAddNode.classList.remove('active');
                btnAddNode.style.backgroundColor = '#f0f9ff';
                paper.view.element.style.cursor = 'default';
            }
        };

        let btnDetach = document.getElementById('btnCtxDetachSubpath');
        if (!btnDetach) {
            btnDetach = document.createElement('button');
            btnDetach.className = 'toolbar-btn';
            btnDetach.id = 'btnCtxDetachSubpath';
            btnDetach.title = 'Desprender sub-trazados de los nodos seleccionados';
            btnDetach.style.cssText = 'color: #ea580c; background: #fff7ed; border-color: #ffedd5; font-weight: bold; margin-right: 8px;';
            btnDetach.innerHTML = '<i class="fas fa-scissors"></i> Desprender Nodos';
            btnAddNode.parentNode.insertBefore(btnDetach, btnAddNode.nextSibling);
        }
        btnDetach.onclick = () => detachSelectedSubpaths();
    }

    const btnDeleteNode = document.getElementById('btnCtxDeleteNode');
    if (btnDeleteNode) {
        btnDeleteNode.onclick = () => deleteSelectedNodes();
    }

    const btnExitNodeEdit = document.getElementById('btnCtxExitNodeEdit');
    if (btnExitNodeEdit) {
        btnExitNodeEdit.onclick = () => exitNodeEditMode();
    }

    document.addEventListener('keydown', handleNodeKeydown);
    const nodeEl = document.getElementById('ctxNodeEditControls');
    if (nodeEl) nodeEl.classList.remove('hidden');
    paper.view.update();
}

/**
 * Sale del modo de edición de nodos y restaura el estado visual y CSG.
 * @param {boolean} skipSelect
 */
export function exitNodeEditMode(skipSelect = false) {
    if (nodeHandlesGroup) {
        nodeHandlesGroup.remove();
        nodeHandlesGroup = null;
    }
    if (marqueeRect) {
        marqueeRect.remove();
        marqueeRect = null;
    }

    document.removeEventListener('keydown', handleNodeKeydown);

    const itemToRestore = activeNodeItem;
    disabledClipGroups.forEach(g => {
        if (g && g.parent) {
            g.clipped = true;
            if (g.data?.clipGroup) return;
            const mask = g.children.find(c => c.data?.wasClipMask || c.clipMask);
            if (mask) {
                mask.clipMask = true;
                mask.strokeColor = null;
                mask.dashArray = null;
                if (mask.data) delete mask.data.wasClipMask;
            }
        }
    });
    disabledClipGroups = [];

    const canvasEl = document.getElementById('editorCanvas');
    if (canvasEl && window._handleNodeContextMenu) {
        canvasEl.removeEventListener('contextmenu', window._handleNodeContextMenu);
        delete window._handleNodeContextMenu;
    }

    // Si era un calado activo, restablecer su visibilidad para el modo CSG estándar
    if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
        activeNodeItem.visible = false;
    }

    activeNodeItem = null;
    selectedNodes.clear();
    isDraggingNode = false;
    isDraggingHandle = false;
    activeHandleData = null;
    window.nodeEditMode = false;
    window.nodeEditTarget = null;
    isAddNodeActive = false;

    const btnTopNodes = document.getElementById('proBtnEditNodes');
    if (btnTopNodes) btnTopNodes.classList.remove('active');

    const btnAddNode = document.getElementById('btnCtxAddNode');
    if (btnAddNode) {
        btnAddNode.classList.remove('active');
        btnAddNode.style.backgroundColor = '';
    }

    if (paper.view && paper.view.element) {
        paper.view.element.style.cursor = 'default';
    }

    if (previousTool) {
        previousTool.activate();
    }

    // Recalcular CSG para materializar las perforaciones exactas sobre las masas sólidas
    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    if (itemToRestore && !skipSelect && typeof window.selectItem === 'function') {
        window.selectItem(itemToRestore);
    }

    const nodeEl = document.getElementById('ctxNodeEditControls');
    if (nodeEl) nodeEl.classList.add('hidden');
    paper.view.update();
}

/**
 * Convierte un PointText a un CompoundPath vectorial editable.
 */
function convertTextToPath(pointText) {
    if (!pointText) return null;
    const compound = pointText.createPath({ insert: false });
    compound.fillColor = pointText.fillColor;
    compound.strokeColor = pointText.strokeColor;
    compound.strokeWidth = pointText.strokeWidth;
    compound.data = { label: "Texto Convertido", geomBase: compound.clone({ insert: false }) };
    return compound;
}

function findGlobalIdxForSegment(path, localIdx) {
    const paths = getTargetPaths(activeNodeItem);
    let globalPointIdx = 0;
    for (const p of paths) {
        if (p === path) {
            return globalPointIdx + localIdx;
        }
        globalPointIdx += p.segments.length;
    }
    return -1;
}

/**
 * Sincroniza la escala visual de los tiradores ante operaciones de zoom.
 */
export function updateNodeHandlesScale() {
    if (!window.nodeEditMode || !nodeHandlesGroup || !paper.view) return;
    const zoom = paper.view.zoom;

    nodeHandlesGroup.children.forEach(handle => {
        if (handle.data?.isNodeHandle) {
            handle.bounds.width = 7 / zoom;
            handle.bounds.height = 7 / zoom;
            handle.strokeWidth = 1.5 / zoom;
        } else if (handle.data?.isTangentHandle) {
            handle.bounds.width = 5 / zoom;
            handle.bounds.height = 5 / zoom;
            handle.strokeWidth = 1 / zoom;
        } else if (handle.data?.isTangentLine) {
            handle.strokeWidth = 1 / zoom;
        }
    });
}

/**
 * Dibuja los tiradores visuales de cada segmento y sus tiradores Bézier sobre el lienzo.
 */
export function drawNodeHandles() {
    if (nodeHandlesGroup) {
        nodeHandlesGroup.remove();
    }
    nodeHandlesGroup = new paper.Group();
    nodeHandlesGroup.data = { isNodeEditOverlay: true, isNodeHandleContainer: true };

    if (!activeNodeItem) return;
    const paths = getTargetPaths(activeNodeItem);
    const zoom = paper.view.zoom;

    let ptIdx = 0;
    paths.forEach(path => {
        path.segments.forEach((segment, localIdx) => {
            const isSelected = selectedNodes.has(ptIdx);
            const globalPt = path.localToGlobal(segment.point);

            // Si el nodo está seleccionado, dibujar sus tiradores Bézier de curvatura
            if (isSelected) {
                if (segment.handleIn && !segment.handleIn.isZero()) {
                    const globalIn = path.localToGlobal(segment.point.add(segment.handleIn));
                    const lineIn = new paper.Path.Line({
                        from: globalPt,
                        to: globalIn,
                        strokeColor: new paper.Color('#0284c7'),
                        strokeWidth: 1 / zoom,
                        insert: false
                    });
                    lineIn.data = { isTangentLine: true };
                    nodeHandlesGroup.addChild(lineIn);

                    const handleIn = new paper.Path.Circle({
                        center: globalIn,
                        radius: 2.5 / zoom,
                        fillColor: new paper.Color('#ffffff'),
                        strokeColor: new paper.Color('#0284c7'),
                        strokeWidth: 1 / zoom,
                        insert: false
                    });
                    handleIn.data = {
                        isTangentHandle: true,
                        type: 'handleIn',
                        pathId: path.id,
                        localIdx: localIdx
                    };
                    nodeHandlesGroup.addChild(handleIn);
                }

                if (segment.handleOut && !segment.handleOut.isZero()) {
                    const globalOut = path.localToGlobal(segment.point.add(segment.handleOut));
                    const lineOut = new paper.Path.Line({
                        from: globalPt,
                        to: globalOut,
                        strokeColor: new paper.Color('#0284c7'),
                        strokeWidth: 1 / zoom,
                        insert: false
                    });
                    lineOut.data = { isTangentLine: true };
                    nodeHandlesGroup.addChild(lineOut);

                    const handleOut = new paper.Path.Circle({
                        center: globalOut,
                        radius: 2.5 / zoom,
                        fillColor: new paper.Color('#ffffff'),
                        strokeColor: new paper.Color('#0284c7'),
                        strokeWidth: 1 / zoom,
                        insert: false
                    });
                    handleOut.data = {
                        isTangentHandle: true,
                        type: 'handleOut',
                        pathId: path.id,
                        localIdx: localIdx
                    };
                    nodeHandlesGroup.addChild(handleOut);
                }
            }

            // Tirador del vértice
            const handle = new paper.Path.Rectangle({
                center: globalPt,
                size: new paper.Size(7 / zoom, 7 / zoom),
                fillColor: isSelected ? new paper.Color('#0284c7') : new paper.Color('#ffffff'),
                strokeColor: new paper.Color('#0284c7'),
                strokeWidth: 1.5 / zoom,
                insert: false
            });
            handle.data = {
                isNodeHandle: true,
                globalIdx: ptIdx,
                localIdx: localIdx,
                pathId: path.id
            };
            nodeHandlesGroup.addChild(handle);
            ptIdx++;
        });
    });

    nodeHandlesGroup.bringToFront();
}

/**
 * Elimina los nodos seleccionados de la geometría activa.
 */
export function deleteSelectedNodes() {
    if (selectedNodes.size === 0 || !activeNodeItem) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const targetPaths = getTargetPaths(activeNodeItem);
    let currentGlobalIdx = 0;
    let anyRemoved = false;

    targetPaths.forEach(path => {
        for (let i = path.segments.length - 1; i >= 0; i--) {
            const gIdx = currentGlobalIdx + i;
            if (selectedNodes.has(gIdx)) {
                if (path.segments.length > 2) {
                    path.removeSegment(i);
                    anyRemoved = true;
                }
            }
        }
        currentGlobalIdx += path.segments.length;
    });

    if (anyRemoved) {
        selectedNodes.clear();
        syncGeometryToGeomBase(activeNodeItem);
        if (activeNodeItem.data?.isHole && typeof recalculateDynamicSubtractions === 'function') {
            recalculateDynamicSubtractions();
            activeNodeItem.visible = true;
        }
    }
    drawNodeHandles();
    paper.view.update();
}

/**
 * Desprende los sub-trazados que corresponden a los nodos seleccionados.
 */
export function detachSelectedSubpaths() {
    if (!activeNodeItem || selectedNodes.size === 0) return;
    const target = getContentItem(activeNodeItem);
    if (!target || !(target instanceof paper.CompoundPath)) {
        alert("Esta función solo es aplicable para desarmar sub-trazados de objetos combinados o compuestos.");
        return;
    }

    if (typeof window.saveHistory === 'function') window.saveHistory();

    const pathsToExtract = new Set();
    nodeHandlesGroup.children.forEach(handle => {
        if (handle.data?.isNodeHandle && selectedNodes.has(handle.data.globalIdx)) {
            pathsToExtract.add(handle.data.pathId);
        }
    });

    if (pathsToExtract.size === 0) return;

    const parent = activeNodeItem.parent || paper.project.activeLayer;
    const isClipped = !!activeNodeItem.data?.clipGroup;
    const extractedItems = [];

    pathsToExtract.forEach(pathId => {
        const subPath = paper.project.getItem({ id: pathId });
        if (subPath && subPath.parent === target) {
            const clone = subPath.clone({ insert: false });
            clone.fillColor = target.fillColor || '#000000';
            clone.strokeColor = target.strokeColor || '#000000';
            clone.strokeWidth = target.strokeWidth || 1;

            let newItem;
            if (isClipped && typeof window.clipItem === 'function') {
                newItem = window.clipItem(clone);
                newItem.matrix = activeNodeItem.matrix.clone();
            } else {
                newItem = clone;
                newItem.matrix = activeNodeItem.matrix.clone();
                parent.addChild(newItem);
            }
            newItem.data = {
                ...(activeNodeItem.data || {}),
                label: (activeNodeItem.data?.label || "Sub-Trazado") + " Desprendido",
                geomBase: clone.clone({ insert: false })
            };
            extractedItems.push(newItem);
            subPath.remove();
        }
    });

    if (target.children.length === 0) {
        activeNodeItem.remove();
    } else {
        syncGeometryToGeomBase(activeNodeItem);
    }

    exitNodeEditMode();
    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    setTimeout(() => {
        if (extractedItems.length > 0) {
            window.selectedItems = [...extractedItems];
            window.selectedItem = extractedItems[extractedItems.length - 1];
            if (typeof window.updateSelectionBox === 'function') {
                window.updateSelectionBox(window.selectedItem);
            }
            if (typeof window.updateContextualMenu === 'function') {
                window.updateContextualMenu(window.selectedItem);
            }
        }
    }, 100);

    paper.view.update();
}

function handleNodeKeydown(e) {
    if (!window.nodeEditMode) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedNodes();
    }
}

// Exposición global segura
if (typeof window !== 'undefined') {
    window.enterNodeEditMode = enterNodeEditMode;
    window.exitNodeEditMode = exitNodeEditMode;
    window.updateNodeHandlesScale = updateNodeHandlesScale;
    window.drawNodeHandles = drawNodeHandles;
    window.detachSelectedSubpaths = detachSelectedSubpaths;
    window.deleteSelectedNodes = deleteSelectedNodes;
}
