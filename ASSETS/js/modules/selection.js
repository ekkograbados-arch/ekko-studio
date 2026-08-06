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
