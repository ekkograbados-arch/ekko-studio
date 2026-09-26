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

  // --- Descomposicion: solo vectores. Un grupo con imagenes se desagrupa
  //     primero; despues se seleccionan sus vectores y se descomponen. ---
  decomposeVector: {
    label: "Descomponer Vector",
    active: s => s.count > 0 && s.onlyVectorish
  },

  // --- Roles solido/hueco ---
  calado: {
    label: "Calar",
    // Todo vector cerrado puede calarse. Solo si NO hay huecos en la
    // seleccion: calar un hueco seria un absurdo.
    active: s => s.count > 0 && s.onlyVectorish && s.hasSolid && !s.hasHole
  },
  rellenar: {
    label: "Rellenar",
    active: s => s.count > 0 && s.onlyVectorish && s.hasHole && !s.hasSolid
  },
  solidHole: {
    label: "<Sólidos ⇄ Huecos>",
    // Mezcla de sólidos y huecos: un clic intercambia los papeles.
    active: s => s.count > 0 && s.onlyVectorish && s.mixedRoles
  },

  // --- Geometria ---
  editNodes: {
    label: "Editar Nodos",
    // Cualquier vector (sólido, hueco o fusionado) y cualquier línea.
    // Una imagen no tiene nodos, así que queda oculta.
    active: s => s.count > 0 && s.onlyVectorish
  },
  boolean: {
    label: "Booleanas",
    active: s => s.count >= 2 && s.onlyVectorish
  },
  outline: {
    label: "Contorno",
    // Un solo concepto de contorno para imagen, vector y texto.
    active: s => s.count > 0 && [...s.species].every(sp =>
      sp === SPECIES.RASTER || sp === SPECIES.VECTOR || sp === SPECIES.TEXT || sp === SPECIES.FUSION)
  },
  audit: {
    label: "Auditar Vectores",
    active: s => s.count > 0 && s.onlyVectorish
  },

  // --- Imagen ---
  outlineBox:    { label: "Contorno · recuadro",
                   active: s => s.count > 0 && s.species.size === 1 && s.species.has(SPECIES.RASTER) },
  removeBg:      { label: "Quitar Fondo",  active: s => s.count > 0 && s.species.size === 1 && s.species.has(SPECIES.RASTER) },
  traceImage:    { label: "Trazar Imagen", active: s => s.count > 0 && s.species.size === 1 && s.species.has(SPECIES.RASTER) },

  // --- Texto ---
  textToVector:  { label: "Texto a Vector", active: s => s.count > 0 && s.species.size === 1 && s.species.has(SPECIES.TEXT) },

  // --- Fusion ---
  fusion: {
    label: "Fusionar",
    // Imagen + vector, o imagen + linea cerrada. La imagen aporta el
    // relleno, el vector o la linea aportan la mascara.
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
  outlineBox: ["outlineBox"],
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

if (typeof window !== "undefined") {
  window.EKKO_CAPABILITIES = {
    SPECIES, ROLE, TOOLS, describeSelection, resolveToolNames, legacyNamesFor,
    isToolEnabled, speciesOf, roleOf
  };
}
