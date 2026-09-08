// ================================================================
// EKKO STUDIO — ELIMINADOR DE FONDO CON IA LOCAL (BRIA RMBG)
// ✅ Modelo compatible cargado
// ✅ Resolución reducida 512x512 = más rápido, sin saturar gráfica
// ✅ Formato de tensor corregido
// ✅ La foto NO viaja afuera, sin costo, sin límites
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
        // CARGAR EL MODELO DE IA
        // ============================================================
        async function cargarModelo() {
            if (ESTADO.modeloCargado) return true;

            try {
                console.log('[EKKO IA] Cargando modelo de inteligencia artificial...');

                if (!window.ort) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }

                ESTADO.sesion = await ort.InferenceSession.create(
                    'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx',
                    { 
                        executionProviders: ['wasm'], // ✅ Usamos WASM = más estable, no se pierde contexto
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
        // ELIMINAR FONDO CON IA — VERSIÓN CORREGIDA
        // ============================================================
        async function eliminarFondoInteligente(imagenPaper) {
            if (!imagenPaper) {
                console.warn('[EKKO] No hay imagen seleccionada');
                return null;
            }

            ESTADO.imagenOriginal = imagenPaper;

            // Guardar posición y tamaño ORIGINALES para conservarlos
            const posOriginal = imagenPaper.position;
            const tamOriginal = imagenPaper.size;
            const rotOriginal = imagenPaper.rotation;
            const escOriginal = imagenPaper.scaling;
            const opaOriginal = imagenPaper.opacity;
            const nombreOriginal = imagenPaper.name;

            if (!ESTADO.modeloCargado) {
                const cargado = await cargarModelo();
                if (!cargado) return null;
            }

            console.log('[EKKO IA] Procesando imagen...');
            alert('⏳ Procesando con IA... Esto puede tardar unos segundos.');

            const bounds = imagenPaper.bounds;
            const ancho = Math.round(bounds.width);
            const alto = Math.round(bounds.height);

            const lienzo = document.createElement('canvas');
            const ctx = lienzo.getContext('2d');
            lienzo.width = ancho;
            lienzo.height = alto;
            ctx.drawImage(imagenPaper.getElement(), 0, 0, ancho, alto);

            // ✅ USAMOS 512x512 = MÁS RÁPIDO, MENOS MEMORIA, CALIDAD EXCELENTE
            const tamañoModelo = 512;
            const lienzoRedim = document.createElement('canvas');
            lienzoRedim.width = tamañoModelo;
            lienzoRedim.height = tamañoModelo;
            const ctxRedim = lienzoRedim.getContext('2d');
            ctxRedim.drawImage(lienzo, 0, 0, tamañoModelo, tamañoModelo);

            const datosImg = ctxRedim.getImageData(0, 0, tamañoModelo, tamañoModelo).data;

            // ✅ FORMATO CORREGIDO: [1, 3, 512, 512] = coincide con lo que espera el modelo
            const datosEntrada = new Float32Array(3 * tamañoModelo * tamañoModelo);
            for (let i = 0; i < datosImg.length; i += 4) {
                const idx = i / 4;
                datosEntrada[idx] = (datosImg[i] / 255.0 - 0.5) / 1.0;                     // R
                datosEntrada[idx + tamañoModelo * tamañoModelo] = (datosImg[i + 1] / 255.0 - 0.5) / 1.0; // G
                datosEntrada[idx + 2 * tamañoModelo * tamañoModelo] = (datosImg[i + 2] / 255.0 - 0.5) / 1.0; // B
            }

            // ✅ Ejecutar IA con forma correcta
            const entrada = new ort.Tensor('float32', datosEntrada, [1, 3, tamañoModelo, tamañoModelo]);
            const resultado = await ESTADO.sesion.run({ input: entrada });
            const mascara = resultado[ESTADO.sesion.outputNames[0]];

            // ✅ Aplicar máscara redimensionada al tamaño original
            const datosSalida = ctx.getImageData(0, 0, ancho, alto);
            const arrMascara = mascara.data;

            for (let y = 0; y < alto; y++) {
                for (let x = 0; x < ancho; x++) {
                    const escalaX = (x + 0.5) / ancho;
                    const escalaY = (y + 0.5) / alto;
                    const mx = Math.max(0, Math.min(tamañoModelo - 1, Math.floor(escalaX * tamañoModelo)));
                    const my = Math.max(0, Math.min(tamañoModelo - 1, Math.floor(escalaY * tamañoModelo)));
                    const valorMascara = arrMascara[my * tamañoModelo + mx];

                    const idx = (y * ancho + x) * 4;
                    datosSalida.data[idx + 3] = Math.max(0, Math.min(255, Math.round(valorMascara * 255)));
                }
            }

            ctx.putImageData(datosSalida, 0, 0);

            // ✅ Crear imagen conservando TODO igual
            const imagenProcesada = new paper.Raster(lienzo.toDataURL('image/png'));
            imagenProcesada.position = posOriginal;
            imagenProcesada.size = tamOriginal;
            imagenProcesada.rotation = rotOriginal;
            imagenProcesada.scaling = escOriginal;
            imagenProcesada.opacity = opaOriginal;
            imagenProcesada.name = nombreOriginal + '_sin_fondo';

            imagenPaper.visible = false;

            ESTADO.imagenProcesada = imagenProcesada;
            console.log('[EKKO IA ✅] Fondo eliminado correctamente');
            alert('✅ Fondo eliminado con Inteligencia Artificial!');

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

                if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';

                if (btnQuitarFondo) {
                    btnQuitarFondo.addEventListener('click', async function () {
                        const seleccion = paper.project.selectedItems;
                        const imagen = seleccion.find(item => item instanceof paper.Raster);

                        if (!imagen) {
                            alert('⚠️ Seleccioná primero una imagen');
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

                console.log('[EKKO BackgroundRemover ✅] IA Local BRIA cargada (versión final)');
            });
        }

        function inicializar() {
            ESTADO.activo = true;
            console.log('[EKKO BackgroundRemover v5.2 ✅] INTELIGENCIA ARTIFICIAL — Versión Final');
            console.log('  › Resolución 512x512 = más rápido y estable');
            console.log('  › Usa WASM en lugar de WebGL = no se pierde contexto');
            console.log('  › Formato de tensor corregido');
            console.log('  › Sin costo, sin cuentas, sin límites');
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
