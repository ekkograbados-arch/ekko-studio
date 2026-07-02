export function loadMockup(svgPath) {

    const token = ++window.loadToken;

    paper.project.activeLayer.removeChildren();

    paper.project.importSVG(svgPath, (item) => {

        if (token !== window.loadToken) {

            if (item) item.remove();

            return;

        }

        if (!item) return;

        const bounds = item.bounds;
        const canvasBounds = paper.view.bounds;

        const scaleX =
            (canvasBounds.width * 0.75) / bounds.width;

        const scaleY =
            (canvasBounds.height * 0.75) / bounds.height;

        const scale = Math.min(scaleX, scaleY);

        item.scale(scale);

        item.position = canvasBounds.center;


window.grabArea = findLargestPath(item);

window.clipMask = buildMask();

window.currentMockup = item;

item.data = {
    locked: true,
    mockup: true,
    label: "Mockup"
};

item.bringToFront();
        
function findLargestPath(item){

    let biggest = null;

    function walk(obj){

        if(
            obj instanceof paper.Path ||
            obj instanceof paper.CompoundPath
        ){

            if(
                !biggest ||
                obj.area > biggest.area
            ){
                biggest = obj;
            }

        }

        if(obj.children){
            obj.children.forEach(walk);
        }

    }

    walk(item);

    return biggest;

}



function collectPaths(item, paths = []){

    if(
        item instanceof paper.Path ||
        item instanceof paper.CompoundPath
    ){
        paths.push(item);
    }

    if(item.children){
        item.children.forEach(child=>{
            collectPaths(child, paths);
        });
    }

    return paths;

}


function buildCompoundMask(item){

    const compound = new paper.CompoundPath();

    const paths = collectPaths(item);

    paths.forEach(path=>{

        const clone = path.clone();

        clone.visible = true;

        compound.addChild(clone);

    });

    compound.fillColor = "black";

    compound.remove();

    return compound;

}
        
        
function lockMockup(item){

    item.data = item.data || {};

    item.data.mockup = true;
    item.data.locked = true;

    if(item.children){
        item.children.forEach(lockMockup);
    }

}
        

function buildMask() {

    if (!window.grabArea) return null;

    const mask = window.grabArea.clone();

    mask.visible = false;

    return mask;

}        


window.clipItem = function(item){

    if(!window.clipMask){

        return item;

    }

    const mask = window.clipMask.clone();

    mask.clipMask = true;

    mask.visible = true;

    const group = new paper.Group();

    group.addChild(mask);

    group.addChild(item);

    group.clipped = true;

    group.data = {
        locked:false,
        label:item.data?.label || "Objeto"
    };

    return group;

}
        

item.data.label = "Mockup";

window.currentMockup = item;

lockMockup(item);

item.bringToFront();

paper.view.update();


        
    });

}



