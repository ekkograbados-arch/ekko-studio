/* =========================================================================
   EKKO STUDIO — PROJECT IO
   Tres modos de salida sobre el mismo contrato semántico:
   1. GRABADO (SVG LightBurn): geometría final materializada, sin doble
      grabado por superposiciones. Solo él sale de prepareSVGForExport.
   2. PROYECTO (.ekko.json): escenas Paper.js por vista + metadatos de
      producto. Re-importable y totalmente re-editable (textos vivos,
      fusiones, semántica). Nunca lleva marca de agua.
   3. BOCETO (PNG cliente): raster del SVG de grabado + marca de agua
      EKKO. Plano, no editable, apto para aprobar diseños.
   La importación de proyecto reutiliza el flujo de vistas existente
   (EKKO_SCENE_STORE + rehydrateSceneRuntime): no se reimplementa nada.
   ========================================================================= */

import { prepareSVGForExport } from "./exportSVG.js";

const PROJECT_FORMAT = "ekko-project/1";

function slugify(value) {
    return String(value || "diseno")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
        .toLowerCase() || "diseno";
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function store() {
    return (typeof window !== "undefined" && window.EKKO_SCENE_STORE) || null;
}

/* ---------------- MODO GRABADO (multi-vista) ---------------- */

export async function exportViewsToSVG(surfaceNames = null, options = {}) {
    const api = store();
    if (!api) {
        console.warn("[EKKO EXPORT] El almacén de vistas no está disponible.");
        return { ok: false, reason: "scene-store-unavailable" };
    }
    const before = api.describe();
    if (!before?.productId) {
        console.warn("[EKKO EXPORT] Seleccioná un producto para exportar.");
        return { ok: false, reason: "no-product" };
    }
    api.saveCurrent();
    const describe = api.describe();
    const all = describe.surfaces || [];
    const wanted = Array.isArray(surfaceNames) && surfaceNames.length
        ? all.filter(surf => surfaceNames.includes(surf.name))
        : all.filter(surf => surf.index === describe.surfaceIndex);
    const targets = wanted.length ? wanted : all.filter(surf => surf.index === describe.surfaceIndex);
    const results = [];
    for (const target of targets) {
        const opened = api.openSurface(describe.productId, target.name);
        if (!opened) {
            results.push({ surface: target.name, ok: false, reason: "open-failed" });
            continue;
        }
        await new Promise(resolve => setTimeout(resolve, 60));
        let svg = "";
        try {
            svg = await prepareSVGForExport({
                asString: true,
                uniteOverlaps: options.uniteOverlaps !== false,
                includeMockup: options.includeMockup === true
            });
        } catch (err) {
            svg = "";
        }
        const report = (typeof window !== "undefined" && window.EKKO_EXPORT_LAST_REPORT) || null;
        if (svg && svg.trim() !== "") {
            const filename = `ekko-${slugify(describe.productName)}-${slugify(target.name)}.svg`;
            downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
            results.push({ surface: target.name, ok: true, filename, report });
        } else {
            results.push({ surface: target.name, ok: false, reason: "export-empty", report });
        }
        await new Promise(resolve => setTimeout(resolve, 120));
    }
    // Restaurar la vista original.
    try {
        const back = describe.surfaces.find(surf => surf.index === describe.surfaceIndex);
        if (back) api.openSurface(describe.productId, back.name);
    } catch (_) {}
    return { ok: results.some(r => r.ok), results };
}

/* ---------------- MODO PROYECTO (.ekko.json) ---------------- */

export function buildProjectEnvelope() {
    const api = store();
    if (!api) return { ok: false, reason: "scene-store-unavailable" };
    api.saveCurrent();
    if (typeof window.rehydrateSceneRuntime === "function") {
        try { window.rehydrateSceneRuntime(); } catch (_) {}
    }
    const describe = api.describe();
    if (!describe?.productId) return { ok: false, reason: "no-product" };
    const states = api.getAll() || {};
    const views = (describe.surfaces || [])
        .filter(surf => surf.sceneKey && typeof states[surf.sceneKey] === "string")
        .map(surf => ({
            surfaceName: surf.name,
            surfaceIndex: surf.index,
            sceneKey: surf.sceneKey,
            projectJSON: states[surf.sceneKey]
        }));
    // La vista viva siempre queda incluida aunque su escena aún no se haya
    // guardado bajo otra superficie.
    const envelope = {
        app: "ekko-studio",
        format: PROJECT_FORMAT,
        savedAt: new Date().toISOString(),
        productId: describe.productId,
        productName: describe.productName,
        currentSurface: describe.surfaceName,
        mmPerPaperUnit: Number(window.mmPerPaperUnit) || null,
        views
    };
    return { ok: views.length > 0, envelope, reason: views.length ? null : "no-scenes" };
}

export function downloadProjectFile() {
    const built = buildProjectEnvelope();
    if (!built.ok || !built.envelope) {
        console.warn("[EKKO PROJECT] No hay vistas editadas para guardar en el proyecto.");
        return built;
    }
    const text = JSON.stringify(built.envelope);
    const filename = `ekko-${slugify(built.envelope.productName)}-proyecto.ekko.json`;
    downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), filename);
    return { ok: true, filename, views: built.envelope.views.length };
}

export async function openProjectFile(file) {
    const api = store();
    if (!api) return { ok: false, reason: "scene-store-unavailable" };
    let envelope = null;
    try {
        envelope = JSON.parse(await file.text());
    } catch (_) {
        return { ok: false, reason: "invalid-json" };
    }
    if (!envelope || envelope.app !== "ekko-studio" || envelope.format !== PROJECT_FORMAT) {
        return { ok: false, reason: "not-an-ekko-project" };
    }
    if (!envelope.productId || !Array.isArray(envelope.views) || !envelope.views.length) {
        return { ok: false, reason: "empty-project" };
    }
    const states = {};
    envelope.views.forEach(view => {
        if (view?.sceneKey && typeof view.projectJSON === "string") states[view.sceneKey] = view.projectJSON;
    });
    api.setAll(states);
    const targetSurface = envelope.views.some(view => view.surfaceName === envelope.currentSurface)
        ? envelope.currentSurface
        : envelope.views[0].surfaceName;
    const opened = api.openSurface(envelope.productId, targetSurface);
    if (!opened) return { ok: false, reason: "product-not-found" };
    return { ok: true, product: envelope.productName, views: envelope.views.length, surface: targetSurface };
}

export function requestOpenProjectFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ekko.json,application/json";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const result = await openProjectFile(file);
        if (!result.ok) {
            alert("No se pudo abrir el proyecto: " + (result.reason || "desconocido"));
        }
    };
    input.click();
}

/* ---------------- MODO BOCETO (PNG con marca de agua) ---------------- */

async function loadLogoImage() {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = "/logo.png";
        setTimeout(() => resolve(null), 4000);
    });
}

export async function downloadSketchPNG() {
    const api = store();
    const describe = api ? api.describe() : null;
    let svg = "";
    try {
        svg = await prepareSVGForExport({ asString: true, includeMockup: false });
    } catch (_) {
        svg = "";
    }
    if (!svg || svg.trim() === "") {
        console.warn("[EKKO SKETCH] No hay elementos válidos para el boceto.");
        return { ok: false, reason: "export-empty" };
    }
    const parser = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = parser.documentElement;
    const viewBox = String(root?.getAttribute?.("viewBox") || "").trim().split(/\s+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value))) {
        console.warn("[EKKO SKETCH] No se pudo dimensionar el boceto.");
        return { ok: false, reason: "no-viewbox" };
    }
    const [, , viewW, viewH] = viewBox;
    const scale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewW * scale));
    canvas.height = Math.max(1, Math.round(viewH * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rendered = await new Promise(resolve => {
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
        const img = new Image();
        img.onload = () => {
            try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(true); }
            catch (_) { resolve(false); }
            URL.revokeObjectURL(url);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
        img.src = url;
    });
    if (!rendered) {
        console.warn("[EKKO SKETCH] No se pudo rasterizar el boceto.");
        return { ok: false, reason: "raster-failed" };
    }
    // Marca de agua: logo + texto EKKO en diagonal + pie con producto/vista.
    try {
        ctx.save();
        ctx.globalAlpha = 0.16;
        const logo = await loadLogoImage();
        const stepX = canvas.width / 3, stepY = canvas.height / 3;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(-Math.PI / 6);
        ctx.textAlign = "center";
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${Math.round(canvas.width / 14)}px sans-serif`;
        for (let ix = -1; ix <= 1; ix++) {
            for (let iy = -1; iy <= 1; iy++) {
                if (logo) {
                    const logoW = stepX * 0.5;
                    const logoH = logoW * (logo.height / Math.max(1, logo.width));
                    ctx.drawImage(logo, ix * stepX - logoW / 2, iy * stepY - logoH / 2 - 14, logoW, logoH);
                }
                ctx.fillText("EKKO STUDIO · BOCETO", ix * stepX, iy * stepY + 30);
            }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#64748b";
        ctx.font = "16px sans-serif";
        ctx.textAlign = "left";
        const caption = `EKKO Studio · Boceto no válido para grabar · ${describe?.productName || ""} ${describe?.surfaceName || ""} · ${new Date().toLocaleDateString()}`;
        ctx.fillText(caption, 12, canvas.height - 12);
    } catch (_) {}
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
        console.warn("[EKKO SKETCH] No se pudo generar el PNG.");
        return { ok: false, reason: "png-failed" };
    }
    const filename = `ekko-${slugify(describe?.productName)}-${slugify(describe?.surfaceName)}-boceto.png`;
    downloadBlob(blob, filename);
    return { ok: true, filename };
}

if (typeof window !== "undefined") {
    window.EKKO_PROJECT_IO = {
        exportViewsToSVG,
        buildProjectEnvelope,
        downloadProjectFile,
        openProjectFile,
        requestOpenProjectFile,
        downloadSketchPNG
    };
}
