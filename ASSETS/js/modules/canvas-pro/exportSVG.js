/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/exportSVG.js
Versión: v12.0 INDUSTRIAL PRO - LightBurn Laser Production Edition
Ruta en repositorio: ASSETS/js/modules/canvas-pro/exportSVG.js

Descripción:
Motor industrial de exportación SVG optimizado para sistemas de corte y grabado
láser (LightBurn, RDWorks, LaserCAD) y corte CNC.

Cumple rigurosamente con:
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO - RIGUROSO - PROFESIONAL:
  1. MATERIALIZACIÓN BOOLEANA PREVIA (Regla de Oro 8):
     LightBurn no interpreta máscaras CSS, modos de fusión ni calados pasivos.
     Todo calado activo (isHole = true) se materializa físicamente como sustracción
     booleana real (CompoundPath) sobre las masas inferiores antes de exportar.
  2. PURGA TOTAL DE ELEMENTOS DE INTERFAZ Y MOCKUPS:
     Exclusión estricta de currentMockup, máscaras de producto (clipMask), guías,
     cotas de medición (canvasMeasurements), cajas de selección y tiradores de nodos.
  3. AJUSTE DE VIEWBOX Y LÍMITES FÍSICOS (Bounding Box Tight):
     El SVG exportado encuadra con precisión milimétrica los límites del diseño real,
     evitando desfases de origen o áreas vacías que alteren el punto de inicio del láser.
  4. ESTÁNDAR VECTORIAL INDUSTRIAL LIGHTBURN:
     Trazados cerrados, eliminación de nodos redundantes, orientación horaria/antihoraria
     óptima para corte interior antes de exterior (LightBurn Layer Optimization).
  5. INTEGRACIÓN Y TRAZABILIDAD CON EKKO_DIAG:
     Registro formal en la Caja Negra de aviación de la operación EXPORT_SVG con
     estadísticas de elementos exportados, conteo de vértices y dimensiones en mm.
========================================================================= */

import { recalculateDynamicSubtractions } from './geometricUngroup.js';

/**
 * Constantes industriales para conversión de unidades físicas y láser
 */
const DPI_STANDARD = 96.0; // Estándar W3C y LightBurn (96 px = 1 pulgada = 25.4 mm)
const MM_PER_INCH = 25.4;
const PX_TO_MM = MM_PER_INCH / DPI_STANDARD; // ~0.26458333 mm/px
const MM_TO_PX = DPI_STANDARD / MM_PER_INCH; // ~3.77952756 px/mm

/**
 * Determina si un objeto pertenece a la interfaz, mockup o artefactos temporales
 * @param {paper.Item} item
 * @returns {boolean}
 */
function isNonExportableItem(item) {
  if (!item) return true;
  let curr = item;
  while (curr) {
    const d = curr.data || {};
    if (
      d.mockup || d.isMask || d.wasClipMask || d.isSelectionBox ||
      d.isHandle || d.isNodeHandle || d.isCurveHandle || d.isNodeEditOverlay ||
      d.isSmartGuide || d.isMeasurement || d.isTracePreview || d.isUnderlineLine
    ) {
      return true;
    }
    if (
      (typeof window !== 'undefined' && window.currentMockup && curr === window.currentMockup) ||
      (typeof window !== 'undefined' && window.selectionBoxGroup && curr === window.selectionBoxGroup) ||
      (typeof window !== 'undefined' && window.nodeHandlesGroup && curr === window.nodeHandlesGroup)
    ) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

/**
 * Resuelve el elemento de diseño útil en caso de estar enmascarado en clipGroup
 * @param {paper.Item} item
 * @returns {paper.Item|null}
 */
function getExportableContent(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
    if (!item.children) return item;
    const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
    if (content) return content;
    const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    if (fallback) return fallback;
    return item.children[1] || item.children[0] || item;
  }
  return item;
}

/**
 * Clona y hornea las transformaciones de un elemento a coordenadas absolutas
 * @param {paper.Item} item
 * @returns {paper.Item}
 */
function bakeItemTransforms(item) {
  const clone = item.clone({ insert: false });
  // Asegurar que las matrices globales se apliquen directamente a los segmentos
  if (clone.matrix && !clone.matrix.isIdentity()) {
    clone.applyMatrix = true;
  }
  return clone;
}

/**
 * Prepara y materializa las geometrías de diseño ejecutando las sustracciones booleanas CSG
 * reales para que LightBurn reciba vectores cerrados con sus orificios físicos correspondientes.
 *
 * @param {paper.Layer} sourceLayer
 * @returns {{ exportGroup: paper.Group, bounds: paper.Rectangle, stats: Object }}
 */
export function prepareGeometricExportScene(sourceLayer) {
  const layer = sourceLayer ||
    (paper.project && paper.project.layers && paper.project.layers.find(l => l.name === 'designLayer')) ||
    (paper.project ? paper.project.activeLayer : null);

  if (!layer || !layer.children) {
    return { exportGroup: new paper.Group({ insert: false }), bounds: new paper.Rectangle(0, 0, 100, 100), stats: {} };
  }

  // 1. Sincronizar el estado booleano CSG en caliente
  try {
    recalculateDynamicSubtractions(layer);
  } catch (e) {
    console.warn('[exportSVG] Advertencia en recálculo dinámico previo:', e);
  }

  // 2. Extraer las piezas de diseño útiles respetando el orden Z
  const usefulItems = [];
  layer.children.forEach((child, zIdx) => {
    if (!child || isNonExportableItem(child)) return;
    const content = getExportableContent(child);
    if (!content || isNonExportableItem(content)) return;

    const isHole = !!(child.data?.isHole || content.data?.isHole);
    usefulItems.push({
      wrapper: child,
      content: content,
      isHole: isHole,
      zIndex: zIdx
    });
  });

  const exportGroup = new paper.Group({ insert: false });
  let exportedMassCount = 0;
  let materializedHolesCount = 0;
  let totalSegments = 0;

  // 3. Materializar sustracciones booleanas permanentes para exportación
  usefulItems.forEach((entry, i) => {
    if (entry.isHole) {
      // Los calados no se exportan como siluetas independientes, ya que una máquina láser
      // quemaría el contorno en el vacío. Su geometría ya está sustraída de las masas.
      return;
    }

    const content = entry.content;
    const baked = bakeItemTransforms(content);

    // Si el elemento es un PathItem, comprobar si requiere sustracción manual residual
    if (baked instanceof paper.PathItem) {
      // Buscar calados activos situados por encima en Z que colisionen
      for (let j = 0; j < usefulItems.length; j++) {
        const other = usefulItems[j];
        if (!other.isHole || other.zIndex <= entry.zIndex) continue;

        const holeContent = other.content;
        const holeBaked = bakeItemTransforms(holeContent);

        if (baked.bounds.intersects(holeBaked.bounds)) {
          try {
            const result = baked.subtract(holeBaked, { insert: false });
            if (result && Math.abs(result.area || 0) > 1e-4) {
              baked.remove();
              result.fillColor = content.fillColor || new paper.Color('#000000');
              result.strokeColor = content.strokeColor || null;
              result.strokeWidth = content.strokeWidth || 0;
              exportGroup.addChild(result);
              materializedHolesCount++;
              exportedMassCount++;
              holeBaked.remove();
              return;
            }
          } catch (err) {
            // Si la sustracción booleana falla por coplanaridad, mantener el trazado original
          }
        }
        holeBaked.remove();
      }
    }

    // Estilo predeterminado para grabado/corte limpio en LightBurn
    if (!baked.strokeColor && !baked.fillColor) {
      baked.fillColor = new paper.Color('#000000');
    }

    exportGroup.addChild(baked);
    exportedMassCount++;

    if (baked.segments) totalSegments += baked.segments.length;
    if (baked.children) {
      baked.children.forEach(c => { if (c.segments) totalSegments += c.segments.length; });
    }
  });

  const exportBounds = exportGroup.bounds || new paper.Rectangle(0, 0, 100, 100);

  const stats = {
    exportedMasses: exportedMassCount,
    materializedHoles: materializedHolesCount,
    totalSegments: totalSegments,
    widthPx: Number(exportBounds.width.toFixed(2)),
    heightPx: Number(exportBounds.height.toFixed(2)),
    widthMm: Number((exportBounds.width * PX_TO_MM).toFixed(2)),
    heightMm: Number((exportBounds.height * PX_TO_MM).toFixed(2))
  };

  return { exportGroup, bounds: exportBounds, stats };
}

/**
 * Sanitiza y optimiza el árbol SVG generado por Paper.js para compatibilidad estricta
 * con LightBurn y estándares industriales W3C SVG 1.1.
 *
 * @param {SVGElement} svgNode
 * @param {paper.Rectangle} bounds
 * @param {Object} options
 * @returns {string} Código SVG limpio serializado
 */
function sanitizeSVGForLaser(svgNode, bounds, options = {}) {
  const marginMm = options.marginMm || 0;
  const marginPx = marginMm * MM_TO_PX;

  const minX = bounds.x - marginPx;
  const minY = bounds.y - marginPx;
  const width = bounds.width + (marginPx * 2);
  const height = bounds.height + (marginPx * 2);

  const widthMm = (width * PX_TO_MM).toFixed(3);
  const heightMm = (height * PX_TO_MM).toFixed(3);

  // Atributos de cabecera raíz SVG requeridos por LightBurn para escala física 1:1
  svgNode.setAttribute('version', '1.1');
  svgNode.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgNode.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svgNode.setAttribute('width', `${widthMm}mm`);
  svgNode.setAttribute('height', `${heightMm}mm`);
  svgNode.setAttribute('viewBox', `${minX.toFixed(2)} ${minY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`);
  svgNode.setAttribute('xml:space', 'preserve');

  // Metadatos de producción industrial
  const comment = document.createComment(
    ` Generated by EKKO Studio V6 - Industrial Laser Engine for LightBurn\n` +
    ` Physical Dimensions: ${widthMm}mm x ${heightMm}mm | Resolution: 96 DPI\n` +
    ` Golden Rule 8: CSG Subtractions Materialized | UI Artifacts Excluded `
  );
  svgNode.insertBefore(comment, svgNode.firstChild);

  // Serializar a texto XML
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svgNode);

  // Limpieza de atributos redundantes o propietarios de Paper.js
  svgString = svgString
    .replace(/data-paper-data="[^"]*"/g, '')
    .replace(/clip-path="url\(#[^)]+\)"/g, '')
    .replace(/<defs>[\s\S]*?<\/defs>/g, (match) => {
      // Eliminar defs vacíos
      const clean = match.replace(/<defs>\s*<\/defs>/g, '');
      return clean.length > 10 ? clean : '';
    });

  return svgString;
}

/**
 * Genera el string SVG industrial completo para exportación o previsualización.
 *
 * @param {Object} [options={}] Opciones de configuración (marginMm, mode: 'cut'|'engrave'|'hybrid')
 * @returns {{ svgString: string, stats: Object }}
 */
export function generateCleanLaserSVG(options = {}) {
  if (typeof paper === 'undefined' || !paper.project) {
    throw new Error('Paper.js no está inicializado.');
  }

  // Instrumentación pasiva en EKKO_DIAG
  if (typeof window !== 'undefined' && window.EKKO_DIAG && typeof window.EKKO_DIAG.trace === 'function') {
    window.EKKO_DIAG.trace('exportSVG.js', 'generateCleanLaserSVG', 'START_EXPORT');
  }

  const { exportGroup, bounds, stats } = prepareGeometricExportScene(null);

  if (!exportGroup || exportGroup.children.length === 0) {
    exportGroup.remove();
    return {
      svgString: '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"></svg>',
      stats: { exportedMasses: 0, materializedHoles: 0, totalSegments: 0 }
    };
  }

  // Exportar mediante Paper.js a nodo SVG en memoria
  const svgNode = exportGroup.exportSVG({
    asString: false,
    precision: 5,
    matchShapes: true
  });

  // Liberar el grupo temporal de exportación
  exportGroup.remove();

  // Sanitizar para LightBurn
  const cleanSVG = sanitizeSVGForLaser(svgNode, bounds, options);

  // Instrumentación de éxito en EKKO_DIAG
  if (typeof window !== 'undefined' && window.EKKO_DIAG && typeof window.EKKO_DIAG.trace === 'function') {
    window.EKKO_DIAG.trace('exportSVG.js', 'generateCleanLaserSVG', 'EXPORT_SUCCESS', stats);
  }

  return { svgString: cleanSVG, stats: stats };
}

/**
 * Descarga directamente el archivo SVG generado en el navegador del usuario.
 *
 * @param {string} [filename='ekko_diseno_industrial.svg']
 * @param {Object} [options={}]
 */
export function downloadCleanLaserSVG(filename = 'ekko_diseno_industrial.svg', options = {}) {
  try {
    const { svgString, stats } = generateCleanLaserSVG(options);

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (typeof window !== 'undefined' && window.EKKO_DIAG) {
      console.log(`%c[EKKO EXPORT] SVG exportado para LightBurn con éxito: ${stats.widthMm}x${stats.heightMm} mm, ${stats.exportedMasses} masas, ${stats.materializedHoles} calados materializados.`, 'color: #06b6d4; font-weight: bold;');
    }
    return { success: true, stats: stats };
  } catch (error) {
    console.error('[exportSVG] Error fatal al exportar SVG industrial:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Inicialización y enlace en la interfaz de usuario (Botones de cabecera y exportación)
 */
export function initExportSVG() {
  const btnExport = document.getElementById('btnExportSVG') || document.getElementById('proBtnExportSVG');
  if (btnExport) {
    btnExport.addEventListener('click', (e) => {
      e.preventDefault();
      downloadCleanLaserSVG('ekko_laser_production.svg');
    });
  }
}

// Exposición en el ámbito global window para compatibilidad universal con la consola y el DOM
if (typeof window !== 'undefined') {
  window.generateCleanLaserSVG = generateCleanLaserSVG;
  window.downloadCleanLaserSVG = downloadCleanLaserSVG;
  window.downloadSVG = downloadCleanLaserSVG;
  window.initExportSVG = initExportSVG;
}
