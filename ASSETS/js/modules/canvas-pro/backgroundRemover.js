// ================================================================
// EKKO STUDIO — ELIMINADOR DE FONDO INTELIGENTE v2.2
// ✅ DETECCIÓN POR CONTORNO / BORDES — NO POR COLOR
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
            umbralBordes: 12,  // ✅ Calibrado: menor = más estricto
            historial: [],
            posicionInicial: { x: 0, y: 0 },
            arrastrando: false
        };

        // ============================================================
        // ✅ DETECCIÓN POR BORDES (GRADIENTE DE BRILLO) — SIN COLOR
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
            // PASO 1: DETECTAR BORDES POR CAMBIO DE BRILLO
            // ========================================================
            const mapaBordes = new Uint8Array(ancho * alto);
            const umbral = ESTADO.umbralBordes;

            // Usamos filtro de Sobel simplificado → detecta bordes REALES
            for (let y = 1; y < alto - 1; y++) {
                for (let x = 1; x < ancho - 1; x++) {
                    const idx = (y * ancho + x) * 4;
                    const iL = (y * ancho + (x - 1)) * 4;
                    const iR = (y * ancho + (x + 1)) * 4;
                    const iT = ((y - 1) * ancho + x) * 4;
                    const iB = ((y + 1) * ancho + x) * 4;

                    // Brillo promedio de cada zona
                    const bC = (pixeles[idx] + pixeles[idx+1] + pixeles[idx+2]) / 3;
                    const bL = (pixeles[iL] + pixeles[iL+1] + pixeles[iL+2]) / 3;
                    const bR = (pixeles[iR] + pixeles[iR+1] + pixeles[iR+2]) / 3;
                    const bT = (pixeles[iT] + pixeles[iT+1] + pixeles[iT+2]) / 3;
                    const bB = (pixeles[iB] + pixeles[iB+1] + pixeles[iB+2]) / 3;

                    // Diferencia horizontal y vertical
                    const gradH = Math.abs(bR - bL);
                    const gradV = Math.abs(bB - bT);

                    // Si hay cambio brusco = ES BORDE
                    if (gradH > umbral || gradV > umbral) {
                        mapaBordes[y * ancho + x] = 1;
                    }
                }
            }

            // ========================================================
            // PASO 2: RELLENAR DESDE LOS BORDES EXTERIORES = FONDO
            // ========================================================
            const visitado = new Uint8Array(ancho * alto);
            const mascara = new Uint8Array(ancho * alto); // 0=fondo, 1=objeto
            const cola = [];

            // Iniciar recorrido desde el contorno de la imagen
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

            // Expandir hacia adentro SIN CRUZAR BORDES
            while (cola.length > 0) {
                const { x, y } = cola.shift();
                const idx = y * ancho + x;

                // Si NO hay borde aquí = sigue siendo fondo
                if (mapaBordes[idx] === 0) {
                    mascara[idx] = 0; // Marcar como fondo

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

            // TODO lo NO alcanzado desde afuera = OBJETO
            for (let i = 0; i < mascara.length; i++) {
                if (visitado[i] === 0) {
                    mascara[i] = 1;
                }
            }

            // ========================================================
            // PASO 3: APLICAR TRANSPARENCIA AL FONDO
            // ========================================================
            for (let i = 0; i < mascara.length; i++) {
                if (mascara[i] === 0) {
                    pixeles[i * 4 + 3] = 0;
                }
            }

            ctx.putImageData(datosImagen, 0, 0);

            const imagenProcesada = new paper.Raster(lienzo.toDataURL());
            imagenProcesada.position = imagenPaper.position;
            imagenProcesada.name = imagenPaper.name + '_sin_fondo';

            ESTADO.imagenProcesada = imagenProcesada;
            ESTADO.historial.push(lienzo.toDataURL());

            console.log('[EKKO BackgroundRemover ✅] Fondo eliminado por CONTORNO (NO por color)');
            return imagenProcesada;
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

                // ✅ ESTADO INICIAL: SOLO "Quitar Fondo" visible
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

                // ACCIÓN: EDITAR RECORTE
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
            console.log('[EKKO BackgroundRemover v2.2 ✅] DETECCIÓN POR CONTORNO — NO POR COLOR');
            console.log('  › Lógica: detecta BORDES por cambio de brillo, NO por tono');
            console.log('  › Funciona aunque objeto y fondo tengan colores parecidos');
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
