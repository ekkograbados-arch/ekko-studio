import { getPublicOwner, isMockupOrMask, isContainmentWrapper } from "./designGeometry.js";
import { isCutLine, semanticKind, VECTOR_KIND } from "./vectorSemantics.js";

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
  // Relleno <-> trazo, con ancho y lado. Ruta ya existente y probada.
  if (typeof window.toggleOutline === "function") return window.toggleOutline(owner);
  return null;
}

/**
 * Punto de entrada unico. Delega segun la especie; no decide nada de
 * visibilidad (eso es trabajo del motor de capacidades).
 */
export function aplicarContorno(items = null, options = {}) {
  const selection = (items || (Array.isArray(window.selectedItems) && window.selectedItems.length
    ? window.selectedItems
    : (window.selectedItem ? [window.selectedItem] : [])))
    .filter(item => item && isDesignObject(item))
    .map(ownerOf);

  if (!selection.length) return null;
  window.beginHistoryTransaction?.("contorno");
  const results = [];
  try {
    selection.forEach(owner => {
      const species = speciesOf(owner);
      if (species === "raster") {
        // El cliente decide: con fondo -> recuadro, sin fondo -> calcar.
        if (options.withBackground) results.push(createBoundingContour(owner, options));
        else if (typeof window.openImageTraceModal === "function") results.push(window.openImageTraceModal(owner));
      } else if (species === "text") {
        if (typeof window.convertTextToVector === "function") {
          const converted = window.convertTextToVector(owner);
          if (converted) results.push(vectorContour(converted));
        }
      } else {
        results.push(vectorContour(owner));
      }
    });
  } catch (e) {
    window.cancelHistoryTransaction?.("contorno-failed");
    console.warn("[EKKO CONTORNO] no se pudo crear el contorno:", e);
    return null;
  }
  const created = results.filter(Boolean);
  if (created.length && !options.withBackground) {
    window.saveHistory?.();
    window.commitHistoryTransaction?.("contorno");
  } else {
    window.cancelHistoryTransaction?.("contorno-empty");
  }
  if (created.length) {
    window.deselectItem?.();
    created.forEach((item, index) => window.selectItem?.(item, index > 0));
    paper.view?.update?.();
  }
  return created;
}

if (typeof window !== "undefined") {
  window.aplicarContorno = aplicarContorno;
  window.createBoundingContour = createBoundingContour;
  window.isSingleClosedContour = isSingleClosedContour;
}
