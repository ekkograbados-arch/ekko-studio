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
//
// Este es el valor por defecto. El hilo principal puede sobrescribirlo con
// setModeloUrl() almandar "preparar", que es donde vive CFG.MODELO: cambiar la
// config surte efecto de verdad y el worker no queda atado a una sola URL.
const MODELOS = {
    // Silueta humana (u2net_human_seg): entrenado sobre PERSONAS, no sobre
    // "objeto que resalta". MEDIDO con la foto de referencia (dos niñas
    // sentadas en el suelo): es el unico que QUITA EL SUELO y las sombras
    // entre y debajo de las piernas, que es el defecto que reporto el cliente.
    //
    //   MODNet 512 ..... deja el suelo entre las piernas (alfa 1,0 ahi)
    //   human_seg 320 .. suelo fuera, contorno correcto
    //
    // Contras medidos: 168 MB (contra 6,3) y ~7,9 s a 320 con UN hilo en un
    // i7-7500U; con 4 hilos en el despliegue baja a ~2-3 s. El peso se paga
    // una sola vez: el modelo queda en IndexedDB para siempre.
    humano: {
        url: '/modelos/u2net_human_seg.onnx',
        id: 'humanseg-320',
        tam: 320,
        etiqueta: 'Silueta humana',
        soloWasm: true
    },
    // MODNet: respaldo rapido (6,3 MB). Resuelve bien el pelo en retratos, pero
    // con personas de cuerpo entero se traga el suelo. Se usa solo si el de
    // silueta humana no esta desplegado o no se puede descargar.
    modnet: {
        url: '/modelos/modnet.onnx',
        id: 'modnet-q512',
        tam: 512,
        etiqueta: 'Retrato',
        soloWasm: true
    },
    // BiRefNet lite queda DESACTIVADO y fuera de la lista de candidatos a
    // proposito. Medido en la maquina del cliente:
    //
    //   "The number of storage buffers (65) in the Compute stage exceeds the
    //    maximum per-stage limit (8)"
    //
    // Su nodo Concat pide 65 storage buffers y WebGPU admite 8 por etapa: es
    // incompatible por arquitectura, no por memoria ni por configuracion. Al
    // pedir webgpu primero, ORT entraba en un ciclo de pipelines invalidos y
    // el navegador se congelaba. En CPU se queda corto de memoria.
    //
    // Se conserva el bloque para poder activarlo si aparece una exportacion
    // preparada para WebGPU (con el Concat partido), pero hoy no se usa.
    birefnet: {
        url: '/modelos/birefnet_fp16.onnx',
        id: 'birefnet-lite-fp16',
        tam: 1024,
        etiqueta: 'Alta definicion',
        DESHABILITADO: true
    },
    silueta: {
        url: '/modelos/silueta.onnx',
        id: 'silueta-v1',
        tam: 320,
        etiqueta: 'Estandar',
        DESHABILITADO: false
    }
};

// Modelo en uso. Arranca en la silueta humana, que es la que resuelve el
// recorte que pidio el cliente. Si no esta desplegada o falla, se baja sola
// al siguiente de la cadena (ver ORDEN_MODELOS), sin que el cliente vea error.
const MODELO_POR_DEFECTO = 'humano';
const ORDEN_MODELOS = ['humano', 'modnet', 'silueta'];
let MODELO_ACTUAL = MODELO_POR_DEFECTO;
let TAM_ENTRADA = MODELOS[MODELO_ACTUAL].tam;
const MEDIA = [0.485, 0.456, 0.406];
const DESV = [0.229, 0.224, 0.225];

/** Fuerza un modelo concreto desde el hilo principal. */
function setModelo(clave) {
    if (!MODELOS[clave]) return false;
    // Un modelo marcado como deshabilitado no se activa por mucho que lo
    // pidan: activarlo fue lo que congelo el navegador.
    if (MODELOS[clave].DESHABILITADO) {
        if (clave !== MODELO_ACTUAL) {
            MODELO_ACTUAL = MODELO_POR_DEFECTO;
            TAM_ENTRADA = MODELOS[MODELO_POR_DEFECTO].tam;
        }
        return false;
    }
    if (clave === MODELO_ACTUAL) return true;
    MODELO_ACTUAL = clave;
    TAM_ENTRADA = MODELOS[clave].tam;
    if (sesion) { try { sesion = null; } catch (_) {} }
    return true;
}
// --- Estado ---------------------------------------------------------------
let ortCargado = null;
let sesion = null;
let modeloClave = null;
let cacheIdb = null;

// --- Utilidades de descarga con progreso ----------------------------------
function reportar(tipo, carga, total, detalle) {
    self.postMessage({ tipo, carga, total, detalle: detalle || '' });
}

/**
 * Cantidad de hilos de WASM.
 *
 * Estaba fijada en 1 a mano con un comentario que decia que el hosting no manda
 * las cabeceras COOP/COEP. Es falso: vercel.json SI las manda, asi que en el
 * despliegue real la pagina queda aislada, SharedArrayBuffer existe y el motor
 * podia estar usando todos los nucleos. En un servidor de pruebas sin esas
 * cabeceras no hay SharedArrayBuffer y se usa 1, que es lo unico que funciona.
 *
 * Es justo lo que permite pagar la entrada mas grande (512x896 en vez de un
 * cuadrado de 512) sin que el recorte tarde mas.
 */
function hilosWasm() {
    if (typeof SharedArrayBuffer === 'undefined') return 1;
    const nucleos = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1;
    return Math.max(1, Math.min(4, nucleos));
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
                    self.ort.env.wasm.numThreads = hilosWasm();
                    self.ort.env.wasm.wasmPaths = CDN;
                    self.ort.env.logLevel = 'error';
                    return self.ort;
                }
            } catch (_) { delete self.ort; }
        }

        importScripts(CDN + 'ort.min.js');
        if (!self.ort) throw new Error('No se pudo cargar el motor de IA');
        self.ort.env.wasm.numThreads = hilosWasm();
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

async function leerModeloCacheado(id) {
    try {
        const clave = id || MODELOS[MODELO_ACTUAL].id;
        const db = await abrirCache();
        return await new Promise((resolve) => {
            const tx = db.transaction('modelos', 'readonly');
            const r = tx.objectStore('modelos').get(clave);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => resolve(null);
        });
    } catch (_) { return null; }
}

async function guardarEnCache(arrayBuffer, id) {
    try {
        const clave = id || MODELOS[MODELO_ACTUAL].id;
        const db = await abrirCache();
        await new Promise((resolve) => {
            const tx = db.transaction('modelos', 'readwrite');
            tx.objectStore('modelos').put(arrayBuffer, clave);
            tx.oncomplete = resolve;
            tx.onerror = resolve;
            tx.onabort = resolve;
        });
        return true;
    } catch (_) { return false; }
}

async function obtenerBufferModelo(clave) {
    const modelo = MODELOS[clave] || MODELOS[MODELO_ACTUAL];
    // Cada modelo se cachea por separado: si se cae al estandar y otro dia
    // vuelve al de alta, no tiene que volver a bajarlo.
    if (buffersCache[modelo.id]) return buffersCache[modelo.id];
    const enCache = await leerModeloCacheado(modelo.id);
    if (enCache) {
        reportar('cache', enCache.byteLength, enCache.byteLength, 'modelo desde caché local');
        buffersCache[modelo.id] = enCache;
        modeloClave = enCache;
        return enCache;
    }
    reportar('descarga', 0, 0, 'descargando modelo…');
    const resp = await fetch(modelo.url);
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

    await guardarEnCache(buf, modelo.id);
    buffersCache[modelo.id] = buf;
    modeloClave = buf;
    return buf;
}

// Que proveedor se esta usando de verdad. WebGPU es mucho mas rapido cuando
// funciona, pero no todas las maquinas lo tienen bien soportado y su fallo
// TIPICO no aparece al crear la sesion sino DESPUES, al ejecutar. Sin esto,
// un equipo con WebGPU defectuoso se queda colgado sin error visible.
let usandoWebGPU = false;
// Buffers ya bajados, por id de modelo.
const buffersCache = {};
// El modelo de alta fallo en esta maquina: no se vuelve a intentar.
let falloAltaDefinicion = false;

/**
 * Carga el modelo activo y, si la maquina no puede con el, baja al estandar
 * SIN QUE EL CLIENTE SEPA NADA.
 *
 * El de alta definicion (1024) necesita mucha memoria: se midio que en una
 * maquina sin WebGPU falla con error de memoria al ejecutar. Si eso pasa, el
 * recorte igual sale, con el modelo de 320, que es peor pero usable, y el
 * cliente cierra el detalle fino con el pincel.
 */
/**
 * Baja al SIGUIENTE modelo de la cadena (humano → modnet → silueta).
 *
 * Es lo que hace que cambiar de modelo no pueda romper "Quitar Fondo": si el
 * de silueta humana no esta desplegado todavia (404) o la descarga falla, el
 * cliente igual obtiene un recorte, con el siguiente de la lista, sin errores
 * ni avisos tecnicos.
 *
 * Devuelve false si ya no hay a donde bajar.
 */
function bajarDeModelo() {
    const i = ORDEN_MODELOS.indexOf(MODELO_ACTUAL);
    for (let k = i + 1; k < ORDEN_MODELOS.length; k++) {
        const clave = ORDEN_MODELOS[k];
        if (!MODELOS[clave] || MODELOS[clave].DESHABILITADO) continue;
        MODELO_ACTUAL = clave;
        TAM_ENTRADA = MODELOS[clave].tam;
        sesion = null;
        self.postMessage({
            tipo: 'nota',
            detalle: 'usando recorte ' + (MODELOS[clave].etiqueta || clave),
            lado: TAM_ENTRADA
        });
        return true;
    }
    return false;
}

async function obtenerSesion(forzarWasm = false) {
    if (sesion && !forzarWasm) return sesion;
    const ort = await cargarOrt();

    // Si estamos en un modelo que ya fallo, no se reintenta: se baja de una.
    if (falloAltaDefinicion && MODELO_ACTUAL === 'birefnet') {
        MODELO_ACTUAL = MODELO_POR_DEFECTO;
        TAM_ENTRADA = MODELOS[MODELO_POR_DEFECTO].tam;
        sesion = null;
    }

    let buf;
    try {
        buf = await obtenerBufferModelo(MODELO_ACTUAL);
    } catch (e) {
        // El modelo preferido NO esta desplegado todavia (404) o la descarga
        // fallo. No es un error para el cliente: se cae al siguiente de la
        // cadena, que es el que siempre estuvo disponible.
        if (bajarDeModelo()) return obtenerSesion(forzarWasm);
        throw e;
    }

    if (forzarWasm || (MODELOS[MODELO_ACTUAL] && MODELOS[MODELO_ACTUAL].soloWasm)) {
        // MODNet va solo por CPU a proposito: pesa tan poco que la GPU no
        // aporta, y asi no queda ninguna posibilidad de que ORT entre en el
        // ciclo de pipelines invalidos que congelo el navegador con BiRefNet.
        if (!forzarWasm) reportar('sesion', 0, 0, 'preparando el motor…');
        else reportar('sesion', 0, 0, 'reintentando en CPU…');
        sesion = await ort.InferenceSession.create(buf, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });
        usandoWebGPU = false;
        return sesion;
    }

    reportar('sesion', 0, 0, 'preparando el motor…');
    const proveedores = [];
    if (typeof navigator !== 'undefined' && navigator.gpu) proveedores.push('webgpu');
    proveedores.push('wasm');

    try {
        sesion = await ort.InferenceSession.create(buf, {
            executionProviders: proveedores,
            graphOptimizationLevel: 'all'
        });
        usandoWebGPU = proveedores[0] === 'webgpu';
    } catch (e) {
        // Si ni siquiera puede CREAR la sesion de alta, no hay caso: al estandar.
        if (MODELO_ACTUAL !== 'silueta') {
            falloAltaDefinicion = true;
            sesion = null;
            return obtenerSesion(forzarWasm);
        }
        sesion = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
        usandoWebGPU = false;
    }
    return sesion;
}


// --- Preprocesado ---------------------------------------------------------
/**
 * Construye el tensor con el TAMAÑO QUE LLEGA, no con un cuadrado fijo.
 *
 * La foto viaja con su aspecto real (medido: MODNet acepta 384x1024 o
 * 512x768 y devuelve la alfa del mismo tamaño), asi que el tensor puede ser
 * 512x896. Antes se deducia el lado con sqrt(pixeles/4), que solo es cierto
 * para un cuadrado: con 512x896 daba 677, no coincidia con TAM_ENTRADA y se
 * reescalaba a 512x512, aplastando la foto y devolviendo la mascara torcida.
 */
function construirTensor(ort, pixeles, ancho, alto) {
    const w = Math.max(32, Math.round(ancho || TAM_ENTRADA));
    const h = Math.max(32, Math.round(alto || TAM_ENTRADA));
    const n = w * h;
    const data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        data[i] = (pixeles[o] / 255 - MEDIA[0]) / DESV[0];
        data[i + n] = (pixeles[o + 1] / 255 - MEDIA[1]) / DESV[1];
        data[i + 2 * n] = (pixeles[o + 2] / 255 - MEDIA[2]) / DESV[2];
    }
    return new ort.Tensor('float32', data, [1, 3, h, w]);
}

/**
 * Escala la imagen al tamano que pida el modelo ACTUAL.
 *
 * Hace falta porque cada modelo pide un lado distinto (MODNet 512, silueta
 * 320) y el respaldo puede cambiarlo en caliente: si se reusara el tensor ya
 * construido, el modelo recibiria una forma que no espera.
 *
 * El reescalado lo hace el propio canvas con su filtrado y no vecino mas
 * cercana: en una foto de retrato, muestrear a saltos deja aliasing en el pelo
 * y el recorte sale sucio.
 */
function construirTensorEscalada(ort, pixeles, tam) {
    const t = tam || TAM_ENTRADA;
    const n = t * t;
    const data = new Float32Array(3 * n);
    const ladoViejo = Math.max(1, Math.round(Math.sqrt(pixeles.length / 4)));

    const origen = new ImageData(ladoViejo, ladoViejo);
    origen.data.set(pixeles.subarray(0, ladoViejo * ladoViejo * 4));
    const tmp = document.createElement('canvas');
    tmp.width = ladoViejo; tmp.height = ladoViejo;
    tmp.getContext('2d').putImageData(origen, 0, 0);

    const cv = document.createElement('canvas');
    cv.width = t; cv.height = t;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, t, t);

    const px = ctx.getImageData(0, 0, t, t).data;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        data[i] = (px[o] / 255 - MEDIA[0]) / DESV[0];
        data[i + n] = (px[o + 1] / 255 - MEDIA[1]) / DESV[1];
        data[i + 2 * n] = (px[o + 2] / 255 - MEDIA[2]) / DESV[2];
    }
    return new ort.Tensor('float32', data, [1, 3, t, t]);
}

// --- Mensajería -----------------------------------------------------------
self.onmessage = async (ev) => {
    const d = ev.data || {};
    if (d.accion === 'preparar') {
        // El hilo principal decide QUE modelo se quiere (no una URL: el worker
        // ya conoce las suyas, y asi el respaldo automatico sigue siendo
        // responsabilidad de este archivo).
        if (d.modeloClave) setModelo(d.modeloClave);
        try {
            await obtenerSesion();
            // El hilo principal necesita saber a que lado escalar la foto, y el
            // worker es quien sabe que modelo quedo activo (puede haber bajado
            // al estandar). Se avisa SIEMPRE, no solo cuando hay respaldo: antes
            // no se hacia y el hilo principal adivinaba 320, asi que con MODNet
            // (que pide 512) mandaba un buffer de 320, el tensor salia lleno de
            // NaN y el recorte llegaba VACIO sin ningun error visible.
            self.postMessage({ tipo: 'nota', lado: TAM_ENTRADA });
            reportar('listo', 1, 1, 'motor listo');
        }
        catch (e) { self.postMessage({ tipo: 'error', mensaje: String(e && e.message || e) }); }
        return;
    }
    if (d.accion === 'probar') {
        // Sonda de diagnostico: responde con algo pequeno para comprobar que el
        // worker sigue vivo sin pagar el coste de una inferencia completa.
        self.postMessage({ tipo: 'listo', carga: 1, total: 1, detalle: 'sondeo' });
        return;
    }
    if (d.accion === 'inferir') {
        try {
            const ort = await cargarOrt();
            const pixeles = new Uint8ClampedArray(d.pixeles);
            // Tamaño REAL del tensor que manda el hilo principal. La foto va con
            // su aspecto (512x896, 384x1024...), asi que no se puede deducir.
            const anchoEntrada = Math.max(32, Math.round(d.anchoEntrada || TAM_ENTRADA));
            const altoEntrada = Math.max(32, Math.round(d.altoEntrada || TAM_ENTRADA));
            const cabeExacto = pixeles.length === anchoEntrada * altoEntrada * 4;
            const tensor = cabeExacto
                ? construirTensor(ort, pixeles, anchoEntrada, altoEntrada)
                : construirTensorEscalada(ort, pixeles, TAM_ENTRADA);

            let salida = null;
            let s = await obtenerSesion();
            reportar('inferir', 0, 0, 'analizando la imagen…');
            try {
                salida = await s.run({ [s.inputNames[0]]: tensor });
            } catch (e) {
                // Dos motivos distintos de fallo y dos respuestas distintas:
                //
                // a) Fallo de MEMORIA con el modelo de alta (1024). Es lo que
                //    se midio en una maquina sin WebGPU. El recorte NO puede
                //    quedar sin hacer: se baja al modelo estandar de 320, que
                //    es peor pero usable, y el cliente lo completa con el
                //    pincel. El cliente no ve ningun error.
                // b) Dispositivo WebGPU perdido con un modelo que ya funciona
                //    en CPU: se reintenta en CPU una vez.
                if (bajarDeModelo()) {
                    // Hay que rehacer el tensor: cambio el tamano de entrada.
                    const pix2 = new Uint8ClampedArray(d.pixeles);
                    const t2 = await construirTensorEscalada(ort, pix2);
                    s = await obtenerSesion();
                    salida = await s.run({ [s.inputNames[0]]: t2 });
                } else if (usandoWebGPU) {
                    s = await obtenerSesion(true);
                    salida = await s.run({ [s.inputNames[0]]: tensor });
                } else {
                    throw e;
                }
            }

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
