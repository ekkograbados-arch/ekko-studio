import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { buildOutlineGeometry } from "./outlineGeometry.js";
import { alphaSilhouetteContours } from "./contorno.js";
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
  // El panel ofrece Niveles 2-8: el tope acompana al panel (antes era 6 y
  // en Lineas/Croquis los niveles 7-8 se perian en silencio).
  const n = Math.max(1, Math.min(8, Math.round(niveles) || 1));
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

// --- MODO COLOR: LA CALCOMANIA POR REGIONES ------------------------------
// El concepto aprobado: Trazar separa la imagen en REGIONES de color y
// entrega cada region como una pieza cerrada rellena. El anidado sale solo:
// una region dentro de otra deja un hueco en la de afuera (mascara por
// region + marching squares), y con fillRule evenodd el conjunto completa
// la calcomania. Todo se entrega en NEGRO: es material para grabado laser.
//
// Pipeline (todo sobre una lectura de pixeles a <=480px):
//   1. cuantizar a N colores (median cut sobre histograma de 5 bits)
//   2. etiquetar cada pixel con su color mas cercano (alfa<=128 = vacio)
//   3. filtro de motas: voto por mayoria 3x3, tantas pasadas como pida
//   4. regiones = componentes conexas (4-conex) de cada etiqueta
//   5. fusion de regiones chicas con la vecina de mayor contacto + tope
//   6. loops por region con el stitcher de Contorno (mascara acolchada)
// -------------------------------------------------------------------------

const MAX_LADO_TRAZO = 480;
const MAX_REGIONES = 48;

/** Lectura de pixeles a resolucion de trabajo. Reusa el patron de Contorno:
 *  canvas offscreen con willReadFrequently. */
function leerPixeles(imgSource, maxLado = MAX_LADO_TRAZO) {
  const w0 = imgSource.width || imgSource.naturalWidth || 0;
  const h0 = imgSource.height || imgSource.naturalHeight || 0;
  if (!(w0 > 0) || !(h0 > 0)) return null;
  const escala = Math.min(1, maxLado / Math.max(w0, h0));
  const w = Math.max(8, Math.round(w0 * escala));
  const h = Math.max(8, Math.round(h0 * escala));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  try { ctx.drawImage(imgSource, 0, 0, w, h); } catch (_) { return null; }
  let data = null;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch (_) { return null; }
  if (!data) return null;
  return { data, w, h };
}

/** Paleta de N colores por median cut. Se trabaja sobre BUCKETS del
 *  histograma (5 bits por canal) y no sobre pixeles: O(miles), no O(millones). */
function paletaMedianCut(data, w, h, n) {
  const hist = new Uint32Array(32768);
  let total = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (data[p + 3] <= 128) continue;
    hist[((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)] += 1;
    total += 1;
  }
  if (!total) return null;
  const entradas = [];
  for (let idx = 0; idx < 32768; idx++) {
    const c = hist[idx];
    if (!c) continue;
    entradas.push({ r: (idx >> 10) & 31, g: (idx >> 5) & 31, b: idx & 31, n: c });
  }
  if (entradas.length <= n) {
    return entradas.map(e => [e.r * 8 + 4, e.g * 8 + 4, e.b * 8 + 4]);
  }
  // Split recursivo: siempre se parte el grupo con mas (rango x peso) por su
  // canal mas ancho, en la mediana PONDERADA por cantidad de pixeles.
  let grupos = [entradas];
  while (grupos.length < n) {
    let mejor = -1, mejorScore = 0, mejorCanal = 0;
    grupos.forEach((g, i) => {
      if (g.length < 2) return;
      let rmin = 31, rmax = 0, gmin = 31, gmax = 0, bmin = 31, bmax = 0, count = 0;
      g.forEach(e => {
        count += e.n;
        if (e.r < rmin) rmin = e.r; if (e.r > rmax) rmax = e.r;
        if (e.g < gmin) gmin = e.g; if (e.g > gmax) gmax = e.g;
        if (e.b < bmin) bmin = e.b; if (e.b > bmax) bmax = e.b;
      });
      const rr = rmax - rmin, gr = gmax - gmin, br = bmax - bmin;
      const canal = (rr >= gr && rr >= br) ? 0 : (gr >= br ? 1 : 2);
      const rango = canal === 0 ? rr : (canal === 1 ? gr : br);
      const score = rango * count;
      if (score > mejorScore) { mejorScore = score; mejor = i; mejorCanal = canal; }
    });
    if (mejor < 0) break;
    const g = grupos.splice(mejor, 1)[0];
    const clave = e => mejorCanal === 0 ? e.r : (mejorCanal === 1 ? e.g : e.b);
    g.sort((a, b) => clave(a) - clave(b));
    let suma = 0;
    g.forEach(e => { suma += e.n; });
    let acc = 0, corte = g.length - 1;
    for (let i = 0; i < g.length; i++) {
      acc += g[i].n;
      if (acc >= suma / 2) { corte = Math.min(g.length - 1, Math.max(1, i + 1)); break; }
    }
    grupos.push(g.slice(0, corte), g.slice(corte));
  }
  return grupos.map(g => {
    let tr = 0, tg = 0, tb = 0, tt = 0;
    g.forEach(e => { tr += e.r * e.n; tg += e.g * e.n; tb += e.b * e.n; tt += e.n; });
    return [Math.round(tr / tt) * 8 + 4, Math.round(tg / tt) * 8 + 4, Math.round(tb / tt) * 8 + 4];
  });
}

/** Etiqueta cada pixel con el color de la paleta mas cercano. -1 = vacio. */
function etiquetarPorPaleta(data, w, h, paleta) {
  const labels = new Int16Array(w * h).fill(-1);
  const k = paleta.length;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (data[p + 3] <= 128) continue;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    let mejor = 0, mejorD = Infinity;
    for (let c = 0; c < k; c++) {
      const dr = r - paleta[c][0], dg = g - paleta[c][1], db = b - paleta[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < mejorD) { mejorD = d; mejor = c; }
    }
    labels[i] = mejor;
  }
  return labels;
}

/** Filtro de motas: voto por mayoria en la ventana 3x3 (el vacio tambien
 *  vota). Empate o sin mayoria clara: el pixel se queda como esta. */
function filtrarMotas(labels, w, h, passes) {
  for (let pasada = 0; pasada < passes; pasada++) {
    const copia = labels.slice();
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
        // etiquetas -1..7 -> indice 0..8
        const conteo = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        let total = 0;
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            const v = copia[yy * w + xx];
            conteo[v + 1] += 1;
            total += 1;
          }
        }
        let mejorV = copia[i], mejorC = -1;
        for (let v = 0; v < conteo.length; v++) {
          if (conteo[v] > mejorC) { mejorC = conteo[v]; mejorV = v - 1; }
        }
        // Solo cambia con mayoria ESTRICTA (mas de la mitad de la ventana):
        // asi el filtro limpia motas sin comerse detalles legitimos.
        if (mejorV !== copia[i] && mejorC * 2 > total) labels[i] = mejorV;
      }
    }
  }
}

/** Regiones = componentes conexas 4-conex de cada etiqueta. BFS con pila
 *  plana: sin recursion, sin reflow. */
function regionesDe(labels, w, h) {
  const region = new Int32Array(w * h).fill(-1);
  const tams = [];
  const pila = new Int32Array(w * h);
  for (let semilla = 0; semilla < w * h; semilla++) {
    if (labels[semilla] < 0 || region[semilla] >= 0) continue;
    const et = labels[semilla];
    const id = tams.length;
    let tope = 0;
    pila[tope++] = semilla;
    region[semilla] = id;
    let tam = 0;
    while (tope > 0) {
      const j = pila[--tope];
      tam += 1;
      const x = j % w;
      if (x > 0 && region[j - 1] < 0 && labels[j - 1] === et) { region[j - 1] = id; pila[tope++] = j - 1; }
      if (x < w - 1 && region[j + 1] < 0 && labels[j + 1] === et) { region[j + 1] = id; pila[tope++] = j + 1; }
      if (j >= w && region[j - w] < 0 && labels[j - w] === et) { region[j - w] = id; pila[tope++] = j - w; }
      if (j < w * (h - 1) && region[j + w] < 0 && labels[j + w] === et) { region[j + w] = id; pila[tope++] = j + w; }
    }
    tams.push(tam);
  }
  return { region, tams };
}

/** Fusion de regiones chicas: cada una se absorbe por la vecina con la que
 *  comparte mas borde. Un solo barrido de contactos + proceso de menor a
 *  mayor, asi las cadenas de motas se absorben en cascada. */
function fusionarChicas(region, tams, w, h, minArea) {
  const n = tams.length;
  if (!n) return;
  // Contactos entre regiones vecinas (un solo barrido, derecha y abajo).
  const contacto = new Map(); // id -> Map(vecino -> pixeles de borde)
  const anotar = (a, b) => {
    if (a === b) return;
    let ma = contacto.get(a);
    if (!ma) { ma = new Map(); contacto.set(a, ma); }
    ma.set(b, (ma.get(b) || 0) + 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = region[i];
      if (a < 0) continue;
      if (x < w - 1) { const b = region[i + 1]; if (b >= 0) { anotar(a, b); anotar(b, a); } }
      if (y < h - 1) { const b = region[i + w]; if (b >= 0) { anotar(a, b); anotar(b, a); } }
    }
  }
  const chicas = [];
  for (let id = 0; id < n; id++) if (tams[id] > 0 && tams[id] < minArea) chicas.push(id);
  chicas.sort((a, b) => tams[a] - tams[b]);
  for (const id of chicas) {
    if (tams[id] <= 0 || tams[id] >= minArea) continue; // ya fusionada o ya grande
    const vecinos = contacto.get(id);
    let mejor = -1, mejorC = 0;
    if (vecinos) vecinos.forEach((c, v) => {
      if (tams[v] > 0 && c > mejorC) { mejorC = c; mejor = v; }
    });
    if (mejor < 0) continue; // isla sin vecinos: se queda
    // Reasignar todos los pixeles de la region id a mejor.
    for (let i = 0; i < w * h; i++) if (region[i] === id) region[i] = mejor;
    tams[mejor] += tams[id];
    tams[id] = 0;
  }
  // Tope duro de regiones: si quedan demasiadas (fotos con dither), se
  // absorben las mas chicas hasta volver al tope. El detalle progresivo lo
  // dan los Niveles; este tope solo evita miles de islas inservibles.
  let vivas = 0;
  for (let id = 0; id < n; id++) if (tams[id] > 0) vivas++;
  while (vivas > MAX_REGIONES) {
    let chica = -1, chicaTam = Infinity;
    for (let id = 0; id < n; id++) if (tams[id] > 0 && tams[id] < chicaTam) { chicaTam = tams[id]; chica = id; }
    if (chica < 0) break;
    const vecinos = contacto.get(chica);
    let mejor = -1, mejorC = 0;
    if (vecinos) vecinos.forEach((c, v) => {
      if (tams[v] > 0 && c > mejorC) { mejorC = c; mejor = v; }
    });
    if (mejor < 0) break;
    for (let i = 0; i < w * h; i++) if (region[i] === chica) region[i] = mejor;
    tams[mejor] += tams[chica];
    tams[chica] = 0;
    vivas--;
  }
}

/** Loops de una region: mascara binaria acolchada con un anillo vacio (asi
 *  las regiones que tocan el borde de la imagen cierran bien) y el stitcher
 *  de Contorno en modo grid. */
function loopsDeRegion(region, tams, id, w, h) {
  const wp = w + 2, hp = h + 2;
  const mask = new Uint8Array(wp * hp); // 0 = vacio, ya acolchado
  for (let y = 0; y < h; y++) {
    const fila = (y + 1) * wp + 1;
    for (let x = 0; x < w; x++) {
      if (region[y * w + x] === id) mask[fila + x] = 255;
    }
  }
  return alphaSilhouetteContours({ alpha: mask, width: wp, height: hp }, null, { enGrid: true })
    .map(loop => loop.map(p => ({ x: p.x - 1, y: p.y - 1 }))); // quitar el acolchado
}

/** El pipeline completo del modo Color. Devuelve loops en coordenadas de
 *  grid (nodo = centro del pixel) listos para mapear a la pieza. */
function trazarRegiones(muestra, { niveles = 4, ruido = 1, silueta = false } = {}) {
  const { data, w, h } = muestra;
  let labels;
  if (silueta) {
    // SILUETA: una sola etiqueta. Todo lo opaco es una region; el hueco es
    // el resto. El filtro de motas limpia el alfa granulado.
    labels = new Int16Array(w * h).fill(-1);
    for (let i = 0, p = 3; i < w * h; i++, p += 4) {
      if (data[p] > 128) labels[i] = 0;
    }
  } else {
    const paleta = paletaMedianCut(data, w, h, Math.max(2, Math.min(8, niveles)));
    if (!paleta) return { loops: [], regiones: 0 };
    labels = etiquetarPorPaleta(data, w, h, paleta);
  }
  filtrarMotas(labels, w, h, Math.max(0, Math.min(3, Math.round(ruido) || 0)));
  const { region, tams } = regionesDe(labels, w, h);
  let opaco = 0;
  for (let i = 0; i < w * h; i++) if (labels[i] >= 0) opaco++;
  // minArea: motas por debajo del 0.1% del area opaca (o de 8 pixeles en
  // absolute) se funden con la vecina.
  const minArea = Math.max(8, Math.round(opaco * 0.001));
  fusionarChicas(region, tams, w, h, minArea);
  const loops = [];
  let regiones = 0;
  for (let id = 0; id < tams.length; id++) {
    if (tams[id] <= 0) continue;
    const loopsRegion = loopsDeRegion(region, tams, id, w, h);
    if (loopsRegion.length) { regiones++; loops.push(...loopsRegion); }
  }
  return { loops, regiones };
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

// Cache del calco: los loops crudos (sin suavizar) dependen de TODO menos
// de la Suavidad. Mover la Suavidad rehace solo los Path y los simplify,
// que es lo barato; mover Niveles/Ruido/Detalle recalcula de verdad.
const CACHE_TRAZO = { clave: null, loops: null };

export function runTracePreview(raster, threshold, cutoff = 0, smoothness = 1.0, optimize = 0.2, sketchTrace = false, onlyOuter = false, outlineWidth = 0, outlineSide = "center", niveles = 4, modo = "color", ruido = 1) {
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

    const bounds = raster.bounds;
    const claseModo = ["color", "lineas", "croquis", "silueta"].includes(String(modo))
      ? String(modo) : "color";

    // Loops crudos en coordenadas de grid (nodo = centro del pixel). Cada
    // modo los produce a su manera; el mapeo a la pieza es el mismo para
    // todos, asi que la escala del raster (y su rotacion, via
    // localToGlobal) se respeta igual que siempre.
    let loops = null;
    let muestra = null;
    if (claseModo === "color" || claseModo === "silueta") {
      muestra = leerPixeles(imgSource);
      if (!muestra) {
        console.warn("[EKKO TRAZO] la imagen no tiene pixeles legibles todavia");
        return;
      }
      const clave = [claseModo, niveles, ruido, fuente.id, muestra.w, muestra.h].join("|");
      if (CACHE_TRAZO.clave === clave && CACHE_TRAZO.loops) {
        loops = CACHE_TRAZO.loops;
      } else {
        const resultado = trazarRegiones(muestra, {
          niveles,
          ruido,
          silueta: claseModo === "silueta"
        });
        loops = resultado.loops;
        CACHE_TRAZO.clave = clave;
        CACHE_TRAZO.loops = loops;
      }
    } else {
      // LINEAS / CROQUIS: el calco de siempre por bandas de gris.
      muestra = leerPixeles(imgSource);
      if (!muestra) {
        console.warn("[EKKO TRAZO] la imagen no tiene pixeles legibles todavia");
        return;
      }
      const clave = [claseModo, niveles, threshold, cutoff, fuente.id, muestra.w, muestra.h].join("|");
      if (CACHE_TRAZO.clave === clave && CACHE_TRAZO.loops) {
        loops = CACHE_TRAZO.loops;
      } else {
        const imageData = { data: muestra.data, width: muestra.w, height: muestra.h };
        loops = traceRasterBandas(imageData, {
          umbral: threshold, corte: cutoff, niveles, croquis: claseModo === "croquis"
        }).flatMap(b => b.contours);
        CACHE_TRAZO.clave = clave;
        CACHE_TRAZO.loops = loops;
      }
    }

    const temporaryPaths = [];

    loops.forEach(points => {
      const pathPoints = points.map(p => {
        // Mapeo exacto basado en el centro de pixel (p.x + 0.5): el nodo del
        // grid ES el centro del pixel, en los cuatro modos. Se divide por el
        // tamano de la MUESTRA (el grid donde viven los loops, <=480px), no
        // por el del raster: si la imagen venia mas grande, el grid es mas
        // chico y dividir por el raster encogeria el calco.
        const pctX = (p.x + 0.5) / muestra.w;
        const pctY = (p.y + 0.5) / muestra.h;

        // Mapear a coordenadas locales de Paper.js (que van desde
        // -raster.width/2 hasta raster.width/2) y de ahi a global de forma
        // matricial: respeta escala y rotacion sin gap.
        const localPoint = new paper.Point(
          (pctX - 0.5) * raster.width,
          (pctY - 0.5) * raster.height
        );
        if (typeof raster.localToGlobal === 'function') {
          return raster.localToGlobal(localPoint);
        }
        return new paper.Point(
          bounds.left + pctX * bounds.width,
          bounds.top + pctY * bounds.height
        );
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
  opacidadOriginal: 1,
  modo: "color"
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
  const modoRaw = modoEl ? String(modoEl.value || "color") : "color";
  // Modos: color (calcomania por regiones), lineas (calco por bandas de
  // gris de siempre), croquis (bandas con umbral adaptativo), silueta (una
  // sola pieza con todo lo opaco y sus huecos).
  const modo = ["color", "lineas", "croquis", "silueta"].includes(modoRaw) ? modoRaw : "color";
  const nivelesRaw = num("traceNiveles", 4);
  const ruidoRaw = num("traceRuido", 1);
  return {
    modo,
    niveles: Math.max(2, Math.min(8, Number.isFinite(nivelesRaw) ? Math.round(nivelesRaw) : 4)),
    ruido: Math.max(0, Math.min(3, Number.isFinite(ruidoRaw) ? Math.round(ruidoRaw) : 1)),
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
  TRAZO.modo = c.modo;
  runTracePreview(TRAZO.raster, c.detalle, 0, c.suavidad, 0.2, c.croquis, false, 0, "center", c.niveles, c.modo, c.ruido);
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
      // NEGRO PURO: los vectores de Trazar siempre se entregan en #000000.
      clon.strokeColor = null;
      clon.strokeWidth = 0;
      clon.fillColor = new paper.Color("#000000");
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
    // evenodd: con TODOS los loops (de todas las regiones) en un solo
    // CompoundPath, el anidado sale solo: un loop dentro de otro agujerea a
    // su madre, y un tercero dentro del hueco vuelve a rellenar. Es lo que
    // completa la calcomania cuando una region esta dentro de otra.
    grupo.fillRule = "evenodd";
    setSemanticKind(grupo, VECTOR_KIND.SOLID);
    const nombreModo = ({ color: "Color", lineas: "Lineas", croquis: "Croquis", silueta: "Silueta" })[TRAZO.modo || "color"] || "Color";
    grupo.data = {
      locked: false,
      label: "Vectorizado (" + nombreModo + ") - " + (raster.data?.label || "Trazado"),
      userImported: true,
      source: "image-trace",
      isSolidShape: true,
      isFusionReceptor: true,
      decomposedLayer: true
    };
    grupo.fillColor = new paper.Color("#000000");
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
