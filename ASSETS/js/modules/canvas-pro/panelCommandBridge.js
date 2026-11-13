import { isProductElement, isValidFusionReceptor, isClosedClientVector, canConvertToCalado, findFusionVector, findFusionRaster } from "./fusionCore.js";
import { canConvertSelectionToCalado, convertSelectionToSolid } from "./calado.js";
import { semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { dispatchUngroup, dispatchVectorDecomposition, canDecomposeVector, getUngroupRoute, UNGROUP_ROUTE } from "./ungroupRoutes.js";
import { getPublicOwner, getOwnerLocalGeometry, isMockupOrMask } from "./designGeometry.js";
import { installOwnerGeometry, recalculateDynamicSubtractions, normalizeSubtractiveOperand } from "./geometricUngroup.js";
import { isToolEnabled, legacyNamesFor, legacyNamesForTab } from "./capabilities.js";
import { aplicarContorno } from "./contorno.js";
// mirrorSelection avisa cuando no hay nada que voltear. Sin este import,
// notice no existia en el ambito del modulo y el comando reventaba al
// ejecutarse: el boton del espejo no hacia nada y noavia por que.
import { notice } from "./ekkoNotice.js";

/* =========================================================================
   EKKO STUDIO — PANEL COMMAND BRIDGE / FASE 4.2
   Fuente única para sincronizar los comandos visibles en:
   - panel superior (#topBar)
   - barra profesional (#pro-layout-toolbar)
   - barra emergente (#contextual-toolbar)

   No ejecuta operaciones geométricas. Solo decide qué comandos se muestran.
========================================================================= */

const PRO_COMMAND_IDS = {
    proBtnFusionar: "fusion",
    proBtnQuitarFusion: "unfusion",
    proBtnCalado: "calado",
    proBtnSolidHole: "solidHole",
    proBtnRellenar: "rellenar",
    proBtnTextToVector: "textToVector",
    proBtnGroup: "group",
    proBtnUngroup: "ungroup",
    proBtnDecomposeVector: "decomposeVector",
    proBtnEditNodes: "editNodes",
    proBtnDistributeH: "distribute",
    proBtnDistributeV: "distribute",
    proBtnToggleRulers: "rulers",
    proBtnToggleGuides: "guides",
    proBtnToggleMeasurements: "measurements",
    proBtnCenterH: "centerH",
    proBtnCenterV: "centerV",
    proBtnCenterBoth: "centerBoth",
    proBtnAlignLeft: "align",
    proBtnAlignCenterH: "align",
    proBtnAlignRight: "align",
    proBtnAlignTop: "align",
    proBtnAlignCenterV: "align",
    proBtnAlignBottom: "align",
    // Boolean operations
    proBtnBooleanUnion: "booleanUnion",
    proBtnBooleanSubtract: "booleanSubtract",
    proBtnBooleanIntersect: "booleanIntersect",
    proBtnBooleanDifference: "booleanDifference"
};


let initialized = false;
let refreshTimer = null;
let commandDispatcherInstalled = false;

// Registry of commands declared by data-ekko-command.  The bridge is the
// single UI entry point; the registry only delegates to existing owners.
const COMMAND_HANDLERS = Object.freeze({
    rellenar: () => convertSelectionToSolid(),
    // Contorno unificado: vector <-> trazo, texto -> vector -> trazo,
    // imagen -> calcar silueta (o recuadro si el cliente dice que tiene fondo).
    contorno: () => aplicarContorno(),
    solidHole: () => invertSelectionRoles(),
    performSmartFusion: () => typeof window.performSmartFusion === "function"
        ? window.performSmartFusion()
        : null,
    abrirEditorFondo: () => window.abrirEditorFondo?.() ?? false,
    releaseSmartFusion: () => {
        if (typeof window.releaseSmartFusion !== "function") return null;
        const selected = window.selectedItems && window.selectedItems.length
            ? [...window.selectedItems]
            : (window.selectedItem ? window.selectedItem : null);
        return window.releaseSmartFusion(selected);
    },
    ungroup: () => dispatchUngroup(),
    decomposeVector: () => dispatchVectorDecomposition(),
    // TRAZAR = calcar el objeto ENTERO: borde por fuera y detalle por
    // adentro. Es una herramienta DISTINTA de Contorno, que solo dibuja la
    // linea del borde exterior. Antes este boton ejecutaba "contorno", asi
    // que Trazar no trazaba: le ponia un borde y nada mas.
    traceImage: () => (typeof window.traceRaster === "function" ? window.traceRaster() : null),
    // Boolean operations (vector ↔ vector)
    booleanUnion: () => performBooleanOperation("union"),
    booleanSubtract: () => performBooleanOperation("subtract"),
    booleanIntersect: () => performBooleanOperation("intersect"),
    booleanDifference: () => performBooleanOperation("difference"),

    // Espejo H y V. Estos dos botones existian en la barra pero no tenian
    // NADA conectado: apretarlos no hacia nada. El motor ya declaraba la
    // herramienta "Voltear" como siempre activa, o sea que la capacidad
    // estaba; faltaba la accion.
    flipH: () => mirrorSelection("horizontal"),
    flipV: () => mirrorSelection("vertical"),

    // Retoque del recorte con pincel. El panel ya existia en el HTML pero sus
    // cuatro botones no tenian nada conectado: apretarlos no hacia nada.
    pincelBorrar: () => setPincel("borrar"),
    pincelRestaurar: () => setPincel("restaurar"),
    deshacerRetoque: () => EKKO.BackgroundRemover?.deshacerRetoque?.(),
    rehacerRetoque: () => EKKO.BackgroundRemover?.rehacerRetoque?.(),
    aceptarRetoque: () => EKKO.BackgroundRemover?.cerrarRetoque(),
});

/** Elige el pincel activo sin abrir el panel dos veces. */
function setPincel(modo) {
    // El estado del pincel vive SOLO en BackgroundRemover. Antes este bloque
    // se limitaba a pintar un outline por CSS y ademas corria DESPUES de
    // abrirRetoque(), que ya habia marcado el boton: el segundo marcado pisaba
    // al primero y dejaba el pincel inactivo con el boton resaltado.
    const api = EKKO.BackgroundRemover;
    if (api && typeof api.elegirPincel === "function") return !!api.elegirPincel(modo);

    // Respaldo si la API todavia no expone elegirPincel.
    const b = document.getElementById(modo === "borrar" ? "pincel-borrar" : "pincel-restaurar");
    const r = document.getElementById(modo === "borrar" ? "pincel-restaurar" : "pincel-borrar");
    if (b) b.style.outline = "3px solid #0f172a";
    if (r) r.style.outline = "none";
    return true;
}

/**
 * Espejo del objeto (o de varios) sobre su propio eje.
 *
 * No se puede usar item.scale(-1, 1): paper.js no admite escala negativa y
 * dejaria la matriz del objeto envenenada. Tampoco sirve aplicar el cambio y
 * llamar a syncGeometryToGeomBase(), porque geomBase es la referencia con la
 * que el motor reconstruye la escena: un espejo guardado ahi no seria un
 * espejo sino una pieza deformada.
 *
 * Por eso el espejo se hornea en la geometria: se calcula el ancho real de
 * cada hijo y se invierte punto por punto. Asi el resultado es una pieza
 * legitima, con la misma logica que usa la fusion y los calados.
 */
function mirrorSelection(sentido) {
    const seleccion = (Array.isArray(window.selectedItems) && window.selectedItems.length)
        ? [...window.selectedItems]
        : (window.selectedItem ? [window.selectedItem] : []);
    if (!seleccion.length) {
        notice("Seleccioná primero un objeto para voltearlo.", { kind: "warn" });
        return null;
    }

    const pieza = (seleccion[0] instanceof paper.Group) ? seleccion[0] : seleccion[0];
    const contenedor = pieza.parent;
    const horizontal = sentido === "horizontal";

    // Se trabaja sobre un clon, se hornea, y recién ahi se cambia: el
    // original queda intacto hasta que el espejo esta comprobado.
    const horneado = hornearEspejo(pieza, horizontal);
    if (!horneado) {
        notice("Ese objeto no se puede voltear.", { kind: "warn" });
        return null;
    }

    if (typeof window.saveHistory === "function") window.saveHistory();
    try { if (window.beginHistoryTransaction) window.beginHistoryTransaction("espejo"); } catch (_) {}

    const indice = contenedor ? contenedor.children.indexOf(pieza) : -1;
    pieza.remove();
    horneado.data = {
        ...(pieza.data || {}),
        label: (pieza.data && pieza.data.label) || pieza.name || "Objeto",
        mirrored: horizontal ? "h" : "v"
    };
    if (contenedor) {
        if (indice >= 0) contenedor.insertChild(indice, horneado);
        else contenedor.addChild(horneado);
    } else {
        (paper.project.activeLayer || paper.project.layers[0]).addChild(horneado);
        if (window.currentMockup) {
            try { horneado.insertBelow(window.currentMockup); } catch (_) {}
        }
    }

    try { window.syncGeometryToGeomBase?.(horneado); } catch (_) {}
    try { window.recalculateDynamicSubtractions?.(); } catch (_) {}
    try { if (window.commitHistoryTransaction) window.commitHistoryTransaction("espejo"); } catch (_) {}
    try { if (window.selectItem) window.selectItem(horneado); } catch (_) {}
    try { paper.view?.update?.(); } catch (_) {}

    return horneado;
}

/** Devuelve un clon de la pieza con la geometria ya invertida. */
function hornearEspejo(pieza, horizontal) {
    const clon = pieza.clone({ insert: false });
    if (!clon) return null;
    const caja = pieza.bounds;
    if (!caja || !(caja.width > 0) || !(caja.height > 0)) return null;

    // Se invierte cada hijo en su propia caja, y despues se recoloca la pieza
    // para que siga donde estaba: el cliente no quiere ver el objeto saltar.
    const invertir = (item) => {
        if (item.children) item.children.forEach(invertir);
        if (!item.segments || !item.segments.length) return;
        const b = item.bounds;
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        item.segments.forEach((seg) => {
            if (horizontal) seg.point.x = 2 * cx - seg.point.x;
            else seg.point.y = 2 * cy - seg.point.y;
        });
        // Un camino espejado invierte su sentido de recorrido.
        if (item.closed) item.reverse?.();
    };
    invertir(clon);

    // La posicion original se restaura porque el clon nace en el mismo lugar
    // pero con la caja espejada.
    if (horizontal) clon.position.x = pieza.position.x;
    else clon.position.y = pieza.position.y;
    return clon;
}

export function dispatchEKKOCommand(command, element = null) {    const handler = COMMAND_HANDLERS[command];
    if (typeof handler !== "function") {
        console.warn(`[EKKO COMMANDS] Comando no registrado: ${command}`);
        return null;
    }
    try {
        const result = handler(element);
        window.EKKO_DIAG?.logEvent?.("command.dispatch", {
            command,
            elementId: element?.id || null,
            ok: true
        });
        return result;
    } catch (error) {
        window.EKKO_DIAG?.logEvent?.("command.dispatch", {
            command,
            elementId: element?.id || null,
            ok: false,
            error: String(error)
        });
        console.error(`[EKKO COMMANDS] Fallo en ${command}`, error);
        return null;
    }
}

function installCommandDispatcher() {
    // Listen on document, not #workspace: the floating contextual toolbar is
    // moved to document.body at runtime (contextualMenu.js), so workspace
    // scoped clicks never reach its [data-ekko-command] buttons (Rellenar,
    // Desagrupar, Descomponer...). The selector already scopes the handler.
    if (commandDispatcherInstalled) return;

    /* Fase 1 UI: un botón bloqueado (.ekko-locked, la clase la escribe
       ribbonRenderer.js) NO debe ejecutar su acción ni tragarse el clic en
       silencio. Este interceptor corre en captura ANTES del dispatcher de
       abajo (el orden de registro decide en la misma fase y target): convierte
       el clic en un aviso con el motivo y corta el resto de la cadena
       (stopImmediatePropagation), incluido el onclick en línea. */
    document.addEventListener("click", event => {
        const locked = event.target?.closest?.(".ekko-locked");
        if (!locked || !document.contains(locked)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const motivo = locked.getAttribute("data-ekko-reason")
            || "Acción no disponible para la selección actual";
        const fn = window.ekkoNotice || (window.EKKO_NOTICE && window.EKKO_NOTICE.notice);
        if (typeof fn === "function") fn(motivo, { kind: "warn" });
    }, true);

    document.addEventListener("click", event => {
        const element = event.target?.closest?.("[data-ekko-command]");
        if (!element || !document.contains(element)) return;
        if (element.disabled || element.classList.contains("ekko-command-hidden")) return;

        // Capture declared commands before any future inline/bubble handler.
        event.preventDefault();
        event.stopPropagation();
        dispatchEKKOCommand(element.dataset.ekkoCommand, element);
    }, true);
    commandDispatcherInstalled = true;
}

function unwrap(item) {
    // Un wrapper sin propietario marcado sigue siendo un candidato válido:
    // devolver null lo saca de classifySelection y mata los botones
    // Calado/Rellenar para selecciones de wrapper (p. ej. un calado recién
    // aplicado dentro de su clip-group de contención).
    return getPublicOwner(item) || item;
}

/* Un click sobre una letra CompoundPath deja en window.selectedItems el Path
   HIJO (data vacia): getPublicOwner no lo resuelve, semanticKind devuelve
   null y el boton Solidos<->Huecos queda MUDO (ninguna rama convierte), y
   booleanOperandOperators terminaria operando con el contorno suelto en vez
   de la letra completa. Se sube por la pila hasta el antepasado con datos de
   diseno, sin cruzar el wrapper de contencion ni el mockup. */
function resolverOwnerDeSeleccion(item) {
    let current = item;
    for (let guard = 0; current && current.parent && guard < 8; guard += 1) {
        const parent = current.parent;
        /* Un CONTORNO (Path hijo de un CompoundPath) nunca es dueno propio:
           la pieza es el compound entero. Vale aunque el contorno arrastre
           datos heredados: la resta dinamica adopta los operandos como
           contornos y les deja isCalado/isHole; sin este salto, un clic sobre
           el anillo de una pieza ya perforada elegia el contorno desmembrado
           como operando y la booleana corrompia el compound (medido 2026-11-13). */
        if (current.className === "Path" && parent.className === "CompoundPath") {
            current = parent;
            continue;
        }
        const data = current.data || {};
        if (data.semanticKind || data.isHole === true || data.isSolidShape === true ||
            data.isCalado === true || data.userImported || data.label ||
            data.isSmartFusion || data.originalVectorData) break;
        const pData = parent.data || {};
        if (pData.clipGroup === true || pData.mockup || pData.isMask) break;
        if (parent.className === "CompoundPath" || parent.className === "Group") {
            current = parent;
        } else break;
    }
    return current;
}

/* Un import de SVG (las letras de SARA, texto vectorizado, etc.) vive como UN
   Grupo con los datos de origen (source/userImported) en el GRUPO y las letras
   hijas Path/CompoundPath SIN datos propios. La seleccion natural del cliente
   es ese grupo entero (una caja con manijas), y expandirlo es la unica forma
   de que Solidos<->Huecos y las booleanas vean cada letra. Nunca se expande
   una fusion (isSmartFusion): su grupo era y sigue siendo rechazado entero. */
function expandirVectoresEditables(owner, contexto = null, depth = 0) {
    if (!owner || depth > 4) return [];
    if (owner.className === "Path" || owner.className === "CompoundPath") {
        return [heredarDatosDeImportacion(owner, contexto)];
    }
    if (owner.className !== "Group") return [];
    const gd = owner.data || {};
    if (gd.isSmartFusion || gd.isFusionMask || gd.mockup || gd.isMask) return [];
    // El antepasado que carga la identidad del import (o del rotulado) es el
    // contexto que heredan las hojas desnudas.
    const ctx = (gd.userImported || gd.source || gd.label || gd.semanticKind ||
        gd.isHole === true || gd.isSolidShape === true) ? owner : contexto;
    const hojas = [];
    (owner.children || []).forEach(child => {
        if (!child || child.clipMask) return;
        const d = child.data || {};
        if (d.mockup || d.isMask || d.isFusionMask || d.isSmartFusion ||
            d.isSelectionBox || d.isHandle) return;
        hojas.push(...expandirVectoresEditables(child, ctx, depth + 1));
    });
    return hojas;
}

/* El import estampa source/userImported en la RAIZ del SVG; las hojas pueden
   quedar desnudas y entonces semanticKind devuelve null y canConvertToCalado
   las rechaza (boton mudo con la seleccion de grupo). Copiamos SOLO la
   identidad minima que falta, sin pisar ningun dato propio de la hoja. */
function heredarDatosDeImportacion(hoja, owner) {
    try {
        const gd = owner?.data || {};
        if (!gd.userImported) return hoja;
        const data = { ...(hoja.data || {}) };
        let cambio = false;
        if (!data.userImported) { data.userImported = true; cambio = true; }
        if (!data.source &&
            ["client-svg", "text-vector", "traced", "calado"].includes(gd.source)) {
            data.source = gd.source;
            cambio = true;
        }
        if (cambio) hoja.data = data;
    } catch (_) {}
    return hoja;
}

function getSelectedItems() {
    if (window.selectedItems && window.selectedItems.length) return [...window.selectedItems];
    return window.selectedItem ? [window.selectedItem] : [];
}

// =========================================================================
// BOOLEANAS VECTOR <-> VECTOR
// =========================================================================
// Paper.js lee coordenadas crudas de segmento e ignora `item.matrix` mientras
// `applyMatrix` es false. Por eso cada operando se hornea en coordenadas de
// proyecto antes de operar y el resultado aceptado vuelve al marco local del
// propietario con installOwnerGeometry (geometryIsLocal = false).
//
// La union es la unica operacion que se puede repetir sobre el resultado sin
// perder material: por eso las formas que se solapan por completo deben fundirse
// en un solo owner (ver exportSVG.js / union anti-doble-grabado).
//
// NOTA: "difference" NO usa exclude(). Con operandos de orientacion homogenea
// el kernel de Paper devuelve un CompoundPath de area ~0 en lugar de la
// diferencia simetrica. Se compone con las dos mitades, que si se apoyan en
// subtract() y unite(), las primitivas ya verificadas por el CSG.
const BOOLEAN_OPERATIONS = Object.freeze({
    union: { method: "unite", oriented: false },
    subtract: { method: "subtract", oriented: true },
    intersect: { method: "intersect", oriented: false },
    difference: { method: "difference", oriented: true }
});

const BOOLEAN_MIN_AREA = 1e-6;
const BOOLEAN_AREA_TOLERANCE = 1e-6;

/* Banda de trazo (stroke -> material relleno) para trazos ABIERTOS sin
   relleno: paper.js 0.12 no trae outlineStroke, así que se aplanan las
   curvas y se construye el polígono paralelo a ambos lados con los normales
   de cada muestra. Devuelve un PathItem de proyecto o null si no hay banda
   aprovechable. Sirve para que Restar/Interseccion con lineas funcionen con
   el GROSOR real que el cliente ve pintado. */
function bandaDeTrazo(item) {
    try {
        const grosor = item.strokeWidth || 0;
        if (grosor <= 0) return null;
        const half = grosor / 2;
        const cadenas = [];
        if (item.hasChildren?.()) {
            item.children.forEach(ch => {
                if (ch.className === "Path" && ch.closed === false) cadenas.push(ch);
            });
        } else if (item.className === "Path" && item.closed === false) {
            cadenas.push(item);
        }
        if (!cadenas.length) return null;
        let masForma = null;
        for (const cad of cadenas) {
            const copia = cad.clone({ insert: false });
            copia.applyMatrix = true;
            try { copia.transform(copia.matrix || new paper.Matrix()); } catch (_) {}
            copia.applyMatrix = false;
            copia.matrix = new paper.Matrix();
            try { copia.flatten(0.4); } catch (_) {}
            const pts = copia.segments.map(s => s.point.clone());
            copia.remove?.();
            if (pts.length < 2) return null;
            const izquierda = [];
            const derecha = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[Math.max(0, i - 1)];
                const b = pts[Math.min(pts.length - 1, i + 1)];
                let dx = b.x - a.x, dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                dx /= len; dy /= len;
                // normal izquierda de la direccion
                const nx = -dy, ny = dx;
                izquierda.push(new paper.Point(pts[i].x + nx * half, pts[i].y + ny * half));
                derecha.push(new paper.Point(pts[i].x - nx * half, pts[i].y - ny * half));
            }
            const banda = new paper.Path({ insert: false, closed: true });
            banda.moveTo(izquierda[0]);
            for (let i = 1; i < izquierda.length; i++) banda.lineTo(izquierda[i]);
            for (let i = derecha.length - 1; i >= 0; i--) banda.lineTo(derecha[i]);
            banda.closePath();
            banda.fillColor = item.strokeColor || "#000000";
            banda.fillRule = "nonzero";
            if (!masForma) masForma = banda;
            else {
                const unida = masForma.unite(banda, { insert: false });
                try { banda.remove(); } catch (_) {}
                try { masForma.remove(); } catch (_) {}
                masForma = unida || masForma;
            }
        }
        return (masForma && Math.abs(masForma.area || 0) > 0) ? masForma : null;
    } catch (_) { return null; }
}

/* Punto de prueba DENTRO DE LA BANDA del contorno. getInteriorPoint() queda
   descartado para clasificar contornos anidados: en un aro devuelve un punto
   cerca del centroide, que cae DENTRO del contador interior, y entonces el
   contorno EXTERIOR parecia contenido por el interior (medido con la O: ambos
   contornos salian "hueco" y el relleno salia copia entera de la letra,
   tapando el calado). Lo correcto es un punto apenas hacia adentro desde el
   borde del propio contorno: vive en su banda, no en sus huecos. */
function puntoDeBandaContorno(hoja) {
    try {
        if (!hoja || hoja.isEmpty?.()) return null;
        const largo = hoja.length || 0;
        let borde = null;
        try { borde = largo > 0 ? hoja.getPointAt(largo * 0.25) : null; } catch (_) {}
        if (!borde) {
            try { borde = hoja.curves?.[0]?.getPoint(0) || hoja.firstSegment?.point || null; } catch (_) {}
        }
        if (!borde) return null;
        let tangente = null;
        try { tangente = largo > 0 ? hoja.getTangentAt(largo * 0.25) : null; } catch (_) {}
        if (!tangente) { try { tangente = hoja.curves?.[0]?.getTangent(0) || null; } catch (_) {} }
        const normal = tangente ? new paper.Point(-tangente.y, tangente.x) : new paper.Point(0, 1);
        const caja = hoja.bounds;
        const paso = Math.max(0.5, Math.min(caja.width, caja.height) * 0.02);
        const candidatos = [borde.add(normal.multiply(paso)), borde.subtract(normal.multiply(paso))];
        for (const candidato of candidatos) {
            try { if (hoja.contains(candidato)) return candidato; } catch (_) {}
        }
        // Ultimo recurso: el punto interior clasico (mejor que nada).
        try { return hoja.getInteriorPoint?.() || borde; } catch (_) { return borde; }
    } catch (_) { return null; }
}

/* El kernel de Paper necesita orientaciones coherentes entre los operandos:
   un contador que vuelve invertido (area negativa) o un compuesto con vueltas
   mezcladas hace que unite/intersect tiren fallos o areas absurdas (se vio con
   piezas importadas de letras: Union/Interseccion morian y Restar, que si
   normaliza, funcionaba). Se uniforma PRESERVANDO la topologia: dentro de cada
   operando, el contorno que queda bajo una cantidad IMPAR de otros contornos
   gira antihorario (hueco) y el resto horario (materia). Los clones horneados
   nunca tocan la escena, asi que el giro no cambia ninguna pieza real. */
function uniformarOrientacionOperandos(geometria) {
    try {
        if (!geometria) return geometria;
        if (geometria.className === "CompoundPath" && Array.isArray(geometria.children)) {
            const hojas = geometria.children.filter(ch => ch && ch.className === "Path");
            // Techo de seguridad: con cientos de contornos (trazados) el test de
            // contencion es O(n^2); ahi se deja la geometria como vino.
            if (hojas.length < 2 || hojas.length > 80) return geometria;
            const puntos = hojas.map(hoja => puntoDeBandaContorno(hoja));
            hojas.forEach((hoja, i) => {
                const punto = puntos[i];
                if (!punto) return;
                let dentro = 0;
                hojas.forEach((otra, j) => {
                    if (j === i) return;
                    try { if (otra.contains(punto)) dentro += 1; } catch (_) {}
                });
                try { hoja.setClockwise(dentro % 2 === 0); } catch (_) {}
            });
            return geometria;
        }
        try { geometria.setClockwise?.(true); } catch (_) {}
        return geometria;
    } catch (_) { return geometria; }
}

function bakeBooleanOperand(item) {
    /* Un GRUPO seleccionado es UN operando compuesto: se hornea la UNION de
       sus hojas (cada una con su bake propio: banda de trazo, matrix global).
       El resultado es un Path/CompoundPath unico, que es lo que el kernel de
       paper exige como operando (un Group no soporta unite/intersect). */
    if (item.className === "Group") {
        let union = null;
        for (const hoja of expandirVectoresEditables(item)) {
            const horneada = bakeBooleanOperand(hoja);
            if (!horneada) continue;
            if (Math.abs(horneada.area || 0) <= BOOLEAN_MIN_AREA) {
                try { horneada.remove(); } catch (_) {}
                continue;
            }
            union = union ? union.unite(horneada, { insert: false }) : horneada;
            if (union !== horneada) { try { horneada.remove(); } catch (_) {} }
        }
        if (union && Math.abs(union.area || 0) > BOOLEAN_MIN_AREA) return union;
        try { union?.remove?.(); } catch (_) {}
        return null;
    }
    let clone = item.clone({ insert: false });
    try {
        const matrix = item.globalMatrix?.clone?.() || clone.matrix?.clone?.();
        clone.applyMatrix = false;
        clone.matrix = new paper.Matrix();
        if (matrix && !matrix.isIdentity()) clone.transform(matrix);
        clone.applyMatrix = true;
    } catch (_) {}
    // Un trazo ABIERTO (linea, zigzag, garabato) no tiene interior: para el
    // kernel su area es 0, de modo que Restar no cambia nada e Interseccion
    // queda vacia ("no funciona"). El GROSOR del trazo si es material real
    // para el laser: se convierte en banda (el mismo gesto que ve el cliente
    // pintado). La misma boca alimenta previsualizacion y ejecucion, asi el
    // fantasma nunca miente.
    try {
        const hijos = Array.isArray(clone.children) ? clone.children : null;
        const esAbierto = clone.closed === false || (hijos ? hijos.some?.(ch => ch && ch.closed === false) : false);
        const sinRelleno = !clone.fillColor;
        const conGrosor = (clone.strokeWidth || 0) > 0;
        if (esAbierto && sinRelleno && conGrosor) {
            const banda = bandaDeTrazo(clone);
            if (banda && Math.abs(banda.area || 0) > BOOLEAN_MIN_AREA) {
                try { clone.remove?.(); } catch (_) {}
                return uniformarOrientacionOperandos(banda);
            }
            try { banda?.remove?.(); } catch (_) {}
        }
    } catch (_) {}
    return uniformarOrientacionOperandos(clone);
}

function booleanStackPath(item) {
    const path = [];
    const seen = new Set();
    let node = item;
    while (node && !seen.has(node)) {
        seen.add(node);
        if (typeof node.index === "number") path.unshift(node.index);
        node = node.parent;
    }
    return path;
}

// Z-order real: la forma mas baja es el material y la de encima es el cutter.
// Sin esto "Restar" dependeria del orden de seleccion, que es arbitrario.
function compareBooleanStack(a, b) {
    const left = booleanStackPath(a);
    const right = booleanStackPath(b);
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
        const lv = left[i] ?? -1;
        const rv = right[i] ?? -1;
        if (lv !== rv) return lv - rv;
    }
    return 0;
}

function isBooleanOperand(owner) {
    if (!owner || !owner.project) return false;
    if (owner.className !== "Path" && owner.className !== "CompoundPath") return false;
    const data = owner.data || {};
    if (data.mockup || data.isMask || data.isFusionMask || data.isSmartFusion) return false;
    try { if (isProductElement(owner)) return false; } catch (_) { return false; }
    // Un calado es un hueco: no se funde, se conserva y sigue perforando.
    try { if (semanticKind(owner) === VECTOR_KIND.HOLE) return false; } catch (_) {}
    return true;
}

function booleanOperandOwners() {
    // Los calados SIEMPRE son operandos validos para el conteo/gate: el
    // cliente pide booleanas con cualquier vector editable por nodos, y los
    // textos vectorizados o piezas caladas tambien entran.
    // performBooleanOperation materializa cada calado (el anillo del hueco
    // pasa a ser materia) justo antes de operar; aca solo se CUENTA, sin
    // efectos secundarios (la misma lista alimenta el gate, la
    // previsualizacion y la ejecucion, asi ninguna miente a las otras).
    // Regla del dueno: el MOCKUP no participa. Ademas de la marca propia
    // (data.mockup / isMask), se excluye por ascendencia: una forma que viva
    // dentro del group del mockup o de una de sus mascaras es parte del
    // producto, y jamas es material de una booleana.
    const esMaterialDelMockup = (owner) => {
        for (let anc = owner && owner.parent; anc && anc !== paper.project; anc = anc.parent) {
            if (anc === window.currentMockup) return true;
            const ad = anc.data || {};
            if (ad.mockup || ad.isMask || ad.isFusionMask || ad.isSmartFusion) return true;
        }
        return false;
    };
    const seen = new Set();
    return getSelectedItems()
        .map(item => resolverOwnerDeSeleccion(unwrap(item)))
        .flatMap(owner => {
            /* El grupo entero (import de SARA, agrupado manual) entra como UN
               operando compuesto: el cliente espera "el grupo" contra "la otra
               forma" (silueta del grupo ∩ huella). Si cada hoja entrase como
               operando separado, la interseccion n-aria daria vacio en cuanto
               UNA hoja no tocara a las demas formas (letras 1-3 vs la huella:
               vacio sin resultado y sin preview). */
            if (owner && owner.className === "Group") return [owner];
            return expandirVectoresEditables(owner);
        })
        .filter(owner => {
            if (!owner || seen.has(owner)) return false;
            /* El grupo (unidad compuesta) es operando valido; rasters y demas
               clases no vectoriales siguen fuera. */
            const esGrupoUnidad = owner.className === "Group";
            if (!esGrupoUnidad && owner.className !== "Path" && owner.className !== "CompoundPath") return false;
            const data = owner.data || {};
            if (data.mockup || data.isMask || data.isFusionMask || data.isSmartFusion) return false;
            try { if (isProductElement(owner)) return false; } catch (_) { return false; }
            try { if (esMaterialDelMockup(owner)) return false; } catch (_) { return false; }
            seen.add(owner);
            return true;
        });
}

function commitBooleanResult(keeper, ownsHistory = false) {
    try { recalculateDynamicSubtractions?.(); } catch (_) {}
    window.deselectItem?.();
    if (typeof window.commitSelection === "function") {
        window.commitSelection(keeper, keeper ? [keeper] : []);
    }
    if (keeper) {
        try { keeper.selected = true; } catch (_) {}
    }
    window.updateSelectionBox?.(keeper);
    window.updateContextualMenu?.(keeper);
    paper.view?.update?.();
    if (ownsHistory) {
        // Mark the already-open transaction dirty so commitHistoryTransaction
        // stores the pre-boolean state for Undo.
        window.saveHistory?.();
        window.commitHistoryTransaction?.("boolean");
    }
    return keeper;
}

// Diferencia simetrica A xor B = (A - B) + (B - A). Ambas mitadas son disjuntas,
// de modo que la union de las dos no reintroduce material. Como el XOR es
// asociativo, plegar el resultado contra cada operando successive da la
// diferencia simetrica n-aria sin acumulacion de error.
function booleanDifference(keep, drop) {
    const left = keep.subtract(drop, { insert: false });
    if (!left) return null;
    const right = drop.subtract(keep, { insert: false });
    if (!right) {
        try { left.remove(); } catch (_) {}
        return null;
    }
    const merged = left.unite(right, { insert: false });
    try { left.remove(); } catch (_) {}
    try { right.remove(); } catch (_) {}
    return merged;
}

function performBooleanOperation(operation) {
    const spec = BOOLEAN_OPERATIONS[operation];
    if (!spec) return null;

    const ownersBrutos = booleanOperandOwners();
    if (ownersBrutos.length < 2) {
        console.warn("[EKKO BOOLEAN] Se necesitan al menos 2 vectores. El mockup y las mascaras no participan.");
        return null;
    }

    // Use one explicit history transaction for the whole boolean mutation.
    // A direct save can be swallowed by an already active transform/fusion
    // transaction, leaving Undo with no pre-boolean snapshot.
    const ownsHistory = !window._ekkoHistoryTransaction?.active;
    if (ownsHistory) window.beginHistoryTransaction?.("boolean");
    const rejectBoolean = reason => {
        if (reason === "empty" || reason === "empty-area") {
            /* La booleana SÍ corrió, pero no deja material (piezas que no se
               tocan, o una tapa por completo a la otra). Sin este aviso el
               dueño cree que el botón está roto: "no colorea nada". */
            try {
                notice("La booleana no dejó ningún pedazo: las piezas no comparten área, o una tapa por completo a la otra. No se cambió nada.", { kind: "warn" });
            } catch (_) {}
        }
        if (ownsHistory) window.cancelHistoryTransaction?.(reason || "boolean-failed");
        return null;
    };

    /* Los operando se usan TAL CUAL estan en la escena. El CSG solo necesita
       GEOMETRIA: bakeBooleanOperand hornea clones con el area real de cada
       pieza (huecos incluidos), asi que NO hace falta materializar los calados
       antes de operar. Materializarlos ADELANTE era el defecto que el dueño
       vio: si la booleana despues no dejaba material (interseccion de un
       cuerpo con su interior, piezas que no se tocan), el hueco ya habia sido
       rellenado por convertSelectionToSolid y el "rollback" de la transaccion
       NO restaura la escena: quedaba "solo rellena el hueco y no une nada",
       el aviso mentia ("no se cambio nada") y Ctrl+Z no tenia entrada a la
       que volver. Con este orden, un fallo NO toca la escena y el undo solo
       se compromete cuando la operacion de verdad cambio algo. */
    const owners = [];
    const yaEnLaLista = new Set();
    for (const owner of ownersBrutos) {
        if (yaEnLaLista.has(owner)) continue;
        yaEnLaLista.add(owner);
        owners.push(owner);
    }
    if (owners.length < 2) {
        return rejectBoolean("boolean-operands-insufficient");
    }

    const ordered = owners.slice().sort(compareBooleanStack);
    const base = ordered[0];
    const baked = ordered.map(bakeBooleanOperand);
    const sourceArea = baked.reduce((total, geometry) => total + Math.abs(geometry?.area || 0), 0);

    let result = baked[0];
    let failure = null;

    for (let i = 1; i < baked.length && !failure; i++) {
        const subject = result;
        let cutter = baked[i];
        // El CSG ya demostro que subtract() necesita operandos con orientacion
        // uniforme: un CompoundPath de texto descomuesto puede reportar mal
        // isClockwise() y devolver un area mayor que la original en vez de
        // perforar. Normalizar contra el sujeto es la misma defensa.
        if (spec.oriented) {
            try { cutter = normalizeSubtractiveOperand(cutter, subject); } catch (_) {}
        }
        try {
            const next = spec.method === "difference"
                ? booleanDifference(subject, cutter)
                : subject[spec.method](cutter, { insert: false });
            try { subject.remove(); } catch (_) {}
            if (cutter !== baked[i]) { try { cutter.remove(); } catch (_) {} }
            result = next;
            if (!result) failure = "sin geometria resultante";
        } catch (error) {
            console.error(`[EKKO BOOLEAN] Fallo en ${operation}:`, error);
            failure = String(error?.message || error);
        }
    }

    baked.forEach(geometry => {
        if (geometry && geometry !== result) {
            try { geometry.remove(); } catch (_) {}
        }
    });

    if (failure || !result) {
        try { result?.remove(); } catch (_) {}
        window.EKKO_DIAG?.logEvent?.("boolean.reject", { operation, reason: failure || "empty" });
        console.warn(`[EKKO BOOLEAN] ${operation} descartada: ${failure || "resultado vacio"}. Los vectores originales se conservan.`);
        return rejectBoolean(failure || "empty");
    }

    // Guardas: una interseccion de formas que no se tocan, o un resultado que
    // crece mas que la suma de sus operandos, indican un fallo del kernel.
    const resultArea = Math.abs(result.area || 0);
    if (resultArea <= BOOLEAN_MIN_AREA) {
        try { result.remove(); } catch (_) {}
        window.EKKO_DIAG?.logEvent?.("boolean.reject", { operation, reason: "empty-area" });
        console.warn(`[EKKO BOOLEAN] ${operation} sin area resultante. Los vectores originales se conservan.`);
        return rejectBoolean("empty-area");
    }
    if (resultArea > sourceArea * (1 + BOOLEAN_AREA_TOLERANCE) + BOOLEAN_MIN_AREA) {
        try { result.remove(); } catch (_) {}
        window.EKKO_DIAG?.logEvent?.("boolean.reject", { operation, reason: "area-overflow" });
        console.warn(`[EKKO BOOLEAN] ${operation} descartada: el area resultante excede la suma de las formas.`);
        return rejectBoolean("area-overflow");
    }

    // even-odd: las siluetas disjuntas que devuelve el kernel se renderizan
    // exactamente como la materia prevista y los contornos anidados se leen
    // como huecos reales, no como opacidad cero.
    try { result.fillRule = "evenodd"; } catch (_) {}

    /* El KEEPER es el operando mas bajo de la pila (ordered[0]). Si ese
       operando era un hueco (calado), recien AHORA se materializa: la
       operacion ya dejo material, asi que el relleno restaurado es parte del
       resultado y no un artefacto de un intento fallido. Es el mismo gesto
       que el boton Rellenar, dentro de la transaccion. */
    let baseFinal = base;
    try {
        if (semanticKind(baseFinal) === VECTOR_KIND.HOLE) {
            const materializado = convertSelectionToSolid(baseFinal);
            if (materializado) baseFinal = materializado;
            // Ultimo recurso defensivo: si la materializacion no alcanzo a
            // quitar el rol de hueco, el keeper quedaria invisible con la
            // geometria de la union. Se pinta con el color original guardado.
            if (semanticKind(baseFinal) === VECTOR_KIND.HOLE) {
                baseFinal.data = { ...(baseFinal.data || {}),
                    isHole: false, isSolidShape: true, isCalado: false,
                    filledFromHole: true, semanticKind: VECTOR_KIND.SOLID, label: "Relleno" };
                baseFinal.fillColor = baseFinal.data?.originalFillColor?.clone?.() || "#111827";
                baseFinal.visible = true;
            }
        }
    } catch (_) {}

    // Capture the new geometry in owner-local space before installing it.
    // installOwnerGeometry can promote a Path to a CompoundPath; afterwards
    // getOwnerLocalGeometry(keeper) would read the old geomBase and CSG would
    // restore the pre-boolean shape.
    let booleanResultLocal = null;
    try {
        booleanResultLocal = result.clone({ insert: false });
        /* Los contornos del resultado son pura silueta: paper.js une piezas
           disjuntas ADOPTANDO los operandos tal cual, asi que cada contorno
           del clon arrastraria los datos semanticos de su origen (isCalado,
           isHole, geomBase, ownerId...). Como geomBase es la fuente de la que
           recalculateDynamicSubtractions reinstala contornos, dejar esas
           marcas haria que la logica de huecos relea las siluetas del
           resultado booleano como piezas aparte. */
        try {
            (booleanResultLocal.children || []).forEach(contorno => {
                if (contorno && (contorno.className === "Path" || contorno.className === "CompoundPath")) {
                    try { contorno.data = {}; } catch (_) {}
                }
            });
        } catch (_) {}
        // geomBase DEBE quedar en espacio LOCAL del owner (contrato que
        // getGlobalUnsubtractedPath/toWorldGeometry asumen: "geomBase is
        // owner-local"). Con matrix-mult + reset de matrix el inverso se
        // DESCARTABA y geomBase quedaba en coordenadas de proyecto; entonces
        // recalculateDynamicSubtractions volvia a aplicar la matrix global del
        // owner ENCIMA: doble transformacion = el resultado booleano se
        // dibujaba agrandado o encogido segun la escala de la importacion.
        // Canon del repo (bakeGeometryClone): hornear el inverso en segmentos.
        booleanResultLocal.applyMatrix = false;
        booleanResultLocal.matrix = new paper.Matrix();
        const baseGlobal = baseFinal.globalMatrix?.clone?.() || new paper.Matrix();
        if (baseGlobal && !baseGlobal.isIdentity()) {
            booleanResultLocal.transform(baseGlobal.inverted());
        }
        booleanResultLocal.applyMatrix = true;
        booleanResultLocal.fillRule = result.fillRule || "evenodd";
    } catch (_) {
        try { booleanResultLocal?.remove?.(); } catch (_) {}
        booleanResultLocal = null;
    }

    let keeper = null;
    try {
        keeper = installOwnerGeometry(baseFinal, result, false);
    } catch (error) {
        console.error(`[EKKO BOOLEAN] No se pudo instalar el resultado:`, error);
        try { result.remove(); } catch (_) {}
        return rejectBoolean("install-failed");
    }

    if (!keeper) {
        window.EKKO_DIAG?.logEvent?.("boolean.reject", { operation, reason: "no-keeper" });
        return rejectBoolean("no-keeper");
    }

    // installOwnerGeometry solo propaga fillRule cuando el propietario pasa a
    // CompoundPath. Un resultado de una sola silueta lo perderia y volveria a
    // nonzero, que es la regla con la que el kernel de Paper orientó los
    // contornos anidados. even-odd es la convencion del proyecto.
    try {
        keeper.fillRule = "evenodd";
        keeper.data = { ...(keeper.data || {}), fillRule: "evenodd" };
    } catch (_) {}

    // Si el propietario era un trazo sin relleno (linea abierta), la geometria
    // booleana es MATERIAL con area y debe quedar pintada: se respeta el color
    // con el que se lo vio pintado (su strokeColor). El trazo se anula porque
    // la banda YA materializa ese mismo trazo; dejar el stroke ensenaria una
    // linea cruzando la parte que Restar supuestamente saco.
    try {
        if (!keeper.fillColor) {
            const color = keeper.strokeColor || result.fillColor || "#111827";
            keeper.fillColor = color;
            try { keeper.strokeColor = null; keeper.strokeWidth = 0; } catch (_) {}
        }
    } catch (_) {}

    // El resultado es una forma nueva: geomBase debe contener la geometría
    // booleana real, no la silueta anterior del primer operando.
    try {
        if (booleanResultLocal) {
            keeper.data = { ...(keeper.data || {}), geomBase: booleanResultLocal };
            if (booleanResultLocal.pathData) keeper.data.geomBasePathData = booleanResultLocal.pathData;
        } else {
            const local = getOwnerLocalGeometry(keeper);
            if (local) {
                local.applyMatrix = false;
                local.matrix = new paper.Matrix();
                keeper.data = { ...(keeper.data || {}), geomBase: local };
                if (local.pathData) keeper.data.geomBasePathData = local.pathData;
            }
        }
    } catch (_) {}

    // Marca de resultado booleano: habilita "Descomponer Vector" sobre la
    // pieza nueva (queja del dueño: una booleana no se podia volver a
    // descomponer). El gate de capabilities mira esta marca y NO la sola
    // presencia de contornos, asi un QR o un trazado siguen sin explotar.
    try {
        keeper.data = { ...(keeper.data || {}), booleanResult: true, booleanOperation: operation };
    } catch (_) {}

    // Los operandos consumidos desaparecen: la forma resultante los contiene.
    /* Higiene del resultado (medido en la union de un solido con un calado
       que NO se pisan): paper.js une piezas disjuntas ADOPTANDO los operandos
       tal cual como contornos del compound, asi que cada contorno del keeper
       arrastraria los datos semanticos de su origen (isCalado, isHole,
       geomBase, ownerId...). La logica de huecos los volveria a ver como
       piezas aparte y el clic sobre el contorno reconvertiria la pieza.
       Los contornos del keeper son pura silueta: su datos se resetean.
       Ademas el wrapper de contencion del operando consumido queda vacio
       (solo su mascara): se retira para no dejar un fantasma seleccionable. */
    if (keeper.className === "CompoundPath") {
        (keeper.children || []).forEach(contorno => {
            if (contorno && (contorno.className === "Path" || contorno.className === "CompoundPath")) {
                try { contorno.data = {}; } catch (_) {}
            }
        });
    }
    const purgaWrapperHuerfano = (nodo, profundidad = 0) => {
        if (!nodo || nodo === paper.project || profundidad > 5) return;
        if (nodo.className !== "Group" || nodo === window.currentMockup) return;
        const d = nodo.data || {};
        if (!d.clipGroup && !d.caladoContainment && !d.mockupContainment && !d.role) return;
        const conContenido = (nodo.children || []).some(ch =>
            !ch.clipMask && !((ch.data || {}).isSelectionBox) &&
            !((ch.data || {}).isHandle) && !((ch.data || {}).mockup));
        if (conContenido) return;
        const abuelo = nodo.parent;
        try { nodo.remove(); } catch (_) {}
        purgaWrapperHuerfano(abuelo, profundidad + 1);
    };
    ordered.slice(1).forEach(owner => {
        const padre = owner ? owner.parent : null;
        try { owner.remove(); } catch (_) {}
        if (padre) purgaWrapperHuerfano(padre);
    });

    window.EKKO_DIAG?.logEvent?.("boolean.applied", {
        operation,
        operands: ordered.length,
        area: resultArea
    });

    return commitBooleanResult(keeper, ownsHistory);
}

/* =========================================================================
   PREVISUALIZACIÓN DE BOOLEANAS AL PASAR EL PUNTERO
   -------------------------------------------------------------------------
   Los cuatro botones dicen "Unión / Restar / Intersección / Diferencia" pero
   no dicen cómo queda la pieza: la única forma de saberlo era hacer clic,
   mirar, y si no era, Ctrl+Z y probar de nuevo. El pedido textual fue "no se
   puede hacer la previsualizacion dinamica al colocar el puntero sobre el
   boton de las distintas opciones... sin la necesidad de hacer clic".

   La previsualización NO toca la escena: se hornea una COPIA de cada operando
   (`insert:false`, fuera del proyecto), se corre la misma operación sobre las
   copias y el resultado se dibuja como fantasma arriba de todo: VERDE #35c46f
   (el color "restaurar" del Editar Fondo) = lo que SE QUEDA, y ROJO
   rgba(239,83,80,.45) (el color "lo quitado" del Editar Fondo) = lo que
   desaparece. No abre transacción de historial, no modifica el documento y no
   deja nada si el puntero se va. El fantasma lleva `isSelectionBox`, que es la
   marca que exportSVG.js:336 ya descarta: jamás puede terminar en el archivo
   del láser.
   ========================================================================= */
const BOOLEAN_PREVIEW_SELECTOR = "[data-fusion-btn^='boolean'], [data-ekko-command^='boolean']";
const BOOLEAN_PREVIEW_COMMANDS = Object.freeze({
    booleanUnion: "union",
    booleanSubtract: "subtract",
    booleanIntersect: "intersect",
    booleanDifference: "difference"
});
let booleanPreviewGroup = null;
let booleanPreviewOperation = null;
let booleanPreviewOwners = [];

function clearBooleanPreview() {
    booleanPreviewOperation = null;
    booleanPreviewOwners = [];
    if (!booleanPreviewGroup) return false;
    const grupo = booleanPreviewGroup;
    booleanPreviewGroup = null;
    try { grupo.remove(); } catch (_) {}
    paper.view?.update?.();
    return true;
}

/* Misma operación que performBooleanOperation, pero sobre clones y sin
   instalar nada: devuelve el contorno resultante en coordenadas de proyecto o
   null si el kernel no produce geometría utilizable. */
function buildBooleanPreview(operation) {
    const spec = BOOLEAN_OPERATIONS[operation];
    if (!spec || !window.paper || !paper.project) return null;
    const owners = booleanOperandOwners();
    if (owners.length < 2) return null;

    const ordered = owners.slice().sort(compareBooleanStack);
    const baked = ordered.map(bakeBooleanOperand);
    const sourceArea = baked.reduce((total, geometry) => total + Math.abs(geometry?.area || 0), 0);
    let result = baked[0];
    let failure = null;

    for (let i = 1; i < baked.length && !failure; i++) {
        const subject = result;
        let cutter = baked[i];
        if (spec.oriented) {
            try { cutter = normalizeSubtractiveOperand(cutter, subject); } catch (_) {}
        }
        try {
            const next = spec.method === "difference"
                ? booleanDifference(subject, cutter)
                : subject[spec.method](cutter, { insert: false });
            try { subject.remove(); } catch (_) {}
            if (cutter !== baked[i]) { try { cutter.remove(); } catch (_) {} }
            result = next;
            if (!result) failure = "sin geometria";
        } catch (_) {
            failure = "kernel";
        }
    }

    baked.forEach(geometry => {
        if (geometry && geometry !== result) { try { geometry.remove(); } catch (_) {} }
    });

    /* Los mismos topes que la operación real: si la previsualización mostrara
       un resultado que el clic después rechaza, mentiría. */
    const resultArea = Math.abs(result?.area || 0);
    if (failure || !result || resultArea <= BOOLEAN_MIN_AREA ||
        resultArea > sourceArea * (1 + BOOLEAN_AREA_TOLERANCE) + BOOLEAN_MIN_AREA) {
        try { result?.remove?.(); } catch (_) {}
        return null;
    }
    return result;
}

/* Preview cuando el resultado de la booleana queda VACIO: una interseccion
   entre piezas que no comparten area, o un restar donde lo segundo tapa todo
   al primero. Antes no se pintaba NADA y el dueño leia "el programa no hace
   nada". Ahora se pinta la union de los operandos en el ROJO de "se quita"
   (misma metodologia del Editar Fondo): la operación SÍ reaccionó, y tal
   como está la selección no quedaría ningún pedazo. */
function mostrarPreviewVacio(operation) {
    const owners = booleanPreviewOwners;
    if (!owners || owners.length < 2) return false;
    let union = null;
    try {
        for (const owner of owners) {
            const baked = bakeBooleanOperand(owner);
            if (!baked) continue;
            union = union ? union.unite(baked, { insert: false }) : baked;
            if (union !== baked) { try { baked.remove(); } catch (_) {} }
        }
    } catch (_) { try { union?.remove?.(); } catch (_) {} return false; }
    if (!union || Math.abs(union.area || 0) <= BOOLEAN_MIN_AREA) {
        try { union?.remove?.(); } catch (_) {}
        return false;
    }
    const proj = paper.project;
    const capa = (proj.layers || []).find(l => l && l.name === "designLayer") || proj.activeLayer;
    if (!capa) { try { union.remove(); } catch (_) {} return false; }
    const zoom = paper.view?.zoom || 1;
    try {
        union.fillRule = "evenodd";
        const rojo = new paper.Color("#ef5350");
        rojo.alpha = 0.45;
        union.fillColor = rojo;
        union.strokeColor = new paper.Color("#ef5350");
        union.strokeWidth = 1.2 / zoom;
        union.dashArray = [5 / zoom, 3 / zoom];
    } catch (_) { try { union.remove(); } catch (_) {} return false; }
    const grupo = new paper.Group({ insert: false });
    grupo.data = { isSelectionBox: true, isBooleanPreview: true, uiOnly: true, booleanOperation: operation, booleanEmpty: true };
    grupo.addChild(union);
    capa.addChild(grupo);
    grupo.bringToFront();
    booleanPreviewGroup = grupo;
    booleanPreviewOperation = operation;
    paper.view?.update?.();
    try {
        notice("Con esta selección la booleana no deja ningún pedazo: en rojo se ve todo lo que se quitaría.", { kind: "warn" });
    } catch (_) {}
    return true;
}

function showBooleanPreview(operation) {
    if (!operation) return false;
    if (booleanPreviewOperation === operation && booleanPreviewGroup?.parent) return true;
    clearBooleanPreview();
    booleanPreviewOwners = booleanOperandOwners();
    const result = buildBooleanPreview(operation);
    if (!result) {
        const pintado = mostrarPreviewVacio(operation);
        if (!pintado) booleanPreviewOwners = [];
        return pintado;
    }
    const proj = paper.project;
    const capa = (proj.layers || []).find(l => l && l.name === "designLayer") || proj.activeLayer;
    if (!capa) { try { result.remove(); } catch (_) {} return false; }
    const zoom = paper.view?.zoom || 1;

    /* Lo que SE QUITA: union de los operandos menos el resultado. Se pinta en
       ROJO con la misma metodologia del Editar Fondo (rojo = lo quitado,
       rgba(239,83,80,.45)); lo que SE QUEDA va en VERDE #35c46f, el color
       semantico de "restaurar" de esa misma herramienta. Asi el fantasma
       dice sin ambiguedad que parte sobrevive y que parte desaparece. */
    let quita = null;
    try {
        let union = null;
        for (const owner of booleanPreviewOwners) {
            const baked = bakeBooleanOperand(owner);
            if (!baked) continue;
            union = union ? union.unite(baked, { insert: false }) : baked;
            if (union !== baked) { try { baked.remove(); } catch (_) {} }
        }
        if (union && Math.abs(union.area || 0) > BOOLEAN_MIN_AREA) {
            quita = union.subtract(result, { insert: false });
        }
        try { union?.remove?.(); } catch (_) {}
        if (quita && Math.abs(quita.area || 0) <= BOOLEAN_MIN_AREA) {
            try { quita.remove(); } catch (_) {}
            quita = null;
        }
    } catch (_) { quita = null; }

    try {
        // Mismo criterio de relleno que el resultado real (performBooleanOperation
        // también fija even-odd): si no, un hueco se vería relleno en el fantasma
        // y vacío después del clic.
        result.fillRule = "evenodd";
        const verde = new paper.Color("#35c46f");
        verde.alpha = 0.40;
        result.fillColor = verde;
        result.strokeColor = new paper.Color("#35c46f");
        result.strokeWidth = 1.6 / zoom;
        result.dashArray = null;
        if (quita) {
            quita.fillRule = "evenodd";
            const rojo = new paper.Color("#ef5350");
            rojo.alpha = 0.45;
            quita.fillColor = rojo;
            quita.strokeColor = new paper.Color("#ef5350");
            quita.strokeWidth = 1.2 / zoom;
            quita.dashArray = [5 / zoom, 3 / zoom];
        }
    } catch (_) {
        try { quita?.remove?.(); } catch (_) {}
        quita = null;
    }
    const grupo = new paper.Group({ insert: false });
    grupo.data = { isSelectionBox: true, isBooleanPreview: true, uiOnly: true, booleanOperation: operation };
    if (quita) grupo.addChild(quita);
    grupo.addChild(result);
    capa.addChild(grupo);
    grupo.bringToFront();
    booleanPreviewGroup = grupo;
    booleanPreviewOperation = operation;
    paper.view?.update?.();
    return true;
}

function booleanButtonUsable(boton) {
    if (!boton || boton.disabled) return false;
    /* Ojo: `aria-disabled` NO sirve como guardia. La barra profesional lo deja
       en "true" aunque EKKO_COMMAND_STATE dé las cuatro booleanas por
       habilitadas, y ese botón igual responde al clic; mirarlo dejaba la
       previsualización muerta en la superficie más usada. Las clases son las
       que escribe ribbonRenderer.js. */
    if (boton.classList.contains("ekko-locked") || boton.classList.contains("ekko-command-hidden")) return false;
    if (boton.style && boton.style.display === "none") return false;
    return true;
}

function booleanOperationOf(boton) {
    const comando = boton.dataset.ekkoCommand || boton.dataset.fusionBtn || "";
    return BOOLEAN_PREVIEW_COMMANDS[comando] || null;
}

function installBooleanPreview() {
    if (window._ekkoBooleanPreviewInstalled) return;
    window._ekkoBooleanPreviewInstalled = true;
    /* Delegación en fase de captura: los botones se MUEVEN de barra (la cinta
       re-parenta #topBar) y se clonan en el menú de herramientas, así que un
       listener puesto en cada botón se perdería. */
    const CONTORNO_PREVIEW_SELECTOR = "[data-fusion-btn='outline'], [data-ekko-command='contorno']";
    document.addEventListener("pointerover", event => {
        /* Vista previa de CONTORNO (mismo gesto que las booleanas): fantasma
           magenta de como quedaria el anillo de la seleccion actual. Lo
           calcula contorno.js sobre clones (nada instalado); aca solo se
           pide y se retira. Bloqueado no previews: el tooltip ya explica. */
        const botonContorno = event.target?.closest?.(CONTORNO_PREVIEW_SELECTOR);
        if (botonContorno && !botonContorno.contains(event.relatedTarget)
            && booleanButtonUsable(botonContorno)) {
            try { window.EKKO?.previsualizarContorno?.(); } catch (_) {}
            return;
        }
        const boton = event.target?.closest?.(BOOLEAN_PREVIEW_SELECTOR);
        const traza = { at: Date.now(), comando: null, operacion: null, usable: null, motivo: null };
        window._ekkoBooleanPreviewLast = traza;
        if (!boton) { traza.motivo = "sin-boton"; return; }
        traza.comando = boton.dataset.ekkoCommand || boton.dataset.fusionBtn || null;
        if (boton.contains(event.relatedTarget)) { traza.motivo = "mismo-boton"; return; }
        traza.usable = booleanButtonUsable(boton);
        if (!traza.usable) { traza.motivo = "boton-no-usable"; return; }
        const operacion = booleanOperationOf(boton);
        traza.operacion = operacion;
        if (!operacion) { traza.motivo = "sin-operacion"; return; }
        traza.motivo = showBooleanPreview(operacion) ? "mostrado" : "sin-resultado";
    }, true);
    document.addEventListener("pointerout", event => {
        const botonContorno = event.target?.closest?.(CONTORNO_PREVIEW_SELECTOR);
        if (botonContorno && !botonContorno.contains(event.relatedTarget)) {
            try { window.EKKO?.quitarPreviewContorno?.(); } catch (_) {}
            return;
        }
        const boton = event.target?.closest?.(BOOLEAN_PREVIEW_SELECTOR);
        if (!boton || boton.contains(event.relatedTarget)) return;
        clearBooleanPreview();
    }, true);
    const limpiarPreviews = () => {
        clearBooleanPreview();
        try { window.EKKO?.quitarPreviewContorno?.(); } catch (_) {}
    };
    ["pointerdown", "wheel", "contextmenu", "keydown"].forEach(tipo => {
        document.addEventListener(tipo, limpiarPreviews, true);
    });
    window.addEventListener("blur", limpiarPreviews);
}

window.EKKO_BOOLEAN_PREVIEW = Object.freeze({
    show: showBooleanPreview,
    clear: clearBooleanPreview,
    build: buildBooleanPreview,
    installed: () => !!window._ekkoBooleanPreviewInstalled
});

/**
 * <Solidos <-> Huecos>: intercambia el papel fisico de cada pieza.
 * Un solido pasa a perforar (hueco real) y un hueco pasa a material.
 * Un clic, util cuando la seleccion mezcla ambos papeles.
 */
/* REGLA DEL DUEÑO (orden Z): dentro de un lote de DESCOMPONER, el apilado
   real va del contorno externo hacia adentro: la masa sólida externa abajo,
   su calado arriba, y así nivel por nivel (Nivel 0 debajo de Nivel 1).
   El reorden por docOrder del stream fuente dejaba los contadores internos
   (muchas fuentes listan el contorno interno ANTES que el externo) por DEBAJO
   de su masa sólida: el dueño lo ve como "los huecos quedan debajo de la capa
   de los sólidos" y al intercambiar Sólidos<->Huecos la pieza convertida
   quedaba perforada/tapada por su hermana. Este re-apilado es ESTABLE:
   solo toca lotes descompuestos (decomposedLayer + containmentScope), Ordera
   por (raíz según orden actual, nivel, docOrder), preserva el orden ENTRE
   jerarquías (letras) y no toca nada de lo apilado a mano por el usuario. */
function restackLoteDescompuesto(convertidos) {
    if (!Array.isArray(convertidos) || !convertidos.length) return;
    const wrapperDe = (pieza) => {
        const p = pieza?.parent;
        return (p && p.data?.clipGroup) ? p : (pieza || null);
    };
    const hojaDe = (w) => (w.children || []).find(ch => !ch.clipMask &&
        !((ch.data || {}).isSelectionBox)) || null;
    const lotes = new Map();
    convertidos.forEach(pieza => {
        const d = pieza?.data || {};
        if (d.decomposedLayer !== true || !d.containmentScope) return;
        const wrapper = wrapperDe(pieza);
        if (!wrapper || !wrapper.parent) return;
        const clave = wrapper.parent.id + '|' + d.containmentScope;
        if (!lotes.has(clave)) lotes.set(clave, { contenedor: wrapper.parent, alcance: d.containmentScope });
    });
    lotes.forEach(({ contenedor, alcance }) => {
        const lote = (contenedor.children || []).filter(ch => {
            const hoja = hojaDe(ch);
            const d = hoja?.data || {};
            return d.decomposedLayer === true && d.containmentScope === alcance;
        });
        if (lote.length < 2) return;
        const raizDe = (ch) => {
            const d = (hojaDe(ch)?.data) || {};
            const clave = d.ownerContainmentKey || d.containmentKey || '';
            return clave.split(':').pop() || clave;
        };
        const nivelDe = (ch) => {
            const d = (hojaDe(ch)?.data) || {};
            return typeof d.layerDepth === 'number' ? d.layerDepth :
                (typeof d.contourDepth === 'number' ? d.contourDepth : 0);
        };
        const ordenFuente = (ch) => {
            const d = (hojaDe(ch)?.data) || {};
            return typeof d.docOrder === 'number' ? d.docOrder : 0;
        };
        // Orden ENTRE raices (letras): su primera aparicion en el orden actual,
        // asi nunca se reordena una letra respecto de otra.
        const rangoRaiz = new Map();
        lote.forEach(ch => {
            const raiz = raizDe(ch);
            if (!rangoRaiz.has(raiz)) rangoRaiz.set(raiz, rangoRaiz.size);
        });
        const ordenDeseado = [...lote].sort((a, b) =>
            (rangoRaiz.get(raizDe(a)) - rangoRaiz.get(raizDe(b))) ||
            (nivelDe(a) - nivelDe(b)) ||
            (ordenFuente(a) - ordenFuente(b)));
        const yaEsta = ordenDeseado.every((ch, i) => ch === lote[i]);
        if (yaEsta) return;
        const indiceBase = Math.min(...lote.map(ch => contenedor.children.indexOf(ch)));
        ordenDeseado.forEach(ch => { try { ch.remove(); } catch (_) {} });
        let idx = indiceBase;
        ordenDeseado.forEach(ch => {
            try { contenedor.insertChild(Math.min(idx, contenedor.children.length), ch); } catch (_) {}
            idx += 1;
        });
    });
}
window.EKKO_restackOrdenBooleano = restackLoteDescompuesto;

/* =========================================================================
   INVERSION POR CONTORNOS (letras con huecos REALES todavia sin descomponer)
   -------------------------------------------------------------------------
   Queja del dueno (2026-11-12): con una letra que tiene huecos reales (la O,
   la A, la R) SIN descomponer, el clic en Sólidos ⇄ Huecos convertia la letra
   ENTERA en calado y la parte interna no existia como pieza: "los huecos
   siguen sin convertirse en rellenos". El intercambio correcto trabaja por
   CONTORNOS: los contornos internos (los contadores) nacen como una pieza
   RELLENO nueva con el color original, y el cuerpo pasa a hueco. Es el mismo
   resultado que Descomponer + invertir, en un solo clic.

   Solo aplica a CompoundPath cerrados con 2+ contornos que NO estan en un
   lote descompuesto (alli el intercambio normal por piezas ya alcanza y
   funciona, medido). El techo de 64 contornos protege trazados grandes del
   test de contencion O(n^2): con mas, se usa el comportamiento de siempre.
   ========================================================================= */
function contornosHuecosInternos(owner) {
    try {
        if (!owner || owner.className !== "CompoundPath") return null;
        const d = owner.data || {};
        if (d.isHole === true || d.semanticKind === VECTOR_KIND.HOLE) return null;
        if (d.decomposedLayer === true) return null;
        const hojas = (owner.children || []).filter(ch => ch && ch.className === "Path" && ch.closed !== false);
        if (hojas.length < 2 || hojas.length > 64) return null;
        const huecos = [];
        const puntos = hojas.map(hoja => puntoDeBandaContorno(hoja));
        hojas.forEach((hoja, i) => {
            const punto = puntos[i];
            if (!punto) return;
            let dentro = 0;
            hojas.forEach((otra, j) => {
                if (j === i) return;
                try { if (otra.contains(punto)) dentro += 1; } catch (_) {}
            });
            if (dentro % 2 === 1) huecos.push(hoja);
        });
        return huecos.length ? huecos : null;
    } catch (_) { return null; }
}

function materializarContornosInternos(owner, huecos) {
    try {
        const colorOriginal = owner.fillColor?.clone?.() || new paper.Color("#111827");
        const nueva = new paper.CompoundPath({ insert: false });
        huecos.forEach(hoja => {
            const clon = hoja.clone({ insert: false });
            clon.data = {};
            nueva.addChild(clon);
        });
        // El cuerpo vive en el mismo marco que su origen: misma matrix y misma
        // convencion applyMatrix, asi la pieza nueva cae EXACTAMENTE donde
        // estaba el hueco.
        nueva.applyMatrix = owner.applyMatrix !== false;
        try { nueva.matrix = owner.matrix?.clone?.() || new paper.Matrix(); } catch (_) {}
        try { nueva.fillRule = owner.fillRule || "evenodd"; } catch (_) {}
        nueva.fillColor = colorOriginal;
        nueva.strokeColor = null;
        nueva.strokeWidth = 0;
        const padre = owner.parent;
        if (!padre) return null;
        const indice = Math.max(0, padre.children.indexOf(owner));
        padre.insertChild(indice, nueva);
        const geomBase = nueva.clone({ insert: false });
        geomBase.applyMatrix = false;
        try { geomBase.matrix = new paper.Matrix(); } catch (_) {}
        nueva.data = {
            source: owner.data?.source || null,
            userImported: owner.data?.userImported === true ? true : undefined,
            label: "Relleno",
            semanticKind: VECTOR_KIND.SOLID,
            isHole: false,
            isSolidShape: true,
            isCalado: false,
            contourRole: "outer",
            originalIsHole: false,
            explicitHole: false,
            filledFromHole: true,
            isFusionReceptor: true,
            originalFillColor: colorOriginal,
            originalStrokeColor: null,
            originalStrokeWidth: 0,
            geomBase
        };
        return nueva;
    } catch (_) { return null; }
}

export function invertSelectionRoles() {
    const selected = getSelectedItems();
    const owners = [];
    const seen = new Set();
    selected.map(item => resolverOwnerDeSeleccion(unwrap(item))).filter(Boolean).forEach(owner => {
        if (seen.has(owner) || isMockupOrMask(owner)) return;
        // Un grupo seleccionado (import de SARA, texto vectorizado, agrupado
        // manual) entra por sus hojas vectoriales: cada letra se invierte por
        // su propio rol.
        expandirVectoresEditables(owner).forEach(hoja => {
            if (seen.has(hoja) || isMockupOrMask(hoja)) return;
            if (hoja.className !== "Path" && hoja.className !== "CompoundPath") return;
            seen.add(hoja);
            owners.push(hoja);
        });
    });
    if (!owners.length) return null;

    window.beginHistoryTransaction?.("solid-hole-toggle");
    const converted = [];
    try {
        owners.forEach(owner => {
            let kind = null;
            try { kind = semanticKind(owner); } catch (_) {}
            if (kind === VECTOR_KIND.HOLE) {
                const solid = convertSelectionToSolid(owner);
                if (solid) converted.push(solid);
            } else if (canConvertSelectionToCalado(owner)) {
                /* Inversion por contornos: la letra con huecos REALES entrega
                   su parte interna como RELLENO nuevo (mismo color de origen)
                   y despues el cuerpo entero pasa a hueco. Sin esto, la
                   conversion entera dejaba el interior sin pieza y el dueño
                   lo leia como "el hueco no se convierte". */
                const huecosInternos = contornosHuecosInternos(owner);
                let relleno = null;
                if (huecosInternos) {
                    relleno = materializarContornosInternos(owner, huecosInternos);
                    if (relleno) converted.push(relleno);
                }
                const hole = convertSelectionToCalado(owner);
                if (hole) {
                    converted.push(hole);
                    /* Orden Z: el RELLENO debe quedar ENCIMA del calado de su
                       misma letra. Debajo, la sustraccion dinamica del hueco
                       (que va arriba) recortaba el relleno y el dueno veia la
                       pieza interna maltratada o desaparecida. Es el mismo
                       orden del lote descompuesto. */
                    if (relleno) { try { relleno.insertAbove(hole); } catch (_) {} }
                }
            }
        });
    } catch (e) {
        window.cancelHistoryTransaction?.("solid-hole-toggle-failed");
        console.warn("[EKKO <Solidos <-> Huecos>] no se pudo invertir:", e);
        return null;
    }
    if (!converted.length) {
        window.cancelHistoryTransaction?.("solid-hole-toggle-empty");
        return null;
    }
    // Orden Z del dueño: las piezas convertidas vuelven a su nivel semántico
    // (masa sólida abajo, calado arriba) dentro de su jerarquía descompuesta.
    // Sin esto, el sólido nuevo del contador quedaba debajo del anillo
    // convertido en hueco y lo perforaba: la pieza desaparecía.
    try { restackLoteDescompuesto(converted); } catch (_) {}
    try { recalculateDynamicSubtractions?.(); } catch (_) {}
    window.saveHistory?.();
    window.commitHistoryTransaction?.("solid-hole-toggle");
    window.deselectItem?.();
    converted.forEach((owner, index) => window.selectItem?.(owner, index > 0));
    window.EKKO_DIAG?.logEvent?.("solid-hole.toggle", { count: converted.length });
    return converted;
}
window.invertSelectionRoles = invertSelectionRoles;

function classifySelection() {
    const selected = getSelectedItems();
    if (!selected.length) return { context: "none", counts: {} };

    const counts = {
        raster: 0,
        vector: 0,
        text: 0,
        fusion: 0,
        other: 0
    };

    selected.forEach(raw => {
        const item = unwrap(raw);
        if (!item) {
            counts.other++;
            return;
        }

        if (item.data && item.data.isSmartFusion) {
            counts.fusion++;
        } else if (item.className === "Raster") {
            counts.raster++;
        } else if (item.className === "PointText" || (item.data && (item.data.isText || item.data.isCurvedGroup || item.data.isSpacedGroup))) {
            counts.text++;
        } else if (["Path", "CompoundPath", "Group", "Shape", "SymbolItem", "PlacedSymbol"].includes(item.className)) {
            counts.vector++;
        } else {
            counts.other++;
        }
    });

    const typeCount = ["raster", "vector", "text", "fusion", "other"].filter(type => counts[type] > 0).length;
    let context = "multiple";
    let canUngroup = false;
    let canDecompose = false;
    let canFusion = false;
    let canCalado = false;
    let canRellenar = false;
    let canBoolean = false;
    const singleTarget = selected.length === 1 ? unwrap(selected[0]) : null;
    // El motor decide: Calar solo con solidos, Rellenar solo con huecos.
    // Con una mezcla no aparece ninguno (aparece <Solidos <-> Huecos>).
    try { canCalado = isToolEnabled('calado', selected); } catch (e) { canCalado = false; }
    try { canRellenar = isToolEnabled('rellenar', selected); } catch (e) { canRellenar = false; }
    if (singleTarget && canCalado) {
        try { canCalado = canConvertSelectionToCalado(singleTarget); } catch (e) { canCalado = false; }
        // Fallback defensivo para CompoundPath dentro de clipGroup. El botón
        // debe aparecer para un sólido público, aunque el wrapper no se haya
        // resuelto todavía por la ruta principal de Calado.
        if (!canCalado) {
            try {
                const candidate = findFusionVector(singleTarget) || singleTarget;
                canCalado = !!candidate &&
                    !isProductElement(candidate) &&
                    isClosedClientVector(candidate) &&
                    canConvertToCalado(candidate);
            } catch (e) { canCalado = false; }
        }
    }

    if (selected.length === 2) {
        const items = selected.map(unwrap).filter(Boolean);
        const raster = items.map(findFusionRaster).find(Boolean);
        const vector = items.map(findFusionVector).find(Boolean);
        canFusion = !!(raster && vector && !isProductElement(raster) && isValidFusionReceptor(vector));
    }

    if (singleTarget) {
        try { canUngroup = getUngroupRoute(singleTarget) !== UNGROUP_ROUTE.NONE; }
        catch (_) { canUngroup = false; }
    }
    // Descomponer acepta MULTIPLES vectores: se descomponen uno por uno.
    // Con imagen mezclada el motor lo oculta: primero Desagrupar.
    try { canDecompose = isToolEnabled('decomposeVector', selected); }
    catch (_) { canDecompose = false; }

    // Solo cuentan los vectores que el kernel puede usar como operandos: un
    // Group, un calado o una mascara no son fusionables.
    if (booleanOperandOwners().length >= 2) {
        canBoolean = true;
    }

    if (counts.fusion === selected.length) {
        context = "fusion";
    } else if (selected.length === 2 && counts.raster === 1 && counts.vector === 1) {
        context = "mixed";
    } else if (selected.length === 1 && counts.raster === 1) {
        context = "image";
    } else if (selected.length === 1 && counts.text === 1) {
        context = "text";
    } else if (selected.length === 1 && counts.vector === 1) {
        context = "vector";
    } else if (selected.length > 1) {
        // Toda selección múltiple conserva el contexto "multiple".
        // Incluso si todos sus elementos son vectores, debe habilitar
        // Agrupar, Alinear y Distribuir como conjunto.
        context = "multiple";
    }

    return { context, counts, canUngroup, canDecompose, canFusion, canCalado, canRellenar, canBoolean };
}

function tagProfessionalButtons() {
    Object.entries(PRO_COMMAND_IDS).forEach(([id, command]) => {
        const button = document.getElementById(id);
        if (button) {
            button.dataset.fusionBtn = command;
            button.dataset.commandSurface = "shared";
        }
    });
}

function getSharedCommandElements() {
    tagProfessionalButtons();
    return [...document.querySelectorAll("#topBar [data-fusion-btn], #pro-layout-toolbar [data-fusion-btn], #contextual-toolbar [data-fusion-btn]")];
}

function applyCommandVisibility() {
    // Un fantasma de booleanas pertenece a los operandos con los que se armó:
    // si la selección cambió, ya no describe nada y se retira.
    if (booleanPreviewGroup) {
        const actuales = booleanOperandOwners();
        const mismo = actuales.length === booleanPreviewOwners.length &&
            actuales.every(owner => booleanPreviewOwners.includes(owner));
        if (!mismo) clearBooleanPreview();
    }
    const selection = classifySelection();
    // El motor de capacidades es la unica autoridad de la barra.
    // La pestana de contexto activa RECORTA ese conjunto: nunca lo amplia,
    // asi que un boton nunca aparece si el objeto seleccionado no lo soporta.
    const selectionList = window.selectedItems?.length
        ? window.selectedItems
        : (window.selectedItem ? [window.selectedItem] : []);
    const activeTab = window.EKKO_PANEL_STATE?.activeTab || "auto";
    const allowed = new Set(legacyNamesForTab(selectionList, activeTab));
    if (selection.canUngroup) allowed.add("ungroup");
    if (selection.canDecompose) allowed.add("decomposeVector");
    else allowed.delete("decomposeVector");
    if (!selection.canFusion) allowed.delete("fusion");
    if (!selection.canCalado) allowed.delete("calado");
    if (!selection.canRellenar) allowed.delete("rellenar");
    /* Rescate igual al de las booleanas: Sólidos ⇄ Huecos es una operacion de
       LOTE (el dueño la usa con muchos vectores apretados). El recorte de
       pestaña la borraba en "Varios" (donde cae toda multiseleccion) y el
       boton desaparecia justo cuando hace falta: con UNA pieza aparecia
       (pestaña Vector) y con varias no. El motor sigue siendo el unico juez
       de si la selección lo soporta; aca solo se garantiza que la pestaña no
       lo esconda. */
    if (isToolEnabled('solidHole', window.selectedItems || [])) allowed.add("solidHole");
    else allowed.delete("solidHole");
    if (selection.canBoolean) {
        allowed.add("booleanUnion");
        allowed.add("booleanSubtract");
        allowed.add("booleanIntersect");
        allowed.add("booleanDifference");
    } else {
        allowed.delete("booleanUnion");
        allowed.delete("booleanSubtract");
        allowed.delete("booleanIntersect");
        allowed.delete("booleanDifference");
    }
    const elements = getSharedCommandElements();
    elements.forEach(element => { element.dataset.commandSurface = "shared"; });

    /* UN SOLO ESCRITOR. Este módulo conserva el CÁLCULO (allowed +
       EKKO_COMMAND_STATE, que otros módulos leen), pero la pintada de
       display/clase la hace ui/ribbonRenderer.js, que es la única autoridad
       de #topBar y #contextual-toolbar. */
    if (window.EKKO_RIBBON && typeof window.EKKO_RIBBON.renderNow === "function") {
        window.EKKO_RIBBON.renderNow();
    } else {
        // Respaldo: solo si el renderer todavía no cargó.
        elements.forEach(element => {
            const show = allowed.has(element.dataset.fusionBtn);
            element.classList.toggle("ekko-command-hidden", !show);
            element.style.display = show ? "" : "none";
        });
    }

    window.EKKO_COMMAND_STATE = {
        context: selection.context,
        counts: selection.counts,
        canUngroup: selection.canUngroup,
        canDecompose: selection.canDecompose,
        canFusion: selection.canFusion,
        canCalado: selection.canCalado,
        canRellenar: selection.canRellenar,
        allowedCommands: [...allowed],
        timestamp: Date.now()
    };

    return window.EKKO_COMMAND_STATE;
}

function enforceCommandVisibility() {
    applyCommandVisibility();
    // contextualMenu.js y canvasControlsIntegration.js también actualizan
    // estilos después de la selección. Reaplicamos al final de ese ciclo.
    setTimeout(applyCommandVisibility, 0);
    setTimeout(applyCommandVisibility, 60);
}

function scheduleRefresh() {
    if (refreshTimer) cancelAnimationFrame(refreshTimer);
    refreshTimer = requestAnimationFrame(() => {
        refreshTimer = null;
        enforceCommandVisibility();
    });
}

function wrapToolbarRefresh() {
    const original = window.refreshAllToolbars;
    if (typeof original !== "function" || original.__ekkoCommandBridgeWrapped) return;

    const wrapped = function () {
        const result = original.apply(this, arguments);
        scheduleRefresh();
        return result;
    };

    wrapped.__ekkoCommandBridgeWrapped = true;
    window.refreshAllToolbars = wrapped;
}

function observeProfessionalToolbar() {
    const workspace = document.getElementById("workspace");
    if (!workspace || workspace.__ekkoCommandObserver) return;

    const observer = new MutationObserver(() => {
        tagProfessionalButtons();
        scheduleRefresh();
    });

    observer.observe(workspace, { childList: true, subtree: true });
    workspace.__ekkoCommandObserver = observer;
}

export function refreshSharedCommands() {
    wrapToolbarRefresh();
    enforceCommandVisibility();
    return window.EKKO_COMMAND_STATE;
}

export function initPanelCommandBridge() {
    if (initialized) return;
    initialized = true;

    tagProfessionalButtons();
    installCommandDispatcher();
    installBooleanPreview();
    observeProfessionalToolbar();
    wrapToolbarRefresh();
    applyCommandVisibility();

    window.refreshEKKOSharedCommands = refreshSharedCommands;
    // Superficie de diagnostico: permite verificar una booleana sin pasar por
    // el DOM y confirma que la operacion respeta la semantica vectorial.
    // Esta es la UNICA definicion de window.EKKO_BOOLEAN. Antes tambien la
    // escribia booleanOperations.js con otra forma de claves; como ambos
    // modulos se cargan, el ultimo en ejecutarse pisaba al otro y una de las
    // dos superficies desaparecia. Ese modulo era codigo muerto: sus funciones
    // no las llamaba nadie y las booleanas reales viven en performBooleanOperation.
    window.EKKO_BOOLEAN = Object.freeze({
        union: () => performBooleanOperation("union"),
        subtract: () => performBooleanOperation("subtract"),
        intersect: () => performBooleanOperation("intersect"),
        difference: () => performBooleanOperation("difference"),
        isOperand: isBooleanOperand,
        operandCount: () => booleanOperandOwners().length
    });
    console.log("%c[EKKO COMMANDS] Superficies de comandos sincronizadas.", "color:#7c3aed;font-weight:bold;");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        initPanelCommandBridge();
        setTimeout(refreshSharedCommands, 0);
    }, { once: true });
} else {
    initPanelCommandBridge();
}

