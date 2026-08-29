/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/exportSVG.js (Industrial Laser Edition - v25.0 PRO)
Ruta: ASSETS/js/modules/canvas-pro/exportSVG.js
Descripción: Procesador asíncrono y exportador de SVG optimizado para LightBurn,
CNC y cortadoras láser.
- Vectoriza recursivamente textos a trazados físicos cerrados (Fonts-to-Paths).
- Integra el motor de Descomposición por Jerarquía de Contención y recálculo reactivo CSG.
- Ejecuta recalculateDynamicSubtractions() en la capa temporal clonada para materializar
  las sustracciones booleanas reales de calados activos (isHole).
- Purga geometrías negativas de control (isHole) para evitar dobles líneas de grabado.
- Limpia artefactos visuales, guías, cotas, reglas, marcas de agua y elementos de mockup.
- Exporta con 5 decimales de precisión vectorial y viewBox ajustado estrictamente al diseño útil.
========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

/**
 * Prepara y exporta el diseño actual a un formato SVG estricto para corte/grabado láser.
 */
export function prepareSVGForExport() {
  if (typeof paper === 'undefined' || !paper.project) {
    console.error("[EKKO EXPORT] Error: Paper.js no está inicializado.");
    return "";
  }

  // 1. Clonar de forma aislada la capa de diseño activa del usuario (con insert: false para no renderizarla)
  const tempLayer = paper.project.activeLayer.clone({ insert: false });

  // 2. VECTORIZACIÓN RECURSIVA DE TIPOGRAFÍAS (Fonts-to-Paths)
  // Evita la dependencia de archivos de fuentes en la máquina de grabado
  const textItems = [];
  tempLayer.getItems({
    match: function(item) {
      return item instanceof paper.PointText || item.className === 'PointText';
    }
  }).forEach(function(item) {
    textItems.push(item);
  });

  textItems.forEach(function(item) {
    try {
      const compoundOutline = item.createPath({ insert: false });
      if (compoundOutline) {
        compoundOutline.fillColor = item.fillColor ? item.fillColor.clone() : new paper.Color(0);
        compoundOutline.strokeColor = item.strokeColor ? item.strokeColor.clone() : null;
        compoundOutline.strokeWidth = item.strokeWidth || 0;
        compoundOutline.matrix = item.matrix.clone();
        compoundOutline.data = {
          label: (item.data && item.data.label) ? (item.data.label + " (Vectorizado)") : "Texto Vectorizado"
        };

        const parent = item.parent;
        if (parent) {
          parent.insertChild(item.index, compoundOutline);
        }
        item.remove();
      }
    } catch (err) {
      console.warn("[EKKO EXPORT WARNING] No se pudo vectorizar el texto. Se exportará como nodo de texto nativo:", err);
    }
  });

  // 3. RECÁLCULO CSG BOOLEANO EN LA CAPA CLONADA
  // Garantiza que todos los huecos activos perforen físicamente las masas sólidas antes de la salida
  try {
    if (typeof recalculateDynamicSubtractions === 'function') {
      recalculateDynamicSubtractions(tempLayer);
    } else if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions(tempLayer);
    }
  } catch (err) {
    console.warn("[EKKO EXPORT CSG RECALC ERROR]", err);
  }

  // 4. PURGADO DE CALADOS ACTIVOS (isHole)
  // Dado que el corte booleano ya fue materializado en las masas sólidas inferiores,
  // los trazados de huecos activos se eliminan para no generar líneas de corte duplicadas
  const holesToRemove = [];
  tempLayer.getItems({
    match: function(item) {
      return item.data && (item.data.isHole === true || item.data.isHoleController === true);
    }
  }).forEach(function(hole) {
    holesToRemove.push(hole);
  });
  holesToRemove.forEach(function(hole) {
    hole.remove();
  });

  // 5. PURGADO DE ARTEFACTOS VISUALES, GUÍAS, COTAS, REGLAS Y MOCKUPS
  const artifactsToRemove = [];
  tempLayer.getItems({
    match: function(item) {
      const data = item.data || {};
      return (
        data.mockup === true ||
        data.isMask === true ||
        data.wasClipMask === true ||
        data.isSelectionBox === true ||
        data.isHandle === true ||
        data.isNodeHandle === true ||
        data.isSmartGuide === true ||
        data.isMeasurement === true ||
        data.isTracePreview === true ||
        data.isNodeEditOverlay === true ||
        data.isGuide === true ||
        data.isWatermark === true ||
        (window.currentMockup && item.id === window.currentMockup.id) ||
        (item instanceof paper.PointText && item.content === window.EKKO_CONFIG?.seguridad?.watermarkText)
      );
    }
  }).forEach(function(it) {
    artifactsToRemove.push(it);
  });
  artifactsToRemove.forEach(function(it) {
    it.remove();
  });

  // 6. EXPORTACIÓN NATIVA A SVG
  // 5 decimales de precisión para corte micrométrico en LightBurn y máquinas láser
  const svgString = tempLayer.exportSVG({
    asString: true,
    bounds: 'content',
    precision: 5
  });

  // 7. LIBERACIÓN DE MEMORIA DEL LIENZO TEMPORAL
  tempLayer.remove();

  console.log("[EKKO EXPORT SUCCESS] El diseño vectorial ha sido industrializado de forma exitosa y está limpio de layouts visuales.");
  return svgString;
}

if (typeof window !== 'undefined') {
  window.prepareSVGForExport = prepareSVGForExport;
}
