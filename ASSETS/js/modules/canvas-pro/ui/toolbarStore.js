/* =========================================================================
   EKKO STUDIO — STORE DE LA CINTA (Fase 0)

   Único lugar donde se CALCULA el estado de la barra. Ningún módulo más
   debe clasificar la selección para decidir botones: si algo necesita
   saber "¿qué hay seleccionado?", lee este snapshot.

   Toda la información viene del motor de capacidades en modo SOLO LECTURA.
   Este archivo no tiene reglas de negocio propias: si capabilities.js cambia,
   este store cambia solo.
   ========================================================================= */

import { describeSelection, resolveToolNames, detectTab, TABS } from "../capabilities.js";
import { tabsOfTool, isBaseTool } from "./toolbarManifest.js";

/** Selección vigente, normalizada a arreglo. */
export function getSelectionList() {
  const items = window.selectedItems;
  if (Array.isArray(items) && items.length) return items.filter(Boolean);
  if (window.selectedItem) return [window.selectedItem];
  return [];
}

/**
 * Snapshot completo del estado de la interfaz en este instante.
 *
 *  enabledTools  -> qué permite capabilities.js (la verdad de negocio)
 *  detectedTab   -> qué pestaña deduce la selección (Inicio/Imagen/Vector/…)
 *  activeTab     -> qué pestaña eligió el cliente (recorta, nunca amplía)
 */
export function compute() {
  const list = getSelectionList();
  const hasSelection = list.length > 0;

  const summary = hasSelection ? describeSelection(list) : null;
  /* capabilities.js resuelve él solo la selección vacía (devuelve las
     herramientas `always`). Si acá se saltara esa llamada, con nada
     seleccionado no habría NINGUNA herramienta habilitada y se irían
     Ajustar Vista, Reglas y Guías, que son exactamente las que tienen que
     estar. */
  const enabledTools = new Set(resolveToolNames(list));
  const detectedTab = detectTab(list);
  const activeTabRaw = (window.EKKO_PANEL_STATE && window.EKKO_PANEL_STATE.activeTab) || "auto";
  const activeTab = (activeTabRaw === "auto") ? "auto" : activeTabRaw;

  const baseTools = new Set(TABS.base?.tools || []);

  return {
    list,
    summary,
    hasSelection,
    enabledTools,
    detectedTab,
    activeTab,

    /**
     * RECORTA por la pestaña de contexto. Nunca amplía: una herramienta que
     * el motor no habilitó no puede entrar por la pestaña.
     * D2 (dueño 2026-11-11): el modo "auto" TAMBIÉN recorta ahora — muestra
     * la pestaña que la selección genera más el núcleo de Inicio. Antes
     * "auto" no filtraba nada y toda herramienta habilitada aparecía siempre
     * (por eso la barra entorpecía). Con una pestaña elegida a mano, esa
     * manda. Las universales de base pasan en todas las pestañas.
     */
    tabAllows(tool) {
      // Sin herramienta declarada (regla propia del manifiesto): la pestaña
      // no la recorta.
      if (!tool) return true;
      const contextTab = (activeTab !== "auto") ? activeTab : detectedTab;
      const tabDef = TABS[contextTab];
      if (!tabDef) return true;
      if (baseTools.has(tool)) return true;
      // Ronda 15 (modelo CAD): sin caso especial para zoom/reglas/guías.
      // Inicio es SOLO Crear; el hogar Lienzo vive en EDICIÓN, pestaña que
      // está SIEMPRE presente (tabsForSelection), así que el cliente llega
      // a ellas con un clic y el conjunto no salta.
      return (tabDef.tools || []).includes(tool);
    },

    /**
     * ¿La herramienta TIENE SENTIDO en el contexto de la selección?
     * Es la puerta de entrada de la familia P: si la herramienta pertenece a
     * la pestaña que esta selección genera, se MUESTRA (bloqueada con motivo)
     * en vez de desaparecer.
     */
    tabRelevant(tool) {
      if (!tool) return false;
      if (isBaseTool(tool)) return true;
      const tabs = tabsOfTool(tool);
      if (!tabs) return false;
      const contextTab = (activeTab !== "auto") ? activeTab : detectedTab;
      return tabs.includes(contextTab);
    }
  };
}

if (typeof window !== "undefined") {
  window.EKKO_TOOLBAR_STORE = Object.freeze({ compute, getSelectionList });
}
