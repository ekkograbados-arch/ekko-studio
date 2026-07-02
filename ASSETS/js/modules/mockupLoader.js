export function findLargestPath(item) {

    let biggest = null;

    function walk(obj) {

        if (
            obj instanceof paper.Path ||
            obj instanceof paper.CompoundPath
        ) {

            if (
                !biggest ||
                Math.abs(obj.area) > Math.abs(biggest.area)
            ) {
                biggest = obj;
            }

        }

        if (obj.children) {
            obj.children.forEach(walk);
        }

    }

    walk(item);

    return biggest;

}

function collectPaths(item, paths = []) {

    if (
        item instanceof paper.Path ||
        item instanceof paper.CompoundPath
    ) {
        paths.push(item);
    }

    if (item.children) {
        item.children.forEach(child => collectPaths(child, paths));
    }

    return paths;

}


function buildCompoundMask(item) {

    const compound = new paper.CompoundPath();

    const paths = collectPaths(item);

    paths.forEach(path => {

        const clone = path.clone();

        clone.applyMatrix = true;

        compound.addChild(clone);

    });

    compound.fillColor = "black";

    compound.visible = false;

    return compound;

}

function lockMockup(item) {

    item.data = item.data || {};

    item.data.locked = true;
    item.data.mockup = true;

    item.locked = true;
    item.selected = false;

    if (item.children) {
        item.children.forEach(lockMockup);
    }

}

window.clipItem = function(item) {

    if (!window.clipMask) {
        return item;
    }

    const mask = window.clipMask.clone();

    mask.clipMask = true;

    const group = new paper.Group();

    group.addChild(mask);
    group.addChild(item);

    group.clipped = true;

    group.data = {
        locked: false,
        label: item.data?.label || "Objeto"
    };

    return group;

};


export function loadMockup(svgPath) {

    const token = ++window.loadToken;

    paper.project.activeLayer.removeChildren();

    paper.project.importSVG(svgPath, function(item) {

        if (token !== window.loadToken) {

            if (item) {
                item.remove();
            }

            return;

        }

        if (!item) return;

        const bounds = item.bounds;
        const canvas = paper.view.bounds;

        const scale = Math.min(

            (canvas.width * 0.75) / bounds.width,

            (canvas.height * 0.75) / bounds.height

        );

        item.scale(scale);

        item.position = canvas.center;

        window.currentMockup = item;

        lockMockup(item);

        window.grabArea = findLargestPath(item);

        window.clipMask = buildCompoundMask(item);

        item.bringToFront();

        paper.view.update();

    });

}
