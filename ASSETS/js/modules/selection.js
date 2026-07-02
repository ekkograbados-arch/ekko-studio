window.selectedItem = null;
window.dragOffset = null;

window.getSelectableItem = function (item) {

    if (!item) return null;

    // Si es la máscara del clip, seleccionamos el grupo
    if (item.clipMask && item.parent) {
        item = item.parent;
    }

    // Si pertenece a un grupo clipado, seleccionamos el grupo
    if (
        item.parent &&
        item.parent instanceof paper.Group &&
        item.parent.clipped
    ) {
        item = item.parent;
    }

    // Mockups nunca seleccionables
    if (
        item.data &&
        (item.data.mockup || item.data.locked)
    ) {
        return null;
    }

    return item;

};

window.selectItem = function (item) {

    if (window.selectedItem) {
        window.selectedItem.selected = false;
    }

    window.selectedItem = item;

    if (item) {
        item.selected = true;
    }

    paper.view.update();

};

window.deselectItem = function () {

    if (window.selectedItem) {
        window.selectedItem.selected = false;
    }

    window.selectedItem = null;

    paper.view.update();

};
