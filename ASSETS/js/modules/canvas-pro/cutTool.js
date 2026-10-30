/* EKKO Studio — TIJERA (corte de segmentos) — ronda 10
 *
 * QUÉ HACE
 * Un clic sobre un trazo con la tijera activa borra EL PEDAZO QUE SE TOCÓ. Los
 * extremos del pedazo son los vértices del propio trazo Y los puntos donde lo
 * cruzan otros trazos: así "cortar el segmento que el cliente quiere" no
 * depende de que alguien haya puesto un nodo justo ahí (que es lo que pasa en
 * AutoCAD cuando una línea parte a otra y no hay nodo en la intersección).
 *
 *   - clic            -> afuera el pedazo tocado
 *   - Shift + clic    -> partir EN ESE PUNTO sin borrar nada (AutoCAD BREAK):
 *                        un cerrado se abre ahí, un abierto se divide en dos
 *   - Esc / el botón  -> salís de la tijera
 *
 * QUÉ NO HACE
 * No es una booleana. Las booleanas (Unión / Diferencia / Intersección) operan
 * entre DOS objetos y devuelven un objeto nuevo; la tijera opera sobre UN trazo
 * y lo que hace es sacarle un pedazo o partirlo. Comparten la intuición visual
 * —"se corta donde se cruza"— pero no se pisan.
 *
 * Por eso tampoco toca los datos de nadie: el objeto que queda conserva su
 * etiqueta, su contención contra el mockup y su geomBase recalculada con el
 * mismo helper que usa el editor de nodos (nodeEditor.js:180), que es el único
 * lugar del estudio que ya sabe re-registrar geometría sin romper el sólido/
 * hueco ni el historial.
 */

import interactionOwner, { VALID_MODES } from "./interactionOwner.js";
import { getPublicOwner } from "./designGeometry.js";
import { syncGeometryToGeomBase } from "./nodeEditor.js";

/* "cut" tampoco estaba en la lista; se declara acá, sin tocar interactionOwner. */
if (!VALID_MODES.has("cut")) VALID_MODES.add("cut");

const COLOR_GUIA = "#e0245e";
const TOLERANCIA_PX = 9;   // qué tan cerca hay que estar del trazo para agarrarlo
const DIANA_PX = 9;        // radio del punto de corte marcado en la guía
const LARGO_MINIMO = 2;    // un pedazo más chico que esto no es un objeto

let activa = false;
let tool = null;
let toolPrevio = null;
let guia = null;
let resaltado = null;      // { camino, owner, segs, desde, hasta } lo que se va a borrar
let chip = null;

/* ---------------------------------------------------------------- */
/* ESTILO                                                           */
/* ---------------------------------------------------------------- */
function estilos() {
    if (document.getElementById("ekkoCorteEstilos")) return;
    const s = document.createElement("style");
    s.id = "ekkoCorteEstilos";
    s.textContent = `
        body.ekko-cortando canvas { cursor: crosshair !important; }
        /* El aviso se apoya en el mismo sitio que el de dibujo; son modos
           excluyentes, así que nunca se ven los dos a la vez. */
        #ekkoCorteChip {
            position: fixed;
            z-index: 20000050;
            display: none;
            max-width: 340px;
            padding: 5px 10px;
            border-radius: 999px;
            background: rgba(16,24,42,0.86);
            color: #fff;
            font-size: 11.5px;
            line-height: 1.2;
            pointer-events: none;
        }
    `;
    document.head.appendChild(s);
}

function aviso(texto) {
    if (!chip) {
        chip = document.createElement("div");
        chip.id = "ekkoCorteChip";
        document.body.appendChild(chip);
    }
    chip.textContent = texto;
    const barra = document.getElementById("topBar");
    const caja = barra ? barra.getBoundingClientRect() : { bottom: 0, left: 0 };
    chip.style.top = `${Math.round(caja.bottom) + 8}px`;
    chip.style.left = `${Math.round(caja.left || 0) + 12}px`;
    chip.style.display = "block";
}

function ocultarAviso() {
    if (chip) chip.style.display = "none";
}

function pxAProyecto(px) {
    return px / (paper.view.zoom || 1);
}

/* ---------------------------------------------------------------- */
/* QUÉ TRAZOS SE PUEDEN CORTAR                                      */
/* ---------------------------------------------------------------- */
/* Se excluye lo que no es diseño: el mockup, sus máscaras, las guías, las
   manijas de selección y los previews de dibujo. El envoltorio de contención
   (mockupLoader.js:470) SÍ se recorre, porque adentro está el objeto real junto
   con su copia enmascarada; la copia se cae sola por data.isMask. */
function esRuido(nodo) {
    const data = (nodo && nodo.data) || {};
    return !!(data.mockup || data.isMask || data.wasClipMask || nodo.clipMask
        || data.isSelectionBox || data.isHandle || data.isCurveHandle
        || data.isMeasurement || data.isSmartGuide || data.isNodeEditOverlay
        || data.isTracePreview || data.isDibujoPreview);
}

function caminosDeDiseno() {
    const salida = [];
    const proj = paper.project;
    if (!proj) return salida;
    const capa = (proj.layers || []).find(l => l && l.name === "designLayer") || proj.activeLayer;
    const visitar = (nodo, dueno, profundidad) => {
        if (!nodo || esRuido(nodo) || profundidad > 6) return;
        if (nodo === window.currentMockup || nodo === window.clipMask) return;
        if (nodo.className === "Path") {
            salida.push({ camino: nodo, owner: getPublicOwner(nodo) || dueno || nodo });
            return;
        }
        if (nodo.className === "CompoundPath") {
            (nodo.children || []).forEach(h => {
                if (h.className === "Path" && !esRuido(h)) {
                    salida.push({ camino: h, owner: getPublicOwner(h) || nodo });
                }
            });
            return;
        }
        const duenoAqui = dueno || nodo;
        (nodo.children || []).forEach(h => visitar(h, duenoAqui, profundidad + 1));
    };
    (capa.children || []).forEach(root => visitar(root, null, 0));
    return salida;
}

function vecinoBajoCursor(punto) {
    const tol = pxAProyecto(TOLERANCIA_PX);
    let mejor = null;
    for (const cand of caminosDeDiseno()) {
        const camino = cand.camino;
        /* Un relleno sin trazo también es un contorno cortable. */
        if (!camino.visible || (!camino.strokeColor && !camino.fillColor)) continue;
        let loc = null;
        try { loc = camino.getNearestLocation(punto); } catch (_) { loc = null; }
        if (!loc || !loc.curve) continue;
        const distancia = loc.point.subtract(punto).length;
        if (distancia > tol) continue;
        if (!mejor || distancia < mejor.distancia) {
            mejor = { ...cand, loc, distancia };
        }
    }
    return mejor;
}

/* ---------------------------------------------------------------- */
/* DÓNDE SE PUEDE CORTAR UN TRAZO                                   */
/* ---------------------------------------------------------------- */
function cortesDelCamino(camino) {
    const total = camino.length;
    const cortes = [];
    if (!camino.closed) cortes.push(0, total);
    /* Los vértices: el corte "de manual", el que siempre existió. */
    camino.segments.forEach(s => cortes.push(s.location.offset));
    /* Los cruces con los demás trazos del lienzo. Sin esto, cortar una línea
       que pasa por encima de otra exige agregar el nodo a mano primero. */
    const demas = caminosDeDiseno();
    for (const cand of demas) {
        const otro = cand.camino;
        if (otro === camino) continue;
        let sus = [];
        try { sus = camino.getIntersections(otro) || []; } catch (_) { sus = []; }
        for (const i of sus) {
            /* getIntersections devuelve las dos mitades del mismo cruce: la que
               está sobre `camino` es la que sirve acá. */
            if (i.path === camino && typeof i.offset === "number") cortes.push(i.offset);
        }
    }
    return normalizarCortes(cortes, total, camino.closed);
}

function normalizarCortes(cortes, total, cerrado) {
    const eps = Math.max(total * 1e-4, pxAProyecto(0.5));
    const limpios = cortes
        .filter(o => typeof o === "number" && isFinite(o))
        .map(o => {
            let v = o;
            if (!cerrado) return Math.min(Math.max(v, 0), total);
            v = v % total;
            return v < 0 ? v + total : v;
        })
        .sort((a, b) => a - b);
    const unicos = [];
    for (const v of limpios) {
        const ultimo = unicos.length ? unicos[unicos.length - 1] : null;
        if (ultimo === null || Math.abs(v - ultimo) > eps) unicos.push(v);
        else if (!cerrado && v === total) unicos[unicos.length - 1] = total;
    }
    if (!cerrado && (unicos.length === 0 || unicos[0] > 0)) unicos.unshift(0);
    return unicos;
}

/* El pedazo que contiene al punto tocado. En un cerrado los cortes son un
   anillo, así que el intervalo puede envolver el final del camino. */
function pedazoTocado(camino, tocado) {
    const total = camino.length;
    const cortes = cortesDelCamino(camino);
    if (cortes.length < 2) return null;
    let desde = null, hasta = null;
    for (const c of cortes) if (c <= tocado + 1e-9) desde = c;
    for (const c of cortes) if (c > tocado + 1e-9) { hasta = c; break; }
    if (camino.closed) {
        if (desde === null) desde = cortes[cortes.length - 1];
        if (hasta === null) hasta = cortes[0];
    } else {
        if (desde === null) desde = 0;
        if (hasta === null) hasta = total;
    }
    if (Math.abs(hasta - desde) < 1e-9) return null;
    return { desde, hasta, total, largo: longitudDelArco(camino, desde, hasta) };
}

function longitudDelArco(camino, desde, hasta) {
    if (camino.closed && hasta < desde) return hasta + camino.length - desde;
    return Math.abs(hasta - desde);
}

/* ---------------------------------------------------------------- */
/* CIRUGÍA                                                          */
/* ---------------------------------------------------------------- */
/* Copia el arco [desde,hasta] como segmentos nuevos.
 * MEDIDO sobre paper-full 0.12.17 (el que carga index.html): `Path#extract` y
 * `Path#getRange` NO existen en esa build, así que el arco se arma con
 * `split()` sobre un clon fuera de la capa. `split()` en un cerrado lo ABRE y lo
 * ROTA (devuelve el mismo objeto, con todo el perímetro arrancando en el offset
 * pedido); en un abierto deja [0..offset] y devuelve el resto como objeto nuevo,
 * que hay que tirar. POR ESO se rotan primero en `desde` y se corta el largo
 * pedido: los sobrantes se recogen y se eliminan para no dejar basura en la capa
 * (basura que saveHistory y la auditoría del corte siguiente verían). */
function segmentosDelArco(camino, desde, hasta) {
    const total = camino.length;
    if (!(total > 0)) return null;
    const largo = longitudDelArco(camino, desde, hasta);
    if (!(largo > 0) || largo > total + 1e-6) return null;
    const tmp = camino.clone({ insert: false });
    const descartar = [];
    let parte = tmp;
    if (camino.closed) {
        /* Offset 0 exacto deja un segmento de largo ~0 (medido); sobre un anillo
           el final coincide con el principio, así que se rota en `total`. */
        const rotar = desde % total < 1e-6 ? total : desde % total;
        const r = parte.split(rotar);
        if (r && r !== parte) descartar.push(r);
    } else if (desde > 1e-6) {
        const r = parte.split(desde);
        if (!r) { parte.remove(); return null; }
        descartar.push(parte);
        parte = r;
    }
    if (largo < parte.length - 1e-6) {
        const cola = parte.split(largo);
        if (cola) descartar.push(cola);
    }
    const segs = parte.segments.map(s => new paper.Segment(
        s.point.clone(), s.handleIn.clone(), s.handleOut.clone()));
    /* MEDIDO: removeSegments()+addSegments() conserva las manijas tal cual
       (largo del círculo 314.203 antes y después), así que el arco conservado
       de una curva no se poligoniza. */
    const medido = parte.length;
    parte.remove();
    descartar.forEach(o => o.remove());
    if (segs.length < 2) return null;
    return { segs, largo: medido };
}

function aplicarSegmentos(camino, segs, cerrado) {
    camino.removeSegments();
    camino.addSegments(segs);
    camino.closed = !!cerrado;
    if (!cerrado) marcarComoCorte(camino);
}

/* MEDIDO (estado rectEdge): el objeto que queda abierto en la tijera tiene que
   declararse línea de corte, igual que el pedazo nuevo y que la Línea de la
   cinta (drawTools.js:525). Si no, geometryAudit lo marca como "vector abierto"
   error y Sólidos ⇄ Huecos lo sigue tratando como contorno cerrado. */
function marcarComoCorte(camino) {
    if (!camino.data) camino.data = {};
    camino.data.isCutLine = true;
    camino.data.isHole = false;
}

function copiarDatos(original, nuevo, cerrado) {
    nuevo.data = Object.assign({}, original.data || {});
    /* geomBase es una foto de la geometría: la del objeto viejo no sirve para
       el nuevo, y arrastrarla deja un sólido fantasma en el corte. */
    delete nuevo.data.geomBase;
    delete nuevo.data.geomBasePathData;
    delete nuevo.data.geomBaseSync;
    nuevo.data.locked = false;
    if (!nuevo.data.label) nuevo.data.label = (original.data && original.data.label) || "Vector";
    if (!cerrado) {
        /* geometryAudit.js:30 marca "open-vector" a todo Path abierto salvo que
           declare que es corte. Al abrir un contorno con la tijera el pedazo que
           queda DEJA de ser un sólido: pasa a ser línea de corte. */
        nuevo.data.isCutLine = true;
    }
}

function estiloDe(original, nuevo) {
    nuevo.strokeColor = original.strokeColor ? original.strokeColor.clone() : new paper.Color(0);
    nuevo.strokeWidth = original.strokeWidth;
    nuevo.fillColor = original.fillColor ? original.fillColor.clone() : null;
}

/* Alta de un objeto nuevo que sale de un corte, por la misma secuencia que el
   resto del estudio: capa de diseño -> geomBase -> contención -> selección. */
/* Lleva un punto del espacio LOCAL del trazo al espacio de la capa de diseño,
   aplicando la matriz de cada ancestro por el camino. Se hace así a propósito:
   `Item#localToView`, `Item#localToProject`, `Item#viewBounds` y
   `Matrix#multiply` NO existen en el paper-full 0.12.17 que carga index.html
   (medido en probe-paper4/5), y el pedazo nuevo se alta en la capa de diseño,
   no al lado del original, para que ensureContainedDesignItem le arme su
   contención contra el mockup. */
function aCapa(item, punto) {
    let v = new paper.Point(punto.x, punto.y);
    for (let n = item; n; n = n.parent) v = v.transform(n.matrix);
    return v;
}

/* Los puntos van con la transformación completa; las manijas son VECTORES, así
   que se transforman como diferencia (M(p+h) - M(p)), que es exacto para afin. */
function segmentosACapa(original, segs) {
    return segs.map(s => {
        const pto = aCapa(original, s.point);
        const adentro = (s.handleIn.x || s.handleIn.y)
            ? pto.subtract(aCapa(original, s.point.subtract(s.handleIn))) : s.handleIn.clone();
        const afuera = (s.handleOut.x || s.handleOut.y)
            ? aCapa(original, s.point.add(s.handleOut)).subtract(pto) : s.handleOut.clone();
        return new paper.Segment(pto, adentro, afuera);
    });
}

function objetoNuevo(segs, cerrado, original) {
    const camino = new paper.Path({ segments: segmentosACapa(original, segs), insert: false });
    camino.closed = !!cerrado;
    estiloDe(original, camino);
    copiarDatos(original, camino, cerrado);
    const padre = original.parent;
    if (padre && padre.className === "CompoundPath") {
        /* El corte de un sub-contorno sigue siendo parte del mismo compuesto
           (una O con el agujero partido sigue siendo UN objeto). */
        padre.addChild(camino);
        return camino;
    }
    const proj = paper.project;
    const capa = (proj.layers || []).find(l => l && l.name === "designLayer") || proj.activeLayer;
    capa.addChild(camino);
    const publico = window.ensureContainedDesignItem
        ? window.ensureContainedDesignItem(camino) : camino;
    return publico || camino;
}

function sincronizarYRefrescar(owners) {
    const vistos = new Set();
    for (const owner of owners) {
        if (!owner || vistos.has(owner)) continue;
        vistos.add(owner);
        syncGeometryToGeomBase(owner);
    }
    if (typeof window.recalculateDynamicSubtractions === "function") {
        try { window.recalculateDynamicSubtractions(); } catch (_) {}
    }
    window.refreshAllToolbars?.();
    paper.view.update();
}

/* Borra el pedazo [desde,hasta] del camino tocado. */
function cortarPedazo(camino, owner, desde, hasta) {
    const total = camino.length;
    if (camino.closed) {
        /* En un cerrado, sacarle un arco deja EL RESTO abierto: es exactamente
           la tijera de LightBurn sobre un rectángulo o una silueta. */
        const resto = segmentosDelArco(camino, hasta, desde);
        if (!resto || resto.largo < LARGO_MINIMO) {
            /* No queda nada aprovechable: el objeto entero era el pedazo tocado. */
            eliminarAlCompleto(camino, owner);
            return { tipo: "eliminado" };
        }
        aplicarSegmentos(camino, resto.segs, false);
        sincronizarYRefrescar([owner]);
        return { tipo: "abierto", largo: resto.largo };
    }
    const antes = desde > 1e-9 ? segmentosDelArco(camino, 0, desde) : null;
    const despues = hasta < total - 1e-9 ? segmentosDelArco(camino, hasta, total) : null;
    if (!antes && !despues) {
        eliminarAlCompleto(camino, owner);
        return { tipo: "eliminado" };
    }
    const seQueda = antes || despues;
    const nuevo = antes ? despues : null;
    aplicarSegmentos(camino, seQueda.segs, false);
    const creados = [];
    if (nuevo && nuevo.largo >= LARGO_MINIMO) {
        creados.push(objetoNuevo(nuevo.segs, false, camino));
    }
    /* El pedazo NUEVO también necesita su geomBase: MEDIDO, si solo se
       sincroniza el original el objeto recien nacido quedaba sin registrar y
       la auditoría lo marcaba como fantasma. */
    sincronizarYRefrescar([owner].concat(creados));
    if (creados.length) window.selectItem?.(creados[0]);
    return { tipo: "partido", largo: seQueda.largo, nuevos: creados.length };
}

/* Shift: partir en el punto tocado sin borrar nada (AutoCAD BREAK). */
function partirEn(camino, owner, tocado) {
    const total = camino.length;
    if (camino.closed) {
        /* Abrir el anillo justo donde se tocó: la geometría completa se queda,
           cambia solo por dónde empieza y dónde termina. */
        const cola = segmentosDelArco(camino, tocado, total);
        const cabeza = segmentosDelArco(camino, 0, tocado);
        if (!cola && !cabeza) return { tipo: "nada" };
        const segs = cola && cabeza
            ? cola.segs.concat(cabeza.segs.slice(1))
            : (cola || cabeza).segs;
        aplicarSegmentos(camino, segs, false);
        sincronizarYRefrescar([owner]);
        return { tipo: "abierto", largo: camino.length };
    }
    const izquierda = tocado > 1e-9 ? segmentosDelArco(camino, 0, tocado) : null;
    const derecha = tocado < total - 1e-9 ? segmentosDelArco(camino, tocado, total) : null;
    if (!izquierda || !derecha) return { tipo: "nada" };
    aplicarSegmentos(camino, izquierda.segs, false);
    const nuevo = objetoNuevo(derecha.segs, false, camino);
    sincronizarYRefrescar([owner, nuevo]);
    window.selectItem?.(nuevo);
    return { tipo: "partido", nuevos: 1 };
}

function eliminarAlCompleto(camino, owner) {
    /* Si el camino era el único contorno del objeto, el objeto desaparece; si
       era un sub-contorno de un compuesto, solo se saca ese contorno. */
    const padre = camino.parent;
    camino.remove();
    if (padre && padre.className === "CompoundPath") {
        if (!padre.children || padre.children.length === 0) {
            const publico = getPublicOwner(padre) || padre;
            publico.remove();
            window.selectItem?.(null);
        }
    } else if (owner && !owner.parent) {
        window.selectItem?.(null);
    }
    sincronizarYRefrescar([owner]);
}

/* ---------------------------------------------------------------- */
/* INTERACCIÓN                                                      */
/* ---------------------------------------------------------------- */
function guiaActiva() {
    if (guia) return guia;
    guia = new paper.Group({ insert: false });
    guia.data = { isSelectionBox: true, isDibujoPreview: true };
    paper.project.activeLayer.addChild(guia);
    guia.bringToFront();
    return guia;
}

function limpiarGuia() {
    if (guia) { guia.remove(); guia = null; }
    resaltado = null;
}

function estiloGuia(camino) {
    camino.strokeColor = new paper.Color(COLOR_GUIA);
    camino.strokeWidth = 1.2 / paper.view.zoom;
    camino.dashArray = [4 / paper.view.zoom, 3 / paper.view.zoom];
    return camino;
}

function marcarPedazo(punto) {
    limpiarGuia();
    const vecino = vecinoBajoCursor(punto);
    if (!vecino) return;
    /* La guía no promete un corte que el clic no va a poder hacer. */
    if (esSolidoMaterializado(vecino.camino, vecino.owner)) return;
    const pedazo = pedazoTocado(vecino.camino, vecino.loc.offset);
    if (!pedazo) return;
    const arco = segmentosDelArco(vecino.camino, pedazo.desde, pedazo.hasta);
    if (!arco) return;
    resaltado = { camino: vecino.camino, owner: vecino.owner, ...pedazo };
    const grupo = guiaActiva();
    grupo.addChild(estiloGuia(new paper.Path(arco.segs)));
    /* Los dos extremos del corte, para que se vea hasta dónde llega el pedazo. */
    [arco.segs[0], arco.segs[arco.segs.length - 1]].forEach(s => {
        const marca = new paper.Path.Circle({ center: s.point, radius: pxAProyecto(DIANA_PX), insert: false });
        marca.closed = true;
        marca.strokeColor = new paper.Color(COLOR_GUIA);
        marca.strokeWidth = 1 / paper.view.zoom;
        grupo.addChild(marca);
    });
    paper.view.update();
}

/* syncGeometryToGeomBase (nodeEditor.js:192) se NEGABA a escribir el geomBase
   de un sólido cuyo geometry visible ya era un resultado CSG materializado.
   Cortar ahí dejaría el geomBase viejo: el próximo recálculo de las restas
   dinámicas devolvería la forma entera y el corte se perdería sin aviso.
   La tijera no compite con las booleanas: avisa y pide Descomponer primero. */
function esSolidoMaterializado(camino, owner) {
    return [camino && camino.data, owner && owner.data]
        .some(d => d && d.csgMaterialized === true && d.nodeEditActive !== true);
}

function cortar(punto, conShift) {
    const vecino = vecinoBajoCursor(punto);
    if (!vecino) { aviso("La tijera no agarró ningún trazo: pasá el puntero encima de una línea o un contorno."); return; }
    const { camino, owner } = vecino;
    if (esSolidoMaterializado(camino, owner)) {
        aviso("Esto es un sólido con relleno booleano activo: primero Descomponer Vector y después tijera.");
        return;
    }
    const pedazo = pedazoTocado(camino, vecino.loc.offset);
    if (!pedazo) return;
    /* El snapshot ANTES de tocar nada: saveHistory guarda el JSON del lienzo y
       si el objeto ya está partido, el Ctrl+Z devuelve el partido. */
    window.saveHistory?.();
    const resultado = conShift
        ? partirEn(camino, owner, vecino.loc.offset)
        : cortarPedazo(camino, owner, pedazo.desde, pedazo.hasta);
    limpiarGuia();
    const texto = {
        abierto: "Contorno abierto: el trazo quedó como línea de corte",
        partido: "Trazo partido en dos objetos",
        eliminado: "El objeto era solo ese pedazo y se fue",
        nada: "No hay nada para partir ahí"
    }[resultado.tipo] || "Listo";
    aviso(`${texto} · Ctrl+Z lo devuelve · clic en otro pedazo para seguir cortando`);
    paper.view.update();
}

function activar(forzar) {
    if (!window.paper || !paper.project) return;
    const quiero = forzar === undefined ? !activa : !!forzar;
    if (quiero === activa) { if (!activa) desactivar(); return; }
    if (!quiero) { desactivar(); return; }

    /* La tijera y el dibujo se pisan el tool: si venía dibujando, se apaga. */
    window.EKKO_DRAW_TOOLS?.desactivar?.();

    toolPrevio = paper.tool || null;
    if (!interactionOwner.claim("cut", { owner: "cutTool" })) return;
    activa = true;

    tool = new paper.Tool();
    tool.onMouseDown = (evento) => cortar(evento.point, conShift(evento));
    tool.onMouseMove = (evento) => marcarPedazo(evento.point);
    tool.activate();

    document.body.classList.add("ekko-cortando");
    if (paper.view.element) paper.view.element.style.cursor = "crosshair";
    aviso("Tijera: clic en el pedazo que querés afuera. Shift + clic parte sin borrar. Esc o el mismo botón salen.");
    pintar();
}

function desactivar() {
    limpiarGuia();
    ocultarAviso();
    const estabaActiva = activa;
    activa = false;
    if (!estabaActiva) { pintar(); return; }

    interactionOwner.release("cut", "tijera-fuera");
    tool = null;
    if (toolPrevio && typeof toolPrevio.activate === "function") {
        toolPrevio.activate();
    } else if (typeof window.initSelectionTool === "function") {
        window.initSelectionTool();
    }
    toolPrevio = null;
    document.body.classList.remove("ekko-cortando");
    if (paper && paper.view && paper.view.element) paper.view.element.style.cursor = "default";
    pintar();
}

function conShift(evento) {
    return !!(evento && ((evento.modifiers && evento.modifiers.shift)
        || (evento.event && evento.event.shiftKey)));
}

function porTecla(evento) {
    if (!activa) return;
    if (evento.key === "Escape") {
        evento.stopPropagation();
        desactivar();
    }
}

function pintar() {
    document.querySelectorAll("[data-ekko-tijera]").forEach(b => {
        b.classList.toggle("active", activa);
    });
}

/* ---------------------------------------------------------------- */
/* BOTÓN                                                            */
/* ---------------------------------------------------------------- */
function icono(nombre) {
    return `<svg class="ekko-ic" aria-hidden="true"><use href="ASSETS/ui/ekko-icons.svg#${nombre}"></use></svg>`;
}

function contenedorCrear() {
    return document.querySelector('.ekko-ribbon-group[data-group="creacion"] .ekko-ribbon-body')
        || document.querySelector('#topBar .top-group');
}

/* El ícono ya estaba dibujado en el sprite (ekko-corte, "tijera partiendo una
   línea con el hueco del corte marcado") y figuraba en la lista de
   "sin botón todavía" de ASSETS/ui/preview.html:105. */
function crearBoton() {
    const caja = contenedorCrear();
    if (!caja || document.getElementById("btnEkkoTijera")) return !!document.getElementById("btnEkkoTijera");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-action";
    b.id = "btnEkkoTijera";
    b.dataset.ekkoTijera = "1";
    b.title = "Tijera: clic en el pedazo de trazo que querés afuera. "
        + "Shift + clic parte el trazo en dos sin borrar nada.";
    b.innerHTML = `${icono("ekko-corte")} Tijera`;
    b.addEventListener("click", () => activar());
    caja.appendChild(b);
    return true;
}

function montar() {
    if (crearBoton()) return;
    let intentos = 60;
    const ticker = () => {
        if (crearBoton() || --intentos <= 0) return;
        requestAnimationFrame(ticker);
    };
    requestAnimationFrame(ticker);
}

export function initCutTool() {
    if (typeof document === "undefined") return;
    estilos();
    document.addEventListener("keydown", porTecla, true);
    window.EKKO_TIJERA = {
        activar: (forzar) => activar(forzar),
        desactivar,
        toggle: () => activar(),
        activa: () => activa,
        /* Expuesto para medir en el arnés y para el botón de la banda
           contextual, que no crea el modo: solo lo enciende. */
        pedazoEn: (punto) => {
            const vecino = vecinoBajoCursor(punto);
            if (!vecino) return null;
            const pedazo = pedazoTocado(vecino.camino, vecino.loc.offset);
            return pedazo ? { ...pedazo, cerrado: vecino.camino.closed } : null;
        },
        vecinos: () => caminosDeDiseno().map(c => c.camino)
    };
    montar();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initCutTool(), { once: true });
} else {
    initCutTool();
}
