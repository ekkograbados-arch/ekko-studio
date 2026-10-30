/* EKKO Studio — LÍNEAS y FORMAS (rondas 8 y 9)
 *
 * QUE APORTA
 * Tres herramientas nuevas en el grupo CREAR de la cinta: Línea, Formas
 * (Rectángulo / Círculo / Triángulo) y Lápiz. Son exactamente las tres que
 * estaban dibujadas como íconos (ekko-lineas, ekko-formas, ekko-lapiz en
 * ASSETS/ui/ekko-icons.svg) y "sin botón todavia" (ASSETS/ui/preview.html:105).
 *
 * RONDA 9 — LÍNEA COMO POLILÍNEA
 * Línea dejó de ser un arrastre de dos puntos: ahora es polilínea como en
 * AutoCAD (un clic por vértice, banda elástica al puntero) y cierra la silueta
 * cuando el clic cae sobre el punto de arranque. Lápiz hace lo mismo: si se
 * suelta sobre su propio arranque el camino queda closed, no corte abierto.
 *
 * QUE NO HACE
 * No inventa un motor de objetos paralelo. Un trazo terminado entra al proyecto
 * por la misma secuencia que usan "Agregar Texto" (editor.js:2433) y el QR
 * (editor.js:2209-2235): snapshot de historial, capa de diseño, geomBase,
 * contención contra el mockup y selectItem. Por eso lo dibujado se selecciona,
 * se mueve, se fusiona, se audita y se exporta como un SVG cargado.
 *
 * DUEÑO ÚNICO DE INTERACCIÓN
 * Mientras una herramienta está activa el modo "draw" queda reclamado en
 * EKKO_INTERACTION y las handlers de selección se autocensuran (selection.js
 * pregunta canHandle("select") en 1065/1255/1396). Al terminar vuelve el tool
 * anterior, como hace nodeEditor.js:758.
 */

import interactionOwner, { VALID_MODES } from "./interactionOwner.js";
import { getOwnerLocalGeometry, getPublicOwner } from "./designGeometry.js";
import { realGeometryIntersects } from "./vectorSemantics.js";

/* "draw" no estaba en la lista. VALID_MODES es un Set exportado, así que la
   herramienta declara su propio modo acá en vez de tocar interactionOwner.js
   por una línea. */
if (!VALID_MODES.has("draw")) VALID_MODES.add("draw");

const GROSOR_TRAZO = 1.2;    // unidades de proyecto: el mismo pelo de la chapa
const UMBRAL_MINIMO = 2;     // un arrastre más chico fue un toque de más
const TOLERANCIA_LAPIZ = 1.2;
const COLOR_GUIA = "#e0245e"; // el rosa de las guías: avisa "esto todavía no es un objeto"

/* Las dos tolerancias de la polilínea se miden en PÍXELES DE PANTALLA y se
   pasan a unidades de proyecto con pxAProyecto(), porque un clic de 4px tiene
   que ser "el mismo punto" tanto con zoom 1 como con zoom 8. Si quedaran en
   unidades de proyecto, con zoom arriba el puntero "se volvería loco": el
   punto de cierre casi imposible de agarrar y un simple temblor de la mano
   agregando vértices fantasma. */
const DIANA_PX = 9;    // radio del punto de inicio que deja cerrar la silueta
const MISMO_PUNTO_PX = 3;  // dos clics más juntos que esto son un toque de más

const FORMAS = {
    linea:     { label: "Línea",      cerrada: false },
    rect:      { label: "Rectángulo", cerrada: true },
    circulo:   { label: "Círculo",    cerrada: true },
    triangulo: { label: "Triángulo",  cerrada: true },
    lapiz:     { label: "Lápiz",      cerrada: false }
};

let activa = null;
let tool = null;
let toolPrevio = null;
let ancla = null;
let preview = null;
let puntosLapiz = [];
/* Vértices ya confirmados de la polilínea (Línea, al modo AutoCAD). El ultimo
   no está en la lista hasta que el usuario lo suelta o hace el siguiente clic;
   la banda elástica lo dibuja aparte. */
let puntosPolilinea = [];
/* El punto REAL del último clic aceptado. Con Shift el vértice guardado puede
   haber saltado a otra esquina, y el doble clic de remate cae sobre el cursor:
   sin esta referencia ese segundo clic se leía como un vértice nuevo y la
   polilínea terminaba con un tramo espurio de unos pocos píxeles. */
let ultimaApuntada = null;
let porDobleClic = null;
let chip = null;
let chipUnion = null;
let chipUnionTimer = null;
let unionPendiente = null;

/* ---------------------------------------------------------------- */
/* ESTILO                                                           */
/* ---------------------------------------------------------------- */
function estilos() {
    if (document.getElementById("ekkoDibujosEstilos")) return;
    const s = document.createElement("style");
    s.id = "ekkoDibujosEstilos";
    s.textContent = `
        /* El puntero de dibujo sobre el lienzo: sin esto la herramienta activa
           se ve encendida pero no se siente, y el cliente cree que no anduvo. */
        body.ekko-dibujando canvas { cursor: crosshair !important; }

        /* El menú de Formas vive en el body, no adentro del botón: la cinta se
           arma moviendo BOTONES sueltos de bloque (ribbonLayout.js:105) y un
           hijo nuestro dentro del grupo se perdería en el re-parenteo. */
        #ekkoFormasMenu {
            position: fixed;
            /* 20000100: arriba de la barra contextual del objeto (contextualMenu.js:249
               la pone en 20000000) porque un desplegable recién abierto tiene que
               tapar, pero debajo del menu de Descargar (2147483000, regla del cliente
               de "siempre por encima de todo"). Con el 2400 de la primera version la
               paleta quedaba escondida detras de esa barra. */
            z-index: 20000100;
            display: none;
            gap: 4px;
            padding: 6px;
            border-radius: 8px;
            background: rgba(255,255,255,0.96);
            border: 1px solid rgba(15,23,42,0.16);
            box-shadow: 0 10px 26px rgba(15,23,42,0.18);
        }
        #ekkoFormasMenu.abierto { display: flex; }
        #ekkoFormasMenu button {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            min-width: 76px;
            padding: 7px 8px;
            border: 1px solid transparent;
            border-radius: 6px;
            background: transparent;
            color: #3d4c63;
            font-size: 11.5px;
            font-weight: 500;
            line-height: 1.15;
            cursor: pointer;
        }
        #ekkoFormasMenu button:hover { background: rgba(15,23,42,0.07); color: #10182a; }
        #ekkoFormasMenu button.active {
            background: rgba(255,46,166,0.16);
            border-color: rgba(255,46,166,0.5);
            color: #10182a;
        }
        #ekkoFormasMenu .ekko-ic { width: 20px; height: 20px; }

        /* Aviso del modo activo, apoyado debajo de la barra superior. */
        #ekkoDibujandoChip {
            position: fixed;
            /* Un pelo debajo de la paleta y arriba de la barra contextual: es la
               unica instruccion visible mientras se dibuja, no puede quedar tapada. */
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
        body.ekko-dibujando #ekkoDibujandoChip { display: block; }

        /* Oferta de unión: aparece sola cuando la figura recién dibujada cruza
           otro contorno. Es un botón de verdad (pointer-events), a diferencia
           del aviso de dibujo, y vive en el mismo carril para que no haya que
           buscarlo: el usuario ya se quejó de botones fuera de pantalla. */
        #ekkoUnirChip {
            position: fixed;
            z-index: 20000060;
            display: none;
            align-items: center;
            gap: 6px;
            padding: 5px 6px 5px 12px;
            border-radius: 999px;
            background: rgba(16,24,42,0.92);
            color: #fff;
            font-size: 11.5px;
            line-height: 1.2;
            box-shadow: 0 8px 20px rgba(15,23,42,0.22);
        }
        #ekkoUnirChip.abierto { display: inline-flex; }
        #ekkoUnirChip .ekko-unir-texto { white-space: nowrap; }
        #ekkoUnirChip button {
            border: 0;
            border-radius: 999px;
            font-size: 11.5px;
            line-height: 1;
            cursor: pointer;
        }
        #ekkoUnirChip .ekko-unir-hacer {
            padding: 7px 12px;
            background: #ff2ea6;
            color: #fff;
            font-weight: 600;
        }
        #ekkoUnirChip .ekko-unir-hacer:hover { background: #e31d91; }
        #ekkoUnirChip .ekko-unir-cerrar {
            padding: 6px 8px;
            background: transparent;
            color: rgba(255,255,255,0.7);
            font-size: 13px;
        }
        #ekkoUnirChip .ekko-unir-cerrar:hover { color: #fff; }
    `;
    document.head.appendChild(s);
}

/* ---------------------------------------------------------------- */
/* GEOMETRÍA DEL ARRASTRE                                           */
/* ---------------------------------------------------------------- */
function esquinaShift(a, b) {
    /* Shift: el rectángulo se cuadrada y el círculo se redondo perfecto. Se
       igualan los dos lados al más corto, así la figura nunca se sale de lo
       que el puntero alcanzó. */
    const dx = b.x - a.x, dy = b.y - a.y;
    const lado = Math.min(Math.abs(dx), Math.abs(dy));
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    return new paper.Point(a.x + sx * lado, a.y + sy * lado);
}

function extremoBloqueado(a, b) {
    /* Shift en la línea la clava en 0°, 45° o 90°: es lo que sirve para una
       línea de corte derecha sobre el producto. */
    const dx = b.x - a.x, dy = b.y - a.y;
    const largo = Math.sqrt(dx * dx + dy * dy);
    if (largo < 1e-6) return b.clone();
    const paso = Math.PI / 4;
    const angulo = Math.round(Math.atan2(dy, dx) / paso) * paso;
    return new paper.Point(a.x + Math.cos(angulo) * largo, a.y + Math.sin(angulo) * largo);
}

function trazar(forma, a, b, conShift) {
    if (forma === "linea") return new paper.Path.Line(a, conShift ? extremoBloqueado(a, b) : b);

    const c = conShift ? esquinaShift(a, b) : b;
    if (forma === "rect") return new paper.Path.Rectangle(a, c);

    if (forma === "circulo") {
        /* Path.Ellipse devuelve un Shape (sin length y ajeno a la auditoría de
           Path); se arma como círculo de radio 1 y se escala a la caja, así el
           objeto real es un Path cerrado como cualquier SVG importado. */
        const caja = new paper.Rectangle(a, c);
        const rx = Math.max(caja.width / 2, 0.01);
        const ry = Math.max(caja.height / 2, 0.01);
        const elipse = new paper.Path.Circle({ center: caja.center, radius: 1, insert: false });
        elipse.scale(rx, ry);
        elipse.position = caja.center;
        return elipse;
    }

    const caja = new paper.Rectangle(a, c);
    const altura = conShift ? caja.width * 0.866 : caja.height;
    const tridente = new paper.Path([
        new paper.Point(caja.center.x, caja.bottom - altura),
        new paper.Point(caja.right, caja.bottom),
        new paper.Point(caja.left, caja.bottom)
    ]);
    tridente.closed = true;
    return tridente;
}

function estiloGuia(camino) {
    camino.strokeColor = new paper.Color(COLOR_GUIA);
    camino.strokeWidth = 1.2 / paper.view.zoom;
    camino.dashArray = [4 / paper.view.zoom, 3 / paper.view.zoom];
    return camino;
}

function pxAProyecto(px) {
    return px / (paper.view.zoom || 1);
}

function anilloCierre(centro) {
    /* La "diana": el blanco que hay que tocar para cerrar la silueta. Vive
       adentro del grupo de preview, así se va solo cuando el trazo se compromete
       o se cancela y nunca puede quedar como objeto fantasma. */
    const anillo = new paper.Path.Circle({
        center: centro, radius: pxAProyecto(DIANA_PX), insert: false
    });
    anillo.closed = true;
    anillo.strokeColor = new paper.Color(COLOR_GUIA);
    anillo.strokeWidth = 1 / (paper.view.zoom || 1);
    anillo.dashArray = [];
    return anillo;
}

function mismoPunto(a, b) {
    return a.subtract(b).length < pxAProyecto(MISMO_PUNTO_PX);
}

/* Con 2 vértices "cerrar" sería volver sobre la misma recta: no hay área que
   el láser pueda encerrar. La diana solo aparece — y solo escucha — desde 3. */
function cercaDelInicio(punto) {
    if (puntosPolilinea.length < 3) return false;
    return punto.subtract(puntosPolilinea[0]).length <= pxAProyecto(DIANA_PX);
}

/* ---------------------------------------------------------------- */
/* ACTIVAR / DESACTIVAR                                             */
/* ---------------------------------------------------------------- */
function aviso(texto) {
    if (!chip) {
        chip = document.createElement("div");
        chip.id = "ekkoDibujandoChip";
        document.body.appendChild(chip);
    }
    chip.textContent = texto;
    const barra = document.getElementById("topBar");
    const caja = barra ? barra.getBoundingClientRect() : { bottom: 0, left: 0 };
    chip.style.top = `${Math.round(caja.bottom) + 8}px`;
    chip.style.left = `${Math.round(caja.left || 0) + 12}px`;
}

/* ---------------------------------------------------------------- */
/* OFERTA DE UNIÓN (pegar tramos en UNA sola silueta)               */
/* ---------------------------------------------------------------- */
/* Unir ya existía en la cinta (grupo "booleanas", panelCommandBridge.js:400),
   pero ese tramo de la cinta queda fuera de pantalla con la ventana normal
   (medido: el botón "Unir formas en una sola" arranca en x≈1909 en 1520px).
   El cliente pidió "pegar tramos" y no encontraba la acción, así que se ofrece
   sola al lado de lo que acaba de dibujar. No hay motor nuevo: el chip llama
   a la misma operación booleana de la cinta. */

function esRuidoUnion(nodo) {
    const data = (nodo && nodo.data) || {};
    return !!(data.mockup || data.isMask || data.wasClipMask || nodo.clipMask
        || data.isSelectionBox || data.isHandle || data.isCurveHandle
        || data.isMeasurement || data.isSmartGuide || data.isNodeEditOverlay
        || data.isTracePreview || data.isDibujoPreview || data.isHole || data.locked);
}

/* Siluetas cerradas de la capa de diseño, sin el trazo recién creado. */
function contornosCerrados(excluir) {
    const salida = [];
    const capa = (paper.project.layers || []).find(l => l && l.name === "designLayer");
    if (!capa) return salida;
    const visitar = (nodo, profundidad) => {
        if (!nodo || nodo === excluir || esRuidoUnion(nodo) || profundidad > 6) return;
        if (nodo.className === "Path") {
            /* Un trazo abierto es una línea de corte: no tiene área que unir. */
            if (nodo.closed && (nodo.strokeColor || nodo.fillColor)) salida.push(nodo);
            return;
        }
        if (nodo.className === "CompoundPath") return;
        (nodo.children || []).forEach(h => visitar(h, profundidad + 1));
    };
    (capa.children || []).forEach(h => visitar(h, 0));
    return salida;
}

function identidadUnion(m) {
    if (!m) return true;
    if (typeof m.isIdentity === "function") return m.isIdentity();
    return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;
}

/* Copia en coordenadas de PROYECTO con todas las matrices de la cadena
   horneadas: `getIntersections` y `intersect` de paper 0.12.17 ignoran la
   matriz de los operandos (medido en la tijera, cutTool.js:162). */
function copiaEnProyectoUnion(camino) {
    if (!camino || camino.className !== "Path" || !camino.segments) return null;
    const clon = new paper.Path({
        segments: camino.segments.map(s => new paper.Segment(
            s.point.clone(), s.handleIn.clone(), s.handleOut.clone())),
        closed: camino.closed,
        insert: false
    });
    for (let n = camino; n; n = n.parent) {
        if (n.matrix && !identidadUnion(n.matrix)) clon.transform(n.matrix);
    }
    return clon;
}

function cerrarUnionChip() {
    unionPendiente = null;
    if (chipUnionTimer) { clearTimeout(chipUnionTimer); chipUnionTimer = null; }
    if (chipUnion) chipUnion.classList.remove("abierto");
}

function mostrarUnionChip(dueno) {
    if (!chipUnion) {
        chipUnion = document.createElement("div");
        chipUnion.id = "ekkoUnirChip";
        chipUnion.innerHTML = `<span class="ekko-unir-texto"></span>
            <button type="button" class="ekko-unir-hacer">Unir en una silueta</button>
            <button type="button" class="ekko-unir-cerrar" aria-label="Cerrar">×</button>`;
        chipUnion.querySelector(".ekko-unir-hacer")
            .addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); unirPendiente(); });
        chipUnion.querySelector(".ekko-unir-cerrar")
            .addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); cerrarUnionChip(); });
        document.body.appendChild(chipUnion);
    }
    const nombre = dueno?.data?.label || "otra forma";
    chipUnion.querySelector(".ekko-unir-texto").textContent = `Se cruza con «${nombre}»`;
    const barra = document.getElementById("topBar");
    const caja = barra ? barra.getBoundingClientRect() : { bottom: 0, left: 0 };
    chipUnion.style.top = `${Math.round(caja.bottom) + 8}px`;
    chipUnion.style.left = `${Math.round(caja.left || 0) + 12}px`;
    chipUnion.classList.add("abierto");
    if (chipUnionTimer) clearTimeout(chipUnionTimer);
    /* Se retira solo: la oferta no puede quedar tapando el lienzo ni competir
       con el menú contextual del objeto. Doce segundos alcanzan para decidir. */
    chipUnionTimer = setTimeout(cerrarUnionChip, 12000);
}

function unirPendiente() {
    const par = unionPendiente;
    cerrarUnionChip();
    if (!par || par.length < 2) return;
    if (!window.EKKO_BOOLEAN || typeof window.commitSelectionContext !== "function") return;
    for (const dueno of par) {
        if (!dueno || !dueno.parent) return;
    }
    try {
        window.commitSelectionContext(par, par[0]);
        window.EKKO_BOOLEAN.union();
    } catch (error) {
        console.warn("[EKKO DIBUJO] No se pudo unir en una silueta:", error);
    }
    paper.view.update();
}

/* Se ofrece solo cuando hay un cruce REAL: dos figuras lejanas no molestan. */
function ofrecerUnion(camino, publico) {
    cerrarUnionChip();
    if (!camino || camino.className !== "Path" || !camino.closed) return;
    if (!window.EKKO_BOOLEAN || typeof window.commitSelectionContext !== "function") return;
    const mio = copiaEnProyectoUnion(camino);
    if (!mio) return;
    let candidato = null;
    try {
        for (const otro of contornosCerrados(camino)) {
            if (!otro.visible) continue;
            const suyo = copiaEnProyectoUnion(otro);
            if (!suyo) continue;
            const cruza = realGeometryIntersects(mio, suyo);
            suyo.remove();
            if (cruza) { candidato = otro; break; }
        }
    } finally {
        mio.remove();
    }
    if (!candidato) return;
    const dueno = getPublicOwner(candidato) || candidato;
    const propio = publico || getPublicOwner(camino) || camino;
    if (!dueno || !propio || dueno === propio) return;
    unionPendiente = [propio, dueno];
    mostrarUnionChip(dueno);
}

function pintarBotones() {
    document.querySelectorAll("[data-ekko-dibujo]").forEach(b => {
        b.classList.toggle("active", b.dataset.ekkoDibujo === (activa || "__ninguna"));
    });
    /* El tile Formas tiene que encenderse cuando la figura activa salió de su
       menú: si no, el usuario no tiene de dónde salir (el aviso dice "el mismo
       botón termina" y ese botón es Formas, no el item del menú ya cerrado). */
    const tomadasDelMenu = activa === "rect" || activa === "circulo" || activa === "triangulo";
    const formas = document.getElementById("btnEkkoFormas");
    if (formas) formas.classList.toggle("active", tomadasDelMenu);
    const menu = document.getElementById("ekkoFormasMenu");
    if (menu) menu.classList.remove("abierto");
}

function desactivar() {
    if (preview) { preview.remove(); preview = null; }
    ancla = null;
    puntosLapiz = [];
    /* La polilínea en curso se descarta acá: desactivar() es Esc / el mismo
       botón, y en las dos lecturas eso significa "cancelar", no "guardar lo
       hecho". Para guardar se termina con doble clic, Enter o la diana. */
    puntosPolilinea = [];
    ultimaApuntada = null;
    if (porDobleClic) {
        if (paper && paper.view && paper.view.element) {
            paper.view.element.removeEventListener("dblclick", porDobleClic);
        }
        porDobleClic = null;
    }
    const menu = document.getElementById("ekkoFormasMenu");
    if (menu) menu.classList.remove("abierto");

    const estabaActiva = !!activa;
    activa = null;
    if (!estabaActiva) { pintarBotones(); return; }

    interactionOwner.release("draw", "dibujo-terminado");
    tool = null;
    if (toolPrevio && typeof toolPrevio.activate === "function") {
        toolPrevio.activate();
    } else if (typeof window.initSelectionTool === "function") {
        window.initSelectionTool();
    }
    toolPrevio = null;

    document.body.classList.remove("ekko-dibujando");
    if (paper && paper.view && paper.view.element) paper.view.element.style.cursor = "default";
    pintarBotones();
}

function conShift(evento) {
    /* Los modificadores de Paper vienen del DOM, pero en un ToolEvent pueden
       llegar vacíos según el evento que disparó el cierre; se lee también el
       evento original para que Shift valga de verdad. */
    return !!(evento && ((evento.modifiers && evento.modifiers.shift)
        || (evento.event && evento.event.shiftKey)));
}

function grupoPreview() {
    const grupo = new paper.Group({ insert: false });
    /* El mismo traje de las guías inteligentes (canvasControlsIntegration.js:446):
       grupo efímero marcado de selección, que el resto del estudio ya sabe
       ignorar y que nunca llega al historial porque se suelta antes del alta. */
    grupo.data = { isSelectionBox: true, isDibujoPreview: true };
    paper.project.activeLayer.addChild(grupo);
    grupo.bringToFront();
    return grupo;
}

function limpiarPreview() {
    if (preview) { preview.remove(); preview = null; }
}

function crearPreview(evento) {
    ancla = evento.point.clone();
    puntosLapiz = [ancla];
    preview = grupoPreview();
    if (activa === "lapiz") return;
    preview.addChild(estiloGuia(trazar(activa, ancla, ancla, false)));
}

function dibujarPreview(evento) {
    if (!ancla || !preview) return;
    const shift = conShift(evento);
    if (activa === "lapiz") {
        const ultimo = puntosLapiz[puntosLapiz.length - 1];
        if (ultimo && evento.point.subtract(ultimo).length < TOLERANCIA_LAPIZ) return;
        puntosLapiz.push(evento.point.clone());
        preview.removeChildren();
        preview.addChild(estiloGuia(new paper.Path(puntosLapiz)));
        if (lapizCercaDelInicio()) preview.addChild(anilloCierre(puntosLapiz[0]));
        return;
    }
    preview.removeChildren();
    preview.addChild(estiloGuia(trazar(activa, ancla, evento.point, shift)));
}

/* ---------------------------------------------------------------- */
/* POLILÍNEA (Línea, al modo AutoCAD)                               */
/* ---------------------------------------------------------------- */
/* Línea dejó de ser "un arrastre, un segmento": ahora cada clic clava un
   vértice y la banda elástica persigue al puntero, como en AutoCAD/LightBurn.
   Tres salidas, y las tres son las que el usuario ya conoce:
   - volver al punto de arranque y hacer clic => silueta CERRADA (lo que pidió);
   - doble clic o Enter => termina ABIERTA (línea de corte);
   - Esc o el mismo botón => cancela lo dibujado.
   Rect/Círculo/Triángulo siguen con arrastrar-soltar: ahí el tamaño ES el
   arrastre y no hay nada que encadenar. */

function puntoLibre(evento) {
    /* Shift en la polilínea es el Ortho de AutoCAD: el vértice se clava en 0°,
       45° o 90° respecto del anterior, conservando el largo. Se calcula contra
       el último vértice, no contra el origen, así cada tramo puede ir derecho. */
    const ultimo = puntosPolilinea[puntosPolilinea.length - 1];
    const punto = evento.point;
    return (ultimo && conShift(evento)) ? extremoBloqueado(ultimo, punto) : punto;
}

function avisoPolilinea() {
    const n = puntosPolilinea.length;
    if (n < 3) {
        aviso(`Polilínea · ${n} vértice${n === 1 ? "" : "s"} · clic para el siguiente · doble clic o Enter termina · Esc cancela`);
    } else {
        aviso(`Polilínea · ${n} vértices · clic en la diana de inicio cierra la silueta · doble clic o Enter termina · Esc cancela`);
    }
}

function redibujarBanda(cursor, cierra) {
    if (!preview) return;
    preview.removeChildren();
    const pts = puntosPolilinea.map(p => p.clone());
    if (cierra) {
        const contorno = estiloGuia(new paper.Path(pts));
        contorno.closed = true;
        preview.addChild(contorno);
    } else {
        if (cursor) pts.push(cursor.clone());
        if (pts.length > 1) preview.addChild(estiloGuia(new paper.Path(pts)));
    }
    if (puntosPolilinea.length >= 3) preview.addChild(anilloCierre(puntosPolilinea[0]));
    paper.view.update();
}

function polilineaEnCurso() {
    return !!preview && puntosPolilinea.length >= 1;
}

function iniciarPolilinea(punto) {
    ancla = punto.clone();
    puntosPolilinea = [ancla];
    ultimaApuntada = punto.clone();
    preview = grupoPreview();
    redibujarBanda(punto, false);
}

function agregarVertice(apuntado, libre) {
    const ultimo = puntosPolilinea[puntosPolilinea.length - 1];
    /* Las dos comparaciones: contra el último punto que el usuario tocó (es la
       que neutraliza el segundo clic del doble clic) y contra el vértice ya
       clavado (la que sirve sin Shift). */
    if (ultimo && (mismoPunto(apuntado, ultimaApuntada || ultimo) || mismoPunto(libre, ultimo))) return false;
    puntosPolilinea.push(libre.clone());
    ultimaApuntada = apuntado.clone();
    return true;
}

function clicPolilinea(evento) {
    if (!preview) {
        iniciarPolilinea(evento.point);
        avisoPolilinea();
        return;
    }
    /* La diana se prueba con el punto real del cursor: con Shift el vértice
       puede saltar a otra esquina y el usuario seguiría apuntando al inicio. */
    if (cercaDelInicio(evento.point)) { terminarPolilinea(true); return; }
    agregarVertice(evento.point, puntoLibre(evento));
    redibujarBanda(evento.point, false);
    avisoPolilinea();
}

function soltarPolilinea(evento) {
    if (!preview) return;
    if (cercaDelInicio(evento.point)) { terminarPolilinea(true); return; }
    /* Sirven los dos estilos de siempre: clic-clic (el vértice ya entró abajo)
       y arrastrar-soltar (acá entra el punto de salida). El filtro de
       mismoPunto evita que un mismo clic se cuente dos veces. */
    agregarVertice(evento.point, puntoLibre(evento));
    redibujarBanda(evento.point, false);
    avisoPolilinea();
}

function seguirCursorPolilinea(evento) {
    if (!preview) return;
    const cierra = cercaDelInicio(evento.point);
    redibujarBanda(cierra ? puntosPolilinea[puntosPolilinea.length - 1] : puntoLibre(evento), cierra);
}

function terminarPolilinea(cerrar) {
    const pts = puntosPolilinea.map(p => p.clone());
    limpiarPreview();
    puntosPolilinea = [];
    ancla = null;
    if (pts.length < 2) { desactivar(); return; }
    const camino = new paper.Path(pts);
    if (cerrar) {
        camino.closed = true;
        darAlta(camino, "linea", true);
        return;
    }
    if (camino.length < UMBRAL_MINIMO) {
        camino.remove();
        desactivar();
        return;
    }
    darAlta(camino, "linea", false);
}

/* El alta, en el mismo orden que el QR (editor.js:2209-2235). */
function baseGeometrica(camino) {
    /* geomBase es la copia limpia de la geometría: sin ella el audit marca
       "missing-geom-base" (geometryAudit.js:23) y el motor de sólidos/huecos
       (editor.js:185) ignora el objeto. initGeomBaseRecursive vive privado en
       editor.js, así que se arma acá con la misma fórmula pública. */
    const base = getOwnerLocalGeometry(camino);
    if (!base) return;
    base.applyMatrix = false;
    base.matrix = new paper.Matrix();
    camino.data.geomBase = base;
    if (camino.data.geomBasePathData === undefined && base.pathData) {
        camino.data.geomBasePathData = base.pathData;
    }
}

/* Lápiz: si al soltar el trazo cae sobre su propio arranque, lo que se quiere
   es una silueta cerrada (contorno grabable o rellenable), no un contorno
   abierto que la auditoría marque como línea de corte. */
function lapizCercaDelInicio() {
    if (puntosLapiz.length < 3) return false;
    const primero = puntosLapiz[0];
    return puntosLapiz[puntosLapiz.length - 1].subtract(primero).length <= pxAProyecto(DIANA_PX);
}

/* El alta, en el mismo orden que el QR (editor.js:2209-2235). Compartida por las
   figuras de arrastre, la polilínea y el lápiz: los tres caminos entran por la
   misma puerta y por eso se seleccionan, mueven, fusionan, auditan y exportan
   igual que un SVG cargado. */
function darAlta(camino, forma, cerrar) {
    /* El snapshot TIENE que tomarse con el trazo todavía afuera del proyecto:
       saveHistory guarda el JSON del lienzo, y si el objeto nuevo ya está
       insertado, el Ctrl+Z lo devuelve sin estilos ni data (fantasma otra vez).
       Paper inserta el Path en la capa corriente al construirlo, de ahí el
       remove() de entrada. */
    camino.remove();
    window.saveHistory?.();

    const meta = FORMAS[forma];
    camino.strokeColor = new paper.Color(0);
    camino.strokeWidth = GROSOR_TRAZO;
    camino.fillColor = null;
    camino.closed = !!cerrar;
    camino.data = { locked: false, label: meta.label, sourcePaintMode: "stroke-only" };
    if (!camino.closed) {
        /* geometryAudit.js:30 marca "open-vector" a todo Path abierto, salvo que
           declare que es línea de corte. Un trazo a mano o una polilínea abierta
           SIEMPRE son corte: el láser recorre el camino, no rellena nada. */
        camino.data.isCutLine = true;
    }

    const proj = paper.project;
    const capa = (proj.layers || []).find(l => l && l.name === "designLayer") || proj.activeLayer;
    capa.addChild(camino);
    baseGeometrica(camino);
    const publico = window.ensureContainedDesignItem
        ? window.ensureContainedDesignItem(camino) : camino;

    desactivar();
    window.selectItem?.(publico || camino);
    paper.view.update();
    ofrecerUnion(camino, publico || camino);
}

/* Figuras de arrastre (Rect/Círculo/Triángulo) y Lápiz: se comprometen al soltar. */
function comprometer(evento) {
    const forma = activa;
    const cerrar = forma === "lapiz" ? lapizCercaDelInicio() : FORMAS[forma].cerrada;
    const camino = forma === "lapiz"
        ? (puntosLapiz.length > 1 ? new paper.Path(puntosLapiz) : null)
        : trazar(forma, ancla, evento.point, conShift(evento));

    limpiarPreview();
    ancla = null;
    puntosLapiz = [];

    if (!camino || camino.length < UMBRAL_MINIMO) {
        /* Paper inserta el Path en la capa corriente al construirlo: si el
           arrastre fue un toque de más, el hilo hay que cortarlo de ahí, si no
           queda un trazo fantasma en el lienzo (medido en el arnés: sin este
           remove el lienzo guardaba un Path de 1px y la cinta abría "Vector"). */
        if (camino) camino.remove();
        desactivar();
        return;
    }

    if (forma === "lapiz" && typeof camino.simplify === "function") {
        camino.simplify(TOLERANCIA_LAPIZ);
    }
    darAlta(camino, forma, cerrar);
}

function activar(forma) {
    if (!window.paper || !paper.project || !FORMAS[forma]) return;
    /* Dibujar otra cosa cancela la oferta anterior: si no, el chip uniría una
       silueta que el usuario ya dejó atrás. */
    cerrarUnionChip();
    if (activa === forma) {
        /* Volver a apretar Línea con la polilínea en curso NO la tira: remata
           el trazo abierto, que es lo que hace el Enter y lo que espera el que
           ya tiene los vértices puestos. Sin vértices, el botón apaga. */
        if (forma === "linea" && polilineaEnCurso() && puntosPolilinea.length >= 2) {
            terminarPolilinea(false);
        } else {
            desactivar();
        }
        return;
    }
    /* Cambiar de herramienta con una ya activa: se limpia la sesión anterior
       primero, si no el preview viejo (con sus vértices o su diana) queda
       colgado en la capa como un trazo fantasma. */
    if (activa) desactivar();

    toolPrevio = paper.tool || null;
    if (!interactionOwner.claim("draw", { owner: "drawTools" })) return;
    activa = forma;

    /* new Tool() ya deja su tool como el activo en Paper; por eso toolPrevio se
       Leyó ANTES de construirlo. */
    tool = new paper.Tool();
    if (forma === "linea") {
        tool.onMouseDown = (evento) => { if (paper.project) clicPolilinea(evento); };
        tool.onMouseDrag = (evento) => { seguirCursorPolilinea(evento); };
        tool.onMouseUp = (evento) => { soltarPolilinea(evento); };
        tool.onMouseMove = (evento) => { seguirCursorPolilinea(evento); };
        /* Paper sintetiza su "doubleclick" sobre el mouseup y con eventos
           sintéticos no siempre lo entrega; el dblclick del DOM es la misma
           intención y llega siempre. El de la selección (selection.js:768) ya
           se autocensura mientras el modo es "draw", así que no chocan. */
        porDobleClic = (evento) => {
            if (!polilineaEnCurso()) return;
            evento.preventDefault?.();
            terminarPolilinea(false);
        };
        if (paper.view.element) paper.view.element.addEventListener("dblclick", porDobleClic);
    } else {
        tool.onMouseDown = (evento) => { if (!paper.project) return; crearPreview(evento); };
        tool.onMouseDrag = (evento) => { dibujarPreview(evento); };
        tool.onMouseUp = (evento) => { comprometer(evento); };
    }
    tool.activate();

    document.body.classList.add("ekko-dibujando");
    if (paper.view.element) paper.view.element.style.cursor = "crosshair";
    if (forma === "linea") {
        aviso("Polilínea: clic en cada vértice · Shift lo clava en 0°, 45° o 90° · clic en la diana de inicio cierra la silueta · doble clic o Enter termina");
    } else {
        aviso(`Arrastrá para dibujar ${FORMAS[forma].label.toLowerCase()} · Shift lo cuadra · Esc o el mismo botón termina`);
    }
    pintarBotones();
}

function porTecla(evento) {
    if (!activa) return;
    if (evento.key === "Escape") {
        evento.stopPropagation();
        desactivar();
        return;
    }
    /* Enter remata la polilínea, como en AutoCAD. Solo cuando ya hay trazo: sin
       vértices no hay nada que guardar y el botón sigue esperando el primer
       clic. */
    if ((evento.key === "Enter" || evento.key === "Return")
        && activa === "linea" && puntosPolilinea.length >= 2) {
        evento.preventDefault();
        evento.stopPropagation();
        terminarPolilinea(false);
    }
}

/* ---------------------------------------------------------------- */
/* BOTONES EN EL GRUPO CREAR                                        */
/* ---------------------------------------------------------------- */
function icono(nombre) {
    return `<svg class="ekko-ic" aria-hidden="true"><use href="ASSETS/ui/ekko-icons.svg#${nombre}"></use></svg>`;
}

function boton(id, forma, nombre, etiqueta, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-action";
    b.id = id;
    if (forma) b.dataset.ekkoDibujo = forma;
    b.title = title;
    b.innerHTML = `${icono(nombre)} ${etiqueta}`;
    return b;
}

function contenedorCrear() {
    /* Dos momentos posibles: la cinta todavía no se armó — los botones van al
       primer .top-group de #topBar, que ribbonLayout.js:121 adopta como Crear —
       o ya está armada: van derecho al cuerpo del grupo Crear, que la cascada
       ya movió a #ekkoCascadeTools. */
    return document.querySelector('.ekko-ribbon-group[data-group="creacion"] .ekko-ribbon-body')
        || document.querySelector('#topBar .top-group');
}

function menuFormas(botonFormas) {
    const menu = document.createElement("div");
    menu.id = "ekkoFormasMenu";
    [
        { forma: "rect", icono: "ekko-rect", etiqueta: "Rectángulo" },
        { forma: "circulo", icono: "ekko-circulo", etiqueta: "Círculo" },
        { forma: "triangulo", icono: "ekko-triangulo", etiqueta: "Triángulo" }
    ].forEach(def => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.ekkoDibujo = def.forma;
        b.title = `${def.etiqueta}: arrastrá el tamaño. Shift lo fuerza cuadrado o círculo perfecto.`;
        b.innerHTML = `${icono(def.icono)} ${def.etiqueta}`;
        b.addEventListener("click", () => activar(def.forma));
        menu.appendChild(b);
    });
    document.body.appendChild(menu);

    botonFormas.addEventListener("click", () => {
        /* Con una figura ya tomada, el botón de Formas APAGA la herramienta
           (es lo que promete el aviso), no vuelve a abrir el menú. */
        if (activa === "rect" || activa === "circulo" || activa === "triangulo") {
            desactivar();
            return;
        }
        if (menu.classList.contains("abierto")) { menu.classList.remove("abierto"); return; }
        const caja = botonFormas.getBoundingClientRect();
        menu.style.top = `${Math.round(caja.bottom) + 6}px`;
        menu.style.left = `${Math.round(caja.left)}px`;
        menu.classList.add("abierto");
    });
    document.addEventListener("mousedown", (ev) => {
        if (!menu.classList.contains("abierto")) return;
        if (menu.contains(ev.target) || botonFormas.contains(ev.target)) return;
        menu.classList.remove("abierto");
    }, true);
}

function crearBotones() {
    const caja = contenedorCrear();
    if (!caja || document.getElementById("btnEkkoLinea")) return !!document.getElementById("btnEkkoLinea");

    const linea = boton("btnEkkoLinea", "linea", "ekko-lineas", "Línea",
        "Polilínea de corte: un clic por vértice. Volvé al inicio y hacé clic para "
        + "cerrar la silueta. Doble clic o Enter termina; Shift clava cada tramo en 0°, 45° o 90°.");
    const formas = boton("btnEkkoFormas", "", "ekko-formas", "Formas",
        "Rectángulo, círculo o triángulo. Elegí la figura y arrastrá el tamaño en el lienzo.");
    const lapiz = boton("btnEkkoLapiz", "lapiz", "ekko-lapiz", "Lápiz",
        "Dibujo a mano alzada; se simplifica solo para que el láser recorra menos puntos. "
        + "Si soltás sobre el arranque, la silueta queda cerrada.");

    caja.appendChild(linea);
    caja.appendChild(formas);
    caja.appendChild(lapiz);

    menuFormas(formas);
    linea.addEventListener("click", () => activar("linea"));
    lapiz.addEventListener("click", () => activar("lapiz"));
    return true;
}

/* La cinta se arma en DOMContentLoaded y el orden de los módulos no está
   garantizado: si al correr nosotros el grupo Crear todavía no existe, se
   reintenta unos frames en vez de dejar los botones fuera de la cinta. */
function montar() {
    if (crearBotones()) return;
    let intentos = 60;
    const ticker = () => {
        if (crearBotones() || --intentos <= 0) return;
        requestAnimationFrame(ticker);
    };
    requestAnimationFrame(ticker);
}

export function initDrawTools() {
    if (typeof document === "undefined") return;
    estilos();
    document.addEventListener("keydown", porTecla, true);
    window.EKKO_DRAW_TOOLS = { activar, desactivar, formaActiva: () => activa };
    montar();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initDrawTools(), { once: true });
} else {
    initDrawTools();
}
