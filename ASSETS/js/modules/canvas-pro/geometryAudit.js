/*
 * EKKO Studio — geometry integrity audit.
 * This is an operator/developer aid, not a laser settings surface. It makes
 * the invariants visible before a design is sent for fabrication.
 */
import { getCanonicalDesignLayer, auditScene, VECTOR_KIND } from "./vectorSemantics.js";
import { getPublicOwners } from "./designGeometry.js";
import { recalculateDynamicSubtractions } from "./geometricUngroup.js";
import { notice } from "./ekkoNotice.js";

function listProblems(layer, scene) {
    const problems = [];
    if (!layer) {
        problems.push({ code: "missing-design-layer", message: "No existe la capa designLayer." });
        return problems;
    }
    const publicItems = getPublicOwners(layer.children || []);
    publicItems.forEach(item => {
        const data = item?.data || {};
        if (data.isMockup || data.mockup || data.isMask) return;
        if (data.isSmartFusion) return;
        if (data.isCutLine === true || data.sourcePaintMode === "stroke-only") return;
        if (!data.geomBase) {
            problems.push({
                code: "missing-geom-base",
                message: `El vector ${data.label || item.className || "sin etiqueta"} no tiene geometría base editable.`,
                id: item.id
            });
        }
        if ((item.className === "Path" || item.className === "CompoundPath") && item.closed !== true && data.isCutLine !== true) {
            problems.push({
                code: "open-vector",
                message: `El vector ${data.label || item.id} está abierto y no fue marcado como línea de corte.`,
                id: item.id
            });
        }
    });
    if (scene) {
        const unresolvedHoles = Number(window.EKKO_CSG_LAST_REPORT?.unresolvedHoles || 0);
        if (unresolvedHoles > 0) {
            problems.push({
                code: "unresolved-holes",
                message: `Hay ${unresolvedHoles} hueco(s) sin materialización booleana.`,
                count: unresolvedHoles
            });
        }
        (scene.owners || []).forEach(owner => {
            if (owner.semanticKind === VECTOR_KIND.SOLID && owner.hasGeomBase && owner.visibleDiffersFromBase) {
                // This is informational rather than an error: a solid can be
                // materialized while a cutter is above it.
                return;
            }
        });
    }
    return problems;
}

export function runGeometryAudit({ refresh = true, show = true } = {}) {
    const layer = getCanonicalDesignLayer();
    if (refresh && typeof recalculateDynamicSubtractions === "function") {
        try { recalculateDynamicSubtractions(layer); } catch (error) {
            console.warn("[EKKO AUDIT] CSG refresh failed", error);
        }
    }
    const scene = auditScene(layer);
    const problems = listProblems(layer, scene);
    const report = {
        schema: "ekko-geometry-audit/1",
        createdAt: new Date().toISOString(),
        layer: layer?.name || null,
        ownerCount: scene.ownerCount,
        solidOwners: scene.solidOwners,
        holeOwners: scene.holeOwners,
        cutLineCount: scene.cutLineCount,
        candidatePairs: scene.candidatePairs?.length || 0,
        unresolvedHoles: Number(window.EKKO_CSG_LAST_REPORT?.unresolvedHoles || 0),
        csgStatus: window.EKKO_CSG_LAST_REPORT?.status || null,
        problems,
        valid: problems.length === 0
    };
    window.EKKO_VECTOR_AUDIT = report;
    window.EKKO_DIAG?.logEvent?.("geometry.audit", report);
    console.groupCollapsed?.("[EKKO VECTOR AUDIT]");
    console.log("Vectores:", report.ownerCount, "Sólidos:", report.solidOwners,
        "Huecos reales:", report.holeOwners, "Líneas:", report.cutLineCount);
    if (problems.length) console.warn("Problemas:", problems);
    else console.log("Geometría íntegra: no se detectaron problemas.");
    console.groupEnd?.();
    if (show && report.problems.length) {
        // Antes se decia "detalle en la consola (F12)". Para el cliente eso
        // es lo mismo que no avisar nada: nadie que disene abre la consola
        // del navegador, y le queda un aviso de que hay un problema que no
        // puede ver. Ahora los problemas se enuncian aqui, en palabras, y la
        // consola sigue siendo el respaldo de quien este desarmando esto.
        const detalle = report.problems
            .slice(0, 4)
            .map((p, i) => {
                if (typeof p === "string") return `${i + 1}. ${p}`;
                // Los problemas traen "message" escrito para humanos y "code"
                // para maquinas. Se enseña el texto: el cliente no va a
                // descifrar un JSON.
                const texto = p?.message || p?.reason || p?.type || p?.code || "";
                return `${i + 1}. ${texto}`;
            })
            .join("\n");
        const resto = report.problems.length > 4 ? `\n…y ${report.problems.length - 4} más.` : "";
        notice(`Geometría: ${report.problems.length} problema(s) para revisar.\n${detalle}${resto}`, { kind: "warn" });
    } else if (show) {
        notice("Geometría íntegra: no se detectaron problemas.", { kind: "ok" });
    }
    return report;
}

if (typeof window !== "undefined") {
    window.EKKO_GEOMETRY_AUDIT = { runGeometryAudit };
    window.runGeometryAudit = runGeometryAudit;
}
