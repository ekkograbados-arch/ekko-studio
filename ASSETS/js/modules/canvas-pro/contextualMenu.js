/**
 * ASSETS/js/modules/canvas-pro/contextualMenu.js
 *
 * Controlador de barra de herramientas contextual flotante interactiva (Canva-style) - Versión 3.
 * SOPORTE DINÁMICO DE FUENTES CON INYECCIÓN DE@font-face Y ELIMINACIÓN DE GALERÍA LATERAL.
 */
import { openImageTraceModal } from "./imageTracer.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { loadDynamicFonts, applyTextCurve, applyTextSpacing, weldText, toggleBold, toggleItalic, toggleUnderline } from "./textToolbar.js";
import { autoRemoveBackground, openBackgroundRemovalModal } from "./backgroundRemover.js";

// Variable global de previsualización en window
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

/**
 * Inyecta dinámicamente las reglas de @font-face en el encabezado (head) para cada fuente devuelta.
 * Esto asegura que el navegador renderice correctamente cualquier archivo de tipografía (.woff2, .ttf, .otf)
 * cargado en el servidor, sin necesidad de agregarlo estáticamente a styles.css.
 */
function injectFontFaces(fonts) {
  let styleEl = document.getElementById('ekko-dynamic-font-faces');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ekko-dynamic-font-faces';
    document.head.appendChild(styleEl);
  }

  let cssRules = "";
  fonts.forEach(font => {
    // Evitar inyectar múltiples veces la misma regla de fuente
    if (!cssRules.includes(`font-family: "${font.family}"`)) {
      cssRules += `
        @font-face {
          font-family: "${font.family}";
          src: url("/ASSETS/fonts/${font.file}") format("woff2"),
               url("/ASSETS/fonts/${font.file}") format("truetype"),
               url("/ASSETS/fonts/${font.file}") format("opentype");
          font-display: swap;
        }
      `;
    }
  });
  styleEl.textContent += cssRules;
}

/**
 * Carga las fuentes dinámicas de la API, inyecta sus @font-face y puebla los dropdowns
 * con el nombre y renderizado real de la tipografía dentro de cada opción.
 */
async function populateFontDropdowns() {
  let fonts = [];
  try {
    if (typeof loadDynamicFonts === 'function') {
      fonts = await loadDynamicFonts();
    } else {
      // Fallback robusto directo en caso de que loadDynamicFonts falle o no esté definida
      const response = await fetch('/api/fonts');
      if (response.ok) {
        fonts = await response.json();
      }
    }
  } catch (err) {
    console.error("Error al cargar las tipografías dinámicas en el menú contextual:", err);
  }

  // Si no se reciben fuentes, usar un listado básico defensivo
  if (!fonts || fonts.length === 0) {
    fonts = [
      { name: "Billie James", family: "ekko_billie", file: "BillieJames-Regular.woff2" },
      { name: "Romantic Sunrise", family: "ekko_romantic", file: "Romantic Sunrise.woff2" },
      { name: "Farmhouse", family: "ekko_farmhouse", file: "Farmhouse.woff2" },
      { name: "Chocolate", family: "ekko_chocolate", file: "Chocolate.woff2" },
      { name: "Disney", family: "ekko_disney", file: "waltograph42.woff2" }
    ];
  }

  // Asegurar que las fuentes estén ordenadas alfabéticamente por nombre de presentación
  fonts.sort((a, b) => a.name.localeCompare(b.name));

  // Inyectar dinámicamente los estilos @font-face en el DOM
  injectFontFaces(fonts);

  const dropdowns = [
    document.getElementById('ctxFontSelector'),
    document.getElementById('fontSelector')
  ];

  dropdowns.forEach(dropdown => {
    if (!dropdown) return;
    dropdown.innerHTML = ""; // Limpiar dropdown previo

    // Opción por defecto (Arial)
    const defOpt = document.createElement('option');
    defOpt.value = "Arial";
    defOpt.textContent = "Arial";
    defOpt.style.fontFamily = "Arial";
    dropdown.appendChild(defOpt);

    // Agregar cada tipografía cargada
    fonts.forEach(font => {
      const opt = document.createElement('option');
      opt.value = font.family;
      opt.textContent = font.name;
      opt.style.fontFamily = font.family; // Previsualización en el menú del navegador
      dropdown.appendChild(opt);
    });
  });

  // NOTA: La función renderSidebarFontGallery() lateral ha sido completamente removida
  // a petición del usuario. Las tipografías solo se muestran y seleccionan en el dropdown.
  const sidebarGallery = document.getElementById("fontGallery");
  if (sidebarGallery) {
    sidebarGallery.classList.add("hidden"); // Ocultar por completo si existe en el DOM
  }
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
      const target = window.selectedItem.data?.clipGroup ?
        window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;

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
    if (imageControls) {
      imageControls.classList.remove('hidden');

      // --- INYECCIÓN PERMANENTE DE BOTONES DE ELIMINACIÓN DE FONDO ---
      let btnRemoveBg = document.getElementById('btnRemoveBg');
      let btnEditRemoval = document.getElementById('btnEditRemoval');

      if (!btnRemoveBg) {
        btnRemoveBg = document.createElement('button');
        btnRemoveBg.id = 'btnRemoveBg';
        btnRemoveBg.className = 'bg-remover-tool-btn';
        btnRemoveBg.style.margin = '4px';
        btnRemoveBg.style.padding = '8px 12px';
        btnRemoveBg.style.fontSize = '12px';
        btnRemoveBg.style.backgroundColor = '#007bff';
        btnRemoveBg.style.borderColor = '#007bff';
        btnRemoveBg.style.color = '#fff';
        btnRemoveBg.style.borderRadius = '6px';
        btnRemoveBg.style.cursor = 'pointer';
        btnRemoveBg.style.fontWeight = 'bold';
        btnRemoveBg.innerHTML = '🪄 Quitar Fondo';
        imageControls.appendChild(btnRemoveBg);
      }

      if (!btnEditRemoval) {
        btnEditRemoval = document.createElement('button');
        btnEditRemoval.id = 'btnEditRemoval';
        btnEditRemoval.className = 'bg-remover-tool-btn';
        btnEditRemoval.style.margin = '4px';
        btnEditRemoval.style.padding = '8px 12px';
        btnEditRemoval.style.fontSize = '12px';
        btnEditRemoval.style.backgroundColor = '#28a745';
        btnEditRemoval.style.borderColor = '#28a745';
        btnEditRemoval.style.color = '#fff';
        btnEditRemoval.style.borderRadius = '6px';
        btnEditRemoval.style.cursor = 'pointer';
        btnEditRemoval.style.fontWeight = 'bold';
        btnEditRemoval.innerHTML = '✂️ Editar Recorte';
        imageControls.appendChild(btnEditRemoval);
      }

      btnRemoveBg.onclick = () => {
        if (window.selectedItem) {
          autoRemoveBackground(window.selectedItem);
        }
      };

      btnEditRemoval.onclick = () => {
        if (window.selectedItem) {
          openBackgroundRemovalModal(window.selectedItem);
        }
      };
    }

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
