/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (PRO Architecture v30)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/contextualMenu.js
   
   Descripción:
   Controlador de la barra contextual y acciones estructurales (Agrupar /
   Desagrupar en 1 Clic / Edición de Nodos) para EKKO Studio.
   
   Cumple rigurosamente con:
   - CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
   - REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
   - DIAGNÓSTICO DE ARQUITECTURA Y DEPENDENCIAS DE EKKO STUDIO V0
   - RESULTADO ESPERADO (Desagrupación atómica en 1 clic, selección limpia,
     agrupación simétrica y preservación de calados dinámicos)
   ========================================================================= */

import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";
import { decomposeByContainmentHierarchy, recalculateDynamicSubtractions } from "./geometricUngroup.js";

/**
 * Obtiene el elemento gráfico real dentro de un grupo de recorte (clipGroup)
 * o devuelve el ítem directo si no está recortado.
 * @param {paper.Item} item
 * @returns {paper.Item|null}
 */
function getContentItem(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
    if (!item.children) return item;
    return item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) || item.children[0] || item;
  }
  return item;
}

/**
 * Determina si el elemento es un CompoundPath
 * @param {paper.Item} item
 * @returns {boolean}
 */
function isCompoundPath(item) {
  return item && (item.className === 'CompoundPath' || (typeof paper !== 'undefined' && paper.CompoundPath && item instanceof paper.CompoundPath));
}

/**
 * Determina si el elemento es un Group
 * @param {paper.Item} item
 * @returns {boolean}
 */
function isGroup(item) {
  return item && (item.className === 'Group' || (typeof paper !== 'undefined' && paper.Group && item instanceof paper.Group));
}

/**
 * AGRUPAR SELECCIÓN:
 * Agrupa los elementos seleccionados preservando su semántica de capas,
 * orden de apilamiento Z, calados activos (isHole) y geometría base (geomBase).
 * Utiliza la jerarquía semántica 'compoundGroup' para garantizar simetría
 * reversible en el ciclo Agrupar <-> Desagrupar.
 */
export function groupSelectedItems() {
  const selected = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (selected.length < 2) {
    if (typeof window.showToast === 'function') {
      window.showToast("Selecciona al menos 2 elementos para agrupar.");
    } else {
      alert("Selecciona al menos 2 elementos para poder agruparlos.");
    }
    return;
  }

  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }

  const parent = selected[0].parent || (paper.project ? paper.project.activeLayer : null);
  if (!parent) return;

  const newGroup = new paper.Group();
  newGroup.data = {
    locked: false,
    label: "Grupo de Capas",
    geometricHierarchy: "compoundGroup"
  };

  // Mantener el orden Z relativo de los elementos al agrupar
  selected.sort((a, b) => (a.index || 0) - (b.index || 0));

  selected.forEach(item => {
    if (item.data && item.data.locked) return;
    newGroup.addChild(item);
  });

  parent.addChild(newGroup);

  // Actualizar selección al nuevo grupo
  if (typeof window.selectItem === 'function') {
    window.selectItem(newGroup);
  } else {
    window.selectedItems = [newGroup];
    window.selectedItem = newGroup;
    newGroup.selected = true;
  }

  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }

  if (typeof updateContextualMenu === 'function') {
    updateContextualMenu(newGroup);
  }

  paper.view.update();
}

/**
 * DESAGRUPAR SELECCIÓN EN UN SOLO CLIC:
 * Ejecuta la descomposición completa por jerarquía de contención.
 * - Descompone grupos de capas o CompoundPaths en capas y calados independientes.
 * - Desacopla la selección forzada arbitraria: selecciona limpiamente todas las
 *   entidades generadas para que el usuario tenga control total.
 * - Dispara el recálculo CSG para materializar perforaciones reactivas según orden Z.
 */
export function ungroupSelectedItem() {
  const wasInNodeEdit = !!window.nodeEditMode;
  if (wasInNodeEdit && typeof exitNodeEditMode === 'function') {
    exitNodeEditMode(true);
  }

  const selectedList = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (selectedList.length === 0) return;

  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }

  const allLiberatedItems = [];

  selectedList.forEach(item => {
    if (!item || item.data?.locked) return;

    const isClipped = !!(item.data && item.data.clipGroup);
    const actualItem = isClipped ? getContentItem(item) : item;
    if (!actualItem) return;

    // Caso A: Grupo estructurado previo ('compoundGroup')
    if (isGroup(actualItem) && actualItem.data?.geometricHierarchy === "compoundGroup") {
      const children = [...actualItem.children];
      const targetLayer = actualItem.layer || (paper.project ? paper.project.activeLayer : null);

      children.forEach(child => {
        if (targetLayer) {
          targetLayer.addChild(child);
        }
        allLiberatedItems.push(child);
      });

      actualItem.remove();
      if (isClipped && item.parent) {
        item.remove();
      }
    } else {
      // Caso B: Descomposición geométrica por jerarquía de contención en 1 clic
      const result = decomposeByContainmentHierarchy(actualItem);
      if (result && result.items && result.items.length > 0) {
        if (isClipped && item.parent) {
          item.remove();
        }
        allLiberatedItems.push(...result.items);
      }
    }
  });

  // Selección unificada de todos los elementos liberados
  if (allLiberatedItems.length > 0) {
    window.selectedItems = [...allLiberatedItems];
    window.selectedItem = allLiberatedItems[allLiberatedItems.length - 1];

    allLiberatedItems.forEach(it => {
      if (it) it.selected = true;
    });

    if (typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(window.selectedItem);
    }
    if (typeof updateContextualMenu === 'function') {
      updateContextualMenu(window.selectedItem);
    }
  } else {
    window.selectedItems = [];
    window.selectedItem = null;
    if (typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(null);
    }
    hideContextualMenu();
  }

  // Recálculo CSG dinámico global para consolidar perforaciones según apilamiento Z
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }

  paper.view.update();
}

/**
 * ENTRAR EN MODO EDICIÓN DE NODOS
 */
export function handleEnterNodeEdit() {
  const item = window.selectedItem;
  if (!item) return;
  if (typeof enterNodeEditMode === 'function') {
    enterNodeEditMode(item);
  }
}

/**
 * SALIR DEL MODO EDICIÓN DE NODOS
 */
export function handleExitNodeEdit() {
  if (typeof exitNodeEditMode === 'function') {
    exitNodeEditMode(false);
  }
}

/**
 * ACTUALIZAR VISIBILIDAD Y ESTADO DE LA BARRA CONTEXTUAL
 * @param {paper.Item|Array<paper.Item>} item
 */
export function updateContextualMenu(item) {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  const currentSelection = (window.selectedItems && window.selectedItems.length > 0)
    ? window.selectedItems
    : (item ? [item] : []);

  if (currentSelection.length === 0) {
    toolbar.style.display = 'none';
    toolbar.classList.remove('active');
    return;
  }

  toolbar.style.display = 'flex';
  toolbar.classList.add('active');

  const btnUngroup = document.getElementById('btnCtxUngroup');
  const btnGroup = document.getElementById('btnCtxGroup');
  const btnNodeEdit = document.getElementById('btnCtxNodeEdit');

  // Control del botón Agrupar: habilitado si hay 2 o más seleccionados
  if (btnGroup) {
    btnGroup.style.display = (currentSelection.length >= 2) ? 'inline-flex' : 'none';
  }

  // Control del botón Desagrupar: habilitado si hay grupos o CompoundPaths
  if (btnUngroup) {
    const hasUngroupable = currentSelection.some(it => {
      const real = getContentItem(it);
      return isGroup(real) || isCompoundPath(real) || (real && real.className === 'PlacedSymbol');
    });
    btnUngroup.style.display = hasUngroupable ? 'inline-flex' : 'none';
  }

  // Control del botón Edición de Nodos: solo para selección única compatible
  if (btnNodeEdit) {
    if (currentSelection.length === 1 && !window.nodeEditMode) {
      const single = getContentItem(currentSelection[0]);
      const canEditNodes = single && (single instanceof paper.Path || single instanceof paper.CompoundPath || single instanceof paper.PointText);
      btnNodeEdit.style.display = canEditNodes ? 'inline-flex' : 'none';
    } else {
      btnNodeEdit.style.display = 'none';
    }
  }
}

/**
 * OCULTAR BARRA CONTEXTUAL
 */
export function hideContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) {
    toolbar.style.display = 'none';
    toolbar.classList.remove('active');
  }
}

/**
 * INICIALIZACIÓN DE ESCUCHADORES DE EVENTOS DE LA BARRA CONTEXTUAL
 */
export function initContextualMenu() {
  const btnUngroup = document.getElementById('btnCtxUngroup');
  if (btnUngroup) {
    btnUngroup.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      ungroupSelectedItem();
    };
  }

  const btnGroup = document.getElementById('btnCtxGroup');
  if (btnGroup) {
    btnGroup.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      groupSelectedItems();
    };
  }

  const btnNodeEdit = document.getElementById('btnCtxNodeEdit');
  if (btnNodeEdit) {
    btnNodeEdit.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEnterNodeEdit();
    };
  }

  const btnExitNodeEdit = document.getElementById('btnExitNodeEdit');
  if (btnExitNodeEdit) {
    btnExitNodeEdit.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleExitNodeEdit();
    };
  }
}

// Exposición en el ámbito global para compatibilidad con eventos DOM e interfaces previas
if (typeof window !== 'undefined') {
  window.ungroupSelectedItem = ungroupSelectedItem;
  window.groupSelectedItems = groupSelectedItems;
  window.enterNodeEditMode = enterNodeEditMode;
  window.exitNodeEditMode = exitNodeEditMode;
  window.handleEnterNodeEdit = handleEnterNodeEdit;
  window.handleExitNodeEdit = handleExitNodeEdit;
  window.updateContextualMenu = updateContextualMenu;
  window.hideContextualMenu = hideContextualMenu;
  window.initContextualMenu = initContextualMenu;
}
