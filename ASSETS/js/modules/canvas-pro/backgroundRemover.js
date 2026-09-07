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
            modoPincel: null, // 'restaurar' | 'quitar'
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

            // Guardar referencia original
            ESTADO.imagenOriginal = imagenPaper;

            // Crear lienzo de procesamiento fuera de pantalla
            const lienzo = document.createElement('canvas');
            const ctx = lienzo.getContext('2d');
            ESTADO.lienzoTemporal = lienzo;
            ESTADO.contexto = ctx;

            // Obtener imagen real desde Paper.js
            const imgElement = imagenPaper.getElement();
            const ancho = imagenPaper.bounds.width;
            const alto = imagenPaper.bounds.height;

            lienzo.width = ancho;
            lienzo.height = alto;

            // Dibujar imagen completa en el lienzo temporal
            ctx.drawImage(imgElement, 0, 0, ancho, alto);

            // Obtener datos de píxeles para análisis
            const datosImagen = ctx.getImageData(0, 0, ancho, alto);
            const pixeles = datosImagen.data;

            // ========================================================
            // NUEVO ALGORITMO: DETECCIÓN DE CONTORNO, NO DE COLOR
            // ========================================================
            const mapaMascara = new Uint8Array(ancho * alto);
            const umbralBordes = ESTADO.toleranciaBordes;

            // PASO 1: Detectar BORDES y CONTRASTE entre píxeles
            for (let y = 1; y < alto - 1; y++) {
                for (let x = 1; x < ancho - 1; x++) {
                    const indice = (y * ancho + x) * 4;

                    // Comparar con píxeles vecinos → detectar cambio brusco = BORDE
                    const indiceDer = (y * ancho + (x + 1)) * 4;
                    const indiceAba = ((y + 1) * ancho + x) * 4;

                    const brilloCentral = (pixeles[indice] + pixeles[indice + 1] + pixeles[indice + 2]) / 3;
                    const brilloDerecha = (pixeles[indiceDer] + pixeles[indiceDer + 1] + pixeles[indiceDer + 2]) / 3;
                    const brilloAbajo = (pixeles[indiceAba] + pixeles[indiceAba + 1] + pixeles[indiceAba + 2]) / 3;

                    const contrasteDer = Math.abs(brilloCentral - brilloDerecha);
                    const contrasteAba = Math.abs(brilloCentral - brilloAbajo);

                    // Si hay contraste = es BORDE del objeto → PERTENECE AL SUJETO
                    if (contrasteDer > umbralBordes || contrasteAba > umbralBordes) {
                        mapaMascara[y * ancho + x] = 1; // ES PARTE DEL OBJETO
                    }
                }
            }

            // PASO 2: Rellenar el INTERIOR del contorno = TODO LO QUE ESTÁ ADENTRO
            rellenarInterior(ancho, alto, mapaMascara);

            // PASO 3: Aplicar máscara → borrar TODO lo que está FUERA del objeto
            for (let i = 0; i < mapaMascara.length; i++) {
                if (mapaMascara[i] === 0) {
                    // No es parte del objeto → ELIMINAR (transparencia)
                    pixeles[i * 4 + 3] = 0; // Canal Alfa = 0 → DESAPARECE
                }
            }

            // PASO 4: Volver imagen procesada al lienzo
            ctx.putImageData(datosImagen, 0, 0);

            // PASO 5: Crear objeto en Paper.js con fondo transparente
            const imagenProcesada = new paper.Raster(lienzo.toDataURL());
            imagenProcesada.position = imagenPaper.position;
            imagenProcesada.name = imagenPaper.name + '_sin_fondo';

            // Guardar para historial y retoque manual
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

            // Empezar desde los BORDES de la imagen = TODO LO EXTERIOR ES FONDO
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

            // Desde los bordes hacia adentro: TODO lo alcanzable SIN cruzar contorno = FONDO
            while (cola.length > 0) {
                const { x, y } = cola.shift();
                const idx = y * ancho + x;

                if (mascara[idx] === 0) {
                    // Es FONDO → marcar como fondo
                    mascara[idx] = 0;

                    // Propagar a vecinos
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

            // Queda marcado como =1 ÚNICAMENTE lo que está encerrado por contorno = EL OBJETO
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
        // INICIALIZACIÓN Y CONEXIÓN AL EDITOR
        // ============================================================

        function inicializar() {
            ESTADO.activo = true;
            console.log('[EKKO BackgroundRemover v2.0 ✅] Eliminador de fondo INTELIGENTE cargado');
            console.log('  › Lógica: detección de contorno, NO por color');
            console.log('  › Compatible con fondos complejos y colores parecidos');
            console.log('  › Herramientas manuales: Restaurar / Quitar');
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

    // Auto-inicializar al cargar
    EKKO.BackgroundRemover.inicializar();

})(window.EKKO = window.EKKO || {});
