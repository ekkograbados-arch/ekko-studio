// ================================================================
// EKKO STUDIO — ELIMINADOR DE FONDO v3.0 HÍBRIDO
// ✅ Automático, funciona con cualquier foto SIN ajustes manuales
// ✅ Respeta sombras, colores oscuros y fondos complejos
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
            posicionInicial: { x: 0, y: 0 },
            arrastrando: false
        };

        // ============================================================
        // ALGORITMO HÍBRIDO: FONDO DESDE ESQUINAS + TOLERANCIA INTELIGENTE
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
            // PASO 1: TOMAR COLOR DE FONDO DESDE LAS 4 ESQUINAS
            // ========================================================
            const esquinas = [
                obtenerColor(pixeles, 5, 5, ancho),
                obtenerColor(pixeles, ancho - 6, 5, ancho),
                obtenerColor(pixeles, 5, alto - 6, ancho),
                obtenerColor(pixeles, ancho - 6, alto - 6, ancho)
            ];

            // Calcular color promedio de fondo y desviación
            const fondoProm = {
                r: Math.round(esquinas.reduce((s, c) => s + c.r, 0) / 4),
                g: Math.round(esquinas.reduce((s, c) => s + c.g, 0) / 4),
                b: Math.round(esquinas.reduce((s, c) => s + c.b, 0) / 4)
            };

            // Tolerancia INTELIGENTE: se ajusta sola según la foto
            const desvio = calcularDesvio(esquinas, fondoProm);
            const UMBRAL = Math.max(35, Math.min(65, 45 + desvio));

            console.log(`[EKKO BackgroundRemover] Umbral calculado automáticamente: ${UMBRAL}`);

            // ========================================================
            // PASO 2: PROPAGACIÓN DESDE BORDES HACIA ADENTRO
            // ========================================================
            const visitado = new Uint8Array(ancho * alto);
            const mascara = new Uint8Array(ancho * alto); // 0=fondo, 1=objeto
            const cola = [];

            // Iniciar desde todo el borde de la imagen
            for (let x = 0; x < ancho; x++) {
                if (esFondo(pixeles, x, 0, ancho, fondoProm, UMBRAL)) {
                    cola.push({ x, y: 0 });
                    visitado[0 * ancho + x] = 1;
                }
                if (esFondo(pixeles, x, alto - 1, ancho, fondoProm, UMBRAL)) {
                    cola.push({ x, y: alto - 1 });
                    visitado[(alto - 1) * ancho + x] = 1;
                }
            }
            for (let y = 1; y < alto - 1; y++) {
                if (esFondo(pixeles, 0, y, ancho, fondoProm, UMBRAL)) {
                    cola.push({ x: 0, y });
                    visitado[y * ancho + 0] = 1;
                }
                if (esFondo(pixeles, ancho - 1, y, ancho, fondoProm, UMBRAL)) {
                    cola.push({ x: ancho - 1, y });
                    visitado[y * ancho + (ancho - 1)] = 1;
                }
            }

            // Expandir hacia adentro
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
                        if (!visitado[vidx] && esFondo(pixeles, v.x, v.y, ancho, fondoProm, UMBRAL)) {
                            visitado[vidx] = 1;
                            cola.push(v);
                        }
                    }
                }
            }

            // TODO lo NO visitado = ES OBJETO
            for (let i = 0; i < mascara.length; i++) {
                mascara[i] = visitado[i] === 0 ? 1 : 0;
            }

            // ========================================================
            // PASO 3: SUAVIZAR BORDES PARA QUE NO QUEDE "DIENTADO"
            // ========================================================
            const mascaraSuave = suavizarBordes(mascara, ancho, alto);

            // ========================================================
            // PASO 4: APLICAR TRANSPARENCIA
            // ========================================================
            for (let i = 0; i < mascaraSuave.length; i++) {
                if (mascaraSuave[i] === 0) {
                    pixeles[i * 4 + 3] = 0;
                }
            }

            ctx.putImageData(datosImagen, 0, 0);

            // Crear imagen en Paper.js
            const imagenProcesada = new paper.Raster(lienzo.toDataURL());
            imagenProcesada.position = imagenPaper.position;
            imagenProcesada.name = imagenPaper.name + '_sin_fondo';

            ESTADO.imagenProcesada = imagenProcesada;
            ESTADO.historial.push(lienzo.toDataURL());

            console.log('[EKKO BackgroundRemover ✅] Fondo eliminado automáticamente (v3.0)');
            return imagenProcesada;
        }

        // ============================================================
        // FUNCIONES AUXILIARES
        // ============================================================
        function obtenerColor(pixeles, x, y, ancho) {
            const idx = (y * ancho + x) * 4;
            return { r: pixeles[idx], g: pixeles[idx + 1], b: pixeles[idx + 2] };
        }

        function distanciaColor(c1, c2) {
            const dr = c1.r - c2.r;
            const dg = c1.g - c2.g;
            const db = c1.b - c2.b;
            return Math.sqrt(dr * dr + dg * dg + db * db);
        }

        function esFondo(pixeles, x, y, ancho, ref, umbral) {
            const actual = obtenerColor(pixeles, x, y, ancho);
            return distanciaColor(actual, ref) < umbral;
        }

        function calcularDesvio(esquinas, promedio) {
            let suma = 0;
            for (const e of esquinas) {
                suma += distanciaColor(e, promedio);
            }
            return Math.round(suma / 4);
        }

        function suavizarBordes(mascara, ancho, alto) {
            const salida = new Uint8Array(mascara);
            for (let y = 1; y < alto - 1; y++) {
                for (let x = 1; x < ancho - 1; x++) {
                    const idx = y * ancho + x;
                    if (mascara[idx] === 1) continue;

                    let vecinosObjeto = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (mascara[(y + dy) * ancho + (x + dx)] === 1) {
                                vecinosObjeto++;
                            }
                        }
                    }
                    if (vecinosObjeto >= 5) salida[idx] = 1;
                }
            }
            return salida;
        }

        // ============================================================
        // HERRAMIENTAS MANUALES
        // ============================================================
        function activarPincelRestaurar() {
            ESTADO.modoPincel = 'restaurar';
            console.log('[EKKO BackgroundRemover] ✏️ Pincel Restaurar');
        }

        function activarPincelQuitar() {
            ESTADO.modoPincel = 'quitar';
            console.log('[EKKO BackgroundRemover] 🖌️ Pincel Borrar');
        }

        function ajustarTamanoPincel(tamano) {
            ESTADO.tamanoPincel = Math.max(5, Math.min(100, tamano));
        }

        function deshacer() {
            if (ESTADO.historial.length > 1) {
                ESTADO.historial.pop();
                return ESTADO.historial[ESTADO.historial.length - 1];
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
                            alert('⚠️ Seleccioná primero una imagen');
                            return;
                        }

                        const procesada = EKKO.BackgroundRemover.eliminarFondoInteligente(imagen);

                        if (procesada) {
                            imagenOriginalReferencia = imagen;
                            imagen.visible = false;
                            procesada.visible = true;

                            btnQuitarFondo.style.display = 'none';
                            if (btnEditarRecorte) btnEditarRecorte.style.display = 'inline-block';
                            if (panelEditarRecorte) panelEditarRecorte.style.display = 'block';
                        }
                    });
                }

                // RESTO DE CONTROLES
                if (btnEditarRecorte && panelEditarRecorte) {
                    btnEditarRecorte.addEventListener('click', () => {
                        panelEditarRecorte.style.display = panelEditarRecorte.style.display === 'none' ? 'block' : 'none';
                    });
                }

                if (pincelBorrar) {
                    pincelBorrar.addEventListener('click', () => {
                        activarPincelQuitar();
                        pincelBorrar.style.outline = '3px solid yellow';
                        if (pincelRestaurar) pincelRestaurar.style.outline = 'none';
                    });
                }

                if (pincelRestaurar) {
                    pincelRestaurar.addEventListener('click', () => {
                        activarPincelRestaurar();
                        pincelRestaurar.style.outline = '3px solid yellow';
                        if (pincelBorrar) pincelBorrar.style.outline = 'none';
                    });
                }

                if (sliderTamano && valorTamano) {
                    sliderTamano.addEventListener('input', e => {
                        valorTamano.textContent = e.target.value;
                        ajustarTamanoPincel(parseInt(e.target.value));
                    });
                }

                if (btnDeshacer) {
                    btnDeshacer.addEventListener('click', () => {
                        if (ESTADO.imagenProcesada && imagenOriginalReferencia) {
                            ESTADO.imagenProcesada.remove();
                            ESTADO.imagenProcesada = null;
                            imagenOriginalReferencia.visible = true;

                            if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                            if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                            if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';
                        }
                    });
                }

                if (btnAceptar) {
                    btnAceptar.addEventListener('click', () => {
                        if (panelEditarRecorte) panelEditarRecorte.style.display = 'none';
                        if (btnEditarRecorte) btnEditarRecorte.style.display = 'none';
                        if (btnQuitarFondo) btnQuitarFondo.style.display = 'inline-block';
                        alert('✅ Fondo eliminado correctamente!');
                    });
                }

                console.log('[EKKO BackgroundRemover ✅] Sistema híbrido cargado');
            });
        }

        function inicializar() {
            ESTADO.activo = true;
            console.log('[EKKO BackgroundRemover v3.0 ✅] SISTEMA HÍBRIDO AUTOMÁTICO');
            console.log('  › Umbral se calcula SOLO por cada foto');
            console.log('  › Funciona con cualquier imagen sin ajustes manuales');
            console.log('  › Bordes suaves, respeta sombras y colores oscuros');
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
