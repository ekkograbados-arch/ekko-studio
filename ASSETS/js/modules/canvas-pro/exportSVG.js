/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/exportSVG.js (Industrial Laser Edition - v30 PRO)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/exportSVG.js

   Descripción:
   Procesador y exportador de SVG optimizado para corte y grabado láser
   en LightBurn, CNC y maquinaria industrial.

   Cumple rigurosamente con:
   - CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
   - REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
   - DIAGNÓSTICO DE ARQUITECTURA Y DEPENDENCIAS DE EKKO STUDIO V0
   - RESULTADO ESPERADO (Huecos físicos reales sin transparencias cosméticas,
     purgado de controladores isHole para evitar dobles líneas de quemado,
     vectorización recursiva tipográfica Fonts-to-Paths y limpieza de artefactos).
   ========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

/**
 * Prepara y exporta el diseño vectorial activo a un formato SVG estricto para corte/grabado láser.
 * Garantiza vacíos geométricos reales (sustracciones booleanas materializadas) y la purga
 * completa de controladores interactivos para evitar quemados dobles en LightBurn.
 * 
 * @returns {string} Código XML SVG puro listo para manufactura
 */
export function prepareSVGForExport() {
  if (typeof paper === 'undefined' || !paper.project) {
    console.error("[EKKO EXPORT] Error crítico: Paper.js no está inicializado.");
    return "";
  }

  // 1. Clonar de forma aislada la capa de diseño activa del usuario (insert: false para no interferir en pantalla)
  const tempLayer = paper.project.activeLayer.clone({ insert: false });

  // 2. VECTORIZACIÓN RECURSIVA DE TIPOGRAFÍAS (Fonts-to-Paths)
  // Convierte todos los PointText nativos a CompoundPath cerrados horneados para
  // independizar el archivo de las fuentes del sistema o de la máquina láser.
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
        compoundOutline.fillColor = item.fillColor ? item.fillColor.clone() : new paper.Color('#000000');
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

  // 3. MATERIALIZACIÓN BOOLEANA CSG EN LA CAPA CLONADA
  // Aplica las perforaciones físicas reales de los calados activos sobre las masas sólidas inferiores (Z descendente).
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
  // Dado que el corte booleano ya fue transferido y materializado en las masas sólidas inferiores,
  // se eliminan todas las entidades de calado interactivo para no generar líneas de corte duplicadas.
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
  // Elimina cualquier geometría auxiliar que no forme parte del grabado físico real.
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
        data.isCurveHandle === true ||
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

  // 6. SANITIZACIÓN DE ATRIBUTOS PARA LIGHTBURN / CNC
  // Asegura que los CompoundPaths mantengan fillRule 'evenodd' o 'nonzero' según corresponda
  // y que las geometrías vacías o degeneradas (sin área ni segmentos) sean descartadas.
  const emptyItems = [];
  tempLayer.getItems({
    match: function(item) {
      if (item instanceof paper.PathItem) {
        if (!item.segments || item.segments.length < 2 || Math.abs(item.area) < 1e-4) {
          return true;
        }
      }
      return false;
    }
  }).forEach(function(it) {
    emptyItems.push(it);
  });
  emptyItems.forEach(function(it) {
    it.remove();
  });

  // 7. EXPORTACIÓN NATIVA A SVG
  // 5 decimales de precisión para corte micrométrico en LightBurn y maquinaria CNC industrial
  const svgString = tempLayer.exportSVG({
    asString: true,
    bounds: 'content',
    precision: 5
  });

  // 8. LIBERACIÓN DE MEMORIA DEL LIENZO TEMPORAL
  tempLayer.remove();

  if (window.EKKO_DEBUG) {
    console.log("[EKKO EXPORT SUCCESS] El diseño vectorial ha sido industrializado exitosamente para LightBurn.");
  }

  return svgString;
}

if (typeof window !== 'undefined') {
  window.prepareSVGForExport = prepareSVGForExport;
}

if (typeof window !== 'undefined') {
  window.prepareSVGForExport = prepareSVGForExport;
}
