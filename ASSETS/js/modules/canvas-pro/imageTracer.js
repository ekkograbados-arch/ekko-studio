import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { buildOutlineGeometry } from "./outlineGeometry.js";
import { cerrarParametros } from "./commandParameters.js";

// --- ALGORITMO DE SEGUIMIENTO DE CONTORNOS (Moore-Neighbor Tracing con Curvas) ---
export function traceRasterContours(imageData, threshold, cutoff = 0, sketchTrace = false) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  const binaryGrid = new Uint8Array(width * height);
  const grayValues = new Uint8Array(width * height);
  const alphaValues = new Uint8Array(width * height);

  // 1. Extraer valores de gris y transparencia
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const idx = i / 4;
    grayValues[idx] = Math.round(gray);
    alphaValues[idx] = a;
  }

  // 2. Aplicar binarización (Estándar o Adaptativa por Croquis)
  if (sketchTrace) {
    // Algoritmo de Umbral Adaptativo por Imagen Integral (Sketch Trace de LightBurn)
    const windowSize = 15;
    const halfWin = Math.floor(windowSize / 2);
    const integral = new Uint32Array(width * height);

    // Calcular imagen integral para consulta O(1) de promedio local
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        rowSum += grayValues[idx];
        integral[idx] = rowSum + (y > 0 ? integral[(y - 1) * width + x] : 0);
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        // HIGIENE: Forzar bordes externos de la imagen a 0 para no trazar el marco rectangular
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          binaryGrid[idx] = 0;
          continue;
        }

        if (alphaValues[idx] <= 50) {
          binaryGrid[idx] = 0;
          continue;
        }

        const x0 = Math.max(0, x - halfWin);
        const x1 = Math.min(width - 1, x + halfWin);
        const y0 = Math.max(0, y - halfWin);
        const y1 = Math.min(height - 1, y + halfWin);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);

        const sum = integral[y1 * width + x1] - 
                    (x0 > 0 ? integral[y1 * width + (x0 - 1)] : 0) - 
                    (y0 > 0 ? integral[(y0 - 1) * width + x1] : 0) + 
                    (x0 > 0 && y0 > 0 ? integral[(y0 - 1) * width + (x0 - 1)] : 0);

        const localAverage = sum / area;
        const gray = grayValues[idx];

        // Ajustar sensibilidad adaptativa con el valor del umbral
        const offset = (128 - threshold) * 0.4;
        binaryGrid[idx] = (gray < localAverage - offset && gray >= cutoff) ? 1 : 0;
      }
    }
  } else {
    // Binarización estándar por rango entre Corte (Cutoff) y Umbral (Threshold)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        // HIGIENE: Forzar bordes externos de la imagen a 0 para no trazar el marco rectangular
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          binaryGrid[idx] = 0;
          continue;
        }

        const gray = grayValues[idx];
        const a = alphaValues[idx];
        binaryGrid[idx] = (a > 50 && gray >= cutoff && gray < threshold) ? 1 : 0;
      }
    }
  }

  // 3. Seguimiento de contornos mediante Moore-Neighbor
  const visited = new Uint8Array(width * height);
  const contours = [];

  const dirs = [
    { x: 0, y: -1 }, // Arriba
    { x: 1, y: -1 }, // Arriba-Derecha
    { x: 1, y: 0 },  // Derecha
    { x: 1, y: 1 },  // Abajo-Derecha
    { x: 0, y: 1 },  // Abajo
    { x: -1, y: 1 }, // Abajo-Izquierda
    { x: -1, y: 0 }, // Izquierda
    { x: -1, y: -1 } // Arriba-Izquierda
  ];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (binaryGrid[idx] === 1 && !visited[idx]) {
        let isBoundary = false;
        for (let d = 0; d < 8; d++) {
          const nx = x + dirs[d].x;
          const ny = y + dirs[d].y;
          if (binaryGrid[ny * width + nx] === 0) {
            isBoundary = true;
            break;
          }
        }

        if (isBoundary) {
          const points = [];
          let currX = x;
          let currY = y;
          let startX = x;
          let startY = y;
          
          let backDir = 6;
          let finished = false;
          let iterations = 0;
          const maxIterations = 8000;

          while (!finished && iterations < maxIterations) {
            points.push({ x: currX, y: currY });
            visited[currY * width + currX] = 1;

            let foundNext = false;
            let scanDir = (backDir + 1) % 8;

            for (let i = 0; i < 8; i++) {
              const checkDir = (scanDir + i) % 8;
              const nx = currX + dirs[checkDir].x;
              const ny = currY + dirs[checkDir].y;

              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (binaryGrid[ny * width + nx] === 1) {
                  currX = nx;
                  currY = ny;
                  backDir = (checkDir + 4) % 8;
                  foundNext = true;
                  break;
                }
              }
            }

            if (!foundNext || (currX === startX && currY === startY)) {
              finished = true;
            }
            iterations++;
          }

          if (points.length > 3) {
            contours.push(points);
          }
        }
      }
    }
  }

  // AUDITORÍA DE GARANTÍA: Filtrar el contorno del recuadro exterior rectangular de la imagen.
  // Cualquier contorno que coincida casi exactamente con los límites del canvas del archivo
  // (es decir, que tenga un ancho y alto de más del 95% del canvas y empiece cerca de x=1, y=1)
  // es el límite físico del archivo de imagen y debe ser ignorado.
  const filteredContours = contours.filter(points => {
    let minX = width, maxX = 0, minY = height, maxY = 0;
    points.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const isOuterFrame = (minX <= 3 && maxX >= width - 4 && minY <= 3 && maxY >= height - 4);
    return !isOuterFrame;
  });

  return filteredContours;
}

// --- TRAZADO POR NIVELES (cantidad de lineas) ---------------------------
// Un solo umbral da una sola banda: dentro o fuera. Para calcar una foto con
// sombras, pelos o medios tonos hacen falta N bandas, una por nivel de gris.
// Cada banda se traza con el mismo motor de siempre; solo cambia el intervalo
// de grises que se le pasa. Con niveles = 1 el resultado es identico al de
// antes: no cambia nada para quien no toca el control.
export function traceRasterBandas(imageData, { umbral = 128, corte = 0, niveles = 1, croquis = false } = {}) {
  const n = Math.max(1, Math.min(6, Math.round(niveles) || 1));
  const lo = Math.max(0, Math.min(255, corte));
  const hi = Math.max(0, Math.min(255, umbral));
  if (hi <= lo || n === 1) {
    return [{ nivel: 0, contours: traceRasterContours(imageData, hi, lo, croquis) }];
  }
  const bandas = [];
  for (let i = 0; i < n; i++) {
    const t0 = lo + ((hi - lo) * i) / n;
    const t1 = lo + ((hi - lo) * (i + 1)) / n;
    bandas.push({ nivel: i, contours: traceRasterContours(imageData, t1, t0, croquis) });
  }
  return bandas;
}

// --- PREVISUALIZACIÓN DE VECTORES EN TIEMPO REAL ---
let tracePreviewGroup = null;

/**
 * La app envuelve cada pieza importada en un grupo de recorte (clipItem), y
 * ese grupo se crea ANTES de que el Raster de adentro termine de cargar. Si se
 * busca en el instante del clic, el grupo todavia no tiene hijos y no hay nada
 * que leer: el trazado salia vacio sin avisar nada.
 *
 * Por eso, si hay un envoltorio pero todavia no aparece el Raster, se espera
 * unos ticks a que aparezca. Es una espera CORTA y con tope: si de verdad no
 * hay imagen, se avisa y se sigue, nunca se queda colgado.
 */
function esperarRaster(item, intentos = 24) {
  const directo = resolverRaster(item);
  if (directo) return directo;
  return new Promise((resolve) => {
    let tries = 0;
    const revisar = () => {
      const r = resolverRaster(window.selectedItems?.[0] || window.selectedItem) ||
                resolverRaster(item);
      tries++;
      if (r) return resolve(r);
      if (tries >= intentos) return resolve(null);
      requestAnimationFrame(revisar);
    };
    revisar();
  });
}

/**
 * Resuelve el Raster real desde un item que puede ser el envoltorio. Se
 * mantiene sincrona para los caminos ya cargados; cuando aun no hay Raster
 * devuelve null y quien necesite esperar usa esperarRaster().
 */
function resolverRaster(item) {
  if (!item) return null;
  try {
    if (item instanceof paper.Raster) return item;
  } catch (_) { return null; }
  const pila = item.children ? [...item.children] : [];
  while (pila.length) {
    const c = pila.shift();
    if (!c) continue;
    try {
      if (c instanceof paper.Raster) return c;
    } catch (_) { continue; }
    if (c.children) pila.push(...c.children);
  }
  return null;
}

function ensureMockupContainment(item) {
  if (!item || !window.currentMockup || !window.clipMask || typeof window.clipItem !== 'function') return item;
  if (item.parent?.data?.clipGroup) return item;

  const parent = item.parent;
  const index = parent?.children ? parent.children.indexOf(item) : -1;
  const previousInfiniteMode = window.infiniteCanvasMode;
  let wrapped = item;
  try {
    window.infiniteCanvasMode = false;
    wrapped = window.clipItem(item) || item;
  } finally {
    window.infiniteCanvasMode = previousInfiniteMode;
  }
  if (wrapped !== item && parent?.insertChild) {
    wrapped.data = { ...(wrapped.data || {}), clipGroup: true, mockupContainment: true };
    parent.insertChild(Math.max(0, index), wrapped);
  }
  return wrapped;
}

export function runTracePreview(raster, threshold, cutoff = 0, smoothness = 1.0, optimize = 0.2, sketchTrace = false, onlyOuter = false, outlineWidth = 0, outlineSide = "center", niveles = 1) {
  if (tracePreviewGroup) {
    tracePreviewGroup.remove();
    tracePreviewGroup = null;
  }

  tracePreviewGroup = new paper.Group();
  tracePreviewGroup.data = { isSelectionBox: true, isTracePreview: true };

  try {
    // Se resuelve al Raster real: puede venir el envoltorio y no tener canvas.
    const fuente = resolverRaster(raster) || raster;
    // Contorno lee asi y funciona: canvas directo o el elemento interno.
    const imgSource = fuente.canvas
      || (typeof fuente.getElement === "function" ? fuente.getElement() : null)
      || fuente.image;
    if (!imgSource) {
      console.warn("[EKKO TRAZO] la imagen no tiene pixeles legibles todavia");
      return;
    }

    const width = raster.width || imgSource.width;
    const height = raster.height || imgSource.height;

    if (width <= 0 || height <= 0) return;

    // RENDIMIENTO EXTREMO: Reducimos a 400px el canvas de lectura para velocidad instantánea
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = Math.min(width, 400);
    previewCanvas.height = Math.round(height * (previewCanvas.width / width));

    const pCtx = previewCanvas.getContext('2d');
    pCtx.drawImage(imgSource, 0, 0, previewCanvas.width, previewCanvas.height);
    const imageData = pCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

    // Cada nivel traza su propia banda de grises; el calco final es la suma.
    const contours = traceRasterBandas(imageData, {
      umbral: threshold, corte: cutoff, niveles, croquis: sketchTrace
    }).flatMap(b => b.contours);
    const bounds = raster.bounds;

    const temporaryPaths = [];

    contours.forEach(points => {
      const pathPoints = points.map(p => {
        // MAESTRÍA DE COBERTURA: Mapeo exacto basado en el centro de píxel (p.x + 0.5)
        const pctX = (p.x + 0.5) / previewCanvas.width;
        const pctY = (p.y + 0.5) / previewCanvas.height;
        
        // Mapear a coordenadas locales de Paper.js (que van desde -raster.width/2 hasta raster.width/2)
        const localPoint = new paper.Point(
          (pctX - 0.5) * raster.width,
          (pctY - 0.5) * raster.height
        );
        
        // Convertir de local a global de forma matricial para máxima precisión sin gap
        if (typeof raster.localToGlobal === 'function') {
          return raster.localToGlobal(localPoint);
        } else {
          // Fallback robusto en caso de que Paper.js esté en un contexto limitado
          return new paper.Point(
            bounds.left + pctX * bounds.width,
            bounds.top + pctY * bounds.height
          );
        }
      });

      let path = new paper.Path({
        segments: pathPoints,
        closed: true,
        strokeColor: '#ff00ff', // Magenta de LightBurn
        strokeWidth: 1.5 / paper.view.zoom,
        insert: false
      });

      // Suavizado dinámico de curvas y optimización de nodos
      if (smoothness > 0) {
        const tolerance = (smoothness * 0.12) + (optimize * 0.25);
        path.simplify(Math.max(0.01, tolerance));
      }

      // El contorno opcional se genera como región cerrada real. En la
      // previsualización se puede ver el mismo anillo que se entregará al
      // cliente; no se depende de strokeWidth para el resultado final.
      if (Number(outlineWidth) > 0) {
        const outlined = buildOutlineGeometry(path, Number(outlineWidth), outlineSide);
        if (outlined) {
          path.remove();
          path = outlined;
        }
      }
      
      temporaryPaths.push(path);
    });

    // FILTRADO DE CONTORNO EXTERIOR (SILUETA):
    if (onlyOuter && temporaryPaths.length > 1) {
      temporaryPaths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
      
      const filteredPaths = [];
      temporaryPaths.forEach(path => {
        const isNested = filteredPaths.some(parentPath => {
          return parentPath.bounds.contains(path.bounds);
        });
        
        if (!isNested) {
          filteredPaths.push(path);
        }
      });
      
      filteredPaths.forEach(p => tracePreviewGroup.addChild(p));
    } else {
      temporaryPaths.forEach(p => tracePreviewGroup.addChild(p));
    }

    paper.project.activeLayer.addChild(tracePreviewGroup);
    paper.view.update();

  } catch (err) {
    console.error("Error drawing live raster trace preview:", err);
  }
}


// --- FLUJO DE TRAZADO EN EL PANEL (sin ventana modal) --------------------
// Antes Trazar abria una ventana aparte con rotulos tecnicos en ingles
// (Threshold, Cutoff, Smoothness, Optimize) y con controles que son de
// Contorno (grosor, posicion, "solo exterior"). Ahora vive en el panel de
// parametros como cualquier otra herramienta: un clic previsualiza con los
// valores actuales, los controles ajustan en vivo y "Aplicar trazado"
// entrega el vector.
//
// El estado vive ACA y no en el DOM: si el panel se cierra y se vuelve a
// abrir, el trazado a medias se retoma donde estaba, no se pierde.

const TRAZO = {
  activo: false,
  raster: null,
  opacidadOriginal: 1
};

/** Lee los controles del panel. Si el panel esta cerrado, valen los de fabrica. */
function leerControlesTrazo() {
  const num = (id, fb) => {
    const el = typeof document !== "undefined" ? document.getElementById(id) : null;
    const v = el ? Number(el.value ?? el.textContent) : NaN;
    // Los botones segmentados guardan en un input oculto con .value; el
    // grupo visible es un div que no tiene valor. Se lee el oculto.
    return Number.isFinite(v) ? v : fb;
  };
  const modoEl = typeof document !== "undefined" ? document.getElementById("traceModo") : null;
  const modo = modoEl ? String(modoEl.value || "foto") : "foto";
  return {
    lineas: Math.max(1, Math.min(6, Math.round(num("traceLineas", 1)) || 1)),
    detalle: Math.max(0, Math.min(255, Math.round(num("traceUmbral", 128)))),
    // El panel muestra 0..100; el motor trabaja 0..1.333. 75 = 1.0, el valor
    // con el que el trazado salia bien en la ventana anterior.
    suavidad: Math.max(0, Math.min(100, num("traceSuavidad", 75))) / 75,
    croquis: modo === "croquis"
  };
}

/**
 * Un clic en Trazar: calca la imagen con los valores actuales y muestra el
 * calco en magenta sobre la imagen atenuada. No entrega nada todavia: para
 * eso esta "Aplicar trazado" en el panel.
 */
export async function iniciarTrazado(raster) {
  cancelarTrazado(true);

  // Se espera a que haya un Raster de verdad. El grupo de recorte se crea
  // antes de que la imagen termine de cargar, y si se busca en el instante
  // del clic no hay pixeles que leer: el calco salia vacio sin avisar nada.
  // La espera tiene tope, asi que si de verdad no hay imagen se avisa y no
  // se queda colgada.
  const fuente = await esperarRaster(raster);
  if (!fuente || !(fuente instanceof paper.Raster)) {
    console.warn("[EKKO TRAZO] no se encontro ninguna imagen para trazar");
    return null;
  }
  if (!(fuente.width > 0) || !(fuente.height > 0)) {
    console.warn("[EKKO TRAZO] la imagen todavia no termino de cargar");
    return null;
  }

  TRAZO.activo = true;
  TRAZO.raster = fuente;
  TRAZO.opacidadOriginal = fuente.opacity;
  // La imagen se atenua para ver el calco encima, como hacia la ventana.
  fuente.opacity = 0.25;
  trazoVivo();
  try { paper.view?.update?.(); } catch (_) {}
  return true;
}

/**
 * Rehace la previsualizacion con lo que dicen los controles ahora mismo.
 * Es lo que el panel llama cada vez que el cliente mueve algo.
 */
export function trazoVivo() {
  if (!TRAZO.activo || !TRAZO.raster) return null;
  const c = leerControlesTrazo();
  runTracePreview(TRAZO.raster, c.detalle, 0, c.suavidad, 0.2, c.croquis, false, 0, "center", c.lineas);
  return true;
}

/** Descarta el trazado a medias y devuelve la imagen a como estaba. */
export function cancelarTrazado(silencioso = false) {
  if (TRAZO.raster) {
    try { TRAZO.raster.opacity = TRAZO.opacidadOriginal; } catch (_) {}
  }
  if (tracePreviewGroup) {
    try { tracePreviewGroup.remove(); } catch (_) {}
    tracePreviewGroup = null;
  }
  TRAZO.activo = false;
  TRAZO.raster = null;
  if (!silencioso) {
    try { cerrarParametros(); } catch (_) {}
    try { paper.view?.update?.(); } catch (_) {}
  }
  return true;
}

/**
 * Entrega el vector: lo que se ve en magenta pasa al lienzo como geometria
 * rellena, lista para Calado, Fusionar y nodos. La imagen original queda en
 * el proyecto, con su identidad y transformacion intactas: trazar nunca es
 * destructivo.
 */
export function confirmarTrazado() {
  if (!TRAZO.activo || !TRAZO.raster) return null;
  const raster = TRAZO.raster;
  const originalOpacity = TRAZO.opacidadOriginal;
  let entregado = null;

  if (tracePreviewGroup && tracePreviewGroup.children.length > 0) {
    if (typeof window.saveHistory === "function") {
      window.saveHistory();
    }

    const piezas = [];
    tracePreviewGroup.children.forEach(p => {
      const clon = p.clone({ insert: false });
      // El calco se entrega como geometria rellena: no depende de
      // strokeWidth y queda disponible para Calado, Fusionar y nodos.
      clon.strokeColor = null;
      clon.strokeWidth = 0;
      clon.fillColor = new paper.Color("#111827");
      setSemanticKind(clon, VECTOR_KIND.SOLID);
      clon.data = {
        ...(p.data || {}),
        locked: false,
        label: "Trazado",
        userImported: true,
        source: "image-trace",
        isSolidShape: true,
        isFusionReceptor: true
      };
      piezas.push(clon);
    });

    const grupo = new paper.CompoundPath({ insert: false });
    piezas.forEach(path => grupo.addChild(path));
    setSemanticKind(grupo, VECTOR_KIND.SOLID);
    grupo.data = {
      locked: false,
      label: "Imagen Vectorizada (" + (raster.data?.label || "Trazado") + ")",
      userImported: true,
      source: "image-trace",
      isSolidShape: true,
      isFusionReceptor: true,
      decomposedLayer: true
    };
    grupo.fillColor = new paper.Color("#111827");
    grupo.strokeColor = null;
    grupo.strokeWidth = 0;
    try { grupo.data.geomBase = grupo.clone({ insert: false }); } catch (_) {}
    const final = ensureMockupContainment(grupo);

    // Antes estos dos fallos se comian en silencio y el cliente apritaba
    // "Aplicar trazado" y no pasaba absolutely nada. Ahora avisa: si el vector
    // no llega al lienzo, es un fallo que hay que ver, no tragarse.
    if (!final || !final.parent) {
      if (!paper.project.activeLayer) {
        console.error("[EKKO TRAZO] no hay capa activa: el trazado no se pudo colocar");
      }
    }
    try {
      const capa = paper.project.activeLayer || paper.project.layers.find(l => l.name === "designLayer");
      if (!capa) throw new Error("no hay ninguna capa donde colocar el trazado");
      capa.addChild(final);
      console.log("[EKKO TRAZO] trazado entregado en la capa", capa.name, "con", piezas.length, "trazos");
    } catch (e) {
      console.error("[EKKO TRAZO] no se pudo colocar el trazado en el lienzo:", e);
    }
    final.data = {
      ...(final.data || {}),
      mockupContainment: final !== grupo || !!window.currentMockup
    };

    if (window.currentMockup) {
      try { final.insertBelow(window.currentMockup); } catch (_) {}
    }
    entregado = final;
  }

  try { raster.opacity = originalOpacity; } catch (_) {}
  TRAZO.activo = false;
  TRAZO.raster = null;
  if (tracePreviewGroup) {
    try { tracePreviewGroup.remove(); } catch (_) {}
    tracePreviewGroup = null;
  }
  try { cerrarParametros(); } catch (_) {}
  if (entregado) {
    try { window.selectItem?.(entregado); } catch (_) {}
  }
  try { paper.view?.update?.(); } catch (_) {}
  return entregado;
}

if (typeof window !== "undefined") {
  window.EKKO = window.EKKO || {};
  // Puente con commandParameters.js: el panel llama a esto cada vez que el
  // cliente mueve un control o aprieta una accion. El panel no sabe nada de
  // pixeles; este modulo no sabe nada de DOM salvo leer sus controles.
  window.EKKO.trazoVivo = trazoVivo;
  window.EKKO.confirmarTrazo = confirmarTrazado;
  window.EKKO.cancelarTrazo = cancelarTrazado;
}
