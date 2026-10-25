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
export const GROUPS = Object.freeze([
  { key: "creacion",   label: "Crear" },
  { key: "fondo",      label: "Imagen" },
  { key: "texto",      label: "Texto" },
  { key: "estructura", label: "Estructura" },
  { key: "geometria",  label: "Geometría" },
  { key: "composicion",label: "Composición" },
  { key: "booleanas",  label: "Booleanas" },
  { key: "vista",      label: "Vista" }
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
  { tool: "size",         legacy: ["size"],          family: FAMILY.H, group: "composicion" },
  {
    tool: "align", legacy: ["align"], family: FAMILY.H, group: "composicion",
    /* El motor la declara `always`, asi que sin seleccion habilitada; pero
       alinearse sin nada seleccionado avisa y no hace nada. Mejor: bloqueada
       con el motivo. */
    extra: snap => snap.hasSelection,
    reason: "Seleccioná al menos un objeto para alinear"
  },
  { tool: "zoom",         legacy: ["zoom"],          family: FAMILY.H, group: "vista" },
  { tool: "rulers",       legacy: ["rulers"],        family: FAMILY.H, group: "vista" },
  { tool: "guides",       legacy: ["guides"],        family: FAMILY.H, group: "vista" },
  { tool: "measurements", legacy: ["measurements"],  family: FAMILY.H, group: "vista" },

  /* --- P: orden obligado. Se ven, pero bloqueadas con el motivo. --- */
  {
    tool: "group", family: FAMILY.P, group: "estructura", legacy: ["group"],
    tabBypass: true,
    reason: "Seleccioná al menos 2 objetos para agrupar"
  },
  {
    tool: "ungroup", family: FAMILY.P, group: "estructura", legacy: ["ungroup"],
    /* Es estructural: un grupo seleccionado se desagrupa aunque la pestaña
       activa sea Vector. Mientras capabilities.js no agregue `ungroup` a
       TABS.vector, esta bandera evita que la pestaña lo esconda. */
    tabBypass: true,
    reason: "Seleccioná un grupo para desagruparlo"
  },
  {
    tool: "decomposeVector", family: FAMILY.P, group: "estructura", legacy: ["decomposeVector"],
    tabBypass: true,
    reason: "Primero desagrupá: un grupo mixto hay que abrirlo para saber con qué se trabaja"
  },
  {
    tool: "distribute", family: FAMILY.P, group: "composicion", legacy: ["distribute"],
    tabBypass: true,
    /* capabilities.js lo habilita con 2, pero distributeSpacing() pide 3 y
       con 2 el botón salía, se apretaba y no hacía nada. La regla fina va
       aca, sin tocar capabilities (capa de objetos). */
    extra: snap => (snap.summary ? snap.summary.count : 0) >= 3,
    reason: "Seleccioná 3 o más objetos para distribuir el espacio"
  },
  {
    tool: "fusion", family: FAMILY.P, group: "estructura", legacy: ["fusion"],
    reason: "Fusionar necesita 1 imagen y 1 vector a la vez: la imagen aporta el relleno y el vector la máscara"
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
    tool: "outline", family: FAMILY.P, group: "geometria", legacy: ["outline"],
    reason: "Seleccioná un solo objeto para darle contorno"
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
