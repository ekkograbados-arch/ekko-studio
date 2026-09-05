/* ========================================================================
RUTA DESTINO EN TU DISCO LOCAL: ASSETS/js/modules/canvas-pro/canvasMeasurements.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE TU ARCHIVO "ASSETS/js/modules/canvas-pro/canvasMeasurements.js"
ESTADO: VERSIÓN DEFINITIVA v10.2 (TITANIUM PRECISION) CON COMENTARIOS EXPLICATIVOS INTEGRADOS
======================================================================== */

let measurementsGroup = null;
let showMeasurements = true;

// Limpia todas las cotas y dimensiones temporales dibujadas en el lienzo
export function clearMeasurements() {
    if (measurementsGroup) {
        measurementsGroup.remove();
        measurementsGroup = null;
    }
    if (window.paper && paper.view) {
        paper.view.update();
    }
}

// Configura la visibilidad del sistema de cotas
export function setMeasurementsVisibility(visible) {
    showMeasurements = visible;
    if (!visible) {
        clearMeasurements();
    }
}

// Dibuja una línea de cota con flechas y texto en milímetros
function drawDimensionLine(p1, p2, offsetVector, textValue, color = "#007bff") {
    if (!window.paper || !measurementsGroup) return;

    const zoom = paper.view.zoom;
    const arrowSize = 5 / zoom; // Ajustar tamaño físico de la flecha con el zoom

    // Puntos de la línea de cota desplazada
    const dp1 = p1.add(offsetVector);
    const dp2 = p2.add(offsetVector);

    // 1. Líneas de extensión desde los límites del objeto hasta la línea de cota
    const extLine1 = new paper.Path.Line(p1, dp1.add(offsetVector.normalize(2 / zoom)));
    extLine1.strokeColor = color;
    extLine1.strokeWidth = 0.8 / zoom;
    extLine1.opacity = 0.5;
    measurementsGroup.addChild(extLine1);

    const extLine2 = new paper.Path.Line(p2, dp2.add(offsetVector.normalize(2 / zoom)));
    extLine2.strokeColor = color;
    extLine2.strokeWidth = 0.8 / zoom;
    extLine2.opacity = 0.5;
    measurementsGroup.addChild(extLine2);

    // 2. Línea de dimensión principal
    const dimLine = new paper.Path.Line(dp1, dp2);
    dimLine.strokeColor = color;
    dimLine.strokeWidth = 1 / zoom;
    measurementsGroup.addChild(dimLine);

    // 3. Flechas de cota
    const lineVector = dp2.subtract(dp1);
    const lineNormal = lineVector.normalize();

    // Flecha 1 (inicio)
    const arrow1 = new paper.Path({
        segments: [
            dp1.add(lineNormal.rotate(30).multiply(arrowSize)),
            dp1,
            dp1.add(lineNormal.rotate(-30).multiply(arrowSize))
        ],
        strokeColor: color,
        strokeWidth: 1 / zoom
    });
    measurementsGroup.addChild(arrow1);

    // Flecha 2 (fin)
    const arrow2 = new paper.Path({
        segments: [
            dp2.subtract(lineNormal.rotate(30).multiply(arrowSize)),
            dp2,
            dp2.subtract(lineNormal.rotate(-30).multiply(arrowSize))
        ],
        strokeColor: color,
        strokeWidth: 1 / zoom
    });
    measurementsGroup.addChild(arrow2);

    // 4. Texto de dimensión en milímetros reales
    const mmVal = typeof textValue === 'number' ? textValue * (window.mmPerPaperUnit || 1.0) : textValue;
    const textStr = typeof mmVal === 'number' ? `${mmVal.toFixed(1)} mm` : mmVal;

    const midPoint = dp1.add(dp2).multiply(0.5);
    const textOffset = offsetVector.normalize(8 / zoom);

    const textEl = new paper.PointText({
        point: midPoint.add(textOffset),
        content: textStr,
        fillColor: color,
        fontSize: 10 / zoom,
        fontFamily: "sans-serif",
        justification: "center"
    });

    // Alinear rotación del texto con el ángulo de la línea para cotas laterales
    const angle = lineVector.angle;
    if (Math.abs(angle) > 45 && Math.abs(angle) < 135) {
        textEl.rotate(angle + 90, textEl.point); // Mantener texto orientado vertical u horizontal
    } else if (Math.abs(angle) >= 135) {
        textEl.rotate(angle + 180, textEl.point);
    }
    measurementsGroup.addChild(textEl);
}

// Genera y dibuja las cotas de diseño en el lienzo
export function drawMeasurements() {
    if (typeof window.updateGlobalScaleFactor === "function") window.updateGlobalScaleFactor();
    if (!showMeasurements || !window.paper || !paper.project) return;

    clearMeasurements();
    measurementsGroup = new paper.Group();
    measurementsGroup.data = { isSelectionBox: true, isMeasurement: true };

    const zoom = paper.view.zoom;
    const offsetMm = 15 / zoom; // Distancia física de las cotas en pantalla respecto al objeto

    // === 1. DIBUJAR COTAS DEL MOCKUP (Silueta del Producto en color gris profesional) ===
    if (window.currentMockup) {
        const mockupBounds = window.currentMockup.bounds;
        if (mockupBounds && mockupBounds.width > 0 && mockupBounds.height > 0) {
            const mColor = "#64748b"; // Gris pizarra discreto para el producto

            // Cota superior (Ancho del Mockup)
            drawDimensionLine(
                new paper.Point(mockupBounds.left, mockupBounds.top),
                new paper.Point(mockupBounds.right, mockupBounds.top),
                new paper.Point(0, -offsetMm * 1.5),
                mockupBounds.width,
                mColor
            );

            // Cota izquierda (Alto del Mockup)
            drawDimensionLine(
                new paper.Point(mockupBounds.left, mockupBounds.bottom),
                new paper.Point(mockupBounds.left, mockupBounds.top),
                new paper.Point(-offsetMm * 1.5, 0),
                mockupBounds.height,
                mColor
            );
        }
    }

    /* 
       -------------------------------------------------------------------------
       [ SECCIÓN C ] COTAS DE DISEÑO DEL OBJETO SELECCIONADO (canvasMeasurements.js)
       -------------------------------------------------------------------------
       Modifica el valor de la variable `objColor` abajo para alterar el color 
       de las cotas de medición métricas (mm) en tu lienzo. El valor predeterminado 
       es `#007bff` (Azul de Diseño), que contrasta de forma excelente con el
       mockup y los trazos vectoriales negros de grabado.
    */
    if (window.selectedItem && !window.selectedItem.data?.mockup) {
        const displayItem = typeof window.getContentItem === 'function' ? window.getContentItem(window.selectedItem) : window.selectedItem;
        if (!displayItem || !displayItem.bounds || displayItem.bounds.width <= 1 || displayItem.bounds.height <= 1) return;

        const bounds = displayItem.bounds;
        const objColor = "#007bff"; // <- COLOR DE SECCIÓN C (Azul técnico para diseño útil)

        // Cota inferior (Ancho del Diseño)
        drawDimensionLine(
            new paper.Point(bounds.left, bounds.bottom),
            new paper.Point(bounds.right, bounds.bottom),
            new paper.Point(0, offsetMm),
            bounds.width,
            objColor
        );

        // Cota derecha (Alto del Diseño)
        drawDimensionLine(
            new paper.Point(bounds.right, bounds.bottom),
            new paper.Point(bounds.right, bounds.top),
            new paper.Point(offsetMm, 0),
            bounds.height,
            objColor
        );
    }

    // Asegurarse de que el grupo de cotas no tape los tiradores interactivos
    measurementsGroup.bringToFront();
    if (window.selectionBoxGroup) {
        window.selectionBoxGroup.bringToFront();
    }
    paper.view.update();
}

// Hook de integración automática para escuchar eventos de transformación
export function installMeasurementsHook() {
    if (!window.paper || !paper.project || !paper.tools || paper.tools.length === 0) {
        setTimeout(installMeasurementsHook, 100);
        return;
    }

    const selectTool = paper.tools.find(t => t.onMouseDrag);
    if (!selectTool) return;

    // Engancharnos al flujo existente sin sobreescribir ni romper la lógica actual
    const originalOnMouseDrag = selectTool.onMouseDrag;
    const originalOnMouseUp = selectTool.onMouseUp;

    selectTool.onMouseDrag = function(event) {
        // Ejecutar primero el arrastre o reescala nativa
        originalOnMouseDrag.call(this, event);

        // Si hay un objeto seleccionado y se está arrastrando o transformando, redibujar cotas
        if (showMeasurements && (window.dragging || window.resizeActive || window.rotationActive)) {
            drawMeasurements();
        }
    };

    selectTool.onMouseUp = function(event) {
        originalOnMouseUp.call(this, event);
        // Ocultar cotas inmediatamente al soltar el ratón para una interfaz limpia
        clearMeasurements();
    };

    console.log("🚀 Sistema de cotas dinámicas (mm) acoplado perfectamente al motor de Paper.js.");
}

// SANEADO CRÍTICO: ÚNICA inicialización automática al cargar el DOM, libre de bucles repetitivos
window.addEventListener("DOMContentLoaded", () => {
    setTimeout(installMeasurementsHook, 450);
});
