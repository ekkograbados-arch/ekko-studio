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


window.grabArea = null;        

markMockupPaths(item);

item.data.label = "Mockup";

window.currentMockup = item;

item.bringToFront();

paper.view.update();


        
    });

}


function markMockupPaths(item) {

    item.data = item.data || {};
    item.data.locked = true;
    item.data.mockup = true;

    if (
        item instanceof paper.Path ||
        item instanceof paper.CompoundPath
    ) {

        if (!window.grabArea) {

            window.grabArea = item.clone();

            window.grabArea.visible = false;

        }

    }

    if (item.children) {

        item.children.forEach(child => {

            markMockupPaths(child);

        });

    }

}
