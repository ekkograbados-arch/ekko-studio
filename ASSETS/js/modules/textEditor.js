/* =========================================================================
Módulo: ASSETS/js/modules/textEditor.js (Sincronizado Canva/Figma WYSIWYG - v2)
Ruta de reemplazo: ASSETS/js/modules/textEditor.js
Descripción: Editor de texto inline interactivo para el canvas (Estilo Canva).
Sincroniza perfectamente la caja de edición (textarea) con la caja de selección
celeste de Paper.js y el cursor caret en tiempo real.
========================================================================= */

import { applyTextCurve } from "./canvas-pro/textToolbar.js";

export function startTextEditing(textItem) {
    if (!textItem) return;
    const old = document.getElementById("ekko-text-editor");
    if (old) old.remove();
    const canvas = document.getElementById("editorCanvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const originalContent = textItem.content;

    // 1. Ocultar el texto original en el canvas para evitar el molesto solapamiento ("doble recuadro")
    textItem.visible = false;
    paper.view.update();

    // 2. Crear el área de escritura (textarea) flotante
    const area = document.createElement("textarea");
    area.id = "ekko-text-editor";
    area.value = textItem.content === "Texto" ? "" : textItem.content; // Si es el placeholder, iniciamos limpio

    // 3. Función interna para sincronizar posición, tamaño y caret con los bounds reales del lienzo
    function syncEditorSizeAndPosition() {
        const zoom = paper.view.zoom;
        const bounds = textItem.bounds;
        
        // Obtener dimensiones reales escaladas con el zoom actual
        const textWidth = bounds.width * zoom;
        const textHeight = bounds.height * zoom;
        const viewTopLeft = paper.view.projectToView(bounds.topLeft);

        // Obtener la escala real del elemento (considerando transformaciones o grupos acumulados)
        let scaleY = 1;
        if (textItem.globalMatrix && textItem.globalMatrix.scaling) {
            scaleY = Math.abs(textItem.globalMatrix.scaling.y);
        } else if (textItem.matrix && textItem.matrix.scaling) {
            scaleY = Math.abs(textItem.matrix.scaling.y);
        }
        const actualFontSize = textItem.fontSize * scaleY * zoom;

        // Posicionar el textarea de forma idéntica a los bounds de Paper.js
        area.style.position = "absolute";
        area.style.left = (rect.left + window.scrollX + viewTopLeft.x) + "px";
        area.style.top = (rect.top + window.scrollY + viewTopLeft.y) + "px";
        area.style.width = Math.max(textWidth + 8, 50) + "px"; // Margen de seguridad para evitar desbordes de cursor
        area.style.height = (textHeight + 4) + "px";
        
        // Estilización de fuentes y alineación
        area.style.fontFamily = textItem.fontFamily;
        area.style.fontSize = actualFontSize + "px";
        area.style.fontWeight = textItem.fontWeight || "normal";
        area.style.fontStyle = textItem.fontStyle || "normal";
        area.style.color = textItem.fillColor ? textItem.fillColor.toCSS(true) : "#000000";
        area.style.textAlign = textItem.justification || "center";
        
        // Centrado vertical exacto para que el caret coincida con el centro de los nodos de selección
        area.style.lineHeight = (textHeight / actualFontSize) || "1";
    }

    // 4. Estilos base del editor invisible (Estilo Canva/Figma)
    area.style.padding = "0px";
    area.style.margin = "0px";
    area.style.border = "none";
    area.style.background = "transparent";
    area.style.outline = "none";
    area.style.resize = "none";
    area.style.overflow = "hidden";
    area.style.whiteSpace = "pre"; // Preserva saltos de línea sin auto-ajustes forzados
    area.style.boxSizing = "border-box";
    area.style.zIndex = "10030"; // Queda por encima de la barra de herramientas flotante

    // Inicializar posición y tamaño
    syncEditorSizeAndPosition();

    // Añadir al DOM, enfocar y seleccionar
    document.body.appendChild(area);
    area.focus();
    area.select();

    let closed = false;

    function finish(save = true) {
        if (closed) return;
        closed = true;
        if (save) {
            const val = area.value.trim();
            if (val === "") {
                // Si el texto queda vacío, eliminamos el objeto
                if (textItem.parent && textItem.parent.data?.clipGroup) {
                    textItem.parent.remove();
                } else {
                    textItem.remove();
                }
                if (typeof window.deselectItem === 'function') {
                    window.deselectItem();
                }
            } else {
                textItem.content = val;
                textItem.visible = true; // Hacerlo visible de nuevo
                
                // Actualizar curvatura si aplica, o simplemente actualizar la caja de selección
                if (textItem.data?.isCurvedGroup || textItem.data?.curvature) {
                    const curvature = textItem.data.curvature || 0;
                    applyTextCurve(textItem.parent && textItem.parent.data?.clipGroup ? textItem.parent : textItem, curvature);
                } else {
                    if (typeof window.updateSelectionBox === 'function') {
                        window.updateSelectionBox(textItem.parent && textItem.parent.data?.clipGroup ? textItem.parent : textItem);
                    }
                }
            }
        } else {
            // Cancelar con Escape: restaurar original
            textItem.content = originalContent;
            textItem.visible = true;
            if (typeof window.updateSelectionBox === 'function') {
                window.updateSelectionBox(textItem.parent && textItem.parent.data?.clipGroup ? textItem.parent : textItem);
            }
        }
        
        if (area.parentNode) {
            area.parentNode.removeChild(area);
        }
        paper.view.update();
    }

    // 5. Escuchar eventos de entrada de texto (Input) para redimensionar en caliente
    area.addEventListener("input", () => {
        textItem.content = area.value;
        paper.view.update(); // Forzar a Paper.js a recalcular la geometría de los bounds
        
        // Recalcular tamaño de textarea y actualizar caja de selección celeste en tiempo real
        syncEditorSizeAndPosition();
        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(textItem.parent && textItem.parent.data?.clipGroup ? textItem.parent : textItem);
        }
    });

    // Enviar con Enter (sin Shift), agregar salto de línea con Shift+Enter
    area.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish(true);
        }
        if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
        }
    });

    // Guardar cambios al hacer clic fuera del área de texto (blur)
    area.addEventListener("blur", () => finish(true), { once: true });
}

// Registrar globalmente para asegurar visibilidad en modules/selection.js
window.startTextEditing = startTextEditing;
