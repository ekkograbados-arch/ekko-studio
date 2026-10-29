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
     HERRAMIENTAS (fila 2)  LA CINTA: los GRUPOS REALES que arma
                    ui/ribbonLayout.js, adoptados completos (nunca clonados ni
                    desarmados): cuerpo arriba, etiqueta de grupo DEBAJO y pelo
                    vertical entre grupos. El motor sigue mandando que se ve
                    (.is-empty del propio sync) y que se bloquea (familia P).
                    Dentro de cada grupo, lo mas usado del contexto se adelanta.
     SECTOR         Las 3 primeras recientes del contexto forman su PROPIO
     "MAS USADAS"   GRUPO etiquetado "Más usadas", al arranque de la cinta. Son
                    los BOTONES REALES mudados desde su grupo de origen, con
                    vuelta garantizada cuando dejan del ranking: la cinta no se
                    desarma y ningun control se duplica.
     BOTON HEROE    En cada grupo, el primer boton visible se agiganta (icono
                    arriba del nombre, 44px) y sus companeros quedan en pila de
                    21px al lado: la jerarquia de Office, dicha con tamano y no
                    con sombras.
     BARRA EMERGENTE El mismo lenguaje, pero como ATAJO del objeto: una sola
                    fila (nowrap), SOLO ICONOS (el nombre queda en la cinta y en
                    el tooltip), las FB_EN_VISTA mas usadas a la vista y ⋯ para
                    el resto (medido: mostraba 19 botones con texto de golpe).
                    La rueda del mouse la desplaza en horizontal. Los grupos que
                    escribe el motor se respetan: solo se reordenan y se esconden
                    de mas.
     PANEL DE PARAMETROS (nivel 3)  commandParameters.js lo abre solo y lo
                    centra en el lienzo; aca se re-ancla como POPOVER debajo
                    de la fila de herramientas con un diente que apunta al
                    boton pulsado. Se vuelca hacia arriba si no entra, sigue
                    a su boton al scrollear o redimensionar, y se rinde si el
                    cliente lo arrastra del asa.
     ALTURA FIJA    La banda de la cinta mide siempre 66px (44 de cuerpo +
                    etiqueta): seleccionar un objeto ya no corre el lienzo.
     PIEL PLANA     Nivel 0 (la tira) conserva el vidrio; la cinta y la barra
                    emergente se aplanan como en Word/Office: sin textura, sin
                    blur, sin las 6 capas de sombra por boton, radio chico,
                    hover de relleno y el acento reservado al boton con estado.
                    Las pestanas pasan de pastilla a solapa con la linea de
                    acento abajo. El boton de tema de la cascada escribe ahora
                    TAMBIEN data-modo (dueno de ekko-espacio.css), para que piel
                    y prototipo no pinten cada uno en un modo distinto.

   ACTIVACION: ?cascade=1 memoriza el prototipo, ?cascade=0 lo apaga, o
   localStorage ekko.cascadePrototype="1". Sin flag el modulo no carga y la
   app se comporta exactamente igual que hoy.
   ========================================================================= */

import { TABS, SPECIES, detectTab, speciesOf, isProductElement } from "./capabilities.js";
import { isContainmentWrapper } from "./designGeometry.js";

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
    const nuevo = (ahora === id) ? "auto" : id;   // 2.º clic = volver a Inicio
    if (nuevo !== "auto" && nuevo !== "base" && nuevo !== "multiple") apuntarEspecie(nuevo);
    if (window.EKKO_PANEL_STATE) window.EKKO_PANEL_STATE.activeTab = nuevo;
    persistirTab(nuevo);
    window.EKKO_RIBBON && window.EKKO_RIBBON.refresh && window.EKKO_RIBBON.refresh();
    renderTabs();
    refrescarFila();
}

/* Una pestana de especie sin objeto de esa especie apuntado no tiene nada que
   mostrar en el nivel 2 (las herramientas trabajan SOBRE algo). Si en el lienzo
   hay contenido de ese tipo y ninguno esta seleccionado, se apunta el primero
   con la API publica del motor. Si ya hay algo de esa especie seleccionado, no
   se toca nada: el cliente eligio cual. */
function apuntarEspecie(tab) {
    const sel = seleccionActual();
    if (sel.some(it => TAB_DE_ESPECIE[speciesOf(it)] === tab)) return;
    const objetivo = contenidoDelLienzo().objetivos.get(tab);
    if (!objetivo) return;
    if (typeof window.selectItem === "function") window.selectItem(objetivo);
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

/* Que ES lo que hay seleccionado, para la barra emergente. capabilities llama
   "base" a todo lo que no le devuelve una especie clara (medido: un recorte de
   la chapa, que es mockup de si mismo, dice base y la tira muestra solo
   Inicio). La pestana puede decir Inicio, pero la barra igual tiene que dar
   los iconos del objeto: se mira la clase real de Paper como red. */
function especieDeLaSeleccion() {
    const det = detectTab(seleccionActual());
    if (det && det !== "base") return det;
    const it = window.selectedItem;
    if (!it) return "base";
    if (it.className === "PointText") return "text";
    if (it.className === "Raster" || (it.data && it.data.isRaster)) return "image";
    return det || "base";
}

/* ------------------------------------------------------------------ */
/* Que HAY en el lienzo (ronda 7)                                       */
/* ------------------------------------------------------------------ */
/* tabsForSelection() mira solo lo seleccionado. El pedido del cliente es otro:
   "si cargo una imagen tiene que aparecer la pestana Imagen al lado de Inicio,
   segun se vayan cargando". O sea que la pestana nace con el OBJETO EN EL
   LIENZO, no cuando el cliente lo apunta. Se recorre la CAPA de diseno y se
   clasifica con el mismo motor (speciesOf), descartando la base del producto
   (isProductElement): si no, el contorno de la chapa abriria una pestana
   "Vector" en todo proyecto. El primero de cada tipo se guarda porque la
   pestana de especie necesita un blanco real para que el nivel 2 tenga que
   mostrar (ver elegirPestaña). */
const TAB_DE_ESPECIE = { [SPECIES.RASTER]: "image", [SPECIES.TEXT]: "text", [SPECIES.VECTOR]: "vector" };
function contenidoDelLienzo() {
    const especies = new Set();
    const objetivos = new Map();
    const mockup = window.currentMockup;
    /* MEDIDO (ronda 7): lo que carga el cliente NO esta dentro de currentMockup
       (la chapa y sus trazos son parte del producto). Vive en la CAPA DE DISENO,
       como hermano del mockup y envuelto en un clipGroup de contencion
       (mockupLoader.createMockupContainmentGroup). La capa se toma con la misma
       formula canonica del resto del codigo (editor.js:155) pero sobre el PROPIO
       proyecto del mockup: window.paper.project puede apuntar a otro proyecto y
       devolver una capa vacia. */
    const proj = (mockup && mockup.project) || (window.paper && window.paper.project);
    const capa = proj ? ((proj.layers || []).find(l => l && l.name === "designLayer") || proj.activeLayer) : null;
    if (!capa) return { especies, objetivos };
    const registrar = (tab, item) => {
        especies.add(tab);
        if (!objetivos.has(tab)) objetivos.set(tab, item);
    };
    const visitar = (n, prof) => {
        if (!n || !n.children || prof > 4) return;
        n.children.forEach(h => {
            if (!h) return;
            /* Un envoltorio de contencion NO es parte del producto: es una
               indirection. designGeometry lo dice literalmente ("its public
               child must remain selectable"), y ahi vive lo que el cliente
               carga. Si se lo descarta como producto, el lienzo parece vacio y
               no abre ninguna pestana — el bug que trajo la ronda 7. */
            if (isContainmentWrapper(h)) { visitar(h, prof + 1); return; }
            if (isProductElement(h)) return;          // chapa, mascaras, marcos
            const tab = TAB_DE_ESPECIE[speciesOf(h)];
            if (tab) { registrar(tab, h); return; }   // pieza: no se desarma
            visitar(h, prof + 1);                      // contenedor: se mira adentro
        });
    };
    visitar(capa, 0);
    return { especies, objetivos };
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
            /* El menu desplegable cuelga del wrap: si el wrap no sube, el
               menu vive encapsulado en SU contexto de apilamiento y pierde
               contra reglas y barras por mas z-index propio que pida.
               PELOTEO SIEMPRE ARRIBA DE TODO (regla del cliente). */
            z-index: 2147483000 !important;
        }
        #ekkoCascadeStrip #ekkoDownloadMenu { z-index: 2147483000; }

        /* El chip de rescate del coordinador esta fijo en la esquina superior
           derecha; con la tira armada esa esquina la ocupa Descargar y se
           montaban uno sobre otro. Se estaciona en el aire libre entre la tira
           (fila 1) y las herramientas (fila 2). Sigue en el body, afuera de
           todo panel, asi conserva su funcion cuando la barra se oculta. */
        body[data-ekko-cascade="1"] #ekkoPanelAnchor { top: 56px !important; }
        /* Ronda 5.1: con la cinta armada el panel superior mide 114px de alto
           (medido: top 10, bottom 124), asi que el chip estacionado en 56 caia
           ENCIMA de los botones cuando lo que esta oculto es la barra emergente
           y no el panel. 56px sigue siendo la respuesta cuando el panel esta
           oculto o compacto — ahi no tiene nada arriba que esquivar. */
        body[data-ekko-cascade="1"]:has(#topBar:not(.is-hidden):not(.is-compact)) #ekkoPanelAnchor {
            top: 130px !important;
        }
        /* En compacto el panel mide 48px y termina en 58 (medido): el chip a 56
           lo rozaba 2px. Se estaciona justo debajo. */
        body[data-ekko-cascade="1"]:has(#topBar.is-compact) #ekkoPanelAnchor {
            top: 64px !important;
        }
        /* ... y el revive › del panel de productos SOBRA en la cascada: ese
           panel se abre y se cierra desde UN unico lugar (el boton a la
           izquierda de "Inicio"), que esta visible incluso en modo compacto.
           Dos puertas para el mismo panel confunden al cliente. El chip
           conserva ⌄ (barra superior oculta) y ≡ (barra emergente oculta),
           que si no se pierden: al ocultar la barra se oculta tambien la tira
           y quedaria sin salida. */
        body[data-ekko-cascade="1"] #ekkoPanelAnchorProducts { display: none !important; }
        /* ... y por la misma razon se apagan LOS OTROS dos portones del mismo
           panel: el ‹ del encabezado de Productos (btnHideProductPanel, que
           ademas es unidireccional: solo oculta, no devuelve) y el chip
           "› Productos" que el coordinador muestra cuando el panel esta
           escondido (productPanelHandle). Medido con la tira armada: ‹ en x=215
           y la puerta real en x=285, los dos a la vista en el mismo instante.
           En la cascada el panel de productos tiene UNA puerta, siempre en el
           mismo lugar, y hace las dos cosas. */
        body[data-ekko-cascade="1"] #btnHideProductPanel,
        body[data-ekko-cascade="1"] #productPanelHandle { display: none !important; }

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
               empieza en la tira; la cinta nace con el objeto:
               cargar -> seleccionar -> trabajar.
               Ronda 5: se esconde el GRUPO ENTERO, no solo sus botones. Con
               .btn-action a display:none quedaban las 8 etiquetas de los grupos
               flotando solas sobre la banda vacia, que es justo el aspecto de
               interfaz rota que el cliente no perdona.
               Ronda 6: el grupo CREAR es la excepcion. Cargar / Agregar Texto /
               QR ya no viven en la tira (mezclarse con las pestañas fue el
               "no se entiende donde terminan las pestañas" del cliente) y son
               justamente las acciones que SI tienen sentido sin seleccion:
               es la manera de empezar. */
        #topBar.ekko-cascade.ekko-sin-seleccion #ekkoCascadeTools > .ekko-ribbon-group:not([data-group="creacion"]) { display: none !important; }
        #topBar.ekko-cascade.ekko-sin-seleccion #ekkoCascadeTools > button { display: none !important; }

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

        /* --- BARRA EMERGENTE SOLO ICONOS (ronda 5) ---
               El pedido fue literal: "resume todo a iconos que resuelvan de
               manera intuitiva lo que el cliente puede hacer con un objeto
               seleccionado". El texto NO se borra del DOM: soloIconos() lo
               envuelve en .ekko-fb-txt y aca se esconde, asi que el nombre
               sigue siendo el nombre accesible del boton y el tooltip (title,
               que la app ya escribe en cada uno) lo devuelve al pasar el
               puntero. La letra chica se deja cuando el glifo de 1-2 caracteres
               es parte del significado (.ekko-queda: el + / - de Subir/Bajar
               capa, que comparten icono). Medido: con el nombre a la vista cada
               boton media ~90px; escondido pasa a ~32px, o sea 3 veces mas
               acciones en el mismo aire.
               Este hoja SOLO se inyecta con el prototipo armado (?cascade=1),
               por eso la regla no necesita el guard body[data-ekko-cascade]. */
        #contextual-toolbar .ekko-fb-txt { display: none !important; }
        #contextual-toolbar .ekko-fb-txt.ekko-queda { display: inline !important; }
        /* Cuadrados parejos: con el texto fuera, el boton se achica al glifo.
           min-width + padding igual = la barra se lee como una hilera de
           iconos, no como pastillas de ancho distinto. */
        #contextual-toolbar.ekko-cascade-fb .toolbar-btn {
            min-width: 32px;
            justify-content: center;
            height: 30px;
            padding-left: 7px;
            padding-right: 7px;
            gap: 4px;
            font-size: 12px;
        }
        /* El vidrio de la barra es el nivel del atajo; los botones de adentro
           se aplanan (el mismo lenguaje de la cinta) para que el icono sea lo
           unico que se mira. Medido en ekko-espacio.css: cada uno llevaba 6
           capas de sombra y blur, que a 32px de ancho son todo ruido. */
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn {
            background: transparent !important;
            border: 1px solid transparent !important;
            border-radius: 7px !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            transform: none !important;
            color: rgba(226,232,240,0.9) !important;
        }
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn:hover {
            background: rgba(255,255,255,0.14) !important;
            color: #fff !important;
        }
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn.active,
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn.is-on,
        body[data-ekko-cascade="1"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn[aria-pressed="true"] {
            background: rgba(255,46,166,0.2) !important;
            border-color: rgba(255,46,166,0.55) !important;
            color: #fff !important;
        }
        /* De dia (tanto del skin data-modo como del botón de tema del
           prototipo data-ekko-theme): tinta oscura sobre la barra clara. Sin
           la segunda, los glifos quedaban gris clarisimo sobre blanco. */
        body[data-modo="claro"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn,
        body[data-ekko-theme="claro"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn {
            color: #3d4c63 !important;
        }
        body[data-modo="claro"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn:hover,
        body[data-ekko-theme="claro"] #contextual-toolbar.ekko-cascade-fb .toolbar-btn:hover {
            background: rgba(15,23,42,0.08) !important;
            color: #10182a !important;
        }


        /* --- CAMPOS DEL OBJETO DENTRO DE LA BARRA (ronda 5.1) ---
               Medido en el arnés: la barra emergida medía 1500x113 y se veía
               como un panel aplastado, no como el atajo del objeto. Dos causas,
               las dos del propio motor:
               1) .toolbar-group es un DIV sin regla (display:block), así que
                  cada <label> cae en su propia línea y el ancho del grupo lo
                  fija la barra entera en vez de fijarlo su contenido.
               2) styles.css esconde los campos de TEXTO (Tamaño, Radio, Ángulo
                  de curvado, Espacio) con el selector
                  #topBar[data-ekko-texto="no"] .size-control-group > *:has(...).
                  Por estar anclado a #topBar NO alcanza a la barra flotante:
                  los seis campos de tipografía seguían a la vista sobre
                  cualquier vector.
               Acá el grupo pasa a fila, el cuadro numérico se achica a lo que
               dice (175px -> 62px) y la regla de texto se re-escribe anclada al
               body con :has(), que es la única forma de gobernar las dos
               superficies desde un solo atributo del motor. */
        body[data-ekko-cascade="1"] #contextual-toolbar .toolbar-group,
        body[data-ekko-cascade="1"] #ekkoCascadeTools .toolbar-group {
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        body[data-ekko-cascade="1"] #contextual-toolbar .toolbar-number-label,
        body[data-ekko-cascade="1"] #ekkoCascadeTools .toolbar-number-label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 10.5px;
            line-height: 1;
            white-space: nowrap;
        }
        body[data-ekko-cascade="1"] #contextual-toolbar .toolbar-input-number,
        body[data-ekko-cascade="1"] #ekkoCascadeTools .toolbar-input-number {
            width: 62px !important;
            min-width: 0;
            padding: 3px 5px;
            font-size: 11px;
        }
        body[data-ekko-cascade="1"] #contextual-toolbar .toolbar-slider-container,
        body[data-ekko-cascade="1"] #ekkoCascadeTools .toolbar-slider-container {
            flex: 0 0 120px;
            width: 120px;
        }
        /* El slider en UNA linea (medido en shot-r6c-texto): el contenedor es un
           <div> de bloque y el <input type=range> sin ancho propio mide ~129px
           de Chrome, o sea mas que los 120px de la caja — el readout ("0°")
           caia a la segunda linea y le pegaba encima de la etiqueta del grupo.
           Flex + range elastico: icono, barra y valor comparten la linea. */
        body[data-ekko-cascade="1"] :is(#contextual-toolbar, #ekkoCascadeTools) .toolbar-slider-container {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            height: 22px;
        }
        body[data-ekko-cascade="1"] :is(#contextual-toolbar, #ekkoCascadeTools) .toolbar-slider-container input[type="range"] {
            flex: 1 1 auto;
            min-width: 0;
            width: auto;
        }
        body[data-ekko-cascade="1"] :is(#contextual-toolbar, #ekkoCascadeTools) .toolbar-slider-container .toolbar-angle-readout {
            flex: 0 0 auto;
        }
        body[data-ekko-cascade="1"] #contextual-toolbar .toolbar-angle-readout,
        body[data-ekko-cascade="1"] #ekkoCascadeTools .toolbar-angle-readout {
            font-size: 10.5px;
        }
        /* El grupo Objeto de la cinta NO usa el molde de botones del resto: sus
           hijos son campos, y column-wrap los apilaria de a dos por columna
           dentro de los 44px. Aca van en una sola fila, centrados. */
        #ekkoCascadeTools .ekko-ribbon-group[data-group="objeto"] .ekko-ribbon-group-body {
            flex-flow: row nowrap;
            align-items: center;
            height: 30px;
            min-height: 30px;
            max-height: none;
            gap: 8px;
        }
        /* El grupo Objeto ABRIR la cinta, no cerrarla. Es lo unico que cambia
           de verdad sobre lo seleccionado (medidas, fuente, tamano) y la cinta
           desplaza: clavado al fondo, con un texto seleccionado el campo de la
           fuente quedaba afuera de la ventana (medido: 1766px de contenido en
           una fila de 1114). Orden -1 = primera columna, sin mover nodos. */
        #ekkoCascadeTools .ekko-ribbon-group[data-group="objeto"] {
            order: -1;
        }
        /* Ronda 6, punto 1: la TIPOGRAFIA pasa a tener UNA sola superficie en
           cascada, que es #ctxTextControls: fuente, tamaño, negrita, curvar y
           espaciado juntos en un bloque. El trío obj* de .size-control-group es
           el espejo viejo del mismo valor (rotationController.js:28 y
           contextualMenu.js:834-851 escriben Y escuchan en las dos ids, asi que
           borrar una no apaga nada), y tener las dos series a la vez duplicaba
           Tamano/Radio/Espacio y estiraba el grupo Objeto hasta 2078px.
           Por eso los obj* salen SIEMPRE en cascada, no solo sin texto. */
        body[data-ekko-cascade="1"] :is(#contextual-toolbar, #ekkoCascadeTools)
            .size-control-group > :is(
                label:has(#objFontSize),
                label:has(#objCurveRadius),
                label:has(#objTextSpacing),
                label:has(.toolbar-angle-readout),
                #objTextSpacingSlider) {
            display: none !important;
        }
        /* Los VALORES de texto afuera de la cinta cuando lo seleccionado no es
           texto. Se decide por data-ekko-texto, que escribe
           refreshTextControlsVisibility ANTES del early-return de
           updateContextualMenu (linea 1008): con contenido mockup el motor ni
           llega a tocar las clases de las cajas. */
        body[data-ekko-cascade="1"]:has(#topBar[data-ekko-texto="no"]) #ekkoCamposTexto {
            display: none !important;
        }
        /* LAS CAJAS POR ESPECIE DE LA BARRA. #ctxTextControls (Negrita,
           Cursiva, Subrayado, Soldar, Curvar, Girar letras) y #ctxImageControls
           (Espejo H/V) nacen en el HTML con la clase .hidden y el motor NUNCA
           se la saca sobre contenido real: updateContextualMenu sale temprano
           para cualquier item con data.mockup — y todo lo que hay en la mesa
           de EKKO lo trae heredado del grupo de la chapa — antes de llegar a
           hideSubgroup/remove. O sea que en production estos seis iconos de
           texto y los espejos jamas se vieron en la barra flotante.
           En cascada la caja se enciende segun el tipo de objeto que la barra
           ya calcula (data-ekko-especie = la pestana que deduce capabilities),
           que es exactamente lo que esa clase queria decir.
           #ctxNodeEditControls NO se toca: su estado es el modo de edicion de
           nodos, no la especie, y ahi el motor si lo gobierna bien. */
        body[data-ekko-cascade="1"] #contextual-toolbar[data-ekko-especie="text"] #ctxTextControls,
        body[data-ekko-cascade="1"] #contextual-toolbar[data-ekko-especie="image"] #ctxImageControls {
            display: flex !important;
        }
        /* El slider de espaciado y el campo "Espacio" de la cinta son el MISMO
           valor (experienciaInput.js los espeja por id). En la cinta gana el
           numero, que es el que se puede escribir con precision para soldar; el
           slider baja de la barra para que la tira quede solo con iconos. */
        body[data-ekko-cascade="1"] #ctxTextSpacingSlider {
            display: none !important;
        }
        /* La caja de campos de texto vive ahora dentro de la banda de 30px de
           la cinta: sin esto heredaria el display:block de .toolbar-subgroup y
           cortaria la fila. */
        #ekkoCamposTexto {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            height: 30px;
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

        /* --- CINTA (fila 2): los GRUPOS REALES de ribbonLayout ---
               Ronda 5: la fila deja de ser una bolsa de botones y vuelve a
               ser una cinta. El motor (ui/ribbonLayout.js) ya arma UN
               .ekko-ribbon-group por grupo del manifiesto, con su cuerpo y su
               etiqueta DEBAJO (order:2) y su sync() enciende .is-empty; este
               prototipo ADOPTA el nodo grupo entero, no lo desarma. Medido en
               la cinta original: 8 grupos, etiquetas Crear / Imagen / Texto /
               Estructura / Geometria / Composicion / Booleanas / Vista. */
        #ekkoCascadeTools {
            display: flex;
            align-items: flex-start;
            gap: 0;
            width: 100%;
            overflow-x: auto;
            scrollbar-width: none;
            padding: 4px 2px 2px 2px;
            /* ALTURA FIJA (medido): sin esta reserva la banda media 6px con el
               lienzo vacio y 33px al seleccionar, asi que cada clic sobre un
               objeto corria el canvas ~27px hacia abajo. Con la cinta por
               grupos pasa lo mismo pero mas fuerte (44 de cuerpo + 13 de
               etiqueta): la banda SE RESERVA y no se arma al seleccionar. La
               geometria que no se mueve es la que el cliente aprende a golpear
               de memoria. 66 = 4 (padding) + 44 (cuerpo) + 2 + 13 (etiqueta)
               + 3 de aire, con box-sizing para que el padding no sume extra. */
            box-sizing: border-box;
            min-height: 66px;
        }
        #ekkoCascadeTools::-webkit-scrollbar { display: none; }
        #ekkoCascadeTools .ekko-ribbon-group { flex: 0 0 auto; }
        #ekkoCascadeTools .btn-action { flex: 0 0 auto; }

        /* La pista de la banda vacia: con el lienzo sin seleccion la cinta
               no tiene herramientas de objeto (las esconde el motor de la
               cascada), y un rectangulo de 66px sin nada se lee como "roto".
               Una linea dice que falta: elegir un objeto. */
        #ekkoCascadeTools .ekko-fila-pista {
            display: none;
            align-self: center;
            font-size: 12px;
            color: rgba(226,232,240,0.5);
            padding: 0 6px;
            white-space: nowrap;
        }
        #topBar.ekko-cascade.ekko-sin-seleccion #ekkoCascadeTools .ekko-fila-pista { display: block; }
        /* La pista va DESPUES de Crear (ronda 6): con la cinta mostrando el
           grupo de creacion, la frase de ayuda detras del boton es un pie de
           pagina; adelante parecia que el boton era parte del aviso. */
        #ekkoCascadeTools .ekko-fila-pista { order: 99; }
        body[data-modo="claro"] #ekkoCascadeTools .ekko-fila-pista { color: rgba(46,58,89,0.55); }

        /* --- CUERPO DEL GRUPO EN COLUMNA QUE ENVUELVE (el dibujo de Office) ---
               flex-flow: column wrap sobre un alto fijo de 44px: el boton
               HEROE (44) ocupa su columna entero y los companeros (21 + 2 de
               gap) se apilan de a dos por columna y siguen de largo en la
               columna siguiente. Es exactamente el molde de Word/Office
               (uno grande + pila de chicos) sin crear, clonar ni duplicar
               ningun nodo: solo cambia como se reparten los que ya existen.
               La guarda :not(.is-collapsed) es a propósito: deja que el
               .is-collapsed del motor anime el max-height:0 de arriba abajo
               (ekko-ribbon.css linea 132) sin que el alto fijo lo pele. */
        #ekkoCascadeTools .ekko-ribbon-group:not(.is-collapsed) .ekko-ribbon-group-body {
            display: flex;
            flex-flow: column wrap;
            align-items: flex-start;
            align-content: center;
            box-sizing: border-box;
            height: 44px;
            min-height: 44px;
            max-height: 44px;
            gap: 2px 6px;
            width: max-content;
        }

        /* El pelo vertical que separa un grupo del siguiente: ekko-ribbon.css
               ya lo pinta (border-right), pero con el gris del tema claro que
               sobre la barra de noche desaparece. Se le cambia el tinte, no la
               regla. El ultimo grupo no tiene borde: la tira de herramientas
               ya cierra con el boton de tema. */
        #ekkoCascadeTools .ekko-ribbon-group {
            padding: 0 8px 0 6px;
            border-right: 1px solid rgba(148,163,184,0.26);
        }
        #ekkoCascadeTools .ekko-ribbon-group:last-of-type { border-right-color: transparent; }
        body[data-modo="claro"] #ekkoCascadeTools .ekko-ribbon-group { border-right-color: rgba(46,58,89,0.16); }

        /* Etiqueta del grupo (arriba la gobierna el motor: es un boton con
           title "Plegar / desplegar"). De noche el #5b6b7c del skin no se lee
           sobre la barra; se sube la tinta y se baja el chevron de plegado a
           un susurro que solo se ve cuando el puntero pasa por el grupo, para
           que la cinta no parezca un teclado de ascensor. */
        #ekkoCascadeTools .ekko-ribbon-group-head {
            color: rgba(226,232,240,0.58);
            font-size: 10px;
        }
        #ekkoCascadeTools .ekko-ribbon-group-head::before { opacity: 0.22; }
        #ekkoCascadeTools .ekko-ribbon-group:hover .ekko-ribbon-group-head::before { opacity: 0.75; }
        #ekkoCascadeTools .ekko-ribbon-group-head:hover { color: #ff2ea6; }
        body[data-modo="claro"] #ekkoCascadeTools .ekko-ribbon-group-head { color: #5b6b7c; }
        /* MEDIDO (shot-r6d-texto): en modo claro los nombres de grupo —OBJETO,
           CREAR, VISTA— salían BLANCOS sobre la banda clara, o sea invisibles,
           y por eso "no se entiende dónde empieza y termina cada bloque". La
           culpa no es de la cascada: ekko-espacio.css:1116 pinta el rótulo con
           "color: rgba(255,255,255,.96) !important" y una sombra en relieve
           pensada para el vidrio oscuro de noche. Acá se gana con la misma
           arma (mas especificidad + !important) SOLO en claro: tinta neutra
           legible y cero sombra, que sobre fondo claro ensucia. */
        body[data-ekko-cascade="1"][data-modo="claro"] #ekkoCascadeTools .ekko-ribbon-group-head:not(:hover) {
            color: #4d5f74 !important;
            text-shadow: none !important;
        }
        /* Mismo origen, mismo bug: los títulos del panel izquierdo (PRODUCTOS,
           CATEGORÍAS, VISTAS) usan la MISMA regla de ekko-espacio.css:1116 y en
           claro quedaban blancos sobre fondo claro. Se corrige en cascada, que
           es donde el modo claro ya es el arranque por defecto. */
        body[data-ekko-cascade="1"][data-modo="claro"] #leftSidebar .panel-title,
        body[data-ekko-cascade="1"][data-modo="claro"] #leftSidebar .sidebar-title {
            color: #4d5f74 !important;
            text-shadow: none !important;
        }


        /* --- MOLDE PLANO DE LOS BOTONES (el aire de Word) ---
               Medido sobre ekko-espacio.css: cada boton de la fila llevaba 6
               capas de box-shadow, textura de ruido, blur y radio 12. Sobre la
               tira de inicio eso esta bien (es el nivel 0, la puerta), pero
               repetido 19 veces en la cinta no deja leer NINGUN nombre: parece
               un collar de cuentas, no un catalogo. Aca el vidrio se queda
               arriba y la cinta se aplana: fondo limpio, hover solo de relleno,
               radio chico, y el color de acento reservado para lo que tiene
               estado (toggle activo). La jerarquia NO la da la sombra: la da el
               tamano (heroe 44 / companero 21) y el grupo con etiqueta.
               La especificidad es obligada: la piel pinta con !important desde
               #topBar .btn-action (1 id + 1 clase); esto es 2 ids + 2 clases y
               ademas el hoja va DESPUES en el head, asi gana en ambos casos. */
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action {
            background: transparent !important;
            border: 1px solid transparent !important;
            border-radius: 5px !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            transform: none !important;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            height: 21px;
            padding: 0 5px !important;
            box-sizing: border-box;
            font-size: 11px !important;
            font-weight: 500 !important;
            line-height: 19px;
            white-space: nowrap;
            color: rgba(226,232,240,0.9) !important;
        }
        /* ICONO 13 sobre la misma linea del nombre (el companero de Word). */
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action .ekko-ic {
            width: 13px; height: 13px;
        }
        /* --- BOTON HEROE DEL GRUPO (la jerarquia de Office) ---
               El primer boton visible de cada grupo se agiganta: icono arriba,
               nombre abajo (2 lineas si hace falta) y los 44px enteros de la
               columna. Es lo primero que se busca con la mirada cuando el
               grupo trae muchos comandos. Lo decide la cinta, no el azar: ver
               pintarHeroes(). */
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action.ekko-es-heroes {
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 2px;
            height: 44px;
            min-width: 52px;
            /* 96px y glifo de 16: la banda mide 44px y el cuerpo tiene
               overflow hidden. Con glifo de 19 + 3px de hueco quedaban 22px
               para el texto, o sea UNA linea de 10.5px — y "Cargar Imagen /
               SVG" necesita dos, asi que el SVG se cortaba a la mitad (se veia
               en la captura de la ronda 6). 44 - 16 - 2 - 4 de padding = 22px
               = dos lineas justas. */
            max-width: 96px;
            padding: 2px 6px !important;
            font-size: 10px !important;
            line-height: 1.05;
            white-space: normal;
            text-align: center;
        }
        #topBar.ekko-cascade #ekkoCascadeTools .btn-action.ekko-es-heroes .ekko-ic {
            width: 16px; height: 16px;
        }
        /* --- CREAR / CARGAR EN GRANDE (ronda 7, punto 3) ---
               Medido sobre la captura del cliente: en reposo la cinta muestra
               SOLO el grupo Crear (la regla .ekko-sin-seleccion de arriba) y
               aun asi los tres botones ocupaban 156px de una fila de 1114 — el
               espacio estaba ahi y la puerta del proyecto se veia como un pie
               de pagina. Pasan a mosaico: alto entero de la banda, glifo de 22
               y nombre de 12px. Y cuando la familia crezca (lineas y formas,
               que siguen) y no entre, NO se achica el boton: la fila ya tiene
               carretel (armarPan pone las flechas y se desliza). */
        #topBar.ekko-cascade #ekkoCascadeTools .ekko-ribbon-group[data-group="creacion"] .ekko-ribbon-group-body {
            gap: 10px;
        }
        #topBar.ekko-cascade #ekkoCascadeTools .ekko-ribbon-group[data-group="creacion"] .btn-action {
            flex: 0 0 auto;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 3px;
            height: 44px;
            min-width: 92px;
            max-width: 132px;
            padding: 3px 10px !important;
            font-size: 12px !important;
            line-height: 1.15;
            white-space: normal;
            text-align: center;
        }
        #topBar.ekko-cascade #ekkoCascadeTools .ekko-ribbon-group[data-group="creacion"] .btn-action .ekko-ic {
            width: 22px; height: 22px;
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
        /* De dia la misma cinta, con tinta azul-gris sobre el vidrio claro. */
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
        /* El boton de tema de la cascada NO vive dentro de #ekkoCascadeTools
           (es hermano de la fila, para que la regla "sin seleccion" no lo
           esconda), asi que el molde plano de arriba no lo alcanza. Se lo
           vestido a mano con las mismas medidas del companero: si un vecino
           de fila se ve plano y el de al lado esmerilado con 6 sombras, la
           fila se lee desordenada. */
        #ekkoToolsShell > #btnEkkoTema {
            background: transparent !important;
            border: 1px solid transparent !important;
            border-radius: 5px !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            transform: none !important;
            height: 26px;
            padding: 0 8px !important;
            font-size: 11.5px !important;
            font-weight: 500 !important;
            line-height: 24px;
            color: rgba(226,232,240,0.9) !important;
        }
        #ekkoToolsShell > #btnEkkoTema:hover {
            background: rgba(255,255,255,0.13) !important;
            color: #fff !important;
            transform: none !important;
        }
        body[data-modo="claro"] #ekkoToolsShell > #btnEkkoTema { color: #3d4c63 !important; }
        body[data-modo="claro"] #ekkoToolsShell > #btnEkkoTema:hover {
            background: rgba(15,23,42,0.08) !important;
            color: #10182a !important;
        }

        /* --- GRUPO "MAS USADAS" (fila 2, el primero) ---
               Los recientes dejan de ser puntitos repartidos por la cinta (en
               la ronda 4 el sector se leia como ruido: 3 puntos sueltos entre
               21 nombres) y pasan a ser UN GRUPO MAS, con su etiqueta abajo
               como los demas. Adentro hay BOTONES REALES movidos desde su grupo
               de origen, con vuelta garantizada: cuando una herramienta deja de
               estar entre las 3 del contexto, regresa al grupo donde nacio
               (ver sincronizarGrupoRecientes). No se duplica ningun control.
               La etiqueta se pinta de acento para que el grupo se distinga del
               catalogo sin necesidad de un panel nuevo. */
        #ekkoCascadeTools .ekko-ribbon-group[data-group="recientes"] .ekko-ribbon-group-head {
            color: #ff2ea6;
        }
        #ekkoCascadeTools .ekko-ribbon-group[data-group="recientes"] {
            border-right-color: rgba(255,46,166,0.35);
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
/* Cada carretel anota su propia funcion de visibilidad. MEDIDO (ronda 7): con
   la cinta desbordando (1868 de 1114) la › seguia invisible, porque el
   desborde aparece al cambiar la clase .ekko-sin-seleccion del topBar — un
   atributo AFUERA del scroller que ni el ResizeObserver (mismo tamano) ni el
   MutationObserver (solo childList) ven. refrescarDocumento() las re-pregunta
   a todas, que es justo cuando la fila cambia de contenido. */
const losPanes = [];
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
    losPanes.push(() => {
        if (!document.contains(scroller)) return false;   // se desmonto: se borra solo
        visibilidad();
        return true;
    });
    visibilidad();
}

function refrescarPanes() {
    for (let i = losPanes.length - 1; i >= 0; i--) {
        if (!losPanes[i]()) losPanes.splice(i, 1);
    }
}

/* ------------------------------------------------------------------ */
/* Nivel 0: tira de inicio                                              */
/* ------------------------------------------------------------------ */
function montarStrip() {
    strip = document.createElement("div");
    strip.id = "ekkoCascadeStrip";

    /* Ronda 6: la CREACION YA NO VIVE EN LA TIRA. Ronda 5 las tenia aca, y el
       cliente lo leyó mal: "no se entiende dónde empiezan y terminan las
       pestañas". Mezclar pestañas (Inicio / Texto = en qué contexto estoy
       parado) con acciones (Cargar = qué hago) en la misma fila borra la
       frontera. En Word la fila de pestañas son SOLO pestañas y toda acción
       baja a la cinta, así que Cargar Imagen/SVG, Agregar Texto y QR se van al
       grupo CREAR de la cinta (ui/ribbonLayout.js ya los agrupa ahí por ser el
       bloque original de #topBar: basta con NO sacarlos). La tira pasa a ser
       solo la puerta + las pestañas + las utilidades.
       Regla segura: .btn-action SIN data-fusion-btn y SIN data-ekko-command
       (las booleanas llevan data-ekko-command: no entran, trato común). */
    Array.from(topBar.querySelectorAll("button.btn-action")).forEach(b => {
        if (b.dataset.fusionBtn || b.dataset.ekkoCommand) return;
        if (b.closest("#ekkoDownloadWrap")) return;
        b.dataset.ekkoCrear = "1";
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

    // Las utilidades van al EXTREMO derecho de la tira: IZQUIERDA = la puerta
    // del panel y "Inicio", DERECHA = estado, chevron y Descargar. Crear ya no
    // pasa por aca (bajó a la cinta en la ronda 6).
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
    /* Arranque SIEMPRE claro y SIN MEMORIA (ronda 7, punto 1). El contrato del
       skin es ese: ui/espacio.js:63 aplica 'claro' y ademas BORRA su clave en
       cada carga — "el modo elegido vive solo mientras dura la pagina". La
       ronda 6 guardaba la eleccion en ekko.cascade.tema, asi que un solo 🌙
       tocado una vez hacia que TODAS las visitas siguientes abrieran de noche:
       es exactamente lo que el cliente siguio viendo. Se borra la clave vieja y
       el boton pasa a ser de sesion, como el del skin. */
    try { localStorage.removeItem("ekko.cascade.tema"); } catch (_) {}
    let modo = "claro";
    const pintarTema = () => {
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
        modo = modo === "claro" ? "oscuro" : "claro";
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
    /* Ronda 7, punto 4: a lo que dice la SELECCION se le suma lo que HAY en el
       lienzo. Cargar una imagen ya abre su pestana al lado de Inicio, sin
       necesidad de apuntarla.
       tabsForSelection() NO sirve aca: cuando detecta "multiple" expande image +
       vector + text por las dudas, y asi un texto + una imagen abrian una
       pestana "Vector" que no tiene nada adentro. El pedido del cliente es otro
       ("TEXTOS, IMAGEN Y VARIOS"): las pestanas de especie nacen de las PIEZAS
       QUE EXISTEN, y "Varios" solo cuando lo seleccionado son varias piezas. */
    const det = sel.length ? detectTab(sel) : null;
    const deSeleccion = det === "multiple" ? ["multiple"]
        : (det && det !== "base" ? [det] : []);
    const { especies } = contenidoDelLienzo();
    const disponibles = [...new Set([
        "base",
        ...deSeleccion,
        ...especies
    ])].filter(id => TABS[id]);
    const manual = pestañaActual();

    /* Ronda 7, punto 2: el REPOSO es Inicio. Antes, en "auto", se activaba la
       pestana que deducía la selección, así que al elegir un objeto el panel
       saltaba solo de pestaña y el cliente perdía de vista dónde estaba. Ahora
       la activa es la que el cliente tocó; si no tocó ninguna, Inicio. */
    const activa = manual !== "auto" ? manual : "base";
    topBar.dataset.ekkoTab = activa;

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
            ? `${def.label} — pulsalo de nuevo para volver a Inicio`
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
/* Nivel 1: la CINTA de herramientas (grupos REALES re-parentados)        */
/* ------------------------------------------------------------------ */
function montarFila() {
    const shell = document.createElement("div");
    shell.className = "ekko-cascade-shell ekko-tools-shell";
    shell.id = "ekkoToolsShell";
    fila = document.createElement("div");
    fila.id = "ekkoCascadeTools";
    shell.appendChild(fila);
    topBar.appendChild(shell);

    // La pista de la banda vacia: con el lienzo sin seleccion la cinta no tiene
    // herramientas de objeto y un rectangulo de 66px sin nada se lee "roto".
    const pista = document.createElement("span");
    pista.className = "ekko-fila-pista";
    pista.textContent = "Elegi un objeto del lienzo para ver sus herramientas";
    fila.appendChild(pista);

    // LOS GRUPOS ENTEROS, no los botones sueltos (ronda 5). ui/ribbonLayout.js
    // ya arma la cinta: un .ekko-ribbon-group por grupo del manifiesto, con su
    // cuerpo, su etiqueta DEBAJO (order:2) y su cabeza clickeable para plegar.
    // Adoptar el nodo grupo completo en vez de vaciar el cuerpo trae las tres
    // cosas que la ronda 4 habia tirado por la borda al aplanar: la etiqueta de
    // contexto, el pelo vertical entre grupos y — lo importante — que
    // ribbonLayout.sync() siga decidiendo .is-empty (los grupos que la
    // seleccion no usa desaparecen solos, sin huecos muertos). sync() mide
    // g.el.isConnected y un grupo re-parentado DENTRO de #topBar sigue
    // conectado: el motor no pierde el hilo de sus propios nodos.
    //
    // El layout corre una sola vez (build se guarda con top.dataset.ekkoRibbon),
    // o sea que la adopcion es estable: nadie vuelve a meter los grupos en el
    // cascaron. Si el prototipo arrancara antes que el layout, se fuerza por su
    // API publica antes de adoptar.
    if (topBar.dataset.ekkoRibbon !== "1" && window.EKKO_RIBBON_LAYOUT) {
        try { window.EKKO_RIBBON_LAYOUT.init(); } catch (_) {}
    }
    adoptarGrupos();

    // Los sueltos SIN grupo: un boton sin entrada en el manifiesto quedaria
    // afuera de la cinta y escondido por el display:none del cascaron. Suben a
    // la fila igual, sin etiqueta, para no perder funciones.
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

/* Mueve los grupos de la cinta a la fila 2. Idempotente y barato: corre en
   cada refresco y solo toca los nodos que todavia no estan en la fila (un
   appendChild sobre un nodo que ya esta en su lugar IGUAL dispara al observer
   de #topBar, y de ahi naceria un bucle). */
function adoptarGrupos() {
    const cascaron = topBar.querySelector(".ekko-ribbon-body");
    if (!cascaron) return;
    Array.from(cascaron.children).forEach(g => {
        if (!g.classList || !g.classList.contains("ekko-ribbon-group")) return;
        if (g.parentElement === fila) return;
        fila.appendChild(g);
    });
}

/* ------------------------------------------------------------------ */
/* GRUPO "MAS USADAS": un grupo MAS de la cinta, alimentado por los        */
/* recientes del contexto. Son BOTONES REALES que se mudan desde su grupo   */
/* de origen y VOLVEN a el cuando dejan de estar entre las primeras 3.      */
/* ------------------------------------------------------------------ */
const MRU_EN_GRUPO = 3;
const GRUPO_RECIENTES = "recientes";

function esVisible(btn) {
    return !btn.classList.contains("ekko-command-hidden") && btn.style.display !== "none";
}

function grupoRecientes() {
    let g = fila.querySelector(`.ekko-ribbon-group[data-group="${GRUPO_RECIENTES}"]`);
    if (g) return g;
    // El mismo molde del motor (cuerpo + cabeza con el titulo debajo, plegable),
    // escrito a mano porque ribbonLayout solo construye los grupos del
    // manifiesto. Se copian sus clases para heredar ekko-ribbon.css.
    g = document.createElement("div");
    g.className = "ekko-ribbon-group";
    g.dataset.group = GRUPO_RECIENTES;
    const cuerpo = document.createElement("div");
    cuerpo.className = "ekko-ribbon-group-body";
    const head = document.createElement("div");
    head.className = "ekko-ribbon-group-head";
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("aria-expanded", "true");
    head.title = "Plegar / desplegar el grupo Más usadas";
    const title = document.createElement("span");
    title.className = "ekko-ribbon-group-title";
    title.textContent = "Más usadas";
    head.appendChild(title);
    g.appendChild(cuerpo);
    g.appendChild(head);
    const plegar = () => {
        const colapsado = g.classList.toggle("is-collapsed");
        head.setAttribute("aria-expanded", colapsado ? "false" : "true");
    };
    head.addEventListener("click", plegar);
    head.addEventListener("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); plegar(); }
    });
    // Primero de todo: lo mas usado se ve sin scrollear.
    fila.insertBefore(g, fila.firstChild);
    return g;
}

/* 1) Los botones que ya no estan entre las MRU_EN_GRUPO del contexto vuelven a
   su grupo de origen (data-casa, anotado al mudarlos). Sin eso la cinta se
   desarmaria sola: "Contorno" desapareceria de Geometria para siempre.
   2) Los recientes entran en orden de uso.
   3) Grupo vacio = grupo que no existe (cero huecos muertos), con la MISMA
   clase que usa el motor. Devuelve cuantos botones se movieron. */
function sincronizarGrupoRecientes() {
    if (!fila) return 0;
    const cola = (leerRecientes()[contextoActual()] || []).map(e => e.c);
    const g = grupoRecientes();
    const cuerpo = g.querySelector(".ekko-ribbon-group-body");

    const porComando = new Map();
    Array.from(topBar.querySelectorAll("button[data-fusion-btn], button[data-ekko-command]")).forEach(b => {
        const c = nombreComando(b);
        if (c && !porComando.has(c)) porComando.set(c, b);
    });
    const queridos = cola.map(c => porComando.get(c)).filter(b => b && esVisible(b)).slice(0, MRU_EN_GRUPO);

    let movidos = 0;
    Array.from(cuerpo.children).forEach(b => {
        if (b.tagName !== "BUTTON" || queridos.indexOf(b) >= 0) return;
        const casa = b.dataset.casa;
        b.removeAttribute("data-casa");
        const destino = casa
            ? topBar.querySelector(`.ekko-ribbon-group[data-group="${casa}"] > .ekko-ribbon-group-body`)
            : null;
        (destino || cuerpo).appendChild(b);
        movidos++;
    });
    queridos.forEach(b => {
        if (b.parentElement === cuerpo) return;
        const casa = b.closest(".ekko-ribbon-group");
        if (casa && casa.dataset.group !== GRUPO_RECIENTES) b.dataset.casa = casa.dataset.group;
        movidos++;
    });
    // appendChild en el orden del ranking: cubre la entrada y el reorden
    // dentro del sector (si no, al cambiar el ranking el grupo queda viejo).
    queridos.forEach(b => cuerpo.appendChild(b));

    const hay = Array.from(cuerpo.children).some(b => b.tagName === "BUTTON" && esVisible(b));
    g.classList.toggle("is-empty", !hay);
    return movidos;
}

/* El heroe de cada grupo: el PRIMER boton visible del cuerpo (el orden lo
   escribe el manifiesto, asi que es estable y no salta con cada clic).
   toggle() con la clase ya en su estado NO dispara registro de mutacion. */
function pintarHeroes() {
    Array.from(fila.querySelectorAll(".ekko-ribbon-group")).forEach(g => {
        if (g.dataset.group === GRUPO_OBJETO) return;   // no tiene botones-propios
        const cuerpo = g.querySelector(".ekko-ribbon-group-body");
        if (!cuerpo) return;
        const visibles = Array.from(cuerpo.children).filter(b => b.tagName === "BUTTON" && esVisible(b));
        visibles.forEach((b, i) => b.classList.toggle("ekko-es-heroes", i === 0));
    });
}

/* ------------------------------------------------------------------ */
/* GRUPO "OBJETO": los CAMPOS NUMERICOS y tipograficos que la barra      */
/* emergente arrastraba.                                                 */
/*                                                                       */
/* Ronda 6, con captura del cliente encima: la barra seguia "muy grande  */
/* y se entiende poco". Medido sobre un texto seleccionado: 1300px y dos */
/* filas, porque adentro de la barra viven .size-control-group (Ancho,   */
/* Alto, Rot, Tamano, Radio, Angulo, Espacio) y #ctxTextControls (la     */
/* fuente, el selector de tamano y DOS sliders). Los glifos — que son lo */
/* que el cliente pidio ver — quedaban ahogados por los campos.          */
/*                                                                       */
/* La solucion no es esconder nada: es mudar los campos a la cinta, que */
/* es el lugar donde el cliente ya los entiende (el panel superior). Se  */
/* MOVEN los nodos reales, no se clonan: conservan id, sus listeners y — */
/* lo importante — la visibilidad que el motor les escribe por clase     */
/* (#ctxTextControls.hidden, data-ekko-texto). Un texto muestra fuente y */
/* tamano; un vector, solo las medidas; sin seleccion, el grupo se va    */
/* con is-empty.                                                          */
/* ------------------------------------------------------------------ */
const GRUPO_OBJETO = "objeto";
/* A la cinta suben SOLO los VALORES del objeto. Las cajas de BOTONES del motor
   (#ctxImageControls: Espejo H/V, #ctxNodeEditControls: Eliminar Nodo…) se
   quedan en la barra emergente: son acciones sobre lo seleccionado, y la barra
   es justamente la tira de iconos del objeto. Ronda 6 las estaba subiendo a
   las dos por llevar .toolbar-subgroup, y quedaban botones sueltos dentro del
   grupo "Objeto" de la cinta — nadie entiende eso. */
const UNIDADES_CAMPO = u => !!(u.classList && (
    u.classList.contains("size-control-group") || u.id === "ekkoCamposTexto"));

/* #ctxTextControls (motor) es UNA caja que mezcla las dos cosas: seis botones
   (Negrita, Cursiva, Subrayado, Soldar, Curvar, Girar letras) y los campos de
   valor (fuente, tamaño, el slider de curvatura, radio, espacio). Se parte por
   la mitad: los botones siguen en la barra emergente y los valores arman
   #ekkoCamposTexto, que sube a la cinta como unidad. */
const CAMPOS_DE_TEXTO = ["ctxFontSize", "ctxCurveRadius", "ctxTextSpacing", "ctxTextCurvature"];
function esCampoDeTexto(n) {
    if (!n || n.nodeType !== 1) return false;
    if (n.id && CAMPOS_DE_TEXTO.includes(n.id)) return true;
    if (n.classList && n.classList.contains("custom-font-dropdown")) return true;
    return !!(n.querySelector && n.querySelector("#" + CAMPOS_DE_TEXTO.join(", #")));
}

function cajaCamposDeTexto() {
    let caja = document.getElementById("ekkoCamposTexto");
    if (!caja) {
        caja = document.createElement("div");
        caja.id = "ekkoCamposTexto";
        caja.className = "toolbar-subgroup ekko-campos-texto";
    }
    const tc = document.getElementById("ctxTextControls");
    if (tc) Array.from(tc.children).forEach(n => {
        if (esCampoDeTexto(n) && n.parentElement !== caja) caja.appendChild(n);
    });
    /* #ctxFontSize llega SOLO (index.html:379 es un <input> suelto con title,
       sin label), y en la cinta se veía un "42" flotando sin nombre. Los demás
       valores ya vienen envueltos en <label class="toolbar-number-label">
       ("Radio", "Espacio"), así que se etiqueta igual y en el mismo idioma
       visual. El input se mueve DENTRO del label: los listeners que le puso
       rotationController via getElementById quedan en la misma nodo. */
    const tamano = caja.querySelector("#ctxFontSize");
    if (tamano && !tamano.closest("label")) {
        const etiqueta = document.createElement("label");
        etiqueta.className = "toolbar-number-label";
        etiqueta.appendChild(document.createTextNode("Tamaño "));
        caja.insertBefore(etiqueta, tamano);
        etiqueta.appendChild(tamano);
    }
    return caja;
}

function grupoObjeto() {
    let g = fila.querySelector(`.ekko-ribbon-group[data-group="${GRUPO_OBJETO}"]`);
    if (g) return g;
    // Molde del motor (cuerpo + etiqueta debajo, plegable) escrito a mano:
    // ribbonLayout solo construye los grupos del manifiesto.
    g = document.createElement("div");
    g.className = "ekko-ribbon-group";
    g.dataset.group = GRUPO_OBJETO;
    const cuerpo = document.createElement("div");
    cuerpo.className = "ekko-ribbon-group-body";
    const head = document.createElement("div");
    head.className = "ekko-ribbon-group-head";
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("aria-expanded", "true");
    head.title = "Plegar / desplegar el grupo Objeto";
    const title = document.createElement("span");
    title.className = "ekko-ribbon-group-title";
    title.textContent = "Objeto";
    head.appendChild(title);
    const toggle = () => {
        const plegado = g.classList.toggle("is-collapsed");
        head.setAttribute("aria-expanded", plegado ? "false" : "true");
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
    });
    g.appendChild(cuerpo);
    g.appendChild(head);
    // AL FINAL de la cinta: es el grupo de los VALORES, se lee despues de
    // elegir la herramienta, no antes.
    fila.appendChild(g);
    return g;
}

function migrarCamposACinta() {
    const fb = document.getElementById("contextual-toolbar");
    const g = grupoObjeto();
    const cuerpo = g.querySelector(".ekko-ribbon-group-body");
    const unidades = fb ? [...fb.children].filter(UNIDADES_CAMPO) : [];
    // Las medidas del objeto primero, y despues la caja de campos de texto: el
    // orden de lectura es "cuanto mide" -> "que dice".
    const aSubir = [...unidades, cajaCamposDeTexto()];
    // Idempotente: appendChild sobre un nodo que ya esta ahi dispara al
    // observador de #topBar igual, y de ahi naceria un bucle.
    aSubir.forEach(u => {
        if (u.parentElement !== cuerpo) cuerpo.appendChild(u);
        // .ekko-fb-vacia la escribe refrescarBarraEmergente contando BOTONES;
        // un grupo de campos no tiene botones propios y se quedaba con la clase
        // puesta. Acá no significa nada: se suelta.
        u.classList.remove("ekko-fb-vacia");
    });
    /* Si el grupo esta .is-empty, todo su contenido mide 0 px: medir el ancho
       para decidir si vaciarlo es un huevo-gallina (una vez vacio, nunca
       vuelve). Se lee la senal que el MOTOR usa para cada unidad: la clase
       .hidden que el mismo escribe. Con el lienzo sin seleccion el grupo lo
       esconde la regla .ekko-sin-seleccion de arriba, no esta. */
    const sinTexto = (document.getElementById("topBar") || {}).getAttribute
        && document.getElementById("topBar").getAttribute("data-ekko-texto") === "no";
    const campoVivo = u => !u.classList.contains("hidden") && u.style.display !== "none"
        && !(sinTexto && u.id === "ekkoCamposTexto");
    const hay = [...cuerpo.children].some(campoVivo);
    g.classList.toggle("is-empty", !hay);
}

/* Recientes: UNICAMENTE el reparto dentro de la cinta; el display lo decide el
   motor (ribbonRenderer) y el llenado de los grupos, ribbonLayout. */
function refrescarFila() {
    if (!fila) return;
    adoptarGrupos();
    migrarCamposACinta();
    const firmas = Array.from(fila.querySelectorAll("button"))
        .filter(b => !b.classList.contains("ekko-pan-btn") && nombreComando(b));
    const forma = firmas.map(b => `${b.id || ""}#${nombreComando(b)}`).join("|");
    const cola = (leerRecientes()[contextoActual()] || []).map(e => e.c);
    // La firma del ORDEN entra en la comparacion junto con la del CONJUNTO:
    // medido en la ronda 4, la guarda miraba solo el conjunto, asi que usar una
    // herramienta (mismo conjunto, orden nuevo) NO reordenaba nada.
    const previa = (fila.dataset.ordenPrevia || "").split("@");
    const cambioConjunto = forma !== previa[0];
    const colaNueva = cola.join(",");
    if (cambioConjunto || colaNueva !== previa[1]) {
        const rango = cmd => { const i = cola.indexOf(cmd); return i < 0 ? 99 : i; };
        // Orden DENTRO de cada grupo por uso. Los grupos del catalogo NO se
        // mueven: el orden del manifiesto es la direccion que el cliente
        // memoriza ("Geometria esta despues de Estructura").
        Array.from(fila.querySelectorAll(".ekko-ribbon-group-body")).forEach(cuerpo => {
            const base = Array.from(cuerpo.children).filter(b => b.tagName === "BUTTON");
            // sort() es ESTABLE en los motores actuales: las no recientes
            // conservan el orden que les dio la cinta.
            const orden = base.slice().sort((a, b) => rango(nombreComando(a)) - rango(nombreComando(b)));
            if (orden.some((b, i) => b !== base[i])) orden.forEach(b => cuerpo.appendChild(b));
        });
        const movio = sincronizarGrupoRecientes();
        // sync() del motor: un grupo que se vacio al mudar un boton a "Mas
        // usadas" (o al cambiar de contexto) tiene que desaparecer con la misma
        // regla que usa la cinta, no con una copia nuestra.
        try { window.EKKO_RIBBON_LAYOUT && window.EKKO_RIBBON_LAYOUT.sync(); } catch (_) {}
        fila.dataset.ordenPrevia = forma + "@" + colaNueva;
        // El golpe de scroll solo cuando cambia el OBJETO (conjunto nuevo) o
        // cuando se rearmo el sector. Al usar una herramienta la cinta se
        // reordena pero respeta donde estabas mirando: saltar al arranque en
        // cada clic es mareante.
        if (cambioConjunto || movio) fila.scrollLeft = 0;
    } else {
        sincronizarGrupoRecientes();
    }
    pintarHeroes();

    const prod = document.getElementById("ekkoCascadeProducto");
    if (prod) pintarProducto(prod);
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
/* Con la barra SOLO DE ICONOS entran muchas mas acciones en el mismo aire
   (medido: 90px por boton con nombre vs ~32px sin el). 9 cubre los iconos
   PROPIOS del tipo seleccionado (un texto son 6: negrita, cursiva, subrayado,
   soldar, curvar, girar letras) sin empujar Eliminar/Duplicar detras del ⋯. */
const FB_EN_VISTA = 9;
/* Las cajas de controles por especie (#ctxTextControls, #ctxImageControls,
   #ctxNodeEditControls) NO existen para otro tipo de objeto: son la razon por
   la que la barra aparecio. Van primero; los genericos (Eliminar, Duplicar,
   al frente…) despues, ordenados por uso. */
const ES_PROPIO_DE_LA_ESPECIE = u => /^(ctxText|ctxImage|ctxVector|ctxNodeEdit)Controls$/.test(u.id || "");

function claveUso(btn) {
    // Las de la cinta tienen contrato (data-fusion-btn); las historicas de la
    // barra emergente solo id (btnCtxDelete...). Sin clave no hay recientes.
    return nombreComando(btn) || (btn.id ? btn.id.toLowerCase() : null);
}

function ocultoPorElMotor(btn) {
    return btn.classList.contains("ekko-command-hidden") || btn.style.display === "none";
}

/* SOLO ICONOS en la barra emergente (el pedido de la ronda 5: "resume todo a
   iconos que resuelvan de manera intuitiva lo que el cliente puede hacer con
   un objeto seleccionado"). No se toca el <i> ni el <svg>: se ENVUELVE el nodo
   de texto del boton en un span para poder esconderlo con CSS sin borrar nada
   — el nombre sigue en el DOM (accesibilidad) y en el tooltip.
   Idempotente sin flags colgados: la pasada mira los hijos REALES, asi que si
   el motor reescribe el innerHTML de un boton el texto se vuelve a envolver
   solo (una bandera en dataset mentiria y dejaria el nombre a la vista). */
function soloIconos(b) {
    if (b.id === "ekkoFbMas") return;                 // el ⋯ no tiene glifo: es el glifo
    const tieneGlifo = !!b.querySelector("i.fas, i.far, i.fab, i.fal, svg.ekko-ic");
    // Un boton que nace SOLO con texto (el candado 🔒, "Listo ✔") ya es icono:
    // esconderle el texto lo dejaria vacio.
    if (!tieneGlifo) return;
    if (!b.title) b.title = (b.textContent || "").trim();
    Array.from(b.childNodes).forEach(n => {
        if (n.nodeType === 1) {
            // Glifos de 1-2 caracteres ("+" / "-" de Subir/Bajar capa): SON el
            // significado. Sin ellos los dos botones comparten el mismo icono
            // de capas y el cliente no tiene como distinguirlos.
            if (n.classList && n.classList.contains("ekko-fb-txt")) {
                n.classList.toggle("ekko-queda", n.textContent.trim().length <= 2);
            }
            return;
        }
        if (n.nodeType !== 3) return;
        const txt = n.textContent.replace(/\s+/g, " ").trim();
        if (!txt) return;                             // el espacio entre <i> y el nombre se queda
        const span = document.createElement("span");
        span.className = "ekko-fb-txt";
        span.textContent = txt;
        span.classList.toggle("ekko-queda", txt.length <= 2);
        b.replaceChild(span, n);
    });
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
    // Senal de QUE tipo de objeto hay, para las cajas por especie de la barra
    // (ver el bloque de CSS de #ctxTextControls). El observador de la barra solo
    // mira class y style, asi que escribir este dataset no se realimenta.
    fb.dataset.ekkoEspecie = especieDeLaSeleccion();
    const mas = document.getElementById("ekkoFbMas");
    // UNIDADES = los hijos DIRECTOS de la barra que agrupan botones: conviven
    // .toolbar-group (Eliminar, Fusionar, Tamano...) y .toolbar-subgroup
    // (Negrita/Cursiva, Eliminar Nodo, Salir de Edicion). Mirar solo los
    // directos evita contar dos veces un subgroup que cuelga de un group.
    const unidades = [...fb.children].filter(c => c.classList &&
        (c.classList.contains("toolbar-group") || c.classList.contains("toolbar-subgroup")));
    const botonesDe = u => [...u.querySelectorAll(".toolbar-btn")].filter(b => b.id !== "ekkoFbMas");
    // SOLO ICONOS: se aplica sobre TODOS los botones (tambien los que el motor
    // ya tiene escondidos), asi cuando el ⋯ los muestra no vuelven con texto.
    // Es idempotente y no mueve unidades: puede ir afuera del guarda de orden.
    unidades.forEach(u => botonesDe(u).forEach(soloIconos));

    // La lista de recientes se lee UNA vez por refresco (son 40 botones y
    // leerRecientes() parsea JSON de localStorage en cada llamada).
    const cola = leerRecientes()[contextoActual()] || [];    const rangoDe = clave => {
        const i = cola.findIndex(e => e.c === clave);
        return i < 0 ? 99 : i;
    };

    // 1) Orden: cada unidad sube segun el mejor puesto de sus botones en los
    //    recientes del contexto. Se mueven las unidades ENTERAS (con sus
    //    titulos y sus controles de tampon), nunca boton por boton: la
    //    estructura que escribe el motor se respeta.
    const mejorRango = u => {
        if (ES_PROPIO_DE_LA_ESPECIE(u)) return -1;
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
    //
    //    Se recorre el ORDEN ya aplicado (no el array viejo: despues del
    //    appendChild de arriba el array `unidades` viene desfasado del DOM) y
    //    se SALTEAN las unidades que el CSS tiene apagadas. Sin ese salto, un
    //    texto y un vector se quedaban sin atajo: #ctxTextControls,
    //    #ctxImageControls y #ctxNodeEditControls siguen vivas en la barra y
    //    sus botones no estan "ocultos por el motor" (lo que el motor oculta es
    //    la CAJA entera por CSS), asi que se comian los 9 huecos y no dejaba
    //    ni Eliminar. Medido: barra de 110px con un vector, solo el ⋯.
    const expandida = fb.classList.contains("ekko-fb-expandida");
    const cajaEncendida = u => getComputedStyle(u).display !== "none";
    let enVista = 0;
    orden.forEach(u => {
        const botones = botonesDe(u);
        let utiles = 0;
        if (!cajaEncendida(u)) {
            botones.forEach(b => b.classList.remove("ekko-fb-extra"));
            u.classList.toggle("ekko-fb-vacia", true);
            return;
        }
        botones.forEach(b => {
            if (ocultoPorElMotor(b)) { b.classList.remove("ekko-fb-extra"); return; }
            utiles++;
            const fuera = !expandida && enVista >= FB_EN_VISTA;
            b.classList.toggle("ekko-fb-extra", fuera);
            if (!fuera) enVista++;
        });
        u.classList.toggle("ekko-fb-vacia", utiles === 0);
    });

    anclarSobreSeleccion(fb);
}

/* Atribulado al item sobre el que la barra esta plantada ahora mismo. Compara
   por identidad (===), no por nombre: dos chapas iguales dan dos objetos. */
let fbAncladoA = null;

/* --- POSICION DE LA BARRA (ronda 5.1, medido) -----------------------------
   contextualMenu.js:1008 sale temprano para CUALQUIER item cuyo data.mockup
   sea verdad — y en EKKO todo lo que hay sobre la mesa vive dentro del grupo
   de la chapa, que trae data.mockup=true heredado al hijo. Sale antes de
   llegar al bloque de left/top (linea 1112), asi que la barra NUNCA se
   posiciona: queda en su posicion estatica, que es la esquina superior
   izquierda del body, encima de la tira de pestañas y de la cinta. Medido en
   el arnes: left y top vacios con la barra visible. La app la muestra igual
   porque panelCoordinator.js:327 la enciende por su cuenta con .is-visible
   (modo auto), o sea el motor la pinta pero nadie la ubica.

   Se la ubica aca con la MISMA formula del motor (centro arriba del objeto,
   -14px) para que el cambio de mano no se note, con dos respetos:
     · si el usuario la arrastró (window.customToolbarLeft, que escribe
       makeToolbarDraggable), no se la toca nunca;
     · si el objeto esta tan arriba que la barra no entra, baja en vez de
       quedarse tapando la cinta (el motor la clava en top:10 ahi).
   Idempotente: escribe left/top una vez por seleccion, y la comparacion de
   fbAncladoA corta el bucle con el MutationObserver de arriba (que escucha
   el atributo style). */
function anclarSobreSeleccion(fb) {
    if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) return;
    if (!fb.classList.contains("is-visible") && !fb.classList.contains("active")) {
        fbAncladoA = null;
        return;
    }
    const seleccion = window.selectedItem || null;
    if (!seleccion) { fbAncladoA = null; return; }
    if (fbAncladoA === seleccion && fb.style.left && fb.style.top) return;

    const paper = window.paper;
    const lienzo = document.getElementById("editorCanvas");
    if (!paper || !paper.view || !lienzo) return;

    const varias = window.selectedItems && window.selectedItems.length > 1 ? window.selectedItems : [seleccion];
    let caja = null;
    varias.forEach(it => {
        if (!it || !it.bounds || it.visible === false) return;
        caja = caja ? caja.unite(it.bounds) : it.bounds.clone();
    });
    // Ultimo recurso: si el item que se selecciono esta marcado invisible (se
    // ve por otro lado, o el motor le dejo el flag), la barra igual tiene que
    // plantarse en algo. Sin esto quedaba en 0/0 tapando la tira.
    if (!caja && seleccion.bounds) caja = seleccion.bounds.clone();
    if (!caja) return;

    const marco = lienzo.getBoundingClientRect();
    const arriba = paper.view.projectToView(caja.topLeft);
    const centro = paper.view.projectToView(caja.center);
    const abajo = paper.view.projectToView(caja.bottomLeft);
    const ancho = fb.offsetWidth || 320;
    const alto = fb.offsetHeight || 44;
    const x = Math.max(10, Math.min(window.innerWidth - ancho - 10, centro.x + marco.left - ancho / 2));
    let y = arriba.y + marco.top - alto - 14;
    if (y < 10) y = Math.min(window.innerHeight - alto - 10, abajo.y + marco.top + 14);
    fb.style.left = Math.round(x) + "px";
    fb.style.top = Math.round(Math.max(10, y)) + "px";
    fbAncladoA = seleccion;
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
    const sinSeleccion = !seleccionActual().length;
    /* Ronda 7, punto 2: quedo el lienzo sin nada apuntado, se vuelve a Inicio.
       Si no, la pestana que el cliente toco para un objeto sigue activa sobre
       una cinta que ya no tiene ese objeto, y la barra parece rota. */
    if (sinSeleccion && pestañaActual() !== "auto") {
        if (window.EKKO_PANEL_STATE) window.EKKO_PANEL_STATE.activeTab = "auto";
        persistirTab("auto");
    }
    topBar.classList.toggle("ekko-sin-seleccion", sinSeleccion);
    // Guardia de orden: ningun motor debe poder desmontar la estructura
    // (la tira vive SIEMPRE al frente de la cascada).
    if (topBar.firstChild !== strip) topBar.insertBefore(strip, topBar.firstChild);
    renderTabs();
    refrescarFila();
    refrescarPanes();
    requestAnimationFrame(refrescarPanes);
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
