import { getPublicOwner, isMockupOrMask, isContainmentWrapper, toWorldGeometry } from "./designGeometry.js";
import { isCutLine, semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { buildOutlineGeometry, refreshOwnerOutline, previsualizarBanda, previsualizarBandaGeom, applySmoothing } from "./outlineGeometry.js";

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

// El resultado de un contorno es para GRABADO LASER: siempre negro. El panel
// no ofrece color ni opacidad a proposito (decision de diseno aprobada).
const CONTOUR_COLOR = "#000000";
// La silueta de una foto recortada puede tener millones de pixeles. Se lee el
// canal alfa a esta resolucion y despues se reescala a la pieza: es mas que
// suficiente para un contorno, y el control Suavidad existe justamente para
// bajar el numero de nodos de un detalle muy fino.
const ALPHA_SCAN_MAX = 1200;
const ALPHA_ISO = 128;

/* ------------------------------------------------------------------
   VINCULOS: que contorno salio de que pieza.

   Vive solo en memoria, a proposito. La app envuelve cada pieza en un grupo
   contenedor, as que lo que el cliente selecciona casi nunca es el contorno
   mismo sino el envoltorio, y la marca en .data no siempre sobrevive al
   envoltorio. El registro evita depender de eso: se guarda el par real.
   ------------------------------------------------------------------ */
const VINCULOS = new Map();

/* AVISOS: cuando el motor NO puede dibujar lo que el cliente pidió, tiene que
   decir por que, no quedarse mudo. El aviso existe porque el caso es real y
   medido: "Solo huecos" sobre una imagen sin huecos (DR_bn.png: 0 celdas de
   hueco sobre 810 000) no produce ninguna banda.
   La API publica es window.ekkoNotice; sin ella solo queda la consola. */
function avisar(mensaje) {
    const fn = (typeof window !== "undefined")
        && (window.ekkoNotice || (window.EKKO_NOTICE && window.EKKO_NOTICE.notice));
    if (typeof fn !== "function") { try { console.info("[EKKO CONTORNO]", mensaje); } catch (_) {} return; }
    // El mismo aviso no se repite en cadena: el arrastre de un control dispara
    // el vaciado en cada tick y cuatro avisos iguales tapan el lienzo.
    const ahora = Date.now();
    if (avisar._ultimo === mensaje && ahora - avisar._cuando < 2500) return;
    avisar._ultimo = mensaje;
    avisar._cuando = ahora;
    try { fn(mensaje, {}); } catch (_) {}
}

const MOTIVOS = Object.freeze({
    "sin-huecos": "Esta pieza no tiene huecos internos: «Solo huecos» no puede dibujar contorno. Volvé a «Borde + huecos» o «Solo borde».",
    "sin-banda": "Con esa Separación y ese Grosor la banda cae afuera de la pieza: no hay contorno que dibujar.",
    "sin-silueta": "La selección no tiene silueta recortada en común: se aplica por pieza."
});

/** Trocea la banda de geometria y la deja dentro del contorno, en el lugar. */
function volcarGeometria(contorno, band, opciones = {}) {
    if (!contorno || !band) return null;
    const hijos = (band.className === "CompoundPath" && band.children?.length
        ? band.children.map(c => c.clone({ insert: false }))
        : [band.clone({ insert: false })]);
    band.remove?.();
    // Se reemplaza la geometria DENTRO del mismo objeto, no se borra y se
    // crea otro: asi el contorno no pierde su posicion, su envoltorio ni su
    // seleccion, y el cliente no ve que la pieza desaparezca un instante.
    contorno.removeChildren?.();
    contorno.applyMatrix = false;
    contorno.matrix = new paper.Matrix();
    hijos.forEach(child => contorno.addChild(child));
    contorno.fillRule = "evenodd";
    contorno.data = {
        ...(contorno.data || {}),
        outlineWidth: opciones.width,
        outlineRadius: opciones.radius,
        outlineSmoothing: opciones.smoothing,
        outlineSide: opciones.side,
        outlineScope: opciones.scope || "all",
        ...(opciones.apply === "pieces" || opciones.apply === "together"
            ? { outlineApply: opciones.apply } : {})
    };
    try { window.syncGeometryToGeomBase?.(contorno); } catch (_) {}
    try { paper.view?.update?.(); } catch (_) {}
    return contorno;
}

/** El RASTER de una pieza que puede venir envuelta en un grupo contenedor.
 *  Sin esto, al envolver la foto el vinculo guarda el grupo y sampleRasterAlpha
 *  no ve canvas: la silueta caia al rectangulo de la caja. */
function rasterDe(item) {
    if (!item) return null;
    if (item.className === "Raster") return item;
    let encontrado = null;
    try {
        (function buscar(nodo) {
            if (encontrado || !nodo) return;
            if (nodo.className === "Raster") { encontrado = nodo; return; }
            (nodo.children || []).forEach(buscar);
        })(item);
    } catch (_) {}
    return encontrado || (item.className === "Raster" ? item : null);
}

/** Rehace la banda de un contorno que ya esta en el lienzo, con los valores de ahora. */
function regenerarContorno(contorno, opciones = null) {
    if (!contorno) return null;
    // El origen se busca en el registro comparando contra la pieza real.
    let vinculoPropio = null;
    for (const vinculo of VINCULOS.values()) {
        if (vinculo.contorno === contorno || vinculo.contorno === ownerOf(contorno)) {
            vinculoPropio = vinculo;
            break;
        }
    }
    if (!vinculoPropio?.origen) {
        console.warn("[EKKO CONTORNO] no se encontro de que pieza salio este contorno");
        return null;
    }
    // La banda NO esta mas en la escena: se retiro sola porque el Alcance
    // pedido no daba geometria (o el cliente la borro). Escribir la geometria
    // nueva sobre ese objeto hueso no se ve NUNCA — el vinculo quedaba marcado
    // vacio y cada control posterior no pintaba nada, que es exactamente el
    // "no funciona ninguno de esos botones" medido. Se reconstruye de arriba,
    // con la pieza o la union de piezas que le corresponden.
    if (!contorno.parent) {
        const piezas = piezasDelVinculo(vinculoPropio);
        const control = opciones || readOutlineControls();
        if (!piezas.length) return null;
        return crearContornoDeImagenes(piezas, control);
    }
    const muestra = muestraDelVinculo(vinculoPropio);
    if (!muestra) return null;

    const control = opciones || readOutlineControls();
    const width = Math.max(1, Math.abs(Number(control.width) || 0) || 1);
    const normalizado = { ...control, width };
    let band = null;
    if (muestra.sampled) {
        // FINAL = exacto: mismo motor que la primera aplicacion, asi el
        // arrastre de un control no cambia ni la forma ni el area del anillo.
        band = bandaImagenViva(vinculoPropio, muestra.origen, muestra.sampled, normalizado, true);
        if (!band) return retirarBanda(vinculoPropio, contorno);
    } else {
        // Sin alfa que leer (JPG opaco): el borde es la caja de la imagen.
        const base = new paper.CompoundPath({ insert: false });
        base.applyMatrix = false;
        base.matrix = new paper.Matrix();
        base.fillRule = "evenodd";
        const caja = loopCajaImagen(muestra.origen) || loopCaja(muestra.origen.bounds);
        if (!caja) { base.remove?.(); return null; }
        base.addChild(new paper.Path({ segments: caja, closed: true, insert: false }));
        band = buildOutlineGeometry(base, width, normalizado.side, Number(normalizado.radius) || 0,
            Number(normalizado.smoothing) || 0, normalizado.scope);
        base.remove?.();
        if (!band) return retirarBanda(vinculoPropio, contorno);
    }
    vinculoPropio.vacio = false;
    return volcarGeometria(contorno, band, {
        width, side: normalizado.side, radius: Number(normalizado.radius) || 0,
        smoothing: Number(normalizado.smoothing) || 0,
        scope: normalizado.scope, apply: normalizado.apply
    });
}

/** El alcance o la Separacion pedidos no dejan celdas que bandear. La banda
 *  vieja NO puede quedar en pantalla: el panel diria "Solo huecos" y la escena
 *  mostraria el borde de siempre. Se retira el contorno y se dice por que. El
 *  vinculo queda marcado como VACIO (no se borra) para que el proximo cambio
 *  de control reconstruya la banda sin que el cliente tenga que volver a
 *  apretar Contorno. */
function retirarBanda(vinculo, contorno) {
    if (!vinculo) return null;
    vinculo.vacio = true;
    try { contorno?.remove?.(); } catch (_) {}
    avisar(MOTIVOS[vinculo.motivo] || "No hay contorno que dibujar con estos valores.");
    return null;
}

/** El vinculo de una PIEZA que participate de una banda de imagen, sea sola
 *  ("Todo junto" sobre una foto) o dentro de una union de varias. */
function vinculoDePieza(vinculo, pieza, owner) {
    if (!vinculo || !pieza) return false;
    if (vinculo.origen === pieza || vinculo.origen === owner) return true;
    return !!(vinculo.origenes && (vinculo.origenes.includes(pieza) || vinculo.origenes.includes(owner)));
}

/* ------------------------------------------------------------------
   PREVIEW FLUIDO (fase C). Durante el arrastre de un control, la banda
   real (stitcher + booleanas) es demasiado cara para pagarla en cada
   tick: el preview pinta la linea central de la banda como trazo magenta
   y la geometria real llega al soltar. El trazo lleva isOutlinePreview:
   para la app es un overlay de UI (no seleccionable, no exporta).
   ------------------------------------------------------------------ */
let previewContorno = null;

function quitarPreview() {
    if (!previewContorno) return;
    try { previewContorno.remove(); } catch (_) {}
    previewContorno = null;
}

function instalarPreview(grupo) {
    quitarPreview();
    if (!grupo) return null;
    try {
        (paper.project.activeLayer || paper.project.layers[0]).addChild(grupo);
    } catch (_) { return null; }
    previewContorno = grupo;
    try { paper.view?.update?.(); } catch (_) {}
    return grupo;
}

function vinculoDeContorno(contorno) {
    if (!contorno) return null;
    const publico = ownerOf(contorno);
    for (const vinculo of VINCULOS.values()) {
        const banda = vinculo.contorno;
        if (!banda) continue;
        // La banda puede llegar envuelta: ensureContainedDesignItem la mete en
        // un Group, y lo que ve la seleccion es ese envoltorio (medido en el
        // probe: la banda nunca es hija directa de la capa).
        if (banda === contorno || banda === publico) return vinculo;
        if (banda.parent && (banda.parent === contorno || banda.parent === publico)) return vinculo;
    }
    return null;
}

/** Vinculo de una PIEZA (no de un contorno). La clave natural es el id, pero
 *  la app re-envuelve piezas en grupos contenedores y el id que ve el panel
 *  puede dejar de coincidir: se acepta tambien el origen por identidad y por
 *  id. Sin ese respaldo, volver a aplicar Contorno creaba un segundo contorno
 *  al lado del primero en vez de rehacerlo. */
function vinculoDeOrigen(owner) {
    if (!owner) return null;
    const clave = owner.id;
    const porClave = (clave !== undefined && clave !== null) ? VINCULOS.get(clave) : null;
    if (porClave?.contorno?.parent) return porClave;
    for (const vinculo of VINCULOS.values()) {
        if (vinculo.origen === owner || (clave != null && vinculo.origen?.id === clave)) return vinculo;
    }
    return porClave || null;
}

/** Loop de respaldo para el cache: la caja de la pieza. Es lo que el motor
 *  usa cuando la imagen no tiene alfa que leer (JPG opaco = rectangulo
 *  silencioso), asi que el preview tiene que poder dibujar lo mismo. El
 *  orden de vértices sigue el convenio del calco (opaco a la izquierda del
 *  recorrido): area con signo negativa, igual que los loops del stitcher,
 *  para que el preview sepa de que lado esta el material. */
function loopCaja(bounds) {
    if (!bounds) return null;
    return [
        bounds.topLeft.clone(), bounds.bottomLeft.clone(),
        bounds.bottomRight.clone(), bounds.topRight.clone()
    ];
}

/* ------------------------------------------------------------------
   MAPEO CON LA MATRIZ DE LA IMAGEN (no con su caja del mundo).
   sampleRasterAlpha lee raster.canvas: los pixeles, que no saben nada de
   giro, espejo ni escala. Antes la grilla se estiraba contra item.bounds,
   que es la caja AABB del mundo: con la pieza girada la silueta sale
   estirada a esa caja (mas grande que la imagen) y con espejo sale sin
   espejar. MEDIDO contra los pixeles renderizados, grosor 12 Exterior:
   sin girar error 2 px; giro 30 error 74 px; giro 90 error 59 px; espejo
   error 54 px. En grabado laser eso es una mordida de 70 px fuera de la
   pieza. Se mapea la grilla al rectangulo propio de la imagen y despues se
   aplica la matriz global, que lleva posicion, escala, giro y espejo.
   ------------------------------------------------------------------ */

/** Caja de la imagen en SU propio espacio y la matriz que la lleva al lienzo.
 *  El anclaje (centro o esquina) no se supone: se prueba cual de los dos
 *  reproduce la caja del mundo, que es lo que Paper usa para pintar. */
function mapeoDeImagen(origen) {
    const w = Number(origen?.width), h = Number(origen?.height);
    if (!(w > 0) || !(h > 0)) return null;
    const matriz = origen.getGlobalMatrix?.();
    const b = origen?.bounds;
    if (!matriz || !b) return null;
    const candidatos = [
        new paper.Rectangle(-w / 2, -h / 2, w, h),
        new paper.Rectangle(0, 0, w, h)
    ];
    const error = r => {
        // Rectangle#transformed no existe en Paper 0.12.17: la caja transformada
        // se saca de sus cuatro esquinas.
        const esquinas = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft]
            .map(p => new paper.Point(p.x, p.y).transform(matriz));
        const xs = esquinas.map(p => p.x), ys = esquinas.map(p => p.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        const y0 = Math.min(...ys), y1 = Math.max(...ys);
        return Math.abs(x0 - b.x) + Math.abs(y0 - b.y)
            + Math.abs((x1 - x0) - b.width) + Math.abs((y1 - y0) - b.height);
    };
    return { caja: error(candidatos[0]) <= error(candidatos[1]) ? candidatos[0] : candidatos[1], matriz };
}

/** Silueta real de la imagen en coordenadas del lienzo. */
function siluetaDeImagen(origen, sampled) {
    const m = mapeoDeImagen(origen);
    if (!m || !sampled) return [];
    const loops = alphaSilhouetteContours(sampled, m.caja);
    if (!loops.length) return loops;
    return loops.map(loop => loop.map(p => new paper.Point(p.x, p.y).transform(m.matriz)));
}

/** La caja de la imagen como poligono YA girado/espejado: el respaldo cuando
 *  no hay alfa que leer (JPG opaco), que con la caja AABB dibujaba un
 *  rectangulo mas grande que la foto girada. */
function loopCajaImagen(origen) {
    const m = mapeoDeImagen(origen);
    if (!m) return null;
    const c = m.caja;
    return [c.topLeft, c.bottomLeft, c.bottomRight, c.topRight]
        .map(p => new paper.Point(p.x, p.y).transform(m.matriz));
}

/** Preview del anillo de vector/texto: trazo sobre la linea media de la
 *  banda, construido desde la forma original guardada (la misma fuente del
 *  panel vivo). Sin snapshot no hay preview: cae al camino final. */
function previsualizarVector(owner) {
    const snapshot = owner?.data?.outlineSourceGeomBase;
    if (!snapshot || !owner.parent) return null;
    const world = snapshot.clone({ insert: false });
    try {
        world.applyMatrix = false;
        world.transform(owner.globalMatrix || new paper.Matrix());
        world.applyMatrix = true;
    } catch (_) {}
    const control = readOutlineControls();
    let grupo = null;
    try {
        grupo = previsualizarBanda(world, control.width, control.side,
            Number(control.radius) || 0, control.scope);
    } catch (_) { grupo = null; }
    world.remove?.();
    return grupo ? instalarPreview(grupo) : null;
}

/** Preview del contorno de imagen: la BANDA MISMA, en magenta. Con el campo
 *  de distancias cacheado en el vinculo, mover Grosor o Posicion es volver a
 *  cortar el campo (una pasada sobre la grilla), no recalcular la transformada
 *  de distancia: por eso el arrastre muestra la forma real y no una linea
 *  aproximada sobre la silueta. Si no hay campo (JPG opaco, sin alfa que leer)
 *  devuelve null y el tick cae al camino final. */
function previsualizarImagen(vinculo) {
    const muestra = muestraDelVinculo(vinculo);
    if (!muestra?.sampled) return null;
    const control = readOutlineControls();
    let grupo = null;
    try {
        const band = bandaImagenViva(vinculo, muestra.origen, muestra.sampled, control);
        grupo = band ? previsualizarBandaGeom(band) : null;
        try { band?.remove?.(); } catch (_) {}
    } catch (_) { grupo = null; }
    return grupo ? instalarPreview(grupo) : null;
}

/** Rehace la banda de un vinculo de imagen, venga el cliente con la pieza o
 *  con el contorno. Si la banda se habia RETIRADO porque el alcance no daba
 *  geometria, se vuelve a armar: el panel no puede quedar muerto despues de
 *  tocar "Solo huecos" una vez. */
function bandaVivaDeImagen(vinculo, preview) {
    if (!vinculo) return null;
    if (preview) {
        const rapido = previsualizarImagen(vinculo);
        if (rapido) return rapido;
    }
    quitarPreview();
    if (vinculo.vacio || !vinculo.contorno?.parent) {
        const piezas = (vinculo.origenes && vinculo.origenes.length > 1)
            ? vinculo.origenes.filter(o => o?.parent)
            : [vinculo.origen];
        return crearContornoDeImagenes(piezas, readOutlineControls());
    }
    return regenerarContorno(vinculo.contorno, null);
}

/**
 * Recalcula el contorno VIVO: el que el cliente tiene seleccionado ahora.
 * Es lo que hace que mover un control se vea en el instante, sin apretar nada.
 *
 * modo "preview": tick de arrastre. Pinta el trazo magenta barato y NO toca
 * la pieza; la banda real se reconstruye al soltar. La capsula de linea de
 * corte es la excepcion: no tiene booleanas, asi que en preview tambien se
 * reconstruye de una.
 * modo "final" (default): geometria real y preview fuera.
 */
export function refrescarContornoVivo(modo = "final") {
    const preview = modo === "preview";
    const seleccion = (Array.isArray(window.selectedItems) && window.selectedItems.length)
        ? window.selectedItems
        : (window.selectedItem ? [window.selectedItem] : []);
    for (const item of seleccion) {
        const owner = ownerOf(item);
        //Caso 1: el cliente tiene seleccionado el contorno mismo.
        if (owner?.data?.source === "image-outline" || item?.data?.source === "image-outline") {
            const vinculo = vinculoDeContorno(owner) || vinculoDeContorno(item);
            if (vinculo) return bandaVivaDeImagen(vinculo, preview);
            if (!preview) { quitarPreview(); return regenerarContorno(owner); }
            const rapido = previsualizarImagen(vinculoDeContorno(owner));
            if (rapido) return rapido;
            quitarPreview();
            return regenerarContorno(owner);
        }
        // Caso 2: el contorno es de VECTOR o TEXTO (un anillo). La banda se
        // rehace desde la forma original guardada, sin toggle: es lo que hace
        // vivo al panel para las especies vectoriales.
        if (owner?.data?.isOutline === true || item?.data?.isOutline === true) {
            if (!preview) { quitarPreview(); return refreshOwnerOutline(owner, readOutlineControls()); }
            const rapido = previsualizarVector(owner);
            if (rapido) return rapido;
            quitarPreview();
            return refreshOwnerOutline(owner, readOutlineControls());
        }
        // Caso 3: tiene seleccionada la pieza. Como la app la envuelve, se
        // busca tambien en el registro comparando contra la pieza de origen.
        for (const vinculo of VINCULOS.values()) {
            if (vinculoDePieza(vinculo, item, owner)) {
                // Imagen: se rehace la silueta alfa. Linea de corte: se rehace
                // la capsula. Son motores distintos y el registro sabe cual.
                if (rasterDe(vinculo.origen) || vinculo.origenes) {
                    return bandaVivaDeImagen(vinculo, preview);
                }
                // La capsula es barata: preview y final son lo mismo.
                quitarPreview();
                return reconstruirContornoLinea(vinculo.contorno, vinculo.origen, readOutlineControls());
            }
        }
    }
    return null;
}

/** Muestrea el canal alfa de la imagen a una resolucion workable.
 *  Devuelve null si la imagen no tiene nada transparente: en ese caso el borde
 *  exterior es el rectangulo de la pieza y no hay nada que leer. */
export function sampleRasterAlpha(raster) {
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
/** Contornos cerrados de una muestra binaria (alpha 0..255 contra ISO 128).
 *  Publica para Trazar por regiones: cada region se pasa como mascara y este
 *  motor (el mismo de Contorno, con el stitcher corregido) devuelve sus
 *  loops. Con opciones.enGrid devuelve puntos de grid sin escalar. */
export function alphaSilhouetteContours(sampled, bounds, opciones = null) {
    const { alpha, width: w, height: h } = sampled;
    const ISO = ALPHA_ISO;
    // Escala del grid de muestreo a coordenadas de la pieza. Solo se usan en
    // el modo normal; enGrid no las necesita (y bounds puede venir null:
    // Trazar pasa mascaras sueltas sin rectangulo de pieza).
    const sx = bounds ? bounds.width / w : 1;
    const sy = bounds ? bounds.height / h : 1;
    const bx = bounds ? bounds.x : 0;
    const by = bounds ? bounds.y : 0;
    const enGrid = opciones?.enGrid === true;

    /* Esta funcion es la primera que costo una aplicacion de Contorno (perfil
       de CPU, probe 26: 298 ms de tiempo propio sobre la grilla ampliada de la
       banda). El ALGORITMO no cambio: marching squares con interpolacion lineal
       contra ISO, mismo code de celda, mismos 14 cases, mismo empalme. Lo que
       se sacó son las allocaciones del bucle caliente:
         - cuatro closures por celda de cruce (77 000 por aplicacion medida);
         - `at(x,y)` closureada cuatro veces por celda (4 M de llamadas);
         - un array de dos puntos por extremo de segmento;
         - una clave de texto por segmento para el empalme.
       La salida es la misma lista de loops, en el mismo orden y con los mismos
       numeros: se verifico punto por punto contra esta misma implementacion
       antes de escribir (lab/probe-contorno27.mjs). */
    const segs = [];              // 4 numeros por segmento: x0,y0,x1,y1
    const push = (ax, ay, cx, cy) => { segs.push(ax, ay, cx, cy); };
    // Cruce sobre la arista, en el mismo punto que antes: (ISO - v1)/(v2 - v1),
    // mitad de arista si el salto de valor es nulo.
    const fr = (v1, v2) => {
        const d = v2 - v1;
        return Math.abs(d) < 1e-6 ? 0.5 : (ISO - v1) / d;
    };

    const ultimaFila = h - 1, ultimaCol = w - 1;
    for (let y = 0; y < ultimaFila; y++) {
        const fila = y * w, filaAb = fila + w;
        // Ventana deslizante: de la fila de arriba solo se leen dos valores por
        // celda; el extremo derecho de la celda anterior es el izquierdo de esta.
        let tl = alpha[fila], tr = alpha[fila + 1];
        for (let x = 0; x < ultimaCol; x++) {
            const bl = alpha[filaAb + x], br = alpha[filaAb + x + 1];
            const code = (tl > ISO ? 1 : 0) | (tr > ISO ? 2 : 0)
                | (br > ISO ? 4 : 0) | (bl > ISO ? 8 : 0);
            const sig = alpha[fila + x + 2];
            if (code !== 0 && code !== 15) {
                // Puntos de cruce de las cuatro aristas, escritos como numeros.
                // Aristas: top(tl,tr), right(tr,br), bottom(bl,br), left(tl,bl).
                //
                // Orientacion UNICA: la region opaca queda siempre a la IZQUIERDA
                // del recorrido (left(d) = (dy, -dx) en coordenadas de pantalla).
                // Cada case complementario (N y 15-N comparten los mismos bordes de
                // cruce) debe ir en direccion OPUESTA: la esquina opaca (case 1) y
                // la esquina transparente (case 14) son situaciones opuestas y el
                // contorno las cruza al reves. Con la misma direccion en ambos,
                // cada punto de cruce queda con 2 salidas o 2 entradas y la cadena
                // se corta ahi: de ahi las decenas de bandas fragmentadas medidas
                // (donut curvo: 32 bandas; donut duro: 7).
                switch (code) {
                    case 1: push(x, y + fr(tl, bl), x + fr(tl, tr), y); break;
                    case 2: push(x + fr(tl, tr), y, x + 1, y + fr(tr, br)); break;
                    case 3: push(x, y + fr(tl, bl), x + 1, y + fr(tr, br)); break;
                    case 4: push(x + 1, y + fr(tr, br), x + fr(bl, br), y + 1); break;
                    case 6: push(x + fr(tl, tr), y, x + fr(bl, br), y + 1); break;
                    case 7: push(x, y + fr(tl, bl), x + fr(bl, br), y + 1); break;
                    case 8: push(x + fr(bl, br), y + 1, x, y + fr(tl, bl)); break;
                    case 9: push(x + fr(bl, br), y + 1, x + fr(tl, tr), y); break;
                    case 11: push(x + fr(bl, br), y + 1, x + 1, y + fr(tr, br)); break;
                    case 12: push(x + 1, y + fr(tr, br), x, y + fr(tl, bl)); break;
                    case 13: push(x + 1, y + fr(tr, br), x + fr(tl, tr), y); break;
                    case 14: push(x + fr(tl, tr), y, x, y + fr(tl, bl)); break;
                    case 5: {
                        // SADDLE: tl y br opacos. La conexion la decide el valor
                        // del CENTRO de la celda. Con el centro opaco tl y br
                        // quedan conectados en diagonal y el contorno rodea los
                        // vacios (tr y bl) por separado; con el centro vacio,
                        // rodea los opacos por separado.
                        if ((tl + tr + br + bl) / 4 > ISO) {
                            push(x + 1, y + fr(tr, br), x + fr(tl, tr), y);
                            push(x, y + fr(tl, bl), x + fr(bl, br), y + 1);
                        } else {
                            push(x, y + fr(tl, bl), x + fr(tl, tr), y);
                            push(x + 1, y + fr(tr, br), x + fr(bl, br), y + 1);
                        }
                        break;
                    }
                    case 10: {
                        // SADDLE espejado: tr y bl opacos.
                        if ((tl + tr + br + bl) / 4 > ISO) {
                            push(x + fr(tl, tr), y, x, y + fr(tl, bl));
                            push(x + fr(bl, br), y + 1, x + 1, y + fr(tr, br));
                        } else {
                            push(x + fr(tl, tr), y, x + 1, y + fr(tr, br));
                            push(x + fr(bl, br), y + 1, x, y + fr(tl, bl));
                        }
                        break;
                    }
                    default: break;
                }
            }
            tl = tr;
            tr = sig;
        }
    }
    const nSeg = segs.length >> 2;
    if (!nSeg) return [];

    // Empalme de segmentos en contornos cerrados.
    // Lineal: cada segmento se visita una sola vez y se saca de su cubo al
    // consumirse. Un empalme por busqueda lineal desde cada semilla es O(n^2)
    // y con una silueta de miles de segmentos cuelga el navegador.
    // La clave sigue siendo el punto redondeado a 1/64 de celda (mismo corte de
    // identidad que antes); se arma como numero en vez de texto porque eran dos
    // plantillas de string por segmento caminado. BIAS/MULT dejan el par
    // (kx,ky) sin colisiones para cualquier grilla real (miles de celdas).
    const BIAS = 1048576, MULT = 2097152;
    const clave = (px, py) => (Math.round(px * 64) + BIAS) * MULT + (Math.round(py * 64) + BIAS);
    const buckets = new Map();
    for (let i = 0; i < nSeg; i++) {
        const k = clave(segs[4 * i], segs[4 * i + 1]);
        let cubo = buckets.get(k);
        if (!cubo) { cubo = []; buckets.set(k, cubo); }
        cubo.push(i);
    }
    const consumido = new Uint8Array(nSeg);
    const planos = [];
    for (let semilla = 0; semilla < nSeg; semilla++) {
        if (consumido[semilla]) continue;
        const plano = [];
        let actual = semilla, anterior = -1;
        while (actual >= 0 && !consumido[actual]) {
            consumido[actual] = 1;
            const o = 4 * actual;
            // Los DOS extremos del segmento, como antes: si la cadena se corta
            // sin cerrar (frecuente en mascaras de ruido, imposible en una banda
            // binaria) el extremo del ultimo segmento es un vertice que no puede
            // perderse. La redundancia se quiere despues, al armar la salida.
            plano.push(segs[o], segs[o + 1], segs[o + 2], segs[o + 3]);
            // Siguiente: el segmento que arranca en el extremo final.
            const cubo = buckets.get(clave(segs[o + 2], segs[o + 3]));
            let siguiente = -1;
            if (cubo) {
                for (let i = 0; i < cubo.length; i++) {
                    if (!consumido[cubo[i]] && cubo[i] !== anterior) { siguiente = cubo[i]; break; }
                }
            }
            anterior = actual;
            actual = siguiente;
        }
        // CUATRO VERICES (16 numeros con los dos extremos por segmento), el
        // mismo minimo que la referencia.
        if (plano.length >= 16) planos.push(plano);
    }

    // A coordenadas de la pieza, y se descartan los hilos sin area.
    // enGrid: devuelve los puntos en coordenadas de GRID (nodo = centro del
    // pixel) sin escalar a la pieza. Lo usa Trazar por regiones, que mapea
    // con su propia conversion (centro de pixel + localToGlobal) para
    // soportar rasters escalados o rotados.
    //
    // SIN VERTICES REPETIDOS: el empaque por segmentos escribe cada nodo dos
    // veces (es el extremo de un segmento y el arranque del siguiente), y el
    // ultimo repite el primero para cerrar. MEDIDO contra la referencia del
    // remoto f988 sobre DR_bn.png: 6 106 puntos que son 3 043 distintos. Un
    // CompoundPath con nodos duplicados sale a LightBurn con segmentos de
    // longitud cero, que la maquina lee como mordidas quieta; aca se sueltan.
    const sal = [];
    for (const plano of planos) {
        const nv = plano.length >> 1;
        const pts = [];
        let ux = NaN, uy = NaN;
        for (let i = 0; i < nv; i++) {
            const gx = plano[2 * i], gy = plano[2 * i + 1];
            if (gx === ux && gy === uy) continue;
            ux = gx; uy = gy;
            const px = enGrid ? gx : bx + gx * sx;
            const py = enGrid ? gy : by + gy * sy;
            pts.push(enGrid ? { x: px, y: py } : new paper.Point(px, py));
        }
        if (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) {
            pts.pop();
        }
        const np = pts.length;
        if (np < 3) continue;
        let area = 0;
        for (let i = 0; i < np; i++) {
            const a = pts[i], b = pts[(i + 1) % np];
            area += a.x * b.y - b.x * a.y;
        }
        if (Math.abs(area / 2) > 1e-6) sal.push(pts);
    }
    return sal;
}

/* ==================================================================
   BANDA EN DOMINIO DE MASCARA — el motor de Contorno para imagenes.

   El motor vectorial (mitres + booleanas de Paper) sobre la silueta leida
   del alfa NO sirve: esa silueta tiene miles de puntos con escalones de un
   pixel y las mitres en un poligono asi se cruzan. MEDIDO con DR_bn.png a
   grosor 20 Exterior la banda salia 78,8 unidades fuera de la caja que
   permite la pieza, con picos negros sobre el torso y un anillo corrido
   ~99 unidades sobre la cabeza. En grabado laser eso es una mordida fuera
   de la pieza.
   Aqui no hay mitres ni booleanas: se calcula la distancia euclidiana exacta
   a la frontera sobre la propia grilla de alfa (transformada separable de
   Felzenszwalb & Huttenlocher, O(n) por celda) y la banda es un intervalo de
   distancia. Es la misma geometria que da el contorno de Photoshop y sale
   con la resolucion del muestreo, no con la suerte de la booleana.
   ================================================================== */
const EDT_INF = 1e15;
const EDT_NO_ALCANZABLE = 1e14;

/** DT euclidiana 1D (Felzenszwalb & Huttenlocher) sobre una linea. Entrada y
 *  salida estan AL CUADRADO en unidades de doc; `celda` es el tamano de celda
 *  en unidades de doc. Escribe en `out`. */
function dtLinea(f, n, celda, out, v, z) {
    const c2 = celda * celda;
    const corte = (q, p) => (f[q] - f[p]) / (2 * c2 * (q - p)) + (q + p) / 2;
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
        let s = corte(q, v[k]);
        // k > 0: con el borde izquierdo en -Infinity nunca se desapila el
        // ultimo indice (eso leia v[-1] y devolvia NaN en una fila sin
        // ninguna semilla).
        while (k > 0 && s <= z[k]) {
            k -= 1;
            s = corte(q, v[k]);
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k += 1;
        const p = v[k];
        const d = (q - p) * celda;
        out[q] = f[p] + d * d;
    }
    return out;
}

/** EDT euclidiana exacta de una grilla. `semilla` vale 0 en las celulas de
 *  referencia y EDT_INF en el resto; se CONSUME (escribe encima) para no
 *  duplicar un array de un millon de doubles. Salida: distancia al cuadrado
 *  en unidades de doc. Las celdas pueden ser rectangulares (celdaX != celdaY):
 *  el minimo separable sigue siendo exacto. */
function edtDistancias(semilla, w, h, celdaX, celdaY) {
    const d = semilla;
    const largo = Math.max(w, h) + 1;
    const tmp = new Float64Array(largo);
    const out = new Float64Array(largo);
    const v = new Int32Array(largo);
    const z = new Float64Array(largo + 1);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) tmp[y] = d[y * w + x];
        dtLinea(tmp, h, celdaY, out, v, z);
        for (let y = 0; y < h; y++) d[y * w + x] = out[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) tmp[x] = d[y * w + x];
        dtLinea(tmp, w, celdaX, out, v, z);
        for (let x = 0; x < w; x++) d[y * w + x] = out[x];
    }
    return d;
}

/** Celulas transparentes conectadas al borde de la grilla (4 vecinos): el
 *  "afuera" de la pieza. 4 no es capricho: el relleno que traza el marching
 *  squares es 8-conexo (los saddle se resuelven por el centro de la celda) y
 *  el dominio exterior tiene que ser su dual, si no un vacio pinchado en
 *  diagonal se escapa como borde cuando es hueco. */
function regionExterior(material, w, h) {
    const n = w * h;
    const ext = new Uint8Array(n);
    const pila = new Int32Array(n);
    let tope = 0;
    const push = i => {
        if (material[i] || ext[i]) return;
        ext[i] = 1;
        pila[tope++] = i;
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (tope > 0) {
        const i = pila[--tope];
        const x = i % w;
        const y = (i - x) / w;
        if (x > 0) push(i - 1);
        if (x < w - 1) push(i + 1);
        if (y > 0) push(i - w);
        if (y < h - 1) push(i + w);
    }
    return ext;
}

/** Tamano de celda mas chico, en unidades de doc. Sirve para traducir el
 *  alcance de la banda (Radio + Grosor) a celulas de la grilla. */
function celdaMinima(origen, sampled) {
    const m = mapeoDeImagen(origen);
    if (!m || !sampled?.width || !sampled?.height) return 0;
    const mx = m.matriz;
    const ex = (Math.hypot(mx.a, mx.b) || 1) * m.caja.width / sampled.width;
    const ey = (Math.hypot(mx.c, mx.d) || 1) * m.caja.height / sampled.height;
    if (!(ex > 0) || !(ey > 0)) return 0;
    return Math.min(ex, ey);
}

/** Cuanto hay que ampliar la grilla para que la banda EXTERIOR pueda envolver
 *  la silueta donde toca el borde de la imagen. Se redondea al siguiente
 *  doble: mover la barra de Grosor de 20 a 24 no vuelve a pagar la transformada
 *  de distancia. Y esta topado por area (2,5 M de celulas) para no inflar la
 *  memoria del navegador con una pieza chica y una banda enorme. */
function padBanda(sampled, cell, reach) {
    const n = (sampled?.width || 0) * (sampled?.height || 0);
    if (!(n > 0)) return 2;
    const lado = Math.sqrt(n);
    const cap = Math.max(2, Math.floor((Math.sqrt(2500000) - lado) / 2));
    if (!(cell > 0) || !(reach > 0)) return Math.min(cap, 2);
    const needed = Math.ceil(reach / cell) + 1;
    let p = 2;
    while (p < needed && p < cap) p *= 2;
    return Math.min(Math.max(p, 2), cap);
}

/** Firma del CAMPO de distancias: solo cambia con la matriz de la imagen, la
 *  resolucion del muestreo, el alfa y el alcance. Grosor/Posicion/Radio NO
 *  entran: esos son un corte sobre el mismo campo, y es lo que permite mover una
 *  barra sin pagar la EDT en cada tick. El padding tampoco entra —se compara
 *  aparte, en campoVivo— porque un campo MAS amplio siempre sirve para un
 *  alcance menor. */
function firmaCampo(origen, sampled, scope) {
    const m = mapeoDeImagen(origen);
    const mx = m ? [m.matriz.a, m.matriz.b, m.matriz.c, m.matriz.d, m.matriz.tx, m.matriz.ty]
        .map(v => Math.round(v * 1e6) / 1e6).join(",") : "sin-matriz";
    const alpha = sampled?.alpha;
    let suma = 0;
    if (alpha) for (let i = 0; i < alpha.length; i += 17) suma = (suma * 31 + alpha[i]) | 0;
    return [mx, sampled?.width, sampled?.height, suma,
        ["outer", "holes"].includes(String(scope)) ? String(scope) : "all"].join("|");
}

/**
 * El campo de distancias con signo de la silueta, en unidades de doc:
 *   sd > 0  -> celula del dominio exterior, a sd de la frontera
 *   sd < 0  -> celula de material, a -sd de la frontera
 *   NaN     -> celula que el alcance pedido no usa (p. ej. huecos en "Solo
 *              borde"), o sin frontera alcanzable
 * Devuelve null si no hay silueta que bandear (caja llena o vacia): eso lo
 * resuelve el camino vectorial de la caja.
 */
function construirCampo(origen, sampled, scope, pad) {
    const m = mapeoDeImagen(origen);
    if (!m || !sampled) return null;
    const { alpha, width: w, height: h } = sampled;
    const n = w * h;
    if (!(n > 0)) return null;

    const material = new Uint8Array(n);
    let opacas = 0;
    for (let i = 0; i < n; i++) {
        if (alpha[i] > ALPHA_ISO) { material[i] = 1; opacas += 1; }
    }
    if (!opacas || opacas >= n) return null;

    const alcance = ["outer", "holes"].includes(String(scope)) ? String(scope) : "all";

    // Las distancias se miden en UNIDADES DE DOC, no de imagen: el Grosor del
    // panel es doc. La matriz puede escalar distinto en X e Y (y girar); el
    // giro no altera la medida de la distancia, la escala si.
    const mx = m.matriz;
    const escX = Math.hypot(mx.a, mx.b) || 1;
    const escY = Math.hypot(mx.c, mx.d) || 1;
    const celdaImgX = m.caja.width / w;
    const celdaImgY = m.caja.height / h;
    const celdaX = celdaImgX * escX;
    const celdaY = celdaImgY * escY;
    if (!(celdaX > 0) || !(celdaY > 0)) return null;

    const ext = alcance === "all" ? null : regionExterior(material, w, h);

    pad = Math.max(1, Math.floor(Number(pad) || 0) || 2);
    const pw = w + pad * 2;
    const ph = h + pad * 2;
    const pn = pw * ph;
    const matP = new Uint8Array(pn);
    const fueraP = new Uint8Array(pn);
    let cntFuera = 0;
    for (let y = 0; y < h; y++) {
        const base = (y + pad) * pw + pad;
        const src = y * w;
        for (let x = 0; x < w; x++) {
            const s = src + x;
            const d = base + x;
            if (material[s]) { matP[d] = 1; continue; }
            let fuera = true;
            if (alcance === "outer") fuera = !!ext[s];
            else if (alcance === "holes") fuera = !ext[s];
            if (fuera) { fueraP[d] = 1; cntFuera += 1; }
        }
    }
    // El anillo de padding es afuera de la imagen: cuenta para "all" y para
    // "outer" (es la continuidad natural del exterior), no para "holes". La
    // ultima cuadro de la grilla ampliada queda SIEMPRE sin dominio: asi ningun
    // contorno puede apoyarse en el borde del array, donde el marching squares
    // no traza y la cadena saldria abierta.
    if (alcance !== "holes") {
        for (let i = 0; i < pn; i++) {
            if (matP[i] || fueraP[i]) continue;
            const x = i % pw;
            const y = (i - x) / pw;
            if (x < pad || x >= pw - pad || y < pad || y >= ph - pad) {
                if (x < 1 || y < 1 || x > pw - 2 || y > ph - 2) continue;
                fueraP[i] = 1;
                cntFuera += 1;
            }
        }
    }
    if (!cntFuera) return null;

    const sd = new Float32Array(pn);
    sd.fill(NaN);
    const siembra = new Float64Array(pn);
    // 1) Distancia al material: vale para las celulas del dominio exterior.
    for (let i = 0; i < pn; i++) siembra[i] = matP[i] ? 0 : EDT_INF;
    edtDistancias(siembra, pw, ph, celdaX, celdaY);
    for (let i = 0; i < pn; i++) {
        if (matP[i] || !fueraP[i]) continue;
        const v = Math.sqrt(siembra[i]);
        sd[i] = v < EDT_NO_ALCANZABLE ? v : NaN;
    }
    // 2) Distancia al dominio exterior del alcance: vale para el material.
    for (let i = 0; i < pn; i++) siembra[i] = fueraP[i] ? 0 : EDT_INF;
    edtDistancias(siembra, pw, ph, celdaX, celdaY);
    for (let i = 0; i < pn; i++) {
        if (!matP[i]) continue;
        const v = -Math.sqrt(siembra[i]);
        sd[i] = v > -EDT_NO_ALCANZABLE ? v : NaN;
    }
    return { sd, pw, ph, pad, celdaImgX, celdaImgY, caja: m.caja, matriz: m.matriz, alcance, material: matP };
}

/* El campo de distancias es LO CARO del contorno de imagen: dos pasadas EDT
   sobre una grilla de hasta un millon de celdas. La cache tiene que vivir AFUERA
   del vinculo, porque el vinculo se recrea en cada aplicacion ("regenerar, nunca
   duplicar") y con la cache encima del vinculo nunca daba: mover la barra de
   Grosor costaba lo mismo frio que tibio (MEDIDO con DR_bn.png: 438-618 ms por
   llamada). La clave es la firma del campo —matriz, muestreo, suma del alfa,
   alcance y padding—, asi que girar, escalar, recortar o cambiar de alcance
   recalculan solos y Grosor/Posicion/Separacion caen en el mismo campo.
   Tope de 3 campos por LRU: cada uno es un Float32Array del tamano de la grilla
   ampliada, y la memoria del navegador vale mas que el historial de un desliz.

   Un campo sirve para CUALQUIER alcance que quepa en su padding: la distancia de
   una celula al material no depende de cuanto array haya alrededor, solo de donde
   esta el material. Por eso la clave NO lleva el padding y se compara aparte: al
   bajar Grosor o Separacion se reusa el campo mas amplio que ya esta en memoria,
   en vez de tirar el bueno y pagar otra transformada de distancia. MEDIDO con
   DR_bn.png (675 x 1200 de grilla, celda 0,332): barrer Grosor 20 -> 40 -> 20
   costaba 238 + 322 ms; con esta regla el segundo 20 cae en el cache. */
const CAMPOS = new Map();
const CAMPOS_MAX = 3;

function campoVivo(origen, sampled, scope, pad) {
    const clave = firmaCampo(origen, sampled, scope);
    const previo = CAMPOS.get(clave);
    if (previo && previo.pad >= pad) {
        CAMPOS.delete(clave);
        CAMPOS.set(clave, previo);
        return previo;
    }
    const campo = construirCampo(origen, sampled, scope, pad);
    if (!campo) return null;
    CAMPOS.delete(clave);
    CAMPOS.set(clave, campo);
    while (CAMPOS.size > CAMPOS_MAX) CAMPOS.delete(CAMPOS.keys().next().value);
    return campo;
}

/** Ramer-Douglas-Peucker sobre un loop CERRADO dado como dos arrays de numeros
 *  (coordenadas del lienzo). Devuelve los indices que se conservan, en orden.
 *  Se parte por el vertice mas lejano del primero, y sobre las dos cadenas
 *  abiertas que resultan aplica DP con pila explicita (sin recursion: una banda
 *  de DR_bn.png llega con miles de vertices y la recursion se hunde).
 *
 *  Es el MISMO corte geometrico que `Path#simplify` de Paper, sin el ajuste de
 *  curvas, que era lo caro: medido con el perfil de CPU (probe 26), simplify
 *  costaba 379 ms de los ~500 de una aplicacion y `fitCubic` se comia la mitad.
 *  La cota de error no cambia: la poligonal conservada no se separa mas de
 *  `tol` de la cruda, y `tol` es una celda de muestreo (0,332 unidades de doc
 *  sobre DR_bn.png, menos de un pixel de la foto). El error queda acotado por
 *  la resolucion con la que se leyo el alfa, no por la suerte del ajuste. */
function decimarCerrada(xs, ys, tol) {
    const n = xs.length;
    const todos = [];
    for (let i = 0; i < n; i++) todos.push(i);
    if (n <= 8 || !(tol > 0)) return todos;

    let partir = 1, peor = -1;
    const x0 = xs[0], y0 = ys[0];
    for (let i = 1; i < n; i++) {
        const dx = xs[i] - x0, dy = ys[i] - y0;
        const d2 = dx * dx + dy * dy;
        if (d2 > peor) { peor = d2; partir = i; }
    }

    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[partir] = 1;
    const tol2 = tol * tol;
    const pila = [[0, partir], [partir, n]];
    while (pila.length) {
        const par = pila.pop();
        const a = par[0], b = par[1];
        if (b - a < 2) continue;
        const ax = xs[a % n], ay = ys[a % n];
        const bx = xs[b % n], by = ys[b % n];
        const vx = bx - ax, vy = by - ay;
        const l2 = vx * vx + vy * vy;
        let maxD = -1, cand = -1;
        for (let i = a + 1; i < b; i++) {
            const px = xs[i % n], py = ys[i % n];
            const cx = px - ax, cy = py - ay;
            // Distancia a la RECTA de la cuerda (DP clasico): es lo que acota
            // el apartamiento de la poligonal respecto de la linea cruda.
            const d2 = l2 === 0
                ? (cx * cx + cy * cy)
                : ((cx * vy - cy * vx) * (cx * vy - cy * vx)) / l2;
            if (d2 > maxD) { maxD = d2; cand = i; }
        }
        if (cand > a && maxD > tol2) {
            keep[cand % n] = 1;
            pila.push([a, cand], [cand, b]);
        }
    }
    const salida = [];
    for (let i = 0; i < n; i++) if (keep[i]) salida.push(i);
    return salida.length >= 3 ? salida : todos;
}

/** ¿Que hay dentro de este loop de banda? Devuelve cuantas celulas de la grilla
 *  encierra (`dentro`) y cuantas de ellas son material (`mat`), contando con
 *  barrido even-odd sobre la caja del propio loop. Sirve para separar las tres
 *  formas que tiene un loop chico:
 *    - el PUNTO que genera un grano de alfa: encierra su granito de material;
 *    - la FRONTERA de un hueco real: encierra celdas vacias y son muchas, es
 *      geometria de la pieza y hay que conservarla aunque sea chica;
 *    - el ESCALON degenerado que suelta el marching squares entre dos celulas
 *      que se tocan por punta: no encierra nada (o una o dos celulas), no es
 *      ni pieza ni hueco, es artificio del trazado.
 *  `loop` esta en coordenadas de la caja ampliada (antes de la matriz), que es
 *  justo el espacio de la grilla, asi que no hace falta invertirla. */
function encerradoDelLoop(loop, caja, pw, ph, material) {
    const sx = caja.width / pw, sy = caja.height / ph;
    if (!(sx > 0) || !(sy > 0)) return { dentro: 1, mat: 1 };   // sin escala no hay como medir: no botar
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of loop) {
        if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
    }
    const gx0 = Math.max(0, Math.floor((minX - caja.x) / sx));
    const gx1 = Math.min(pw - 1, Math.ceil((maxX - caja.x) / sx));
    const gy0 = Math.max(0, Math.floor((minY - caja.y) / sy));
    const gy1 = Math.min(ph - 1, Math.ceil((maxY - caja.y) / sy));
    const n = loop.length;
    const cortes = [];
    let dentro = 0, mat = 0;
    for (let gy = gy0; gy <= gy1; gy++) {
        const y = caja.y + (gy + 0.5) * sy;
        cortes.length = 0;
        for (let i = 0; i < n; i++) {
            const a = loop[i], b = loop[(i + 1) % n];
            if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
                cortes.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
            }
        }
        if (cortes.length < 2) continue;
        cortes.sort((p, q) => p - q);
        const fila = gy * pw;
        for (let k = 0; k + 1 < cortes.length; k += 2) {
            const c0 = Math.max(gx0, Math.round((cortes[k] - caja.x) / sx - 0.5));
            const c1 = Math.min(gx1, Math.round((cortes[k + 1] - caja.x) / sx - 0.5));
            for (let gx = c0; gx <= c1; gx++) { dentro += 1; if (material[fila + gx]) mat += 1; }
        }
    }
    return { dentro, mat };
}

/** La banda: cortar el campo por el intervalo que piden Posicion, Radio y
 *  Grosor, y trazar la mascara resultante. */
function bandaDesdeCampo(campo, control) {
    if (!campo) return null;
    const width = Math.max(1, Math.abs(Number(control.width) || 0) || 1);
    const radius = Math.max(0, Number(control.radius) || 0);
    const lado = ["inside", "outside", "center"].includes(String(control.side))
        ? String(control.side) : "center";
    const enBanda = sd => {
        if (lado === "outside") return sd >= radius && sd <= radius + width;
        if (lado === "inside") return sd <= -radius && sd >= -(radius + width);
        return sd >= radius - width / 2 && sd <= radius + width / 2;
    };
    const { sd, pw, ph, pad, celdaImgX, celdaImgY, caja, matriz, material: matP } = campo;
    const banda = new Uint8Array(sd.length);
    let cnt = 0;
    for (let i = 0; i < sd.length; i++) {
        const v = sd[i];
        if (v !== v) continue;                       // NaN = celula fuera del alcance
        if (enBanda(v)) { banda[i] = 255; cnt += 1; }
    }
    if (!cnt) return null;

    // El trazo lo hace el MISMO marching squares del calco, sobre la mascara
    // de banda (0 / 255). Con valores binarios e ISO 128 el cruce cae a mitad
    // de celda, o sea en el limite entre la celula dentro y la de fuera.
    const muestra = { alpha: banda, width: pw, height: ph };
    const cajaP = new paper.Rectangle(
        caja.x - celdaImgX * pad, caja.y - celdaImgY * pad,
        caja.width + celdaImgX * pad * 2, caja.height + celdaImgY * pad * 2
    );
    const loops = alphaSilhouetteContours(muestra, cajaP);
    if (!loops.length) return null;

    const comp = new paper.CompoundPath({ insert: false });
    comp.applyMatrix = false;
    comp.matrix = new paper.Matrix();
    comp.fillRule = "evenodd";
    // LIMPIEZA DEL ESCALON. El marching squares entrega UN nodo por cruce de
    // celda: sobre DR_bn.png (celda de 0,332 unidades de doc) la banda de
    // Grosor 20 salia con 19 296 nodos, y MEDIDO con simplify a 1 celda: 265
    // nodos, area movida 0,01% y caja movida 0,42 unidades (1,27 celdas), o
    // sea menos de un pixel de la foto. Un contorno de 20 000 nodos no se puede
    // editar ni mandar a LightBurn, y en pantalla se ve dentado: la tolerancia
    // de la propia resolucion de muestreo es el corte honesto.
    //
    // La matriz se aplica con aritmetica suelta, no con `new Point().transform`:
    // sobre la banda cruda eran ~10 000 objetos Paper y sus multiplicaciones, y
    // ahi estaba el resto del coste que mostro el perfil.
    const tol = Math.max(Number(celdaImgX) || 0, Number(celdaImgY) || 0);
    // POLVO. Cada grano de alfa que deja el recorte se convierte en un puntito
    // de banda del tamano del propio grosor (medido con Grosor 2 / Centro en
    // "2 SIN FONDO.png" y "12 SIN FONDO.png": loops de 0,25 / 0,40 / 2,13 /
    // 2,22 / 3,12 unidades de doc, al lado del anillo real de 21 138). Un loop
    // que encierra menos area que el cuadrado del grosor pedido esta por debajo
    // de la resolucion que el cliente pidio: es ruido, no geometria, y en la
    // maquina es una marca de mas. Es el mismo corte que ya aplicaba el camino
    // vectorial (`amount * amount`), asi imagen y vector usan una sola regla.
    //
    // La excepcion es la frontera de un HUECO: encierra vacio, no material, y es
    // geometria real de la pieza aunque sea chica (medido en el banco de la
    // pieza con huecos, Grosor 12: el hueco de 11,9 unidades tiene frontera de
    // 111 < 12 x 12 y habria desaparecido, comiendose el hueco). Por eso el corte
    // no mira solo el area: un loop chico es polvo si encierra material (grano)
    // o si no encierra casi ninguna celda (escalon degenerado del trazado).
    //
    // FALTA LA TERCERA FORMA, y es la que quedaba: el escalon de DOS o TRES
    // CELULAS que si encierra sus celdas, o sea que pasa los dos filtros anteriores
    // y se queda en la banda. Medido en "2 SIN FONDO.png" y "12 SIN FONDO.png"
    // con Grosor 2 / Centro: 3 loops de extension [1x1], [2x2] y [3x3] celdas
    // (0,19 / 0,37 / 0,56 unidades de doc, areas 0,018 / 0,053 / 0,088). Cuatro
    // celdas es la medida honesta: la grilla se arma con ALPHA_SCAN_MAX = 1200
    // columnas, asi que 4 celdas son 1/300 del ancho de la imagen, menos de 7
    // pixeles reales en una foto de 2000 px. Nada de eso es trazable en la
    // maquina y todo eso cambia de forma segun como caiga el muestreo.
    //
    // La extension se mide en CELDAS y en el espacio de la grilla, no en unidades
    // del documento: la regla tiene que valer igual para una foto de 224 unidades
    // y para una de 20, y no puede depender del giro de la pieza.
    const areaMinima = width * width;
    const POLVO_CELULAS = 3;
    const POLVO_LARGO = 4;
    const celdaX = cajaP.width / pw, celdaY = cajaP.height / ph;
    const mx = matriz;
    const hojas = [];
    let masChica = null;
    loops.forEach(loop => {
        const n = loop.length;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < n; i++) {
            const p = loop[i];
            if (p.x < x0) x0 = p.x; else if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y; else if (p.y > y1) y1 = p.y;
        }
        const celdas = (x1 - x0) / celdaX, filas = (y1 - y0) / celdaY;
        const cortoDemas = celdas < POLVO_LARGO && filas < POLVO_LARGO;
        const xs = new Float64Array(n), ys = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const p = loop[i], X = p.x, Y = p.y;
            xs[i] = mx.a * X + mx.c * Y + mx.tx;
            ys[i] = mx.b * X + mx.d * Y + mx.ty;
        }
        const keep = decimarCerrada(xs, ys, tol);
        if (keep.length < 3) return;
        let doble = 0;
        for (let i = 0, k = keep.length; i < k; i++) {
            const a = keep[i], b = keep[(i + 1) % k];
            doble += xs[a] * ys[b] - xs[b] * ys[a];
        }
        const segmentos = new Array(keep.length);
        for (let i = 0; i < keep.length; i++) segmentos[i] = [xs[keep[i]], ys[keep[i]]];
        const hoja = { segmentos, area: Math.abs(doble) / 2 };
        const enc = !cortoDemas && hoja.area < areaMinima
            ? encerradoDelLoop(loop, cajaP, pw, ph, matP) : null;
        const esPolvo = cortoDemas || (!!enc && (enc.mat > 0 || enc.dentro < POLVO_CELULAS));
        if (!esPolvo) hojas.push(hoja);
        else if (!masChica || hoja.area > masChica.area) masChica = hoja;
    });
    // Si todos los loops son polvo la pieza entera es mas chica que el grosor:
    // se devuelve el unico punto que hay antes que un "no paso nada" inexplicable.
    if (!hojas.length && masChica) hojas.push(masChica);
    hojas.forEach(hoja => comp.addChild(
        new paper.Path({ segments: hoja.segmentos, closed: true, insert: false })));
    if (!comp.children.length) return null;
    return comp;
}

/** VISTA PREVIA TIPO BOOLEANAS para el boton Contorno: como quedaria el
 *  anillo de la seleccion ACTUAL, sin instalar nada. Es el "mostrar como
 *  quedaria" previo al clic que pidio el cliente (mismo gesto que la
 *  Interseccion Booleana). Respeta el control "Aplicar a" del panel:
 *  Todo junta -> un anillo alrededor de la silueta de toda la seleccion
 *  (solo vectores: el texto se convierte recien al aplicar, y convertirlo
 *  aqui instalaria geometria); Por pieza -> un anillo por objeto. Todo se
 *  calcula sobre clones; si algo falla no hay fantasma y el clic hace lo de
 *  siempre. Devuelve true si el fantasma quedo instalado. */
function previsualizarContornoSeleccion() {
    const seleccion = (Array.isArray(window.selectedItems) && window.selectedItems.length)
        ? window.selectedItems
        : (window.selectedItem ? [window.selectedItem] : []);
    const owners = [];
    const vistos = new Set();
    seleccion.forEach(item => {
        const o = ownerOf(item);
        if (!o || !isDesignObject(o) || vistos.has(o)) return;
        vistos.add(o);
        owners.push(o);
    });
    if (!owners.length) return false;
    const control = readOutlineControls();
    const bandas = [];

    try {
        const especies = owners.map(o => ({ o, sp: speciesOf(o) }));
        const vectores = especies.filter(e => e.sp === "vector");
        const imagenes = especies.filter(e => e.sp === "raster");
        if (!vectores.length && !imagenes.length) return false;
        const todoJunto = control.apply !== "pieces" && vectores.length > 1 && !imagenes.length;

        if (todoJunto) {
            const union = unirGeometrias(vectores.map(e => e.o));
            if (!union) return false;
            const band = buildOutlineGeometry(union, control.width, control.side,
                Number(control.radius) || 0, Number(control.smoothing) || 0, control.scope);
            union.remove?.();
            if (!band) return false;
            bandas.push(band);
        } else {
            vectores.forEach(e => {
                let geo = null;
                try { geo = toWorldGeometry(e.o); } catch (_) { geo = null; }
                if (!geo) return;
                const band = buildOutlineGeometry(geo, control.width, control.side,
                    Number(control.radius) || 0, Number(control.smoothing) || 0, control.scope);
                geo.remove?.();
                if (band) bandas.push(band);
            });
            imagenes.forEach(e => {
                const raster = rasterDe(e.o);
                if (!raster) return;
                const sampled = sampleRasterAlpha(raster);
                const band = bandaExactaDeImagen(raster, sampled, control);
                if (band) bandas.push(band);
            });
        }
    } catch (_) {
        bandas.forEach(b => { try { b.remove?.(); } catch (_) {} });
        return false;
    }
    if (!bandas.length) return false;

    const zoom = paper.view?.zoom || 1;
    const grupo = new paper.Group({ insert: false });
    grupo.data = { isSelectionBox: true, uiOnly: true, isOutlinePreview: true, isContornoHover: true };
    bandas.forEach(band => {
        try {
            const rosa = new paper.Color("#ff2ea6");
            rosa.alpha = 0.22;
            band.fillColor = rosa;
            band.strokeColor = new paper.Color("#ff2ea6");
            band.strokeWidth = 1.6 / zoom;
            band.dashArray = [5 / zoom, 3 / zoom];
            band.fillRule = "evenodd";
        } catch (_) {}
        grupo.addChild(band);
    });
    return !!instalarPreview(grupo);
}

/** Banda viva: la grilla de alfa se relee en cada llamada (una edicion de
 *  recorte tiene que verse al instante) pero el campo de distancias —lo caro—
 *  sale de CAMPOS y solo se recalcula si cambio la matriz, el alfa, el alcance
 *  o el padding. Mover Grosor/Posicion/Separacion es un corte sobre el campo
 *  guardado. Cuando no sale banda se anota el MOTIVO en el vinculo: el aviso al
 *  cliente se escribe con eso, y "no paso nada" deja de ser un misterio. */
function bandaImagenViva(vinculo, origen, sampled, control, exacto = false) {
    if (vinculo) vinculo.motivo = null;
    if (!sampled) { if (vinculo) vinculo.motivo = "sin-silueta"; return null; }
    const width = Math.max(1, Math.abs(Number(control.width) || 0) || 1);
    const radius = Math.max(0, Number(control.radius) || 0);
    /* FINAL EXACTO: el camino definitivo no pasa por la grilla. El campo de
       distancias tiene un piso fisico: una banda mas angosta que ~2 celdas de
       muestreo no tiene NI UNA celda dentro del intervalo (imagen de 200
       unidades con Grosor 1: celda 1.0, intervalo +/-0.5, cero celdas — medido
       con sonda). El motor vectorial no tiene ese piso: parte de la silueta
       interpolada y da el anillo exacto para cualquier grosor, con el area
       exacta de Photoshop. El FINAL va siempre por ahi (y sale mas barato:
       cero EDT por aplicacion); la grilla queda para el PREVIEW del arrastre,
       que es lo que la cache de campo hace bien. */
    if (exacto) return bandaExactaDeImagen(origen, sampled, control);
    const cell = celdaMinima(origen, sampled);
    const pad = padBanda(sampled, cell, radius + width);
    let campo;
    try {
        campo = campoVivo(origen, sampled, control.scope, pad);
    } catch (e) {
        if (vinculo) vinculo.motivo = "campo-fallo";
        console.warn("[EKKO CONTORNO] el campo de distancias fallo:", e && e.message);
        return null;
    }
    if (!campo) {
        // Sin celdas en el dominio pedido. Con "Solo huecos" la unica forma
        // de que eso pase es que la pieza no tenga huecos (medido sobre
        // DR_bn.png: 548 196 celdas de material, 261 804 de exterior,
        // 0 de hueco).
        if (vinculo) vinculo.motivo = String(control.scope) === "holes" ? "sin-huecos" : "sin-silueta";
        return null;
    }
    let base = bandaDesdeCampo(campo, control);
    if (!base) {
        if (vinculo) vinculo.motivo = "sin-banda";
        /* PLAN B del preview: la grilla se quedo corta para la banda pedida
           (o el motivo fue otro). El exacto no depende de la resolucion de
           muestreo: si da geometria, el preview muestra la banda de verdad
           en vez de un aviso de "no hay contorno". */
        const rescate = bandaExactaDeImagen(origen, sampled, control);
        if (rescate) { if (vinculo) vinculo.motivo = null; return rescate; }
        return null;
    }
    if (!(Number(control.smoothing) > 0)) return base;
    try { return applySmoothing(base, Number(control.smoothing)) || base; }
    catch (_) { return base; }
}

/** PLAN B EXACTO: banda por el motor vectorial sobre la silueta real.
 *  El campo de distancias trabaja sobre una grilla y su banda sale cuantizada
 *  a la celda; con Grosor fino respecto del muestreo se queda sin celdas y
 *  muere en "sin-banda". Este camino parte de la silueta interpolada
 *  (marching squares con alfa continuo, la misma que ve el cliente) y le
 *  aplica buildOutlineGeometry: anillo exacto para cualquier Grosor/Radio/
 *  Suavidad/Alcance, sin escalon y con el area exacta. Es el mismo motor que
 *  usaba el FINAL entregado (v11.41) y el que usa la imagen llena (JPG) hoy,
 *  asi que imagen recortada e imagen llena vuelven a compartir un solo
 *  camino de verdad. Devuelve null si ni silueta ni caja hay. */
function bandaExactaDeImagen(origen, sampled, control) {
    const loops = siluetaDeImagen(origen, sampled);
    const uso = loops.length ? loops : loopCajaImagen(origen);
    if (!uso || !uso.length) return null;
    const base = new paper.CompoundPath({ insert: false });
    base.applyMatrix = false;
    base.matrix = new paper.Matrix();
    base.fillRule = "evenodd";
    uso.forEach(loop => base.addChild(
        new paper.Path({ segments: loop, closed: true, insert: false })));
    const salida = buildOutlineGeometry(base, control.width, control.side,
        Number(control.radius) || 0, Number(control.smoothing) || 0, control.scope);
    base.remove?.();
    return salida;
}

/* ------------------------------------------------------------------
   TODO JUNTO SOBRE IMAGENES: una sola grilla de alfa para toda la
   seleccion.

   El boton Contorno estaba declarado para UN objeto (capabilities), asi que
   con dos imagenes seleccionadas simplemente no aparecia, y el panel prometa
   un "Todo junto" que el motor solo sabia hacer con vectores. La banda de
   imagen ya no depende de booleanas: se calcula sobre una grilla de alfa, y
   varias imagenes pueden compartir esa grilla. Se pinta cada foto en un canvas
   comun con SU matriz, se lee el alfa compuesto (que es la union: source-over
   suma alfa) y el motor de distancias trabaja sobre esa silueta unica como si
   fuera una sola imagen. Con esto "Todo junto" deja de ser una opcion que no
   hace nada y pasa a dar el borde de toda la composicion, que es lo que se
   espera de una herramienta tipo Photoshop.
   ------------------------------------------------------------------ */

/** Caja de un raster en coordenadas del lienzo (la caja propia, no la AABB). */
function cajaEnLienzo(raster) {
    const m = mapeoDeImagen(raster);
    if (!m) return null;
    const c = m.caja;
    const esquinas = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft]
        .map(p => new paper.Point(p.x, p.y).transform(m.matriz));
    const xs = esquinas.map(p => p.x), ys = esquinas.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys),
        x1: Math.max(...xs), y1: Math.max(...ys), mapeo: m,
        // Tamano de un pixel de la foto en unidades del doc, ya escalado.
        pixel: Math.min(Math.hypot(m.matriz.a, m.matriz.b) || Infinity,
                        Math.hypot(m.matriz.c, m.matriz.d) || Infinity) };
}

/** Grilla de alfa comun a varias imagenes + el "origen" sintetico que la
 *  devuelve al lienzo. Devuelve null si no hay nada que unir (una sola foto,
 *  fotos sin matriz, o una composicion totalmente opaca: ahi no hay silueta,
 *  hay rectangulos, y eso lo resuelve el camino por pieza). */
function unionDeAlfas(origenes) {
    if (typeof document === "undefined" || !Array.isArray(origenes) || origenes.length < 2) return null;
    const partes = [];
    let caja = null;
    let pixel = Infinity;
    for (const owner of origenes) {
        const raster = rasterDe(owner);
        if (!raster) return null;
        const c = cajaEnLienzo(raster);
        if (!c || !(c.pixel > 0)) return null;
        const element = raster.canvas || raster.getElement?.() || null;
        if (!element) return null;
        partes.push({ raster, element, c });
        if (!caja) caja = { x: c.x, y: c.y, x1: c.x1, y1: c.y1 };
        else {
            caja.x = Math.min(caja.x, c.x); caja.y = Math.min(caja.y, c.y);
            caja.x1 = Math.max(caja.x1, c.x1); caja.y1 = Math.max(caja.y1, c.y1);
        }
        pixel = Math.min(pixel, c.pixel);
    }
    const ancho = caja.x1 - caja.x, alto = caja.y1 - caja.y;
    if (!(ancho > 0) || !(alto > 0)) return null;
    // Celda: la mas fina entre las fotos, topada para que el lado mayor no
    // pase ALPHA_SCAN_MAX (la misma regla que sampleRasterAlpha).
    let celda = pixel;
    const lado = Math.max(ancho, alto);
    if (!(celda > 0) || lado / celda > ALPHA_SCAN_MAX) celda = lado / ALPHA_SCAN_MAX;
    const gw = Math.max(8, Math.round(ancho / celda));
    const gh = Math.max(8, Math.round(alto / celda));
    const cx = ancho / gw, cy = alto / gh;

    const canvas = document.createElement("canvas");
    canvas.width = gw;
    canvas.height = gh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, gw, gh);
    for (const p of partes) {
        const mx = p.c.mapeo.matriz, c = p.c.mapeo.caja;
        // pixel de la foto -> unidad de imagen (caja) -> lienzo -> grilla
        const A = mx.a / cx, C = mx.c / cx;
        const B = mx.b / cy, D = mx.d / cy;
        const E = (mx.a * c.x + mx.c * c.y + mx.tx - caja.x) / cx;
        const F = (mx.b * c.x + mx.d * c.y + mx.ty - caja.y) / cy;
        ctx.setTransform(A, B, C, D, E, F);
        try { ctx.drawImage(p.element, 0, 0); } catch (_) { /* una foto rota no cancela la union */ }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let data = null;
    try { data = ctx.getImageData(0, 0, gw, gh).data; } catch (_) { return null; }
    if (!data) return null;
    const alpha = new Uint8Array(gw * gh);
    let visible = 0;
    for (let i = 0, q = 3; i < alpha.length; i++, q += 4) {
        const v = data[q];
        alpha[i] = v;
        if (v > ALPHA_ISO) visible += 1;
    }
    if (!visible || visible >= alpha.length * 0.995) return null;

    // El "origen" sintetico: su espacio de imagen ES la grilla (1 unidad =
    // 1 celda) y su matriz la lleva al lienzo. Con eso celdaMinima, firmaCampo,
    // construirCampo y bandaDesdeCampo funcionan sin saber que son varias fotos.
    const anchoGrilla = gw * cx, altoGrilla = gh * cy;
    const origen = {
        width: gw,
        height: gh,
        bounds: new paper.Rectangle(caja.x, caja.y, anchoGrilla, altoGrilla),
        getGlobalMatrix: () => new paper.Matrix(cx, 0, 0, cy, caja.x, caja.y)
    };
    return { origen, sampled: { alpha, width: gw, height: gh, sourceW: gw, sourceH: gh }, partes: partes.length };
}

/** De que grilla sale la banda de un vinculo: la foto propia, o la grilla
 *  compartida cuando el contorno es "Todo junto" de varias imagenes. */
function muestraDelVinculo(vinculo) {
    if (!vinculo) return null;
    if (vinculo.origenes && vinculo.origenes.length > 1) {
        const vivos = vinculo.origenes.filter(o => o && o.parent);
        if (vivos.length > 1) {
            const union = unionDeAlfas(vivos);
            if (union) return union;
        }
    }
    const raster = rasterDe(vinculo.origen);
    if (!raster) return null;
    return { origen: raster, sampled: sampleRasterAlpha(raster) };
}

/**
 * El borde exterior de una o varias imagenes. Es SIEMPRE el mismo concepto:
 * una sola linea que dice hasta donde llega la pieza, y nada de lo que esta
 * adentro. De donde venga el borde no es una decision del cliente:
 *   - si la imagen esta llena hasta su caja, el borde es la caja;
 *   - si viene recortada, el borde es su silueta real (pelo y bigote
 *     incluidos), leida del canal alfa.
 * Con varias imagenes y "Todo junto" la silueta es la UNION de todas, medida
 * sobre una grilla de alfa comun (unionDeAlfas).
 * El cliente nunca tiene que clasificar nada. Y esto NO es Trazar: Trazar
 * analiza tonos y copia el objeto entero; aqui solo se lee el limite.
 */
function crearContornoDeImagenes(origenes, options = {}) {
    const lista = [];
    (Array.isArray(origenes) ? origenes : [origenes]).forEach(o => {
        const owner = ownerOf(o);
        if (owner && owner.bounds && !lista.includes(owner)) lista.push(owner);
    });
    if (!lista.length) return null;
    const esUnion = lista.length > 1;

    const width = Math.abs(Number(options.width) || 0) || 1;
    const side = ["inside", "outside", "center"].includes(String(options.side || "").toLowerCase())
        ? String(options.side).toLowerCase() : "center";
    const radius = Number(options.radius) || 0;
    const smoothing = Number(options.smoothing) || 0;
    const control = { ...options, width, side, radius, smoothing };

    // La grilla de alfa es de la IMAGEN (o de la union) y se devuelve al lienzo
    // con SU matriz (mapeoDeImagen): con la caja del dueno estiraba la silueta
    // cuando el dueno es un grupo mas grande que la foto (+34% de ancho, 10 px
    // de corrimiento) y con la caja AABB del mundo estiraba cualquier giro.
    let muestra = null;
    if (esUnion) {
        muestra = unionDeAlfas(lista);
    } else {
        const raster = rasterDe(lista[0]);
        if (!raster) return null;
        muestra = { origen: raster, sampled: sampleRasterAlpha(raster) };
    }
    if (!muestra) return null;

    // El vinculo se arma ANTES de la banda: la banda es lo caro y se cachea
    // encima de el, para que el arrastre de un control no recalcule la EDT.
    const vinculo = esUnion
        ? { contorno: null, origen: lista[0], origenes: lista.slice() }
        : { contorno: null, origen: lista[0] };

    const band = (() => {
        if (muestra.sampled) {
            // IMAGEN RECORTADA: banda en dominio de mascara (distancia
            // euclidiana exacta a la frontera). Si el alcance no tiene celdas
            // ("Solo huecos" sin huecos) NO se inventa un contorno: sin banda,
            // y el motivo se avisa al cliente en la boca que llamo.
            // FINAL = exacto: el anillo lo da el motor vectorial sobre la
            // silueta real (areas exactas, cualquier grosor); la grilla queda
            // para el preview del arrastre.
            return bandaImagenViva(vinculo, muestra.origen, muestra.sampled, control, true);
        }
        // IMAGEN LLENA (JPG opaco): el borde es la caja de la imagen, y sobre
        // un rectangulo el motor vectorial es exacto.
        const base = new paper.CompoundPath({ insert: false });
        base.applyMatrix = false;
        base.matrix = new paper.Matrix();
        base.fillRule = "evenodd";
        const caja = loopCajaImagen(muestra.origen);
        if (!caja) { base.remove?.(); return null; }
        base.addChild(new paper.Path({ segments: caja, closed: true, insert: false }));
        const salida = buildOutlineGeometry(base, width, side, radius, smoothing, control.scope);
        base.remove?.();
        return salida;
    })();
    if (!band) {
        avisar(MOTIVOS[vinculo.motivo] || "No hay contorno que dibujar con estos valores.");
        return null; }

    // Con alfa leible la silueta existe; sin alfa (JPG opaco) el borde es la
    // caja. No se vuelve a calcular la silueta solo para etiquetar: sobre la
    // grilla de DR_bn.png eso cuesta un marching squares de 810 000 celdas.
    const origin = muestra.sampled ? "image-silhouette" : "image-bounding";

    // REGENERAR, NUNCA DUPLICAR: si estas piezas ya tenian contorno vivo se
    // retira antes de montar el nuevo, venga la llamada del panel, de la barra
    // o de un "Volver a aplicar". Sin esto el cliente acumulaba un contorno
    // encima de otro cada vez que volvia a apretar.
    const previos = new Set();
    lista.forEach(o => { const v = vinculoDeOrigen(o); if (v) previos.add(v); });
    previos.forEach(v => {
        try { v.contorno?.remove?.(); } catch (_) {}
        VINCULOS.forEach((valor, clave) => { if (valor === v) VINCULOS.delete(clave); });
    });

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
        label: esUnion ? "Contorno de la union" : "Contorno de imagen",
        source: "image-outline",
        origin,
        isSolidShape: true,
        isFusionReceptor: true,
        semanticKind: VECTOR_KIND.SOLID,
        outlineWidth: width,
        outlineRadius: radius,
        outlineSmoothing: smoothing,
        outlineSide: side,
        outlineScope: ["outer", "holes"].includes(String(options.scope || "")) ? String(options.scope) : "all",
        outlineApply: options.apply === "pieces" ? "pieces" : "together",
        ...(esUnion ? { outlinePieces: lista.length } : {})
    };
    try { window.ensureContainedDesignItem?.(outline); } catch (_) {}
    if (outline.parent === null) {
        (paper.project.activeLayer || paper.project.layers[0]).addChild(outline);
        if (window.currentMockup) outline.insertBelow(window.currentMockup);
    }
    window.syncGeometryToGeomBase?.(outline);

    // Se anota de que pieza (o de cuales piezas) salio este contorno. Es lo que
    // permite que, al mover un control, se rehaga ESTE contorno y no se cree
    // uno nuevo al lado. En la union el mismo vinculo queda registrado bajo
    // cada pieza: arrastrar cualquiera de ellas tiene que mover la banda unica.
    vinculo.contorno = outline;
    lista.forEach(o => {
        const clave = o?.id;
        if (clave !== undefined && clave !== null) VINCULOS.set(clave, vinculo);
    });

    return outline;
}

function createRasterBorderContour(raster, options = {}) {
    return crearContornoDeImagenes([ownerOf(raster) || raster], options);
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

/* ------------------------------------------------------------------
   UNION: un solo contorno alrededor de la silueta de TODA la seleccion.
   Es el default con varios objetos (o un grupo) vectoriales; el cliente
   despues lo edita con tijera o booleanas si quiere separarlo.
   ------------------------------------------------------------------ */
function unirGeometrias(owners) {
  const geos = (owners || []).map(o => { try { return toWorldGeometry(o); } catch (_) { return null; } })
    .filter(Boolean);
  if (!geos.length) return null;
  if (geos.length === 1) return geos[0];
  let acc = geos[0];
  for (let i = 1; i < geos.length; i += 1) {
    const candidato = geos[i];
    try {
      const unido = acc.unite(candidato, { insert: false });
      if (unido && Math.abs(Number(unido.area) || 0) > 1e-7) {
        acc?.remove?.();
        candidato.remove?.();
        unido.applyMatrix = true;
        acc = unido;
      } else {
        unido?.remove?.();
        candidato.remove?.();
      }
    } catch (_) {
      candidato.remove?.();
    }
  }
  return acc;
}

function crearContornoUnion(owners, control) {
  const union = unirGeometrias(owners);
  if (!union) return null;
  const width = Math.max(1, Math.abs(Number(control.width) || 0) || 1);
  const band = buildOutlineGeometry(union, width, control.side, Number(control.radius) || 0,
    Number(control.smoothing) || 0, control.scope);
  if (!band) { union.remove?.(); return null; }
  const pieza = new paper.CompoundPath({ insert: false });
  pieza.applyMatrix = false;
  pieza.matrix = new paper.Matrix();
  pieza.fillRule = "evenodd";
  const volcado = volcarGeometria(pieza, band, {
    width, side: control.side, radius: Number(control.radius) || 0,
    smoothing: Number(control.smoothing) || 0, scope: control.scope, apply: control.apply
  });
  if (!volcado) { union.remove?.(); return null; }
  volcado.fillColor = new paper.Color(CONTOUR_COLOR);
  volcado.strokeColor = null;
  volcado.strokeWidth = 0;
  // La forma original del contorno de union es la UNION misma: con ella el
  // panel vivo puede rehacer la banda y el toggle puede devolver la union.
  const snapshot = union.clone({ insert: false });
  try { snapshot.applyMatrix = true; } catch (_) {}
  union.remove?.();
  volcado.data = {
    locked: false,
    label: "Contorno de la union",
    source: "vector-outline",
    isOutline: true,
    unionOutline: true,
    isSolidShape: true,
    isFusionReceptor: true,
    semanticKind: VECTOR_KIND.SOLID,
    outlineWidth: width,
    outlineRadius: Number(control.radius) || 0,
    outlineSmoothing: Number(control.smoothing) || 0,
    outlineSide: control.side,
    outlineScope: control.scope || "all",
    outlineApply: control.apply === "pieces" ? "pieces" : "together"
  };
  try { window.ensureContainedDesignItem?.(volcado); } catch (_) {}
  if (volcado.parent === null) {
    (paper.project.activeLayer || paper.project.layers[0]).addChild(volcado);
    if (window.currentMockup) volcado.insertBelow(window.currentMockup);
  }
  try {
    const inversa = volcado.globalMatrix?.inverted?.();
    if (inversa) snapshot.transform(inversa);
    snapshot.applyMatrix = false;
    snapshot.matrix = new paper.Matrix();
  } catch (_) {}
  volcado.data = { ...(volcado.data || {}), geomBase: snapshot, outlineSourceGeomBase: snapshot };
  window.syncGeometryToGeomBase?.(volcado);
  return volcado;
}

/* ------------------------------------------------------------------
   LINEA DE CORTE: su silueta es una CAPSULA cerrada (la linea con su
   grosor a cada lado). La pieza original no se toca: es una linea de
   corte y sigue siendo una linea de corte. El contorno sale como pieza
   nueva, igual que con las imagenes.
   ------------------------------------------------------------------ */
function capsulaLoopDeLinea(linea, control) {
  try {
    const width = Math.max(1, Math.abs(Number(control.width) || 0) || 1);
    const medio = width / 2;
    const largo = Number(linea.length) || 0;
    if (!(largo > 0)) return null;
    const matriz = linea.globalMatrix || null;
    const pasos = Math.max(8, Math.min(600, Math.ceil(largo / 3)));
    const centro = [];
    for (let i = 0; i <= pasos; i += 1) {
      const p = linea.getPointAt((i / pasos) * largo);
      if (!p) continue;
      centro.push(matriz ? p.transform(matriz) : p);
    }
    if (centro.length < 2) return null;
    const ladoA = [], ladoB = [];
    for (let i = 0; i < centro.length; i += 1) {
      const prev = centro[Math.max(0, i - 1)];
      const next = centro[Math.min(centro.length - 1, i + 1)];
      const dir = next.subtract(prev);
      if (dir.length < 1e-9) continue;
      const n = new paper.Point(-dir.y, dir.x).normalize().multiply(medio);
      ladoA.push(centro[i].add(n));
      ladoB.push(centro[i].subtract(n));
    }
    if (ladoA.length < 2) return null;
    return ladoA.concat(ladoB.reverse());
  } catch (_) { return null; }
}

function crearContornoLinea(linea, control) {
  const owner = ownerOf(linea);
  if (!owner) return null;
  // REGENERAR, NUNCA DUPLICAR: si esta linea ya tiene capsula, la vieja se
  // reemplaza por la nueva.
  const clave = owner?.id;
  const vinculo = vinculoDeOrigen(owner);
  if (vinculo?.contorno?.parent) {
    try { vinculo.contorno.remove(); } catch (_) {}
    if (clave !== undefined && clave !== null) VINCULOS.delete(clave);
  }
  const loop = capsulaLoopDeLinea(owner, control);
  if (!loop || loop.length < 3) return null;
  const shape = new paper.Path({ segments: loop, closed: true, insert: false });
  const contorno = new paper.CompoundPath({ insert: false });
  contorno.applyMatrix = false;
  contorno.matrix = new paper.Matrix();
  contorno.fillRule = "evenodd";
  const volcado = volcarGeometria(contorno, shape, {
    width: Math.max(1, Math.abs(Number(control.width) || 0) || 1),
    side: control.side, radius: Number(control.radius) || 0,
    smoothing: Number(control.smoothing) || 0, scope: control.scope
  });
  if (!volcado) return null;
  volcado.fillColor = new paper.Color(CONTOUR_COLOR);
  volcado.strokeColor = null;
  volcado.strokeWidth = 0;
  volcado.data = {
    locked: false,
    label: "Contorno de linea de corte",
    source: "cutline-outline",
    isSolidShape: true,
    isFusionReceptor: true,
    semanticKind: VECTOR_KIND.SOLID,
    outlineWidth: Math.max(1, Math.abs(Number(control.width) || 0) || 1),
    outlineRadius: Number(control.radius) || 0,
    outlineSmoothing: Number(control.smoothing) || 0,
    outlineSide: control.side,
    outlineScope: control.scope || "all",
    outlineApply: control.apply === "pieces" ? "pieces" : "together"
  };
  try { window.ensureContainedDesignItem?.(volcado); } catch (_) {}
  if (volcado.parent === null) {
    (paper.project.activeLayer || paper.project.layers[0]).addChild(volcado);
    if (window.currentMockup) volcado.insertBelow(window.currentMockup);
  }
  window.syncGeometryToGeomBase?.(volcado);
  if (clave !== undefined && clave !== null) {
    VINCULOS.set(clave, { contorno: volcado, origen: owner });
  }
  return volcado;
}

/** Rehace EN SU LUGAR la capsula de una linea de corte (panel vivo). */
function reconstruirContornoLinea(contorno, origen, control) {
  if (!contorno?.parent || !origen) return null;
  const loop = capsulaLoopDeLinea(origen, control);
  if (!loop || loop.length < 3) return null;
  const shape = new paper.Path({ segments: loop, closed: true, insert: false });
  return volcarGeometria(contorno, shape, {
    width: Math.max(1, Math.abs(Number(control.width) || 0) || 1),
    side: control.side, radius: Number(control.radius) || 0,
    smoothing: Number(control.smoothing) || 0, scope: control.scope, apply: control.apply
  });
}

/* ------------------------------------------------------------------
   DE DONDE SALEN LOS VALORES DEL CONTORNO.

   Los controles del panel viven en el DOM, y el DOM muere cuando el panel se
   cierra o se repinta (commandParameters.js hace innerHTML = ""). Antes,
   quedar sin controles devolvia el default duro (grosor 1, Centro, Borde +
   huecos), y cualquier reconstruccion posterior DESINFLABA la banda que el
   cliente habia dejado en 8 px. MEDIDO en el editor real con DR_bn.png:
   grosor 8 -> cerrar el panel -> clic en Contorno -> la banda volvía a 1 px,
   y reabrir el panel mostraba 1 aunque en escena hubiera una banda de 8.

   La prioridad, de menos a mas importante:
     1) el default de la herramienta,
     2) el ultimo ajuste de esta sesion (lo que el cliente viene usando),
     3) la banda del objeto que se esta editando (lo que ya esta en escena),
     4) el panel abierto (lo que el cliente esta moviendo ahora mismo).
   ------------------------------------------------------------------ */
const CONTROL_POR_DEFECTO = Object.freeze({
    width: 1, radius: 0, smoothing: 0, side: "center", scope: "all", apply: "together"
});
let ultimoControl = null;

function controlDelPanel() {
    if (typeof document === "undefined") return {};
    const num = id => {
        const v = Number(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : null;
    };
    const txt = (id, valores) => {
        const v = document.getElementById(id)?.value;
        return valores.includes(v) ? v : null;
    };
    return {
        width: num("ctxOutlineWidth"),
        radius: num("ctxOutlineRadius"),
        smoothing: num("ctxOutlineSmoothing"),
        side: txt("ctxOutlineSide", ["center", "outside", "inside"]),
        scope: txt("ctxOutlineScope", ["all", "outer", "holes"]),
        apply: txt("ctxOutlineApply", ["together", "pieces"])
    };
}

/** Los valores con los que esta hecha la banda de la pieza seleccionada. Es la
 *  unica memoria que sobrevive al cerrar el panel: viaja en .data del contorno. */
function controlDeLaPieza() {
    const seleccion = (Array.isArray(window.selectedItems) && window.selectedItems.length)
        ? window.selectedItems
        : (window.selectedItem ? [window.selectedItem] : []);
    for (const item of seleccion) {
        const owner = ownerOf(item);
        if (!owner) continue;
        const banda = (owner.data?.source === "image-outline" || owner.data?.isOutline === true)
            ? owner
            : (vinculoDeOrigen(owner)?.contorno || null);
        if (!banda) continue;
        const valores = valoresDelContorno(banda);
        if (valores) return valores;
    }
    return {};
}

/** Lee los controles del panel de contorno. Sin panel en pantalla se usa la
 *  cadena de prioridad de arriba, nunca un default que desinfla la banda. */
function readOutlineControls() {
    const control = { ...CONTROL_POR_DEFECTO };
    [ultimoControl, controlDeLaPieza(), controlDelPanel()].forEach(capa => {
        if (!capa) return;
        Object.keys(CONTROL_POR_DEFECTO).forEach(clave => {
            const v = capa[clave];
            if (v !== null && v !== undefined) control[clave] = v;
        });
    });
    control.width = Math.max(1, Math.abs(Number(control.width) || 0) || 1);
    control.radius = Math.max(0, Number(control.radius) || 0);
    control.smoothing = Math.max(0, Number(control.smoothing) || 0);
    if (!["center", "outside", "inside"].includes(control.side)) control.side = "center";
    if (!["all", "outer", "holes"].includes(control.scope)) control.scope = "all";
    if (!["together", "pieces"].includes(control.apply)) control.apply = "together";
    ultimoControl = { ...control };
    return control;
}

/** Lo que el panel tiene que mostrar al abrirse: el estado real de la pieza,
 *  no el valor escrito en el registro de parametros. */
export function estadoContornoParaPanel() {
    return readOutlineControls();
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
  // El bus de transformaciones puede no haber cargado todavia cuando se
  // importo este modulo; aplicar es el momento garantizado de engancharse.
  asegurarSuscripcionTransform();
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
  // toggleOutline (la ruta vectorial) devuelve un ARRAY de resultados; si se
  // apila tal cual, el selectItem final recibe [[anillo]] y la seleccion se
  // pierde. Todo resultado se aplana antes de entrar a la lista.
  const pushPlano = item => {
    if (Array.isArray(item)) item.forEach(pushPlano);
    else if (item) results.push(item);
  };
  const controles = { ...readOutlineControls(), ...options };
  // Los GRUPOS se desarmen para el calculo: la silueta de un grupo es la
  // silueta de sus piezas (junta o por pieza, segun el control Aplicar a).
  const targets = [];
  const vistos = new Set();
  const agregar = o => { if (o && !vistos.has(o)) { vistos.add(o); targets.push(o); } };
  selection.forEach(o => {
    if (o?.className === "Group" && !o.data?.source && o.data?.isOutline !== true) {
      (o.children || []).forEach(hijo => { if (isDesignObject(hijo)) agregar(ownerOf(hijo)); });
    } else agregar(o);
  });
  // Una BANDA no es una pieza: es el resultado de calcular sobre otras. Al
  // terminar de aplicar, la seleccion pasa a ser la banda que se creo, asi que
  // el proximo movimiento de un control del panel llega CON la banda
  // seleccionada. Se vuelve atras, a sus piezas de origen, y se decide de nuevo
  // con "Aplicar a". Sin esto, cambiar "Todo junto" a "Por pieza" regeneraba la
  // misma banda de union (medido: seguia saliendo 1 banda "Contorno de la
  // union"), y dos bandas seleccionadas se unian por booleana de vectores en
  // lugar de por su alfa real.
  const deBandas = [];
  targets.forEach(o => {
    const piezas = piezasDelVinculo(vinculoDeContorno(o));
    if (piezas.length) piezas.forEach(p => deBandas.push(p));
    else deBandas.push(o);
  });
  targets.length = 0;
  vistos.clear();
  deBandas.forEach(agregar);
  if (!targets.length) return fail("contorno-empty");
  try {
    const especies = targets.map(o => ({ o, sp: speciesOf(o) }));
    const todosVectoriales = especies.every(e => e.sp === "vector" || e.sp === "text");
    const todasImagenes = especies.every(e => e.sp === "raster");
    // POR PIEZA: un contorno por cada objeto (tambien es el camino cuando
    // la seleccion mezcla imagenes con vectores: la union entre un raster
    // y un vector no existe sin rasterizar).
    const porPieza = async () => {
      for (const owner of targets) {
        // Si lo seleccionado YA ES un contorno de imagen, se REHACE: nunca se
        // re-contornea un contorno (eso lo destruia y dejaba un anillo basura
        // de fragmentos, medido en la auditoria).
        if (owner.data?.source === "image-outline") {
          const regenerado = regenerarContorno(owner, controles);
          if (regenerado) { pushPlano(regenerado); continue; }
        }
        const species = speciesOf(owner);
        if (species === "raster") {
          // REGENERAR, NUNCA DUPLICAR: si esta pieza ya tiene contorno vivo,
          // se rehace ESE contorno con los valores actuales del panel y no se
          // crea otro al lado.
          const vinculo = vinculoDeOrigen(owner);
          // UNicamente se rehace en su propio objeto si el vinculo es DE ESTA
          // PIEZA. Si el vinculo es una UNION (la banda compartida de "Todo
          // junto"), rehacerla aqui dejaria la banda de union en pantalla
          // aunque el cliente pido "Por pieza": se crea la banda propia, que
          // ademas retira la union vieja.
          if (vinculo?.contorno?.parent && !(vinculo.origenes && vinculo.origenes.length > 1)) {
            const regenerado = regenerarContorno(vinculo.contorno, controles);
            if (regenerado) { pushPlano(regenerado); continue; }
          }
          // El borde exterior de la imagen. La app decide de donde sale: la caja
          // si esta llena, su silueta real si viene recortada. El cliente solo
          // aprieta Contorno. Trazar es OTRA herramienta y no se llama desde aca.
          const rect = createRasterBorderContour(owner, controles);
          if (rect) pushPlano(rect);
        } else if (species === "line") {
          // Linea de corte: capsula cerrada como pieza nueva.
          const capsula = crearContornoLinea(owner, controles);
          if (capsula) pushPlano(capsula);
        } else if (species === "text") {
          if (typeof window.convertTextToVector !== "function") continue;
          // convertTextToVector es async: hay que esperar al vector nuevo antes
          // de engrosarlo, o se engrosa una Promise y no pasa nada.
          const converted = await window.convertTextToVector(owner);
          if (!converted) continue;
          const contoured = vectorContour(converted);
          pushPlano(contoured);
        } else {
          const contoured = vectorContour(owner);
          pushPlano(contoured);
        }
      }
    };
    // UNION: con varios objetos el default es UN solo contorno de toda la
    // silueta; "Por pieza" en el panel lo divide. Con vectores la union sale de
    // una booleana; con IMAGENES sale de una grilla de alfa compartida, que es
    // lo que faltaba: con dos fotos seleccionadas el boton Contorno ni siquiera
    // aparecia y el "Todo junto" del panel no hacia nada.
    if (targets.length > 1 && controles.apply !== "pieces" && (todosVectoriales || todasImagenes)) {
      if (todasImagenes) {
        const propio = vinculoDeOrigen(targets[0]);
        const esUnionDeEstas = !!(propio?.origenes && propio.origenes.length > 1
          && targets.every(t => propio.origenes.includes(t)));
        const banda = esUnionDeEstas && propio?.contorno?.parent
          ? regenerarContorno(propio.contorno, controles)
          : crearContornoDeImagenes(targets, controles);
        // Sin silueta comun (p. ej. dos JPG opacos: la union es todo rectangulo)
        // no hay banda que unir: se aplica por pieza, que si da.
        if (banda) pushPlano(banda);
        else await porPieza();
      } else {
        const efectivos = [];
        for (const e of especies) {
          if (e.sp === "text") {
            if (typeof window.convertTextToVector !== "function") continue;
            // convertTextToVector es async: hay que esperar al vector nuevo.
            const convertido = await window.convertTextToVector(e.o);
            if (convertido) efectivos.push(convertido);
          } else {
            efectivos.push(e.o);
          }
        }
        if (efectivos.length > 1) {
          const pieza = crearContornoUnion(efectivos, controles);
          if (pieza) pushPlano(pieza);
        } else if (efectivos.length === 1) {
          pushPlano(vectorContour(efectivos[0]));
        }
      }
    } else await porPieza();
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

/* ------------------------------------------------------------------
   LA BANDA SIGUE A LA PIEZA. Un contorno es geometria calculada una vez:
   si despues el cliente mueve, escala o gira la foto, la banda vieja se
   queda donde estaba (medido en el editor: foto escalada al 60% y banda
   conservando la caja de antes, o sea un borde grande y corrida alrededor
   de la pieza). La app ya tiene un bus de transformaciones
   (EKKO_FUSION_CONTROLLER.addTransformObserver) por donde pasan la cinta,
   las medidas y la fusion. Aca se traslada la banda durante el arrastre,
   que es barato y hace que siga a la pieza, y al soltar se RECALCULA desde
   la silueta actual: escalar la banda al 60% dejaria de medir los 12 px
   que pidio el cliente, y en grabado laser el grosor es una medida real.
   ------------------------------------------------------------------ */
let suscriptoTransform = false;
let colaRecalculo = null;
const pendientesRecalculo = new Set();

function duenosTransformados(payload) {
    const out = [];
    const agregar = o => { if (o && !out.includes(o)) out.push(o); };
    const entradas = payload?.transaction?.entries;
    if (Array.isArray(entradas)) entradas.forEach(e => agregar(e?.owner));
    if (out.length) return out;
    // Los caminos numericos (caja de tamano, giro por angulo) no traen
    // transaccion: la seleccion es lo que se esta transformando.
    const seleccion = (Array.isArray(window.selectedItems) && window.selectedItems.length)
        ? window.selectedItems
        : (window.selectedItem ? [window.selectedItem] : []);
    seleccion.forEach(item => agregar(ownerOf(item) || item));
    return out;
}

function valoresDelContorno(contorno) {
    // La banda se rehace con LO QUE SE PIDIO PARA ESA PIEZA, no con lo que el
    // panel muestra ahora: el panel puede estar cerrado, o mostrar otra pieza,
    // y entonces readOutlineControls() daria el default (grosor 1, centro) y
    // el contorno se desinflaria al mover la foto (medido: banda de 12 px
    // Exterior que quedaba en 1 px Centro despues de un arrastre).
    const d = contorno?.data || {};
    return {
        width: Number.isFinite(+d.outlineWidth) && +d.outlineWidth > 0 ? +d.outlineWidth : null,
        radius: Number.isFinite(+d.outlineRadius) ? +d.outlineRadius : 0,
        smoothing: Number.isFinite(+d.outlineSmoothing) ? +d.outlineSmoothing : 0,
        side: ["inside", "outside", "center"].includes(String(d.outlineSide)) ? String(d.outlineSide) : "center",
        scope: ["all", "outer", "holes"].includes(String(d.outlineScope)) ? String(d.outlineScope) : "all",
        apply: d.outlineApply === "pieces" ? "pieces" : "together"
    };
}

function recalcularPendientes() {
    colaRecalculo = null;
    const lista = Array.from(pendientesRecalculo);
    pendientesRecalculo.clear();
    let pinto = false;
    lista.forEach(contorno => {
        if (!contorno?.parent) return;
        const guardado = valoresDelContorno(contorno);
        // Si el contorno no tiene su grosor anotado (piezas de una sesion
        // anterior), no se adivina: se deja como esta antes que achicarlo.
        if (guardado.width === null) return;
        const control = guardado;
        const vinculo = vinculoDeContorno(contorno);
        const origen = vinculo?.origen;
        try {
            // Imagen (sola o en union) va al motor de máscara; linea de corte a
            // la capsula; lo demas es el anillo vectorial. La prueba antes era
            // `origen.className === "Raster"`, que fallaba cuando la app
            // envuelve la foto en su grupo contenedor.
            if (vinculo?.origenes || rasterDe(origen)) regenerarContorno(contorno, control);
            else if (origen) reconstruirContornoLinea(contorno, origen, control);
            else refreshOwnerOutline(contorno, control);
            // La huella se anota con la pieza YA reconstruida: es la referencia
            // de la proxima lectura del vigia.
            if (vinculo) vinculo.senia = seniaDelVinculo(vinculo);
            pinto = true;
        } catch (_) { /* una banda que no se pudo rehacer no corta la edicion */ }
    });
    // Se guarda historia despues del recalcular: si no, el Rehacer devuelve la
    // pieza a su lugar pero la banda queda con la geometria nueva.
    if (pinto) { window.saveHistory?.(); paper.view?.update?.(); }
}

function alTransformar(payload) {
    try {
        let toco = false;
        duenosTransformados(payload).forEach(owner => {
            const contorno = vinculoDeOrigen(owner)?.contorno;
            if (!contorno || !contorno.parent) return;
            pendientesRecalculo.add(contorno);
            toco = true;
            // En vivo solo traslacion. Escalar y girar cambian la silueta, y
            // ahi lo unico honesto es recalcular (cae en el debounce).
            const d = payload?.delta;
            if (d && Number.isFinite(d.x) && Number.isFinite(d.y) && (d.x || d.y)) {
                contorno.translate(new paper.Point(d.x, d.y));
            }
        });
        if (!toco) return;
        if (colaRecalculo) clearTimeout(colaRecalculo);
        colaRecalculo = setTimeout(recalcularPendientes, 180);
    } catch (_) { /* el observador nunca rompe la transformacion */ }
}

function asegurarSuscripcionTransform() {
    asegurarVigia();
    if (suscriptoTransform || typeof window === "undefined") return;
    const controlador = window.EKKO_FUSION_CONTROLLER;
    if (!controlador?.addTransformObserver) return;
    controlador.addTransformObserver(alTransformar);
    suscriptoTransform = true;
}

/* ------------------------------------------------------------------
   VIGIA DE GEOMETRIA. El bus tiene 6 caminos publicados (arrastre, manija
   de escala, giro, tamano numerico, angulo numerico, tamano de fuente),
   pero el resto de la app mueve piezas directo con la API de Paper:
   alinear, centrar, espejar, el auto-ajuste al cargar en el mockup y la
   portada de una fusion. Medido: por ahi la banda quedaba vieja igual que
   antes de este arreglo, que es exactamente la mancha gigante descolgada de
   la foto. El vigia no depende de que cada llamador avise: compara la caja
   actual de la pieza con la que tenia cuando se calculo su banda.
   Exige dos lecturas iguales antes de rehacer, asi un arrastre en curso
   (que cambia la caja en cada frame) no dispara la banda cara: primero se
   estabiliza, despues se recalcula.
   ------------------------------------------------------------------ */
const VIGIA_CADA_MS = 350;
let vigiaActivo = false;

/** Huella barata de donde esta la pieza y como esta orientada. El signo del
 *  determinante cambia con un espejo, que deja la misma caja pero silueta
 *  distinta: sin eso, un espejado no se notaria. */
function seniaDeOrigen(origen) {
    const b = origen?.bounds;
    if (!b) return null;
    // La matriz global lleva posicion, escala, giro y espejo; la caja agrega el
    // caso en que cambiao el tamano propio de la imagen con la misma matriz.
    const v = origen.getGlobalMatrix?.().values || [];
    const f = n => Number(n).toFixed(2);
    return [b.x, b.y, b.width, b.height].map(f).join(",") + "|" +
        (v.length === 6 ? v.map(f).join(",") : "-");
}

/** Las piezas vivas de un vinculo: las varias de una union, o la propia. */
function piezasDelVinculo(vinculo) {
    if (vinculo?.origenes?.length) return vinculo.origenes.filter(o => o && o.parent);
    return vinculo?.origen?.parent ? [vinculo.origen] : [];
}

/** Huella del vinculo entero: una union se mueve si se movio CUALQUIERA de sus
 *  piezas, no solo la primera. */
function seniaDelVinculo(vinculo) {
    const piezas = piezasDelVinculo(vinculo);
    if (!piezas.length) return null;
    return piezas.map(pieza => seniaDeOrigen(pieza)).join(";");
}

function vigilarBandas() {
    if (!vigiaActivo) return;
    try {
        VINCULOS.forEach((vinculo, clave) => {
            const piezas = piezasDelVinculo(vinculo);
            if (!piezas.length) {
                // Sin piezas ya no hay de donde rehacer: se suelta el registro,
                // salvo que la banda estuviera retirada a proposito (un alcance
                // sin geometria): esa tiene que poder volver si el cliente
                // cambia el control.
                if (!vinculo?.vacio) VINCULOS.delete(clave);
                return;
            }
            // Una banda retirada (vinculo.vacio) no tiene objeto en escena: no
            // hay nada que vigilar hasta que el panel la pida de nuevo.
            if (vinculo.vacio || !vinculo.contorno?.parent) {
                if (!vinculo.vacio) VINCULOS.delete(clave);
                return;
            }
            // Si murio una pieza de la union, el registro se ajusta al conjunto
            // vivo: la banda pasa a ser de las que quedan.
            if (vinculo.origenes && vinculo.origenes.length !== piezas.length) {
                vinculo.origenes = piezas.slice();
            }
            const senia = seniaDelVinculo(vinculo);
            if (!senia) return;
            if (!vinculo.senia) { vinculo.senia = senia; return; }
            if (senia === vinculo.senia) { vinculo.seniaAnterior = null; return; }
            if (vinculo.seniaAnterior !== senia) { vinculo.seniaAnterior = senia; return; }
            vinculo.seniaAnterior = null;
            pendientesRecalculo.add(vinculo.contorno);
        });
        if (pendientesRecalculo.size) recalcularPendientes();
    } catch (_) { /* el vigia tampoco rompe la edicion */ }
    setTimeout(vigilarBandas, VIGIA_CADA_MS);
}

function asegurarVigia() {
    if (vigiaActivo || typeof window === "undefined") return;
    vigiaActivo = true;
    setTimeout(vigilarBandas, VIGIA_CADA_MS);
}

if (typeof window !== "undefined") {
  window.aplicarContorno = aplicarContorno;
  window.createBoundingContour = createBoundingContour;
  window.createRasterBorderContour = createRasterBorderContour;
  window.isSingleClosedContour = isSingleClosedContour;

  // Puente con commandParameters.js: el panel de Contorno llama a esto cada
  // vez que el cliente mueve un control. Vive en EKKO porque es la unica
  // autoridad de este dominio; el panel no sabe nada de geometria.
  window.EKKO = window.EKKO || {};
  window.EKKO.contornoVivo = refrescarContornoVivo;
  // El panel se pinta CON lo que hay en escena, no con lo que dice el registro:
  // asi el cliente ve el grosor real de la banda que esta editando.
  window.EKKO.contornoEstado = estadoContornoParaPanel;
  // Limpieza del preview para rutas ajenas al panel (por ejemplo, cerrar el
  // panel con un arrastre a medio hacer): sin trazo magenta residual.
  window.EKKO.quitarPreviewContorno = quitarPreview;
  // Vista previa tipo booleanas: el fantasma magenta del boton Contorno.
  // La instala el puente de comandos en el hover y la retira al salir.
  window.EKKO.previsualizarContorno = previsualizarContornoSeleccion;
  // Mejor esfuerzo: si el controlador de transformaciones ya cargo, se engancha
  // ahora y la primera banda que se mueva no depende de que antes se haya
  // aplicado un contorno.
  asegurarSuscripcionTransform();
}
