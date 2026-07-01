export function startTextEditing(textItem) {

    if (!textItem) return;

    const oldInput = document.getElementById("ekkoTextEditor");

    if (oldInput) oldInput.remove();

    const input = document.createElement("textarea");

    input.id = "ekkoTextEditor";

    input.value = textItem.content;

input.focus();

input.setSelectionRange(
    input.value.length,
    input.value.length
);

    document.body.appendChild(input);

    const pos = paper.view.projectToView(textItem.position);

    input.style.position = "fixed";

input.style.left = "-5000px";

input.style.top = "-5000px";

input.style.width = "1px";

input.style.height = "1px";

input.style.opacity = "0";

input.style.pointerEvents = "none";

input.style.resize = "none";

input.style.border = "0";

input.style.outline = "0";

input.style.background = "transparent";
    
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
