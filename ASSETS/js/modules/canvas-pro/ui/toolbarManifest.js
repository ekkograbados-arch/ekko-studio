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
 * HOGARES del panel superior tipo CAD (dueño, maqueta v3 aprobada).
 * El orden de este array es el orden visual de la banda. Cada hogar tiene
 * TITULO ABAJO y altura uniforme (el CSS de ekko-ribbon.css la clava a 96px).
 * Un botón vive en UN hogar; la pestaña activa decide cuáles se ven
 * (tabAllows en toolbarStore.js + TABS en capabilities.js).
 *
 * Correspondencia con la maqueta:
 *   INICIO   -> CREAR
 *   EDICIÓN  -> TAMAÑO · ORGANIZAR · PORTAPAPELES · LIENZO
 *   IMAGEN   -> TAMAÑO · IMAGEN · TRAZAR/CONVERSIÓN
 *   VECTOR   -> TAMAÑO · VECTOR · FUSIÓN · HUECOS · BOOLEANAS · TRAZAR/CONVERSIÓN
 *   TEXTO    -> TAMAÑO · TIPOGRAFÍA · CURVAR Y ESPACIAR · TRAZAR/CONVERSIÓN
 *   VARIOS   -> TAMAÑO · ORGANIZAR · IMAGEN · BOOLEANAS · TRAZAR/CONVERSIÓN
 * El hogar "trazar" cambia de título: "Trazar" en Imagen, "Conversión" en el
 * resto (ribbonLayout.js lo reescribe en cada sync).
 */
export const GROUPS = Object.freeze([
  { key: "creacion",     label: "Crear",              modo: "grandes" },
  { key: "tamano",       label: "Tamaño" },
  { key: "organizar",    label: "Organizar" },
  { key: "portapapeles", label: "Portapapeles" },
  { key: "lienzo",       label: "Lienzo" },
  { key: "imagen",       label: "Imagen" },
  { key: "trazar",       label: "Conversión",         tituloPorTab: { image: "Trazar" } },
  { key: "vector",       label: "Vector" },
  { key: "fusion",       label: "Fusión" },
  { key: "huecos",       label: "Huecos" },
  { key: "booleanas",    label: "Booleanas" },
  { key: "texto",        label: "Tipografía" },
  { key: "curvar",       label: "Curvar y espaciar" }
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
  /* PORTAPAPELES (maqueta): Duplicar · Copiar · Pegar · Eliminar */
  { tool: "delete",       legacy: ["delete"],        family: FAMILY.H, group: "portapapeles" },
  { tool: "duplicate",    legacy: ["duplicate"],     family: FAMILY.H, group: "portapapeles" },
  { tool: "copy",         legacy: ["copy"],          family: FAMILY.H, group: "portapapeles" },
  { tool: "paste",        legacy: ["paste"],         family: FAMILY.H, group: "portapapeles" },
  /* ORGANIZAR (maqueta): alinear direcciones · centrar · distribuir ·
     voltear · capas · agrupar. Ronda 15: los grupos alinear/centrar/
     distribuir/capas/organizar viejos se fusionan en UN solo hogar. */
  { tool: "bringForward", legacy: ["bringForward"],  family: FAMILY.H, group: "organizar" },
  { tool: "sendBackward", legacy: ["sendBackward"],  family: FAMILY.H, group: "organizar" },
  { tool: "toFront",      legacy: ["toFront"],       family: FAMILY.H, group: "organizar" },
  { tool: "toBack",       legacy: ["toBack"],        family: FAMILY.H, group: "organizar" },
  { tool: "rotate",       legacy: ["rotate"],        family: FAMILY.H, group: "organizar" },
  { tool: "flip",         legacy: ["flip", "flipH", "flipV"], family: FAMILY.H, group: "organizar" },
  {
    /* TAMAÑO (maqueta): el hogar con los campos de la caja de selección
       (Ancho/Alto/Rotación/Candado). El contenedor `.size-control-group`
       lleva data-fusion-btn="size" (lo adopta hogaresCad/ribbonLayout) y
       su regla fina pide selección: sin nada seleccionado el hogar se va,
       porque no hay caja que medir. */
    tool: "size", legacy: ["size"], family: FAMILY.H, group: "tamano",
    rule: snap => !!snap.hasSelection
  },
  {
    tool: "align", family: FAMILY.H, group: "organizar",
    /* Ronda 14: la herramienta es `always` en el motor; el botón genérico
       "Alinear" volvió al HTML (lo restauró el dueño) y despacha
       window.alignSelection() sin dirección. Ronda 15: con el modelo GRIS
       CON MOTIVO se ve APAGADO con motivo cuando no hay selección, en vez
       de desaparecer (maqueta: hogar Organizar siempre visible). */
    legacy: ["align", "alignLeft", "alignCenterX", "alignRight", "alignTop", "alignCenterY", "alignBottom"],
    extra: snap => snap.hasSelection,
    reason: "Seleccioná al menos un objeto para alinear"
  },
  {
    /* Ronda 15: Reglas/Guías/Cotas son configuración del LIENZO y son
       `always` en el motor. Con el modelo CAD su hogar vive en la pestaña
       EDICIÓN (siempre presente), no en Inicio: Inicio es SOLO Crear. */
    tool: "zoom", legacy: ["zoom"], family: FAMILY.H, group: "lienzo"
  },
  {
    tool: "rulers", legacy: ["rulers"], family: FAMILY.H, group: "lienzo"
  },
  {
    tool: "guides", legacy: ["guides"], family: FAMILY.H, group: "lienzo"
  },
  { tool: "measurements", legacy: ["measurements"],  family: FAMILY.H, group: "lienzo" },
  {
    /* Ronda 15: los tres botones viven en la banda reservorio
       (#pro-layout-toolbar) y hogaresCad los ADOPTA al hogar Organizar.
       tool "centrar" (capabilities, always): la pestaña lo recorta a
       Edición/Varios y, sin selección, se ve APAGADO con motivo. */
    tool: "centrar",
    legacy: ["centerH", "centerV", "centerBoth"],
    family: FAMILY.H,
    group: "organizar",
    rule: snap => !!snap.hasSelection,
    reason: "Seleccioná al menos un objeto para centrar en el producto"
  },
  {
    /* Ronda 15: reinicio de zoom al 100%, hogar Lienzo (Edición). Se rige
       por la herramienta `zoom` (a la que acompaña) para que INICIO siga
       siendo SOLO Crear: el hogar Lienzo no asoma ahí. El botón vive en la
       banda reservorio (#pro-zoom-reset) y hogaresCad lo ADOPTA. */
    tool: "zoom",
    legacy: ["zoomReset"],
    family: FAMILY.H,
    group: "lienzo"
  },

  /* --- P: orden obligado. GRIS CON MOTIVO (Ronda 15, maqueta v3): en su
     pestaña se VEN apagados con el motivo en el tooltip, nunca desaparecen.
     El renderer (ribbonRenderer.decide) aplica la política. --- */
  {
    tool: "group", family: FAMILY.P, group: "organizar", legacy: ["group"],
    tabBypass: true,
    reason: "Seleccioná al menos 2 objetos para agrupar"
  },
  {
    tool: "ungroup", family: FAMILY.P, group: "organizar", legacy: ["ungroup"],
    /* Es estructural: un grupo seleccionado se desagrupa aunque la pestaña
       activa sea Vector. Mientras capabilities.js no agregue `ungroup` a
       TABS.vector, esta bandera evita que la pestaña lo esconda. */
    tabBypass: true,
    reason: "Seleccioná un grupo para desagruparlo"
  },
  {
    tool: "decomposeVector", family: FAMILY.P, group: "vector", legacy: ["decomposeVector"],
    tabBypass: true,
    reason: "Primero desagrupá: un grupo mixto hay que abrirlo para saber con qué se trabaja"
  },
  {
    tool: "distribute", family: FAMILY.P, group: "organizar",
    legacy: ["distribute", "distributeH", "distributeV"],
    /* capabilities.js lo habilita con 2, pero distributeSpacing() pide 3 y
       con 2 el botón salía, se apretaba y no hacía nada. La regla fina va
       acá, sin tocar capabilities (capa de objetos). */
    extra: snap => (snap.summary ? snap.summary.count : 0) >= 3,
    reason: "Seleccioná 3 o más objetos para distribuir el espacio"
  },
  {
    tool: "fusion", family: FAMILY.P, group: "fusion", legacy: ["fusion"],
    reason: "Fusionar necesita imagen y vector: la imagen aporta el relleno y el vector la máscara"
    /* Ronda 15 GRIS CON MOTIVO: con la maqueta aprobada, Fusionar se VE
       apagado con su motivo en la pestaña Vector (y en Imagen) cuando la
       selección no alcanza; el renderer ya no oculta a la familia P. */
  },
  {
    tool: "editNodes", family: FAMILY.P, group: "vector", legacy: ["editNodes"],
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
    tool: "cutSegment", family: FAMILY.P, group: "vector", legacy: ["cutSegment"],
    reason: "La tijera corta trazos: seleccioná al menos un vector"
  },
  {
    tool: "outline", family: FAMILY.P, group: "trazar", legacy: ["outline"],
    reason: "Contorno necesita al menos un objeto de imagen, vector o texto"
  },
  {
    tool: "audit", family: FAMILY.P, group: "vector", legacy: ["audit"],
    reason: "La auditoría revisa vectores: seleccioná al menos uno"
  },
  {
    tool: "traceImage", family: FAMILY.P, group: "trazar", legacy: ["traceImage"],
    reason: "Trazar convierte una imagen en vector: seleccioná una imagen"
  },

  /* --- Campos de la CAJA DE SELECCIÓN y controles de TEXTO que no son
     botones: contenedores/inputs con data-fusion-btn propio que el renderer
     gobierna igual que un botón (hogaresCad los envuelve en spans). --- */
  {
    tool: null, legacy: ["campoFuente", "campoTamanoFuente"],
    family: FAMILY.H, group: "texto",
    rule: snap => {
      const s = snap.summary;
      return !!s && s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.TEXT);
    }
  },
  {
    tool: null, legacy: ["campoCurvatura", "campoRadio", "campoEspaciado"],
    family: FAMILY.H, group: "curvar",
    rule: snap => {
      const s = snap.summary;
      return !!s && s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.TEXT);
    }
  },

  /* --- Herramientas que capabilities.js NO declara (no son "especie" sino
     una acción de interfaz). Se rigen por una `rule` propia declarada ACÁ.
     La interfaz no decide: solo ejecuta lo que el manifiesto dice. --- */
  {
    tool: null,
    legacy: ["curvar"],
    family: FAMILY.P,
    group: "curvar",
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
    group: "portapapeles",
    rule: snap => !!snap.hasSelection,
    reason: "Seleccioná al menos un objeto"
  },
  {
    tool: null,
    legacy: ["ctxBold", "ctxItalic", "ctxUnderline"],
    family: FAMILY.H,
    group: "texto",
    rule: snap => {
      const s = snap.summary;
      return !!s && s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.TEXT);
    },
    reason: "Los controles de texto piden un único texto seleccionado"
  },
  {
    /* Soldar y Girar letras: viven en el hogar CURVAR Y ESPACIAR (maqueta). */
    tool: null,
    legacy: ["ctxWeld", "ctxRotateLetters"],
    family: FAMILY.H,
    group: "curvar",
    rule: snap => {
      const s = snap.summary;
      return !!s && s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.TEXT);
    },
    reason: "El soldado y la orientación de letras piden un único texto seleccionado"
  },
  {
    tool: null,
    legacy: ["ctxDeleteNode", "ctxExitNodeEdit"],
    family: FAMILY.H,
    group: "vector",
    rule: () => window.nodeEditMode === true,
    reason: "Entrá al modo Editar Nodos para usar estos botones"
  },

  /* --- E: máquina de estados. El slot muta, no aparece ni desaparece. --- */
  { tool: "removeBg",        legacy: ["removeBg"],        family: FAMILY.E, group: "imagen" },
  { tool: "editCutout",      legacy: ["editCutout"],      family: FAMILY.E, group: "imagen" },
  { tool: "unfusion",        legacy: ["unfusion"],        family: FAMILY.E, group: "fusion" },
  { tool: "editFusionImage", legacy: ["editFusionImage"], family: FAMILY.E, group: "fusion" },
  { tool: "textToVector",    legacy: ["textToVector"],    family: FAMILY.E, group: "trazar" },
  { tool: "calado",          legacy: ["calado"],          family: FAMILY.E, group: "huecos" },
  { tool: "rellenar",        legacy: ["rellenar"],        family: FAMILY.E, group: "huecos" },
  { tool: "solidHole",       legacy: ["solidHole"],       family: FAMILY.E, group: "huecos" },

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
