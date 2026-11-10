/* =========================================================================
   EKKO STUDIO — LOS PARAMETROS DE QUITAR FONDO DENTRO DE LA CINTA

   EL PROBLEMA (medido 2026-11-01 sobre f988f41):
   Al clickear "Quitar Fondo" se abria `#ekkoParamSurface`, un popover
   flotante con Borde / Suavizar / Halo. Medido: caja [8,124,329,188] o sea
   UNA VENTANA MAS encima del lienzo. El cliente la confundia con la ventana
   de Editar Fondo, que es otra herramienta y otra cosa.

   AHORA:
   Los mismos tres valores, declarados en el MISMO lugar de siempre
   (commandParameters.js -> PARAM_SPECS.removeBg, importada acá), viven:
     · en la cinta fija, como un GRUPO del nivel 2 llamado "Recorte", pegado
       despues del grupo "Imagen";
     · en la barra emergente, dentro de `#ctxImageControls` (la caja que ya
       significa "controles de la imagen seleccionada").
   Ninguna ventana nueva, ningun valor nuevo, ningun comando nuevo.

   LO QUE NO TOCA:
   `#ventana-editar-fondo` (Editar Fondo / el pincel de retoque) sigue
   exactamente como estaba. Son dos herramientas distintas con dos superficies
   distintas: Quitar Fondo entrega el recorte profesional en un clic, y Editar
   Fondo es la reparacion a mano para cuando ese clic no alcanzó.

   POR QUE LOS DOS SETS NO PUEDEN DESINCRONIZARSE:
   el valor real vive en `EKKO.BackgroundRemover.config`. Cada control lee y
   escribe esa unica fuente; cuando uno cambia, los demas se refrescan contra
   ella. La ventana de Editar Fondo escribe la misma config, y por eso este
   modulo tambien la relee por su cuenta (para eso alcanza el interval).
   ========================================================================= */

import { PARAM_SPECS, crearAplicador } from "./commandParameters.js";
import { isToolEnabled } from "./capabilities.js";

const COMANDO = "removeBg";
const GRUPO_CINTA = "recorte";
const ID_BARRA = "ekkoRecorteBarra";
const ETIQUETA_GRUPO = "Recorte";

/* Los tres valores que declara el registro; en el orden de siempre. */
const SPECS = (PARAM_SPECS[COMANDO]?.parametros || []).slice();
const ACCIONES = (PARAM_SPECS[COMANDO]?.acciones || []).slice();

/** El valor real manda: se lee la config del motor, nunca un recuerdo. */
function leerCfg(spec) {
    const cfg = window.EKKO?.BackgroundRemover?.config?.[spec.claveCfg];
    return typeof cfg === "number" ? cfg : 0.5;
}

function seleccionActual() {
    const sel = [];
    if (window.selectedItems && window.selectedItems.length) {
        sel.push(...window.selectedItems.filter(Boolean));
    } else if (window.selectedItem) sel.push(window.selectedItem);
    return sel;
}

/* ¿HAY un recorte hecho por Quitar Fondo en lo seleccionado?
   Se pregunta AL MISMO motor que decide si el boton "Editar Fondo" existe
   (capabilities: editCutout = algun item con data.quitarFondoIA). Si la
   regla de ese boton cambia, esta tira cambia sola: no se copia la
   condicion, se llama la funcion. */
function hayRecorte() {
    const sel = seleccionActual();
    if (!sel.length) return false;
    return isToolEnabled("editCutout", sel);
}

/* ------------------------------------------------------------------ */
/* ESTILOS: van aca, inyectados, como hace cascadeToolbar.js.          */
/* No se toca styles.css para que el arreglo de este modulo quepa en   */
/* un solo archivo.                                                    */
/* ------------------------------------------------------------------ */
function estilos() {
    if (document.getElementById("ekko-recorte-estilos")) return;
    const st = document.createElement("style");
    st.id = "ekko-recorte-estilos";
    st.textContent = `
        /* Cada valor es una fila de 20px: Borde · Suavizar · Halo se apilan de
           a dos por columna dentro del cuerpo de 44px de la cinta, que es el
           molde de cinta que ya usa el grupo Imagen. Asi el grupo cuesta ~230px
           y no ~460px: medido, la cinta desborda y un bloque ancho empuja las
           herramientas que SI importan fuera de la ventana. */
        #ekkoCascadeTools .ekko-ribbon-group[data-group="${GRUPO_CINTA}"] .ekko-ribbon-group-body {
            gap: 2px 8px;
        }
        .ekko-recorte-param {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 20px;
            font-size: 11px;
            line-height: 1;
            white-space: nowrap;
            color: inherit;
            cursor: default;
        }
        .ekko-recorte-nombre { opacity: .8; }
        .ekko-recorte-rango {
            -webkit-appearance: none;
            appearance: none;
            width: 62px;
            height: 4px;
            margin: 0;
            border-radius: 3px;
            background: rgba(148,163,184,.55);
            cursor: ew-resize;
        }
        body[data-modo="claro"] .ekko-recorte-rango { background: #cbd5e1; }
        .ekko-recorte-rango::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 11px;
            height: 11px;
            border-radius: 50%;
            background: #ff2ea6;
            border: none;
        }
        .ekko-recorte-rango::-moz-range-thumb {
            width: 11px;
            height: 11px;
            border-radius: 50%;
            background: #ff2ea6;
            border: none;
        }
        .ekko-recorte-rango:focus-visible {
            outline: 1px solid #1d4ed8;
            outline-offset: 3px;
        }
        .ekko-recorte-valor {
            min-width: 30px;
            font-variant-numeric: tabular-nums;
            font-weight: 700;
        }
        /* El envoltorio del boton NO es un <button> a proposito: pintarHeroes()
           busca hijos BUTTON del cuerpo del grupo y le pone el molde grande al
           primero. Aca el boton vive adentro de un span para que la accion no
           se infle a 44px y rompa la grilla de dos por columna. */
        .ekko-recorte-accion-env { display: inline-flex; align-items: center; height: 20px; }
        .ekko-recorte-accion {
            border: 1px solid rgba(148,163,184,.5);
            border-radius: 5px;
            background: transparent;
            padding: 2px 7px;
            font-size: 11px;
            line-height: 1.3;
            cursor: pointer;
            color: inherit;
            white-space: nowrap;
        }
        .ekko-recorte-accion:hover { border-color: #ff2ea6; color: #ff2ea6; }
        /* En la barra emergente la tira va en una sola linea, pegada despues
           de los espejos de #ctxImageControls. */
        #${ID_BARRA} {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            height: 26px;
        }
        #${ID_BARRA} .ekko-recorte-rango { width: 54px; }
    `;
    document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* Un control = nombre + deslizadores + lectura. Sin campo a numero:   */
/* en la cinta no hay lugar y la precision ya existe con las flechas    */
/* del rango enfocado y con la rueda.                                   */
/* ------------------------------------------------------------------ */
const vivos = [];        // todos los controles de las dos superficies

function crearControl(spec) {
    const envoltorio = document.createElement("label");
    envoltorio.className = "ekko-recorte-param";
    envoltorio.dataset.ekkoRecorte = spec.id;

    const nombre = document.createElement("span");
    nombre.className = "ekko-recorte-nombre";
    nombre.textContent = spec.etiqueta;

    const rango = document.createElement("input");
    rango.type = "range";
    rango.className = "ekko-recorte-rango";
    rango.min = String(spec.min);
    rango.max = String(spec.max);
    rango.step = String(spec.paso);
    rango.setAttribute("aria-label", spec.etiqueta);
    rango.title = spec.ayuda || spec.etiqueta;

    const lectura = document.createElement("span");
    lectura.className = "ekko-recorte-valor";

    envoltorio.append(nombre, rango, lectura);

    const aplicador = crearAplicador(spec, COMANDO);

    const control = { spec, rango, mostrado: null };

    /* ESCALA: en el motor el valor es una FRACCION (BORDE 0.5); en el control
       es el numero que ve el cliente (50%). Medido en el primer arranque de
       esta tira: sin la conversion la cinta decía "Borde 1%" y "Halo 1%" —
       pintaba la fraccion redondeada, no el porcentaje. */
    const pintar = v => {
        const n = Math.max(spec.min, Math.min(spec.max, Math.round(v)));
        if (n !== control.mostrado) {
            // Escribir el value en cada tick movia el DOM de la barra y de la
            // cinta, y eso re-disparaba a los observadores que llaman al tick:
            // bucle. Si el numero no cambio, no se toca nada (y un arrastre en
            // curso no se pisa).
            control.mostrado = n;
            rango.value = String(n);
            lectura.textContent = n + "%";
        }
        aplicador.setValor(n);
        return n;
    };

    /* El rango enfocado es el que esta moviendo la mano: nunca se le pisa el
       valor mientras se arrastra o se usa la rueda. */
    control.sincronizar = () => {
        if (document.activeElement !== rango) pintar(leerCfg(spec) * 100);
    };
    pintar(leerCfg(spec) * 100);

    rango.addEventListener("input", () => {
        pintar(Number(rango.value));
        aplicador.pedir();
        sincronizarOtros(control);
    });
    rango.addEventListener("change", () => {
        pintar(Number(rango.value));
        aplicador.aplicarAhora();
        sincronizarOtros(control);
    });
    rango.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const paso = Math.max(1, Number(spec.paso) || 1) * (Math.abs(ev.deltaY) >= 100 ? 5 : 1);
        pintar(Number(rango.value) + (ev.deltaY > 0 ? -paso : paso));
        aplicador.pedir();
        sincronizarOtros(control);
        clearTimeout(rango.__ruedaT);
        rango.__ruedaT = setTimeout(() => aplicador.aplicarAhora(), 220);
    }, { passive: false });

    vivos.push(control);
    return envoltorio;
}

/* El que toca manda: los demas se ponen en el mismo valor leido del motor. */
function sincronizarOtros(origen) {
    vivos.forEach(c => { if (c !== origen) c.sincronizar(); });
}

function crearAccion(a) {
    const env = document.createElement("span");
    env.className = "ekko-recorte-accion-env";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ekko-recorte-accion";
    b.textContent = a.etiqueta;
    b.dataset.ekkoRecorteAccion = a.id;
    // SIN id ni data-fusion-btn a proposito: enlazar() de cascadeToolbar
    // registra en "Mas usadas" cualquier boton de la cinta o de la barra que
    // tenga nombre de comando, y esto no es un comando, es una accion del
    // panel. Sin clave, registrarUso() sale solo.
    b.addEventListener("click", () => {
        try { a.ejecutar(); } catch (e) { console.warn("[EKKO RECORTE] accion", a.id, e); }
        sincronizarTodos();
    });
    env.appendChild(b);
    return env;
}

function crearTira(conAccion) {
    const nodo = document.createDocumentFragment();
    SPECS.forEach(s => nodo.appendChild(crearControl(s)));
    if (conAccion) ACCIONES.forEach(a => nodo.appendChild(crearAccion(a)));
    return nodo;
}

/* ------------------------------------------------------------------ */
/* NIVEL 2: un grupo MAS de la cinta, escrito a mano con el mismo molde */
/* del motor (cuerpo + etiqueta debajo, plegable) porque ribbonLayout   */
/* solo construye los grupos del manifiesto. Se copia .ekko-ribbon-group */
/* para heredar ekko-ribbon.css y el skin de la cascada.                */
/* ------------------------------------------------------------------ */
function grupoRecorte() {
    const fila = document.getElementById("ekkoCascadeTools");
    if (!fila) return null;
    let g = fila.querySelector(`.ekko-ribbon-group[data-group="${GRUPO_CINTA}"]`);
    if (g) return g;

    g = document.createElement("div");
    g.className = "ekko-ribbon-group is-empty";
    g.dataset.group = GRUPO_CINTA;

    const cuerpo = document.createElement("div");
    cuerpo.className = "ekko-ribbon-group-body";
    cuerpo.appendChild(crearTira(true));

    const head = document.createElement("div");
    head.className = "ekko-ribbon-group-head";
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("aria-expanded", "true");
    head.title = `Plegar / desplegar el grupo ${ETIQUETA_GRUPO}`;
    const title = document.createElement("span");
    title.className = "ekko-ribbon-group-title";
    title.textContent = ETIQUETA_GRUPO;
    head.appendChild(title);
    const plegar = () => {
        const plegado = g.classList.toggle("is-collapsed");
        head.setAttribute("aria-expanded", plegado ? "false" : "true");
    };
    head.addEventListener("click", plegar);
    head.addEventListener("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); plegar(); }
    });

    g.appendChild(cuerpo);
    g.appendChild(head);

    // Pegado despues del grupo "Imagen" (removeBg/editCutout): se lee
    // herramienta -> sus valores, en el orden en que ya estan en la cinta.
    const imagen = fila.querySelector('.ekko-ribbon-group[data-group="fondo"]');
    if (imagen && imagen.nextSibling) fila.insertBefore(g, imagen.nextSibling);
    else fila.appendChild(g);
    return g;
}

/* ------------------------------------------------------------------ */
/* BARRA EMERGENTE: la tira compacta vive DENTRO de #ctxImageControls,   */
/* la caja de la barra que ya se enciende sola cuando lo seleccionado    */
/* es una imagen (data-ekko-especie="image"). No se arma una unidad     */
/* nueva de la barra: refrescarBarraEmergente() esconde como             */
/* "ekko-fb-vacia" toda unidad que no tenga botones, y una tira de       */
/* deslizadores no tiene ninguno — colgando de una unidad que si los    */
/* tiene, la caja sigue encendida por los espejos.                       */
/* ------------------------------------------------------------------ */
function tiraBarra() {
    const caja = document.getElementById("ctxImageControls");
    if (!caja) return null;
    let tira = document.getElementById(ID_BARRA);
    if (!tira) {
        tira = document.createElement("div");
        tira.id = ID_BARRA;
        tira.className = "ekko-recorte-barra";
        // SIN "Restaurar original" aca: esa accion ya esta en la cinta. En la
        // barra van los tres valores, que son lo que se mira mientras se
        // afinan el borde y el halo.
        tira.appendChild(crearTira(false));
        caja.appendChild(tira);
    }
    return tira;
}

/* ------------------------------------------------------------------ */
/* Visibilidad                                                        */
/* ------------------------------------------------------------------ */
function refrescar() {
    const visible = hayRecorte() && SPECS.length > 0;
    const g = grupoRecorte();
    if (g) {
        // is-empty es la clase que ya usa el motor para borrar un grupo sin
        // nada visible (ekko-ribbon.css:139) — no se inventa otro mecanismo.
        g.classList.toggle("is-empty", !visible);
    }
    const tira = tiraBarra();
    if (tira) tira.style.display = visible ? "inline-flex" : "none";
    if (visible) sincronizarTodos();
    return visible;
}

/* Relee la config del motor en los controles que NO estan siendo tocados.
   Cubre los cambios que hace otra superficie (la ventana de Editar Fondo, o
   el otro set de esta tira) sin tener que escuchar eventos de nadie. */
function sincronizarTodos() {
    vivos.forEach(c => c.sincronizar());
}

let ultimo = "";
function tick() {
    /* Firma = lo que los controles MUESTRAN, no solo lo que se toco. Medido:
       con la firma mirando nada mas la seleccion y la config, terminar una
       Quitar Fondo no cambiaba nada (el item sigue siendo el mismo y BORDE
       sigue en 0.5) y la tira se quedaba apagada aunque el recorte ya
       existiera. El estado del recorte tiene que estar en la comparacion. */
    const sel = seleccionActual();
    const firma = [sel.length, sel.map(it => it && it._id).join(","),
        SPECS.map(s => leerCfg(s)).join("|"), hayRecorte() ? "recorte" : "sin"].join("#");
    // Con el grupo todavia sin montar la firma vieja no vale: la cinta se arma
    // despues que este modulo y hay que colgarlo igual.
    const montado = !!document.querySelector(
        `#ekkoCascadeTools .ekko-ribbon-group[data-group="${GRUPO_CINTA}"]`);
    if (montado && firma === ultimo) return;
    ultimo = firma;
    refrescar();
}

let iniciado = false;

export function initRecorteEnCinta() {
    if (iniciado) return;
    if (!SPECS.length) {
        console.warn("[EKKO RECORTE] PARAM_SPECS.removeBg no tiene parametros; nada que montar.");
        return;
    }
    iniciado = true;
    estilos();
    tiraBarra();
    montarCuandoExista();

    /* Señales: las MISMAS que ya usa la cascada. cascadeToolbar envuelve
       refreshEKKORibbon / refreshAllToolbars / etc. y escucha
       "ekko:seleccion-cambio"; se encadena despues de el (los wrappers quedan
       armados en su init, y aca se envuelve lo ya envuelto) para no pelear con
       nadie: se llama SIEMPRE al previo. */
    ["refreshEKKORibbon", "refreshEKKOSharedCommands", "refreshAllToolbars",
        "refreshSharedCommands"].forEach(nombre => {
        const previo = window[nombre];
        if (typeof previo !== "function") return;
        window[nombre] = function () {
            const r = previo.apply(this, arguments);
            setTimeout(tick, 0);
            return r;
        };
    });
    document.addEventListener("ekko:seleccion-cambio", () => setTimeout(tick, 0));
    window.addEventListener("resize", () => setTimeout(tick, 0));

    /* La tira cambia de host (cinta <-> barra) cuando el motor remueve los
       grupos, y al terminar una Quitar Fondo lote el recorte aparece sin que
       nadie avise. El interval es la red que cubre los dos casos —y a la
       ventana de Editar Fondo, que escribe la config sin tocar el DOM de la
       cinta—; los observadores bajan la latencia a ~60ms cuando se puede. */
    const barra = document.getElementById("contextual-toolbar");
    vigilar(barra, { childList: true, attributes: true, attributeFilter: ["data-ekko-especie"] });

    setInterval(tick, 700);
    console.log("%c[EKKO RECORTE] Borde / Suavizar / Halo en el nivel 2 y en la barra emergente.", "color:#0891b2;font-weight:bold;");
}

/* El nodo de la cinta no existe cuando arrancan los modulos: lo monta
   cascadeToolbar.js DESPUES, por import dinamico desde
   panelCoordinator.js:690. Se espera su aparicion una sola vez, con la misma
   red que usa vigilarNivel2() con #ekkoParamSurface. */
function montarCuandoExista() {
    if (grupoRecorte()) { refrescar(); return; }
    const obs = new MutationObserver(() => {
        if (!grupoRecorte()) return;
        obs.disconnect();
        refrescar();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Y se vigila la cinta ya montada: si el motor reordena los grupos, la
    // tira tiene que volver a quedarse pegada despues de "Imagen".
    vigilar(document.getElementById("ekkoCascadeTools"), { childList: true, subtree: true });
}

function vigilar(nodo, opts) {
    if (!nodo || !nodo.isConnected) return;
    new MutationObserver(() => setTimeout(tick, 60)).observe(nodo, opts);
}

if (typeof window !== "undefined") {
    window.EKKO_RECORTE_CINTA = {
        refrescar,
        estaVisible: () => hayRecorte(),
        // Para la sonda: el estado que ven los controles, no un recuerdo.
        valores: () => SPECS.reduce((a, s) => (a[s.id] = Math.round(leerCfg(s) * 100), a), {})
    };
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRecorteEnCinta, { once: true });
} else {
    initRecorteEnCinta();
}
