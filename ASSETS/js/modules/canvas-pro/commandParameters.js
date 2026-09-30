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

   Este archivo NO reimplementa ninguna accion: solo dibuja los controles y
   llama al callback que le declare el registro PARAM_SPECS.
   ========================================================================= */

/**
 * Registro de parametros por herramienta.
 * Cada parametro: { id, etiqueta, tipo, min, max, paso, valor, aplicar }
 *   aplicar(valor) -> void, se llama en cada cambio.
 * Cada comando puede declarar ademas `acciones`: botones de una sola vez
 * (Restaurar original, Deshacer...) que no son un valor continuo.
 */
export const PARAM_SPECS = Object.freeze({
    removeBg: {
        etiqueta: "Quitar Fondo",
        parametros: [
            {
                id: "contraste",
                etiqueta: "Borde",
                ayuda: "Cuanto se conserva del contorno del sujeto. Sube para no comerte pelo fino.",
                tipo: "range", min: 0, max: 30, paso: 1, valor: 6, formato: v => v + "%",
                disponible: () => !!(window.EKKO && window.EKKO.BackgroundRemover)
            },
            {
                id: "suavizado",
                etiqueta: "Suavizar",
                ayuda: "Difumina la transicion del recorte para quitar el halo.",
                tipo: "range", min: 0, max: 100, paso: 1, valor: 35, formato: v => v + "%",
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

    // Se inserta justo despues de la barra para que quede pegada a ella.
    barra.insertAdjacentElement("afterend", superficie);
    return superficie;
}

function crearParametro(spec, comando) {
    const envoltorio = document.createElement("label");
    envoltorio.className = "ekko-param";

    const texto = document.createElement("span");
    texto.className = "ekko-param-label";
    texto.textContent = spec.etiqueta;

    const valor = document.createElement("span");
    valor.className = "ekko-param-value";

    const entrada = document.createElement("input");
    entrada.type = "range";
    entrada.min = String(spec.min);
    entrada.max = String(spec.max);
    entrada.step = String(spec.paso);
    entrada.className = "ekko-param-input";
    entrada.title = spec.ayuda || spec.etiqueta;

    // Los controles de EKKO van en porcentaje. La configuracion interna usa
    // fracciones (0..1), asi que el valor real manda sobre el declarado: si
    // otro modulo ya toco CFG, la barra no puede mostrar un numero inventado.
    const cfg = window.EKKO?.BackgroundRemover?.config?.[claveCfg(spec.id)];
    const fraccion = typeof cfg === "number" ? cfg : Number(spec.valor) / 100;
    const inicial = Math.round(Math.max(spec.min, Math.min(spec.max, fraccion * 100)));
    entrada.value = String(inicial);
    valor.textContent = (spec.formato || String)(inicial);

    entrada.addEventListener("input", () => {
        valor.textContent = (spec.formato || String)(entrada.value);
        try { PARAM_SPECS[comando]?.alAplicar?.(spec.id, Number(entrada.value)); }
        catch (e) { console.warn("[EKKO] parametro", spec.id, e); }
    });

    envoltorio.append(texto, entrada, valor);
    return envoltorio;
}

function claveCfg(idParam) {
    return idParam === "contraste" ? "BORDE_CONTRASTE" : "BORDE_SUAVIZADO";
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
        // Se aplaza para que la ejecucion del comando ya haya empezado.
        setTimeout(() => alternarParametros(comando), 0);
    }, true);

    // El teclado tambien debe cerrarlo.
    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && comandoAbierto) cerrarParametros();
    });

    // Marca las dos superficies (panel y barra) con la flechita de "hay mas".
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
