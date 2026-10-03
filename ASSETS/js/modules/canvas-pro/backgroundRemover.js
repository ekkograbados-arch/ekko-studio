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

        // Modelo usado. MODNet: entrenado para retrato, 6,3 MB, entrada 512.
        //
        // Se eligio MEDIDO, no por sabor: contra la foto de referencia del
        // cliente, de punta a punta dentro de la app, IoU 96,4% con 0,4% de
        // sujeto faltante, frente al 71,4% y 7,6% del modelo anterior. El pelo
        // y la cabeza, que es lo que el cliente reportaba roto, es justamente
        // lo que MODNet hace bien.
        //
        // El worker tiene su propio respaldo: si este no se descarga, baja al
        // estandar por su cuenta (ver obtenerSesion).
        MODELO_CLAVE: 'modnet',

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

        // MATTING: cuanto se deja que la FOTOGRAFIA real resuelva la franja
        // dudosa del recorte.
        //
        // DESACTIVADO (0) a proposito, y medido con la foto de referencia:
        //   MATTING 0  -> IoU 71.4%, transicion 8758 px
        //   MATTING 55 -> IoU 71.4%, transicion 8458 px
        // No mejora nada y solo endurece el borde.
        //
        // El motivo es tecnico, no una mania: el matteado por color compara
        // contra el COLOR MEDIO del sujeto. En una foto con varias personas y
        // ropa de color intenso (vestido azul, pelo castano oscuro), el medio
        // lo domina el azul, el pelo queda lejos de esa referencia y nunca se
        // recupera. Sirve para un sujeto monocromo; aqui no.
        //
        // Queda el codigo porque sirve para fotos de un solo color, y el
        // slider "Pelo" existe para que el cliente lo pruebe y lo vea por si
        // mismo. En 0 = solo el modelo, que es el estado recomendado.
        MATTING: 0,

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
                } else if (d.tipo === 'nota') {
                    // Aviso interno del worker (por ejemplo: bajo al modelo
                    // estandar porque el de alta no entra en memoria). Se
                    // registra el lado de entrada para escalar bien.
                    if (d.lado) window.__EKKO_LADO_ENTRADA = d.lado;
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
    // Escalado al tamaño que pide el modelo, conservando el aspecto
    // ----------------------------------------------------------------------
    function prepararEntrada(imagen, lado) {
        const W = imagen.naturalWidth || imagen.width;
        const H = imagen.naturalHeight || imagen.height;
        if (!W || !H) throw new Error('La imagen no tiene dimensiones');

        const S = lado || 320;
        // Encajar en un cuadrado SIN deformar: si el modelo ve un sujeto
        // estirado, el recorte sale torcido.
        const escala = Math.min(S / W, S / H);
        const dw = Math.max(1, Math.round(W * escala));
        const dh = Math.max(1, Math.round(H * escala));
        const ox = (S - dw) / 2;
        const oy = (S - dh) / 2;

        const lienzo = document.createElement('canvas');
        lienzo.width = S; lienzo.height = S;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });

        // El relleno NO es negro. MEDIDO con MODNet: con marco negro el recorte
        // cae a IoU 89,5% y el modelo clasifica parte del marco como sujeto
        // (2,6% de pixeles de sobra). Con el color medio de la propia foto sube
        // a 95,5%: el marco se camufla con el fondo real y deja de existir.
        const tonal = document.createElement('canvas');
        tonal.width = 8; tonal.height = 8;
        const tc = tonal.getContext('2d', { willReadFrequently: true });
        tc.drawImage(imagen, 0, 0, 8, 8);
        const d8 = tc.getImageData(0, 0, 8, 8).data;
        let tr = 0, tg = 0, tb = 0;
        for (let i = 0; i < 64; i++) { tr += d8[i * 4]; tg += d8[i * 4 + 1]; tb += d8[i * 4 + 2]; }
        ctx.fillStyle = `rgb(${tr >> 6},${tg >> 6},${tb >> 6})`;
        ctx.fillRect(0, 0, S, S);
        ctx.drawImage(imagen, ox, oy, dw, dh);

        // Se devuelve el rectangulo que ocupa la foto DENTRO del cuadrado. Sin
        // el, al volver la mascara habria que suponer que la foto llena todo el
        // cuadrado, y no es cierto: queda corrida y con un marco pegado.
        return { pixeles: ctx.getImageData(0, 0, S, S).data, W, H, caja: { ox, oy, dw, dh } };
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

    function aplicarMascara(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo, caja) {
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
                const a = alfa[y0 * mw + x0], b = alfa[y0 * mw + x1];
                const cc = alfa[y1 * mw + x0], d = alfa[y1 * mw + x1];
                fila[x] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
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

        // Refinado del borde contra la FOTOGRAFIA. Sin esto la transicion queda
        // en 2,2 px con saltos de 255 entre pixeles vecinos (medido), que es el
        // "pixelado" que reportaba el cliente: la alfa viene de 512 y se
        // amplia a 1600, y ampliar a pelo no reproduce el borde real.
        if (CFG.REFINAR_BORDE > 0.001) {
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
    /**
     * MATTING POR COLORES DE LA FOTOGRAFIA
     *
     * El modelo entrega la mascara a 320x320 y al ampliarla el pelo fino ya se
     * perdio: por eso la cabeza de la nina se veia cortada (el pelo oscuro cae
     * sobre un fondo oscuro y el modelo no sabe cual de los dos es pelo).
     *
     * Ningun ajuste de umbral recupera eso, porque el dato no esta. Lo que si
     * esta a resolucion completa es la PROPIA FOTOGRAFIA. Este paso usa esa
     * informacion para rehacer SOLO la franja donde el modelo duda:
     *
     *   - El interior opaco (alfa > 0.9) no se toca: el modelo esta seguro y
     *     la foto no aporta nada mejor ahi.
     *   - El fondo limpio (alfa < 0.1) tampoco: ya es transparente.
     *   - La franja intermedia (0.1..0.9) es la zona de decision. Ahi se
     *     compara el color del pixel con los colores dominantes del sujeto y
     *     del fondo, y se corrige el alfa hacia el lado que corresponda.
     *
     * Asi el pelo se conserva porque se parece al sujeto, y el fondo se
     * conserva transparente porque se parece al fondo. La diferencia con un
     * guided filter a secas es que NO se toca el interior ni el exterior: antes
     * se empujaba toda la mascara hacia el color del fondo y el recorte
     * empeoraba (medido: los pixeles de borde nitidos bajaron de 4135 a 3229).
     */
    function mattearConFoto(px, alfaTrabajo, W, H, fuerza) {
        if (fuerza <= 0.001) return;
        const total = W * H;

        // Luminancia media de lo que el modelo considero sujeto y fondo.
        // Se mide sobre las zonas en las que NO duda, para que la referencia no
        // este contaminada por la propia franja que queremos corregir.
        let sFondo = 0, nFondo = 0, sSujeto = 0, nSujeto = 0;
        const rF = [0, 0, 0], rS = [0, 0, 0];
        for (let i = 0; i < total; i++) {
            const a = alfaTrabajo[i];
            const o = i * 4;
            if (a < 0.08) { rF[0] += px[o]; rF[1] += px[o+1]; rF[2] += px[o+2]; nFondo++; }
            else if (a > 0.92) { rS[0] += px[o]; rS[1] += px[o+1]; rS[2] += px[o+2]; nSujeto++; }
        }
        if (nFondo < 64 || nSujeto < 64) return;   // escena no separable
        rF[0] /= nFondo; rF[1] /= nFondo; rF[2] /= nFondo;
        rS[0] /= nSujeto; rS[1] /= nSujeto; rS[2] /= nSujeto;
        sFondo = (rF[0] + rF[1] + rF[2]) / 3;
        sSujeto = (rS[0] + rS[1] + rS[2]) / 3;
        const sepL = Math.abs(sSujeto - sFondo);

        // Encuadre: el modelo solo vio 320 px, asi que el sujeto en la foto
        // grande estarappedido en una regionmucho mas pequena que la imagen.
        // Medimos la caja real del sujeto sobre la propia imagen de trabajo.
        let minX = W, maxX = 0, minY = H, maxY = 0, nCaja = 0;
        const EPO = W * H / 4096;                   // muestra ~4096 pixeles
        const paso = Math.max(1, Math.floor(Math.sqrt(EPO)));
        for (let y = 0; y < H; y += paso) {
            for (let x = 0; x < W; x += paso) {
                if (alfaTrabajo[y * W + x] > 0.5) {
                    nCaja++;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (nCaja < 16) return;

        // Padding proporcional: el sujeto suele tocar el borde de su caja.
        const pad = Math.max(6, Math.round(Math.max(maxX - minX, maxY - minY) * 0.04));
        minX = Math.max(0, minX - pad); maxX = Math.min(W - 1, maxX + pad);
        minY = Math.max(0, minY - pad); maxY = Math.min(H - 1, maxY + pad);
        const anchoCaja = maxX - minX, altoCaja = maxY - minY;
        if (anchoCaja < 8 || altoCaja < 8) return;

        const k = Math.min(1, fuerza * 1.5);
        // RECUPERACION: el modelo marco como fondo (alfa casi 0) zonas que en
        // realidad son sujeto. Es el caso de la cabeza de la nina: pelo oscuro
        // sobre fondo oscuro, el modelo no lo vio y lo corto. El paso anterior
        // no puede recuperarlo porque solo trabaja donde el modelo DUDABA
        // (0.1..0.9); aqui ya estaba en 0.
        //
        // Solo se recupera lo que la foto dice claramente que es sujeto: un
        // pixel totalmente transparente cuyo color este muy cerca del color
        // medio del sujeto, Y que tenga un vecino opaco cerca (si no, se
        // pegaria fondo lejano con un color parecido). Es conservador a
        // proposito: perder pelo es un defecto muy visible.
        const radioBusqueda = Math.max(3, Math.round(Math.min(anchoCaja, altoCaja) * 0.06));
        const umbralColor = 0.16 + (1 - fuerza) * 0.2;   // fuerza alta = mas exquisito

        // Hay un pixel que el modelo SI conserva como sujeto cerca de este?
        const cercano = (x, y) => {
            for (let dy = -radioBusqueda; dy <= radioBusqueda; dy += 2) {
                const yy = y + dy;
                if (yy < 0 || yy >= H) continue;
                for (let dx = -radioBusqueda; dx <= radioBusqueda; dx += 2) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= W) continue;
                    if (alfaTrabajo[yy * W + xx] > 0.6) return true;
                }
            }
            return false;
        };

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const i = y * W + x;
                const a = alfaTrabajo[i];
                const o = i * 4;
                const R = px[o], G = px[o+1], B = px[o+2];
                const lum = (R * 0.299 + G * 0.587 + B * 0.114) / 255;

                // --- Recuperacion de sujeto que el modelo mato ---
                if (a <= 0.1) {
                    if (fuerza < 0.25) continue;
                    const ds = Math.sqrt(
                        (R - rS[0]) * (R - rS[0]) +
                        (G - rS[1]) * (G - rS[1]) +
                        (B - rS[2]) * (B - rS[2])) / 441.67;
                    const df = Math.sqrt(
                        (R - rF[0]) * (R - rF[0]) +
                        (G - rF[1]) * (G - rF[1]) +
                        (B - rF[2]) * (B - rF[2])) / 441.67;
                    // Claramente mas parecido al sujeto que al fondo...
                    if (ds > umbralColor || ds >= df) continue;
                    // ...y pegado a algo que el modelo SI conservo como sujeto.
                    if (!cercano(x, y)) continue;
                    // Recuperacion gradual: en el borde de la zona recuperada
                    // el alfa entra suave, para que no aparezca un escalon.
                    alfaTrabajo[i] = Math.min(1, fuerza * 1.15);
                    continue;
                }
                if (a >= 0.9) continue;      // el modelo ya decidio opaco

                // Distancia normalizada a los colores de referencia.
                const dS = Math.sqrt(
                    (R - rS[0]) * (R - rS[0]) +
                    (G - rS[1]) * (G - rS[1]) +
                    (B - rS[2]) * (B - rS[2])) / 441.67;
                const dF = Math.sqrt(
                    (R - rF[0]) * (R - rF[0]) +
                    (G - rF[1]) * (G - rF[1]) +
                    (B - rF[2]) * (B - rF[2])) / 441.67;

                // Pertenencia al sujeto segun el color: 1 = sujeto, 0 = fondo.
                let porColor;
                const total2 = dS + dF;
                if (total2 < 1e-4) porColor = a;         // caso degenerado
                else porColor = dF / total2;             // cuanto mas lejos del fondo, mas sujeto

                // El pelo es oscuro sobre fondo oscuro: la luminancia sola no
                // alcanza, por eso se usa la distancia de color completa. Solo
                // si la escena tiene poco contraste de luminancia se recurre a
                // ella, porque ahi el color no aporta y la luminancia si.
                if (sepL < 0.045) {
                    porColor = (lum - sFondo) / (sepL || 1);
                    porColor = porColor < 0 ? 0 : porColor > 1 ? 1 : porColor;
                }

                // Correccion suave: solo se acerca al veredicto del color, sin
                // sustituirlo. Asi una zona dudosa por color NO fuerza el corte.
                const corregido = a + (porColor - a) * k;
                alfaTrabajo[i] = corregido < 0 ? 0 : corregido > 1 ? 1 : corregido;
            }
        }
    }

    function componerRecorte(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo, caja) {
        const lienzo = aplicarMascara(alfa, mw, mh, imagen, anchoTrabajo, altoTrabajo, caja);
        if (CFG.MATTING <= 0.001 && CFG.AFINADO <= 0.001) return lienzo;
        try {
            const ctx = lienzo.getContext('2d', { willReadFrequently: true });
            const img = ctx.getImageData(0, 0, anchoTrabajo, altoTrabajo);
            const px = img.data;
            const total = anchoTrabajo * altoTrabajo;
            const aTrabajo = new Float32Array(total);
            for (let i = 0; i < total; i++) aTrabajo[i] = px[i * 4 + 3] / 255;

            // Primero el matteado por color, que es el que recupera el pelo;
            // despues el afilado fino del halo, que solo pica la ultima franja.
            mattearConFoto(px, aTrabajo, anchoTrabajo, altoTrabajo, CFG.MATTING);
            if (CFG.AFINADO > 0.001) {
                afinarConFoto(px, aTrabajo, anchoTrabajo, altoTrabajo, CFG.AFINADO);
            }

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

            // El lado de entrada lo decide el modelo que este activo. El worker
            // avisa cual quedo si tuvo que bajar al estandar por falta de memoria.
            // El lado de entrada lo DECIDE el worker, que es quien sabe que modelo quedo
            // activo (puede haber bajado al estandar). Antes se adivinaba aqui
            // con un 320 fijo y, con un modelo que pide 512, se mandaba un buffer
            // de 320: el recorte salia vacio sin dar ningun error.
            const ladoModelo = window.__EKKO_LADO_ENTRADA || 512;
            const entrada = prepararEntrada(elemento, ladoModelo);
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
            // El rectangulo que la foto ocupa dentro del cuadrado de entrada se
            // guarda para que todo recorte posterior (ajustar el borde, pincel)
            // siga con la misma correspondencia y no se vuelva a correr.
            ESTADO.caja = entrada.caja;

            const lienzo = componerRecorte(r.alfa, r.w, r.h, elemento, aw, ah, entrada.caja);

            // El Raster nuevo se crea desde la URL, no desde un canvas, para
            // que Paper no intente hornear la imagen.
            //
            // Se deja que Paper lo inserte en la capa activa. Con
            // `{ insert: false }` el item nace SIN proyecto y su `position` sale
            // en NaN de origen, y no se deja ni reasignar a mano (medido): sin
            // posicion no hay recorte visible, ni pincel, ni exportacion. La
            // contencion del mockup se resuelve DESPUES, moviendo el item ya
            // transformado al grupo del original: al moverlo, la posicion se
            // conserva (medido).
            const nueva = new paper.Raster(lienzo.toDataURL('image/png'));
            nueva.applyMatrix = false;
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

            nueva.opacity = opaOriginal;
            nueva.name = (nomOriginal || 'Imagen') + ' sin fondo';

            // La transformacion se aplica UNA sola vez, propiedad por propiedad,
            // y ANTES de mover el item al grupo de contencion.
            //
            // Primero: aplicar `matrix = raster.matrix.clone()` y despues
            // `position` hacia que el desplazamiento y la escala entraran dos
            // veces (medido: escala 5,05 contra 0,20 de la foto), y por eso el
            // pincel apuntaba a coordenadas negativas y no pintaba nada.
            try {
                nueva.scaling = escOriginal.clone();
                nueva.rotation = rotOriginal;
                nueva.position = posOriginal.clone();
            } catch (e) { ESTADO.ultimoError = e; }

            // --- CONTENCION DEL MOCKUP ---
            //
            // El recorte tiene que quedar dentro del MISMO grupo que el
            // original. Si no, se dibuja fuera del producto: el cliente lo
            // reporto como "la imagen queda por fuera de la contencion del
            // mockup".
            //
            // No alcanza con llamar a ensureContainedDesignItem al final: si el
            // item no esta ya dentro de un grupo, esa funcion lo envuelve en uno
            // NUEVO y lo manda a designLayer por debajo del mockup, con lo que
            // el recorte se separa del resto del diseno. Primero se coloca
            // junto al original y despues se verifica la contencion.
            let padreOk = false;
            try {
                const padre = raster.parent;
                if (padre && padre.insertChild) {
                    padre.insertChild(raster.index + 1, nueva);
                    padreOk = true;
                }
            } catch (e) {
                ESTADO.ultimoError = e;
            }
            if (!padreOk) {
                // El original no estaba en ningun grupo: se usa la ruta
                // canonica del resto de la app, que crea la contencion si hace
                // falta y es un no-op cuando no hay mockup.
                try {
                    if (typeof window.ensureContainedDesignItem === 'function') {
                        window.ensureContainedDesignItem(nueva);
                    }
                } catch (e) { ESTADO.ultimoError = e; }
            }

            // El grupo de contencion sigue publicando al ORIGINAL como dueño.
            // Eso hay que corregirlo, porque el recorte es ahora la pieza
            // publica y el original queda solo como copia oculta del "deshacer".
            //
            // MEDIDO: sin esto, `getPublicOwner` resolvia al original (oculto,
            // sin la marca `quitarFondoIA`), y el boton "Editar Fondo" se
            // apagaba despues de quitar el fondo. Es el mismo mecanismo que
            // usa el resto de la app: el wrapper declara su publicOwner.
            let wrapper = null;
            try {
                wrapper = nueva.parent;
                if (wrapper && wrapper.data && wrapper.data.mockupContainment) {
                    wrapper.data.publicOwner = nueva;
                    wrapper.data.publicOwnerId = nueva.id;
                    wrapper.data.transformOwnerId = nueva.id;
                    wrapper.data.label = nueva.name || wrapper.data.label;
                    nueva.data = { ...(nueva.data || {}), publicOwner: true, ownerId: nueva.id };
                }
            } catch (e) { ESTADO.ultimoError = e; }

            // Red de seguridad: la posicion nunca debe quedar en NaN. Sin
            // posicion no hay recorte visible, ni pincel, ni exportacion, y el
            // cliente no ve nada mas que un producto vacio. MEDIDO: asi fue
            // como se rompio al meter el recorte dentro de la contencion.
            try {
                if (!Number.isFinite(nueva.position.x) || !Number.isFinite(nueva.position.y)) {
                    const seguro = raster.position;
                    if (Number.isFinite(seguro.x) && Number.isFinite(seguro.y)) {
                        nueva.position = seguro.clone();
                    }
                }
            } catch (e) { ESTADO.ultimoError = e; }

            // El original se oculta, no se borra: deshacer es un clic.
            raster.visible = false;
            ESTADO.imagenProcesada = nueva;
            ESTADO.listo = true;

            // La seleccion debe CAER en el recorte, no quedarse en el original
            // oculto. Antes el cliente quedaba manipulando una pieza invisible:
            // mover BORDE funcionaba por debajo pero no se veia nada cambiar, y
            // el panel no ofrecia herramientas porque la especie del original ya
            // no era la que se estaba editando.
            // La seleccion la arma la APP, no este archivo.
                //
                // MEDIDO: si ademas se marca `nueva.selected = true` aqui,
                // quedan DOS cajas de seleccion: la del grupo de contencion
                // (198x99, el producto entero) y la del recorte (49x37). Con
                // dos cajas el arrastre no sabe cual mover y el cliente reporto
                // que no se puede arrastrar la imagen sin fondo.
                //
                // El diseno de la app es que un contenido dentro de un
                // mockup se selecciona por su GRUPO: una sola caja, la del
                // producto, y arrastrar mueve el recorte con el. Ademas la app
                // vuelve a seleccionar el grupo en su propio sincronizador, asi
                // que desmarcarlo desde aqui no servia de nada (medido).
                try {
                    paper.project.deselectAll();
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
                    ESTADO.mascara, ESTADO.mascaraAncho, ESTADO.mascaraAlto, elemento, aw, ah,
                    ESTADO.caja);
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
        elegirPincel,
        modoAsistido,
        modoManual,
        verLoQuitado,
        pintarPincel,
        deshacerRetoque,
        cerrarRetoque,
        estadoRetoque: () => ({
            activo: RETOQUE.activo,
            modo: RETOQUE.modo,
            manual: RETOQUE.manual,
            radio: RETOQUE.radio,
            verQuitado: RETOQUE.verQuitado
        }),
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
    const RETOQUE = {
        activo: false,
        modo: 'borrar',        // 'borrar' quita, 'restaurar' devuelve
        radio: 25,
        original: null,        // Uint8ClampedArray de la mascara de la IA
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
        verQuitado: false
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

    function abrirRetoque() {
        if (!ESTADO.imagenProcesada || !ESTADO.mascara) {
            avisar('Primero quitá el fondo, después retocá el recorte.', { kind: 'warn' });
            return false;
        }
        if (!RETOQUE.original) {
            RETOQUE.original = new Uint8ClampedArray(ESTADO.mascara);
        }
        const barra = document.getElementById('barra-editar-recorte');
        if (!barra) {
            avisar('No se encontró la barra de editar.', { kind: 'error' });
            return false;
        }
        RETOQUE.activo = true;

        // La barra REEMPLAZA a la contextual: ocupa su misma banda y se queda
        // sola. Antes convivan las dos con los mismos botones duplicados, y la
        // contextual seguia apareciendo encima.
        //
        // La barra tiene que quedar SIEMPRE junto a la barra contextual, no dentro
        // del contenedor del lienzo: si comparten padre comparten tambien el
        // bloque que posiciona los absolutos, y el `top` que calcula la app
        // para la contextual sirve para las dos.
        //
        // MEDIDO: con la barra dentro de #canvasContainer quedava 140 px mas
        // arriba y 260 px a la derecha (exactamente el offset del contenedor).
        // Ningun ajuste de `top` lo arregla: son containing blocks distintos.
        try {
            const ctx = document.getElementById('contextual-toolbar');
            if (ctx && ctx.parentElement && barra.parentElement !== ctx.parentElement) {
                ctx.parentElement.insertBefore(barra, ctx.nextSibling);
            }
            if (ctx) {
                const top = parseFloat(getComputedStyle(ctx).top);
                if (Number.isFinite(top)) barra.style.top = top + 'px';
            }
        } catch (_) {}
        barra.style.display = 'flex';
        barra.classList.add('ekko-visible');

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
        dibujarCapaQuitado();
        return true;
    }

    /**
     * "Deshacer" DENTRO del retoque: vuelve al recorte que dio la IA, sin
     * perder el trabajo de fondo ya hecho ni recalcular la inferencia. Es lo
     * que el cliente espera: si retoquea de más, no quiere perder la IA.
     */
    function deshacerRetoque() {
        if (!RETOQUE.original) {
            avisar('Todavía no retocaste nada.', { kind: 'info' });
            return false;
        }
        ESTADO.mascara = new Uint8ClampedArray(RETOQUE.original);
        recomponerDesdeMascara();
        dibujarCapaQuitado();
        try { if (window.saveHistory) window.saveHistory(); } catch (_) {}
        return true;
    }

    function cerrarRetoque() {
        RETOQUE.activo = false;
        RETOQUE.puntero = false;
        RETOQUE.verQuitado = false;
        const barra = document.getElementById('barra-editar-recorte');
        if (barra) { barra.style.display = 'none'; barra.classList.remove('ekko-visible'); }
        document.body.classList.remove('ekko-modo-retoque');
        salirDeVistaCompleta();
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

        // El tamaño del pincel solo existe en modo manual, igual que en
        // PhotoRoom. Mostrarlo en asistido es una promesa que el modo no
        // cumple y el cliente lo cuenta como que no funciona.
        const grupo = document.getElementById('grupo-tamano');
        if (grupo) grupo.hidden = !RETOQUE.manual;
        actualizarCursor();
    }

    /**
     * Cursor circular del pincel.
     *
     * Sin esto no se ve ni el tamaño real ni de que color se esta pintando, que
     * era la otra mitad de la queja del cliente.
     */
    function escalaMascaraAPantalla() {
        const r = imagenEnRetoque() || ESTADO.imagenProcesada;
        const m = paper && paper.view ? paper.view.matrix : null;
        if (!r || !m || !(ESTADO.mascaraAncho > 0)) return 1;
        const b = r.bounds;
        if (!b || !(b.width > 0)) return 1;
        // De un pixel de mascara a pixeles de pantalla.
        return (b.width * m.a) / ESTADO.mascaraAncho;
    }

    function actualizarCursor(ev) {
        const cur = document.getElementById('cursor-pincel');
        if (!cur) return;
        // Se muestra en LOS DOS MODOS. Antes solo aparecia en Manual, asi que
        // en Asistido el cliente no tenia ninguna referencia de que herramenta
        // estaba activa ni de cuan fina seria la pasada: lo reporto como "el
        // puntero aun no se colorea ni se muestra el tamano del pincel".
        if (!RETOQUE.activo) { cur.style.display = 'none'; cur.dataset.visible = ''; return; }
        const esc = escalaMascaraAPantalla();
        const d = Math.max(12, RETOQUE.radio * esc * 2);
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
        const opacoSemilla = m[i0] > 128;
        if (opacoSemilla !== quitar) {
            avisar(quitar
                ? 'Ahí no hay nada que borrar: tocá una parte del sujeto.'
                : 'Ahí ya está el sujeto: tocá una parte del fondo.', { kind: 'info' });
            return 0;
        }

        const tol = RETOQUE.tolerancia;
        const tol2 = tol * tol;
        const r0 = px[i0 * 4], g0 = px[i0 * 4 + 1], b0 = px[i0 * 4 + 2];
        // Radio maximo alrededor del toque. El fondo de la foto es uniforme, asi
        // que sin este tope un toque repone el fondo ENTERO (medido: 673.604
        // pixeles de una). Con el tope la accion se parece a lo que el cliente
        // quiere: reparar una zona concreta.
        const alcance = Math.max(20, RETOQUE.alcance);
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
            m[i] = quitar ? 0 : 255;

            const cr = px[i * 4], cg = px[i * 4 + 1], cb = px[i * 4 + 2];
            const dr = cr - r0, dg = cg - g0, db = cb - b0;
            if (dr * dr + dg * dg + db * db > tol2) continue;

            for (let d = 0; d < 4; d++) {
                const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
                const ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const j = ny * w + nx;
                if (visto[j]) continue;
                const oq = m[j] > 128;
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

        const cv = document.getElementById('editorCanvas');
        if (!cv || !paper.view) return null;
        const rc = cv.getBoundingClientRect();
        const m = paper.view.matrix;

        // Pantalla -> espacio del lienzo.
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
        const barra = document.getElementById('barra-editar-recorte');
        if (!barra || barra.__ekkoConectado) return;
        barra.__ekkoConectado = true;

        const b = document.getElementById('pincel-borrar');
        const r = document.getElementById('pincel-restaurar');
        const slider = document.getElementById('slider-tamano-pincel');
        const valor = document.getElementById('valor-tamano-pincel');
        const aceptar = document.getElementById('btn-aceptar-fondo');
        const deshacerBtn = document.getElementById('btn-deshacer-fondo');
        const ma = document.getElementById('modo-asistido');
        const mm = document.getElementById('modo-manual');
        const verQuitado = document.getElementById('ver-quitado');

        const elegir = (modo) => {
            RETOQUE.modo = modo;
            RETOQUE.activo = true;
            marcarPincelActivo();
            actualizarCursor();
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
        if (verQuitado) {
            verQuitado.addEventListener('click', function () {
                RETOQUE.verQuitado = !RETOQUE.verQuitado;
                verQuitado.setAttribute('aria-pressed', RETOQUE.verQuitado ? 'true' : 'false');
                verQuitado.classList.toggle('is-activo', RETOQUE.verQuitado);
                dibujarCapaQuitado();
            });
        }

        if (slider) {
            slider.addEventListener('input', function () {
                RETOQUE.radio = Number(slider.value) || 25;
                if (valor) valor.textContent = String(RETOQUE.radio);
                actualizarCursor();
            });
        }
        if (aceptar) aceptar.addEventListener('click', function () {
            // "Listo" cierra la edicion, como el check de PhotoRoom.
            cerrarRetoque();
        });
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
        //
        // OJO con donde se escucha. Se midio que el manejador de eventos de
        // EKKO detiene la propagacion en un ancestro del lienzo: el evento
        // llegaba a `document` pero NUNCA al `canvas`. Con el listener en el
        // lienzo el pincel no recibia nada y abrir el panel no producia
        // ningun efecto visible.
        //
        // Por eso se escucha en `window` en fase de captura, que es lo
        // PRIMERO que se ejecuta en toda la cadena. Se filtra por objetivo
        // para no secuestrar clics que no son del lienzo.
        const canvas = document.getElementById('editorCanvas');
        let pintando = false;

        const sobreLienzo = (ev) => {
            try { return !!(canvas && canvas.contains(ev.target)); }
            catch (_) { return false; }
        };
        const pintarEn = (ev) => {
            const p = pantallaAMascara(ev);
            if (!p) return false;
            pintarPincel(p.x, p.y);
            recomponerDesdeMascara();
            dibujarCapaQuitado();
            return true;
        };

        // Un toque en modo ASISTIDO elige la zona sola. No es un trazo: se
        // aplica una vez y se suelta, asi que va solo en pointerdown.
        const tocarAsistido = (ev) => {
            const p = pantallaAMascara(ev);
            if (!p) return false;
            if (!RETOQUE.original) RETOQUE.original = new Uint8ClampedArray(ESTADO.mascara);
            const n = marcarZonaAsistida(p.x, p.y);
            if (!n) return false;
            recomponerDesdeMascara();
            dibujarCapaQuitado();
            return true;
        };

        window.addEventListener('pointerdown', (ev) => {
            if (!RETOQUE.activo) return;
            if (!sobreLienzo(ev)) return;
            if (ev.button !== undefined && ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (!RETOQUE.manual) { tocarAsistido(ev); pintando = false; return; }
            pintarEn(ev);
            pintando = true;
        }, true);

        window.addEventListener('pointermove', (ev) => {
            if (!RETOQUE.activo || !sobreLienzo(ev)) return;
            // El cursor se mueve en LOS DOS modos. Antes en Asistido se llamaba
            // con null, sin el evento, y eso hacia que nunca recibiera posicion:
            // el circulo quedaba oculto y el cliente se quedaba sin puntero de referencia.
            actualizarCursor(ev);
            if (!pintando || !RETOQUE.manual) return;
            ev.preventDefault();
            ev.stopPropagation();
            pintarEn(ev);
        }, true);

        // Al salir del lienzo el cursor se esconde: si queda congelado en el
        // borde parece que el pincel sigue activo.
        window.addEventListener('pointerleave', () => {
            const cur = document.getElementById('cursor-pincel');
            if (cur) { cur.style.display = 'none'; cur.dataset.visible = ''; }
        }, true);
        window.addEventListener('blur', () => { pintando = false; }, true);

        const soltar = () => { pintando = false; };
        window.addEventListener('pointerup', soltar, true);
        window.addEventListener('pointercancel', soltar, true);

        // Atajos de teclado. Mientras se esta retocando el recorte, escribir
        // B/R/A/M no debe insertar texto en el editor: se intercepta antes.
        //   B  Borrar          R  Restaurar
        //   A  Asistido       M  Manual
        //   V  ver lo quitado  Esc  Listo
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
