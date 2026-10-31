/* =========================================================================
   EKKO STUDIO — PROJECT IO
   Tres modos de salida sobre el mismo contrato semántico:
   1. GRABADO (SVG LightBurn): geometría final materializada, sin doble
      grabado por superposiciones. Solo él sale de prepareSVGForExport.
   2. PROYECTO (.ekko): escenas Paper.js por vista + metadatos de
      producto, con FIRMA EKKO (cabecera + cuerpo codificado): solo EKKO
      Studio lo abre — Photoshop u otra plataforma no reconocen el
      formato y no pueden convertirlo en fuente editable. Re-importable
      y totalmente re-editable (textos vivos, fusiones, semántica).
      Nunca lleva marca de agua. El legado .ekko.json sin firma sigue
      abriendo para no romper proyectos viejos.
   3. BOCETO (PNG y PDF cliente): raster del SVG de grabado + marca de
      agua EKKO (logo del repositorio). Aplanado, no editable, apto para
      compartir y aprobar diseños. PNG y PDF salen de la MISMA imagen.
   La importación de proyecto reutiliza el flujo de vistas existente
   (EKKO_SCENE_STORE + rehydrateSceneRuntime): no se reimplementa nada.
   ========================================================================= */

import { prepareSVGForExport } from "./exportSVG.js";
import { notice } from "./ekkoNotice.js";

const PROJECT_FORMAT = "ekko-project/1";

/* Firma del proyecto: el archivo .ekko lleva esta cabecera y su cuerpo va
   codificado en base64. Objetivo definido con el dueño del producto: la
   edición solo se abre en EKKO Studio — ninguna otra app lo reconoce ni
   puede convertirlo en fuente editable para grabar en otro lado. */
const PROJECT_MAGIC = "EKKO-PROYECTO-v1:";

function encodeProjectEnvelope(envelope) {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    let binario = "";
    const PASO = 0x8000; // por tramos: el spread de un buffer grande revienta la pila
    for (let i = 0; i < bytes.length; i += PASO) {
        binario += String.fromCharCode.apply(null, bytes.subarray(i, i + PASO));
    }
    return PROJECT_MAGIC + btoa(binario);
}

function decodeProjectText(text) {
    const limpio = String(text || "").trim();
    if (!limpio.startsWith(PROJECT_MAGIC)) return JSON.parse(limpio); // legado .ekko.json
    const b64 = limpio.slice(PROJECT_MAGIC.length).replace(/\s+/g, "");
    const binario = atob(b64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
}

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

/* Estampilla en el nombre del archivo: fecha y hora de la descarga. Así los
   archivos de distintos clientes y de distintas ediciones nunca se confunden
   entre sí, ni en la carpeta de descargas ni en el Drive del taller. */
function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* El SVG de grabado es material de producción del TALLER: el cliente no lo
   descarga. Solo se habilita en MODO TALLER (el dueño lo activa manteniendo
   apretado el botón Descargar). */
function esModoTaller() {
    try { return localStorage.getItem("ekkoModoTaller") === "1"; } catch (_) { return false; }
}

/* ---------------- MODO GRABADO (multi-vista) ---------------- */

export async function exportViewsToSVG(surfaceNames = null, options = {}) {
    if (!esModoTaller()) {
        notice("El SVG de grabado es del taller: mantené apretado el botón Descargar para activar el modo taller.", { kind: "warn", ms: 6000 });
        return { ok: false, reason: "modo-cliente" };
    }
    const api = store();
    if (!api) {
        console.warn("[EKKO EXPORT] El almacén de vistas no está disponible.");
        return { ok: false, reason: "scene-store-unavailable" };
    }
    const before = api.describe();
    if (!before?.productId) {
        console.warn("[EKKO EXPORT] Seleccioná un producto para exportar.");
        notice("Cargá un producto antes de descargar: elegilo en el panel de productos.", { kind: "warn" });
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
            const filename = `ekko-grabado-${slugify(describe.productName)}-${slugify(target.name)}-${stamp()}.svg`;
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
    // Feedback humano (definido con el dueño): la descarga nunca termina en
    // silencio — el cliente tiene que saber QUÉ se bajó y PARA QUÉ sirve.
    const okList = results.filter(r => r.ok);
    if (okList.length === 1) {
        notice(`Descargado: ${okList[0].filename} — abrilo en LightBurn y grabá.`, { kind: "ok", ms: 6000 });
    } else if (okList.length > 1) {
        notice(`Descargadas ${okList.length} vistas de ${describe.productName}: un archivo por vista, listos para LightBurn.`, { kind: "ok", ms: 6000 });
    } else if (results.some(r => r.reason === "export-empty")) {
        notice("El diseño está vacío: agregá algo al lienzo antes de descargar.", { kind: "warn" });
    } else {
        notice("No se pudo generar el SVG de grabado. Probá de nuevo.", { kind: "error" });
    }
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
        notice(built.reason === "no-product"
            ? "Cargá un producto antes de guardar tu proyecto."
            : "Todavía no hay nada editado para guardar: trabajá en alguna vista primero.", { kind: "warn" });
        return built;
    }
    // .ekko firmado: solo EKKO Studio lo abre. Otras apps no reconocen el
    // formato y no pueden convertirlo en fuente editable.
    const filename = `ekko-${slugify(built.envelope.productName)}-proyecto-${stamp()}.ekko`;
    downloadBlob(new Blob([encodeProjectEnvelope(built.envelope)], { type: "application/octet-stream" }), filename);
    notice(`Guardado: ${filename} (${built.envelope.views.length} vista${built.envelope.views.length === 1 ? "" : "s"}) — este archivo solo se abre en EKKO Studio.`, { kind: "ok", ms: 6000 });
    return { ok: true, filename, views: built.envelope.views.length };
}

export async function openProjectFile(file) {
    const api = store();
    if (!api) return { ok: false, reason: "scene-store-unavailable" };
    let envelope = null;
    try {
        // Acepta .ekko firmado y el legado .ekko.json sin firma.
        envelope = decodeProjectText(await file.text());
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
    notice(`Proyecto abierto: ${envelope.productName || "sin nombre"} · ${envelope.views.length} vista${envelope.views.length === 1 ? "" : "s"}.`, { kind: "ok" });
    return { ok: true, product: envelope.productName, views: envelope.views.length, surface: targetSurface };
}

export function requestOpenProjectFile() {
    const input = document.createElement("input");
    input.type = "file";
    // Solo proyectos firmados EKKO: el selector ya no ofrece .ekko.json ni
    // archivos sueltos. (El lector interno sigue tolerando el legado si un
    // archivo viejo se arrastra, pero la carga normal es solo .ekko.)
    input.accept = ".ekko";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const result = await openProjectFile(file);
        if (!result.ok) {
            // Errores en idioma de cliente: cada motivo con su frase.
            const mensajes = {
                "invalid-json": "Ese archivo no se entiende como proyecto EKKO.",
                "not-an-ekko-project": "Ese archivo no es un proyecto EKKO: solo abren los .ekko guardados desde acá.",
                "empty-project": "El proyecto está vacío: no tiene vistas guardadas.",
                "product-not-found": "El producto de ese proyecto ya no está en el catálogo.",
                "scene-store-unavailable": "El editor todavía está cargando. Probá de nuevo en unos segundos."
            };
            notice(mensajes[result.reason] || "No se pudo abrir el proyecto.", { kind: "error" });
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

/* Cuerpo compartido del boceto: lienzo aplanado CON marca de agua (logo del
   repositorio + texto EKKO en diagonal + pie con producto/vista/fecha). PNG
   y PDF salen de EXACTAMENTE la misma imagen: lo que comparte el cliente
   nunca es editable y siempre lleva la marca. */
async function buildSketchCanvas() {
    const api = store();
    const describe = api ? api.describe() : null;
    let svg = "";
    try {
        // El boceto es la captura fiel de la interfaz: el mockup real va
        // incluido (los huecos del huesito son huecos también en el boceto)
        // y el diseño queda contenido dentro del producto. Sin contorno
        // azul: eso es del SVG de grabado, no del boceto.
        svg = await prepareSVGForExport({ asString: true, includeMockup: false, keepMockupImage: true });
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
    // Marca de agua: SOLO el logo EKKO (el del repositorio), repetido en
    // diagonal y bien tenue + un pie pequeno con producto/vista/fecha. Antes
    // un texto gigante dominaba la imagen y tapaba el diseño.
    try {
        ctx.save();
        ctx.globalAlpha = 0.13;
        const logo = await loadLogoImage();
        if (logo) {
            const paso = Math.max(canvas.width, canvas.height) / 3;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(-Math.PI / 6);
            for (let ix = -1; ix <= 1; ix++) {
                for (let iy = -1; iy <= 1; iy++) {
                    const lw = paso * 0.42;
                    const lh = lw * (logo.height / Math.max(1, logo.width));
                    ctx.drawImage(logo, ix * paso - lw / 2, iy * paso - lh / 2, lw, lh);
                }
            }
        }
        ctx.restore();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#64748b";
        ctx.font = `bold ${Math.max(11, Math.round(canvas.width / 55))}px sans-serif`;
        ctx.textAlign = "left";
        const caption = `EKKO Studio · Boceto no válido para grabar · ${describe?.productName || ""} ${describe?.surfaceName || ""} · ${new Date().toLocaleDateString()}`;
        ctx.fillText(caption, 12, canvas.height - 12);
    } catch (_) {}
    return { ok: true, canvas, describe };
}

export async function downloadSketchPNG() {
    const built = await buildSketchCanvas();
    if (!built.ok) return built;
    const blob = await new Promise(resolve => built.canvas.toBlob(resolve, "image/png"));
    if (!blob) {
        console.warn("[EKKO SKETCH] No se pudo generar el PNG.");
        return { ok: false, reason: "png-failed" };
    }
    const filename = `ekko-boceto-${slugify(built.describe?.productName)}-${slugify(built.describe?.surfaceName)}-${stamp()}.png`;
    downloadBlob(blob, filename);
    notice(`Descargado: ${filename} — aplanado y con marca de agua.`, { kind: "ok" });
    return { ok: true, filename };
}

/* PDF cliente: la MISMA imagen del boceto (aplanada, con marca de agua)
   incrustada en un PDF de una sola página. Sin librerías: el JPEG viaja con
   la compresión DCTDecode nativa del formato PDF. */
export async function downloadSketchPDF() {
    const built = await buildSketchCanvas();
    if (!built.ok) return built;
    const jpeg = await new Promise(resolve => built.canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!jpeg) {
        console.warn("[EKKO SKETCH PDF] No se pudo generar la imagen del PDF.");
        return { ok: false, reason: "png-failed" };
    }
    const filename = `ekko-boceto-${slugify(built.describe?.productName)}-${slugify(built.describe?.surfaceName)}-${stamp()}.pdf`;
    try {
        const pdf = await jpegBlobToPdf(await jpeg.arrayBuffer(), built.canvas.width, built.canvas.height);
        downloadBlob(pdf, filename);
    } catch (err) {
        console.warn("[EKKO SKETCH PDF] Fallo al armar el PDF:", err);
        return { ok: false, reason: "pdf-failed" };
    }
    notice(`Descargado: ${filename} — aplanado y con marca de agua.`, { kind: "ok" });
    return { ok: true, filename };
}

/* Armado mínimo de un PDF 1.4 (binario exacto: xref calculado a mano). Una
   página con el JPEG a página completa: nada de capas ni texto editable. */
async function jpegBlobToPdf(jpegBuffer, anchoPx, altoPx) {
    const PT = 72 / 96; // 1 px de pantalla = 0.75 pt
    const w = (anchoPx * PT).toFixed(2);
    const h = (altoPx * PT).toFixed(2);
    const jpeg = new Uint8Array(jpegBuffer);
    const te = new TextEncoder();
    const partes = [];
    const offsets = [0, 0, 0, 0, 0];
    let offset = 0;
    const txt = (s) => te.encode(s);
    const push = (chunk) => { partes.push(chunk); offset += chunk.length; };

    push(txt("%PDF-1.4\n"));
    offsets[0] = offset; push(txt("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
    offsets[1] = offset; push(txt("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"));
    offsets[2] = offset; push(txt(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`));
    offsets[3] = offset;
    push(txt(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${anchoPx} /Height ${altoPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`));
    push(jpeg);
    push(txt("\nendstream\nendobj\n"));
    const contenido = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    offsets[4] = offset; push(txt(`5 0 obj\n<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream\nendobj\n`));

    const inicioXref = offset;
    let xref = "xref\n0 6\n0000000000 65535 f \n";
    for (let i = 0; i < 5; i++) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
    push(txt(xref));

    let total = 0;
    partes.forEach(p => { total += p.length; });
    const salida = new Uint8Array(total);
    let pos = 0;
    partes.forEach(p => { salida.set(p, pos); pos += p.length; });
    return new Blob([salida], { type: "application/pdf" });
}

/* ---------------- ENVÍO AL TALLER (solo modo taller) ---------------- */
/* WhatsApp y Drive del taller, sin servidores y sin costo: el archivo se
   descarga con nombre ordenado y se abre el chat / la carpeta para
   adjuntarlo con un arrastre. El navegador solo no puede meter archivos
   dentro de WhatsApp o Drive, pero deja todo listo a un paso. */
const EKKO_TALLER_CONTACTO = {
    whatsapp: "5492804719686",
    drive: "https://drive.google.com/drive/folders/1Bt0BAnpn3WCMd9mUCAMnc5Bdg6DxJHqK"
};

export async function enviarGrabadoPorWhatsApp(surfaceNames = null, options = {}) {
    const res = await exportViewsToSVG(surfaceNames, options);
    if (!res.ok) return res;
    const okList = (res.results || []).filter(r => r.ok);
    let describe = null;
    try { describe = store()?.describe?.() || null; } catch (_) {}
    const msg = [
        "EKKO Grabados — archivo para grabar",
        `Producto: ${describe?.productName || "-"}`,
        `Vistas: ${okList.map(r => r.surface).join(", ")}`,
        `Archivos: ${okList.map(r => r.filename).join(", ")}`,
        `Fecha: ${new Date().toLocaleString()}`
    ].join("\n");
    setTimeout(() => {
        try { window.open(`https://wa.me/${EKKO_TALLER_CONTACTO.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank"); } catch (_) {}
    }, 900);
    notice("Grabado descargado y WhatsApp abierto: adjuntá el archivo SVG en el chat.", { kind: "ok", ms: 8000 });
    return res;
}

export function abrirDriveProyectos() {
    try { window.open(EKKO_TALLER_CONTACTO.drive, "_blank"); } catch (_) {}
    notice("Drive abierto: arrastrá los archivos del cliente a PROYECTOS DE CLIENTES.", { kind: "info", ms: 7000 });
    return { ok: true };
}

/* ---------------- ENVIAR A GRABAR A: EKKO GRABADOS (botón del cliente) ---------------- */
/* Fase 3: el cliente manda su trabajo con UN clic. Se genera UN solo SVG con
   todas las vistas editadas del producto compuestas lado a lado en mm (cada
   pieza con su translate, sin nested svg): el taller corta el lote completo
   de una pasada. Sin marca de agua: el archivo viaja directo al dueño para
   grabar, no es una previsualización. El archivo se descarga y se abre el
   chat de WhatsApp con el mensaje prellenado: el navegador no puede adjuntar
   solo, el cliente arrastra el archivo al chat. */
function leerContactoTaller() {
    // Escalable (fase 3b): un colega con grabadora propia configura su propio
    // contacto desde el modo taller; sin configuración, el destino es EKKO.
    try {
        const crudo = localStorage.getItem("ekkoTallerContacto");
        if (crudo) {
            const parsed = JSON.parse(crudo);
            if (parsed && /^\d{6,15}$/.test(String(parsed.whatsapp || ""))) {
                return { whatsapp: parsed.whatsapp, nombre: String(parsed.nombre || "taller") };
            }
        }
    } catch (_) {}
    return EKKO_TALLER_CONTACTO;
}

async function construirSVGLote(surfaceNames = null) {
    const api = store();
    if (!api) return { ok: false, reason: "scene-store-unavailable" };
    const before = api.describe();
    if (!before?.productId) return { ok: false, reason: "no-product" };
    api.saveCurrent();
    const describe = api.describe();
    const all = describe.surfaces || [];
    const states = api.getAll() || {};
    // Solo vistas con edición guardada (a menos que el taller pida vistas puntuales).
    const candidatas = Array.isArray(surfaceNames) && surfaceNames.length
        ? all.filter(surf => surfaceNames.includes(surf.name))
        : all.filter(surf => surf.sceneKey && typeof states[surf.sceneKey] === "string" && states[surf.sceneKey].trim() !== "");
    const piezas = [];
    for (const target of candidatas) {
        const opened = api.openSurface(describe.productId, target.name);
        if (!opened) continue;
        await new Promise(resolve => setTimeout(resolve, 60));
        let svg = "";
        try {
            // El lote es para GRABAR: sin mockup, sin marca de agua. Una vista
            // cuyo export sale vacío es una vista sin edición real: se salta.
            svg = await prepareSVGForExport({ asString: true, includeMockup: false });
        } catch (_) { svg = ""; }
        if (!svg || svg.trim() === "") continue;
        const vb = String((svg.match(/viewBox="([^"]+)"/) || [])[1] || "").trim().split(/\s+/).map(Number);
        const wMM = parseFloat((svg.match(/width="([\d.]+)mm"/) || [])[1]);
        const gInicio = svg.indexOf("<g");
        const gFin = svg.lastIndexOf("</g>");
        if (vb.length !== 4 || vb.some(v => !Number.isFinite(v)) || !Number.isFinite(wMM) || gInicio < 0 || gFin <= gInicio) continue;
        piezas.push({ nombre: target.name, viewBox: vb, wMM, contenido: svg.slice(gInicio, gFin + 4) });
        await new Promise(resolve => setTimeout(resolve, 120));
    }
    // Restaurar la vista original del cliente.
    try {
        const back = describe.surfaces.find(surf => surf.index === describe.surfaceIndex);
        if (back) api.openSurface(describe.productId, back.name);
    } catch (_) {}
    if (!piezas.length) return { ok: false, reason: "no-editado" };
    // Escala mm/unidad: la fija el editor según el producto; si no está, se
    // deduce de la primera pieza (ancho mm / ancho en unidades).
    const mmPorUnidad = Number(window.mmPerPaperUnit) || (piezas[0].wMM / piezas[0].viewBox[2]);
    const SEPARACION_MM = 6; // aire entre piezas: el láser nunca pega dos productos
    const sepUnidades = SEPARACION_MM / mmPorUnidad;
    const grupos = [];
    let cursor = 0; // en unidades del viewBox (papel)
    let anchoTotal = 0, altoMax = 0;
    piezas.forEach(p => {
        const [vx, vy, vw, vh] = p.viewBox;
        grupos.push(`<g data-ekko-vista="${p.nombre}" transform="translate(${(-vx + cursor).toFixed(4)},${(-vy).toFixed(4)})">${p.contenido}</g>`);
        cursor += vw + sepUnidades;
        anchoTotal += p.wMM;
        altoMax = Math.max(altoMax, vh * mmPorUnidad);
    });
    anchoTotal += SEPARACION_MM * (piezas.length - 1);
    const lote = `<svg xmlns="http://www.w3.org/2000/svg" width="${anchoTotal.toFixed(3)}mm" height="${altoMax.toFixed(3)}mm" viewBox="0 0 ${cursor - sepUnidades} ${altoMax / mmPorUnidad}">${grupos.join("")}</svg>`;
    return { ok: true, lote, piezas: piezas.map(p => p.nombre), producto: describe.productName };
}

export async function enviarAGrabarEkkoGrabados(surfaceNames = null) {
    const contacto = leerContactoTaller();
    const api = store();
    if (!api || !api.describe()?.productId) {
        notice("Cargá un producto antes de enviar a grabar.", { kind: "warn" });
        return { ok: false, reason: "no-product" };
    }
    const lote = await construirSVGLote(surfaceNames);
    if (!lote.ok) {
        notice(lote.reason === "no-editado"
            ? "Todavía no hay nada editado para grabar: dibujá o escribí algo primero."
            : "No se pudo preparar el envío. Probá de nuevo.", { kind: "warn", ms: 6000 });
        return lote;
    }
    const filename = `ekko-grabado-${slugify(lote.producto)}-COMPLETO-${stamp()}.svg`;
    downloadBlob(new Blob([lote.lote], { type: "image/svg+xml;charset=utf-8" }), filename);
    const msg = [
        `${contacto.nombre || "EKKO GRABADOS"} — pedido de grabado`,
        `Producto: ${lote.producto}`,
        `Piezas incluidas (1 archivo): ${lote.piezas.join(", ")}`,
        `Archivo: ${filename} (ya descargado: adjuntalo en este chat)`,
        `Fecha: ${new Date().toLocaleString()}`
    ].join("\n");
    setTimeout(() => {
        try { window.open(`https://wa.me/${contacto.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank"); } catch (_) {}
    }, 900);
    notice(`Listo para enviar: ${filename} (${lote.piezas.length} pieza${lote.piezas.length === 1 ? "" : "s"} en un solo archivo). Adjuntalo en el chat de WhatsApp.`, { kind: "ok", ms: 9000 });
    return { ok: true, filename, vistas: lote.piezas };
}

if (typeof window !== "undefined") {
    window.EKKO_PROJECT_IO = {
        exportViewsToSVG,
        buildProjectEnvelope,
        downloadProjectFile,
        openProjectFile,
        requestOpenProjectFile,
        downloadSketchPNG,
        downloadSketchPDF,
        enviarGrabadoPorWhatsApp,
        abrirDriveProyectos,
        enviarAGrabarEkkoGrabados
    };
}
