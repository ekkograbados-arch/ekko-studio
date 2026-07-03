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

    const paths = collectPaths(item)
        .filter(path => path && path.area !== 0)
        .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

    if (!paths.length) {
        return null;
    }

    let mask = paths[0].clone();
    mask.applyMatrix = true;

    for (let i = 1; i < paths.length; i++) {

        const hole = paths[i].clone();
        hole.applyMatrix = true;

        const center = hole.bounds.center;

        if (mask.contains(center)) {
            const nextMask = mask.subtract(hole);
            mask.remove();
            hole.remove();

            if (nextMask) {
                mask = nextMask;
            }
        } else {
            hole.remove();
        }

    }

    mask.fillColor = "black";
    mask.strokeColor = null;
    mask.visible = false;

    return mask;

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

window.clipItem = function (item) {

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
        label: item.data?.label || "Objeto",
        clipGroup: true
    };

    // el raster NO debe creer que es el grupo
    item.parentClip = group;

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




    window.grabArea = buildCompoundMask(item);

window.clipMask = window.grabArea ? window.grabArea.clone() : null;

if (window.clipMask) {
    window.clipMask.visible = false;
}

        item.bringToFront();

        paper.view.update();

    });

}
