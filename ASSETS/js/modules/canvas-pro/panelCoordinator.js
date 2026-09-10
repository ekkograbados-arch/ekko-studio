/* =========================================================================
   EKKO STUDIO — PANEL COORDINATOR / FASE 0
   Coordina exclusivamente la interfaz de paneles.
   No modifica geometría, Paper.js, mockups ni productos.

   Superficies coordinadas:
   - #topBar
   - #pro-layout-toolbar
   - #contextual-toolbar
   - #productPanelWrap
   - #panelRecoveryDock
========================================================================= */

const panelState = {
    topPanel: "expanded",       // expanded | compact | hidden
    floatingBar: "auto",        // auto | visible | hidden
    productPanel: "visible",    // visible | hidden
    currentSelection: null,
    currentContext: "none",
    menu: null,
    initialized: false
};

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
        <div id="ekkoTopContextTabs" class="ekko-top-context-tabs"></div>
        <span id="ekkoTopContextLabel" class="ekko-top-context-label"></span>
    `;
    top.insertBefore(surface, top.firstChild);
    return surface;
}

function renderContextSurface() {
    const surface = ensureContextSurface();
    if (!surface) return;

    const tabs = byId("ekkoTopContextTabs");
    const label = byId("ekkoTopContextLabel");
    const context = panelState.currentContext || "none";
    const contextLabel = CONTEXT_LABELS[context] || CONTEXT_LABELS.none;

    const available = context === "none"
        ? ["none"]
        : ["none", context];

    tabs.innerHTML = "";
    available.forEach(name => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "ekko-context-tab" + (name === context ? " is-active" : "");
        tab.dataset.context = name;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", name === context ? "true" : "false");
        tab.textContent = CONTEXT_LABELS[name];
        tab.addEventListener("click", () => {
            // En esta fase las pestañas son de contexto visual.
            // Las acciones se sincronizarán en la siguiente etapa.
            panelState.currentContext = name;
            renderContextSurface();
        });
        tabs.appendChild(tab);
    });

    if (label) label.textContent = `Contexto: ${contextLabel}`;
    surface.dataset.context = context;
}

function applyPanelState() {
    const el = getElements();
    renderContextSurface();

    if (el.top) {
        el.top.classList.toggle("is-expanded", panelState.topPanel === "expanded");
        el.top.classList.toggle("is-compact", panelState.topPanel === "compact");
        el.top.classList.toggle("is-hidden", panelState.topPanel === "hidden");
        el.top.dataset.panelMode = panelState.topPanel;
    }

    // La barra profesional dinámica es una extensión del panel superior.
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
    }

    const allHidden = panelState.topPanel === "hidden" &&
        panelState.floatingBar === "hidden" &&
        panelState.productPanel === "hidden";

    if (el.recovery) {
        el.recovery.classList.toggle("is-visible", allHidden);
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
    const topOverflow = byId("topPanelOverflow");
    const floatingOverflow = byId("floatingPanelOverflow");
    const hideProducts = byId("btnHideProductPanel");
    const productHandle = byId("productPanelHandle");
    const recovery = byId("panelRecoveryDock");

    topCompact?.addEventListener("click", (event) => {
        event.stopPropagation();
        panelState.topPanel = panelState.topPanel === "compact" ? "expanded" : "compact";
        applyPanelState();
    });

    topOverflow?.addEventListener("click", (event) => {
        event.stopPropagation();
        openVisibilityMenu(topOverflow);
    });

    floatingOverflow?.addEventListener("click", (event) => {
        event.stopPropagation();
        openVisibilityMenu(floatingOverflow);
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

    wrapContextualMenuAPI();
    bindPanelControls();
    applyPanelState();

    window.EKKO_PANEL_STATE = panelState;
    window.setEKKOSelectionContext = setSelectionContext;
    window.getEKKOPanelState = getPanelState;

    console.log("%c[EKKO PANELS] Coordinador de paneles inicializado.", "color:#2563eb;font-weight:bold;");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPanelCoordinator, { once: true });
} else {
    initPanelCoordinator();
}
