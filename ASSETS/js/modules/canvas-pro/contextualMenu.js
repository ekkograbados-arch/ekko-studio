import { openImageTraceModal } from "./imageTracer.js";
import { 
    scaleImage, 
    duplicateImage, 
    deleteImage, 
    bringImageForward, 
    sendImageBackward, 
    applyBrightnessContrast 
} from "./imageToolbar.js";

// --- REMOVE OVERLAP TAB (EVITAR SUPERPOSICION) ---
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

    // --- 1. ACCIONES GENERALES RECONSTRUIDAS ---
    setClick('btnCtxDelete', () => {
        if (window.selectedItem) {
            deleteImage(window.selectedItem);
            hideContextualMenu();
        }
    });

    setClick('btnCtxDuplicate', () => {
        if (window.selectedItem) {
            duplicateImage(window.selectedItem);
        }
    });

    setClick('btnCtxForward', () => {
        if (window.selectedItem) {
            bringImageForward(window.selectedItem);
        }
    });

    setClick('btnCtxBackward', () => {
        if (window.selectedItem) {
            sendImageBackward(window.selectedItem);
        }
    });

    // --- 2. ACCIONES DE TEXTO ---
    const fontSelector = document.getElementById('ctxFontSelector');
    if (fontSelector) {
        fontSelector.onchange = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup 
                    ? window.selectedItem.children.find(c => !c.clipMask) 
                    : window.selectedItem;
                if (target && target instanceof paper.PointText) {
                    if (typeof window.saveHistory === 'function') window.saveHistory();
                    target.fontFamily = fontSelector.value;
                    paper.view.update();
                }
            }
        };
    }

    setClick('btnCtxItalic', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target && target instanceof paper.PointText) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                const isItalic = target.fontStyle === 'italic';
                target.fontStyle = isItalic ? 'normal' : 'italic';
                paper.view.update();
            }
        }
    });

    // --- 3. ACCIONES DE IMAGEN ---
    setClick('btnCtxFlipH', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
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
                if (typeof window.saveHistory === 'function') window.saveHistory();
                target.scale(1, -1);
                paper.view.update();
            }
        }
    });

    // --- ACCIONES DE ESCALADO INTERACTIVO (ACHICAR / AGRANDAR) ---
    const bindScaleDown = () => { if (window.selectedItem) scaleImage(window.selectedItem, 0.9); };
    const bindScaleUp = () => { if (window.selectedItem) scaleImage(window.selectedItem, 1.1); };

    // Soporte defensivo para múltiples nomenclaturas de IDs de botones
    setClick('btnCtxAchicar', bindScaleDown);
    setClick('btnCtxScaleDown', bindScaleDown);
    setClick('btnCtxShrink', bindScaleDown);
    
    setClick('btnCtxAgrandar', bindScaleUp);
    setClick('btnCtxScaleUp', bindScaleUp);
    setClick('btnCtxGrow', bindScaleUp);

    // --- SLIDERS DE BRILLO Y CONTRASTE EN TIEMPO REAL ---
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');

    const handleFilterInput = () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup 
                ? window.selectedItem.children.find(c => !c.clipMask) 
                : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                const bVal = briSlider ? parseFloat(briSlider.value) : 0;
                const cVal = conSlider ? parseFloat(conSlider.value) : 0;
                
                // Almacenar el estado en el raster para que persista
                target.data = target.data || {};
                target.data.brightness = bVal;
                target.data.contrast = cVal;

                applyBrightnessContrast(target, bVal, cVal);
            }
        }
    };

    if (briSlider) briSlider.oninput = handleFilterInput;
    if (conSlider) conSlider.oninput = handleFilterInput;
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

    // Ocultar subgrupos por defecto
    const hideSubgroup = (id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    };
    hideSubgroup('ctxTextControls');
    hideSubgroup('ctxImageControls');
    hideSubgroup('ctxVectorControls');

    const btnTrace = document.getElementById('btnCtxTrace');
    if (btnTrace) btnTrace.style.display = 'none';

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    // Mostrar subgrupos y restaurar valores de sliders e inputs según el objeto activo
    if (target instanceof paper.PointText) {
        const textControls = document.getElementById('ctxTextControls');
        if (textControls) textControls.classList.remove('hidden');
        
        const fontSelector = document.getElementById('ctxFontSelector');
        if (fontSelector && target.fontFamily) {
            fontSelector.value = target.fontFamily;
        }
    } else if (target instanceof paper.Raster) {
        const imageControls = document.getElementById('ctxImageControls');
        if (imageControls) imageControls.classList.remove('hidden');

        // Sincroniza la posición de los sliders con el estado real de la imagen seleccionada
        const briSlider = document.getElementById('ctxBrightness');
        const conSlider = document.getElementById('ctxContrast');
        if (briSlider) briSlider.value = target.data?.brightness || 0;
        if (conSlider) conSlider.value = target.data?.contrast || 0;
    } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
        const vectorControls = document.getElementById('ctxVectorControls');
        if (vectorControls) vectorControls.classList.remove('hidden');
    }

    // Posicionamiento Canva Style sobre el objeto
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
