/* =========================================================================
   EKKO STUDIO — NIVEL 2: PARAMETROS POR COMANDO

   El panel tiene dos niveles:
     1. QUE herramientas se despliegan  -> capabilities.js + panelCoordinator.js
     2. QUE parametros se pueden cambiar -> este archivo

   Como se comporta un boton principal:
     - Herramienta SIN parametros: el clic ejecuta y ya. "Eliminar" no tiene
       nada que configurar.
     - Herramienta CON parametros: el clic ejecuta con el valor actual Y
       despliega la tira de parametros, para que el cliente vea y ajuste lo
       que se acaba de aplicar. Si solo quiere el valor por defecto, le basta
       un clic y nunca tiene que abrir la tira.

   Cada control tiene TRES formas de ajustarse, como en cualquier editor
   profesional: arrastre, escritura directa y rueda del raton.

   Este archivo NO reimplementa ninguna accion: solo dibuja los controles y
   llama al callback que declare el registro PARAM_SPECS.
   ========================================================================= */

/**
 * Registro de parametros por herramienta.
 *   aplicar(valor)  -> se llama al soltar / confirmar / rueda
 *   claveCfg(id)    -> nombre de la propiedad real en BackgroundRemover.config
 */
export const PARAM_SPECS = Object.freeze({
    removeBg: {
        etiqueta: "Quitar Fondo",
        parametros: [
            {
                id: "borde",
                etiqueta: "Borde",
                ayuda: "Cuanto se conserva del sujeto. Sube para no comerte el pelo fino; baja para un recorte mas cerrado.",
                tipo: "range", min: 0, max: 100, paso: 1,
                claveCfg: "BORDE",
                disponible: () => !!(window.EKKO && window.EKKO.BackgroundRemover)
            },
            {
                id: "suavizado",
                etiqueta: "Suavizar",
                ayuda: "Difumina la transicion del recorte. Poco = borde nitido; mucho = borde fino y natural.",
                tipo: "range", min: 0, max: 100, paso: 1,
                claveCfg: "SUAVIZADO",
                disponible: () => !!(window.EKKO && window.EKKO.BackgroundRemover)
            }
        ],
        acciones: [
            {
                id: "deshacer", etiqueta: "Restaurar original",
                ejecutar: () => window.EKKO?.BackgroundRemover?.deshacer()
            }
        ],
        alAplicar: (clave, valor) => window.EKKO?.BackgroundRemover?.ajustarBorde(clave, valor / 100)
    }
});

const ID_SUPERFICIE = "ekkoParamSurface";
let superficie = null;
let comandoAbierto = null;

function el(id) { return document.getElementById(id); }

function asegurarSuperficie() {
    if (superficie && superficie.isConnected) return superficie;
    const barra = el("contextual-toolbar");
    if (!barra) return null;

    superficie = document.createElement("div");
    superficie.id = ID_SUPERFICIE;
    superficie.className = "ekko-param-surface";
    superficie.setAttribute("role", "group");
    superficie.style.display = "none";
    barra.insertAdjacentElement("afterend", superficie);
    return superficie;
}

/* ------------------------------------------------------------------
   Aplicacion coalescente.

   Recomponer el recorte son millones de pixeles. Si se llamara en cada
   `input` del raton la interfaz se congelaria y el control pareceria
   muerto: eso es exactamente lo que pasaba antes. Se aplica UNA vez por
   animacion, al soltar, al confirmar el numero y al parar la rueda.
   ------------------------------------------------------------------ */
function crearAplicador(spec, comando) {
    let pendiente = null;

    // El valor vive AQUI, dentro del aplicador. Antes apply() leia una
    // variable que solo existia en otro ambito: lanzaba ReferenceError y el
    // catch lo silenciaba, de modo que mover el control no hacia NADA y
    // parecia un boton muerto.
    let valor = 0;

    const aplicar = () => {
        pendiente = null;
        try { PARAM_SPECS[comando]?.alAplicar?.(spec.id, valor); }
        catch (e) {
            // Se avisa en rojo: un fallo aqui significa que el control va a
            // parecer muerto, y no puede volver a esconderse en silencio.
            console.error("[EKKO] no se pudo aplicar el parametro", spec.id, e);
        }
    };

    const pedir = () => {
        if (pendiente) return;
        pendiente = requestAnimationFrame(aplicar);
    };

    return {
        pedir,
        aplicarAhora: aplicar,
        setValor: v => { valor = v; },
        obtener: () => valor
    };
}

function crearParametro(spec, comando) {
    const envoltorio = document.createElement("label");
    envoltorio.className = "ekko-param";

    const texto = document.createElement("span");
    texto.className = "ekko-param-label";
    texto.textContent = spec.etiqueta;

    const valor = document.createElement("span");
    valor.className = "ekko-param-value";

    // --- Campo numerico editable: el cliente escribe el valor directo ---
    const numero = document.createElement("input");
    numero.type = "number";
    numero.className = "ekko-param-number";
    numero.min = String(spec.min);
    numero.max = String(spec.max);
    numero.step = String(spec.paso);

    const rango = document.createElement("input");
    rango.type = "range";
    rango.min = String(spec.min);
    rango.max = String(spec.max);
    rango.step = String(spec.paso);
    rango.className = "ekko-param-input";
    rango.title = spec.ayuda || spec.etiqueta;
    numero.title = spec.ayuda || spec.etiqueta;

    // El estado real del control manda sobre el declarado: si el motor ya
    // toco CFG, la barra no puede mostrar un numero inventado.
    const cfg = window.EKKO?.BackgroundRemover?.config?.[spec.claveCfg];
    const fraccion = typeof cfg === "number" ? cfg : 0.5;
    const valorActual = Math.round(Math.max(spec.min, Math.min(spec.max, fraccion * 100)));

    const aplicador = crearAplicador(spec, comando);

    // pintar NO guarda el valor: se lo pasa al aplicador. Asi el control y el
    // motor nunca pueden discrepar.
    const pintar = v => {
        const n = Math.max(spec.min, Math.min(spec.max, Math.round(v)));
        rango.value = String(n);
        numero.value = String(n);
        valor.textContent = n + "%";
        aplicador.setValor(n);
        return n;
    };

    pintar(valorActual);

    // 1) Arrastre: se aplica EN VIVO. Antes solo se aplicaba al soltar, y con un
    //    raton el evento `change` llega tarde o no llega: el cliente arrastraba
    //    y no veia nada hasta que soltaba, en un canvas que puede
    //    tardar en recomponerse. Ahora cada movimiento recompone (una sola vez
    //    por fotograma) y el recorte se ve seguir al dedo.
    rango.addEventListener("input", () => { pintar(Number(rango.value)); aplicador.pedir(); });
    rango.addEventListener("change", () => { pintar(Number(rango.value)); aplicador.aplicarAhora(); });

    // 2) Teclado: escribir el numero y confirmar.
    numero.addEventListener("input", () => {
        const v = Number(numero.value);
        if (!Number.isFinite(v)) return;
        pintar(v);
    });
    const confirmar = () => { pintar(Number(numero.value)); aplicador.aplicarAhora(); };
    numero.addEventListener("change", confirmar);
    numero.addEventListener("blur", confirmar);
    numero.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { confirmar(); numero.blur(); ev.preventDefault(); }
    });

    // 3) Rueda del raton. preventDefault para que la pagina no scrollee.
    const rueda = (delta) => {
        const paso = Math.max(1, Number(spec.paso) || 1) * (Math.abs(delta) >= 100 ? 5 : 1);
        pintar(aplicador.obtener() + (delta > 0 ? -paso : paso));
        aplicador.pedir();
        // Retraso corto: si deja de girar, se aplica igual.
        clearTimeout(rango.__ruedaT);
        rango.__ruedaT = setTimeout(() => aplicador.aplicarAhora(), 220);
    };
    [rango, numero].forEach(ctrl => {
        ctrl.addEventListener("wheel", (ev) => { ev.preventDefault(); rueda(ev.deltaY); }, { passive: false });
    });

    envoltorio.append(texto, rango, numero, valor);
    envoltorio.appendChild(document.createTextNode('%'));
    return envoltorio;
}

const LLAVE_POSICION = "ekko.params.pos";

/** Remember donde el cliente dejo el panel, para no repositionarlo cada vez. */
function colocar(cont, forzarCentro) {
    const ancho = cont.offsetWidth || 420;
    const alto = cont.offsetHeight || 64;
    let x = null, y = null;

    if (!forzarCentro) {
        try {
            const g = JSON.parse(localStorage.getItem(LLAVE_POSICION) || 'null');
            if (g && typeof g.x === 'number' && typeof g.y === 'number') { x = g.x; y = g.y; }
        } catch (_) {}
    }

    if (x === null || forzarCentro) {
        // Por defecto: centrado en el lienzo, por DEBAJO de la barra
        // emergente pero con holgura propia, para que se lea como un panel
        // aparte y no como una prolongacion de la barra.
        const barra = el("contextual-toolbar");
        const r = barra ? barra.getBoundingClientRect() : null;
        x = r ? r.left + r.width / 2 - ancho / 2 : (window.innerWidth - ancho) / 2;
        y = r ? r.bottom + 26 : Math.max(90, (window.innerHeight - alto) / 2);
    }

    // Se mantiene siempre dentro de la ventana visible.
    x = Math.max(8, Math.min(window.innerWidth - ancho - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - alto - 8, y));
    cont.style.left = Math.round(x) + "px";
    cont.style.top = Math.round(y) + "px";
}

function hacerArrastrable(cont) {
    const asa = cont.querySelector('.ekko-param-asa');
    if (!asa) return;

    let dx = 0, dy = 0, moviendo = false;

    const inicio = (ev) => {
        if (ev.target.closest('input, button, select, textarea')) return;
        const r = cont.getBoundingClientRect();
        const p = ev.touches ? ev.touches[0] : ev;
        dx = p.clientX - r.left;
        dy = p.clientY - r.top;
        moviendo = true;
        cont.classList.add('is-arrastrando');
        ev.preventDefault();
    };
    const mover = (ev) => {
        if (!moviendo) return;
        const p = ev.touches ? ev.touches[0] : ev;
        const x = p.clientX - dx, y = p.clientY - dy;
        const ancho = cont.offsetWidth, alto = cont.offsetHeight;
        cont.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - ancho - 8, x))) + 'px';
        cont.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - alto - 8, y))) + 'px';
        ev.preventDefault();
    };
    const fin = () => {
        if (!moviendo) return;
        moviendo = false;
        cont.classList.remove('is-arrastrando');
        try {
            localStorage.setItem(LLAVE_POSICION, JSON.stringify({
                x: parseFloat(cont.style.left) || 0,
                y: parseFloat(cont.style.top) || 0
            }));
        } catch (_) {}
    };

    asa.addEventListener('pointerdown', inicio);
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
}

function pintar(comando, recentrar) {
    const spec = PARAM_SPECS[comando];
    if (!spec) return;

    const cont = asegurarSuperficie();
    if (!cont) return;

    cont.innerHTML = "";
    cont.dataset.comando = comando;
    cont.classList.remove('is-pegada');

    // Asa: separa visualmente el panel de la barra, lo hace arrastrable y dice
    // QUE se esta ajustando, para que no se confunda con una toolbar mas.
    const asa = document.createElement("div");
    asa.className = "ekko-param-asa";
    asa.innerHTML = '<span aria-hidden="true">⠿</span><span>' + spec.etiqueta + '</span>';
    cont.appendChild(asa);

    (spec.parametros || []).forEach(p => {
        if (p.disponible && !p.disponible()) return;
        cont.appendChild(crearParametro(p, comando));
    });

    (spec.acciones || []).forEach(a => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ekko-param-action";
        b.textContent = a.etiqueta;
        b.addEventListener("click", () => {
            try { a.ejecutar(); } catch (e) { console.warn("[EKKO] accion", a.id, e); }
        });
        cont.appendChild(b);
    });

    const cerrar = document.createElement("button");
    cerrar.type = "button";
    cerrar.className = "ekko-param-close";
    cerrar.title = "Cerrar";
    cerrar.setAttribute("aria-label", "Cerrar parametros");
    cerrar.textContent = "×";
    cerrar.addEventListener("click", () => cerrarParametros());
    cont.appendChild(cerrar);

    cont.style.display = "flex";

    // Se mide primero con el panel ya en pantalla y luego se coloca: hace
    // falta conocer su ancho real para centrarlo o clamp-earlo.
    colocar(cont, !!recentrar);
    hacerArrastrable(cont);
}

export function cerrarParametros() {
    if (!superficie) return;
    superficie.style.display = "none";
    superficie.innerHTML = "";
    delete superficie.dataset.comando;
    comandoAbierto = null;
}

export function alternarParametros(comando) {
    if (comandoAbierto === comando) { cerrarParametros(); return; }
    // Si se cambia de comando, el panel se recentra: sus controles cambian de
    // ancho y dejarlo en la posicion anterior lo dejaba descuadrado.
    const cambiar = comandoAbierto !== null;
    comandoAbierto = comando;
    pintar(comando, cambiar);
}

/**
 * Se engancha en fase de captura y NO detiene el evento: el clic sigue
 * llegando al onclick o al data-ekko-command de siempre, asi que el comando
 * se ejecuta exactamente igual que antes de existir este archivo. Aqui solo
 * se anade el desplegable.
 */
export function initParametros() {
    document.addEventListener("click", (ev) => {
        const boton = ev.target.closest && ev.target.closest("[data-fusion-btn]");
        if (!boton) return;
        const comando = boton.dataset.fusionBtn;
        if (!PARAM_SPECS[comando]) return;
        setTimeout(() => alternarParametros(comando), 0);
    }, true);

    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && comandoAbierto) cerrarParametros();
    });

    // Si la ventana cambia de tamano, el panel se mantiene dentro: sin esto
    // se quedaria colgando fuera de la pantalla al rotar una tablet.
    window.addEventListener("resize", () => {
        if (superficie && superficie.style.display !== "none") colocar(superficie, false);
    });

    Object.keys(PARAM_SPECS).forEach(comando => {
        document.querySelectorAll(`[data-fusion-btn="${comando}"]`)
            .forEach(b => b.setAttribute("data-ekko-has-params", comando));
    });

    console.log("%c[EKKO PARAMS] Parametros por comando inicializados.", "color:#2563eb;font-weight:bold;");
}

if (typeof window !== "undefined") {
    window.EKKO_PARAMETROS = { PARAM_SPECS, abrir: alternarParametros, cerrar: cerrarParametros };
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initParametros, { once: true });
} else {
    initParametros();
}
