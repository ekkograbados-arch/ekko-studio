// ================================================================
// EKKO STUDIO — ELIMINADOR DE FONDO CON IA LOCAL (BRIA RMBG)
// ✅ Versión CORREGIDA con modelo compatible con ONNX v11
// ✅ Corre en el navegador del cliente → la foto NO viaja afuera
// ✅ $0 costo, sin límites, sin cuentas, sin API Keys
// ✅ Calidad cercana a Photoroom
// ✅ Conserva posición, tamaño y propiedades de la imagen
// ================================================================

(function (EKKO, undefined) {
    'use strict';

    EKKO.BackgroundRemover = (function () {

        const ESTADO = {
            activo: false,
            imagenOriginal: null,
            imagenProcesada: null,
            modeloCargado: false,
            sesion: null
        };

        // ============================================================
        // CARGAR EL MODELO DE IA (BRIA RMBG - VERSIÓN COMPATIBLE)
        // ============================================================
        async function cargarModelo() {
            if (ESTADO.modeloCargado) return true;

            try {
                console.log('[EKKO IA] Cargando modelo de inteligencia artificial...');

                // Cargar librería ONNX Runtime Web
                if (!window.ort) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }

                // ✅ USAMOS VERSIÓN SIN CUANTIZAR = COMPATIBLE CON TODOS LOS NAVEGADORES
                ESTADO.sesion = await ort.InferenceSession.create(
                    'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx',
                    { 
                        executionProviders: ['webgl', 'wasm'],
                        graphOptimizationLevel: 'all'
                    }
                );

                ESTADO.modeloCargado = true;
                console.log('[EKKO IA ✅] Modelo cargado y listo');
                return true;
            } catch (err) {
                console.error('[EKKO IA ❌ Error cargando modelo]:', err);
                alert('⚠️ No se pudo cargar la IA. Revisá tu conexión y volvé a intentar.');
                return false;
            }
        }

        // ============================================================
        // ELIMINAR FONDO CON IA
        // ============================================================
        async function eliminarFondoInteligente(imagenPaper) {
            if (!imagenPaper) {
                console.warn('[EKKO] No hay imagen seleccionada');
                return null;
            }

            ESTADO.imagenOriginal = imagenPaper;

            // Guardar TODAS las propiedades para conservarlas
            const posOriginal = imagenPaper.position;
            const tamOriginal = imagenPaper.size;
            const rotOriginal = imagenPaper.rotation;
            const escOriginal = imagenPaper.scaling;
            const opaOriginal = imagenPaper.opacity;
            const nombreOriginal = imagenPaper.name;

            // Cargar modelo si no está cargado
            if (!ESTADO.modeloCargado) {
                const cargado = await cargarModelo();
                if (!cargado) return null;
            }

            console.log('[EKKO IA] Procesando imagen...');
            alert('⏳ Procesando con Inteligencia Artificial... Esto puede tardar unos segundos.');

            // Obtener datos de la imagen
            const bounds = imagenPaper.bounds;
            const ancho = Math.round(bounds.width);
            const alto = Math.round(bounds.height);

            const lienzo = document.createElement('canvas');
            const ctx = lienzo.getContext('2d');
            lienzo.width = ancho;
            lienzo.height = alto;
            ctx.drawImage(imagenPaper.getElement(), 0, 0, ancho, alto);

            // Preparar imagen para la IA (tamaño estándar 1024x1024)
            const tamañoObjetivo = [1024, 1024];
            const lienzoRedim = document.createElement('canvas');
            lienzoRedim.width = tamañoObjetivo[0];
            lienzoRedim.height = tamañoObjetivo[1];
            const ctxRedim = lienzoRedim.getContext('2d');
            ctxRedim.drawImage(lienzo, 0, 0, tamañoObjetivo[0], tamañoObjetivo[1]);

            const datosImg = ctxRedim.getImageData(0, 0, tamañoObjetivo[0], tamañoObjetivo[1]).data;

            // Convertir a formato que espera la IA (RGB normalizado)
            const datosEntrada = new Float32Array(3 * tamañoObjetivo[0] * tamañoObjetivo[1]);
            for (let i = 0; i < datosImg.length; i += 4) {
                const idx = i / 4;
                datosEntrada[idx] = (datosImg[i] / 255.0 - 0.5) / 1.0; // R
                datosEntrada[idx + tamañoObjetivo[0] * tamañoObjetivo[1]] = (datosImg[i + 1] / 255.0 - 0.5) / 1.0; // G
                datosEntrada[idx + 2 * tamañoObjetivo[0] * tamañoObjetivo[1]] = (datosImg[i + 2] / 255.0 - 0.5) / 1.0; // B
            }

            // Ejecutar la IA
            const entrada = new ort.Tensor('float32', datosEntrada, [1, 3, tamañoObjetivo[0], tamañoObjetivo[1]]);
            const resultado = await ESTADO.sesion.run({ input: entrada });
            const mascara = resultado[ESTADO.sesion.outputNames[0]];

            // Aplicar máscara de transparencia
            const datosSalida = ctx.getImageData(0, 0, ancho, alto);
            const arrMascara = mascara.data;

            for (let y = 0; y < alto; y++) {
                for (let x = 0; x < ancho; x++) {
                    const escalaX = x / ancho;
                    const escalaY = y / alto;
                    const mx = Math.max(0, Math.min(tamañoObjetivo[0] - 1, Math.floor(escalaX * tamañoObjetivo[0])));
                    const my = Math.max(0, Math.min(tamañoObjetivo[1] - 1, Math.floor(escalaY * tamañoObjetivo[1])));
                    const valorMascara = arrMascara[my * tamañoObjetivo[0] + mx];

                    const idx = (y * ancho + x) * 4;
                    datosSalida.data[idx + 3] = Math.max(0, Math.min(255, Math.round(valorMascara * 255)));
                }
            }

            ctx.putImageData(datosSalida, 0, 0);

            // Crear imagen nueva conservando TODO igual
            const imagenProcesada = new paper.Raster(lienzo.toDataURL('image/png'));
            imagenProcesada.position = posOriginal;
            imagenProcesada.size = tamOriginal;
            imagenProcesada.rotation = rotOriginal;
            imagenProcesada.scaling = escOriginal;
            imagenProcesada.opacity = opaOriginal;
            imagenProcesada.name = nombreOriginal + '_sin_fondo';

            // Ocultar original
            imagenPaper.visible = false;

            ESTADO.imagenProcesada = imagenProcesada;
            console.log('[EKKO IA ✅] Fondo eliminado por Inteligencia Artificial');
            alert('✅ Fondo eliminado correctamente con IA!');

            return imagenProcesada;
        }

        // ============================================================
        // DESHACER
        // ============================================================
        function deshacer() {
            if (ESTADO.imagenProcesada) {
                ESTADO.imagenProcesada.remove();
                ESTADO.imagenProcesada = null;
            }
            if (ESTADO.imagenOriginal) {
                ESTADO.imagenOriginal.visible = true;
            }
            console.log('[EKKO ↩️] Deshecho. Imagen restaurada.');
        }

        // ============================================================
        // CONEXIÓN DE BOTONES
        // ============================================================
        function conectarBotonesInterfaz() {
            document.addEventListener('DOMContentLoaded', function () {
                const btnQuitarFondo = document.getElementById('btnCtxRemoveBg');
                const btnEditarRecorte = document.getElementById('btnCtxEditCutout');
                const panelEditarRecorte = document.getElementById('panel-editar-recorte');
                const btnDeshacer = document.getElementById('btn-deshacer-fondo');
                const btnAceptar = document.getElementById('btn-aceptar-fondo');

                let imagenOriginalReferencia = null;

                // ESTADO INICIAL
                if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';

                // ACCIÓN: QUITAR FONDO CON IA
                if (btnQuitarFondo) {
                    btnQuitarFondo.addEventListener('click', async function () {
                        const seleccion = paper.project.selectedItems;
                        const imagen = seleccion.find(item => item instanceof paper.Raster);

                        if (!imagen) {
                            alert('⚠️ Seleccioná primero una imagen en el lienzo');
                            return;
                        }

                        imagenOriginalReferencia = imagen;
                        const procesada = await EKKO.BackgroundRemover.eliminarFondoInteligente(imagen);

                        if (procesada) {
                            btnQuitarFondo.style.display = 'none';
                            if (btnEditarRecorte) btnEditarRecorte.style.display = 'inline-block';
                            if (panelEditarRecorte) panelEditarRecorte.style.display = 'block';
                        }
                    });
                }

                // RESTO DE CONTROLES
                if (btnEditarRecorte && panelEditarRecorte) {
                    btnEditarRecorte.addEventListener('click', function () {
                        panelEditarRecorte.style.display = panelEditarRecorte.style.display === 'none' ? 'block' : 'none';
                    });
                }

                if (btnDeshacer) {
                    btnDeshacer.addEventListener('click', function () {
                        deshacer();
                        if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                        if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                        if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';
                    });
                }

                if (btnAceptar) {
                    btnAceptar.addEventListener('click', function () {
                        if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';
                        if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                        if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                        alert('✅ Imagen lista!');
                    });
                }

                console.log('[EKKO BackgroundRemover ✅] IA Local BRIA cargada (versión compatible)');
            });
        }

        function inicializar() {
            ESTADO.activo = true;
            console.log('[EKKO BackgroundRemover v5.1 ✅] INTELIGENCIA ARTIFICIAL LOCAL — Versión Compatible');
            console.log('  › La IA corre en la computadora del cliente');
            console.log('  › La foto NO se envía a servidores externos');
            console.log('  › Sin costo, sin límites, sin cuentas');
            console.log('  › Modelo compatible con todos los navegadores');
            conectarBotonesInterfaz();
        }

        return {
            inicializar,
            eliminarFondoInteligente,
            deshacer,
            estado: () => ESTADO.activo
        };

    })();

    EKKO.BackgroundRemover.inicializar();

})(window.EKKO = window.EKKO || {});
