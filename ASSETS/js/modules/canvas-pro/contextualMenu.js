/**
 * ASSETS/js/modules/canvas-pro/contextualMenu.js (PRO Edition v2)
 * 
 * Controlador de barra de herramientas contextual flotante interactiva (Canva-style).
 * Integra de forma nativa la binarización de trazados vectoriales (Trazar Imagen),
 * el modo de edición de nodos interactivo (Hotkeys LightBurn S, L, C, D, I, M, B) y
 * mantiene intactas las funciones tipográficas avanzadas y procesamiento de imágenes.
 */

import { openImageTraceModal } from "./imageTracer.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { loadDynamicFonts, applyTextCurve, applyTextSpacing, weldText, toggleBold, toggleItalic, toggleUnderline } from "./textToolbar.js";
import { autoRemoveBackground, openBackgroundRemovalModal } from "./backgroundRemover.js";

// Inicializar variable global de previsualización tipográfica en el window
window.originalFontBackup = null;

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

// Cargar las fuentes dinámicas del sistema y poblar los dropdowns con la previsualización tipográfica en tiempo real
async function populateFontDropdowns() {
    try {
        const fonts = await loadDynamicFonts();
        const dropdowns = [
            document.getElementById('ctxFontSelector'),
            document.getElementById('fontSelector')
        ];
        dropdowns.forEach(dropdown => {
            if (!dropdown) return;
            dropdown.innerHTML = ""; // Limpiar dropdowns anteriores
            fonts.forEach(font => {
                const opt = document.createElement('option');
                opt.value = font.family;
                opt.textContent = font.name;
                dropdown.appendChild(opt);
            });
        });

        // Poblar galería lateral si existe
        renderSidebarFontGallery(fonts);
    } catch (err) {
        console.warn("Fallo al poblar selectores de fuentes. Usando fallbacks locales.", err);
    }
}

// Renderizar galería de tipografías lateral con hover interactivo de previsualización (Hover Preview)
function renderSidebarFontGallery(fonts) {
    const list = document.getElementById("fontList");
    if (!list) return;
    list.innerHTML = "";

    fonts.forEach(font => {
        const item = document.createElement("div");
        item.className = "font-item-card";
        item.style.cursor = "pointer";
        item.innerHTML = `
            <div class="font-preview" style="font-family: ${font.family}">Feliz Día Papá</div>
            <div class="font-name">${font.name}</div>
        `;

        // PREVISUALIZACIÓN DINÁMICA POR HOVER (Al pasar el cursor del mouse por encima)
        item.onmouseenter = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? 
                    window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                
                if (target) {
                    // Respaldar la tipografía original si no hay respaldo activo
                    if (!window.originalFontBackup) {
                        if (target instanceof paper.PointText) {
                            window.originalFontBackup = target.fontFamily;
                        } else if (target instanceof paper.Group) {
                            const firstChar = target.children.find(c => c instanceof paper.PointText);
                            if (firstChar) window.originalFontBackup = firstChar.fontFamily;
                        }
                    }
                    // Aplicar tipografía en vivo
                    if (target instanceof paper.PointText) {
                        target.fontFamily = font.family;
                    } else if (target instanceof paper.Group) {
                        target.children.forEach(child => {
                            if (child instanceof paper.PointText) child.fontFamily = font.family;
                        });
                    }
                    if (typeof window.updateSelectionBox === 'function') {
                        window.updateSelectionBox(window.selectedItem);
                    }
                    paper.view.update();
                }
            }
        };

        // RESTAURACIÓN DE TIPOGRAFÍA ORIGINAL AL SALIR DEL CONTENEDOR (Unhover)
        item.onmouseleave = () => {
            if (window.selectedItem && window.originalFontBackup) {
                const target = window.selectedItem.data?.clipGroup ? 
                    window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                
                if (target) {
                    if (target instanceof paper.PointText) {
                        target.fontFamily = window.originalFontBackup;
                    } else if (target instanceof paper.Group) {
                        target.children.forEach(child => {
                            if (child instanceof paper.PointText) child.fontFamily = window.originalFontBackup;
                        });
                    }
                    window.originalFontBackup = null;
                    if (typeof window.updateSelectionBox === 'function') {
                        window.updateSelectionBox(window.selectedItem);
                    }
                    paper.view.update();
                }
            }
        };

        // CONFIRMACIÓN DE TIPOGRAFÍA AL HACER CLIC
        item.onclick = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? 
                    window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                
                if (target) {
                    if (typeof window.saveHistory === 'function') window.saveHistory();
                    if (target instanceof paper.PointText) {
                        target.fontFamily = font.family;
                    } else if (target instanceof paper.Group) {
                        target.children.forEach(child => {
                            if (child instanceof paper.PointText) child.fontFamily = font.family;
                        });
                    }
                    // Confirmar selección y evitar que el unhover posterior la restaure
                    window.originalFontBackup = null;
                    
                    // Sincronizar selectores de fuentes
                    const ctxDropdown = document.getElementById('ctxFontSelector');
                    const sideDropdown = document.getElementById('fontSelector');
                    if (ctxDropdown) ctxDropdown.value = font.family;
                    if (sideDropdown) sideDropdown.value = font.family;

                    if (typeof window.updateSelectionBox === 'function') {
                        window.updateSelectionBox(window.selectedItem);
                    }
                    paper.view.update();
                }
            }
        };

        list.appendChild(item);
    });
}

// Auxiliar para establecer clics seguros sobre IDs que podrían no existir en todo tipo de vistas
function setClick(id, callback) {
    const el = document.getElementById(id);
    if (el) {
        el.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            callback();
        };
    }
}

export function initContextualMenu() {
    const toolbar = document.getElementById('contextual-toolbar');
    if (!toolbar) return;

    // --- 1. ACCIONES GENERALES ---
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

    // --- 2. ACCIONES DE TEXTO AVANZADAS ---
    const fontSelector = document.getElementById('ctxFontSelector');
    if (fontSelector) {
        fontSelector.onchange = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? 
                    window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                
                if (target) {
                    if (typeof window.saveHistory === 'function') window.saveHistory();
                    if (target instanceof paper.PointText) {
                        target.fontFamily = fontSelector.value;
                    } else if (target instanceof paper.Group) {
                        target.children.forEach(child => {
                            if (child instanceof paper.PointText) child.fontFamily = fontSelector.value;
                        });
                    }
                    if (typeof window.updateSelectionBox === 'function') {
                        window.updateSelectionBox(window.selectedItem);
                    }
                    paper.view.update();
                }
            }
        };
    }

    setClick('btnCtxBold', () => {
        if (window.selectedItem) {
            toggleBold(window.selectedItem);
        }
    });

    setClick('btnCtxItalic', () => {
        if (window.selectedItem) {
            toggleItalic(window.selectedItem);
        }
    });

    setClick('btnCtxUnderline', () => {
        if (window.selectedItem) {
            toggleUnderline(window.selectedItem);
        }
    });

    setClick('btnCtxWeld', () => {
        if (window.selectedItem) {
            weldText(window.selectedItem);
        }
    });

    // Control Deslizante de Curvatura de Texto (Estilo LightBurn)
    const curveSlider = document.getElementById('ctxTextCurve');
    if (curveSlider) {
        curveSlider.oninput = () => {
            if (window.selectedItem) {
                const val = parseFloat(curveSlider.value);
                applyTextCurve(window.selectedItem, val);
            }
        };
    }

    // Control Deslizante de Espaciado de Caracteres (HSpace - Estilo LightBurn)
    const hspaceSlider = document.getElementById('ctxTextHSpace');
    if (hspaceSlider) {
        hspaceSlider.oninput = () => {
            if (window.selectedItem) {
                const val = parseFloat(hspaceSlider.value);
                applyTextSpacing(window.selectedItem, val);
            }
        };
    }

    // --- 3. ACCIONES DE IMAGEN ---
    setClick('btnCtxFlipH', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup ? 
                window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                target.scale(-1, 1);
                paper.view.update();
            }
        }
    });

    setClick('btnCtxFlipV', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup ? 
                window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
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
            const target = window.selectedItem.data?.clipGroup ? 
                window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                const b = parseInt(briSlider ? briSlider.value : 0);
                const c = parseInt(conSlider ? conSlider.value : 0);
                
                target.data = target.data || {};
                target.data.brightness = b;
                target.data.contrast = c;
                
                applyBrightnessContrast(target, b, c);
            }
        }
    };

    if (briSlider) briSlider.oninput = handleFilterInput;
    if (conSlider) conSlider.oninput = handleFilterInput;

    // --- BOTONES DE QUITAR FONDO IA (PhotoRoom Style) ---
    setClick('btnCtxAutoRemoveBg', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup ? 
                window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                autoRemoveBackground(target);
            }
        }
    });

    setClick('btnCtxManualRemoveBg', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup ? 
                window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                openBackgroundRemovalModal(target);
            }
        }
    });

    // --- 4. ACCIONES DE VECTORES / EDICIÓN DE NODOS ---
    setClick('btnCtxEditNodes', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup ? 
                window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (target && (target instanceof paper.Path || target instanceof paper.CompoundPath)) {
                if (typeof window.enterNodeEditMode === 'function') {
                    window.enterNodeEditMode(target);
                }
            }
        }
    });

    // Enlace de los botones dentro de la barra flotante de control de nodos (ctxNodeEditControls)
    setClick('btnNodeSmooth', () => simulateNodeAction('s'));
    setClick('btnNodeLine', () => simulateNodeAction('l'));
    setClick('btnNodeCorner', () => simulateNodeAction('c'));
    setClick('btnNodeDelete', () => simulateNodeAction('d'));
    setClick('btnNodeInsert', () => simulateNodeAction('i'));
    setClick('btnNodeMidpoint', () => simulateNodeAction('m'));
    setClick('btnNodeBreak', () => simulateNodeAction('b'));
    setClick('btnNodeExit', () => {
        if (typeof window.exitNodeEditMode === 'function') {
            window.exitNodeEditMode();
        }
    });

    // Inicializar dropdowns tipográficos de inmediato
    populateFontDropdowns();
}

/**
 * Simula la pulsación de una tecla en el lienzo para ejecutar acciones del modo de edición de nodos
 */
function simulateNodeAction(keyChar) {
    if (!window.nodeEditMode || !window.nodeEditTarget) return;
    
    // Si la función handleNodeKeyDown de imageTracer.js está enlazada globalmente
    if (typeof window.handleNodeKeyDown === 'function') {
        window.handleNodeKeyDown({
            key: keyChar.toLowerCase(),
            preventDefault: () => {},
            modifiers: { control: false, shift: false }
        });
    } else {
        // Fallback: Disparar un Custom Event sintético sobre el documento
        const event = new KeyboardEvent('keydown', { key: keyChar.toUpperCase(), bubbles: true });
        document.dispatchEvent(event);
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

    const hideSubgroup = (id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    };

    hideSubgroup('ctxTextControls');
    hideSubgroup('ctxImageControls');
    hideSubgroup('ctxVectorControls');
    hideSubgroup('ctxNodeEditControls');

    // Desvincular/Ocultar por defecto el botón de trazado y de quita fondos
    const btnTrace = document.getElementById('btnCtxTrace');
    if (btnTrace) {
        btnTrace.style.display = 'none';
        btnTrace.onclick = null;
    }

    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    if (target instanceof paper.PointText || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
        const textControls = document.getElementById('ctxTextControls');
        if (textControls) textControls.classList.remove('hidden');

        const sideSelector = document.getElementById('ctxFontSelector');
        if (sideSelector && target.fontFamily) {
            sideSelector.value = target.fontFamily;
        }

        const curveSlider = document.getElementById('ctxTextCurve');
        if (curveSlider) {
            curveSlider.value = target.data?.curvature || 0;
        }

        const hspaceSlider = document.getElementById('ctxTextHSpace');
        if (hspaceSlider) {
            hspaceSlider.value = target.data?.hspace || 0;
        }

    } else if (target instanceof paper.Raster) {
        const imageControls = document.getElementById('ctxImageControls');
        if (imageControls) imageControls.classList.remove('hidden');

        const briSlider = document.getElementById('ctxBrightness');
        const conSlider = document.getElementById('ctxContrast');
        if (briSlider) briSlider.value = target.data?.brightness || 0;
        if (conSlider) conSlider.value = target.data?.contrast || 0;

        // ACTIVACIÓN DEL TRAZADOR VECTORIAL DIRECTO:
        // Si el objeto seleccionado es una imagen válida, inyectamos y mostramos el botón "Trazar Imagen"
        if (btnTrace) {
            btnTrace.style.display = 'inline-block';
            btnTrace.onclick = () => {
                openImageTraceModal(target);
            };
        }

    } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
        if (window.nodeEditMode) {
            const nodeControls = document.getElementById('ctxNodeEditControls');
            if (nodeControls) nodeControls.classList.remove('hidden');
        } else {
            const vectorControls = document.getElementById('ctxVectorControls');
            if (vectorControls) vectorControls.classList.remove('hidden');
        }
    }

    // Calcular posición flotante del menú contextual (siempre por encima del bounding box del objeto)
    const bounds = item.bounds;
    if (!bounds) return;

    const viewPoint = paper.view.projectToView(bounds.topCenter);
    const editorCanvas = document.getElementById('editorCanvas');
    if (!editorCanvas) return;

    const rect = editorCanvas.getBoundingClientRect();
    const x = viewPoint.x + rect.left;
    const y = viewPoint.y + rect.top;

    // Posicionar la barra con un desfase de 55 píxeles arriba del contorno celeste
    toolbar.style.left = `${x}px`;
    toolbar.style.top = `${y - 55}px`;
    toolbar.style.transform = 'translate(-50%, -100%)';
}

export function hideContextualMenu() {
    const toolbar = document.getElementById('contextual-toolbar');
    if (toolbar) {
        toolbar.classList.remove('active');
    }
}
