export function prepareSVGForExport() {
    const tempLayer = paper.project.activeLayer.clone({ insert: false });
    // 1. Ejecutar el ciclo de sustracción definitivo en la capa clonada
    if (typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions(tempLayer);
    }
    // 2. Eliminar físicamente los controladores invisibles de calado (isHole = true)
    const holes = tempLayer.children.filter(item => item.data?.isHole === true);
    holes.forEach(hole => hole.remove());
    // 3. Exportar el SVG procesado libre de controladores transparentes
    const svgString = tempLayer.exportSVG({ asString: true });
    tempLayer.remove();
    return svgString;
}
