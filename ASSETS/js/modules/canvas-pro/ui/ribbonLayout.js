/* =========================================================================
   EKKO STUDIO — RIBBON LAYOUT (Fase 2)

   Reorganiza los botones que YA existen en #topBar dentro de grupos con
   TÍTULO, colapsables, debajo de la tira de pestañas contextuales que ya
   construye panelCoordinator (#ekkoTopContextSurface).

   IMPORTANTE: no se recrea ningún botón. Se MOVEN los nodos del DOM, así
   que se conservan id, onclick, data-ekko-command y data-fusion-btn. Nadie
   pierde su manejador.

   Estructura resultante:

     #topBar
       #ekkoTopContextSurface      ← pestañas (panelCoordinator, ya existía)
       .ekko-ribbon-body
         .ekko-ribbon-group[data-group="fondo"]
           .ekko-ribbon-group-body  ← botones
           .ekko-ribbon-group-head  ← título, clic = colapsar
         …
         #selectionInfo / #btnTopTextCurve / #topPanelControls (sueltos)

   Este módulo NO decide visibilidad de botones (eso es ribbonRenderer);
   solo decide DÓNDE están y si un grupo entero quedó sin nada visible.
   ========================================================================= */

import { GROUPS, BY_LEGACY } from "./toolbarManifest.js";

/** Botones sin manifiesto que igual pertenecen a un grupo por su oficio. */
const FORCE_GROUP = Object.freeze({
  btnTopTextCurve: "texto",
  btnCtxTextCurve: "texto"
});

let layout = null;

function makeGroup(def) {
  const el = document.createElement("div");
  el.className = "ekko-ribbon-group";
  el.dataset.group = def.key;

  const body = document.createElement("div");
  body.className = "ekko-ribbon-group-body";

  const head = document.createElement("div");
  head.className = "ekko-ribbon-group-head";
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  head.setAttribute("aria-expanded", "true");
  head.title = `Plegar / desplegar el grupo ${def.label}`;

  const title = document.createElement("span");
  title.className = "ekko-ribbon-group-title";
  title.textContent = def.label;
  head.appendChild(title);

  // El cuerpo va primero en el DOM y el título después: con flex-direction
  // column y order se logra el look de Office (etiqueta DEBAJO de los botones).
  el.appendChild(body);
  el.appendChild(head);

  const toggle = () => {
    const collapsed = el.classList.toggle("is-collapsed");
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
  });

  return { el, body, head };
}

/** ¿Este nodo es un contenedor de botones o un botón suelto? */
function nodesOf(child) {
  if (child.matches && child.matches("button")) return [child];
  if (child.querySelectorAll) return [...child.querySelectorAll("button")];
  return [];
}

function build() {
  const top = document.getElementById("topBar");
  if (!top || top.dataset.ekkoRibbon === "1") return layout;

  const surface = document.getElementById("ekkoTopContextSurface");
  const body = document.createElement("div");
  body.className = "ekko-ribbon-body";

  const groups = new Map();
  GROUPS.forEach(def => {
    const made = makeGroup(def);
    groups.set(def.key, made);
  });

  const trailing = [];
  const originals = [...top.children].filter(el => el !== surface);

  originals.forEach((child, index) => {
    const buttons = nodesOf(child);
    if (!buttons.length) {
      // Sin botones: selectionInfo, controles de panel… van al final.
      trailing.push(child);
      return;
    }
    buttons.forEach(btn => {
      /* El nombre legacy puede venir en data-fusion-btn (marcado en el HTML)
         o en data-ekko-command (lo etiqueta panelCommandBridge en runtime,
         como pasa con las cuatro booleanas del panel superior). Se miran los
         dos para no agrupar mal a un botón cuyo marcado todavía no corrió. */
      const legacy = btn.dataset.fusionBtn || btn.dataset.ekkoCommand || null;
      let key = FORCE_GROUP[btn.id] || (legacy && BY_LEGACY.has(legacy) ? BY_LEGACY.get(legacy).group : null);
      /* Si el nombre venía solo en data-ekko-command, se lo deja escrito en
         data-fusion-btn para que el renderer también lo gobierne: si no, el
         botón quedaría siempre visible y su grupo nunca se vaciaría. */
      if (key && !btn.dataset.fusionBtn && legacy && BY_LEGACY.has(legacy)) {
        btn.dataset.fusionBtn = legacy;
      }
      if (!key) {
        // Solo el primer bloque original son botones de creación (Cargar,
        // Agregar Texto, QR). Lo demás sin manifiesto se queda suelto.
        key = (index === 0) ? "creacion" : null;
      }
      if (key && groups.has(key)) groups.get(key).body.appendChild(btn);
      else trailing.push(btn);
    });
    // El contenedor original queda vacío: no se vuelve a insertar.
  });

  /* Se insertan TODOS los grupos, incluso los que nacen vacíos: si se
     descartara uno en el build, no podría volver a aparecer nunca cuando la
     selección lo habilite. El que no tiene nada visible se oculta con
     la clase `is-empty` en sync(). */
  GROUPS.forEach(def => body.appendChild(groups.get(def.key).el));
  trailing.forEach(node => body.appendChild(node));

  top.appendChild(body);
  top.dataset.ekkoRibbon = "1";
  layout = { top, body, groups };
  sync();
  return layout;
}

/**
 * Oculta los grupos que quedaron sin ningún botón visible. Así la cinta
 * "respira" con la selección sin dejar huecos muertos entre grupos.
 */
export function sync() {
  const current = build();
  if (!current) return;
  current.groups.forEach(g => {
    if (!g.el.isConnected) return;
    const visible = [...g.body.querySelectorAll("button")].some(btn =>
      btn.style.display !== "none" && !btn.classList.contains("ekko-command-hidden")
    );
    g.el.classList.toggle("is-empty", !visible);
  });
}

export function initRibbonLayout() {
  build();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { try { initRibbonLayout(); } catch (e) { console.error("[EKKO RIBBON] layout", e); } }, { once: true });
  } else {
    try { initRibbonLayout(); } catch (e) { console.error("[EKKO RIBBON] layout", e); }
  }
}

if (typeof window !== "undefined") {
  window.EKKO_RIBBON_LAYOUT = Object.freeze({ sync, init: initRibbonLayout });
}
