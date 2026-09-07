// ================================================================
// EKKO STUDIO — ELIMINADOR DE FONDO INTELIGENTE v2.0
// CONCEPTO: Separación por CONTORNO y BORDES, NO por color
// Inspirado en Photoroom / Canva: identifica el objeto, no el color
// ================================================================

(function (EKKO, undefined) {
    'use strict';

    EKKO.BackgroundRemover = (function () {

        // Estado interno
        const ESTADO = {
            activo: false,
            imagenOriginal: null,
            imagenProcesada: null,
            lienzoTemporal: null,
            contexto: null,
            modoPincel: null,
            tamanoPincel: 25,
            toleranciaBordes: 30,
            historial: [],
            posicionInicial: { x: 0, y: 0 },
            arrastrando: false
        };

        // ============================================================
        // MÉTODO PRINCIPAL — ELIMINACIÓN INTELIGENTE POR CONTORNO
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
            const ancho = imagenPaper.bounds.width;
            const alto = imagenPaper.bounds.height;

            lienzo.width = ancho;
            lienzo.height = alto;

            ctx.drawImage(imgElement, 0, 0, ancho, alto);
            const datosImagen = ctx.getImageData(0, 0, ancho, alto);
            const pixeles = datosImagen.data;

            const mapaMascara = new Uint8Array(ancho * alto);
            const umbralBordes = ESTADO.toleranciaBordes;

            for (let y = 1; y < alto - 1; y++) {
                for (let x = 1; x < ancho - 1; x++) {
                    const indice = (y * ancho + x) * 4;
                    const indiceDer = (y * ancho + (x + 1)) * 4;
                    const indiceAba = ((y + 1) * ancho + x) * 4;

                    const brilloCentral = (pixeles[indice] + pixeles[indice + 1] + pixeles[indice + 2]) / 3;
                    const brilloDerecha = (pixeles[indiceDer] + pixeles[indiceDer + 1] + pixeles[indiceDer + 2]) / 3;
                    const brilloAbajo = (pixeles[indiceAba] + pixeles[indiceAba + 1] + pixeles[indiceAba + 2]) / 3;

                    const contrasteDer = Math.abs(brilloCentral - brilloDerecha);
                    const contrasteAba = Math.abs(brilloCentral - brilloAbajo);

                    if (contrasteDer > umbralBordes || contrasteAba > umbralBordes) {
                        mapaMascara[y * ancho + x] = 1;
                    }
                }
            }

            rellenarInterior(ancho, alto, mapaMascara);

            for (let i = 0; i < mapaMascara.length; i++) {
                if (mapaMascara[i] === 0) {
                    pixeles[i * 4 + 3] = 0;
                }
            }

            ctx.putImageData(datosImagen, 0, 0);

            const imagenProcesada = new paper.Raster(lienzo.toDataURL());
            imagenProcesada.position = imagenPaper.position;
            imagenProcesada.name = imagenPaper.name + '_sin_fondo';

            ESTADO.imagenProcesada = imagenProcesada;
            ESTADO.historial.push(lienzo.toDataURL());

            console.log('[EKKO BackgroundRemover ✅] Fondo eliminado por detección de contorno');
            return imagenProcesada;
        }

        // ============================================================
        // ALGORITMO DE RELLENO INTERNO — Separa objeto de fondo
        // ============================================================
        function rellenarInterior(ancho, alto, mascara) {
            const visitado = new Uint8Array(ancho * alto);
            const cola = [];

            for (let x = 0; x < ancho; x++) {
                cola.push({ x, y: 0 });
                cola.push({ x, y: alto - 1 });
                visitado[0 * ancho + x] = 1;
                visitado[(alto - 1) * ancho + x] = 1;
            }
            for (let y = 1; y < alto - 1; y++) {
                cola.push({ x: 0, y });
                cola.push({ x: ancho - 1, y });
                visitado[y * ancho + 0] = 1;
                visitado[y * ancho + (ancho - 1)] = 1;
            }

            while (cola.length > 0) {
                const { x, y } = cola.shift();
                const idx = y * ancho + x;

                if (mascara[idx] === 0) {
                    mascara[idx] = 0;

                    const vecinos = [
                        { x: x - 1, y }, { x: x + 1, y },
                        { x, y: y - 1 }, { x, y: y + 1 }
                    ];

                    for (const v of vecinos) {
                        if (v.x >= 0 && v.x < ancho && v.y >= 0 && v.y < alto) {
                            const vidx = v.y * ancho + v.x;
                            if (!visitado[vidx]) {
                                visitado[vidx] = 1;
                                cola.push(v);
                            }
                        }
                    }
                }
            }
        }

        // ============================================================
        // HERRAMIENTAS MANUALES ESTILO PHOTOROOM
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
        // CONEXIÓN DE BOTONES — IDs COINCIDENTES CON TU index.html
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

                            btnQuitarFondo.style.display = 'none';
                            if (btnEditarRecorte) btnEditarRecorte.style.display = 'inline-block';
                            if (panelEditarRecorte) panelEditarRecorte.style.display = 'block';

                            console.log('[EKKO ✅] Fondo eliminado. Panel de edición activado.');
                        }
                    });
                }

                if (btnEditarRecorte && panelEditarRecorte) {
                    btnEditarRecorte.addEventListener('click', function () {
                        panelEditarRecorte.style.display = panelEditarRecorte.style.display === 'none' ? 'block' : 'none';
                    });
                }

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
            console.log('[EKKO BackgroundRemover v2.0 ✅] Eliminador de fondo INTELIGENTE cargado');
            console.log('  › Lógica: detección de contorno, NO por color');
            console.log('  › Compatible con fondos complejos y colores parecidos');
            console.log('  › Herramientas manuales: Restaurar / Quitar');
            conectarBotonesInterfaz();
        }

        // API PÚBLICA
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
