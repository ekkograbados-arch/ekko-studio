import { getPublicOwner, isMockupOrMask, isContainmentWrapper } from "./designGeometry.js";
import { isCutLine, semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { buildOutlineGeometry } from "./outlineGeometry.js";

/* =========================================================================
   EKKO STUDIO — CONTORNO UNIFICADO (v1.0)

   Antes convivian tres botones con nombres parecidos que hacian cosas
   distintas:
     - "Contorno"            relleno <-> trazo de un vector
     - "Trazar Imagen"       calca una imagen
     - "Aplicar Contorno"    efecto de contorno de texto

   El concepto es UNO: crear el contorno de un objeto. Esta ruta decide por
   la ESPECIE del objeto y aplica la variante correcta, igual que la barra
   decide por capacidad.

   Reglas del cliente:
     - La imagen NO se elimina nunca al crear su contorno. Queda en el
       proyecto para que el cliente la borre o la fusione cuando quiera.
     - Si la imagen tiene fondo, el contorno es el recuadro de la imagen.
     - Si no tiene fondo, se calca la silueta (bigotes, pelos, etc).
     - El cliente edita el contorno: nivel de detalle, radio y lado
       (adentro / centro / afuera).
     - Fusionar imagen + contorno solo tiene sentido si el contorno es una
       sola pieza cerrada. Con varios contornos la fusion se deja a mano
       para no generar una fusion incorrecta.
   ========================================================================= */

const CONTOUR_COLOR = "#111827";
// La silueta de una foto recortada puede tener millones de pixeles. Se lee el
// canal alfa a esta resolucion y despues se reescala a la pieza: es mas que
// suficiente para un contorno, y el control Suavidad existe justamente para
// bajar el numero de nodos de un detalle muy fino.
const ALPHA_SCAN_MAX = 1200;
const ALPHA_ISO = 128;

/** Muestrea el canal alfa de la imagen a una resolucion workable.
 *  Devuelve null si la imagen no tiene nada transparente: en ese caso el borde
 *  exterior es el rectangulo de la pieza y no hay nada que leer. */
function sampleRasterAlpha(raster) {
    const element = raster?.canvas || raster?.getElement?.() || null;
    const sourceW = Math.round(raster?.width || 0);
    const sourceH = Math.round(raster?.height || 0);
    if (!element || !(sourceW > 0) || !(sourceH > 0)) return null;
    const scale = Math.min(1, ALPHA_SCAN_MAX / Math.max(sourceW, sourceH));
    const w = Math.max(8, Math.round(sourceW * scale));
    const h = Math.max(8, Math.round(sourceH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, w, h);
    try { ctx.drawImage(element, 0, 0, w, h); } catch (_) { return null; }
    let data = null;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (_) { return null; }
    if (!data) return null;
    const alpha = new Uint8Array(w * h);
    let visible = 0;
    for (let i = 0, p = 3; i < alpha.length; i++, p += 4) {
        const a = data[p];
        alpha[i] = a;
        if (a > ALPHA_ISO) visible += 1;
    }
    // Si practicamente todo es opaco, la imagen no esta recortada.
    if (visible <= 0 || visible >= alpha.length * 0.995) return null;
    return { alpha, width: w, height: h, sourceW, sourceH };
}

/**
 * Contorno exacto de la region opaca por "marching squares" con
 * interpolacion lineal sobre el canal alfa. Devuelve poligonos cerrados en
 * coordenadas de la pieza (no de la imagen): el borde sale donde termina la
 * imagen de verdad, con pelo y bigote incluidos, sin stair-steps.
 *
 * NO es trazado: no analiza tonos ni inventa formas. Solo lee donde acaba el
 * dibujo, que es exactamente lo que es el borde de la pieza.
 */
function alphaSilhouetteContours(sampled, bounds) {
    const { alpha, width: w, height: h } = sampled;
    const at = (x, y) => alpha[y * w + x];
    const cut = (x1, y1, v1, x2, y2, v2) => {
        const denom = v2 - v1;
        const t = Math.abs(denom) < 1e-6 ? 0.5 : (ALPHA_ISO - v1) / denom;
        return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    };
    // Escala del grid de muestreo a coordenadas de la pieza.
    const sx = bounds.width / w;
    const sy = bounds.height / h;

    const segments = [];
    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
            const code = (tl > ALPHA_ISO ? 1 : 0) | (tr > ALPHA_ISO ? 2 : 0)
                       | (br > ALPHA_ISO ? 4 : 0) | (bl > ALPHA_ISO ? 8 : 0);
            if (code === 0 || code === 15) continue;
            const top = () => cut(x, y, tl, x + 1, y, tr);
            const right = () => cut(x + 1, y, tr, x + 1, y + 1, br);
            const bottom = () => cut(x, y + 1, bl, x + 1, y + 1, br);
            const left = () => cut(x, y, tl, x, y + 1, bl);
            // Orientacion fija: la region opaca queda siempre a un lado, asi
            // los contornos salen con un sentido consistente.
            switch (code) {
                case 1: case 14: segments.push([left(), top()]); break;
                case 2: case 13: segments.push([top(), right()]); break;
                case 3: case 12: segments.push([left(), right()]); break;
                case 4: case 11: segments.push([right(), bottom()]); break;
                case 6: case 9:  segments.push([top(), bottom()]); break;
                case 7: case 8:  segments.push([bottom(), left()]); break;
                case 5:  segments.push([left(), top()], [right(), bottom()]); break;
                case 10: segments.push([top(), right()], [bottom(), left()]); break;
                default: break;
            }
        }
    }
    if (!segments.length) return [];

    // Empalme de segmentos en contornos cerrados.
    // Lineal: cada segmento se visita una sola vez y se saca de su cubo al
    // consumirse. Un empalme por busqueda lineal desde cada semilla es O(n^2)
    // y con una silueta de miles de segmentos cuelga el navegador.
    const key = (p) => `${Math.round(p[0] * 64)}_${Math.round(p[1] * 64)}`;
    const buckets = new Map();
    segments.forEach((seg, index) => {
        const k = key(seg[0]);
        let bucket = buckets.get(k);
        if (!bucket) { bucket = []; buckets.set(k, bucket); }
        bucket.push(index);
    });
    const consumed = new Uint8Array(segments.length);
    const loops = [];
    for (let seedIndex = 0; seedIndex < segments.length; seedIndex++) {
        if (consumed[seedIndex]) continue;
        const loop = [];
        let current = seedIndex;
        let previous = -1;
        while (current >= 0 && !consumed[current]) {
            consumed[current] = 1;
            const seg = segments[current];
            loop.push(seg[0], seg[1]);
            // Siguiente: el segmento que arranca en el extremo final.
            const bucket = buckets.get(key(seg[1]));
            let next = -1;
            if (bucket) {
                for (let i = 0; i < bucket.length; i++) {
                    if (!consumed[bucket[i]] && bucket[i] !== previous) { next = bucket[i]; break; }
                }
            }
            previous = current;
            current = next;
        }
        if (loop.length >= 8) loops.push(loop);
    }

    // A coordenadas de la pieza, y se descartan los hilos sin area.
    return loops.map(loop => loop.map(p => new paper.Point(bounds.x + p[0] * sx, bounds.y + p[1] * sy)))
        .filter(pts => {
            let area = 0;
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                area += a.x * b.y - b.x * a.y;
            }
            return Math.abs(area / 2) > 1e-6;
        });
}

/**
 * El borde exterior de una imagen. Es SIEMPRE el mismo concepto: una sola
 * linea que dice hasta donde llega la pieza, y nada de lo que esta adentro.
 * De donde venga el borde no es una decision del cliente:
 *   - si la imagen esta llena hasta su caja, el borde es la caja;
 *   - si viene recortada, el borde es su silueta real (pelo y bigote
 *     incluidos), leida del canal alfa.
 * El cliente nunca tiene que clasificar nada. Y esto NO es Trazar: Trazar
 * analiza tonos y copia el objeto entero; aqui solo se lee el limite.
 */
function createRasterBorderContour(raster, options = {}) {
    const owner = ownerOf(raster);
    const bounds = owner?.bounds?.clone?.() || raster?.bounds?.clone?.();
    if (!bounds) return null;

    // De donde sale el borde NO es una decision del cliente:
    //   - imagen llena hasta su caja  -> el borde es la caja
    //   - imagen recortada            -> el borde es su silueta real
    // En los dos casos el contorno se arma con el MISMO motor, asi que los
    // cuatro controles se comportan igual sin importar cual de los dos sea.
    const sampled = sampleRasterAlpha(raster);
    const loops = sampled ? alphaSilhouetteContours(sampled, bounds) : [];
    const origin = loops.length ? "image-silhouette" : "image-bounding";

    const compound = new paper.CompoundPath({ insert: false });
    compound.applyMatrix = false;
    compound.matrix = new paper.Matrix();
    compound.fillRule = "evenodd";
    if (loops.length) {
        loops.forEach(loop => {
            compound.addChild(new paper.Path({ segments: loop, closed: true, insert: false }));
        });
    } else {
        const frame = new paper.Path.Rectangle({
            from: bounds.topLeft, to: bounds.bottomRight, closed: true, insert: false
        });
        compound.addChild(frame);
    }

    const width = Math.abs(Number(options.width) || 0) || 2;
    const side = ["inside", "outside", "center"].includes(String(options.side || "").toLowerCase())
        ? String(options.side).toLowerCase() : "center";
    const radius = Number(options.radius) || 0;
    const smoothing = Number(options.smoothing) || 0;
    const band = buildOutlineGeometry(compound, width, side, radius, smoothing);
    compound.remove?.();
    if (!band) return null;

    const outline = new paper.CompoundPath({ insert: false });
    outline.applyMatrix = false;
    outline.matrix = new paper.Matrix();
    (band.className === "CompoundPath" && band.children?.length
        ? band.children.map(c => c.clone({ insert: false }))
        : [band.clone({ insert: false })]
    ).forEach(child => outline.addChild(child));
    band.remove?.();
    outline.fillRule = "evenodd";
    outline.fillColor = new paper.Color(CONTOUR_COLOR);
    outline.strokeColor = null;
    outline.strokeWidth = 0;
    outline.data = {
        locked: false,
        label: "Contorno de imagen",
        source: "image-outline",
        origin,
        isSolidShape: true,
        isFusionReceptor: true,
        semanticKind: VECTOR_KIND.SOLID,
        outlineWidth: width,
        outlineRadius: radius,
        outlineSmoothing: smoothing,
        outlineSide: side
    };
    try { window.ensureContainedDesignItem?.(outline); } catch (_) {}
    if (outline.parent === null) {
        (paper.project.activeLayer || paper.project.layers[0]).addChild(outline);
        if (window.currentMockup) outline.insertBelow(window.currentMockup);
    }
    window.syncGeometryToGeomBase?.(outline);
    return outline;
}

function ownerOf(item) {
  try { return getPublicOwner(item) || item; } catch (_) { return item; }
}
function isDesignObject(item) {
  const owner = ownerOf(item);
  if (!owner) return false;
  try { if (isMockupOrMask(owner) || isContainmentWrapper(owner)) return false; } catch (_) {}
  return owner !== window.currentMockup && owner !== window.clipMask;
}
function speciesOf(item) {
  const owner = ownerOf(item);
  if (!owner) return null;
  const data = owner.data || {};
  if (owner.className === "Raster") return "raster";
  if (data.isText || data.isCurvedGroup || data.isSpacedGroup || owner.className === "PointText") return "text";
  if (["Path", "CompoundPath", "Shape"].includes(owner.className)) {
    return isCutLine(owner) ? "line" : "vector";
  }
  return null;
}

/** El cliente decide si la imagen tiene fondo. Un rectangulo es ese caso. */
export function createBoundingContour(raster, options = {}) {
  if (!raster) return null;
  const bounds = raster.bounds?.clone?.() || null;
  if (!bounds) return null;
  const width = Number(options.width) || 1;
  const rect = new paper.Path.Rectangle({
    insert: false,
    from: bounds.topLeft,
    to: bounds.bottomRight,
    fillColor: new paper.Color(CONTOUR_COLOR)
  });
  rect.data = {
    locked: false,
    label: "Contorno de imagen",
    source: "image-contour",
    origin: "image-bounding",
    // Es una forma CERRADA y rellena: por eso puede actuar como receptor de
    // Fusion y como vector normal. Si el cliente quiere una linea de corte
    // abierta, eso es una decision posterior (Calar / Contorno).
    isSolidShape: true,
    isFusionReceptor: true,
    semanticKind: VECTOR_KIND.SOLID,
    outlineWidth: width,
    outlineSide: options.side || "center"
  };
  // ensureContainedDesignItem devuelve el WRAPPER; a la API le interesa el
  // objeto publico, que es el rectangulo recien creado.
  // OJO: el wrapper ya se inserta bajo el mockup por su cuenta. Mover el
  // objeto DESPUES de envolverlo lo sacaria del wrapper.
  try { window.ensureContainedDesignItem?.(rect); } catch (_) {}
  if (rect.parent === null) {
    (paper.project.activeLayer || paper.project.layers[0]).addChild(rect);
    if (window.currentMockup) rect.insertBelow(window.currentMockup);
  }
  window.syncGeometryToGeomBase?.(rect);
  return rect;
}

/** ¿El contorno calcido es una sola pieza cerrada? Solo esa se puede fusionar. */
export function isSingleClosedContour(item) {
  const owner = ownerOf(item);
  if (!owner) return false;
  const leaves = owner.className === "CompoundPath" ? Array.from(owner.children || []) : [owner];
  if (leaves.length !== 1) return false;
  return leaves.every(leaf => leaf.closed === true);
}

function vectorContour(owner) {
  // Relleno <-> trazo, con los cuatro controles del panel: Grosor, Radio,
  // Lado y Suavidad. Ruta ya existente y probada.
  if (typeof window.toggleOutline === "function") {
    return window.toggleOutline(owner, readOutlineControls());
  }
  return null;
}

/** Lee los 4 controles del panel de contorno. Si el panel no esta visible
 *  (por ejemplo el cliente aprieta Contorno desde la barra superior sin
 *  haber abierto el panel contextual) se usan los valores por defecto. */
function readOutlineControls() {
  const read = (id, fallback) => {
    const el = typeof document !== "undefined" ? document.getElementById(id) : null;
    const value = Number(el?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  const sideEl = typeof document !== "undefined" ? document.getElementById("ctxOutlineSide") : null;
  return {
    width: read("ctxOutlineWidth", 2),
    radius: read("ctxOutlineRadius", 0),
    smoothing: read("ctxOutlineSmoothing", 0),
    side: sideEl?.value || "center"
  };
}

/**
 * Punto de entrada unico. Delega segun la especie; no decide nada de
 * visibilidad (eso es trabajo del motor de capacidades).
 *
 * CONCEPTO: CONTORNO = una linea que dibuja el BORDE EXTERIOR de la seleccion
 * y nada de lo que esta adentro. No importa de donde venga el objeto ni si
 * la imagen tiene fondo: el borde es el borde. Esa unica regla es lo que
 * separa esta herramienta de TRAZAR, que copia el objeto entero e incluye el
 * detalle interno.
 */
export async function aplicarContorno(items = null, options = {}) {
  const selection = (items || (Array.isArray(window.selectedItems) && window.selectedItems.length
    ? window.selectedItems
    : (window.selectedItem ? [window.selectedItem] : [])))
    .filter(item => item && isDesignObject(item))
    .map(ownerOf);

  if (!selection.length) return null;
  // Solo se cancela una transaccion que esta misma llamada abrio. Si ya habia
  // una abierta (un arrastre, una fusion), es de otro Dueño y no se toca: si se
  // cancelara aqui, el Deshacer de esa operacion se perderia en silencio.
  const ownsHistory = !window._ekkoHistoryTransaction?.active;
  if (ownsHistory) window.beginHistoryTransaction?.("contorno");
  const fail = reason => {
    if (ownsHistory) window.cancelHistoryTransaction?.(reason || "contorno-failed");
    console.warn("[EKKO CONTORNO] no se pudo crear el contorno:", reason);
    return null;
  };
  const results = [];
  try {
    for (const owner of selection) {
      const species = speciesOf(owner);
      if (species === "raster") {
        // El borde exterior de la imagen. La app decide de donde sale: la caja
        // si esta llena, su silueta real si viene recortada. El cliente solo
        // aprieta Contorno. Trazar es OTRA herramienta y no se llama desde aca.
        const rect = createRasterBorderContour(owner, { ...readOutlineControls(), ...options });
        if (rect) results.push(rect);
      } else if (species === "text") {
        if (typeof window.convertTextToVector !== "function") continue;
        // convertTextToVector es async: hay que esperar al vector nuevo antes
        // de engrosarlo, o se engrosa una Promise y no pasa nada.
        const converted = await window.convertTextToVector(owner);
        if (!converted) continue;
        const contoured = vectorContour(converted);
        if (contoured) results.push(contoured);
      } else {
        const contoured = vectorContour(owner);
        if (contoured) results.push(contoured);
      }
    }
  } catch (e) {
    return fail(e);
  }
  if (!results.length) return fail("contorno-empty");
  // El Deshacer se guarda siempre que se haya creado algo, con o sin fondo:
  // si el cliente creo un contorno, tiene que poder deshacerlo.
  window.saveHistory?.();
  if (ownsHistory) window.commitHistoryTransaction?.("contorno");
  window.deselectItem?.();
  results.forEach((item, index) => window.selectItem?.(item, index > 0));
  paper.view?.update?.();
  return results;
}

if (typeof window !== "undefined") {
  window.aplicarContorno = aplicarContorno;
  window.createBoundingContour = createBoundingContour;
  window.createRasterBorderContour = createRasterBorderContour;
  window.isSingleClosedContour = isSingleClosedContour;
}
