/* =========================================================================
Módulo: ASSETS/js/modules/textEditor.js (Sincronizado Canva/Figma WYSIWYG - v2)
Ruta de reemplazo: ASSETS/js/modules/textEditor.js
Descripción: Editor de texto inline interactivo para el canvas (Estilo Canva).
Sincroniza perfectamente la caja de edición (textarea) con la caja de selección
celeste de Paper.js y el cursor caret en tiempo real.
========================================================================= */

import { applyTextCurve } from "./canvas-pro/textToolbar.js";
import { interactionOwner } from "./canvas-pro/interactionOwner.js";

function containsTextItem(owner, textItem) {
    if (!owner || !textItem) return false;
    if (owner === textItem) return true;
    return !!owner.children?.some(child => containsTextItem(child, textItem));
}

function resolveTextEditorOwner(textItem) {
    if (!textItem) return null;
    const selected = window.selectedItem || null;
    if (selected && containsTextItem(selected, textItem)) return selected;
    if (textItem.parent?.data?.clipGroup) return textItem.parent;
    return textItem;
}

function publishTextEditorState(mode, textItem, content) {
    const owner = resolveTextEditorOwner(textItem);
    const data = owner?.data || {};
    window.EKKO_TEXT_EDITOR_STATE = {
        mode,
        content: content == null ? "" : String(content),
        owner: owner ? {
            id: owner.id ?? null,
            className: owner.className || owner.constructor?.name || null,
            label: data.label ?? null,
            fusionId: data.fusionId ?? null,
            isSmartFusion: data.isSmartFusion === true,
            isTextVector: data.isTextVector === true,
            isClipGroup: data.clipGroup === true
        } : null,
        itemId: textItem.id ?? null,
        updatedAt: new Date().toISOString()
    };
}

export function startTextEditing(textItem) {
    if (!textItem) return;
    interactionOwner.claim("text-edit", { owner: "textEditor" });
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
    publishTextEditorState("editing", textItem, area.value);

    // 3. Función interna para sincronizar posición, tamaño y caret con los bounds reales del lienzo
    function syncEditorSizeAndPosition() {
        /* Lienzo medido FRESCO: con un rect capturado al abrir la sesion, el
           vigilante de zoom sincronizaba respecto a la pantalla de antes si
           la ventana o un panel se movieron mientras se editaba. */
        const rect = canvas.getBoundingClientRect();
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
    area.style.zIndex = "10000000"; // Queda por encima de la barra de herramientas flotante

    // Inicializar posición y tamaño
    syncEditorSizeAndPosition();

    // Añadir al DOM, enfocar y seleccionar
    document.body.appendChild(area);
    area.focus();
    area.select();

    let closed = false;
    /* SESION SUSPENDIDA = EL CLIENTE ESTA MANOJANDO LA CAJA.
       Mientras escribe, el textarea tiene el foco y el texto en el canvas
       esta oculto (para no ver doble recuadro). Pero el cliente necesita
       agrandar el texto con los tiradores o arrastrarlo SIN aceptar la
       edicion, y despues seguir escribiendo. Antes cualquier mousedown
       fuera del textarea cerraba la sesion: agarrar un tirador aceptaba el
       texto a la fuerza y ya no se podia seguir editando.
       La sesion ahora se SUSPENDE (no se cierra): el texto se muestra, el
       textarea se esconde y el lienzo recibe el puntero. Al soltar, la
       sesion se reanuda con el caret donde estaba. Es conmutativo: da lo
       mismo escribir y luego escalar que escalar y luego escribir. */
    let suspended = false;
    let caretStart = 0;
    let caretEnd = 0;

    function mostrarTextoEnCanvas() {
        textItem.visible = true;
        area.style.display = "none";
        try { paper.view.update(); } catch (_) {}
    }

    function mostrarTextarea() {
        textItem.visible = false;
        area.style.display = "";
        syncEditorSizeAndPosition();
        try { paper.view.update(); } catch (_) {}
    }

    function suspend() {
        if (closed || suspended) return;
        suspended = true;
        caretStart = area.selectionStart ?? 0;
        caretEnd = area.selectionEnd ?? caretStart;
        publishTextEditorState("transforming", textItem, area.value);
        /* CEDER EL PUNTERO AL LIENZO.
           Mientras el dueño de la interaccion es "text-edit", selection.js
           hace `canHandle("select")` -> false y IGNORA el mousedown: los
           tiradores no responden. Hay que liberar el modo para que la caja
           de seleccion vuelva a tomar el puntero. La sesion de edicion no
           se pierde: vive en este closure, no en interactionOwner. */
        try { interactionOwner.release("text-edit"); } catch (_) {}
        mostrarTextoEnCanvas();
    }

    function resume() {
        if (closed || !suspended) return;
        suspended = false;
        /* Reclamar de nuevo: sin esto, cualquier tecla o herramienta seguira
           creyendo que manda la seleccion y el textarea quedaria a medio usar. */
        try { interactionOwner.claim("text-edit", { owner: "textEditor" }); } catch (_) {}
        publishTextEditorState("editing", textItem, area.value);
        mostrarTextarea();
        area.focus();
        try { area.setSelectionRange(caretStart, caretEnd); } catch (_) {}
    }

    /* El puntero esta SOBRE la pieza o sobre su caja de seleccion?
       Se usa bounds y no hitTest porque mientras se escribe el texto esta
       invisible, y hitTest sobre un item invisible no responde. Bounds si
       sigue valiendo: la geometria no desaparece, solo no se dibuja. */
    function punteroSobreLaPieza(punto) {
        const tol = 12 / (paper.view?.zoom || 1);
        const candidatos = [window.selectedItem, textItem].filter(Boolean);
        for (const it of candidatos) {
            try {
                const b = it.bounds;
                if (b && b.expand(tol).contains(punto)) return true;
            } catch (_) {}
        }
        try {
            if (window.selectionBoxGroup && window.selectionBoxGroup.hitTest(punto)) return true;
        } catch (_) {}
        return false;
    }

    function puntoDelEvento(e) {
        const r = canvas.getBoundingClientRect();
        return paper.view.viewToProject(new paper.Point(e.clientX - r.left, e.clientY - r.top));
    }

    function finish(save = true) {
        if (closed) return;
        closed = true;
        interactionOwner.release("text-edit");
        publishTextEditorState(save ? "confirmed" : "cancelled", textItem, save ? area.value.trim() : originalContent);
        
        // Remover los detectores de clics externos globales (mismo orden de fases)
        if (typeof removerCaptura === 'function') removerCaptura();
        document.removeEventListener("mouseup", handleCanvasMouseUp);
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
        /* Enganche para quien edita un grupo curvado/espaciado por la via de un
           PointText temporal: guarda el texto y sale sin esperar el rebuild. */
        if (textItem.data?.isTempEditorMock || textItem.data?.editHostOwnerId) {
            if (typeof window.textEditOnComplete === 'function') {
                window.textEditOnComplete(textItem, save);
            }
        }
        paper.view.update();
    }

    // 5. Escuchar eventos de entrada de texto (Input) para redimensionar en caliente
    area.addEventListener("input", () => {
        textItem.content = area.value;
        publishTextEditorState("editing", textItem, area.value);
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

        /* EL BLUR NO CIERRA LA SESION, SOLO LA SUSPENDE.
           Esconder el textarea (al agarrar un tirador) dispara blur
           automaticamente. Si ahi se cerrara, el tirador aceptaria el texto
           por la fuerza. El blur solo avisa: el cierre lo decide el
           mousedown de abajo. */
    area.addEventListener("blur", () => {
        if (closed || suspended) return;
        /* Blur sin suspension = el foco se fue a un panel de la interfaz
           (cinta, sidebar). Ahi si se acepta, igual que en Canva. */
        finish(true);
    });

    /* =========================================================================
       ZOOM CON LA SESION VIVA
       -------------------------------------------------------------------------
       Las letras que se ven mientras se escribe son del TEXTAREA (el texto del
       lienzo esta oculto). La caja de seleccion es geometria del lienzo en
       coordenadas mundiales: al hacer zoom se acomoda sola. El textarea NO: su
       posicion y su alto/fecha se calcularon una vez, asi que despues del zoom
       las letras quedaban en la pantalla de antes y separadas de la caja.
       MEDIDO: con zoom x1.2 el cuadrado bajo unos 50px y el texto quedo arriba.

       Tres piezas:
        1. RUEDA sobre el textarea -> ahora hace zoom igual que en el lienzo
           (se re-expide al canvas, que es el dueno del control de zoom
           LightBurn). Antes el textarea se comia la rueda: ni zoom ni caret.
        2. VIGILANTE por frame: si el zoom de la vista o el rectangulo del
           lienzo cambiaron, re-sincroniza posicion/tamano del textarea. Cubre
           rueda sobre el lienzo, Ctrl+rueda desde el textarea, y el deslizar
           de paneles que muevan el canvas.
        3. CURSOR DE TRANSFORMACION sobre el textarea: el cambio de cursor vive
           en selectTool.onMouseMove del lienzo, que no corre mientras el
           puntero esta sobre el textarea. Con esto, pasar por encima de un
           tirador mientras se escribe muestra el mismo cursor que en la caja.
       ========================================================================= */

    /* 1. La rueda sobre las letras ya no muere: zoom con el mismo gesto. */
    area.addEventListener("wheel", (e) => {
        if (closed) return;
        e.preventDefault();
        e.stopPropagation();
        /* offsetX/offsetY son relativos al TARGET: al re-expedir sobre el
           canvas quedan relativos al lienzo, que es lo que espera el control
           de zoom relativo al cursor. */
        canvas.dispatchEvent(new WheelEvent("wheel", {
            bubbles: true, cancelable: true,
            clientX: e.clientX, clientY: e.clientY,
            deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode
        }));
    }, { passive: false });

    /* 2. Vigilante: el zoom (o un lienzo que corrio) re-acomoda el textarea. */
    let ultimoZoom = paper.view ? paper.view.zoom : 1;
    let ultimoRect = canvas.getBoundingClientRect();
    const vigilancia = () => {
        if (closed) return;
        try {
            if (suspended) {
                /* Sin textarea visible no hay nada que acomodar; solo se
                   actualizan las referencias para no falsar el proximo mundo. */
                ultimoZoom = paper.view ? paper.view.zoom : ultimoZoom;
            } else {
                const v = paper.view ? paper.view.zoom : ultimoZoom;
                const r = canvas.getBoundingClientRect();
                const movio = Math.abs(r.left - ultimoRect.left) > 0.5
                    || Math.abs(r.top - ultimoRect.top) > 0.5
                    || Math.abs(r.width - ultimoRect.width) > 0.5
                    || Math.abs(r.height - ultimoRect.height) > 0.5;
                if (v !== ultimoZoom || movio) {
                    ultimoZoom = v;
                    ultimoRect = r;
                    syncEditorSizeAndPosition();
                } else {
                    ultimoRect = r;
                }
            }
        } catch (_) {}
        requestAnimationFrame(vigilancia);
    };
    requestAnimationFrame(vigilancia);

    /* 3. Cursor de transformacion: misma logica que el pasaje a traves, para
       que el cursor que se muestra prometa EXACTAMENTE lo que el clic hara.
       Orden: tirador de curvatura -> tiradores/borde de caja -> caret. */
    area.addEventListener("pointermove", (e) => {
        if (closed || suspended) return;
        let cur = "text";
        try {
            const punto = puntoDelEvento(e);
            if (window.EKKO_TEXT_BEND && typeof window.EKKO_TEXT_BEND.hitTest === "function" && window.EKKO_TEXT_BEND.hitTest(punto)) {
                cur = "ns-resize";
            } else {
                const golpe = window.selectionBoxGroup && window.selectionBoxGroup.hitTest(punto, {
                    fill: true, stroke: true, segments: true,
                    tolerance: 10 / (paper.view?.zoom || 1)
                });
                if (golpe) {
                    const d = golpe.item.data || {};
                    const mapa = { rot: "grab", tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize" };
                    cur = d.isHandle ? (mapa[d.handleType] || "move") : "move";
                }
            }
        } catch (_) {}
        area.style.cursor = cur;
    });

    /* Detector de clics externos global.
       Cuatro destinos, cuatro caminos distintos:
         - sobre el textarea PERO cayendo en un tirador o en el borde de la
           caja -> SALVA AL LIENZO (pasaje a traves). Sin esto el textarea,
           que tapa el texto con un margen de 8px al costado y 4px arriba y
           abajo, se comeria los clics de las esquinas: agarrar un tirador
           mientras se escribe seria imposible (no interactua).
         - sobre el lienzo, sobre la pieza o su caja -> SUSPENDE (seguir editando)
         - sobre el lienzo vacio -> acepta y listo
         - sobre un panel de la interfaz -> acepta */
    const reexpedirAlLienzo = (e) => {
        /* El evento original salio del textarea: el lienzo nunca lo vio.
           Se re-dispacha IGUAL sobre el canvas para que el tool lo procese. */
        setTimeout(() => {
            if (closed || !suspended) return;
            const datos = { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: e.button ?? 0, buttons: e.type === 'pointerup' || e.type === 'mouseup' ? 0 : 1 };
            if (e.type === 'pointerdown' || e.type === 'pointerup' || e.type === 'pointermove') {
                canvas.dispatchEvent(new PointerEvent(e.type, { ...datos, pointerId: e.pointerId ?? 1, pointerType: e.pointerType ?? 'mouse', isPrimary: e.isPrimary ?? true }));
            } else {
                canvas.dispatchEvent(new MouseEvent(e.type, datos));
            }
        }, 0);
    };
    const handleOutsideClick = (e) => {
        if (closed || suspended) return;
        if (e.target === area) {
            try {
                /* ¿El punto cae sobre la caja de seleccion (borde o tiradores)?
                   hitTest del grupo de caja; el interior del rectangulo no
                   marca porque no tiene relleno, pero los tiradores si
                   (blanco con borde). */
                const punto = puntoDelEvento(e);
                const golpe = window.selectionBoxGroup && window.selectionBoxGroup.hitTest(punto, {
                    fill: true, stroke: true, segments: true,
                    tolerance: 10 / (paper.view?.zoom || 1)
                });
                if (golpe) {
                    suspend();
                    reexpedirAlLienzo(e);
                }
            } catch (_) {}
            return;
        }
        if (e.target === canvas) {
            try {
                if (punteroSobreLaPieza(puntoDelEvento(e))) {
                    suspend();
                    return;
                }
            } catch (_) {}
        }
        finish(true);
    };

    // Retrasar el registro ligeramente para evitar que el doble clic que abrió el editor lo cierre de inmediato
    /* EL ORDEN DE LAS FASES NO ES CAPRICHO, ES EL CERROJO.
       - pointerdown y mousedown en CAPTURA: corren ANTES de los listeners
         del lienzo. paper.js 0.12.x prefiere Pointer Events, y el navegador
         dispara `pointerdown` ANTES que `mousedown`: si la suspension
         escuchara solo mousedown, selection.js consultaria el modo
         (linea 877) ANTES de que se libere "text-edit" y el tirador nunca
         se agarra. Se escuchan los dos tipos; suspend() es idempotente.
       - mouseup en BURBUJA: corre DESPUES del onMouseUp de selection.js
         (linea 1235 vuelve a exigir `canHandle("select")`). Si reanudara
         la sesion antes, el escalado no terminaria de cerrar (ni historial
         ni banderas ni caja). Respetando el orden, cada motor recibe el
         evento en el estado que necesita. */
    const registrarCaptura = () => {
        document.addEventListener("pointerdown", handleOutsideClick, true);
        document.addEventListener("mousedown", handleOutsideClick, true);
    };
    setTimeout(() => {
        registrarCaptura();
        document.addEventListener("mouseup", handleCanvasMouseUp);
    }, 50);

    /* AL SOLTAR EL PUNTERO VOLVER A EDITAR.
       El tirador o el arrastre ya hicieron su trabajo: la sesion se
       reanuda con el caret donde estaba, para que el cliente siga
       escribiendo sin tener que volver a abrir el editor. */
    const handleCanvasMouseUp = () => {
        if (closed || !suspended) return;
        setTimeout(() => { if (!closed) resume(); }, 0);
    };
    setTimeout(() => {
        document.addEventListener("mouseup", handleCanvasMouseUp);
    }, 50);
}

// Registrar globalmente para asegurar visibilidad en modules/selection.js
window.startTextEditing = startTextEditing;
