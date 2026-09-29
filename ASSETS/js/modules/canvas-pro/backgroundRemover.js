/* =========================================================================
   EKKO STUDIO — Quitar Fondo con IA (local, en el navegador)
   -------------------------------------------------------------------------
   Nada sale del equipo: el modelo y la imagen se procesan en el navegador.

   Modelo: silueta.onnx (42 MB, Apache-2.0 — uso comercial permitido).
   Se descarga una vez y queda en caché (IndexedDB) para siempre.

   El recorte es geometría real: la imagen conserva su transformación
   exacta y la máscara se aplica como canal alfa, nunca como un color.
   ========================================================================= */

(function (EKKO, undefined) {
    'use strict';

    const CFG = {
        MODELO: '/ASSETS/modelos/silueta.onnx',
        WORKER: '/ASSETS/js/modules/canvas-pro/backgroundWorker.js',
        ORT: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js',
        ENTRADA: 320,          // tamaño fijo que exige el modelo
        MAX_LADO: 2600,        // techo de trabajo: memoria y tiempo razonables
        // Refinado de borde: quita el halo oscuro que deja el recorte.
        BORDE_CONTRASTE: 0.06, // umbral de diferencia contra el vecino
        BORDE_SUAVIZADO: 0.35  // fuerza del suavizado en la franja
    };

    const ESTADO = {
        worker: null,
        listo: false,
        cargando: false,
        progreso: 0,
        fase: '',
        imagenOriginal: null,
        imagenProcesada: null,
        ultimoError: null,
        oyentes: new Set()
    };

    // ----------------------------------------------------------------------
    // Progreso para la interfaz
    // ----------------------------------------------------------------------
    function informar(fase, carga, total, detalle) {
        ESTADO.fase = fase;
        ESTADO.progreso = total > 0 ? Math.min(1, carga / total) : 0;
        ESTADO.oyentes.forEach(fn => {
            try { fn({ fase, carga, total, progreso: ESTADO.progreso, detalle }); } catch (_) {}
        });
    }

    function alProgresar(fn) {
        ESTADO.oyentes.add(fn);
        return () => ESTADO.oyentes.delete(fn);
    }

    // ----------------------------------------------------------------------
    // ONNX Runtime: se carga bajo demanda (pesa ~2 MB si no se usa)
    // ----------------------------------------------------------------------
    let ortPromesa = null;
    function cargarOrt() {
        if (window.ort) return Promise.resolve(window.ort);
        if (ortPromesa) return ortPromesa;
        ortPromesa = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = CFG.ORT;
            s.async = true;
            s.onload = () => window.ort
                ? resolve(window.ort)
                : reject(new Error('ONNX Runtime no cargó'));
            s.onerror = () => reject(new Error('No hay conexión para descargar el motor'));
            document.head.appendChild(s);
        }).catch(err => { ortPromesa = null; throw err; });
        return ortPromesa;
    }

    // ----------------------------------------------------------------------
    // Worker
    // ----------------------------------------------------------------------
    function obtenerWorker() {
        if (ESTADO.worker) return Promise.resolve(ESTADO.worker);
        return new Promise((resolve, reject) => {
            let w;
            try { w = new Worker(CFG.WORKER); }
            catch (e) { return reject(new Error('Este navegador no soporta Web Workers')); }

            let resolver = null;
            let rechazar = null;
            let esperaTipo = null;

            w.onmessage = ev => {
                const d = ev.data || {};
                const esRespuesta = d.tipo === esperaTipo;
                if (d.tipo === 'listo') ESTADO.listo = true;

                if (esRespuesta && d.tipo === 'mascara') {
                    if (resolver) { const r = resolver; resolver = null; rechazar = null; esperaTipo = null; r(d); }
                } else if (d.tipo === 'error') {
                    if (rechazar) { const r = rechazar; resolver = null; rechazar = null; esperaTipo = null; r(new Error(d.mensaje || 'Error del motor de IA')); }
                } else if (esRespuesta) {
                    if (resolver) { const r = resolver; resolver = null; rechazar = null; esperaTipo = null; r(d); }
                } else {
                    informar(d.tipo, d.carga || 0, d.total || 0, d.detalle || '');
                }
            };
            w.onerror = () => {
                if (rechazar) { const r = rechazar; resolver = null; rechazar = null; r(new Error('Fallo en el worker de IA')); }
            };

            ESTADO.worker = w;
            ESTADO._esperar = (mensaje, tipoRespuesta) => new Promise((res, rej) => {
                resolver = res; rechazar = rej;
                esperaTipo = tipoRespuesta || 'mascara';
                w.postMessage(mensaje);
            });
            resolve(w);
        });
    }

    /** Envía un comando al worker y espera su respuesta correspondiente. */
    async function enviar(msg, tipoRespuesta) {
        await obtenerWorker();
        return ESTADO._esperar(msg, tipoRespuesta);
    }

    // ----------------------------------------------------------------------
    // Escalado a 320x320 conservando el aspecto dentro de un lienzo cuadrado
    // ----------------------------------------------------------------------
    function prepararEntrada(imagen) {
        const W = imagen.naturalWidth || imagen.width;
        const H = imagen.naturalHeight || imagen.height;
        if (!W || !H) throw new Error('La imagen no tiene dimensiones');

        const S = CFG.ENTRADA;
        // Encajar dentro de 320x320 sin deformar: el modelo vería un sujeto
        // estirado y el recorte saldría torcido.
        const escala = Math.min(S / W, S / H);
        const dw = Math.max(1, Math.round(W * escala));
        const dh = Math.max(1, Math.round(H * escala));

        const lienzo = document.createElement('canvas');
        lienzo.width = S; lienzo.height = S;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, S, S);
        ctx.drawImage(imagen, (S - dw) / 2, (S - dh) / 2, dw, dh);

        return { pixeles: ctx.getImageData(0, 0, S, S).data, W, H };
    }

    // ----------------------------------------------------------------------
    // Aplicación de la máscara + refinado de borde
    // ----------------------------------------------------------------------
    function aplicarMascara(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo) {
        const lienzo = document.createElement('canvas');
        lienzo.width = anchoTrabajo;
        lienzo.height = altoTrabajo;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imagen, 0, 0, anchoTrabajo, altoTrabajo);
        const img = ctx.getImageData(0, 0, anchoTrabajo, altoTrabajo);
        const px = img.data;

        // Muestreo bilineal de la máscara: evita el serrucho de un nearest.
        const fila = new Float32Array(anchoTrabajo);
        for (let y = 0; y < altoTrabajo; y++) {
            const fy = Math.min(mh - 1, (y * mh) / altoTrabajo);
            const y0 = Math.floor(fy), y1 = Math.min(mh - 1, y0 + 1), ty = fy - y0;
            for (let x = 0; x < anchoTrabajo; x++) {
                const fx = Math.min(mw - 1, (x * mw) / anchoTrabajo);
                const x0 = Math.floor(fx), x1 = Math.min(mw - 1, x0 + 1), tx = fx - x0;
                const a = alfa[y0 * mw + x0], b = alfa[y0 * mw + x1];
                const c = alfa[y1 * mw + x0], d = alfa[y1 * mw + x1];
                fila[x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
            }
            for (let x = 0; x < anchoTrabajo; x++) {
                const o = (y * anchoTrabajo + x) * 4;
                px[o + 3] = Math.max(0, Math.min(255, Math.round(fila[x] * 255)));
            }
        }
        ctx.putImageData(img, 0, 0);
        refinarBorde(ctx, anchoTrabajo, altoTrabajo);
        return lienzo;
    }

    /**
     * Refinado de borde.
     *
     * El recorte neuronal deja una franja de 1-2 px donde el color del sujeto
     * se mezcla con el fondo: es el halo oscuro/claro que se ve al imprimir.
     * Se contrae el alfa donde el color local es muy distinto al de la
     * mayoría del sujeto, y se suaviza la transición.
     */
    function refinarBorde(ctx, W, H) {
        const d = ctx.getImageData(0, 0, W, H);
        const p = d.data;
        const n = W * H;

        // Color medio del sujeto (alfa > 0.7) = referencia de "qué es el sujeto".
        let r = 0, g = 0, b = 0, c = 0;
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            if (p[o + 3] > 178) { r += p[o]; g += p[o + 1]; b += p[o + 2]; c++; }
        }
        if (c < 64) return; // sujeto demasiado pequeño: no arriesgar
        r /= c; g /= c; b /= c;

        const dif = (o) => {
            const dr = p[o] - r, dg = p[o + 1] - g, db = p[o + 2] - b;
            return Math.sqrt(dr * dr + dg * dg + db * db) / 441.67;
        };
        const u = CFG.BORDE_CONTRASTE;
        const suav = CFG.BORDE_SUAVIZADO;

        for (let i = 0; i < n; i++) {
            const o = i * 4;
            const a = p[o + 3];
            if (a === 0 || a === 255) continue;        // solo la franja
            if (dif(o) > u) continue;                    // es color real del sujeto
            // Halo: baja la opacidad parcialmente en vez de cortar de golpe.
            p[o + 3] = Math.max(0, Math.min(255, Math.round(a * (1 - suav * (u - dif(o)) / u) + a * suav * dif(o) / u)));
        }

        // Un pase de desenfoque de 1 px únicamente sobre la franja suavizada.
        const copia = new Uint8ClampedArray(p);
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const o = (y * W + x) * 4;
                if (copia[o + 3] === 0 || copia[o + 3] === 255) continue;
                let s = 0;
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++)
                        s += copia[((y + dy) * W + (x + dx)) * 4 + 3];
                p[o + 3] = Math.round(s / 9);
            }
        }
        ctx.putImageData(d, 0, 0);
    }

    // ----------------------------------------------------------------------
    // API principal
    // ----------------------------------------------------------------------
    async function quitarFondo(raster, opciones = {}) {
        if (!raster) throw new Error('Seleccioná una imagen primero');
        ESTADO.ultimoError = null;
        ESTADO.imagenOriginal = raster;

        try {
            // Conservar TODO antes de tocar nada: posición, tamaño, rotación,
            // escala y opacidad son la identidad visual del objeto.
            const posOriginal = raster.position.clone();
            const tamOriginal = raster.size.clone();
            const rotOriginal = raster.rotation;
            const escOriginal = raster.scaling.clone();
            const opaOriginal = raster.opacity;
            const nomOriginal = raster.name;

            const elemento = raster.getElement();
            if (!elemento) throw new Error('La imagen todavía no cargó');
            if (!elemento.complete || elemento.naturalWidth === 0) {
                await new Promise(res => {
                    const t = setTimeout(res, 2500);
                    elemento.complete ? (clearTimeout(t), res()) : null;
                    elemento.addEventListener('load', () => { clearTimeout(t); res(); }, { once: true });
                });
            }

            await cargarOrt();
            await obtenerWorker();
            await enviar({ accion: 'preparar' }, 'listo');

            const entrada = prepararEntrada(elemento);
            informar('inferir', 0, 0, 'analizando la imagen…');
            const r = await enviar({
                accion: 'inferir',
                pixeles: entrada.pixeles.buffer,
                ancho: entrada.W,
                alto: entrada.H
            });

            // Limitar el lado largo: por encima de ~2600 px el coste de
            // memoria no aporta nada visible en un producto pequeño.
            const esc = Math.min(1, CFG.MAX_LADO / Math.max(entrada.W, entrada.H));
            const aw = Math.max(1, Math.round(entrada.W * esc));
            const ah = Math.max(1, Math.round(entrada.H * esc));

            const lienzo = aplicarMascara(r.alfa, r.w, r.h, elemento, aw, ah);

            // El Raster nuevo se crea desde la URL, no desde un canvas, para
            // que Paper no intente hornear la imagen.
            const nueva = new paper.Raster(lienzo.toDataURL('image/png'));
            nueva.data = { ...(raster.data || {}), quitarFondoIA: true, source: raster.data?.source || 'user-image' };

            // Esperar a que la imagen exista ANTES de aplicar la transformacion.
            // Aplicarla antes daba size 0 y perdida de rotacion, porque un
            // Raster recien creado todavia no tiene dimensiones.
            await new Promise(res => {
                const listo = nueva.image && nueva.image.complete && nueva.width > 0;
                if (listo) return res();
                let hecho = false;
                const fin = () => { if (!hecho) { hecho = true; res(); } };
                nueva.onLoad = fin;
                setTimeout(fin, 8000);
            });

            try {
                nueva.applyMatrix = false;
                nueva.matrix = raster.matrix.clone();
                nueva.rotation = rotOriginal;
                nueva.scaling = escOriginal;
                nueva.position = posOriginal;
            } catch (_) {}

            nueva.opacity = opaOriginal;
            nueva.name = (nomOriginal || 'Imagen') + ' sin fondo';

            // El original se oculta, no se borra: deshacer es un clic.
            raster.visible = false;
            ESTADO.imagenProcesada = nueva;
            ESTADO.listo = true;
            informar('listo', 1, 1, 'Fondo eliminado');
            if (typeof window.saveHistory === 'function') {
                try { window.saveHistory(); } catch (_) {}
            }
            return nueva;
        } catch (e) {
            ESTADO.ultimoError = e;
            informar('error', 0, 0, 'Error: ' + (e && e.message || e));
            throw e;
        }
    }

    function deshacer() {
        if (ESTADO.imagenProcesada) {
            try { ESTADO.imagenProcesada.remove(); } catch (_) {}
            ESTADO.imagenProcesada = null;
        }
        if (ESTADO.imagenOriginal) {
            try { ESTADO.imagenOriginal.visible = true; } catch (_) {}
        }
        informar('listo', 1, 1, 'Recorte deshecho');
    }

    /** Descarga el modelo en segundo plano para que el primer uso sea rápido. */
    function precargar() {
        return (async () => {
            try {
                await cargarOrt();
                await obtenerWorker();
                await enviar({ accion: 'preparar' }, 'listo');
                return true;
            } catch (_) { return false; }
        })();
    }

    EKKO.BackgroundRemover = {
        quitarFondo,
        deshacer,
        precargar,
        alProgresar,
        estado: () => ({
            listo: ESTADO.listo,
            cargando: ESTADO.cargando,
            fase: ESTADO.fase,
            progreso: ESTADO.progreso
        }),
        config: CFG
    };

    // Botón contextual: sustituye el alert() por un mensaje en la barra.
    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('btnCtxRemoveBg');
        const btnBarra = document.querySelector('[data-fusion-btn="removeBg"]');
        const aviso = document.createElement('div');
        aviso.id = 'ekko-bg-aviso';
        aviso.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);' +
            'background:#111827;color:#f9fafb;padding:10px 16px;border-radius:10px;' +
            'font:500 13px/1.35 system-ui,sans-serif;z-index:99999;display:none;' +
            'box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:min(520px,92vw)';
        document.body.appendChild(aviso);
        const barra = document.getElementById('pro-progress-bg');
        if (barra) {
            barra.style.cssText = 'height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-top:8px';
            const relleno = document.createElement('div');
            relleno.style.cssText = 'height:100%;width:0;background:#7c3aed;transition:width .18s';
            barra.appendChild(relleno);
        }

        alProgresar(ev => {
            if (!aviso.style) return;
            if (ev.fase === 'error') {
                aviso.textContent = '⚠️ ' + ev.detalle;
                aviso.style.display = 'block';
                if (barra) barra.style.display = 'none';
                setTimeout(() => { aviso.style.display = 'none'; }, 5200);
                return;
            }
            if (ev.fase === 'listo') {
                aviso.textContent = '✅ Fondo eliminado';
                aviso.style.display = 'block';
                setTimeout(() => { aviso.style.display = 'none'; }, 2200);
            } else {
                const pct = ev.total > 0 ? Math.round(ev.carga / ev.total * 100) + '%' : '';
                aviso.textContent = 'Quitar fondo: ' + (ev.detalle || ev.fase) + ' ' + pct;
                aviso.style.display = 'block';
            }
            if (barra) {
                barra.style.display = ev.fase === 'listo' || ev.fase === 'error' ? 'none' : 'block';
                const rel = barra.querySelector('div');
                if (rel) rel.style.width = Math.round((ev.progreso || 0) * 100) + '%';
            }
        });

        const ejecutar = async () => {
            const sel = paper.project.selectedItems;
            const img = sel.find(i => i instanceof paper.Raster);
            if (!img) {
                aviso.textContent = '⚠️ Seleccioná primero una imagen';
                aviso.style.display = 'block';
                setTimeout(() => { aviso.style.display = 'none'; }, 2600);
                return;
            }
            try { await EKKO.BackgroundRemover.quitarFondo(img); }
            catch (_) { /* el aviso ya muestra el error */ }
        };
        if (btn) btn.addEventListener('click', ejecutar);
        if (btnBarra) btnBarra.addEventListener('click', ejecutar);
    });

})(window.EKKO = window.EKKO || {});
