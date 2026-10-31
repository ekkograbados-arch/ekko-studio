import { getPublicOwner, isMockupOrMask, isContainmentWrapper, toWorldGeometry } from "./designGeometry.js";
import { isCutLine, semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { buildOutlineGeometry, refreshOwnerOutline, previsualizarBanda, previsualizarBandaDeLoops } from "./outlineGeometry.js";

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
        outlineScope: opciones.scope || "all"
    };
    try { window.syncGeometryToGeomBase?.(contorno); } catch (_) {}
    try { paper.view?.update?.(); } catch (_) {}
    return contorno;
}

/** Rehace la banda de un contorno que ya esta en el lienzo, con los valores de ahora. */
function regenerarContorno(contorno, opciones = null) {
    if (!contorno) return null;
    // El origen se busca en el registro comparando contra la pieza real.
    let vinculoPropio = null;
    let origen = null;
    for (const vinculo of VINCULOS.values()) {
        if (vinculo.contorno === contorno || vinculo.contorno === ownerOf(contorno)) {
            vinculoPropio = vinculo;
            origen = vinculo.origen;
            break;
        }
    }
    if (!origen) {
        console.warn("[EKKO CONTORNO] no se encontro de que pieza salio este contorno");
        return null;
    }

    const control = opciones || readOutlineControls();
    const sampled = sampleRasterAlpha(origen);
    // La silueta sale de la matriz de la imagen, no de su caja del mundo: con
    // la pieza girada o espejada la caja estira y no espeja (MEDIDO en
    // siluetaDeImagen).
    const bounds = origen?.bounds?.clone?.();
    if (!bounds) return null;
    // La silueta SIN filtrar alimenta el cache del preview (fase C): el
    // alcance se aplica aparte, con el valor de ahora, igual que hace
    // createRasterBorderContour al crear el contorno.
    const todasSilueta = siluetaDeImagen(origen, sampled);
    const loops = filtrarLoopsPorAlcance(todasSilueta, control.scope);
    if (vinculoPropio) {
        vinculoPropio.silueta = todasSilueta.length ? todasSilueta : loopCajaImagen(origen) || loopCaja(bounds);
    }

    const base = new paper.CompoundPath({ insert: false });
    base.applyMatrix = false;
    base.matrix = new paper.Matrix();
    base.fillRule = "evenodd";
    if (loops.length) {
        loops.forEach(loop => base.addChild(new paper.Path({ segments: loop, closed: true, insert: false })));
    } else {
        const caja = loopCajaImagen(origen) || loopCaja(bounds);
        base.addChild(new paper.Path({ segments: caja, closed: true, insert: false }));
    }

    const width = Math.max(1, Math.abs(Number(control.width) || 0) || 1);
    const band = buildOutlineGeometry(base, width, control.side, Number(control.radius) || 0,
        Number(control.smoothing) || 0, control.scope);
    base.remove?.();
    if (!band) return null;
    return volcarGeometria(contorno, band, {
        width, side: control.side, radius: Number(control.radius) || 0, smoothing: Number(control.smoothing) || 0,
        scope: control.scope
    });
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
    for (const vinculo of VINCULOS.values()) {
        if (vinculo.contorno === contorno || vinculo.contorno === ownerOf(contorno)) return vinculo;
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

/** Preview del contorno de imagen: trazo sobre los loops del cache del
 *  vinculo (silueta SIN filtrar; el alcance lo aplica el preview con el
 *  valor de ahora). Sin cache devuelve null y el tick cae al camino final,
 *  que reconstruye de verdad y llena el cache para los ticks siguientes. */
function previsualizarImagen(vinculo) {
    const loops = vinculo?.silueta;
    if (!Array.isArray(loops) || !loops.length) return null;
    const control = readOutlineControls();
    let grupo = null;
    try {
        grupo = previsualizarBandaDeLoops(loops, control.width, control.side,
            Number(control.radius) || 0, control.scope);
    } catch (_) { grupo = null; }
    return grupo ? instalarPreview(grupo) : null;
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
            if (vinculo.origen === item || vinculo.origen === owner) {
                // Imagen: se rehace la silueta alfa. Linea de corte: se rehace
                // la capsula. Son motores distintos y el registro sabe cual.
                if (vinculo.origen?.className === "Raster") {
                    if (!preview) { quitarPreview(); return regenerarContorno(vinculo.contorno); }
                    const rapido = previsualizarImagen(vinculo);
                    if (rapido) return rapido;
                    quitarPreview();
                    return regenerarContorno(vinculo.contorno);
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
    const at = (x, y) => alpha[y * w + x];
    const cut = (x1, y1, v1, x2, y2, v2) => {
        const denom = v2 - v1;
        const t = Math.abs(denom) < 1e-6 ? 0.5 : (ALPHA_ISO - v1) / denom;
        return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    };
    // Escala del grid de muestreo a coordenadas de la pieza. Solo se usan en
    // el modo normal; enGrid no las necesita (y bounds puede venir null:
    // Trazar pasa mascaras sueltas sin rectangulo de pieza).
    const sx = bounds ? bounds.width / w : 1;
    const sy = bounds ? bounds.height / h : 1;

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
                case 1: segments.push([left(), top()]); break;
                case 2: segments.push([top(), right()]); break;
                case 3: segments.push([left(), right()]); break;
                case 4: segments.push([right(), bottom()]); break;
                case 6: segments.push([top(), bottom()]); break;
                case 7: segments.push([left(), bottom()]); break;
                case 8: segments.push([bottom(), left()]); break;
                case 9: segments.push([bottom(), top()]); break;
                case 11: segments.push([bottom(), right()]); break;
                case 12: segments.push([right(), left()]); break;
                case 13: segments.push([right(), top()]); break;
                case 14: segments.push([top(), left()]); break;
                case 5: {
                    // SADDLE: tl y br opacos. La conexion la decide el valor
                    // del CENTRO de la celda. Con el centro opaco tl y br
                    // quedan conectados en diagonal y el contorno rodea los
                    // vacios (tr y bl) por separado; con el centro vacio,
                    // rodea los opacos por separado.
                    const centro = (tl + tr + br + bl) / 4;
                    if (centro > ALPHA_ISO) segments.push([right(), top()], [left(), bottom()]);
                    else segments.push([left(), top()], [right(), bottom()]);
                    break;
                }
                case 10: {
                    // SADDLE espejado: tr y bl opacos.
                    const centro = (tl + tr + br + bl) / 4;
                    if (centro > ALPHA_ISO) segments.push([top(), left()], [bottom(), right()]);
                    else segments.push([top(), right()], [bottom(), left()]);
                    break;
                }
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
    // enGrid: devuelve los puntos en coordenadas de GRID (nodo = centro del
    // pixel) sin escalar a la pieza. Lo usa Trazar por regiones, que mapea
    // con su propia conversion (centro de pixel + localToGlobal) para
    // soportar rasters escalados o rotados.
    const enGrid = opciones?.enGrid === true;
    return loops.map(loop => enGrid
        ? loop.map(p => ({ x: p[0], y: p[1] }))
        : loop.map(p => new paper.Point(bounds.x + p[0] * sx, bounds.y + p[1] * sy)))
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
    // La grilla de alfa es de la IMAGEN y se devuelve al lienzo con SU matriz
    // (mapeoDeImagen): con la caja del dueno estiraba la silueta cuando el dueno
    // es un grupo mas grande que la foto (+34% de ancho, 10 px de corrimiento)
    // y con la caja AABB del mundo estiraba cualquier pieza girada.
    const owner = ownerOf(raster);
    if (!raster?.bounds) return null;

    // REGENERAR, NUNCA DUPLICAR: si esta pieza ya tenia un contorno vivo se
    // retira antes de armar el nuevo, venga la llamada del panel, de la barra
    // o de un "Volver a aplicar". Sin esto el cliente acumulaba un contorno
    // encima de otro cada vez que volvia a apretar.
    const previo = vinculoDeOrigen(owner);
    if (previo?.contorno?.parent) {
        try { previo.contorno.remove(); } catch (_) {}
    }

    // CONTORNO = EL BORDE. Es una sola cosa, y de donde sale NO lo decide el
    // cliente: la app mira la imagen y ya esta.
    //   - imagen llena hasta su caja  -> el borde es la caja
    //   - imagen recortada            -> el borde es su silueta real
    // En los dos casos el contorno se arma con el MISMO motor, asi que los
    // cuatro controles se comportan igual sin importar cual de los dos sea.
    const sampled = sampleRasterAlpha(raster);
    // La silueta SIN filtrar se guarda en el vinculo: el preview del panel
    // (fase C) la lee y aplica el alcance del momento sin recalcular nada.
    const todasSilueta = siluetaDeImagen(raster, sampled);
    const loops = filtrarLoopsPorAlcance(todasSilueta, options.scope);
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
        const caja = loopCajaImagen(raster);
        if (!caja) return null;
        compound.addChild(new paper.Path({ segments: caja, closed: true, insert: false }));
    }

    const width = Math.abs(Number(options.width) || 0) || 1;
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
        outlineSide: side,
        outlineScope: ["outer", "holes"].includes(String(options.scope || "")) ? String(options.scope) : "all"
    };
    try { window.ensureContainedDesignItem?.(outline); } catch (_) {}
    if (outline.parent === null) {
        (paper.project.activeLayer || paper.project.layers[0]).addChild(outline);
        if (window.currentMockup) outline.insertBelow(window.currentMockup);
    }
    window.syncGeometryToGeomBase?.(outline);

    // Se anota de que pieza salio este contorno. Es lo que permite que, al
    // mover un control, se rehaga ESTE contorno y no se cree uno nuevo al lado.
    try {
        const clave = owner?.id ?? raster?.id;
        if (clave !== undefined && clave !== null) {
            // Cache del preview: los loops SIN filtrar (o la caja, si la
            // imagen no tiene alfa que leer). La banda real se recalcula
            // siempre en el camino final; esto solo alimenta el trazo
            // magenta del arrastre.
            VINCULOS.set(clave, {
                contorno: outline,
                origen: owner || raster,
                silueta: todasSilueta.length ? todasSilueta : loopCajaImagen(raster)
            });
        }
    } catch (_) {}

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
    smoothing: Number(control.smoothing) || 0, scope: control.scope
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
    outlineScope: control.scope || "all"
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
    outlineScope: control.scope || "all"
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
    smoothing: Number(control.smoothing) || 0, scope: control.scope
  });
}

/** Lee los controles del panel de contorno. Si el panel no esta visible
 *  (por ejemplo el cliente aprieta Contorno desde la barra superior sin
 *  haber abierto el panel contextual) se usan los valores por defecto. */
function readOutlineControls() {
  const read = (id, fallback) => {
    const el = typeof document !== "undefined" ? document.getElementById(id) : null;
    const value = Number(el?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  const sideEl = typeof document !== "undefined" ? document.getElementById("ctxOutlineSide") : null;
  const scopeEl = typeof document !== "undefined" ? document.getElementById("ctxOutlineScope") : null;
  const applyEl = typeof document !== "undefined" ? document.getElementById("ctxOutlineApply") : null;
  return {
    // Grosor minimo 1: al apretar Contorno tiene que salir una LINEA delgada,
    // pegada al borde, como en AutoCAD o LightBurn. Si el panel esta cerrado no
    // hay ningun control que leer, asi que gana este valor por defecto.
    width: read("ctxOutlineWidth", 1),
    radius: read("ctxOutlineRadius", 0),
    smoothing: read("ctxOutlineSmoothing", 0),
    side: sideEl?.value || "center",
    // ALCANCE: que parte de la silueta se contornea. El default es borde +
    // huecos, que es lo que el cliente espera de un contorno completo.
    scope: ["all", "outer", "holes"].includes(scopeEl?.value) ? scopeEl.value : "all",
    // Con varios objetos: todo junto (union) o por pieza.
    apply: applyEl?.value === "pieces" ? "pieces" : "together"
  };
}

/** ALCANCE para la silueta de imagen: mismo contrato que buildOutlineGeometry.
 *  El contorno de mayor area es el borde externo; el resto son huecos e
 *  islas internas leidas del canal alfa. */
function areaDeLoop(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

function filtrarLoopsPorAlcance(loops, scope) {
  const alcance = ["outer", "holes"].includes(String(scope || "")) ? String(scope) : "all";
  if (!Array.isArray(loops) || loops.length <= 1 || alcance === "all") return loops;
  let mayor = 0;
  loops.forEach((pts, i) => { if (areaDeLoop(pts) > areaDeLoop(loops[mayor])) mayor = i; });
  return alcance === "outer" ? [loops[mayor]] : loops.filter((_, i) => i !== mayor);
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
  if (!targets.length) return fail("contorno-empty");
  try {
    const especies = targets.map(o => ({ o, sp: speciesOf(o) }));
    const todosVectoriales = especies.every(e => e.sp === "vector" || e.sp === "text");
    // UNION: con varios objetos vectoriales (o un grupo) el default es UN
    // solo contorno de toda la silueta; "Por pieza" en el panel lo divide.
    if (targets.length > 1 && controles.apply !== "pieces" && todosVectoriales) {
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
    } else {
      // POR PIEZA: un contorno por cada objeto (tambien es el camino cuando
      // la seleccion mezcla imagenes con vectores: la union entre un raster
      // y un vector no existe sin rasterizar).
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
          if (vinculo?.contorno?.parent) {
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
        const origen = vinculoDeContorno(contorno)?.origen;
        try {
            if (origen?.className === "Raster") regenerarContorno(contorno, control);
            else if (origen) reconstruirContornoLinea(contorno, origen, control);
            else refreshOwnerOutline(contorno, control);
            // La huella se anota con la pieza YA reconstruida: es la referencia
            // de la proxima lectura del vigia.
            const vinculo = vinculoDeContorno(contorno);
            if (vinculo?.origen) vinculo.senia = seniaDeOrigen(vinculo.origen);
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

function vigilarBandas() {
    if (!vigiaActivo) return;
    try {
        VINCULOS.forEach((vinculo, clave) => {
            if (!vinculo?.contorno?.parent || !vinculo.origen?.parent) { VINCULOS.delete(clave); return; }
            const senia = seniaDeOrigen(vinculo.origen);
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
  // Limpieza del preview para rutas ajenas al panel (por ejemplo, cerrar el
  // panel con un arrastre a medio hacer): sin trazo magenta residual.
  window.EKKO.quitarPreviewContorno = quitarPreview;
  // Mejor esfuerzo: si el controlador de transformaciones ya cargo, se engancha
  // ahora y la primera banda que se mueva no depende de que antes se haya
  // aplicado un contorno.
  asegurarSuscripcionTransform();
}
