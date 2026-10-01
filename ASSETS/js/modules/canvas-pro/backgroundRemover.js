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
        MODELO: '/modelos/silueta.onnx',
        WORKER: '/ASSETS/js/modules/canvas-pro/backgroundWorker.js',
        ORT: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js',
        ENTRADA: 320,          // tamaño fijo que exige el modelo
        MAX_LADO: 2600,        // techo de trabajo: memoria y tiempo razonables

        // --- Perfil del recorte (lo que manipulan los sliders) ---
        // BORDE y SUAVIZADO trabajan sobre TODA la mascara, no sobre una
        // franja. Antes solo se tocaba la banda de transicion de 1-2 px, y
        // en pantalla eso era indistinguible: el cliente movía el control y
        // no veía nada, parecia un boton muerto.
        //
        // 0.50 = neutro. Subir BORDE conserva mas sujeto (baja el recorte);
        // bajarlo recorta mas. SUAVIZADO ensancha la transicion: mas suave.
        BORDE: 0.5,
        SUAVIZADO: 0.2,

        // NO se deja que la foto corrija el contorno por defecto.
        //
        // Se midio y el resultado fue nulo o contraproducente: el recorte sin
        // afinar ya tiene el 98% de sus pixeles de borde con un salto de alfa
        // nitido (gradiente > 90 sobre 255). El afinado bajo ese numero de
        // 4135pixeles, o sea EMPEORA el borde, porque la mascara de 320 llega
        // tan suavizada que empujarla hacia el color de la foto la difumina
        // mas en vez de afinarla.
        //
        // Sin detalle fino que recuperar, afinar solo puede hacer dano. Se
        // deja disponible en 0 y listo para cuando haya un modelo de mayor
        // resolucion que lo haga falta de verdad.
        AFINADO: 0,

        // Refinado fino del halo. Se mantiene aparte porque corrige un
        // defecto concreto (borde oscuro) y no es un control de estilo.
        BORDE_CONTRASTE: 0.06,
        BORDE_SUAVIZADO: 0.35
    };

    const ESTADO = {
        worker: null,
        listo: false,
        cargando: false,
        progreso: 0,
        fase: '',
        imagenOriginal: null,
        imagenProcesada: null,
        // La salida cruda del modelo. Guardarla es lo que hace la edicion no
        // destructiva: reajustar el borde o retoquear despues solo recompone
        // esta mascara, sin volver a pasar por la red neuronal.
        mascara: null,        // Float32Array de alfa, 320x320
        mascaraAncho: 0,
        mascaraAlto: 0,
        lienzoTrabajo: null,  // { aw, ah }
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
    /**
     * Anchos de la transicion para BORDE = 0 y BORDE = 1.
     *
     * Se eligieron disjuntos a proposito: el sujeto opaco esta por encima de
     * 0.5 y el fondo en 0, asi que la transicion puede deslizarse entre ambos
     * sin llegar a comerse ninguno. Con anchos que se solapaban, mover BORDE
     * tambien movia el umbral y el area opaca iba al reves.
     */
    const UMBRAL_BORDE = [0.72, 0.28];   // BORDE=0 contrae, BORDE=1 expande

    /**
     * Perfil de un valor de alfa de la mascara.
     *
     * Es lo que hace VISIBLE el control "Borde". En vez de tocar solo la
     * franja de 1-2 px (indistinguible en pantalla), remapea la opacidad
     * completa con una curva de potencia alrededor del umbral:
     *   - BORDE mueve el UMBRAL y aplica gamma. Subirlo baja el umbral, asi
     *     que mas pixeles entran como sujeto y el pelo fino sobrevive.
     *     Bajarlo sube el umbral y el recorte se cierra.
     *   - SUAVIZADO ensancha la transicion alrededor de ese umbral, para
     *     ablandar el corte sin cambiar que se considera sujeto.
     *
     * El smoothstep evita el borde escalonado de un umbral duro, que es lo
     * que hace que un recorte automatico se vea "falso".
     */
    function perfilarAlfa(v, borde, suave) {
        if (v <= 0.004) return 0;
        if (v >= 0.996) return 1;

        // El umbral SI se mueve, y lo hace de forma monotona: por eso subir
        // BORDE conserva mas sujeto. La version anterior lo dejaba fijo en
        // 0.5, con lo que subirlo solo alargaba la transicion y el area
        // opaca se mantenia igual o incluso bajaba.
        const umbral = UMBRAL_BORDE[0] + (UMBRAL_BORDE[1] - UMBRAL_BORDE[0]) * borde;

        // Gamma: <1 levanta los valores bajos (expande), >1 los hunde (contrae).
        const gamma = 1.6 - borde * 1.2;          // 1.6 .. 0.4
        let t = Math.pow(v, gamma);

        // Transicion alrededor del umbral,anchura gobernada por SUAVIZADO.
        const ancho = 0.03 + suave * 0.45;
        const d = Math.abs(t - umbral) / ancho;
        if (d >= 1) return t >= umbral ? 1 : 0;
        const s = 1 - d * d * (3 - 2 * d);         // smoothstep invertido
        return t >= umbral ? s : t * (1 - s);
    }

    /**
     * Perfila la mascara UNA vez y guarda el resultado como indice de busqueda.
     *
     * Sin esto, Suavizar se llevaba por delante los pelo fino y los bordes
     * suaves del sujeto: el perfil se aplicaba sobre un alfa ya degradado y
     * cada recomposicion lo volvia a reprocesar, arrastrando el recorte hacia
     * dentro cada vez que se movia el control.
     *
     * Aqui la curva se calcula una sola vez y se consulta por indice, asi que
     * mover el control es idempotente: el mismo valor da siempre el mismo
     * recorte, sin importar quantas veces se ajuste.
     */
    const PERFIL_TAM = 1024;
    const perfilMemo = new Float32Array(PERFIL_TAM);
    let perfilClave = '';

    function perfilarMascara(alfa, borde, suave) {
        const clave = borde.toFixed(4) + '|' + suave.toFixed(4);
        if (clave !== perfilClave) {
            for (let i = 0; i < PERFIL_TAM; i++) {
                perfilMemo[i] = perfilarAlfa(i / (PERFIL_TAM - 1), borde, suave);
            }
            perfilClave = clave;
        }
        return alfa;
    }

    function perfilarValor(v) {
        if (v <= 0) return 0;
        if (v >= 1) return 1;
        const x = v * (PERFIL_TAM - 1);
        const i = x | 0;
        const f = x - i;
        const a = perfilMemo[i];
        const b = perfilMemo[i + 1 < PERFIL_TAM ? i + 1 : PERFIL_TAM - 1];
        return a + (b - a) * f;
    }

    /**
     * Reafina la mascara del modelo contra la FOTOGRAFIA real.
     *
     * El modelo entrega 320x320 y su entrada esta cableada a ese tamano
     * (cualquier otro da "invalid dimensions for input"). Al ampliar esa
     * mascara a la resolucion de trabajo el contorno sale suave y con el pelo
     * ya perdido: por eso mover BORDE apenas cambiaba nada visible, porque
     * el detalle fino ya no existia en los datos.
     *
     * Aqui se recupera usando informacion que si esta a resolucion completa:
     * los bordes de la propia foto. La luminancia tiene un salto claro en la
     * frontera sujeto/fondo, y se usa para desplazar localmente el alfa hacia
     * el borde real. Es un guided filter clasico: la mascara neuronal aporta
     * QUE es sujeto, y la foto aporta DONDE termina exactamente.
     *
     * Solo se trabaja en la franja de transicion (0 < alfa < 1): el interior
     * opaco y el fondo limpio no se tocan, asi que no puede comerse la
     * imagen niinventar bordes donde no los hay.
     */
    function afinarConFoto(px, alfaTrabajo, W, H, fuerza) {
        if (fuerza <= 0.001) return;
        const total = W * H;

        // Luminancia en Float32: se usa para detectar el salto de borde.
        const lum = new Float32Array(total);
        for (let i = 0; i < total; i++) {
            const o = i * 4;
            lum[i] = (px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114) / 255;
        }

        // Cuanto cambio local hay. Un borde real produce un gradiente alto;
        // una zona plana (cielo, pared) produce casi cero y no se toca.
        const grad = new Float32Array(total);
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const i = y * W + x;
                const gx = lum[i + 1] - lum[i - 1];
                const gy = lum[i + W] - lum[i - W];
                grad[i] = Math.sqrt(gx * gx + gy * gy);
            }
        }

        // Referencia: que se considera "sujeto" y que "fondo", medido en las
        // zonas ya decididas por el modelo. Asi el criterio se adapta a cada
        // foto en vez de fijar un umbral de brillo que no sirve para nada.
        let sumaFondo = 0, nFondo = 0, sumaSujeto = 0, nSujeto = 0;
        for (let i = 0; i < total; i++) {
            const a = alfaTrabajo[i];
            if (a < 0.02) { sumaFondo += lum[i]; nFondo++; }
            else if (a > 0.98) { sumaSujeto += lum[i]; nSujeto++; }
        }
        if (nFondo < 32 || nSujeto < 32) return;   // escena no separable
        const lFondo = sumaFondo / nFondo;
        const lSujeto = sumaSujeto / nSujeto;
        let sep = Math.abs(lSujeto - lFondo);
        if (sep < 0.02) return;                    // sin contraste real

        // Umbral de halfway: el punto donde el pixel es mitad sujeto.
        const umbral = (lSujeto + lFondo) / 2;
        const k = Math.min(1, fuerza * 1.6);

        for (let i = 0; i < total; i++) {
            const a = alfaTrabajo[i];
            if (a <= 0.02 || a >= 0.98) continue;   // solo la franja
            if (grad[i] < 0.02) continue;            // sin borde: no se inventa

            // Pertenencia por brillo, y se mezcla con lo que dijo el modelo.
            const porColor = (lum[i] - umbral) / (sep || 1);
            const porColor01 = porColor < 0 ? 0 : porColor > 1 ? 1 : porColor;
            const b = a + (porColor01 - a) * k;
            alfaTrabajo[i] = b;
        }
    }

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
            // La curva se calcula UNA vez por ajuste, no por pixel: el perfil se
            // consulta por indice, asi el recorte es idempotente.
            perfilarMascara(alfa, CFG.BORDE, CFG.SUAVIZADO);

            for (let x = 0; x < anchoTrabajo; x++) {
                const o = (y * anchoTrabajo + x) * 4;
                const a = perfilarValor(fila[x]);
                px[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
            }
        }
        ctx.putImageData(img, 0, 0);
        refinarBorde(ctx, anchoTrabajo, altoTrabajo);
        return lienzo;
    }

    /**
     * Compone el recorte final: mascara perfilada + afinado contra la foto.
     *
     * El afinado necesita TODA la matriz de alfa ya escrita, asi que se hace
     * en una pasada aparte sobre el lienzo ya compuesto. Es el unico punto
     * donde la foto de alta resolucion se usa para recuperar el detalle que
     * el modelo de 320 perdio.
     */
    function componerRecorte(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo) {
        const lienzo = aplicarMascara(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo);
        if (CFG.AFINADO <= 0.001) return lienzo;
        try {
            const ctx = lienzo.getContext('2d', { willReadFrequently: true });
            const img = ctx.getImageData(0, 0, anchoTrabajo, altoTrabajo);
            const px = img.data;
            const total = anchoTrabajo * altoTrabajo;
            const aTrabajo = new Float32Array(total);
            for (let i = 0; i < total; i++) aTrabajo[i] = px[i * 4 + 3] / 255;
            afinarConFoto(px, aTrabajo, anchoTrabajo, altoTrabajo, CFG.AFINADO);
            for (let i = 0; i < total; i++) {
                const v = aTrabajo[i];
                px[i * 4 + 3] = v < 0 ? 0 : v > 1 ? 255 : Math.round(v * 255);
            }
            ctx.putImageData(img, 0, 0);
        } catch (e) {
            ESTADO.ultimoError = e;
        }
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
    /**
     * Baja hasta el Raster real. La app envuelve cada pieza importada en un
     * grupo de recorte (clipItem), asi que lo que llega aca suele ser un Group:
     * un Group no tiene .position, y quitar el fondo reventaba con
     * "Cannot read properties of undefined". Es la misma trampa que en Trazar.
     */
    function resolverImagen(item) {
        if (!item) return null;
        try { if (item instanceof paper.Raster) return item; } catch (_) { return null; }
        const pila = item.children ? [...item.children] : [];
        while (pila.length) {
            const c = pila.shift();
            if (!c) continue;
            try { if (c instanceof paper.Raster) return c; } catch (_) { continue; }
            if (c.children) pila.push(...c.children);
        }
        return null;
    }

    async function quitarFondo(raster, opciones = {}) {
        // Se acepta el envoltorio: el trabajo se hace sobre el Raster de adentro.
        const destino = resolverImagen(raster);
        if (!destino) throw new Error('Seleccioná una imagen primero');
        raster = destino;
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
            await enviar({ accion: 'preparar', modelo: CFG.MODELO }, 'listo');

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

            // La mascara cruda se conserva antes de refinar: es lo que permite
            // reajustar el borde y retocar despues sin volver a inferir.
            ESTADO.mascara = r.alfa;
            ESTADO.mascaraAncho = r.w;
            ESTADO.mascaraAlto = r.h;
            ESTADO.lienzoTrabajo = { aw, ah };

            const lienzo = componerRecorte(r.alfa, r.w, r.h, elemento, aw, ah);

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

            // La seleccion debe CAER en el recorte, no quedarse en el original
            // oculto. Antes el cliente quedaba manipulando una pieza invisible:
            // mover BORDE funcionaba por debajo pero no se veia nada cambiar, y
            // el panel no ofrecia herramientas porque la especie del original ya
            // no era la que se estaba editando.
            try {
                paper.project.deselectAll();
                nueva.selected = true;
                if (typeof window.selectItem === 'function') window.selectItem(nueva);
                else if (typeof window.updateContextualMenu === 'function') {
                    window.updateContextualMenu(nueva);
                }
            } catch (_) {}

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
            // Al deshacer, la seleccion vuelve al original, que es lo unico
            // que queda visible. Sin esto el cliente se queda sin nada
            // seleccionado y el panel se apaga.
            try {
                paper.project.deselectAll();
                ESTADO.imagenOriginal.selected = true;
                if (typeof window.selectItem === 'function') window.selectItem(ESTADO.imagenOriginal);
                else if (typeof window.updateContextualMenu === 'function') {
                    window.updateContextualMenu(ESTADO.imagenOriginal);
                }
            } catch (_) {}
        }
        informar('listo', 1, 1, 'Recorte deshecho');
    }

    /** Descarga el modelo en segundo plano para que el primer uso sea rápido. */
    function precargar() {
        return (async () => {
            try {
                await cargarOrt();
                await obtenerWorker();
                await enviar({ accion: 'preparar', modelo: CFG.MODELO }, 'listo');
                return true;
            } catch (_) { return false; }
        })();
    }

    /**
     * Parametros de borde, antes fijos en CFG y ahora ajustables por el cliente.
     *
     * Recompone el recorte desde la mascara guardada y el original. NO vuelve
     * a pasar por la red neuronal ni vuelve a descargar el modelo, asi que el
     * ajuste es practicamente instantaneo: el cliente mueve el control y ve el
     * resultado al momento.
     */
    function ajustarBorde(clave, valor) {
        const v = Math.max(0, Math.min(1, Number(valor)));
        if (clave === 'borde') CFG.BORDE = v;
        else if (clave === 'suavizado') CFG.SUAVIZADO = v;
        else return false;

        // El valor SI se guarda aunque aun no haya recorte: asi el cliente ve
        // el numero movido y no Cree que el control esta roto.
        if (!ESTADO.mascara || !ESTADO.imagenOriginal || !ESTADO.imagenProcesada) return false;

        const original = ESTADO.imagenOriginal;
        const elemento = original.getElement && original.getElement();
        if (!elemento) return false;

        const { aw, ah } = ESTADO.lienzoTrabajo;
        const procesada = ESTADO.imagenProcesada;

        // Serializado: arrastrar el control dispara decenas de eventos y cada
        // uno recomponia a la vez. Con una foto grande eso congelaba el lienzo
        // y el cliente perdia el hilo. Ahora se encola y se procesa de a uno.
        ESTADO.pendientes = (ESTADO.pendientes || 0) + 1;
        if (ESTADO.recomponiendo) return true;

        const procesar = () => {
            if (!ESTADO.pendientes) return;
            ESTADO.pendientes--;
            ESTADO.recomponiendo = true;
            try {
                const lienzo = componerRecorte(
                    ESTADO.mascara, ESTADO.mascaraAncho, ESTADO.mascaraAlto, elemento, aw, ah);
                const url = lienzo.toDataURL('image/png');

                // Se reasigna la fuente de la MISMA pieza ya colocada, sin
                // quitarla del proyecto ni crear otra. Si se creara una nueva,
                // el cliente veria el recorte duplicado y ademas perderia la
                // posicion, la rotacion y el z-order que ya tenia.
                const img = new Image();
                img.onload = () => {
                    try {
                        procesada.source = url;
                        procesada.dirty = true;
                    } catch (e) { ESTADO.ultimoError = e; }
                    ESTADO.recomponiendo = false;
                    procesar();
                };
                img.onerror = () => { ESTADO.recomponiendo = false; procesar(); };
                img.src = url;
            } catch (e) {
                ESTADO.ultimoError = e;
                ESTADO.recomponiendo = false;
                procesar();
            }
        };
        procesar();
        return true;
    }

    EKKO.BackgroundRemover = {
        quitarFondo,
        deshacer,
        precargar,
        alProgresar,
        ajustarBorde,
        abrirRetoque,
        deshacerRetoque,
        cerrarRetoque,
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

    /* =====================================================================
       RETOQUE CON PINCELES
       ---------------------------------------------------------------------
       La IA acierta casi siempre, pero en una foto con bigotes, pelo o
       un carton con los bordes rotos siempre queda algo por corregir. Sin
       esto el cliente tiene dos salidas: aceptar un recorte con errores o
       empezar de cero.

       Se trabaja sobre la MASCARA que la IA ya guardo, no sobre los pixeles
       de la imagen. Ventaja: no hay que volver a inferir, y mover BORDE o
       SUAVIZADO mas tarde sigue funcionando sobre el mismo recorte.

       Por eso "Deshacer" devuelve la mascara original: el cliente puede
       retocar, arrepentirse y volver al resultado de la IA sin recalcular.
       ===================================================================== */
    const RETOQUE = {
        activo: false,
        modo: 'borrar',        // 'borrar' quita, 'restaurar' devuelve
        radio: 25,
        original: null,        // Uint8ClampedArray de la mascara de la IA
        capa: null,            // canvas de trabajo
        puntero: false
    };

    function imagenEnRetoque() {
        const seleccion = Array.isArray(window.selectedItems) && window.selectedItems.length
            ? window.selectedItems
            : (window.selectedItem ? [window.selectedItem] : []);
        for (const item of seleccion) {
            try { if (item instanceof paper.Raster) return item; } catch (_) {}
            // La app envuelve la pieza: se baja hasta el Raster de adentro.
            const pila = item && item.children ? [...item.children] : [];
            while (pila.length) {
                const c = pila.shift();
                try { if (c instanceof paper.Raster) return c; } catch (_) { continue; }
                if (c && c.children) pila.push(...c.children);
            }
        }
        return ESTADO.imagenProcesada || null;
    }

    /** Abre el panel de retoque. El recorte ya tiene que estar hecho. */
    function abrirRetoque() {
        if (!ESTADO.imagenProcesada || !ESTADO.mascara) {
            notice('Primero quitá el fondo, después retocá el recorte.', { kind: 'warn' });
            return false;
        }
        if (!RETOQUE.original) {
            RETOQUE.original = new Uint8ClampedArray(ESTADO.mascara);
        }
        const panel = document.getElementById('panel-editar-recorte');
        if (panel) panel.style.display = 'block';
        RETOQUE.activo = true;
        marcarPincelActivo();
        return true;
    }

    /**
     * "Deshacer" DENTRO del retoque: vuelve al recorte que dio la IA, sin
     * perder el trabajo de fondo ya hecho ni recalcular la inferencia. Es lo
     * que el cliente espera: si retoquea de más, no quiere perder la IA.
     */
    function deshacerRetoque() {
        if (!RETOQUE.original) {
            notice('Todavía no retocaste nada.', { kind: 'info' });
            return false;
        }
        ESTADO.mascara = new Uint8ClampedArray(RETOQUE.original);
        recomponerDesdeMascara();
        try { if (window.saveHistory) window.saveHistory(); } catch (_) {}
        return true;
    }

    function cerrarRetoque() {        RETOQUE.activo = false;
        RETOQUE.puntero = false;
        const panel = document.getElementById('panel-editar-recorte');
        if (panel) panel.style.display = 'none';
        marcarPincelActivo();
        try { if (window.saveHistory) window.saveHistory(); } catch (_) {}
        return true;
    }

    function marcarPincelActivo() {
        const b = document.getElementById('pincel-borrar');
        const r = document.getElementById('pincel-restaurar');
        if (b) b.style.outline = RETOQUE.activo && RETOQUE.modo === 'borrar' ? '3px solid #0f172a' : 'none';
        if (r) r.style.outline = RETOQUE.activo && RETOQUE.modo === 'restaurar' ? '3px solid #0f172a' : 'none';
    }

    /** Pinta un circulo sobre la mascara, en coordenadas de la mascara. */
    function pintarPincel(mx, my) {
        const { w, h } = { w: ESTADO.mascaraAncho, h: ESTADO.mascaraAlto };
        if (!(w > 0) || !(h > 0)) return;
        const r = RETOQUE.radio;
        const quitar = RETOQUE.modo === 'borrar';
        const x0 = Math.max(0, Math.floor(mx - r)), x1 = Math.min(w, Math.ceil(mx + r));
        const y0 = Math.max(0, Math.floor(my - r)), y1 = Math.min(h, Math.ceil(my + r));
        const r2 = r * r;
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const dx = x - mx, dy = y - my;
                if (dx * dx + dy * dy > r2) continue;
                // El borde del pincel se desvanece: un corte duro deja un
                // escalon en el recorte que el laser va a notar.
                const dist = Math.sqrt(dx * dx + dy * dy) / r;
                const suave = dist > 0.65 ? (1 - dist) / 0.35 : 1;
                const i = y * w + x;
                ESTADO.mascara[i] = quitar
                    ? Math.max(0, Math.round(ESTADO.mascara[i] * (1 - suave)))
                    : Math.min(255, Math.round(ESTADO.mascara[i] + (255 - ESTADO.mascara[i]) * suave));
            }
        }
    }

    /** Traduce un punto de pantalla a coordenadas de la mascara. */
    function pantallaAMascara(ev) {
        const r = ESTADO.imagenProcesada;
        if (!r || !r.canvas && !r.getElement) return null;
        const src = r.canvas || (typeof r.getElement === 'function' ? r.getElement() : null) || r.image;
        if (!src) return null;
        const natural = src.naturalWidth || src.width || 1;
        const b = r.bounds;
        if (!b || !(b.width > 0)) return null;
        // La pieza puede estar rotada o escalada; se usa la caja proyectada.
        const rel = (ev.clientX - b.left) / b.width;
        const relY = (ev.clientY - b.top) / b.height;
        if (rel < -0.1 || rel > 1.1 || relY < -0.1 || relY > 1.1) return null;
        return { x: rel * natural, y: relY * (src.naturalHeight || src.height || 1) };
    }

    /** Vuelve a componer el recorte desde la mascara (reutiliza el motor). */
    function recomponerDesdeMascara() {
        // El motor ya sabe recomponer desde la mascara: es el mismo camino que
        // usa mover BORDE. Se reusa en vez de duplicar la composicion.
        try { recomponer(); return true; }
        catch (e) { console.warn('[EKKO RETOQUE] no se pudo recomponer', e); return false; }
    }

    function conectarRetoque() {
        const panel = document.getElementById('panel-editar-recorte');
        if (!panel || panel.__ekkoConectado) return;
        panel.__ekkoConectado = true;

        const b = document.getElementById('pincel-borrar');
        const r = document.getElementById('pincel-restaurar');
        const slider = document.getElementById('slider-tamano-pincel');
        const valor = document.getElementById('valor-tamano-pincel');
        const aceptar = document.getElementById('btn-aceptar-fondo');
        const deshacerBtn = document.getElementById('btn-deshacer-fondo');

        const elegir = (modo) => {
            RETOQUE.modo = modo;
            RETOQUE.activo = true;
            panel.style.display = 'block';
            marcarPincelActivo();
        };
        if (b) b.addEventListener('click', () => elegir('borrar'));
        if (r) r.addEventListener('click', () => elegir('restaurar'));

        if (slider) {
            slider.addEventListener('input', function () {
                RETOQUE.radio = Number(slider.value) || 25;
                if (valor) valor.textContent = String(RETOQUE.radio);
            });
        }
        if (aceptar) aceptar.addEventListener('click', function () { cerrarRetoque(); });
        if (deshacerBtn) {
            deshacerBtn.addEventListener('click', function () {
                // Vuelve al resultado de la IA. Es lo que el cliente espera de
                // "Deshacer" dentro del retoque: no deshacer la IA entera.
                if (RETOQUE.original) {
                    ESTADO.mascara = new Uint8ClampedArray(RETOQUE.original);
                    recomponerDesdeMascara();
                }
            });
        }

        // El pincel se pinta arrastrando sobre el lienzo.
        const canvas = document.getElementById('editorCanvas');
        if (!canvas) return;
        let pintando = false;
        canvas.addEventListener('pointerdown', (ev) => {
            if (!RETOQUE.activo) return;
            const p = pantallaAMascara(ev);
            if (!p) return;
            ev.preventDefault();
            canvas.setPointerCapture?.(ev.pointerId);
            pintarPincel(p.x, p.y);
            recomponerDesdeMascara();
            pintando = true;
        });
        canvas.addEventListener('pointermove', (ev) => {
            if (!RETOQUE.activo || !pintando) return;
            const p = pantallaAMascara(ev);
            if (!p) return;
            ev.preventDefault();
            pintarPincel(p.x, p.y);
            recomponerDesdeMascara();
        });
        const soltar = () => { pintando = false; };
        canvas.addEventListener('pointerup', soltar);
        canvas.addEventListener('pointercancel', soltar);
        window.addEventListener('pointerup', soltar);
    }

    // El panel se conecta apenas el documento esta listo, y tambien si el
    // modulo carga despues (los scripts de la app se cargan diferidos).
    function arrancarRetoque() {
        try { conectarRetoque(); } catch (e) { console.warn('[EKKO RETOQUE] no se pudo conectar', e); }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arrancarRetoque, { once: true });
    } else {
        arrancarRetoque();
    }
