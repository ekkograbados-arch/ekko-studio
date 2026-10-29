/* =========================================================================
   EKKO STUDIO â€” PANEL COORDINATOR / FASE 0
   Coordina exclusivamente la interfaz de paneles.
   No modifica geometrÃ­a, Paper.js, mockups ni productos.

   Superficies coordinadas:
   - #topBar
   - #pro-layout-toolbar
   - #contextual-toolbar
   - #productPanelWrap
   - #panelRecoveryDock
========================================================================= */

import { TABS, detectTab, tabsForSelection } from "./capabilities.js";

const STORAGE_KEY = "ekko.panels.v1";

const panelState = {
    topPanel: "expanded",       // expanded | compact | hidden
    floatingBar: "auto",        // auto | visible | hidden
    productPanel: "visible",    // visible | hidden
    // "auto" = no se recorta nada (interseccion completa, comportamiento
    // previo). Un id de TABS = el usuario eligio ese grupo a proposito.
    activeTab: "auto",
    currentSelection: null,
    currentContext: "none",
    menu: null,
    initialized: false
};

/* --- Persistencia: el cliente configura los paneles una vez y los mantiene.
   Sin esto, recargar devolvia todo a los valores de fabrica. --- */
function loadPanelState() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) { return; }
    if (!raw) return;
    let saved;
    try { saved = JSON.parse(raw); } catch (_) { return; }
    if (!saved || typeof saved !== "object") return;
    ["topPanel", "floatingBar", "productPanel", "activeTab"].forEach(key => {
        if (typeof saved[key] === "string") panelState[key] = saved[key];
    });
    // Estado guardado corrupto o de una version vieja: volver a fabrica en
    // vez de dejar la interfaz en un modo que no existe.
    if (!["expanded", "compact", "hidden"].includes(panelState.topPanel)) panelState.topPanel = "expanded";
    if (!["auto", "visible", "hidden"].includes(panelState.floatingBar)) panelState.floatingBar = "auto";
    if (!["visible", "hidden"].includes(panelState.productPanel)) panelState.productPanel = "visible";
    if (panelState.activeTab !== "auto" && !TABS[panelState.activeTab]) panelState.activeTab = "auto";
}

function savePanelState() {
    // Coalescente: applyPanelState se dispara en cada cambio de seleccion y
    // no tiene sentido escribir en localStorage en cada raf.
    if (savePanelState.__pending) return;
    savePanelState.__pending = true;
    setTimeout(() => {
        savePanelState.__pending = false;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                topPanel: panelState.topPanel,
                floatingBar: panelState.floatingBar,
                productPanel: panelState.productPanel,
                activeTab: panelState.activeTab
            }));
        } catch (_) {}
    }, 150);
}

function byId(id) {
    return document.getElementById(id);
}

function hasSelection(item = null) {
    if (item) return true;
    if (window.selectedItems && window.selectedItems.length > 0) return true;
    return !!window.selectedItem;
}

function getElements() {
    return {
        top: byId("topBar"),
        pro: byId("pro-layout-toolbar"),
        floating: byId("contextual-toolbar"),
        products: byId("productPanelWrap"),
        recovery: byId("panelRecoveryDock")
    };
}

function getContentTarget(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup && item.children) {
        return item.children.find(child => !child.clipMask && !(child.data && (child.data.isMask || child.data.wasClipMask))) || item;
    }
    return item;
}

function resolveContext(item = null) {
    const selected = window.selectedItems && window.selectedItems.length
        ? window.selectedItems
        : (item ? [item] : (window.selectedItem ? [window.selectedItem] : []));

    if (selected.length > 1) return "multiple";
    const target = getContentTarget(selected[0]);
    if (!target) return "none";

    if ((target.data && target.data.isSmartFusion) ||
        (typeof window.findSmartFusionContainer === "function" && window.findSmartFusionContainer(target))) {
        return "fusion";
    }

    if (target.className === "Raster") return "image";
    if (target.className === "PointText" || (target.data && (target.data.isText || target.data.isCurvedGroup || target.data.isSpacedGroup))) return "text";
    if (["Path", "CompoundPath", "Group", "Shape", "SymbolItem", "PlacedSymbol"].includes(target.className)) return "vector";
    return "none";
}

const CONTEXT_LABELS = {
    none: "Inicio",
    image: "Imagen",
    text: "Texto",
    vector: "Vector",
    multiple: "Selección múltiple",
    fusion: "Fusión"
};

function ensureContextSurface() {
    const top = byId("topBar");
    if (!top) return null;
    let surface = byId("ekkoTopContextSurface");
    if (surface) return surface;

    surface = document.createElement("div");
    surface.id = "ekkoTopContextSurface";
    surface.className = "ekko-top-context-surface";
    surface.setAttribute("role", "tablist");
    surface.innerHTML = `
        <button id="productPanelTopToggle" type="button" class="product-panel-top-toggle" title="Ocultar panel de productos" aria-label="Ocultar panel de productos">‹</button>
        <div id="ekkoTopContextTabs" class="ekko-top-context-tabs"></div>
        <span id="ekkoTopContextLabel" class="ekko-top-context-label"></span>
    `;
    top.insertBefore(surface, top.firstChild);
    return surface;
}

/**
 * Chip de panel oculto: UN SOLO control, el mismo chevron de la barra,
 * resurgiendo flotante en la esquina superior derecha cuando el panel
 * superior esta OCULTO. El chevron apunta hacia abajo ("abrir el panel");
 * clic devuelve la barra a expandido. SIN menu de tres puntos aca: los
 * tres puntos verticales son y solo son "Mas herramientas"
 * (toolbarOverflow.js, al estilo Word/Office); las opciones de paneles
 * viven en su propio lugar (boton de la barra emergente) y el chevron
 * invertido es la unica salida de emergencia necesaria.
 * Se construye en JS (con sus estilos) para no depender de HTML/CSS del
 * servidor y para que exista SIEMPRE que se necesite.
 */
function ensurePanelAnchor() {
    let wrap = byId("ekkoPanelAnchor");
    if (wrap) return wrap;

    if (!byId("ekkoPanelAnchorStyles")) {
        const style = document.createElement("style");
        style.id = "ekkoPanelAnchorStyles";
        style.textContent = `
            #ekkoPanelAnchor {
                position: fixed;
                top: 10px;
                right: 14px;
                z-index: calc(var(--ekko-floating-z, 10100) + 10);
                display: none;
                align-items: center;
                gap: 2px;
                padding: 5px 8px;
                border-radius: 8px;
                background: rgba(15, 23, 42, 0.88);
                border: 1px solid rgba(255, 255, 255, 0.22);
                box-shadow: 0 8px 22px rgba(15, 23, 42, 0.35);
            }
            #ekkoPanelAnchor.is-visible { display: inline-flex; }
            .panel-anchor-btn {
                background: transparent;
                border: 0;
                color: #e2e8f0;
                font-size: 15px;
                line-height: 1;
                padding: 2px 4px;
                cursor: pointer;
            }
            .panel-anchor-btn:hover { background: rgba(255, 255, 255, 0.16); color: #fff; border-radius: 5px; }
        `;
        document.head.appendChild(style);
    }

    wrap = document.createElement("div");
    wrap.id = "ekkoPanelAnchor";
    wrap.setAttribute("role", "button");
    wrap.setAttribute("aria-label", "Controles de panel");
    wrap.innerHTML = `
        <button type="button" class="panel-anchor-btn" id="ekkoPanelAnchorExpand" title="Expandir panel superior" aria-label="Expandir panel superior">⌄</button>
        <button type="button" class="panel-anchor-btn" id="ekkoPanelAnchorProducts" title="Mostrar panel de productos" aria-label="Mostrar panel de productos">›</button>
        <button type="button" class="panel-anchor-btn" id="ekkoPanelAnchorFloating" title="Mostrar barra emergente" aria-label="Mostrar barra emergente">≡</button>
    `;
    document.body.appendChild(wrap);

    byId("ekkoPanelAnchorExpand").addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.topPanel = "expanded";
        applyPanelState();
    });

    // REVERSIBILIDAD: estos tres reviveadores viven EN EL BODY, afuera de
    // todo panel que se pueda ocultar. Aunque el cliente esconda el panel
    // de productos o la barra emergente (cuyos propios botones quedan
    // dentro y desaparecen), SIEMPRE hay un camino de vuelta visible aqui.
    byId("ekkoPanelAnchorProducts").addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.productPanel = "visible";
        applyPanelState();
    });

    byId("ekkoPanelAnchorFloating").addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.floatingBar = "auto";
        applyPanelState();
    });

    return wrap;
}

function renderContextSurface() {
    const surface = ensureContextSurface();
    if (!surface) return;

    const tabs = byId("ekkoTopContextTabs");
    const label = byId("ekkoTopContextLabel");
    const context = panelState.currentContext || "none";

    const selection = panelState.currentSelection
        ? [panelState.currentSelection]
        : ((window.selectedItems && window.selectedItems.length)
            ? window.selectedItems
            : (window.selectedItem ? [window.selectedItem] : []));

    // Solo se ofrecen pestanas que tienen herramientas para ESTA seleccion.
    // Con una imagen el cliente ve Inicio e Imagen; Texto y Vector ni aparecen.
    const available = tabsForSelection(selection);
    const detected = detectTab(selection);

    // La pestana resaltada es la que el motor dedujo de la seleccion.
    // Si el usuario aplico una a mano, esa manda.
    const highlighted = panelState.activeTab !== "auto" ? panelState.activeTab : detected;

    // Si la preferencia activa no aparece en la lista natural, se agrega para
    // que el cliente pueda verla y desactivarla. Si no, quedaria filtrando en
    // silencio sin ninguna pista de como volver al automatico.
    if (panelState.activeTab !== "auto" && !available.includes(panelState.activeTab)) {
        available.push(panelState.activeTab);
    }

    if (tabs) {
        tabs.innerHTML = "";
        available.forEach(id => {
            const def = TABS[id];
            if (!def) return;
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "ekko-context-tab" + (id === highlighted ? " is-active" : "");
            if (panelState.activeTab !== "auto" && id === panelState.activeTab) {
                tab.classList.add("is-manual");
            }
            tab.dataset.context = id;
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-selected", id === highlighted ? "true" : "false");
            tab.textContent = def.label;
            tab.title = panelState.activeTab === id
                ? `${def.label} — pulsalo de nuevo para ver todas las herramientas`
                : `Mostrar herramientas de ${def.label.toLowerCase()}`;
            tab.addEventListener("click", () => {
                // Segundo clic sobre la misma pestana = volver al automatico.
                panelState.activeTab = (panelState.activeTab === id) ? "auto" : id;
                savePanelState();
                applyPanelState();
                refreshSharedCommands();
            });
            tabs.appendChild(tab);
        });
    }

    const def = TABS[highlighted];
    if (label) {
        const contextLabel = CONTEXT_LABELS[context] || CONTEXT_LABELS.none;
        label.textContent = panelState.activeTab === "auto"
            ? `Contexto: ${contextLabel}`
            : `Contexto: ${contextLabel} Â· ${def ? def.label : ""}`;
    }
    surface.dataset.context = context;
    surface.dataset.activeTab = panelState.activeTab;
}

function applyPanelState() {
    renderPanelState();
    savePanelState();
}

function renderPanelState() {
    const el = getElements();
    renderContextSurface();

    if (el.top) {
        el.top.classList.toggle("is-expanded", panelState.topPanel === "expanded");
        el.top.classList.toggle("is-compact", panelState.topPanel === "compact");
        el.top.classList.toggle("is-hidden", panelState.topPanel === "hidden");
        el.top.dataset.panelMode = panelState.topPanel;
    }

    // La barra profesional dinÃ¡mica es una extensiÃ³n del panel superior.
    if (el.pro) {
        el.pro.classList.toggle("is-compact", panelState.topPanel === "compact");
        el.pro.classList.toggle("is-hidden", panelState.topPanel === "hidden");
        el.pro.dataset.panelSurface = "top";
    }

    const floatingShouldShow = panelState.floatingBar === "visible" ||
        (panelState.floatingBar === "auto" && hasSelection(panelState.currentSelection));

    if (el.floating) {
        el.floating.classList.toggle("is-visible", floatingShouldShow);
        el.floating.classList.toggle("is-hidden", panelState.floatingBar === "hidden");
        el.floating.dataset.panelMode = panelState.floatingBar;
    }

    if (el.products) {
        const hidden = panelState.productPanel === "hidden";
        el.products.classList.toggle("is-collapsed", hidden);
        el.products.dataset.panelMode = hidden ? "hidden" : "visible";

        const topToggle = byId("productPanelTopToggle");
        if (topToggle) {
            topToggle.textContent = hidden ? "›" : "‹";
            topToggle.title = hidden ? "Mostrar panel de productos" : "Ocultar panel de productos";
            topToggle.setAttribute("aria-label", topToggle.title);
            topToggle.dataset.panelState = hidden ? "hidden" : "visible";
        }
    }

    // SALIDA DE EMERGENCIA SIN TEXTO: cuando el panel superior esta OCULTO,
    // un chip minimalista fijo en la esquina superior derecha muestra EL MISMO
    // control de la barra: chevron invertido ("abrir el panel") + opciones de
    // paneles. En compacto no aparece porque los controles de la propia barra
    // siguen visibles en la tira de 34px. Sustituye al dock con texto
    // "Mostrar herramientas" (que queda dormido en el HTML) y elimina la
    // trampa en la que los botones de retorno vivian DENTRO del panel que se
    // ocultaba.
    const anchor = ensurePanelAnchor();
    if (anchor) {
        // REVERSIBLE SIEMPRE: el chip aparece si ALGUNA de las tres capas
        // quedo oculta, y cada reviveador solo se ve para la capa que
        // efectivamente esta oculta (el resto no muestra boton fantasma).
        const topOculto = panelState.topPanel === "hidden";
        const productosOcultos = panelState.productPanel === "hidden";
        const emergenteOculta = panelState.floatingBar === "hidden";
        anchor.classList.toggle("is-visible", topOculto || productosOcultos || emergenteOculta);
        const ex = byId("ekkoPanelAnchorExpand");
        if (ex) ex.style.display = topOculto ? "" : "none";
        const pr = byId("ekkoPanelAnchorProducts");
        if (pr) pr.style.display = productosOcultos ? "" : "none";
        const fl = byId("ekkoPanelAnchorFloating");
        if (fl) fl.style.display = emergenteOculta ? "" : "none";
    }

    // El chevron de la propia barra tambien se invierte en compacto: mismo
    // lenguaje visual en ambos controles.
    const compactBtn = byId("topPanelCompact");
    if (compactBtn) {
        const contraido = panelState.topPanel !== "expanded";
        compactBtn.textContent = contraido ? "⌄" : "⌃";
        compactBtn.title = contraido ? "Expandir panel superior" : "Contraer panel superior";
        compactBtn.setAttribute("aria-label", compactBtn.title);
    }
}

function closeMenu() {
    if (panelState.menu) {
        panelState.menu.remove();
        panelState.menu = null;
    }
}

function addMenuButton(menu, label, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        callback();
        closeMenu();
    });
    menu.appendChild(button);
}

function openVisibilityMenu(anchor) {
    closeMenu();

    const menu = document.createElement("div");
    menu.id = "ekko-panel-visibility-menu";
    menu.className = "panel-visibility-menu";
    menu.setAttribute("role", "menu");

    addMenuButton(menu, "Panel superior: expandido", () => {
        panelState.topPanel = "expanded";
        applyPanelState();
    });

    addMenuButton(menu, "Panel superior: compacto", () => {
        panelState.topPanel = "compact";
        applyPanelState();
    });

    addMenuButton(menu, "Ocultar panel superior", () => {
        panelState.topPanel = "hidden";
        applyPanelState();
    });

    addMenuButton(menu, "Barra emergente: automática", () => {
        panelState.floatingBar = "auto";
        applyPanelState();
    });

    addMenuButton(menu, "Mostrar barra emergente", () => {
        panelState.floatingBar = "visible";
        applyPanelState();
    });

    addMenuButton(menu, "Ocultar barra emergente", () => {
        panelState.floatingBar = "hidden";
        applyPanelState();
    });

    addMenuButton(menu, "Mostrar panel de productos", () => {
        panelState.productPanel = "visible";
        applyPanelState();
    });

    addMenuButton(menu, "Ocultar panel de productos", () => {
        panelState.productPanel = "hidden";
        applyPanelState();
    });

    addMenuButton(menu, "Restaurar todos los paneles", () => {
        panelState.topPanel = "expanded";
        panelState.floatingBar = "auto";
        panelState.productPanel = "visible";
        applyPanelState();
    });

    document.body.appendChild(menu);
    panelState.menu = menu;

    const rect = anchor.getBoundingClientRect();
    const menuWidth = 230;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
    const top = Math.min(window.innerHeight - 12, rect.bottom + 8);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function refreshSharedCommands() {
    if (typeof window.refreshEKKOSharedCommands === "function") {
        window.refreshEKKOSharedCommands();
    } else if (typeof window.refreshAllToolbars === "function") {
        window.refreshAllToolbars();
    }
}

/**
 * La pestana activa es una PREFERENCIA del cliente, no un estado derivado de
 * la seleccion. Por eso NO se recalcula aqui al seleccionar otra cosa: si se
 * hiciera, el grupo que el cliente eligio se perderia en cuanto tocara un
 * objeto de otro tipo, y no sobreviviria a la recarga.
 *
 * Es seguro que el filtro sobreviva: legacyNamesForTab() siempre recorta por
 * la interseccion real de capacidades, asi que una pestana "Imagen" con un
 * vector seleccionado muestra solo las herramientas universales. Nunca aparece
 * un boton que el objeto no soporta.
 */

function wrapContextualMenuAPI() {
    const update = window.updateContextualMenu;
    if (typeof update === "function" && !update.__ekkoPanelWrapped) {
        const wrappedUpdate = function (item) {
            const result = update.apply(this, arguments);
            panelState.currentSelection = item || window.selectedItem || null;
            panelState.currentContext = resolveContext(panelState.currentSelection);
            applyPanelState();
            refreshSharedCommands();
            return result;
        };
        wrappedUpdate.__ekkoPanelWrapped = true;
        window.updateContextualMenu = wrappedUpdate;
    }

    const hide = window.hideContextualMenu;
    if (typeof hide === "function" && !hide.__ekkoPanelWrapped) {
        const wrappedHide = function () {
            const result = hide.apply(this, arguments);
            panelState.currentSelection = null;
            panelState.currentContext = "none";
            // activeTab NO se toca aqui: es una preferencia del cliente sobre
            // la barra, no un estado derivado de lo que hay seleccionado.
            applyPanelState();
            refreshSharedCommands();
            return result;
        };
        wrappedHide.__ekkoPanelWrapped = true;
        window.hideContextualMenu = wrappedHide;
    }
}

function bindPanelControls() {
    const topCompact = byId("topPanelCompact");
    // topPanelOverflow (los tres puntos de la barra superior) NO se vincula
    // aca: es exclusivamente el boton "Mas herramientas" de toolbarOverflow.js
    // (estilo Word/Office), que ademas corta los demas listeners del mismo
    // clic con stopImmediatePropagation en fase captura. Cualquier binding
    // de paneles a ese boton es codigo muerto y confunde el semantico:
    // tres puntos = herramientas, nunca = ocultar paneles.
    const floatingOverflow = byId("floatingPanelOverflow");
    const topProductToggle = byId("productPanelTopToggle");
    const hideProducts = byId("btnHideProductPanel");
    const productHandle = byId("productPanelHandle");
    const recovery = byId("panelRecoveryDock");

    topCompact?.addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.topPanel = panelState.topPanel === "compact" ? "expanded" : "compact";
        applyPanelState();
    });

    floatingOverflow?.addEventListener("click", (event) => {
        event.stopPropagation();
        openVisibilityMenu(floatingOverflow);
    });

    topProductToggle?.addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.productPanel = panelState.productPanel === "hidden" ? "visible" : "hidden";
        applyPanelState();
    });

    hideProducts?.addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.productPanel = "hidden";
        applyPanelState();
    });

    productHandle?.addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.productPanel = "visible";
        applyPanelState();
    });

    recovery?.addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.topPanel = "expanded";
        panelState.floatingBar = "auto";
        panelState.productPanel = "visible";
        applyPanelState();
    });

    document.addEventListener("click", (event) => {
        if (panelState.menu && !panelState.menu.contains(event.target) &&
            !event.target.closest("[data-panel-menu='visibility']")) {
            closeMenu();
        }
    });

    window.addEventListener("resize", () => {
        closeMenu();
        applyPanelState();
    });
}

export function setSelectionContext(item = null) {
    panelState.currentSelection = item;
    panelState.currentContext = resolveContext(item);
    applyPanelState();
    refreshSharedCommands();
}

export function getPanelState() {
    return { ...panelState, menu: null };
}

export function initPanelCoordinator() {
    if (panelState.initialized) return;
    panelState.initialized = true;

    loadPanelState();
    wrapContextualMenuAPI();
    ensureContextSurface();
    bindPanelControls();
    applyPanelState();

    window.EKKO_PANEL_STATE = panelState;
    window.setEKKOSelectionContext = setSelectionContext;
    window.getEKKOPanelState = getPanelState;

    /* LA CASCADA ES LA INTERFAZ, NO UN PROTOTIPO: arranca siempre, en cualquier
       dispositivo. Antes vivia de la clave ekko.cascadePrototype en localStorage,
       y localStorage es por navegador y por maquina: la misma URL mostraba dos
       interfaces distintas segun donde se abriera, y un ?cascade=0 tocado una vez
       dejaba una computadora atrasada para siempre (el "no veo cambios" entre PC).
       Ahora la unica forma de apagarla es ?cascade=0 en la URL, y solo dura esa
       carga. La clave vieja se borra para que ningun dispositivo quede atado a
       una decision tomada hace rondas. */
    try {
        localStorage.removeItem("ekko.cascadePrototype");
        if (new URLSearchParams(location.search).get("cascade") !== "0") {
            import("./cascadeToolbar.js")
                .then(m => m.initCascadeToolbar?.())
                .catch(err => console.warn("[EKKO CASCADA] no se pudo iniciar:", err));
        }
    } catch (_) {}

    console.log("%c[EKKO PANELS] Coordinador de paneles inicializado.", "color:#2563eb;font-weight:bold;");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPanelCoordinator, { once: true });
} else {
    initPanelCoordinator();
}
