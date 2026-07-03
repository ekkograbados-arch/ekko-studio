window.selectedItem = null;
window.dragOffset = null;

/* =========================
   SELECCIÓN DE OBJETO
========================= */

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

/* =========================
   SELECT
========================= */

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

/* =========================
   DESELECT
========================= */

window.deselectItem = function(){

    if(window.selectedItem){
        window.selectedItem.selected = false;
    }

    window.selectedItem = null;

    paper.view.update();
};
