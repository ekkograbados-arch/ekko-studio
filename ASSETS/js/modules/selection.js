window.selectedItem = null;
window.dragOffset = null;

window.selectItem = function(item){

    if(window.selectedItem){
        window.selectedItem.selected = false;
    }

    window.selectedItem = item;

    if(item){

        // Si es un grupo recortado, seleccionamos únicamente la imagen
        if(item instanceof paper.Group && item.clipped){

            const image = item.children.find(child => !child.clipMask);

            if(image){
                image.selected = true;
            }

        }else{

            item.selected = true;

        }

    }

    paper.view.update();

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

window.deselectItem = function(){

    if(window.selectedItem){

        if(window.selectedItem instanceof paper.Group && window.selectedItem.clipped){

            const image = window.selectedItem.children.find(child => !child.clipMask);

            if(image){
                image.selected = false;
            }

        }else{

            window.selectedItem.selected = false;

        }

    }

    window.selectedItem = null;

    paper.view.update();

};
