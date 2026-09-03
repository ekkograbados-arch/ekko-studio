/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (PRO Node Engine v43.0 - Unified CallGraph & Double-Scope GeomBase Precision)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripción:
    Motor de edición interactiva de nodos vectoriales (vértices y tiradores Bézier)
    para EKKO Studio basado en Paper.js.

    SOPORTA RECALCULO REACTIVO EN TIEMPO REAL CSG Y PROTECCIÓN DE ANCESTROS DEL MOCKUP.

AUTORIDAD: REPOSITORIO CANÓNICO V8 / CO-DISEÑO DE PRECISIÓN
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
        const childrenArr = Array.from(item.children);
        const content = childrenArr.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
        if (content) return content;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

// Detecta de forma infalible si un elemento pertenece de forma implícita o explícita al mockup del producto
function isMockupOrProductElement(item) {
    let curr = item;
    while (curr) {
        if (curr.data && (
            curr.data.mockup ||
            curr.data.isMask ||
            curr.data.locked ||
            curr.data.isSelectionBox ||
            curr.data.isHandle ||
            curr.data.isSmartGuide ||
            curr.data.isMeasurement ||
            curr.data.isTracePreview
        )) {
            return true;
        }
        // Comprobación heurística de etiquetas para chapitas, huesitos, termo, mate, llaveros
        const label = (curr.data?.label || '').toLowerCase();
        if (label.includes('chapita') || label.includes('huesito') || label.includes('termo') || label.includes('mate') || label.includes('llavero') || label.includes('producto') || label.includes('plantilla')) {
            return true;
        }
        curr = curr.parent;
    }
    return false;
}

// Variables de Estado de la Herramienta de Edición de Nodos
let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set();
let isDraggingNode = false;
let isDraggingHandle = false;
let activeHandleData = null;
let dragStartPoint = null;
let marqueeRect = null;
let isAddNodeActive = false;
let previousTool = null;
let nodeEditTool = null;
let disabledClipGroups = [];

// Exposición en ventana para centinelas globales
if (typeof window !== 'undefined') {
    window.nodeEditMode = false;
    window.nodeEditTarget = null;
    window.isDraggingNode = false;
}

/**
 * Obtiene la lista aplanada de todos los trazados (paper.Path) que componen la pieza.
 * @param {paper.Item} target
 * @returns {paper.Path[]}
 */
function getTargetPaths(target) {
    const paths = [];
    const findPathsRecursive = (item) => {
        if (!item || isMockupOrProductElement(item)) return;
        const cName = item.className;
        if (cName === 'Path') {
            // Ignorar la máscara de recorte del producto para no editar sus nodos por error
            if (!item.clipMask && !(item.data && (item.data.isMask || item.data.wasClipMask))) {
                paths.push(item);
            }
        } else if (cName === 'CompoundPath') {
            if (item.children && item.children.length > 0) {
                for (let i = 0; i < item.children.length; i++) {
                    findPathsRecursive(item.children[i]);
                }
            } else {
                paths.push(item);
            }
        } else if (cName === 'Group' || item.children) {
            if (item.children && item.children.length > 0) {
                for (let i = 0; i < item.children.length; i++) {
                    findPathsRecursive(item.children[i]);
                }
            }
        }
    };
    findPathsRecursive(target);
    return paths;
}

/**
 * SINCRONIZACIÓN IMPECABLE DE GEOMETRÍA BASE (ANTI-CORRUPCIÓN CSG)
 * @param {paper.Item} item
 */
export function syncGeometryToGeomBase(item) {
    if (!item) return;
    const target = getContentItem(item);
    if (!target) return;

    if (!target.data) target.data = {};

    const newGeomBase = target.clone({ insert: false });
    newGeomBase.matrix = new paper.Matrix();

    if (target.data.geomBase) {
        try {
            target.data.geomBase.remove();
        } catch (e) {}
    }

    target.data.geomBase = newGeomBase;

    if (item !== target) {
        if (!item.data) item.data = {};
        if (item.data.geomBase) {
            try {
                item.data.geomBase.remove();
            } catch (e) {}
        }
        item.data.geomBase = newGeomBase.clone({ insert: false });
    }
}

/**
 * Inicia el modo de edición de nodos para el objeto vectorial seleccionado.
 * @param {paper.Item} item
 */
export function enterNodeEditMode(item) {
    if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask || isMockupOrProductElement(item)) return;
    const target = getContentItem(item);
    if (!target || isMockupOrProductElement(target)) return;

    // Conversión automática de texto a curvas
    const isText = target.className === 'PointText' || (typeof paper !== 'undefined' && paper.PointText && target.className === 'PointText');
    if (isText) {
        if (confirm("Para editar los nodos de este texto, primero debes convertirlo a curvas. ¿Deseas continuar?")) {
            const converted = convertTextToPath(target);
            if (converted) {
                const parent = target.parent || paper.project.activeLayer;
                const idx = parent.children.indexOf(target);
                parent.insertChild(idx, converted);
                target.remove();
                item = converted;
            } else {
                return;
            }
        } else {
            return;
        }
    }

    if (window.nodeEditMode) {
        exitNodeEditMode(true);
    }

    activeNodeItem = item;
    window.nodeEditMode = true;
    window.nodeEditTarget = item;

    function disableClipGroup(g) {
        if (!g || !g.data || !g.data.clipGroup) return;
        if (g.clipped) {
            g.clipped = false;
            const mask = g.children.find(c => c.clipMask || (c.data && c.data.isMask));
            if (mask) {
                mask.visible = true;
                mask.strokeColor = '#007bff';
                mask.dashArray = [4, 4];
                mask.data.wasClipMask = true;
            }
            disabledClipGroups.push(g);
        }
    }
    if (item.data && item.data.clipGroup) {
        disableClipGroup(item);
    }

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(null);
    }

    selectedNodes.clear();
    drawNodeHandles();

    previousTool = paper.tool;
    nodeEditTool = new paper.Tool();

    nodeEditTool.onMouseDown = (event) => {
        if (isAddNodeActive) {
            const targetPaths = getTargetPaths(activeNodeItem);
            let nearestLoc = null;
            let minDistance = 10 / paper.view.zoom;

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
                    
                    if (typeof recalculateDynamicSubtractions === 'function') {
                        recalculateDynamicSubtractions();
                    }

                    selectedNodes.clear();
                    drawNodeHandles();
                    const globalIdx = findGlobalIdxForSegment(path, newSegment.index);
                    if (globalIdx !== -1) {
                        selectedNodes.add(globalIdx);
                        drawNodeHandles();
                    }
                    isAddNodeActive = false;
                    const btnAddNode = document.getElementById('btnCtxAddNode');
                    if (btnAddNode) {
                        btnAddNode.classList.remove('active');
                        btnAddNode.style.backgroundColor = '';
                    }
                    if (paper.view && paper.view.element) {
                        paper.view.element.style.cursor = 'default';
                    }
                }
            }
            return;
        }

        if (nodeHandlesGroup) {
            const hitResult = nodeHandlesGroup.hitTest(event.point, {
                fill: true,
                stroke: true,
                tolerance: 10 / paper.view.zoom,
                match: (hit) => hit.item.data && (hit.item.data.isNodeHandle || hit.item.data.isCurveHandle)
            });

            if (hitResult) {
                const hitData = hitResult.item.data;

                if (hitData.isCurveHandle) {
                    isDraggingHandle = true;
                    activeHandleData = {
                        pathId: hitData.pathId,
                        localIdx: hitData.localIdx,
                        handleType: hitData.handleType
                    };
                    dragStartPoint = event.point.clone();
                    return;
                }

                if (hitData.isNodeHandle) {
                    isDraggingNode = true;
                    window.isDraggingNode = true;
                    dragStartPoint = event.point.clone();

                    if (event.modifiers.shift) {
                        if (selectedNodes.has(hitData.globalIdx)) {
                            selectedNodes.delete(hitData.globalIdx);
                        } else {
                            selectedNodes.add(hitData.globalIdx);
                        }
                    } else {
                        if (!selectedNodes.has(hitData.globalIdx)) {
                            selectedNodes.clear();
                            selectedNodes.add(hitData.globalIdx);
                        }
                    }
                    drawNodeHandles();
                    paper.view.update();
                    return;
                }
            }
        }

        dragStartPoint = event.point.clone();
        if (!event.modifiers.shift) {
            selectedNodes.clear();
        }
        drawNodeHandles();
        paper.view.update();
    };

    nodeEditTool.onMouseDrag = (event) => {
        if (isDraggingHandle && activeHandleData) {
            const targetPath = paper.project.getItem({ id: activeHandleData.pathId });
            if (targetPath && targetPath.segments && targetPath.segments[activeHandleData.localIdx]) {
                const seg = targetPath.segments[activeHandleData.localIdx];
                const localMousePoint = targetPath.globalToLocal(event.point);
                const tangentVector = localMousePoint.subtract(seg.point);

                if (activeHandleData.handleType === 'in') {
                    seg.handleIn = tangentVector;
                    if (!event.modifiers.alt && !event.modifiers.option) {
                        seg.handleOut = tangentVector.multiply(-1);
                    }
                } else if (activeHandleData.handleType === 'out') {
                    seg.handleOut = tangentVector;
                    if (!event.modifiers.alt && !event.modifiers.option) {
                        seg.handleIn = tangentVector.multiply(-1);
                    }
                }
            }
            syncGeometryToGeomBase(activeNodeItem);
            
            if (typeof recalculateDynamicSubtractions === 'function') {
                recalculateDynamicSubtractions();
            }

            drawNodeHandles();
            paper.view.update();
            return;
        }

        if (isDraggingNode && selectedNodes.size > 0 && activeNodeItem) {
            moveSelectedNodesByDelta(event.delta);
            drawNodeHandles();
            paper.view.update();
            return;
        }

        if (dragStartPoint) {
            if (marqueeRect) {
                marqueeRect.remove();
            }
            const rect = new paper.Rectangle(dragStartPoint, event.point);
            marqueeRect = new paper.Path.Rectangle({
                rectangle: rect,
                strokeColor: '#009dec',
                dashArray: [4 / paper.view.zoom, 4 / paper.view.zoom],
                strokeWidth: 1.5 / paper.view.zoom,
                fillColor: new paper.Color(0, 157, 236, 0.15)
            });

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
        if (isDraggingNode || isDraggingHandle) {
            isDraggingNode = false;
            isDraggingHandle = false;
            activeHandleData = null;
            window.isDraggingNode = false;

            if (typeof window.saveHistory === 'function') {
                window.saveHistory();
            }

            syncGeometryToGeomBase(activeNodeItem);
            
            if (typeof recalculateDynamicSubtractions === 'function') {
                recalculateDynamicSubtractions();
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

    const parentControls = document.getElementById('ctxNodeEditControls');
    if (parentControls) {
        let btnAddNode = document.getElementById('btnCtxAddNode');
        if (!btnAddNode) {
            btnAddNode = document.createElement('button');
            btnAddNode.className = 'toolbar-btn';
            btnAddNode.id = 'btnCtxAddNode';
            btnAddNode.title = 'Añadir puntos de anclaje haciendo clic en el contorno';
            btnAddNode.style.cssText = 'color: #0284c7; background: #f0f9ff; border-color: #e0f2fe; font-weight: bold; margin-right: 8px;';
            btnAddNode.innerHTML = '<i class="fas fa-plus-circle"></i> Añadir Nodo';
            btnAddNode.onclick = () => {
                isAddNodeActive = !isAddNodeActive;
                if (isAddNodeActive) {
                    btnAddNode.classList.add('active');
                    btnAddNode.style.backgroundColor = '#bae6fd';
                    if (paper.view && paper.view.element) {
                        paper.view.element.style.cursor = 'crosshair';
                    }
                } else {
                    btnAddNode.classList.remove('active');
                    btnAddNode.style.backgroundColor = '';
                    if (paper.view && paper.view.element) {
                        paper.view.element.style.cursor = 'default';
                    }
                }
            };
            parentControls.insertBefore(btnAddNode, parentControls.firstChild);
        }

        let btnDetach = document.getElementById('btnCtxDetachSubpath');
        if (!btnDetach) {
            btnDetach = document.createElement('button');
            btnDetach.className = 'toolbar-btn';
            btnDetach.id = 'btnCtxDetachSubpath';
            btnDetach.title = 'Separar el trazado secundario de los nodos seleccionados';
            btnDetach.style.cssText = 'color: #7c3aed; background: #f5f3ff; border-color: #ddd6fe; font-weight: bold; margin-right: 8px;';
            btnDetach.innerHTML = '<i class="fas fa-project-diagram"></i> Desprender Trazo';
            btnDetach.onclick = () => {
                detachSelectedSubpaths();
            };
            parentControls.insertBefore(btnDetach, parentControls.firstChild.nextSibling);
        }
    }

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

    document.addEventListener('keydown', handleNodeKeydown);
    const nodeEl = document.getElementById('ctxNodeEditControls');
    if (nodeEl) nodeEl.classList.remove('hidden');

    paper.view.update();
}

/**
 * Función atómica instrumentada para desplazar nodos seleccionados en bloque.
 * @param {paper.Point} delta
 */
export function moveSelectedNodesByDelta(delta) {
    if (!activeNodeItem || !delta || selectedNodes.size === 0) return;
    const targetPaths = getTargetPaths(activeNodeItem);
    let curGlobal = 0;

    targetPaths.forEach(path => {
        const p0 = path.globalToLocal(new paper.Point(0, 0));
        const p1 = path.globalToLocal(delta);
        const localDelta = p1.subtract(p0);

        path.segments.forEach((seg) => {
            if (selectedNodes.has(curGlobal)) {
                seg.point = seg.point.add(localDelta);
            }
            curGlobal++;
        });
    });

    syncGeometryToGeomBase(activeNodeItem);
    
    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }
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

    disabledClipGroups.forEach(g => {
        if (g) {
            g.clipped = true;
            const mask = g.children.find(c => c.data && c.data.wasClipMask);
            if (mask) {
                mask.visible = false;
                mask.strokeColor = null;
                mask.dashArray = [];
                delete mask.data.wasClipMask;
            }
        }
    });
    disabledClipGroups = [];

    const canvasEl = document.getElementById('editorCanvas');
    if (canvasEl) {
        const handleNodeContextMenu = window._handleNodeContextMenu;
        if (handleNodeContextMenu) {
            canvasEl.removeEventListener('contextmenu', handleNodeContextMenu);
            delete window._handleNodeContextMenu;
        }
    }

    const finishedItem = activeNodeItem;
    if (finishedItem) {
        syncGeometryToGeomBase(finishedItem);
    }

    activeNodeItem = null;
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

    const nodeEl = document.getElementById('ctxNodeEditControls');
    if (nodeEl) nodeEl.classList.add('hidden');
    document.removeEventListener('keydown', handleNodeKeydown);

    if (previousTool && previousTool !== nodeEditTool) {
        previousTool.activate();
    } else if (typeof window.initSelectionTool === 'function') {
        window.initSelectionTool();
    }

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions(null, true);
    }

    if (!skipSelect && finishedItem && typeof window.selectItem === 'function') {
        setTimeout(() => {
            window.selectItem(finishedItem);
        }, 20);
    }
    paper.view.update();
}

function convertTextToPath(pointText) {
    if (!pointText) return null;
    const compound = pointText.createPath({ insert: false });
    compound.fillColor = pointText.fillColor;
    compound.strokeColor = pointText.strokeColor;
    compound.strokeWidth = pointText.strokeWidth;
    compound.data = { label: "Texto Convertido" };
    syncGeometryToGeomBase(compound);
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

export function updateNodeHandlesScale() {
    if (!window.nodeEditMode || !activeNodeItem) return;
    drawNodeHandles();
    if (window.paper && paper.view) paper.view.update();
}

export function drawNodeHandles() {
    if (nodeHandlesGroup) {
        nodeHandlesGroup.remove();
    }
    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    nodeHandlesGroup = new paper.Group();
    nodeHandlesGroup.data = { isNodeEditOverlay: true, isNodeHandleContainer: true };
    designLayer.addChild(nodeHandlesGroup);

    if (!activeNodeItem || !paper.view) return;
    const paths = getTargetPaths(activeNodeItem);
    const zoom = paper.view.zoom || 1.0;

    const handleRadius = 5 / zoom;
    const handleDotRadius = 3.5 / zoom;

    let ptIdx = 0;
    paths.forEach(path => {
        path.segments.forEach((segment, localIdx) => {
            const isSelected = selectedNodes.has(ptIdx);
            const globalPoint = path.localToGlobal(segment.point);

            if (isSelected) {
                if (segment.handleIn && !segment.handleIn.isZero()) {
                    const globalIn = path.localToGlobal(segment.point.add(segment.handleIn));
                    const lineIn = new paper.Path.Line({
                        from: globalPoint,
                        to: globalIn,
                        strokeColor: '#0284c7',
                        strokeWidth: 1.2 / zoom,
                        insert: false
                    });
                    lineIn.data = { isTangentLine: true };
                    nodeHandlesGroup.addChild(lineIn);

                    const dotIn = new paper.Path.Circle({
                        center: globalIn,
                        radius: handleDotRadius,
                        strokeColor: '#0284c7',
                        fillColor: '#ffffff',
                        strokeWidth: 1.2 / zoom,
                        insert: false
                    });
                    dotIn.data = {
                        isCurveHandle: true,
                        handleType: 'in',
                        globalIdx: ptIdx,
                        localIdx: localIdx,
                        pathId: path.id
                    };
                    nodeHandlesGroup.addChild(dotIn);
                }

                if (segment.handleOut && !segment.handleOut.isZero()) {
                    const globalOut = path.localToGlobal(segment.point.add(segment.handleOut));
                    const lineOut = new paper.Path.Line({
                        from: globalPoint,
                        to: globalOut,
                        strokeColor: '#0284c7',
                        strokeWidth: 1.2 / zoom,
                        insert: false
                    });
                    lineOut.data = { isTangentLine: true };
                    nodeHandlesGroup.addChild(lineOut);

                    const dotOut = new paper.Path.Circle({
                        center: globalOut,
                        radius: handleDotRadius,
                        strokeColor: '#0284c7',
                        fillColor: '#ffffff',
                        strokeWidth: 1.2 / zoom,
                        insert: false
                    });
                    dotOut.data = {
                        isCurveHandle: true,
                        handleType: 'out',
                        globalIdx: ptIdx,
                        localIdx: localIdx,
                        pathId: path.id
                    };
                    nodeHandlesGroup.addChild(dotOut);
                }
            }

            const handle = new paper.Path.Circle({
                center: globalPoint,
                radius: handleRadius,
                strokeColor: isSelected ? '#16a34a' : '#dc2626',
                fillColor: isSelected ? '#22c55e' : '#ffffff',
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

export function deleteSelectedNodes() {
    if (!activeNodeItem || selectedNodes.size === 0) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const paths = getTargetPaths(activeNodeItem);
    const pointsToDeleteByPath = new Map();
    let curGlobal = 0;

    paths.forEach(path => {
        if (!pointsToDeleteByPath.has(path.id)) {
            pointsToDeleteByPath.set(path.id, []);
        }
        path.segments.forEach((seg, localIdx) => {
            if (selectedNodes.has(curGlobal)) {
                pointsToDeleteByPath.get(path.id).push(localIdx);
            }
            curGlobal++;
        });
    });

    pointsToDeleteByPath.forEach((localIndices, pathId) => {
        const path = paper.project.getItem({ id: pathId });
        if (path) {
            localIndices.sort((a, b) => b - a);
            localIndices.forEach(idx => {
                if (path.segments && path.segments[idx]) {
                    path.removeSegment(idx);
                }
            });
            if (path.segments && path.segments.length < 2) {
                path.remove();
            }
        }
    });

    selectedNodes.clear();
    syncGeometryToGeomBase(activeNodeItem);

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    drawNodeHandles();
    paper.view.update();
}

export function detachSelectedSubpaths() {
    if (!activeNodeItem || selectedNodes.size === 0) return;
    const target = getContentItem(activeNodeItem);
    const isCP = target && (target.className === 'CompoundPath' || (typeof paper !== 'undefined' && paper.CompoundPath && target.className === 'CompoundPath'));
    if (!target || !isCP) {
        alert("Esta operación requiere que el objeto sea un trazado compuesto (CompoundPath).");
        return;
    }

    const paths = getTargetPaths(activeNodeItem);
    const subPathsToDetach = [];
    let curGlobal = 0;

    paths.forEach(path => {
        let hasSelectedNodeInPath = false;
        path.segments.forEach(() => {
            if (selectedNodes.has(curGlobal)) {
                hasSelectedNodeInPath = true;
            }
            curGlobal++;
        });
        if (hasSelectedNodeInPath) {
            subPathsToDetach.push(path);
        }
    });

    if (subPathsToDetach.length === 0) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const parent = activeNodeItem.parent || paper.project.activeLayer;
    const extractedItems = [];

    subPathsToDetach.forEach(subPath => {
        const clone = subPath.clone({ insert: false });
        let newItem;

        if (activeNodeItem.data?.clipGroup && typeof window.clipItem === 'function') {
            newItem = window.clipItem(clone);
            parent.addChild(newItem);
        } else {
            newItem = clone;
            parent.addChild(newItem);
        }

        syncGeometryToGeomBase(newItem);
        newItem.data = {
            ...(newItem.data || {}),
            locked: false,
            isHole: false,
            label: "Trazado Desprendido"
        };
        extractedItems.push(newItem);
        subPath.remove();
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
    if (extractedItems.length > 0 && typeof window.selectItem === 'function') {
        window.selectItem(extractedItems[0]);
    }
}

function handleNodeKeydown(e) {
    if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        exitNodeEditMode();
        return;
    }
    if (selectedNodes.size === 0 || !activeNodeItem) return;
    if (e.key === 'Delete' || e.key === 'Backspace' || e.key.toLowerCase() === 'd') {
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
    window.moveSelectedNodesByDelta = moveSelectedNodesByDelta;
    window.syncGeometryToGeomBase = syncGeometryToGeomBase;
}
