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

        

item.data.label = "Mockup";

window.currentMockup = item;

item.bringToFront();

paper.view.update();


        
    });

}



