/* =========================================================================
   EKKO STUDIO — Quitar Fondo con IA (local, en el navegador)
   -------------------------------------------------------------------------
   Nada sale del equipo: el modelo y la imagen se procesan en el navegador.

   Modelo: u2net_human_seg (168 MB, Apache-2.0) entrenado en SILUETAS DE
   PERSONAS. Se descarga una vez y queda en cache (IndexedDB) para siempre.
   Respaldo automatico: MODNet (6,3 MB) y despues el modelo estandar, por si el
   de silueta humana no esta desplegado o la descarga falla.

   El recorte es geometría real: la imagen conserva su transformación
   exacta y la máscara se aplica como canal alfa, nunca como un color.
   ========================================================================= */

(function (EKKO, undefined) {
    'use strict';

    /**
     * Aviso al cliente.
     *
     * Antes se llamaba `notice(...)` a pelo, esperando que existiera un global
     * con ese nombre. No existe: el modulo de avisos se publica como
     * `window.ekkoNotice` y `window.EKKO_NOTICE.notice`. Al no haber tal global,
     * cualquier rama que llegara a un aviso tiraba `ReferenceError: notice is
     * not defined` y el resto de esa accion no se ejecutaba. MEDIDO en el modo
     * Asistido: tocar una zona que no correspondia rompia el toque entero.
     */
    function avisar(mensaje, opciones) {
        const fn = (typeof window !== 'undefined')
            && (window.ekkoNotice || (window.EKKO_NOTICE && window.EKKO_NOTICE.notice));
        if (typeof fn !== 'function') {
            try { console.info('[EKKO RECORTE]', mensaje); } catch (_) {}
            return false;
        }
        // El mismo aviso no se repite en cadena. MEDIDO: en modo Asistido, con
        // "Borrar" activo y el cursor sobre el fondo, el cliente recibia cuatro
        // avisos iguales apilados y eso tapa el lienzo. Uno alcanza: el motivo
        // ya quedo dicho.
        const ahora = Date.now();
        if (avisar._ultimo === mensaje && (ahora - avisar._cuando) < 2500) return false;
        avisar._ultimo = mensaje;
        avisar._cuando = ahora;
        try { fn(mensaje, opciones || {}); return true; }
        catch (_) { return false; }
    }

    const CFG = {
        WORKER: '/ASSETS/js/modules/canvas-pro/backgroundWorker.js',
        ORT: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js',

        // Modelo usado: SILUETA HUMANA (u2net_human_seg).
        //
        // MEDIDO con la foto de referencia del cliente: es el unico que quita
        // el suelo y las sombras entre las piernas. MODNet, que es retrato,
        // deja esa zona como sujeto (alfa 1,0) y de ahi venia el "deja partes
        // del suelo" del reporte.
        //
        // Pesa 168 MB y se descarga UNA vez (queda en IndexedDB). El worker
        // tiene su propia cadena de respaldo: si este no esta desplegado o
        // falla, baja solo a MODNet (6,3 MB) y despues al estandar, sin que el
        // cliente vea ningun error.
        MODELO_CLAVE: 'humano',

        MAX_LADO: 2600,        // techo de trabajo: memoria y tiempo razonables

        // Lado CORTO de la entrada del modelo.
        //
        // MEDIDO: la version anterior de este comentario decia que MODNet tenia
        // la entrada fija en 320 y que cualquier otro tamaño fallaba. Es falso.
        // Probado contra modnet.onnx: 384x1024, 512x768, 640x640 y 288x512
        // devuelven una alfa del MISMO tamaño que la entrada. Solo hay que
        // respetar que los lados sean multiplos de 32 (con 512x900 el grafo
        // falla en un Concat).
        //
        // Por eso la foto ya NO se mete en un cuadrado con marco: se pasa con
        // su aspecto real y este valor es el lado corto. En una foto vertical
        // de 900x1600 eso da 512 de ancho real (antes 288 tras el marco), o
        // sea 1,8 veces mas detalle en el borde con el mismo modelo.
        LADO_ENTRADA: 512,

        // Tope del lado LARGO de la entrada. Evita que una foto muy alargada
        // (un banner, una tira) dispare el tiempo: el detalle extra no se ve
        // pero la factura de CPU si. Debe ser multiplo de 32.
        LADO_MAX: 896,

        // Encuadre de la entrada: cuadrado (lo que espera MODNet) o aspecto
        // real de la foto. Ver `encuadre()` para las dos medidas.
        ENTRADA_CUADRADA: true,

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

        // PERFIL: si se aplica la curva de BORDE/SUAVIZADO sobre el alfa del
        // modelo. MEDIDO: con la curva activa el alfa queda casi binaria
        // (39% en 0 y 55% en 1), o sea que el matiz suave del pelo -que el
        // modelo SI entrega- se convierte en un recorte de tijera. Es
        // justamente lo que el cliente describe como "grotesco".
        PERFIL: false,

        // SOLIDIFICAR: pone el INTERIOR del sujeto en alfa 1 sin tocar la
        // franja del borde. MEDIDO: sin esto el cuerpo queda a 0,7-0,9 y se ve
        // traslucido; con la curva de antes se arreglaba el cuerpo pero se
        // comia el pelo. Esto arregla las dos cosas a la vez.
        SOLIDIFICAR: true,
        SOLIDIFICAR_RADIO: 2,      // px de MASCARA (~6 px de foto en 1600)

        // FILO: ancho de la franja de transicion, en unidades de alfa (0..1),
        // que se aplica al FINAL del recorte.
        //
        // MEDIDO con la foto de referencia: el modelo entrega una franja
        // blanda de ~31 px a 900x1600 y de ~60 px a 3200 px, porque la mascara
        // de 320 se estira con la foto. Esa franja es el "borron" que el
        // cliente ve alrededor del sujeto: no es pelo, es neblina.
        //
        // Aqui se vuelve a decidir el borde con un smoothstep estrecho: el
        // sujeto queda opaco, el fondo transparente y la transicion mide
        // 2-4 px REALES sin importar el tamano de la foto. No inventa detalle
        // (el modelo no lo tiene), pero deja de inventar niebla.
        FILO: 0.08,

        // AFINADO: segunda pasada que solo pica el ultimo pixel del borde para
        // quitar el halo oscuro. Antes se llamaba igual y se confundian: el pelo
        // NO lo arregla el afilado, porque el pelo ya no esta en los datos que
        // el modelo entrego. Se deja en 0, que es lo medido.
        AFINADO: 0,

        // Refinado fino del halo. Se mantiene aparte porque corrige un
        // defecto concreto (borde oscuro) y no es un control de estilo.
        BORDE_CONTRASTE: 0.06,
        BORDE_SUAVIZADO: 0.35,

        // REFINAR_BORDE: pasa la alfa por un filtro guiado que usa la foto como
        // guia, para que la franja de transicion siga el borde REAL de la
        // imagen en vez de una interpolacion recta de la mascara de 512.
        //
        // MEDIDO con la foto de referencia, de punta a punta en la app
        // (IoU NO cambia: 96,4% en todas las filas; lo que se arregla es la
        // calidad del borde, no la forma del recorte):
        //
        //   sin refinar ..... transicion  2,2 px | salto 255 | 3.224 escalones
        //   r=2  eps=0,0004  transicion  8,6 px | salto 158 |    98 escalones
        //   r=4  eps=0,0004  transicion 10,4 px | salto 163 |    87 escalones
        //   r=8  eps=0,0004  transicion 12,7 px | salto 175 |   119 escalones
        //   r=4  eps=0,001   transicion 11,7 px | salto 161 |    66 escalones  <--
        //   r=4  eps=0,01    transicion 17,6 px | salto 124 |     2 escalones
        //
        // Se eligio r=4 / eps=0,001: deja el 2% de los escalones (98% menos
        // serrucho) con una transicion de 11,7 px, que es lo que se ve como
        // borde limpio. Con eps=0,01 el salteo desaparece del todo, pero una
        // transicion de 17,6 px deja el pelo difuminado, que es peor.
        //
        // RADIO y EPS son los dos parametros del filtro. El radio decide sobre
        // que escala se promedia; el eps decide cuanto se respeta el borde real
        // frente a la suavizacion (mas eps = mas suave y menos detalle).
        REFINAR_BORDE: 1,
        REFINAR_RADIO: 4,
        REFINAR_EPS: 0.001
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
        mascara: null,        // Float32Array de alfa. 320x320 del modelo o la de trabajo ya final
        mascaraAncho: 0,
        mascaraAlto: 0,
        // `true` cuando `mascara` YA es la alfa final a resolucion de trabajo:
        // paso por solidificado, perfil y filtro guiado una sola vez. Mientras
        // este en true, recomponer NO vuelve a erosionar ni a filtrar toda la
        // mascara, porque eso cambiaba el contorno entero con cada trazo (ver
        // `mascaraATrabajo`).
        mascaraFinal: false,
        // Alfa final de la IA a resolucion de trabajo. Se guarda al recortar
        // para que, al reabrir el retoque, Deshacer siga teniendo el estado 0
        // sin volver a correr el post-proceso.
        alfaIA: null,
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
                } else if (d.tipo === 'nota') {
                    // Aviso interno del worker (por ejemplo: bajo al modelo
                    // estandar porque el de alta no entra en memoria). Se
                    // registra el lado del modelo como REFERENCIA: la config
                    // manda, porque MODNet acepta cualquier tamaño multiplo de
                    // 32 (medido). Antes esto pisaba la config y no habia forma
                    // de probar otra resolucion.
                    ESTADO.ladoEntrada = d.lado || ESTADO.ladoEntrada;
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
    // Encuadre de la entrada del modelo
    // ----------------------------------------------------------------------
    /**
     * MEDIDO en la foto de referencia (dos niñas sentadas en el suelo), y las
     * dos cosas a la vez, que es lo que obliga a elegir:
     *
     *   cuadrado 512 (288 px utiles de ancho)
     *       -> silueta correcta: quita el suelo y las sombras.
     *       -> borde pobre: la alfa se estira 3,1 veces hasta la foto.
     *
     *   aspecto real 512x896 (512 px utiles de ancho)
     *       -> pelo y contornos notablemente mas nitidos.
     *       -> el modelo se TRAGA el suelo y las sombras (alfa media 0,68
     *          contra 0,33): deja de decidir bien que es fondo.
     *
     * MODNet esta entrenado con recortes CUADRADOS de retrato; sacarlo de ese
     * encuadre afina el borde y arruina la decision de fondo. Por eso el
     * encuadre es configurable y el que se usa es el cuadrado, que es el que
     * respeta la silueta, que es lo primero que pidio el cliente.
     */
    function encuadre(W, H, lado, cuadrado) {
        const base = Math.max(32, Math.round((lado || 512) / 32) * 32);
        if (cuadrado) {
            // Encajar SIN deformar: si el modelo ve un sujeto estirado, el
            // recorte sale torcido.
            const escala = Math.min(base / W, base / H);
            const dw = Math.max(1, Math.round(W * escala));
            const dh = Math.max(1, Math.round(H * escala));
            return {
                w: base, h: base,
                ox: Math.round((base - dw) / 2),
                oy: Math.round((base - dh) / 2),
                dw, dh
            };
        }
        const largo = Math.max(W, H), chico = Math.min(W, H);
        let lg = Math.round((base * largo / chico) / 32) * 32;
        // Tope de memoria/tiempo: por encima de esto el detalle extra no se
        // nota en pantalla pero el tiempo se dispara en equipos sin hilos.
        const tope = Math.max(base, Math.floor(CFG.LADO_MAX / 32) * 32);
        if (lg > tope) lg = tope;
        if (lg < base) lg = base;
        return W >= H
            ? { w: lg, h: base, ox: 0, oy: 0, dw: lg, dh: base }
            : { w: base, h: lg, ox: 0, oy: 0, dw: base, dh: lg };
    }

    function prepararEntrada(imagen, lado) {
        const W = imagen.naturalWidth || imagen.width;
        const H = imagen.naturalHeight || imagen.height;
        if (!W || !H) throw new Error('La imagen no tiene dimensiones');

        const c = encuadre(W, H, lado || 512, CFG.ENTRADA_CUADRADA);
        const lienzo = document.createElement('canvas');
        lienzo.width = c.w; lienzo.height = c.h;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Si sobra marco, NO va negro. MEDIDO con MODNet: con marco negro el
        // recorte cae a IoU 89,5% y el modelo clasifica parte del marco como
        // sujeto (2,6% de pixeles de sobra). Con el color medio de la propia
        // foto sube a 95,5%: el marco se camufla con el fondo real.
        if (c.ox || c.oy) {
            const tonal = document.createElement('canvas');
            tonal.width = 8; tonal.height = 8;
            const tc = tonal.getContext('2d', { willReadFrequently: true });
            tc.drawImage(imagen, 0, 0, 8, 8);
            const d8 = tc.getImageData(0, 0, 8, 8).data;
            let tr = 0, tg = 0, tb = 0;
            for (let i = 0; i < 64; i++) { tr += d8[i * 4]; tg += d8[i * 4 + 1]; tb += d8[i * 4 + 2]; }
            ctx.fillStyle = `rgb(${tr >> 6},${tg >> 6},${tb >> 6})`;
            ctx.fillRect(0, 0, c.w, c.h);
        }
        ctx.drawImage(imagen, c.ox, c.oy, c.dw, c.dh);

        // Se devuelve el rectangulo que ocupa la foto DENTRO de la entrada. Sin
        // el, al volver la mascara habria que suponer que la foto llena todo,
        // y no es cierto: queda corrida y con un marco pegado.
        return {
            pixeles: ctx.getImageData(0, 0, c.w, c.h).data,
            W, H,
            caja: { ox: c.ox, oy: c.oy, dw: c.dw, dh: c.dh },
            lado: { w: c.w, h: c.h }
        };
    }

    /**
     * Filtro de caja (media movil) en dos pasadas, separables.
     *
     * Se usa con sumas encadenadas, asi que es O(n) y no O(n*r): con una foto
     * de 1600x1200 y radio 6 son unos 30 ms, frente a los segundos que seria
     * con la forma ingenua.
     */
    function cajaFiltro(src, dst, w, h, r, tmp) {
        const norm = 1 / (2 * r + 1);
        // Horizontal
        for (let y = 0; y < h; y++) {
            const f = y * w;
            let suma = 0;
            for (let i = -r; i <= r; i++) suma += src[f + Math.min(w - 1, Math.max(0, i))];
            for (let x = 0; x < w; x++) {
                tmp[f + x] = suma * norm;
                const sale = src[f + Math.min(w - 1, Math.max(0, x - r))];
                const entra = src[f + Math.min(w - 1, Math.max(0, x + r + 1))];
                suma += entra - sale;
            }
        }
        // Vertical
        for (let x = 0; x < w; x++) {
            let suma = 0;
            for (let i = -r; i <= r; i++) suma += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
            for (let y = 0; y < h; y++) {
                dst[y * w + x] = suma * norm;
                const sale = tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
                const entra = tmp[Math.min(h - 1, Math.max(0, y + r + 1)) * w + x];
                suma += entra - sale;
            }
        }
    }

    /**
     * Refina la alfa con la FOTOGRAFIA como guia (filtro guiado).
     *
     * El problema que resuelve, MEDIDO: la mascara del modelo llega a 512 y la
     * foto a 1600, asi que se amplía 3,1 veces. Ampliar a pelo produce una
     * franja de transicion de 2,2 px con saltos de 255 entre pixeles vecinos:
     * eso es justo el borde "pixelado" que ve el cliente, porque el recorte no
     * sigue el borde real de la foto sino una interpolacion recta.
     *
     * El filtro guiado corrige la alfa para que su transicion se acomode a los
     * gradientes de la propia imagen: dentro de una region homogenea suaviza
     * (matando el serrucho) y en un borde real lo respeta (recuperando el
     * detalle). Es la tecnica estandar de post-proceso de matte y por eso la
     * usan las herramientas profesionales.
     *
     * @param {ImageData} img  foto ya dibujada en el lienzo de trabajo
     * @param {Float32Array} alfa  alfa actual, una por pixel
     * @param {number} r  radio de la ventana de promediado
     * @param {number} eps  cuanto se respeta el borde real frente a la suavizacion
     */
    function afinarAlfaConFoto(img, alfa, w, h, r, eps) {
        const n = w * h;
        const gris = new Float32Array(n);      // guia: luminancia
        // Cada buffer necesita ser propio: cajaFiltro usa un scratch interno, asi
        // que pasarle el mismo array como entrada y salida pisa valores que
        // todavia no se leyeron y el filtro devuelve basura.
        const scratch = new Float32Array(n);
        const ii = new Float32Array(n);        // I*I
        const ip = new Float32Array(n);        // I*P
        const mediaI = new Float32Array(n);
        const mediaP = new Float32Array(n);
        const varI = new Float32Array(n);
        const covIP = new Float32Array(n);
        const ca = new Float32Array(n);
        const cb = new Float32Array(n);
        const mediaA = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            const o = i * 4;
            // Luminancia en 0..1. Se usa el gris porque al Worklet le importa
            // la estructura, y el color meteria ruido de croma en el pelo.
            gris[i] = (0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]) / 255;
            ii[i] = gris[i] * gris[i];
            ip[i] = gris[i] * alfa[i];
        }

        cajaFiltro(gris, mediaI, w, h, r, scratch);
        cajaFiltro(alfa, mediaP, w, h, r, scratch);
        cajaFiltro(ii, varI, w, h, r, scratch);
        cajaFiltro(ip, covIP, w, h, r, scratch);

        for (let i = 0; i < n; i++) {
            const v = varI[i] - mediaI[i] * mediaI[i];
            const cov = covIP[i] - mediaI[i] * mediaP[i];
            ca[i] = cov / (v + eps);
            cb[i] = mediaP[i] - ca[i] * mediaI[i];
        }
        cajaFiltro(ca, mediaA, w, h, r, scratch);
        cajaFiltro(cb, covIP, w, h, r, scratch);

        for (let i = 0; i < n; i++) {
            const q = mediaA[i] * gris[i] + covIP[i];
            alfa[i] = q < 0 ? 0 : q > 1 ? 1 : q;
        }
        return alfa;
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
    // Umbral de CORTE segun BORDE. El signo importa: un umbral BAJO deja entrar
    // mas pixeles como sujeto (expande) y uno ALTO los expulsa (contrae).
    //   BORDE=0 -> 0.72 (contrae)   BORDE=1 -> 0.28 (expande)   BORDE=0.5 -> 0.5
    //
    // MEDIDO con el modelo anterior (u2net 320): subir BORDE al maximo NO
    // arreglaba nada. IoU contra la foto de referencia iba de 71,4% (BORDE 0.5)
    // a 72,9% (BORDE 1.0) y el sujeto faltante solo bajaba de 7,6% a 6,8%. El
    // control estaba bien calibrado; lo que fallaba era el modelo. Con MODNet el
    // valor por defecto (0.5) da IoU 96,4% con 0,4% de sujeto faltante, y el
    // control queda como ajuste fino.
    const UMBRAL_BORDE = [0.72, 0.28];

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
        // Modo matiz: NO hay curva. BORDE desplaza la opacidad (expande o
        // contrae) y el pelo fino sigue siendo fino: un mechon a 0,3 sigue a
        // 0,3 y no salta a 0 o 1 como hacia la curva.
        if (CFG.PERFIL === false) {
            const d = (CFG.BORDE - 0.5) * 0.6;     // -0.3 .. +0.3
            // El fondo NO se inventa. MEDIDO con clics reales: sin esta linea,
            // Borde al 96% sumaba 0,276 tambien a los pixeles que estaban en 0.
            // En la recomposicion normal `definirFilo` borraba ese velo, pero
            // al confirmar Editar Fondo (`yaFinal`) ese paso no corre: el PNG
            // guardado quedaba con TODO el fondo a alfa 70/255 (un velo gris
            // que el cliente ve como "volvio el fondo").
            if (v <= 0) return 0;
            // El interior opaco se respeta: bajar BORDE cierra el CONTORNO,
            // no deja el cuerpo a 70% (el cliente lo ve como "me come el torso").
            if (d < 0 && v >= 0.999) return v;
            if (d === 0) return v;
            const r = v + d;
            return r <= 0 ? 0 : r >= 1 ? 1 : r;
        }
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

    /**
     * Solidifica el INTERIOR del sujeto sin tocar la franja del borde.
     *
     * MEDIDO con MODNet: el modelo entrega el cuerpo a 0,7-0,9 en varias zonas
     * (las piernas, sobre todo), y eso en pantalla se ve traslucido: se cuela
     * el fondo a traves de la persona. La tentacion es subir el contraste del
     * alfa, y es justo lo que estaba pasando: al endurecerlo se llevaba por
     * delante el pelo, que es donde el alfa ES suave a proposito.
     *
     * La solucion no es de color ni de valor, es de GEOMETRIA: se erosiona la
     * silueta unos pixeles y ahi dentro el alfa pasa a 1. La franja exterior
     * (pelo, contornos) se queda tal cual la entrego el modelo.
     *
     * El radio se mide en pixeles de MASCARA, no de foto: 2 px de 512 son ~6 px
     * en una foto de 1600, que es mas que suficiente para el cuerpo y mucho
     * menos que cualquier mechon de pelo.
     */
    function solidificarInterior(alfa, w, h, radio) {
        const n = w * h;
        const r = Math.max(1, Math.round(radio || 2));

        // 1 = dentro de la silueta (alfa >= 0.5).
        const dentro = new Uint8Array(n);
        for (let i = 0; i < n; i++) dentro[i] = alfa[i] >= 0.5 ? 1 : 0;

        // Erosion separable (min-filtro): si algun vecino del radio esta
        // fuera, el pixel queda fuera. Se hace en dos pasadas O(n*r) con
        // ventana deslizante, pero con r<=3 es despreciable.
        const tmp = new Uint8Array(n);
        for (let y = 0; y < h; y++) {
            const f = y * w;
            for (let x = 0; x < w; x++) {
                let v = 1;
                const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
                for (let k = x0; k <= x1; k++) { if (!dentro[f + k]) { v = 0; break; } }
                tmp[f + x] = v;
            }
        }
        const nucleo = new Uint8Array(n);
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                let v = 1;
                const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
                for (let k = y0; k <= y1; k++) { if (!tmp[k * w + x]) { v = 0; break; } }
                nucleo[y * w + x] = v;
            }
        }

        // Copia con el nucleo a 1. No se toca `alfa` (es la mascara guardada:
        // de ella dependen el pincel y deshacer).
        const salida = new Float32Array(alfa);
        for (let i = 0; i < n; i++) if (nucleo[i]) salida[i] = 1;
        return salida;
    }

    function aplicarMascara(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo, caja, yaFinal) {
        const lienzo = document.createElement('canvas');
        lienzo.width = anchoTrabajo;
        lienzo.height = altoTrabajo;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imagen, 0, 0, anchoTrabajo, altoTrabajo);
        const img = ctx.getImageData(0, 0, anchoTrabajo, altoTrabajo);
        const px = img.data;

        // La foto se metio CENTRADA en un cuadrado (ver prepararEntrada), asi
        // que la mascara cubre el cuadrado entero y la foto solo una parte.
        // Mapear el cuadrado completo sobre la foto corrida el recorte en
        // vertical y superpone el marco de relleno sobre el sujeto. MEDIDO: eso
        // solo, sin tocar el modelo, bajaba el IoU de 95,5% a 69,9%. Se mapea el
        // rectangulo real.
        const c = caja || { ox: 0, oy: 0, dw: mw, dh: mh };
        const escalaX = c.dw / anchoTrabajo;
        const escalaY = c.dh / altoTrabajo;

        // Interior solido + franja del modelo intacta (ver solidificarInterior).
        //
        // SOLO en el primer procesado. MEDIDO con `banco-manual.mjs`: al
        // recomponer despues de CADA trazo, la erosion se aplicaba a toda la
        // mascara y un toque de pincel cambiaba 41.679 px repartidos por todo
        // el contorno aunque solo se hubiera pintado un circulo. El cliente lo
        // describio como "el manual funciona como asistido". Si la mascara ya
        // es la final (`yaFinal`), lo pintado tiene que mandar tal cual.
        let base = (!yaFinal && CFG.SOLIDIFICAR)
            ? solidificarInterior(alfa, mw, mh, CFG.SOLIDIFICAR_RADIO)
            : alfa;

        // Continuo y en 2D. Antes el radio era Math.round(SUAVIZADO*2): TODO lo
        // que estaba por debajo del 25% (incluido el 20% por defecto) valia 0 px,
        // o sea el slider no hacia nada. Y el desenfoque se aplicaba sobre una
        // sola dimension, asi que el corte de arriba/abajo no se suavizaba.
        //
        // Ahora redondea la FORMA del contorno (0-2 px de mascara) y el filo se
        // vuelve a definir despues con `definirFilo`: el resultado es un borde
        // limpio y redondeado, no una mancha difusa.
        if (!yaFinal) {
            const brutoSuave = Math.max(0, (CFG.SUAVIZADO || 0) * 2);
            if (brutoSuave > 0.001 && mw > 1 && mh > 1) {
                const nMaskS = mw * mh;
                const tmpS1 = new Float32Array(nMaskS);
                const tmpS2 = new Float32Array(nMaskS);
                cajaFiltro(base, tmpS1, mw, mh, 1, tmpS2);
                const pasoS1 = tmpS1;
                let desdeS = base, hastaS = pasoS1, kS = Math.min(1, brutoSuave);
                if (brutoSuave > 1.001) {
                    const tmpS3 = new Float32Array(nMaskS);
                    const tmpS4 = new Float32Array(nMaskS);
                    desdeS = pasoS1;
                    cajaFiltro(pasoS1, tmpS3, mw, mh, 1, tmpS4);
                    hastaS = tmpS3;
                    kS = Math.min(1, brutoSuave - 1);
                }
                if (kS >= 0.999) {
                    base = hastaS;
                } else {
                    const salidaS = new Float32Array(nMaskS);
                    for (let iSm = 0; iSm < nMaskS; iSm++) salidaS[iSm] = desdeS[iSm] + (hastaS[iSm] - desdeS[iSm]) * kS;
                    base = salidaS;
                }
            }
        }

        // Muestreo bilineal de la máscara: evita el serrucho de un nearest.
        const fila = new Float32Array(anchoTrabajo);
        for (let y = 0; y < altoTrabajo; y++) {
            const fy = c.oy + y * escalaY;
            const dentroY = fy >= 0 && fy <= mh - 1;
            const fyc = Math.max(0, Math.min(mh - 1, fy));
            const y0 = Math.floor(fyc), y1 = Math.min(mh - 1, y0 + 1), ty = fyc - y0;
            for (let x = 0; x < anchoTrabajo; x++) {
                const fx = c.ox + x * escalaX;
                const dentroX = fx >= 0 && fx <= mw - 1;
                if (!dentroY || !dentroX) { fila[x] = 0; continue; }
                const fxc = Math.max(0, Math.min(mw - 1, fx));
                const x0 = Math.floor(fxc), x1 = Math.min(mw - 1, x0 + 1), tx = fxc - x0;
                const a = base[y0 * mw + x0], b = base[y0 * mw + x1];
                const cc = base[y1 * mw + x0], d = base[y1 * mw + x1];
                fila[x] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
            }
            // La curva se calcula UNA vez por ajuste, no por pixel: el perfil se
            // consulta por indice, asi el recorte es idempotente.
            if (!yaFinal) perfilarMascara(alfa, CFG.BORDE, CFG.SUAVIZADO);

            for (let x = 0; x < anchoTrabajo; x++) {
                const o = (y * anchoTrabajo + x) * 4;
                // Con la mascara ya final (retoque) lo pintado manda tal cual:
                // no se vuelve a aplicar Borde/Suavizar por segunda vez. Antes
                // eso cambiaba todo el contorno al pulsar Listo.
                const a = yaFinal ? fila[x] : perfilarValor(fila[x]);
                px[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
            }
        }

        // Refinado del borde contra la FOTOGRAFIA. Sin esto la transicion queda
        // en 2,2 px con saltos de 255 entre pixeles vecinos (medido), que es el
        // "pixelado" que reportaba el cliente: la alfa viene de 512 y se
        // amplia a 1600, y ampliar a pelo no reproduce el borde real.
        if (!yaFinal && CFG.REFINAR_BORDE > 0.001) {
            const total = anchoTrabajo * altoTrabajo;
            const aTrabajo = new Float32Array(total);
            for (let i = 0; i < total; i++) aTrabajo[i] = px[i * 4 + 3] / 255;
            afinarAlfaConFoto(img, aTrabajo, anchoTrabajo, altoTrabajo,
                Math.max(1, Math.round(CFG.REFINAR_RADIO)), CFG.REFINAR_EPS);
            for (let i = 0; i < total; i++) {
                px[i * 4 + 3] = Math.round(aTrabajo[i] < 0 ? 0 : aTrabajo[i] > 1 ? 255 : aTrabajo[i] * 255);
            }
        }

        ctx.putImageData(img, 0, 0);
        if (!yaFinal) {
            refinarBorde(ctx, anchoTrabajo, altoTrabajo);
            // Ultimo paso, y el que arregla el "borron": la franja blanda del
            // modelo se re-decide con un escalon estrecho. Ver CFG.FILO.
            definirFilo(ctx, anchoTrabajo, altoTrabajo, CFG.FILO);
        }
        return lienzo;
    }

    /**
     * Deja el borde DEFINIDO: opaco por dentro, transparente por fuera y una
     * transicion de pocos pixeles.
     *
     * El modelo entrega el alfa con una rampa muy ancha (medido: 31 px en una
     * foto de 900x1600, 60 px en una de 3200). Esa rampa no es detalle real:
     * es la mascara de 320 estirada. Al grabarla se ve como un halo gris
     * alrededor de todo el sujeto.
     *
     * `ancho` es la franja en unidades de alfa. 0.08 deja ~2-4 px reales, que
     * es lo que necesita un corte limpio sin escalones visibles. Si `ancho` es
     * 0 no se toca nada (se conserva el alfa tal cual).
     */
    function definirFilo(ctx, W, H, ancho) {
        if (!(ancho > 0.001)) return;
        const d = ctx.getImageData(0, 0, W, H);
        const p = d.data;
        const n = W * H;
        const semi = ancho * 0.5;
        const lo = 0.5 - semi;
        const inv = 1 / ancho;
        for (let i = 0; i < n; i++) {
            const o = i * 4 + 3;
            const a = p[o];
            if (a === 0 || a === 255) continue;       // interior y fondo no se tocan
            let t = (a / 255 - lo) * inv;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            p[o] = Math.round(t * t * (3 - 2 * t) * 255);
        }
        ctx.putImageData(d, 0, 0);
    }

    /**
     * Entrega el recorte a la resolucion NATURAL de la foto, sin remuestrear
     * el color.
     *
     * MEDIDO: antes se componia a resolucion de trabajo (techo 2600 px) y se
     * estiraba al tamano natural. En una foto de 3200x2133 eso dejaba solo el
     * 30,33% de los pixeles opacos identicos al original (delta medio 0,83,
     * maximo 10): la foto se veia lavada y el grabado perdia detalle.
     *
     * Aqui el RGB sale de la foto ORIGINAL dibujada a su tamano natural (1:1,
     * sin escalar) y del lienzo de trabajo solo se toma el ALFA. Resultado:
     * color byte a byte igual al original y borde a resolucion completa.
     */
    function componerCalidad(lienzo, imagen, anchoTrabajo, altoTrabajo) {
        const W = imagen.naturalWidth || imagen.width || 0;
        const H = imagen.naturalHeight || imagen.height || 0;
        if (!(W > 0) || !(H > 0)) return lienzo;
        if (W === anchoTrabajo && H === altoTrabajo) return lienzo;
        const fin = document.createElement('canvas');
        fin.width = W;
        fin.height = H;
        const c = fin.getContext('2d');
        c.drawImage(imagen, 0, 0, W, H);            // color original, 1:1
        c.globalCompositeOperation = 'destination-in';
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(lienzo, 0, 0, W, H);            // solo aporta el alfa
        return fin;
    }

    /**
     * Compone el recorte final: mascara perfilada + afinado contra la foto.
     *
     * El afinado necesita TODA la matriz de alfa ya escrita, asi que se hace
     * en una pasada aparte sobre el lienzo ya compuesto. Es el unico punto
     * donde la foto de alta resolucion se usa para recuperar el detalle que
     * el modelo de 320 perdio.
     */
    function componerRecorte(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo, caja, yaFinal) {
        const lienzo = aplicarMascara(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo, caja, yaFinal);
        if (yaFinal) return lienzo;
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
            await enviar({ accion: 'preparar', modeloClave: CFG.MODELO_CLAVE }, 'listo');

            // Lado de entrada: lo decide el MODELO ACTIVO (el worker avisa en
            // `preparar`, incluido el respaldo si tuvo que bajar). El override
            // `__EKKO_LADO_ENTRADA` queda para medir otra resolucion a mano.
            const ladoModelo = window.__EKKO_LADO_ENTRADA || ESTADO.ladoEntrada || CFG.LADO_ENTRADA || 512;
            const entrada = prepararEntrada(elemento, ladoModelo);
            informar('inferir', 0, 0, 'analizando la imagen…');
            const r = await enviar({
                accion: 'inferir',
                pixeles: entrada.pixeles.buffer,
                ancho: entrada.W,
                alto: entrada.H,
                anchoEntrada: entrada.lado.w,
                altoEntrada: entrada.lado.h
            });

            // Limitar el lado largo: por encima de ~2600 px el coste de
            // memoria no aporta nada visible en un producto pequeño.
            const esc = Math.min(1, CFG.MAX_LADO / Math.max(entrada.W, entrada.H));
            const aw = Math.max(1, Math.round(entrada.W * esc));
            const ah = Math.max(1, Math.round(entrada.H * esc));

            // La alfa del modelo deberia venir en 0..1. MEDIDO: en la foto de
            // referencia llegaban 6900 valores fuera de ese rango (negativos y
            // mayores que 1). Un solo valor fuera de rango rompe el filtro
            // guiado, que supone 0..1, y deja manchas y halos: el borde se ve
            // "sucio" sin que se entienda por que. Se acota aqui, una vez.
            let ajustados = 0;
            for (let i = 0; i < r.alfa.length; i++) {
                const v = r.alfa[i];
                if (v !== v) { r.alfa[i] = 0; ajustados++; }        // NaN
                else if (v < 0) { r.alfa[i] = 0; ajustados++; }
                else if (v > 1) { r.alfa[i] = 1; ajustados++; }
            }
            if (ajustados) {
                console.info('[EKKO RECORTE] alfa acotada a 0..1:', ajustados, 'valores');
            }

            // La mascara cruda se conserva antes de refinar: es lo que permite
            // reajustar el borde y retocar despues sin volver a inferir.
            ESTADO.mascara = r.alfa;
            ESTADO.mascaraAncho = r.w;
            ESTADO.mascaraAlto = r.h;
            // Otra foto: la copia "original" del retoque ya no sirve.
            RETOQUE.original = null;
            RETOQUE.capasClave = '';
            RETOQUE.capasSucias = true;
            ESTADO.lienzoTrabajo = { aw, ah };
            // El rectangulo que la foto ocupa dentro de la entrada se guarda para
            // que todo recorte posterior (ajustar el borde, pincel) siga con la
            // misma correspondencia y no se vuelva a correr.
            //
            // Se reescala si el worker devolvio otra resolucion (por ejemplo al
            // caer al modelo de respaldo): la caja esta en unidades de ENTRADA
            // y la mascara puede llegar a otro tamaño.
            const caja = {
                ox: entrada.caja.ox, oy: entrada.caja.oy,
                dw: entrada.caja.dw, dh: entrada.caja.dh
            };
            if (r.w && r.h && (r.w !== entrada.lado.w || r.h !== entrada.lado.h)) {
                caja.dw = r.w; caja.dh = r.h; caja.ox = 0; caja.oy = 0;
            }
            ESTADO.caja = caja;

            const lienzo = componerRecorte(r.alfa, r.w, r.h, elemento, aw, ah, caja, false);

            // La mascara recien guardada es la CRUDA del modelo: la final
            // (solidificada + filtro guiado) se calcula al componer. Se guarda
            // aqui a resolucion de trabajo para que el retoque arranque ya con
            // esa alfa y no tenga que reprocesarla (ver `mascaraATrabajo`).
            ESTADO.mascaraFinal = false;
            ESTADO.alfaIA = null;
            try {
                const aLienzo = lienzo.getContext('2d', { willReadFrequently: true })
                    .getImageData(0, 0, aw, ah).data;
                const alfaIA = new Float32Array(aw * ah);
                for (let i = 0; i < alfaIA.length; i++) alfaIA[i] = aLienzo[i * 4 + 3] / 255;
                ESTADO.alfaIA = alfaIA;
            } catch (_) { /* sin alfaIA el retoque la recalcula al abrir */ }

            // ==================================================================
            // NO SE CREA UNA IMAGEN NUEVA: se le cambia el CONTENIDO a la que ya
            // esta ahi. Este es el cambio de fondo del asunto.
            //
            // MEDIDO, y explica TODO lo que reporto el cliente:
            //
            //   - Una imagen CARGADA, con fondo, se arrastra y se recorta contra
            //     el mockup sin problema, porque la app ya la mete dentro del
            //     grupo de contencion y la recorta sola.
            //   - El recorte de fondo NO lo hacia: era un `paper.Raster` NUEVO,
            //     aparte, en la capa. Al ser otra pieza perdia la contencion, y
            //     por eso se salia del producto y el arrastre fallaba.
            //   - Meter el Raster nuevo dentro del grupo tampoco servia: dentro
            //     del grupo no se arrastra (medido con raton real: (0,0) ->
            //     (0,0)), porque la unidad de seleccion es el wrapper.
            //
            // Cambiar el `source` del MISMO item conserva id, padre,
            // transformacion, escala, rotacion y seleccion. Todo lo que la app
            // ya hace bien con una imagen normal sigue haciendo exactamente
            // igual: se arrastra y se recorta contra el mockup.
            // ==================================================================

            // El lienzo se entrega al tamano NATURAL del elemento original. Si se
            // entregara al tamano de trabajo, al cambiar el source el item
            // cambiaria de tamano y con el se moveria la caja de seleccion.
            //
            // El color NO se estira: `componerCalidad` dibuja la foto original
            // 1:1 y solo le aplica el alfa. Antes se estiraba el lienzo de
            // trabajo y una foto de 3200 px perdia el 70% de sus pixeles.
            const salida = componerCalidad(lienzo, elemento, aw, ah);

            // Se guarda la fuente original para el "deshacer": volver a ponerla
            // devuelve la foto con su fondo, sin tocar nada mas.
            if (!ESTADO.urlOriginal) ESTADO.urlOriginal = elemento.src;
            ESTADO.rasterOriginal = raster;

            // Copia de los pixeles ORIGINALES en un lienzo aparte.
            //
            // MEDIDO, y es la causa de fondo de dos sintomas:
            //   1. `imagenOriginal` e `imagenProcesada` son el MISMO item: el
            //      recorte se hizo cambiando `source` en el sitio, asi que
            //      cuando se relee el "original" ya no queda nada de la foto,
            //      solo el recorte. Por eso la ventana no podia mostrar la zona
            //      quitada desvanecida (no hay pixeles que mostrar) y `Restaurar`
            //      no podia devolver lo que ya se habia borrado de verdad.
            //   2. Sin esta copia no hay de donde sacar los pixeles para
            //      recomponer, y `Deshacer` tampoco tendria sentido.
            // Se hace ANTES del cambio de `source`, que es el ultimo momento en
            // que el item todavia tiene la foto entera.
            try {
                const w0 = elemento.naturalWidth || elemento.width || 0;
                const h0 = elemento.naturalHeight || elemento.height || 0;
                if (w0 > 0 && h0 > 0) {
                    const orig = document.createElement('canvas');
                    orig.width = w0; orig.height = h0;
                    orig.getContext('2d').drawImage(elemento, 0, 0, w0, h0);
                    ESTADO.lienzoOriginal = orig;
                }
            } catch (e) { ESTADO.ultimoError = e; }

            raster.source = salida.toDataURL('image/png');
            if (nomOriginal) raster.name = nomOriginal;

            // Se espera a que la imagen nueva este cargada antes de seguir.
            await new Promise(res => {
                const el = raster.getElement && raster.getElement();
                const listo = el && el.complete && el.width > 0;
                if (listo) return res();
                let hecho = false;
                const fin = () => { if (!hecho) { hecho = true; res(); } };
                raster.onLoad = fin;
                setTimeout(fin, 8000);
            });

            let nueva = raster;
            ESTADO.imagenProcesada = nueva;
            ESTADO.listo = true;

            // La seleccion no se toca: sigue siendo la misma pieza que el
            // cliente ya estaba moviendo.
            try {
                if (typeof window.selectItem === 'function') window.selectItem(nueva);
            } catch (_) {}

            // OJO: ya no se oculta el original, porque AHI MISMO esta el recorte.
            // `nueva === raster`: el item es el mismo, con otro contenido. Dejar
            // `raster.visible = false` dejaba el recorte invisible, que es
            // justo lo que se reportaba antes.

            // Nada que readjustar: el item no se movio, no cambio de padre y no cambio de
            // tamano. La seleccion sigue siendo la misma pieza de antes.

            informar('listo', 1, 1, 'Fondo eliminado');

            // La marca se pone AL FINAL, despues de toda la logica de seleccion.
            //
            // MEDIDO: puesta antes, se perdia. Al cambiar `source` y al correr la
            // sincronizacion de seleccion, `data` volvia a quedar en
            // `{locked, label, rotation}` sin la marca, y entonces:
            //   - el boton "Editar Fondo" no abria nada (su guarda lee la marca)
            //   - la piramide mostraba los dos botones a la vez
            // El contenido de `data` lo tocan varios modulos de la app, asi que
            // la ultima palabra la tiene esta linea, aqui al final.
            if (typeof window.saveHistory === 'function') {
                try { window.saveHistory(); } catch (_) {}
            }

            // ...y la marca va DESPUES de saveHistory, sobre el item que QUEDO en la
            // escena, no sobre la referencia que acá tenemos.
            //
            // MEDIDO: saveHistory rehidrata la escena y deja un item NUEVO
            // (el anterior queda desconectado). Marcando la referencia vieja la
            // marca se perdia y "Editar Fondo" no abria nada. Por eso primero se
            // localiza el item vivo.
            try {
                let vivo = null;
                const sel = window.selectedItem
                    || (Array.isArray(window.selectedItems) ? window.selectedItems[window.selectedItems.length - 1] : null);
                if (sel && sel.className === 'Raster') vivo = sel;
                if (!vivo) {
                    const buscar = it => {
                        if (vivo) return;
                        if (it && it.className === 'Raster' && it.visible !== false && it.project) vivo = it;
                        (it.children || []).forEach(buscar);
                    };
                    (paper.project.layers || []).forEach(l => l.children.forEach(buscar));
                }
                if (!vivo) vivo = raster;
                vivo.data = {
                    ...(vivo.data || {}),
                    quitarFondoIA: true,
                    source: 'user-image'
                };
                ESTADO.rasterOriginal = vivo;
                nueva = vivo;
            } catch (e) { ESTADO.ultimoError = e; }

            return nueva;
        } catch (e) {
            ESTADO.ultimoError = e;
            informar('error', 0, 0, 'Error: ' + (e && e.message || e));
            throw e;
        }
    }

    function deshacer() {
        // El recorte es el MISMO item que la foto original, con otro contenido
        // (ver quitarFondo). Deshacer es volver a poner la fuente que tenia,
        // que es lo unico que hay que cambiar: no se borra ni se oculta nada.
        const r = ESTADO.imagenProcesada || ESTADO.rasterOriginal;
        if (r && ESTADO.urlOriginal) {
            try {
                r.source = ESTADO.urlOriginal;
                r.data = { ...(r.data || {}) };
                delete r.data.quitarFondoIA;
            } catch (_) {}
        }
        ESTADO.imagenProcesada = null;
        ESTADO.rasterOriginal = null;
        ESTADO.urlOriginal = null;
        ESTADO.mascara = null;
        ESTADO.mascaraFinal = false;
        ESTADO.alfaIA = null;
        RETOQUE.capasClave = '';
        RETOQUE.capasSucias = true;
        ESTADO.listo = false;
        if (r) {
            try {
                paper.project.deselectAll();
                if (typeof window.selectItem === 'function') window.selectItem(r);
                else if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(r);
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
                await enviar({ accion: 'preparar', modeloClave: CFG.MODELO_CLAVE }, 'listo');
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
    /**
     * Localiza el item que REALMENTE esta en el lienzo.
     *
     * MEDIDO, y fue un fallo silencioso de tres pasos:
     *   1. `saveHistory()` rehidrata la escena y deja un item NUEVO. La
     *      referencia que guardamos en `ESTADO.imagenProcesada` queda
     *      DESCONECTADA: sigue viva como objeto, pero ya no esta en el proyecto.
     *   2. `ajustarBorde()` escribia el recorte sobre esa referencia muerta.
     *   3. El pincel pintaba la mascara, `recomponerDesdeMascara()` no daba
     *      ningun error, y la foto del mockup no cambiaba NADA. El cliente veia
     *      el panel abierto y ningun efecto, igual que antes.
     *
     * Se busca primero el raster marcado como recorte y, si no, el primero
     * vivo. Nunca se devuelve una referencia que haya quedado suelta.
     */
    function resolverItemVivo() {
        try {
            const sel = window.selectedItem
                || (Array.isArray(window.selectedItems)
                    ? window.selectedItems[window.selectedItems.length - 1] : null);
            if (sel && sel.className === 'Raster' && sel.project) return sel;

            let marcado = null, primero = null;
            const buscar = (it) => {
                if (it && it.className === 'Raster' && it.project) {
                    if (!primero) primero = it;
                    if (!marcado && it.data && it.data.quitarFondoIA) marcado = it;
                }
                (it.children || []).forEach(buscar);
            };
            (paper.project.layers || []).forEach(l => l.children.forEach(buscar));
            return marcado || primero || ESTADO.imagenProcesada || null;
        } catch (_) {
            return ESTADO.imagenProcesada || null;
        }
    }

    function ajustarBorde(clave, valor) {
        const v = Math.max(0, Math.min(1, Number(valor)));
        // 'recomponer' no cambia ningun parametro: es la via para que el retoque
        // refresque el recorte tras alterar la mascara, sin tocar BORDE ni
        // SUAVIZADO. Sin aceptarla aqui, el pincel no tendria forma de
        // actualizar lo que el cliente ve.
        if (clave === 'borde') CFG.BORDE = v;
        else if (clave === 'suavizado') CFG.SUAVIZADO = v;
        else if (clave !== 'recomponer') return false;

        // El valor SI se guarda aunque aun no haya recorte: asi el cliente ve
        // el numero movido y no Cree que el control esta roto.
        if (!ESTADO.mascara || !ESTADO.imagenOriginal || !ESTADO.imagenProcesada) return false;

        const original = ESTADO.imagenOriginal;
        const elemento = original && original.getElement && original.getElement();
        // Se recompone desde la COPIA de la original, no desde el item. El item
        // ya tiene el recorte puesto (el cambio fue en el sitio), asi que leerlo
        // como original no solo no restaura: no puede, los pixeles no estan.
        // Ver la nota de `ESTADO.lienzoOriginal` en `quitarFondo`.
        const fuente = ESTADO.lienzoOriginal || elemento;
        if (!fuente) return false;

        const { aw, ah } = ESTADO.lienzoTrabajo;
        // El destino es el item VIVO, no la referencia guardada: ver
        // `resolverItemVivo`. Ademas se refresca la referencia para que las
        // siguientes llamadas no vuelvan a la pieza suelta.
        const procesada = resolverItemVivo();
        if (!procesada) return false;
        ESTADO.imagenProcesada = procesada;
        ESTADO.rasterOriginal = procesada;

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
                    ESTADO.mascara, ESTADO.mascaraAncho, ESTADO.mascaraAlto, fuente, aw, ah,
                    ESTADO.caja, ESTADO.mascaraFinal);
                // Mismo criterio que al recortar: al mover un slider el color
                // se toma de la foto original, no del lienzo de trabajo.
                const url = componerCalidad(lienzo, fuente, aw, ah).toDataURL('image/png');

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
        elegirPincel,
        modoAsistido,
        modoManual,
        verLoQuitado,
        pintarPincel,
        deshacerRetoque,
        rehacerRetoque,
        cerrarRetoque,
        estadoRetoque: () => ({
            activo: RETOQUE.activo,
            modo: RETOQUE.modo,
            manual: RETOQUE.manual,
            radio: RETOQUE.radio,
            verQuitado: RETOQUE.verQuitado,
            // Zoom de la ventana (1 = encaje; 24 = maximo) y desplazamiento.
            // Se expone para poder MEDIRLO en los bancos, no para la UI.
            zoom: RETOQUE.zoomVentana || 1,
            pan: { ...(RETOQUE.panVentana || { x: 0, y: 0 }) },
            // Historial: `pasos` es cuantos estados hay y `paso` en cual se
            // esta. Deshacer se puede mientras `paso > 0` y Rehacer mientras
            // `paso < pasos - 1`.
            pasos: HISTORIAL.pasos.length + 1,
            paso: HISTORIAL.indice
        }),
        // LECTURA DEL DIAGNOSTICO. SOLO LEE, no escribe nada.
        //
        // Se agrega porque dos veces se perdio tiempo buscando un fallo que era
        // la MEDICION y no el codigo (ver "La leccion de esta sesion" en
        // ESTADO-QUITAR-FONDO.md): sin poder ver la mascara real no se puede
        // saber si un valor fuera de 0..1 existe de verdad o solo se supone.
        // `fueraDeRango` es el contador que delata un pincel o un relleno que
        // escribe 255 en una mascara que va de 0 a 1.
        //
        // NOTA al que siga: este bloque se rompio una vez por una variable
        // declarada como `partiales` y usada como `parciales`. Node y Chromium
        // tiraron ReferenceError y el archivo entero dejaba de cargar, con un
        // error que no senala ninguna de las dos palabras. Si se toca este
        // modulo, correr el chequeo de sintaxis antes de entregar.
        diagnosticoRetoque: () => {
            const m = ESTADO.mascara;
            let min = Infinity;
            let max = -Infinity;
            let fuera = 0;
            let suma = 0;
            let n = 0;
            let blandos = 0;
            if (m && m.length) {
                for (let i = 0; i < m.length; i++) {
                    const v = m[i];
                    if (v < min) min = v;
                    if (v > max) max = v;
                    if (v < 0 || v > 1) fuera++;
                    if (v > 0.004 && v < 0.996) blandos++;
                    suma = suma + v;
                    n = n + 1;
                }
            }
            if (n === 0) { min = 0; max = 0; }
            return {
                mascaraAncho: ESTADO.mascaraAncho,
                mascaraAlto: ESTADO.mascaraAlto,
                min: min,
                max: max,
                fueraDeRango: fuera,
                blandos: blandos,
                promedio: n ? suma / n : 0,
                lienzoTrabajo: ESTADO.lienzoTrabajo ? { ...ESTADO.lienzoTrabajo } : null,
                caja: ESTADO.caja ? { ...ESTADO.caja } : null,
                ventanaCaja: ESTADO.ventanaCaja ? { ...ESTADO.ventanaCaja } : null,
                zoomVentana: RETOQUE.zoomVentana || 1,
                panVentana: { ...(RETOQUE.panVentana || { x: 0, y: 0 }) },
                ultimoError: ESTADO.ultimoError ? String(ESTADO.ultimoError && ESTADO.ultimoError.message || ESTADO.ultimoError) : null
            };
        },
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

    // Zoom de la ventana de edicion, RELATIVO AL ENCAJE (zoom 1 = la foto
    // entra completa). 24x deja cada pixel de la foto en ~15 px de pantalla
    // con la foto de referencia: suficiente para pelo y detalles minimos.
    // Antes el techo era 8x y el cliente no llegaba al detalle.
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 24;

    const RETOQUE = {
        activo: false,
        modo: 'borrar',        // 'borrar' quita, 'restaurar' devuelve
        radio: 25,
        // La copia de la mascara de la IA, para el boton *Deshacer*.
        //
        // MEDIDO, y era un fallo de fondo: era `Uint8ClampedArray`, y esa clase
        // convierte cada valor al ENTERO mas cercano. La mascara va de 0 a 1 en
        // coma flotante, asi que al copiarla todo 0.73 se convertible en 1 y
        // todo 0.21 en 0: la mascara entera quedaba BINARIA.
        //
        // MEDIDO en el banco: tras un Deshacer, los pixeles de alfa parciales
        // (los que hacen el borde suave) pasaban de 7241 a CERO. O sea que
        // deshacia el recorte y de paso devolvia la mascara escalonada, que es
        // justo lo que se estaba trying de arreglar.
        //
        // Ahora es Float32Array, que copia el valor tal cual. El nombre
        // `original` se conserva; lo que cambia es el tipo.
        original: null,        // Float32Array con la mascara de la IA, intacta
        capa: null,            // canvas de trabajo
        puntero: false,

        // --- Modo Asistido / Manual (estructura de "Edit Cutout") ---
        //
        // manual=false: un toque y la zona se elige sola por color (asistido).
        // manual=true:  se pinta con el pincel del tamaño que se elija.
        //
        // Arranca en ASISTIDO: es lo que pidio el cliente y lo que hace
        // PhotoRoom. Manual queda a un clic y con atajo de teclado.
        manual: false,
        // Pintar solo se permite en manual: en asistido el puntero no debe
        // pintar, porque el cliente quiere "marcar" una zona, no hacer un rayado.
        permitirPintado: true,
        // Intensidad con que el modo asistido decide que dos pixeles son "lo
        // mismo". El fondo de una foto suele ser UNIFORME, asi que con una
        // tolerancia alta un solo toque repone el fondo entero de una vez
        // (medido: 673.604 pixeles de golpe), y eso no es retocar una cabeza
        // comida, es deshacer el trabajo del cliente de un saque.
        tolerancia: 62,
        // Radio maximo, en pixulos de la mascara, de lo que un toque alcanza.
        // Es lo que hace que "Asistido" repare una ZONA y no la foto entera.
        // 0.28 del lado menor cubre de sobra una cabeza o un brazo.
        alcance: 143,
        // Colores de la foto a la resolucion de la mascara. Se calculan una
        // sola vez por imagen (la foto no cambia mientras se retoquea) y son
        // lo que permite que el modo asistido mire la imagen y no solo el
        // recorte.
        colorGrid: null,
        colorClave: '',
        // "Ver lo que se quito": capa translucida sobre lo que ya quedo
        // transparente, para poder precisar que restaurar.
        verQuitado: false,
        // Capa CACHEADAS de la vista previa, a resolucion de trabajo:
        //   `capaRecorte` = foto con la alfa aplicada (lo que queda)
        //
        // Antes la vista se armaba de dos maneras: durante el arrastre con la
        // mascara cruda y al soltar con la composicion refinada. Ese cambio de
        // camino hacia que TODO el contorno se redibujara al soltar un punto,
        // y el cliente lo leia como "el manual restaura/borra cosas que no
        // pinte". Con la capa cacheada la vista es SIEMPRE la misma; el
        // pincel solo actualiza su circulo (ver `pintarPincel`).
        //
        // El "velo blanco" que habia antes se elimino: ahora lo quitado se
        // muestra con el tablero de transparencia + un fantasma de la foto
        // original, que es la senal universal de "aca no hay imagen".
        capaRecorte: null,
        capasClave: '',
        capasSucias: true,
        // Zoom PROPIO de la ventana de edicion. No toca `paper.view` a
        // proposito: si tocara el del editor se moveria todo el mockup y se
        // romperia el encuadre. El tamanio del pincel ya se ajusta con su
        // control, asi que la rueda queda libre para el zoom, que es lo que
        // sirve para trabajar detalle fino.
        zoomVentana: 1,
        panVentana: { x: 0, y: 0 },
    };

    /**
     * HISTORIAL del retoque: deshacer y rehacer ACCION POR ACCION.
     *
     * PhotoRoom y Photoshop no deshacen "todo el retoque": retroceden UN paso
     * por vez. EKKO solo tenia un boton que volvia de golpe al recorte de la
     * IA, asi que un trazo mal dado obligaba a perder todos los anteriores.
     *
     * COMO SE GUARDA (esto cambio con el retoque a resolucion de trabajo):
     *
     *   Antes cada paso era una copia completa de la mascara. Con la mascara
     *   de 320 (0,4 MB) eso era barato, pero ahora la mascara es la de trabajo
     *   (900x1600 = 5,8 MB) y 40 copias serian 230 MB: en la maquina del
     *   cliente se comia la memoria. Ahora cada paso guarda SOLO el recuadro
     *   que cambio, con sus valores antes y despues. Un trazo ocupa unos pocos
     *   KB y se conservan los 40 pasos de siempre.
     *
     *   `base` es el estado 0 (la IA ya procesada) y `pasos[k]` es la
     *   transicion del estado k al k+1:
     *     - Deshacer desde j aplica `pasos[j-1].antes`
     *     - Rehacer desde j aplica `pasos[j].despues`
     *   Al pasarse de memoria se tira el paso MAS VIEJO, pero su efecto se
     *   absorbe en `base`, asi que el estado 0 sigue siendo coherente.
     */
    const HISTORIAL = {
        base: null,           // Float32Array: estado 0
        pasos: [],            // [{ x0, y0, w, h, antes, despues }]
        indice: 0,            // estado actual (0 = base)
        ultimo: null,         // copia de la mascara en el estado actual
        LIMITE_PASOS: 40,
        LIMITE_BYTES: 48 * 1024 * 1024,
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

    /**
     * Elige el modo del pincel y deja el retoque activo.
     *
     * Es la UNICA via para cambiar de modo. Antes el puente de comandos y los
     * botones del panel activaban el pincel por separado: el puente ejecutaba
     * un marcado por CSS DESPUES de que este modulo ya lo hubiera hecho, y el
     * segundo marcado pisaba al primero dejando RETOQUE.activo en false. El
     * boton quedaba resaltado pero el lienzo no recibia el trazo.
     */
    function elegirPincel(modo) {
        if (!abrirRetoque()) return false;
        RETOQUE.modo = modo === 'restaurar' ? 'restaurar' : 'borrar';
        RETOQUE.activo = true;
        marcarPincelActivo();
        // Se repinta al cambiar de herramienta para que el cursor y la vista
        // queden sincronizados. El boton de la ventana ya lo hacia, pero este
        // camino (el que usa el panel flotante) NO: al cambiar de pincel desde
        // el panel, la vista se quedaba con el estado anterior hasta el
        // siguiente trazo.
        try { pintarLienzoVentana(); }
        catch (e) {
            ESTADO.ultimoError = e;
            console.warn('[EKKO RETOQUE] no se pudo repintar al elegir pincel:', e);
        }
        return true;
    }

    /**
     * Cambia entre Asistido y Manual desde fuera (lo usa el panel de
     * parametros y el atajo de teclado).
     */
    function ponerModoRetoque(manual) {
        if (!abrirRetoque()) return false;
        RETOQUE.manual = !!manual;
        marcarPincelActivo();
        return true;
    }

    /** Enciende o apaga la capa "ver lo que se quito". */
    function verLoQuitado(encendido) {
        if (!ESTADO.imagenProcesada || !ESTADO.mascara) return false;
        RETOQUE.verQuitado = !!encendido;
        const vq = document.getElementById('ver-quitado');
        if (vq) vq.checked = RETOQUE.verQuitado;
        dibujarCapaQuitado();
        return true;
    }

    /** Abre el panel de retoque. El recorte ya tiene que estar hecho. */
    /**
     * Vista de edicion: la foto ocupa la pantalla y solo quedan las
     * herramientas.
     *
     * Se guarda la vista previa para devolverla exactamente al salir con
     * "Listo": si el cliente cierra sin querer, el editor no queda movido.
     */
    function entrarEnVistaCompleta() {
        if (RETOQUE.vistaGuardada) return;
        try {
            const r = imagenEnRetoque() || ESTADO.imagenProcesada;
            if (!r || !paper.view) return;
            const b = r.getBounds();
            if (!b || !(b.width > 0) || !(b.height > 0)) return;
            if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return;

            RETOQUE.vistaGuardada = {
                center: paper.view.center.clone(),
                zoom: paper.view.zoom
            };
            const vs = paper.view.viewSize;
            const margen = 1.08;                       // aire alrededor
            const z = Math.min(vs.width / (b.width * margen), vs.height / (b.height * margen));
            paper.view.zoom = Math.max(0.05, Math.min(40, z));
            paper.view.center = b.center;
            paper.view.update();
        } catch (e) { ESTADO.ultimoError = e; }
    }

    function salirDeVistaCompleta() {
        const v = RETOQUE.vistaGuardada;
        RETOQUE.vistaGuardada = null;
        if (!v || !paper.view) return;
        try {
            paper.view.center = v.center;
            paper.view.zoom = v.zoom;
            paper.view.update();
        } catch (_) {}
    }

    // Modo Asistido: tocas una zona y se selecciona sola (como en PhotoRoom).
    function modoAsistido() { return ponerModoRetoque(false); }

    // Modo Manual: pintás con el pincel del tamaño que elijas.
    function modoManual() { return ponerModoRetoque(true); }

    /**
     * Zoom de la ventana de edicion.
     *
     * La rueda hace zoom y el arrastre con Alt, con el boton central o con
     * ESPACIO apretado desplaza. El zoom ancla en el punto donde esta el
     * puntero, que es lo que se necesita para detalle fino: uno acerca justo
     * la zona que quiere corregir.
     *
     * No toca `paper.view`: el encuadre del editor y del mockup queda intacto.
     */
    function zoomEn(ev, factor) {
        const cv = document.getElementById('lienzo-editar-fondo');
        const caja = ESTADO.ventanaCaja;
        if (!cv || !caja || !caja.esc) return;
        const pan = RETOQUE.panVentana || { x: 0, y: 0 };
        const antes = RETOQUE.zoomVentana || 1;
        const despues = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, antes * factor));
        if (despues === antes) return;
        const rc = cv.getBoundingClientRect();
        // Punto de la imagen bajo el puntero, para que no se mueva al zoomear.
        const px = (ev.clientX - rc.left - caja.ox) / caja.esc;
        const py = (ev.clientY - rc.top - caja.oy) / caja.esc;
        RETOQUE.zoomVentana = despues;
        pintarLienzoVentana();
        const c2 = ESTADO.ventanaCaja;
        if (c2) {
            RETOQUE.panVentana = {
                x: pan.x + (ev.clientX - rc.left - (c2.ox + px * c2.esc)),
                y: pan.y + (ev.clientY - rc.top - (c2.oy + py * c2.esc))
            };
            pintarLienzoVentana();
        }
        const et = document.getElementById('valor-zoom-ventana');
        if (et) et.textContent = Math.round(RETOQUE.zoomVentana * 100) + '%';
        actualizarCursor();
    }

    /**
     * Clave de validez de las capas cacheadas. Si cambia el tamaño de la
     * mascara o del lienzo, hay que reconstruirlas.
     */
    function claveCapas() {
        const aw = ESTADO.lienzoTrabajo ? ESTADO.lienzoTrabajo.aw : 0;
        const ah = ESTADO.lienzoTrabajo ? ESTADO.lienzoTrabajo.ah : 0;
        return aw + 'x' + ah + '|' + ESTADO.mascaraAncho + 'x' + ESTADO.mascaraAlto +
            '|' + (ESTADO.mascaraFinal ? 'final' : 'modelo');
    }

    /**
     * Reconstruye la capa cacheada de la vista previa a resolucion de trabajo:
     *
     *   capaRecorte = foto con la alfa aplicada (lo que queda)
     *
     * El resto de la vista (tablero de transparencia + fantasma de la foto)
     * se dibuja directo en `pintarLienzoVentana`: no hace falta otra capa.
     *
     * Se recalcula al abrir, al deshacer y al soltar el pincel. Mientras se
     * arrastra NO se reconstruye: `pintarPincel` actualiza solo su circulo.
     */
    function reconstruirCapas() {
        const aw = ESTADO.lienzoTrabajo ? ESTADO.lienzoTrabajo.aw : 0;
        const ah = ESTADO.lienzoTrabajo ? ESTADO.lienzoTrabajo.ah : 0;
        if (!(aw > 0) || !(ah > 0) || !ESTADO.mascara) return false;
        const r = imagenEnRetoque() || ESTADO.imagenProcesada;
        const ref = ESTADO.imagenOriginal || r;
        const src = ESTADO.lienzoOriginal || (ref && ref.getElement && ref.getElement());
        if (!src) return false;
        try {
            RETOQUE.capaRecorte = componerRecorte(
                ESTADO.mascara, ESTADO.mascaraAncho, ESTADO.mascaraAlto,
                src, aw, ah, ESTADO.caja, ESTADO.mascaraFinal);
            RETOQUE.capasClave = claveCapas();
            RETOQUE.capasSucias = false;
            return true;
        } catch (e) {
            ESTADO.ultimoError = e;
            RETOQUE.capaRecorte = null;
            return false;
        }
    }

    /**
     * Actualiza en la capa cacheada SOLO el recuadro que acaba de pintar el
     * pincel. La alfa sale del mismo valor de mascara, asi que sigue
     * coincidiendo con una reconstruccion completa.
     */
    function actualizarCapasEn(x0, y0, x1, y1) {
        const capa = RETOQUE.capaRecorte;
        const w = ESTADO.mascaraAncho, h = ESTADO.mascaraAlto;
        if (!capa || RETOQUE.capasSucias) return;
        if (capa.width !== w || capa.height !== h) return;
        const bw = x1 - x0, bh = y1 - y0;
        if (!(bw > 0) || !(bh > 0)) return;
        try {
            const cctx = capa.getContext('2d', { willReadFrequently: true });

            // El canvas 2D NO conserva el color de los pixeles transparentes:
            // al consultarlos devuelve 0,0,0. Si solo se cambia la alfa al
            // restaurar, lo restaurado sale NEGRO. MEDIDO en `banco-vista`:
            // el punto restaurado daba (0,0,0) en vez del color de la foto.
            //
            // Se repinta el RGB desde la foto ORIGINAL en el recuadro del
            // pincel antes de aplicar la alfa. Es barato (el recuadro es el
            // circulo pintado) y el RGB del recorte es la misma foto: el
            // matteado y el refinado solo tocan la alfa.
            const r = imagenEnRetoque() || ESTADO.imagenProcesada;
            const ref = ESTADO.imagenOriginal || r;
            const src = ESTADO.lienzoOriginal || (ref && ref.getElement && ref.getElement());
            const natW = src && (src.naturalWidth || src.width);
            const natH = src && (src.naturalHeight || src.height);
            if (src && natW > 0 && natH > 0) {
                cctx.drawImage(
                    src,
                    (x0 / w) * natW, (y0 / h) * natH,
                    (bw / w) * natW, (bh / h) * natH,
                    x0, y0, bw, bh);
            }

            const ci = cctx.getImageData(x0, y0, bw, bh);
            for (let y = 0; y < bh; y++) {
                for (let x = 0; x < bw; x++) {
                    const a = ESTADO.mascara[(y0 + y) * w + (x0 + x)];
                    const av = Math.max(0, Math.min(255, Math.round(a * 255)));
                    const o = (y * bw + x) * 4;
                    ci.data[o + 3] = av;
                }
            }
            cctx.putImageData(ci, x0, y0);
        } catch (e) { ESTADO.ultimoError = e; }
    }

    // Tablero de transparencia de la ventana: cuadros claros, como el fondo
    // de Photoshop. Se genera UNA vez y se reutiliza; cada cuadro mide
    // TABLERO_CELDA px de PANTALLA, no de imagen, asi no cambia con el zoom.
    const TABLERO_CELDA = 10;
    const FANTASMA_ALFA = 0.38;
    let tableroCanvas = null;
    let tableroPatron = null;
    let tableroPatronCtx = null;
    function patronTablero(ctx) {
        if (!tableroCanvas) {
            tableroCanvas = document.createElement('canvas');
            tableroCanvas.width = TABLERO_CELDA * 2;
            tableroCanvas.height = TABLERO_CELDA * 2;
            const g = tableroCanvas.getContext('2d');
            g.fillStyle = '#e8ecf1';
            g.fillRect(0, 0, TABLERO_CELDA * 2, TABLERO_CELDA * 2);
            g.fillStyle = '#c6ccd4';
            g.fillRect(0, 0, TABLERO_CELDA, TABLERO_CELDA);
            g.fillRect(TABLERO_CELDA, TABLERO_CELDA, TABLERO_CELDA, TABLERO_CELDA);
        }
        if (!tableroPatron || tableroPatronCtx !== ctx) {
            tableroPatron = ctx.createPattern(tableroCanvas, 'repeat');
            tableroPatronCtx = ctx;
        }
        return tableroPatron;
    }

    /**
     * Dibuja la vista de edicion:
     *   fondo neutro en toda la ventana,
     *   tablero de transparencia + fantasma de la foto SOLO dentro de la foto,
     *   y encima el recorte real.
     *
     * El lienzo es PROPIO de la ventana y no toca `paper.view`: el encuadre
     * del editor y del mockup queda intacto mientras se retoca.
     */
    function pintarLienzoVentana(refinado) {
        const cv = document.getElementById('lienzo-editar-fondo');
        if (!cv) return;
        const ancho = cv.clientWidth, alto = cv.clientHeight;
        if (!(ancho > 0) || !(alto > 0)) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(ancho * dpr) || cv.height !== Math.round(alto * dpr)) {
            cv.width = Math.round(ancho * dpr);
            cv.height = Math.round(alto * dpr);
        }
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Fondo NEUTRO de toda la ventana. Antes se limpiaba y quedaba a la
        // vista el fondo del editor: al hacer zoom se veia NEGRO alrededor de
        // la foto y el cliente lo confundia con "lo que borre". Ahora el
        // unico negro es el marco, siempre igual.
        ctx.fillStyle = '#0e1218';
        ctx.fillRect(0, 0, ancho, alto);

        const r = imagenEnRetoque() || ESTADO.imagenProcesada;
        if (!r) return;

        // Se dibuja la foto ORIGINAL, no el recorte.
        //
        // MEDIDO: con el recorte como fondo de contexto, la zona quitada ya no
        // tiene pixeles (es transparente) y se veia el fondo oscuro de la
        // ventana. El cliente pedia ver la foto con lo quitado DESVANECIDO, no
        // un agujero. Con la original de fondo, lo que quedo fuera se ve
        // apagado y el sujeto, arriba, con su color natural.
        const ref = ESTADO.imagenOriginal || r;
        const src = ESTADO.lienzoOriginal || (ref.getElement && ref.getElement());
        if (!src) return;

        const natW = src.naturalWidth || src.width;
        const natH = src.naturalHeight || src.height;
        const mw = ESTADO.mascaraAncho, mh = ESTADO.mascaraAlto;
        if (!(natW > 0) || !(natH > 0)) return;

        // Encajar la imagen en el lienzo de la ventana, con el ZOOM de la ventana.
        //
        // El zoom es PROPIO de la ventana y NO toca `paper.view`: si tocara el
        // del editor se moveria todo el mockup y se romperia el encuadre que ya
        // anda. MEDIDO: la caja se guarda con la escala y el desplazamiento ya
        // calculados, asi que `pantallaAMascara` y el cursor no necesitan
        // saber nada del zoom.
        const escBase = Math.min(ancho / natW, alto / natH);
        const zoom = RETOQUE.zoomVentana || 1;
        const esc = escBase * zoom;
        const w = natW * esc, h = natH * esc;
        const pan = RETOQUE.panVentana || { x: 0, y: 0 };
        const ox = (ancho - w) / 2 + pan.x;
        const oy = (alto - h) / 2 + pan.y;

        // La caja se calcula ANTES de cualquier salida por la mascara. MEDIDO:
        // con la salida de `!ESTADO.mascara` antes de esta linea, la caja nunca
        // se guardaba, `pantallaAMascara` devolvia null y el pincel NO PINTABA
        // sin dar ningun error. Es el mapeo que necesita el trazo.
        ESTADO.ventanaCaja = { ox, oy, w, h, esc, natW, natH };

        if (!(mw > 0) || !(mh > 0) || !ESTADO.mascara) return;

        // COMO SE MUESTRA LA FOTO (esto es lo que se lee de un vistazo):
        //
        //   - Lo que se MANTIENE: color pleno.
        //   - Lo que se QUITO: TABLERO DE TRANSPARENCIA (cuadros) + un
        //     fantasma tenue de la foto original.
        //
        // El tablero es la senal universal de "aca no hay imagen" (PhotoRoom,
        // Photoshop). El fantasma deja ver que hay debajo para poder
        // restaurar sin adivinar. Antes se lavaba la zona quitada con blanco:
        // eso producia un parche blanco, y cuando el zoom dejaba ver el fondo
        // de la ventana aparecia negro. Ninguno de los dos decia "transparente".
        // Solo se dibuja la parte VISIBLE de la foto.
        //
        // MEDIDO: a 24x el rectangulo de destino mide ~13500x24000 px. Con
        // `drawImage(src, ox, oy, w, h)` el navegador recorria la foto entera
        // en cada movimiento y el paneo costaba 49 ms (20 fps). Recortando al
        // area visible, el destino baja a 1332x1000 y el paneo queda fluido.
        const dx0 = Math.max(ox, 0);
        const dy0 = Math.max(oy, 0);
        const dx1 = Math.min(ox + w, ancho);
        const dy1 = Math.min(oy + h, alto);
        if (!(dx1 > dx0) || !(dy1 > dy0)) return;   // la foto quedo fuera
        const dw = dx1 - dx0, dh = dy1 - dy0;
        const sx = ((dx0 - ox) / w) * natW;
        const sy = ((dy0 - oy) / h) * natH;
        const sw = (dw / w) * natW;
        const sh = (dh / h) * natH;

        ctx.save();
        ctx.beginPath();
        ctx.rect(ox, oy, w, h);
        ctx.clip();

        // 1) Tablero de transparencia, solo dentro de la foto. Los cuadros
        //    miden siempre lo mismo en pantalla, aunque se haga zoom.
        ctx.fillStyle = patronTablero(ctx);
        ctx.fillRect(dx0, dy0, dw, dh);

        // 2) Fantasma de la foto ORIGINAL. Va siempre debajo del recorte: en
        //    el sujeto opaco no se ve (lo tapa) y en lo quitado deja ver el
        //    pelo/fondo que se puede devolver.
        ctx.globalAlpha = FANTASMA_ALFA;
        ctx.drawImage(src, sx, sy, sw, sh, dx0, dy0, dw, dh);
        ctx.globalAlpha = 1;

        // 3) El recorte real, con su alfa. Es la unica capa que se cachea, a
        //    resolucion de trabajo, para que el arrastre y el "soltar"
        //    muestren exactamente lo mismo.
        const cacheValida = !refinado
            && RETOQUE.capaRecorte
            && !RETOQUE.capasSucias
            && RETOQUE.capasClave === claveCapas();
        if (!cacheValida && !reconstruirCapas()) { ctx.restore(); return; }
        const capa = RETOQUE.capaRecorte;
        if (!capa) { ctx.restore(); return; }
        // La capa de trabajo ocupa el MISMO rectangulo que la foto, pero a su
        // propia resolucion: se recorta con la misma proporcion.
        const csx = (sx / natW) * capa.width;
        const csy = (sy / natH) * capa.height;
        const csw = (sw / natW) * capa.width;
        const csh = (sh / natH) * capa.height;
        ctx.drawImage(capa, csx, csy, csw, csh, dx0, dy0, dw, dh);

        ctx.restore();

        // Borde fino: separa la foto del fondo neutro cuando se hace zoom.
        ctx.strokeStyle = 'rgba(255,255,255,.14)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ox + 0.5, oy + 0.5, w - 1, h - 1);

        ESTADO.ventanaCaja = { ox, oy, w, h, esc, natW, natH };
    }

    /**
     * "Listo": aplica lo editado a la imagen del mockup y cierra la ventana.
     *
     * La ventana edita la MASCARA. Al confirmar se recompone el contenido del
     * MISMO item que ya esta dentro del mockup: mismo id, mismo padre, misma
     * transformacion. Por eso el recorte no se mueve nunca del producto y el
     * arrastre sigue funcionando (ver la nota de arquitectura en quitarFondo).
     */
    function confirmarEdicion() {
        try {
            recomponerDesdeMascara();
        } catch (e) {
            ESTADO.ultimoError = e;
        }
        cerrarRetoque();
        // NO se guarda historia aqui a proposito: se conserva lo que hacia antes
        // (cerrar y ya). `quitarFondo` guarda su propio historial, asi que el
        // recorte por IA sigue siendo un paso de undo, y dentro de la ventana
        // el deshacer del recorte lo da el boton `Deshacer`, que es lo que el
        // cliente espera de el. Guardar ademas rehidrata la escena, y dentro de
        // una ventana que esta por cerrarse conviene no tocar la escena.
        return true;
    }

    /**
     * Lleva la mascara del modelo a la RESOLUCION DE TRABAJO, ya procesada.
     *
     * Por que: el pincel escribia sobre la grilla del modelo (320x320) y la
     * ventana la estiraba a 900x1600. A zoom alto cada pixel de mascara son
     * ~7 px de pantalla, y el trazo se ve escalonado: es el "muy pixelado" que
     * reporto el cliente. Ademas, al recomponer se volvian a aplicar la
     * erosion de `solidificarInterior` y el filtro guiado a TODA la mascara en
     * cada toque, de modo que pintar un punto cambiaba el contorno entero.
     *
     * Solucion: se corre el post-proceso UNA vez (el mismo que produce el
     * recorte final) y se conserva su alfa a tamano de trabajo. Desde ahi:
     *   - el pincel pinta pixel a pixel de la foto (sin escalera)
     *   - recomponer no erosiona ni filtra: lo unico que cambia es lo pintado
     *
     * El estado 0 del historial es la mascara ACTUAL ya procesada (no
     * `alfaIA`): Deshacer devuelve al recorte que el cliente ve en el lienzo,
     * con el perfil Borde/Suavizar actual. Usar `alfaIA` creaba un paso
     * fantasma al abrir con los sliders movidos y ademas el paso 0 revertia
     * el ajuste a 50/20.
     */
    function mascaraATrabajo() {
        const aw = ESTADO.lienzoTrabajo ? ESTADO.lienzoTrabajo.aw : 0;
        const ah = ESTADO.lienzoTrabajo ? ESTADO.lienzoTrabajo.ah : 0;
        if (!ESTADO.mascara || !(aw > 0) || !(ah > 0)) return false;
        if (ESTADO.mascaraFinal && ESTADO.mascaraAncho === aw && ESTADO.mascaraAlto === ah) {
            return true;
        }

        // MEDIDO con clics reales: el camino rapido copiaba `alfaIA`, que es la
        // alfa del perfil con el que se recorto (Borde/Suavizar de ese momento).
        // Si el cliente movia los sliders, Editar Fondo abria con el perfil
        // VIEJO y al pulsar Listo el recorte cambiaba solo (195.281 opacos
        // volvian a 181.910). Ahora se reconstruye con el perfil ACTUAL:
        // `componerRecorte(..., false)` es exactamente lo que se ve en el lienzo.
        //
        // Si no hay alfa guardada (por ejemplo, se reabrio una sesion vieja),
        // se procesa ahora. Es el unico momento caro; despues todo es local.
        const fuente = ESTADO.lienzoOriginal ||
            (ESTADO.imagenOriginal && ESTADO.imagenOriginal.getElement &&
                ESTADO.imagenOriginal.getElement());
        if (!fuente) return false;
        try {
            const lienzo = componerRecorte(
                ESTADO.mascara, ESTADO.mascaraAncho, ESTADO.mascaraAlto,
                fuente, aw, ah, ESTADO.caja, false);
            const px = lienzo.getContext('2d', { willReadFrequently: true })
                .getImageData(0, 0, aw, ah).data;
            const alfa = new Float32Array(aw * ah);
            for (let i = 0; i < alfa.length; i++) alfa[i] = px[i * 4 + 3] / 255;
            ESTADO.mascara = alfa;
            ESTADO.mascaraAncho = aw;
            ESTADO.mascaraAlto = ah;
            ESTADO.caja = { ox: 0, oy: 0, dw: aw, dh: ah };
            ESTADO.mascaraFinal = true;
        } catch (e) {
            ESTADO.ultimoError = e;
            return false;
        }
        return true;
    }

    function abrirRetoque() {
        const ventana = document.getElementById('ventana-editar-fondo');
        // Si YA esta abierto, no se reinicia NADA: ni zoom, ni paneo, ni
        // historial. MEDIDO: `elegirPincel()` (el camino del panel flotante)
        // llamaba a esta funcion y al cambiar de herramienta se perdia el
        // zoom y el paneo, el historial volvia al recorte de la IA y el
        // cartel quedaba en 2400% mientras la foto volvia al encaje.
        if (RETOQUE.activo && ventana && ventana.classList.contains('vf-visible')) return true;
        // El zoom de la ventana arranca limpio en cada apertura.
        RETOQUE.zoomVentana = 1;
        RETOQUE.panVentana = { x: 0, y: 0 };
        const etZoom = document.getElementById('valor-zoom-ventana');
        if (etZoom) etZoom.textContent = '100%';
        if (!ESTADO.imagenProcesada || !ESTADO.mascara) {
            avisar('Primero quitá el fondo, después retocá el recorte.', { kind: 'warn' });
            return false;
        }
        if (!RETOQUE.original) {
            // Float32Array y NO Uint8ClampedArray: ver la nota de
            // `RETOQUE.original`. Con Uint8ClampedArray la copia redondeaba la
            // mascara entera a 0/1.
            RETOQUE.original = new Float32Array(ESTADO.mascara);
        }
        // La mascara de retoque pasa a la resolucion de trabajo, ya procesada:
        // el pincel deja de pintar sobre la grilla de 320 (que se veia
        // escalonada) y recomponer deja de alterar el contorno entero.
        if (!mascaraATrabajo()) {
            avisar('No se pudo preparar la máscara para editar.', { kind: 'error' });
            return false;
        }
        // El historial arranca en el recorte de la IA: Deshacer y Rehacer
        // trabajan sobre este retoque, no sobre la escena del editor.
        historialReiniciar();
        if (!ventana) {
            avisar('No se encontró la ventana de editar.', { kind: 'error' });
            return false;
        }
        RETOQUE.activo = true;

        // La barra REEMPLAZA a la contextual: ocupa su misma banda y se queda
        // sola. Antes convivan las dos con los mismos botones duplicados, y la
        // contextual seguia apareciendo encima.
        // La ventana es a pantalla completa: lienzo a la izquierda, panel a la
        // derecha. Reemplaza por completo a la barra contextual, asi que nunca
        // hay dos superficies con los mismos botones a la vez.
        ventana.style.display = 'grid';
        ventana.classList.add('vf-visible');

        // Vista de edicion: la foto a pantalla completa y solo las
        // herramientas. Es lo que pidio el cliente; antes seguian viéndose el
        // producto entero y los paneles de al lado, que para retocar el pelo
        // sobran y estorban.
        document.body.classList.add('ekko-modo-retoque');
        entrarEnVistaCompleta();

        // La tira de parametros se cierra. MEDIDO en el navegador: al pasar
        // de "Quitar Fondo" a "Editar Fondo" se quedaban las dos barras a la
        // vez, la de parametros abajo y la de edicion arriba.
        //
        // El cierre va en un turno siguiente a proposito: el boton dispara su
        // cadena de manejadores DESPUES de este retorno, y si se cierra ahora
        // el mismo boton la vuelve a abrir. Cerrando en el siguiente turno se
        // gana esa carrera.
        try {
            setTimeout(() => {
                try {
                    if (typeof window.EKKO_PARAMETROS?.cerrar === 'function') {
                        window.EKKO_PARAMETROS.cerrar();
                    }
                } catch (_) {}
            }, 0);
        } catch (_) {}

        // La transparencia de lo quitado se ENCIENDE SOLA al entrar a editar.
        // Antes era un interruptor que el cliente tenia que encontrar y
        // activar, y no era lo pedido: lo que quiere ver es QUE quito la
        // automatica sin tener que pedirlo.
        RETOQUE.verQuitado = true;
        const vq = document.getElementById('ver-quitado');
        if (vq) vq.setAttribute('aria-pressed', 'true');

        marcarPincelActivo();
        try { pintarLienzoVentana(); }
        catch (e) { ESTADO.ultimoError = e; try { console.warn('[EKKO RECORTE] no se pudo pintar la ventana:', e); } catch (_) {} }
        return true;
    }

    /**
     * Recorta el rectangulo que cambio entre dos mascaras.
     *
     * Devuelve `{ x0, y0, w, h, antes, despues }` con SOLO ese recuadro, o
     * `null` si no cambio ningun pixel. Es lo que mantiene barato el historial
     * a resolucion de trabajo: un trazo guarda su circulo, no 1,4 M de pixeles.
     */
    function historialRegion(antes, despues) {
        const w = ESTADO.mascaraAncho, h = ESTADO.mascaraAlto;
        if (!antes || !despues || antes.length !== despues.length) return null;
        if (antes.length !== w * h) return null;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
            const f = y * w;
            for (let x = 0; x < w; x++) {
                if (antes[f + x] === despues[f + x]) continue;
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
        if (x1 < 0) return null;
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        const a = new Float32Array(cw * ch);
        const d = new Float32Array(cw * ch);
        for (let y = 0; y < ch; y++) {
            const src = (y0 + y) * w + x0;
            a.set(antes.subarray(src, src + cw), y * cw);
            d.set(despues.subarray(src, src + cw), y * cw);
        }
        return { x0, y0, w: cw, h: ch, antes: a, despues: d };
    }

    function historialBytes() {
        let b = HISTORIAL.base ? HISTORIAL.base.byteLength : 0;
        for (const p of HISTORIAL.pasos) b += p.antes.byteLength + p.despues.byteLength;
        return b;
    }

    /**
     * Tira el paso mas viejo SIN perder el estado 0: su efecto se aplica a
     * `base`, que pasa a representar el estado siguiente. Asi se puede seguir
     * deshaciendo hasta el nuevo estado 0 sin guardar copias completas.
     */
    function historialAbsorberPrimero() {
        if (!HISTORIAL.pasos.length || HISTORIAL.indice <= 0) return;
        const p = HISTORIAL.pasos.shift();
        const w = ESTADO.mascaraAncho;
        for (let y = 0; y < p.h; y++) {
            HISTORIAL.base.set(
                p.despues.subarray(y * p.w, y * p.w + p.w),
                (p.y0 + y) * w + p.x0);
        }
        HISTORIAL.indice -= 1;
    }

    /**
     * Deja el historial en el estado actual.
     *
     * El paso 0 es la mascara con la que se ABRE la ventana: el recorte
     * ACTUAL, ya con el perfil Borde/Suavizar que el cliente ve en el lienzo.
     * No se usa `alfaIA` porque es el perfil del momento de Quitar Fondo: si
     * despues movio los sliders, Deshacer lo devolveria a un recorte que ya
     * no ve. Al abrir, base y actual son la misma mascara, asi que no hay
     * paso inicial (pasos = 0, paso = 0).
     */
    function historialReiniciar() {
        HISTORIAL.pasos = [];
        HISTORIAL.indice = 0;
        HISTORIAL.base = null;
        HISTORIAL.ultimo = null;
        if (!ESTADO.mascara || !(ESTADO.mascara.length > 0)) return;
        HISTORIAL.base = new Float32Array(ESTADO.mascara);
        HISTORIAL.ultimo = new Float32Array(ESTADO.mascara);
        actualizarBotonesRetoque();
    }

    /**
     * Guarda el estado ACTUAL como un paso nuevo. Se llama al SOLTAR el pincel
     * (un trazo = un paso) y al aplicar una zona en Asistido (un toque = un paso).
     */
    function historialAnotar() {
        if (!ESTADO.mascara || !(ESTADO.mascara.length > 0)) return;
        if (!HISTORIAL.base) {
            HISTORIAL.base = new Float32Array(ESTADO.mascara);
            HISTORIAL.ultimo = new Float32Array(ESTADO.mascara);
            HISTORIAL.pasos = [];
            HISTORIAL.indice = 0;
            actualizarBotonesRetoque();
            return;
        }
        // Si se habia deshecho, lo que estaba "adelante" se descarta: no se
        // puede rehacer sobre una rama nueva (es el comportamiento de Photoshop).
        if (HISTORIAL.indice < HISTORIAL.pasos.length) {
            HISTORIAL.pasos.length = HISTORIAL.indice;
        }
        const paso = historialRegion(HISTORIAL.ultimo, ESTADO.mascara);
        if (!paso) {
            // El trazo no cambio ningun pixel (por ejemplo un toque fuera del
            // sujeto): no se anota un paso vacio.
            actualizarBotonesRetoque();
            return;
        }
        HISTORIAL.pasos.push(paso);
        HISTORIAL.indice = HISTORIAL.pasos.length;
        HISTORIAL.ultimo.set(ESTADO.mascara);
        // Recorte por memoria: se tiran los MAS VIEJOS, nunca el actual y
        // nunca el estado 0.
        while (HISTORIAL.pasos.length > 1
            && (HISTORIAL.pasos.length + 1 > HISTORIAL.LIMITE_PASOS
                || historialBytes() > HISTORIAL.LIMITE_BYTES)) {
            historialAbsorberPrimero();
        }
        actualizarBotonesRetoque();
    }

    /** Lleva la mascara al paso `i` del historial y repinta. */
    function historialIr(i) {
        if (!ESTADO.mascara || !HISTORIAL.base) return false;
        if (i < 0 || i > HISTORIAL.pasos.length) return false;
        if (i === HISTORIAL.indice) return false;
        const w = ESTADO.mascaraAncho;
        const escribir = (vals, paso) => {
            for (let y = 0; y < paso.h; y++) {
                ESTADO.mascara.set(
                    vals.subarray(y * paso.w, y * paso.w + paso.w),
                    (paso.y0 + y) * w + paso.x0);
            }
        };
        if (i < HISTORIAL.indice) {
            for (let k = HISTORIAL.indice; k > i; k--) {
                escribir(HISTORIAL.pasos[k - 1].antes, HISTORIAL.pasos[k - 1]);
            }
            if (i === 0) ESTADO.mascara.set(HISTORIAL.base);
        } else {
            for (let k = HISTORIAL.indice; k < i; k++) {
                escribir(HISTORIAL.pasos[k].despues, HISTORIAL.pasos[k]);
            }
        }
        HISTORIAL.indice = i;
        HISTORIAL.ultimo.set(ESTADO.mascara);
        recomponerDesdeMascara();
        dibujarCapaQuitado();
        try { pintarLienzoVentana(true); } catch (_) {}
        actualizarBotonesRetoque();
        try { if (window.saveHistory) window.saveHistory(); } catch (_) {}
        return true;
    }

    /** Pinta el estado de los botones: apagados cuando no queda nada que hacer. */
    function actualizarBotonesRetoque() {
        const d = document.getElementById('btn-deshacer-fondo');
        const r = document.getElementById('btn-rehacer-fondo');
        if (d) d.disabled = !(HISTORIAL.indice > 0);
        if (r) r.disabled = !(HISTORIAL.indice < HISTORIAL.pasos.length);
    }

    /**
     * "Deshacer" DENTRO del retoque: retrocede UN paso, como en PhotoRoom y
     * Photoshop. Cuando se agotan los pasos llega al recorte de la IA, que es
     * lo que este boton hacia antes; no se pierde el trabajo de fondo ni se
     * vuelve a correr la inferencia.
     */
    function deshacerRetoque() {
        if (!HISTORIAL.base) {
            avisar('Todavía no retocaste nada.', { kind: 'info' });
            return false;
        }
        if (HISTORIAL.indice <= 0) {
            avisar('No hay más pasos para deshacer.', { kind: 'info' });
            return false;
        }
        return historialIr(HISTORIAL.indice - 1);
    }

    /** "Rehacer": vuelve al paso que se acaba de deshacer. */
    function rehacerRetoque() {
        if (!HISTORIAL.base) return false;
        if (HISTORIAL.indice >= HISTORIAL.pasos.length) {
            avisar('No hay nada para rehacer.', { kind: 'info' });
            return false;
        }
        return historialIr(HISTORIAL.indice + 1);
    }

    function cerrarRetoque() {
        RETOQUE.activo = false;
        RETOQUE.puntero = false;
        RETOQUE.verQuitado = false;
        // Al abrir la ventana el lienzo se acerca al recorte (entrarEnVistaCompleta).
        // Faltaba volver: el cliente cerraba Editar Fondo y el editor quedaba
        // con un zoom que no eligio. Se devuelve la vista exacta que tenia.
        salirDeVistaCompleta();
        const vf = document.getElementById('ventana-editar-fondo');
        if (vf) { vf.style.display = 'none'; vf.classList.remove('vf-visible'); }
        document.body.classList.remove('ekko-modo-retoque');
        const vq = document.getElementById('ver-quitado');
        if (vq) { vq.setAttribute('aria-pressed', 'false'); vq.classList.remove('is-activo'); }
        const capa = document.getElementById('capa-quitado');
        if (capa) capa.style.display = 'none';
        const cur = document.getElementById('cursor-pincel');
        if (cur) { cur.style.display = 'none'; cur.dataset.visible = ''; }
        marcarPincelActivo();
        try { if (window.saveHistory) window.saveHistory(); } catch (_) {}
        return true;
    }

    /**
     * Marca que herramienta esta activa.
     *
     * Antes se hacia con `outline: 3px solid #0f172a`: un contorno azul casi
     * negro sobre una interfaz oscura, que de noche no se ve. Y el color del
     * boton no cambiaba, asi que la unica senal de cual brush estaba activo
     * era ese contorno casi invisible. Era exactamente la duda que el cliente
     * planteo: "no puedo identificar cual borra o cual restaura".
     *
     * Ahora el estado se marca en la clase `is-activo` y en `aria-pressed`, y
     * el CSS pinta el boton entero (fondo y borde tintados por herramienta) con
     * el MISMO color que el cursor sobre el lienzo.
     */
    function marcarPincelActivo() {
        const par = [
            [document.getElementById('pincel-borrar'), 'borrar'],
            [document.getElementById('pincel-restaurar'), 'restaurar']
        ];
        for (const [el, clave] of par) {
            if (!el) continue;
            const on = RETOQUE.activo && RETOQUE.modo === clave;
            el.classList.toggle('is-activo', on);
            el.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        // El modo (asistido/manual) tambien es estado visible, por el mismo
        // motivo: si no se ve, el cliente no sabe por que el toque no pintó.
        const ma = document.getElementById('modo-asistido');
        const mm = document.getElementById('modo-manual');
        if (ma) { ma.classList.toggle('is-activo', !RETOQUE.manual); ma.setAttribute('aria-pressed', RETOQUE.manual ? 'false' : 'true'); }
        if (mm) { mm.classList.toggle('is-activo', RETOQUE.manual); mm.setAttribute('aria-pressed', RETOQUE.manual ? 'true' : 'false'); }

        // Mientras se edita el recorte, la tira de parametros flotante deja de
        // recibir el puntero: esta `position: fixed` y se monta encima del
        // lienzo, con lo que se comia cada trazo del pincel. MEDIDO: sin esto
        // `pintarPincel` se llamaba 0 veces y el pincel no hacia nada.
        const tira = document.querySelector('.ekko-param-surface');
        if (tira) tira.classList.toggle('ekko-sin-puntero', RETOQUE.activo);

        // El tamaño del pincel se ve SIEMPRE, en los dos modos. MEDIDO: antes solo
        // aparecia en Manual y el cliente lo pidió así: en Asistido
        // también se pincel, y sin el control no se sabe qué tan fina va a ser
        // la pasada.
        const grupo = document.getElementById('grupo-tamano');
        if (grupo) grupo.hidden = false;

        // La ayuda tiene que explicar el modo que esta activo. MEDIDO: el texto
        // se quedaba siempre en el de Asistido y en Manual el cliente leia que
        // los objetos se detectaban solos, que es justo lo que ese modo no hace.
        const ayuda = document.getElementById('ayuda-modo');
        if (ayuda) {
            ayuda.textContent = RETOQUE.manual
                ? 'Pinta para quitar. Con Restaurar vuelve lo que se ve bajo los cuadros.'
                : 'Toca una zona y se detecta sola. Los cuadros muestran lo que está quitado.';
        }
    }

    /**
     * Pixeles de MASCARA por pixel de PANTALLA, en la ventana de edicion.
     *
     * Es el INVERSO EXACTO del mapeo de `pantallaAMascara`: ahi un pixel de
     * pantalla son `caja.esc` pixeles naturales de la foto, y un pixel natural
     * son `c.dw/nW` pixeles de mascara. Con eso, un pixel de pantalla vale
     * `c.dw / (nW * caja.esc)` pixeles de mascara.
     *
     * MEDIDO, y era la causa del defecto que reporto el cliente ("el circulo
     * pintado sale mas grande que el anillo del cursor", y "el pincel no mide
     * lo que dice"): el radio se convertia con
     * `esc * (anchoFoto / mascaraAncho)`, que SOLO coincide con esto cuando la
     * foto llena el ancho de la mascara (foto apaisada) y da otro numero en
     * las demas. Con este factor, el circulo pintado y el anillo del cursor
     * salen del MISMO numero y no pueden separarse.
     */
    function factorPantallaAMascara() {
        const caja = ESTADO.ventanaCaja;
        if (!caja || !(caja.esc > 0)) return 0;
        const c = ESTADO.caja || { ox: 0, oy: 0, dw: ESTADO.mascaraAncho, dh: ESTADO.mascaraAlto };
        const nat = imagenEnRetoque() || ESTADO.imagenProcesada;
        const el = nat && (nat.canvas || (nat.getElement && nat.getElement()));
        const nW = el ? (el.naturalWidth || el.width) : 0;
        if (!(nW > 0) || !(c.dw > 0)) return 0;
        return c.dw / (nW * caja.esc);
    }

    function actualizarCursor(ev) {
        const cur = document.getElementById('cursor-pincel');
        if (!cur) return;
        // Se muestra en LOS DOS MODOS. Antes solo aparecia en Manual, asi que
        // en Asistido el cliente no tenia ninguna referencia de que herramenta
        // estaba activa ni de cuan fina seria la pasada: lo reporto como "el
        // puntero aun no se colorea ni se muestra el tamano del pincel".
        if (!RETOQUE.activo) { cur.style.display = 'none'; cur.dataset.visible = ''; return; }
        // El numero del control es el DIAMETRO del pincel EN PANTALLA, que es
        // como lo piensa cualquiera: lo que dice el numero es lo que se ve.
        //
        // MEDIDO, y este era el defecto que reporto el cliente ("el circulo
        // pintado sale mas grande que el anillo del cursor" y "el pincel no
        // mide lo que dice"): antes el numero se multiplicaba por la escala de
        // la ventana, asi que el anillo de la pantalla y el circulo que se
        // pintaba NO eran el mismo circulo. Con el numero siendo directamente
        // el diametro en pantalla, el anillo y la pintura salen del MISMO
        // numero por construccion y no pueden separarse.
        //
        // Y es lo que hace PhotoRoom, medido en su video: el circulo del
        // cursor mide en pantalla lo que dice el control y NO cambia con el
        // zoom de la ventana (medido: 24 px con zoom alto y 57 px con zoom
        // medio, con el control en el mismo lugar). O sea que el pincel se
        // mide en pixeles de pantalla, no de imagen.
        //
        // Y en ASISTIDO el circulo NO se muestra: ahi no se pinta con el
        // pincel sino que se toca una zona y se selecciona sola, asi que
        // un circulo del tamaño del pincel mentia. MEDIDO: con el mismo
        // circulo en los dos modos, el cliente no notaba diferencia entre
        // Asistido y Manual.
        const d = RETOQUE.manual ? Math.max(4, RETOQUE.radio) : 10;
        cur.style.width = d + 'px';
        cur.style.height = d + 'px';
        cur.dataset.modo = RETOQUE.modo;
        if (ev) {
            cur.style.left = ev.clientX + 'px';
            cur.style.top = ev.clientY + 'px';
            cur.style.display = 'block';
            cur.dataset.visible = '1';
            cur.dataset.tam = String(Math.round(RETOQUE.radio));
            // En Asistido el radio es el alcance de la seleccion, no el ancho
            // de un pincel. Decirlo evita que se piense que se va a pintar un
            // circulo de ese tamaño.
            cur.dataset.modoVisual = RETOQUE.manual ? 'pincel' : 'asistido';
        }
    }

    /**
     * Colores de la foto a la resolucion de la mascara (una sola vez por foto).
     *
     * El modo asistido necesita poder preguntar "este pixel se parece a
     * aquel?" mirando la FOTOGRAFIA, no solo el recorte: es lo que dice la
     * documentacion de PhotoRoom ("analyses the color of the pixels and the
     * content of the image"). Sin esta rejilla no hay con que decidir.
     */
    function rejillaDeColor() {
        const r = imagenEnRetoque() || ESTADO.imagenProcesada;
        if (!r || !(ESTADO.mascaraAncho > 0)) return null;
        const clave = String(ESTADO.mascaraAncho) + 'x' + String(ESTADO.mascaraAlto);
        if (RETOQUE.colorGrid && RETOQUE.colorClave === clave) return RETOQUE.colorGrid;

        const src = r.canvas || (typeof r.getElement === 'function' ? r.getElement() : null) || r.image;
        if (!src) return null;
        const w = ESTADO.mascaraAncho, h = ESTADO.mascaraAlto;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        try { ctx.drawImage(src, 0, 0, w, h); } catch (_) { return null; }
        let px;
        try { px = ctx.getImageData(0, 0, w, h).data; }
        catch (e) { return null; }

        RETOQUE.colorGrid = { w, h, px };
        RETOQUE.colorClave = clave;
        return RETOQUE.colorGrid;
    }

    /**
     * Modo ASISTIDO: elige sola la zona que se toco.
     *
     * Crece por inundacion desde el punto tocado, y solo entra en pixeles de
     * color parecido Y del lado correcto segun la herramienta:
     *
     *   Borrar    -> solo entra donde hoy es opaco (el sujeto), y lo vuelve
     *               transparente. Asi no "borra" fondo que ya no se ve.
     *   Restaurar -> solo entra donde hoy es transparente (el fondo), y lo
     *               vuelve opaco. Asi un toque devuelve el fondo alrededor de
     *               un agujero sin comerse el pelo de al lado.
     *
     * Sin esa restriction el modo asistido seria peligroso: un solo toque
     * podria comerse media persona.
     */
    function marcarZonaAsistida(mx, my) {
        const g = rejillaDeColor();
        if (!g || !ESTADO.mascara) return 0;
        const w = g.w, h = g.h, px = g.px, m = ESTADO.mascara;
        const sx = Math.round(mx), sy = Math.round(my);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0;

        const i0 = sy * w + sx;
        const quitar = RETOQUE.modo === 'borrar';
        // La semilla tiene que estar DEL LADO que la herramienta va a tocar:
        //   Borrar    -> la semilla es opaca       (se saca parte del sujeto)
        //   Restaurar -> la semilla es transparente (se devuelve parte del fondo)
        //
        // Se define con `opacoSemilla !== quitar` porque "quitar" vale
        // justamente true cuando hay que actuar sobre lo opaco. Con la
        // comparacion al reves (la primera version) el modo Restaurar exigia
        // tocar el sujeto: el toque se rechazaba siempre y no hacia nada.
        // La mascara es un Float32Array en escala 0..1, asi que el umbral es 0.5.
// MEDIDO: decia `m[i0] > 128`, que con valores de 0 a 1 SIEMPRE da false. En
// Borrar eso hacia que el assisted saliera siempre por el aviso y no hiciera
// NADA, y el cliente reportaba que no notaba diferencia entre Manual y
// Asistido: en realidad Asistido con Borrar estaba roto.
        const opacoSemilla = m[i0] > 0.5;
        if (opacoSemilla !== quitar) {
            avisar(quitar
                ? 'Ahí no hay nada que borrar: tocá una parte del sujeto.'
                : 'Ahí ya está el sujeto: tocá una parte del fondo.', { kind: 'info' });
            return 0;
        }

        const tol = RETOQUE.tolerancia;
        const tol2 = tol * tol;
        // Tolerancia LOCAL, para no cruzar bordes.
        //
        // MEDIDO: con 0.35 de la tolerancia la region NO crecia nada (0 pixeles
        // en cuatro toques distintos) y el assisted quedaba muerto otra vez.
        // Con 0.7 deja pasar la variacion normal de una superficie y sigue
        // frenando en los bordes reales, que son saltos mucho mas grandes.
        const tolLocal = Math.max(20, tol * 0.7);
        const tolLocal2 = tolLocal * tolLocal;
        const r0 = px[i0 * 4], g0 = px[i0 * 4 + 1], b0 = px[i0 * 4 + 2];
        // Radio maximo alrededor del toque, PROPORCIONAL al lado de la mascara.
        //
        // MEDIDO: la mascara del retoque ya no es la del modelo (320) sino la
        // de TRABAJO (900x1600). El tope fijo de 143 px que se midio con 512
        // cubriria 1/6 del lado y el asistido quedaria inutil; 0.28 del lado
        // menor es exactamente la misma zona que se midio entonces.
        const alcance = Math.max(24, Math.round(Math.min(w, h) * 0.28));
        const alcance2 = alcance * alcance;

        const visto = new Uint8Array(w * h);
        const cola = new Int32Array(w * h);
        let cabeza = 0, colaN = 0;
        cola[colaN++] = i0;
        visto[i0] = 1;
        let tocados = 0;
        // Techo de seguridad extra, por si la tolerancia combinara con un fondo
        // patronado. Nunca se midio que hiciese falta, pero si alguna vez
        // dispara, es mejor un recorte parcial que perder el trabajo del
        // cliente de un saque.
        const TECHO = Math.floor(w * h * 0.35);

        while (cabeza < colaN) {
            const i = cola[cabeza++];
            const x = i % w, y = (i / w) | 0;
            const ex = x - sx, ey = y - sy;
            if (ex * ex + ey * ey > alcance2) continue;   // fuera de alcance
            tocados++;
            // Se aplica con un borde suave hacia el interior de la zona, para
            // que la transicion no quede como un escalon.
            // Se aplica con una RAMPA hacia el interior de la zona.
              //
              // MEDIDO: antes se escribia 0 o 1 seco. Sobre la grilla de 512 eso
              // deja una escalera, y el cliente reporto que Asistido dejaba
              // "lineas de borde". Con un escalon real en la mascara el filtro
              // guiado no tiene gradiente con que trabajar y no lo puede
              // suavizar: el pixelado se ve.
              const dBorde = Math.sqrt(ex * ex + ey * ey) / alcance;
              const dentro = Math.max(0, Math.min(1, (1 - dBorde) / 0.18));
              const rampa = dentro * dentro * (3 - 2 * dentro);
              const actual = m[i];
              m[i] = quitar ? actual * (1 - rampa) : Math.min(1, actual + (1 - actual) * rampa);

            // Dos comparaciones, y la segunda es la importante:
            //
            //   1) contra la SEMILLA: mantiene la zona parecida a lo que se toco.
            //   2) contra el VECINO INMEDIATO: no deja que la region se escape a
            //     .traves de un borde real.
            //
            // MEDIDO: antes solo comparaba contra la semilla, y por eso un toque
            // en el blanco del vestido se iba para arriba: toda la ropa clara,
            // el cardigan y la pared entran en la misma region por ser del mismo
            // color. El cliente reporto justo eso ("borra para arriba"). Es lo
            // que PhotoRoom llama "toda el area COHERENTE con tu toque": la
            // coherencia la da no saltar un borde, no Parecerse a un color.
            const cr = px[i * 4], cg = px[i * 4 + 1], cb = px[i * 4 + 2];
            const dr = cr - r0, dg = cg - g0, db = cb - b0;
            if (dr * dr + dg * dg + db * db > tol2) continue;

            for (let d = 0; d < 4; d++) {
                const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
                const ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const j = ny * w + nx;
                if (visto[j]) continue;
                // No se entra a un vecino que se parece al actual: eso es un
                // borde, y cruzar bordes es lo que hacia subir la region.
                const nr = px[j * 4], ng = px[j * 4 + 1], nb = px[j * 4 + 2];
                const lr = nr - cr, lg = ng - cg, lb = nb - cb;
                if (lr * lr + lg * lg + lb * lb > tolLocal2) continue;

                // Umbral 0.5 porque la mascara es 0..1. MEDIDO: decia `> 128`, que
                // siempre daba false, y entonces la region nunca crecia: el
                // assisted solo tocaba el pixel de la semilla y no se veia NADA.
                const oq = m[j] > 0.5;
                if (oq !== quitar) continue;          // mismo lado que la semilla
                visto[j] = 1;
                if (colaN < cola.length) cola[colaN++] = j;
            }
            // Si la tolerancia agarro medio plano, se corta: recordarle al
            // cliente media persona de un toque es peor que no hacer nada.
            if (tocados > TECHO) break;
        }
        return tocados;
    }

    /**
     * La capa roja de "lo que se quito" SE ELIMINA. Estaba inventada aqui.
     *
     * El cliente pidio "ver de forma transparente lo que se quito de fondo", y
     * lo que quiso decir es que el recorte se ve TRANSPARENTE de verdad, no
     * que hay que pintarlo de rojo. El recorte ya es transparente: superponer
     * un velo encima solo tapa el dibujo.
     *
     * MEDIDO: la capa cubria la caja de seleccion ENTERA de rosa y el cliente
     * la veto explicitamente. Ademas es falso: teñia de rojo tambien el pelo y
     * los bordes suaves, que no estan quitados. FotoRoom no tiene ninguna capa
     * de este tipo.
     *
     * Se conserva la funcion, apagada, para no romper las llamadas, pero ya no
     * dibuja nada. Lo que se ve al editar el recorte es el recorte con su
     * transparencia real.
     */
    function dibujarCapaQuitado() {
        const lienzo = document.getElementById('capa-quitado');
        if (!lienzo) return;
        lienzo.style.display = 'none';
        return;
        /* eslint-disable no-unreachable */
        const r = imagenEnRetoque() || ESTADO.imagenProcesada;
        const ec = document.getElementById('editorCanvas');
        const m = paper && paper.view ? paper.view.matrix : null;
        if (!RETOQUE.verQuitado || !r || !ec || !m || !ESTADO.mascara) { lienzo.style.display = 'none'; return; }

        const rc = ec.getBoundingClientRect();
        if (!(rc.width > 0) || !(rc.height > 0)) { lienzo.style.display = 'none'; return; }
        lienzo.style.display = 'block';
        lienzo.style.left = rc.left + 'px';
        lienzo.style.top = rc.top + 'px';
        lienzo.style.width = rc.width + 'px';
        lienzo.style.height = rc.height + 'px';
        const dpr = window.devicePixelRatio || 1;
        if (lienzo.width !== Math.round(rc.width * dpr) || lienzo.height !== Math.round(rc.height * dpr)) {
            lienzo.width = Math.round(rc.width * dpr);
            lienzo.height = Math.round(rc.height * dpr);
        }

        const ctx = lienzo.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rc.width, rc.height);

        const mw = ESTADO.mascaraAncho, mh = ESTADO.mascaraAlto;
        const aw = ESTADO.lienzoTrabajo ? ESTADO.lienzoTrabajo.aw : mw;
        const ah = ESTADO.lienzoTrabajo ? ESTADO.lienzoTrabajo.ah : mh;

        // La mascara a la resolucion del lienzo de trabajo, con el mismo mapeo
        // que usa el recorte (incluido el rectangulo real de la caja).
        const t = document.createElement('canvas');
        t.width = aw; t.height = ah;
        const tc = t.getContext('2d');
        const img = tc.createImageData(aw, ah);
        const c = ESTADO.caja || { ox: 0, oy: 0, dw: mw, dh: mh };
        for (let y = 0; y < ah; y++) {
            const fy = c.oy + (y * c.dh) / ah;
            const dentroY = fy >= 0 && fy < mh;
            const my = Math.max(0, Math.min(mh - 1, Math.floor(fy)));
            for (let x = 0; x < aw; x++) {
                const fx = c.ox + (x * c.dw) / aw;
                const dentro = dentroY && fx >= 0 && fx < mw;
                const o = (y * aw + x) * 4;
                if (!dentro) { img.data[o + 3] = 0; continue; }
                const mx = Math.max(0, Math.min(mw - 1, Math.floor(fx)));
                const a = ESTADO.mascara[my * mw + mx];
                // Solo se marca lo que esta FUERA de verdad.
                //
                // MEDIDO: antes se tintaba con `255 - alfa`, es decir cualquier
                // pixel con algo de traslucidez. En una foto de personas eso es
                // TODO: el pelo y los bordes blandos tienen alfa parcial y el
                // sujeto entero salia teñido de rosa. Lo que sirve para decidir
                // es separar "fuera" de "dentro": se pinta la zona claramente
                // transparente y la franja suave aparece apenas, para no
                // mentir sobre el borde fino.
                const fuera = a <= 24 ? 1 : (a >= 96 ? 0 : (96 - a) / 72 * 0.45);
                img.data[o] = 239;          // rojo de "borrado"
                img.data[o + 1] = 83;
                img.data[o + 2] = 80;
                // Tinte SUAVE a proposito. MEDIDO en el navegador: con opacidad
                // alta la zona quitada se veia como un bloque rosa solido que
                // tapaba la foto entera, y no informaba de nada. Con un
                // velo bajo se ve que hay algo retirado sin perder el dibujo.
                img.data[o + 3] = Math.round(fuera * 34);
            }
        }
        tc.putImageData(img, 0, 0);

        // Situar la capa exactamente donde esta la pieza: espacio de la pieza
        // (bounds, en coordenadas de Paper) y de ahi a pantalla con la vista.
        const b = r.bounds;
        if (!b || !(b.width > 0)) { lienzo.style.display = 'none'; return; }
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.transform(
            (b.width / aw) * m.a, 0, 0, (b.height / ah) * m.d,
            b.x * m.a + m.tx, b.y * m.d + m.ty
        );
        ctx.drawImage(t, 0, 0);
        ctx.restore();
    }

    /** Pinta un circulo sobre la mascara, en coordenadas de la mascara. */
    function pintarPincel(mx, my) {
        const { w, h } = { w: ESTADO.mascaraAncho, h: ESTADO.mascaraAlto };
        if (!(w > 0) || !(h > 0)) return;
        // `RETOQUE.radio` es el DIAMETRO que muestra el control, en PIXELES DE
        // PANTALLA de la ventana de edicion. Es el mismo numero que dibuja el
        // anillo del cursor, asi que lo que dice el control es lo que se pinta.
        //
        // MEDIDO, tres errores encadenados:
        //   1) el numero era el RADIO: con 25 se pintaba un circulo de 50 px.
        //   2) faltaba el cambio de escala entre pantalla y mascara.
        //   3) el cambio de escala estaba mal: se usaba
        //      `esc * (anchoFoto/mascaraAncho)`, que solo da bien cuando la
        //      foto llena el ancho de la mascara. Con el factor inverso exacto
        //      (`factorPantallaAMascara`) el circulo pintado y el anillo del
        //      cursor son SIEMPRE el mismo circulo.
        //
        // El cliente reportaba que "los pinceles no respetan el tamano" y que
        // el circulo pintado salia ~3 veces mas grande que el anillo del
        // cursor. MEDIDO en el video de PhotoRoom: ahi el circulo del cursor y
        // la pintura SI coinciden, y el tamano es el que dice el control.
        const factor = factorPantallaAMascara();
        if (!(factor > 0)) return;
        const r = Math.max(1, (RETOQUE.radio / 2) * factor);
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
                // Difuminado ANCHO y suave (smoothstep).
                //
                // MEDIDO: con el difuminado viejo el 65% interior era 1 y el
                // 35% exterior caia lineal a 0. Eso deja un corte casi duro
                // sobre una grilla de 512, y con zoom al 300% cada peldaño de la
                // grilla son ~9 px de pantalla: se ve la escalera. El cliente lo
                // reporto como "se ve escalonado".
                //
                // Ahora la rampa arranca en la mitad del pincel y es una
                // smoothstep: hay un gradiente real para que el filtro guiado
                // trabaje, y el borde sale suave a cualquier zoom.
                const t = (1 - dist) / 0.5;          // 1 en el centro, 0 en el borde
                const suave = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
                const i = y * w + x;
                const a = ESTADO.mascara[i];
                // La mascara va de 0 a 1. MEDIDO: aqui se escribia 255 al
                // restaurar, y un 255 en un array de 0..1 rompe el filtro
                // guiado justo en la zona restaurada: por eso restaurar se veia
                // pixelado y borrar no. Es el quinto sightings del mismo error
                // de escala en este archivo.
                ESTADO.mascara[i] = quitar
                    ? Math.max(0, a * (1 - suave))
                    : Math.min(1, a + (1 - a) * suave);
            }
        }
        // La vista previa se actualiza SOLO en este recuadro: lo que no se
        // pinto no cambia ni un pixel. Es lo que separa Manual de Asistido.
        actualizarCapasEn(x0, y0, x1, y1);
    }

    /**
     * Traduce un punto de pantalla a coordenadas de la mascara.
     *
     * OJO con las unidades. `item.bounds` de Paper esta en el espacio del
     * LIENZO (con la escala y el desplazamiento del zoom ya aplicados), y
     * `ev.clientX` esta en pixeles de PANTALLA. Restarlos directamente mezcla
     * dos sistemas distintos y devuelve numeros sin sentido: con la pieza
     * desplazada salian coordenadas negativas, el pincel se salia del rango
     * en cada trazo y no pintaba NADA. Ese era el motivo por el que abrir el
     * panel de retoque no producia ningun efecto.
     *
     * La conversion correcta es en dos pasos, usando las matrices reales:
     * pantalla -> lienzo (matriz de vista) y lienzo -> pieza (matriz del
     * item), que puede traer escala, rotacion y traslacion.
     */
    function pantallaAMascara(ev) {
        // Se puede estar retocando una imagen que ya no es la ultima procesada:
        // se resuelve desde la seleccion para no pintar sobre la pieza
        // equivocada cuando el cliente retoca dos fotos seguidas.
        const r = imagenEnRetoque() || ESTADO.imagenProcesada;
        if (!r) return null;
        const src = r.canvas || (typeof r.getElement === 'function' ? r.getElement() : null) || r.image;
        if (!src) return null;
        const natW = src.naturalWidth || src.width || 1;
        const natH = src.naturalHeight || src.height || 1;
        if (!(natW > 0) || !(natH > 0)) return null;
        if (!(ESTADO.mascaraAncho > 0) || !(ESTADO.mascaraAlto > 0)) return null;

        // La ventana tiene su propio lienzo y su propia caja: se lee de ahi, no de
        // `paper.view`. MEDIDO: usar la del editor mandaba el trazo a cualquier
        // lado, porque la ventana esta en otro sistema de coordenadas.
        const cv = document.getElementById('lienzo-editar-fondo');
        const caja = ESTADO.ventanaCaja;
        if (!cv || !caja || !caja.esc) return null;

        // Pantalla -> pixel de la foto dentro de la ventana.
        const rc = cv.getBoundingClientRect();
        const fx = (ev.clientX - rc.left - caja.ox) / caja.esc;
        const fy = (ev.clientY - rc.top - caja.oy) / caja.esc;
        if (!isFinite(fx) || !isFinite(fy)) return null;

        // El limite se mide contra el TAMAÑO NATURAL de la foto, no contra
        // `caja.w/h` (que es el ancho en pantalla).
        //
        // MEDIDO: `fx` ya viene en pixeles naturales, pero se comparaba con el
        // ancho mostrado. Con una foto de 1200 px dibujada a 216 de ancho, todo
        // lo que pasaba de x=238 se rechazaba y el pincel NO PINTABA NADA, sin
        // dar ningun error. Era el mismo problema de unidades que YA se habia
        // resuelto una vez para `paper.view` (ver la nota de esta funcion).
        if (fx < -natW * 0.1 || fx > natW * 1.1 || fy < -natH * 0.1 || fy > natH * 1.1) return null;

        // Pixel de la foto -> coordenada de la MASCARA, respetando el
        // rectangulo real que la foto ocupa dentro del cuadrado de entrada.
        const c = ESTADO.caja || { ox: 0, oy: 0, dw: ESTADO.mascaraAncho, dh: ESTADO.mascaraAlto };
        const nat = imagenEnRetoque() || ESTADO.imagenProcesada;
        const el = nat && (nat.canvas || (nat.getElement && nat.getElement()));
        const nW = el ? (el.naturalWidth || el.width) : 0;
        const nH = el ? (el.naturalHeight || el.height) : 0;
        if (!(nW > 0) || !(nH > 0)) return null;
        const mx = c.ox + (fx / nW) * c.dw;
        const my = c.oy + (fy / nH) * c.dh;
        if (!isFinite(mx) || !isFinite(my)) return null;
        return { x: mx, y: my };
    }

    /** Version vieja, solo para el lienzo del editor. Ya no se usa para pintar. */
    function pantallaAMascaraEditor(ev) {
        if (!paper.view) return null;
        const cv = document.getElementById('editorCanvas');
        if (!cv) return null;
        const rc = cv.getBoundingClientRect();
        const m = paper.view.matrix;
        const lx = (ev.clientX - rc.left - m.tx) / m.a;
        const ly = (ev.clientY - rc.top - m.ty) / m.d;
        if (!isFinite(lx) || !isFinite(ly)) return null;

        // Lienzo -> espacio local de la pieza.
        //
        // Se usa la caja REAL de la pieza (bounds), no su matriz. Medido: la
        // matriz de un Raster recien creado con escala y posicion NO
        // coincide con la caja que Paper reporta, e invertirla daba
        // coordenadas negativas incluso con la pieza bien colocada: el
        // pincel se salia del rango en cada trazo y no pintaba nada.
        const b = r.bounds;
        if (!b || !(b.width > 0) || !(b.height > 0)) return null;
        const sx = (lx - b.x) / b.width;
        const sy = (ly - b.y) / b.height;
        // Margen del 12%: el cliente puede empezar el trazo justo en el borde.
        if (sx < -0.12 || sx > 1.12 || sy < -0.12 || sy > 1.12) return null;
        return { x: sx * ESTADO.mascaraAncho, y: sy * ESTADO.mascaraAlto };
    }

    /** Vuelve a componer el recorte desde la mascara (reutiliza el motor). */
    function recomponerDesdeMascara() {
        // Llama a ajustarBorde con la clave 'recomponer', que es el camino real
        // del motor. Antes llamaba a una funcion `recomponer()` que NO existe
        // en este archivo: el ReferenceError caia en un catch que solo imprimia
        // un aviso, con lo que el pincel pintaba la mascara pero la imagen
        // nunca cambiaba. El cliente veia el panel abierto y ningun efecto.
        try { return ajustarBorde('recomponer', 0) !== false; }
        catch (e) {
            console.error('[EKKO RETOQUE] no se pudo recomponer', e);
            return false;
        }
    }

    function conectarRetoque() {
        const vf = document.getElementById('ventana-editar-fondo');
        if (!vf || vf.__ekkoConectado) return;
        vf.__ekkoConectado = true;

        const b = document.getElementById('pincel-borrar');
        const r = document.getElementById('pincel-restaurar');
        const slider = document.getElementById('slider-tamano-pincel');
        const inputNum = document.getElementById('input-tamano-pincel');
        const aceptar = document.getElementById('btn-aceptar-fondo');
        const deshacerBtn = document.getElementById('btn-deshacer-fondo');
        const rehacerBtn = document.getElementById('btn-rehacer-fondo');
        const ma = document.getElementById('modo-asistido');
        const mm = document.getElementById('modo-manual');
        const verQuitado = document.getElementById('ver-quitado');

        const elegir = (modo) => {
            RETOQUE.modo = modo;
            RETOQUE.activo = true;
            marcarPincelActivo();
            actualizarCursor();
            // El fondo se ve mas o menos apagado segun la herramienta, asi que
            // al cambiarla hay que repintar. MEDIDO: sin esto el fondo se
            // quedaba siempre apagado y en Restaurar no se veian las sillas
            // que hay que recuperar.
            try { pintarLienzoVentana(); }
            catch (e) { ESTADO.ultimoError = e; console.warn('[EKKO RETOQUE] no se pudo repintar al cambiar de herramienta:', e); }
        };
        if (b) b.addEventListener('click', () => elegir('borrar'));
        if (r) r.addEventListener('click', () => elegir('restaurar'));

        // Asistido / Manual. Cambia lo que hace el puntero sobre el lienzo, asi
        // que el estado tiene que verse en la barra (marcarPincelActivo).
        const ponerModo = (manual) => {
            RETOQUE.manual = !!manual;
            marcarPincelActivo();
            actualizarCursor();
        };
        if (ma) ma.addEventListener('click', () => ponerModo(false));
        if (mm) mm.addEventListener('click', () => ponerModo(true));

        // "Ver lo quitado" es ahora un BOTON, no una casilla: la barra es un
        // sitio plano y una casilla invisible obligaba a acertar el punto
        // exacto.
        // Botones de zoom de la ventana.
        const zMas = document.getElementById('zoom-mas');
        const zMenos = document.getElementById('zoom-menos');
        const zCien = document.getElementById('zoom-100');
        const zValor = document.getElementById('valor-zoom-ventana');
        const ponZoom = (z) => {
            RETOQUE.zoomVentana = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
            if (zValor) zValor.textContent = Math.round(RETOQUE.zoomVentana * 100) + '%';
            try { pintarLienzoVentana(); } catch (_) {}
            actualizarCursor();
        };
        if (zMas) zMas.addEventListener('click', () => ponZoom((RETOQUE.zoomVentana || 1) * 1.35));
        if (zMenos) zMenos.addEventListener('click', () => ponZoom((RETOQUE.zoomVentana || 1) / 1.35));
        if (zCien) zCien.addEventListener('click', () => { RETOQUE.panVentana = { x: 0, y: 0 }; ponZoom(1); });

        if (verQuitado) {
            verQuitado.addEventListener('click', function () {
                RETOQUE.verQuitado = !RETOQUE.verQuitado;
                verQuitado.setAttribute('aria-pressed', RETOQUE.verQuitado ? 'true' : 'false');
                verQuitado.classList.toggle('is-activo', RETOQUE.verQuitado);
                dibujarCapaQuitado();
                try { pintarLienzoVentana(); } catch (_) {}
                marcarPincelActivo();
            });
        }

        // El tamano del pincel se ajusta de CUATRO maneras, como pidio el
        // cliente: la barra, la rueda, escribiendo el numero y arrastrando el
        // cursor. Todas pasan por el MISMO numero, asi que nunca pueden
        // separarse: el circulo del puntero y lo que se pinta salen de aca.
        const aplicarTamano = function (nuevo, desde) {
            const v = Math.max(1, Math.min(120, Math.round(Number(nuevo) || 25)));
            RETOQUE.radio = v;
            if (slider && desde !== 'slider') slider.value = String(v);
            // El campo numerico se corrige SIEMPRE: si queda con un numero
            // fuera de rango (por ejemplo 999) muestra una cosa y se
            // aplica otra. MEDIDO: asi se veia.
            if (inputNum) inputNum.value = String(v);
            actualizarCursor();
        };
        if (slider) {
            slider.addEventListener('input', function () {
                aplicarTamano(slider.value, 'slider');
            });
        }
        if (inputNum) {
            inputNum.addEventListener('input', function () {
                // Se acepta mientras se escribe; el valor se ajusta al rango.
                const v = Number(inputNum.value);
                if (!isFinite(v) || v < 1) return;
                aplicarTamano(v, 'input');
            });
            // Al salir del campo se corrige lo que quedo fuera de rango.
            inputNum.addEventListener('change', function () {
                aplicarTamano(inputNum.value, 'input');
            });
        }
        if (aceptar) aceptar.addEventListener('click', function () {
            // "Listo": aplica lo editado a la foto del mockup y cierra.
            confirmarEdicion();
        });
        if (deshacerBtn) deshacerBtn.addEventListener('click', function () { deshacerRetoque(); });
        if (rehacerBtn) rehacerBtn.addEventListener('click', function () { rehacerRetoque(); });
        actualizarBotonesRetoque();

        // El pincel se pinta arrastrando sobre el lienzo de la VENTANA.
        //
        // OJO con donde se escucha. Se midio que el manejador de eventos de
        // EKKO detiene la propagacion en un ancestro del lienzo: el evento
        // llegaba a `document` pero NUNCA al `canvas`. Con el listener en el
        // lienzo el pincel no recibia nada y abrir la ventana no producia
        // ningun efecto visible.
        //
        // Por eso se escucha en `window` en fase de captura, que es lo
        // PRIMERO que se ejecuta en toda la cadena.
        //
        // MEDIDO: la ventana ahora es el lienzo PROPIO que se pinta. Antes se
        // pintaba sobre `editorCanvas`, el lienzo del editor, y con la ventana
        // abierta encima el trazo caia en la foto de fondo y no en nada.
        const canvas = document.getElementById('lienzo-editar-fondo');
        let pintando = false;

        // ESPACIO + arrastrar = mover la foto, como en Photoshop. Se declara
        // aca porque lo consultan el pincel (para no pintar mientras se
        // navega) y el manejo de paneo. Con 24x de zoom, moverse es tan
        // importante como acercarse.
        let espacio = false;
        let ratonDentro = false;
        const enCampo = (t) => {
            const n = (t && (t.tagName || '')).toUpperCase();
            return n === 'INPUT' || n === 'TEXTAREA' || !!(t && t.isContentEditable);
        };
        const mostrarCursorPincel = (visible) => {
            const cur = document.getElementById('cursor-pincel');
            if (!cur) return;
            cur.style.display = visible ? 'block' : 'none';
            cur.dataset.visible = visible ? '1' : '';
        };
        window.addEventListener('keydown', (ev) => {
            if (!RETOQUE.activo || enCampo(ev.target)) return;
            if (ev.code === 'Space' || ev.key === ' ') {
                espacio = true;
                // Sin esto, el navegador baja la pagina con la barra espaciadora.
                ev.preventDefault();
                mostrarCursorPincel(false);
            }
        }, true);
        window.addEventListener('keyup', (ev) => {
            if (ev.code === 'Space' || ev.key === ' ') {
                espacio = false;
                // Si el puntero sigue sobre la foto, el anillo vuelve sin
                // esperar a que el cliente mueva el mouse.
                if (RETOQUE.activo && ratonDentro) mostrarCursorPincel(true);
            }
        }, true);

        const sobreLienzo = (ev) => {
            try { return !!(canvas && canvas.contains(ev.target)); }
            catch (_) { return false; }
        };
        const pintarEn = (ev) => {
            const p = pantallaAMascara(ev);
            if (!p) return false;
            pintarPincel(p.x, p.y);
            pintarLienzoVentana();
            return true;
        };

        // Un toque en modo ASISTIDO elige la zona sola. No es un trazo: se
        // aplica una vez y se suelta, asi que va solo en pointerdown.
        const tocarAsistido = (ev) => {
            const p = pantallaAMascara(ev);
            if (!p) return false;
            // Float32Array y NO Uint8ClampedArray: ver la nota de
            // `RETOQUE.original`.
            if (!RETOQUE.original) RETOQUE.original = new Float32Array(ESTADO.mascara);
            const n = marcarZonaAsistida(p.x, p.y);
            if (!n) return false;
            // El asistido cambia una zona entera: las capas cacheadas ya no
            // valen y se reconstruyen al repintar.
            RETOQUE.capasSucias = true;
            // Un toque en Asistido no tiene arrastre: se puede refinar de una.
            pintarLienzoVentana(true);
            // Un toque = un paso de historial, igual que un trazo.
            historialAnotar();
            return true;
        };

        window.addEventListener('pointerdown', (ev) => {
            if (!RETOQUE.activo) return;
            if (!sobreLienzo(ev)) return;
            // Alt, ESPACIO o boton central son NAVEGACION, no pincel. MEDIDO:
            // sin esta salida, Alt+arrastrar pintaba un punto al empezar a
            // mover, porque los dos manejadores se disparan en el mismo evento.
            if (ev.altKey || espacio || ev.button === 1) return;
            if (ev.button !== undefined && ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (!RETOQUE.manual) { tocarAsistido(ev); pintando = false; return; }
            pintarEn(ev);
            pintando = true;
        }, true);

        window.addEventListener('pointermove', (ev) => {
            ratonDentro = sobreLienzo(ev);
            if (!RETOQUE.activo || !ratonDentro) return;
            // El cursor se mueve en LOS DOS modos. Antes en Asistido se llamaba
            // con null, sin el evento, y eso hacia que nunca recibiera posicion:
            // el circulo quedaba oculto y el cliente se quedaba sin puntero de referencia.
            if (!espacio) actualizarCursor(ev);
            if (!pintando || !RETOQUE.manual) return;
            ev.preventDefault();
            ev.stopPropagation();
            pintarEn(ev);
        }, true);

        // Al salir del lienzo el cursor se esconde: si queda congelado en el
        // borde parece que el pincel sigue activo.
        window.addEventListener('pointerleave', () => {
            ratonDentro = false;
            mostrarCursorPincel(false);
        }, true);
        window.addEventListener('blur', () => { pintando = false; espacio = false; }, true);

        // Al SOLTAR ya no hay que cambiar de camino de dibujo: durante el
        // arrastre las capas cacheadas se actualizan solo en el circulo
        // pintado, y son las mismas que se usan al soltar y al guardar. Antes
        // se repintaba "refinado" de golpe y eso redibujaba todo el contorno.
        const soltar = () => {
            const huboTrazo = pintando;
            pintando = false;
            // Un trazo = UN paso de historial. Se anota al soltar y no en cada
            // cuadro: si se anotara por cuadro, deshacer iria pixel a pixel en
            // vez de trazo a trazo, que es lo util (y lo que hacen PhotoRoom y
            // Photoshop).
            if (huboTrazo) historialAnotar();
            try { pintarLienzoVentana(); }
            catch (e) {
                // Un error tragado no se puede ver: se guarda y se avisa.
                ESTADO.ultimoError = e;
                console.warn('[EKKO RETOQUE] fallo el repintado:', e);
            }
        };
        window.addEventListener('pointerup', soltar, true);
        window.addEventListener('pointercancel', soltar, true);

        // Rueda = zoom de la ventana, solo si el puntero esta sobre el lienzo.
        window.addEventListener('wheel', (ev) => {
            if (!RETOQUE.activo) return;
            // Sobre el control del tamano, la rueda cambia el TAMANO del
            // pincel, no el zoom. MEDIDO: el cliente pidio las dos cosas y
            // con una sola rueda no se pueden tener.
            if (slider) {
                const rs = slider.getBoundingClientRect();
                if (ev.clientX >= rs.left && ev.clientX <= rs.right && ev.clientY >= rs.top && ev.clientY <= rs.bottom) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    aplicarTamano(RETOQUE.radio + (ev.deltaY < 0 ? 1 : -1), 'rueda');
                    return;
                }
            }
            const cv = document.getElementById('lienzo-editar-fondo');
            if (!cv) return;
            const rc = cv.getBoundingClientRect();
            if (ev.clientX < rc.left || ev.clientX > rc.right) return;
            if (ev.clientY < rc.top || ev.clientY > rc.bottom) return;
            ev.preventDefault();
            ev.stopPropagation();
            zoomEn(ev, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
        }, { capture: true, passive: false });

        // Navegacion: Alt + arrastrar (el atajo que ya existia), ESPACIO +
        // arrastrar (como Photoshop) y boton central. Asi el pincel y el
        // desplazamiento no se pisan.
        let desplazando = false;
        let desde = null;
        window.addEventListener('pointerdown', (ev) => {
            if (!RETOQUE.activo) return;
            if (!(ev.altKey || espacio || ev.button === 1)) return;
            const cv = document.getElementById('lienzo-editar-fondo');
            if (!cv) return;
            const rc = cv.getBoundingClientRect();
            if (ev.clientX < rc.left || ev.clientX > rc.right) return;
            if (ev.clientY < rc.top || ev.clientY > rc.bottom) return;
            desplazando = true;
            desde = { x: ev.clientX, y: ev.clientY, px: (RETOQUE.panVentana||{x:0}).x, py: (RETOQUE.panVentana||{y:0}).y };
            ev.preventDefault();
            ev.stopPropagation();
            // El boton central, sin esto, activa el autoscroll del navegador.
            if (ev.button === 1) {
                const cur = document.getElementById('cursor-pincel');
                if (cur) mostrarCursorPincel(false);
            }
        }, true);
        window.addEventListener('pointermove', (ev) => {
            if (!desplazando || !desde) return;
            RETOQUE.panVentana = { x: desde.px + (ev.clientX - desde.x), y: desde.py + (ev.clientY - desde.y) };
            pintarLienzoVentana();
        }, true);
        window.addEventListener('pointerup', () => {
            desplazando = false; desde = null;
            if (RETOQUE.activo && ratonDentro && !espacio) mostrarCursorPincel(true);
        }, true);

        // Ctrl+Z / Ctrl+Shift+Z (o Ctrl+Y): deshacer y rehacer, como en
        // Photoshop. Va en su PROPIO listener porque el de abajo ignora a
        // proposito las teclas con Ctrl (B/R/A/M no deben dispararse con Ctrl).
        window.addEventListener('keydown', (ev) => {
            if (!RETOQUE.activo) return;
            if (!(ev.ctrlKey || ev.metaKey)) return;
            const t = ev.target;
            const nombre = (t && (t.tagName || '')).toUpperCase();
            if (nombre === 'INPUT' || nombre === 'TEXTAREA' || (t && t.isContentEditable)) return;
            const k = String(ev.key || '').toLowerCase();
            if (k === 'z' && !ev.shiftKey) {
                ev.preventDefault(); ev.stopPropagation();
                deshacerRetoque();
            } else if ((k === 'z' && ev.shiftKey) || k === 'y') {
                ev.preventDefault(); ev.stopPropagation();
                rehacerRetoque();
            }
        }, true);

        // Atajos de teclado. Mientras se esta retocando el recorte, escribir
        // B/R/A/M no debe insertar texto en el editor: se intercepta antes.
        //   B  Borrar          R  Restaurar
        //   A  Asistido       M  Manual
        //   V  ver lo quitado  Esc  Listo
        //   [  pincel mas fino   ]  pincel mas grueso  (como en Photoshop)
        window.addEventListener('keydown', (ev) => {
            if (!RETOQUE.activo) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const t = ev.target;
            const nombre = (t && (t.tagName || '')).toUpperCase();
            if (nombre === 'INPUT' || nombre === 'TEXTAREA' || (t && t.isContentEditable)) return;
            const k = String(ev.key || '').toLowerCase();
            const actuar = {
                b: () => { RETOQUE.modo = 'borrar'; marcarPincelActivo(); },
                r: () => { RETOQUE.modo = 'restaurar'; marcarPincelActivo(); },
                a: () => { RETOQUE.manual = false; marcarPincelActivo(); },
                m: () => { RETOQUE.manual = true; marcarPincelActivo(); },
                v: () => { RETOQUE.verQuitado = !RETOQUE.verQuitado; marcarPincelActivo(); dibujarCapaQuitado(); },
                '[': () => aplicarTamano(RETOQUE.radio - 1, 'teclado'),
                ']': () => aplicarTamano(RETOQUE.radio + 1, 'teclado'),
                escape: () => cerrarRetoque(),
                enter: () => cerrarRetoque()
            }[k];
            if (!actuar) return;
            ev.preventDefault();
            ev.stopPropagation();
            actuar();
            actualizarCursor();
        }, true);
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

})(window.EKKO = window.EKKO || {});
