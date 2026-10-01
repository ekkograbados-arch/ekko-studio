/* =========================================================================
   CODIGO QR COMO VECTOR
   -------------------------------------------------------------------------
   Antes el QR se insertaba como una IMAGEN: la libreria lo dibujaba en un
   canvas y se traia como raster. Para el cliente que solo disena, un QR es
   una forma mas del diseno, igual que el logo. Y un raster en un laser se
   ve borroso en el corte y no se puede usar como contorno, ni convertir en
   solido, ni participation en operaciones de forma.

   Este modulo arma el QR con la misma convencion que usa el resto de la app
   para un vector (ver fontToPath.js): un CompoundPath con fillRule evenodd,
   cada contorno con su registro de semantica y su tipo vector. Asi el QR
   entra al motor de formas como cualquier otro dibujo del cliente.

   LA PARTE IMPORTANTE: los modulos no se emiten uno por uno. Un QR de 33x33
   tiene del orden de 600 modulos oscuros, y cada uno como un cuadrado
   suelto significa 600 contornos: el laser tendria que cortar 600 lineas,
   muchas de ellas en el interior de la misma mancha, y los cuadrados se
   cairian del material. Se agrupan en rectangulos maximos: la misma mancha
   negra, con unos 200 contornos, sin lineas de corte por la mitad.

   La libreria es qrcode-generator, que entrega la matriz de modulos de
   verdad (isDark) en vez de un dibujo. Si no se pudiera cargar, se devuelve
   null y quien llama sigue con el QR de imagen, que por lo menos existe.
   ========================================================================= */
import { buildContourRelations, applyContourRecord } from "./holeSemantics.js";
import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";

const ORIGEN_QR = "qr-vector";
const URL_LIBRERIA = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
/**
 * MARGEN: 2 modulos, no los 4 que suele verse en los ejemplos.
 *
 * El margen es aire limpio alrededor del codigo y existe para que el lector
 * distinga el borde de la mancha. Los 4 son la recomendacion comoda para
 * pantalla; para un grabado laser cada modulo de mas es superficie que no se
 * graba y tiempo de maquina. Con 2 el codigo sigue leyendose con el celular
 * en la mano, y el area total baja de 37 a 33 celdas: cada modulo del QR
 * crece un 12%, y en superficie chica eso es justo lo que hace legible un
 * codigo que antes no lo era.
 */
const MARGEN_MODULOS = 2;

let cargando = null;

/** Carga qrcode-generator una sola vez, aunque se apriete el boton dos veces. */
function cargarLibreria() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (cargando) return cargando;
    cargando = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = URL_LIBRERIA;
        script.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error("qrcode sin global")));
        script.onerror = () => reject(new Error("no se pudo cargar qrcode-generator"));
        document.head.appendChild(script);
    });
    cargando.catch(() => { cargando = null; });
    return cargando;
}

/**
 * NIVEL DE CORRECCION: L, no H.
 *
 * Es la decision que mas pesa para grabar en superficie chica. La correccion
 * alta (H) reparte cerca de 30% de los modulos en repeticion para tolerar que
 * se raye o se tape el codigo, y eso significa mas modulos, versiones mas
 * grandes y mas lineas de corte. En una pulsera grabada a laser el codigo sale
 * limpio o no sale: la correccion extra no salva un corte mal hecho, solo
 * agranda el trabajo. L aguanta un 7% de dano, que es lo que un grabado
 * prolijo tiene de verdad, y a cambio el codigo es la version mas chica.
 */
const NIVEL_CORRECCION = "L";

/**
 * Matriz de modulos del QR, ya elegida la version mas chica que entra.
 * typeNumber 0 deja que la libreria elija sola, que es lo que se quiere:
 * mientras mas chico el codigo, menos modulos y menos corte.
 */
function matrizModulos(lib, texto) {
    for (let tipo = 0; tipo <= 40; tipo++) {
        try {
            const qr = lib(tipo, NIVEL_CORRECCION);
            qr.addData(texto);
            qr.make();
            const total = qr.getModuleCount();
            if (!total) continue;
            const filas = [];
            for (let f = 0; f < total; f++) {
                const fila = [];
                for (let c = 0; c < total; c++) fila.push(qr.isDark(f, c));
                filas.push(fila);
            }
            return { filas, total };
        } catch (e) {
            // Version demasiado chica para este texto: se prueba la siguiente.
        }
    }
    return null;
}

/**
 * Agrupa los modulos oscuros en rectangulos maximos.
 *
 * Se recorre de arriba hacia abajo, de izquierda a derecha. Al encontrar un
 * modulo oscuro todavia sin usar se estira hacia la derecha lo que pueda y
 * despues hacia abajo, mientras la fila entera siga oscura. Se marca todo el
 * rectángulo como usado. El resultado cubre la misma mancha sin superponerse:
 * los rectangulos quedan pegados pero no cruzados.
 */
function rectangulosMaximos(filas) {
    const alto = filas.length;
    const ancho = filas[0] ? filas[0].length : 0;
    const usado = filas.map(fila => fila.map(() => false));
    const rects = [];
    for (let f = 0; f < alto; f++) {
        for (let c = 0; c < ancho; c++) {
            if (!filas[f][c] || usado[f][c]) continue;
            // Se estira a la derecha mientras el renglon siga oscuro.
            let largo = 0;
            while (c + largo < ancho && filas[f][c + largo] && !usado[f][c + largo]) largo++;
            // Y despues baja mientras ese ancho completo siga oscuro.
            let fondo = 1;
            while (f + fondo < alto) {
                let calza = true;
                for (let k = 0; k < largo; k++) {
                    if (!filas[f + fondo][c + k] || usado[f + fondo][c + k]) { calza = false; break; }
                }
                if (!calza) break;
                fondo++;
            }
            for (let df = 0; df < fondo; df++) {
                for (let dc = 0; dc < largo; dc++) usado[f + df][c + dc] = true;
            }
            rects.push({ fila: f, columna: c, largo, alto: fondo });
        }
    }
    return rects;
}

/**
 * Arma el QR como CompoundPath, con la misma convencion de semantica que el
 * resto de los vectores de la app.
 *
 * @param {string} texto  lo que se quiere codificar (enlace, texto, wifi...)
 * @param {object} opciones  { tamano } lado final en unidades de lienzo
 */
export async function construirQrVector(texto, opciones = {}) {
    if (!window.paper || !String(texto || "").trim()) return null;
    const lib = await cargarLibreria();
    const datos = matrizModulos(lib, String(texto).trim());
    if (!datos) return null;

    const rects = rectangulosMaximos(datos.filas);
    if (!rects.length) return null;

    const lado = Number(opciones.tamano) || 0;
    const total = datos.total;
    // El margen cuenta para el tamano final: el codigo sale con el aire que
    // necesita alrededor, que es lo que hace que un telefono lo lea.
    const paso = lado / (total + MARGEN_MODULOS * 2);
    if (!paso || !isFinite(paso) || paso <= 0) return null;

    /* El ancho de UN modulo en milimetros es lo que decide si el celular lo
       lee. El umbral viene de una prueba real, no de un manual: en EKKO
       Studio se grabaron codigos de 4 mm de lado (0.121 mm por modulo) y se
       leen bien, con zoom de camara. El grabado laser da contraste alto y
       sin reflejo, asi que aguanta mas chico que lo que se lee en pantalla.

       Por eso el piso es 0.10 mm y no los 0.25 mm que rigen para un codigo
       impreso o mostrado en pantalla: esos valores venian de ahi y no
       correspondian a lo que hace la maquina. El aviso queda para el rango
       realmente ajustado (0.10 a 0.14), que es donde un grabado puede
       salir sucio y conviene avisar antes de gastarla. */
    const anchoModuloMm = opciones.anchoModulo && lado ? (paso * opciones.anchoModulo) / lado : null;
    const legible = anchoModuloMm === null || anchoModuloMm >= 0.10;
    const ajustado = anchoModuloMm !== null && anchoModuloMm < 0.14;

    const contornos = [];
    rects.forEach(rect => {
        const x = (rect.columna + MARGEN_MODULOS) * paso;
        const y = (rect.fila + MARGEN_MODULOS) * paso;
        const w = rect.largo * paso;
        const h = rect.alto * paso;
        if (w <= 0 || h <= 0) return;
        const path = new paper.Path({ insert: false });
        path.add(new paper.Point(x, y));
        path.add(new paper.Point(x + w, y));
        path.add(new paper.Point(x + w, y + h));
        path.add(new paper.Point(x, y + h));
        path.closed = true;
        contornos.push(path);
    });
    if (!contornos.length) return null;

    const compound = new paper.CompoundPath({ insert: false, children: contornos });
    compound.fillRule = "evenodd";
    compound.fillColor = new paper.Color("black");
    compound.applyMatrix = false;
    compound.matrix = new paper.Matrix();

    // Topologia por el contrato compartido de contornos, como en textToCompoundPath.
    const { nodes } = buildContourRelations(contornos, { fillRule: "evenodd" });
    const contornoMeta = nodes.map(node => {
        const record = {
            ...node.contourRecord,
            contourIndex: node.index,
            contourDepth: node.depth,
            isHole: node.isHole,
            originalIsHole: node.isHole,
            fillRule: "evenodd"
        };
        applyContourRecord(node.path, record);
        // Los rectangulos del QR no se tocan en su interior, asi que todos
        // son solido: ninguno es un hueco de otro.
        setSemanticKind(node.path, VECTOR_KIND.SOLID);
        node.path.data = {
            ...(node.path.data || {}),
            contourIndex: node.index,
            contourDepth: node.depth,
            contourRole: "outer",
            originalIsHole: false,
            fillRule: "evenodd",
            source: ORIGEN_QR
        };
        return record;
    });
    compound.data = {
        ...(compound.data || {}),
        source: ORIGEN_QR,
        fillRule: "evenodd",
        originalFillRule: "evenodd",
        label: "Codigo QR",
        textoQr: String(texto).trim(),
        modulos: total,
        version: (total - 17) / 4,
        margenModulos: MARGEN_MODULOS,
        /* Ancho de un modulo ya en milimetros de la superficie real. Es el
           numero que decide si el celular lo lee: de nada sirve un QR
           impecable que en la pulsera queda de 0.2 mm por lado. */
        anchoModuloMm,
        qrLegible: legible,
        /* Por debajo de 0.14 mm el margen es fino: el grabado puede salir
           justo. Con 0.10 mm o mas se lee, como los codigos de 4 mm probados
           en EKKO Studio. */
        qrAjustado: ajustado,
        rectangulos: rects.length,
        contours: contornoMeta,
        hasInternalHoles: false
    };
    return compound;
}

if (typeof window !== "undefined") {
    window.EKKO_QR_VECTOR = { construirQrVector };
}
