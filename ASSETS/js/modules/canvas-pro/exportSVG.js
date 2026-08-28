/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/exportSVG.js (Industrial Laser Edition - v24.1 PRO)
   Ruta: ASSETS/js/modules/canvas-pro/exportSVG.js
   Descripción: Procesador asíncrono y exportador de SVG optimizado para LightBurn,
                LaserGRBL y maquinaria CNC. Realiza vectorización recursiva de fuentes,
                fusión física de calados CSG y purgado completo de layouts de mockup e interfaz.
   ========================================================================= */

/**
   Exporta e industrializa el diseño del lienzo convirtiendo textos a curvas,
   ejecutando las sustracciones físicas finales y removiendo todo mockup o guías.
   @returns {string} Código XML SVG limpio y listo para el grabado láser.
 */
export function prepareSVGForExport() {
    if (typeof paper === 'undefined' || !paper.project) {
        console.error("[EKKO EXPORT] Error: Paper.js no está inicializado.");
        return "";
    }

    // 1. Clonar de forma aislada la capa de diseño activa del usuario (con insert: false para no renderizarla en pantalla)
    const tempLayer = paper.project.activeLayer.clone({ insert: false });

    // 2. VECTORIZACIÓN RECURSIVA DE TIPOGRAFÍAS (Fonts-to-Paths)
    // Evita la dependencia de archivos de fuentes .woff2 o .ttf en la máquina del tógrafo/grabadora
    function vectorizeTextsRecursive(item) {
        if (!item) return;

        if (item.children) {
            // Recorrer los hijos en un array estático para poder mutar la colección sin provocar leaks
            const kids = [...item.children];
            kids.forEach(vectorizeTextsRecursive);
        }

        // Si es un PointText nativo o un texto individual en un grupo curvado/espaciado
        if (item instanceof paper.PointText || (item.className === 'PointText')) {
            try {
                // Generar los contornos cerrados del texto basándose en los glifos de Paper.js
                const compoundOutline = item.createPath({ insert: false });
                if (compoundOutline) {
                    // Traspasar con fidelidad absoluta los colores, rellenos y grosores
                    compoundOutline.fillColor = item.fillColor ? item.fillColor.clone() : new paper.Color(0);
                    compoundOutline.strokeColor = item.strokeColor ? item.strokeColor.clone() : null;
                    compoundOutline.strokeWidth = item.strokeWidth || 0;
                    
                    // Aplicar las transformaciones de escala, inclinación o rotación acumuladas localmente
                    compoundOutline.matrix = item.matrix.clone();
                    
                    // Preservar la metadata de grabado
                    compoundOutline.data = {
                        ...(item.data || {}),
                        label: "Texto Convertido (Curvas)",
                        geometricHierarchy: 'simple'
                    };
                    
                    // Sustituir en la jerarquía del clon de manera limpia
                    const parent = item.parent;
                    if (parent) {
                        parent.insertChild(item.index, compoundOutline);
                    }
                    item.remove();
                }
            } catch (err) {
                console.warn("[EKKO EXPORT WARNING] No se pudo vectorizar el texto. Se exportará como nodo de texto nativo:", err);
            }
        }
    }

    // Ejecutar vectorización sobre la capa clonada
    vectorizeTextsRecursive(tempLayer);

    // 3. RECÁLCULO FÍSICO CSG REACTIVO DE CALADOS (Stacking CSG Physics)
    // Aplica las ausencias físicas de material (isHole) sobre los sólidos inferiores antes de purgar
    if (typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions(tempLayer);
    } else {
        console.warn("[EKKO EXPORT WARNING] window.recalculateDynamicSubtractions no está definida. Es posible que el calado dinámico no se fusione físicamente.");
    }

    // 4. PURGADO INTEGRAL Y PROFUNDO DE MOCKUPS, GUIAS E INTERFAZ (Ghost-Free Layout)
    // Limpia de forma recursiva cualquier elemento ajeno al diseño útil de producción
    function purgeInterfaceAndMockupRecursive(item) {
        if (!item) return;

        if (item.children) {
            const kids = [...item.children];
            kids.forEach(purgeInterfaceAndMockupRecursive);
        }

        const data = item.data || {};
        const shouldPurge = 
            data.isHole === true ||           // Controladores de agujeros físicos (ya sustraídos)
            data.mockup === true ||           // Fondos, siluetas de productos o virolas de mockup
            data.isMask === true ||           // Máscaras de recorte auxiliares del producto
            data.isSelectionBox === true ||   // Recuadros celestes de selección WYSIWYG
            data.isHandle === true ||         // Tiradores de rotación y escala de la UI
            data.isSmartGuide === true ||     // Líneas rosa de guías inteligentes de alineación
            data.isMeasurement === true ||    // Acotaciones y cotas de tamaño en milímetros (Cotas)
            data.isTracePreview === true ||   // Polígonos de previsualización del trazado en vivo
            data.isNodeEditOverlay === true || // Líneas y círculos de edición de puntos de anclaje
            data.isGuide === true ||          // Guías rojas de Canva-Style para espaciado
            data.isWatermark === true ||      // Marcas de agua administrativas
            (window.currentMockup && item.id === window.currentMockup.id) || // ID directo del mockup cargado
            (item instanceof paper.PointText && item.content === window.EKKO_CONFIG?.seguridad?.watermarkText); // Validación redundante de marca de agua por literal

        if (shouldPurge) {
            item.remove();
        }
    }

    // Purgar toda la capa clonada recursivamente
    purgeInterfaceAndMockupRecursive(tempLayer);

    // 5. UNIFICACIÓN DE CLIP-GROUPS (Flattening Masks)
    // Si quedan grupos que eran máscaras (clipGroups) de elementos que ya no existen, liberar su modo clip
    tempLayer.children.forEach(item => {
        if (item && item.data && item.data.clipGroup) {
            item.clipped = false; // Desvincular recorte para que la grabadora acceda a las geometrías limpias
        }
    });

    // 6. EXPORTACIÓN NATIVA A SVG
    // Generar el XML de Paper.js aplicando un formato de alta precisión para evitar pérdidas de coordenadas
    const svgString = tempLayer.exportSVG({ 
        asString: true,
        bounds: 'content', // Ajustar el viewBox estrictamente a los límites del diseño útil
        precision: 5       // 5 decimales de precisión vectorial para grabado micrométrico
    });

    // 7. DESTRUCCIÓN Y LIBERACIÓN DE MEMORIA DEL LIENZO TEMPORAL
    tempLayer.remove();

    console.log("[EKKO EXPORT SUCCESS] El diseño vectorial ha sido industrializado de forma exitosa y está limpio de layouts visuales.");
    return svgString;
}

if (typeof window !== 'undefined') {
    window.prepareSVGForExport = prepareSVGForExport;
}
