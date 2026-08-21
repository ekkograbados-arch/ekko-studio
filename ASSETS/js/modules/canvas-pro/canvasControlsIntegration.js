/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/canvasControlsIntegration.js
Descripción: Integrador de Interfaz Profesional (Versión v2 - Multi-Selección).
             Inyecta la barra de formato/alineación con prefijos únicos,
             evita colisiones de IDs, e integra comandos de alineación (Canva-style)
             y distribución espacial para objetos seleccionados.
========================================================================= */

import { setRulersVisibility, setGuidesVisibility } from "./canvasGuidesAndRulers.js";
import { setMeasurementsVisibility } from "./canvasMeasurements.js";

// Estilos CSS modernos (estilo Canva y Figma) para la barra de alineaciones y zoom
const proToolbarStylesId = "ekko-pro-toolbar-styles";
if (!document.getElementById(proToolbarStylesId)) {
    const styleEl = document.createElement("style");
    styleEl.id = proToolbarStylesId;
    styleEl.textContent = `
        /* Barra de Alineaciones Profesional estilo Canva */
        #pro-layout-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
            gap: 16px;
            flex-wrap: wrap;
            user-select: none;
            z-index: 100;
        }

        .pro-group {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .pro-divider {
            width: 1px;
            height: 20px;
            background-color: #cbd5e1;
            margin: 0 4px;
        }

        .pro-label {
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-right: 6px;
        }

        .pro-btn {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 6px 10px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            cursor: pointer;
            color: #334155;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.15s ease;
        }

        .pro-btn:hover {
            background-color: #f1f5f9;
            color: #0f172a;
            border-color: #94a3b8;
        }

        .pro-btn.active {
            background-color: #007bff;
            color: #ffffff;
            border-color: #007bff;
        }

        #pro-zoom-reset {
            font-weight: bold;
            color: #007bff;
            border-color: #bbf7d0;
            background-color: #f0fdf4;
        }
        #pro-zoom-reset:hover {
            background-color: #dcfce7;
        }
    `;
    document.head.appendChild(styleEl);
}

// Inyección e inicialización de la barra de controles
export function initProControls() {
    const workspace = document.getElementById("workspace");
    const topBar = document.getElementById("topBar");
    if (!workspace || !topBar) return;

    // 1. Eliminar/Ocultar lupas antiguas de zoom para evitar duplicidad de controles
    const btnZoomIn = document.getElementById("btnZoomIn");
    const btnZoomOut = document.getElementById("btnZoomOut");
    const btnFit = document.getElementById("btnFit");
    if (btnZoomIn) btnZoomIn.style.display = "none";
    if (btnZoomOut) btnZoomOut.style.display = "none";
    if (btnFit) btnFit.style.display = "none";

    // Ocultar barra flotante de visualización antigua si existiera
    const oldFloat = document.getElementById("pro-canvas-controls");
    if (oldFloat) oldFloat.remove();

    // 2. Inyectar la Barra de Alineación Profesional debajo del topBar
    let proToolbar = document.getElementById("pro-layout-toolbar");
    if (!proToolbar) {
        proToolbar = document.createElement("div");
        proToolbar.id = "pro-layout-toolbar";
        proToolbar.innerHTML = `
            <div class="pro-group">
                <span class="pro-label">Alineación</span>
                <button class="pro-btn" id="proBtnAlignLeft" title="Alinear a la izquierda"><i class="fas fa-align-left"></i> Left</button>
                <button class="pro-btn" id="proBtnAlignCenterH" title="Alinear al centro horizontal"><i class="fas fa-align-center"></i> C-H</button>
                <button class="pro-btn" id="proBtnAlignRight" title="Alinear a la derecha"><i class="fas fa-align-right"></i> Right</button>
                <div class="pro-divider"></div>
                <button class="pro-btn" id="proBtnAlignTop" title="Alinear arriba"><i class="fas fa-square" style="transform: rotate(180deg); height: 10px; width: 10px; display: inline-block;"></i> Top</button>
                <button class="pro-btn" id="proBtnAlignCenterV" title="Alinear al centro vertical"><i class="fas fa-align-justify"></i> C-V</button>
                <button class="pro-btn" id="proBtnAlignBottom" title="Alinear abajo"><i class="fas fa-square" style="height: 10px; width: 10px; display: inline-block;"></i> Bottom</button>
            </div>

            <div class="pro-group">
                <span class="pro-label">Centrado Mockup</span>
                <button class="pro-btn" id="proBtnCenterH" title="Centrar horizontalmente en producto"><i class="fas fa-arrows-alt-h"></i> H-Center</button>
                <button class="pro-btn" id="proBtnCenterV" title="Centrar verticalmente en producto"><i class="fas fa-arrows-alt-v"></i> V-Center</button>
                <button class="pro-btn" id="proBtnCenterBoth" title="Centrar en ambos ejes"><i class="fas fa-compress-arrows-alt"></i> Centrar Total</button>
            </div>

            <div class="pro-group">
                <span class="pro-label">Distribución</span>
                <button class="pro-btn" id="proBtnDistributeH" title="Distribuir espacio horizontal (Mín. 3 seleccionados)"><i class="fas fa-ellipsis-h"></i> Distribuir H</button>
                <button class="pro-btn" id="proBtnDistributeV" title="Distribuir espacio vertical (Mín. 3 seleccionados)"><i class="fas fa-ellipsis-v"></i> Distribuir V</button>
            </div>

            <div class="pro-group">
                <span class="pro-label">Opciones de Vista</span>
                <button class="pro-btn active" id="proBtnToggleRulers" title="Activar/Desactivar reglas físicas"><i class="fas fa-ruler"></i> Reglas</button>
                <button class="pro-btn active" id="proBtnToggleGuides" title="Activar/Desactivar guías inteligentes"><i class="fas fa-magic"></i> Guías</button>
                <button class="pro-btn active" id="proBtnToggleMeasurements" title="Activar/Desactivar cotas en mm"><i class="fas fa-arrows-alt"></i> Cotas (mm)</button>
                <div class="pro-divider"></div>
                <span class="pro-label">Zoom</span>
                <button class="pro-btn" id="pro-zoom-reset" title="Restablecer zoom al 100%"><i class="fas fa-search-plus"></i> <span id="pro-zoom-text">100%</span></button>
            </div>
        `;
        workspace.insertBefore(proToolbar, topBar.nextSibling);
    }

    // 3. Vincular los eventos de clic
    bindClickHandlers();

    // 4. Configurar sincronización del Zoom en tiempo real al girar la rueda del ratón
    const canvasEl = document.getElementById("editorCanvas");
    if (canvasEl) {
        canvasEl.addEventListener("wheel", () => {
            setTimeout(updateZoomReadout, 10);
        });
    }
}

// Sincroniza y actualiza la lectura del zoom actual
export function updateZoomReadout() {
    const readout = document.getElementById("pro-zoom-text");
    if (readout && window.paper && paper.view) {
        const pct = Math.round(paper.view.zoom * 100);
        readout.textContent = `${pct}%`;
    }
}

// Obtener límites unificados de todos los objetos seleccionados
function getSelectionBounds(items) {
    if (!items || items.length === 0) return null;
    let rect = null;
    items.forEach(item => {
        const bounds = item.bounds;
        if (!rect) {
            rect = bounds.clone();
        } else {
            rect = rect.unite(bounds);
        }
    });
    return rect;
}

// Vincula las acciones de alineación, distribución y vista a los botones
function bindClickHandlers() {
    // Vincular botones de visibilidad
    const setupToggle = (btnId, toggleFn) => {
        const btn = document.getElementById(btnId);
        let state = true;

        if (btn) {
            btn.onclick = () => {
                state = !state;
                if (state) {
                    btn.classList.add("active");
                } else {
                    btn.classList.remove("active");
                }
                toggleFn(state);
            };
        }
    };

    setupToggle("proBtnToggleRulers", (state) => setRulersVisibility(state));
    setupToggle("proBtnToggleGuides", (state) => setGuidesVisibility(state));
    setupToggle("proBtnToggleMeasurements", (state) => setMeasurementsVisibility(state));

    // Resetear zoom al 100% al hacer clic en el indicador numérico
    const zoomReadoutBtn = document.getElementById("pro-zoom-reset");
    if (zoomReadoutBtn) {
        zoomReadoutBtn.onclick = () => {
            if (window.paper && paper.view) {
                paper.view.zoom = 1.0;
                if (window.currentMockup) {
                    paper.view.center = window.currentMockup.bounds.center;
                } else {
                    paper.view.center = new paper.Point(paper.view.viewSize.width / 2, paper.view.viewSize.height / 2);
                }
                paper.view.update();
                updateZoomReadout();
                if (typeof window.updateSelectionBox === "function") {
                    window.updateSelectionBox();
                }
            }
        };
    }

    // Funciones profesionales de alineación de objetos
    const alignSelection = (type) => {
        const selected = window.selectedItems || (window.selectedItem ? [window.selectedItem] : []);
        if (selected.length === 0 || !window.paper) {
            alert("Selecciona al menos un objeto para alinear.");
            return;
        }
        if (typeof window.saveHistory === "function") window.saveHistory();

        const mockupBounds = window.currentMockup ? window.currentMockup.bounds : paper.view.bounds;

        if (selected.length === 1) {
            // Un solo objeto seleccionado: se alinea respecto al producto (mockup)
            const item = selected[0];
            const bounds = item.bounds;
            const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
            if (!target) return;

            switch (type) {
                case "left":
                    target.position.x += (mockupBounds.left - bounds.left);
                    break;
                case "centerX":
                    target.position.x += (mockupBounds.center.x - bounds.center.x);
                    break;
                case "right":
                    target.position.x += (mockupBounds.right - bounds.right);
                    break;
                case "top":
                    target.position.y += (mockupBounds.top - bounds.top);
                    break;
                case "centerY":
                    target.position.y += (mockupBounds.center.y - bounds.center.y);
                    break;
                case "bottom":
                    target.position.y += (mockupBounds.bottom - bounds.bottom);
                    break;
            }
        } else {
            // Múltiples objetos seleccionados: se alinean respecto a su caja delimitadora unificada (Canva/Figma style)
            const combinedBounds = getSelectionBounds(selected);
            if (!combinedBounds) return;

            selected.forEach(item => {
                if (item.data && item.data.locked) return;
                const bounds = item.bounds;
                const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
                if (!target) return;

                switch (type) {
                    case "left":
                        target.position.x += (combinedBounds.left - bounds.left);
                        break;
                    case "centerX":
                        target.position.x += (combinedBounds.center.x - bounds.center.x);
                        break;
                    case "right":
                        target.position.x += (combinedBounds.right - bounds.right);
                        break;
                    case "top":
                        target.position.y += (combinedBounds.top - bounds.top);
                        break;
                    case "centerY":
                        target.position.y += (combinedBounds.center.y - bounds.center.y);
                        break;
                    case "bottom":
                        target.position.y += (combinedBounds.bottom - bounds.bottom);
                        break;
                }
            });
        }

        if (typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox();
        }
        paper.view.update();
    };

    // Vincular clics de alineación básicos
    const bindBtn = (id, actionFn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = actionFn;
    };

    bindBtn("proBtnAlignLeft", () => alignSelection("left"));
    bindBtn("proBtnAlignCenterH", () => alignSelection("centerX"));
    bindBtn("proBtnAlignRight", () => alignSelection("right"));
    bindBtn("proBtnAlignTop", () => alignSelection("top"));
    bindBtn("proBtnAlignCenterV", () => alignSelection("centerY"));
    bindBtn("proBtnAlignBottom", () => alignSelection("bottom"));

    // Centrados rápidos respecto al producto (mockup)
    const centerSelection = (axis) => {
        const selected = window.selectedItems || (window.selectedItem ? [window.selectedItem] : []);
        if (selected.length === 0 || !window.paper || !window.currentMockup) return;
        if (typeof window.saveHistory === "function") window.saveHistory();

        const mockupCenter = window.currentMockup.bounds.center;

        selected.forEach(item => {
            if (item.data && item.data.locked) return;
            const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
            if (!target) return;

            if (axis === "h" || axis === "both") {
                target.position.x = mockupCenter.x;
            }
            if (axis === "v" || axis === "both") {
                target.position.y = mockupCenter.y;
            }
        });

        if (typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox();
        }
        paper.view.update();
    };

    bindBtn("proBtnCenterH", () => centerSelection("h"));
    bindBtn("proBtnCenterV", () => centerSelection("v"));
    bindBtn("proBtnCenterBoth", () => centerSelection("both"));

    // Distribución de espacio inteligente ( mm / Paper.js ) de OBJETOS SELECCIONADOS
    const distributeSpacing = (axis) => {
        if (!window.paper) return;

        // Obtener solo los elementos que el usuario tiene seleccionados actualmente
        const selected = (window.selectedItems && window.selectedItems.length > 0) 
            ? [...window.selectedItems] 
            : (window.selectedItem ? [window.selectedItem] : []);

        if (selected.length < 3) {
            alert("Selecciona al menos 3 elementos para poder distribuirlos.");
            return;
        }

        if (typeof window.saveHistory === "function") window.saveHistory();

        if (axis === "h") {
            // Distribuir horizontalmente
            selected.sort((a, b) => a.bounds.left - b.bounds.left);
            const leftmost = selected[0];
            const rightmost = selected[selected.length - 1];
            
            const totalSpan = rightmost.bounds.right - leftmost.bounds.left;
            const sumWidths = selected.reduce((sum, it) => sum + it.bounds.width, 0);
            
            // Espacio disponible a repartir entre los elementos intermedios
            const remainingSpace = totalSpan - sumWidths;
            const spacing = remainingSpace / (selected.length - 1);

            let currentX = leftmost.bounds.left;
            for (let i = 0; i < selected.length; i++) {
                const item = selected[i];
                if (item.data && item.data.locked) continue;
                const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
                const halfWidth = item.bounds.width / 2;
                target.position.x += (currentX + halfWidth - target.position.x);
                currentX += item.bounds.width + spacing;
            }
        } else {
            // Distribuir verticalmente
            selected.sort((a, b) => a.bounds.top - b.bounds.top);
            const topmost = selected[0];
            const bottommost = selected[selected.length - 1];

            const totalSpan = bottommost.bounds.bottom - topmost.bounds.top;
            const sumHeights = selected.reduce((sum, it) => sum + it.bounds.height, 0);
            
            // Espacio disponible a repartir
            const remainingSpace = totalSpan - sumHeights;
            const spacing = remainingSpace / (selected.length - 1);

            let currentY = topmost.bounds.top;
            for (let i = 0; i < selected.length; i++) {
                const item = selected[i];
                if (item.data && item.data.locked) continue;
                const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
                const halfHeight = item.bounds.height / 2;
                target.position.y += (currentY + halfHeight - target.position.y);
                currentY += item.bounds.height + spacing;
            }
        }

        // Forzar actualización de caja de selección
        if (typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox();
        }
        paper.view.update();
    };

    bindBtn("proBtnDistributeH", () => distributeSpacing("h"));
    bindBtn("proBtnDistributeV", () => distributeSpacing("v"));
}

// Iniciar automáticamente al cargar el DOM
window.addEventListener("DOMContentLoaded", () => {
    setTimeout(initProControls, 500);
});
