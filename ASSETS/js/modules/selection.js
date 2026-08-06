window.selectedItem = null; 
window.dragOffset = null; 

/* ========================= SELECCIÓN DE OBJETO ========================= */ 
window.getSelectableItem = function(item){ 
 if(!item) return null; 
 if (item.data && item.data.mockup) return null; 
 
 let current = item; 
 while (current) { 
   if (current.data) { 
     if (current.data.mockup) return null; // Si es parte del mockup de fondo, no es seleccionable
     if (current.data.clipGroup) { 
       return current; // Retornamos el grupo recortado
     } 
   } 
   
   // SEGURIDAD: Si llegamos al nivel de la capa de dibujo activa, nos detenemos para NO seleccionar el lienzo entero
   if (current.parent instanceof paper.Layer || current.parent === paper.project.activeLayer) { 
     return current; 
   } 
   
   if (current.parent) { 
     current = current.parent; 
   } else { 
     break; 
   } 
 } 
 return current; 
}; 

/* ========================= SELECT ========================= */ 
window.selectItem = function(item){ 
 if(window.selectedItem){ 
   window.selectedItem.selected = false; 
 } 
 window.selectedItem = item; 
 if(!item){ 
   paper.view.update(); 
   return; 
 } 
 if(item.data && item.data.mockup){ 
   item.selected = false; 
   paper.view.update(); 
   return; 
 } 
 item.selected = true; 
 paper.view.update(); 
}; 

/* ========================= DESELECT ========================= */ 
window.deselectItem = function(){ 
 if(window.selectedItem){ 
   window.selectedItem.selected = false; 
 } 
 window.selectedItem = null; 
 paper.view.update(); 
};
Bajá al final de la página, hacé clic en el botón verde Commit changes... (Confirmar cambios) y guardalo.
Paso 2: Crear el lector automático de fuentes (Eliminar el error 404 de consola)
Este paso creará el puente para que Vercel lea automáticamente tu carpeta de tipografías sin errores en consola:
Volvé a la página principal de tu repositorio de GitHub haciendo clic en la palabra ekko-studio arriba.
Hacé clic en el botón Add file (Agregar archivo) arriba a la derecha y elegí Create new file (Crear nuevo archivo).
En el cuadro para el nombre, escribí exactamente: api/fonts.js (GitHub creará automáticamente la carpeta api al escribir la barra /).
Pegá el siguiente código adentro del archivo (es el conector oficial de Vercel para leer carpetas de manera automática):
const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const fontsDir = path.join(process.cwd(), 'ASSETS', 'fonts');
    if (!fs.existsSync(fontsDir)) {
      return res.status(200).json([]);
    }
    const files = fs.readdirSync(fontsDir);
    const fonts = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ext === '.ttf' || ext === '.otf' || ext === '.woff' || ext === '.woff2';
      })
      .map(file => {
        const nameWithoutExt = path.basename(file, path.extname(file));
        const family = 'ekko_' + nameWithoutExt.toLowerCase().replace(/[^a-z0-9]/g, '_');
        return {
          name: nameWithoutExt,
          family: family,
          file: file
        };
      });
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate');
    return res.status(200).json(fonts);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
