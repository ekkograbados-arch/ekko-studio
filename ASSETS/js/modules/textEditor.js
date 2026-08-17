/*
 * ASSETS/js/modules/textEditor.js
 * Editor de texto inline interactivo para el canvas (Estilo Canva / LightBurn).
 */

import { applyTextCurve } from "./canvas-pro/textToolbar.js";

export function startTextEditing(textItem) {
  if (!textItem) return;

  const old = document.getElementById("ekko-text-editor");
  if (old) old.remove();

  const canvas = document.getElementById("editorCanvas");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();

  // 1. Ocultar el texto en el canvas para evitar el molesto solapamiento ("doble recuadro")
  textItem.visible = false;
  paper.view.update();

  // 2. Crear el área de escritura de forma flotante con los mismos estilos tipográficos
  const area = document.createElement("textarea");
  area.id = "ekko-text-editor";
  area.value = textItem.content === "Texto" ? "" : textItem.content; // Si es el placeholder, iniciamos limpio

  // Posicionamiento absoluto sobre el canvas
  area.style.position = "absolute";
  area.style.left = rect.left + textItem.position.x - (textItem.bounds ? textItem.bounds.width / 2 : 50) + "px";
  area.style.top = rect.top + textItem.position.y - textItem.fontSize + "px";
  area.style.fontFamily = textItem.fontFamily;
  area.style.fontSize = textItem.fontSize + "px";
  area.style.fontWeight = textItem.fontWeight || "normal";
  area.style.fontStyle = textItem.fontStyle || "normal";
  area.style.color = textItem.fillColor ? textItem.fillColor.toCSS(true) : "#000000";
  area.style.textAlign = "center";
  area.style.padding = "4px";
  area.style.margin = "0";
  area.style.border = "1px dashed #00d2ff"; // Borde sutil de Canva
  area.style.background = "rgba(255, 255, 255, 0.9)";
  area.style.outline = "none";
  area.style.resize = "both";
  area.style.minWidth = "120px";
  area.style.zIndex = "10000";

  document.body.appendChild(area);
  area.focus();
  area.select(); // Selecciona el texto inicial para sobreescribir al instante

  let closed = false;

  function finish(save = true) {
    if (closed) return;
    closed = true;

    if (save) {
      const val = area.value.trim();
      if (val === "") {
        // Si el texto está vacío, eliminamos el objeto para no dejar elementos invisibles
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
        textItem.visible = true; // Hacerlo visible nuevamente

        // Si es un grupo curvo, forzamos la actualización de curvatura usando importación estática segura
        if (textItem.data?.isCurvedGroup || textItem.data?.curvature) {
          const curvature = textItem.data.curvature || 0;
          applyTextCurve(textItem.parent && textItem.parent.data?.clipGroup ? textItem.parent : textItem, curvature);
        } else {
          // Texto plano normal: actualizar caja de selección
          if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(textItem.parent && textItem.parent.data?.clipGroup ? textItem.parent : textItem);
          }
        }
      }
    } else {
      // Cancelado (Esc): Restauramos el texto original
      textItem.visible = true;
    }

    if (area.parentNode) {
      area.parentNode.removeChild(area);
    }
    paper.view.update();
  }

  area.addEventListener("keydown", (e) => {
    // Enviar con Enter (sin Shift), agregar salto de línea con Shift+Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });

  // Guardar cambios al hacer clic fuera del área de texto
  area.addEventListener("blur", () => finish(true), { once: true });
}


