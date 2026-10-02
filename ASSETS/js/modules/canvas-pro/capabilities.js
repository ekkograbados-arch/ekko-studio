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

/* =========================================================================
   ESPECIES: TRES, Y SOLO TRES.

   Lo que el cliente puede cargar en EKKO son vectores, imagenes y textos.
   Todo lo demas es una PROPIEDAD de uno de esos tres, no un tipo aparte:

     - Una linea de corte es un vector con isCutLine. Sigue siendo vector:
       por eso le sirven el contorno y las booleanas como a cualquier otro.
     - Una fusion es un vector que tiene una imagen adentro. Por eso sale
       en la pestana Vector, y a la vez ofrece "Quitar Fusion" y "Trazar".
     - Un grupo no es un tipo: es un envoltorio. Se clasifica por lo que
       TIENE ADENTRO, y si tiene mas de una cosa, primero hay que
       desagrupar para saber con que se esta trabajando.

   Antes existian LINE, GROUP y FUSION como especies propias. Eso obligaba
   al motor a adivinar que hacer con un grupo, y por eso un grupo mixto
   terminaba en la pestana "Varios", ofreciendo Union y Distribuir sobre un
   solo objeto apretado. Con tres especies eso no puede pasar: un grupo
   misto es un vector con imagen y texto adentro, y por definicion hay que
   abrirlo primero.

   NUNCA se decide por la etiqueta. Un QR no es "un QR": es un
   CompoundPath, o sea un vector, y se comporta como cualquier vector. Un
   objeto se identifica por su clase y sus propiedades geometricas, jamas
   por su nombre.
   ========================================================================= */
export const SPECIES = Object.freeze({
  RASTER: "raster",
  VECTOR: "vector",
  TEXT: "text",
  /* No es un tipo que el cliente pueda cargar. Es un grupo que tiene mas de
     una especie adentro: hay que desagruparlo antes de poder operarlo. */
  MIXED: "mixed"
});

/* PROPIEDADES de un vector. No son tipos: describen que le pasa a un vector,
   y por eso el motor las lee sin cambiarle la especie. */
export const PROPS = Object.freeze({
  /* Vector que tiene una imagen fusionada adentro. Sale en la pestana
     Vector y por eso ofrece Quitar Fusion y Trazar. */
  containsImage: "contieneImagen",
  /* Vector que es una linea de corte. Sigue siendo vector: por eso le
     sirven el contorno y las booleanas. */
  cutLine: "esLineaDeCorte"
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
 * Un objeto es CONTENEDOR si al apretar Descomponer se lo puede partir en
 * varias piezas y trabajar con cada una por separado.
 *
 * Solo los Group y las piezas que conservan el grupo de un SVG importado.
 * Un CompoundPath tiene hijos, pero son los TRAZOS que lo componen, no partes
 * sueltas: partirlo deja de darle sentido. Por eso un QR, una letra
 * vectorizada o una forma son una pieza y no se descomponen.
 */
function esContenedor(entry) {
  const owner = entry.owner;
  if (!owner) return false;
  if (owner.className === "Group") return true;
  return entry.species === SPECIES.VECTOR && owner.data?.decomposedLayer !== true &&
    !!(owner.data?.svgSourceGroup || owner.data?.fromSvgImport || owner.data?.importedGroup);
}

/** Un grupo es un envoltorio: cuenta que cosa de diseno tiene adentro. */
function contenidoDeGrupo(owner) {
  const especies = new Set();
  const visit = node => {
    if (!node) return;
    const data = node.data || {};
    if (data.mockup || data.isMask || data.wasClipMask || node.clipMask ||
        data.isSelectionBox || data.isHandle || data.isMeasurement ||
        data.isSmartGuide || data.isNodeEditOverlay || data.isTracePreview) return;
    if (data.isText || data.isCurvedGroup || data.isSpacedGroup || node.className === "PointText") {
      especies.add(SPECIES.TEXT);
    } else if (node.className === "Raster") {
      especies.add(SPECIES.RASTER);
    } else if (VECTOR_CLASSES.includes(node.className)) {
      especies.add(SPECIES.VECTOR);
    }
    (node.children || []).forEach(visit);
  };
  visit(owner);
  return especies;
}

/**
 * Especie del objeto: VECTOR, RASTER o TEXT. Nada mas.
 *
 * Un grupo no tiene especie propia: se lee por lo que contiene. Si tiene
 * una sola cosa, es esa cosa. Si tiene varias, es un vector multiple y por
 * definicion hay que desagrupar antes de operar: por eso describeSelection
 * marca mezcla y la cinta ofrece solo "Desagrupar".
 *
 * Ni la fusion ni la linea de corte cambian la especie: son propiedades.
 */
export function speciesOf(item) {
  const owner = ownerOf(item);
  if (!owner) return null;
  const data = owner.data || {};
  if (data.isText || data.isCurvedGroup || data.isSpacedGroup || owner.className === "PointText") {
    return SPECIES.TEXT;
  }
  if (owner.className === "Raster") return SPECIES.RASTER;
  if (VECTOR_CLASSES.includes(owner.className)) return SPECIES.VECTOR;
  if (owner.className === "Group") {
    /* UNA FUSION ES UN VECTOR QUE TIENE UNA IMAGEN ADENTRO. No es un grupo
       mixto cualquiera: es una sola pieza compuesta, con su unico contorno
       (la mascara vectorial) y su relleno (la imagen). Por eso se reporta
       como vector, y por eso ofrece Quitar Fusion y Trazar. Sin esto, una
       fusion caia en la categoria de grupo mixto y no le ofrecia nada. */
    if (data.isSmartFusion) return SPECIES.VECTOR;

    const dentro = contenidoDeGrupo(owner);
    if (dentro.size === 1) return [...dentro][0];
    // Vacio: un Group sin contenido de diseno (un marco, por ejemplo) no es
    // una especie y no debe aparecer en la cinta. Si tiene varias cosas, se
    // reporta como mezcla y la cinta ofrece solo Desagrupar.
    if (dentro.size === 0) return null;
    return SPECIES.MIXED;
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

  /* PROPIEDADES, no especies. Una fusion es un vector con una imagen
     adentro; una linea de corte es un vector. Ninguna de las dos cambia lo
     que el objeto es, solo lo que se le puede hacer. */
  const fusions = list.filter(e => esFusion(e.owner));
  const cutLines = list.filter(e => isCutLine(e.owner));

  return {
    list,
    count: list.length,
    species,
    roles,
    speciesCount: species.size,
    solids,
    holes,
    fusions,
    cutLines,
    allSameSpecies: list.length > 0 && species.size <= 1,
    allSolid: list.length > 0 && list.every(e => e.role === ROLE.SOLID),
    allHole: list.length > 0 && list.every(e => e.role === ROLE.HOLE),
    hasSolid: solids.length > 0,
    hasHole: holes.length > 0,
    mixedRoles: solids.length > 0 && holes.length > 0,
    /* Un grupo con varias especies adentro. Hay que desagruparlo antes de
       operar: no se le puede aplicar nada a "un vector con una imagen y un
       texto adentro" sin saber primero cual es cual. */
    hasMixed: list.some(e => e.species === SPECIES.MIXED),
    onlyVectorish: list.length > 0 && list.every(e => e.species === SPECIES.VECTOR)
  };
}

/** Un vector que tiene una imagen fusionada adentro. Sigue siendo vector. */
export function esFusion(owner) {
  const data = (owner && owner.data) || {};
  if (data.isSmartFusion) return true;
  // Un grupo con un Raster adentro tambien es una fusion, aunque no traiga la
  // marca: la imagen es el relleno y el vector es la mascara.
  if (!owner || owner.className !== "Group") return false;
  const dentro = contenidoDeGrupo(owner);
  return dentro.has(SPECIES.RASTER) && dentro.has(SPECIES.VECTOR);
}

const ALL_SPECIES = [SPECIES.RASTER, SPECIES.VECTOR, SPECIES.TEXT, SPECIES.MIXED];

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
  /* Desagrupar se ofrece siempre que haya un grupo apretado, sea homogeneo o
     mixto. Un grupo mixto NO se puede operar: primero hay que abrirlo para
     ver que hay adentro, y despues recien cada parte con su tipo. */
  ungroup:     { label: "Desagrupar",
                 active: s => s.count > 0 && s.list.some(e => e.owner?.className === "Group") },

  // --- Descomposicion ---
  //     Descomponer significa SEPARAR UNA PIEZA EN VARIAS. Solo tiene
  //     sentido si el objeto seleccionado es un contenedor: un grupo, o una
  //     pieza que todavia conserve el grupo de origen de un SVG importado.
  //
  //     Un CompoundPath NO es un contenedor. Sus hijos son los trazos que lo
  //     componen, no partes que el cliente pueda tratar por separado: un QR,
  //     una letra vectorizada o una forma con curvas son una sola pieza.
  //     Por eso NO se ofrece Descomponer, aunque por dentro tenga 120
  //     rectangulos. No es un caso especial para el QR: es la misma regla
  //     para cualquier vector que ya es una pieza unica.
  //
  //     Un grupo mixto tampoco: primero hay que desagrupar.
  decomposeVector: {
    label: "Descomponer Vector",
    active: s => s.count > 0 && !s.hasMixed && s.list.every(esContenedor) &&
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
      sp === SPECIES.RASTER || sp === SPECIES.VECTOR || sp === SPECIES.TEXT)
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
      const masks = s.list.filter(e => e.species === SPECIES.VECTOR);
      return rasters.length >= 1 && masks.length >= 1;
    }
  },

  // --- Fusion: NO es una especie. Es un vector que tiene una imagen
  //     adentro, asi que se declara por la PROPIEDAD "fusions" del resumen.
  //     Por eso viven en la pestana Vector y no en una pestana aparte. ---
  unfusion:        { label: "Quitar Fusión",  active: s => s.count > 0 && s.fusions.length === s.count },
  editFusionImage: { label: "Editar Imagen",  active: s => s.count > 0 && s.fusions.length === s.count }
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
  /* Un grupo con varias especies adentro (un vector, una imagen y un texto
     en la misma caja) NO se puede trabajar: hay que abrirlo primero para
     saber que hay. Se ofrece Desagrupar y nada mas, aunque la pestana
     "Varios" admita otras cosas, porque Alinear o Distribuir sobre un grupo
     con imagen adentro no significan nada. */
  if (summary.hasMixed) {
    return ["ungroup"].filter(name => TOOLS[name]?.active?.(summary));
  }
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

/* Pestanas del modelo de TRES especies.
   - No existe pestana "Fusion": una fusion es un vector con una imagen
     adentro, asi que sale en Vector y ahi ofrece Quitar Fusion y Trazar.
   - No existe pestana "Grupo": un grupo se clasifica por lo que contiene.
   - "Varios" es para varios objetos SUELTOS apretados a la vez, no para un
     grupo. Un grupo mixto cae aca y lo unico que ofrece es Desagrupar, que es
     justamente lo que hace falta para poder seguir trabajando. */
export const TABS = Object.freeze({
  base:     { id: "base",     label: "Inicio",  tools: ALWAYS_TOOLS },
  image:    { id: "image",    label: "Imagen",  tools: ["removeBg", "traceImage", "outline", "fusion"] },
  vector:   { id: "vector",   label: "Vector",  tools: ["editNodes", "decomposeVector", "boolean", "calado", "rellenar", "solidHole", "audit", "outline", "unfusion", "editFusionImage"] },
  text:     { id: "text",     label: "Texto",   tools: ["textToVector", "outline"] },
  multiple: { id: "multiple", label: "Varios",  tools: ["group", "distribute", "align", "ungroup", "measurements"] }
});

/** Contexto que el motor deduce de la seleccion. Es el mismo criterio que
 *  usa el resto de EKKO: especie unica -> su pestana; mezcla -> Varios. */
export function detectTab(selection) {
  const list = (Array.isArray(selection) ? selection : []).filter(Boolean);
  if (!list.length) return "base";
  const s = describeSelection(list);
     if (s.species.has(SPECIES.MIXED)) return "multiple";
  if (s.count > 1 || s.speciesCount > 1) return "multiple";
  const only = [...s.species][0];
  if (only === SPECIES.RASTER) return "image";
      if (only === SPECIES.TEXT) return "text";
     if (only === SPECIES.VECTOR) return "vector";
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
    isToolEnabled, speciesOf, roleOf, esFusion, PROPS
  };
}
