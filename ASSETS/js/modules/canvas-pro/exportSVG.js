/* =========================================================================
MÃÆÃÂ³dulo: ASSETS/js/modules/canvas-pro/exportSVG.js (Industrial Laser Edition - v35 PRO)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/exportSVG.js

DescripciÃÆÃÂ³n:
Procesador y exportador de SVG optimizado para corte y grabado lÃÆÃÂ¡ser
en el programa de grabado/lÃÆÃÂ¡ser, CNC y maquinaria industrial.

Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÃÆÃ¢â¬ÅN POR JERARQUÃÆÃÂA DE CONTENCIÃÆÃ¢â¬ÅN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÃÆÃ¢â¬ÅSTICO DE ARQUITECTURA (Diagnostico.txt)
- RESULTADO ESPERADO (Huecos fÃÆÃÂ­sicos reales sin transparencias cosmÃÆÃÂ©ticas,
  purgado de controladores isHole para evitar dobles lÃÆÃÂ­neas de quemado,
  vectorizaciÃÆÃÂ³n recursiva tipogrÃÆÃÂ¡fica Fonts-to-Paths y limpieza de artefactos).

FASE DE OPERACIÃÆÃ¢â¬ÅN:
1. SelecciÃÆÃÂ³n y clonado defensivo de la capa de diseÃÆÃÂ±o (designLayer o activeLayer).
2. Purgado inicial de artefactos auxiliares (mockups, guÃÆÃÂ­as, cotas, reglas, cajas de selecciÃÆÃÂ³n).
3. Desempaquetado seguro de grupos de recorte (clipGroup) preservando transformaciones globales.
4. VectorizaciÃÆÃÂ³n recursiva de tipografÃÆÃÂ­as (PointText, CurvedText, SpacedText a CompoundPath/Path).
5. MaterializaciÃÆÃÂ³n booleana CSG fÃÆÃÂ­sica de calados activos sobre masas sÃÆÃÂ³lidas inferiores.
6. Purgado total de entidades de calado interactivo (isHole) para anular dobles cortes en lÃÆÃÂ¡ser.
7. SanitizaciÃÆÃÂ³n de reglas de relleno (fillRule = "evenodd") y eliminaciÃÆÃÂ³n de trazados degenerados.
8. AsignaciÃÆÃÂ³n de estilos visibles (fill/stroke) para reconocimiento de capas en el programa de grabado/lÃÆÃÂ¡ser.
9. InyecciÃÆÃÂ³n de unidades fÃÆÃÂ­sicas mÃÆÃÂ©tricas reales (mm) y precisiÃÆÃÂ³n micromÃÆÃÂ©trica (5 decimales).
========================================================================= */

import { recalculateDynamicSubtractions, interiorPointOf, evenOddContains, getGlobalUnsubtractedPath } from "./geometricUngroup.js";
import { getVirtualHoleEntries } from "./fusionCore.js";
import { textToCompoundPath } from "./fontToPath.js";
import { getPublicOwner } from "./designGeometry.js";
import { getCanonicalDesignLayer, collectVectorOwners, semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { notice } from "./ekkoNotice.js";

/**
 * Obtiene el elemento de contenido real si el item estÃÆÃÂ¡ encapsulado en un grupo de recorte.
 * @param {paper.Item} item
 * @returns {paper.Item|null}
 */
function getContentItem(item) {
    if (!item) return null;
    // Owner resolution is semantic and centralized. A containment wrapper
    // without an explicit public owner is not exportable design geometry.
    const owner = getPublicOwner(item);
    if (owner) return owner;
    return item.data?.clipGroup ? null : item;
}

/**
 * Aplica recursivamente una matriz a los segmentos de un trazado
 */
function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix || matrix.isIdentity()) return;
    if (path.segments) {
        path.segments.forEach(seg => {
            const originalPoint = seg.point.clone();
            const originalHandleIn = seg.handleIn ? seg.handleIn.clone() : null;
            const originalHandleOut = seg.handleOut ? seg.handleOut.clone() : null;
            seg.point = matrix.transform(originalPoint);
            if (originalHandleIn) {
                const absoluteHandle = originalPoint.add(originalHandleIn);
                seg.handleIn = matrix.transform(absoluteHandle).subtract(seg.point);
            }
            if (originalHandleOut) {
                const absoluteHandle = originalPoint.add(originalHandleOut);
                seg.handleOut = matrix.transform(absoluteHandle).subtract(seg.point);
            }
        });
    }
    if (path.children && Array.isArray(path.children)) {
        path.children.forEach(child => bakeMatrixIntoPath(child, matrix));
    }
}

/**
 * Convierte un PointText o grupo tipogrÃÆÃÂ¡fico a un CompoundPath/Path vectorial horneado.
 * @param {paper.Item} textItem
 * @returns {paper.Item|null}
 */
async function vectorizeTextItem(textItem) {
    if (!textItem) return null;
    try {
        const path = await textToCompoundPath(textItem);
        if (!path) return null;
        path.data = {
            ...(textItem.data || {}),
            label: (textItem.data?.label || "Texto") + " (Vectorizado)",
            isTextVector: true,
            source: "text-vector"
        };
        return path;
    } catch (err) {
        console.warn("[EKKO EXPORT WARNING] FallÃÆÃÂ³ la conversiÃÆÃÂ³n OpenType:", err);
        return null;
    }
}

/* ---------------------- FILTRO DE ESCALA DE GRISES (JSON) ----------------
   Referencia de tono: DR_bn (el filtro que el taller aplica a mano para que
   TODA foto grave bien en el programa de grabado/lÃÆÃÂ¡ser sin tocar parÃÆÃÂ¡metros). Cada raster del
   DISEÃÆÃ¢â¬ËO ÃÂ¢Ã¢âÂ¬Ã¢â¬Ânunca del mockupÃÂ¢Ã¢âÂ¬Ã¢â¬Â pasa por cuatro pasos en cada exportaciÃÆÃÂ³n:

   1. CALIDAD (la lecciÃÆÃÂ³n entre DR_color y DR_bn: MISMA foto, el bn tiene
      4x mÃÆÃÂ¡s pÃÆÃÂ­xeles y MUCHO mÃÆÃÂ¡s detalle). AmpliaciÃÆÃÂ³n progresiva (pasos
      de <= 2x con suavizado de la mejor calidad) hasta el objetivo de
      lado, y luego realce profesional:
        - PROFUNDIDAD (efecto 3D): contraste local con radio grande; el
          rostro salta hacia adelante y la ropa se hunde hacia atrÃÆÃÂ¡s.
        - NITIDEZ: unsharp fino (radio chico) para pestaÃÆÃÂ±as, sonrisa,
          pliegues: definiciÃÆÃÂ³n de grabado, no de foto lavada.
   2. GRIS por luminancia (Rec 709): la foto deja de ser color.
   3. AUTO-NIVELES adaptativo: 1% de recorte en cada punta del histograma
      PROPIO de la imagen. Normaliza brillo/contraste: una foto milka y una
      quemada terminan en la misma "entrada normalizada".
   4. CURVA DE REFERENCIA: nodos cuantil-cuantil medidos del par
      DR_colorÃÂ¢Ã¢â¬Â Ã¢â¬â¢DR_bn (la propuesta superadora: reproduce su look y es
      editable).

   El JSON entero se puede reemplazar en vivo con localStorage
   "ekkoFiltroGrises" (mismo formato) para probar otra curva sin editar el
   archivo. options.filtroGrises === false lo desactiva. */
const EKKO_GRIS_DEFAULT = {
    id: "EKKO-GRIS-v2",
    referencia: "DR_bn",
    luminancia: [0.2126, 0.7152, 0.0722],
    autoNiveles: { clipNegroPct: 1, clipBlancoPct: 1 },
    curva: {
        tipo: "nodos",
        nodos: [
            [0.0, 0.0],
            [0.031, 0.075],
            [0.09, 0.168],
            [0.145, 0.228],
            [0.506, 0.328],
            [0.761, 0.724],
            [0.883, 0.888],
            [1.0, 1.0]
        ]
    },
    /* Calidad del grabado: DR_bn llega a 2000px en el lado CHICO desde una
       fuente de 800 px: el resto se PALPA en el grabado. Ampliamos la foto
       al lado objetivo antes de tono y realce; presupuestoPx protege la
       memoria en fotos gigantes. profundidad/nitidez en fracciÃÆÃÂ³n (0 apaga). */
    calidad: {
        objetivoLado: 2000,
        presupuestoPx: 16000000,
        profundidad: 0.55,
        nitidez: 0.9
    }
};

function construirLUTGris(cfg) {
    const out = new Uint8Array(256);
    if (cfg && Array.isArray(cfg.nodosLUT) && cfg.nodosLUT.length === 256) {
        for (let i = 0; i < 256; i++) {
            out[i] = Math.max(0, Math.min(255, Math.round(Number(cfg.nodosLUT[i]) || 0)));
        }
        return out;
    }
    const bruta = (cfg && cfg.curva && Array.isArray(cfg.curva.nodos) && cfg.curva.nodos.length >= 2)
        ? cfg.curva.nodos : [[0, 0], [1, 1]];
    const nodos = bruta
        .map(n => [Math.min(1, Math.max(0, Number(n[0]) || 0)), Math.min(1, Math.max(0, Number(n[1]) || 0))])
        .sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        if (t <= nodos[0][0]) { out[i] = Math.round(nodos[0][1] * 255); continue; }
        if (t >= nodos[nodos.length - 1][0]) { out[i] = Math.round(nodos[nodos.length - 1][1] * 255); continue; }
        let k = 0;
        while (k < nodos.length - 2 && t > nodos[k + 1][0]) k++;
        const a = nodos[k], b = nodos[k + 1];
        const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
        out[i] = Math.max(0, Math.min(255, Math.round((a[1] + f * (b[1] - a[1])) * 255)));
    }
    return out;
}

function leerFiltroGrises() {
    try {
        const crudo = localStorage.getItem("ekkoFiltroGrises");
        if (crudo) {
            const parsed = JSON.parse(crudo);
            if (parsed && typeof parsed === "object") {
                if (Array.isArray(parsed.nodosLUT) && parsed.nodosLUT.length === 256) return parsed;
                if (parsed.curva && Array.isArray(parsed.curva.nodos)) return parsed;
            }
        }
    } catch (_) {}
    return EKKO_GRIS_DEFAULT;
}

/* ------------------- CALIDAD: ampliaciÃÆÃÂ³n + realce (v2) ------------------- */

/* TamaÃÆÃÂ±o final del raster: si el lado mÃÆÃÂ¡s chico queda por debajo del
   objetivo se amplÃÆÃÂ­a (igual que el paso DR_colorÃÂ¢Ã¢â¬Â Ã¢â¬â¢DR_bn); el presupuesto de
   pÃÆÃÂ­xeles acota el resultado para no fundir la memoria con fotos enormes. */
function destinoCalidad(w0, h0, cal) {
    const obj = Math.min(6000, Math.max(400, Number(cal.objetivoLado) || 2000));
    const capPx = Math.min(40000000, Math.max(1000000, Number(cal.presupuestoPx) || 16000000));
    const lado0 = Math.max(w0, h0);
    const f = lado0 < obj ? obj / lado0 : 1;
    let wT = Math.round(w0 * f), hT = Math.round(h0 * f);
    if (wT * hT > capPx) { const k = Math.sqrt(capPx / (wT * hT)); wT = Math.round(wT * k); hT = Math.round(hT * k); }
    return { w: Math.max(1, wT), h: Math.max(1, hT) };
}

/* AmpliaciÃÆÃÂ³n progresiva: cada paso crece como mucho 2x con smoothing de la
   mejor calidad. El zoom de un solo tirÃÆÃÂ³n del navegador tiende a bilinear
   blando; los pasos chicos acumulan mucha mÃÆÃÂ¡s definiciÃÆÃÂ³n utilizable. */
function ampliacionSuave(fuente, w0, h0, wT, hT) {
    let actual = fuente, cw = w0, ch = h0, pasos = 0;
    while ((cw * 2 <= wT && ch * 2 <= hT) && pasos < 8) {
        const c = document.createElement("canvas");
        c.width = cw * 2; c.height = ch * 2;
        const x = c.getContext("2d");
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
        try { x.drawImage(actual, 0, 0, c.width, c.height); } catch (_) { return null; }
        actual = c; cw = c.width; ch = c.height; pasos++;
    }
    if (cw !== wT || ch !== hT) {
        const cF = document.createElement("canvas");
        cF.width = wT; cF.height = hT;
        const xF = cF.getContext("2d");
        xF.imageSmoothingEnabled = true; xF.imageSmoothingQuality = "high";
        try { xF.drawImage(actual, 0, 0, wT, hT); } catch (_) { return null; }
        actual = cF;
    }
    return actual;
}

/* Desenfoque de caja separable con ventana deslizante: O(px) por pasada,
   exactas para ramos de radio grande (la profundidad usa radio ~lado/16). */
function desenfoqueCaja(v, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const win = 2 * r + 1;
    for (let y = 0; y < h; y++) {
        const fila = y * w;
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += v[fila + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
            tmp[fila + x] = acc / win;
            acc += v[fila + Math.min(w - 1, x + r + 1)] - v[fila + Math.max(0, x - r)];
        }
    }
    for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
            out[y * w + x] = acc / win;
            acc += tmp[(y + r + 1 > h - 1 ? h - 1 : y + r + 1) * w + x] - tmp[(y - r < 0 ? 0 : y - r) * w + x];
        }
    }
    return out;
}

/* Dos pasadas de caja (ancha + angosta) aproximan una gaussiana suave:
   suficiente para el unsharp mask y mucho mÃÆÃÂ¡s barato que la exacta. */
function desenfoqueRealce(v, w, h, r) {
    return desenfoqueCaja(desenfoqueCaja(v, w, h, r), w, h, Math.max(1, Math.round(r * 0.6)));
}

/* PROFUNDIDAD (3D) + NITIDEZ sobre el gris final. La profundidad es un
   unsharp de radio grande (el contraste LOCAL da el volumen que DR_bn
   muestra en el rostro y la ropa). La nitidez es el unsharp fino clÃÆÃÂ¡sico.
   La MÃÆÃÂSCARA vivo separa los pÃÆÃÂ­xeles reales de los vacÃÆÃÂ­os: los vacÃÆÃÂ­os
   participan en los desenfoques como gris NEUTRO (no inclinan el borde)
   y JAMÃÆÃÂS se escriben; un gris apurado a negativo sigue siendo vivo. */
function realceCalidad(gris, vivo, w, h, cal) {
    const profundidad = Number(cal.profundidad) > 0 ? Number(cal.profundidad) : 0;
    const nitidez = Number(cal.nitidez) > 0 ? Number(cal.nitidez) : 0;
    if (profundidad <= 0 && nitidez <= 0) return;
    const ladoRef = Math.min(w, h);
    const neutralDe = () => {
        const neutral = new Float32Array(gris.length);
        for (let i = 0; i < neutral.length; i++) neutral[i] = vivo[i] ? gris[i] : 127;
        return neutral;
    };
    if (profundidad > 0) {
        const r = Math.max(6, Math.round(ladoRef / 16));
        const base = desenfoqueRealce(neutralDe(), w, h, r);
        for (let i = 0; i < gris.length; i++) {
            if (!vivo[i]) continue;
            gris[i] += profundidad * (gris[i] - base[i]);
        }
    }
    if (nitidez > 0) {
        const r = Math.max(1, Math.round(ladoRef / 450));
        // tras la pasada de profundidad el plano cambiÃÆÃÂ³: reconstruir el
        // neutro desde el estado actual
        const base = desenfoqueRealce(neutralDe(), w, h, r);
        for (let i = 0; i < gris.length; i++) {
            if (!vivo[i]) continue;
            gris[i] += nitidez * (gris[i] - base[i]);
        }
    }
}

/* ResoluciÃÆÃÂ³n de horneado de la contenciÃÆÃÂ³n: antes el techo de 300 dpi y
   2000 px agotaba la foto del boceto. DR_bn apunta mÃÆÃÂ¡s alto: hasta 3600 px
   de lado (600 dpi) con presupuesto absoluto de pÃÆÃÂ­xeles por si el producto
   es enorme. La ampliaciÃÆÃÂ³n del filtro aÃÆÃÂ±ade pÃÆÃÂ­xeles ANTES: esto los
   conserva en el bake en lugar de triturarlos. */
function resolucionHorneado(anchoPts, altoPts) {
    const maxDim = Math.max(anchoPts || 1, altoPts || 1, 1);
    let res = Math.max(96, Math.min(600, (72 * 3600) / maxDim));
    const wPx = (anchoPts / 72) * res, hPx = (altoPts / 72) * res;
    if (wPx * hPx > 16000000) res = res * Math.sqrt(16000000 / (wPx * hPx));
    return res;
}

/* Transforma los rasters del diseÃÆÃÂ±o de una capa temporaria. El filtro es
   SIEMPRE sobre un canvas NUEVO: el clone de un Raster comparte el canvas
   del original, y editarlos in situ mancharÃÆÃÂ­a el lienzo vivo del usuario.
   Cada pixel lejano a la opacidad queda transparente: alfa intacta. */
function aplicarFiltroGrises(capa, cfgOverride) {
    if (!capa || typeof document === "undefined") return;
    const cfg = cfgOverride || leerFiltroGrises();
    const lut = construirLUTGris(cfg);
    const pesos = (Array.isArray(cfg.luminancia) && cfg.luminancia.length === 3) ? cfg.luminancia : [0.2126, 0.7152, 0.0722];
    const clipN = Math.min(25, Math.max(0, (cfg.autoNiveles && Number.isFinite(cfg.autoNiveles.clipNegroPct)) ? cfg.autoNiveles.clipNegroPct : 1)) / 100;
    const clipB = Math.min(25, Math.max(0, (cfg.autoNiveles && Number.isFinite(cfg.autoNiveles.clipBlancoPct)) ? cfg.autoNiveles.clipBlancoPct : 1)) / 100;
    // La etapa de calidad acepta override parcial: un JSON viejo (v1) o un
    // override del localStorage sin "calidad" sigue funcionando con los
    // valores por defecto de la v2.
    const cal = Object.assign({}, EKKO_GRIS_DEFAULT.calidad, (cfg && typeof cfg.calidad === "object" && cfg.calidad) || {});
    const delMockup = (item) => {
        let p = item;
        while (p) {
            if (p.data?.mockup === true) return true;
            if (window.currentMockup && p.id === window.currentMockup.id) return true;
            p = p.parent;
        }
        return false;
    };
    const rasters = capa.getItems({ match: it => it instanceof paper.Raster && it.data?.mockup !== true });
    rasters.forEach(raster => {
        try {
            if (delMockup(raster)) return;
            // REGLA DEL DUEÃÆÃ¢â¬ËO (descargas segÃÆÃÂºn modo activo): el filtro de
            // grabado corre SOLO en Modo LÃÆÃÂ¡ser ÃÂ¢Ã¢âÂ¬Ã¢â¬Â en Modo Color todo sale con
            // los colores originales. Y un raster YA vestido (data.ekkoModoColor
            // del modo activo) ya ES el look final: no se re-toca, asÃÆÃÂ­ el
            // realce nunca se acumula en una segunda pasada.
            if (!modoLaserActivo) return;
            if (raster.data?.ekkoModoColor) return;
            const fuente = raster.image || raster.canvas || null;
            const ancho = Math.round(raster.width || 0), alto = Math.round(raster.height || 0);
            if (!fuente || ancho < 1 || alto < 1) return;
            const destino = destinoCalidad(ancho, alto, cal);
            const lienzo = ampliacionSuave(fuente, ancho, alto, destino.w, destino.h);
            if (!lienzo) return;
            const ctx = lienzo.getContext("2d");
            const wLienzo = lienzo.width, hLienzo = lienzo.height;
            let datos;
            try { datos = ctx.getImageData(0, 0, wLienzo, hLienzo); } catch (_) { return; }
            const px = datos.data;
            // histograma de luminancia de los pixeles visibles
            const hist = new Uint32Array(256);
            let n = 0;
            for (let i = 0; i < px.length; i += 4) {
                if (px[i + 3] < 128) continue;
                let l = Math.round(pesos[0] * px[i] + pesos[1] * px[i + 1] + pesos[2] * px[i + 2]);
                hist[l > 255 ? 255 : (l < 0 ? 0 : l)]++;
                n++;
            }
            if (n < 16) return;
            const punto = (frac) => {
                const objetivo = Math.floor(frac * n);
                let acum = 0, v = 255;
                for (let k = 0; k < 256; k++) {
                    acum += hist[k];
                    if (acum > objetivo) { v = k; break; }
                }
                return v;
            };
            let neg = punto(clipN);
            let bla = punto(1 - clipB);
            let rango = Math.max(1, bla - neg);
            // Imagenes casi PLANAS (fotos lavadas, logos llenos): los niveles
            // colapsarian todo a un extremo. Piso un rango minimo alrededor
            // del centro para conservar gradientes utilizables.
            if (rango < 16) {
                const centro = (neg + bla) / 2;
                neg = Math.max(0, Math.min(239, Math.round(centro - 8)));
                bla = Math.min(255, Math.max(16, Math.round(centro + 8)));
                rango = bla - neg;
            }
            const mapa = new Uint8ClampedArray(256);
            for (let k = 0; k < 256; k++) {
                let t = (k - neg) / rango;
                t = t < 0 ? 0 : (t > 1 ? 1 : t);
                mapa[k] = lut[t === 1 ? 255 : Math.round(t * 255)];
            }
            // 1) gris final por LUT en un plano float + MÃÆÃÂSCARA de vida.
            //    Todo pixel con ALFA > 0 se lava a gris (los flecos
            //    antialiaseados del recorte teÃÆÃÂ±irÃÆÃÂ­an el borde al ampliarse).
            //    El realce puede apurar la tonalidad a NEGATIVO en los
            //    contornos: la mÃÆÃÂ¡scara separa "sin color" de "gris apurado",
            //    asÃÆÃÂ­ ningÃÆÃÂºn pixel con color queda sin lavar.
            const gris = new Float32Array(wLienzo * hLienzo);
            const vivo = new Uint8Array(wLienzo * hLienzo);
            let k2 = 0;
            for (let i = 0; i < px.length; i += 4, k2++) {
                if (px[i + 3] === 0) continue;
                vivo[k2] = 1;
                let l = Math.round(pesos[0] * px[i] + pesos[1] * px[i + 1] + pesos[2] * px[i + 2]);
                l = l > 255 ? 255 : (l < 0 ? 0 : l);
                gris[k2] = mapa[l];
            }
            // 2) PROFUNDIDAD + NITIDEZ sobre el gris final (efecto 3D y
            //    definiciÃÆÃÂ³n de grabado). Es lo que DR_bn tiene y DR_color no.
            realceCalidad(gris, vivo, wLienzo, hLienzo, cal);
            // 3) escritura: gris puro (DR_bn es R=G=B), alfa intacta
            k2 = 0;
            for (let i = 0; i < px.length; i += 4, k2++) {
                if (!vivo[k2]) continue;
                const g = gris[k2] > 255 ? 255 : (gris[k2] < 0 ? 0 : Math.round(gris[k2]));
                px[i] = g; px[i + 1] = g; px[i + 2] = g;
            }
            ctx.putImageData(datos, 0, 0);
            // REEMPLAZO 1:1 con el mismo z. La ampliaciÃÆÃÂ³n mete MÃÆÃÂS pÃÆÃÂ­xeles
            // en el mismo lugar del mundo: la matriz original corresponde al
            // tamaÃÆÃÂ±o VIEJO, asÃÆÃÂ­ que su parte lineal se divide por el factor
            // de densidad (nuevo/ancho). Sin esto la foto salta 2.8x y
            // desborda el mockup: el mundo NO cambia, solo los pÃÆÃÂ­xeles.
            // TRASLACIÃÆÃ¢â¬ÅN: paper NO expone matrix.e/.f en la matriz de un
            // item (leerlos da undefinedÃÂ¢Ã¢â¬Â Ã¢â¬â¢NaN y muerde los bounds). El centro
            // del raster en el mundo SÃÆÃÂ es la traslaciÃÆÃÂ³n (los rasters viven
            // centrados), asÃÆÃÂ­ que se lee de bounds/position, jamÃÆÃÂ¡s de la
            // matriz.
            const filtrado = new paper.Raster({ canvas: lienzo, insert: false });
            try {
                const orig = raster.matrix?.clone?.() || null;
                const a = orig && isFinite(orig.a) ? orig.a : 1;
                const b = orig && isFinite(orig.b) ? orig.b : 0;
                const c = orig && isFinite(orig.c) ? orig.c : 0;
                const d = orig && isFinite(orig.d) ? orig.d : 1;
                let ce = null, cf = null;
                const bo = raster.bounds || null;
                if (bo && isFinite(bo.x)) { ce = bo.x + bo.width / 2; cf = bo.y + bo.height / 2; }
                if (ce === null || !isFinite(ce)) {
                    const p = raster.position;
                    if (p && isFinite(p.x)) { ce = p.x; cf = p.y; }
                }
                const k = lienzo.width / ancho; // amplificaciÃÆÃÂ³n de densidad
                filtrado.applyMatrix = false;
                // parte lineal dividida por k; la TRASLACIÃÆÃ¢â¬ÅN va por position
                // (paper la resuelve aun con ancestros transformados: e/f de
                // una matriz de item es local y no se puede leer directo)
                filtrado.matrix = new paper.Matrix(a / k, b / k, c / k, d / k, 0, 0);
                if (isFinite(ce)) filtrado.position = new paper.Point(ce, cf);
            } catch (_) {}
            const padre = raster.parent || capa;
            const idx = raster.index;
            raster.remove();
            padre.insertChild(idx, filtrado);
        } catch (_) {}
    });
}

/* PREPARACIÃÆÃ¢â¬ÅN DE FOTOS AL IMPORTAR (mejora de calidad automÃÆÃÂ¡tica): toda
   foto que entra al editor queda lista para el grabado ÃÂ¢Ã¢âÂ¬Ã¢â¬Â SIN recortar NI
   agrandar el encuadre ÃÂ¢Ã¢âÂ¬Ã¢â¬Â con dos pasos:
     1) DENSIDAD: si la foto tiene menos pÃÆÃÂ­xeles que los que su tamaÃÆÃÂ±o
        visual en el diseÃÆÃÂ±o necesita a 300 dpi, se amplÃÆÃÂ­a con la escalera
        progresiva (hasta el presupuesto de 16 MP); si ya alcanza, se
        respeta la resoluciÃÆÃÂ³n original.
     2) DEFINICIÃÆÃ¢â¬ÅN: unsharp por dos escalas sobre la LUMINANCIA (media
        "definiciÃÆÃÂ³n" + micro-fina) ÃÂ¢Ã¢âÂ¬Ã¢â¬Â el COLOR queda intacto (delta comÃÆÃÂºn
        por canal, sin saturar ni recolorear). Al hacer zoom en la cara
        se ve la definiciÃÆÃÂ³n mejorada, exactamente lo que pide el cliente.
   La mÃÆÃÂ¡scara vivo separa pÃÆÃÂ­xeles reales de los transparentes: los vacÃÆÃÂ­os
   entran a los desenfoques como gris neutro y JAMÃÆÃÂS se escriben.
   Si el raster tiene padre, se reemplaza en el mismo lugar conservando
   escala/posiciÃÆÃÂ³n; sin padre solo devuelve el raster nuevo (flujo de
   importaciÃÆÃÂ³n, donde el editor lo inserta despuÃÆÃÂ©s). */
function prepararFotoImportada(raster, opciones) {
    if (!raster || typeof document === "undefined") return null;
    try {
        const dpi = Math.max(96, Math.min(600, Number(opciones && opciones.dpi) || 300));
        const fuente = raster.image || raster.canvas || null;
        const ancho = Math.round(raster.width || 0), alto = Math.round(raster.height || 0);
        if (!fuente || ancho < 1 || alto < 1) return null;
        // 1) densidad objetivo: tamaÃÆÃÂ±o visual en el mundo (pts) ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ px a dpi.
        //    El importador escala el raster ANTES de llamar acÃÆÃÂ¡, asÃÆÃÂ­ que
        //    bounds trae el tamaÃÆÃÂ±o real; sin bounds uso la escala 1:1.
        let ladoPts = Math.max(ancho, alto);
        try {
            const b = raster.bounds;
            if (b && isFinite(b.width) && b.width > 0) ladoPts = Math.max(b.width, b.height);
        } catch (_) {}
        let f = ((ladoPts / 72) * dpi) / Math.max(1, ancho);
        if (f < 1) f = 1;
        if (ancho * f * alto * f > 16000000) f = Math.sqrt(16000000 / (ancho * alto));
        const wT = Math.round(ancho * f), hT = Math.round(alto * f);
        // SIEMPRE canvas nuevo: el original puede compartir pixels con
        // clones del editor; editarlo in situ mancharÃÆÃÂ­a el lienzo vivo.
        let lienzo = null;
        if (wT >= ancho * 2) {
            lienzo = ampliacionSuave(fuente, ancho, alto, wT, hT);
        }
        if (!lienzo) {
            lienzo = document.createElement("canvas");
            lienzo.width = wT; lienzo.height = hT;
            const cx = lienzo.getContext("2d");
            cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = "high";
            try { cx.drawImage(fuente, 0, 0, wT, hT); } catch (_) { return null; }
        }
        const W = lienzo.width, H = lienzo.height;
        const ctx2 = lienzo.getContext("2d");
        // NORMALIZACIÃÆÃ¢â¬ÅN del borde ampliado: la interpolaciÃÆÃÂ³n del escalado
        // ensancha los flecos del recorte y deja COLOR RESIDUAL en pÃÆÃÂ­xeles
        // casi transparentes ÃÂ¢Ã¢âÂ¬Ã¢â¬Â eso era lo que se veÃÆÃÂ­a como "puntitos
        // blancos" alrededor de la silueta sobre el lienzo. En fotos para
        // grabado todo es opaco: alfa >= 128 pasa a 255; abajo ÃÂ¢Ã¢âÂ¬Ã¢â¬Â vacÃÆÃÂ­o
        // total con color a 0. Las fotos JPEG (sin alfa) no cambian nada.
        if (wT !== ancho || hT !== alto) {
            let datosA;
            try { datosA = ctx2.getImageData(0, 0, W, H); } catch (_) { return null; }
            const pA = datosA.data;
            for (let i = 0; i < pA.length; i += 4) {
                if (pA[i + 3] >= 128) pA[i + 3] = 255;
                else { pA[i] = 0; pA[i + 1] = 0; pA[i + 2] = 0; pA[i + 3] = 0; }
            }
            ctx2.putImageData(datosA, 0, 0);
        }
        let datos;
        try { datos = ctx2.getImageData(0, 0, W, H); } catch (_) { return null; }
        const px = datos.data;
        const N = W * H;
        // plano de luminancia + mÃÆÃÂ¡scara de vida. SOLO se realcea lo
        // sÃÆÃÂ³lidamente visible (alfa >= 128): los flecos del recorte
        // (alfa parcial) JAMÃÆÃÂS se tocan ÃÂ¢Ã¢âÂ¬Ã¢â¬Â realcearlos salpicaba puntos
        // claros alrededor de la silueta. Los vacÃÆÃÂ­os entran a los
        // desenfoques como gris neutro.
        const luma = new Float32Array(N);
        const vivo = new Uint8Array(N);
        const neutral = new Float32Array(N);
        for (let i = 0, k4 = 0; i < px.length; i += 4, k4++) {
            if (px[i + 3] < 128) continue;
            vivo[k4] = 1;
            const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            luma[k4] = l; neutral[k4] = l;
        }
        for (let k4 = 0; k4 < N; k4++) if (!vivo[k4]) neutral[k4] = 128;
        // 2) definiciÃÆÃÂ³n por dos escalas (radios sobre la imagen final).
        //    Fuerzas moderadas y delta ACOTADO: mÃÆÃÂ¡s definiciÃÆÃÂ³n sin los
        //    puntitos claros del ringing en bordes y zonas blancas.
        const ladoMin = Math.min(W, H);
        const rMid = Math.max(3, Math.round(ladoMin / 85));
        const rFino = Math.max(1, Math.round(ladoMin / 450));
        const baseMid = desenfoqueRealce(neutral, W, H, rMid);
        const baseFino = desenfoqueRealce(neutral, W, H, rFino);
        for (let k4 = 0; k4 < N; k4++) {
            if (!vivo[k4]) continue;
            let d = 0.4 * (luma[k4] - baseMid[k4]) + 0.55 * (luma[k4] - baseFino[k4]);
            if (d > 30) d = 30; else if (d < -30) d = -30;
            const i = k4 * 4;
            px[i] = Math.max(0, Math.min(255, Math.round(px[i] + d)));
            px[i + 1] = Math.max(0, Math.min(255, Math.round(px[i + 1] + d)));
            px[i + 2] = Math.max(0, Math.min(255, Math.round(px[i + 2] + d)));
        }
        ctx2.putImageData(datos, 0, 0);
        // 3) reemplazo fiel: misma escala visual (matriz / k) y posiciÃÆÃÂ³n
        const filtrado = new paper.Raster({ canvas: lienzo, insert: false });
        try {
            const orig = raster.matrix?.clone?.() || null;
            const a = orig && isFinite(orig.a) ? orig.a : 1;
            const b = orig && isFinite(orig.b) ? orig.b : 0;
            const c = orig && isFinite(orig.c) ? orig.c : 0;
            const d = orig && isFinite(orig.d) ? orig.d : 1;
            const k = W / ancho;
            filtrado.applyMatrix = false;
            filtrado.matrix = new paper.Matrix(a / k, b / k, c / k, d / k, 0, 0);
            let ce = null, cf = null;
            const bo = raster.bounds || null;
            if (bo && isFinite(bo.x)) { ce = bo.x + bo.width / 2; cf = bo.y + bo.height / 2; }
            if (ce === null || !isFinite(ce)) {
                const p = raster.position;
                if (p && isFinite(p.x)) { ce = p.x; cf = p.y; }
            }
            if (isFinite(ce)) filtrado.position = new paper.Point(ce, cf);
        } catch (_) {}
        const padre = raster.parent || null;
        if (padre) {
            const idx = raster.index;
            raster.remove();
            padre.insertChild(idx, filtrado);
        }
        return filtrado;
    } catch (_) {
        return null;
    }
}

/* =========================================================================
   MODO LÃÆÃÂSER ÃÂ¢Ã¢âÂ¬Ã¢â¬Â modo de EDICIÃÆÃ¢â¬ÅN (no simulaciÃÆÃÂ³n, no ventana)

   El dueÃÆÃÂ±o lo definiÃÆÃÂ³ asÃÆÃÂ­: el lÃÆÃÂ¡ser es UNA FORMA DE EDITAR. Al entrar, SOLO
   las imÃÆÃÂ¡genes del diseÃÆÃÂ±o cambian a su look de grabado (la misma curva que
   usa la exportaciÃÆÃÂ³n: auto-niveles + tabla de tonos DR_bn + realce de
   calidad). Vectores y textos no se tocan (graban negros de fÃÆÃÂ¡brica) y el
   mockup queda tal cual estÃÆÃÂ¡ en el lienzo. Editar en vivo queda INSTANTÃÆÃÂNEO
   porque nada se re-renderiza: cada foto se "viste" UNA vez al entrar ÃÂ¢Ã¢âÂ¬Ã¢â¬Â
   mismo tamaÃÆÃÂ±o de pÃÆÃÂ­xeles, solo cambia el colorÃÂ¢Ã¢âÂ¬Ã¢â¬Â y al salir se restaura su
   color original guardado por dentro.

   GarantÃÆÃÂ­as:
   - El color original queda guardado como dataURL serializable en la data
     del item (data.ekkoModoColor.src): el vestuario entra en deshacer, en
     el proyecto .ekko y en la recarga, y un VIGILANTE corrige cualquier
     raster que cargue vestido/color al revÃÆÃÂ©s (importaciÃÆÃÂ³n nueva, deshacer,
     fusiones, reapertura del proyecto).
   - El QR (label "Codigo QR") NUNCA se viste: sigue binario limpio.
   - Exportar en Modo LÃÆÃÂ¡ser sale con ESTE look; en Modo Color con los
     colores originales. Una sola regla, sin excepciones.
   ========================================================================= */

const MODO_ORIGINALES = new WeakMap();   // raster ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ { img, src, w, h }
let modoLaserActivo = false;
let modoVistiendo = false;
let modoVigilante = null;

/* (funciÃÆÃÂ³n compartida) Del mimo patrÃÆÃÂ³n que hornearWorld() de
   prepareSVGForExport: devuelve la pieza con su GEOMETRÃÆÃÂA DE MUNDO horneada
   (clon no insertado). La usa el modo lÃÆÃÂ¡ser y la exportaciÃÆÃÂ³n de selecciÃÆÃÂ³n. */
function hornoMundo(item) {
    if (!item) return null;
    let clon = null;
    try { clon = item.clone({ insert: false }); } catch (_) { return null; }
    try {
        const matrix = item.globalMatrix?.clone?.() || clon.matrix?.clone?.();
        clon.applyMatrix = false;
        clon.matrix = new paper.Matrix();
        if (matrix && !matrix.isIdentity()) clon.transform(matrix);
        clon.applyMatrix = true;
    } catch (_) {}
    return clon;
}

/* QuÃÆÃÂ© raster JAMÃÆÃÂS se viste: los del mockup (producto) y los QR. */
function rasterModoIgnorable(raster) {
    try {
        if (!raster || raster.data?.mockup === true) return true;
        if (window.currentMockup && raster === window.currentMockup) return true;
        const etiqueta = String(raster.data?.label || "");
        if (/qr/i.test(etiqueta)) return true;
        let p = raster.parent;
        while (p) {
            if (p.data?.mockup === true) return true;
            if (window.currentMockup && p === window.currentMockup) return true;
            p = p.parent;
        }
        return false;
    } catch (_) { return true; }
}

/* El VESTIDO del modo lÃÆÃÂ¡ser: mismo tamaÃÆÃÂ±o de pÃÆÃÂ­xeles que la foto original
   (capturar el look). La curva es la MISMA que aplicarÃÆÃÂ¡ la exportaciÃÆÃÂ³n:
   auto-niveles (clip% por extremo) sobre la luminancia visible + tabla de
   tonos DR_bn + realce de calidad (profundidad+nitidez). Alfa intacta. */
function vestidoLaser(raster) {
    try {
        const fuente = raster.image || raster.canvas || null;
        const ancho = Math.round(raster.width || 0), alto = Math.round(raster.height || 0);
        if (!fuente || ancho < 1 || alto < 1 || typeof document === "undefined") return null;
        const cfg = leerFiltroGrises();
        const lut = construirLUTGris(cfg);
        const pesos = (Array.isArray(cfg.luminancia) && cfg.luminancia.length === 3) ? cfg.luminancia : [0.2126, 0.7152, 0.0722];
        const clipN = Math.min(25, Math.max(0, (cfg.autoNiveles && Number.isFinite(cfg.autoNiveles.clipNegroPct)) ? cfg.autoNiveles.clipNegroPct : 1)) / 100;
        const clipB = Math.min(25, Math.max(0, (cfg.autoNiveles && Number.isFinite(cfg.autoNiveles.clipBlancoPct)) ? cfg.autoNiveles.clipBlancoPct : 1)) / 100;
        const cal = Object.assign({}, EKKO_GRIS_DEFAULT.calidad, (cfg && typeof cfg.calidad === "object" && cfg.calidad) || {});
        const lienzo = document.createElement("canvas");
        lienzo.width = ancho; lienzo.height = alto;
        const ctx = lienzo.getContext("2d");
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(fuente, 0, 0, ancho, alto);
        let datos;
        try { datos = ctx.getImageData(0, 0, ancho, alto); } catch (_) { return null; }
        const px = datos.data;
        // histograma de luminancia de los pÃÆÃÂ­xeles visibles (mismo criterio
        // que el export: alfa >= 128 participa)
        const hist = new Uint32Array(256);
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 128) continue;
            let l = Math.round(pesos[0] * px[i] + pesos[1] * px[i + 1] + pesos[2] * px[i + 2]);
            hist[l > 255 ? 255 : (l < 0 ? 0 : l)]++;
            n++;
        }
        if (n < 16) return null;
        const punto = (frac) => {
            const objetivo = Math.floor(frac * n);
            let acum = 0, v = 255;
            for (let k = 0; k < 256; k++) {
                acum += hist[k];
                if (acum > objetivo) { v = k; break; }
            }
            return v;
        };
        let neg = punto(clipN);
        let bla = punto(1 - clipB);
        let rango = Math.max(1, bla - neg);
        if (rango < 16) {
            const centro = (neg + bla) / 2;
            neg = Math.max(0, Math.min(239, Math.round(centro - 8)));
            bla = Math.min(255, Math.max(16, Math.round(centro + 8)));
            rango = bla - neg;
        }
        const mapa = new Uint8ClampedArray(256);
        for (let k = 0; k < 256; k++) {
            let t = (k - neg) / rango;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            mapa[k] = lut[t === 1 ? 255 : Math.round(t * 255)];
        }
        const gris = new Float32Array(ancho * alto);
        const vivo = new Uint8Array(ancho * alto);
        let k2 = 0;
        for (let i = 0; i < px.length; i += 4, k2++) {
            if (px[i + 3] === 0) continue;
            vivo[k2] = 1;
            let l = Math.round(pesos[0] * px[i] + pesos[1] * px[i + 1] + pesos[2] * px[i + 2]);
            l = l > 255 ? 255 : (l < 0 ? 0 : l);
            gris[k2] = mapa[l];
        }
        realceCalidad(gris, vivo, ancho, alto, cal);
        k2 = 0;
        for (let i = 0; i < px.length; i += 4, k2++) {
            if (!vivo[k2]) continue;
            const g = gris[k2] > 255 ? 255 : (gris[k2] < 0 ? 0 : Math.round(gris[k2]));
            px[i] = g; px[i + 1] = g; px[i + 2] = g;
        }
        ctx.putImageData(datos, 0, 0);
        return lienzo;
    } catch (_) { return null; }
}

/* Veste / desviste UN raster. marca de vida cuando truly cambiÃÆÃÂ³. */
function aplicarVestuario(raster, vestir) {
    try {
        if (!raster || rasterModoIgnorable(raster)) return false;
        if (vestir) {
            if (raster.data?.ekkoModoColor) return false; // ya vestida
            const fuente = raster.image || raster.canvas;
            const w0 = Math.round(raster.width || 0), h0 = Math.round(raster.height || 0);
            if (!fuente || w0 < 1 || h0 < 1) return false; // aÃÆÃÂºn cargando: la viste el vigilante
            const src0 = (typeof raster.source === "string" && raster.source.startsWith("data:image"))
                ? raster.source
                : (typeof fuente.toDataURL === "function" ? fuente.toDataURL("image/png") : null);
            if (!src0) return false;
            const vestido = vestidoLaser(raster);
            if (!vestido) return false;
            raster.data = Object.assign({}, raster.data || {}, { ekkoModoColor: { src: src0 } });
            try {
                // Via canÃÆÃÂ³nica de paper: el setter de source carga el dataURL
                // del vestido de forma asÃÆÃÂ­ncrona y sincroniza tamaÃÆÃÂ±o/alfa.
                raster.source = vestido.toDataURL("image/png");
            } catch (_) {
                const d = Object.assign({}, raster.data || {}); delete d.ekkoModoColor; raster.data = d;
                return false;
            }
            MODO_ORIGINALES.set(raster, { img: fuente, src: src0, w: w0, h: h0 });
            return true;
        } else {
            if (!raster.data?.ekkoModoColor) return false;
            const orig = String(raster.data.ekkoModoColor.src || "");
            if (!orig) return false;
            const d = Object.assign({}, raster.data || {}); delete d.ekkoModoColor; raster.data = d;
            raster.source = orig; // recarga asÃÆÃÂ­ncrona a los pÃÆÃÂ­xeles originales
            MODO_ORIGINALES.delete(raster);
            return true;
        }
    } catch (_) { return false; }
}

/* El texto del botÃÆÃÂ³n interruptor (ÃÂ°ÃÂ¸Ã¢â¬ÂÃÂ¥ MODO LÃÆÃÂSER / ÃÂ°ÃÂ¸ÃÂ½ÃÂ¨ MODO COLOR) */
function sincronizarBotonModo() {
    try {
        const b = document.getElementById("btnEkkoPreview");
        if (!b) return;
        b.innerHTML = modoLaserActivo
            ? '<span style="font-size:13px;line-height:1;">ÃÂ°ÃÂ¸ÃÂ½ÃÂ¨</span><span class="ekko-tema-txt">MODO COLOR</span>'
            : '<span style="font-size:13px;line-height:1;">ÃÂ°ÃÂ¸Ã¢â¬ÂÃÂ¥</span><span class="ekko-tema-txt">MODO LÃÆÃÂSER</span>';
        b.title = modoLaserActivo
            ? "Salir del Modo LÃÆÃÂ¡ser: todo vuelve a los colores originales (las descargas tambiÃÆÃÂ©n)."
            : "Modo LÃÆÃÂ¡ser de ediciÃÆÃÂ³n: seguÃÆÃÂ­ editando normal ÃÂ¢Ã¢âÂ¬Ã¢â¬Â las imÃÆÃÂ¡genes muestran cÃÆÃÂ³mo se graban. Las descargas salen con este look.";
    } catch (_) {}
}

/* VIGILANTE: corrige raster vestido/color al revÃÆÃÂ©s del modo. La escena puede
   traer rasters nuevos o restaurados por fuera del toggle (importar mientras
   el modo estÃÆÃÂ¡ activo, deshacer/rehacer, fusiones, reapertura del .ekko).
   Corrige cualquier raster que estÃÆÃÂ© vestido/color al revÃÆÃÂ©s del modo actual.
   Coste por tick: O(cantidad de rasters), sin tocar pÃÆÃÂ­xeles. UNO SOLO por
   pÃÆÃÂ¡gina: si el mÃÆÃÂ³dulo entra otra vez (recarga/inyecciÃÆÃÂ³n), mata al previo. */
function iniciarVigilanteModo() {
    if (typeof window === "undefined") return;
    // Registro en lista global: cada carga del mÃÆÃÂ³dulo mata a TODOS los
    // vigilantes anteriores (evita restos fantasma de un reload/inject).
    try {
        window.__ekkoModoVigilantes = Array.isArray(window.__ekkoModoVigilantes)
            ? window.__ekkoModoVigilantes
            : [];
        window.__ekkoModoVigilantes.forEach(clearInterval);
        window.__ekkoModoVigilantes = [];
    } catch (_) {}
    // El modo se lee SIEMPRE de la API viva: si el mÃÆÃÂ³dulo entra de nuevo,
    // este vigilante sigue apuntando al estado real, no al de su instancia.
    const intervalo = setInterval(() => {
        try {
            if (modoVistiendo) return;
            const activo = (typeof window.ekkoModoLaser?.activo === "function")
                ? !!window.ekkoModoLaser.activo()
                : modoLaserActivo;
            const p = window.paper;
            if (!p || !p.project) return;
            const capa = p.project.layers.find(l => l.name === "designLayer") || p.project.activeLayer;
            if (!capa) return;
            const afecto = capa.getItems({ match: it => it instanceof p.Raster });
            if (!afecto.length) return;
            let cambios = 0;
            afecto.forEach(r => { try { if (aplicarVestuario(r, activo)) cambios++; } catch (_) {} });
            if (cambios) { try { p.view.update(); } catch (_) {} }
        } catch (_) {}
    }, 600);
    window.__ekkoModoVigilante = intervalo;   // alias rÃÆÃÂ¡pido
    window.__ekkoModoVigilantes.push(intervalo);
}

function setModoLaser(onOff) {
    if (typeof paper === "undefined" || !paper.project) return false;
    const capa = paper.project.layers.find(l => l.name === "designLayer") || paper.project.activeLayer;
    if (!capa) return false;
    if (modoVistiendo) return false;
    modoVistiendo = true;
    try {
        modoLaserActivo = !!onOff;
        let tocadas = 0;
        capa.getItems({ match: it => it instanceof paper.Raster }).forEach(raster => {
            try { if (aplicarVestuario(raster, modoLaserActivo)) tocadas++; } catch (_) {}
        });
        iniciarVigilanteModo();
        sincronizarBotonModo();
        try { paper.view.update(); } catch (_) {}
        notice(modoLaserActivo
            ? (tocadas ? "Modo LÃÆÃÂ¡ser: " + tocadas + " imagen(es) muestran cÃÆÃÂ³mo se graban. SeguÃÆÃÂ­ editando con normalidad." : "Modo LÃÆÃÂ¡ser activo (no habÃÆÃÂ­a fotos que vestir).")
            : "Modo Color: colores originales restaurados.", { kind: "ok" });
        return true;
    } finally { modoVistiendo = false; }
}

function alternarModoLaser() { return setModoLaser(!modoLaserActivo); }

/* =========================================================================
   EXPORTAR SELECCIÃÆÃ¢â¬ÅN ÃÂ¢Ã¢âÂ¬Ã¢â¬Â PNG con la selecciÃÆÃÂ³n, recortada por ORDEN DE
   APILAMIENTO (lo de arriba pisa a lo de abajo, recorte fÃÆÃÂ­sico de pÃÆÃÂ­xeles),
   mÃÆÃÂ¡scara del producto (sus huecos vuelven a ser huecos), look del MODO
   activo (Modo LÃÆÃÂ¡ser ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ grabado; Modo Color ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ colores) y DPI a elecciÃÆÃÂ³n.
   No es un aplanado en el lienzo: los objetos del proyecto quedan intactos;
   el recorte sucede solo en el PNG entregado.
   ========================================================================= */

function rasterizarRaiz(item, res) {
    const clon = hornoMundo(item);
    if (!clon) return null;
    const tmpLayer = new paper.Layer();
    let r = null;
    try {
        tmpLayer.addChild(clon);
        r = clon.rasterize(res, { insert: false });
    } catch (_) { r = null; }
    try { tmpLayer.remove(); } catch (_) {}
    try { clon.remove(); } catch (_) {}
    if (!r || !r.canvas || !(r.bounds.width > 0)) return null;
    return { canvas: r.canvas, x: r.bounds.x, y: r.bounds.y };
}

function renderSeleccionPNG(dpi) {
    if (typeof paper === "undefined" || !paper.project) return { ok: false, reason: "sin-paper" };
    const capa = paper.project.layers.find(l => l.name === "designLayer") || paper.project.activeLayer;
    if (!capa) return { ok: false, reason: "sin-capa" };
    let seleccion = (Array.isArray(window.selectedItems) && window.selectedItems.length)
        ? window.selectedItems.slice()
        : (window.selectedItem ? [window.selectedItem] : null);
    if (!seleccion) return { ok: false, reason: "sin-seleccion" };
    // Filtrar vinculo? solo contenido del diseÃÆÃÂ±o (el mockup no se exporta
    // aquÃÆÃÂ­: es de la escena, no de la pieza).
    const delMockup = (item) => {
        let p = item;
        while (p) {
            if (p.data?.mockup === true) return true;
            if (window.currentMockup && p === window.currentMockup) return true;
            p = p.parent;
        }
        return false;
    };
    seleccion = seleccion.filter(it => it && !delMockup(it));
    if (!seleccion.length) return { ok: false, reason: "sin-seleccion" };
    // jerarquia: si una raiz seleccionada contiene a otra seleccionada,
    // la raiz representa a las dos (sin doble dibujo).
    const dentro = new Set(seleccion);
    const piezas = seleccion.filter(it => {
        let p = it.parent;
        while (p && p !== capa) { if (dentro.has(p)) return false; p = p.parent; }
        return true;
    });
    if (!piezas.length) return { ok: false, reason: "sin-seleccion" };
    // ORDEN DE PINTURA global: recorrido pre-orden de la capa, igual que
    // dibuja paper: el ÃÆÃÂ­ndice decide quiÃÆÃÂ©n tapa a quiÃÆÃÂ©n.
    let orden = 0;
    const pintura = new Map();
    (function rec(n) { for (const c of n.children) { pintura.set(c, orden++); if (c.children) rec(c); } })(capa);
    piezas.sort((a, b) => (pintura.get(a) ?? 0) - (pintura.get(b) ?? 0));
    // HUECOS DE CALADO por encima: la perforaciÃÂ³n es fÃÂ­sica tambiÃÂ©n en el
    // PNG entregado Ã¢â¬â la pieza de abajo pierde el ÃÂ¡rea del hueco (igual que
    // en el SVG: hueco real, no transparencia forzada).
    const huecosSeleccion = [];
    try {
        capa.getItems({
            match: it => it.data?.isHole === true &&
                (it instanceof paper.PathItem) &&
                !(it.parent && it.parent.className === "CompoundPath") &&
                it.data?.isFusionMask !== true && it.data?.isSmartFusion !== true &&
                it.data?.isCutLine !== true
        }).forEach(h => {
            try {
                const geo = getGlobalUnsubtractedPath(h);
                if (!geo || !(h.bounds && h.bounds.width > 0)) return;
                huecosSeleccion.push({ geo, orden: pintura.get(h) ?? -1, caja: h.bounds });
            } catch (_) {}
        });
    } catch (_) {}
    // caja de la selecciÃÆÃÂ³n
    let caja = null;
    piezas.forEach(it => {
        try {
            const w = hornoMundo(it);
            if (!w) return;
            const b = w.bounds;
            caja = caja ? caja.unite(b) : b.clone();
            try { w.remove(); } catch (_) {}
        } catch (_) {}
    });
    if (!caja || !(caja.width > 0) || !(caja.height > 0)) return { ok: false, reason: "sin-caja" };
    // PRESUPUESTO: nunca mÃÆÃÂ¡s de 36 MP ÃÂ¢Ã¢âÂ¬Ã¢â¬Â si el pedido excede, baja el DPI
    // efectivo y avisa (selecciones gigantes salen livianas, no reventadas).
    const AREA_MAX = 36000000;
    let res = dpi;
    const areaPx = caja.width * caja.height * (res / 72) * (res / 72);
    if (areaPx > AREA_MAX) res = Math.max(96, Math.floor(Math.sqrt(AREA_MAX / (caja.width * caja.height)) * 72));
    const k = res / 72;
    const W = Math.max(1, Math.ceil(caja.width * k) + 1);
    const H = Math.max(1, Math.ceil(caja.height * k) + 1);
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const occl = document.createElement("canvas"); occl.width = W; occl.height = H;
    const occ = occl.getContext("2d");
    let recortado = res !== dpi;
    // TOP ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ ABAJO: cada pieza pierde los pÃÆÃÂ­xeles que ya cubrieron las de
    // arriba (recorte fÃÆÃÂ­sico por apilado) y entra al PNG tal cual entra al
    // grabado: nunca se re-grababa la parte de abajo de una superposiciÃÆÃÂ³n.
    for (let i = piezas.length - 1; i >= 0; i--) {
        try {
            const piezaR = rasterizarRaiz(piezas[i], res);
            if (!piezaR) continue;
            const fu = document.createElement("canvas"); fu.width = W; fu.height = H;
            const fx = fu.getContext("2d");
            fx.imageSmoothingEnabled = true; fx.imageSmoothingQuality = "high";
            fx.drawImage(piezaR.canvas, Math.round((piezaR.x - caja.x) * k), Math.round((piezaR.y - caja.y) * k));
            try { piezaR.canvas.width = 0; piezaR.canvas.height = 0; } catch (_) {} // liberar
            fx.globalCompositeOperation = "destination-out";
            fx.drawImage(occl, 0, 0);
            // y los huecos de calado que estÃÂ¡n ENCIMA de esta pieza.
            const oPieza = pintura.get(piezas[i]) ?? -1;
            huecosSeleccion.forEach(hh => {
                try {
                    if (hh.orden <= oPieza) return;
                    if (!hh.caja.intersects(caja)) return;
                    const mb = hh.geo.bounds;
                    if (!mb || !(mb.width > 0) || !(mb.height > 0)) return;
                    const celo = construirMascaraSilueta(hh.geo, mb, k, k * 72);
                    if (celo) fx.drawImage(celo, Math.round((mb.x - caja.x) * k), Math.round((mb.y - caja.y) * k));
                } catch (_) {}
            });
            fx.globalCompositeOperation = "source-over";
            ctx.drawImage(fu, 0, 0);
            occ.drawImage(fu, 0, 0);
        } catch (_) {}
    }
    // MÃÆÃÂSCARA del producto: la selecciÃÆÃÂ³n queda contenida en la silueta y
    // sus perforaciones vuelven a ser huecos. Sin silueta conocida: sale
    // tal cual la selecciÃÆÃÂ³n.
    try {
        const silReal = window.clipMask || null;
        if (silReal) {
            const sil = hornoMundo(silReal);
            if (sil) {
                try {
                    const marcoB = sil.bounds;
                    if (marcoB && marcoB.width > 0 && marcoB.height > 0) {
                        const mC = construirMascaraSilueta(sil, marcoB, k, res);
                        if (mC) {
                            ctx.globalCompositeOperation = "destination-in";
                            ctx.drawImage(mC, Math.round((marcoB.x - caja.x) * k), Math.round((marcoB.y - caja.y) * k));
                            ctx.globalCompositeOperation = "source-over";
                        }
                    }
                } finally { try { sil.remove(); } catch (_) {} }
            }
        }
    } catch (_) {}
    if (recortado) notice(`La selecciÃÆÃÂ³n es grande: se bajÃÆÃÂ³ a ${Math.round(res)} DPI para que el archivo no explote.`, { kind: "warn" });
    return { ok: true, canvas: out, dpi: Math.round(res), dpiPedido: dpi, recortado };
}

/* PNG con densidad metida como chunk pHYs (byte exacto tras IHDR): igual
   tÃÆÃÂ©cnica del boceto en projectIO ÃÂ¢Ã¢âÂ¬Ã¢â¬Â copia local porque no se exporta. */
const MODSEL_CRC_TABLA = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let m = 0; m < 8; m++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function modSelCrc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = MODSEL_CRC_TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function pngConDensidadModoSel(pngBytes, dpi) {
    const ppm = Math.round(dpi / 0.0254);
    const out = new Uint8Array(pngBytes.length + 21);
    const view = new DataView(out.buffer);
    out.set(pngBytes.subarray(0, 33), 0);
    view.setUint32(33, 9);
    out.set([0x70, 0x48, 0x59, 0x73], 37); // "pHYs"
    view.setUint32(41, ppm);
    view.setUint32(45, ppm);
    out[49] = 1;
    view.setUint32(50, modSelCrc32(out.subarray(37, 50)));
    out.set(pngBytes.subarray(33), 54);
    return out;
}

function stampModoSel() {
    try { return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14); }
    catch (_) { return String(Date.now()); }
}

/* DESCARGAR selecciÃÆÃÂ³n: PNG con pHYs al DPI elegido. */
async function exportarSeleccionPNG(dpi) {
    const r = renderSeleccionPNG(dpi);
    if (!r.ok) return r;
    const blob = await new Promise(resolve => r.canvas.toBlob(resolve, "image/png"));
    if (!blob) return { ok: false, reason: "png-fallido" };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const finales = pngConDensidadModoSel(bytes, r.dpi);
    const nombre = `ekko-seleccion-${r.dpi}dpi-${stampModoSel()}.png`;
    const url = URL.createObjectURL(new Blob([finales], { type: "image/png" }));
    const link = document.createElement("a");
    link.href = url; link.download = nombre;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notice(`SelecciÃÆÃÂ³n exportada: ${nombre} ÃÂ¢Ã¢âÂ¬Ã¢â¬Â ${r.dpi} DPI, con el look del modo activo y el apilado respetado.`, { kind: "ok" });
    return { ok: true, nombre, dpi: r.dpi };
}

/* COPIAR selecciÃÆÃÂ³n al portapapeles del sistema: pega directo en el programa de grabado/lÃÆÃÂ¡ser. */
async function copiarSeleccionPNG(dpi) {
    const r = renderSeleccionPNG(dpi || 600);
    if (!r.ok) { notice("No hay selecciÃÆÃÂ³n para copiar.", { kind: "warn" }); return r; }
    const blob = await new Promise(resolve => r.canvas.toBlob(resolve, "image/png"));
    if (!blob) return { ok: false, reason: "png-fallido" };
    try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        notice("SelecciÃÆÃÂ³n copiada al portapapeles (" + r.dpi + " DPI): pegÃÆÃÂ¡ directo en el programa de grabado/lÃÆÃÂ¡ser.", { kind: "ok" });
        return { ok: true, dpi: r.dpi };
    } catch (e) {
        notice("El navegador no dejÃÆÃÂ³ copiar al portapapeles. UsÃÆÃÂ¡ el botÃÆÃÂ³n Exportar SelecciÃÆÃÂ³n.", { kind: "warn" });
        return { ok: false, reason: "portapapeles-denegado", detalle: String(e?.message || e) };
    }
}

/* El selector chico (sin ventana gigante): dos fichas 300/600 + visible el
   atajo para que el cliente lo aprenda. */
function ekkoExportarSeleccionUI() {
    if (typeof document === "undefined") return { ok: false, reason: "sin-dom" };
    const previo = document.getElementById("ekkoExportarSelOverlay");
    if (previo) previo.remove();
    const overlay = document.createElement("div");
    overlay.id = "ekkoExportarSelOverlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483400;background:rgba(9,10,13,0.55);display:flex;align-items:center;justify-content:center;font-family:inherit;";
    const caja = document.createElement("div");
    caja.style.cssText = "background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:22px 26px;width:min(460px,92vw);text-align:center;";
    caja.innerHTML =
        '<div style="font-size:16px;font-weight:bold;color:#1e293b;">ÃÂ°ÃÂ¸Ã¢â¬ÅÃÂ¤ EXPORTAR SELECCIÃÆÃ¢â¬ÅN</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:6px;">Sale con el <b>modo activo</b> (Color o LÃÆÃÂ¡ser), con el recorte por apilamiento (lo de arriba tapa a lo de abajo) y con los huecos del producto respetados. El mockup no va.</div>' +
        '<div style="display:flex;gap:10px;justify-content:center;margin-top:14px;">' +
          '<button id="ekkoSelExp300" style="flex:1;padding:12px 8px;border:2px solid #d7dee8;border-radius:10px;background:#f8fafc;cursor:pointer;font-weight:bold;color:#334155;font-size:13px;">ÃÂ¢ÃÂ¡ÃÂ¡ 300 DPI<br><span style="font-weight:normal;font-size:11px;color:#64748b;">liviano (recomendado)</span></button>' +
          '<button id="ekkoSelExp600" style="flex:1;padding:12px 8px;border:2px solid #d7dee8;border-radius:10px;background:#f8fafc;cursor:pointer;font-weight:bold;color:#334155;font-size:13px;">ÃÂ°ÃÂ¸ÃÂ½ÃÂ¯ 600 DPI<br><span style="font-weight:normal;font-size:11px;color:#64748b;">pesado (mÃÆÃÂ¡s calidad)</span></button>' +
        '</div>' +
        '<div style="margin-top:14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;">ÃÂ°ÃÂ¸Ã¢â¬â¢ÃÂ¡ <b>Ctrl+Shift+C</b> copia la selecciÃÆÃÂ³n al portapapeles (600 DPI) ÃÂ¢Ã¢âÂ¬Ã¢â¬Â pegÃÆÃÂ¡s directo en el programa de grabado/lÃÆÃÂ¡ser sin pasar por archivo.</div>' +
        '<button id="ekkoSelExpCancelar" style="margin-top:12px;border:none;background:transparent;color:#94a3b8;cursor:pointer;font-size:12px;">Cancelar</button>';
    overlay.appendChild(caja);
    document.body.appendChild(overlay);
    const cerrar = () => overlay.remove();
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) cerrar(); });
    document.getElementById("ekkoSelExpCancelar").addEventListener("click", cerrar);
    document.getElementById("ekkoSelExp300").addEventListener("click", async () => { cerrar(); await exportarSeleccionPNG(300); });
    document.getElementById("ekkoSelExp600").addEventListener("click", async () => { cerrar(); await exportarSeleccionPNG(600); });
    return { ok: true };
}
/* MÃÆÃÂ¡scara de silueta a canvas (blanco = visible, transparente = fuera del
   producto). Base = el contorno mÃÆÃÂ¡s grande; cada contorno menor contenido
   en ÃÆÃÂ©l = hueco (destination-out). Se dibuja Path por Path porque el
   CompoundPath no respeta sus fills al rasterizar. */
function construirMascaraSilueta(clonSil, marcoB, k, res) {
    if (!clonSil || !marcoB || !(marcoB.width > 0) || !(marcoB.height > 0)) return null;
    const W = Math.max(1, Math.ceil(marcoB.width * k));
    const H = Math.max(1, Math.ceil(marcoB.height * k));
    const mc = document.createElement("canvas");
    mc.width = W; mc.height = H;
    const bx = mc.getContext("2d");
    const rutas = [];
    (function recolectar(n) {
        if (!n) return;
        if (n instanceof paper.Path) rutas.push(n);
        else if (n.children) n.children.forEach(recolectar);
    })(clonSil);
    if (!rutas.length) return null;
    rutas.sort((p, q) => Math.abs(q.area || 0) - Math.abs(p.area || 0));
    const base = rutas[0];
    const bb = base.bounds;
    const dibujar = (ruta, comp) => {
        const bake = ruta.clone({ insert: false });
        const tmpLayer = new paper.Layer({ name: "HORNEO-TMP" });
        try {
            tmpLayer.addChild(bake);
            bake.fillColor = "white";
            bake.strokeColor = null;
            bake.opacity = 1;
            const r = bake.rasterize(res, { insert: false });
            if (r && r.canvas) {
                try {
                    bx.globalCompositeOperation = comp;
                    bx.drawImage(r.canvas, (r.bounds.x - marcoB.x) * k, (r.bounds.y - marcoB.y) * k);
                    bx.globalCompositeOperation = "source-over";
                } catch (_) {}
            }
        } catch (_) {}
        try { tmpLayer.remove(); } catch (_) {}
        try { bake.remove(); } catch (_) {}
    };
    dibujar(base, "source-over");
    rutas.slice(1).forEach(h => {
        try {
            const hb = h.bounds;
            if (!hb) return;
            const contenidoEn = (hb.x >= bb.x && hb.y >= bb.y &&
                hb.x + hb.width <= bb.x + bb.width &&
                hb.y + hb.height <= bb.y + bb.height);
            if (contenidoEn) dibujar(h, "destination-out");
        } catch (_) {}
    });
    return mc;
}

/**
 * Prepara y exporta el diseÃÆÃÂ±o vectorial activo a un formato SVG estricto para corte/grabado lÃÆÃÂ¡ser.
 * Garantiza vacÃÆÃÂ­os geomÃÆÃÂ©tricos reales (sustracciones booleanas materializadas) y la purga
 * completa de controladores interactivos para evitar quemados dobles en el programa de grabado/lÃÆÃÂ¡ser.
 *
 * @param {Object} [options] Opciones de exportaciÃÆÃÂ³n
 * @param {number} [options.precision=5] PrecisiÃÆÃÂ³n decimal para coordenadas vectoriales
 * @param {boolean} [options.asString=true] Retorna el SVG como string XML
 * @returns {string|SVGElement} CÃÆÃÂ³digo XML SVG puro listo para manufactura o elemento SVG
 */
export async function prepareSVGForExport(options = {}) {
    if (typeof paper === "undefined" || !paper.project) {
        console.error("[EKKO EXPORT] Error crÃÆÃÂ­tico: Paper.js no estÃÆÃÂ¡ inicializado.");
        return "";
    }

    const precision = typeof options.precision === "number" ? options.precision : 5;
    const asString = options.asString !== false;

    // 1. SELECCIÃÆÃ¢â¬ÅN DEFENSIVA DE LA CAPA DE DISEÃÆÃ¢â¬ËO ÃÆÃÂ¡TIL
    const designLayer = getCanonicalDesignLayer();
    if (!designLayer) {
        console.error("[EKKO EXPORT] Error: No se encontrÃÆÃÂ³ la capa de diseÃÆÃÂ±o para exportar.");
        return "";
    }

    // Clonado aislado de la capa (insert: false para no contaminar el lienzo interactivo)
    const tempLayer = designLayer.clone({ insert: false });
    tempLayer.name = "designLayer";

    // 0. FILTRO DE ESCALA DE GRISES DE REFERENCIA (EKKO-GRIS-v1): SIEMPRE en
    // toda exportaciÃÆÃÂ³n (grabado y boceto). Solo rasters del diseÃÆÃÂ±o; el filtro
    // pinta sobre canvas nuevo: el lienzo vivo queda intacto.
    if (options.filtroGrises !== false) {
        try {
            aplicarFiltroGrises(tempLayer);
        } catch (err) {
            console.warn("[EKKO EXPORT] Filtro de grises interrumpido:", err);
        }
    }

    // MARCO DE EXPORTACION: EL PRODUCTO, no el contenido. El SVG de grabado y
    // el boceto tienen que conservar la posicion del diseÃÆÃÂ±o DENTRO del
    // producto: asi el programa de grabado/lÃÆÃÂ¡ser lo recibe 1:1 en su lugar y el boceto muestra el
    // producto completo. Antes se exportaba con bounds:"content" y un texto
    // solo salia como un archivo de 3 mm sin referencia alguna.
    // Se capturan los limites del mockup ANTES del purgado, exista o no la
    // opcion includeMockup (los limites se usan siempre; los PATHS del
    // contorno se insertan solo si el llamador los pide).
    let marcoProducto = null;
    try {
        const candidato = tempLayer.getItems({
            match: item => item && (item.data?.mockup === true || item === window.currentMockup) &&
                (item instanceof paper.Path || item instanceof paper.CompoundPath)
        })?.[0] || window.clipMask || null;
        if (candidato && candidato.bounds && candidato.bounds.width > 0 && candidato.bounds.height > 0) {
            marcoProducto = candidato.bounds.clone();
        }
    } catch (_) { marcoProducto = null; }

    // Contorno del producto como grupo separado y fÃÆÃÂ¡cilmente eliminable.
    // Se captura ANTES del purgado de artefactos. Solo se incluye si el
    // llamador lo pide (options.includeMockup): es referencia, no material.
    let mockupOutline = null;
    if (options.includeMockup === true) {
        try {
            const mockup = tempLayer.getItems({
                match: item => item && (item.data?.mockup === true || item === window.currentMockup) &&
                    (item instanceof paper.Path || item instanceof paper.CompoundPath)
            })?.[0] || null;
            const source = mockup || window.clipMask;
            if (source) {
                const outline = source.clone({ insert: false });
                // Si el clon es un Path (sin hijos), el propio clon es el
                // contorno: removerlo lo sacarÃÆÃÂ­a del grupo (bug medido).
                const esContenedor = !!(outline.children && outline.children.length);
                const flat = [];
                (function collect(node) {
                    if (!node) return;
                    if (node instanceof paper.Path) flat.push(node);
                    else if (node.children) Array.from(node.children).forEach(collect);
                })(outline);
                if (flat.length) {
                    mockupOutline = new paper.Group({ insert: false });
                    mockupOutline.data = { id: "EKKO-mockup", isMockupOutline: true };
                    flat.forEach(path => {
                        path.fillColor = null;
                        path.strokeColor = new paper.Color("#0000ff");
                        path.strokeWidth = 0.5;
                        path.opacity = 1;
                        mockupOutline.addChild(path);
                    });
                }
                if (esContenedor) { try { outline.remove(); } catch (_) {} }
            }
        } catch (_) {
            mockupOutline = null;
        }
    }

    // CAPA DE CORTE PARA el programa de grabado/lÃÆÃÂ¡ser (options.includeCutLayer): contorno del
    // producto y de cada perforaciÃÆÃÂ³n, trazo ROJO sin relleno. el programa de grabado/lÃÆÃÂ¡ser lee
    // cada color como capa: rojo = corte del producto, negro = grabado. Se
    // captura ANTES de la purga (despuÃÆÃÂ©s el mockup ya no existe).
    let capaCorte = null;
    if (options.includeCutLayer === true) {
        try {
            // Fuente ÃÆÃÂ¡NICA preferente: window.clipMask ÃÂ¢Ã¢âÂ¬Ã¢â¬Â ya ES la silueta exacta
            // (contorno del producto + cada perforaciÃÆÃÂ³n como contorno hijo).
            // Tomar TODOS los paths con data.mockup disparaba la duplicaciÃÆÃÂ³n en
            // cascada: el CompoundPath y sus hijos coinciden a la vez, y el
            // mockup trae dos juegos de rutas (medido: cada contorno x12).
            let fuentes = null;
            try {
                if (window.clipMask && Math.abs(window.clipMask.area || 0) > 1) fuentes = [window.clipMask];
            } catch (_) { fuentes = null; }
            if (!fuentes) {
                const candidatos = tempLayer.getItems({
                    match: item => item && (item.data?.mockup === true || item === window.currentMockup) &&
                        (item instanceof paper.Path || item instanceof paper.CompoundPath)
                });
                // solo candidatos TOPE: ninguno que sea hijo de otro candidato
                const idsPadres = new Set();
                candidatos.forEach(c => {
                    let p = c.parent;
                    while (p) { idsPadres.add(String(p.id)); p = p.parent; }
                });
                fuentes = candidatos.filter(c => !idsPadres.has(String(c.id)));
            }
            const contornos = [];
            const contenedores = [];
            fuentes.forEach(f => {
                try {
                    const clon = f.clone({ insert: false });
                    const esContenedor = !!(clon.children && clon.children.length);
                    (function recolectar(nodo) {
                        if (!nodo) return;
                        if (nodo instanceof paper.Path && Math.abs(nodo.area || 0) > 0) contornos.push(nodo);
                        else if (nodo.children) nodo.children.forEach(recolectar);
                    })(clon);
                    // Solo se descarta el clon si era CONTENEDOR (sus hijos ya
                    // se movieron al grupo). Si el clon ES el contorno, queda
                    // vivo: removerlo vaciaba la capa de corte (bug medido).
                    if (esContenedor) contenedores.push(clon);
                } catch (_) {}
            });
            if (contornos.length) {
                capaCorte = new paper.Group({ insert: false });
                capaCorte.data = { id: "EKKO-corte", isCutLayer: true };
                contornos.forEach(p => {
                    p.fillColor = null;
                    p.strokeColor = new paper.Color("#ff0000");
                    p.strokeWidth = 0.5;
                    p.opacity = 1;
                    capaCorte.addChild(p);
                });
            }
            contenedores.forEach(clon => { try { clon.remove(); } catch (_) {} });
            // Contornos de CALADO (perforaciÃÂ³n real del diseÃÂ±o): cada hueco
            // entra a la capa de corte con SU contorno completo (exterior y
            // contracubetas). AsÃÂ­ la perforaciÃÂ³n existe fÃÂ­sicamente aunque
            // el hueco caiga sobre una foto o sobre nada: hueco real, no
            // transparencia Ã¢â¬â lo interior no se graba, los bordes se cortan.
            try {
                const huecosCorte = tempLayer.getItems({
                    match: it => it.data?.isHole === true &&
                        (it instanceof paper.PathItem) &&
                        !(it.parent && it.parent.className === "CompoundPath") &&
                        it.data?.isFusionMask !== true && it.data?.isSmartFusion !== true
                });
                if (huecosCorte.length) {
                    if (!capaCorte) {
                        capaCorte = new paper.Group({ insert: false });
                        capaCorte.data = { id: "EKKO-corte", isCutLayer: true };
                    }
                    huecosCorte.forEach(hueco => {
                        try {
                            const geoH = getGlobalUnsubtractedPath(hueco);
                            if (!geoH) return;
                            (function recolectarH(nodo) {
                                if (!nodo) return;
                                if (nodo instanceof paper.Path && Math.abs(nodo.area || 0) > 0) {
                                    nodo.fillColor = null;
                                    nodo.strokeColor = new paper.Color("#ff0000");
                                    nodo.strokeWidth = 0.5;
                                    nodo.opacity = 1;
                                    capaCorte.addChild(nodo);
                                } else if (nodo.children) nodo.children.forEach(recolectarH);
                            })(geoH);
                        } catch (_) {}
                    });
                }
            } catch (_) {}
        } catch (_) { capaCorte = null; }
    }

    // 1b. HORNEADO DE RECORTE (contenciÃÆÃÂ³n del mockup y clips del diseÃÆÃÂ±o importado)
    // La contenciÃÆÃÂ³n (el diseÃÆÃÂ±o dentro del producto y de sus huecos) se HORNEA
    // antes de la purga: los hijos vectoriales se intersectan con la silueta
    // (quedan contenidos y en vector para el lÃÆÃÂ¡ser) y los RASTER (fotos) se
    // rasterizan CON el recorte incluido, asÃÆÃÂ­ la foto queda dentro de su hueco
    // igual que en la interfaz. Antes se quitaba la mÃÆÃÂ¡scara sin hornear: la
    // foto salÃÆÃÂ­a desclipeada y afuera del huesito en cada descarga.
    // La capa entra al proyecto solo dentro de este bloque sÃÆÃÂ­ncrono (rasterize
    // lo exige): nunca llega a pintarse en pantalla.

    // (funciÃÆÃÂ³n) GeometrÃÆÃÂ­a en coordenadas de proyecto para booleanas fiables
    // (mismo patrÃÆÃÂ³n que la uniÃÆÃÂ³n anti doble-grabado del paso 5b). Vive a nivel
    // de funciÃÆÃÂ³n: tambiÃÆÃÂ©n la usa la contenciÃÆÃÂ³n final del boceto (4b) y el
    // aplanado por apilado (7c).
    const hornearWorld = (item) => {
        const clone = item.clone({ insert: false });
        try {
            const matrix = item.globalMatrix?.clone?.() || clone.matrix?.clone?.();
            clone.applyMatrix = false;
            clone.matrix = new paper.Matrix();
            if (matrix && !matrix.isIdentity()) clone.transform(matrix);
            clone.applyMatrix = true;
        } catch (_) {}
        return clone;
    };

    /* Recorte booleano que PRESERVA los huecos (counters de letras, calados
       internos): Paper.js aplica las booleanas con winding y IGNORA el
       even-odd, asÃÆÃÂ­ que intersectar/restar un CompoundPath entero rellena
       sus huecos y el control de ÃÆÃÂ¡rea termina conservando el original sin
       recortar (el bug de la "Z" de ZARA fuera del producto con letras
       llenas). Intersectando/restando HIJO POR HIJO ÃÂ¢Ã¢âÂ¬Ã¢â¬Âcada contorno no tiene
       huecos internos, no hay nada que rellenarÃÂ¢Ã¢âÂ¬Ã¢â¬Â y rearmando el compound con
       evenodd, los huecos sobreviven al recorte. Devuelve PathItem o null. */
    const booleanaPorHijos = (vector, herramienta, operacion) => {
        if (!vector || !herramienta) return null;
        const agregarPieza = (pieza, coleccion) => {
            if (!pieza || pieza.isEmpty?.() || Math.abs(pieza.area || 0) <= 1e-9) return;
            if (pieza.children && pieza.children.length) {
                pieza.children.forEach(p => { if (p instanceof paper.Path) coleccion.push(p); });
            } else if (pieza instanceof paper.Path) {
                coleccion.push(pieza);
            }
        };
        const piezas = [];
        try {
            if (vector.children && vector.children.length) {
                vector.children.forEach(child => {
                    try {
                        if (operacion === "subtract") agregarPieza(child.subtract(herramienta, { insert: false }), piezas);
                        else agregarPieza(child.intersect(herramienta, { insert: false }), piezas);
                    } catch (_) {}
                });
            } else {
                if (operacion === "subtract") agregarPieza(vector.subtract(herramienta, { insert: false }), piezas);
                else agregarPieza(vector.intersect(herramienta, { insert: false }), piezas);
            }
        } catch (_) { return null; }
        if (!piezas.length) return null;
        const compound = new paper.CompoundPath({ insert: false, children: piezas });
        compound.fillRule = "evenodd";
        // ESTILO EXACTO del origen: un contorno sin relleno (el producto, los
        // contornos de corte) DEBE seguir sin relleno ÃÂ¢Ã¢âÂ¬Ã¢â¬Â rellenarlo de negro
        // pintaba el producto entero de negro en el boceto.
        compound.fillColor = vector.fillColor || null;
        compound.strokeColor = vector.strokeColor || null;
        compound.strokeWidth = vector.strokeWidth || 0;
        return compound;
    };

    // (hoisted) Silueta completa del producto con TODAS las perforaciones como
    // huecos: la usa el horneado (1b), la contenciÃÆÃÂ³n final del boceto (4b) y
    // el aplanado por apilado del grabado (7c).
    let siluetaSketch = null;
    try {
        const capaActivaPrevia = paper.project.activeLayer;
        let capaEnProyecto = false;
        try { paper.project.addLayer(tempLayer); capaEnProyecto = true; } catch (_) {}

        // SILUETA COMPLETA CON TODAS LAS PERFORACIONES: en el lienzo el
        // recorte del mockup deja fuera solo las perforaciones chicas (<15%
        // del area). Regla del cliente: LOS HUECOS SIEMPRE SERAN HUECOS, por
        // mas que sea un boceto ÃÂ¢Ã¢âÂ¬Ã¢â¬Â asi que el boceto recorta con la silueta
        // completa (perforaciones grandes incluidas: aro del llavero, ranuras).
        // PRIMERO window.clipMask: ES la silueta real (la armÃÆÃÂ³ mockupLoader
        // con el producto y sus perforaciones como huecos). Sin mÃÆÃÂ¡scara, se
        // reconstruye desde los paths del mockup ÃÂ¢Ã¢âÂ¬Ã¢â¬Â solo restando contornos
        // CHICOS contenidos (un segundo path casi del tamaÃÆÃÂ±o del producto
        // convertÃÆÃÂ­a la silueta en un anillo y deglutÃÆÃÂ­a el diseÃÆÃÂ±o).
        if ((options.keepMockupImage === true || options.stackFlatten === true)) {
            try {
                const mascaraReal = window.clipMask || null;
                if (mascaraReal && Math.abs(mascaraReal.area || 0) > 1) {
                    siluetaSketch = hornearWorld(mascaraReal);
                } else if (window.currentMockup) {
                    const rutasMockup = [];
                    (function recolectar(nodo) {
                        if (!nodo) return;
                        if ((nodo instanceof paper.Path || nodo instanceof paper.CompoundPath) &&
                            Math.abs(nodo.area || 0) > 0) rutasMockup.push(nodo);
                        if (nodo.children) nodo.children.forEach(recolectar);
                    })(window.currentMockup);
                    rutasMockup.sort((a, b) => Math.abs(b.area || 0) - Math.abs(a.area || 0));
                    if (rutasMockup.length) {
                        let acc = hornearWorld(rutasMockup[0]);
                        for (let i = 1; i < rutasMockup.length; i++) {
                            const agujero = hornearWorld(rutasMockup[i]);
                            try {
                                const esHueco = acc.bounds.contains(agujero.bounds) &&
                                    agujero.bounds.width < acc.bounds.width * 0.9 &&
                                    agujero.bounds.height < acc.bounds.height * 0.9;
                                if (esHueco) {
                                    const restado = acc.subtract(agujero, { insert: false });
                                    if (restado && !restado.isEmpty() && Math.abs(restado.area || 0) > 1e-9) {
                                        try { acc.remove(); } catch (_) {}
                                        acc = restado;
                                    }
                                }
                            } catch (_) {}
                            try { agujero.remove(); } catch (_) {}
                        }
                        siluetaSketch = acc;
                    }
                }
            } catch (_) { siluetaSketch = null; }
        }

        const hornearGrupo = (grupo) => {
            const hijos = grupo.children ? grupo.children.slice() : [];
            const mascara = hijos.find(c => c.clipMask === true || c.data?.isMask === true || c.data?.wasClipMask === true) || null;
            if (!mascara) return null;
            const contenido = hijos.filter(c => c !== mascara);
            if (!contenido.length) return null;

            // El DIBUJO del mockup (producto, perforaciones) no se recorta con
            // booleanas: ya es el producto. Solo el diseÃÆÃÂ±o del cliente pasa por
            // la contenciÃÆÃÂ³n.
            const esDelMockup = (item) => {
                let p = item;
                while (p) {
                    if (p.data?.mockup === true || (window.currentMockup && p.id === window.currentMockup.id)) return true;
                    p = p.parent;
                }
                return false;
            };

            const parent = grupo.parent || tempLayer;
            const idx = grupo.index;
            const resultados = [];
            const rasters = contenido.filter(c => c instanceof paper.Raster);
            const vectores = contenido.filter(c => !(c instanceof paper.Raster));
            // En el boceto la contenciÃÆÃÂ³n usa la silueta COMPLETA (todas las
            // perforaciones son huecos). En el grabado, la mÃÆÃÂ¡scara propia del
            // grupo, como siempre.
            const usaSiluetaSketch = options.keepMockupImage === true && !!siluetaSketch;
            const mascaraWorld = usaSiluetaSketch ? siluetaSketch : hornearWorld(mascara);

            if (rasters.length) {
                if (capaEnProyecto) {
                    // paper.js IGNORA "clipped" al rasterizar (verificado en
                    // producciÃÆÃÂ³n: la silueta no recortaba nada). Se hace el
                    // recorte EN pÃÆÃÂ­xeles: mÃÆÃÂ¡scara del producto con huecos
                    // horneada con destination-in. El resultado es UN solo
                    // raster aplanado por bolsa/clip, idÃÆÃÂ©ntico al marco del
                    // producto (huecos transparentes incluidos).
                    try {
                        const silDestino = usaSiluetaSketch ? siluetaSketch : mascara;
                        // La mÃÆÃÂ¡scara de un "clipGroup de contenciÃÆÃÂ³n" vive
                        // FUERA del contenido a hornear; siluetaSketch ya es
                        // mundo; haremos el cruce de bounds del raster contra
                        // la silueta con la lÃÆÃÂ³gica de algÃÆÃÂºn dÃÆÃÂ­a.
                        if (!silDestino) throw new Error("sin silueta");
                        const clonSil = hornearWorld(silDestino);
                        const marcoB = clonSil && clonSil.bounds;
                        if (!marcoB || !(marcoB.width > 0) || !(marcoB.height > 0)) throw new Error("marco vacio");
                        const res = resolucionHorneado(marcoB.width, marcoB.height);
                        const k = res / 72; // pÃÆÃÂ­xeles por unidad de proyecto
                        const W = Math.max(1, Math.ceil(marcoB.width * k));
                        const H = Math.max(1, Math.ceil(marcoB.height * k));
                        // Canvas de la mÃÆÃÂ¡scara: base = el contorno mÃÆÃÂ¡s grande;
                        // cada contorno menor COMPLETAMENTE contenido = hueco
                        // (destination-out). Se dibuja con Path.rasterize
                        // individual porque el CompoundPath no respeta fills.
                        const crearMascara = () => construirMascaraSilueta(clonSil, marcoB, k, res);
                        const mascaraC = crearMascara();
                        // Solo se hornean los rasters que CRUZAN el producto:
                        const rastersDentro = rasters.filter(r => {
                            try {
                                const rWorld = hornearWorld(r);
                                const cruza = rWorld && marcoB.intersects(rWorld.bounds);
                                try { rWorld.remove(); } catch (_) {}
                                return !!cruza;
                            } catch (_) { return true; }
                        });
                        if (rastersDentro.length) {
                            const lienzo = document.createElement("canvas");
                            lienzo.width = W; lienzo.height = H;
                            const ctx = lienzo.getContext("2d");
                            ctx.imageSmoothingEnabled = true;
                            ctx.imageSmoothingQuality = "high";
                            rastersDentro.forEach(r => {
                                try {
                                    const r2 = hornearWorld(r);
                                    const cv = r2.canvas || null;
                                    if (!cv) { try { r2.remove(); } catch (_) {} return; }
                                    const vals = (r2.globalMatrix && r2.globalMatrix.values) || (r2.matrix && r2.matrix.values) || [1, 0, 0, 1, 0, 0];
                                    const [a, b, c, d, e, f] = vals.map(Number);
                                    if (![a, b, c, d, e, f].every(Number.isFinite)) { try { r2.remove(); } catch (_) {} return; }
                                    ctx.save();
                                    ctx.setTransform(a * k, b * k, c * k, d * k, (e - marcoB.x) * k, (f - marcoB.y) * k);
                                    // paper dibuja las imÃÆÃÂ¡genes con origen en el
                                    // CENTRO (coordenadas locales centradas):
                                    // la esquina superior-izquierda estÃÆÃÂ¡ en
                                    // (-w/2, -h/2), no en (0, 0).
                                    ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
                                    ctx.restore();
                                    try { r2.remove(); } catch (_) {}
                                } catch (_) {}
                            });
                            if (mascaraC) {
                                ctx.globalCompositeOperation = "destination-in";
                                ctx.setTransform(1, 0, 0, 1, 0, 0);
                                ctx.drawImage(mascaraC, 0, 0);
                                ctx.globalCompositeOperation = "source-over";
                            }
                            const horneado = new paper.Raster({ canvas: lienzo, insert: false });
                            try {
                                horneado.applyMatrix = false;
                                // paper.js toma e/f como el CENTRO de la imagen
                                // (no la esquina): colocar el marco por su centro.
                                horneado.matrix = new paper.Matrix(1 / k, 0, 0, 1 / k,
                                    marcoB.x + marcoB.width / 2, marcoB.y + marcoB.height / 2);
                            } catch (_) {}
                            parent.insertChild(idx, horneado);
                            resultados.push(horneado);
                            rasters.forEach(r => { try { r.remove(); } catch (_) {} });
                        } else {
                            rasters.forEach(r => { try { r.remove(); } catch (_) {} });
                        }
                    } catch (_) {
                        // Sin horneo posible: la foto queda como estaba
                        // (sin recorte, comportamiento previo).
                        rasters.forEach(r => resultados.push(hornearWorld(r)));
                    }
                } else {
                    rasters.forEach(r => resultados.push(hornearWorld(r)));
                }
            }

            vectores.forEach(v => {
                // El dibujo del mockup va ENTERO (ya es el producto): sin
                // booleanas, sin cambios de estilo.
                if (esDelMockup(v)) {
                    resultados.push(hornearWorld(v));
                    return;
                }
                // ContenciÃÆÃÂ³n de vectores SIN romper contornos: las booleanas
                // de Paper ignoran el relleno par-impar y rellenan los huecos
                // de las letras (la "O" salÃÆÃÂ­a llena). Estrategia:
                // 1) Ya estÃÆÃÂ¡ dentro del producto -> NO se toca.
                // 2) EstÃÆÃÂ¡ afuera del producto -> no se exporta (contenido).
                // 3) Cruza el borde -> intersecciÃÆÃÂ³n con control de ÃÆÃÂ¡rea: la
                //    intersecciÃÆÃÂ³n solo puede achicar; si el ÃÆÃÂ¡rea crece, la
                //    booleana rellenÃÆÃÂ³ huecos y se conserva el original.
                const worldV = hornearWorld(v);
                try {
                    const areaV = Math.abs(worldV.area || 0);
                    let dentro = false;
                    try { dentro = mascaraWorld.bounds.contains(worldV.bounds); } catch (_) { dentro = false; }
                    let cruza = false;
                    try { cruza = mascaraWorld.bounds.intersects(worldV.bounds); } catch (_) { cruza = false; }
                    if (dentro) {
                        resultados.push(worldV);
                    } else if (!cruza) {
                        try { worldV.remove(); } catch (_) {}
                    } else {
                        // IntersecciÃÆÃÂ³n HIJO POR HIJO: la booleana de Paper
                        // ignorarÃÆÃÂ­a el even-odd del compound y rellenarÃÆÃÂ­a los
                        // counters (la "O" llena); asÃÆÃÂ­ los huecos sobreviven.
                        const recortado = booleanaPorHijos(worldV, mascaraWorld, "intersect");
                        const areaR = recortado ? Math.abs(recortado.area || 0) : 0;
                        if (recortado && areaR > 1e-9 && areaR <= areaV * (1 + 1e-6)) {
                            resultados.push(recortado);
                            try { worldV.remove(); } catch (_) {}
                        } else {
                            try { recortado?.remove?.(); } catch (_) {}
                            resultados.push(worldV);
                        }
                    }
                } catch (_) {
                    resultados.push(worldV);
                }
            });

            if (!usaSiluetaSketch) { try { mascaraWorld.remove(); } catch (_) {} }
            // El grupo original se retira completo (mÃÆÃÂ¡scara incluida) y los
            // resultados ocupan su posiciÃÆÃÂ³n exacta en el apilado.
            try { grupo.remove(); } catch (_) {}
            resultados.forEach((r, i) => {
                try { parent.insertChild(idx + i, r); } catch (_) { try { parent.addChild(r); } catch (_) {} }
            });
            return resultados.length;
        };

        // Varias pasadas: hornear un grupo puede dejar a la vista otros
        // clipGroups anidados (se procesan en la pasada siguiente).
        for (let pasada = 0; pasada < 5; pasada++) {
            const pendientes = tempLayer.getItems({
                match: function(item) {
                    if (!(item instanceof paper.Group) || item.clipped !== true) return false;
                    if (item.data?.isSmartFusion === true) return false;
                    const fusionMasks = item.getItems?.({
                        match: child => child.data?.isFusionMask === true
                    }) || [];
                    return fusionMasks.length === 0;
                }
            });
            if (!pendientes.length) break;
            pendientes.forEach(g => { try { hornearGrupo(g); } catch (_) {} });
        }

        // La silueta sigue viva para la contenciÃÆÃÂ³n final del boceto (4b) y el
        // aplanado del grabado (7c); ahÃÆÃÂ­ se limpia.
        try { if (siluetaSketch && options.keepMockupImage !== true && options.stackFlatten !== true) siluetaSketch.remove(); } catch (_) {}
        try { if (capaEnProyecto) tempLayer.remove(); } catch (_) {}
        // La capa activa queda como estaba: el editor nunca deja de apuntar
        // a su capa de trabajo por culpa de la exportaciÃÆÃÂ³n.
        try { if (capaActivaPrevia && capaActivaPrevia.project) capaActivaPrevia.activate(); } catch (_) {}
    } catch (err) {
        console.warn("[EKKO EXPORT] Horneado de contenciÃÆÃÂ³n incompleto:", err);
    }

    // 2. PURGADO INICIAL DE ARTEFACTOS AUXILIARES Y ELEMENTOS NO GRABABLES
    // Elimina de inmediato mockups, fondos, guÃÆÃÂ­as inteligentes, cotas, reglas, marcas de agua y cajas de selecciÃÆÃÂ³n
    // En el BOCETO el mockup real SI va (keepMockupImage): el cliente ve el
    // producto tal cual la interfaz, con sus huecos como huecos. En el SVG de
    // grabado se purga siempre: es referencia, no material.
    const mockupProtegido = new Set();
    if (options.keepMockupImage === true) {
        tempLayer.getItems({ match: it => it?.data?.mockup === true }).forEach(m => {
            (function marcar(nodo) {
                if (!nodo) return;
                mockupProtegido.add(nodo.id);
                (nodo.children || []).forEach(marcar);
            })(m);
        });
    }
    const artifactsToRemove = [];
    tempLayer.getItems({
        match: function(item) {
            const data = item.data || {};
            if (mockupProtegido.has(item.id)) return false;
            return (
                data.mockup === true ||
                data.isMask === true ||
                data.wasClipMask === true ||
                data.isSelectionBox === true ||
                data.isHandle === true ||
                data.isNodeHandle === true ||
                data.isCurveHandle === true ||
                data.isSmartGuide === true ||
                data.isMeasurement === true ||
                data.isTracePreview === true ||
                data.isNodeEditOverlay === true ||
                data.isFusionEditGhost === true ||
                data.isFusionEditProxy === true ||
                data.isFusionEditClip === true ||
                data.isGuide === true ||
                data.isWatermark === true ||
                data.isUnderlineLine === true ||
                (window.currentMockup && item.id === window.currentMockup.id) ||
                (item instanceof paper.PointText && item.content === window.EKKO_CONFIG?.seguridad?.watermarkText)
            );
        }
    }).forEach(it => artifactsToRemove.push(it));

    artifactsToRemove.forEach(it => {
        try { it.remove(); } catch (e) {}
    });

    // 3. DESEMPAQUETADO SEGURO DE GRUPOS DE RECORTE (clipGroup)
    // Extrae el contenido ÃÆÃÂºtil al nivel raÃÆÃÂ­z de tempLayer horneando matrices para evitar pÃÆÃÂ©rdidas por mÃÆÃÂ¡scaras
    const clipGroups = [];
    tempLayer.getItems({
        match: function(item) {
            if (!item.data || item.data.clipGroup !== true) return false;
            if (item.data.isSmartFusion === true) return false;
            const fusionMasks = item.getItems?.({
                match: child => child.data?.isFusionMask === true
            }) || [];
            return fusionMasks.length === 0;
        }
    }).forEach(cg => clipGroups.push(cg));

    clipGroups.forEach(group => {
        const groupParent = group.parent || tempLayer;
        const groupIndex = group.index;
        const groupMatrix = group.matrix ? group.matrix.clone() : new paper.Matrix();
        
        const usefulChildren = [];
        if (group.children) {
            [...group.children].forEach(child => {
                if (child.clipMask || (child.data && (child.data.isMask || child.data.mockup || child.data.wasClipMask))) {
                    child.remove();
                } else {
                    usefulChildren.push(child);
                }
            });
        }

        usefulChildren.forEach(child => {
            if (child.matrix && !groupMatrix.isIdentity()) {
                child.matrix = groupMatrix.chain(child.matrix);
            }
            groupParent.insertChild(groupIndex, child);
        });

        group.remove();
    });

    // 4. VECTORIZACIÃÆÃ¢â¬ÅN RECURSIVA DE TIPOGRAFÃÆÃÂAS (Fonts-to-Paths)
    // Convierte todos los PointText y grupos de texto curvo a CompoundPaths cerrados horneados
    // para independizar el archivo de las fuentes del sistema o de la mÃÆÃÂ¡quina lÃÆÃÂ¡ser
    const textItems = [];
    tempLayer.getItems({
        match: function(item) {
            return (
                item instanceof paper.PointText ||
                item.className === "PointText" ||
                (item.data && (item.data.isCurvedGroup || item.data.isSpacedGroup))
            );
        }
    }).forEach(item => textItems.push(item));

    for (const item of textItems) {
        if (item.data && (item.data.isCurvedGroup || item.data.isSpacedGroup)) {
            // Grupo de texto compuesto: vectorizar cada hijo PointText
            if (item.children) {
                const subTexts = [...item.children].filter(c => c instanceof paper.PointText);
                for (const st of subTexts) {
                    const vec = await vectorizeTextItem(st);
                    if (vec) {
                        item.insertChild(st.index, vec);
                        st.remove();
                    }
                }
            }
        } else if (item instanceof paper.PointText) {
            const vec = await vectorizeTextItem(item);
            if (vec) {
                const parent = item.parent || tempLayer;
                parent.insertChild(item.index, vec);
                item.remove();
            }
        }
    }

    // 4b. CONTENCIÃÆÃ¢â¬ÅN FINAL DEL BOCETO (regla del cliente: TODO el diseÃÆÃÂ±o
    // queda contenido dentro del mockup). El horneado 1b solo procesa
    // clipGroups: el texto y las formas sueltas que cruzan el borde del
    // producto quedaban AFUERA en el boceto (la "Z" de ZARA). AcÃÆÃÂ¡ se recorta
    // TODO lo que queda directo en la capa (texto ya vectorizado incluido),
    // con booleana hijo-por-hijo para no perder los counters. Los RASTERS
    // (fotos) se recortan pixel a pixel con mÃÆÃÂ¡scara destino-in: paper.js
    // ignora el clip en rasterize() ÃÂ¢Ã¢âÂ¬Ã¢â¬Â la silueta como primer hijo NO recorta.
    // El LIENZO general no tiene mockup: sin silueta este bloque no corre.
    if (options.keepMockupImage === true && siluetaSketch) {
        let capaEnProyecto4b = false;
        try { paper.project.addLayer(tempLayer); capaEnProyecto4b = true; } catch (_) {}
        try {
            const clonSil = hornearWorld(siluetaSketch);
            const marcoB = clonSil && clonSil.bounds;
            if (!marcoB || !(marcoB.width > 0) || !(marcoB.height > 0)) throw new Error("silueta vacia");
            const res = resolucionHorneado(marcoB.width, marcoB.height);
            const k = res / 72;
            const W = Math.max(1, Math.ceil(marcoB.width * k));
            const H = Math.max(1, Math.ceil(marcoB.height * k));
            const mascaraC = construirMascaraSilueta(clonSil, marcoB, k, res);
            const worldWithin = (b) => (b && b.x >= marcoB.x - 0.5 && b.y >= marcoB.y - 0.5 &&
                b.x + b.width <= marcoB.x + marcoB.width + 0.5 &&
                b.y + b.height <= marcoB.y + marcoB.height + 0.5);
            const piezaCruza = [];
            tempLayer.getItems({
                match: function(item) {
                    if (item instanceof paper.PointText) return false;
                    if (!(item instanceof paper.PathItem || item instanceof paper.Raster)) return false;
                    if (item.data?.mockup === true || item.data?.isMockupOutline === true ||
                        item.data?.isFusionMask === true || item.data?.isSmartFusion === true) return false;
                    // solo piezas tope: jamÃÆÃÂ¡s hijos de otro PathItem (los
                    // counters de un compound se conservan con su padre).
                    let p = item.parent;
                    while (p && p !== tempLayer) {
                        if (p instanceof paper.PathItem || p.clipped === true) return false;
                        p = p.parent;
                    }
                    return true;
                }
            }).forEach(item => piezaCruza.push(item));

            piezaCruza.forEach(item => {
                try {
                    const world = hornearWorld(item);
                    if (!world) return;
                    const areaV = Math.abs(world.area || 0);
                    const wb = world.bounds;
                    const dentro = worldWithin(wb);
                    let cruza = false;
                    try { cruza = marcoB.intersects(wb); } catch (_) {}
                    if (dentro) {
                        try { world.remove(); } catch (_) {}
                        return; // ya estÃÆÃÂ¡ contenido: no se toca
                    }
                    if (!cruza) {
                        try { world.remove(); } catch (_) {}
                        try { item.remove(); } catch (_) {}
                        return; // afuera del producto: no se exporta
                    }
                    if (item instanceof paper.Raster) {
                        // La foto se hornea CON la silueta: recorte pÃÆÃÂ­xel a
                        // pÃÆÃÂ­xel (destination-in), igual que en 1b ÃÂ¢Ã¢âÂ¬Ã¢â¬Â clipped
                        // lo ignora paper.js al rasterizar.
                        try { world.remove(); } catch (_) {}
                        const lienzo = document.createElement("canvas");
                        lienzo.width = W; lienzo.height = H;
                        const ctx = lienzo.getContext("2d");
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = "high";
                        const vals = (item.globalMatrix && item.globalMatrix.values) || (item.matrix && item.matrix.values) || [1, 0, 0, 1, 0, 0];
                        const [a, b, c, d, e, f] = vals.map(Number);
                        const cv = item.canvas || item.image;
                        const iw = cv ? (cv.width || cv.naturalWidth || 0) : 0;
                        const ih = cv ? (cv.height || cv.naturalHeight || 0) : 0;
                        if (cv && iw > 0 && ih > 0 && [a, b, c, d, e, f].every(Number.isFinite)) {
                            ctx.save();
                            ctx.setTransform(a * k, b * k, c * k, d * k, (e - marcoB.x) * k, (f - marcoB.y) * k);
                            ctx.drawImage(cv, -iw / 2, -ih / 2);
                            ctx.restore();
                            if (mascaraC) {
                                ctx.globalCompositeOperation = "destination-in";
                                ctx.setTransform(1, 0, 0, 1, 0, 0);
                                ctx.drawImage(mascaraC, 0, 0);
                                ctx.globalCompositeOperation = "source-over";
                            }
                            const horneado = new paper.Raster({ canvas: lienzo, insert: false });
                            try {
                                horneado.applyMatrix = false;
                                // paper.js toma e/f como el CENTRO de la imagen
                                // (no la esquina): colocar el marco por su centro.
                                horneado.matrix = new paper.Matrix(1 / k, 0, 0, 1 / k,
                                    marcoB.x + marcoB.width / 2, marcoB.y + marcoB.height / 2);
                            } catch (_) {}
                            const parent = item.parent || tempLayer;
                            const idx = item.index;
                            try { item.remove(); } catch (_) {}
                            parent.insertChild(idx, horneado);
                        }
                        return;
                    }
                    const recortado = booleanaPorHijos(world, siluetaSketch, "intersect");
                    const areaR = recortado ? Math.abs(recortado.area || 0) : 0;
                    try { world.remove(); } catch (_) {}
                    if (recortado && areaR > 1e-9 && areaR <= areaV * (1 + 1e-6)) {
                        const parent = item.parent || tempLayer;
                        const idx = item.index;
                        try { item.remove(); } catch (_) {}
                        parent.insertChild(idx, recortado);
                    } else {
                        try { recortado?.remove?.(); } catch (_) {}
                        // La booleana volviÃÆÃÂ³ a rellenar algo: se conserva el
                        // original mejor que una letra mutilada.
                    }
                } catch (_) {}
            });
            try { clonSil.remove(); } catch (_) {}
        } catch (err) {
            console.warn("[EKKO EXPORT] ContenciÃÆÃÂ³n final del boceto incompleta:", err);
        }
        try { if (capaEnProyecto4b) tempLayer.remove(); } catch (_) {}
        try { if (options.stackFlatten !== true) siluetaSketch.remove(); } catch (_) {}
    }

    // 5. MATERIALIZACIÃÆÃ¢â¬ÅN BOOLEANA CSG EN LA CAPA CLONADA
    // El export usa copias de los huecos virtuales, nunca las geometrÃÆÃÂ­as del
    // lienzo interactivo. Se conserva ownerContainmentKey para aislar fusiones.
    // unionReport se declara aquÃÆÃÂ­ porque el informe de compuerta (mÃÆÃÂ¡s abajo)
    // lo referencia antes de que corra la uniÃÆÃÂ³n 5b.
    const unionReport = { mergedPairs: 0, skippedPairs: 0, dedupedStrokes: 0, timedOut: false, filledCount: 0, evaluatedPairs: 0 };
      const exportVirtualHoles = [];
    let exportCsgReport = null;
    let exportCsgError = null;
    try {
        getVirtualHoleEntries().forEach(entry => {
            if (!entry || !entry.geom) return;
            const geom = entry.geom.clone({ insert: false });
            const cloneGroup = tempLayer.getItems?.({
                match: item => item?.data?.isSmartFusion === true &&
                    item?.data?.fusionId === entry.fusionId
            })?.[0] || null;
            exportVirtualHoles.push({
                geom,
                fusionId: entry.fusionId,
                group: cloneGroup,
                ownerContainmentKey: entry.ownerContainmentKey || null
            });
        });

        if (typeof recalculateDynamicSubtractions === "function") {
            exportCsgReport = recalculateDynamicSubtractions(tempLayer, exportVirtualHoles);
        } else if (typeof window.recalculateDynamicSubtractions === "function") {
            exportCsgReport = window.recalculateDynamicSubtractions(tempLayer, exportVirtualHoles);
        } else {
            exportCsgError = "csg-recalculator-unavailable";
        }
    } catch (err) {
        exportCsgError = String(err?.stack || err);
        console.warn("[EKKO EXPORT CSG RECALC ERROR]", exportCsgError);
    } finally {
        exportVirtualHoles.forEach(entry => {
            try { entry.geom.remove(); } catch (e) {}
        });
    }
    // Export gate: hole owners are EXPECTED in the scene (they are purged
    // after materialization in step 6). The gate must use the CSG report,
    // not the mere presence of cutters: a hole with no unresolved targets
    // (fully cut, or over a material-free notch) must not block export.
    const exportOwners = collectVectorOwners(tempLayer);
    const holeOwners = exportOwners.filter(owner => semanticKind(owner) === VECTOR_KIND.HOLE);
    // Huecos SIN RESOLVER = solo los que tuvieron blanco vectorial real
    // (par evaluado por el CSG) y no lograron restar. Un hueco sobre una
    // FOTO o sobre nada se materializa mÃÂ¡s abajo (knock-out de pÃÂ­xeles en
    // el tratado de fotos + contorno de corte en la capa roja): nunca
    // debÃÂ­a bloquear el export entero.
    const evaluatedCsgHoles = new Set(exportCsgReport?.evaluatedHoleKeys || []);
    const acceptedCsgHoles = new Set(exportCsgReport?.acceptedHoleKeys || []);
    const materializationUnresolvedHoles = [...evaluatedCsgHoles].filter(k => !acceptedCsgHoles.has(k)).length;
    const failedBooleans = [
        ...(exportCsgReport?.failedBooleans || []),
        ...(exportCsgError ? [{ operation: "csg-recalculate", error: exportCsgError }] : [])
    ];
    const csgCompleted = exportCsgReport?.completed === true && !exportCsgError;
    exportCsgReport = {
        ...(exportCsgReport || {}),
        holeOwners: holeOwners.length,
        solidOwners: exportOwners.filter(owner => semanticKind(owner) === VECTOR_KIND.SOLID).length,
        outOfProductHoles: (exportCsgReport?.outOfProductHoleKeys || []).length,
        unresolvedHoles: materializationUnresolvedHoles,
        unresolvedOwnerIds: [...(exportCsgReport?.unresolvedHoleKeys || [])],
        union: unionReport,
        mockupIncluded: !!mockupOutline,
        failedBooleans,
        csgCompleted,
        exportReady: csgCompleted && failedBooleans.length === 0 && materializationUnresolvedHoles === 0
    };
    if (typeof window !== "undefined") window.EKKO_EXPORT_LAST_REPORT = exportCsgReport;
    if (!exportCsgReport.exportReady) {
        console.error("[EKKO EXPORT] CSG no pudo materializar todos los huecos", exportCsgReport);
        tempLayer.remove();
        return "";
    }



    // 5b. UNIÃÆÃ¢â¬ÅN ANTI DOBLE-GRABADO (solo modo grabado)
    // Dos rellenos superpuestos del mismo estilo se grabarÃÆÃÂ­an dos veces en
    // la intersecciÃÆÃÂ³n. Se fusionan por estilo con tope de tiempo/pares; lo
    // no unido se informa en el reporte en vez de bloquear la exportaciÃÆÃÂ³n.
    // Las lÃÆÃÂ­neas de corte abiertas duplicadas exactas se deduplican por
    // pathData normalizado.
    if (options.uniteOverlaps !== false) {
        try {
            const styleKey = item => {
                const fill = item.fillColor ? item.fillColor.toCSS(true) : "none";
                const stroke = item.strokeColor ? item.strokeColor.toCSS(true) : "none";
                return `${fill}|${stroke}|${item.strokeWidth || 0}`;
            };
            // Only top-level public owners: getItems descends into compound
            // children, which would double-count (and wrongly merge) the
            // internal contours of every solid.
            const filled = [];
            tempLayer.getItems({
                match: item => (item instanceof paper.Path || item instanceof paper.CompoundPath) &&
                    !(item.parent instanceof paper.Path) && !(item.parent instanceof paper.CompoundPath) &&
                    !item.data?.isHole && !item.data?.isFusionMask && !item.data?.mockup &&
                    !item.data?.isMask && !item.data?.wasClipMask && !item.clipMask &&
                    !!item.fillColor && item.closed !== false
            }).forEach(item => filled.push(item));
            // Interior probes of every hole owner: a union must never fill a
            // previously empty hole (e.g. swallowing an island solid that
            // sits inside a hole region).
            const holeProbes = [];
            tempLayer.getItems({
                match: item => item?.data?.isHole === true &&
                    (item instanceof paper.Path || item instanceof paper.CompoundPath)
            }).forEach(hole => {
                try {
                    const probe = interiorPointOf(hole);
                    if (probe) holeProbes.push(probe);
                } catch (_) {}
            });
            const byStyle = new Map();
            filled.forEach(item => {
                const key = styleKey(item);
                if (!byStyle.has(key)) byStyle.set(key, []);
                byStyle.get(key).push(item);
            });
            unionReport.filledCount = filled.length;
            const bakeWorld = item => {
                // Paper booleans read raw segments and ignore .matrix when
                // applyMatrix is false. Bake the FULL world transform (owner
                // plus ancestors) into a detached clone so the union runs in
                // project coordinates.
                const clone = item.clone({ insert: false });
                try {
                    const matrix = item.globalMatrix?.clone?.() || clone.matrix?.clone?.();
                    clone.applyMatrix = false;
                    clone.matrix = new paper.Matrix();
                    if (matrix && !matrix.isIdentity()) clone.transform(matrix);
                    clone.applyMatrix = true;
                } catch (_) {}
                return clone;
            };
            const toLocalOf = (geometry, owner) => {
                // Bring world-baked result back to the keeper's local frame.
                try {
                    const inverse = owner.globalMatrix?.inverted?.();
                    if (inverse && typeof geometry.transform === "function") geometry.transform(inverse);
                } catch (_) {}
                return geometry;
            };
            const deadline = Date.now() + (Number.isFinite(options.uniteBudgetMs) ? options.uniteBudgetMs : 4000);
            let pairCount = 0;
            const maxPairs = Number.isFinite(options.uniteMaxPairs) ? options.uniteMaxPairs : 2000;
            byStyle.forEach(group => {
                // Union de punto fijo: se repite hasta que ninguna pareja se
                // pueda fusionar mas. Antes el bucle jardin seguia despues de
                // fusionar y voltaba a unir geometria ya removida, dejando
                // paths fantasma en el SVG (el laser quemaba dos veces).
                let pending = group.filter(Boolean);
                let progressed = true;
                while (progressed && Date.now() < deadline && pairCount < maxPairs) {
                    progressed = false;
                    for (let a = 0; a < pending.length && Date.now() < deadline && pairCount < maxPairs; a++) {
                        let first = pending[a];
                        if (!first || !first.project) continue;
                        for (let b = a + 1; b < pending.length; b++) {
                            if (Date.now() >= deadline || pairCount >= maxPairs) break;
                            const second = pending[b];
                            if (!second || !second.project || first === second) continue;
                            try {
                                if (!first.bounds.intersects(second.bounds)) continue;
                            } catch (_) { continue; }
                            pairCount += 1;
                            unionReport.evaluatedPairs += 1;
                            let united = null;
                            const worldA = bakeWorld(first);
                            const worldB = bakeWorld(second);
                            try {
                                united = worldA.unite(worldB, { insert: false });
                            } catch (_) { united = null; }
                            const unitedArea = united ? Math.abs(united.area || 0) : 0;
                            const sumArea = Math.abs(worldA.area || 0) + Math.abs(worldB.area || 0);
                            try { worldA.remove(); } catch (_) {}
                            try { worldB.remove(); } catch (_) {}
                            let preservesHoles = true;
                            if (united && unitedArea > 1e-9 && unitedArea <= sumArea * (1 + 1e-6)) {
                                try {
                                    united.fillRule = "evenodd";
                                    for (const probe of holeProbes) {
                                        const wasEmpty = !evenOddContains(first, probe) && !evenOddContains(second, probe);
                                        if (wasEmpty && evenOddContains(united, probe)) {
                                            preservesHoles = false;
                                            break;
                                        }
                                    }
                                } catch (_) {
                                    preservesHoles = false;
                                }
                            }
                            if (united && unitedArea > 1e-9 && unitedArea <= sumArea * (1 + 1e-6) && preservesHoles) {
                                try {
                                    toLocalOf(united, first);
                                    const parent = first.parent || tempLayer;
                                    const index = typeof first.index === "number" ? first.index : 0;
                                    united.applyMatrix = false;
                                    united.matrix = first.matrix?.clone?.() || new paper.Matrix();
                                    united.fillColor = first.fillColor?.clone?.() || first.fillColor;
                                    united.strokeColor = first.strokeColor?.clone?.() || first.strokeColor;
                                    united.strokeWidth = first.strokeWidth;
                                    united.fillRule = "evenodd";
                                    united.data = { ...(first.data || {}), exportUnited: true, csgMaterialized: true };
                                    parent.insertChild(index, united);
                                    first.remove();
                                    second.remove();
                                    // La pareja se consume: se saca de la lista
                                    // activa y el bucle vuelve a intentarlo con
                                    // la geometria ya combinada.
                                    pending.splice(b, 1);
                                    pending[a] = united;
                                    first = united;
                                    progressed = true;
                                    unionReport.mergedPairs += 1;
                                } catch (_) {
                                    try { united.remove(); } catch (_) {}
                                    unionReport.skippedPairs += 1;
                                }
                            } else {
                                try { united?.remove?.(); } catch (_) {}
                                unionReport.skippedPairs += 1;
                            }
                        }
                    }
                }
            });
            if (Date.now() >= deadline || pairCount >= maxPairs) unionReport.timedOut = true;
            // DeduplicaciÃÆÃÂ³n de trazos abiertos idÃÆÃÂ©nticos (doble lÃÆÃÂ­nea de corte).
            const seenStrokes = new Set();
            tempLayer.getItems({
                match: item => (item instanceof paper.Path) && !item.closed &&
                    !item.data?.isHole && (item.strokeColor || item.fillColor)
            }).forEach(item => {
                let key = null;
                try {
                    key = item.pathData + "|" + (item.strokeColor ? item.strokeColor.toCSS(true) : "") +
                        "|" + (item.strokeWidth || 0) + "|" + (item.position?.x.toFixed(3) || "") +
                        "," + (item.position?.y.toFixed(3) || "");
                } catch (_) { key = null; }
                if (!key) return;
                if (seenStrokes.has(key)) {
                    try { item.remove(); unionReport.dedupedStrokes += 1; } catch (_) {}
                } else {
                    seenStrokes.add(key);
                }
            });
        } catch (err) {
            unionReport.timedOut = unionReport.timedOut || false;
            console.warn("[EKKO EXPORT UNION ERROR]", String(err?.message || err));
        }
    }

    // 6. PURGADO DE CALADOS ACTIVOS (isHole)
    // Dado que el corte booleano ya fue materializado en la geometrÃÆÃÂ­a de las masas sÃÆÃÂ³lidas inferiores,
    // se eliminan todas las entidades de calado interactivo para no generar lÃÆÃÂ­neas de corte duplicadas en el programa de grabado/lÃÆÃÂ¡ser
    // CRÃÆÃÂTICO (bug counters de letras): un HIJO de un CompoundPath es un contorno
    // interno (el hueco real de una letra R, A, O...), NO un calado interactivo.
    // La vectorizaciÃÆÃÂ³n de texto marca esos hijos con isHole:true y la purga los
    // borreaba uno por uno: las letras salÃÆÃÂ­an MACIZAS en el SVG de grabado y en
    // el boceto PNG/PDF (que rasteriza este mismo SVG). Los calados reales
    // siempre cuelgan de la capa o de un grupo, jamÃÆÃÂ¡s de un CompoundPath.
    const holesToRemove = [];
    tempLayer.getItems({
        match: function(item) {
            return item.data &&
                (item.data.isHole === true || item.data.isHoleController === true) &&
                item.data.isFusionMask !== true &&
                item.data.isSmartFusion !== true &&
                !(item.parent && item.parent.className === "CompoundPath");
        }
    }).forEach(hole => holesToRemove.push(hole));

    holesToRemove.forEach(hole => {
        try { hole.remove(); } catch (e) {}
    });

    // 7. SANITIZACIÃÆÃ¢â¬ÅN VECTORIAL Y ASIGNACIÃÆÃ¢â¬ÅN DE ESTILOS PARA CORTE/GRABADO LÃÆÃÂSER
    // - Asigna fillRule "evenodd" en todos los CompoundPaths para renderizado de huecos estÃÆÃÂ¡ndar
    // - Asegura colores visibles (negro para grabado / trazo fino) evitando paths invisibles ignorados por el programa de grabado/lÃÆÃÂ¡ser
    // - Descarta geometrÃÆÃÂ­as vacÃÆÃÂ­as o degeneradas (sin ÃÆÃÂ¡rea ni segmentos)
    const emptyItems = [];
    tempLayer.getItems({
        match: function(item) {
            // Un contorno interno de un CompoundPath (counter de letra) jamÃÆÃÂ¡s
            // se evalÃÆÃÂºa ni se elimina por separado: si su compound tiene ÃÆÃÂ¡rea,
            // ÃÆÃÂ©l pertenece a ese relleno con huecos (evenodd).
            if (item.parent && item.parent.className === "CompoundPath") return false;
            if (item instanceof paper.PathItem) {
                const segCount = item.segments ? item.segments.length :
                    (item.children ? item.children.reduce((acc, c) => acc + (c.segments ? c.segments.length : 0), 0) : 0);
                const area = Math.abs(item.area || 0);
                if (segCount < 2 || area < 1e-4) {
                    return true;
                }
            }
            return false;
        }
    }).forEach(it => emptyItems.push(it));

    emptyItems.forEach(it => {
        try { it.remove(); } catch (e) {}
    });

    tempLayer.getItems({
        match: function(item) {
            return item instanceof paper.PathItem;
        }
    }).forEach(item => {
        // Fusion masks are clipping/CSG implementation details, never an
        // exported black engraving shape.  Keep the mask object available to
        // Paper.js clip semantics but make it non-painting in the clone.
        if (item.data?.isFusionMask === true) {
            item.fillColor = null;
            item.strokeColor = null;
            item.strokeWidth = 0;
            item.opacity = 0;
            return;
        }
        // Boolean outputs are disjoint contours: evenodd and nonzero agree,
        // except when a contour kept the outer winding (Paper quirk on some
        // glyph/SVG holes). Anything CSG actually cut is therefore stamped
        // evenodd. Untouched multi-contour owners keep their source rule so
        // same-winding nonzero designs (e.g. 008 islands) keep rendering.
        if (item instanceof paper.CompoundPath && (item.children?.length || 0) > 1) {
            if (item.data?.csgMaterialized === true) {
                item.fillRule = "evenodd";
            } else {
                const sourceRule = String(item.data?.originalFillRule || item.fillRule || "nonzero").toLowerCase();
                item.fillRule = sourceRule === "nonzero" || sourceRule === "non-zero" ? "nonzero" : "evenodd";
            }
        }
        // AsignaciÃÆÃÂ³n de estilo por defecto si carece de color
        if (!item.fillColor && !item.strokeColor) {
            item.fillColor = new paper.Color("#000000");
        }
        // Garantizar trazo mÃÆÃÂ­nimo si es un path abierto de corte
        if (!item.closed && (!item.strokeWidth || item.strokeWidth <= 0)) {
            item.strokeWidth = 1.0;
            if (!item.strokeColor) item.strokeColor = new paper.Color("#000000");
        }
    });

    // 7b. CONTORNO DEL PRODUCTO (opcional, grupo propio eliminable)
    if (mockupOutline) {
        try {
            tempLayer.insertChild(0, mockupOutline);
        } catch (_) {
            try { mockupOutline.remove(); } catch (_) {}
            mockupOutline = null;
        }
    }

    // 7c. APLANADO POR APILADO PARA el programa de grabado/lÃÆÃÂ¡ser (options.stackFlatten):
    // regla del dueÃÆÃÂ±o ÃÂ¢Ã¢âÂ¬Ã¢â¬Â se graba lo que SE VE. Cada pieza resta todo lo que
    // estÃÆÃÂ¡ POR ENCIMA de ella (knock-out), asÃÆÃÂ­ las capas de abajo no quedan
    // grabadas debajo de las de arriba; y todo se contiene con la silueta del
    // producto. Booleana hijo-por-hijo: los counters de las letras nunca se
    // rellenan. Las piezas quedan en el mismo orden z (abajo ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ arriba).
    if (options.stackFlatten === true) {
        try {
            const unidades = tempLayer.children.filter(it =>
                (it instanceof paper.PathItem || it instanceof paper.Group) &&
                !it.data?.mockup && !it.data?.isMockupOutline && !it.data?.isCutLayer &&
                !it.data?.isFusionMask && !it.data?.isSmartFusion);
            const worlds = unidades.map(u => hornearWorld(u));
            for (let i = 0; i < unidades.length; i++) {
                const unidad = unidades[i];
                const world = worlds[i];
                if (!world || !unidad) continue;
                // 1) KNOCK-OUT: restar la uniÃÆÃÂ³n de todo lo de arriba.
                let cubierto = null;
                for (let j = i + 1; j < unidades.length; j++) {
                    const arriba = worlds[j];
                    if (!arriba) continue;
                    try { if (!world.bounds.intersects(arriba.bounds)) continue; } catch (_) { continue; }
                    try {
                        cubierto = cubierto ? cubierto.unite(arriba, { insert: false }) : arriba.clone({ insert: false });
                    } catch (_) {}
                }
                let final = world;
                if (cubierto) {
                    const restado = booleanaPorHijos(final, cubierto, "subtract");
                    try { cubierto.remove(); } catch (_) {}
                    if (restado && Math.abs(restado.area || 0) > 1e-9 &&
                        Math.abs(restado.area || 0) <= Math.abs(final.area || 0) * (1 + 1e-6)) {
                        final = restado;
                    }
                }
                // 2) CONTENCIÃÆÃ¢â¬ÅN: intersecciÃÆÃÂ³n con la silueta del producto.
                if (siluetaSketch) {
                    let toca = false;
                    try { toca = final.bounds.intersects(siluetaSketch.bounds); } catch (_) {}
                    if (toca) {
                        const contenido = booleanaPorHijos(final, siluetaSketch, "intersect");
                        if (contenido && Math.abs(contenido.area || 0) > 1e-9 &&
                            Math.abs(contenido.area || 0) <= Math.abs(final.area || 0) * (1 + 1e-6)) {
                            final = contenido;
                        } else {
                            try { contenido?.remove?.(); } catch (_) {}
                        }
                    }
                }
                // 3) Reemplazo en la MISMA posiciÃÆÃÂ³n z (abajo ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ arriba).
                try {
                    const parent = unidad.parent || tempLayer;
                    const idx = unidad.index;
                    unidad.remove();
                    parent.insertChild(idx, final);
                } catch (_) {
                    try { tempLayer.addChild(final); } catch (_) {}
                }
            }
        } catch (err) {
            console.warn("[EKKO EXPORT] Aplanado por apilado incompleto:", err);
        }
        try { if (siluetaSketch) siluetaSketch.remove(); } catch (_) {}
    }

    // 7d. CAPA DE CORTE (roja) al tope del apilado: el programa de grabado/lÃÆÃÂ¡ser la lee como
    // capa de corte separada del grabado negro.
    if (capaCorte) {
        try {
            tempLayer.addChild(capaCorte);
        } catch (_) {
            try { capaCorte.remove(); } catch (_) {}
            capaCorte = null;
        }
    }

    // 7e. CAPAS el programa de grabado/lÃÆÃÂ¡ser (regla del dueÃÆÃÂ±o: solo modo grabado/stackFlatten):
    // los vectores del cliente van a capa AZUL (#0000ff, engraving y
    // perfectamente visible sobre el lienzo oscuro), el mockup de
    // referencia (si se incluye) y la capa de corte van a ROJO, y las
    // imÃÆÃÂ¡genes quedan en capa NEGRA (la capa 00 de el programa de grabado/lÃÆÃÂ¡ser).
    // El boceto (keepMockupImage) NO se toca: el cliente ve su diseÃÆÃÂ±o.
    if (options.stackFlatten === true) {
        try {
            const esVector = (item) =>
                item instanceof paper.PathItem &&
                !(item.data?.mockup || item.data?.isMockupOutline || item.data?.isCutLayer ||
                  item.data?.isFusionMask);
            // Vectores del cliente ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ AZUL (incluso los "casi negros" del app).
            tempLayer.getItems({
                match: it => esVector(it)
            }).forEach(item => {
                item.strokeColor = new paper.Color("#0000ff");
                if (item.fillColor) item.fillColor = new paper.Color("#0000ff");
            });
            // Mockup de referencia (si se incluye) ÃÂ¢Ã¢â¬Â Ã¢â¬â¢ ROJO, como la capa de corte.
            tempLayer.getItems({
                match: it => (it.data?.mockup || it.data?.isMockupOutline) && !it.data?.isCutLayer
            }).forEach(item => {
                item.strokeColor = new paper.Color("#ff0000");
                item.fillColor = null;
            });
        } catch (_) {}
    }

    // 8. EXPORTACIÃÆÃ¢â¬ÅN NATIVA A SVG CON PRECISIÃÆÃ¢â¬ÅN INDUSTRIAL
    // El marco es el PRODUCTO (union con el contenido por si algo sobresale):
    // la geometria no se traslada, solo cambia la ventana del viewBox.
    let marcoFinal = null;
    try {
        const contenido = tempLayer.bounds;
        if (marcoProducto && contenido && contenido.width > 0 && contenido.height > 0) {
            marcoFinal = marcoProducto.unite(contenido);
        } else {
            marcoFinal = marcoProducto ? marcoProducto.clone() : null;
        }
    } catch (_) { marcoFinal = marcoProducto ? marcoProducto.clone() : null; }
    const exportConfig = {
        asString: true,
        bounds: marcoFinal || "content",
        precision: precision
    };

    let svgString = tempLayer.exportSVG(exportConfig);

    // 8b. DESANIDADO + SIN RECORTE HEREDADO: Paper envuelve los items con
    // clip en <svg> anidados SIN atributos de tamanio; el navegador los mide
    // 100%x100% del lienzo y el render se rompe (visto en produccion con un
    // diseÃÆÃÂ±o importado: contenido recortado y desplazado). El clip heredado
    // del SVG del cliente ademas esconde geometria que en el lienzo se ve
    // completa. Regla de la descarga: LO QUE SE VE EN EL LIENZO ES LO QUE
    // SALE ÃÂ¢Ã¢âÂ¬Ã¢â¬Â se aplana la estructura y se eliminan los recortes.
    if (typeof svgString === "string") {
        svgString = svgString
            .replace(/<svg[^>]*>/g, "")
            .replace(/<\/svg>/g, "")
            .replace(/<defs>\s*<clipPath[\s\S]*?<\/clipPath>\s*<\/defs>/g, "")
            .replace(/\s*clip-path="[^"]*"/g, "");
    }

    // 8e. PREFIJO DE HREF NORMALIZADO A XLINK: Paper serializa los href de
    // las imÃÆÃÂ¡genes como `ns1:href` (prefijo arbitrario) y declara
    // `xmlns:ns1="http://www.w3.org/1999/xlink"` sobre el propio <image>.
    // el programa de grabado/lÃÆÃÂ¡ser busca `xlink:href` literal y no reconoce el prefijo `ns1`,
    // por lo que las imÃÆÃÂ¡genes quedan invisibles (se ve sÃÆÃÂ³lo el vector).
    // Se reescribe el prefijo y se declara xmlns:xlink en la raÃÆÃÂ­z
    // (mÃÆÃÂ¡s abajo, secciÃÆÃÂ³n 9).
    if (typeof svgString === "string" && svgString.indexOf("<image") !== -1) {
        svgString = svgString.replace(/\b[a-zA-Z_][\w.-]*:href\s*=/g, "xlink:href=");
        svgString = svgString.replace(/\s+xmlns:[a-zA-Z_][\w.-]*\s*=\s*"http:\/\/www\.w3\.org\/1999\/xlink"/g, "");
    }

    // 8c. IMÃÆÃÂGENES SIN ESCALA HEREDADA: el programa de grabado/lÃÆÃÂ¡ser no siempre resuelve un
    // <image width="2000" transform="scale(0.025)"> igual que el navegador:
    // el tamaÃÆÃÂ±o fÃÆÃÂ­sico correcto vive en width/height, y si la transformaciÃÆÃÂ³n
    // es una ESCALA UNIFORME se hornea en el elemento (xÃâÃÂ·s, yÃâÃÂ·s, wÃâÃÂ·s, hÃâÃÂ·s) y
    // la transformaciÃÆÃÂ³n desaparece. Cualquier otra transformaciÃÆÃÂ³n se deja
    // intacta (caso raro: rotaciones sobre imÃÆÃÂ¡genes horneadas).
    if (typeof svgString === "string" && svgString.indexOf("<image") !== -1) {
        svgString = svgString.replace(/<image\b[^>]*>/g, function (etiqueta) {
            if (etiqueta.indexOf("transform") === -1) return etiqueta;
            const mTr = etiqueta.match(/transform\s*=\s*"scale\(\s*([-+\d.eE]+)\s*(?:,\s*([-+\d.eE]+)\s*)?\)"/);
            if (!mTr) return etiqueta;
            const sx = parseFloat(mTr[1]);
            const sy = mTr[2] !== undefined ? parseFloat(mTr[2]) : sx;
            if (!isFinite(sx) || !isFinite(sy) || sx <= 0 || sy <= 0) return etiqueta;
            const aplana = (reg, mult) => {
                const mA = etiqueta.match(reg);
                if (!mA) return null;
                const v = parseFloat(mA[2]);
                if (!isFinite(v)) return null;
                const flat = parseFloat((v * mult).toFixed(6));
                return { completo: mA[0], nuevo: mA[1] + flat };
            };
            const cambios = [
                aplana(/(\sx\s*=\s*")([-+\d.eE]+)/, sx),
                aplana(/(\sy\s*=\s*")([-+\d.eE]+)/, sy),
                aplana(/(\swidth\s*=\s*")([-+\d.eE]+)/, sx),
                aplana(/(\sheight\s*=\s*")([-+\d.eE]+)/, sy)
            ];
            let salida = etiqueta.replace(mTr[0], "");
            cambios.forEach(c => { if (c) salida = salida.replace(c.completo, c.nuevo); });
            return salida;
        });
    }

    // 8d. IMÃÆÃÂGENES EN CAPA AMARILLA (regla del dueÃÆÃÂ±o: solo modo grabado).
    // el programa de grabado/lÃÆÃÂ¡ser asigna la capa por color; un raster no tiene color, asÃÆÃÂ­
    // que se envuelve en un <g stroke="#ffd700"> ÃÂ¢Ã¢âÂ¬Ã¢â¬Â el color del grupo manda,
    // igual que con el texto/vectores. Las imÃÆÃÂ¡genes pasan a la capa amarilla
    // y el cliente las ve (sobre el lienzo oscuro desaparecÃÆÃÂ­an).
    // En el boceto (keepMockupImage) no se toca: el cliente ve su diseÃÆÃÂ±o.
    if (typeof svgString === "string" && svgString.indexOf("<image") !== -1 && options.stackFlatten === true) {
        svgString = svgString.replace(/<image\b[^>]*>/g, function (etiqueta) {
            return '<g stroke="#ffd700" stroke-width="0.5" fill="none" data-ekko-layer="imagenes">' + etiqueta + '</g>';
        });
    }

    // 9. RAÃÆÃÂZ SVG CON DIMENSIONES FÃÆÃÂSICAS EN MILÃÆÃÂMETROS (Escala 1:1 en el programa de grabado/lÃÆÃÂ¡ser)
    // Paper exporta la capa como fragmento <g> sin raÃÆÃÂ­z <svg>; el antiguo
    // reemplazo por regex nunca encontraba <svg> y las dimensiones se perdÃÆÃÂ­an.
    // Se construye la raÃÆÃÂ­z explÃÆÃÂ­citamente: width/height en mm y viewBox en
    // unidades de proyecto, de modo que 1 unidad = window.mmPerPaperUnit mm.
    if (typeof svgString === "string" && svgString.trim() !== "") {
        const bounds = marcoFinal || tempLayer.bounds;
        const mmPerUnit = Number(window.mmPerPaperUnit) || 0;
        if (bounds && bounds.width > 0 && bounds.height > 0 && mmPerUnit > 0) {
            const num = value => Number.isFinite(value) ? value.toFixed(precision) : "0";
            const widthMm = (bounds.width * mmPerUnit).toFixed(3);
            const heightMm = (bounds.height * mmPerUnit).toFixed(3);
            const viewBox = `${num(bounds.x)} ${num(bounds.y)} ${num(bounds.width)} ${num(bounds.height)}`;
            svgString = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${widthMm}mm" height="${heightMm}mm" viewBox="${viewBox}">${svgString}</svg>`;
        } else {
            svgString = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${svgString}</svg>`;
        }
    }

    // 10. LIBERACIÃÆÃ¢â¬ÅN DE MEMORIA DEL LIENZO TEMPORAL
    tempLayer.remove();

    if (window.EKKO_DEBUG) {
        console.log("[EKKO EXPORT SUCCESS] El diseÃÆÃÂ±o vectorial ha sido industrializado exitosamente para el programa de grabado/lÃÆÃÂ¡ser.");
    }

    if (typeof DOMParser !== "undefined") {
        const parsed = new DOMParser().parseFromString(svgString, "image/svg+xml");
        if (parsed.querySelector?.("parsererror")) {
            exportCsgReport = { ...(window.EKKO_EXPORT_LAST_REPORT || {}), exportReady: false, reason: "generated-svg-parsererror" };
            window.EKKO_EXPORT_LAST_REPORT = exportCsgReport;
            return "";
        }
        return asString ? svgString : parsed.documentElement;
    }
    return asString ? svgString : svgString;
}

/**
 * Dispara la descarga del SVG preparado directamente en el navegador del usuario.
 * @param {string} [filename="diseno-ekko.svg"] Nombre del archivo de salida
 */
export async function downloadExportedSVG(filename = "diseno-ekko.svg") {
    const svgContent = await prepareSVGForExport({ asString: true });
    if (!svgContent || svgContent.trim() === "") {
        notice("No hay elementos vÃÆÃÂ¡lidos para exportar en el lienzo.", { kind: "warn" });
        return;
    }

    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".svg") ? filename : (filename + ".svg");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ExposiciÃÆÃÂ³n global segura
if (typeof window !== "undefined") {
    window.prepareSVGForExport = prepareSVGForExport;
    window.downloadExportedSVG = downloadExportedSVG;
    // Filtro de grises EKKO-GRIS-v2 para el editor (al entrar fotos).
    window.ekkoAplicarFiltroGrises = aplicarFiltroGrises;
    window.ekkoGrisConfig = leerFiltroGrises;
    // Mejora automÃÆÃÂ¡tica al importar (densidad 300 dpi + definiciÃÆÃÂ³n).
    window.ekkoPrepararFotoImportada = prepararFotoImportada;
    // MODO LÃÆÃÂSER (ediciÃÆÃÂ³n con el look de grabado) + EXPORTAR SELECCIÃÆÃ¢â¬ÅN.
    window.ekkoModoLaser = {
        alternar: alternarModoLaser,
        poner: setModoLaser,
        activo: () => modoLaserActivo
    };
    window.ekkoExportarSeleccionUI = ekkoExportarSeleccionUI;
    window.ekkoExportarSeleccionPNG = exportarSeleccionPNG;
    window.ekkoCopiarSeleccionPNG = copiarSeleccionPNG;
    // DiagnÃÆÃÂ³stico interno (no se usa en UI; sirve para auditar el modo).
    window.__ekkoModoDebug = { aplicarVestuario, vestidoLaser, rasterModoIgnorable };
    sincronizarBotonModo();
}


