//=====================================================
// EKKO Studio - Contextual Menu (Canvas-Pro)
// Versión Simplificada: Sin Trazado de Imagen / Con Enmascaramiento Seguro
//=====================================================

function removeOverlapTab() {
    const btnSubtract = document.getElementById('btnCtxSubtract');
    if (btnSubtract) {
        btnSubtract.style.display = 'none';
        btnSubtract.remove();
    }
    const allElements = document.querySelectorAll('button, div, span, a, p, li');
    allElements.forEach(el => {
        if (el.textContent) {
            const normalizedText = el.textContent.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
            if (normalizedText.includes('EVITAR SUPERPOSICION')) {
                el.remove();
            }
        }
    });
}

export function initContextualMenu() {
    const toolbar = document.getElementById('contextual-toolbar');
    if (!toolbar) return;

    removeOverlapTab();

    const setClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };

    // --- ACCIONES DE TEXTO ---
    setClick('btnCtxItalic', () => {
        if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
            const isItalic = window.selectedItem.fontStyle === 'italic';
            window.selectedItem.fontStyle = isItalic ? 'normal' : 'italic';
            paper.view.update();
        }
    });

    // --- ACCIONES DE IMAGEN ---
    setClick('btnCtxFlipH', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                target.scale(-1, 1);
                paper.view.update();
            }
        }
    });

    setClick('btnCtxFlipV', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                target.scale(1, -1);
                paper.view.update();
            }
        }
    });

    // Sliders de Brillo y Contraste
    const briSlider = document.getElementById('ctxBrightness');
    if (briSlider) {
        briSlider.oninput = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup 
                    ? window.selectedItem.children.find(c => !c.clipMask) 
                    : window.selectedItem;
                if (target && target instanceof paper.Raster) {
                    target.data = target.data || {};
                    target.data.brightness = parseFloat(briSlider.value);
                }
            }
        };
    }
}

export function updateContextualMenu(item) {
    const toolbar = document.getElementById('contextual-toolbar');
    if (!toolbar) return;

    removeOverlapTab();

    if (!item || (item.data && item.data.mockup)) {
        toolbar.classList.remove('active');
        return;
    }

    toolbar.classList.add('active');

    // Esconder todos los subgrupos de forma predeterminada
    const hideSubgroup = (id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    };
    hideSubgroup('ctxTextControls');
    hideSubgroup('ctxImageControls');
    hideSubgroup('ctxVectorControls');

    // Deshabilitar y ocultar físicamente cualquier botón de trazado huérfano
    const btnTrace = document.getElementById('btnCtxTrace');
    if (btnTrace) {
        btnTrace.style.display = 'none';
        btnTrace.remove();
    }

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    // Habilitar subgrupos según el objeto seleccionado
    if (target instanceof paper.PointText) {
        const textControls = document.getElementById('ctxTextControls');
        if (textControls) textControls.classList.remove('hidden');
    } else if (target instanceof paper.Raster) {
        const imageControls = document.getElementById('ctxImageControls');
        if (imageControls) imageControls.classList.remove('hidden');
    } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
        const vectorControls = document.getElementById('ctxVectorControls');
        if (vectorControls) vectorControls.classList.remove('hidden');
    }

    // --- POSICIONAMIENTO GEOMÉTRICO (Canva Style) ---
    const bounds = item.bounds;
    if (!bounds) return;

    const viewPoint = paper.view.projectToView(bounds.topCenter);
    const toolbarWidth = toolbar.offsetWidth || 350;
    const toolbarHeight = toolbar.offsetHeight || 45;

    const posX = viewPoint.x - (toolbarWidth / 2);
    const posY = viewPoint.y - toolbarHeight - 20;

    const maxLeft = paper.view.element.clientWidth - toolbarWidth - 10;
    const maxTop = paper.view.element.clientHeight - toolbarHeight - 10;

    toolbar.style.left = `${Math.max(10, Math.min(posX, maxLeft))}px`;
    toolbar.style.top = `${Math.max(10, Math.min(posY, maxTop))}px`;
}

export function hideContextualMenu() {
    const toolbar = document.getElementById('contextual-toolbar');
    if (toolbar) toolbar.classList.remove('active');
}
