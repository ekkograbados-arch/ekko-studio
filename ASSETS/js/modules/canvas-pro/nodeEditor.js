/* =========================================================================
   Modulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (DOM-Safe WYSIWYG Edition - v18.0 PRO - Auto-Snapping & Subpath Detach)
   Ruta de reemplazo: ASSETS/js/modules/canvas-pro/nodeEditor.js
   Descripcion: Motor interactivo de seleccion y edicion de puntos de anclaje/nodos
   para EKKO Studio. Permite deformar de forma directa las curvas bezier del lienzo.
   Soporta multi-seleccion de puntos por Shift+Clic y caja de arrastre (marquee),
   borrado de nodos, acoplamiento reactivo con calados, y la nueva funcion de
   DESPRENDER NODOS (Separar sub-trazados seleccionados de CompoundPaths).
   ========================================================================= */

function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        // BLINDAJE DE SEGURIDAD: Si es un elemento simple sin hijos, retornarlo directamente
        if (!item.children) return item;
        var content = item.children.find(function(c) {
            return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask));
        });
        if (content) return content;
        var fallback = item.children.find(function(c) {
            return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup));
        });
        if (fallback) return fallback;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

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

let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set(); // Conjunto de indices globales de puntos seleccionados
let isDraggingNode = false;
let dragStartPoint = null;
let marqueeRect = null;
let nodeEditTool = null;
let previousTool = null;
let disabledClipGroups = [];
let isAddNodeActive = false; // Modo adición de nodos en caliente

// Entrar en modo de edicion de nodos para un elemento
export function enterNodeEditMode(item) {
    if (typeof window !== 'undefined') {
        console.log("%c[EKKO NODE EDITOR] Entrando en modo edición de nodos para el objeto:", "color: #8b5cf6; font-weight: bold; background: #f5f3ff; padding: 4px 8px; border-radius: 6px;");
        console.log(" - Elemento objetivo:", item ? { id: item.id, type: item.constructor.name, data: item.data } : "Ninguno");
    }
    if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return;
    const target = getContentItem(item);
    if (!target) return;
    // Si es un PointText nativo, ofrecer convertir a curvas primero
    if (target instanceof paper.PointText) {
        if (confirm("Para poder editar los nodos de este texto, primero debes convertirlo a curvas (ruta vectorial). Deseas continuar?")) {
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
                window.deselectItem();
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

    // ATENCION - GARANTÍA DE GRABADO SEGURO:
    // Desactivamos temporalmente el clipping de grupos padres/hijos EXCEPTO el del clipGroup de producto
    // para permitir deformar y arrastrar los nodos de un SVG por fuera de su caja original/viewBox.
    disabledClipGroups = [];
    function disableClipGroup(g) {
        if (disabledClipGroups.includes(g)) return;
        g.clipped = false;
        disabledClipGroups.push(g);
    }
    let currentClip = target.parent;
    while (currentClip && currentClip !== paper.project.activeLayer) {
        // NUNCA desactivamos el clipGroup del producto para garantizar el grabado seguro
        if (currentClip instanceof paper.Group && currentClip.clipped && !currentClip.data?.clipGroup) {
            disableClipGroup(currentClip);
        }
        currentClip = currentClip.parent;
    }
    // Recorrer hacia abajo (descendientes)
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

    // AutoCAD-style Right-Click to Exit Node Edit Mode
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
    window._handleNodeContextMenu = handleNodeContextMenu; // Guardar referencia para desvincular

    const btnTopNodes = document.getElementById('proBtnEditNodes');
    if (btnTopNodes) btnTopNodes.classList.add('active');
    window.nodeEditTarget = activeNodeItem;
    window.isDraggingNode = false;

    // Ocultar caja de seleccion celeste global
    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(null);
    }

    // Dibujar tiradores de nodos en pantalla
    drawNodeHandles();

    // CREAR Y ACTIVAR EL TOOL DEDICADO DE EDICION DE NODOS (Estilo LightBurn)
    previousTool = paper.tool;
    nodeEditTool = new paper.Tool();
    nodeEditTool.onMouseDown = (event) => {
        // 0. Interceptar si el modo "Añadir Nodo" está activo
        if (isAddNodeActive) {
            const targetPaths = getTargetPaths(activeNodeItem);
            let nearestLoc = null;
            let minDistance = 8 / paper.view.zoom; // tolerancia en view pixels
            
            // Buscar contorno más cercano para dividirlo
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
                    // Sincronizar con el originalPath calado si aplica
                    if (activeNodeItem.data?.isOuterWithHoles && activeNodeItem.data?.originalPath) {
                        const origPath = activeNodeItem.data.originalPath;
                        if (origPath instanceof paper.CompoundPath) {
                            const parentIdx = path.parent.children.indexOf(path);
                            const subPath = origPath.children[parentIdx];
                            if (subPath) {
                                const origLoc = subPath.getNearestLocation(nearestLoc.point);
                                if (origLoc) {
                                    origLoc.curve.divideAt(origLoc);
                                }
                            }
                        } else {
                            const origLoc = origPath.getNearestLocation(nearestLoc.point);
                            if (origLoc) {
                                origLoc.curve.divideAt(origLoc);
                            }
                        }
                    }
                    selectedNodes.clear();
                    drawNodeHandles();
                    const globalIdx = findGlobalIdxForSegment(path, newSegment.index);
                    if (globalIdx !== -1) {
                        selectedNodes.add(globalIdx);
                        drawNodeHandles();
                    }
                    if (activeNodeItem.data?.isOuterWithHoles) {
                        if (typeof window.updateOuterPathGeometry === 'function') {
                            window.updateOuterPathGeometry(activeNodeItem);
                        }
                    }
                    // UX: Desactivar modo Añadir inmediatamente para poder arrastrar el nodo de una vez
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

        // 1. Hit test para ver si hicimos clic sobre un tirador/nodo de interfaz existente
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
                // Multi-seleccion con Shift
                if (selectedNodes.has(ptIdx)) {
                    selectedNodes.delete(ptIdx);
                } else {
                    selectedNodes.add(ptIdx);
                }
            } else {
                // Seleccion simple
                if (!selectedNodes.has(ptIdx)) {
                    selectedNodes.clear();
                    selectedNodes.add(ptIdx);
                }
            }
            drawNodeHandles();
            paper.view.update();
            return;
        }

        dragStartPoint = event.point.clone();
        if (!event.modifiers.shift) {
            selectedNodes.clear();
        }
        drawNodeHandles();
        paper.view.update();
    };

    nodeEditTool.onMouseDrag = (event) => {
        // A. Arrastre de nodos seleccionados
        if (isDraggingNode) {
            const delta = event.delta;
            if (typeof window !== 'undefined' && Math.random() < 0.15) { // Muestrear para no saturar la consola
                console.log("%c[EKKO NODE EDITOR] Arrastrando nodos...", "color: #6366f1; font-weight: bold;");
                console.log(" - Desplazamiento delta:", { x: delta.x, y: delta.y });
                console.log(" - Nodos siendo modificados:", Array.from(selectedNodes));
            }
            selectedNodes.forEach(selIdx => {
                const matchingHandle = nodeHandlesGroup.children.find(c => c.data?.globalIdx === selIdx);
                if (matchingHandle) {
                    const targetPath = paper.project.getItem({ id: matchingHandle.data.pathId });
                    if (targetPath && targetPath.segments[matchingHandle.data.localIdx]) {
                        const seg = targetPath.segments[matchingHandle.data.localIdx];
                        // Mover el punto del segmento de forma local
                        seg.point = seg.point.add(delta);
                        matchingHandle.position = targetPath.localToGlobal(seg.point); // Sincronizar mango visual

                        // Sincronizar con el originalPath calado si aplica
                        if (activeNodeItem.data?.isOuterWithHoles && activeNodeItem.data?.originalPath) {
                            const origPath = activeNodeItem.data.originalPath;
                            if (origPath instanceof paper.CompoundPath) {
                                const parentIdx = targetPath.parent.children.indexOf(targetPath);
                                const subPath = origPath.children[parentIdx];
                                if (subPath && subPath.segments[matchingHandle.data.localIdx]) {
                                    subPath.segments[matchingHandle.data.localIdx].point = seg.point.clone();
                                }
                            } else if (origPath.segments[matchingHandle.data.localIdx]) {
                                origPath.segments[matchingHandle.data.localIdx].point = seg.point.clone();
                            }
                        }
                    }
                }
            });

            // CORRECCIÓN HISTÓRICA CLAVE: Actualización de geomBase para sólidos y calados
            if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.geomBase) {
                const localClone = activeNodeItem.clone({ insert: false });
                localClone.matrix = new paper.Matrix(); // Resetea transformaciones para coordenadas puras
                activeNodeItem.data.geomBase = localClone;
            }

            // Recalcular la geometria calada reactiva en vivo
            if (activeNodeItem.data?.isOuterWithHoles) {
                if (typeof window.updateOuterPathGeometry === 'function') {
                    window.updateOuterPathGeometry(activeNodeItem);
                }
            } else if (activeNodeItem.data?.isHoleController && activeNodeItem.data?.outerItemId) {
                const outerItem = paper.project.getItem({ id: activeNodeItem.data.outerItemId });
                if (outerItem && typeof window.updateOuterPathGeometry === 'function') {
                    window.updateOuterPathGeometry(outerItem);
                }
            } else if (typeof window.recalculateDynamicSubtractions === 'function') {
                window.recalculateDynamicSubtractions();
            }

            paper.view.update();
            return;
        }

        // B. Arrastre de caja de seleccion (Marquee Selection Box)
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
                        // Verificar si el nodo esta dentro de la caja dibujada
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
        if (isDraggingNode) {
            isDraggingNode = false;
            window.isDraggingNode = false;
            if (typeof window.saveHistory === 'function') {
                window.saveHistory();
            }
            // --- VINCULACIÓN INTERACTIVA CON HOLE CONTROLLER TRAS DEFORMAR/MOVER NODOS ---
            if (activeNodeItem && activeNodeItem.data?.isHoleController) {
                if (typeof window.handleInteractiveDrop === 'function') {
                    window.handleInteractiveDrop({ point: activeNodeItem.bounds.center });
                }
            }
        }
        if (marqueeRect) {
            marqueeRect.remove();
            marqueeRect = null;
        }
        dragStartPoint = null;
        paper.view.update();
    };

    nodeEditTool.activate();

    // Inyectar y configurar el botón "Añadir Nodo" y "Desprender Selección" dinámicamente si no existen
    const parentControls = document.getElementById('ctxNodeEditControls');
    if (parentControls) {
        let btnAddNode = document.getElementById('btnCtxAddNode');
        if (!btnAddNode) {
            btnAddNode = document.createElement('button');
            btnAddNode.className = 'toolbar-btn';
            btnAddNode.id = 'btnCtxAddNode';
            btnAddNode.title = 'Añadir Nodo sobre el contorno';
            btnAddNode.style.cssText = 'color: #0284c7; background: #f0f9ff; border-color: #bae6fd; font-weight: bold; margin-right: 8px;';
            btnAddNode.innerHTML = '<i class="fas fa-plus-circle"></i> Añadir Nodo';
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
            btnDetach.title = 'Desprender la parte de los nodos seleccionados como un objeto independiente (Desagrupar Nodos)';
            btnDetach.style.cssText = 'color: #ea580c; background: #fff7ed; border-color: #ffedd5; font-weight: bold; margin-right: 8px;';
            btnDetach.innerHTML = '<i class="fas fa-scissors"></i> Desprender Nodos';
            btnAddNode.parentNode.insertBefore(btnDetach, btnAddNode.nextSibling);
        }
        btnDetach.onclick = () => detachSelectedSubpaths();
    }

    // Registrar botones de menu flotante
    const btnDeleteNode = document.getElementById('btnCtxDeleteNode');
    if (btnDeleteNode) {
        btnDeleteNode.onclick = () => deleteSelectedNodes();
    }
    const btnExitNodeEdit = document.getElementById('btnCtxExitNodeEdit');
    if (btnExitNodeEdit) {
        btnExitNodeEdit.onclick = () => exitNodeEditMode();
    }

    // Vincular teclado
    document.addEventListener('keydown', handleNodeKeydown);

    const nodeEl = document.getElementById('ctxNodeEditControls');
    if (nodeEl) nodeEl.classList.remove('hidden');

    paper.view.update();
}

// Salir del modo de edicion de nodos
export function exitNodeEditMode(skipSelect = false) {
    if (typeof window !== 'undefined') {
        console.log(`%c[EKKO NODE EDITOR] Saliendo del modo edición de nodos (skipSelect = ${skipSelect}) 🚪`, "color: #8b5cf6; font-weight: bold; background: #f5f3ff; padding: 4px 8px; border-radius: 6px;");
    }
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

    // Al salir, reactivamos todos los recortes guardados
    disabledClipGroups.forEach(g => {
        if (g && g.parent) {
            g.clipped = true;
            if (g.data?.clipGroup) return; // Saltarse del producto para no alterar
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

    activeNodeItem = null;
    selectedNodes.clear();
    isDraggingNode = false;
    window.nodeEditMode = false;

    const btnTopNodes = document.getElementById('proBtnEditNodes');
    if (btnTopNodes) btnTopNodes.classList.remove('active');
    window.nodeEditTarget = null;

    // Limpiar estado de añadir nodo
    isAddNodeActive = false;
    const btnAddNode = document.getElementById('btnCtxAddNode');
    if (btnAddNode) {
        btnAddNode.classList.remove('active');
        btnAddNode.style.backgroundColor = '';
    }

    if (paper.view && paper.view.element) {
        paper.view.element.style.cursor = 'default';
    }

    // Restaurar la herramienta de seleccion global previa
    if (previousTool) {
        previousTool.activate();
    }

    if (itemToRestore && !skipSelect) {
        window.selectItem(itemToRestore);
    }

    const nodeEl = document.getElementById('ctxNodeEditControls');
    if (nodeEl) nodeEl.classList.add('hidden');

    paper.view.update();
}

// Convertir un PointText a un CompoundPath vectorial
function convertTextToPath(pointText) {
    if (!pointText) return null;
    const compound = pointText.createPath({ insert: false });
    compound.fillColor = pointText.fillColor;
    compound.strokeColor = pointText.strokeColor;
    compound.strokeWidth = pointText.strokeWidth;
    compound.data = { label: "Texto Convertido" };
    return compound;
}

// Obtener los trazados vectoriales reales sobre los cuales operar
function getTargetPaths(item) {
    const target = getContentItem(item);
    if (!target) return [];
    const paths = [];
    const findPathsRecursive = (el) => {
        if (el instanceof paper.Path) {
            paths.push(el);
        } else if (el instanceof paper.CompoundPath) {
            el.children.forEach(c => findPathsRecursive(c));
        } else if (el instanceof paper.Group) {
            el.children.forEach(c => findPathsRecursive(c));
        }
    };
    findPathsRecursive(target);
    return paths;
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

// Sincronizar dinamicamente la escala visual de los tiradores ante operaciones de zoom
export function updateNodeHandlesScale() {
    if (!nodeHandlesGroup || !window.paper) return;
    const zoom = paper.view.zoom;
    const handleSize = 5 / zoom;
    nodeHandlesGroup.children.forEach(handle => {
        if (handle.data?.isNodeHandle) {
            if (handle instanceof paper.Path.Circle) {
                handle.radius = handleSize;
            } else {
                handle.bounds.size = new paper.Size(handleSize * 2, handleSize * 2);
            }
            handle.strokeWidth = 1.5 / zoom;
        }
    });
}
window.updateNodeHandlesScale = updateNodeHandlesScale;

// Dibujar fisicamente los circulos de la interfaz de nodos
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
    let globalPointIdx = 0;

    paths.forEach(path => {
        path.segments.forEach((segment, localIdx) => {
            const ptIdx = globalPointIdx++;
            const isSelected = selectedNodes.has(ptIdx);
            // Dibujar en coordenadas globales absolutas utilizando localToGlobal para compensar transformaciones
            const globalPoint = path.localToGlobal(segment.point);
            const handle = new paper.Path.Circle({
                center: globalPoint,
                radius: handleSize,
                strokeColor: isSelected ? '#28a745' : '#dc3545', // Verde si esta seleccionado, rojo si no
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

// Eliminar nodos seleccionados
export function deleteSelectedNodes() {
    if (selectedNodes.size === 0 || !activeNodeItem) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    const paths = getTargetPaths(activeNodeItem);
    const pointsToDeleteByPath = new Map();

    // Agrupar los indices de nodos a borrar por ruta fisica
    nodeHandlesGroup.children.forEach(handle => {
        if (handle.data?.isNodeHandle && selectedNodes.has(handle.data.globalIdx)) {
            if (!pointsToDeleteByPath.has(handle.data.pathId)) {
                pointsToDeleteByPath.set(handle.data.pathId, []);
            }
            pointsToDeleteByPath.get(handle.data.pathId).push(handle.data.localIdx);
        }
    });

    // Eliminar los segmentos de reversa (de mayor a menor indice) para evitar alteracion de punteros
    pointsToDeleteByPath.forEach((localIndices, pathId) => {
        const path = paper.project.getItem({ id: pathId });
        if (path) {
            localIndices.sort((a, b) => b - a);
            localIndices.forEach(idx => {
                if (path.segments[idx]) {
                    path.removeSegment(idx);
                    // Sincronizar con el originalPath calado si aplica
                    if (activeNodeItem.data?.isOuterWithHoles && activeNodeItem.data?.originalPath) {
                        const origPath = activeNodeItem.data.originalPath;
                        if (origPath instanceof paper.CompoundPath) {
                            const parentIdx = path.parent.children.indexOf(path);
                            const subPath = origPath.children[parentIdx];
                            if (subPath && subPath.segments[idx]) {
                                subPath.removeSegment(idx);
                            }
                        } else if (origPath.segments[idx]) {
                            origPath.removeSegment(idx);
                        }
                    }
                }
            });
            if (path.segments.length === 0) {
                path.remove();
            }
        }
    });

    selectedNodes.clear();

    // Actualización de geomBase para sólidos y calados
    if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.geomBase) {
        const localClone = activeNodeItem.clone({ insert: false });
        localClone.matrix = new paper.Matrix(); // Resetea transformaciones para coordenadas puras
        activeNodeItem.data.geomBase = localClone;
    }

    if (activeNodeItem.data?.isOuterWithHoles) {
        if (typeof window.updateOuterPathGeometry === 'function') {
            window.updateOuterPathGeometry(activeNodeItem);
        }
    } else if (activeNodeItem.data?.isHoleController && activeNodeItem.data?.outerItemId) {
        const outerItem = paper.project.getItem({ id: activeNodeItem.data.outerItemId });
        if (outerItem && typeof window.updateOuterPathGeometry === 'function') {
            window.updateOuterPathGeometry(outerItem);
        }
    } else if (typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions();
    }

    drawNodeHandles();
    paper.view.update();
}

// NUEVA FUNCIÓN: Desprender trazados correspondientes a los nodos seleccionados (Desagrupar Nodos)
export function detachSelectedSubpaths() {
    if (typeof window !== 'undefined') {
        console.log("%c[EKKO NODE EDITOR] Desprendiendo trazados seleccionados (Desagrupar Nodos desde editor)...", "color: #ea580c; font-weight: bold; background: #fff7ed; padding: 4px 8px; border-radius: 6px;");
        console.log(" - Índices de nodos seleccionados (globalIdx):", Array.from(selectedNodes));
    }
    if (!activeNodeItem || selectedNodes.size === 0) return;
    const target = getContentItem(activeNodeItem);
    if (!target || !(target instanceof paper.CompoundPath)) {
        alert("Esta funcion solo es aplicable para desarmar sub-trazados de objetos combinados o compuestos.");
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
    const index = parent.children.indexOf(activeNodeItem);
    const isClipped = !!activeNodeItem.data?.clipGroup;
    const pathRelMatrix = getMatrixRelativeTo(target, isClipped ? activeNodeItem : null);
    const pathAbsMatrix = getGlobalMatrix(target);
    const extractedItems = [];

    pathsToExtract.forEach(pathId => {
        const subPath = paper.project.getItem({ id: pathId });
        if (subPath && subPath.parent === target) {
            // Clonar el trazado seleccionado como un elemento independiente
            const clone = subPath.clone({ insert: false });
            clone.fillColor = target.fillColor || '#000000';
            clone.strokeColor = target.strokeColor || '#000000';
            clone.strokeWidth = target.strokeWidth || 1;
            let newItem;
            if (isClipped) {
                newItem = window.clipItem(clone);
                newItem.matrix = activeNodeItem.matrix.clone();
                clone.matrix = pathRelMatrix.clone().chain(clone.matrix);
            } else {
                newItem = clone;
                newItem.matrix = pathAbsMatrix.clone().chain(clone.matrix);
                parent.addChild(newItem);
            }
            newItem.data = {
                ...(newItem.data || {}),
                label: "Trazado Desprendido"
            };
            // Si el CompoundPath original tenia un calado reactivo activo (Outer with Holes)
            if (activeNodeItem.data?.isOuterWithHoles) {
                newItem.data.isHoleController = true;
                newItem.data.outerItemId = activeNodeItem.id;
                newItem.data.label = "Hueco";
                activeNodeItem.data.holeIds = activeNodeItem.data.holeIds || [];
                activeNodeItem.data.holeIds.push(newItem.id);
            }
            extractedItems.push(newItem);
            subPath.remove(); // Eliminar de la lista de hijos del CompoundPath original
        }
    });

    // Si el CompoundPath original se quedo sin hijos, eliminarlo completamente
    if (target.children.length === 0) {
        activeNodeItem.remove();
    } else {
        // Si era un OuterWithHoles, recalcular su geometria dinamica
        if (activeNodeItem.data?.isOuterWithHoles) {
            if (typeof window.updateOuterPathGeometry === 'function') {
                window.updateOuterPathGeometry(activeNodeItem);
            }
        }
    }

    // Salir de modo de edicion de nodos y enfocar los nuevos elementos desprendidos
    exitNodeEditMode();
    window.deselectItem();
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

// Manejar teclado
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

// Exposicion global segura
if (typeof window !== 'undefined') {
    window.enterNodeEditMode = enterNodeEditMode;
    window.exitNodeEditMode = exitNodeEditMode;
    window.updateNodeHandlesScale = updateNodeHandlesScale;
    window.drawNodeHandles = drawNodeHandles;
    window.detachSelectedSubpaths = detachSelectedSubpaths;
}
