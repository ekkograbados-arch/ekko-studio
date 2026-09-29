/*
 * EKKO Studio — avisos no bloqueantes.
 *
 * Reemplaza a alert()/confirm(): una ventana del navegador congela el lienzo,
 * interrumpe la operación y el cliente no puede seguir trabajando hasta
 * cerrarla. En un editor eso se siente como un fallo de la plataforma.
 *
 * Reglas:
 *   - Nunca bloquean. La operación sigue aunque el aviso este en pantalla.
 *   - Se apilan y se van solos.
 *   - Son de solo lectura: comunican, no piden una decision.
 *   - Un error real (cargar un proyecto roto) tambien se avisa, pero además
 *     queda registrado en la consola para el diagnóstico.
 */

const MAX_VISIBLE = 4;
const DEFAULT_MS = 3600;
const ERROR_MS = 7000;

let container = null;
const live = [];

function ensureContainer() {
    if (container && container.isConnected) return container;
    if (typeof document === "undefined") return null;
    container = document.getElementById("ekko-notices");
    if (!container) {
        container = document.createElement("div");
        container.id = "ekko-notices";
        container.setAttribute("role", "status");
        container.setAttribute("aria-live", "polite");
        // Estilos embebidos a proposito: el aviso tiene que existir aunque el
        // bundle de estilos no haya cargado todavia.
        container.style.cssText = [
            "position:fixed",
            "right:16px",
            "bottom:16px",
            "z-index:2147483000",
            "display:flex",
            "flex-direction:column",
            "gap:8px",
            "align-items:flex-end",
            "pointer-events:none",
            "max-width:min(380px,90vw)",
            "font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
        ].join(";");
        document.body.appendChild(container);
    }
    return container;
}

const PALETTE = {
    info:    { bg: "#0f172a", fg: "#e2e8f0", border: "#334155" },
    ok:      { bg: "#064e3b", fg: "#d1fae5", border: "#059669" },
    warn:    { bg: "#78350f", fg: "#fef3c7", border: "#d97706" },
    error:   { bg: "#7f1d1d", fg: "#fee2e2", border: "#dc2626" }
};

function dismiss(entry) {
    const index = live.indexOf(entry);
    if (index >= 0) live.splice(index, 1);
    if (!entry.node || !entry.node.isConnected) return;
    entry.node.style.transition = "opacity .16s ease, transform .16s ease";
    entry.node.style.opacity = "0";
    entry.node.style.transform = "translateY(6px)";
    setTimeout(() => { try { entry.node.remove(); } catch (_) {} }, 180);
}

/**
 * Muestra un aviso. `kind` es info | ok | warn | error.
 * Devuelve una funcion para cerrarlo antes de tiempo.
 */
export function notice(message, options = {}) {
    const text = String(message ?? "").trim();
    if (!text) return () => {};
    const kind = PALETTE[options.kind] ? options.kind : "info";
    const host = ensureContainer();
    // Sin DOM (pruebas headless sin render) no hay nada que hacer, pero el
    // aviso nunca debe romper la operacion que lo origina.
    if (!host) return () => {};

    while (live.length >= MAX_VISIBLE) dismiss(live[0]);

    const palette = PALETTE[kind];
    const node = document.createElement("div");
    node.style.cssText = [
        "pointer-events:auto",
        "background:" + palette.bg,
        "color:" + palette.fg,
        "border:1px solid " + palette.border,
        "border-radius:10px",
        "padding:10px 14px",
        "box-shadow:0 8px 24px rgba(0,0,0,.28)",
        "opacity:0",
        "transform:translateY(6px)",
        "transition:opacity .16s ease, transform .16s ease",
        "white-space:pre-wrap",
        "overflow-wrap:anywhere"
    ].join(";");

    const textNode = document.createElement("div");
    textNode.textContent = text;
    node.appendChild(textNode);

    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Cerrar aviso");
    close.textContent = "×";
    close.style.cssText = [
        "position:absolute",
        "top:4px",
        "right:8px",
        "background:transparent",
        "border:0",
        "color:" + palette.fg,
        "opacity:.6",
        "font-size:16px",
        "line-height:1",
        "cursor:pointer",
        "padding:2px 4px"
    ].join(";");
    node.style.position = "relative";
    close.onclick = () => dismiss(entry);
    node.appendChild(close);

    host.appendChild(node);
    const entry = { node, kind };
    live.push(entry);

    requestAnimationFrame(() => {
        if (!node.isConnected) return;
        node.style.opacity = "1";
        node.style.transform = "translateY(0)";
    });

    // Los errores quedan mas tiempo y tambien en consola: si algo se rompe de
    // verdad, el cliente debe enterarse y nosotros poder diagnosticarlo.
    if (kind === "error") console.warn("[EKKO]", text);
    const ms = Number.isFinite(options.ms) ? options.ms : (kind === "error" ? ERROR_MS : DEFAULT_MS);
    const timer = setTimeout(() => dismiss(entry), ms);
    node.addEventListener("mouseenter", () => clearTimeout(timer), { once: true });

    return () => dismiss(entry);
}

export const notify = notice;

if (typeof window !== "undefined") {
    window.EKKO_NOTICE = { notice, notify };
    window.ekkoNotice = notice;
}
