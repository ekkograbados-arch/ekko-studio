export function startTextEditing(textItem) {

    const old = document.getElementById("ekko-text-editor");
    if (old) old.remove();

    const canvas = document.getElementById("editorCanvas");

    const rect = canvas.getBoundingClientRect();

    const area = document.createElement("textarea");

    area.id = "ekko-text-editor";

    area.value = textItem.content;

    area.style.position = "absolute";
    area.style.left = rect.left + textItem.position.x - 5 + "px";
    area.style.top = rect.top + textItem.position.y - textItem.fontSize + "px";

    area.style.fontFamily = textItem.fontFamily;
    area.style.fontSize = textItem.fontSize + "px";

    area.style.padding = "0";
    area.style.margin = "0";
    area.style.border = "none";
    area.style.background = "transparent";
    area.style.outline = "none";
    area.style.resize = "none";
    area.style.overflow = "hidden";

    document.body.appendChild(area);

    area.focus();

    area.selectionStart = area.value.length;
    area.selectionEnd = area.value.length;

    function finish(save = true){

        if(save){
            textItem.content = area.value;
        }

        if(area.parentNode){
            area.parentNode.removeChild(area);
        }

        paper.view.update();
    }

    area.addEventListener("keydown",(e)=>{

        if(e.key==="Enter"){
            e.preventDefault();
            finish(true);
        }

        if(e.key==="Escape"){
            e.preventDefault();
            finish(false);
        }

    });

    area.addEventListener("blur",()=>finish(true),{once:true});

}
