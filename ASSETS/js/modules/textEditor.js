export function startTextEditing(textItem) {

    if (!textItem) return;

    const oldInput = document.getElementById("ekkoTextEditor");

    if (oldInput) oldInput.remove();

    const input = document.createElement("textarea");

    input.id = "ekkoTextEditor";

    input.value = textItem.content;

    document.body.appendChild(input);

    const pos = paper.view.projectToView(textItem.position);

    input.style.position = "absolute";

    input.style.left = pos.x + "px";

    input.style.top = pos.y + "px";

    input.style.minWidth = "220px";

    input.style.minHeight = "80px";

    input.style.fontSize = textItem.fontSize + "px";

    input.style.fontFamily = textItem.fontFamily;

    input.style.zIndex = 99999;

    input.focus();

    input.select();

    input.oninput = () => {

        textItem.content = input.value;

        paper.view.update();

    };

    input.onblur = () => {

        textItem.content = input.value;

        input.remove();

        paper.view.update();

    };

}
