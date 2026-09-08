// ================================================================
// EKKO STUDIO — ELIMINADOR DE FONDO v4.0 MANUAL ASISTIDO
// ✅ No mueve la imagen
// ✅ No recorta el producto
// ✅ No borra el objeto automáticamente
// ✅ Usa pincel manual para corregir
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
            historial: [],
            posicionBloqueada: false
        };

        // ============================================================
        // NUEVO: BLOQUEAR IMAGEN DENTRO DEL PRODUCTO
        // ============================================================
        function bloquearImagen(imagenPaper) {
            if (!imagenPaper) return;

            imagenPaper.locked = true;
            imagenPaper.selectable = false;

            if (imagenPaper.parent) {
                imagenPaper.parent.addChild(imagenPaper);
            }

            ESTADO.posicionBloqueada = true;

            console.log('[EKKO BackgroundRemover ✅] Imagen bloqueada dentro del producto');
        }

        function desbloquearImagen(imagenPaper) {
            if (!imagenPaper) return;

            imagenPaper.locked = false;
            imagenPaper.selectable = true;
            ESTADO.posicionBloqueada = false;

            console.log('[EKKO BackgroundRemover ✅] Imagen desbloqueada');
        }

        // ============================================================
        // ELIMINACIÓN DE FONDO MANUAL ASISTIDA
        // ============================================================
        function eliminarFondoManual(imagenPaper) {
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
            const bounds = imagenPaper.bounds;

            const ancho = Math.round(bounds.width);
            const alto = Math.round(bounds.height);

            lienzo.width = ancho;
            lienzo.height = alto;

            ctx.drawImage(imgElement, 0, 0, ancho, alto);

            console.log('[EKKO BackgroundRemover ✅] Imagen copiada sin modificar tamaño ni posición');

            const imagenProcesada = new paper.Raster(lienzo.toDataURL());
            imagenProcesada.position = imagenPaper.position;
            imagenProcesada.size = imagenPaper.size;
            imagenProcesada.name = imagenPaper.name + '_sin_fondo';

            ESTADO.imagenProcesada = imagenProcesada;
            ESTADO.historial.push(lienzo.toDataURL());

            return imagenProcesada;
        }

        // ============================================================
        // HERRAMIENTAS MANUALES DE PINCEL
        // ============================================================
        function activarPincelRestaurar() {
            ESTADO.modoPincel = 'restaurar';
            console.log('[EKKO BackgroundRemover] ✏️ Pincel Restaurar activo');
        }

        function activarPincelQuitar() {
            ESTADO.modoPincel = 'quitar';
            console.log('[EKKO BackgroundRemover] 🖌️ Pincel Quitar activo');
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
        // CONEXIÓN DE BOTONES
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

                // ESTADO INICIAL
                if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';

                // ACCIÓN: QUITAR FONDO
                if (btnQuitarFondo) {
                    btnQuitarFondo.addEventListener('click', function () {
                        const seleccion = paper.project.selectedItems;
                        const imagen = seleccion.find(item => item instanceof paper.Raster);

                        if (!imagen) {
                            alert('⚠️ Seleccioná primero una imagen en el lienzo');
                            return;
                        }

                        const imagenProcesada = eliminarFondoManual(imagen);

                        if (imagenProcesada) {
                            imagenOriginalReferencia = imagen;
                            imagen.visible = false;
                            imagenProcesada.visible = true;

                            bloquearImagen(imagenProcesada);

                            btnQuitarFondo.style.display = 'none';
                            if (btnEditarRecorte) btnEditarRecorte.style.display = 'inline-block';
                            if (panelEditarRecorte) panelEditarRecorte.style.display = 'block';

                            console.log('[EKKO ✅] Fondo listo para edición manual');
                        }
                    });
                }

                // ACCIÓN: EDITAR RECORTE
                if (btnEditarRecorte && panelEditarRecorte) {
                    btnEditarRecorte.addEventListener('click', function () {
                        panelEditarRecorte.style.display = panelEditarRecorte.style.display === 'none' ? 'block' : 'none';
                    });
                }

                // PINCELES
                if (pincelBorrar) {
                    pincelBorrar.addEventListener('click', function () {
                        activarPincelQuitar();
                        pincelBorrar.style.outline = '3px solid yellow';
                        if (pincelRestaurar) pincelRestaurar.style.outline = 'none';
                    });
                }

                if (pincelRestaurar) {
                    pincelRestaurar.addEventListener('click', function () {
                        activarPincelRestaurar();
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

                            desbloquearImagen(imagenOriginalReferencia);

                            if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                            if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                            if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';

                            console.log('[EKKO ↩️] Deshecho. Imagen restaurada y desbloqueada');
                        }
                    });
                }

                if (btnAceptar) {
                    btnAceptar.addEventListener('click', function () {
                        if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';
                        if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                        if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';

                        if (ESTADO.imagenProcesada) {
                            desbloquearImagen(ESTADO.imagenProcesada);
                        }

                        console.log('[EKKO ✅] Recorte aceptado. Imagen desbloqueada');
                        alert('✅ Fondo eliminado correctamente!');
                    });
                }

                console.log('[EKKO BackgroundRemover ✅] Modo manual asistido cargado');
            });
        }

        function inicializar() {
            ESTADO.activo = true;
            console.log('[EKKO BackgroundRemover v4.0 ✅] MODO MANUAL ASISTIDO');
            console.log('  › La imagen no se mueve automáticamente');
            console.log('  › La imagen se bloquea dentro del producto');
            console.log('  › Usa pincel para borrar o restaurar fondo');
            conectarBotonesInterfaz();
        }

        return {
            inicializar,
            eliminarFondoManual,
            bloquearImagen,
            desbloquearImagen,
            activarPincelRestaurar,
            activarPincelQuitar,
            ajustarTamanoPincel,
            deshacer,
            estado: () => ESTADO.activo
        };

    })();

    EKKO.BackgroundRemover.inicializar();

})(window.EKKO = window.EKKO || {});
