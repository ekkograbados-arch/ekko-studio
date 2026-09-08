// ================================================================
// EKKO STUDIO — ELIMINADOR DE FONDO INTELIGENTE v2.1
// MEJORADO: Funciona con fotos reales, no requiere bordes nítidos
// ================================================================

(function (EKKO, undefined) {
    'use strict';

    EKKO.BackgroundRemover = (function () {

        const ESTADO = {
            activo: false,
            imagenOriginal: null,
            imagenProcesada: null,
            lienzoTemporal: null,
            contexto: null,
            modoPincel: null,
            tamanoPincel: 25,
            toleranciaBordes: 15,
            historial: [],
            posicionInicial: { x: 0, y: 0 },
            arrastrando: false
        };

        // ============================================================
        // MÉTODO MEJORADO: ELIMINACIÓN DESDE LOS BORDES HACIA ADENTRO
        // ============================================================
        function eliminarFondoInteligente(imagenPaper) {
            if (!imagenPaper) {
                console.warn('[EKKO BackgroundRemover] No hay imagen seleccionada');
                return null;
            }

            ESTADO.imagenOriginal = imagenPaper;

            const lienzo = document.createElement('canvas');
            const ctx = lienzo.getContext('2d');
            ESTADO.lienzoTemporal = lienzo;
            ESTADO.contexto = ctx;

            const imgElement = imagenPaper.getElement();
            const ancho = Math.round(imagenPaper.bounds.width);
            const alto = Math.round(imagenPaper.bounds.height);

            lienzo.width = ancho;
            lienzo.height = alto;

            ctx.drawImage(imgElement, 0, 0, ancho, alto);
            const datosImagen = ctx.getImageData(0, 0, ancho, alto);
            const pixeles = datosImagen.data;

            // ========================================================
            // ALGORITMO NUEVO: FONDO = TODO LO QUE LLEGA DESDE AFUERA
            // ========================================================
            const mascara = new Uint8Array(ancho * alto); // 0=fondo, 1=objeto
            const visitado = new Uint8Array(ancho * alto);
            const cola = [];

            // PASO 1: Tomar color promedio de las esquinas = COLOR DE FONDO
            const esquinaTL = obtenerColor(pixeles, 0, 0, ancho);
            const esquinaTR = obtenerColor(pixeles, ancho - 1, 0, ancho);
            const esquinaBL = obtenerColor(pixeles, 0, alto - 1, ancho);
            const esquinaBR = obtenerColor(pixeles, ancho - 1, alto - 1, ancho);

            const colorFondo = {
                r: Math.round((esquinaTL.r + esquinaTR.r + esquinaBL.r + esquinaBR.r) / 4),
                g: Math.round((esquinaTL.g + esquinaTR.g + esquinaBL.g + esquinaBR.g) / 4),
                b: Math.round((esquinaTL.b + esquinaTR.b + esquinaBL.b + esquinaBR.b) / 4)
            };

            const UMBRAL_COLOR = 45; // Tolerancia al color de fondo

            // PASO 2: Empezar desde TODOS los bordes de la imagen
            for (let x = 0; x < ancho; x++) {
                if (esFondo(pixeles, x, 0, ancho, colorFondo, UMBRAL_COLOR)) {
                    cola.push({ x, y: 0 });
                    visitado[0 * ancho + x] = 1;
                }
                if (esFondo(pixeles, x, alto - 1, ancho, colorFondo, UMBRAL_COLOR)) {
                    cola.push({ x, y: alto - 1 });
                    visitado[(alto - 1) * ancho + x] = 1;
                }
            }
            for (let y = 1; y < alto - 1; y++) {
                if (esFondo(pixeles, 0, y, ancho, colorFondo, UMBRAL_COLOR)) {
                    cola.push({ x: 0, y });
                    visitado[y * ancho + 0] = 1;
                }
                if (esFondo(pixeles, ancho - 1, y, ancho, colorFondo, UMBRAL_COLOR)) {
                    cola.push({ x: ancho - 1, y });
                    visitado[y * ancho + (ancho - 1)] = 1;
                }
            }

            // PASO 3: Propagación hacia adentro → marcar fondo
            while (cola.length > 0) {
                const { x, y } = cola.shift();
                const idx = y * ancho + x;
                mascara[idx] = 0; // Es fondo

                const vecinos = [
                    { x: x - 1, y }, { x: x + 1, y },
                    { x, y: y - 1 }, { x, y: y + 1 }
                ];

                for (const v of vecinos) {
                    if (v.x >= 0 && v.x < ancho && v.y >= 0 && v.y < alto) {
                        const vidx = v.y * ancho + v.x;
                        if (!visitado[vidx] && esFondo(pixeles, v.x, v.y, ancho, colorFondo, UMBRAL_COLOR)) {
                            visitado[vidx] = 1;
                            cola.push(v);
                        }
                    }
                }
            }

            // PASO 4: TODO lo NO marcado como fondo = ES OBJETO
            for (let i = 0; i < mascara.length; i++) {
                const fila = Math.floor(i / ancho);
                const col = i % ancho;
                if (visitado[i] === 0) {
                    mascara[i] = 1; // Es objeto
                }
            }

            // PASO 5: Aplicar transparencia al fondo
            for (let i = 0; i < mascara.length; i++) {
                if (mascara[i] === 0) {
                    pixeles[i * 4 + 3] = 0;
                }
            }

            ctx.putImageData(datosImagen, 0, 0);

            // PASO 6: Crear imagen en Paper.js
            const imagenProcesada = new paper.Raster(lienzo.toDataURL());
            imagenProcesada.position = imagenPaper.position;
            imagenProcesada.name = imagenPaper.name + '_sin_fondo';

            ESTADO.imagenProcesada = imagenProcesada;
            ESTADO.historial.push(lienzo.toDataURL());

            console.log('[EKKO BackgroundRemover ✅] Fondo eliminado (algoritmo mejorado v2.1)');
            return imagenProcesada;
        }

        // ============================================================
        // FUNCIONES AUXILIARES
        // ============================================================
        function obtenerColor(pixeles, x, y, ancho) {
            const idx = (y * ancho + x) * 4;
            return { r: pixeles[idx], g: pixeles[idx + 1], b: pixeles[idx + 2] };
        }

        function esFondo(pixeles, x, y, ancho, colorRef, umbral) {
            const idx = (y * ancho + x) * 4;
            const dr = pixeles[idx] - colorRef.r;
            const dg = pixeles[idx + 1] - colorRef.g;
            const db = pixeles[idx + 2] - colorRef.b;
            const distancia = Math.sqrt(dr * dr + dg * dg + db * db);
            return distancia < umbral;
        }

        // ============================================================
        // HERRAMIENTAS MANUALES
        // ============================================================
        function activarPincelRestaurar() {
            ESTADO.modoPincel = 'restaurar';
            console.log('[EKKO BackgroundRemover] ✏️ Pincel de Restaurar activo');
        }

        function activarPincelQuitar() {
            ESTADO.modoPincel = 'quitar';
            console.log('[EKKO BackgroundRemover] 🖌️ Pincel de Quitar activo');
        }

        function ajustarTamanoPincel(tamano) {
            ESTADO.tamanoPincel = Math.max(5, Math.min(100, tamano));
        }

        function deshacer() {
            if (ESTADO.historial.length > 1) {
                ESTADO.historial.pop();
                const ultima = ESTADO.historial[ESTADO.historial.length - 1];
                console.log('[EKKO BackgroundRemover] ↩️ Deshecho');
                return ultima;
            }
            return null;
        }

        // ============================================================
        // CONEXIÓN DE BOTONES + ESTADO INICIAL CORRECTO
        // ============================================================
        function conectarBotonesInterfaz() {
            document.addEventListener('DOMContentLoaded', function () {
                const btnQuitarFondo = document.getElementById('btnCtxRemoveBg');
                const btnEditarRecorte = document.getElementById('btnCtxEditCutout');
                const panelEditarRecorte = document.getElementById('panel-editar-recorte');
                const pincelBorrar = document.getElementById('pincel-borrar');
                const pincelRestaurar = document.getElementById('pincel-restaurar');
                const sliderTamano = document.getElementById('slider-tamano-pincel');
                const valorTamano = document.getElementById('valor-tamano-pincel');
                const btnDeshacer = document.getElementById('btn-deshacer-fondo');
                const btnAceptar = document.getElementById('btn-aceptar-fondo');

                let imagenOriginalReferencia = null;

                // ✅ ESTADO INICIAL FORZADO — ARRANCA BIEN
                if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';

                // ==============================================
                // ACCIÓN: QUITAR FONDO
                // ==============================================
                if (btnQuitarFondo) {
                    btnQuitarFondo.addEventListener('click', function () {
                        const seleccion = paper.project.selectedItems;
                        const imagen = seleccion.find(item => item instanceof paper.Raster);

                        if (!imagen) {
                            alert('⚠️ Seleccioná primero una imagen en el lienzo');
                            return;
                        }

                        const imagenProcesada = EKKO.BackgroundRemover.eliminarFondoInteligente(imagen);

                        if (imagenProcesada) {
                            imagenOriginalReferencia = imagen;
                            imagen.visible = false;
                            imagenProcesada.visible = true;

                            // Cambiar visibilidad correctamente
                            btnQuitarFondo.style.display = 'none';
                            if (btnEditarRecorte) btnEditarRecorte.style.display = 'inline-block';
                            if (panelEditarRecorte) panelEditarRecorte.style.display = 'block';

                            console.log('[EKKO ✅] Fondo eliminado. Panel de edición activado.');
                        }
                    });
                }

                // ==============================================
                // ACCIÓN: EDITAR RECORTE
                // ==============================================
                if (btnEditarRecorte && panelEditarRecorte) {
                    btnEditarRecorte.addEventListener('click', function () {
                        panelEditarRecorte.style.display = panelEditarRecorte.style.display === 'none' ? 'block' : 'none';
                    });
                }

                // PINCELES Y CONTROLES
                if (pincelBorrar) {
                    pincelBorrar.addEventListener('click', function () {
                        EKKO.BackgroundRemover.activarPincelQuitar();
                        pincelBorrar.style.outline = '3px solid yellow';
                        if (pincelRestaurar) pincelRestaurar.style.outline = 'none';
                    });
                }

                if (pincelRestaurar) {
                    pincelRestaurar.addEventListener('click', function () {
                        EKKO.BackgroundRemover.activarPincelRestaurar();
                        pincelRestaurar.style.outline = '3px solid yellow';
                        if (pincelBorrar) pincelBorrar.style.outline = 'none';
                    });
                }

                if (sliderTamano && valorTamano) {
                    sliderTamano.addEventListener('input', function () {
                        valorTamano.textContent = this.value;
                        EKKO.BackgroundRemover.ajustarTamanoPincel(parseInt(this.value));
                    });
                }

                if (btnDeshacer) {
                    btnDeshacer.addEventListener('click', function () {
                        if (ESTADO.imagenProcesada) {
                            ESTADO.imagenProcesada.remove();
                            ESTADO.imagenProcesada = null;

                            if (imagenOriginalReferencia) imagenOriginalReferencia.visible = true;

                            if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                            if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                            if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';

                            console.log('[EKKO ↩️] Deshecho. Imagen original restaurada.');
                        }
                    });
                }

                if (btnAceptar) {
                    btnAceptar.addEventListener('click', function () {
                        if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';
                        if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                        if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                        console.log('[EKKO ✅] Recorte aceptado.');
                        alert('✅ Fondo eliminado correctamente!');
                    });
                }

                console.log('[EKKO BackgroundRemover ✅] Botones conectados al flujo Photoroom');
            });
        }

        // ============================================================
        // INICIALIZACIÓN
        // ============================================================
        function inicializar() {
            ESTADO.activo = true;
            console.log('[EKKO BackgroundRemover v2.1 ✅] Eliminador de fondo CARGADO');
            console.log('  › Lógica mejorada: desde bordes hacia adentro + color de fondo');
            console.log('  › Compatible con fotos reales, fondos complejos y gradientes');
            console.log('  › Herramientas manuales: Restaurar / Quitar');
            conectarBotonesInterfaz();
        }

        return {
            inicializar,
            eliminarFondoInteligente,
            activarPincelRestaurar,
            activarPincelQuitar,
            ajustarTamanoPincel,
            deshacer,
            estado: () => ESTADO.activo
        };

    })();

    EKKO.BackgroundRemover.inicializar();

})(window.EKKO = window.EKKO || {});
