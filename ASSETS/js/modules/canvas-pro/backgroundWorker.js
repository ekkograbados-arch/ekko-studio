/* =========================================================================
   EKKO STUDIO — Worker de eliminación de fondo (ONNX Runtime Web)
   -------------------------------------------------------------------------
   Corre FUERA del hilo principal: la inferencia no congela el lienzo.

   Modelo: silueta.onnx (42 MB) — U²-Net reentrenado, licencia Apache-2.0.
   Aparece bajo MIT/Apache-2.0, apto para uso comercial.

   Entrada: 320x320x3 normalizada con medias/desviaciones de ImageNet.
   Salida:  [1,1,320,320] alfa en [0,1] que se reescala al tamaño original.
   ========================================================================= */

'use strict';

// --- Configuración de ruta -------------------------------------------------
// Ruta ABSOLUTA y MISMO ORIGEN: dentro de un worker una ruta relativa se
// resolvería contra /ASSETS/js/modules/canvas-pro/ y daría 404.
// /modelos/silueta.onnx lo sirve el propio despliegue (rewrite de vercel.json),
// por eso el navegador no necesita CORS ni descarga desde HuggingFace directo.
const MODELO_URL = '/modelos/silueta.onnx';
const MODELO_ID = 'silueta-v1';
const TAM_ENTRADA = 320;
const MEDIA = [0.485, 0.456, 0.406];
const DESV = [0.229, 0.224, 0.225];

// --- Estado ---------------------------------------------------------------
let ortCargado = null;
let sesion = null;
let modeloClave = null;
let cacheIdb = null;

// --- Utilidades de descarga con progreso ----------------------------------
function reportar(tipo, carga, total, detalle) {
    self.postMessage({ tipo, carga, total, detalle: detalle || '' });
}

async function cargarOrt() {
    if (ortCargado) return ortCargado;
    ortCargado = (async () => {
        if (self.ort) return self.ort;
        const CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
        const hayWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;

        // WebGPU: de ~6s a ~1-2s. Si el runtime no lo soporta, se cae a WASM.
        if (hayWebGPU) {
            try {
                importScripts(CDN + 'ort.webgpu.min.js');
                if (self.ort) {
                    // Un SOLO hilo: los hilos multiples exigen SharedArrayBuffer,
                    // que a su vez exige cabeceras COOP/COEP que el hosting no
                    // envia, y ort aborta con "previous call to initWasm() failed".
                    self.ort.env.wasm.numThreads = 1;
                    self.ort.env.wasm.wasmPaths = CDN;
                    self.ort.env.logLevel = 'error';
                    return self.ort;
                }
            } catch (_) { delete self.ort; }
        }

        importScripts(CDN + 'ort.min.js');
        if (!self.ort) throw new Error('No se pudo cargar el motor de IA');
        self.ort.env.wasm.numThreads = 1;
        self.ort.env.wasm.wasmPaths = CDN;
        self.ort.env.logLevel = 'error';
        return self.ort;
    })();
    return ortCargado;
}

// --- Caché persistente del modelo (IndexedDB) -----------------------------
function abrirCache() {
    if (cacheIdb) return cacheIdb;
    cacheIdb = new Promise((resolve, reject) => {
        const req = indexedDB.open('ekko-bg-modelos', 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('modelos')) db.createObjectStore('modelos');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return cacheIdb;
}

async function leerModeloCacheado() {
    try {
        const db = await abrirCache();
        return await new Promise((resolve) => {
            const tx = db.transaction('modelos', 'readonly');
            const r = tx.objectStore('modelos').get(MODELO_ID);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => resolve(null);
        });
    } catch (_) { return null; }
}

async function guardarEnCache(arrayBuffer) {
    try {
        const db = await abrirCache();
        await new Promise((resolve) => {
            const tx = db.transaction('modelos', 'readwrite');
            tx.objectStore('modelos').put(arrayBuffer, MODELO_ID);
            tx.oncomplete = resolve;
            tx.onerror = resolve;
            tx.onabort = resolve;
        });
        return true;
    } catch (_) { return false; }
}

async function obtenerBufferModelo() {
    if (modeloClave) return modeloClave;
    const enCache = await leerModeloCacheado();
    if (enCache) {
        reportar('cache', enCache.byteLength, enCache.byteLength, 'modelo desde caché local');
        modeloClave = enCache;
        return modeloClave;
    }
    reportar('descarga', 0, 0, 'descargando modelo…');
    const resp = await fetch(MODELO_URL);
    if (!resp.ok) throw new Error('No se pudo cargar el modelo (' + resp.status + ')');
    const total = Number(resp.headers.get('content-length')) || 0;

    let buf;
    if (resp.body && resp.body.getReader) {
        const reader = resp.body.getReader();
        const trozos = [];
        let recibido = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            trozos.push(value);
            recibido += value.length;
            reportar('descarga', recibido, total, 'descargando modelo…');
        }
        buf = new ArrayBuffer(recibido);
        const vista = new Uint8Array(buf);
        let off = 0;
        for (const t of trozos) { vista.set(t, off); off += t.length; }
    } else {
        buf = await resp.arrayBuffer();
        reportar('descarga', buf.byteLength, buf.byteLength, 'descargando modelo…');
    }

    await guardarEnCache(buf);
    modeloClave = buf;
    return buf;
}

async function obtenerSesion() {
    if (sesion) return sesion;
    const ort = await cargarOrt();
    const buf = await obtenerBufferModelo();

    reportar('sesion', 0, 0, 'preparando el motor…');
    const proveedores = [];
    if (typeof navigator !== 'undefined' && navigator.gpu) proveedores.push('webgpu');
    proveedores.push('wasm');
    try {
        sesion = await ort.InferenceSession.create(buf, {
            executionProviders: proveedores,
            graphOptimizationLevel: 'all'
        });
    } catch (_) {
        sesion = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    }
    return sesion;
}

// --- Preprocesado ---------------------------------------------------------
function construirTensor(ort, pixeles) {
    // pixeles: Uint8ClampedArray RGBA de 320x320 ya escalado.
    const n = TAM_ENTRADA * TAM_ENTRADA;
    const data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        data[i] = (pixeles[o] / 255 - MEDIA[0]) / DESV[0];
        data[i + n] = (pixeles[o + 1] / 255 - MEDIA[1]) / DESV[1];
        data[i + 2 * n] = (pixeles[o + 2] / 255 - MEDIA[2]) / DESV[2];
    }
    return new ort.Tensor('float32', data, [1, 3, TAM_ENTRADA, TAM_ENTRADA]);
}

// --- Mensajería -----------------------------------------------------------
self.onmessage = async (ev) => {
    const d = ev.data || {};
    if (d.accion === 'preparar') {
        try { await obtenerSesion(); reportar('listo', 1, 1, 'motor listo'); }
        catch (e) { self.postMessage({ tipo: 'error', mensaje: String(e && e.message || e) }); }
        return;
    }
    if (d.accion === 'inferir') {
        try {
            const ort = await cargarOrt();
            const s = await obtenerSesion();
            reportar('inferir', 0, 0, 'analizando la imagen…');
            const tensor = construirTensor(ort, new Uint8ClampedArray(d.pixeles));
            const salida = await s.run({ [s.inputNames[0]]: tensor });
            const pred = salida[s.outputNames[0]];
            const dims = pred.dims;
            const w = dims[dims.length - 1], h = dims[dims.length - 2];
            // Copia a Float32Array propio: pred.data puede ser un tensor compartido.
            const alfa = new Float32Array(pred.data);
            self.postMessage({ tipo: 'mascara', alfa, w, h, ancho: d.ancho, alto: d.alto },
                [alfa.buffer]);
        } catch (e) {
            self.postMessage({ tipo: 'error', mensaje: String(e && e.message || e) });
        }
    }
};
