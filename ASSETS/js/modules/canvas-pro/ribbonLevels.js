/* =========================================================================
   EKKO STUDIO — NIVELES DE LA BARRA (ronda 14)

   Agrega dos niveles al panel superior, sin tocar el motor de la cinta:

   NIVEL "MÁS USADAS"  fila propia (por defecto abajo de todo). El CONJUNTO lo
                       eligen los usos: las N herramientas con más clicks.
                       El ORDEN horizontal lo pone la recencia: la última usada
                       queda primera y el resto corre a la derecha.
                       Los chips son accesos directos: no llevan
                       data-fusion-btn ni data-ekko-command, así que ni el
                       renderer ni panelCommandBridge los tocan.

   NIVEL "FIJA"        la banda #pro-layout-toolbar existente, re-estilada al
                       formato de Word: iconos en fila y el nombre del grupo
                       debajo. Se pliega a una línea. No duplica botones: los
                       mismos botones de la banda se reacomodan.

   Uso: este módulo solo LEE el DOM de la cinta y ejecuta los botones reales
   con click(). Nunca decide habilitado/bloqueado: eso sigue siendo de
   capabilities.js y ribbonRenderer.js.
   ========================================================================= */

const LS_USO = "ekko.niveles.uso.v1";
const LS_CFG = "ekko.niveles.cfg.v1";
const CACHE_USO_VIEJO = "ekko.cascade.recientes.v1";

const CFG_DEF = Object.freeze({
    n: 6,              // 5..9
    orden: "hibrido",  // hibrido | uso | reciente
    usadasArriba: false,
    fijaWord: true,
    fijaPlegada: false,
    usadasPlegada: false
});

let cfg = { ...CFG_DEF };
let uso = {};      // key -> { c: clicks, ts: ultimo uso }
let row = null;    // #ekkoNivelUsadas
let editor = null;

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */
function leer(k, def) {
    try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : def;
    } catch (_) { return def; }
}
function guardar(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
}
function cargarCfg() {
    const guardado = leer(LS_CFG, null);
    cfg = { ...CFG_DEF, ...(guardado && typeof guardado === "object" ? guardado : {}) };
    cfg.n = Math.min(9, Math.max(5, +cfg.n || CFG_DEF.n));
    if (!["hibrido", "uso", "reciente"].includes(cfg.orden)) cfg.orden = CFG_DEF.orden;
}
function cargarUso() {
    const propias = leer(LS_USO, null);
    uso = (propias && typeof propias === "object") ? propias : sembrarDesdeRecientes();
    // Claves viejas de la banda ("pro:…") se funden con su herramienta de cinta.
    const limpio = {};
    Object.keys(uso).forEach(k => {
        const nk = normalizar(k);
        const e = uso[k] || {};
        const previo = limpio[nk];
        const c = +e.c || 0;
        const ts = +e.ts || 0;
        if (!previo) limpio[nk] = { c, ts };
        else { previo.c += c; previo.ts = Math.max(previo.ts, ts); }
    });
    uso = limpio;
    guardar(LS_USO, uso);
}
/* Primera vez: hereda lo que ya registró la cinta vieja (por contexto) para
   que el nivel no arranque vacío en una instalación con historial. */
function sembrarDesdeRecientes() {
    const semilla = {};
    const datos = leer(CACHE_USO_VIEJO, null);
    if (datos && typeof datos === "object") {
        Object.values(datos).forEach(lista => {
            if (!Array.isArray(lista)) return;
            lista.forEach(e => {
                if (!e || !e.c) return;
                const k = "fb:" + e.c;
                const previo = semilla[k];
                const c = +e.count || 1;
                const ts = +e.ts || 0;
                if (!previo) semilla[k] = { c, ts };
                else { previo.c += c; previo.ts = Math.max(previo.ts, ts); }
            });
        });
    }
    return semilla;
}

/* ------------------------------------------------------------------ */
/* Registro de uso                                                     */
/* ------------------------------------------------------------------ */
/* Cinta y banda fija repiten la misma herramienta con otro nombre. Para el
   nivel "Más usadas" es UNA sola: se cuentan bajo la clave de la cinta. */
const ALIAS = Object.freeze({
    "pro:proBtnGroup": "fb:group",
    "pro:proBtnUngroup": "fb:ungroup",
    "pro:proBtnEditNodes": "fb:editNodes",
    "pro:proBtnToggleRulers": "fb:rulers",
    "pro:proBtnToggleGuides": "fb:guides",
    "pro:proBtnToggleMeasurements": "fb:measurements",
    "pro-zoom-reset": "fb:zoom"
});
const normalizar = k => (k && ALIAS[k]) || k;
/* Vuelta: si la cinta no tiene ese botón montado, el chip igual tiene que
   poder disparar el de la banda. */
const ALIAS_ID = Object.freeze(Object.entries(ALIAS)
    .reduce((acc, [pro, fb]) => { acc[fb] = pro.slice(4); return acc; }, {}));

/* Los botones de la banda se llaman "Left", "C-H", "Total": en el nivel
   tienen que leerse como herramientas. */
const NOMBRES = Object.freeze({
    "pro:proBtnAlignLeft": "Alinear izq.",
    "pro:proBtnAlignCenterH": "Centrar H",
    "pro:proBtnAlignRight": "Alinear der.",
    "pro:proBtnAlignTop": "Alinear arriba",
    "pro:proBtnAlignCenterV": "Centrar V",
    "pro:proBtnAlignBottom": "Alinear abajo",
    "pro:proBtnCenterH": "Centrar en producto H",
    "pro:proBtnCenterV": "Centrar en producto V",
    "pro:proBtnCenterBoth": "Centrar en producto",
    "pro:proBtnDistributeH": "Distribuir H",
    "pro:proBtnDistributeV": "Distribuir V",
    "pro:proBtnFusionar": "Fusionar",
    "pro:proBtnQuitarFusion": "Quitar fusión"
});

function claveDe(boton) {
    if (!boton) return null;
    if (boton.dataset.fusionBtn) return "fb:" + boton.dataset.fusionBtn;
    if (boton.id) return normalizar("pro:" + boton.id);
    return null;
}
function registrar(clave) {
    if (!clave) return;
    const e = uso[clave] || { c: 0, ts: 0 };
    e.c += 1;
    e.ts = Date.now();
    uso[clave] = e;
    guardar(LS_USO, uso);
    pintarUsadas();
    if (editor) pintarEditor();
}

/* ------------------------------------------------------------------ */
/* Registro de herramientas (etiqueta + icono) a partir del DOM real    */
/* ------------------------------------------------------------------ */
const iconoDe = el => {
    if (!el) return "";
    const i = el.querySelector("i");
    if (i) return i.outerHTML;
    const s = el.querySelector("svg");
    return s ? s.outerHTML : "";
};
const textoDe = el => {
    if (!el) return "";
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t || (el.getAttribute("title") || "");
};

function herramientas() {
    const mapa = new Map();
    // Cinta primero: si la misma herramienta vive en los dos lados, gana la
    // cinta (es la que tiene el nombre bueno). La banda solo aporta las suyas.
    const reales = document.querySelectorAll("#topBar button[data-fusion-btn], #pro-layout-toolbar .pro-btn");
    reales.forEach(b => {
        const k = claveDe(b);
        if (!k || mapa.has(k)) return;
        const enBanda = !!b.closest("#pro-layout-toolbar");
        const bruto = b.id ? "pro:" + b.id : "";
        const label = (enBanda && NOMBRES[bruto]) || textoDe(b);
        mapa.set(k, { clave: k, label, icon: iconoDe(b), titulo: b.getAttribute("title") || label });
    });
    return mapa;
}

function botonReal(clave) {
    if (!clave) return null;
    if (clave.startsWith("pro:")) {
        const id = clave.slice(4);
        const banda = document.querySelector(`#pro-layout-toolbar #${CSS.escape(id)}`);
        return banda || document.getElementById(id);
    }
    const nombre = clave.slice(3);
    const dentro = document.querySelector(`#topBar button[data-fusion-btn="${CSS.escape(nombre)}"]`);
    if (dentro) return dentro;
    const id = ALIAS_ID[clave];
    if (id) {
        const banda = document.querySelector(`#pro-layout-toolbar #${CSS.escape(id)}`);
        if (banda) return banda;
    }
    return Array.from(document.querySelectorAll(`button[data-fusion-btn="${CSS.escape(nombre)}"]`))[0] || null;
}

/* Un chip nunca dispara algo que en este momento no se puede usar: se ve
   apagado en vez de fallar en silencio. */
function disponible(clave) {
    const b = botonReal(clave);
    return !!b && !b.disabled && !b.classList.contains("ekko-locked");
}
function ejecutar(clave) {
    if (!disponible(clave)) return false;
    botonReal(clave).click();
    return true;
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */
function ranking() {
    const todas = herramientas();
    const lista = Object.keys(uso)
        .filter(k => todas.has(k) && uso[k] && uso[k].c > 0)
        .map(k => ({ clave: k, c: uso[k].c, ts: uso[k].ts || 0, info: todas.get(k) }));

    /* El conjunto lo eligen los USOS (top N por cantidad de clicks).
       El orden horizontal lo pone la RECENCIA, salvo que se pida otra cosa. */
    const conjunto = lista.slice().sort((a, b) => (b.c - a.c) || (b.ts - a.ts)).slice(0, cfg.n);
    if (cfg.orden === "reciente") conjunto.sort((a, b) => (b.ts - a.ts) || (b.c - a.c));
    else if (cfg.orden === "uso") conjunto.sort((a, b) => (b.c - a.c) || (b.ts - a.ts));
    else conjunto.sort((a, b) => (b.ts - a.ts) || (b.c - a.c));
    return { conjunto, lista };
}

/* ------------------------------------------------------------------ */
/* Nivel MÁS USADAS                                                    */
/* ------------------------------------------------------------------ */
function crearFila() {
    if (row && document.body.contains(row)) return row;
    row = document.getElementById("ekkoNivelUsadas");
    if (row) return row;

    row = document.createElement("div");
    row.id = "ekkoNivelUsadas";
    row.className = "ekko-niv";
    row.innerHTML = `
        <button class="ekko-niv-rail" type="button" data-niv-plegar="usadas"
                title="Plegar el nivel Más usadas">
            <span class="ekko-niv-chev"></span>
            <span class="ekko-niv-nombre">Más usadas</span>
        </button>
        <div class="ekko-niv-items" role="toolbar" aria-label="Herramientas más usadas"></div>
        <button class="ekko-niv-cfg" type="button" title="Configurar los niveles de la barra">
            <i class="fas fa-sliders-h"></i> Niveles
        </button>`;
    return row;
}

function montarFila() {
    const banda = document.getElementById("pro-layout-toolbar");
    const fila = crearFila();
    if (!banda || !fila) return;
    // Por defecto abajo de todo: debajo de la barra fija y arriba del lienzo.
    if (cfg.usadasArriba) {
        if (banda.previousElementSibling !== fila) banda.parentElement.insertBefore(fila, banda);
    } else if (banda.nextElementSibling !== fila) {
        banda.insertAdjacentElement("afterend", fila);
    }
    row.classList.toggle("is-plegada", !!cfg.usadasPlegada);
}

function pintarUsadas() {
    if (!row) return;
    const items = row.querySelector(".ekko-niv-items");
    if (!items) return;
    const { conjunto } = ranking();
    document.body.classList.toggle("ekko-usadas-plegada", !!cfg.usadasPlegada);
    if (!conjunto.length) {
        items.innerHTML = '<span class="ekko-niv-vacia">Todavía no usaste ninguna herramienta</span>';
        row.classList.add("is-vacia");
        return;
    }
    row.classList.remove("is-vacia");
    const ultimo = Math.max(...conjunto.map(x => x.ts));
    items.innerHTML = conjunto.map(x => {
        const reciente = x.ts === ultimo ? " is-reciente" : "";
        const off = disponible(x.clave) ? "" : " is-off";
        const titulo = `${x.info.titulo} · ${x.c} ${x.c === 1 ? "uso" : "usos"}` +
            (off ? " · no disponible ahora" : "");
        return `<button class="ekko-chip${reciente}${off}" type="button" data-niv-clave="${x.clave}"
                    title="${escapar(titulo)}">
                    <span class="ekko-chip-ic">${x.info.icon}</span>
                    <span class="ekko-chip-tx">${escapar(x.info.label)}</span>
                    <span class="ekko-chip-n">${x.c}</span>
                </button>`;
    }).join("");
}

function escapar(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

/* ------------------------------------------------------------------ */
/* Nivel FIJA: la banda existente en formato Word                       */
/* ------------------------------------------------------------------ */
function prepararBanda() {
    const banda = document.getElementById("pro-layout-toolbar");
    if (!banda) return;
    if (!banda.dataset.ekkoWord) {
        // El grupo de "Opciones de Vista" mezcla vista y zoom: el zoom merece
        // su propio grupo para que el nombre quede debajo de sus botones.
        const zoom = banda.querySelector("#pro-zoom-reset");
        if (zoom) {
            const viejo = zoom.parentElement;
            const etiquetaZoom = Array.from(viejo.children)
                .find(c => c.classList.contains("pro-label") && /zoom/i.test(c.textContent));
            const grupo = document.createElement("div");
            grupo.className = "pro-group";
            grupo.dataset.ekkoZoom = "1";
            if (etiquetaZoom) grupo.appendChild(etiquetaZoom);
            grupo.appendChild(zoom);
            const divisor = Array.from(viejo.children).reverse()
                .find(c => c.classList.contains("pro-divider"));
            if (divisor) divisor.remove();
            banda.appendChild(grupo);
        }
        // Word: el nombre del grupo va DEBAJO de sus iconos.
        banda.querySelectorAll(".pro-group").forEach(g => {
            const label = Array.from(g.children).find(c => c.classList.contains("pro-label"));
            if (label && g.lastElementChild !== label) g.appendChild(label);
        });
        // Plegar / desplegar la barra fija.
        const fold = document.createElement("button");
        fold.type = "button";
        fold.id = "ekkoFijaFold";
        fold.className = "ekko-niv-fold";
        fold.title = "Plegar / desplegar la barra fija";
        fold.innerHTML = '<span class="ekko-niv-chev"></span>';
        fold.addEventListener("click", () => {
            cfg.fijaPlegada = !cfg.fijaPlegada;
            guardar(LS_CFG, cfg);
            aplicar();
        });
        banda.appendChild(fold);
        banda.dataset.ekkoWord = "1";
    }
    document.body.classList.toggle("ekko-fija-word", !!cfg.fijaWord);
    document.body.classList.toggle("ekko-fija-plegada", !!cfg.fijaPlegada && !!cfg.fijaWord);
}

/* ------------------------------------------------------------------ */
/* Estilos                                                             */
/* ------------------------------------------------------------------ */
function estilos() {
    if (document.getElementById("ekkoNivelesStyles")) return;
    const st = document.createElement("style");
    st.id = "ekkoNivelesStyles";
    st.textContent = `
    /* ---------- nivel Más usadas ---------- */
    /* Todo con las variables del tema: el nivel se pinta con el mismo vidrio
       que la cinta y cambia solo cuando el cliente toca Oscuro. */
    #ekkoNivelUsadas{display:flex;align-items:stretch;gap:10px;padding:3px 8px;margin:0;
        background:var(--esp-vidrio,rgba(255,255,255,.72));
        border-bottom:1px solid var(--esp-borde-interior,rgba(20,24,40,.08));
        backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
        font:12px/1.2 "Segoe UI Variable","Segoe UI",system-ui,sans-serif;
        color:var(--esp-texto,#22242a);user-select:none;position:relative;z-index:9}
    #ekkoNivelUsadas .ekko-niv-rail{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;
        padding:0 6px 0 2px;font-size:9px;letter-spacing:.7px;text-transform:uppercase;
        color:var(--esp-titulo,#8a8e99);cursor:pointer}
    #ekkoNivelUsadas .ekko-niv-rail:hover{color:var(--esp-texto,#22242a)}
    #ekkoNivelUsadas .ekko-niv-items{display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow-x:auto;
        scrollbar-width:thin;padding:1px 0}
    #ekkoNivelUsadas .ekko-niv-vacia{font-size:11px;color:var(--esp-titulo,#9a9da7);font-style:italic;padding:4px 2px}
    #ekkoNivelUsadas .ekko-niv-cfg{display:inline-flex;align-items:center;gap:5px;
        border:1px solid var(--esp-borde-interior,rgba(20,24,40,.12));
        background:var(--esp-vidrio-fuerte,#fff);color:var(--esp-texto,#4b4f59);border-radius:6px;
        padding:0 8px;height:24px;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
    #ekkoNivelUsadas .ekko-niv-cfg:hover{background:rgba(79,70,229,.10);color:#3730c9}

    .ekko-chip{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 7px;
        border:1px solid var(--esp-borde-interior,rgba(20,24,40,.10));
        background:var(--esp-vidrio-fuerte,#fff);border-radius:6px;color:var(--esp-texto,#22242a);
        font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap;
        flex:none;transition:background .12s ease,border-color .12s ease}
    .ekko-chip:hover{background:rgba(79,70,229,.08);border-color:rgba(79,70,229,.24)}
    .ekko-chip-ic{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;
        color:inherit;opacity:.82}
    .ekko-chip-ic svg{width:13px;height:13px}
    .ekko-chip-tx{max-width:96px;overflow:hidden;text-overflow:ellipsis}
    .ekko-chip-n{font-size:9.5px;min-width:15px;height:15px;padding:0 4px;display:inline-grid;place-items:center;
        background:rgba(120,120,140,.16);color:inherit;border-radius:9px;opacity:.9}
    .ekko-chip.is-off{opacity:.45}
    .ekko-chip.is-off:hover{background:transparent;border-color:var(--esp-borde-interior,rgba(20,24,40,.10))}
    .ekko-chip.is-reciente{border-color:rgba(79,70,229,.34);background:rgba(79,70,229,.10)}
    .ekko-chip.is-reciente .ekko-chip-n{background:#4f46e5;color:#fff}
    .ekko-chip.is-nueva{animation:ekkoChipIn .35s ease}
    @keyframes ekkoChipIn{from{opacity:.35;transform:translateY(-3px)}to{opacity:1;transform:none}}

    .ekko-niv-chev{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;
        border-top:5px solid currentColor;display:inline-block;transition:transform .15s ease}
    body.ekko-usadas-plegada #ekkoNivelUsadas .ekko-niv-chev{transform:rotate(-90deg)}
    body.ekko-usadas-plegada #ekkoNivelUsadas .ekko-niv-items{display:none}
    body.ekko-usadas-plegada #ekkoNivelUsadas{padding:2px 8px;min-height:20px}

    /* ---------- barra fija en formato Word ----------
       Ojo con la especificidad: ASSETS/css/styles.css y ekko-espacio.css ya
       pintan la banda con "#topBar + #pro-layout-toolbar .pro-btn" (dos ids).
       Por eso acá todo va con el mismo prefijo y una clase más. */
    /* Solo se toca el ORDEN: el vidrio, el borde y el tema los sigue pintando
       ekko-espacio.css (que ya tiene su versión oscura). */
    body.ekko-fija-word #topBar + #pro-layout-toolbar{display:flex;align-items:flex-end;justify-content:flex-start;
        gap:0;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;height:auto;position:relative}
    body.ekko-fija-word #topBar + #pro-layout-toolbar::-webkit-scrollbar{height:0}
    body.ekko-fija-word #topBar + #pro-layout-toolbar{scrollbar-width:none}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-group{display:flex;flex-flow:row wrap;align-items:center;
        justify-content:flex-start;gap:1px;padding:2px 7px 1px;border-right:1px solid rgba(20,24,40,.09);
        border-radius:0;background:transparent;flex:none;max-width:224px}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-group:last-of-type{border-right:0}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-btn{display:inline-grid;place-items:center;width:27px;
        height:24px;min-height:0;padding:0;font-size:0 !important;line-height:1;background:transparent;border:1px solid transparent;
        border-radius:4px;color:#3d424d;margin:0 1px;box-shadow:none}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-btn>i{font-size:12.5px !important;margin:0}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-btn:hover{background:rgba(79,70,229,.08);
        border-color:rgba(79,70,229,.22);color:#3730c9}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-btn.active{background:rgba(79,70,229,.10);color:#3730c9}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-btn>span{display:none}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-label{flex-basis:100%;text-align:center;
        font-size:8.4px !important;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#8b8f9a;
        margin:3px 0 0;white-space:nowrap;order:99}
    body.ekko-fija-word #topBar + #pro-layout-toolbar .pro-divider{width:1px;height:20px;
        background:rgba(20,24,40,.10);margin:0 3px;align-self:center}
    .ekko-niv-fold{margin-left:auto;align-self:center;display:grid;place-items:center;width:22px;height:22px;
        border:1px solid transparent;border-radius:4px;background:transparent;color:#8b8f9a;cursor:pointer;flex:none}
    .ekko-niv-fold:hover{background:rgba(20,24,40,.06);color:#22242a}
    body.ekko-fija-plegada #topBar + #pro-layout-toolbar{min-height:20px;padding:0 8px}
    body.ekko-fija-plegada #topBar + #pro-layout-toolbar .pro-group{display:none}
    body.ekko-fija-plegada #topBar + #pro-layout-toolbar .ekko-niv-fold .ekko-niv-chev{transform:rotate(-90deg)}

    /* ---------- editor ---------- */
    .ekko-niv-modal{position:fixed;inset:0;background:rgba(18,20,28,.34);z-index:20000300;
        display:flex;align-items:flex-start;justify-content:center;padding:64px 16px;overflow:auto}
    .ekko-niv-panel{width:min(560px,100%);background:#fff;color:#22242a;border-radius:12px;
        box-shadow:0 18px 60px rgba(10,14,30,.28);font:12.5px/1.45 "Segoe UI Variable","Segoe UI",system-ui,sans-serif;overflow:hidden}
    .ekko-niv-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #e9eaee}
    .ekko-niv-head b{font-size:13.5px;font-weight:650}
    .ekko-niv-head span{color:#71757e;font-size:11.5px}
    .ekko-niv-x{margin-left:auto;border:0;background:transparent;font-size:16px;color:#71757e;cursor:pointer;line-height:1}
    .ekko-niv-body{padding:12px 14px;display:grid;gap:14px;max-height:min(60vh,520px);overflow:auto}
    .ekko-niv-sec{border:1px solid #e9eaee;border-radius:9px;padding:10px 11px;display:grid;gap:8px}
    .ekko-niv-sec>h4{margin:0;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:#8b8f9a;font-weight:650}
    .ekko-niv-linea{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .ekko-niv-linea>label{color:#4b4f59}
    .ekko-niv-panel select,.ekko-niv-panel input[type=number]{font:inherit;font-size:12px;height:26px;padding:0 6px;
        border:1px solid #dcdee3;border-radius:6px;background:#fff;color:#22242a}
    .ekko-niv-b{border:1px solid #dcdee3;background:#fff;border-radius:6px;height:26px;padding:0 9px;font:inherit;
        font-size:11.5px;color:#22242a;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
    .ekko-niv-b:hover{background:#f3f4f7}
    .ekko-niv-b.warn{color:#b3261e;border-color:#f0c4c1}
    .ekko-niv-hint{color:#8b8f9a;font-size:11px}
    .ekko-niv-tabla{display:grid;gap:3px}
    .ekko-niv-fila{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;
        padding:3px 5px;border-radius:5px}
    .ekko-niv-fila:hover{background:#f6f7fa}
    .ekko-niv-fila .n{font-size:10px;color:#71757e;background:#eceef4;border-radius:8px;padding:1px 6px}
    .ekko-niv-fila .ekko-chip-ic{color:#4b4f59}
    .ekko-niv-fila-nm{display:flex;align-items:center;gap:6px;min-width:0}
    .ekko-niv-fila-nm span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    body[data-modo="oscuro"] .ekko-niv-panel{background:#1d1f26;color:#e8e9ee}
    body[data-modo="oscuro"] .ekko-niv-head,body[data-modo="oscuro"] .ekko-niv-sec{border-color:#31343d}
    body[data-modo="oscuro"] .ekko-niv-panel select,
    body[data-modo="oscuro"] .ekko-niv-panel input,
    body[data-modo="oscuro"] .ekko-niv-b{background:#262932;color:#e8e9ee;border-color:#3a3e49}
    body[data-modo="oscuro"] .ekko-niv-fila:hover{background:#22252c}
    body[data-modo="oscuro"] .ekko-niv-fila .n{background:#2c3038;color:#b9bdc7}`;
    document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */
function abrirEditor() {
    if (!editor) {
        editor = document.createElement("div");
        editor.className = "ekko-niv-modal";
        editor.innerHTML = '<div class="ekko-niv-panel" role="dialog" aria-modal="true" aria-label="Niveles de la barra"></div>';
        editor.addEventListener("click", ev => {
            if (ev.target === editor) cerrarEditor();
            const b = ev.target.closest("[data-niv-accion]");
            if (b) accionEditor(b.dataset.nivAccion, b.dataset.nivValor);
        });
        document.body.appendChild(editor);
    }
    editor.style.display = "flex";
    pintarEditor();
}
function cerrarEditor() {
    if (editor) editor.style.display = "none";
}

function pintarEditor() {
    if (!editor || editor.style.display === "none") return;
    const panel = editor.querySelector(".ekko-niv-panel");
    const { conjunto, lista } = ranking();
    const ordenadas = lista.slice().sort((a, b) => (b.c - a.c) || (b.ts - a.ts));
    panel.innerHTML = `
        <div class="ekko-niv-head">
            <b>Niveles de la barra</b>
            <span>EKKO · se guarda solo</span>
            <button class="ekko-niv-x" type="button" data-niv-accion="cerrar" title="Cerrar">✕</button>
        </div>
        <div class="ekko-niv-body">

            <div class="ekko-niv-sec">
                <h4>Nivel Más usadas</h4>
                <div class="ekko-niv-linea">
                    <label>Cantidad</label>
                    <select data-niv-campo="n">
                        ${[5, 6, 7, 8, 9].map(n => `<option value="${n}"${cfg.n === n ? " selected" : ""}>${n}</option>`).join("")}
                    </select>
                    <label>Orden</label>
                    <select data-niv-campo="orden">
                        <option value="hibrido"${cfg.orden === "hibrido" ? " selected" : ""}>las más usadas, la última primero</option>
                        <option value="uso"${cfg.orden === "uso" ? " selected" : ""}>sólo por cantidad de usos</option>
                        <option value="reciente"${cfg.orden === "reciente" ? " selected" : ""}>sólo por última vez usada</option>
                    </select>
                </div>
                <div class="ekko-niv-linea">
                    <label>Posición</label>
                    <select data-niv-campo="usadasArriba">
                        <option value="0"${!cfg.usadasArriba ? " selected" : ""}>abajo de todo (sobre el lienzo)</option>
                        <option value="1"${cfg.usadasArriba ? " selected" : ""}>arriba de la barra fija</option>
                    </select>
                    <button class="ekko-niv-b" type="button" data-niv-accion="plegar-usadas">
                        ${cfg.usadasPlegada ? "Desplegar" : "Plegar"} el nivel
                    </button>
                </div>
                <div class="ekko-niv-hint">Se muestran las ${cfg.n} con más usos; cada vez que tocás una vuelve al primer lugar.</div>
            </div>

            <div class="ekko-niv-sec">
                <h4>Nivel Barra fija</h4>
                <div class="ekko-niv-linea">
                    <label>Formato</label>
                    <select data-niv-campo="fijaWord">
                        <option value="1"${cfg.fijaWord ? " selected" : ""}>Word (iconos y nombre abajo)</option>
                        <option value="0"${!cfg.fijaWord ? " selected" : ""}>original (con texto)</option>
                    </select>
                    <button class="ekko-niv-b" type="button" data-niv-accion="plegar-fija">
                        ${cfg.fijaPlegada ? "Desplegar" : "Plegar"} la barra
                    </button>
                </div>
                <div class="ekko-niv-hint">Son los mismos botones de siempre (alinear, centrar, organizar, vista): no hay copias.</div>
            </div>

            <div class="ekko-niv-sec">
                <h4>Herramientas registradas (${ordenadas.length})</h4>
                <div class="ekko-niv-tabla">
                    ${ordenadas.length ? ordenadas.map(x => {
                        const dentro = conjunto.some(c => c.clave === x.clave);
                        return `<div class="ekko-niv-fila">
                            <span class="ekko-niv-fila-nm"><span class="ekko-chip-ic">${x.info.icon}</span><span>${escapar(x.info.label)}</span></span>
                            <span class="n">${x.c}</span>
                            <button class="ekko-niv-b${dentro ? " warn" : ""}" type="button"
                                data-niv-accion="sacar" data-niv-valor="${x.clave}"
                                title="Deja de contar esta herramienta (vuelve si la usás otra vez)">olvidar</button>
                        </div>`;
                    }).join("") : '<div class="ekko-niv-hint">Todavía no hay usos registrados.</div>'}
                </div>
                <div class="ekko-niv-linea">
                    <button class="ekko-niv-b warn" type="button" data-niv-accion="restaurar"
                        title="Borra todos los usos y vuelve a la barra como vino">Volver a como estaba</button>
                </div>
            </div>

        </div>`;
}

function accionEditor(accion, valor) {
    switch (accion) {
        case "cerrar": return cerrarEditor();
        case "plegar-usadas":
            cfg.usadasPlegada = !cfg.usadasPlegada; break;
        case "plegar-fija":
            cfg.fijaPlegada = !cfg.fijaPlegada; break;
        case "sacar": {
            const e = uso[valor];
            if (!e) break;
            // "sacar" del ranking = olvidar ese registro (vuelve si se usa).
            delete uso[valor];
            guardar(LS_USO, uso);
            break;
        }
        case "restaurar":
            if (!confirm("¿Borrar todos los usos y volver a la barra como vino?")) return;
            cfg = { ...CFG_DEF };
            uso = {};
            guardar(LS_CFG, cfg); guardar(LS_USO, uso);
            break;
        default: break;
    }
    guardar(LS_CFG, cfg);
    aplicar();
    pintarEditor();
}

/* ------------------------------------------------------------------ */
/* Interacción global                                                  */
/* ------------------------------------------------------------------ */
function enlazar() {
    document.addEventListener("click", ev => {
        // Chips del nivel Más usadas.
        const chip = ev.target.closest && ev.target.closest("[data-niv-clave]");
        if (chip) {
            ev.preventDefault();
            ev.stopPropagation();
            if (!ejecutar(chip.dataset.nivClave)) chip.classList.add("is-off");
            return;
        }
        if (ev.target.closest && ev.target.closest(".ekko-niv-cfg")) {
            ev.preventDefault();
            abrirEditor();
            return;
        }
        if (ev.target.closest && ev.target.closest("[data-niv-plegar]")) {
            ev.preventDefault();
            cfg.usadasPlegada = !cfg.usadasPlegada;
            guardar(LS_CFG, cfg);
            aplicar();
            return;
        }
    }, true);

    // Registro de uso: cualquier click en un botón real de la cinta o de la
    // banda fija cuenta. Fase captura para no depender de otros módulos.
    document.addEventListener("click", ev => {
        const b = ev.target.closest && ev.target.closest("#topBar button[data-fusion-btn], #pro-layout-toolbar .pro-btn");
        if (!b) return;
        if (b.disabled || b.classList.contains("ekko-locked")) return;
        registrar(claveDe(b));
    }, true);

    document.addEventListener("change", ev => {
        const campo = ev.target.getAttribute && ev.target.getAttribute("data-niv-campo");
        if (!campo) return;
        if (campo === "n") cfg.n = Math.min(9, Math.max(5, +ev.target.value || 6));
        else if (campo === "orden") cfg.orden = ev.target.value;
        else if (campo === "usadasArriba") cfg.usadasArriba = ev.target.value === "1";
        else if (campo === "fijaWord") cfg.fijaWord = ev.target.value === "1";
        guardar(LS_CFG, cfg);
        aplicar();
        pintarEditor();
    });

    document.addEventListener("keydown", ev => {
        if (ev.key === "Escape" && editor && editor.style.display !== "none") cerrarEditor();
    });
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */
function aplicar() {
    estilos();
    prepararBanda();
    montarFila();
    pintarUsadas();
    document.body.classList.toggle("ekko-usadas-plegada", !!cfg.usadasPlegada);
}

let observer = null;
function vigilar() {
    if (observer) return;
    const zona = document.getElementById("workspace") || document.body;
    observer = new MutationObserver(() => {
        if (!document.getElementById("ekkoNivelUsadas") || !document.body.contains(row)) {
            row = null;
            aplicar();
        }
    });
    observer.observe(zona, { childList: true });
}

function arrancar() {
    cargarCfg();
    cargarUso();
    enlazar();
    aplicar();
    vigilar();
    // La banda fija se inyecta al inicializar canvasControlsIntegration:
    // si todavía no está, se reintenta hasta que aparezca.
    let intentos = 0;
    const esperar = setInterval(() => {
        intentos++;
        if (document.getElementById("pro-layout-toolbar")) {
            clearInterval(esperar);
            aplicar();
        } else if (intentos > 60) clearInterval(esperar);
    }, 100);
}

window.EKKO_NIVELES = Object.freeze({
    abrir: abrirEditor,
    refresh: aplicar,
    get config() { return { ...cfg }; },
    get uso() { return { ...uso }; }
});

if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar, { once: true });
    else arrancar();
}
