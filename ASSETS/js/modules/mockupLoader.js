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
