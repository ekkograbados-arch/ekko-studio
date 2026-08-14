/**
*  ASSETS/js/modules/canvas-pro/contextualMenu.js
*  Módulo para el control interactivo de la barra flotante emergente y menús de fuentes de alta fidelidad.
*  Soporta conversión a Dropdowns Enriquecidos con Hover Preview real en tiempo real.
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

// Cargar las fuentes dinámicas del sistema y poblar los dropdowns con la previsualización tipográfica en tiempo real
async function populateFontDropdowns() {
    const fonts = await loadDynamicFonts();
    const dropdowns = [
        document.getElementById('ctxFontSelector'),
        document.getElementById('fontSelector')
    ];
    dropdowns.forEach(dropdown => {
        if (!dropdown) return;
        dropdown.innerHTML = ""; // Limpiar dropdowns anteriores
        
        // Opción por defecto
        const defOpt = document.createElement('option');
        defOpt.value = "Arial";
        defOpt.textContent = "Arial";
        defOpt.style.fontFamily = "Arial";
        dropdown.appendChild(defOpt);
        
        fonts.forEach(font => {
            const opt = document.createElement('option');
            opt.value = font.family;
            opt.textContent = font.name;
            opt.style.fontFamily = font.family; // Previsualización real de la fuente dentro de las opciones
            dropdown.appendChild(opt);
        });
    });
    
    renderSidebarFontGallery(fonts);

    // CONVERTIR AUTOMÁTICAMENTE AMBOS DROPDOWNS NATIVOS A SELECTORES ENRIQUECIDOS CON HOVER PREVIEW
    convertToRichDropdown('ctxFontSelector');
    convertToRichDropdown('fontSelector');
}

// Convertidor de <select> nativo a Dropdown Personalizado Enriquecido (Canva Style) con soporte de Hover
function convertToRichDropdown(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Si ya fue convertido, evitar duplicados
    if (select.dataset.richConverted) return;
    select.dataset.richConverted = "true";

    // Inyectar estilos CSS para el dropdown personalizado de forma automática
    const styleId = 'rich-select-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .rich-select-wrapper {
                position: relative;
                display: inline-block;
                min-width: 180px;
                vertical-align: middle;
                font-family: Arial, sans-serif;
                z-index: 999999 !important; /* Fuerza a que se dibuje por encima de Paper.js y mockups */
            }
            .rich-select-trigger {
                padding: 8px 12px;
                background: #2a2a2a !important;
                color: #ffffff !important;
                border: 1px solid #444444 !important;
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 14px;
                font-weight: bold;
                user-select: none;
                transition: background 0.2s, border-color 0.2s;
            }
            .rich-select-trigger:hover {
                background: #3a3a3a !important;
                border-color: #ff00ff !important;
            }
            .rich-select-options {
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: #1e1e1e !important;
                border: 1px solid #ff00ff !important;
                border-radius: 8px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
                z-index: 1000000 !important;
                max-height: 250px;
                overflow-y: auto;
                margin-top: 4px;
                scrollbar-width: thin;
                scrollbar-color: #ff00ff #1e1e1e;
            }
            .rich-select-options::-webkit-scrollbar {
                width: 6px;
            }
            .rich-select-options::-webkit-scrollbar-thumb {
                background: #ff00ff;
                border-radius: 3px;
            }
            .rich-select-option {
                padding: 8px 12px;
                cursor: pointer;
                color: #e2e8f0 !important;
                font-size: 15px;
                transition: background 0.15s, color 0.15s;
                border-bottom: 1px solid rgba(255,255,255,0.03);
            }
            .rich-select-option:hover {
                background: #ff00ff !important;
                color: #ffffff !important;
            }
            .rich-select-arrow {
                font-size: 10px;
                margin-left: 8px;
                opacity: 0.8;
            }
            .rich-select-options.hidden {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Ocultar select original
    select.style.display = 'none';

    // Crear la UI del Dropdown personalizado
    const wrapper = document.createElement('div');
    wrapper.className = 'rich-select-wrapper';
    
    // Mantener clases originales si existen
    select.classList.forEach(cls => wrapper.classList.add(cls));

    const trigger = document.createElement('div');
    trigger.className = 'rich-select-trigger';
    trigger.innerHTML = `<span class="rich-select-text">Arial</span><span class="rich-select-arrow">▼</span>`;

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'rich-select-options hidden';

    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsContainer);

    // Sincronizar el valor inicial del trigger
    const syncTriggerText = () => {
        const selectedOpt = select.options[select.selectedIndex];
        if (selectedOpt) {
            const textSpan = trigger.querySelector('.rich-select-text');
            textSpan.textContent = selectedOpt.textContent;
            textSpan.style.fontFamily = selectedOpt.style.fontFamily || selectedOpt.value;
        }
    };

    // INTERCEPCIÓN ULTRA-ROBUSTA DE ASIGNACIONES EN JAVASCRIPT (.value = '...')
    // Esto asegura que cuando Paper.js o editor.js actualicen la tipografía programáticamente, el dropdown de Canva cambie de inmediato.
    const originalValueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (originalValueProp) {
        Object.defineProperty(select, 'value', {
            get() {
                return originalValueProp.get.call(this);
            },
            set(val) {
                originalValueProp.set.call(this, val);
                syncTriggerText(); // Sincronización instantánea de la UI
            },
            configurable: true
        });
    }

    // Escuchar cambios estándar
    select.addEventListener('change', syncTriggerText);

    // Llenar opciones dinámicas en base al select nativo oculto
    const populateOptions = () => {
        optionsContainer.innerHTML = '';
        Array.from(select.options).forEach(opt => {
            const optDiv = document.createElement('div');
            optDiv.className = 'rich-select-option';
            optDiv.style.fontFamily = opt.style.fontFamily || opt.value;
            optDiv.textContent = opt.textContent;

            // HOVER PREVIEW: Al deslizar el puntero del mouse sobre la opción
            optDiv.onmouseenter = () => {
                if (window.selectedItem) {
                    const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                    if (target) {
                        // Almacenar respaldo original de la fuente
                        if (!window.originalFontBackup) {
                            if (target instanceof paper.PointText) {
                                window.originalFontBackup = target.fontFamily;
                            } else if (target instanceof paper.Group) {
                                const firstChar = target.children.find(c => c instanceof paper.PointText);
                                if (firstChar) window.originalFontBackup = firstChar.fontFamily;
                            }
                        }
                        // Aplicar previsualización tipográfica interactiva en el lienzo
                        if (target instanceof paper.PointText) {
                            target.fontFamily = opt.value;
                        } else if (target instanceof paper.Group) {
                            target.children.forEach(child => {
                                if (child instanceof paper.PointText) child.fontFamily = opt.value;
                            });
                        }
                        if (typeof window.updateSelectionBox === 'function') {
                            window.updateSelectionBox(window.selectedItem);
                        }
                        paper.view.update();
                    }
                }
            };

            // RESTAURACIÓN DE LA FUENTE ORIGINAL: Al mover el mouse fuera de la opción
            optDiv.onmouseleave = () => {
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

            // SELECCIÓN DEFINITIVA: Al hacer clic en la opción
            optDiv.onclick = (e) => {
                e.stopPropagation();
                select.value = opt.value;
                syncTriggerText();
                optionsContainer.classList.add('hidden');

                if (window.selectedItem) {
                    const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                    if (target) {
                        if (typeof window.saveHistory === 'function') window.saveHistory();
                        
                        target.data = target.data || {};
                        
                        if (target instanceof paper.PointText) {
                            target.fontFamily = opt.value;
                            target.data.fontFamily = opt.value;
                        } else if (target instanceof paper.Group) {
                            target.children.forEach(child => {
                                if (child instanceof paper.PointText) child.fontFamily = opt.value;
                            });
                            target.data.fontFamily = opt.value;
                        }
                        // Limpiar respaldo para evitar restauraciones innecesarias
                        window.originalFontBackup = null;
                        
                        // Sincronizar recíprocamente el otro selector de tipografía del sistema
                        const otherSelectId = selectId === 'ctxFontSelector' ? 'fontSelector' : 'ctxFontSelector';
                        const otherSelect = document.getElementById(otherSelectId);
                        if (otherSelect) {
                            otherSelect.value = opt.value;
                        }

                        if (typeof window.updateSelectionBox === 'function') {
                            window.updateSelectionBox(window.selectedItem);
                        }
                        paper.view.update();
                    }
                }

                // Desencadenar el evento original 'change' para conservar la compatibilidad de módulos externos
                const event = new Event('change');
                select.dispatchEvent(event);
            };

            optionsContainer.appendChild(optDiv);
        });
    };

    // Desplegar/Ocultar lista al hacer clic sobre el trigger
    trigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.rich-select-options').forEach(el => {
            if (el !== optionsContainer) el.classList.add('hidden');
        });
        populateOptions();
        optionsContainer.classList.toggle('hidden');
    };

    // Cerrar el dropdown al hacer clic fuera del control
    document.addEventListener('click', () => {
        optionsContainer.classList.add('hidden');
    });

    // Escuchar mutaciones dinámicas de options del select por si cambian de forma remota
    const observer = new MutationObserver(syncTriggerText);
    observer.observe(select, { childList: true, subtree: true, attributes: true });

    // Sincronizar el valor inicial
    syncTriggerText();
}

// Renderizar galería de tipografías lateral con hover interactivo de previsualización (Hover Preview)
function renderSidebarFontGallery(fonts) {
    const list = document.getElementById("fontList");
    if (!list) return;
    list.innerHTML = "";
    fonts.forEach(font => {
        const item = document.createElement("div");
        item.className = "font-item";
        item.style.cursor = "pointer";
        item.innerHTML = `<div class="font-preview" style="font-family: ${font.family}">Feliz Día Papá</div> <div class="font-name">${font.name}</div>`;
        
        // PREVISUALIZACIÓN DINÁMICA POR HOVER (Al pasar el cursor del mouse por encima)
        item.onmouseenter = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
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
        
        // CONFIRMACIÓN DE TIPOGRAFÍA AL HACER CLIC
        item.onclick = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                if (target) {
                    if (typeof window.saveHistory === 'function') window.saveHistory();
                    
                    target.data = target.data || {};
                    
                    if (target instanceof paper.PointText) {
                        target.fontFamily = font.family;
                        target.data.fontFamily = font.family; // Sincronización en data
                    } else if (target instanceof paper.Group) {
                        target.children.forEach(child => {
                            if (child instanceof paper.PointText) child.fontFamily = font.family;
                        });
                        target.data.fontFamily = font.family; // Sincronización en data
                    }
                    
                    // Confirmar selección y evitar que el unhover posterior la restaure
                    window.originalFontBackup = null;
                    
                    // Sincronizar selectores de fuentes (Dropdowns nativos y wrappers dinámicos)
                    const dropdowns = ['ctxFontSelector', 'fontSelector'];
                    dropdowns.forEach(id => {
                        const sel = document.getElementById(id);
                        if (sel) {
                            sel.value = font.family;
                        }
                    });

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

    // --- 2. ACCIONES DE TEXTO AVANZADAS ---
    const fontSelector = document.getElementById('ctxFontSelector');
    if (fontSelector) {
        const applyFontChange = () => {
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
                if (target) {
                    if (typeof window.saveHistory === 'function') window.saveHistory();
                    
                    target.data = target.data || {};
                    
                    if (target instanceof paper.PointText) {
                        target.fontFamily = fontSelector.value;
                        target.data.fontFamily = fontSelector.value;
                    } else if (target instanceof paper.Group) {
                        target.children.forEach(child => {
                            if (child instanceof paper.PointText) child.fontFamily = fontSelector.value;
                        });
                        target.data.fontFamily = fontSelector.value;
                    }
                    if (typeof window.updateSelectionBox === 'function') {
                        window.updateSelectionBox(window.selectedItem);
                    }
                    paper.view.update();
                }
            }
        };
        fontSelector.onchange = applyFontChange;
        fontSelector.oninput = applyFontChange;
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
        const fontSelector = document.getElementById('ctxFontSelector');
        if (fontSelector && target.fontFamily) {
            fontSelector.value = target.fontFamily;
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
