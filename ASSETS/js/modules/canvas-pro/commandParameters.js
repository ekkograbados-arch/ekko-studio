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

    // 1) Arrastre: se pinta al instante, se aplica al soltar. Asi el control
    //    responde al dedo sin congelar el lienzo.
    rango.addEventListener("input", () => pintar(Number(rango.value)));
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

function pintar(comando) {
    const spec = PARAM_SPECS[comando];
    if (!spec) return;

    const cont = asegurarSuperficie();
    if (!cont) return;
    const barra = el("contextual-toolbar");

    cont.innerHTML = "";
    cont.dataset.comando = comando;

    const titulo = document.createElement("span");
    titulo.className = "ekko-param-title";
    titulo.textContent = spec.etiqueta;
    cont.appendChild(titulo);

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

    // La tira es HERMANA de la barra, no hija (la barra es flex y la anadiria
    // al grupo de botones). Por eso top:100% no serviria: se resolveria contra
    // el contenedor equivocado. Se coloca con el rect real de la barra.
    const r = barra.getBoundingClientRect();
    cont.style.left = `${Math.round(r.left)}px`;
    cont.style.top = `${Math.round(r.bottom)}px`;
    cont.style.width = `${Math.round(r.width)}px`;
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
    comandoAbierto = comando;
    pintar(comando);
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
