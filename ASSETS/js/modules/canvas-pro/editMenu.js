/**
 * ASSETS/js/modules/canvas-pro/editMenu.js
 * Módulo interactivo del "Menú de Edición" al estilo LightBurn para EKKO Studio.
 * Proporciona operaciones profesionales sobre los objetos cargados por el cliente,
 * garantizando el aislamiento absoluto de los mockups fijos del producto.
 */

export function isEditableItem(item) {
    if (!item) return false;
    if (item.data) {
        if (item.data.mockup || item.data.isSelectionBox || item.data.isNodeEditOverlay || item.data.isTracePreview || item.data.isTempSelectionGroup) {
            return false;
        }
    }
    // Debe estar directamente en la capa activa o ser un grupo recortado editable
    if (item.parent === paper.project.activeLayer) {
        return true;
    }
    return false;
}

export function selectAll() {
    let editableItems = [];
    paper.project.activeLayer.children.forEach(item => {
        if (isEditableItem(item)) {
            item.selected = true;
            editableItems.push(item);
        } else {
            if (item.data && !item.data.mockup) {
                item.selected = false;
            }
        }
    });

    if (editableItems.length === 0) {
        window.deselectItem();
    } else if (editableItems.length === 1) {
        window.selectItem(editableItems[0]);
    } else {
        createTempSelectionGroup(editableItems);
    }
    paper.view.update();
}

export function invertSelection() {
    let activeLayer = paper.project.activeLayer;
    let currentlySelected = [];
    
    // Si hay un grupo de selección temporal activo, lo desarmamos para evaluar los elementos individuales
    const tempGroup = activeLayer.children.find(c => c.data && c.data.isTempSelectionGroup);
    if (tempGroup) {
        currentlySelected = tempGroup.children.slice();
        unpackTempSelectionGroup();
    } else if (window.selectedItem && isEditableItem(window.selectedItem)) {
        currentlySelected = [window.selectedItem];
    }
    
    let newSelectedItems = [];
    activeLayer.children.forEach(item => {
        if (isEditableItem(item)) {
            if (currentlySelected.includes(item)) {
                item.selected = false;
            } else {
                item.selected = true;
                newSelectedItems.push(item);
            }
        }
    });
    
    if (newSelectedItems.length === 0) {
        window.deselectItem();
    } else if (newSelectedItems.length === 1) {
        window.selectItem(newSelectedItems[0]);
    } else {
        createTempSelectionGroup(newSelectedItems);
    }
    paper.view.update();
}

export function pasteInPlace() {
    const clipboard = window.clipboardItem;
    if (!clipboard) {
        alert("El portapapeles está vacío.");
        return;
    }
    if (typeof window.saveHistory === 'function') window.saveHistory();
    
    const clone = clipboard.clone();
    clone.data = { ...(clone.data || {}), locked: false };
    
    paper.project.activeLayer.addChild(clone);
    if (window.currentMockup) {
        clone.insertBelow(window.currentMockup);
    }
    
    window.selectItem(clone);
    paper.view.update();
}

export function convertToPathSelected() {
    if (!window.selectedItem || window.selectedItem.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    
    const target = window.selectedItem.data?.clipGroup ? 
        window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        
    if (!target) return;
    
    let converted = false;
    
    function processItem(item) {
        if (item instanceof paper.Shape) {
            const path = item.toPath();
            path.data = { ...item.data };
            path.name = item.name;
            path.selected = true;
            if (item.parent) {
                item.parent.insertChild(item.index, path);
                item.remove();
            }
            converted = true;
            return path;
        } else if (item instanceof paper.Group) {
            const children = item.children.slice();
            children.forEach(child => processItem(child));
        }
        return item;
    }
    
    processItem(target);
    if (converted) {
        window.updateSelectionBox(window.selectedItem);
        paper.view.update();
    } else {
        alert("El objeto seleccionado ya es un trazado vectorial o no es una forma convertible.");
    }
}

export function closePathSelected() {
    if (!window.selectedItem || window.selectedItem.data?.locked) return;
    
    const target = window.selectedItem.data?.clipGroup ? 
        window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        
    if (!target) return;
    
    let modified = false;
    
    function closePath(item) {
        if (item instanceof paper.Path) {
            if (!item.closed) {
                if (typeof window.saveHistory === 'function' && !modified) window.saveHistory();
                item.closed = true;
                modified = true;
            }
        } else if (item instanceof paper.CompoundPath) {
            item.children.forEach(child => {
                if (child instanceof paper.Path && !child.closed) {
                    if (typeof window.saveHistory === 'function' && !modified) window.saveHistory();
                    child.closed = true;
                    modified = true;
                }
            });
        } else if (item instanceof paper.Group) {
            item.children.forEach(closePath);
        }
    }
    
    closePath(target);
    if (modified) {
        paper.view.update();
    } else {
        alert("El trazado seleccionado ya está cerrado o no es un vector abierto.");
    }
}

export function autoJoinSelectedPaths() {
    if (!window.selectedItem || window.selectedItem.data?.locked) return;
    
    let paths = [];
    
    function collectOpenPaths(item) {
        if (item instanceof paper.Path && !item.closed) {
            paths.push(item);
        } else if (item instanceof paper.CompoundPath) {
            item.children.forEach(child => {
                if (child instanceof paper.Path && !child.closed) {
                    paths.push(child);
                }
            });
        } else if (item instanceof paper.Group) {
            item.children.forEach(collectOpenPaths);
        }
    }
    
    const target = window.selectedItem.data?.clipGroup ? 
        window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        
    collectOpenPaths(target);
    
    if (paths.length < 2) {
        alert("Seleccione un grupo o elementos con al menos dos trazos vectoriales abiertos para unirlos.");
        return;
    }
    
    if (typeof window.saveHistory === 'function') window.saveHistory();
    
    let joinedAny = false;
    const tolerance = 5.0; // Distancia límite en píxeles para unión
    
    for (let i = 0; i < paths.length; i++) {
        let pathA = paths[i];
        if (!pathA || !pathA.parent) continue;
        
        for (let j = i + 1; j < paths.length; j++) {
            let pathB = paths[j];
            if (!pathB || !pathB.parent) continue;
            
            const aStart = pathA.firstSegment.point;
            const aEnd = pathA.lastSegment.point;
            const bStart = pathB.firstSegment.point;
            const bEnd = pathB.lastSegment.point;
            
            let canJoin = false;
            let reverseA = false;
            let reverseB = false;
            
            if (aEnd.distance(bStart) < tolerance) {
                canJoin = true;
            } else if (aEnd.distance(bEnd) < tolerance) {
                canJoin = true;
                reverseB = true;
            } else if (aStart.distance(bEnd) < tolerance) {
                canJoin = true;
                reverseA = true;
            } else if (aStart.distance(bStart) < tolerance) {
                canJoin = true;
                reverseA = true;
                reverseB = true;
            }
            
            if (canJoin) {
                if (reverseA) pathA.reverse();
                if (reverseB) pathB.reverse();
                
                pathA.join(pathB);
                paths[j] = null;
                joinedAny = true;
                i--; // Re-evaluar este mismo trazo A para ver si conecta con otros
                break;
            }
        }
    }
    
    if (joinedAny) {
        window.updateSelectionBox(window.selectedItem);
        paper.view.update();
    } else {
        alert("No se encontraron extremos vectoriales lo suficientemente cercanos para unir (Tolerancia: 5px).");
    }
}

export function optimizeSelectedShapes() {
    if (!window.selectedItem || window.selectedItem.data?.locked) return;
    
    let modified = false;
    
    function simplifyItem(item) {
        if (item instanceof paper.Path) {
            if (typeof window.saveHistory === 'function' && !modified) window.saveHistory();
            item.simplify(1.5); // Simplificación sutil de Paper.js
            modified = true;
        } else if (item instanceof paper.CompoundPath) {
            if (typeof window.saveHistory === 'function' && !modified) window.saveHistory();
            item.children.forEach(child => {
                if (child instanceof paper.Path) {
                    child.simplify(1.5);
                }
            });
            modified = true;
        } else if (item instanceof paper.Group) {
            item.children.forEach(simplifyItem);
        }
    }
    
    const target = window.selectedItem.data?.clipGroup ? 
        window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        
    simplifyItem(target);
    
    if (modified) {
        window.updateSelectionBox(window.selectedItem);
        paper.view.update();
    } else {
        alert("La selección no contiene trazos vectoriales simplificables.");
    }
}

export function deleteDuplicates() {
    const activeLayer = paper.project.activeLayer;
    let editables = [];
    
    activeLayer.children.forEach(item => {
        if (isEditableItem(item)) {
            editables.push(item);
        }
    });
    
    if (editables.length < 2) {
        alert("No hay suficientes elementos en el lienzo para buscar duplicados.");
        return;
    }
    
    if (typeof window.saveHistory === 'function') window.saveHistory();
    
    let duplicatesRemoved = 0;
    const tolerance = 0.5; // Tolerancia de solapamiento en píxeles
    
    for (let i = 0; i < editables.length; i++) {
        let itemA = editables[i];
        if (!itemA || !itemA.parent) continue;
        
        const displayA = (itemA.data && itemA.data.clipGroup) ? 
            itemA.children.find(c => !c.clipMask) : itemA;
            
        if (!displayA) continue;
        
        for (let j = i + 1; j < editables.length; j++) {
            let itemB = editables[j];
            if (!itemB || !itemB.parent) continue;
            
            const displayB = (itemB.data && itemB.data.clipGroup) ? 
                itemB.children.find(c => !c.clipMask) : itemB;
                
            if (!displayB) continue;
            
            if (displayA.className !== displayB.className) continue;
            if (displayA.position.distance(displayB.position) > tolerance) continue;
            
            if (Math.abs(displayA.bounds.width - displayB.bounds.width) > tolerance ||
                Math.abs(displayA.bounds.height - displayB.bounds.height) > tolerance) {
                continue;
            }
            
            let isDuplicate = false;
            if (displayA instanceof paper.Path && displayB instanceof paper.Path) {
                if (displayA.segments.length === displayB.segments.length) {
                    isDuplicate = true;
                    for (let s = 0; s < displayA.segments.length; s++) {
                        if (displayA.segments[s].point.distance(displayB.segments[s].point) > tolerance) {
                            isDuplicate = false;
                            break;
                        }
                    }
                }
            } else if (displayA instanceof paper.PointText && displayB instanceof paper.PointText) {
                if (displayA.content === displayB.content && 
                    displayA.fontFamily === displayB.fontFamily && 
                    displayA.fontSize === displayB.fontSize) {
                    isDuplicate = true;
                }
            } else {
                isDuplicate = true; // Fallback para formas estáticas idénticas en caja y posición
            }
            
            if (isDuplicate) {
                if (window.selectedItem === itemB) {
                    window.deselectItem();
                }
                itemB.remove();
                editables[j] = null;
                duplicatesRemoved++;
            }
        }
    }
    
    if (duplicatesRemoved > 0) {
        paper.view.update();
        alert(`Éxito: Se eliminaron ${duplicatesRemoved} objeto(s) duplicado(s) que estaban perfectamente solapados.`);
    } else {
        alert("Análisis completo: No se encontraron objetos duplicados solapados.");
    }
}

/* --- SISTEMA DE SELECCIÓN MÚLTIPLE TEMPORAL (Garantía de No Regresión) --- */

export function createTempSelectionGroup(items) {
    unpackTempSelectionGroup();
    if (!items || items.length <= 1) return null;

    const group = new paper.Group(items);
    group.data = { isTempSelectionGroup: true, label: "Selección Múltiple" };
    
    paper.project.activeLayer.addChild(group);
    if (window.currentMockup) {
        group.insertBelow(window.currentMockup);
    }
    
    window.selectedItem = group;
    window.updateSelectionBox(group);
    return group;
}

export function unpackTempSelectionGroup() {
    const activeLayer = paper.project.activeLayer;
    const tempGroup = activeLayer.children.find(c => c.data && c.data.isTempSelectionGroup);
    if (tempGroup) {
        const children = tempGroup.children.slice();
        children.forEach(child => {
            activeLayer.addChild(child);
            child.selected = true;
        });
        if (window.currentMockup) {
            children.forEach(child => {
                child.insertBelow(window.currentMockup);
            });
        }
        tempGroup.remove();
    }
}

// Inyección y aumento dinámico seguro de las funciones de selección global
if (typeof window !== 'undefined') {
    const originalDeselectItem = window.deselectItem;
    window.deselectItem = function() {
        unpackTempSelectionGroup();
        if (typeof originalDeselectItem === 'function') {
            originalDeselectItem();
        }
    };

    const originalSelectItem = window.selectItem;
    window.selectItem = function(item) {
        if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.isTempSelectionGroup) {
            if (item !== window.selectedItem) {
                unpackTempSelectionGroup();
            }
        }
        if (typeof originalSelectItem === 'function') {
            originalSelectItem(item);
        }
    };
}
