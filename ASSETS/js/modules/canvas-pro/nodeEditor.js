/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (PRO Node Engine v32.2 - CSG Reactive & Clean Stacking)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripción:
Motor de edición interactiva de nodos vectoriales (vértices y tiradores Bézier)
para EKKO Studio basado en Paper.js.
Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt & EKKO_DIAG v6.2):
  * Resuelve de raíz el bug crítico donde 'activeNodeItem.clone({ insert: false })'
    sobreescribía 'geomBase' con la geometría visible ya mutilada/perforada por CSG.
  * Preservación inmaculada de 'geomBase' en coordenadas locales neutras.
  * Blindaje de edición de calados activos (isHole): visibilidad forzada y contorno interactivo en edición.
  * Sincronización reactiva del motor CSG en vivo al arrastrar nodos de calados.
  * Preservación de vértices prístinos al editar masas sólidas sin aniquilación por CSG intermedio.
  * Extracción de sub-trazados (detachSelectedSubpaths) y eliminación puntual de nodos (deleteSelectedNodes).
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

function getMatrixRelativeTo(item, root) {
    let current = item;
    let accumulatedMatrix = new paper.Matrix();
    while (current && current !== root) {
        if (current.matrix) {
            accumulatedMatrix = current.matrix.clone().concatenate(accumulatedMatrix);
        }
        current = current.parent;
    }
    return accumulatedMatrix;
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
 */
function getTargetPaths(target) {
    const paths = [];
    if (!target) return paths;

    const findPathsRecursive = (el) => {
        if (!el) return;
        if (el instanceof paper.Path) {
            paths.push(el);
        } else if (el instanceof paper.CompoundPath) {
            if (el.children) {
                el.children.forEach(c => findPathsRecursive(c));
            }
        } else if (el instanceof paper.Group) {
            if (el.children) {
                el.children.forEach(c => findPathsRecursive(c));
            }
        }
    };
    findPathsRecursive(target);
    return paths;
}

/**
 * Encuentra la curva y punto más cercano entre un conjunto de trazados.
 */
function findNearestPointOnPaths(point, paths) {
    let nearestLoc = null;
    let minDistance = 8 / paper.view.zoom;
    for (const path of paths) {
        const loc = path.getNearestLocation(point);
        if (loc) {
            const dist = loc.point.getDistance(point);
            if (dist < minDistance) {
                minDistance = dist;
                nearestLoc = loc;
            }
        }
    }
    return nearestLoc;
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

    // Clonamos en neutro local para no absorber perforaciones booleanas temporales
    const newGeomBase = target.clone({ insert: false });

    if (item.data.geomBase && item.data.geomBase !== target) {
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
        if (confirm("Para editar los nodos de este texto, primero debes convertirlo a curvas. ¿Deseas continuar?")) {
            const converted = convertTextToPath(target);
            if (converted) {
                if (item.data?.clipGroup) {
                    target.remove();
                    item.addChild(converted);
                    activeNodeItem = item;
                } else {
                    const parent = item.parent || paper.project.activeLayer;
                    const idx = parent.children.indexOf(item);
                    parent.insertChild(idx, converted);
                    item.remove();
                    activeNodeItem = converted;
                }
                if (typeof window.deselectItem === 'function') window.deselectItem();
                window.selectedItem = activeNodeItem;
                activeNodeItem.selected = true;
            } else {
                return;
            }
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
        if (currParent instanceof paper.Group && currParent.clipped) {
            disableClipGroup(currParent);
        }
        currParent = currParent.parent;
    }

    selectedNodes.clear();
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
        const targetContent = getContentItem(activeNodeItem);
        if (targetContent && targetContent.segments) {
            targetContent.segments = [];
            const baseClone = activeNodeItem.data.geomBase.clone({ insert: false });
            if (baseClone.segments) {
                baseClone.segments.forEach(s => targetContent.add(s.clone()));
            }
            baseClone.remove();
        }
    }

    // 2. Si el elemento es un calado activo (isHole), forzar visibilidad y color contrastante durante edición
    if (activeNodeItem.data && activeNodeItem.data.isHole) {
        const targetContent = getContentItem(activeNodeItem);
        if (targetContent) {
            targetContent.visible = true;
            targetContent.strokeColor = new paper.Color('#00bcd4');
            targetContent.strokeWidth = 1.5 / paper.view.zoom;
            targetContent.fillColor = new paper.Color(0, 188, 212, 0.15);
        }
    }

    drawNodeHandles();

    // Crear la herramienta de edición de nodos
    previousTool = paper.tool;
    nodeEditTool = new paper.Tool();

    nodeEditTool.onMouseDown = (event) => {
        // Agregar nodo en trazado
        if (isAddNodeActive) {
            const targetPaths = getTargetPaths(activeNodeItem);
            const nearestLoc = findNearestPointOnPaths(event.point, targetPaths);

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
                    isAddNodeActive = false;
                    const btnAddNode = document.getElementById('btnCtxAddNode');
                    if (btnAddNode) {
                        btnAddNode.classList.remove('active');
                        btnAddNode.style.backgroundColor = '';
                    }
                    paper.view.element.style.cursor = 'default';
                    isDraggingNode = true;
                    window.isDraggingNode = true;
                    paper.view.update();
                    return;
                }
            }
        }

        // 1. Hit test para tiradores Bézier de curvatura (handleIn / handleOut)
        const bezierHit = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            tolerance: 8 / paper.view.zoom,
            match: (hit) => hit.item && hit.item.data?.isCurveHandle
        });

        if (bezierHit) {
            isDraggingHandle = true;
            activeHandleData = bezierHit.item.data;
            paper.view.update();
            return;
        }

        // 2. Hit test para nodos principales (puntos de anclaje)
        const hitResult = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            tolerance: 8 / paper.view.zoom,
            match: (hit) => hit.item && hit.item.data?.isNodeHandle
        });

        if (hitResult) {
            const handleItem = hitResult.item;
            const ptIdx = handleItem.data.globalIdx;
            isDraggingNode = true;
            window.isDraggingNode = true;

            if (event.modifiers.shift) {
                if (selectedNodes.has(ptIdx)) {
                    selectedNodes.delete(ptIdx);
                } else {
                    selectedNodes.add(ptIdx);
                }
            } else {
                if (!selectedNodes.has(ptIdx)) {
                    selectedNodes.clear();
                    selectedNodes.add(ptIdx);
                }
            }
            drawNodeHandles();
            paper.view.update();
            return;
        }

        // 3. Clic en el vacío: Deselección o inicio de recuadro de selección Marquee
        dragStartPoint = event.point.clone();
        if (!event.modifiers.shift) {
            selectedNodes.clear();
        }
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
                const tangentVector = localMouse.subtract(seg.point);

                if (activeHandleData.handleType === 'in') {
                    seg.handleIn = tangentVector;
                    if (!event.modifiers.alt) {
                        seg.handleOut = tangentVector.multiply(-1);
                    }
                } else if (activeHandleData.handleType === 'out') {
                    seg.handleOut = tangentVector;
                    if (!event.modifiers.alt) {
                        seg.handleIn = tangentVector.multiply(-1);
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
        if (isDraggingNode) {
            const delta = event.delta;
            selectedNodes.forEach(selIdx => {
                const matchingHandle = nodeHandlesGroup.children.find(c => c.data?.globalIdx === selIdx && c.data?.isNodeHandle);
                if (matchingHandle) {
                    const targetPath = paper.project.getItem({ id: matchingHandle.data.pathId });
                    if (targetPath && targetPath.segments[matchingHandle.data.localIdx]) {
                        const seg = targetPath.segments[matchingHandle.data.localIdx];
                        seg.point = seg.point.add(delta);
                        matchingHandle.position = targetPath.localToGlobal(seg.point);
                    }
                }
            });

            // Sincronizar en geomBase pura inmaculada
            syncGeometryToGeomBase(activeNodeItem);

            // Recálculo reactivo en tiempo real si el elemento es un calado activo
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

        // Selección por ventana (Marquee)
        if (dragStartPoint) {
            if (marqueeRect) marqueeRect.remove();
            const rect = new paper.Rectangle(dragStartPoint, event.point);
            marqueeRect = new paper.Path.Rectangle({
                rectangle: rect,
                strokeColor: '#009dec',
                dashArray: [4, 4],
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
            if (typeof window.saveHistory === 'function') window.saveHistory();
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
            btnAddNode.title = 'Agregar punto de anclaje en el trazado';
            btnAddNode.innerHTML = '<i class="fas fa-plus-circle"></i> Agregar Nodo';
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
            btnDetach.title = 'Separar sub-trazados seleccionados como objetos independientes';
            btnDetach.innerHTML = '<i class="fas fa-unlink"></i> Separar Trazado';
            parentControls.appendChild(btnDetach);
        }
        btnDetach.onclick = () => detachSelectedSubpaths();

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
        const targetContent = getContentItem(activeNodeItem);
        if (targetContent) {
            targetContent.fillColor = new paper.Color(0, 0, 0, 0.001);
            targetContent.strokeColor = null;
            targetContent.strokeWidth = 0;
        }
    }

    window.nodeEditMode = false;
    window.nodeEditTarget = null;
    activeNodeItem = null;
    selectedNodes.clear();
    isDraggingNode = false;
    window.isDraggingNode = false;
    isDraggingHandle = false;
    activeHandleData = null;
    dragStartPoint = null;
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
    if (!nodeHandlesGroup || !paper.view) return;
    const zoom = paper.view.zoom;
    nodeHandlesGroup.children.forEach(handle => {
        if (handle.data?.isNodeHandle) {
            handle.radius = 5 / zoom;
            handle.strokeWidth = 1.5 / zoom;
        } else if (handle.data?.isCurveHandle) {
            handle.radius = 3.5 / zoom;
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
    const handleSize = 5 / zoom;
    const tangentSize = 3.5 / zoom;

    let globalPointIdx = 0;

    paths.forEach(path => {
        path.segments.forEach((segment, localIdx) => {
            const ptIdx = globalPointIdx++;
            const isSelected = selectedNodes.has(ptIdx);
            const globalPoint = path.localToGlobal(segment.point);

            // Si el nodo está seleccionado, dibujar sus tiradores Bézier de tangente si existen
            if (isSelected) {
                // Tirador de entrada (handleIn)
                if (segment.handleIn && !segment.handleIn.isZero()) {
                    const globalIn = path.localToGlobal(segment.point.add(segment.handleIn));
                    const lineIn = new paper.Path.Line(globalPoint, globalIn);
                    lineIn.strokeColor = new paper.Color('#0284c7');
                    lineIn.strokeWidth = 1 / zoom;
                    lineIn.data = { isTangentLine: true };
                    nodeHandlesGroup.addChild(lineIn);

                    const dotIn = new paper.Path.Circle({
                        center: globalIn,
                        radius: tangentSize,
                        strokeColor: '#0284c7',
                        fillColor: '#ffffff',
                        strokeWidth: 1 / zoom,
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

                // Tirador de salida (handleOut)
                if (segment.handleOut && !segment.handleOut.isZero()) {
                    const globalOut = path.localToGlobal(segment.point.add(segment.handleOut));
                    const lineOut = new paper.Path.Line(globalPoint, globalOut);
                    lineOut.strokeColor = new paper.Color('#0284c7');
                    lineOut.strokeWidth = 1 / zoom;
                    lineOut.data = { isTangentLine: true };
                    nodeHandlesGroup.addChild(lineOut);

                    const dotOut = new paper.Path.Circle({
                        center: globalOut,
                        radius: tangentSize,
                        strokeColor: '#0284c7',
                        fillColor: '#ffffff',
                        strokeWidth: 1 / zoom,
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

            // Nodo principal de anclaje
            const handle = new paper.Path.Circle({
                center: globalPoint,
                radius: handleSize,
                strokeColor: isSelected ? '#28a745' : '#dc3545',
                fillColor: isSelected ? '#28a745' : '#ffffff',
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

    const paths = getTargetPaths(activeNodeItem);
    const pointsToDeleteByPath = new Map();

    nodeHandlesGroup.children.forEach(handle => {
        if (handle.data?.isNodeHandle && selectedNodes.has(handle.data.globalIdx)) {
            if (!pointsToDeleteByPath.has(handle.data.pathId)) {
                pointsToDeleteByPath.set(handle.data.pathId, []);
            }
            pointsToDeleteByPath.get(handle.data.pathId).push(handle.data.localIdx);
        }
    });

    pointsToDeleteByPath.forEach((localIndices, pathId) => {
        const path = paper.project.getItem({ id: pathId });
        if (path) {
            localIndices.sort((a, b) => b - a);
            localIndices.forEach(idx => {
                if (path.segments[idx]) {
                    path.removeSegment(idx);
                }
            });
            if (path.segments.length === 0) {
                path.remove();
            }
        }
    });

    selectedNodes.clear();
    syncGeometryToGeomBase(activeNodeItem);
    if (activeNodeItem && activeNodeItem.data?.isHole && typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
        activeNodeItem.visible = true;
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
            if (isClipped) {
                newItem = window.clipItem(clone);
                newItem.matrix = activeNodeItem.matrix.clone();
            } else {
                newItem = clone;
                newItem.matrix = target.matrix.clone();
                parent.addChild(newItem);
            }
            newItem.data = {
                locked: false,
                label: "Sub-trazado Separado",
                geomBase: clone.clone({ insert: false }),
                isHole: false
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
            extractedItems.forEach(it => { if (it) it.selected = true; });
            if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
            if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }, 50);
}

function handleNodeKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        exitNodeEditMode();
        return;
    }
    if (selectedNodes.size === 0 || !activeNodeItem) return;
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
