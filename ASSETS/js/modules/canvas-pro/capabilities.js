import { semanticKind, VECTOR_KIND, isCutLine } from "./vectorSemantics.js";
import { getPublicOwner, isMockupOrMask, isContainmentWrapper } from "./designGeometry.js";

/* =========================================================================
   EKKO STUDIO — MOTOR DE CAPACIDADES (v1.0)

   Fuente UNICA de verdad para decidir que herramientas se muestran.

   Antes habia dos decididores que se pisaban entre si:
     - canvasControlsIntegration.resolveButtonSet()  (tabla de casos fijos)
     - panelCommandBridge.classifySelection()       (Calado/Rellenar sueltos)
   y getSelectionTypes() no distinguia un vector SOLIDO de un HUECO, por lo
   que Calar y Rellenar nunca se decidian bien.

   Aqui cada herramienta DECLARA que especies y que roles soporta, y la barra
   muestra un boton solo si TODOS los objetos seleccionados lo soportan.
   Es el mismo criterio de AutoCAD, Word y Canva: nada de casos fijos.
   ========================================================================= */

export const SPECIES = Object.freeze({
  RASTER: "raster",
  VECTOR: "vector",
  LINE: "line",
  TEXT: "text",
  GROUP: "group",
  FUSION: "fusion"
});

export const ROLE = Object.freeze({
  SOLID: VECTOR_KIND.SOLID,
  HOLE: VECTOR_KIND.HOLE,
  CUTLINE: "cutline",
  NEUTRAL: "neutral"
});

const VECTOR_CLASSES = ["Path", "CompoundPath", "Shape", "PlacedSymbol", "SymbolItem"];

function ownerOf(item) {
  try { return getPublicOwner(item) || item; } catch (_) { return item; }
}

/**
 * Especie del objeto: de donde viene, no como se ve. Un CompoundPath puede
 * ser un relleno o una linea de corte; la especie es "vector" y el rol
 * dice lo de relleno/hueco.
 */
export function speciesOf(item) {
  const owner = ownerOf(item);
  if (!owner) return null;
  const data = owner.data || {};
  if (data.isSmartFusion) return SPECIES.FUSION;
  if (data.isText || data.isCurvedGroup || data.isSpacedGroup || owner.className === "PointText") {
    return SPECIES.TEXT;
  }
  if (owner.className === "Group") return SPECIES.GROUP;
  if (owner.className === "Raster") return SPECIES.RASTER;
  if (VECTOR_CLASSES.includes(owner.className)) {
    return isCutLine(owner) ? SPECIES.LINE : SPECIES.VECTOR;
  }
  return null;
}

/** Papel fisico: lo que hace el laser con esta pieza. */
export function roleOf(item) {
  const owner = ownerOf(item);
  if (!owner) return ROLE.NEUTRAL;
  if (isCutLine(owner)) return ROLE.CUTLINE;
  try {
    const kind = semanticKind(owner);
    if (kind === VECTOR_KIND.HOLE) return ROLE.HOLE;
    if (kind === VECTOR_KIND.SOLID) return ROLE.SOLID;
  } catch (_) {}
  return ROLE.NEUTRAL;
}

/** Un grupo estructural aporta vectores si todos sus descendientes de diseno
 *  son vectores o lineas (sin imagen ni texto). Asi un SVG recien importado
 *  ofrece Descomponer aunque su raiz sea un Group. */
function groupHasOnlyVectorish(owner) {
  if (!owner || owner.className !== "Group") return false;
  let vectorish = 0;
  let invalido = false;
  const visit = node => {
    if (!node || invalido) return;
    const data = node.data || {};
    if (data.mockup || data.isMask || data.wasClipMask || node.clipMask ||
        data.isSelectionBox || data.isHandle || data.isMeasurement ||
        data.isSmartGuide || data.isNodeEditOverlay || data.isTracePreview) return;
    if (node.className === "Raster" || node.className === "PointText" ||
        data.isText || data.isCurvedGroup || data.isSpacedGroup) {
      // Una imagen o un texto adentro: primero Desagrupar, despues se
      // seleccionan los vectores sueltos y se descomponen.
      invalido = true;
      return;
    }
    if (["Path", "CompoundPath", "Shape"].includes(node.className)) vectorish++;
    (node.children || []).forEach(visit);
  };
  visit(owner);
  return !invalido && vectorish > 0;
}

export function isProductElement(item) {
  const owner = ownerOf(item);
  if (!owner) return true;
  try {
    if (isMockupOrMask(owner)) return true;
    if (isContainmentWrapper(owner)) return true;
  } catch (_) {}
  return owner === window.currentMockup || owner === window.clipMask;
}

/** Desglose de una seleccion, listo para decidir. */
export function describeSelection(selection) {
  const list = (Array.isArray(selection) ? selection : [])
    .filter(Boolean)
    .map(item => {
      const owner = ownerOf(item);
      return {
        item,
        owner,
        species: speciesOf(item),
        role: roleOf(item)
      };
    })
    .filter(entry => entry.owner && entry.species && !isProductElement(entry.owner));

  const species = new Set(list.map(e => e.species));
  const roles = new Set(list.map(e => e.role));
  const solids = list.filter(e => e.role === ROLE.SOLID);
  const holes = list.filter(e => e.role === ROLE.HOLE);

  return {
    list,
    count: list.length,
    species,
    roles,
    speciesCount: species.size,
    solids,
    holes,
    allSameSpecies: list.length > 0 && species.size <= 1,
    allSolid: list.length > 0 && list.every(e => e.role === ROLE.SOLID),
    allHole: list.length > 0 && list.every(e => e.role === ROLE.HOLE),
    hasSolid: solids.length > 0,
    hasHole: holes.length > 0,
    mixedRoles: solids.length > 0 && holes.length > 0,
    onlyVectorish: list.length > 0 && list.every(e =>
      e.species === SPECIES.VECTOR || e.species === SPECIES.LINE)
  };
}

const ALL_SPECIES = [SPECIES.RASTER, SPECIES.VECTOR, SPECIES.LINE, SPECIES.TEXT, SPECIES.GROUP, SPECIES.FUSION];

/**
 * Declaracion de cada herramienta. `active` recibe el desglose de la
 * seleccion y devuelve true/false. Asi una regla compleja no queda escondida
 * en un if/else de barra.
 *
 * REGLAS DE SELECCION MULTIPLE (del cliente):
 *   - Un objeto -> todo lo de su tipo queda visible.
 *   - Varios del mismo tipo -> agrupar, alinear y distribuir SI; editar NO.
 *     Por eso las herramientas de edicion exigen count === 1.
 *   - Fusionar -> SOLO si hay vector + imagen. Solo vectores o solo
 *     imagenes: no se fusiona. (La regla de `fusion` ya lo dice.)
 *   - Booleanas, descomponer, solidos/huecos y auditar son operaciones
 *     geometricas pensadas para varios objetos: quedan como estan.
 */
export const TOOLS = {
  // --- Siempre activas: sirven para cualquier objeto ---
  delete:      { label: "Eliminar",     always: true },
  duplicate:   { label: "Duplicar",     always: true },
  copy:        { label: "Copiar",       always: true },
  paste:       { label: "Pegar",        always: true },
  bringForward:{ label: "Subir capa",   always: true },
  sendBackward:{ label: "Bajar capa",   always: true },
  toFront:     { label: "Al frente",    always: true },
  toBack:      { label: "Al fondo",     always: true },
  rotate:      { label: "Rotar",        always: true },
  flip:        { label: "Voltear",      always: true },
  size:        { label: "Tamaño",       always: true },
  measurements:{ label: "Cotas",        always: true },
  align:       { label: "Alinear",      always: true },
  distribute:  { label: "Distribuir",   active: s => s.count >= 2 },
  zoom:        { label: "Ajustar vista",always: true },
  rulers:      { label: "Reglas",       always: true },
  guides:      { label: "Guías",        always: true },

  // --- Estructural ---
  group:       { label: "Agrupar",      active: s => s.count >= 2 },
  ungroup:     { label: "Desagrupar",
                 active: s => s.count >= 1 && s.species.size === 1 && s.species.has(SPECIES.GROUP) },

  // --- Descomposicion: vectores sueltos o grupos estructurales que solo
  //     contienen vectores (como un SVG recien importado). Una pieza con
  //     decomposedLayer ya es atomica: el boton se oculta y re-descomponer
  //     es no-op (antes el boton seguia activo y cada clic reemplazaba la
  //     pieza por un clon identico, ensuciando historial y rompiendo
  //     semantica). Con mezcla fresco+descompuesto se muestra y el dispatcher
  //     procesa solo lo fresco. ---
  decomposeVector: {
    label: "Descomponer Vector",
    active: s => s.count > 0 &&
      s.list.every(e => e.species === SPECIES.VECTOR || e.species === SPECIES.LINE ||
        (e.species === SPECIES.GROUP && groupHasOnlyVectorish(e.owner))) &&
      s.list.some(e => e.owner?.data?.decomposedLayer !== true)
  },

  // --- Roles solido/hueco (edicion de UN objeto: con varios se ocultan) ---
  calado: {
    label: "Calar",
    // Todo vector cerrado puede calarse. Solo si NO hay huecos en la
    // seleccion: calar un hueco seria un absurdo.
    active: s => s.count === 1 && s.onlyVectorish && s.hasSolid && !s.hasHole
  },
  rellenar: {
    label: "Rellenar",
    active: s => s.count === 1 && s.onlyVectorish && s.hasHole && !s.hasSolid
  },
  solidHole: {
    label: "Sólidos ⇄ Huecos",
    // Mezcla de sólidos y huecos: un clic intercambia los papeles.
    active: s => s.count > 0 && s.onlyVectorish && s.mixedRoles
  },

  // --- Geometria (edicion de UN objeto: con varios se ocultan) ---
  editNodes: {
    label: "Editar Nodos",
    // Cualquier vector (sólido, hueco o fusionado) y cualquier línea.
    // Una imagen no tiene nodos, así que queda oculta.
    active: s => s.count === 1 && s.onlyVectorish
  },
  boolean: {
    label: "Booleanas",
    active: s => s.count >= 2 && s.onlyVectorish
  },
  outline: {
    label: "Contorno",
    // Un solo concepto de contorno para imagen, vector y texto.
    // Edicion de UN objeto: con varios seleccionados se oculta (ahi solo
    // quedan agrupar, alinear, distribuir, booleanas y fusion).
    active: s => s.count === 1 && [...s.species].every(sp =>
      sp === SPECIES.RASTER || sp === SPECIES.VECTOR || sp === SPECIES.TEXT || sp === SPECIES.FUSION)
  },
  audit: {
    label: "Auditar Vectores",
    active: s => s.count > 0 && s.onlyVectorish
  },

  // --- Imagen (edicion de UNA imagen: con varias se ocultan) ---
  // NO hay una herramienta "Contorno · recuadro": recuadro NO es un concepto
  // para el cliente. CONTORNO ES EL BORDE, y es una sola cosa. De donde sale
  // ese borde (silueta o caja) lo decide la app sola mirando la imagen, asi
  // que acá no hay una entrada aparte: solo `outline`.
  removeBg:      { label: "Quitar Fondo",  active: s => s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.RASTER) },
  traceImage:    { label: "Trazar Imagen", active: s => s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.RASTER) },

  // --- Texto (edicion de UN texto: con varios se oculta) ---
  textToVector:  { label: "Texto a Vector", active: s => s.count === 1 && s.species.size === 1 && s.species.has(SPECIES.TEXT) },

  // --- Fusion ---
  fusion: {
    label: "Fusionar",
    // REGLA DEL CLIENTE: fusionar SOLO si hay vector + imagen. Solo vectores
    // o solo imagenes: no se fusiona. Por eso se exigen las dos especies a la
    // vez: la imagen aporta el relleno, el vector o la linea aportan la mascara.
    active: s => {
      if (s.count < 2) return false;
      const rasters = s.list.filter(e => e.species === SPECIES.RASTER);
      const masks = s.list.filter(e => e.species === SPECIES.VECTOR || e.species === SPECIES.LINE);
      return rasters.length >= 1 && masks.length >= 1;
    }
  },
  unfusion:       { label: "Quitar Fusión",      active: s => s.count > 0 && s.species.has(SPECIES.FUSION) },
  editFusionImage:{ label: "Editar Imagen",      active: s => s.count > 0 && s.species.has(SPECIES.FUSION) }
};

/** Nombres de herramientas visibles para una seleccion. */
export function resolveToolNames(selection) {
  const selectionList = (Array.isArray(selection) ? selection : []).filter(Boolean);
  if (!selectionList.length) {
    return Object.entries(TOOLS)
      .filter(([, tool]) => tool.always)
      .map(([name]) => name);
  }
  const summary = describeSelection(selectionList);
  return Object.entries(TOOLS)
    .filter(([, tool]) => {
      try { return tool.always ? true : !!tool.active?.(summary); }
      catch (_) { return false; }
    })
    .map(([name]) => name);
}

/** Alias historicos que la barra y el puente siguen esperando. */
const LEGACY_ALIAS = Object.freeze({
  booleanUnion: "boolean",
  booleanSubtract: "boolean",
  booleanIntersect: "boolean",
  booleanDifference: "boolean"
});

export function isToolEnabled(toolName, selection) {
  const canonical = LEGACY_ALIAS[toolName] || toolName;
  const tool = TOOLS[canonical];
  if (!tool) return false;
  const selectionList = (Array.isArray(selection) ? selection : []).filter(Boolean);
  if (!selectionList.length) return !!tool.always;
  if (tool.always) return true;
  try { return !!tool.active?.(describeSelection(selectionList)); }
  catch (_) { return false; }
}

/**
 * Traduce el motor a los nombres historicos que usan los data-fusion-btn de
 * las barras. Las dos superficies (panelCommandBridge y
 * canvasControlsIntegration) consumen ESTA funcion, por lo que la barra
 * superior y laemergente no pueden discrepar entre si.
 */
const ENGINE_TO_LEGACY = Object.freeze({
  boolean: ["booleanUnion", "booleanIntersect", "booleanSubtract", "booleanDifference"],
  group: ["group"],
  ungroup: ["ungroup"],
  align: ["align", "centerH", "centerV", "centerBoth", "alignLeft", "alignCenterX", "alignRight", "alignTop", "alignCenterY", "alignBottom"],
  distribute: ["distribute", "distributeH", "distributeV"],
  decomposeVector: ["decomposeVector"],
  editNodes: ["editNodes"],
  outline: ["outline"],
  calado: ["calado"],
  rellenar: ["rellenar"],
  solidHole: ["solidHole"],
  fusion: ["fusion"],
  unfusion: ["unfusion"],
  editFusionImage: ["editFusionImage"],
  removeBg: ["removeBg"],
  traceImage: ["traceImage"],
  textToVector: ["textToVector"],
  zoom: ["zoom"],
  rulers: ["rulers"],
  guides: ["guides"],
  measurements: ["measurements"]
});

export function legacyNamesFor(selection) {
  const selectionList = (Array.isArray(selection) ? selection : []).filter(Boolean);
  if (!selectionList.length) return ["zoom", "rulers", "guides", "measurements"];
  const enabled = new Set(resolveToolNames(selectionList));
  const names = [];
  Object.entries(ENGINE_TO_LEGACY).forEach(([tool, legacy]) => {
    if (!enabled.has(tool)) return;
    legacy.forEach(name => { if (!names.includes(name)) names.push(name); });
  });
  return names;
}

/* =========================================================================
   EKKO STUDIO — PESTAÑAS DE CONTEXTO (v1.0)

   El nivel 1 del panel de dos niveles. Decide QUE grupo de herramientas se
   despliega. El nivel 2 (los parametros de cada boton) vive en
   commandParameters.js.

   "auto" NO filtra: devuelve exactamente la interseccion completa que ya
   devolvia legacyNamesFor(). Eso mantiene el comportamiento actual intacto y
   evita sorpresas. Solo cuando el usuario pulsa una pestana explicita se
   restringe al grupo de esa pestana.
   ========================================================================= */

const ALWAYS_TOOLS = Object.entries(TOOLS)
  .filter(([, tool]) => tool.always)
  .map(([name]) => name);

export const TABS = Object.freeze({
  base:     { id: "base",     label: "Inicio",  tools: ALWAYS_TOOLS },
  image:    { id: "image",    label: "Imagen",  tools: ["removeBg", "traceImage", "outline", "fusion"] },
  vector:   { id: "vector",   label: "Vector",  tools: ["editNodes", "decomposeVector", "boolean", "calado", "rellenar", "solidHole", "audit", "outline"] },
  text:     { id: "text",     label: "Texto",   tools: ["textToVector", "outline"] },
  multiple: { id: "multiple", label: "Varios",  tools: ["group", "distribute", "align", "boolean", "fusion", "measurements"] },
  fusion:   { id: "fusion",   label: "Fusión",  tools: ["unfusion", "editFusionImage", "outline"] }
});

/** Contexto que el motor deduce de la seleccion. Es el mismo criterio que
 *  usa el resto de EKKO: especie unica -> su pestana; mezcla -> Varios. */
export function detectTab(selection) {
  const list = (Array.isArray(selection) ? selection : []).filter(Boolean);
  if (!list.length) return "base";
  const s = describeSelection(list);
  if (!s.count) return "base";
  if (s.species.has(SPECIES.FUSION)) return "fusion";
  if (s.count > 1 || s.speciesCount > 1) return "multiple";
  const only = [...s.species][0];
  if (only === SPECIES.RASTER) return "image";
  if (only === SPECIES.TEXT) return "text";
  if (only === SPECIES.VECTOR || only === SPECIES.LINE || only === SPECIES.GROUP) return "vector";
  return "base";
}

/** Pestanas que tienen sentido con esta seleccion. Con una imagen
 *  seleccionada el cliente ve Inicio e Imagen, no Texto ni Vector. */
export function tabsForSelection(selection) {
  const detected = detectTab(selection);
  const ids = ["base", detected];
  if (detected === "multiple") ids.push("image", "vector", "text");
  return [...new Set(ids)].filter(id => TABS[id]);
}

/**
 * Nombres legacy visibles para una pestana concreta.
 * - "auto"  -> interseccion completa (comportamiento previo, sin cambios)
 * - "base"  -> solo herramientas universales mas las de su grupo
 * - resto   -> universales + herramientas del grupo, siempre recortadas por
 *               la interseccion real de la seleccion (nunca se ofrece una
 *               herramienta que el objeto seleccionado no soporta)
 */
export function legacyNamesForTab(selection, tabId) {
  const all = legacyNamesFor(selection);
  if (!tabId || tabId === "auto") return all;

  const tab = TABS[tabId];
  if (!tab) return all;

  const enabled = new Set(resolveToolNames(selection));
  const allowedTools = new Set(tab.tools);
  const baseTools = new Set(TABS.base.tools);

  const names = [];
  Object.entries(ENGINE_TO_LEGACY).forEach(([tool, legacy]) => {
    if (!enabled.has(tool)) return;
    if (!allowedTools.has(tool) && !baseTools.has(tool)) return;
    legacy.forEach(name => { if (!names.includes(name)) names.push(name); });
  });

  // Sin seleccion solo se ofrecen las universales, igual que antes.
  if (!names.length && !(Array.isArray(selection) && selection.filter(Boolean).length)) {
    return ["zoom", "rulers", "guides", "measurements"];
  }
  return names;
}

if (typeof window !== "undefined") {
  window.EKKO_CAPABILITIES = {
    SPECIES, ROLE, TOOLS, TABS, describeSelection, resolveToolNames, legacyNamesFor,
    legacyNamesForTab, detectTab, tabsForSelection,
    isToolEnabled, speciesOf, roleOf
  };
}
