/* EKKO Studio — LÍNEAS y FORMAS (ronda 8)
 *
 * QUE APORTA
 * Tres herramientas nuevas en el grupo CREAR de la cinta: Línea, Formas
 * (Rectángulo / Círculo / Triángulo) y Lápiz. Son exactamente las tres que
 * estaban dibujadas como íconos (ekko-lineas, ekko-formas, ekko-lapiz en
 * ASSETS/ui/ekko-icons.svg) y "sin botón todavia" (ASSETS/ui/preview.html:105).
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
import { getOwnerLocalGeometry } from "./designGeometry.js";

/* "draw" no estaba en la lista. VALID_MODES es un Set exportado, así que la
   herramienta declara su propio modo acá en vez de tocar interactionOwner.js
   por una línea. */
if (!VALID_MODES.has("draw")) VALID_MODES.add("draw");

const GROSOR_TRAZO = 1.2;    // unidades de proyecto: el mismo pelo de la chapa
const UMBRAL_MINIMO = 2;     // un arrastre más chico fue un toque de más
const TOLERANCIA_LAPIZ = 1.2;
const COLOR_GUIA = "#e0245e"; // el rosa de las guías: avisa "esto todavía no es un objeto"

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
let chip = null;

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
            z-index: 2400;
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
            z-index: 2450;
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

function crearPreview(evento) {
    ancla = evento.point.clone();
    puntosLapiz = [ancla];
    preview = new paper.Group({ insert: false });
    /* El mismo traje de las guías inteligentes (canvasControlsIntegration.js:446):
       grupo efímero marcado de selección, que el resto del estudio ya sabe
       ignorar y que nunca llega al historial porque se suelta antes del alta. */
    preview.data = { isSelectionBox: true, isDibujoPreview: true };
    paper.project.activeLayer.addChild(preview);
    preview.bringToFront();
    if (activa !== "lapiz") preview.addChild(estiloGuia(trazar(activa, ancla, ancla, false)));
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
        return;
    }
    preview.removeChildren();
    preview.addChild(estiloGuia(trazar(activa, ancla, evento.point, shift)));
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

function comprometer(evento) {
    const forma = activa;
    const shift = conShift(evento);
    const camino = forma === "lapiz"
        ? (puntosLapiz.length > 1 ? new paper.Path(puntosLapiz) : null)
        : trazar(forma, ancla, evento.point, shift);

    if (preview) { preview.remove(); preview = null; }
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

    /* El snapshot TIENE que tomarse con el trazo todavía afuera del proyecto:
       saveHistory guarda el JSON del lienzo, y si el objeto nuevo ya está
       insertado, el Ctrl+Z lo devuelve sin estilos ni data (fantasma otra vez). */
    camino.remove();
    window.saveHistory?.();

    const meta = FORMAS[forma];
    camino.strokeColor = new paper.Color(0);
    camino.strokeWidth = GROSOR_TRAZO;
    camino.fillColor = null;
    if (forma === "lapiz" && typeof camino.simplify === "function") {
        camino.simplify(TOLERANCIA_LAPIZ);
    }
    camino.closed = !!meta.cerrada && forma !== "lapiz";
    camino.data = { locked: false, label: meta.label, sourcePaintMode: "stroke-only" };
    if (!camino.closed) {
        /* geometryAudit.js:30 marca "open-vector" a todo Path abierto, salvo que
           declare que es línea de corte. Un trazo a mano o una recta SIEMPRE son
           corte: el láser recorre el camino, no rellena nada. */
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
}

function activar(forma) {
    if (!window.paper || !paper.project || !FORMAS[forma]) return;
    if (activa === forma) { desactivar(); return; }

    if (!activa) {
        toolPrevio = paper.tool || null;
        if (!interactionOwner.claim("draw", { owner: "drawTools" })) return;
    }
    activa = forma;

    /* new Tool() ya deja su tool como el activo en Paper; por eso toolPrevio se
       Leyó ANTES de construirlo. */
    tool = new paper.Tool();
    tool.onMouseDown = (evento) => { if (!paper.project) return; crearPreview(evento); };
    tool.onMouseDrag = (evento) => { dibujarPreview(evento); };
    tool.onMouseUp = (evento) => { comprometer(evento); };
    tool.activate();

    document.body.classList.add("ekko-dibujando");
    if (paper.view.element) paper.view.element.style.cursor = "crosshair";
    aviso(`Arrastrá para dibujar ${FORMAS[forma].label.toLowerCase()} · Shift lo cuadra · Esc o el mismo botón termina`);
    pintarBotones();
}

function porTecla(evento) {
    if (!activa) return;
    if (evento.key === "Escape") {
        evento.stopPropagation();
        desactivar();
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
        "Línea de corte: arrastrá de un punto a otro. Shift la deja en 0°, 45° o 90°.");
    const formas = boton("btnEkkoFormas", "", "ekko-formas", "Formas",
        "Rectángulo, círculo o triángulo. Elegí la figura y arrastrá el tamaño en el lienzo.");
    const lapiz = boton("btnEkkoLapiz", "lapiz", "ekko-lapiz", "Lápiz",
        "Dibujo a mano alzada; se simplifica solo para que el láser recorra menos puntos.");

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
