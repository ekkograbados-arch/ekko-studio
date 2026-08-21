/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/canvasGuidesAndRulers.js
Descripción: Sistema de Reglas en Milímetros (mm) que escalan con el zoom de la rueda,
             y Guías Inteligentes (Smart Guides) estilo Canva para alineación y snapping.
========================================================================= */

let topRulerCanvas = null;
let leftRulerCanvas = null;
let cornerEl = null;
let showRulers = true;
let showGuides = true;

// Inicializa las reglas fijas en HTML
export function initRulers() {
    const container = document.getElementById("canvasContainer");
    if (!container) return;

    // Forzar posicionamiento relativo del contenedor para posicionar overlays
    container.style.position = "relative";

    // Crear esquina superior izquierda
    cornerEl = document.getElementById("ekko-ruler-corner");
    if (!cornerEl) {
        cornerEl = document.createElement("div");
        cornerEl.id = "ekko-ruler-corner";
        cornerEl.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 20px;
            height: 20px;
            background: #f1f5f9;
            border-bottom: 1px solid #cbd5e1;
            border-right: 1px solid #cbd5e1;
            z-index: 1000;
        `;
        container.appendChild(cornerEl);
    }

    // Crear regla superior
    topRulerCanvas = document.getElementById("ekko-ruler-top");
    if (!topRulerCanvas) {
        topRulerCanvas = document.createElement("canvas");
        topRulerCanvas.id = "ekko-ruler-top";
        topRulerCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 20px;
            right: 0;
            height: 20px;
            background: #f8fafc;
            border-bottom: 1px solid #cbd5e1;
            z-index: 999;
            pointer-events: none;
        `;
        container.appendChild(topRulerCanvas);
    }

    // Crear regla izquierda
    leftRulerCanvas = document.getElementById("ekko-ruler-left");
    if (!leftRulerCanvas) {
        leftRulerCanvas = document.createElement("canvas");
        leftRulerCanvas.id = "ekko-ruler-left";
        leftRulerCanvas.style.cssText = `
            position: absolute;
            top: 20px;
            left: 0;
            bottom: 0;
            width: 20px;
            background: #f8fafc;
            border-right: 1px solid #cbd5e1;
            z-index: 999;
            pointer-events: none;
        `;
        container.appendChild(leftRulerCanvas);
    }

    // Escuchar el redimensionamiento del contenedor para ajustar lienzos de reglas
    const resizeObserver = new ResizeObserver(() => {
        resizeRulers();
        drawRulers();
    });
    resizeObserver.observe(container);

    // Ajustar por primera vez
    resizeRulers();
    drawRulers();

    // Hook en el render loop de Paper.js para actualizar reglas cuando cambie la vista
    let lastZoom = 0;
    let lastCenter = null;
    if (window.paper && paper.view) {
        paper.view.on("frame", () => {
            if (!showRulers) return;
            const currentZoom = paper.view.zoom;
            const currentCenter = paper.view.center;
            const centerChanged = !lastCenter || !lastCenter.equals(currentCenter);
            if (currentZoom !== lastZoom || centerChanged || window.dragging || window.resizeActive || window.rotationActive) {
                drawRulers();
                lastZoom = currentZoom;
                lastCenter = currentCenter ? currentCenter.clone() : null;
            }
        });
    }
}

// Redimensiona los canvases de las reglas físicas para coincidir con el contenedor
function resizeRulers() {
    const container = document.getElementById("canvasContainer");
    if (!container || !topRulerCanvas || !leftRulerCanvas) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    topRulerCanvas.width = w - 20;
    topRulerCanvas.height = 20;
    topRulerCanvas.style.width = (w - 20) + "px";
    topRulerCanvas.style.height = "20px";

    leftRulerCanvas.width = 20;
    leftRulerCanvas.height = h - 20;
    leftRulerCanvas.style.width = "20px";
    leftRulerCanvas.style.height = (h - 20) + "px";
}

// Dibuja las marcas y etiquetas en milímetros

// Dibuja las marcas y etiquetas en milímetros reales
export function drawRulers() {
    if (!showRulers || !topRulerCanvas || !leftRulerCanvas || !window.paper || !paper.view) return;

    if (typeof window.updateGlobalScaleFactor === "function") {
        window.updateGlobalScaleFactor();
    }

    const zoom = paper.view.zoom;
    const bounds = paper.view.bounds;

    const originX = window.currentMockup ? window.currentMockup.bounds.left : 0;
    const originY = window.currentMockup ? window.currentMockup.bounds.top : 0;
    const scaleFactor = window.paperUnitsPerMm || 1.0;
    const mmPerUnit = window.mmPerPaperUnit || 1.0;

    // Configuración regla superior
    const ctxTop = topRulerCanvas.getContext("2d");
    ctxTop.clearRect(0, 0, topRulerCanvas.width, topRulerCanvas.height);
    ctxTop.font = "9px sans-serif";
    ctxTop.fillStyle = "#475569";
    ctxTop.strokeStyle = "#94a3b8";
    ctxTop.lineWidth = 1;

    // Configuración regla izquierda
    const ctxLeft = leftRulerCanvas.getContext("2d");
    ctxLeft.clearRect(0, 0, leftRulerCanvas.width, leftRulerCanvas.height);
    ctxLeft.font = "9px sans-serif";
    ctxLeft.fillStyle = "#475569";
    ctxLeft.strokeStyle = "#94a3b8";
    ctxLeft.lineWidth = 1;

    // Calcular el paso idóneo en milímetros (que quepan etiquetas cada ~60 a ~100 píxeles de pantalla)
    const targetPixels = 70;
    const rawStepMm = targetPixels * (mmPerUnit / zoom);
    const standardSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    let stepMm = standardSteps[0];
    for (let s of standardSteps) {
        if (rawStepMm >= s) {
            stepMm = s;
        } else {
            break;
        }
    }

    // --- REGLA SUPERIOR (Eje X) ---
    const minMmX = (bounds.left - originX) * mmPerUnit;
    const maxMmX = (bounds.right - originX) * mmPerUnit;
    const startMmX = Math.floor(minMmX / stepMm) * stepMm;

    for (let mm = startMmX; mm <= maxMmX; mm += stepMm) {
        const x = originX + mm * scaleFactor;
        const screenX = (x - bounds.left) * zoom;
        if (screenX < 0 || screenX > topRulerCanvas.width) continue;

        // Dibujar marca principal (mayor)
        ctxTop.beginPath();
        ctxTop.moveTo(screenX, 0);
        ctxTop.lineTo(screenX, 15);
        ctxTop.stroke();

        // Etiqueta en mm
        ctxTop.fillText(`${Math.round(mm)} mm`, screenX + 4, 12);

        // Sub-marcas (menores cada 1/10 de paso)
        const subStepMm = stepMm / 10;
        if (subStepMm * scaleFactor * zoom >= 2) {
            for (let i = 1; i < 10; i++) {
                const subMm = mm + i * subStepMm;
                const subX = originX + subMm * scaleFactor;
                const subScreenX = (subX - bounds.left) * zoom;
                if (subScreenX < 0 || subScreenX > topRulerCanvas.width) continue;

                ctxTop.beginPath();
                ctxTop.moveTo(subScreenX, 0);
                ctxTop.lineTo(subScreenX, i === 5 ? 10 : 5);
                ctxTop.stroke();
            }
        }
    }

    // --- REGLA IZQUIERDA (Eje Y) ---
    const minMmY = (bounds.top - originY) * mmPerUnit;
    const maxMmY = (bounds.bottom - originY) * mmPerUnit;
    const startMmY = Math.floor(minMmY / stepMm) * stepMm;

    for (let mm = startMmY; mm <= maxMmY; mm += stepMm) {
        const y = originY + mm * scaleFactor;
        const screenY = (y - bounds.top) * zoom;
        if (screenY < 0 || screenY > leftRulerCanvas.height) continue;

        // Dibujar marca principal (mayor)
        ctxLeft.beginPath();
        ctxLeft.moveTo(0, screenY);
        ctxLeft.lineTo(15, screenY);
        ctxLeft.stroke();

        // Dibujar etiqueta rotada verticalmente para lectura cómoda
        ctxLeft.save();
        ctxLeft.translate(12, screenY + 4);
        ctxLeft.rotate(-Math.PI / 2);
        ctxLeft.fillText(`${Math.round(mm)} mm`, 0, 0);
        ctxLeft.restore();

        // Sub-marcas (menores cada 1/10 de paso)
        const subStepMm = stepMm / 10;
        if (subStepMm * scaleFactor * zoom >= 2) {
            for (let i = 1; i < 10; i++) {
                const subMm = mm + i * subStepMm;
                const subY = originY + subMm * scaleFactor;
                const subScreenY = (subY - bounds.top) * zoom;
                if (subScreenY < 0 || subScreenY > leftRulerCanvas.height) continue;

                ctxLeft.beginPath();
                ctxLeft.moveTo(0, subScreenY);
                ctxLeft.lineTo(i === 5 ? 10 : 5, subScreenY);
                ctxLeft.stroke();
            }
        }
    }
}

// Configura la visibilidad de las reglas en pantalla
export function setRulersVisibility(visible) {
    showRulers = visible;
    const s = visible ? "block" : "none";
    if (topRulerCanvas) topRulerCanvas.style.display = s;
    if (leftRulerCanvas) leftRulerCanvas.style.display = s;
    if (cornerEl) cornerEl.style.display = s;
    if (visible) {
        drawRulers();
    }
}

export function setGuidesVisibility(visible) {
    showGuides = visible;
    if (!visible) {
        clearSmartGuides();
    }
}

/* =========================================================================
   SISTEMA DE GUÍAS INTELIGENTES (SMART GUIDES & SNAPPING)
========================================================================= */

let guidesGroup = null;

// Borra las líneas de guía inteligente visibles en el lienzo
export function clearSmartGuides() {
    if (guidesGroup) {
        guidesGroup.remove();
        guidesGroup = null;
    }
    if (window.paper && paper.view) {
        paper.view.update();
    }
}

// Ejecuta el algoritmo de snapping y dibuja las guías en Paper.js
export function calculateSmartGuides(draggedItem, event) {
    if (!showGuides || !draggedItem || !window.paper || !paper.project) return;

    clearSmartGuides();

    // Obtener todos los elementos candidatos para la alineación
    const candidates = paper.project.activeLayer.children.filter(item => {
        if (item === draggedItem) return false;
        if (item.data && (item.data.isSelectionBox || item.data.isHandle || item.data.isCurveHandle || item.data.isNodeEditOverlay)) return false;
        if (item === guidesGroup) return false;
        return true; // Incluye otros elementos de diseño y el mockup actual
    });

    if (candidates.length === 0) return;

    // Obtener el elemento interno real si es un clipGroup
    const activeDragged = draggedItem.data && draggedItem.data.clipGroup
        ? draggedItem.children.find(c => !c.clipMask)
        : draggedItem;

    if (!activeDragged) return;

    const selBounds = activeDragged.bounds;
    const zoom = paper.view.zoom;
    const snapThreshold = 3 / zoom; // Ajustado a 3px para un snapping suave estilo Canva y Figma // Umbral de 5 píxeles en pantalla convertido a unidades de Paper (mm)

    let snapX = null;
    let snapY = null;
    let guideLines = [];

    // Coordenadas clave del elemento que se arrastra
    const selX = {
        left: selBounds.left,
        center: selBounds.center.x,
        right: selBounds.right
    };
    const selY = {
        top: selBounds.top,
        center: selBounds.center.y,
        bottom: selBounds.bottom
    };

    // Evaluar alineaciones con cada candidato
    for (let item of candidates) {
        const target = item.data && item.data.clipGroup
            ? item.children.find(c => !c.clipMask)
            : item;

        if (!target) continue;
        const tarBounds = target.bounds;

        const tarX = {
            left: tarBounds.left,
            center: tarBounds.center.x,
            right: tarBounds.right
        };
        const tarY = {
            top: tarBounds.top,
            center: tarBounds.center.y,
            bottom: tarBounds.bottom
        };

        // 1. Alineación Horizontal (Alinear X - Guías Verticales)
        for (let sKey in selX) {
            for (let tKey in tarX) {
                const diff = selX[sKey] - tarX[tKey];
                if (Math.abs(diff) <= snapThreshold) {
                    snapX = diff; // Cantidad a corregir
                    guideLines.push({
                        type: "vertical",
                        x: tarX[tKey],
                        yStart: Math.min(selBounds.top, tarBounds.top),
                        yEnd: Math.max(selBounds.bottom, tarBounds.bottom)
                    });
                    break;
                }
            }
            if (snapX !== null) break;
        }

        // 2. Alineación Vertical (Alinear Y - Guías Horizontales)
        for (let sKey in selY) {
            for (let tKey in tarY) {
                const diff = selY[sKey] - tarY[tKey];
                if (Math.abs(diff) <= snapThreshold) {
                    snapY = diff;
                    guideLines.push({
                        type: "horizontal",
                        y: tarY[tKey],
                        xStart: Math.min(selBounds.left, tarBounds.left),
                        xEnd: Math.max(selBounds.right, tarBounds.right)
                    });
                    break;
                }
            }
            if (snapY !== null) break;
        }
    }

    // Aplicar Snapping físico si hay coincidencia
    if (snapX !== null) {
        activeDragged.position.x -= snapX;
    }
    if (snapY !== null) {
        activeDragged.position.y -= snapY;
    }

    // Dibujar las líneas de guía en el lienzo
    if (guideLines.length > 0) {
        guidesGroup = new paper.Group();
        guidesGroup.data = { isSelectionBox: true, isSmartGuide: true };

        guideLines.forEach(line => {
            let path;
            if (line.type === "vertical") {
                path = new paper.Path.Line(
                    new paper.Point(line.x, line.yStart - 10),
                    new paper.Point(line.x, line.yEnd + 10)
                );
            } else {
                path = new paper.Path.Line(
                    new paper.Point(line.xStart - 10, line.y),
                    new paper.Point(line.xEnd + 10, line.y)
                );
            }

            path.strokeColor = "#db2777"; // Rosa Canva/LightBurn de alto contraste
            path.strokeWidth = 1 / zoom;
            path.dashArray = [4 / zoom, 4 / zoom];
            guidesGroup.addChild(path);
        });

        // Asegurar que las guías queden en el plano superior sin tapar la selección
        guidesGroup.bringToFront();
        if (window.selectionBoxGroup) {
            window.selectionBoxGroup.bringToFront();
        }
    }

    paper.view.update();
}

// Hook de integración automática en la herramienta de selección de Paper.js
export function installSmartGuidesHook() {
    if (!window.paper || !paper.tools || paper.tools.length === 0) {
        setTimeout(installSmartGuidesHook, 100);
        return;
    }

    // Buscar la herramienta de selección principal que tiene los eventos onMouseDrag
    const selectTool = paper.tools.find(t => t.onMouseDrag && !t.data?.hooked);
    if (!selectTool) return;

    const originalOnMouseDrag = selectTool.onMouseDrag;
    const originalOnMouseUp = selectTool.onMouseUp;

    selectTool.onMouseDrag = function(event) {
        // Ejecutar primero el arrastre clásico del elemento
        originalOnMouseDrag.call(this, event);

        // Si estamos arrastrando el objeto seleccionado, calcular guías e imantación
        if (window.dragging && window.selectedItem && !window.selectedItem.data?.locked) {
            calculateSmartGuides(window.selectedItem, event);
        }
    };

    selectTool.onMouseUp = function(event) {
        originalOnMouseUp.call(this, event);
        clearSmartGuides();
    };

    selectTool.data = selectTool.data || {};
    selectTool.data.hooked = true;
    console.log("🚀 Guías inteligentes integradas con éxito en el flujo de arrastre de Paper.js.");
}

// Iniciar automáticamente las guías y reglas
window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        initRulers();
        installSmartGuidesHook();
    }, 400);
});
