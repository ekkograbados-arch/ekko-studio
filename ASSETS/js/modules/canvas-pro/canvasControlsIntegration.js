/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/canvasControlsIntegration.js
Descripción: Integrador de Interfaz Profesional. Inyecta la barra de formato/alineación,
             el control flotante superior derecho de zoom, y vincula las reglas,
             guías inteligentes, cotas y comandos de distribución.
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

        /* Panel Flotante Superior Derecho de Control del Lienzo */
        #pro-canvas-controls {
            position: absolute;
            top: 16px;
            right: 16px;
            background: rgba(255, 255, 255, 0.95);
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
            display: flex;
            align-items: center;
            padding: 4px 8px;
            gap: 8px;
            z-index: 1010; /* Encima de las reglas */
            backdrop-filter: blur(4px);
        }

        .zoom-indicator {
            font-size: 13px;
            font-weight: 700;
            color: #007bff;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 6px;
            transition: background 0.15s ease;
        }

        .zoom-indicator:hover {
            background: #e2e8f0;
        }
    `;
    document.head.appendChild(styleEl);
}

// Inyección e inicialización de la barra de controles
export function initProControls() {
    const workspace = document.getElementById("workspace");
    const topBar = document.getElementById("topBar");
    if (!workspace || !topBar) return;

    // 1. Eliminar lupas de zoom antiguas del topBar
    const btnZoomIn = document.getElementById("btnZoomIn");
    const btnZoomOut = document.getElementById("btnZoomOut");
    const btnFit = document.getElementById("btnFit");
    if (btnZoomIn) btnZoomIn.style.display = "none";
    if (btnZoomOut) btnZoomOut.style.display = "none";
    if (btnFit) btnFit.style.display = "none";

    // 2. Inyectar la Barra de Alineación Profesional debajo del topBar
    let proToolbar = document.getElementById("pro-layout-toolbar");
    if (!proToolbar) {
        proToolbar = document.createElement("div");
        proToolbar.id = "pro-layout-toolbar";
        proToolbar.innerHTML = `
            <div class="pro-group">
                <span class="pro-label">Alineación</span>
                <button class="pro-btn" id="btnAlignLeft" title="Alinear a la izquierda"><i class="fas fa-align-left"></i> Left</button>
                <button class="pro-btn" id="btnAlignCenterH" title="Alinear al centro horizontal"><i class="fas fa-align-center"></i> C-H</button>
                <button class="pro-btn" id="btnAlignRight" title="Alinear a la derecha"><i class="fas fa-align-right"></i> Right</button>
                <div class="pro-divider"></div>
                <button class="pro-btn" id="btnAlignTop" title="Alinear arriba"><i class="fas fa-square" style="transform: rotate(180deg); height: 10px; width: 10px; display: inline-block;"></i> Top</button>
                <button class="pro-btn" id="btnAlignCenterV" title="Alinear al centro vertical"><i class="fas fa-align-justify"></i> C-V</button>
                <button class="pro-btn" id="btnAlignBottom" title="Alinear abajo"><i class="fas fa-square" style="height: 10px; width: 10px; display: inline-block;"></i> Bottom</button>
            </div>

            <div class="pro-group">
                <span class="pro-label">Centrado Canvas</span>
                <button class="pro-btn" id="btnCenterH" title="Centrar horizontalmente en producto"><i class="fas fa-arrows-alt-h"></i> Centrar H</button>
                <button class="pro-btn" id="btnCenterV" title="Centrar verticalmente en producto"><i class="fas fa-arrows-alt-v"></i> Centrar V</button>
                <button class="pro-btn" id="btnCenterBoth" title="Centrar en ambos ejes"><i class="fas fa-compress-arrows-alt"></i> Centrar Total</button>
            </div>

            <div class="pro-group">
                <span class="pro-label">Distribución</span>
                <button class="pro-btn" id="btnDistributeH" title="Distribuir espacio horizontal uniformemente"><i class="fas fa-ellipsis-h"></i> Distribuir H</button>
                <button class="pro-btn" id="btnDistributeV" title="Distribuir espacio vertical uniformemente"><i class="fas fa-ellipsis-v"></i> Distribuir V</button>
            </div>

            <div class="pro-group">
                <span class="pro-label">Opciones de Vista</span>
                <button class="pro-btn active" id="btnToggleRulers" title="Activar/Desactivar reglas físicas"><i class="fas fa-ruler"></i> Reglas</button>
                <button class="pro-btn active" id="btnToggleGuides" title="Activar/Desactivar guías inteligentes"><i class="fas fa-magic"></i> Guías</button>
                <button class="pro-btn active" id="btnToggleMeasurements" title="Activar/Desactivar cotas de tamaño en mm"><i class="fas fa-arrows-alt"></i> Cotas (mm)</button>
            </div>
        `;
        workspace.insertBefore(proToolbar, topBar.nextSibling);
    }

    // 3. Inyectar el Panel Flotante Superior Derecho sobre el canvasContainer
    const canvasContainer = document.getElementById("canvasContainer");
    if (canvasContainer) {
        let proCanvasControls = document.getElementById("pro-canvas-controls");
        if (!proCanvasControls) {
            proCanvasControls = document.createElement("div");
            proCanvasControls.id = "pro-canvas-controls";
            proCanvasControls.innerHTML = `
                <span class="pro-label"><i class="fas fa-eye"></i> Visualización</span>
                <button class="pro-btn active" id="btnFloatRulers" title="Alternar Reglas"><i class="fas fa-ruler"></i></button>
                <button class="pro-btn active" id="btnFloatGuides" title="Alternar Guías"><i class="fas fa-magic"></i></button>
                <button class="pro-btn active" id="btnFloatMeasurements" title="Alternar Cotas"><i class="fas fa-arrows-alt"></i></button>
                <div class="pro-divider"></div>
                <div class="zoom-indicator" id="zoom-readout" title="Haga clic para restablecer zoom al 100%">100%</div>
            `;
            canvasContainer.appendChild(proCanvasControls);
        }
    }

    // 4. Vincular los eventos de clic
    bindClickHandlers();

    // 5. Configurar sincronización del Zoom en tiempo real al girar la rueda del ratón
    const canvasEl = document.getElementById("editorCanvas");
    if (canvasEl) {
        canvasEl.addEventListener("wheel", () => {
            setTimeout(updateZoomReadout, 10);
        });
    }
}

// Sincroniza y actualiza la lectura del zoom actual
export function updateZoomReadout() {
    const readout = document.getElementById("zoom-readout");
    if (readout && window.paper && paper.view) {
        const pct = Math.round(paper.view.zoom * 100);
        readout.textContent = `${pct}%`;
    }
}

// Vincula las acciones de alineación, distribución y vista a los botones
function bindClickHandlers() {
    // Vincular botones duplicados de vista (barra de formato y panel flotante derecho)
    const setupToggle = (btnId, floatId, toggleFn) => {
        const btn = document.getElementById(btnId);
        const floatBtn = document.getElementById(floatId);
        let state = true;

        const executeToggle = (forceState) => {
            state = forceState !== undefined ? forceState : !state;
            if (state) {
                if (btn) btn.classList.add("active");
                if (floatBtn) floatBtn.classList.add("active");
            } else {
                if (btn) btn.classList.remove("active");
                if (floatBtn) floatBtn.classList.remove("active");
            }
            toggleFn(state);
        };

        if (btn) btn.onclick = () => executeToggle();
        if (floatBtn) floatBtn.onclick = () => executeToggle();
    };

    setupToggle("btnToggleRulers", "btnFloatRulers", (state) => setRulersVisibility(state));
    setupToggle("btnToggleGuides", "btnFloatGuides", (state) => setGuidesVisibility(state));
    setupToggle("btnToggleMeasurements", "btnFloatMeasurements", (state) => setMeasurementsVisibility(state));

    // Resetear zoom al 100% al hacer clic en el indicador numérico
    const zoomReadout = document.getElementById("zoom-readout");
    if (zoomReadout) {
        zoomReadout.onclick = () => {
            if (window.paper && paper.view) {
                paper.view.zoom = 1.0;
                if (window.currentMockup) {
                    paper.view.center = window.currentMockup.bounds.center;
                } else {
                    paper.view.center = new paper.Point(paper.view.viewSize.width / 2, paper.view.viewSize.height / 2);
                }
                paper.view.update();
                updateZoomReadout();
                if (window.selectedItem && typeof window.updateSelectionBox === "function") {
                    window.updateSelectionBox(window.selectedItem);
                }
            }
        };
    }

    // Funciones nativas de alineación (si están disponibles en editor.js)
    // Agregamos redundancia robusta para garantizar su funcionamiento perfecto
    const alignSelection = (type) => {
        if (!window.selectedItem || !window.paper) return;
        if (typeof window.saveHistory === "function") window.saveHistory();

        const item = window.selectedItem;
        const bounds = item.bounds;
        const mockupBounds = window.currentMockup ? window.currentMockup.bounds : paper.view.bounds;

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

        if (typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox(item);
        }
        paper.view.update();
    };

    // Vincular clics de alineación básicos
    const bindBtn = (id, actionFn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = actionFn;
    };

    bindBtn("btnAlignLeft", () => alignSelection("left"));
    bindBtn("btnAlignCenterH", () => alignSelection("centerX"));
    bindBtn("btnAlignRight", () => alignSelection("right"));
    bindBtn("btnAlignTop", () => alignSelection("top"));
    bindBtn("btnAlignCenterV", () => alignSelection("centerY"));
    bindBtn("btnAlignBottom", () => alignSelection("bottom"));

    // Centrados rápidos respecto al producto
    const centerSelection = (axis) => {
        if (!window.selectedItem || !window.paper || !window.currentMockup) return;
        if (typeof window.saveHistory === "function") window.saveHistory();

        const item = window.selectedItem;
        const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
        if (!target) return;

        const mockupCenter = window.currentMockup.bounds.center;

        if (axis === "h" || axis === "both") {
            target.position.x = mockupCenter.x;
        }
        if (axis === "v" || axis === "both") {
            target.position.y = mockupCenter.y;
        }

        if (typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox(item);
        }
        paper.view.update();
    };

    bindBtn("btnCenterH", () => centerSelection("h"));
    bindBtn("btnCenterV", () => centerSelection("v"));
    bindBtn("btnCenterBoth", () => centerSelection("both"));

    // Distribución de espacio inteligente ( mm / Paper.js )
    const distributeSpacing = (axis) => {
        if (!window.paper) return;

        // Obtener todos los elementos editables (no bloqueados, no mockup, no guías)
        const items = paper.project.activeLayer.children.filter(item => {
            if (item.data && (item.data.mockup || item.data.isSelectionBox || item.data.isHandle || item.data.isCurveHandle || item.data.isSmartGuide || item.data.isMeasurement)) return false;
            return true;
        });

        if (items.length < 3) {
            alert("Seleccione o tenga al menos 3 elementos de diseño en pantalla para poder distribuirlos.");
            return;
        }

        if (typeof window.saveHistory === "function") window.saveHistory();

        if (axis === "h") {
            // Distribuir horizontalmente
            items.sort((a, b) => a.bounds.left - b.bounds.left);
            const leftmost = items[0];
            const rightmost = items[items.length - 1];
            
            const totalSpan = rightmost.bounds.right - leftmost.bounds.left;
            const sumWidths = items.reduce((sum, it) => sum + it.bounds.width, 0);
            const spacing = (totalSpan - sumWidths) / (items.length - 1);

            let currentX = leftmost.bounds.left;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
                const halfWidth = item.bounds.width / 2;
                target.position.x += (currentX + halfWidth - target.position.x);
                currentX += item.bounds.width + spacing;
            }
        } else {
            // Distribuir verticalmente
            items.sort((a, b) => a.bounds.top - b.bounds.top);
            const topmost = items[0];
            const bottommost = items[items.length - 1];

            const totalSpan = bottommost.bounds.bottom - topmost.bounds.top;
            const sumHeights = items.reduce((sum, it) => sum + it.bounds.height, 0);
            const spacing = (totalSpan - sumHeights) / (items.length - 1);

            let currentY = topmost.bounds.top;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
                const halfHeight = item.bounds.height / 2;
                target.position.y += (currentY + halfHeight - target.position.y);
                currentY += item.bounds.height + spacing;
            }
        }

        // Forzar actualización de caja de selección del elemento activo si existe
        if (window.selectedItem && typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
    };

    bindBtn("btnDistributeH", () => distributeSpacing("h"));
    bindBtn("btnDistributeV", () => distributeSpacing("v"));
}

// Iniciar automáticamente al cargar el DOM
window.addEventListener("DOMContentLoaded", () => {
    setTimeout(initProControls, 500);
});
