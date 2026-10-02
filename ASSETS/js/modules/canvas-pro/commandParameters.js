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
            },
            {
                id: "matting",
                etiqueta: "Pelo",
                ayuda: "Recupera el pelo fino y los bordes suaves usando la foto original. Subelo si el recorte se ve comido.",
                tipo: "range", min: 0, max: 100, paso: 1,
                claveCfg: "MATTING",
                disponible: () => !!(window.EKKO && window.EKKO.BackgroundRemover)
            }
        ],
        acciones: [
            {
                id: "deshacer", etiqueta: "Restaurar original",
                ejecutar: () => window.EKKO?.BackgroundRemover?.deshacer()
            }
        ],
        alAplicar: (clave, valor) => {
            const api = window.EKKO?.BackgroundRemover;
            if (!api) return;
            // 'matting' no es un ajuste de borde sino del paso de matteado por
            // color, asi que va por su propia clave en la configuracion.
            if (clave === 'matting') {
                api.config.MATTING = Math.max(0, Math.min(1, valor / 100));
                api.ajustarBorde('recomponer', 0);
                return;
            }
            api.ajustarBorde(clave, valor / 100);
        }
    },

    /* ------------------------------------------------------------------
       CONTORNO = una linea sobre el BORDE EXTERIOR de la pieza, y nada de
       lo de adentro. Un clic y ya esta aplicada; este panel es solo para
       ajustarla despues. Trazar es OTRA herramienta y no comparte nada con
       esta.

       La clave es `outline` porque es lo que dice el atributo
       data-fusion-btn del boton: el panel se busca por ahi, no por el
       nombre del comando. Con `contorno` el panel nunca encontraba nada.

       Los `domId` no son cosmeticos: contorno.js lee estos ids con
       getElementById para construir la linea. Por eso el control no puede
       desincronizarse del motor.
       ------------------------------------------------------------------ */
    outline: {
        etiqueta: "Contorno",
        parametros: [
            {
                id: "grosor", grupo: "Valores", etiqueta: "Grosor de línea",
                ayuda: "Grosor de la línea del borde. Con 1 sale una línea delgada, como en AutoCAD.",
                tipo: "range", min: 1, max: 40, paso: 1,
                sufijo: "px", domId: "ctxOutlineWidth",
                valorActual: 1,
                disponible: () => typeof window.aplicarContorno === "function"
            },
            {
                id: "radio", grupo: "Valores", etiqueta: "Radio",
                ayuda: "Redondea las esquinas. Sube para un borde más suave, baja para conservar el dibujo original.",
                tipo: "range", min: 0, max: 60, paso: 1,
                sufijo: "px", domId: "ctxOutlineRadius",
                valorActual: 0,
                disponible: () => typeof window.aplicarContorno === "function"
            },
            {
                id: "suavidad", grupo: "Valores", etiqueta: "Suavidad",
                ayuda: "Suaviza los dientes que deja el calco sobre la imagen. Más suave, contorno más limpio.",
                tipo: "range", min: 0, max: 10, paso: 1,
                sufijo: "", domId: "ctxOutlineSmoothing",
                valorActual: 0,
                disponible: () => typeof window.aplicarContorno === "function"
            },
            {
                id: "posicion", grupo: "Posición", etiqueta: "",
                ayuda: "De qué lado del borde va la línea.",
                tipo: "segmentos", domId: "ctxOutlineSide",
                valorActual: "center",
                opciones: [
                    { valor: "center", etiqueta: "Centro", ayuda: "La línea se apoya justo sobre el borde." },
                    { valor: "outside", etiqueta: "Exterior", ayuda: "La línea sale para afuera del objeto." },
                    { valor: "inside", etiqueta: "Interior", ayuda: "La línea entra hacia adentro del objeto." }
                ],
                disponible: () => typeof window.aplicarContorno === "function"
            }
        ],
        acciones: [
            { id: "rehacer", etiqueta: "Volver a aplicar", ejecutar: () => window.aplicarContorno?.() }
        ],
        // Cada cambio rehace el contorno con el valor nuevo. El motor se
        // encarga de no crear uno duplicado: si ya existe, lo rehace.
        alAplicar: () => window.EKKO?.contornoVivo?.()
    },

    /* ------------------------------------------------------------------
       TRAZAR = calcar el objeto ENTERO: borde por fuera y detalle por
       adentro, con lineas y siluetas cerradas. Es OTRA herramienta, no
       Contorno: Contorno solo dibuja la linea del borde exterior.
       Por eso aca NO hay grosor, ni posicion, ni "solo exterior": todo
       eso es Contorno y vive en su propio panel.

       Un clic previsualiza el calco en magenta; "Aplicar trazado" lo
       entrega como vector. Cada control rehace la vista en vivo.
       ------------------------------------------------------------------ */
    traceImage: {
        etiqueta: "Trazar",
        parametros: [
            {
                id: "lineas", grupo: "Trazado", etiqueta: "Cantidad de líneas",
                ayuda: "Cuántas bandas de gris se calcan. Con 1 sale el dibujo base; sube para traer sombras, pelos y medios tonos.",
                tipo: "range", min: 1, max: 6, paso: 1,
                sufijo: "", domId: "traceLineas",
                valorActual: 1,
                disponible: () => typeof window.traceRaster === "function"
            },
            {
                id: "detalle", grupo: "Trazado", etiqueta: "Detalle",
                ayuda: "Hasta qué gris se calca. Sube para traer más dibujo interno; baja para quedarte con lo esencial.",
                tipo: "range", min: 0, max: 255, paso: 1,
                sufijo: "", domId: "traceUmbral",
                valorActual: 128,
                disponible: () => typeof window.traceRaster === "function"
            },
            {
                id: "suavidad", grupo: "Trazado", etiqueta: "Suavidad",
                ayuda: "Limpia los dientes del calco. Más suave, líneas más limpias; menos suave, más fiel al píxel.",
                tipo: "range", min: 0, max: 100, paso: 1,
                sufijo: "", domId: "traceSuavidad",
                valorActual: 75,
                disponible: () => typeof window.traceRaster === "function"
            },
            {
                id: "modo", grupo: "Modo", etiqueta: "",
                ayuda: "Foto calca por niveles de gris; Croquis es para firmas o manuscritos con luz dispareja.",
                tipo: "segmentos", domId: "traceModo",
                valorActual: "foto",
                opciones: [
                    { valor: "foto", etiqueta: "Foto", ayuda: "Calca por niveles de gris. Para fotos e imágenes normales." },
                    { valor: "croquis", etiqueta: "Croquis", ayuda: "Umbral adaptativo local. Para firmas o manuscritos en papel." }
                ],
                disponible: () => typeof window.traceRaster === "function"
            }
        ],
        acciones: [
            { id: "aplicar", etiqueta: "Aplicar trazado", ejecutar: () => window.EKKO?.confirmarTrazo?.() },
            { id: "descartar", etiqueta: "Descartar", ejecutar: () => window.EKKO?.cancelarTrazo?.() }
        ],
        // Cada cambio rehace la vista previa con los valores nuevos.
        alAplicar: () => window.EKKO?.trazoVivo?.()
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

/* ------------------------------------------------------------------
   Botones segmentados (Centro / Exterior / Interior).

   No es un desplegable: se ven las tres opciones y se aprieta la que se
   quiere, como los grupos de la cinta de Word. Menos clics y sin adivinar
   que hay algo escondido.

   La rueda tambien los recorre: es la misma idea que en los deslizadores,
   el cliente no necesita cobrar la otra mano para cambiar el valor.
   ------------------------------------------------------------------ */
function crearSegmentos(spec, comando) {
    const envoltorio = document.createElement("span");
    envoltorio.className = "ekko-param";

    const opciones = Array.isArray(spec.opciones) ? spec.opciones : [];
    if (!opciones.length) return envoltorio;

    const grupo = document.createElement("div");
    grupo.className = "ekko-seg";

    // El motor lee la eleccion con document.getElementById(domId).value, que
    // es lo que hacen los <select>. Un <div> no tiene .value, asi que el boton
    // se pintaba pero el motor seguia viendo "center". Este input oculto es el
    // que el motor lee; los botones solo lo actualizan. Por eso la eleccion se
    // ve Y se aplica, sin que el motor sepa que hay botones.
    let puente = null;
    if (spec.domId) {
        puente = document.createElement("input");
        puente.type = "hidden";
        puente.id = spec.domId;
        grupo.appendChild(puente);
    }
    // El valor REAL manda: si el motor ya tiene algo aplicado, el control se
    // muestra en ese valor y no en uno inventado.
    const inicial = String(spec.valorActual ?? opciones[0].valor ?? "");
    let valor = inicial;

    const botones = opciones.map((op) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ekko-seg-btn";
        b.textContent = op.etiqueta;
        if (op.ayuda) b.title = op.ayuda;
        b.dataset.valor = String(op.valor);
        b.addEventListener("click", () => { fijar(String(op.valor)); aplicador.aplicarAhora(); });
        grupo.appendChild(b);
        return b;
    });

    const fijar = (v) => {
        valor = v;
        if (puente) puente.value = v;
        botones.forEach((b) => b.classList.toggle("is-activo", b.dataset.valor === v));
    };

    const aplicador = crearAplicador(spec, comando);
    fijar(inicial);
    // El motor tambien necesita saber cual quedo elegido.
    aplicador.setValor(valor);

    grupo.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const i = opciones.findIndex((o) => String(o.valor) === valor);
        const paso = ev.deltaY > 0 ? 1 : -1;
        const siguiente = opciones[(i + paso + opciones.length) % opciones.length];
        fijar(String(siguiente.valor));
        aplicador.pedir();
        clearTimeout(grupo.__ruedaT);
        grupo.__ruedaT = setTimeout(() => aplicador.aplicarAhora(), 220);
    }, { passive: false });

    envoltorio.appendChild(grupo);
    return envoltorio;
}

function crearParametro(spec, comando) {
    if (spec.tipo === "segmentos") return crearSegmentos(spec, comando);

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

    // domId es el puente con el motor: contorno.js busca estos ids con
    // getElementById, asi el control y el motor no pueden separarse nunca.
    if (spec.domId) {
        rango.id = spec.domId;
        numero.id = spec.domId + "Num";
    }
    // Las unidades: un borde de fondo va en porcentaje; un grosor de linea no.
    // Sin esto se veria "12%" en algo que no es un porcentaje.
    const sufijo = spec.sufijo !== undefined ? spec.sufijo : "%";

    // El estado real del control manda sobre el declarado: si el motor ya
    // toco CFG, la barra no puede mostrar un numero inventado.
    const cfg = spec.leerCfg
        ? spec.leerCfg()
        : window.EKKO?.BackgroundRemover?.config?.[spec.claveCfg];
    const fraccion = typeof cfg === "number" ? cfg : 0.5;
    const valorActual = spec.valorActual !== undefined
        ? spec.valorActual
        : Math.round(Math.max(spec.min, Math.min(spec.max, fraccion * 100)));

    const aplicador = crearAplicador(spec, comando);

    // pintar NO guarda el valor: se lo pasa al aplicador. Asi el control y el
    // motor nunca pueden discrepar.
    const pintar = v => {
        const n = Math.max(spec.min, Math.min(spec.max, Math.round(v)));
        rango.value = String(n);
        numero.value = String(n);
        valor.textContent = n + (sufijo ? " " + sufijo : "");
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
    if (sufijo) envoltorio.appendChild(document.createTextNode(sufijo));
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

    // --- Grupos ---------------------------------------------------------
    // Si el comando declara grupos, los controles se reparten en columnas
    // separadas por una linea, como los grupos de la cinta de Word: los
    // valores que se ajustan a la izquierda, los botones a la derecha.
    // Si NO declara grupos se dibuja todo en fila, como antes: un comando
    // que no pide grupos no cambia de aspecto.
    const visibles = (spec.parametros || []).filter(p => !p.disponible || p.disponible());
    const conGrupos = visibles.some(p => p.grupo);

    if (conGrupos) {
        const orden = [];
        const porNombre = new Map();
        visibles.forEach(p => {
            const nombre = p.grupo || "";
            if (!porNombre.has(nombre)) {
                const g = { nombre, controles: [] };
                porNombre.set(nombre, g);
                orden.push(g);
            }
            porNombre.get(nombre).controles.push(p);
        });

        orden.forEach(g => {
            const caja = document.createElement("div");
            caja.className = "ekko-param-grupo";
            if (g.nombre) {
                const titulo = document.createElement("div");
                titulo.className = "ekko-param-grupo-titulo";
                titulo.textContent = g.nombre;
                caja.appendChild(titulo);
            }
            const fila = document.createElement("div");
            fila.className = "ekko-param-fila";
            g.controles.forEach(p => fila.appendChild(crearParametro(p, comando)));
            caja.appendChild(fila);
            cont.appendChild(caja);
        });
    } else {
        visibles.forEach(p => cont.appendChild(crearParametro(p, comando)));
    }

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
