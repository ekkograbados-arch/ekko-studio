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
     H -> visible y habilitado si capabilities.js lo habilita. Si la entrada
          declara `reason` (align, centrar…), se VE APAGADA con ese motivo:
          gris con motivo, nunca desaparece de su pestaña (maqueta CAD v3).
     P -> SIEMPRE visible en su pestaña, pero BLOQUEADA con el motivo en el
     P -> SIEMPRE visible en su pestaña, pero BLOQUEADO con el motivo en el
          tooltip. Enseña la pirámide de orden sin que la barra salte.
     E -> el slot muestra SOLO el estado vigente (Quitar Fondo -> Editar Fondo).
   ========================================================================= */

import { FAMILY, BY_LEGACY } from "./toolbarManifest.js";
import { compute } from "./toolbarStore.js";

/* D2 (dueño 2026-11-11): la barra profesional entra al contrato. Sus botones
   (alinear en producto, reglas, guías, cotas, distribuir, fusionar, calado…)
   compartían los comandos de la cinta pero VIVÍAN AFUERA del único escritor:
   nadie los filtraba y estaban siempre visibles — justo el desorden que el
   dueño señala. Desde acá obedecen la misma pestaña que la cinta. */
const SURFACES = ["topBar", "contextual-toolbar", "pro-layout-toolbar"];
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
function decide(entry, snap, esContextual = false) {
  /* La verdad de negocio la pone capabilities.js. Las herramientas sin
     entrada en el motor (tool: null) traen su propia `rule` declarada en el
     manifiesto: la interfaz no inventa nada, solo ejecuta lo declarado. */
  const enabled = entry.rule ? !!entry.rule(snap) : snap.enabledTools.has(entry.tool);

  /* 1) La pestaña activa RECORTA, nunca amplía. Las herramientas
     estructurales (tabBypass) siguen a la selección aunque la pestaña diga
     otra cosa: un grupo seleccionado se desagrupa desde la pestaña Vector.
     R22 (dueño): la BARRA EMERGENTE es CONTEXTUAL — sus atajos siguen a la
     SELECCIÓN, no a la pestaña. Antes la pestaña resolvía a "base" (sin
     tools) y los botones del atajo salían ocultos (queja 5). */
  const tabOk = esContextual || snap.tabAllows(entry.tool) || (enabled && entry.tabBypass === true);
  if (!tabOk) return { show: false, enabled: false, reason: null };

  /* 2) La verdad de negocio la pone capabilities.js. */
  const extraOk = entry.extra ? !!entry.extra(snap) : true;
  if (enabled && extraOk) return { show: true, enabled: true, reason: null };

  /* 3) GRIS CON MOTIVO (Ronda 15, maqueta CAD v3): si la entrada declara
     `reason` — familia P por pirámide de orden, o H con puerta fina — se
     MUESTRA APAGADA con el motivo en el tooltip en vez de desaparecer:
     el botón enseña su requisito y la banda no salta.
     R24: las entradas SIN herramienta del motor (tool: null, con regla
     propia en el manifiesto) eran SIEMPRE "no relevantes"
     (tabRelevant(null)=false) y por eso se OCULTABAN con la regla en
     false: con dos textos seleccionados todos los controles de texto
     desaparecían sin aviso ("los controles del panel superior no
     funcionan"). Para ellas la relevancia es HABER SELECCIÓN: la regla
     del manifiesto ya define el estado válido, y el motivo explica el
     resto. Sin selección siguen ocultas (antes y ahora). */
  const relevant = entry.tool ? snap.tabRelevant(entry.tool) : snap.hasSelection;
  const wantsLock = !extraOk || entry.family === FAMILY.P || entry.reason != null;
  const lockOk = entry.lockWhen ? !!entry.lockWhen(snap) : true;
  if (relevant && wantsLock && lockOk) {
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
    el.removeAttribute("data-ekko-reason");
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
    el.removeAttribute("data-ekko-reason");
    if (el.disabled) el.disabled = false;
    /* R24: los campos de texto son INPUTS dentro del span. Si el span queda
       gris, el input debe quedarse también sin edición: si no, un campo
       apagado seguiría aceptando tecleo/rueda sobre uno de los textos de una
       selección múltiple, que es exactamente la inconsistencia a evitar. */
    el.querySelectorAll("input, select, textarea").forEach(i => { i.disabled = false; });
    el.removeAttribute("aria-disabled");
    el.setAttribute("title", el.getAttribute(ATTR_TITLE));
  } else {
    el.classList.add(CLASS_LOCKED);
    el.disabled = true;
    el.querySelectorAll("input, select, textarea").forEach(i => { i.disabled = true; });
    if (reason) {
      /* Ronda 15: el motivo tambien en data-ekko-reason. Los interceptores
         de clic (panelCommandBridge, toolbarOverflow) leen ese atributo para
         no tragarse el clic de un boton bloqueado; antes solo iba en title. */
      el.setAttribute("title", reason);
      el.setAttribute("data-ekko-reason", reason);
    }
    el.setAttribute("aria-disabled", "true");
  }
}

/**
 * BARRA EMERGENTE SIN SLOTS VACÍOS (queja 5).
 *
 * La píldora #contextual-toolbar mostraba huecos mudos: grupos cuyos
 * botones se habían adoptado en la cinta (R18) o que el motor escondió
 * entero quedaban dibujados como cajitas vacías, y encima sobraba el
 * separador al costado — "no muestra correctamente los botones de atajos".
 *
 * cascadeToolbar.js YA calculaba esto (.ekko-fb-vacia) pero su
 * montarBarraEmergente() no corre en este layout (data-ekkoCascadeFb
 * nunca se pone), así que la clase jamás se aplicaba y la regla CSS no
 * tenía a quién aplicársele. Acá se pinta desde el ÚNICO escritor de la
 * píldora: grupo sin ningún control utilizable (visible y no bloqueado
 * por el motor) => .ekko-fb-vacia, y el CSS lo oculta junto con los
 * dividers vecinos. Los grupos con al menos un botón no se tocan.
 *
 * @returns {number} cuántos grupos quedaron vacíos (para depurar).
 */
function marcarGruposVaciosPildora() {
  const bar = document.getElementById("contextual-toolbar");
  if (!bar) return 0;
  let vacios = 0;
  /* Sin layout no se mide nada: si la píldora está oculta (sin selección),
     todos los hijos miden 0 px y quedarían marcados vacíos sin serlo. */
  const rectPill = bar.getBoundingClientRect();
  if (getComputedStyle(bar).display === "none" || !rectPill.width) return 0;
  for (const grupo of bar.children) {
    if (!grupo.classList) continue;
    /* Agrupadores directos de la píldora: los .toolbar-group (Eliminar,
       Fusionar…) y también los .toolbar-subgroup (#ctxTextControls, que
       tras la adopción R18 quedó con los SOLOS textos "Radio"/"Espacio"
       y el wrapper vacío del select de fuente: texto mudo sin botón). */
    const esAgrupador = grupo.classList.contains("toolbar-group")
                     || grupo.classList.contains("toolbar-subgroup");
    if (!esAgrupador) continue;
    /* SE MIDE SIEMPRE CON EL GRUPO PINTADO: si está oculto por la regla
       .ekko-fb-vacia, sus hijos miden 0 px y la medición diría "vacío"
       aunque hayan vuelto botones útiles (y ahí el grupo oscilaría entre
       vacío y lleno en cada render). Se quita la clase, se mide de verdad
       y se vuelve a poner solo si sigue sin nada útil. La clase .hidden /
       ekko-command-hidden / display:none inline se chequean aparte porque
       esas formas de ocultar no dependen de que el grupo esté pintado. */
    const estabaVacio = grupo.classList.contains("ekko-fb-vacia");
    if (estabaVacio) grupo.classList.remove("ekko-fb-vacia");
    const controlUtil = [...grupo.querySelectorAll("button, input, select, textarea")]
      .some(c => {
        if (c.classList.contains(CLASS_HIDDEN)) return false;  // escondido por el motor
        if (c.classList.contains("hidden")) return false;      // display:none !important
        if (c.style.display === "none") return false;
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    const vacio = !controlUtil;
    grupo.classList.toggle("ekko-fb-vacia", vacio);
    if (vacio) vacios++;
  }

  /* SEPARADORES: un divider solo tiene sentido si separa DOS grupos
     visibles, y solo el PRIMERO de esa pareja: si entre los dos vivos
     quedó un grupo mudo en el medio, sus dos dividers apuntan al mismo
     par y sobra uno (se veía rayita doble). */
  const nodos = [...bar.children];
  const esGrupo = n => n.classList &&
    (n.classList.contains("toolbar-group") || n.classList.contains("toolbar-subgroup"));
  const pintado = n => esGrupo(n) && !n.classList.contains("ekko-fb-vacia") &&
    getComputedStyle(n).display !== "none";
  let hayVisibleAntes = false;
  let usadoTrasVisible = false;
  nodos.forEach((n) => {
    if (esGrupo(n)) {
      if (pintado(n)) { hayVisibleAntes = true; usadoTrasVisible = false; }
      return;
    }
    if (!n.classList || !n.classList.contains("toolbar-divider")) return;
    let hayVisibleDespues = false;
    const i = nodos.indexOf(n);
    for (let j = i + 1; j < nodos.length && !hayVisibleDespues; j++) hayVisibleDespues = pintado(nodos[j]);
    const sobra = !hayVisibleAntes || !hayVisibleDespues || usadoTrasVisible;
    n.classList.toggle("ekko-divider-sobra", sobra);
    if (!sobra) usadoTrasVisible = true;
  });
  return vacios;
}

let pendingFrame = 0;

/** Render síncrono. Devuelve el snapshot por si algo quiere inspeccionarlo. */
export function renderNow() {
  if (typeof document === "undefined") return null;
  const snap = compute();

  /* Ronda 11 (dueño 2026-11-11): la banda de propiedades YA NO es un nivel
     suelto debajo de la cinta. La Ronda 12 (dueño 2026-11-11, rechazo de la
     R11) la jubila: el modelo es Word de UNA cinta — al fijar Organizar es
     la PROPIA CINTA la que cambia de contenido. La banda queda como
     RESERVORIO OCULTO para siempre: sus botones siguen en el DOM (los
     botones de la cinta los despachan con click()) y el puente los sigue
     gobernando, pero nunca vuelve a verse. */
  const bandaPro = document.getElementById("pro-layout-toolbar");
  if (bandaPro) {
    bandaPro.style.display = "none";
    bandaPro.classList.remove("ekko-band-fuera");
  }

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
    const esContextual = !!el.closest("#contextual-toolbar");
    const decision = decide(entry, snap, esContextual);
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
  /* Queja 5: recién DESPUÉS de que la cinta adoptó sus botones se mide la
     píldora, así el grupo recién vaciado se oculta en el mismo render. */
  try { marcarGruposVaciosPildora(); } catch (_) {}
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
