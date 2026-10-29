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
                    usadas de cada contexto se adelantan EN EL MOMENTO DEL USO
                    (recientes por peso: frecuencia x recencia, memorizadas en
                    localStorage; la firma comparada es conjunto + orden, si no
                    la fila no se reordenaria hasta cambiar de objeto). Al
                    extremo derecho, el boton de modo claro/oscuro, con el
                    lenguaje visual de ESTA fila.
     BARRA EMERGENTE   El mismo lenguaje, pero como ATAJO del objeto: una sola
                    fila (nowrap) con las 5 herramientas mas usadas de ese
                    contexto a la vista y ⋯ para desplegar el resto (medido:
                    mostraba 19 botones de golpe). La rueda del mouse la
                    desplaza en horizontal. Los grupos que escribe el motor se
                    respetan: solo se reordenan y se esconden de mas.
     PANEL DE PARAMETROS (nivel 3)  commandParameters.js lo abre solo y lo
                    centra en el lienzo; aca se re-ancla como POPOVER debajo
                    de la fila de herramientas con un diente que apunta al
                    boton pulsado. Se vuelca hacia arriba si no entra, sigue
                    a su boton al scrollear o redimensionar, y se rinde si el
                    cliente lo arrastra del asa.
     ALTURA FIJA    La banda de herramientas mide siempre 34px: seleccionar
                    un objeto ya no corre el lienzo (~27px antes).
     SECTOR         Las 3 primeras recientes de la fila 2 forman el sector
     "MAS USADAS"   "mas usadas": quedan a la izquierda (scrollLeft 0), llevan
                    un punto de acento y un cabello vertical las separa del
                    resto. Son los BOTONES REALES marcados con una clase: no se
                    duplica ningun control ni se agrega un panel nuevo.
     PIEL PLANA     Nivel 0 (la tira) conserva el vidrio; la fila 2 se aplana
                    como en Word/Office: sin textura, sin blur, sin las 6 capas
                    de sombra por boton, radio chico, hover de relleno y el
                    acento reservado al boton con estado. Las pestanas pasan de
                    pastilla a solapa con la linea de acento abajo. El boton de
                    tema de la cascada escribe ahora TAMBIEN data-modo (dueno de
                    ekko-espacio.css), para que piel y prototipo no pinten cada
                    uno en un modo distinto.

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
// Anclaje del popover de parametros (nivel 3): que comando lo abrio y si el
// cliente lo agarro del asa (ahi ya no lo vuelvo a mover).
let anclaComando = null;
let arrastrado = false;

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
    refrescarBarraEmergente();
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
        /* La concha de pestanas NO se estira: ahora abre la tira (esta primero
           que la creacion), y si absorbiera el espacio libre empujaria a
           "Cargar Imagen / SVG" contra el centro. Solo encoge cuando no
           entran las pestanas, y ahi aparecen las flechas. */
        .ekko-tabs-shell { flex: 0 1 auto; display: flex; align-items: center; min-width: 0; }
        /* La concha de herramientas es FLEX: adentro vive la fila que
           scrollea y, clavado a la derecha, el boton de modo claro/oscuro. */
        .ekko-tools-shell { width: 100%; display: flex; align-items: center; gap: 6px; }
        .ekko-tools-shell #ekkoCascadeTools { flex: 1 1 auto; min-width: 0; }
        /* El boton de la derecha no puede pisar a la flecha de desplazamiento:
           la flecha se corre a su izquierda. */
        .ekko-tools-shell .ekko-pan-der { right: 96px; }

        /* El UNICO control del panel de productos: siempre a la IZQUIERDA de
           "Inicio", en la tira. Mismo lenguaje que el chevron de la barra
           superior: un boton fijo que cambia el glifo (‹ / › segun el lado por
           donde abre) y el tooltip. panelCoordinator invierte ambos; aca solo
           se le da lugar y el tamano del chevron, para que los dos "portones"
           de la interfaz se lean de la misma familia. */
        #ekkoCascadeStrip #productPanelTopToggle {
            display: inline-flex !important;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            min-width: 34px;
            height: 30px;
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
        /* ... y el revive › del panel de productos SOBRA en la cascada: ese
           panel se abre y se cierra desde UN unico lugar (el boton a la
           izquierda de "Inicio"), que esta visible incluso en modo compacto.
           Dos puertas para el mismo panel confunden al cliente. El chip
           conserva ⌄ (barra superior oculta) y ≡ (barra emergente oculta),
           que si no se pierden: al ocultar la barra se oculta tambien la tira
           y quedaria sin salida. */
        body[data-ekko-cascade="1"] #ekkoPanelAnchorProducts { display: none !important; }

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

        /* --- BARRA EMERGENTE en la cascada: una sola fila con las 5 mas
               usadas a la vista y ⋯ para el resto (medido: sin esto mostraba
               19 botones de golpe, y el cliente no sabe donde mirar). Es el
               ATAJO del objeto; la cinta de arriba sigue siendo el catalogo.
               No se fuerza la visibilidad de NADA: solo se ocultan de mas,
               asi los bloqueos del motor (familia P) siguen mandando. --- */
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb {
            flex-wrap: nowrap;
            overflow-x: auto;
            scrollbar-width: none;
            max-width: calc(100vw - 24px);
        }
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb::-webkit-scrollbar { display: none; }
        /* Los separadores son hijos de la barra, no de los grupos: al
           reordenar los grupos por uso quedarian contando el orden viejo. En
           la cascada el limite de un grupo lo marca su propio margen. */
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb { gap: 8px; }
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb .toolbar-divider { display: none !important; }
        body[data-ekko-cascade="1"] #contextual-toolbar .toolbar-group { flex: 0 0 auto; }
        body[data-ekko-cascade="1"] #contextual-toolbar .ekko-fb-extra,
        body[data-ekko-cascade="1"] #contextual-toolbar .ekko-fb-vacia { display: none !important; }
        /* Al desplegar, el ⋯ se queda y pasa a decir "mostrar menos". */
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-fb-expandida .ekko-fb-extra { display: inline-flex !important; }
        body[data-ekko-cascade="1"] #ekkoFbMas {
            flex: 0 0 auto;
            width: 30px;
            height: 30px;
            padding: 0;
            font-size: 15px;
            line-height: 1;
            cursor: pointer;
        }

        /* --- PANEL DE OPCIONES: la capa de opciones se abre un escalon MAS
               CLARO que la barra: se lee como "opciones de la herramienta",
               una capa por encima, y no como otra fila. --- */
        #ekkoParamSurface {
            background: #33415e !important;
            border-color: rgba(255,255,255,0.32) !important;
            color: #eef2f9 !important;
            box-shadow: 0 14px 34px rgba(0,0,0,0.45) !important;
        }
        /* DIENTADO de Word: el panel de parametros (nivel 3) es un popover
           pegado bajo la herramienta que lo abrio, no un panel flotando en el
           medio del lienzo. La pestañita dice DE QUE boton colgo, que es justo
           lo que se pierde cuando el panel vive centrado. --ekko-ancla-x lo
           escribe la cascada con el centro del boton. */
        #ekkoParamSurface.ekko-anclado::before {
            content: "";
            position: absolute;
            top: -6px;
            left: var(--ekko-ancla-x, 24px);
            width: 12px;
            height: 12px;
            transform: rotate(45deg);
            background: inherit;
            border-left: 1px solid rgba(255,255,255,0.32);
            border-top: 1px solid rgba(255,255,255,0.32);
            border-radius: 3px 0 0 0;
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
            /* Word: la pestana NO es una pastilla, es una solapa plana con el
               acento abajo. Radio 999 hacia de la tira un rosario de chips; el
               borde inferior de 2px es lo que dice "esta capa esta abierta" y
               ademas apunta hacia la fila de herramientas, que es lo gobierna. */
            border-radius: 7px 7px 0 0;
            position: relative;
            cursor: pointer;
            white-space: nowrap;
        }
        .ekko-cascade-tab:hover { color: #fff; background: rgba(255,255,255,0.1); }
        .ekko-cascade-tab.is-activa {
            background: rgba(255,255,255,0.1);
            border-color: transparent;
            color: #fff;
            font-weight: 600;
        }
        .ekko-cascade-tab.is-activa::after {
            content: "";
            position: absolute;
            left: 8px;
            right: 8px;
            bottom: 0;
            height: 2px;
            border-radius: 2px 2px 0 0;
            background: #ff2ea6;
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
            /* ALTURA FIJA (medido): sin esta reserva la banda media 6px con el
               lienzo vacio y 33px al seleccionar, asi que cada clic sobre un
               objeto corria el canvas ~27px hacia abajo. La cinta de Word no se
               achica al cambiar de objeto y aca tampoco: la geometria que no se
               mueve es la que el cliente aprende a golpear de memoria.
               box-sizing para que los 4+2 de padding no sumen extra. */
            box-sizing: border-box;
            min-height: 34px;
        }
        #ekkoCascadeTools::-webkit-scrollbar { display: none; }
        #ekkoCascadeTools .btn-action { flex: 0 0 auto; }

        /* --- PIEL PLANA DE LA FILA 2 (el aire de Word) ---
               Medido sobre ekko-espacio.css: cada boton de la fila llevaba 6
               capas de box-shadow, textura de ruido, blur y radio 12. Sobre la
               tira de inicio eso esta bien (es el nivel 0, la puerta), pero
               repetido 19 veces en la fila de herramientas no deja leer NINGUN
               nombre: parece un collar de cuentas, no un catalogo. Aca el
               vidrio se queda arriba y la fila se aplana: fondo limpio, hover
               solo de relleno, radio chico, y el color de acento reservado para
               lo que tiene estado (toggle activo).
               La especificidad es obligada: la piel pinta con !important desde
               #topBar .btn-action (1 id + 1 clase); esto es 2 ids + 2 clases y
               ademas el hoja va DESPUES en el head, asi gana en ambos casos. */
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action {
            background: transparent !important;
            border: 1px solid transparent !important;
            border-radius: 6px !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            transform: none !important;
            padding: 0 8px !important;
            height: 26px;
            box-sizing: border-box;
            font-size: 12px !important;
            line-height: 24px;
            color: rgba(226,232,240,0.88) !important;
        }
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action:hover {
            background: rgba(255,255,255,0.13) !important;
            color: #fff !important;
            transform: none !important;
        }
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action:active {
            transform: none !important;
            background: rgba(255,255,255,0.2) !important;
        }
        /* Estado ON: en Word el boton presionado se rellena, no flota. Un solo
           lenguaje de acento para toda la cascada (el mismo rosa de la tira). */
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action.active,
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action.is-on,
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action[aria-pressed="true"] {
            background: rgba(255,46,166,0.2) !important;
            border-color: rgba(255,46,166,0.55) !important;
            color: #fff !important;
            box-shadow: none !important;
        }
        /* De dia la misma fila, con tinta azul-gris sobre el vidrio claro. */
        body[data-modo="claro"] #topBar.ekko-cascade #ekkoCascadeTools .btn-action {
            color: #3d4c63 !important;
        }
        body[data-modo="claro"] #topBar.ekko-cascade #ekkoCascadeTools .btn-action:hover {
            background: rgba(15,23,42,0.08) !important;
            color: #10182a !important;
        }
        body[data-modo="claro"] #topBar.ekko-cascade #ekkoCascadeTools .btn-action:active {
            background: rgba(15,23,42,0.14) !important;
        }

        /* --- SECTOR "MAS USADAS" (fila 2) ---
               Los recientes ya ordenan la fila (los 3 de arriba quedan a la
               izquierda y la fila arranca en scrollLeft 0). Faltaba que se
               VIERA: un cabello vertical separa el sector del resto y cada
               herramienta del sector lleva un punto de acento. No se duplica
               ningun boton ni se agrega un panel: el mismo boton real, marcado.
               .ekko-mru-corte nace oculto y solo respira cuando la fila tiene
               sector (lo decide marcarSectorRecientes con la clase
               .ekko-hay-recientes), para no flotar solo cuando no hay
               seleccion y la cinta escondio todo. */
        .ekko-mru-corte {
            display: none;
            flex: 0 0 1px;
            width: 1px;
            height: 18px;
            align-self: center;
            margin: 0 3px;
            background: rgba(255,255,255,0.22);
        }
        #ekkoCascadeTools.ekko-hay-recientes .ekko-mru-corte { display: block; }
        body[data-modo="claro"] .ekko-mru-corte { background: rgba(15,23,42,0.22); }
        #ekkoCascadeTools .btn-action.ekko-es-reciente { position: relative; }
        #ekkoCascadeTools .btn-action.ekko-es-reciente::after {
            content: "";
            position: absolute;
            top: 3px;
            right: 3px;
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: #ff2ea6;
            opacity: 0.85;
        }

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
            /* TINTA DEL CONTENEDOR: la regla base fuerza #eef2f9 (blanco roto)
               con !important para el modo noche, y el panel tiene texto PROPIO
               heredado (la unidad "px" suelta dentro de
               <label class="ekko-param">). Sin esta linea, de dia esa tinta
               caia blanca sobre panel blanco: invisible. Gana por especificidad
               (body[data] + id contra id) y los controles internos conservan
               su color declarado, que ya es oscuro. */
            color: #16181d !important;
        }
        body[data-ekko-theme="claro"] #ekkoParamSurface.ekko-anclado::before {
            border-left-color: #b9c5d6;
            border-top-color: #b9c5d6;
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

    /* El ORDEN de la tira sigue el flujo de lectura: primero la PUERTA del
       panel de productos y "Inicio" (donde se esta parado), despues la
       CREACION (Cargar / Agregar Texto / QR) y al fondo las utilidades. La
       puerta abre la tira porque el panel que gobierna esta pegado al borde
       izquierdo de la ventana: es lo primero que toca la mano. */
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
    strip.appendChild(cluster);

    // Las utilidades van al EXTREMO derecho de la tira (fuera del cluster):
    // IZQUIERDA = la puerta del panel y "Inicio", CENTRO = crear el proyecto,
    // DERECHA = estado, chevron y Descargar.
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
        // Y se escribe TAMBIEN el atributo del que es dueño ui/espacio.js
        // (data-modo), que es el que lee ekko-espacio.css. Sin esto el boton de
        // la cascada pintaba de dia la piel del prototipo sobre el vidrio de
        // noche: dos sistemas de tema discutiendo en la misma pantalla y texto
        // claro sobre barra clara. La puerta del tema es UNA y mueve los dos.
        document.body.dataset.modo = modo;
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
    // La firma del ORDEN entra en la comparacion junto con la del CONJUNTO.
    // Medido antes de esto: la guarda miraba solo el conjunto, así que usar una
    // herramienta (mismo conjunto, orden nuevo) NO reordenaba nada y el sector
    // de recientes se llenaba de puntos repartidos por toda la fila. Recien al
    // cambiar de contexto, cuando el conjunto cambia, la fila se ordenaba.
    const cola = (leerRecientes()[contextoActual()] || []).map(e => e.c);
    const previa = (fila.dataset.ordenPrevia || "").split("@");
    const cambioConjunto = forma !== previa[0];
    const colaNueva = cola.join(",");
    if (cambioConjunto || colaNueva !== previa[1]) {
        const rango = cmd => { const i = cola.indexOf(cmd); return i < 0 ? 99 : i; };
        const base = firmas.slice();
        // sort() es ESTABLE en los motores actuales: las no recientes conservan
        // el orden que les dio la cinta, solo cambian las usadas.
        base.sort((a, b) => rango(nombreComando(a)) - rango(nombreComando(b)));
        base.forEach(b => fila.appendChild(b));
        fila.dataset.ordenPrevia = forma + "@" + colaNueva;
        // El golpe de scroll solo cuando cambia el OBJETO (conjunto nuevo). Al
        // usar una herramienta la fila se reordena pero respeta dónde estabas
        // mirando: saltar al arranque en cada clic es mareante.
        if (cambioConjunto) fila.scrollLeft = 0;
    }

    const prod = document.getElementById("ekkoCascadeProducto");
    if (prod) pintarProducto(prod);
    marcarSectorRecientes();
}

/* ------------------------------------------------------------------ */
/* SECTOR "MAS USADAS" de la fila 2: marcar, no duplicar.                */
/* ------------------------------------------------------------------ */
const MRU_EN_SECTOR = 3;

function marcarSectorRecientes() {
    if (!fila) return;
    // La cola se lee UNA vez: leerRecientes() parsea JSON de localStorage en
    // cada llamada y esto corre por cada boton de la fila.
    const claveRecientes = (leerRecientes()[contextoActual()] || [])
        .slice(0, MRU_EN_SECTOR).map(e => e.c);
    const botones = Array.from(fila.querySelectorAll("button"))
        .filter(b => !b.classList.contains("ekko-pan-btn") && nombreComando(b));
    let ultimo = null;
    botones.forEach(b => {
        const es = claveRecientes.indexOf(nombreComando(b)) >= 0;
        // toggle() con la clase ya en su estado NO dispara registro de
        // mutacion: esta pasada no puede realimentar al observador de #topBar.
        b.classList.toggle("ekko-es-reciente", es);
        if (es) ultimo = b;
    });
    const hay = !!ultimo && seleccionActual().length > 0;
    fila.classList.toggle("ekko-hay-recientes", hay);

    // El cabello va DESPUES del ultimo reciente. Solo se mueve si esta mal
    // ubicado: insertBefore de un nodo que ya esta en su lugar IGUAL genera
    // registro childList, y ahi el refresco se llamaria a si mismo.
    let corte = fila.querySelector(".ekko-mru-corte");
    if (hay) {
        if (!corte) {
            corte = document.createElement("div");
            corte.className = "ekko-mru-corte";
        }
        if (corte.nextSibling !== ultimo.nextSibling) {
            fila.insertBefore(corte, ultimo.nextSibling);
        }
    } else if (corte) {
        corte.remove();
    }
}

/* ------------------------------------------------------------------ */
/* Nivel 1-b: la barra emergente es el ATAJO del objeto, no una copia    */
/* de la cinta. Una sola fila, las FB_EN_VISTA mas usadas a la vista y   */
/* ⋯ para el resto.                                                      */
/*                                                                       */
/* Acá NADIE fuerza la visibilidad de un boton: solo se esconden de mas. */
/* Los que el motor bloquea (familia P, .ekko-command-hidden o display   */
/* inline) siguen bloqueados por el motor, asi que no aparece ninguna    */
/* herramienta muerta nueva.                                             */
/* ------------------------------------------------------------------ */
const FB_EN_VISTA = 5;

function claveUso(btn) {
    // Las de la cinta tienen contrato (data-fusion-btn); las historicas de la
    // barra emergente solo id (btnCtxDelete...). Sin clave no hay recientes.
    return nombreComando(btn) || (btn.id ? btn.id.toLowerCase() : null);
}

function ocultoPorElMotor(btn) {
    return btn.classList.contains("ekko-command-hidden") || btn.style.display === "none";
}

function montarBarraEmergente() {
    const fb = document.getElementById("contextual-toolbar");
    if (!fb || fb.dataset.ekkoCascadeFb === "1") return;
    fb.dataset.ekkoCascadeFb = "1";
    fb.classList.add("ekko-cascade-fb");

    const mas = document.createElement("button");
    mas.type = "button";
    mas.id = "ekkoFbMas";
    mas.className = "toolbar-btn";
    mas.textContent = "⋯";
    mas.title = "Ver todas las herramientas de este objeto";
    mas.addEventListener("click", (ev) => {
        // makeToolbarDraggable mueve la barra con el mousedown sobre cualquier
        // cosa que no sea BUTTON/INPUT: el stopPropagation evita que el clic
        // en el ⋯ la arrastre.
        ev.stopPropagation();
        const expandida = fb.classList.toggle("ekko-fb-expandida");
        mas.title = expandida ? "Mostrar solo las mas usadas"
                              : "Ver todas las herramientas de este objeto";
        refrescarBarraEmergente();
    });
    fb.appendChild(mas);

    // Fila nowrap: la rueda desplaza en horizontal (AutoCAD) en vez de hacer
    // zoom con la barra llena.
    fb.addEventListener("wheel", (ev) => {
        if (fb.scrollWidth <= fb.clientWidth) return;
        if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
        fb.scrollLeft += ev.deltaY;
        ev.preventDefault();
    }, { passive: false });

    // La barra vive en el body, fuera de #topBar: el observador general no la
    // ve, y el motor la reescribe entera en cada cambio de seleccion.
    let timer = null;
    new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(refrescarBarraEmergente, 90);
    }).observe(fb, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });

    window.addEventListener("resize", refrescarBarraEmergente);
    refrescarBarraEmergente();
}

function refrescarBarraEmergente() {
    const fb = document.getElementById("contextual-toolbar");
    if (!fb || fb.dataset.ekkoCascadeFb !== "1") return;
    const mas = document.getElementById("ekkoFbMas");
    // UNIDADES = los hijos DIRECTOS de la barra que agrupan botones: conviven
    // .toolbar-group (Eliminar, Fusionar, Tamano...) y .toolbar-subgroup
    // (Negrita/Cursiva, Eliminar Nodo, Salir de Edicion). Mirar solo los
    // directos evita contar dos veces un subgroup que cuelga de un group.
    const unidades = [...fb.children].filter(c => c.classList &&
        (c.classList.contains("toolbar-group") || c.classList.contains("toolbar-subgroup")));
    const botonesDe = u => [...u.querySelectorAll(".toolbar-btn")].filter(b => b.id !== "ekkoFbMas");
    // La lista de recientes se lee UNA vez por refresco (son 40 botones y
    // leerRecientes() parsea JSON de localStorage en cada llamada).
    const cola = leerRecientes()[contextoActual()] || [];
    const rangoDe = clave => {
        const i = cola.findIndex(e => e.c === clave);
        return i < 0 ? 99 : i;
    };

    // 1) Orden: cada unidad sube segun el mejor puesto de sus botones en los
    //    recientes del contexto. Se mueven las unidades ENTERAS (con sus
    //    titulos y sus controles de tampon), nunca boton por boton: la
    //    estructura que escribe el motor se respeta.
    const mejorRango = u => {
        const rangos = botonesDe(u).filter(b => !ocultoPorElMotor(b)).map(b => rangoDe(claveUso(b)));
        return rangos.length ? Math.min(...rangos) : 999;
    };
    const orden = unidades.slice().sort((a, b) => mejorRango(a) - mejorRango(b));
    // appendChild sobre un nodo que ya esta en su lugar IGUAL dispara al
    // observador childList: sin esta comparacion el refresco se llamaria a si
    // mismo para siempre.
    if (orden.some((u, i) => u !== unidades[i])) {
        orden.forEach(u => fb.appendChild(u));
        if (mas) fb.appendChild(mas);   // el ⋯ SIEMPRE al fondo
    }

    // 2) Los primeros FB_EN_VISTA quedan a la vista; el resto espera detras
    //    del ⋯. toggle() sobre una clase que ya esta como se pide no genera
    //    registro de mutacion, asi que esta parte no puede realimentarse.
    const expandida = fb.classList.contains("ekko-fb-expandida");
    let enVista = 0;
    unidades.forEach(u => {
        const botones = botonesDe(u);
        let utiles = 0;
        botones.forEach(b => {
            if (ocultoPorElMotor(b)) { b.classList.remove("ekko-fb-extra"); return; }
            utiles++;
            const fuera = !expandida && enVista >= FB_EN_VISTA;
            b.classList.toggle("ekko-fb-extra", fuera);
            if (!fuera) enVista++;
        });
        u.classList.toggle("ekko-fb-vacia", utiles === 0);
    });
}

/* ------------------------------------------------------------------ */
/* Nivel 3: el panel de parametros es un POPOVER colgado de la          */
/* herramienta que lo abrio (commandParameters.js ya lo abre solo; aqui  */
/* cambia el ancla y se lo sigue).                                       */
/*                                                                       */
/* Reglas:                                                              */
/*  - Cae debajo de la FILA de herramientas (yugo fijo), no del boton:   */
/*    si la fila scrolleo, el boton puede estar mas alto que la banda.   */
/*  - Si no entra por abajo, abre por arriba. Nunca se sale de la        */
/*    ventana.                                                           */
/*  - Sigue a su boton cuando la fila scrollea o la ventana cambia de    */
/*    tamano (el motor re-centra el panel en cada resize).               */
/*  - Si el cliente lo ARRASTRA del asa, se rinde: queda donde lo puso   */
/*    hasta que se cierre. Rebotar un panel que alguien movio a          */
/*    proposito es la peor clase de bug de interfaz.                     */
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

function buscarBotonComando(comando) {
    // Comparando el dataset en vez de armar un selector: el id del comando
    // nunca tiene que poder romper una busqueda por como se escriba.
    const botones = [...(fila ? fila.querySelectorAll("button") : []),
                     ...(topBar ? topBar.querySelectorAll("button") : [])];
    // Primero la fila 2; si el motor volvio a aplanar la cinta y el boton ya
    // no esta ahi (paso en la ronda de la tira), igual lo encuentro en la barra.
    return botones.find(b => b.dataset.fusionBtn === comando) ||
           botones.find(b => b.dataset.ekkoCommand === comando) || null;
}

function anclarNivel3() {
    if (!superficieN2) return;
    const visible = superficieN2.style.display !== "none";
    const comando = superficieN2.dataset.comando || null;
    if (!visible || !comando) { arrastrado = false; return; }
    // Cambio de herramienta = panel nuevo: vuelve a valer la ley del ancla,
    // aunque el anterior lo hayan arrastrado.
    if (comando !== anclaComando) { anclaComando = comando; arrastrado = false; }
    if (arrastrado) return;

    const btn = buscarBotonComando(comando);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    // Boton oculto (el motor lo bloqueo o cambio el contexto a mitad del
    // panel): NO lo persigo hasta la esquina 0,0. Queda donde estaba y la
    // proxima mutacion lo re-intenta.
    if (!r.width && !r.height) return;
    const w = superficieN2.offsetWidth || 420;
    const h = superficieN2.offsetHeight || 64;
    const left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left)));
    const base = fila && fila.offsetHeight > 0 ? fila.getBoundingClientRect().bottom : r.bottom;
    const abajo = Math.round(base + 9);
    const volcar = abajo + h > window.innerHeight - 8;
    const top = volcar ? Math.max(8, Math.round(r.top - h - 9)) : abajo;
    const izq = `${left}px`;
    // Se compara contra la POSICION ACTUAL, no contra un recuerdo: el motor
    // re-centra el panel en cada resize (commandParameters.js -> colocar()), y
    // si solo mirara mi ultima escritura el popover se despegaria del boton
    // nada mas achicar la ventana. Es idempotente: cuando ya esta en su lugar
    // la comparacion falla y el observador no vuelve a entrar.
    if (superficieN2.style.left === izq && superficieN2.style.top === `${top}px`) return;
    superficieN2.style.left = izq;
    superficieN2.style.top = `${top}px`;
    // El diente apunta al centro del boton; con el panel ya colocado, la
    // coordenada es relativa a la superficie. Se recorta a los bordes porque
    // el panel puede estar desplazado a la izquierda del boton (clamp).
    const diente = Math.round(r.left + r.width / 2 - left - 6);
    superficieN2.style.setProperty("--ekko-ancla-x",
        `${Math.max(12, Math.min(w - 24, diente))}px`);
    superficieN2.classList.toggle("ekko-anclado", !volcar);
}

function vigilarEstados() {
    if (!superficieN2) return;
    // childList/subtree: el motor pinta los controles DESPUES de mostrar la
    // superficie, y recien ahi el panel tiene su altura real (lo que decide
    // si abre hacia abajo o se vuelca arriba).
    new MutationObserver(anclarNivel3).observe(superficieN2, {
        attributeFilter: ["style", "data-comando", "class"], attributes: true,
        childList: true, subtree: true,
    });
    superficieN2.addEventListener("pointerdown", ev => {
        if (ev.target.closest && ev.target.closest(".ekko-param-asa")) arrastrado = true;
    }, true);
    // La fila se desplaza con las flechas y la ventana cambia de tamano: en
    // ambos casos el popover tiene que seguir a su boton.
    if (fila) fila.addEventListener("scroll", anclarNivel3, { passive: true });
    window.addEventListener("resize", anclarNivel3);
    anclarNivel3();
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
    limpiarAncla();
    // La barra emergente puede no existir todavia en el arranque (contextualMenu
    // la muda al body). Es idempotente: se monta la primera vez que aparece.
    montarBarraEmergente();
    refrescarBarraEmergente();
}

/* El chip de rescate del coordinador se muestra si ALGUNA capa quedo oculta.
   En la cascada la puerta del panel de productos vive en la tira (siempre
   visible, tambien en compacto), asi que su revive › esta oculto por CSS y el
   chip podia quedar flotando VACIO en la esquina. Si no le queda ningun boton
   con funcion, se va. */
function limpiarAncla() {
    const anchor = document.getElementById("ekkoPanelAnchor");
    if (!anchor || !anchor.classList.contains("is-visible")) return;
    const util = [...anchor.querySelectorAll(".panel-anchor-btn")].some(b =>
        b.id !== "ekkoPanelAnchorProducts" && getComputedStyle(b).display !== "none");
    if (!util) anchor.classList.remove("is-visible");
}

function enlazar() {
    // Recientes: captura, sin frenar nada; los botones bloqueados (P) no
    // disparan click, asi que solo el uso REAL alimenta la lista. Las dos
    // superficies de edicion (cinta y barra emergente) comparten la memoria.
    document.addEventListener("click", (ev) => {
        if (!ev.target.closest) return;
        const dentro = ev.target.closest("#ekkoCascadeTools, #contextual-toolbar");
        if (!dentro) return;
        const btn = ev.target.closest("button");
        if (!btn || btn.id === "ekkoFbMas") return;   // el ⋯ no es una herramienta
        registrarUso(claveUso(btn));
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

    // El chip de rescate esta en el BODY (fuera de la barra), asi que el
    // observador de #topBar no lo ve: se vigila aparte para que nunca flote
    // vacio. Es idempotente: al quitarle is-visible vuelve a entrar, ve que ya
    // no esta visible y sale sin tocar nada.
    const ancla = document.getElementById("ekkoPanelAnchor");
    if (ancla) new MutationObserver(limpiarAncla)
        .observe(ancla, { attributes: true, attributeFilter: ["class", "style"] });

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
