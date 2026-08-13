/**
 * ASSETS/js/modules/canvas-pro/contextualMenu.js
 * Módulo para el control interactivo de la barra flotante emergente y menús de fuentes de alta fidelidad.
 */

import { openImageTraceModal } from "./imageTracer.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { loadDynamicFonts, applyTextCurve, applyTextSpacing, weldText, toggleBold, toggleItalic, toggleUnderline } from "./textToolbar.js";

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

// Cargar las fuentes dinámicas del sistema y poblar los dropdowns enriquecidos
async function populateFontDropdowns() {
    try {
        const fonts = await loadDynamicFonts();
        
        // Poblar el dropdown estático de la barra de propiedades lateral de respaldo (si existiera)
        const fontSelector = document.getElementById('fontSelector');
        if (fontSelector) {
            fontSelector.innerHTML = "";
            const defOpt = document.createElement('option');
            defOpt.value = "Arial";
            defOpt.textContent = "Arial";
            fontSelector.appendChild(defOpt);
            fonts.forEach(font => {
                const opt = document.createElement('option');
                opt.value = font.family;
                opt.textContent = font.name;
                opt.style.fontFamily = font.family;
                fontSelector.appendChild(opt);
            });
        }

        // Renderizar el Dropdown Enriquecido (Floating Popover)
        renderRichFontDropdown(fonts);
    } catch (err) {
        console.error("Error al poblar los selectores de tipografías:", err);
    }
}

// Renderizar el selector flotante enriquecido con previsualización dinámica sin textos fijos
function renderRichFontDropdown(fonts) {
    const dropdownList = document.getElementById("pnlCtxFontDropdown");
    if (!dropdownList) return;

    dropdownList.innerHTML = "";

    // Añadir opción por defecto Arial
    const defaultItem = document.createElement("div");
    defaultItem.className = "rich-font-item";
    defaultItem.style.cursor = "pointer";
    
    defaultItem.innerHTML = `
        <div class="font-preview" style="font-family: Arial; font-size: 18px;">Arial</div>
        <div class="font-name" style="font-size: 10px; color: #888; text-transform: uppercase;">Arial (Sistema)</div>
    `;
    
    defaultItem.onclick = () => {
        applyFontSelection({ family: "Arial", name: "Arial" });
    };
    dropdownList.appendChild(defaultItem);

    // Añadir las tipografías dinámicas
    fonts.forEach(font => {
        const item = document.createElement("div");
        item.className = "rich-font-item";
        item.style.cursor = "pointer";
        item.style.padding = "8px 12px";
        item.style.borderBottom = "1px solid #f0f0f0";

        item.innerHTML = `
            <div class="font-preview" style="font-family: ${font.family}; font-size: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Grabado</div>
            <div class="font-name" style="font-size: 10px; color: #888; text-transform: uppercase; margin-top: 2px;\">${font.name}</div>
        `;

        // EVENTO: Al pasar el cursor por encima (Hover Preview en tiempo real sobre el canvas)
        item.onmouseenter = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                if (target) {
                    if (!window.originalFontBackup) {
                        if (target instanceof paper.PointText) {
                            window.originalFontBackup = target.fontFamily;
                        } else if (target instanceof paper.Group) {
                            const firstChar = target.children.find(c => c instanceof paper.PointText);
                            if (firstChar) window.originalFontBackup = firstChar.fontFamily;
                        }
                    }
                    // Aplicar fuente temporalmente
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

        // EVENTO: Al quitar el cursor (Leave - Restaurar estado original)
        item.onmouseleave = () => {
            if (window.selectedItem && window.originalFontBackup) {
                const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
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

        // EVENTO: Al confirmar con un clic
        item.onclick = () => {
            applyFontSelection(font);
        };

        dropdownList.appendChild(item);
    });
}

// Aplicar selección tipográfica permanente
function applyFontSelection(font) {
    if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (target) {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            
            if (target instanceof paper.PointText) {
                target.fontFamily = font.family;
            } else if (target instanceof paper.Group) {
                target.children.forEach(child => {
                    if (child instanceof paper.PointText) child.fontFamily = font.family;
                });
            }
            
            window.originalFontBackup = null;

            // Actualizar etiqueta del disparador enriquecido
            const labelActive = document.getElementById("txtCtxFontActive");
            if (labelActive) labelActive.textContent = font.name;

            // Cerrar el panel automáticamente
            const dropdownList = document.getElementById("pnlCtxFontDropdown");
            if (dropdownList) dropdownList.classList.add("hidden");

            if (typeof window.updateSelectionBox === 'function') {
                window.updateSelectionBox(window.selectedItem);
            }
            paper.view.update();
        }
    }
}

// Actualizar los textos de previsualización dinámicamente con el texto activo del cliente antes de desplegar
export function updateRichFontPreviews() {
    const dropdownList = document.getElementById("pnlCtxFontDropdown");
    if (!dropdownList) return;

    // Obtener texto actual en vivo del canvas
    let userText = "Grabado";
    if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (target) {
            userText = target.data?.textString || target.content || "Texto";
        }
    }

    // Estandarizar textos de previsualización cortos
    if (userText === "Texto" || userText === "Haz clic para editar") {
        userText = "Grabado Láser";
    }

    // Limitar longitud para evitar desbordes visuales en el menú desplegable
    if (userText.length > 25) {
        userText = userText.substring(0, 22) + "...";
    }

    // Actualizar dinámicamente los contenedores renderizados
    const previews = dropdownList.querySelectorAll(".font-preview");
    previews.forEach(preview => {
        preview.textContent = userText;
    });
}

export function initContextualMenu() {
    const toolbar = document.getElementById('contextual-toolbar');
    if (!toolbar) return;

    removeOverlapTab();
    populateFontDropdowns();

    const setClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };

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

    // Enlazar disparador del Dropdown Enriquecido de fuentes
    const fontTrigger = document.getElementById("btnCtxFontSelect");
    const fontDropdown = document.getElementById("pnlCtxFontDropdown");
    if (fontTrigger && fontDropdown) {
        fontTrigger.onclick = (e) => {
            e.stopPropagation();
            updateRichFontPreviews();
            fontDropdown.classList.toggle("hidden");
        };
    }

    // Cerrar el panel al hacer clic en cualquier parte fuera de la tipografía
    document.addEventListener("click", (e) => {
        if (fontDropdown && !fontDropdown.classList.contains("hidden")) {
            const isClickInside = fontTrigger.contains(e.target) || fontDropdown.contains(e.target);
            if (!isClickInside) {
                fontDropdown.classList.add("hidden");
            }
        }
    });

    // --- 2. ACCIONES DE TEXTO AVANZADAS ---
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

    // Control Deslizante de Curvatura de Texto (Estilo LightBurn) con Wheel interactivo
    const curveSlider = document.getElementById('ctxTextCurve');
    if (curveSlider) {
        curveSlider.oninput = () => {
            if (window.selectedItem) {
                const val = parseFloat(curveSlider.value);
                applyTextCurve(window.selectedItem, val);
            }
        };
        curveSlider.onwheel = (e) => {
            e.preventDefault();
            let val = parseFloat(curveSlider.value);
            val += e.deltaY < 0 ? 1 : -1;
            val = Math.max(-100, Math.min(100, val));
            curveSlider.value = val;
            if (window.selectedItem) {
                applyTextCurve(window.selectedItem, val);
            }
        };
    }

    // Control Deslizante de Espaciado de Caracteres (Espaciado - Estilo LightBurn) con Wheel interactivo
    const hspaceSlider = document.getElementById('ctxTextHSpace');
    if (hspaceSlider) {
        hspaceSlider.oninput = () => {
            if (window.selectedItem) {
                const val = parseFloat(hspaceSlider.value);
                applyTextSpacing(window.selectedItem, val);
            }
        };
        hspaceSlider.onwheel = (e) => {
            e.preventDefault();
            let val = parseFloat(hspaceSlider.value);
            val += e.deltaY < 0 ? 1 : -1;
            val = Math.max(-10, Math.min(100, val));
            hspaceSlider.value = val;
            if (window.selectedItem) {
                applyTextSpacing(window.selectedItem, val);
            }
        };
    }

    // --- 3. ACCIONES DE IMAGEN ---
    setClick('btnCtxFlipH', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                target.scale(-1, 1);
                paper.view.update();
            }
        }
    });
    setClick('btnCtxFlipV', () => {
        if (window.selectedItem) {
            const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                target.scale(1, -1);
                paper.view.update();
            }
        }
    });

    // --- ACCIONES DE ESCALADO INTERACTIVO (ACHICAR / AGRANDAR) ---
    const bindScaleDown = () => {
        if (window.selectedItem) scaleImage(window.selectedItem, 0.9);
    };
    const bindScaleUp = () => {
        if (window.selectedItem) scaleImage(window.selectedItem, 1.1);
    };
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
            const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (target && target instanceof paper.Raster) {
                const bVal = briSlider ? parseFloat(briSlider.value) : 0;
                const cVal = conSlider ? parseFloat(conSlider.value) : 0;
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

    if (target instanceof paper.PointText || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
        const textControls = document.getElementById('ctxTextControls');
        if (textControls) textControls.classList.remove('hidden');

        // Sincronizar el nombre en el disparador del dropdown enriquecido
        const labelActive = document.getElementById("txtCtxFontActive");
        if (labelActive && target.fontFamily) {
            let cleanName = target.fontFamily.replace("ekko_", "").replace(/_/g, " ");
            cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
            labelActive.textContent = cleanName;
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
    } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
        const vectorControls = document.getElementById('ctxVectorControls');
        if (vectorControls) vectorControls.classList.remove('hidden');
    }

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
