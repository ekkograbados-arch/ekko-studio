/* =========================================================================
   EKKO STUDIO — RENDERER DE LA CINTA (Fase 0 · 1)

   ╔══════════════════════════════════════════════════════════════════════╗
   ║  UN SOLO ESCRITOR.  Estado -> render puro -> DOM.                   ║
   ║  Ningún otro módulo puede tocar style.display de un botón de barra. ║
   ╚══════════════════════════════════════════════════════════════════════╝

   ANTES había cuatro escritores de style.display con criterios distintos y
   en distintos ticks (canvasControlsIntegration, panelCommandBridge,
   contextualMenu y toolbarOverflow), y ganaba el último en correr: por eso
   un botón que debía irse reaparecía y uno que debía verse se ocultaba.

   AHORA: este módulo calcula (toolbarStore) y pinta (manifiesto). Los demás
   solo llaman a refresh().

   COMPORTAMIENTO POR FAMILIA:
     H -> visible y habilitado si capabilities.js lo habilita; si no, oculto.
     P -> SIEMPRE visible en su pestaña, pero BLOQUEADO con el motivo en el
          tooltip. Enseña la pirámide de orden sin que la barra salte.
     E -> el slot muestra SOLO el estado vigente (Quitar Fondo -> Editar Fondo).
   ========================================================================= */

import { FAMILY, BY_LEGACY } from "./toolbarManifest.js";
import { compute } from "./toolbarStore.js";

const SURFACES = ["topBar", "contextual-toolbar"];
const ATTR_TITLE = "data-ekko-original-title";
const CLASS_HIDDEN = "ekko-command-hidden";
const CLASS_LOCKED = "ekko-locked";

/** Itera los botones manifiesto de las dos superficies. */
function* barButtons() {
  for (const id of SURFACES) {
    const bar = document.getElementById(id);
    if (!bar) continue;
    for (const el of bar.querySelectorAll("[data-fusion-btn]")) yield el;
  }
}

/** Decisión pura: qué le toca a una entrada del manifiesto dado el estado. */
function decide(entry, snap) {
  /* La verdad de negocio la pone capabilities.js. Las herramientas sin
     entrada en el motor (tool: null) traen su propia `rule` declarada en el
     manifiesto: la interfaz no inventa nada, solo ejecuta lo declarado. */
  const enabled = entry.rule ? !!entry.rule(snap) : snap.enabledTools.has(entry.tool);

  /* 1) La pestaña activa RECORTA, nunca amplía. Las herramientas
     estructurales (tabBypass) siguen a la selección aunque la pestaña diga
     otra cosa: un grupo seleccionado se desagrupa desde la pestaña Vector. */
  const tabOk = snap.tabAllows(entry.tool) || (enabled && entry.tabBypass === true);
  if (!tabOk) return { show: false, enabled: false, reason: null };

  /* 2) La verdad de negocio la pone capabilities.js. */
  const extraOk = entry.extra ? !!entry.extra(snap) : true;
  if (enabled && extraOk) return { show: true, enabled: true, reason: null };

  /* 3) Familia P: si tiene sentido en este contexto, se MUESTRA bloqueada con
     el motivo en el tooltip en vez de desaparecer (enseña la pirámide). */
  const relevant = snap.tabRelevant(entry.tool);
  const wantsLock = !extraOk || entry.family === FAMILY.P;
  if (relevant && wantsLock) {
    const reason = typeof entry.reason === "function" ? entry.reason(snap) : entry.reason;
    return { show: true, enabled: false, reason: reason || "Requisito previo pendiente" };
  }

  /* 4) Familia E (máquina de estados): el botón no existe hasta que el estado
     de la pieza lo habilita. Y H fuera de su contexto: se oculta. */
  return { show: false, enabled: false, reason: null };
}

function applyDecision(el, decision) {
  const { show, enabled, reason } = decision;

  // Título original: se guarda una sola vez para poder devolverlo.
  if (!el.hasAttribute(ATTR_TITLE)) {
    el.setAttribute(ATTR_TITLE, el.getAttribute("title") || "");
  }

  if (!show) {
    el.style.display = "none";
    el.classList.add(CLASS_HIDDEN);
    el.classList.remove(CLASS_LOCKED);
    if (el.disabled) el.disabled = false;
    el.setAttribute("title", el.getAttribute(ATTR_TITLE));
    el.setAttribute("aria-hidden", "true");
    return;
  }

  el.style.display = "";
  el.classList.remove(CLASS_HIDDEN);
  /* Clase `hidden` ({display:none !important}) que pudiera haber dejado un
     módulo anterior: con !important le ganaría al motor. */
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");

  if (enabled) {
    el.classList.remove(CLASS_LOCKED);
    if (el.disabled) el.disabled = false;
    el.removeAttribute("aria-disabled");
    el.setAttribute("title", el.getAttribute(ATTR_TITLE));
  } else {
    el.classList.add(CLASS_LOCKED);
    el.disabled = true;
    if (reason) el.setAttribute("title", reason);
    el.setAttribute("aria-disabled", "true");
  }
}

let pendingFrame = 0;

/** Render síncrono. Devuelve el snapshot por si algo quiere inspeccionarlo. */
export function renderNow() {
  if (typeof document === "undefined") return null;
  const snap = compute();
  const state = {
    selectionCount: snap.list.length,
    detectedTab: snap.detectedTab,
    activeTab: snap.activeTab,
    enabledTools: [...snap.enabledTools],
    shown: [],
    locked: [],
    hidden: []
  };

  for (const el of barButtons()) {
    const entry = BY_LEGACY.get(el.dataset.fusionBtn);
    // Sin manifiesto: este botón todavía no está bajo contrato. No se toca.
    if (!entry) continue;
    const decision = decide(entry, snap);
    applyDecision(el, decision);
    if (!decision.show) state.hidden.push(el.dataset.fusionBtn);
    else if (!decision.enabled) state.locked.push(el.dataset.fusionBtn);
    else state.shown.push(el.dataset.fusionBtn);
  }

  window.EKKO_RIBBON_STATE = Object.freeze(state);
  /* Fase 2: si la cinta tiene grupos, sincronizan (grupo sin botones
     visibles = oculto). Guardado con ? porque el layout puede no haber
     cargado todavía. */
  try { window.EKKO_RIBBON_LAYOUT?.sync?.(); } catch (_) {}
  return snap;
}

/** Render con debounce de un frame: muchas fuentes disparan a la vez. */
export function refresh() {
  if (typeof window === "undefined") return;
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    try {
      renderNow();
    } catch (error) {
      console.error("[EKKO RIBBON] render falló", error);
    }
  });
}

/** Instalación: un render inicial + observación de cambios estructurales. */
function install() {
  renderNow();

  // Si un módulo reconstruye botones (lista de fuentes, subgrupos), hay que
  // volver a aplicar el contrato. Solo childList: nuestros cambios son de
  // atributo, así que no hay bucle.
  try {
    const observer = new MutationObserver(() => refresh());
    SURFACES.forEach(id => {
      const bar = document.getElementById(id);
      if (bar) observer.observe(bar, { childList: true, subtree: true });
    });
  } catch (_) {}

  window.EKKO_RIBBON = Object.freeze({ refresh, renderNow });
  // Alias para que los módulos antiguos puedan delegar sin importar nada.
  window.refreshEKKORibbon = refresh;
  console.log(
    "%c[EKKO RIBBON v1] Un solo escritor activo sobre #topBar y #contextual-toolbar.",
    "color:#7c3aed;font-weight:bold;"
  );
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
}
