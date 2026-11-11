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
/* Ronda 12 (dueño 2026-11-11, rechazo de la R11): el ex grupo "vista" se
   parte en las SECCIONES del modelo Word de una cinta, en orden fijo. Al
   fijar Organizar, la propia cinta muestra estas secciones:
   LIENZO (zoom/reglas/guías/cotas, activo sin selección) · ALINEAR ·
   CENTRAR EN PRODUCTO · DISTRIBUIR · CAPAS · ORGANIZAR (agrupar).
   Con selección aparecen las de objetos con botones activos o GRIS con
   motivo; sin selección solo queda Lienzo (ribbonLayout sync oculta las
   que quedan vacías, así que los botones sin selección van ocultos por
   su propia regla en el motor/manifiesto). */
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
  { key: "organizar",  label: "Organizar" }
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
    /* Las 6 direcciones viven en la cinta de Organizar (Ronda 12) con el
       mismo nombre legacy que el motor ya emite (ENGINE_TO_LEGACY.align).
       Ronda 12: sin selección la sección Alinear NO existe (solo Lienzo) —
       lockWhen falso la esconde en vez de mostrarla gris con el lienzo
       vacío; con selección el motor la habilita (count >= 1). */
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
    /* Ronda 12: sección LIENZO de Organizar. Estas tres son configuración
       del lienzo, no herramientas del objeto: SOLO se ven con Organizar
       fijada (extra) y fuera de esa pestaña se ocultan en vez de mostrarse
       grises (lockWhen falso — mismo patrón que fusion). Sin selección
       quedan activas: pestaña Organizar = lienzo configurable. */
    tool: "zoom", legacy: ["zoom"], family: FAMILY.H, group: "lienzo",
    extra: snap => snap.activeTab === "vista",
    lockWhen: () => false
  },
  {
    tool: "rulers", legacy: ["rulers"], family: FAMILY.H, group: "lienzo",
    extra: snap => snap.activeTab === "vista",
    lockWhen: () => false
  },
  {
    tool: "guides", legacy: ["guides"], family: FAMILY.H, group: "lienzo",
    extra: snap => snap.activeTab === "vista",
    lockWhen: () => false
  },
  { tool: "measurements", legacy: ["measurements"],  family: FAMILY.H, group: "lienzo" },
  {
    /* Ronda 12: CENTRAR EN PRODUCTO. Los tres botones viven en la cinta
       (despachan a los de la banda reservorio). Centrar no opera nada sin
       selección y solo tiene sentido dentro de Organizar: la regla es la
       dos condiciones juntas. */
    tool: null,
    legacy: ["centerH", "centerV", "centerBoth"],
    family: FAMILY.H,
    group: "centrar",
    rule: snap => !!snap.hasSelection && snap.activeTab === "vista",
    reason: "Seleccioná al menos un objeto para centrar en el producto"
  },
  {
    /* Ronda 12: reinicio de zoom al 100% en la sección Lienzo. */
    tool: null,
    legacy: ["zoomReset"],
    family: FAMILY.H,
    group: "lienzo",
    rule: snap => snap.activeTab === "vista"
  },

  /* --- P: orden obligado. Se ven, pero bloqueadas con el motivo. --- */
  {
    tool: "group", family: FAMILY.P, group: "organizar", legacy: ["group"],
    tabBypass: true,
    /* Ronda 12: sin selección la sección Organizar no existe (solo Lienzo). */
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
    /* Ronda 12: Distribuir es sección de Organizar; también alcanza en
       Varios (multiple.tools lo declara). Ya no bypasea: en Vector no
       aparece (la pestaña lo recorta). Sin selección la sección no existe. */
    /* capabilities.js lo habilita con 2, pero distributeSpacing() pide 3 y
       con 2 el botón salía, se apretaba y no hacía nada. La regla fina va
       aca, sin tocar capabilities (capa de objetos). */
    extra: snap => (snap.summary ? snap.summary.count : 0) >= 3,
    lockWhen: snap => snap.hasSelection,
    reason: "Seleccioná 3 o más objetos para distribuir el espacio"
  },
  {
    tool: "fusion", family: FAMILY.P, group: "estructura", legacy: ["fusion"],
    reason: "Fusionar necesita 1 imagen y 1 vector a la vez: la imagen aporta el relleno y el vector la máscara",
    /* REGLA DEL DUEÑO (2026-11-11): la fusión es SOLO 1 vector + 1 imagen,
       NUNCA con más. Con la selección exacta el motor la habilita (botón
       activo); con CUALQUIER otra cosa (solo imagen, 2 vectores, 2 rasters,
       3+ objetos) el botón no tiene nada que ver con lo seleccionado y SE
       OCULTA: la familia P no lo muestra bloqueado "enseñando" una fusión
       que esa selección nunca va a poder hacer. lockWhen es la puerta del
       estado bloqueado y acá queda en falso: o va habilitado (par exacto) o
       no se ve (medido en runtime: 2 vectores mostraba el botón bloqueado). */
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
