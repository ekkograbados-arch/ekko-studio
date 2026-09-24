/* ========================================================================
RUTA DESTINO EN TU DISCO LOCAL: ASSETS/js/modules/canvas-pro/canvasMeasurements.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE TU ARCHIVO "ASSETS/js/modules/canvas-pro/canvasMeasurements.js"
ESTADO: VERSIÓN DEFINITIVA v10.2 (TITANIUM PRECISION) CON COMENTARIOS EXPLICATIVOS INTEGRADOS
======================================================================== */

let measurementsGroup = null;
// Cotas visibles automáticamente para cada owner público seleccionado.
let showMeasurements = true;

function publishMeasurementState(extra = {}) {
    window._ekkoMeasurementsState = {
        enabled: showMeasurements,
        visible: !!measurementsGroup,
        groupId: measurementsGroup?.id ?? null,
        childCount: measurementsGroup?.children?.length || 0,
        ...extra,
        at: Date.now()
    };
}

// Limpia todas las cotas y dimensiones temporales dibujadas en el lienzo
export function clearMeasurements() {
    if (measurementsGroup) {
        measurementsGroup.remove();
        measurementsGroup = null;
    }
    publishMeasurementState({ reason: "clear" });
    if (window.paper && paper.view) {
        paper.view.update();
    }
}

// Configura la visibilidad del sistema de cotas
export function setMeasurementsVisibility(visible) {
    showMeasurements = visible === true;
    if (!showMeasurements) {
        clearMeasurements();
        return;
    }
    // Turning the toggle back on must redraw the current public selection;
    // otherwise the state is enabled but the old overlay remains absent.
    drawMeasurements();
    publishMeasurementState({ reason: "visibility-on" });
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

    // Alinear el texto con la línea sin que nunca quede de cabeza: el
    // ángulo se normaliza al rango legible [-90, 90]. La versión anterior
    // sumaba +90/+180 y dejaba las cotas verticales rotadas 180°.
    const rawAngle = lineVector.angle;
    const normalized = ((rawAngle % 360) + 360) % 360;
    const readable = normalized > 90 && normalized <= 270 ? normalized - 180 : normalized;
    if (readable !== 0) textEl.rotate(readable, textEl.point);
    measurementsGroup.addChild(textEl);
}

// Genera y dibuja las cotas de diseño en el lienzo
export function drawMeasurements() {
    if (typeof window.updateGlobalScaleFactor === "function") window.updateGlobalScaleFactor();
    if (!showMeasurements || !window.paper || !paper.project || !window.selectedItem) {
        clearMeasurements();
        return;
    }

    clearMeasurements();
    measurementsGroup = new paper.Group();
    measurementsGroup.data = { isMeasurement: true, nonSelectable: true };

    const zoom = paper.view.zoom;
    const offsetMm = 15 / zoom; // Distancia física de las cotas en pantalla respecto al objeto

    // Mockup/product dimensions are reference metadata, never selection
    // measurements.  Excluding them prevents the product bounds from
    // contaminating the public owner's overlay.
    // Draw one overlay per selected public owner.  Use owner-local geometry
    // and its world matrix so rotated items receive oriented dimensions.
    const selectedOwners = (Array.isArray(window.selectedItems) && window.selectedItems.length)
        ? window.selectedItems
        : [window.selectedItem];
    const seen = new Set();
    const resolveOwner = window.EKKO_FUSION_CONTROLLER?.resolvePublicTransformOwner
        || window.resolvePublicTransformOwner;
    const measuredOwners = [];
    selectedOwners.forEach(raw => {
        // The public resolver is owned by fusionController.  A Raster selected
        // through a mockup clipGroup must be measured as that Raster, never as
        // the wrapper or its static product mask.
        const owner = typeof resolveOwner === "function"
            ? resolveOwner(raw)
            : (raw?.data?.clipGroup && typeof window.getContentItem === "function"
                ? window.getContentItem(raw) : raw);
        if (!owner || seen.has(owner) || owner.data?.mockup || owner.data?.isMask || owner.data?.isSelectionBox) return;
        seen.add(owner);
        measuredOwners.push({ id: owner.id ?? null, className: owner.className, label: owner.data?.label || null });
        let localClone = null;
        try {
            localClone = owner.clone({ insert: false });
            localClone.applyMatrix = false;
            localClone.matrix = new paper.Matrix();
            const local = localClone.bounds;
            const matrix = owner.globalMatrix || owner.matrix || new paper.Matrix();
            if (!local || local.width <= 0 || local.height <= 0) return;
            const toWorld = point => matrix.transform(point);
            const tl = toWorld(local.topLeft), tr = toWorld(local.topRight);
            const br = toWorld(local.bottomRight), bl = toWorld(local.bottomLeft);
            const offset = new paper.Point(0, offsetMm);
            drawDimensionLine(tl, tr, offset, tl.getDistance(tr), "#007bff");
            drawDimensionLine(tr, br, new paper.Point(offsetMm, 0), tr.getDistance(br), "#007bff");
        } catch (e) {
            // An invalid transient owner is simply omitted from the overlay.
        } finally {
            try { localClone?.remove?.(); } catch (e) {}
        }
    });

    publishMeasurementState({ reason: "draw", owners: measuredOwners });
    // Asegurarse de que el grupo de cotas no tape los tiradores interactivos
    measurementsGroup.bringToFront();
    if (window.selectionBoxGroup) {
        window.selectionBoxGroup.bringToFront();
    }
    paper.view.update();
}

// Hook de integración automática para escuchar eventos de transformación
export function installMeasurementsHook() {
    if (window._ekkoMeasurementsObserverInstalled) return true;
    const controller = window.EKKO_FUSION_CONTROLLER;
    if (!controller?.addTransformObserver) {
        setTimeout(installMeasurementsHook, 100);
        return false;
    }
    controller.addTransformObserver(payload => {
        if (showMeasurements && (window.dragging || window.resizeActive || window.rotationActive)) {
            drawMeasurements();
        }
    });
    window._ekkoMeasurementsObserverInstalled = true;
    window._ekkoMeasurementsHook = { mode: "controller-observer", installedAt: Date.now() };
    return true;
}

// Selection, history and runtime diagnostics use the public window API.  The
// module is imported for its toggle handler, so publish the same drawing and
// cleanup functions used by those consumers instead of leaving the overlay
// implementation module-scoped.
if (typeof window !== "undefined") {
    window.drawMeasurements = drawMeasurements;
    window.clearMeasurements = clearMeasurements;
    window.setMeasurementsVisibility = setMeasurementsVisibility;
}

// SANEADO CRÍTICO: ÚNICA inicialización automática al cargar el DOM, libre de bucles repetitivos
window.addEventListener("DOMContentLoaded", () => {
    setTimeout(installMeasurementsHook, 450);
});
