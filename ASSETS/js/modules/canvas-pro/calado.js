/* =========================================================================
   EKKO STUDIO — CALADO
   Conversión semántica de un vector sólido o una fusión sólida en calado.

   La geometría no se redibuja: cambia la semántica del receptor y se
   recalculan las sustracciones. Un calado existente es no-op.
========================================================================= */
import {
    isProductElement,
    canConvertToCalado,
    getContentItem,
    findFusionVector,
    isClosedClientVector,
    updateFusionRecord
} from "./fusionCore.js";
import { syncFusionVirtualHole } from "./fusionController.js";
import { setSemanticKind, semanticKind, collectVectorOwners, isAboveInRenderOrder, VECTOR_KIND } from "./vectorSemantics.js";
import { installGeometryInOwner } from "./geometricUngroup.js";
import { getPublicOwner, getPublicOwners, getOwnerLocalGeometry, toWorldGeometry } from "./designGeometry.js";
import { geometricallyContains } from "./holeSemantics.js";
import { notice } from "./ekkoNotice.js";

function selectedItems() {
    if (Array.isArray(window.selectedItems) && window.selectedItems.length) {
        return [...window.selectedItems].filter(Boolean);
    }
    return window.selectedItem ? [window.selectedItem] : [];
}

function findFusionGroup(item) {
    if (!item) return null;
    let current = item;
    while (current) {
        if (current.data?.isSmartFusion) {
            if (current.data.clipGroup && current.children) {
                const nested = Array.from(current.children).find(child =>
                    child?.data?.isSmartFusion && child.children?.length >= 2
                );
                if (nested) return nested;
            }
            return current;
        }
        current = current.parent;
    }
    return null;
}

function getVectorTarget(item) {
    const fusion = findFusionGroup(item);
    if (fusion) return { fusion, vector: fusion.data?.originalVectorData || null };
    let content = getContentItem(item);
    // Un calado recién aplicado queda envuelto en un clip-group de contención
    // (data.clipGroup). Si la resolución central no encuentra un propietario
    // público, resolvemos los propietarios públicos de los hijos del wrapper:
    // ahí vive el vector real (isHole / isCalado / isSolidShape).
    if (!content && item && item.children?.length) {
        const owners = getPublicOwners(item.children);
        content = owners.find(owner => owner?.data &&
            (owner.data.isHole === true || owner.data.isCalado === true ||
                owner.data.isSolidShape === true)) || null;
    }
    const vector = findFusionVector(content) ||
        (isClosedClientVector(content) ? content : null);
    return { fusion: null, vector };
}

function ensureMockupContainment(target) {
    if (!target || !target.parent || target.parent.data?.clipGroup) return target;
    if (!window.currentMockup || !window.clipMask || typeof window.clipItem !== "function") return target;

    const parent = target.parent;
    const index = parent.children.indexOf(target);
    let wrapped = target;
    const previousInfiniteMode = window.infiniteCanvasMode;
    try {
        // Calado pertenece al área del mockup aunque el modo de lienzo
        // infinito esté activo para otros objetos.
        window.infiniteCanvasMode = false;
        wrapped = window.clipItem(target) || target;
    } finally {
        window.infiniteCanvasMode = previousInfiniteMode;
    }

    if (wrapped !== target) {
        /* clipItem -> createMockupContainmentGroup devuelve el wrapper
           ANCESTRO cuando el target YA esta contenido (por ejemplo una hoja
           dentro del grupo de un SVG importado). Re-insertar ese ancestro
           dentro del padre local mete al grupo dentro de su propio wrapper:
           ciclo padre<->hijo que deja _isUpdated de paper recursando para
           siempre y muere el render de toda la pagina (se vio con un SVG
           de letras importado + Solidos<->Huecos). Solo se re-inserta y
           re-etiqueta cuando el wrapper es NUEVO, es decir cuando contiene
           al target como hijo directo. */
        const esWrapperNuevo = Array.isArray(wrapped.children) &&
            wrapped.children.indexOf(target) !== -1;
        if (!esWrapperNuevo) return target;
        wrapped.data = {
            ...(wrapped.data || {}),
            clipGroup: true,
            caladoContainment: true,
            label: "Calado"
        };
        parent.insertChild(Math.max(0, index), wrapped);
        return wrapped;
    }
    return target;
}

function canConvertVectorToCalado(vector) {
    if (!vector || isProductElement(vector) || vector.closed !== true) return false;
    if (semanticKind(vector) === VECTOR_KIND.HOLE) return false;
    const data = vector.data || {};
    if (data.sourceIsHole === true || data.originalIsHole === true) return data.isSolidShape === true;
    return canConvertToCalado(vector);
}

function canRestoreFusionToCalado(fusion) {
    const data = fusion?.data || {};
    return semanticKind(fusion) === VECTOR_KIND.SOLID && data.receiverKind === "solid" &&
        (data.sourceIsHole === true || data.originalIsHole === true || data.filledFromHole === true);
}

function recalculateContainmentRelations(target) {
    if (!target) return;
    const owner = getPublicOwner(target) || target;
    const holeGeometry = toWorldGeometry(owner);
    if (!holeGeometry) return;
    try {
        const holeArea = Math.abs(holeGeometry.area || 0);
        const scope = owner.data?.containmentScope || null;
        let receptor = null;
        let receptorArea = Infinity;
        collectVectorOwners(owner.layer).filter(item => item !== owner && semanticKind(item) === VECTOR_KIND.SOLID)
            .forEach(item => {
                if (!isAboveInRenderOrder(owner, item)) return;
                const itemScope = item.data?.containmentScope || null;
                if (scope && itemScope && scope !== itemScope) return;
                const geometry = toWorldGeometry(item);
                try {
                    const area = Math.abs(geometry?.area || 0);
                    if (area > holeArea && area < receptorArea && geometricallyContains(geometry, holeGeometry)) {
                        receptor = item;
                        receptorArea = area;
                    }
                } finally {
                    try { geometry?.remove?.(); } catch (_) {}
                }
            });
        owner.data = {
            ...(owner.data || {}),
            ownerContainmentKey: receptor?.data?.containmentKey || null,
            containmentScope: scope || receptor?.data?.containmentScope || null
        };
    } finally {
        try { holeGeometry.remove?.(); } catch (_) {}
    }
}

function markHole(target) {
    if (!target) return null;
    const sourceData = target.data || {};
    if (semanticKind(target) === VECTOR_KIND.HOLE || sourceData.isHole === true) {
        return target;
    }
    const previousFill = target.data?.originalFillColor?.clone?.() || target.fillColor?.clone?.();
    const previousStroke = target.data?.originalStrokeColor?.clone?.() || target.strokeColor?.clone?.();
    const previousStrokeWidth = target.data?.originalStrokeWidth || target.strokeWidth || 0;

    setSemanticKind(target, VECTOR_KIND.HOLE);
    target.data = {
        ...(target.data || {}),
        isHole: true,
        isCalado: true,
        isFusionReceptor: true,
        isSolidShape: false,
        csgMaterialized: false,
        holeRenderMode: "semantic-cutter-no-paint",
        label: "Calado",
        // Preserve source paint only for a later explicit Rellenar action.
        // No fallback contour is created: color and stroke are never hole
        // semantics and must not be used to visualize the cutter.
        originalFillColor: previousFill || null,
        originalStrokeColor: previousStroke || null,
        originalStrokeWidth: previousStrokeWidth || 0
    };
    if (!target.data.geomBase) {
        const base = getOwnerLocalGeometry(target);
        if (base) {
            base.data = { ...(base.data || {}), isHole: true };
            target.data.geomBase = base;
            try { base.remove(); } catch (e) {}
        }
    }

    // Calado es una perforación real. La geometría física no se vuelve una
    // transparencia cosmética: el owner permanece cerrado, seleccionable y
    // disponible para CSG. La lectura visual del hueco la aporta el overlay
    // de selección, no un alpha casi cero en el objeto de diseño.
    target.fillColor = null;
    target.strokeColor = null;
    target.strokeWidth = 0;
    target.opacity = 1;
    target.visible = false;
    return ensureMockupContainment(target);
}

function markFusionHole(fusion) {
    if (!fusion || semanticKind(fusion) === VECTOR_KIND.HOLE) return false;
    setSemanticKind(fusion, VECTOR_KIND.HOLE);
    const currentMask = fusion.children?.find(child => child?.clipMask || child?.data?.isFusionMask);
    fusion.data = {
        ...(fusion.data || {}),
        isHole: true,
        isCalado: true,
        receiverKind: "hole",
        fusionMode: "intersecar",
        label: "Fusión Calada"
    };
    if (currentMask) {
        currentMask.data = {
            ...(currentMask.data || {}),
            isHole: true,
            isFusionMask: true,
            ownerContainmentKey: fusion.data.ownerContainmentKey || null
        };
    }
    updateFusionRecord(fusion, {
        semanticKind: VECTOR_KIND.HOLE,
        receiverKind: "hole",
        mode: "intersecar"
    });
    syncFusionVirtualHole(fusion);
    return true;
}

function restoreSolidGeometry(target, options = {}) {
    if (!target) return null;
    let restored = target;
    // A boolean keeper already owns the accepted result geometry. Reinstalling
    // its old hole geomBase here would erase the operation that just succeeded.
    if (!options.preserveGeometry && target.data?.geomBase) {
        const world = toWorldGeometry(target);
        if (world) {
            restored = installGeometryInOwner(target, world) || target;
            world.remove?.();
        }
    }
    setSemanticKind(restored, VECTOR_KIND.SOLID);
    restored.data = {
        ...(restored.data || {}),
        isHole: false,
        isSolidShape: true,
        isCalado: false,
        contourRole: "outer",
        explicitHole: false,
        filledFromHole: true,
        csgMaterialized: false,
        label: "Relleno",
        originalFillColor: restored.data?.originalFillColor || new paper.Color("#111827")
    };
    restored.fillColor = restored.data.originalFillColor.clone?.() || restored.data.originalFillColor;
    restored.strokeColor = restored.data.originalStrokeColor?.clone?.() || null;
    restored.strokeWidth = restored.data.originalStrokeWidth || 0;
    restored.visible = true;
    return restored;
}

export function convertSelectionToSolid(item = null, options = {}) {
    const targets = item ? [item] : selectedItems();
    if (targets.length !== 1) return null;
    const resolved = getVectorTarget(targets[0]);
    if (resolved.fusion) {
        const fusion = resolved.fusion;
        if (semanticKind(fusion) !== VECTOR_KIND.HOLE && fusion.data?.isHole !== true) return fusion;
        if (!options.skipHistory && typeof window.saveHistory === "function") window.saveHistory();
        setSemanticKind(fusion, VECTOR_KIND.SOLID);
        fusion.data = {
            ...(fusion.data || {}),
            isHole: false, isSolidShape: true, isCalado: false,
            contourRole: "outer", explicitHole: false,
            receiverKind: "solid", filledFromHole: true
        };
        updateFusionRecord(fusion, {
            semanticKind: VECTOR_KIND.SOLID,
            receiverKind: "solid",
            mode: "intersecar"
        });
        syncFusionVirtualHole(fusion);
        window.recalculateDynamicSubtractions?.();
        return fusion;
    }
    if (!resolved.vector || isProductElement(resolved.vector)) return null;
    if (semanticKind(resolved.vector) !== VECTOR_KIND.HOLE && resolved.vector.data?.isHole !== true) return resolved.vector;
    if (!options.skipHistory && typeof window.saveHistory === "function") window.saveHistory();
    const solid = restoreSolidGeometry(resolved.vector, {
        preserveGeometry: options.preserveGeometry === true
    });
    window.recalculateDynamicSubtractions?.();
    window.selectItem?.(solid);
    paper.view.update();
    return solid;
}

export function canConvertSelectionToCalado(item = null) {
    const targets = item ? [item] : selectedItems();
    if (targets.length !== 1) return false;
    const resolved = getVectorTarget(targets[0]);
    if (resolved.fusion) {
        return canConvertToCalado(resolved.fusion) || canRestoreFusionToCalado(resolved.fusion);
    }
    return canConvertVectorToCalado(resolved.vector);
}

export function convertSelectionToCalado(item = null, options = {}) {
    const targets = item ? [item] : selectedItems();
    if (targets.length !== 1) {
        notice("Seleccioná un vector sólido o una fusión sólida para aplicar Calado.", { kind: "warn" });
        return null;
    }
    const resolved = getVectorTarget(targets[0]);
    if (resolved.fusion) {
        const eligible = canConvertToCalado(resolved.fusion) || canRestoreFusionToCalado(resolved.fusion);
        if (!eligible || semanticKind(resolved.fusion) === VECTOR_KIND.HOLE) return resolved.fusion;
        if (!options.skipHistory && typeof window.saveHistory === "function") window.saveHistory();
        markFusionHole(resolved.fusion);
        if (typeof window.recalculateSmartFusion === "function") {
            window.recalculateSmartFusion(resolved.fusion);
        }
        if (typeof window.recalculateDynamicSubtractions === "function") {
            window.recalculateDynamicSubtractions();
        }
        if (typeof window.selectItem === "function") window.selectItem(resolved.fusion);
        paper.view.update();
        return resolved.fusion;
    }
    const vector = resolved.vector;
    if (!canConvertVectorToCalado(vector)) {
        // Rechazo observable: el usuario no debe quedarse sin respuesta al
        // pulsar Calado sobre algo no convertible (mismo criterio que el caso
        // de trazo abierto de más abajo).
        notice("Esta selección no admite Calado: se necesita un vector sólido cerrado.", { kind: "warn" });
        return null;
    }
    // Un trazo abierto no delimita superficie: no hay nada que vaciar. Se avisa
    // en vez de fallar en silencio.
    if (vector.closed !== true) {
        notice("Solo los vectores CERRADOS se pueden calar (círculos, rectángulos, letras, formas cerradas). El trazo seleccionado está abierto.", { kind: "warn" });
        return null;
    }
    if (!options.skipHistory && typeof window.saveHistory === "function") window.saveHistory();
    const finalItem = markHole(vector) || vector;
    recalculateContainmentRelations(finalItem);
    if (typeof window.recalculateDynamicSubtractions === "function") {
        window.recalculateDynamicSubtractions();
    }
    if (typeof window.selectItem === "function") window.selectItem(finalItem);
    paper.view.update();
    return finalItem;
}

if (typeof window !== "undefined") {
    window.convertSelectionToCalado = convertSelectionToCalado;
    window.canConvertSelectionToCalado = canConvertSelectionToCalado;
    window.convertSelectionToSolid = convertSelectionToSolid;
}
