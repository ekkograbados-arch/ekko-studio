/* =========================================================================
   EKKO CASCADA — PROTOTIPO FASE 1 (alineado a la cinta del remoto)
   -------------------------------------------------------------------------
   RELACION CON EL MOTOR REAL (verificado en GitHub):

   - La decision de QUE boton se ve, se BLOQUEA (família P, "enseña la
     piramide") o se oculta la escribe SOLO ui/ribbonRenderer.js, consumiendo
     toolbarStore.js + toolbarManifest.js + capabilities.js. ESE NIVEL YA
     EXISTE: este prototipo NO lo duplica y no toca style.display.
   - La pestaña activa la lee toolbarStore desde window.EKKO_PANEL_STATE
     (panelCoordinator). Los chips de la tira escriben AHI y piden
     window.EKKO_RIBBON.refresh(): una sola fuente de verdad.
   - commandParameters.js ya abre automaticamente su panel (#ekkoParamSurface)
     al pulsar un boton con parametros: el panel de opciones de este prototipo solo lo
     RE-ANCLA debajo del boton pulsado (se despliega hacia abajo, pegado a
     su herramienta).

   ESTRUCTURA que aporta este modulo:
     TIRA (fila 1)  Cluster de creacion (Cargar / Agregar Texto / QR) + el
                    UNICO boton de panel de productos (a la izquierda de
                    "Inicio", con ‹ / › segun este oculto o visible) +
                    pestañas de contexto (Inicio/Imagen/Texto/Vector/...) +
                    estado, chevron contraer/expandir y DESCARGAR al extremo
                    derecho. Flechas DESVANECIDAS que desplazan solo con
                    hover (sin clic).
     HERRAMIENTAS (fila 2)  LOS BOTONES REALES del topBar, re-parentados
                    (nunca clonados): el motor, el historial y el panel de
                    parametros siguen escuchando al mismo nodo. Las mas
                    usadas de cada contexto se adelantan (recientes por peso:
                    frecuencia x recencia, memorizadas en localStorage). Al
                    extremo derecho, el boton de modo claro/oscuro, con el
                    lenguaje visual de ESTA fila.
     PANEL DE PARAMETROS  Re-anclaje del panel de opciones bajo el boton
                    pulsado.

   ACTIVACION: ?cascade=1 memoriza el prototipo, ?cascade=0 lo apaga, o
   localStorage ekko.cascadePrototype="1". Sin flag el modulo no carga y la
   app se comporta exactamente igual que hoy.
   ========================================================================= */

import { TABS, detectTab, tabsForSelection } from "./capabilities.js";

let iniciado = false;
let topBar = null;
let strip = null;
let tabsBox = null;
let fila = null;
let superficieN2 = null;

const RAIZ_ORDEN = { base: 0, image: 1, vector: 2, text: 3, multiple: 4, fusion: 5 };
const LLAVE_RECENTES = "ekko.cascade.recientes.v1";

/* ------------------------------------------------------------------ */
/* Pestaña activa: UNA sola fuente — panelCoordinator (EKKO_PANEL_STATE) */
/* ------------------------------------------------------------------ */
function pestañaActual() {
    const t = window.EKKO_PANEL_STATE && window.EKKO_PANEL_STATE.activeTab;
    return (t && t !== "auto") ? t : "auto";
}

function persistirTab(nuevo) {
    // El coordinador persiste en su ciclo; el prototipo acompaña con la
    // misma clave para que la eleccion sobreviva a la recarga.
    try {
        const estado = JSON.parse(localStorage.getItem("ekko.panels.v1") || "{}");
        estado.activeTab = nuevo;
        localStorage.setItem("ekko.panels.v1", JSON.stringify(estado));
    } catch (_) {}
}

function elegirPestaña(id) {
    const ahora = pestañaActual();
    const nuevo = (ahora === id) ? "auto" : id;   // 2.º clic = volver a auto
    if (window.EKKO_PANEL_STATE) window.EKKO_PANEL_STATE.activeTab = nuevo;
    persistirTab(nuevo);
    window.EKKO_RIBBON && window.EKKO_RIBBON.refresh && window.EKKO_RIBBON.refresh();
    renderTabs();
    refrescarFila();
}

/* ------------------------------------------------------------------ */
/* Selección (mismas fuentes que el store de la cinta)                  */
/* ------------------------------------------------------------------ */
function seleccionActual() {
    const sel = [];
    if (window.selectedItems && window.selectedItems.length) sel.push(...window.selectedItems.filter(Boolean));
    else if (window.selectedItem) sel.push(window.selectedItem);
    return sel;
}

function contextoActual() {
    const manual = pestañaActual();
    if (manual !== "auto" && TABS[manual]) return manual;
    const via = (window.EKKO_RIBBON_STATE && window.EKKO_RIBBON_STATE.detectedTab) || detectTab(seleccionActual()) || "base";
    return via;
}

function nombreComando(btn) {
    return btn.dataset.fusionBtn || btn.dataset.ekkoCommand || null;
}

/* ------------------------------------------------------------------ */
/* Recientes por contexto: frecuencia x recencia                        */
/* ------------------------------------------------------------------ */
function leerRecientes() {
    try { return JSON.parse(localStorage.getItem(LLAVE_RECENTES) || "{}") || {}; } catch (_) { return {}; }
}

function registrarUso(comando) {
    if (!comando) return;
    // Solo herramientas con contrato real (data-fusion-btn) alimentan los
    // recientes: los botones permanentes (Cargar/Texto/QR) no compiten.
    const contexto = contextoActual();
    const datos = leerRecientes();
    const lista = datos[contexto] || [];
    const i = lista.findIndex(e => e.c === comando);
    if (i >= 0) { lista[i].count = (lista[i].count || 1) + 1; lista[i].ts = Date.now(); }
    else lista.push({ c: comando, count: 1, ts: Date.now() });
    lista.sort((a, b) => (b.count * Math.exp(-(Date.now() - b.ts) / 86400000)) -
                          (a.count * Math.exp(-(Date.now() - a.ts) / 86400000)));
    datos[contexto] = lista.slice(0, 6);
    try { localStorage.setItem(LLAVE_RECENTES, JSON.stringify(datos)); } catch (_) {}
    refrescarFila();
}

function rangoReciente(comando) {
    const lista = leerRecientes()[contextoActual()] || [];
    const i = lista.findIndex(e => e.c === comando);
    return i < 0 ? 99 : i;
}

/* ------------------------------------------------------------------ */
/* Estilos                                                              */
/* ------------------------------------------------------------------ */
function estilos() {
    if (document.getElementById("ekkoCascadeStyles")) return;
    const st = document.createElement("style");
    st.id = "ekkoCascadeStyles";
    st.textContent = `
        /* --- Estructura: topBar a columna (tira + fila de herramientas) --- */
        #topBar.ekko-cascade {
            flex-direction: column !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            display: flex !important;
        }
        /* Los modos del coordinador siguen mandando: en compacto queda solo
           la tira de inicio; en oculto, el chip de rescate ya conocido.
           overflow VISIBLE: el menu de Descargar cuelga de la tira y no puede
           recortarse contra los 34px de la barra contraida. */
        #topBar.ekko-cascade.is-compact { height: auto !important; overflow: visible !important; }
        #topBar.ekko-cascade.is-compact .ekko-tools-shell { display: none !important; }

        /* Sistemas de facto afuera de la cascada */
        #topBar.ekko-cascade #ekkoTopContextSurface,
        #topBar.ekko-cascade #topPanelControls,
        #topBar.ekko-cascade #topPanelOverflow { display: none !important; }
        #topBar.ekko-cascade .ekko-overflowed { display: inline-flex !important; }
        /* La cinta con titulos de ribbonLayout es OTRO sistema de la misma
           informacion: en la cascada sus botones ya fueron aplanados a la fila
           2, asi que el esqueleto se oculta (los grupos vacios quedarian como
           huecos muertos entre la tira y las herramientas). */
        #topBar.ekko-cascade .ekko-ribbon-body { display: none !important; }

        /* Conchas: las flechas viven aqui (position:relative), no dentro del
           scroller, para quedar clavadas al borde visible. */
        .ekko-cascade-shell { position: relative; min-width: 0; }
        .ekko-tabs-shell { flex: 1 1 auto; display: flex; align-items: center; min-width: 0; }
        /* La concha de herramientas es FLEX: adentro vive la fila que
           scrollea y, clavado a la derecha, el boton de modo claro/oscuro. */
        .ekko-tools-shell { width: 100%; display: flex; align-items: center; gap: 6px; }
        .ekko-tools-shell #ekkoCascadeTools { flex: 1 1 auto; min-width: 0; }
        /* El boton de la derecha no puede pisar a la flecha de desplazamiento:
           la flecha se corre a su izquierda. */
        .ekko-tools-shell .ekko-pan-der { right: 96px; }

        /* El UNICO control del panel de productos: siempre a la IZQUIERDA de
           "Inicio", en la tira. Mismo lenguaje que el chevron de la barra
           superior: un boton fijo que cambia el glifo (‹ oculto / › visible
           por el lado que abre) y el tooltip. panelCoordinator se ocupa de
           invertir ambos; aca solo se le da lugar. */
        #ekkoCascadeStrip #productPanelTopToggle {
            display: inline-flex !important;
            flex: 0 0 auto;
            margin-right: 6px;
        }

        /* --- TIRA (fila 1) --- */
        #ekkoCascadeStrip {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            position: relative;
            padding: 4px 2px 0 2px;
        }
        #ekkoCascadeCluster {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
        }
        .ekko-strip-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.14);
            color: #e2e8f0;
            padding: 5px 10px;
            border-radius: 7px;
            font-size: 12.5px;
            cursor: pointer;
            white-space: nowrap;
        }
        .ekko-strip-btn:hover { background: rgba(255,255,255,0.13); color: #fff; }
        /* Descargar vive en la TIRA (fila 1), al extremo derecho: su menu
           cuelga del boton con position:relative.
           ekko-espacio.css todavia fija al boton en la esquina con !important
           (era la pila flotante anterior: top:12px lo empujaba fuera de la
           fila y la pastilla esmerilada le robaba el molde de la tira). Se le
           responde con la misma moneda y aqui gana por especificidad: dos ids
           contra uno. */
        #ekkoCascadeStrip #ekkoDownloadWrap {
            position: relative !important;
            top: auto !important;
            right: auto !important;
            left: auto !important;
            bottom: auto !important;
            display: inline-flex !important;
        }
        #ekkoCascadeStrip #ekkoDownloadMenu { z-index: 260; }

        /* El chip de rescate del coordinador esta fijo en la esquina superior
           derecha; con la tira armada esa esquina la ocupa Descargar y se
           montaban uno sobre otro. Se estaciona en el aire libre entre la tira
           (fila 1) y las herramientas (fila 2). Sigue en el body, afuera de
           todo panel, asi conserva su funcion cuando la barra se oculta. */
        body[data-ekko-cascade="1"] #ekkoPanelAnchor { top: 56px !important; }

        /* --- BOTONES DE LA TIRA (fila 1): llenos y de acento. El lenguaje
               visual DEBE distinguirse de la fila de herramientas (fila 2),
               que sigue luciendo fantasma sobre la barra. --- */
        #ekkoCascadeStrip button.ekko-ini-btn {
            display: inline-flex; align-items: center; gap: 6px;
            background: #ff2ea6; color: #fff; border: none;
            padding: 7px 14px; border-radius: 8px;
            font-size: 12.5px; font-weight: 700; cursor: pointer;
            white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        #ekkoCascadeStrip button.ekko-ini-btn:hover { background: #ff51b6; color: #fff; }
        #ekkoCascadeStrip button.ekko-ini-btn .ekko-ic { width: 15px; height: 15px; }
        /* Descargar entra en la tira con el MOLDE EXACTO de la fila 1: es un
           .btn-action mas, asi que padding, peso y tipografia los decide la
           misma regla que viste a sus vecinos (Cargar / Agregar Texto / QR).
           Lo unico propio es el verde, que es el color semantico de la salida
           y el de su menu.
           Los !important son obligados: ekko-espacio.css fija la pastilla
           esmerilada (radio 999) sobre todo #topBar .btn-action. Entre dos
           !important decide la especificidad, y aca ganan tres ids contra uno.
           El borde transparente existe para que la caja mida lo mismo que sus
           vecinos (ellos llevan 1px de vidrio): sin el, el boton salia 5px mas
           bajo y la tira se veia descuadrada. */
        #ekkoCascadeStrip #ekkoDownloadWrap #btnEkkoDownload {
            background: #15803d !important;
            border: 1px solid transparent !important;
            border-radius: 12px !important;
            color: #fff !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
            /* 15px es la caja que ocupa el svg .ekko-ic de los vecinos; el
               <i> de Font Awesome mide 12 y el boton salia 3px mas bajo. */
            line-height: 15px;
        }
        #ekkoCascadeStrip #ekkoDownloadWrap #btnEkkoDownload:hover,
        #ekkoCascadeStrip #ekkoDownloadWrap button.ekko-ini-btn:hover {
            background: #166534 !important;
            color: #fff !important;
            transform: none;
        }
        .ekko-util-cluster { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        #ekkoCascadeCluster #ekkoCascadeProducto { margin-left: 0; }
        /* El texto de estado no puede apabullar a las pestañas: se trunca. */
        .ekko-util-cluster #selectionInfo,
        .ekko-util-cluster #ekkoCascadeProducto {
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* Contraer/Expandir SOLO con el chevron: ⌃ contrae, ⌄ expande. El
           glifo y el tooltip los invierte panelCoordinator ("Contraer panel
           superior" / "Expandir panel superior"): la palabra escrita en la
           tira repetia lo que el puntero ya avisa. */
        #ekkoCascadeStrip #topPanelCompact {
            display: inline-flex !important;
            align-items: center; justify-content: center;
            gap: 0; white-space: nowrap;
            min-width: 34px; padding: 5px 9px;
        }

        /* Modo claro/oscuro: vive en la FILA DE HERRAMIENTAS (fila 2), clavado
           a la derecha. No se le pinta una piel propia: se le da la clase
           .btn-action, que es EXACTAMENTE lo que usan los botones de esa fila,
           asi hereda el molde del skin activo (vidrio esmerilado con
           ekko-espacio.css, fantasma sin el) y se ve como un par mas. Pintarlo
           a mano lo dejaba ilegible de dia (texto claro sobre barra clara).
           No es una herramienta de objeto, por eso la regla "sin seleccion" no
           lo alcanza: vive fuera de #ekkoCascadeTools, como hermano de la fila. */
        #btnEkkoTema {
            flex: 0 0 auto;
            display: inline-flex; align-items: center; gap: 5px;
            white-space: nowrap;
        }

        /* --- SIN SELECCION: no aparecen las herramientas. La cascada
               empieza en la tira; la fila nace con el objeto:
               cargar -> seleccionar -> trabajar. --- */
        #topBar.ekko-cascade.ekko-sin-seleccion #ekkoCascadeTools .btn-action { display: none !important; }

        /* --- PANEL DE OPCIONES: la capa de opciones se abre un escalon MAS
               CLARO que la barra: se lee como "opciones de la herramienta",
               una capa por encima, y no como otra fila. --- */
        #ekkoParamSurface {
            background: #33415e !important;
            border-color: rgba(255,255,255,0.32) !important;
            color: #eef2f9 !important;
            box-shadow: 0 14px 34px rgba(0,0,0,0.45) !important;
        }
        #ekkoCascadeProducto {
            margin-left: auto;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 11.5px;
            color: rgba(226,232,240,0.75);
            border: 1px dashed rgba(255,255,255,0.18);
            border-radius: 999px;
            padding: 3px 10px;
            white-space: nowrap;
        }
        #ekkoCascadeTabs { display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0; overflow-x: auto; scrollbar-width: none; }
        #ekkoCascadeTabs::-webkit-scrollbar { display: none; }
        .ekko-cascade-tab {
            background: rgba(255,255,255,0.05);
            border: 1px solid transparent;
            color: rgba(226,232,240,0.8);
            font-size: 12.5px;
            padding: 5px 12px;
            border-radius: 999px;
            cursor: pointer;
            white-space: nowrap;
        }
        .ekko-cascade-tab:hover { color: #fff; background: rgba(255,255,255,0.1); }
        .ekko-cascade-tab.is-activa {
            background: rgba(255,46,166,0.16);
            border-color: rgba(255,46,166,0.55);
            color: #fff;
            font-weight: 600;
        }

        /* --- FILA DE HERRAMIENTAS (fila 2): botones reales --- */
        #ekkoCascadeTools {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            overflow-x: auto;
            scrollbar-width: none;
            padding: 4px 2px 2px 2px;
        }
        #ekkoCascadeTools::-webkit-scrollbar { display: none; }
        #ekkoCascadeTools .btn-action { flex: 0 0 auto; }

        /* La familia P del renderer YA bloquea con motivo; aca se garantiza
           un lenguaje visual minimo aunque styles.css aun no lo traiga. */
        button[data-fusion-btn].ekko-locked {
            opacity: 0.38;
            filter: grayscale(0.5);
            cursor: not-allowed;
        }
        button[data-fusion-btn].ekko-locked:hover { background: rgba(255,255,255,0.06); color: inherit; }

        /* --- Flechas desvanecidas de desplazamiento automatico --- */
        .ekko-pan-btn {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 1px solid rgba(255,255,255,0.22);
            background: rgba(15,23,42,0.55);
            color: rgba(226,232,240,0.7);
            font-size: 13px;
            line-height: 1;
            cursor: default;
            opacity: 0;
            transition: opacity .18s ease;
            z-index: 5;
            pointer-events: none;
            user-select: none;
        }
        .ekko-pan-btn.ekko-op { opacity: 0.55; pointer-events: auto; }
        .ekko-pan-btn.ekko-op:hover, .ekko-pan-btn:hover { opacity: 1; color: #fff; }
        .ekko-pan-izq { left: 4px; }
        .ekko-pan-der { right: 4px; }

        /* --- Modo claro del prototipo (se pule con la aprobacion) --- */
        body[data-ekko-theme="claro"] #topBar,
        body[data-ekko-theme="claro"] #contextual-toolbar,
        body[data-ekko-theme="claro"] .ekko-param-surface {
            background: #f6f7fb !important;
            color: #16181d !important;
            border-color: #d7dee8 !important;
        }
        body[data-ekko-theme="claro"] .btn-action,
        body[data-ekko-theme="claro"] .toolbar-btn,
        body[data-ekko-theme="claro"] .ekko-strip-btn,
        body[data-ekko-theme="claro"] .ekko-cascade-tab {
            background: #ffffff;
            color: #243044;
            border-color: #d7dee8;
        }
        body[data-ekko-theme="claro"] .btn-action:hover,
        body[data-ekko-theme="claro"] .toolbar-btn:hover {
            background: #eef2f7;
            color: #111;
        }
        body[data-ekko-theme="claro"] #selectionInfo { color: #47536b !important; }
        body[data-ekko-theme="claro"] #ekkoCascadeProducto { color: #47536b; border-color: #c3ccda; }
        body[data-ekko-theme="claro"] .ekko-pan-btn {
            background: rgba(255,255,255,0.85); color: #47536b; border-color: #c3ccda;
        }
        body[data-ekko-theme="claro"] button[data-fusion-btn].ekko-locked { opacity: 0.45; }
        body[data-ekko-theme="claro"] #canvasContainer { background: #e9edf4; }
        body[data-ekko-theme="claro"] #ekkoParamSurface {
            background: #ffffff !important;
            border-color: #b9c5d6 !important;
            box-shadow: 0 14px 34px rgba(15,23,42,0.16) !important;
        }
        body[data-ekko-theme="claro"] #ekkoCascadeStrip button.ekko-ini-btn { background: #d61d8c; }
        body[data-ekko-theme="claro"] #ekkoCascadeStrip button.ekko-ini-btn:hover { background: #bd1478; }
        /* Descargar NO se re-pinta de día: su verde es semántico y la regla
           base de la tira ya lo fija con !important para ambos temas. */
    `;
    document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* Flechas desvanecidas: desplazan con solo hover, sin clic             */
/* ------------------------------------------------------------------ */
function armarPan(host, scroller) {
    const izq = document.createElement("button");
    izq.type = "button";
    izq.className = "ekko-pan-btn ekko-pan-izq";
    izq.textContent = "‹";
    izq.title = "Desplazá el puntero aquí";
    const der = document.createElement("button");
    der.type = "button";
    der.className = "ekko-pan-btn ekko-pan-der";
    der.textContent = "›";
    der.title = "Desplazá el puntero aquí";
    // Hermanas del scroller (no hijos): queda clavadas al borde visible.
    host.appendChild(izq);
    host.appendChild(der);

    let raf = null;
    const desplazar = (haciaIzq) => {
        if (raf) return;
        const paso = () => {
            scroller.scrollLeft += haciaIzq ? -5 : 5;
            raf = requestAnimationFrame(paso);
        };
        raf = requestAnimationFrame(paso);
    };
    const parar = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    izq.addEventListener("pointerenter", () => desplazar(true));
    der.addEventListener("pointerenter", () => desplazar(false));
    [izq, der].forEach(b => b.addEventListener("pointerleave", parar));

    const visibilidad = () => {
        const max = scroller.scrollWidth - scroller.clientWidth;
        const hay = max > 2;
        izq.classList.toggle("ekko-op", hay && scroller.scrollLeft > 2);
        der.classList.toggle("ekko-op", hay && scroller.scrollLeft < max - 2);
    };
    scroller.addEventListener("scroll", visibilidad, { passive: true });
    new ResizeObserver(visibilidad).observe(scroller);
    new MutationObserver(() => visibilidad()).observe(scroller, { childList: true, subtree: true });
    visibilidad();
}

/* ------------------------------------------------------------------ */
/* Nivel 0: tira de inicio                                              */
/* ------------------------------------------------------------------ */
function montarStrip() {
    strip = document.createElement("div");
    strip.id = "ekkoCascadeStrip";

    const cluster = document.createElement("div");
    cluster.id = "ekkoCascadeCluster";

    // "Donde empieza el proyecto": Cargar Imagen/SVG, Agregar Texto y QR son
    // acciones de CREACION, no herramientas de objeto. Viven en la tira
    // (fila 1) con lenguaje visual propio de botones primarios; la fila de
    // herramientas (fila 2) queda solo para trabajar sobre objetos YA existentes.
    // Regla segura: .btn-action SIN data-fusion-btn y SIN data-ekko-command
    // (las booleanas llevan data-ekko-command: no entran, trato comun).
    Array.from(topBar.querySelectorAll("button.btn-action")).forEach(b => {
        if (b.dataset.fusionBtn || b.dataset.ekkoCommand) return;
        if (b.closest("#ekkoDownloadWrap")) return;
        b.classList.add("ekko-ini-btn");
        cluster.appendChild(b);
    });

    // Contraer / Expandir: el MISMO boton del coordinador, siempre en la
    // tira. Solo el chevron (⌃ contrae / ⌄ expande): el nombre completo vive
    // en el tooltip que escribe panelCoordinator.
    const compacto = document.getElementById("topPanelCompact");
    if (compacto) compacto.classList.add("ekko-strip-btn");

    // Estado de la seleccion (el texto de ayuda historico)
    const info = document.getElementById("selectionInfo");

    // Producto activo
    const prod = document.createElement("span");
    prod.id = "ekkoCascadeProducto";
    pintarProducto(prod);

    // DERECHA de la tira, en este orden: estado, producto activo, chevron de
    // la barra y, AL EXTREMO, Descargar. El modo claro/oscuro NO esta aca:
    // bajó a la fila de herramientas (montarFila).
    const util = document.createElement("div");
    util.className = "ekko-util-cluster";
    if (info) util.appendChild(info);
    util.appendChild(prod);
    if (compacto) util.appendChild(compacto);

    const desc = document.getElementById("ekkoDownloadWrap");
    if (desc) {
        // Adueno del boton: su CSS inline (position:fixed / top / right) lo
        // dejaba flotando sobre el lienzo; dentro de la tira solo cuelga el
        // menu.
        desc.style.cssText = "";
        const boton = document.getElementById("btnEkkoDownload");
        if (boton) boton.classList.add("ekko-ini-btn");
        util.appendChild(desc);
    }

    strip.appendChild(cluster);

    const tabsShell = document.createElement("div");
    tabsShell.className = "ekko-cascade-shell ekko-tabs-shell";

    // EL control del panel de productos: UN solo boton, siempre en el mismo
    // lugar, a la IZQUIERDA de "Inicio". Es el mismo nodo que usa
    // panelCoordinator (por eso no se crea aca, se re-usa): el coordinador le
    // cambia el glifo ‹ / › y el tooltip en cada estado, igual que hace con el
    // chevron de la barra superior.
    const toggleProductos = document.getElementById("productPanelTopToggle");
    if (toggleProductos) tabsShell.appendChild(toggleProductos);

    tabsBox = document.createElement("div");
    tabsBox.id = "ekkoCascadeTabs";
    tabsShell.appendChild(tabsBox);
    strip.appendChild(tabsShell);

    // Las utilidades van al EXTREMO derecho de la tira (fuera del cluster):
    // IZQUIERDA = crear el proyecto, CENTRO = contextos, DERECHA = estado.
    strip.appendChild(util);

    topBar.insertBefore(strip, topBar.firstChild);
    armarPan(tabsShell, tabsBox);
}

/* Modo claro / oscuro: boton propio de la fila de herramientas (fila 2),
   clavado a la derecha de esa fila. */
function crearBotonTema() {
    const tema = document.createElement("button");
    tema.type = "button";
    tema.id = "btnEkkoTema";
    // .btn-action = el molde vivo de la fila 2 (lo que el skin activo pinte).
    tema.className = "btn-action";
    const pintarTema = () => {
        const modo = (localStorage.getItem("ekko.cascade.tema") || "oscuro");
        document.body.dataset.ekkoTheme = modo;
        tema.textContent = modo === "claro" ? "🌙 Oscuro" : "☀ Claro";
        tema.title = "Modo claro / oscuro";
    };
    tema.addEventListener("click", () => {
        const modo = (localStorage.getItem("ekko.cascade.tema") || "oscuro") === "claro" ? "oscuro" : "claro";
        try { localStorage.setItem("ekko.cascade.tema", modo); } catch (_) {}
        pintarTema();
    });
    pintarTema();
    return tema;
}

function pintarProducto(prod) {
    let nombre = "";
    try {
        const ruta = window.currentMockup && window.currentMockup.data && window.currentMockup.data.svgPath;
        if (ruta) {
            const base = String(ruta).split("/").pop().replace(/\.svg$/i, "");
            nombre = base.replace(/[-–]+/g, " ").replace(/\s+/g, " ").trim()
                .toLowerCase().replace(/(^|\s)\S/g, t => t.toUpperCase());
        }
    } catch (_) {}
    const esLibre = !nombre || /lienzo/i.test(nombre);
    prod.textContent = esLibre ? "▣ Lienzo libre" : `▣ ${nombre}`;
}

/* Pestañas de contexto: chips de la TIRA. Escriben EKKO_PANEL_STATE y le
   piden el render a la cinta (una sola fuente de verdad, cero conflicto). */
function renderTabs() {
    if (!tabsBox) return;
    const sel = seleccionActual();
    const disponibles = tabsForSelection(sel.length ? sel : null);
    const manual = pestañaActual();
    const detectada = detectTab(sel.length ? sel : null) || "base";
    const activa = manual !== "auto" ? manual : detectada;

    if (manual !== "auto" && !disponibles.includes(manual)) disponibles.push(manual);
    if (!disponibles.includes("base")) disponibles.unshift("base");

    tabsBox.innerHTML = "";
    disponibles.sort((a, b) => (RAIZ_ORDEN[a] ?? 99) - (RAIZ_ORDEN[b] ?? 99));
    disponibles.forEach(id => {
        const def = TABS[id];
        if (!def) return;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ekko-cascade-tab" + (id === activa ? " is-activa" : "");
        b.textContent = def.label;
        b.title = (manual === id)
            ? `${def.label} — pulsalo de nuevo para volver al automático`
            : `Ver herramientas de ${def.label.toLowerCase()}`;
        b.addEventListener("click", () => elegirPestaña(id));
        tabsBox.appendChild(b);
    });

    // La pestaña Inicio SIEMPRE queda a la izquierda de todo (y la activa a
    // la vista): si el ancho desplazo los chips, se vuelve al inicio y se
    // centra la activa. La tira no puede arrancar con la Inicio oculta.
    tabsBox.scrollLeft = 0;
    const activo = tabsBox.querySelector(".is-activa");
    if (activo && activo.scrollIntoView) activo.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* ------------------------------------------------------------------ */
/* Nivel 1: fila de herramientas (botones REALES re-parentados)         */
/* ------------------------------------------------------------------ */
function montarFila() {
    const shell = document.createElement("div");
    shell.className = "ekko-cascade-shell ekko-tools-shell";
    fila = document.createElement("div");
    fila.id = "ekkoCascadeTools";
    shell.appendChild(fila);
    topBar.appendChild(shell);

    // Aplanar: los botones pasan directo a la fila (el reordenamiento por
    // recientes exige un mismo contenedor flex). Son los nodos REALES:
    // ribbonRenderer y commandParameters siguen encontrandolos dentro de
    // #topBar, asi que el contrato no cambia nada.
    //
    // Hay dos generaciones de contenedor en el repo: los .top-group historicos
    // y los .ekko-ribbon-group-body que arma ribbonLayout.js. Como el layout de
    // la cinta corre antes que esta tira, los botones YA estan agrupados con
    // titulo: si solo se miran los .top-group la fila nace vacia y arriba
    // quedan tres filas (tira + cinta + cascaron de herramientas). Se aplanan
    // las dos y la cinta se oculta por CSS (.ekko-ribbon-body).
    Array.from(topBar.querySelectorAll("div.top-group")).forEach(g => {
        Array.from(g.children).forEach(h => fila.appendChild(h));
        g.remove();
    });
    Array.from(topBar.querySelectorAll(".ekko-ribbon-group-body")).forEach(g => {
        Array.from(g.children).forEach(h => fila.appendChild(h));
    });
    // Los sueltos de la cinta (btnTopTextCurve viaja sin manifiesto).
    Array.from(topBar.querySelectorAll(".ekko-ribbon-body > button")).forEach(b => fila.appendChild(b));
    Array.from(topBar.children).forEach(h => {
        if (h === strip || h === shell) return;
        if (["ekkoTopContextSurface", "topPanelControls"].includes(h.id)) return;
        if (h.tagName === "BUTTON") fila.appendChild(h);
    });

    // Descargar NO baja a esta fila: vive en la tira (fila 1) al extremo
    // derecho. Lo monta montarStrip().
    // Modo claro/oscuro: SI, a esta fila, clavado a la derecha y vistiendo
    // como un boton mas de la fila.
    shell.appendChild(crearBotonTema());

    if (topBar.firstChild !== strip) topBar.insertBefore(strip, topBar.firstChild);

    armarPan(shell, fila);
}

/* Recientes: UNICAMENTE reordenamiento; el display lo decide la cinta. */
function refrescarFila() {
    if (!fila) return;
    const firmas = Array.from(fila.querySelectorAll("button"))
        .filter(b => !b.classList.contains("ekko-pan-btn") && nombreComando(b));
    const forma = firmas.map(b => `${b.id || ""}#${nombreComando(b)}`).join("|");
    const previa = fila.dataset.ordenPrevia || "";
    if (forma !== previa) {
        const base = firmas.slice();
        base.sort((a, b) => rangoReciente(nombreComando(a)) - rangoReciente(nombreComando(b)));
        base.forEach(b => fila.appendChild(b));
        fila.dataset.ordenPrevia = forma;
    }

    const prod = document.getElementById("ekkoCascadeProducto");
    if (prod) pintarProducto(prod);
}

/* ------------------------------------------------------------------ */
/* Nivel 2: re-anclar el panel de parametros bajo el boton pulsado      */
/* (commandParameters.js ya lo abre automaticamente; aqui solo cambia   */
/*  el lugar: debajo de la herramienta, como pide el concepto)          */
/* ------------------------------------------------------------------ */
function vigilarNivel2() {
    superficieN2 = document.getElementById("ekkoParamSurface");
    if (!superficieN2) {
        new MutationObserver((_, obs) => {
            const s = document.getElementById("ekkoParamSurface");
            if (s) { obs.disconnect(); superficieN2 = s; vigilarEstados(); }
        }).observe(document.body, { childList: true, subtree: true });
        return;
    }
    vigilarEstados();
}

function vigilarEstados() {
    if (!superficieN2) return;
    let abiertoPrevio = superficieN2.dataset.comando || null;
    new MutationObserver(() => {
        const visible = superficieN2.style.display !== "none";
        const comando = superficieN2.dataset.comando || null;
        if (!visible || !comando) { abiertoPrevio = null; return; }
        if (abiertoPrevio === comando) return;
        abiertoPrevio = comando;
        const btn = fila && fila.querySelector(`[data-fusion-btn="${comando}"]`);
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const w = superficieN2.offsetWidth || 420;
        superficieN2.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + "px";
        superficieN2.style.top = Math.round(r.bottom + 10) + "px";
    }).observe(superficieN2, { attributeFilter: ["style", "data-comando", "class"], attributes: true, childList: true });
}

/* ------------------------------------------------------------------ */
/* Refresco + orden de listeners (mi documento corre DESPUES del motor)  */
/* ------------------------------------------------------------------ */
function refrescarDocumento() {
    // Sin seleccion, las herramientas de objeto NO se muestran: el flujo
    // empieza en la tira (cargar / crear) y el resto nace con el objeto; la
    // cinta decide los estados como siempre.
    topBar.classList.toggle("ekko-sin-seleccion", !seleccionActual().length);
    // Guardia de orden: ningun motor debe poder desmontar la estructura
    // (la tira vive SIEMPRE al frente de la cascada).
    if (topBar.firstChild !== strip) topBar.insertBefore(strip, topBar.firstChild);
    renderTabs();
    refrescarFila();
}

function enlazar() {
    // Recientes: captura, sin frenar nada; los botones bloqueados (P) no
    // disparan click, asi que solo el uso REAL alimenta la lista.
    document.addEventListener("click", (ev) => {
        if (!ev.target.closest) return;
        const dentro = ev.target.closest("#ekkoCascadeTools");
        if (!dentro) return;
        const btn = ev.target.closest("button");
        if (!btn) return;
        registrarUso(nombreComando(btn));
    }, true);

    // Despues de CUALQUIER refresco de la cinta/puentes, actualizo tabs y MRU.
    ["refreshEKKORibbon", "refreshEKKOSharedCommands", "refreshAllToolbars", "refreshSharedCommands"].forEach(n => {
        const previo = window[n];
        if (typeof previo !== "function") return;
        window[n] = function () {
            const r = previo.apply(this, arguments);
            setTimeout(refrescarDocumento, 0);
            return r;
        };
    });
    document.addEventListener("ekko:seleccion-cambio", () => refrescarDocumento());

    // Solamente childList: el renderer cambia atributos (no hijos), asi que
    // mis reordenamientos no generan bucle (y la firma del orden freno igual).
    let timer = null;
    new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(refrescarDocumento, 120);
    }).observe(topBar, { childList: true, subtree: true });

    window.addEventListener("resize", () => refrescarDocumento());
}

/* ------------------------------------------------------------------ */
export function initCascadeToolbar() {
    if (iniciado) return;
    const top = document.getElementById("topBar");
    if (!top || document.getElementById("ekkoCascadeStrip")) return;
    if (!window.EKKO_PANEL_STATE) {
        // Sin el estado vivo del coordinador no hay fuente unica: no arranco.
        console.warn("[EKKO CASCADA] Requiere panelCoordinator con EKKO_PANEL_STATE.");
        return;
    }
    iniciado = true;
    topBar = top;
    topBar.classList.add("ekko-cascade");
    // El chip de rescate vive en el BODY, fuera de la barra: la tira necesita
    // marcar el estado desde ahi para poder apartarlo de su esquina.
    document.body.dataset.ekkoCascade = "1";

    estilos();
    montarStrip();
    montarFila();
    refrescarDocumento();
    vigilarNivel2();
    enlazar();

    window.EKKO_RIBBON && window.EKKO_RIBBON.refresh && window.EKKO_RIBBON.refresh();

    window.__EKKO_CASCADA = {
        activo: true,
        refrescar: refrescarDocumento,
        reiniciarRecientes() {
            try { localStorage.removeItem(LLAVE_RECENTES); } catch (_) {}
            refrescarFila();
        }
    };
    console.log("%c[EKKO CASCADA] Prototipo activo (?cascade=1). Tira/estructura montada; decision de botones delegada a la cinta (un solo escritor).", "color:#7c3aed;font-weight:bold;");
}
