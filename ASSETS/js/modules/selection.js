
window.selectedItem = null;

window.dragOffset = new paper.Point(0, 0);

window.selectItem = function(item){

    if(window.selectedItem){
        window.selectedItem.selected = false;
    }

    window.selectedItem = item;

    if(item){
        item.selected = true;
    }

    paper.view.update();

};

window.deselectItem = function(){

    if(window.selectedItem){
        window.selectedItem.selected = false;
    }

    window.selectedItem = null;

    paper.view.update();

};
