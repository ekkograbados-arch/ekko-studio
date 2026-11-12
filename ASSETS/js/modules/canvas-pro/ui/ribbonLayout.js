/* =========================================================================
   EKKO STUDIO — RIBBON LAYOUT (Ronda 15 · panel superior tipo CAD)

   Maqueta el panel superior según la maqueta v3 APROBADA por el dueño
   (maqueta-cinta-cad.html): hogares con TÍTULO ABAJO, altura uniforme,
   botones grandes (icono arriba, nombre abajo) en CREAR y botones chicos
   (icono + nombre) apilados en columnas de 3 en el resto. Flechas de
   desborde a nivel de BANDA COMPLETA, nunca adentro de un hogar.

   IMPORTANTE: no se recrea ningún botón. Se MOVEN los nodos del DOM, así
   que se conservan id, onclick, data-ekko-command y data-fusion-btn.

   De dónde salen los botones:
     - #topBar (los originales) -> hogares según toolbarManifest.GROUPS.
     - .size-control-group de #contextual-toolbar -> hogar TAMAÑO
       (los campos duplicados objFontSize/objCurveRadius/... van a un
       reservorio OCULTO: hay módulos que los leen y escriben, no se
       pueden borrar).
     - #ctxTextControls -> campos del hogar TIPOGRAFÍA (selector de fuente,
       tamaño) y del hogar CURVAR Y ESPACIAR (curvatura, radio, espaciado,
       soldar, girar letras).
     - #btnCtxFlipH/#btnCtxFlipV -> hogar ORGANIZAR (Voltear H / Voltear V),
       etiquetados flipH/flipV para que el manifiesto los gobierne.
     - #pro-layout-toolbar (banda reservorio oculta) -> se ADOPTAN solo los
       que no duplican a uno de #topBar: Centrar H/V/total, Distribuir H/V
       y Cotas. Alinear-direcciones y capas quedan allá: la cinta ya tiene
       Alinear (genérico) y Subir/Bajar/Frente/Fondo propios.

   Este módulo NO decide visibilidad de botones (eso es ribbonRenderer);
   solo decide DÓNDE están, oculta el hogar que quedó sin nada visible y
   pinta las flechas de banda.
   ========================================================================= */

import { GROUPS, BY_LEGACY } from "./toolbarManifest.js";

const RESERVORIO_ID = "ekkoRibbonReservorio";
const CLASE_FLECHA = "ekko-banda-flecha";

/** Botones sin manifiesto que igual pertenecen a un hogar por su oficio.
 *  Quedó VACÍO: todos los botones del panel superior están bajo contrato. */
const FORCE_GROUP = Object.freeze({});

/* Campos duplicados de la caja de selección que viven dentro de
   .size-control-group pero NO son del hogar Tamaño (son de Tipografía y
   Curvar). Los módulos (rotationController, textToolbar, contextualMenu)
   los leen por id: van a un reservorio oculto, nunca se eliminan. */
const CAMPOS_DUPLICADOS = ["objFontSize", "objCurveRadius", "objBendAngleVal", "objTextSpacingSlider", "objTextSpacing"];

/* Orden de nodos dentro de cada hogar. Se re-aplica en cada sync, así que
   el orden queda estable aunque la adopción corra muchas veces. */
const ORDEN_HOGARES = {
  tamano:       [".size-control-group"],
  portapapeles: ['[data-fusion-btn="delete"]', '[data-fusion-btn="duplicate"]',
                 '[data-fusion-btn="copy"]',   '[data-fusion-btn="paste"]'],
  organizar:    ['[data-fusion-btn="align"]',   '[data-fusion-btn="group"]',
                 '[data-fusion-btn="ungroup"]', '[data-fusion-btn="distribute"]',
                 '[data-fusion-btn="centerH"]', '[data-fusion-btn="centerV"]',
                 '[data-fusion-btn="centerBoth"]',
                 '[data-fusion-btn="flipH"]',   '[data-fusion-btn="flipV"]',
                 '[data-fusion-btn="bringForward"]', '[data-fusion-btn="sendBackward"]',
                 '[data-fusion-btn="toFront"]', '[data-fusion-btn="toBack"]'],
  lienzo:       ['[data-fusion-btn="zoom"]', '[data-fusion-btn="rulers"]',
                 '[data-fusion-btn="guides"]', '[data-fusion-btn="measurements"]',
                 '[data-fusion-btn="zoomReset"]'],
  imagen:       ['[data-fusion-btn="removeBg"]', '[data-fusion-btn="editCutout"]'],
  trazar:       ['[data-fusion-btn="outline"]', '[data-fusion-btn="traceImage"]',
                 '[data-fusion-btn="textToVector"]'],
  vector:       ['[data-fusion-btn="editNodes"]', '[data-fusion-btn="cutSegment"]',
                 '[data-fusion-btn="decomposeVector"]', '[data-fusion-btn="audit"]',
                 '[data-fusion-btn="ctxDeleteNode"]', '[data-fusion-btn="ctxExitNodeEdit"]'],
  fusion:       ['[data-fusion-btn="fusion"]', '[data-fusion-btn="unfusion"]',
                 '[data-fusion-btn="editFusionImage"]'],
  huecos:       ['[data-fusion-btn="calado"]', '[data-fusion-btn="rellenar"]',
                 '[data-fusion-btn="solidHole"]'],
  booleanas:    ['[data-fusion-btn="booleanUnion"]', '[data-fusion-btn="booleanSubtract"]',
                 '[data-fusion-btn="booleanIntersect"]', '[data-fusion-btn="booleanDifference"]'],
  texto:        ['[data-fusion-btn="campoFuente"]', '[data-fusion-btn="campoTamanoFuente"]',
                 '[data-fusion-btn="ctxBold"]', '[data-fusion-btn="ctxItalic"]',
                 '[data-fusion-btn="ctxUnderline"]'],
  curvar:       ['[data-fusion-btn="curvar"]', '[data-fusion-btn="campoCurvatura"]',
                 '[data-fusion-btn="campoRadio"]', '[data-fusion-btn="campoEspaciado"]',
                 '[data-fusion-btn="ctxWeld"]', '[data-fusion-btn="ctxRotateLetters"]']
};

/* Icono dos-tonos del sprite para reemplazar el <i> de FontAwesome en los
   botones adoptados. Los que no están en el sprite no se tocan. */
const SWAP_ICONOS = {
  proBtnCenterH:            { icono: "ekko-centrar-h",   texto: "Centrar H" },
  proBtnCenterV:            { icono: "ekko-centrar-v",   texto: "Centrar V" },
  proBtnCenterBoth:         { icono: "ekko-centrar",     texto: "Centrar total" },
  proBtnDistributeH:        { icono: "ekko-distribuir-h", texto: "Distribuir H" },
  proBtnDistributeV:        { icono: "ekko-distribuir-v", texto: "Distribuir V" },
  proBtnToggleMeasurements: { icono: "ekko-cotas",       texto: "Cotas" },
  btnCtxFlipH:              { icono: "ekko-voltear",     texto: "Voltear H" },
  btnCtxFlipV:              { icono: "ekko-voltear-v",   texto: "Voltear V" },
  btnCtxBold:               { icono: "ekko-negrita" },
  btnCtxItalic:             { icono: "ekko-cursiva" },
  btnCtxUnderline:          { icono: "ekko-subrayado" },
  btnCtxWeld:               { icono: "ekko-soldar" },
  btnCtxRotateLetters:      { icono: "ekko-rotar" },
  btnCtxDeleteNode:         { icono: "ekko-eliminar" },
  btnSizeLockContext:       { icono: "ekko-candado" }
};

let layout = null;

/* ------------------------------------------------------------------ */
/* RESERVORIO OCULTO de campos que otros módulos siguen usando         */
/* ------------------------------------------------------------------ */
function asegurarReservorio() {
  let r = document.getElementById(RESERVORIO_ID);
  if (r) return r;
  r = document.createElement("div");
  r.id = RESERVORIO_ID;
  r.setAttribute("aria-hidden", "true");
  /* Nada de display:none: los inputs de un contenedor oculto son medibles
     pero algunos navegadores les reducen el layout; queda fuera de pantalla
     y con tamaño real para que las librerías que lo leen no se confundan. */
  r.style.cssText = "position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;";
  const ancla = document.getElementById("contextual-toolbar") || document.body;
  ancla.appendChild(r);
  return r;
}

/* ------------------------------------------------------------------ */
/* HOGAR CAD                                                           */
/* ------------------------------------------------------------------ */
function makeGroup(def) {
  const el = document.createElement("div");
  el.className = "ekko-ribbon-group";
  el.dataset.group = def.key;
  if (def.modo) el.dataset.modo = def.modo;

  const body = document.createElement("div");
  body.className = "ekko-ribbon-group-body";

  const head = document.createElement("div");
  head.className = "ekko-ribbon-group-head";
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  head.setAttribute("aria-expanded", "true");
  head.title = `Plegar / desplegar el hogar ${def.label}`;

  const title = document.createElement("span");
  title.className = "ekko-ribbon-group-title";
  title.textContent = def.label;
  head.appendChild(title);

  // Cuerpo primero, título después: el TÍTULO QUEDA ABAJO (maqueta CAD).
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

  return { el, body, head, def };
}

/** ¿Este nodo es un contenedor de botones o un botón suelto? */
function nodesOf(child) {
  if (child.matches && child.matches("button")) return [child];
  if (child.querySelectorAll) return [...child.querySelectorAll("button")];
  return [];
}

/* ------------------------------------------------------------------ */
/* BOTONES NUEVOS (solo los que no existen en ningún DOM)              */
/* ------------------------------------------------------------------ */
function crearBoton(legacy, etiqueta, iconoId, onclickAttr) {
  if (document.querySelector(`#topBar [data-fusion-btn="${legacy}"]`)) return null;
  const b = document.createElement("button");
  b.className = "btn-action";
  b.dataset.fusionBtn = legacy;
  b.title = etiqueta;
  b.setAttribute("aria-label", etiqueta);
  b.innerHTML =
    `<svg class="ekko-ic" aria-hidden="true"><use href="ASSETS/ui/ekko-icons.svg#ekko-${iconoId}"></use></svg> ${etiqueta}`;
  if (onclickAttr) b.setAttribute("onclick", onclickAttr);
  return b;
}

/* ------------------------------------------------------------------ */
/* ADOPCIÓN (idempotente: corre en cada sync)                          */
/* ------------------------------------------------------------------ */
function etiquetar(btn, legacy) {
  if (!btn) return;
  /* SE FORZA el valor: panelCommandBridge etiqueta los proBtn con mapas
     gruesos (proBtnCenterH -> "align") y pisaría el nombre fino del hogar. */
  btn.dataset.fusionBtn = legacy;
}

function ponerIcono(btn, iconoId) {
  if (!btn || !iconoId) return;
  if (btn.querySelector("svg.ekko-ic")) return; // ya tiene icono del sprite
  const i = btn.querySelector("i");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ekko-ic");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<use href="ASSETS/ui/ekko-icons.svg#${iconoId}"></use>`;
  if (i) { i.replaceWith(svg); return; }
  /* Sin <i> (el candado de la caja trae un glifo de texto): se reemplaza
     el contenido por el icono del sprite. */
  btn.textContent = "";
  btn.appendChild(svg);
}

function adoptar() {
  if (!layout) return;
  const g = key => layout.groups.get(key);

  const mover = (node, key) => {
    if (!node || !g(key)) return;
    if (node.parentElement !== g(key).body) g(key).body.appendChild(node);
  };

  /* --- 1. CAJA DE SELECCIÓN -> hogar TAMAÑO ------------------------- */
  const sizeGroup = document.querySelector("#contextual-toolbar .size-control-group");
  if (sizeGroup) {
    if (!sizeGroup.dataset.ekkoAdoptado) {
      sizeGroup.dataset.ekkoAdoptado = "1";
      etiquetar(sizeGroup, "size");
      const reservorio = asegurarReservorio();
      [...sizeGroup.children].forEach(node => {
        const propio = node.id && CAMPOS_DUPLICADOS.includes(node.id);
        const interno = node.querySelector && CAMPOS_DUPLICADOS.some(id => node.querySelector("#" + id));
        if (propio || interno) reservorio.appendChild(node);
      });
      const candado = document.getElementById("btnSizeLockContext");
      if (candado) ponerIcono(candado, "ekko-candado");
    }
    mover(sizeGroup, "tamano");
  }

  /* --- 2. TIPOGRAFÍA y CURVAR Y ESPACIAR (desde #ctxTextControls) --- */
  const envolver = (node, legacy) => {
    if (!node) return null;
    if (node.parentElement && node.parentElement.dataset.fusionBtn === legacy) {
      return node.parentElement; // ya envuelto
    }
    const span = document.createElement("span");
    span.className = "ekko-ribbon-campo";
    span.dataset.fusionBtn = legacy;
    node.replaceWith(span);
    span.appendChild(node);
    return span;
  };
  const fuente = document.getElementById("ctxFontSelector");
  if (fuente) mover(envolver(fuente, "campoFuente"), "texto");
  const tamFuente = document.getElementById("ctxFontSize");
  if (tamFuente) mover(envolver(tamFuente, "campoTamanoFuente"), "texto");
  const curvatura = document.getElementById("ctxTextCurvature");
  if (curvatura) mover(envolver(curvatura, "campoCurvatura"), "curvar");
  const radio = document.getElementById("ctxCurveRadius");
  if (radio) mover(envolver(radio, "campoRadio"), "curvar");
  const sliderEsp = document.getElementById("ctxTextSpacingSlider");
  if (sliderEsp) mover(envolver(sliderEsp, "campoEspaciado"), "curvar");
  const numEsp = document.getElementById("ctxTextSpacing");
  if (numEsp) mover(envolver(numEsp, "campoEspaciado"), "curvar");

  /* --- 3. VOLTEAR H/V (desde #ctxImageControls) y nodos ------------- */
  ["btnCtxFlipH", "btnCtxFlipV"].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    etiquetar(b, id === "btnCtxFlipH" ? "flipH" : "flipV");
    const swap = SWAP_ICONOS[id];
    if (swap) ponerIcono(b, swap.icono);
    if (b.parentElement && b.parentElement.closest("#contextual-toolbar")) mover(b, "organizar");
  });
  ["btnCtxDeleteNode", "btnCtxExitNodeEdit"].forEach(id => {
    const b = document.getElementById(id);
    if (b && b.parentElement && b.parentElement.closest("#contextual-toolbar")) mover(b, "vector");
  });
  ["btnCtxBold", "btnCtxItalic", "btnCtxUnderline", "btnCtxWeld", "btnCtxRotateLetters"].forEach(id => {
    const b = document.getElementById(id);
    if (b && b.parentElement && b.parentElement.closest("#contextual-toolbar")) {
      const key = (id === "btnCtxWeld" || id === "btnCtxRotateLetters") ? "curvar" : "texto";
      mover(b, key);
    }
  });

  /* --- 4. BANDA RESERVORIO (#pro-layout-toolbar) -------------------- */
  const bandaPro = document.getElementById("pro-layout-toolbar");
  if (bandaPro) {
    const porId = id => bandaPro.querySelector("#" + id);
    const adoptarPro = (id, legacy, key) => {
      const b = porId(id);
      if (!b) return;
      etiquetar(b, legacy);
      const swap = SWAP_ICONOS[id];
      if (swap) ponerIcono(b, swap.icono);
      mover(b, key);
    };
    adoptarPro("proBtnCenterH", "centerH", "organizar");
    adoptarPro("proBtnCenterV", "centerV", "organizar");
    adoptarPro("proBtnCenterBoth", "centerBoth", "organizar");
    adoptarPro("proBtnDistributeH", "distribute", "organizar");
    adoptarPro("proBtnDistributeV", "distribute", "organizar");
    adoptarPro("proBtnToggleMeasurements", "measurements", "lienzo");
    /* Zoom 100% ya EXISTE en la banda (trae el lector de % y su propio
       onclick): se adopta tal cual, sin tocar su icono ni su etiqueta. */
    adoptarPro("pro-zoom-reset", "zoomReset", "lienzo");
    /* proBtnAlign* (6 direcciones) y proBtnCapa* quedan en el reservorio:
       la cinta ya trae Alinear genérico y Subir/Bajar/Frente/Fondo. */
  }

  /* --- 5. BOTONES NUEVOS: Copiar y Pegar --------------------------- */
  const copiar = crearBoton("copy", "Copiar", "ekko-copiar", "window.copySelected?.()");
  if (copiar) mover(copiar, "portapapeles");
  const pegar = crearBoton("paste", "Pegar", "ekko-pegar", "window.pasteSelected?.()");
  if (pegar) mover(pegar, "portapapeles");

  /* --- 6. ORDEN ESTABLE dentro de cada hogar ------------------------ */
  Object.entries(ORDEN_HOGARES).forEach(([key, selectores]) => {
    const home = g(key);
    if (!home) return;
    selectores.forEach(sel => {
      home.body.querySelectorAll(":scope > " + sel).forEach(n => home.body.appendChild(n));
    });
  });
}

/* ------------------------------------------------------------------ */
/* ARMADO (una sola vez)                                               */
/* ------------------------------------------------------------------ */
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
      const legacy = btn.dataset.fusionBtn || btn.dataset.ekkoCommand || null;
      let key = FORCE_GROUP[btn.id] || (legacy && BY_LEGACY.has(legacy) ? BY_LEGACY.get(legacy).group : null);
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
  });

  GROUPS.forEach(def => body.appendChild(groups.get(def.key).el));
  trailing.forEach(node => body.appendChild(node));

  /* Envoltorio con las flechas de desborde de la BANDA ENTERA (maqueta v3):
     viven FUERA del scroller (.ekko-ribbon-body) para no desplazarse con el
     contenido, igual que #banda-wrap en la maqueta. Cada hogar aparece
     siempre completo; si el conjunto no entra en el ancho, la flecha
     correspondiente se enciende. */
  const wrap = document.createElement("div");
  wrap.className = "ekko-banda-wrap";
  wrap.appendChild(body);
  const flechas = [
    { lado: "izq", titulo: "Hogares hacia la izquierda", delta: -340 },
    { lado: "der", titulo: "Hogares hacia la derecha",   delta: 340 }
  ].map(f => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = CLASE_FLECHA + " " + f.lado;
    b.title = f.titulo;
    b.setAttribute("aria-label", f.titulo);
    b.textContent = f.lado === "izq" ? "\u2039" : "\u203A";
    b.addEventListener("click", () => body.scrollBy({ left: f.delta, behavior: "smooth" }));
    wrap.appendChild(b);
    return b;
  });

  // Arrastrar o rodar la banda también refresca las flechas.
  body.addEventListener("scroll", () => { try { sync(); } catch (_) {} }, { passive: true });

  top.appendChild(wrap);
  top.dataset.ekkoRibbon = "1";
  layout = { top, body, wrap, groups, flechas };
  sync();
  return layout;
}

/* ------------------------------------------------------------------ */
/* SYNC (corre en cada render del renderer)                            */
/* ------------------------------------------------------------------ */
export function sync() {
  const current = build();
  if (!current) return;

  adoptar();

  /* Título dinámico del hogar "trazar" (maqueta): "Trazar" en la pestaña
     Imagen, "Conversión" en el resto. El detectedTab lo escribió el
     renderer en window.EKKO_RIBBON_STATE justo antes de llamar sync. */
  current.groups.forEach((g, key) => {
    const def = g.def;
    if (def && def.tituloPorTab) {
      const estado = window.EKKO_RIBBON_STATE || {};
      const tab = (estado.activeTab && estado.activeTab !== "auto")
        ? estado.activeTab : estado.detectedTab;
      const titulo = def.tituloPorTab[tab] || def.label;
      const span = g.head.querySelector(".ekko-ribbon-group-title");
      if (span && span.textContent !== titulo) span.textContent = titulo;
    }
  });

  /* Hogar sin botones visibles: desaparece del todo (cero huecos muertos). */
  current.groups.forEach(g => {
    if (!g.el.isConnected) return;
    const visible = [...g.body.querySelectorAll("button, .ekko-ribbon-campo, .size-control-group")].some(n =>
      n.style.display !== "none" &&
      !n.classList.contains("ekko-command-hidden") &&
      !n.classList.contains("hidden") &&
      !n.closest('[data-fusion-btn].ekko-command-hidden')
    );
    g.el.classList.toggle("is-empty", !visible);
  });

  /* Flechas de banda: activas solo si el contenido no entra. */
  const body = current.body;
  const overflow = body.scrollWidth > body.clientWidth + 2;
  const max = body.scrollWidth - body.clientWidth;
  const x = body.scrollLeft;
  current.flechas.forEach(b => {
    const lado = b.classList.contains("izq") ? "izq" : "der";
    const activa = overflow && (lado === "izq" ? x > 4 : x < max - 4);
    b.classList.toggle("activa", activa);
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
