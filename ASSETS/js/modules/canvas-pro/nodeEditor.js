/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (PRO Node Engine v45.0 - Ultimate Curves)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripción:
    Motor de edición interactiva de nodos vectoriales (vértices y tiradores Bézier)
    para EKKO Studio basado en Paper.js.
    
    Asegura la preservación absoluta de las atenciones a atajos de teclado (D, S, L, I, M),
    conversión automática de PointText a curvas, marquesina de selección y desprendimiento de sub-trazados.
    
    Reprogramado de forma canónica conforme al Pacto de Estabilidad del Bloque D para
    garantizar reactividad reactiva CSG en tiempo real ante cualquier movimiento de nodo,
    eliminar fugas de memoria y blindar de forma absoluta la plantilla del producto mockup base.

AUTORIDAD: REPOSITORIO CANÓNICO V9 / PACTO DE ESTABILIDAD
========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";
import { textToCompoundPath } from "./fontToPath.js";
import { interactionOwner } from "./interactionOwner.js";
import { getPublicOwner } from "./designGeometry.js";
import { setSemanticKind, semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { notice } from "./ekkoNotice.js";

// Única resolución de owner público. Los wrappers de contención y máscaras
// no deben convertirse en el objeto de edición de nodos.
function getContentItem(item) {
    return getPublicOwner(item) || item || null;
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
let canvasDblClickHandler = null;
let previousTool = null;
let nodeEditTool = null;
let disabledClipGroups = [];
let activeFusionNodeContext = null;

function findFusionAncestor(item) {
    let current = item;
    while (current) {
        if (current.data?.isSmartFusion) {
            if (current.data.clipGroup && current.children) {
                const nested = Array.from(current.children).find(child =>
                    child?.data?.isSmartFusion && child.children?.length >= 2
                );
                if (nested) return nested;
            }
            return current;
        }
        current = current.parent;
    }
    return null;
}

function getFusionEditableMask(fusion) {
    return fusion?.children?.find(child => child?.clipMask || child?.data?.isFusionMask) || null;
}

if (typeof window !== 'undefined') {
    window.nodeEditMode = false;
    window.nodeEditTarget = null;
    window.isDraggingNode = false;
}

// Detecta si un elemento es parte del mockup del producto base
function isMockupOrProductElement(item) {
    let curr = item;
    while (curr) {
        if (curr.data && (
            curr.data.mockup ||
            curr.data.isMask ||
            curr.data.locked ||
            curr.data.isSelectionBox ||
            curr.data.isSmartGuide ||
            curr.data.isMeasurement
        )) {
            return true;
        }
        const label = (curr.data?.label || '').toLowerCase();
        if (label.includes('chapita') || label.includes('huesito') || label.includes('termo') || label.includes('mate') || label.includes('llavero') || label.includes('producto') || label.includes('plantilla')) {
            return true;
        }
        curr = curr.parent;
    }
    return false;
}

/**
 * Obtiene la lista aplanada de todos los trazados que componen la pieza útil, bloqueando mockups.
 * @param {paper.Item} target
 * @returns {paper.Path[]}
 */
function getTargetPaths(target) {
    const paths = [];
    const findPathsRecursive = (item) => {
        if (!item) return;
        if (isMockupOrProductElement(item)) return; // Blindaje absoluto de plantilla

        const cName = item.className;
        if (cName === 'Path') {
            if (!item.clipMask && !(item.data && (item.data.isMask || item.data.wasClipMask))) {
                paths.push(item);
            }
        } else if (cName === 'CompoundPath') {
            if (item.children && item.children.length > 0) {
                Array.from(item.children).forEach(findPathsRecursive);
            }
        } else if (item.children) {
            Array.from(item.children).forEach(findPathsRecursive);
        }
    };
    findPathsRecursive(target);
    return paths;
}

/**
 * Pone el owner en modo edición usando su geometría fuente, no el resultado
 * visual de una sustracción CSG anterior. Mientras se editan nodos, el owner
 * permanece sin materializar para que cada movimiento pueda actualizar
 * geomBase sin incorporar los bordes del calado a la masa sólida.
 */
function prepareCanonicalNodeGeometry(target) {
    const base = target?.data?.geomBase;
    if (!target || !base?.clone) return false;
    target.data = target.data || {};
    const ownerMatrix = target.matrix?.clone?.() || new paper.Matrix();
    const clone = base.clone({ insert: false });
    let cloneConsumed = false;
    try {
        target.applyMatrix = false;
        if (target instanceof paper.Path && clone instanceof paper.Path) {
            target.removeSegments();
            target.addSegments(clone.segments);
            target.closed = clone.closed;
        } else if (target instanceof paper.CompoundPath) {
            target.removeChildren();
            if (clone instanceof paper.CompoundPath) {
                target.addChildren(clone.removeChildren());
            } else {
                target.addChild(clone);
                cloneConsumed = true;
            }
        } else if (target.children && clone.children) {
            target.removeChildren();
            target.addChildren(clone.removeChildren());
        } else {
            return false;
        }
        target.matrix = ownerMatrix;
        target.visible = true;
        target.data.csgMaterialized = false;
        target.data.nodeEditActive = true;
        return true;
    } catch (_) {
        return false;
    } finally {
        if (!cloneConsumed) {
            try { clone.remove?.(); } catch (e) {}
        }
    }
}

/**
 * Sincroniza la geometría editada con 'geomBase' manteniendo coherencia matemática.
 * @param {paper.Item} item
 */
export function syncGeometryToGeomBase(item) {
    if (!item) return;
    const target = getContentItem(item);
    if (!target) return;

    if (!target.data) target.data = {};

    // A solid may currently contain a materialized CSG result. That visible
    // result is not the source geometry: copying it back into geomBase would
    // permanently bake every active hole into the solid and the solid could
    // never recover when the hole moves, changes Z or is deleted. Real holes
    // themselves are never materialized and remain fully editable here.
    if (target.data.csgMaterialized === true && target.data.nodeEditActive !== true && target.data.isHole !== true) {
        target.data.geomBaseSync = {
            skipped: true,
            reason: 'visible-geometry-is-csg-result',
            at: Date.now()
        };
        return;
    }

    const newGeomBase = target.clone({ insert: false });
    newGeomBase.matrix = new paper.Matrix();

    if (target.data.geomBase) {
        try { target.data.geomBase.remove(); } catch (e) {}
    }
    target.data.geomBase = newGeomBase;
    target.data.csgMaterialized = false;
    target.data.geomBaseSync = { skipped: false, at: Date.now() };

    if (item !== target) {
        if (!item.data) item.data = {};
        if (item.data.geomBase) {
            try { item.data.geomBase.remove(); } catch (e) {}
        }
        item.data.geomBase = newGeomBase.clone({ insert: false });
    }
}

/**
 * Inicia el modo de edición de nodos para el objeto vectorial seleccionado.
 * @param {paper.Item} item
 */
export async function enterNodeEditMode(item) {
    if (!item || isMockupOrProductElement(item)) return;
    const fusion = findFusionAncestor(item);
    const fusionMask = fusion ? getFusionEditableMask(fusion) : null;
    const target = fusionMask || getContentItem(item);
    if (!target) return;

    if (fusion && fusion.data?.fusionMode === 'calar') {
        // El modo calado inverso contiene un rectángulo exterior auxiliar;
        // el vector receptor real se edita desde su snapshot, no el marco.
        return;
    }

    const isText = target.className === 'PointText' || (typeof paper !== 'undefined' && paper.PointText && target instanceof paper.PointText);
    if (isText) {
        if (confirm("Para editar los nodos de este texto, primero debes convertirlo a curvas. ¿Deseas continuar?")) {
            const converted = await convertTextToPath(target);
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

    activeFusionNodeContext = fusion ? {
        fusion,
        selectionItem: item,
        mask: target
    } : null;
    // Normal public vectors are edited from geomBase. A fusion mask keeps its
    // own controller-owned edit transaction and must not be replaced here.
    if (!fusion) prepareCanonicalNodeGeometry(target);
    activeNodeItem = target;
    target.data = {
        ...(target.data || {}),
        nodeEditActive: true
    };
    interactionOwner.claim("node-edit", { owner: "nodeEditor" });
    window.nodeEditMode = true;
    window.nodeEditTarget = target;

    // Desactivar temporalmente máscaras para manipulación libre sin recortes
    function disableClipGroup(g) {
        if (!g || !g.data || !g.data.clipGroup) return;
        if (g.clipped) {
            g.clipped = false;
            const mask = Array.from(g.children).find(c => c.clipMask || (c.data && c.data.isMask));
            if (mask) {
                mask.visible = true;
                mask.strokeColor = '#ff00ff';
                mask.dashArray = [4, 4];
                mask.strokeWidth = 1 / paper.view.zoom;
                mask.clipMask = false;
                mask.data.wasClipMask = true;
            }
            disabledClipGroups.push(g);
        }
    }
    disableClipGroup(item);

    selectedNodes.clear();
    drawNodeHandles();

    previousTool = paper.tool;
    nodeEditTool = new paper.Tool();
    
    nodeEditTool.onMouseDown = (event) => {
        if (isAddNodeActive) {
            /* El modo permanece ACTIVO hasta Esc o botón (como LightBurn):
               antes cualquier clic despegado lo apagaba en silencio y el
               usuario creía que la herramienta no funcionaba. */
            tryInsertNodeAt(event.point);
            paper.view.update();
            return;
        }

        // The standalone curved-text handle is outside nodeHandlesGroup.
        // Se delega al dueno unico (EKKO_TEXT_BEND en textToolbar): este modulo
        // no guarda la referencia del owner porque applyTextCurve lo reemplaza
        // en cada reconstruccion y la referencia quedaba desconectada. Tampoco
        // inventa curvatura inicial: el signo lo decide la direccion del arrastre.
        if (window.EKKO_TEXT_BEND?.hitTest?.(event.point)) {
            window.EKKO_TEXT_BEND.begin(event.point);
            if (typeof window.saveHistory === 'function') window.saveHistory();
            return;
        }

        if (nodeHandlesGroup) {
            const hitResult = nodeHandlesGroup.hitTest(event.point, {
                fill: true,
                stroke: true,
                tolerance: 12 / paper.view.zoom,
                match: (hit) => hit.item.data && (hit.item.data.isNodeHandle || hit.item.data.isCurveHandle)
            });

            if (hitResult) {
                const hitData = hitResult.item.data;
                // Snapshot before any node/handle mutation. Saving on mouseUp
                // alone records the post-edit geometry and makes Undo unable
                // to restore the pre-drag shape.
                if (typeof window.saveHistory === 'function') window.saveHistory();
                dragStartPoint = event.point.clone();
                if (hitData.isCurveHandle) {
                    isDraggingHandle = true;
                    /* Referencia cacheada: durante el arrastre el recálculo
                       CSG puede incongelar/re-materializar el dueno y variar su
                       id. Con esta copia la antena sigue viva hasta el mouseUp. */
                    activeHandleData = { ...hitData, cachedPath: paper.project.getItem({ id: hitData.pathId }) || null };
                } else if (hitData.isNodeHandle) {
                    isDraggingNode = true;
                    window.isDraggingNode = true;
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
                    
                    // Crueldad eliminada: el clic solo SELECCIONA. Suavizar
                    // explícitamente es la tecla S (revela antenitas), nunca
                    // un efecto lateral del clic. Esquinas permanecen esquinas.
                    
                    drawNodeHandles();
                }
                paper.view.update();
                return;
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
        /* Curvatura delegada al dueno unico. El owner se resuelve adentro desde
           la seleccion actual en cada frame: guardar la referencia aqui la
           dejaba desconectada desde el segundo frame. */
        if (window.EKKO_TEXT_BEND?.isBending?.()) {
            window.EKKO_TEXT_BEND.update(event.point);
            return;
        }

        if (isDraggingHandle && activeHandleData) {
            /* Resolución resistente: el CSG puede re-materializar el dueno a
               mitad del arrastre y cambiar su id; la referencia cacheada en el
               mousedown mantiene viva la antena. */
            const targetPath = paper.project.getItem({ id: activeHandleData.pathId })
                || (activeHandleData.cachedPath && activeHandleData.cachedPath.parent
                    ? activeHandleData.cachedPath
                    : null);
            if (targetPath && targetPath.segments && targetPath.segments[activeHandleData.localIdx]) {
                const seg = targetPath.segments[activeHandleData.localIdx];
                const globalPt = targetPath.localToGlobal(seg.point);
                const tangentVector = targetPath.globalToLocal(event.point).subtract(targetPath.globalToLocal(globalPt));
                // Manijas independientes por defecto; solo simétricas con Alt/Option
                const symmetric = event.modifiers.alt || event.modifiers.option;
                if (activeHandleData.handleType === 'in') {
                    seg.handleIn = tangentVector;
                    if (symmetric) seg.handleOut = tangentVector.multiply(-1);
                } else if (activeHandleData.handleType === 'out') {
                    seg.handleOut = tangentVector;
                    if (symmetric) seg.handleIn = tangentVector.multiply(-1);
                }
            }
            /* El costo pesado NO corre por frame: syncGeometryToGeomBase y el
               recálculo CSG de perforados se hacen UNA VEZ en el mouseUp.
               Ponerlos acá re-ejecutaba todas las booleanas en cada movimiento
               del mouse: en objetos con huecos el arrastre se congelaba. */
            drawNodeHandles();
            paper.view.update();
            return;
        }

        if (isDraggingNode && dragStartPoint) {
            moveSelectedNodesByDelta(event.delta);
            drawNodeHandles();
            paper.view.update();
            return;
        }

        if (dragStartPoint) {
            if (marqueeRect) marqueeRect.remove();
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
                            if (!selectedNodes.has(handle.data.globalIdx)) {
                                // La marquesina solo SELECCIONA: nunca muestra
                                // manijas ni suaviza esquinas por su cuenta.
                                // La tecla S sigue siendo el único camino a las antenas.
                                selectedNodes.add(handle.data.globalIdx);
                            }
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
        /* Si se estaba curvando texto, cierra el arrastre por el dueno unico
           (un solo paso de historial) en vez de seguir la ruta de nodos. */
        if (window.EKKO_TEXT_BEND?.isBending?.()) {
            window.EKKO_TEXT_BEND.end();
            return;
        }
        if (isDraggingNode || isDraggingHandle) {
            isDraggingNode = false;
            isDraggingHandle = false;
            activeHandleData = null;
            window.isDraggingNode = false;
            if (typeof window.saveHistory === 'function') window.saveHistory();
            syncGeometryToGeomBase(activeNodeItem);
            /* Pago único del costo pesado al terminar el arrastre: una sola
               sincronización de geomBase y un solo recálculo del perforado con
               la curva final. Es lo que hace que las antenas se sientan fluidas
               como en LightBurn en vez de congelarse. */
            safeRecalculateSubtractions();
            drawNodeHandles();
        }
        if (marqueeRect) {
            marqueeRect.remove();
            marqueeRect = null;
        }
        dragStartPoint = null;
        paper.view.update();
    };

    nodeEditTool.activate();

    // Inyectar botón "Añadir Nodo" en toolbar contextual
    const parentControls = document.getElementById('ctxNodeEditControls');
    if (parentControls) {
        let btnAddNode = document.getElementById('btnCtxAddNode');
        if (!btnAddNode) {
            btnAddNode = document.createElement('button');
            btnAddNode.className = 'toolbar-btn';
            btnAddNode.id = 'btnCtxAddNode';
            btnAddNode.title = 'Añadir puntos: clic en el contorno con este modo activo, o doble clic directo en cualquier momento. Esc para salir';
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

        let btnSmooth = document.getElementById('btnCtxSmooth');
        if (!btnSmooth) {
            btnSmooth = document.createElement('button');
            btnSmooth.className = 'toolbar-btn';
            btnSmooth.id = 'btnCtxSmooth';
            btnSmooth.title = 'Suavizar los nodos seleccionados para convertirlos en curvas (S)';
            btnSmooth.style.cssText = 'color: #16a34a; background: #f0fdf4; border-color: #bbf7d0; font-weight: bold; margin-right: 8px;';
            btnSmooth.innerHTML = '<i class="fas fa-wave-square"></i> Suavizar (S)';
            btnSmooth.onclick = () => {
                makeSelectedNodesSmooth();
            };
            parentControls.insertBefore(btnSmooth, parentControls.firstChild.nextSibling);
        }

        let btnCorner = document.getElementById('btnCtxCorner');
        if (!btnCorner) {
            btnCorner = document.createElement('button');
            btnCorner.className = 'toolbar-btn';
            btnCorner.id = 'btnCtxCorner';
            btnCorner.title = 'Hacer esquina viva en los nodos seleccionados (C)';
            btnCorner.style.cssText = 'color: #dc2626; background: #fef2f2; border-color: #fecaca; font-weight: bold; margin-right: 8px;';
            btnCorner.innerHTML = '<i class="fas fa-angle-right"></i> Esquina (C)';
            btnCorner.onclick = () => {
                makeSelectedNodesCorner();
            };
            parentControls.insertBefore(btnCorner, parentControls.firstChild.nextSibling.nextSibling);
        }
    }

    const canvasEl = document.getElementById('editorCanvas');
    const handleNodeContextMenu = (e) => {
        if (window.nodeEditMode) {
            e.preventDefault();
            exitNodeEditMode();
        }
    };
    /* Doble clic directo sobre el contorno = agregar nodo en ese punto, sin
       activar ningún modo (como Inkscape/Photoshop). Usa el mismo motor
       tryInsertNodeAt que el modo Añadir Nodo, así las dos vías son idénticas. */
    const handleNodeDoubleClick = (e) => {
        if (!window.nodeEditMode || !activeNodeItem) return;
        const rect = canvasEl.getBoundingClientRect();
        if (!paper.view || !paper.view.viewToProject) return;
        const projectPoint = paper.view.viewToProject(new paper.Point(e.clientX - rect.left, e.clientY - rect.top));
        if (isAddNodeActive) return; // el modo Añadir ya maneja sus clics
        if (tryInsertNodeAt(projectPoint)) e.preventDefault();
    };
    if (canvasEl) {
        canvasEl.addEventListener('contextmenu', handleNodeContextMenu);
        canvasEl.addEventListener('dblclick', handleNodeDoubleClick);
    }
    canvasDblClickHandler = handleNodeDoubleClick;
    window._handleNodeContextMenu = handleNodeContextMenu;

    const btnTopNodes = document.getElementById('proBtnEditNodes');
    if (btnTopNodes) btnTopNodes.classList.add('active');

    document.addEventListener('keydown', handleNodeKeydown);
    const nodeEl = document.getElementById('ctxNodeEditControls');
    if (nodeEl) nodeEl.classList.remove('hidden');

    paper.view.update();
    return true;
}

// Helper de disparo seguro de recálculo CSG
function safeRecalculateSubtractions() {
    if (typeof recalculateDynamicSubtractions === 'function') {
        // The second argument is the current virtual-hole collection, not a
        // boolean flag. Passing true silently disabled the intended CSG path.
        const virtualHoles = Array.isArray(window._fusionVirtualHoles)
            ? window._fusionVirtualHoles : [];
        recalculateDynamicSubtractions(null, virtualHoles);
    }
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
    safeRecalculateSubtractions();
}

/**
 * Sale del modo de edición de nodos y restaura el estado visual y CSG.
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
            const mask = Array.from(g.children).find(c => c.data && c.data.wasClipMask);
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
        /* Duplico la limpieza para el doble clic de nodo (la vía 2). */
        if (canvasDblClickHandler) {
            canvasEl.removeEventListener('dblclick', canvasDblClickHandler);
            canvasDblClickHandler = null;
        }
    }

    const finishedItem = activeNodeItem;
    const finishedFusionContext = activeFusionNodeContext;
    if (finishedItem) {
        syncGeometryToGeomBase(finishedItem);
    }

    // En una fusión, los nodos modifican únicamente el vector máscara. La
    // imagen interna no se reconstruye ni pierde su transformación.
    if (finishedFusionContext?.fusion && finishedItem?.project) {
        const fusion = finishedFusionContext.fusion;
        const updatedVector = finishedItem.clone({ insert: false });
        updatedVector.clipMask = false;
        updatedVector.data = {
            ...(fusion.data?.originalVectorData?.data || {}),
            ...(updatedVector.data || {}),
            isFusionMask: false,
            isHole: fusion.data?.originalIsHole === true
        };
        try { fusion.data.originalVectorData?.remove?.(); } catch (e) {}
        fusion.data.originalVectorData = updatedVector;
        try { fusion.data.geomBase?.remove?.(); } catch (_) {}
        const fusionBase = updatedVector.clone({ insert: false });
        fusionBase.applyMatrix = false;
        fusionBase.matrix = new paper.Matrix();
        fusion.data.geomBase = fusionBase;
        if (typeof window.recalculateSmartFusion === 'function') {
            window.recalculateSmartFusion(fusion);
        }
        if (typeof window.EKKO_FUSION_CONTROLLER?.refreshFusion === 'function') {
            window.EKKO_FUSION_CONTROLLER.refreshFusion(fusion);
        }
    }

    if (finishedItem?.data) {
        finishedItem.data.nodeEditActive = false;
        finishedItem.data.csgMaterialized = false;
    }
    activeNodeItem = null;
    activeFusionNodeContext = null;
    window.nodeEditMode = false;
    window.nodeEditTarget = null;
    interactionOwner.release("node-edit");
    isAddNodeActive = false;

    const btnTopNodes = document.getElementById('proBtnEditNodes');
    if (btnTopNodes) btnTopNodes.classList.remove('active');

    const btnAddNode = document.getElementById('btnCtxAddNode');
    if (btnAddNode) {
        btnAddNode.classList.remove('active');
        btnAddNode.style.backgroundColor = '';
    }

    const btnSmooth = document.getElementById('btnCtxSmooth');
    const btnCorner = document.getElementById('btnCtxCorner');

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

    safeRecalculateSubtractions();

    const selectionTarget = finishedFusionContext?.selectionItem || finishedItem;
    if (!skipSelect && selectionTarget && typeof window.selectItem === 'function') {
        setTimeout(() => {
            window.selectItem(selectionTarget);
        }, 20);
    }
    paper.view.update();
    return true;
}

async function convertTextToPath(pointText) {
    if (!pointText) return null;
    const compound = await textToCompoundPath(pointText);
    if (!compound) return null;
    compound.data = {
        ...(pointText.data || {}),
        label: "Texto Convertido",
        isTextVector: true,
        source: "text-vector"
    };
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

/* Un solo motor de inserción, usado por TRES vías con el mismo resultado:
   (a) modo Añadir Nodo activo + clic en el contorno (botón),
   (b) doble clic directo sobre el contorno, dentro del editor de nodos,
   (c) doble clic sobre un vector SIN editor abierto: entra al editor y agrega
       el nodo en ese punto (Inkscape/Photoshop). La delega selection.js
       tras resolver el hit del doble clic. */
export function tryInsertNodeAt(projectPoint) {
    if (!window.nodeEditMode || !activeNodeItem) return false;
    const targetPaths = getTargetPaths(activeNodeItem);
    let nearestLoc = null;
    let minDistance = 15 / paper.view.zoom;
    for (const path of targetPaths) {
        /* getNearestLocation trabaja en el marco LOCAL del path. En vectores
           planos (matriz identidad) el marco local coincide con el global y
           pasaba cualquier coordenada. En letras de texto arco cada glifo
           lleva rotacion/traslacion propia: sin convertir el marco, el punto
           global se leia como local y la distancia daba absurdas: el motor
           salia sin insertar, en silencio (precisamente el bug del usuario).
           Convertimos ida y vuelta: la busqueda en local, la distancia en
           global, donde vive la tolerancia de 15/zoom en pixeles de pantalla. */
        let loc = null;
        try {
            const localPoint = path.globalToLocal ? path.globalToLocal(projectPoint) : projectPoint;
            loc = path.getNearestLocation(localPoint);
            if (loc) {
                const globalHit = path.localToGlobal ? path.localToGlobal(loc.point) : loc.point;
                const dist = projectPoint.getDistance(globalHit);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestLoc = loc;
                }
            }
        } catch (err) { /* path sin marco: sigo con el siguiente */ }
    }
    if (!nearestLoc) return false;
    /* Guardia anti-duplicado: SOLO bloquea el clic que cae encima del dot de
       un nodo existente (radio del dot + margen mínimo = 4/zoom). Antes era
       6/zoom y en vectores densos (texto vectorizado: nodos cada pocos px)
       se comía casi cualquier doble clic válido: parecía que no hacía nada. */
    let cercaNodoExistente = false;
    for (const p of targetPaths) {
        for (const s of p.segments) {
            if (p.localToGlobal(s.point).getDistance(projectPoint) < 4 / paper.view.zoom) {
                cercaNodoExistente = true;
                break;
            }
        }
        if (cercaNodoExistente) break;
    }
    if (cercaNodoExistente) return false;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    const path = nearestLoc.path;
    const index = nearestLoc.index;
    /* nearestLoc.point vive en el marco LOCAL del path: el marco correcto
       para insertar (la geometria interna del path siempre es local). Para
       vectores planos es identico al punto global de antes; para letras de
       arco es periferica la diferencia. */
    path.insert(index + 1, nearestLoc.point);
    // Nodo nuevo = esquina viva (sin smooth automático).
    // El usuario presiona 'S' si quiere suavizar después.
    /* Índice global del nodo nuevo, calculado POR POSICIÓN y no por
       identidad: syncGeometryToGeomBase + el recálculo CSG pueden
       re-materializar los hijos del compuesto y los clones nuevos ya no
       coinciden con la referencia vieja (el verde quedaba blanco en texto
       vectorizado, donde ese recálculo corre siempre). */
    const receiveIdx = targetPaths.indexOf(path);
    let globalIdx = -1;
    if (receiveIdx !== -1) {
        globalIdx = 0;
        for (let i = 0; i < receiveIdx; i++) globalIdx += targetPaths[i].segments.length;
        globalIdx += index + 1;
    }
    syncGeometryToGeomBase(activeNodeItem);
    safeRecalculateSubtractions();
    selectedNodes.clear();
    if (globalIdx !== -1) {
        selectedNodes.add(globalIdx);
    }
    drawNodeHandles();
    paper.view.update();
    return true;
}

export function updateNodeHandlesScale() {
    if (!window.nodeEditMode || !activeNodeItem) return;
    drawNodeHandles();
    if (window.paper && paper.view) paper.view.update();
}

/**
 * Dibuja los tiradores visuales de cada segmento y sus tiradores Bézier sobre el lienzo.
 */
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

    const handleSize = 6 / zoom;
    const hoverSize = 10 / zoom;

    let ptIdx = 0;
    paths.forEach(path => {
        path.segments.forEach((segment, localIdx) => {
            const globalPoint = path.localToGlobal(segment.point);
            const isSegmentSelected = selectedNodes.has(ptIdx);

            // 1. Dibujar manijas Bézier si el segmento está seleccionado
            if (isSegmentSelected) {
                if (segment.handleIn && !segment.handleIn.isZero()) {
                    const globalIn = path.localToGlobal(segment.point.add(segment.handleIn));
                    const lineIn = new paper.Path.Line({
                        from: globalPoint,
                        to: globalIn,
                        strokeColor: '#0284c7',
                        strokeWidth: 1 / zoom
                    });
                    nodeHandlesGroup.addChild(lineIn);

                    const dotIn = new paper.Path.Circle({
                        center: globalIn,
                        radius: 5 / zoom,
                        fillColor: '#ffffff',
                        strokeColor: '#0284c7',
                        strokeWidth: 1.25 / zoom,
                        data: {
                            isCurveHandle: true,
                            handleType: 'in',
                            localIdx: localIdx,
                            pathId: path.id
                        }
                    });
                    nodeHandlesGroup.addChild(dotIn);
                }

                if (segment.handleOut && !segment.handleOut.isZero()) {
                    const globalOut = path.localToGlobal(segment.point.add(segment.handleOut));
                    const lineOut = new paper.Path.Line({
                        from: globalPoint,
                        to: globalOut,
                        strokeColor: '#0284c7',
                        strokeWidth: 1 / zoom
                    });
                    nodeHandlesGroup.addChild(lineOut);

                    const dotOut = new paper.Path.Circle({
                        center: globalOut,
                        radius: 5 / zoom,
                        fillColor: '#ffffff',
                        strokeColor: '#0284c7',
                        strokeWidth: 1.25 / zoom,
                        data: {
                            isCurveHandle: true,
                            handleType: 'out',
                            localIdx: localIdx,
                            pathId: path.id
                        }
                    });
                    nodeHandlesGroup.addChild(dotOut);
                }
            }

            // 2. Dibujar el tirador de vértice (Nodo)
            const nodeDot = new paper.Path.Circle({
                center: globalPoint,
                radius: isSegmentSelected ? 4.5 / zoom : 3.5 / zoom,
                fillColor: isSegmentSelected ? '#00e676' : '#ffffff', // Verde si está seleccionado, blanco si no
                strokeColor: isSegmentSelected ? '#00c853' : '#0284c7',
                strokeWidth: 1.5 / zoom,
                data: {
                    isNodeHandle: true,
                    globalIdx: ptIdx,
                    localIdx: localIdx,
                    pathId: path.id
                }
            });
            nodeHandlesGroup.addChild(nodeDot);
            ptIdx++;
        });
    });

    nodeHandlesGroup.bringToFront();
}

/**
 * Elimina los nodos seleccionados de la geometría activa (LightBurn Style).
 */
export function deleteSelectedNodes() {
    if (!activeNodeItem || selectedNodes.size === 0) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const paths = getTargetPaths(activeNodeItem);
    const pointsToDeleteByPath = new Map();
    let curGlobal = 0;

    paths.forEach(path => {
        const localIndices = [];
        path.segments.forEach((seg, localIdx) => {
            if (selectedNodes.has(curGlobal)) {
                localIndices.push(localIdx);
            }
            curGlobal++;
        });
        if (localIndices.length > 0) {
            pointsToDeleteByPath.set(path, localIndices);
        }
    });

    pointsToDeleteByPath.forEach((indices, path) => {
        // Ordenar en sentido descendente para no desordenar los índices de segmentos al ir borrando
        indices.sort((a, b) => b - a);
        indices.forEach(idx => {
            if (path.segments.length > 2) {
                path.removeSegment(idx);
            } else {
                console.warn("[EKKO NODES] No se puede eliminar el segmento: Un trazado requiere un mínimo de 2 puntos.");
            }
        });
    });

    syncGeometryToGeomBase(activeNodeItem);
    selectedNodes.clear();
    safeRecalculateSubtractions();
    drawNodeHandles();
    paper.view.update();
}

/**
 * Desprende los sub-trazados que corresponden a los nodos seleccionados.
 */
export function detachSelectedSubpaths() {
    if (!activeNodeItem || selectedNodes.size === 0) return;
    const target = getContentItem(activeNodeItem);
    const isCP = target && (target.className === 'CompoundPath' || (typeof paper !== 'undefined' && paper.CompoundPath && target instanceof paper.CompoundPath));
    if (!target || !isCP) {
        notice("Esta acción solo es válida para calados o trazados compuestos (CompoundPath).", { kind: "warn" });
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
        const detachedKind = typeof subPath.data?.originalIsHole === "boolean"
            ? (subPath.data.originalIsHole ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID)
            : (semanticKind(activeNodeItem) || VECTOR_KIND.SOLID);
        setSemanticKind(newItem, detachedKind);
        newItem.data = {
            ...(newItem.data || {}),
            locked: false,
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
    safeRecalculateSubtractions();

    if (extractedItems.length > 0 && typeof window.selectItem === 'function') {
        window.selectItem(extractedItems[0]);
    }
}

export function makeSelectedNodesSmooth() {
    if (selectedNodes.size === 0 || !activeNodeItem) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    const paths = getTargetPaths(activeNodeItem);
    let curGlobal = 0;
    paths.forEach(path => {
        path.segments.forEach(seg => {
            if (selectedNodes.has(curGlobal)) {
                // S = revelar manijas (revelar antenitas), NO igualarlas.
                // - Esquina sin antenas: revela ambas, pequeñas, siguiendo la curva.
                // - Nodo con UNA sola antena (típico en trazos vectorizados):
                //   revela SOLAMENTE la que falta, sin tocar la existente.
                // - Nodo con las dos: no tocarlas (LightBurn: S = revelar, no igualar).
                const faltaIn = seg.handleIn.isZero();
                const faltaOut = seg.handleOut.isZero();
                if (faltaIn || faltaOut) {
                    const prevSeg = seg.previous;
                    const nextSeg = seg.next;
                    if (prevSeg && nextSeg) {
                        const dirIn = seg.point.subtract(prevSeg.point).normalize(10);
                        const dirOut = nextSeg.point.subtract(seg.point).normalize(10);
                        if (faltaIn) seg.handleIn = dirIn.multiply(-1);
                        if (faltaOut) seg.handleOut = dirOut;
                    } else if (prevSeg) {
                        const dir = seg.point.subtract(prevSeg.point).normalize(10);
                        if (faltaIn) seg.handleIn = dir.multiply(-1);
                        if (faltaOut) seg.handleOut = dir;
                    } else if (nextSeg) {
                        const dir = nextSeg.point.subtract(seg.point).normalize(10);
                        if (faltaIn) seg.handleIn = dir.multiply(-1);
                        if (faltaOut) seg.handleOut = dir;
                    }
                }
                // Si ya tiene las dos manijas, NO tocarlas (LightBurn: S = revelar, no igualar)
            }
            curGlobal++;
        });
    });
    syncGeometryToGeomBase(activeNodeItem);
    safeRecalculateSubtractions();
    drawNodeHandles();
    if (window.paper && paper.view) paper.view.update();
}

export function makeSelectedNodesCorner() {
    if (selectedNodes.size === 0 || !activeNodeItem) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    const paths = getTargetPaths(activeNodeItem);
    let curGlobal = 0;
    paths.forEach(path => {
        path.segments.forEach(seg => {
            if (selectedNodes.has(curGlobal)) {
                seg.handleIn = new paper.Point(0, 0);
                seg.handleOut = new paper.Point(0, 0);
            }
            curGlobal++;
        });
    });
    syncGeometryToGeomBase(activeNodeItem);
    safeRecalculateSubtractions();
    drawNodeHandles();
    if (window.paper && paper.view) paper.view.update();
}

function handleNodeKeydown(e) {
    if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        /* Esc primero apaga el modo Añadir Nodo (como LightBurn); sólo un
           segundo Esc sale del editor de nodos. stopPropagation evita que el
           Escape genérico de zoomYShortcuts (en window) también salga. */
        if (isAddNodeActive) {
            isAddNodeActive = false;
            const btnAddNodeEsc = document.getElementById('btnCtxAddNode');
            if (btnAddNodeEsc) {
                btnAddNodeEsc.classList.remove('active');
                btnAddNodeEsc.style.backgroundColor = '';
            }
            if (paper.view && paper.view.element) {
                paper.view.element.style.cursor = 'default';
            }
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        exitNodeEditMode();
        return;
    }
    if (selectedNodes.size === 0 || !activeNodeItem) return;

    const key = e.key.toLowerCase();

    // 1. ELIMINAR NODOS (Delete / Backspace / D)
    if (e.key === 'Delete' || e.key === 'Backspace' || key === 'd') {
        e.preventDefault();
        deleteSelectedNodes();
        return;
    }

    // 2. SUAVE / SMOOTH (Tecla S - LightBurn Style) -> Genera antenas y redondea curvas
    if (key === 's') {
        e.preventDefault();
        makeSelectedNodesSmooth();
        return;
    }

    // 3. ESQUINA / CORNER (Tecla C - LightBurn Style) -> Quita antenas y hace esquinas vivas
    if (key === 'c') {
        e.preventDefault();
        makeSelectedNodesCorner();
        return;
    }

    // 4. LÍNEA / LINE (Tecla L - LightBurn Style) -> Quita antenas y endereza el segmento con sus vecinos
    if (key === 'l') {
        e.preventDefault();
        if (typeof window.saveHistory === 'function') window.saveHistory();
        const paths = getTargetPaths(activeNodeItem);
        let curGlobal = 0;
        paths.forEach(path => {
            path.segments.forEach(seg => {
                if (selectedNodes.has(curGlobal)) {
                    seg.handleIn = new paper.Point(0, 0);
                    seg.handleOut = new paper.Point(0, 0);
                    if (seg.previous) seg.previous.handleOut = new paper.Point(0, 0);
                    if (seg.next) seg.next.handleIn = new paper.Point(0, 0);
                }
                curGlobal++;
            });
        });
        syncGeometryToGeomBase(activeNodeItem);
        safeRecalculateSubtractions();
        drawNodeHandles();
        if (window.paper && paper.view) paper.view.update();
        return;
    }
}

if (typeof window !== 'undefined') {
    window.enterNodeEditMode = enterNodeEditMode;
    window.exitNodeEditMode = exitNodeEditMode;
    window.updateNodeHandlesScale = updateNodeHandlesScale;
    window.drawNodeHandles = drawNodeHandles;
    window.makeSelectedNodesSmooth = makeSelectedNodesSmooth;
    window.makeSelectedNodesCorner = makeSelectedNodesCorner;
    window.detachSelectedSubpaths = detachSelectedSubpaths;
    window.deleteSelectedNodes = deleteSelectedNodes;
    window.moveSelectedNodesByDelta = moveSelectedNodesByDelta;
    window.syncGeometryToGeomBase = syncGeometryToGeomBase;
    window.tryInsertNodeAt = tryInsertNodeAt;
}
