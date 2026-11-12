/* =========================================================================
   EKKO STUDIO — MANIFIESTO DE HERRAMIENTAS (Fase 0 · contrato)

   Este archivo es la ÚNICA declaracion de presentacion de los botones de
   las dos superficies (#topBar y #contextual-toolbar).

   REGLA DE ORO DE ESTA CAPA: el manifiesto NO decide nada por su cuenta.
   Solo declara:
     - a que HERRAMIENTA del motor corresponde (importada de capabilities.js)
     - en que GRUPO del ribbon vive
     - que FAMILIA es (H / P / E) y por lo tanto como se comporta la UI
     - el MOTIVO que se le muestra al cliente si esta bloqueada

   La regla de si la herramienta esta habilitada o no la sigue poniendo
   capabilities.js (TOOLS + describeSelection). Aca jamas se duplica logica
   de negocio: si hace falta una precondicion nueva, se agrega a capabilities.

   FAMILIAS:
     H — Orden libre (conmutativa)  -> siempre visible y habilitado.
     P — Orden obligado (typestate) -> VISIBLE PERO BLOQUEADA con motivo en
         el tooltip, en vez de desaparecer: enseña la pirámide y la barra no salta.
     E — Máquina de estados         -> el slot MUTA (Quitar Fondo -> Editar
         Fondo). El botón no aparece ni desaparece: cambia de identidad.
   ========================================================================= */

import { TABS, SPECIES } from "../capabilities.js";

export const FAMILY = Object.freeze({ H: "H", P: "P", E: "E" });

/**
 * GRUPOS del ribbon. El orden de este array es el orden visual de la cinta.
 * Fase 2 (ribbon) usa `label` para el titulo colapsable; en Fase 0/1 el grupo
 * solo ordena.
 */
/* Ronda 14 (merge sobre el modelo always del dueño 2026-11-12): ya NO hay
   pestaña "vista" — el dueño la eliminó de TABS. Las secciones de abajo
   (Lienzo · Alinear · Centrar · Distribuir · Capas · Agrupar) viven
   directamente en la cinta de Inicio: las de lienzo (zoom/reglas/guías/
   cotas) son siempre visibles porque ahora son herramientas `always`; las
   de objetos piden selección y se ocultan solas cuando quedan vacías. */
export const GROUPS = Object.freeze([
  { key: "creacion",   label: "Crear" },
  { key: "fondo",      label: "Imagen" },
  { key: "texto",      label: "Texto" },
  { key: "estructura", label: "Estructura" },
  { key: "geometria",  label: "Geometría" },
  { key: "composicion",label: "Composición" },
  { key: "booleanas",  label: "Booleanas" },
  { key: "lienzo",     label: "Lienzo" },
  { key: "alinear",    label: "Alinear" },
  { key: "centrar",    label: "Centrar en producto" },
  { key: "distribuir", label: "Distribuir" },
  { key: "capas",      label: "Capas" },
  { key: "organizar",  label: "Agrupar" }
]);

/**
 * MAPA DE PESTAÑAS POR HERRAMIENTA.
 * Se invierte TABS en vez de declararlo a mano: si mañana agregás una
 * herramienta a una pestaña en capabilities.js, este motor la sigue sola.
 */
const TABS_OF_TOOL = (() => {
  const map = new Map();
  Object.values(TABS).forEach(tab => {
    (tab.tools || []).forEach(tool => {
      if (!map.has(tool)) map.set(tool, new Set());
      map.get(tool).add(tab.id);
    });
  });
  return map;
})();

/** Pestañas en las que la herramienta tiene sentido, o null si no está en TABS. */
export function tabsOfTool(tool) {
  const set = TABS_OF_TOOL.get(tool);
  return set ? [...set] : null;
}

/** ¿La herramienta pertenece al grupo base (siempre disponible)? */
export function isBaseTool(tool) {
  return (TABS.base?.tools || []).includes(tool);
}

/* =========================================================================
   BOTONES. `legacy` son los valores de data-fusion-btn que existen hoy en el
   HTML. Un botón puede declarar varios (las cuatro booleanas son UNA
   herramienta: "boolean").
   ========================================================================= */
export const BUTTONS = Object.freeze([
  /* --- H: orden libre. Nunca saltan. --- */
  { tool: "delete",       legacy: ["delete"],        family: FAMILY.H, group: "composicion" },
  { tool: "duplicate",    legacy: ["duplicate"],     family: FAMILY.H, group: "composicion" },
  { tool: "copy",         legacy: ["copy"],          family: FAMILY.H, group: "composicion" },
  { tool: "paste",        legacy: ["paste"],         family: FAMILY.H, group: "composicion" },
  { tool: "bringForward", legacy: ["bringForward"],  family: FAMILY.H, group: "composicion" },
  { tool: "sendBackward", legacy: ["sendBackward"],  family: FAMILY.H, group: "composicion" },
  { tool: "toFront",      legacy: ["toFront"],       family: FAMILY.H, group: "composicion" },
  { tool: "toBack",       legacy: ["toBack"],        family: FAMILY.H, group: "composicion" },
  { tool: "rotate",       legacy: ["rotate"],        family: FAMILY.H, group: "composicion" },
  { tool: "flip",         legacy: ["flip", "flipH", "flipV"], family: FAMILY.H, group: "composicion" },
  { tool: "size",         legacy: ["size"],          family: FAMILY.H, group: "organizar" },
  {
    tool: "align", family: FAMILY.H, group: "alinear",
    /* Ronda 14: la herramienta es `always` en el motor; el botón genérico
       "Alinear" volvió al HTML (lo restauró el dueño) y despacha
       window.alignSelection() sin dirección. Con selección se habilita;
       sin selección el chip lockWhen falso no se ve (la familia H no
       enseña grises: la regla es el propio motor, count >= 1). */
    legacy: ["align", "alignLeft", "alignCenterX", "alignRight", "alignTop", "alignCenterY", "alignBottom"],
    extra: snap => snap.hasSelection,
    lockWhen: snap => snap.hasSelection,
    reason: "Seleccioná al menos un objeto para alinear"
  },
  { tool: "bringForward", legacy: ["bringForward"],  family: FAMILY.H, group: "capas" },
  { tool: "sendBackward", legacy: ["sendBackward"],  family: FAMILY.H, group: "capas" },
  { tool: "toFront",      legacy: ["toFront"],       family: FAMILY.H, group: "capas" },
  { tool: "toBack",       legacy: ["toBack"],        family: FAMILY.H, group: "capas" },
  {
    /* Ronda 14: son configuración del LIENZO y ahora `always` en el motor
       (modelo del dueño 2026-11-12): se ven en cualquier pestaña, con o sin
       selección. La gate de "vista" que las ataba a la pestaña Organizar
       murió con esa pestaña — sin este cambio quedarían ocultas para
       siempre. */
    tool: "zoom", legacy: ["zoom"], family: FAMILY.H, group: "lienzo",
    lockWhen: () => false
  },
  {
    tool: "rulers", legacy: ["rulers"], family: FAMILY.H, group: "lienzo",
    lockWhen: () => false
  },
  {
    tool: "guides", legacy: ["guides"], family: FAMILY.H, group: "lienzo",
    lockWhen: () => false
  },
  { tool: "measurements", legacy: ["measurements"],  family: FAMILY.H, group: "lienzo" },
  {
    /* Ronda 14: los tres botones viven en la banda reservorio
       (#pro-layout-toolbar, la crea panelCommandBridge.js). Centrar no
       opera nada sin selección; ya no depende de la pestaña Organizar
       (eliminada por el dueño). */
    tool: null,
    legacy: ["centerH", "centerV", "centerBoth"],
    family: FAMILY.H,
    group: "centrar",
    rule: snap => !!snap.hasSelection,
    reason: "Seleccioná al menos un objeto para centrar en el producto"
  },
  {
    /* Ronda 14: reinicio de zoom al 100%, sección Lienzo. Siempre disponible
       (antes pedía Organizar fijada; esa pestaña ya no existe). */
    tool: null,
    legacy: ["zoomReset"],
    family: FAMILY.H,
    group: "lienzo",
    rule: () => true
  },

  /* --- P: orden obligado. Se ven, pero bloqueadas con el motivo. --- */
  {
    tool: "group", family: FAMILY.P, group: "organizar", legacy: ["group"],
    tabBypass: true,
    /* Ronda 14: grupo "Agrupar" en la cinta; sin selección queda oculto
       porque el chip no se ve con lockWhen falso. */
    lockWhen: snap => snap.hasSelection,
    reason: "Seleccioná al menos 2 objetos para agrupar"
  },
  {
    tool: "ungroup", family: FAMILY.P, group: "organizar", legacy: ["ungroup"],
    /* Es estructural: un grupo seleccionado se desagrupa aunque la pestaña
       activa sea Vector. Mientras capabilities.js no agregue `ungroup` a
       TABS.vector, esta bandera evita que la pestaña lo esconda. */
    tabBypass: true,
    lockWhen: snap => snap.hasSelection,
    reason: "Seleccioná un grupo para desagruparlo"
  },
  {
    tool: "decomposeVector", family: FAMILY.P, group: "estructura", legacy: ["decomposeVector"],
    tabBypass: true,
    reason: "Primero desagrupá: un grupo mixto hay que abrirlo para saber con qué se trabaja"
  },
  {
    tool: "distribute", family: FAMILY.P, group: "distribuir",
    legacy: ["distribute", "distributeH", "distributeV"],
    /* Ronda 14: Distribuir es sección propia de la cinta; también está en
       Varios (multiple.tools lo declara). Ya no bypasea: en Vector no
       aparece (la pestaña lo recorta). Sin selección no se ve. */
    /* capabilities.js lo habilita con 2, pero distributeSpacing() pide 3 y
       con 2 el botón salía, se apretaba y no hacía nada. La regla fina va
       aca, sin tocar capabilities (capa de objetos). */
    extra: snap => (snap.summary ? snap.summary.count : 0) >= 3,
    lockWhen: snap => snap.hasSelection,
    reason: "Seleccioná 3 o más objetos para distribuir el espacio"
  },
  {
    tool: "fusion", family: FAMILY.P, group: "estructura", legacy: ["fusion"],
    reason: "Fusionar necesita imagen y vector: la imagen aporta el relleno y el vector la máscara",
    /* REGLA DEL DUEÑO, RELAJADA (2026-11-12): basta >=1 raster + >=1 vector
       (2 imagenes + 1 vector SÍ fusiona; ya no exige el par exacto 1+1).
       El motor decide: activo con la selección válida; con cualquier otra
       cosa (solo imagen, solo vectores, 1 objeto) lockWhen falso lo OCULTA
       — la familia P no muestra bloqueado lo que la selección nunca va a
       poder hacer. */
    lockWhen: () => false
  },
  {
    tool: "editNodes", family: FAMILY.P, group: "geometria", legacy: ["editNodes"],
    /* Regla que antes vivía en contextualMenu.js (y pisaba al motor): los
       nodos no se editan sobre un Group ni sobre un SymbolItem. */
    extra: snap => {
      const owner = snap.summary && snap.summary.list[0] && snap.summary.list[0].owner;
      if (!owner) return false;
      return owner.className !== "Group" && owner.className !== "SymbolItem" && owner.className !== "PlacedSymbol";
    },
    reason: "Los nodos se editan sobre un vector cerrado, no sobre un grupo ni un símbolo"
  },
  {
    tool: "cutSegment", family: FAMILY.P, group: "geometria", legacy: ["cutSegment"],
    reason: "La tijera corta trazos: seleccioná al menos un vector"
  },
  {
    tool: "outline", family: FAMILY.P, group: "geometria", legacy: ["outline"],
    reason: "Contorno necesita al menos un objeto de imagen, vector o texto"
  },
  {
    tool: "audit", family: FAMILY.P, group: "geometria", legacy: ["audit"],
    reason: "La auditoría revisa vectores: seleccioná al menos uno"
  },
  {
    tool: "traceImage", family: FAMILY.P, group: "fondo", legacy: ["traceImage"],
    reason: "Trazar convierte una imagen en vector: seleccioná una imagen"
  },

  /* --- Herramientas que capabilities.js NO declara (no son "especie" sino
     una acción de interfaz). Se rigen por una `rule` propia declarada ACÁ.
     La interfaz no decide: solo ejecuta lo que el manifiesto dice. --- */
  {
    tool: null,
    legacy: ["curvar"],
    family: FAMILY.P,
    group: "texto",
    rule: snap => {
      const s = snap.summary;
      return !!s && s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.TEXT);
    },
    reason: "Curvar se aplica sobre un texto seleccionado"
  },

  /* --- Botones de la BARRA EMERGENTE que son acciones de interfaz (sin
     herramienta del motor). La regla se declara ACÁ y el renderer la
     ejecuta; el clic lo siguen resolviendo los manejadores de siempre.
     El contrato solo decide VISIBILIDAD (regla falla -> oculto, familia H). --- */
  {
    tool: null,
    legacy: ["ctxDelete", "ctxDuplicate", "ctxScaleDown", "ctxScaleUp",
             "ctxToFront", "ctxForward", "ctxBackward", "ctxToBack"],
    family: FAMILY.H,
    group: "composicion",
    rule: snap => !!snap.hasSelection,
    reason: "Seleccioná al menos un objeto"
  },
  {
    tool: null,
    legacy: ["ctxBold", "ctxItalic", "ctxUnderline", "ctxWeld", "ctxRotateLetters"],
    family: FAMILY.H,
    group: "texto",
    rule: snap => {
      const s = snap.summary;
      return !!s && s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.TEXT);
    },
    reason: "Los controles de texto piden un único texto seleccionado"
  },
  {
    tool: null,
    legacy: ["ctxDeleteNode", "ctxExitNodeEdit"],
    family: FAMILY.H,
    group: "geometria",
    rule: () => window.nodeEditMode === true,
    reason: "Entrá al modo Editar Nodos para usar estos botones"
  },

  /* --- E: máquina de estados. El slot muta, no aparece ni desaparece. --- */
  { tool: "removeBg",        legacy: ["removeBg"],        family: FAMILY.E, group: "fondo" },
  { tool: "editCutout",      legacy: ["editCutout"],      family: FAMILY.E, group: "fondo" },
  { tool: "unfusion",        legacy: ["unfusion"],        family: FAMILY.E, group: "estructura" },
  { tool: "editFusionImage", legacy: ["editFusionImage"], family: FAMILY.E, group: "estructura" },
  { tool: "textToVector",    legacy: ["textToVector"],    family: FAMILY.E, group: "texto" },
  { tool: "calado",          legacy: ["calado"],          family: FAMILY.E, group: "geometria" },
  { tool: "rellenar",        legacy: ["rellenar"],        family: FAMILY.E, group: "geometria" },
  { tool: "solidHole",       legacy: ["solidHole"],       family: FAMILY.E, group: "geometria" },

  /* Las booleanas son UNA herramienta del motor ("boolean") con cuatro
     superficies de resultado. El mismo motivo sirve para las cuatro. */
  {
    tool: "boolean", family: FAMILY.P, group: "booleanas", tabBypass: true,
    legacy: ["booleanUnion", "booleanSubtract", "booleanIntersect", "booleanDifference"],
    reason: "Las booleanas necesitan 2 vectores sólidos seleccionados"
  }
]);

/* Índice legacy -> entrada, para que el renderer encuentre el manifiesto de
   cualquier botón por su data-fusion-btn actual. */
export const BY_LEGACY = (() => {
  const map = new Map();
  BUTTONS.forEach(entry => (entry.legacy || []).forEach(name => map.set(name, entry)));
  return map;
})();

if (typeof window !== "undefined") {
  window.EKKO_TOOLBAR_MANIFEST = Object.freeze({ FAMILY, GROUPS, BUTTONS, tabsOfTool, isBaseTool });
}
