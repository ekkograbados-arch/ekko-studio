window.selectedItem = null;
window.dragOffset = null;

window.getSelectableItem = function(item){

    if(!item) return null;

    while(item){

        if(item.data){

            if(item.data.mockup) return null;

            if(item.data.clipGroup){
                return item;
            }

        }

        if(item.parent){
            item = item.parent;
        }else{
            break;
        }

    }

    return item;

};

window.selectItem = function(item){

    if(window.selectedItem){
        window.selectedItem.selected = false;
    }

    window.selectedItem = item;

    if(item){

        if(
            item instanceof paper.Group &&
            item.clipped
        ){

            item.selected = false;

        }else{

            item.selected = true;

        }

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
