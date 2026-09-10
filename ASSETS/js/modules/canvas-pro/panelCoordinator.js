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

function applyPanelState() {
    const el = getElements();

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

function wrapContextualMenuAPI() {
    const update = window.updateContextualMenu;
    if (typeof update === "function" && !update.__ekkoPanelWrapped) {
        const wrappedUpdate = function (item) {
            const result = update.apply(this, arguments);
            panelState.currentSelection = item || window.selectedItem || null;
            applyPanelState();
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
            applyPanelState();
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
    applyPanelState();
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
