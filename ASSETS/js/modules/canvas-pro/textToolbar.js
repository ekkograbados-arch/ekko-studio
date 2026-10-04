import { getPublicOwner, getPublicOwners, isMockupOrMask } from "./designGeometry.js";
/* =========================================================================
Módulo: js/modules/canvas-pro/textToolbar.js (v7 PRO - LAZY LOADING OPTIMIZED)
Ruta de reemplazo: js/modules/canvas-pro/textToolbar.js
Descripción: Gestión de tipografías dinámicas con registro perezoso (Lazy Loading)
para eliminar por completo el delay de red de 2 minutos.
========================================================================= */

// 🚀 SILENCIADOR DE CONSOLA GLOBAL: Mantener la consola limpia de logs informativos o repetitivos


import { textToCompoundPath, getBuiltinFontCatalog, loadFont } from "./fontToPath.js";
import { stampDesignItem } from "./fusionCore.js";
import { buildContourRelations, applyContourRecord } from "./holeSemantics.js";
import { setSemanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { notice } from "./ekkoNotice.js";

/* =========================================================================
   ESTADO DE TEXTO: TRES REPRESENTACIONES, UN SOLO DESPACH
   ---------------------------------------------------------------------------
   Un texto de EKKO vive en una de tres formas, y cada una guarda sus
   atributos en un sitio distinto:

     PointText          -> propiedad directa (fontSize, fontFamily, ...)
     grupo curvado      -> data.textString + data.fontSize + data.curvature
     grupo espaciado    -> data.textString + data.fontSize + data.hspace

   Antes cada funcion de formato (negrita, cursiva, fuente, tamano,
   espaciado) resolvia sola cual era el caso, y todas resolvian "PointText" o
   buscaban hijos PointText. El grupo curvado tiene hijos COMPOUNDPATH porque
   sus glifos van horneados, y el grupo espaciado tiene PointText sueltos: por
   eso la negrita no aplicaba al texto curvado, cambiar la fuente no hacia
   nada, y al curvar un texto espaciado se curvaba una unica letra.

   Los helpers de esta seccion son el UNICO lugar que sabe como se
   reconstruye cada representacion. rotationController (tamano) y
   contextualMenu (fuente) los usan por la via publica para no duplicar el
   despacho.

   Nota de contencion: nada de esto toca isFusionReceptor. Un texto ya
   vectorizado es otra especie (data.isTextVector) y no pasa por aqui, asi que
   la fusion de una imagen dentro de una letra sigue intacta.
   ========================================================================= */

/** Resuelve el owner de TEXTO de una seleccion, sea cual sea su forma. */
function resolveTextTarget(item) {
    const owner = getPublicOwner(item) || item;
    if (!owner || owner.data?.locked) return null;
    if (isTextOwner(owner)) return owner;
    return findTextTarget(owner);
}

/**
 * Predicado canonico: "este owner es texto".
 *
 * Vive aca porque textToolbar es el modulo de texto, y lo consumen el
 * resolutor, rotationController (por window, para no abrir un ciclo de imports
 * con fusionController) y contextualMenu. Que los tres pregunten lo mismo es lo
 * que evita que la negrita aparezca para un vector o que los campos de tamano
 * se activen con una imagen.
 */
export function isTextOwner(item) {
    if (!item) return false;
    const data = item.data || {};
    if (data.isText === true || data.isCurvedGroup === true || data.isSpacedGroup === true) return true;
    return item.className === "PointText";
}

function isGroupedText(owner) {
    return !!(owner && (owner.data?.isCurvedGroup === true || owner.data?.isSpacedGroup === true));
}

/** Cuerpo del texto en unidades de lienzo, venga de donde venga. */
export function textFontSize(owner) {
    if (!owner) return null;
    if (owner.className === "PointText" && Number(owner.fontSize) > 0) return Number(owner.fontSize);
    const size = Number(owner.data?.fontSize);
    return Number.isFinite(size) && size > 0 ? size : null;
}

/**
 * Escribe un atributo de fuente en CUALQUIER representacion de texto.
 *
 * Un PointText lo guarda en la propiedad y se redibuja solo. Un grupo curvado
 * o espaciado lo guarda en data.* y ademas tiene que RECONSTRUIRSE, porque sus
 * glifos ya son geometria horneada: cambiar la propiedad sola no llega a la
 * pantalla.
 */
function setFontAttribute(owner, key, value) {
    if (!owner) return;
    if (!isGroupedText(owner)) {
        owner[key] = value;
        paper.view.update();
        return;
    }
    owner.data = { ...(owner.data || {}), [key]: value };
    window.rebuildEKKOTextOwner?.(owner);
    paper.view.update();
}

/**
 * Reconstruye un owner de texto en la misma forma que tenia.
 *
 * Es el unico camino de reconstruccion: lo usan la negrita, la cursiva, el
 * tamano de fuente, el espaciado y la curvatura, para que no se desincronicen.
 *
 * @param {paper.Item} owner  grupo curvado o espaciado
 * @param {Object}   [patch]  { curvature, radius, hspace } para forzar valores
 * @returns {paper.Item|null} el owner plano, o la promesa del reconstruido
 */
export function rebuildEKKOTextOwner(owner, patch = {}) {
    if (!owner) return null;
    if (!isGroupedText(owner)) return owner;

    const data = owner.data || {};
    const curvature = patch.curvature !== undefined
        ? Number(patch.curvature) || 0
        : Number(data.curvature) || 0;
    const hspace = patch.hspace !== undefined
        ? Number(patch.hspace) || 0
        : Number(data.hspace) || 0;
    const radius = patch.radius !== undefined
        ? Number(patch.radius) || 0
        : Number(data.radius) || 0;

    // restoreFlatText lee data.textString y deja un PointText limpio en el
    // MISMO indice del mismo padre, asi que el objeto no se mueve de lugar.
    const flat = restoreFlatText(owner, owner, true);
    if (!flat) return null;
    flat.visible = true;

    // applyTextCurve y applyTextSpacing solo saben publicar el owner nuevo si la
    // seleccion apunta al objeto que van a reemplazar. Por eso se les entrega
    // la seleccion antes de llamarlos, en vez de rehacer su logica aqui.
    handOffSelection(owner, flat);
    /* El modo curva sigue al texto plano intermedio: las reconstrucciones de
       abajo publican el owner final y transfieren desde aca. */
    transferCurveMode(owner, flat);

    if (Math.abs(curvature) >= 0.1) {
        const promesa = applyTextCurve(flat, curvature, {
            skipHistory: true,
            radius: radius || undefined,
            hspace
        });
        return (promesa && typeof promesa.then === "function")
            ? promesa.catch(() => null)
            : null;
    }
    if (hspace) {
        const promesa = applyTextSpacing(flat, hspace);
        return (promesa && typeof promesa.then === "function")
            ? promesa.catch(() => null)
            : null;
    }
    window.updateSelectionBox?.(flat);
    return flat;
}

/**
 * Entrega la seleccion al texto plano para que la reconstruccion pueda
 * publicarla.
 *
 * Solo se toca cuando la seleccion era el propio owner agrupado, que es el
 * unico caso que queda colgando: si era el wrapper de contencion, ese wrapper
 * no se mueve y hay que dejar la seleccion exactamente como estaba.
 */
function handOffSelection(owner, flat) {
    if (!owner || window.selectedItem !== owner) return;
    if (typeof window.selectItem === "function") window.selectItem(flat);
}

if (typeof window !== "undefined") {
    // Superficie publica: rotationController y contextualMenu reconstruyen y
    // consulta desde aca en vez de importar este modulo, para no abrir un ciclo
    // de imports con fusionController.
    window.rebuildEKKOTextOwner = rebuildEKKOTextOwner;
    window.EKKO_TEXT_IS_OWNER = isTextOwner;
    window.EKKO_TEXT_FONT_SIZE = textFontSize;
    window.toggleRotateLetters = toggleRotateLetters;
    window.editGroupText = editGroupText;
    /* Sello de version del modulo de texto. Si en la consola del cliente este
       valor no coincide con el del paquete entregado, esta probando codigo
       viejo (cache o Vercel sin actualizar). Se actualiza en cada entrega. */
    window.EKKO_TEXT_BUILD = "20261004-modo-curva-v2";
    /* Superficie del tirador de curvatura. selection.js la consulta en vez de
       mantener su propia logica de arrastre: asi el unico dueno de "como se
       curva un texto" es este modulo. */
    window.EKKO_TEXT_BEND = {
        sync: syncCurveHandle,
        hitTest: bendHitTest,
        begin: beginBend,
        update: updateBend,
        end: endBend,
        clear: clearBend,
        isBending,
        radiusOf: curvatureToRadius,
        guides: drawCurveGuides,
        enterMode: enterCurveMode,
        exitMode: exitCurveMode,
        isMode: isCurveMode,
        syncInputs: syncBendInputs,
        handle: () => window._ekkoCurveHandle || null
    };
    /* Las guias y el tirador se despegan del texto cuando el cliente lo mueve,
       escala o rota: quedan clavados en el lugar anterior. El controlador de
       transformaciones avisa de cada gesto, asi que se redibujan ahi, una vez
       por frame. MEDIDO: sin esto, mover el texto curvo dejaba el arco magenta
       flotando lejos de las letras. */
    window.EKKO_FUSION_CONTROLLER?.addTransformObserver?.(() => {
        if (guiaFrame) return;
        if (!isCurveMode(window.selectedItem)) return;
        guiaFrame = requestAnimationFrame(() => {
            guiaFrame = null;
            syncCurveHandle();
        });
    });
}
let guiaFrame = null;

let loadedFontsCache = [];

// Diccionario de mapeo de alias tipográficos históricos para retrocompatibilidad absoluta
const LEGACY_FONT_ALIASES = {
    "billiejames": ["ekko_billie", "ekko_billiejames_regular"],
    "romantic": ["ekko_romantic", "ekko_romantic_sunrise"],
    "farmhouse": ["ekko_farmhouse"],
    "chocolate": ["ekko_chocolate"],
    "waltograph": ["ekko_disney", "ekko_waltograph", "ekko_waltograph42"],
    "simpson": ["ekko_simpson", "ekko_simpsonfont_demo"],
    "milk": ["ekko_milk", "ekko_milk_water"],
    "simplehandmade": ["ekko_simple"],
    "studynight": ["ekko_studynight"],
    "studyperson": ["ekko_studyperson"],
    "nostalgic": ["ekko_nostalgic"],
    "please writ": ["ekko_song"]
};

/**
 * Carga fuentes dinámicamente desde el endpoint del backend /api/fonts
 * ⚡ OPTIMIZACIÓN v7: Registro perezoso de FontFace (Lazy Loading) sin llamar a .load() de forma síncrona.
 * Esto elimina por completo el delay de 2 minutos al arrancar la página.
 */
export async function loadDynamicFonts() {
    if (loadedFontsCache.length > 0) return loadedFontsCache;

    try {
        const response = await fetch('/api/fonts');
        if (!response.ok) throw new Error("Endpoint api/fonts no disponible");
        const fontFiles = await response.json();
        if (!fontFiles || fontFiles.length === 0) {
            // Keep the editor usable in a static/local installation. The
            // fallback files are part of the repository and are also the
            // source used by the OpenType converter.
            loadedFontsCache = getBuiltinFontCatalog();
            return loadedFontsCache;
        }

        const loaded = [];
        for (const item of fontFiles) {
            let name, family, file;
            if (typeof item === 'string') {
                file = item;
                name = file.replace(/^.*[\/]/, '').replace(/\.[^/.]+$/, "");
                family = "ekko_" + name.toLowerCase().replace(/[^a-z0-9]/g, "_");
            } else if (item && typeof item === 'object') {
                name = item.name;
                family = item.family;
                file = item.file;
            } else {
                continue;
            }

            try {
                // 🚀 OPTIMIZACIÓN CLAVE (LAZY-LOADING): No descargamos la fuente de forma bloqueante conawait .load()
                // Solo creamos el objeto FontFace y lo registramos en document.fonts. El navegador la descargará
                // de forma transparente únicamente cuando el lienzo intente pintar un texto con dicha tipografía.
                const fontFace = new FontFace(family, `url(/ASSETS/fonts/${encodeURIComponent(file)})`, { display: 'swap' });
                document.fonts.add(fontFace);
                loaded.push({ name: name, family: family, file: file });

                // Registrar Alias Históricos de forma perezosa instantánea
                const lowerFile = file.toLowerCase();
                for (const [pattern, aliases] of Object.entries(LEGACY_FONT_ALIASES)) {
                    if (lowerFile.includes(pattern)) {
                        for (const alias of aliases) {
                            if (alias !== family) {
                                try {
                                    const aliasFace = new FontFace(alias, `url(/ASSETS/fonts/${encodeURIComponent(file)})`, { display: 'swap' });
                                    document.fonts.add(aliasFace);
                                } catch (aliasErr) {
                                    // Ignorar en silencio
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                // Ignorar error individual de fuente
            }
        }

        if (loaded.length === 0) {
            throw new Error("Ninguna tipografía dinámica pudo registrarse.");
        }
        loaded.sort((a, b) => a.name.localeCompare(b.name));
        loadedFontsCache = loaded;
        return loaded;
    } catch (e) {
        // Static/local mode: expose the bundled catalogue instead of leaving
        // the text tools empty. The endpoint remains the preferred source.
        loadedFontsCache = getBuiltinFontCatalog();
        if (typeof window !== 'undefined') window._ekkoFontCatalogError = String(e?.message || e);
        return loadedFontsCache;
    }
}

/**
 * Puerta de entrada SERIALIZADA a la curvatura. Todo el que curva (arrastre,
 * sliders, numeros, codigo) pasa por aca: si hay un rebuild en vuelo, el pedido
 * se encola y solo corre el ultimo. Sin esto, dos rebuilds encimados dejaban
 * dos grupos vivos (duplicado).
 */
export function applyTextCurve(item, curvature, options = {}) {
    return new Promise((resolver) => {
        /* Coalescencia solo entre curvas: si lo ultimo encolado es una curva,
           se actualiza en el lugar (el ultimo valor manda) y este pedido espera
           con los demas. Si es una soldadura, se encola detras (orden real). */
        const top = curvaCola[curvaCola.length - 1];
        if (top && !top.soldar) {
            top.item = item;
            top.curvatura = curvature;
            top.opciones = options || {};
            top.espera.push(resolver);
        } else {
            curvaCola.push({ item, curvatura: curvature, opciones: options || {}, espera: [resolver] });
        }
        bombearCarril();
    });
}

/**
 * Aplica deformación curva al texto distribuyendo letras sobre un arco (Estilo LightBurn)
 */
async function applyTextCurveRun(item, curvature, options = {}) {
    if (!item || item.data?.locked) return;
    /* Sin padre no hay nada que reconstruir: Paper conserva `.project` despues
       de remove() (solo quita parent), asi que chequear project no alcanza. Un
       pedido viejo sobre un objeto ya eliminado generaba basura invisible
       (grupos sueltos sin padre) o, peor, grupos duplicados en escena. */
    if (!item.parent) return null;
    if (!options.skipHistory && typeof window.saveHistory === 'function') window.saveHistory();
    const numericCurvature = Number(curvature) || 0;

    if (Math.abs(numericCurvature) < 0.1) {
        /* APPLANAR. applyTextCurve con curvatura cero deshace el arco.
           restoreFlatText cambia el owner de la escena, asi que la seleccion hay
           que entregarla al texto plano. Antes solo se hacia si la seleccion
           apuntaba EXACTAMENTE al grupo curvo: cuando apuntaba al wrapper de
           contencion, o cuando venia de otra ruta, la seleccion se quedaba
           colgando del grupo ya removido y el texto plano quedaba sin poder
           editar. Se resuelve el owner publico para no depender de cual de los
           dos este seleccionado.
           Aplanar tambien SALE del modo curva: sin curva no hay nada que
           ajustar con el punto. */
        exitCurveMode();
        if (item.data?.isCurvedGroup) {
            const owner = getPublicOwner(item) || item;
            const flatText = restoreFlatText(item, item);
            if (flatText) {
                const seleccion = window.selectedItem;
                if (seleccion === item || seleccion === owner ||
                    seleccion?.data?.publicOwnerId === owner?.id) {
                    if (typeof window.selectItem === "function") window.selectItem(flatText);
                }
                window.updateSelectionBox?.(flatText);
                paper.view.update();
            }
        }
        return;
    }

    let textString = "";
    let fontSize = 42;
    let fontFamily = "Arial";
    let fillColor = new paper.Color(0);
    let fontWeight = "normal";
    let fontStyle = "normal";
    let targetItem = item;

    if (item.data?.isCurvedGroup) {
        textString = item.data.textString || "";
        fontSize = item.data.fontSize || 42;
        fontFamily = item.data.fontFamily || "Arial";
        fillColor = item.data.fillColor || new paper.Color(0);
        fontWeight = item.data.fontWeight || "normal";
        fontStyle = item.data.fontStyle || "normal";
    } else if (item instanceof paper.PointText) {
        textString = item.content;
        fontSize = item.fontSize;
        fontFamily = item.fontFamily;
        fillColor = item.fillColor;
        fontWeight = item.fontWeight || "normal";
        fontStyle = item.fontStyle || "normal";
        item.data = item.data || {};
        item.data.textString = textString;
        item.data.fontSize = fontSize;
        item.data.fontFamily = fontFamily;
        item.data.fillColor = fillColor;
        item.data.fontWeight = fontWeight;
        item.data.fontStyle = fontStyle;
    } else if (item.data?.isSpacedGroup) {
        /* Un grupo con espaciado YA tiene el string guardado en
           data.textString, asi que la curva se aplica al TEXTO COMPLETO y no a
           uno de sus hijos.

           Antes se tomaba el primer PointText encontrado con find(), de modo
           que al curvar un texto con espaciado (cuyos hijos son PointText
           sueltos, uno por letra) se curvaba UNICAMENTE la primera letra y el
           resto quedaba recto. Reconstruir desde el string es la unica forma
           de que la curva aplique al conjunto. */
        rebuildEKKOTextOwner(item, {
            curvature: numericCurvature,
            radius: Number(options.radius) || undefined,
            hspace: options.hspace !== undefined ? Number(options.hspace) : undefined
        });
        window.updateSelectionBox?.(window.selectedItem);
        paper.view.update();
        return;
    } else {
        const textChild = item.children.map(getPublicOwner).filter(Boolean).find(c => c instanceof paper.PointText || c.data?.isCurvedGroup);
        if (textChild) {
            applyTextCurve(textChild, curvature, options);
            window.updateSelectionBox(item);
            paper.view.update();
        }
        return;
    }

    removeCurveHandle();

    const curvedGroup = new paper.Group();
    curvedGroup.data = {
        ...targetItem.data,
        isCurvedGroup: true,
        textString: textString,
        fontSize: fontSize,
        fontFamily: fontFamily,
        fillColor: fillColor,
        fontWeight: fontWeight,
        fontStyle: fontStyle,
        curvature: numericCurvature,
        radius: Number(options.radius) || (Math.abs(numericCurvature) > 0.001 ? 10000 / Math.abs(numericCurvature) : 10000),
        hspace: Number(options.hspace ?? targetItem.data?.hspace ?? 0) || 0,
        // Curved text remains editable text, not a final Text-to-Vector owner.
        isTextVector: false,
        preserveCompoundTopology: true
    };

    const charCount = textString.length;
    if (charCount === 0) return;

    /* MEDIDAS REALES DE LOS GLIFOS.
       Antes el ancho del texto se estimaba con `largo * fontSize * 0.6`, una
       aproximacion que no tiene en cuenta el ancho de cada letra: "il" ocupaba
       lo mismo que "MM". Por eso unas letras quedaban pegadas y otras
       separadas, y el espaciado era incontrolable. getAdvanceWidth da el avance
       real de cada glifo. */
    const size = Number(fontSize) || 42;
    const hspace = Number(options.hspace ?? targetItem.data?.hspace ?? 0) || 0;
    const fuente = await loadFont(fontFamily).catch(() => null);
    const chars = Array.from(textString);
    const medidas = chars.map((ch) => {
        let advance = size * 0.6;
        try { advance = fuente?.getAdvanceWidth ? fuente.getAdvanceWidth(ch, size) : advance; } catch (_) {}
        return Math.abs(Number(advance) || size * 0.6);
    });

    // Longitud total del arco: suma de avances reales mas el espaciado pedido.
    const espacioPorPar = hspace * size * 0.02;
    const longitudTotal = medidas.reduce((a, b) => a + b, 0) + Math.max(0, charCount - 1) * espacioPorPar;

    /* EL ANGULO ES EL VALOR MAESTRO.
       radio = longitud del arco / angulo. El cliente escribe el angulo (0 a 359)
       y el radio sale solo. Si mas adelante se toca el radio, el angulo se
       recalcula con esta misma formula: los dos nunca pueden discordar. */
    const theta = Math.abs(numericCurvature) * (Math.PI / 180);
    const haciaArriba = numericCurvature >= 0;
    const signo = haciaArriba ? 1 : -1;
    const radio = theta > 1e-6 ? (longitudTotal / theta) : Infinity;

    /* ANCLA EN MARCO OWNER-LOCAL.
       Los hijos del grupo se posicionan en marco local puro del arco (sin
       mapear por la matriz del texto), y la matriz del texto se transfiere
       ENTERA al grupo nuevo al publicar. Asi la salida es M·(arco + ancla):
         - rebuilds con mismos parametros: mismos numeros -> salida
           bit-identica, cero deriva al arrastrar;
         - el cliente MOVIO el texto: la traslacion viaja en la matriz
           transferida -> el arco viaja rigido con el objeto;
         - el cliente ROTO el texto: la rotacion viaja igual -> gira rigido.
       El ancla se guarda (data.bendAnchorLocal) con el id del padre
       (data.bendAnchorParent): mientras el padre sea el mismo se reutiliza.
       Solo se recalcula en la primera curva o si el objeto cambio de padre.
       La version anterior mapeaba por la matriz (que incluye la posicion
       fresca del PointText temporal, distinta en cada rebuild) y por eso el
       texto trepaba frame a frame. */
    const padreTarget = targetItem.parent;
    const padreId = padreTarget?.id ?? null;
    let anclaLocal = null;
    const anclaGuardada = targetItem.data?.bendAnchorLocal;
    const padreGuardado = targetItem.data?.bendAnchorParent;
    if (Array.isArray(anclaGuardada) && anclaGuardada.length === 2 &&
        anclaGuardada.every((n) => Number.isFinite(n)) &&
        padreGuardado != null && padreGuardado === padreId) {
        anclaLocal = new paper.Point(anclaGuardada[0], anclaGuardada[1]);
    } else {
        // Primera curva o reparentado: el punto del marco local que hoy cae
        // sobre el centro visible del texto (matriz completa invertida: el
        // ancla debe cumplir M·A = C).
        try {
            const cPadre = padreTarget
                ? padreTarget.globalToLocal(targetItem.bounds.center)
                : targetItem.bounds.center.clone();
            const inv = targetItem.matrix?.inverted?.() || new paper.Matrix();
            anclaLocal = cPadre.transform(inv);
        } catch (_) {
            anclaLocal = new paper.Point(0, 0);
        }
    }

    let acumulado = -longitudTotal / 2;
    for (let i = 0; i < charCount; i++) {
        const char = chars[i];
        const advance = medidas[i];
        const centroGlifo = acumulado + advance / 2;
        acumulado += advance + (i < charCount - 1 ? espacioPorPar : 0);

        // Punto sobre la circunferencia, medido desde el mas cercano al medio.
        const phi = radio < Infinity ? centroGlifo / radio : 0;
        const xLocal = radio < Infinity ? radio * Math.sin(phi) : centroGlifo;
        const yLocal = radio < Infinity ? signo * radio * (1 - Math.cos(phi)) : 0;

        const temp = new paper.PointText({
            insert: false,
            point: new paper.Point(0, 0),
            content: char,
            fontSize: size,
            fontFamily,
            fillColor,
            fontWeight,
            fontStyle,
            justification: "left"
        });
        const glyph = await textToCompoundPath(temp);
        temp.remove();
        if (!glyph) continue;
        glyph.fillRule = "evenodd";

        /* Geometria HORNEADA, no en matriz.
           textToCompoundPath devuelve el glifo con applyMatrix=false (la matriz
           la aplica el llamador una sola vez). Si se deja asi, cada glifo lleva
           su posicion y su giro en glyph.matrix, y todo lo que lee geometria
           clonando sin matriz (flattenIdentityClone, que usa la caja de
           seleccion, el alineado y las cotas) pierde la transformacion: la caja
           salia del tamano de un glifo sin girar en vez del texto curvado.
           Con applyMatrix=true, los translate/rotate de abajo se hornean en los
           segmentos y el glifo queda como cualquier otro vector de la app
           (matriz identidad, geometria final). Los movimientos/rotados reales
           van por la matriz del DUENO (fusionController), que sigue intacta. */
        glyph.applyMatrix = true;

        // Centrar el glifo sobre su avance, girarlo para que quede tangente a
        // la circunferencia y ubicarlo en el marco local del grupo.
        glyph.translate(new paper.Point(-advance / 2, 0));
        /* MODO DE GIRO DE LAS LETRAS (el "candado").
           paper.rotate() recibe GRADOS, no radianes (asi se fue el angulo: se
           pasaba phi en radianes y cada letra giraba ~1° en lugar de los 50° que
           correspondian). En el modo "letra vertical" (candado CERRADO) no se
           gira la letra: se apoya en la linea de curvado y sigue vertical. En el
           modo LightBurn (candado ABIERTO) se gira para quedar perpendicular al
           radio, que es lo que hace LightBurn.
           El modo se guarda en data.rotateLetters: true = como LightBurn. */
        const girar = options.rotateLetters !== undefined
            ? !!options.rotateLetters
            : (targetItem.data?.rotateLetters !== false);
        if (radio < Infinity && girar) {
            glyph.rotate(signo * phi * (180 / Math.PI), new paper.Point(0, 0));
        }
        /* Posicion final en marco OWNER-LOCAL: ancla + arco. Sin mapear por la
           matriz del texto: esa matriz se transfiere ENTERA al grupo al
           publicar, y mapear tambien aca la aplicaria dos veces. */
        const posLocal = new paper.Point(xLocal, yLocal).add(anclaLocal);
        glyph.translate(posLocal);
        curvedGroup.addChild(glyph);
    }

    /* Las guias se dibujan EN VIVO desde los glifos (drawCurveGuides), no desde
       vertices guardados: la app mueve grupos a veces por matriz y a veces por
       hijos (duplicar, alinear, position=), asi que ningun marco guardado
       sobrevive a todos los flujos. Solo se guardan los escalares del estado
       para sliders y diagnostico. */
    curvedGroup.data.bendAngle = numericCurvature;
    curvedGroup.data.bendRadius = radio < Infinity ? radio : null;
    curvedGroup.data.bendSign = radio < Infinity ? signo : 0;
    curvedGroup.data.bendLength = longitudTotal;
    curvedGroup.data.bendAnchorLocal = [anclaLocal.x, anclaLocal.y];
    curvedGroup.data.bendAnchorParent = padreId;

    /* Las guias las dibuja syncCurveHandle() al final (grupo ya en escena y
       seleccionado): ver drawCurveGuides(). */

    curvedGroup.data.fillRule = "evenodd";
    curvedGroup.data.isTextVector = false;
    delete curvedGroup.data.isTextVector;

    /* El tirador NO se dibuja aqui. Antes se hacia antes de insertar el grupo en
       la escena, con lo cual el punto quedaba anclado a un owner que todavia no
       estaba en el lienzo. Se dibuja al final, cuando el owner ya vive y la
       seleccion ya lo publico: ver syncCurveHandle() al final de esta funcion. */

    const parent = targetItem.parent;
    /* La matriz del texto (rotacion/escala/posicion del cliente) se transfiere
       ENTERA al grupo: los hijos estan en marco local puro y es esta matriz la
       que los lleva al lugar correcto. Sin esto, curvar un texto rotado lo
       enderezaba.
       OJO: con applyMatrix=true (default del Group), asignar .matrix HORNEA la
       transformacion en los hijos y resetea a identidad: la transferencia se
       evaporaba y el ancla quedaba huerfana (el texto teleportaba al origen en
       el segundo rebuild). Por eso applyMatrix=false ANTES de asignar, igual
       que hace fusionController para todos los owners publicos. */
    try {
        curvedGroup.applyMatrix = false;
        if (targetItem.matrix) curvedGroup.matrix = targetItem.matrix.clone();
    } catch (_) {}
    if (parent) {
        const index = parent.children.indexOf(targetItem);
        parent.insertChild(index, curvedGroup);
    }
    targetItem.remove();

    if (window.selectedItem === targetItem) {
        /* La lista se pasa EXPLICITA, no como window.selectedItems.

           commitSelectionContext(items, primary) resuelve el primario DENTRO de
           la lista: si el primario no esta en ella, se queda con el ultimo
           elemento de la lista. Al pasar window.selectedItems, que en este
           punto todavia es [targetItem] —el objeto que recien se elimino de la
           escena—, el primario caia en el texto viejo y la seleccion quedaba
           colgando de un owner que ya no existia: la caja se quedaba pegada a
           un punto fantasma y todo comando posterior (negrita, fuente, tamano)
           caia sobre un objeto invisible.

           weldText, mas abajo en este mismo archivo, ya lo hacia bien con
           commitSelection(resultPath, [resultPath]). Esta era la excepcion. */
        /* El modo sigue al owner nuevo ANTES del commit: commitSelection
           refresca el menu en forma sincronica, y ese refresh saldria del modo
           si el id todavia apuntara al owner viejo. */
        transferCurveMode(targetItem, curvedGroup);
        window.commitSelection?.(curvedGroup, [curvedGroup]);
        window.updateSelectionBox(curvedGroup);
    }
    /* El tirador se dibuja al final, cuando el owner ya esta en la escena y la
       seleccion lo apunta. syncCurveHandle() es idempotente: si el punto ya
       apunta a este owner no lo vuelve a crear, asi que durante un arrastre no
       parpadea. */
    syncCurveHandle();
    paper.view.update();
}

/**
 * Alterna el modo de giro de las letras al curvar.
 *
 * Cerradura (candado CERRADO): la letra queda vertical pero apoyada sobre la
 * linea de curvado, que se arquea. Es la forma extrema de "apoyar el texto en el
 * piso curvo": cada glifo mantiene su eje vertical propio.
 *
 * Candado ABIERTO (por defecto): cada letra se gira para quedar PERPENDICULAR a
 * la linea del radio, que es exactamente como lo hace LightBurn.
 *
 * En ambos casos la linea de curvado y el espaciado son los mismos; solo cambia
 * la orientacion de cada glifo.
 */
/* Edita un texto CURVADO o ESPACIADO como si fuera texto normal.
   Se crea un PointText temporal con las mismas propiedades, se abre el editor
   inline sobre él (se oculta el grupo), y al confirmar se escribe el nuevo
   string en data.textString y se reconstruye la curvatura. El grupo nunca se
   convierte en vector: sigue siendo "texto curvado", como en Word o en
   LightBurn. */
export function editGroupText(owner) {
    if (!owner || owner.data?.locked) return;
    const data = owner.data || {};
    if (typeof window.startTextEditing !== 'function') return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const mock = new paper.PointText({
        point: owner.bounds.center,
        content: data.textString || '',
        fontSize: data.fontSize || 42,
        fontFamily: data.fontFamily,
        fillColor: data.fillColor,
        fontWeight: data.fontWeight,
        fontStyle: data.fontStyle,
        justification: 'center'
    });
    mock.data = { isTempEditorMock: true, editHostOwnerId: owner.id };

    const parent = owner.parent || paper.project.activeLayer;
    parent.addChild(mock);
    const visibleAntes = owner.visible;
    owner.visible = false;

    window.textEditOnComplete = (temp, saved) => {
        window.textEditOnComplete = null;
        owner.visible = visibleAntes;
        try { temp.remove(); } catch (_) {}
        const text = saved ? String(temp.content || '').trim() : '';
        if (saved && text) {
            owner.data = { ...(owner.data || {}), textString: text };
            rebuildEKKOTextOwner(owner, {});
        } else if (saved && !text) {
            owner.remove();
            if (typeof window.deselectItem === 'function') window.deselectItem();
            return;
        }
        if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(owner);
        paper.view.update();
    };
    window.startTextEditing(mock);
}

export function toggleRotateLetters() {
    const owner = resolveTextTarget(window.selectedItem || window.selectedItems?.[0]);
    if (!owner) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    const actual = owner.data?.rotateLetters !== false;
    const siguiente = !actual;
    owner.data = { ...(owner.data || {}), rotateLetters: siguiente };
    if (owner.className !== "PointText") {
        /* Ya curvado: rebuild sin pedir estado de nuevo; el modo se toma de
           owner.data porque applyTextCurve lo lee cuando no viene en options. */
        rebuildEKKOTextOwner(owner, { skipHistory: true });
    } else {
        const angulo = Number(owner.data?.curvature) || 0;
        if (Math.abs(angulo) >= 0.1) {
            applyTextCurve(owner, angulo, { skipHistory: true });
        }
    }
    paper.view.update();
}

export function restoreFlatText(item, curvedGroup, keepAnchor = false) {
    const textStr = curvedGroup.data.textString || "Texto";
    const flatText = new paper.PointText({
        point: curvedGroup.bounds.bottomCenter,
        content: textStr,
        fontSize: curvedGroup.data.fontSize || 42,
        fontFamily: curvedGroup.data.fontFamily || "Arial",
        fillColor: curvedGroup.data.fillColor || new paper.Color(0),
        fontWeight: curvedGroup.data.fontWeight || "normal",
        fontStyle: curvedGroup.data.fontStyle || "normal",
        justification: "center"
    });
    flatText.data = { ...curvedGroup.data, isCurvedGroup: false, isTextVector: false };
    delete flatText.data.isTextVector;
    delete flatText.data.curvature;
    delete flatText.data.radius;
    /* La matriz del grupo (rotacion/escala del cliente) pasa al texto plano.
       Sin esto, cada rebuild perdia la rotacion: el arco se reconstruia sin
       girar aunque el cliente lo hubiera rotado antes de curvar. La posicion
       (point) se mantiene donde estaba: solo viaja la orientacion. */
    try {
        if (curvedGroup.matrix && !curvedGroup.matrix.isIdentity()) {
            flatText.matrix = curvedGroup.matrix.clone();
        }
    } catch (_) {}
    /* Un texto plano no es un grupo: ni curvado ni espaciado. Antes solo se
       limpiaba isCurvedGroup, asi que al aplanar un texto con espaciado el
       PointText nuevo conservaba isSpacedGroup, y al volver a curvarlo el
       grupo resultante llevaba las dos marcas a la vez. applyTextCurve y
       applyTextSpacing decide por la primera que encuentran, asi que el
       resultado era correcto por casualidad y no por diseno. */
    delete flatText.data.isSpacedGroup;
    /* El ancla solo sobrevive si se va a re-curvar enseguida (rebuild): un
       aplanado definitivo la borra, asi que si el cliente mueve el texto
       recto y vuelve a curvar, el arco se centra donde esta ahora y no salta
       al pasado. */
    if (!keepAnchor) {
        delete flatText.data.bendAnchorLocal;
        delete flatText.data.bendAnchorParent;
    }
    /* El subrayado es una linea aparte que cuelga del grupo. Si el owner que
       se aplana venia de ahi, el PointText plano se encontraria con una marca
       de subrayado sin la linea que la respalda. rebuildEKKOTextOwner rechaza
       esa combinacion antes de llegar aca; esto es la red de seguridad. */
    delete flatText.data.isUnderlinedGroup;

    const parent = curvedGroup.parent;
    if (parent) {
        const index = parent.children.indexOf(curvedGroup);
        parent.insertChild(index, flatText);
    }
    /* El tirador no se borra aca. Se rehace al final contra el owner que quedo
       vivo. Borrarlo solo dejaba el texto plano sin punto para arrastrar, que es
       justo el estado en el que mas hace falta. */
    curvedGroup.remove();
    return flatText;
}

function removeCurveHandle() {
    removeCurveGuides();
    const handle = typeof window !== 'undefined' ? window._ekkoCurveHandle : null;
    if (handle?.project) {
        try { handle.remove(); } catch (e) {}
    }
    if (typeof window !== 'undefined') window._ekkoCurveHandle = null;
}

/* Las guias comparten el ciclo de vida del tirador: se dibujan y se borran
   juntas, y solo existen si el texto esta curvado (ver syncCurveHandle). */
function removeCurveGuides() {
    const guias = typeof window !== 'undefined' ? window._ekkoCurveGuides : null;
    if (Array.isArray(guias)) {
        guias.forEach(g => { try { if (g?.project) g.remove(); } catch (_) {} });
    }
    if (typeof window !== 'undefined') window._ekkoCurveGuides = null;
}

/**
 * Dibuja las guias de curvado en la capa de overlay, ajustadas EN VIVO a los
 * glifos: circulo por los centros del primer/medio/ultimo glifo.
 *
 * No usa vertices guardados a proposito: la app transforma grupos a veces por
 * matriz y a veces por hijos (duplicar, alinear, position=), y ningun marco
 * guardado sobrevive a todos los flujos. El ajuste en vivo siempre coincide
 * con lo que se ve, ante cualquier transformacion.
 *
 * Casi-recto (radio enorme): se dibuja la cuerda recta y no hay linea de
 * radio (no hay centro). Un solo glifo: solo el eje.
 */
export function drawCurveGuides(owner) {
    removeCurveGuides();
    if (!owner?.project) return null;
    const size = Number(owner.data?.fontSize) || Number(owner.fontSize) || 42;
    const alcance = Math.max(size * 3, 120);
    const capa = bendHandleLayer();
    const creadas = [];
    const armar = (vertices, estilo) => {
        if (!Array.isArray(vertices) || vertices.length < 2) return null;
        const trazo = new paper.Path({ insert: false });
        vertices.forEach(p => trazo.add(p));
        trazo.strokeColor = estilo.color;
        /* Grosor fijo en proyecto, igual que el punto: escala con el zoom. */
        trazo.strokeWidth = estilo.ancho;
        if (estilo.dash) trazo.dashArray = estilo.dash;
        trazo.data = { isBendGuide: true, isHandle: true, noOutput: true,
            curveOwnerId: owner.id };
        capa.addChild(trazo);
        creadas.push(trazo);
        return trazo;
    };
    const guardar = () => {
        if (typeof window !== 'undefined') window._ekkoCurveGuides = creadas;
        return creadas;
    };
    /* Regla uniforme: bounds.center esta en marco del PADRE del item medido,
       asi que se mapea con ESE padre. Para glifos el padre es el grupo (lleva
       la rotacion/posicion); para texto recto es la capa o el wrapper. */
    const aProyecto = (it) => {
        if (!it) return null;
        try {
            const c = it.bounds.center.clone();
            const mp = it.parent;
            return mp?.localToGlobal ? mp.localToGlobal(c) : c;
        } catch (_) { return null; }
    };

    /* Texto RECTO en modo: guias de referencia rectas (el radio es recto en
       principio). Eje por el medio perpendicular al texto, y linea base
       horizontal a lo largo del texto. Todo mapeado a proyecto (ver abajo). */
    if (owner.className === "PointText" && !owner.data?.isCurvedGroup) {
        let dir;
        try {
            const m = owner.globalMatrix || owner.matrix;
            dir = new paper.Point(m.a, m.b);
        } catch (_) { dir = new paper.Point(1, 0); }
        if (dir.length < 1e-6) dir = new paper.Point(1, 0);
        dir = dir.normalize();
        const normal = new paper.Point(-dir.y, dir.x);
        let mid;
        try {
            mid = aProyecto(owner);
            if (!mid) return guardar();
        }
        catch (_) { return guardar(); }
        const medioAncho = (Number(owner.bounds.width) || size * 2) / 2;
        /* El ancho en marco padre escala por la matriz al pasar a proyecto:
           se mide con dos puntos para no asumir escala 1. */
        let anchoProy = medioAncho;
        try {
            if (owner.parent?.localToGlobal) {
                const a = owner.parent.localToGlobal(new paper.Point(-medioAncho, 0));
                const b = owner.parent.localToGlobal(new paper.Point(medioAncho, 0));
                anchoProy = a.getDistance(b) / 2;
            }
        } catch (_) {}
        armar([mid.add(normal.multiply(-alcance)), mid.add(normal.multiply(alcance))],
            { color: 'rgba(37,99,235,0.55)', ancho: 1.5, dash: [4, 4] });
        armar([mid.add(dir.multiply(-anchoProy)), mid.add(dir.multiply(anchoProy))],
            { color: 'rgba(214,0,127,0.45)', ancho: 1.8 });
        return guardar();
    }

    const glifos = Array.from(owner.children || []).filter(c =>
        c && !c.data?.isBendGuide && (c.className === "CompoundPath" || c.className === "Path"));
    if (!glifos.length) return guardar();

    const c0 = aProyecto(glifos[0]);
    const c1 = aProyecto(glifos[glifos.length - 1]);
    if (!c0 || !c1) return null;
    const midCuerda = c0.add(c1).divide(2);

    // Eje del tirador: perpendicular a la cuerda por el medio. Es la recta por
    // la que se mueve el punto azul.
    let direccion = c1.subtract(c0);
    if (direccion.length < 1e-6) {
        try {
            const m = owner.globalMatrix || owner.matrix;
            direccion = new paper.Point(m.a, m.b);
        } catch (_) { direccion = new paper.Point(1, 0); }
        if (direccion.length < 1e-6) direccion = new paper.Point(1, 0);
    }
    direccion = direccion.normalize();
    const normal = new paper.Point(-direccion.y, direccion.x);
    armar([midCuerda.add(normal.multiply(-alcance)), midCuerda.add(normal.multiply(alcance))],
        { color: 'rgba(37,99,235,0.55)', ancho: 1.5, dash: [4, 4] });

    if (glifos.length < 2) {
        return guardar();
    }

    // Ajuste de circulo por primer/medio/ultimo glifo (ya en proyecto).
    const cm = aProyecto(glifos[Math.floor(glifos.length / 2)]) || midCuerda;
    const centroArco = circuncentro(c0, cm, c1);
    if (!centroArco || centroArco.radio > 1e6) {
        // Casi recto: la cuerda ES la linea de curvado; no hay centro ni radio.
        armar([c0, c1], { color: 'rgba(214,0,127,0.45)', ancho: 1.8 });
    } else {
        const C = centroArco.punto;
        const R = centroArco.radio;
        const ang = (p) => Math.atan2(p.y - C.y, p.x - C.x);
        let a0 = ang(c0), a1 = ang(c1), am = ang(cm);
        // Recorrer de a0 a a1 pasando por am (el lado correcto del circulo).
        const TAU = Math.PI * 2;
        const norm = (a) => ((a % TAU) + TAU) % TAU;
        let n0 = norm(a0), n1 = norm(a1), nm = norm(am);
        const vaPorDerecha = ((nm - n0 + TAU) % TAU) <= ((n1 - n0 + TAU) % TAU);
        const pasos = 32;
        const pts = [];
        for (let j = 0; j <= pasos; j++) {
            const t = vaPorDerecha
                ? n0 + (((n1 - n0 + TAU) % TAU) * j) / pasos
                : n0 - (((n0 - n1 + TAU) % TAU) * j) / pasos;
            pts.push(new paper.Point(C.x + R * Math.cos(t), C.y + R * Math.sin(t)));
        }
        armar(pts, { color: 'rgba(214,0,127,0.65)', ancho: 1.8 });
        // Linea del radio: del centro al medio del arco.
        const medioArco = pts[Math.floor(pts.length / 2)];
        armar([C, medioArco], { color: 'rgba(5,150,105,0.75)', ancho: 1.6, dash: [6, 4] });
    }
    return guardar();
}

/* Circuncentro de tres puntos. null si son colineales. */
function circuncentro(p0, p1, p2) {
    const d = 2 * (p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y));
    if (Math.abs(d) < 1e-9) return null;
    const q0 = p0.x * p0.x + p0.y * p0.y;
    const q1 = p1.x * p1.x + p1.y * p1.y;
    const q2 = p2.x * p2.x + p2.y * p2.y;
    const cx = (q0 * (p1.y - p2.y) + q1 * (p2.y - p0.y) + q2 * (p0.y - p1.y)) / d;
    const cy = (q0 * (p2.x - p1.x) + q1 * (p0.x - p2.x) + q2 * (p1.x - p0.x)) / d;
    const punto = new paper.Point(cx, cy);
    return { punto, radio: punto.getDistance(p0) };
}

/* =========================================================================
   TIRADOR DE CURVATURA — ESTILO LIGHTBURN
   ---------------------------------------------------------------------------
   LightBurn: se selecciona un texto, aparece un punto azul, se arrastra hacia
   arriba o abajo y el texto se arquea. Doble clic en el punto y vuelve a recto.

   MEDIDO, lo que hacia EKKO antes:

     - El punto SOLO se creaba cuando el texto ya estaba curvado. Con texto plano
       no habia NADA que agarrar, que es justo el gesto con el que se empieza. No
       se podia entrar al estado curvo arrastrando: habia que apretar el boton.
     - El arrastre guardaba una referencia de Paper al owner. applyTextCurve
       REEMPLAZA el owner (saca el viejo y mete el nuevo), asi que desde el
       segundo frame la referencia estaba desconectada de la escena y el arrastre
       no continuaba. Verificado: owner_en_escena = false tras 5 frames.
     - applyTextCurve es async (una pasada de OpenType por glifo) y el arrastre lo
       llamaba en cada evento: docenas de reconstrucciones encimadas y el texto se
       atrasaba respecto del puntero.

   La solucion es NO guardar el owner. Durante el arrastre manda el VALOR de la
   curvatura y el owner se resuelve SIEMPRE desde la seleccion actual, que es la
   unica referencia que sobrevive porque applyTextCurve la publica. Ademas se
   coalesce a una reconstruccion por frame.
   ========================================================================= */

/** Radio del arco, en unidades de lienzo, que corresponde a una curvatura. */
export function curvatureToRadius(curvature) {
    const c = Math.abs(Number(curvature) || 0);
    if (c < 0.001) return Infinity;
    return 10000 / c;
}

function bendHandleLayer() {
    return paper.project.layers?.find(layer => layer.data?.isOverlayLayer) || paper.project.activeLayer;
}

/**
 * Crea el tirador para el owner dado.
 *
 * El tirador es OVERLAY: vive en la capa de overlays y nunca es hijo del texto,
 * para no contaminar los bounds, el hit-test ni el export.
 */
export function drawBlueCurveHandle(group) {
    removeCurveHandle();
    if (!group || !group.bounds) return null;

    const bounds = group.bounds;
    /* Radio FIJO EN PROYECTO: el punto escala con el zoom (al acercar se agranda,
       al alejar se achica), como el resto de la geometria. Pedido del cliente:
       con tamano fijo en pantalla el punto quedaba desproporcionado respecto
       del texto al hacer zoom. */
    const radio = 7;
    const separacion = 20;
    const handle = new paper.Path.Circle({
        center: new paper.Point(bounds.center.x, bounds.bottom + separacion),
        radius: radio,
        fillColor: '#00d2ff',
        strokeColor: '#007bff',
        strokeWidth: 1.5
    });
    handle.data = {
        isCurveHandle: true,
        isHandle: true,
        isBendHandle: true,
        curveOwnerId: group.id
    };
    bendHandleLayer().addChild(handle);
    handle.bringToFront();
    if (typeof window !== 'undefined') window._ekkoCurveHandle = handle;
    return handle;
}

/**
 * Deja el tirador como corresponde: si hay texto seleccionado el punto esta; si
 * no, no esta.
 *
 * Se llama en cada cambio de seleccion. Antes el punto solo aparecia sobre texto
 * ya curvado, y el gesto de LightBurn (agarrar el punto y arrastrar) no existia.
 */
export function syncCurveHandle() {
    /* Id obsoleto: el owner salio de escena sin pasar por aplanar (borrado,
       deshacer, vectorizado). Sin esta limpieza el modo quedaria apuntando a
       un id muerto. */
    if (typeof window !== 'undefined' && window._ekkoCurveModeOwnerId != null) {
        let vivo = null;
        try { vivo = paper.project.getItem({ id: window._ekkoCurveModeOwnerId }); } catch (_) {}
        if (!vivo || !vivo.project) window._ekkoCurveModeOwnerId = null;
    }
    const raw = window.selectedItem ||
        (Array.isArray(window.selectedItems) && window.selectedItems.length
            ? window.selectedItems[window.selectedItems.length - 1]
            : null);
    const owner = raw?.data?.clipGroup ? (getPublicOwner(raw) || raw) : raw;
    if (!isTextOwner(owner)) {
        removeCurveHandle();
        return null;
    }
    /* El punto existe SOLO dentro del modo curva (ver MODO CURVA arriba).
       Ni en texto recto sin modo, ni al re-seleccionar sin haber apretado el
       boton. */
    if (!isCurveMode(owner)) {
        removeCurveHandle();
        return null;
    }
    /* ORDEN IMPORTANTE: primero el tirador, despues las guias.
       drawBlueCurveHandle() arranca con removeCurveHandle(), y ese tambien
       borra las guias (comparten ciclo de vida). Al revés, las guias se
       creaban y se eliminaban en el mismo frame y nunca se veian
       (medido: _ekkoCurveGuides vacio con el punto azul dibujado). */
    const handle = drawBlueCurveHandle(owner);
    drawCurveGuides(owner);
    return handle;
}

/** Devuelve el owner si el punto agarra el tirador; null si no. */
export function bendHitTest(point) {
    const handle = window._ekkoCurveHandle;
    if (!handle?.project || !point) return null;
    const owner = paper.project.getItem({ id: handle.data.curveOwnerId });
    if (!owner) return null;
    /* El radio se lee de los BOUNDS, no de handle.radius.
       MEDIDO: paper.Path.Circle no guarda `radius` como propiedad (el circulo
       son 4 segmentos), asi que handle.radius es undefined. Con el undefined la
       tolerancia salia NaN y hitTest devolvia null SIEMPRE: el punto azul se
       veia pero era imposible de agarrar con el mouse. Los bounds no dependen de
       como se haya construido la figura. */
    const radio = (Number(handle.bounds?.width) || 12) / 2;
    const tolerance = Math.max(14 / paper.view.zoom, radio * 2.2);
    const hit = handle.hitTest(point, { fill: true, stroke: true, tolerance });
    return hit ? owner : null;
}

/* =========================================================================
   MODO CURVA
   ---------------------------------------------------------------------------
   El punto azul y las guias existen SOLO dentro del modo curva, que se entra
   con el boton "Curvar Texto". El boton NUNCA modifica la geometria: con texto
   recto entra al modo y el texto sigue recto (angulo 0, guias rectas de
   referencia); con texto ya curvado entra al modo con los valores actuales.
   El segundo clic sale del modo conservando la curva. Aplanar es doble clic en
   el punto o angulo 0: eso tambien sale del modo.

   Sin modo no hay punto, y sin punto no hay gesto indefinido: antes el punto
   aparecia sobre texto recto y arrastrarlo empezaba una curva que nadie pidio.
   ========================================================================= */

/** Activa el modo curva para el owner dado. No toca la geometria. */
export function enterCurveMode(owner) {
    let o = owner || window.selectedItem ||
        (Array.isArray(window.selectedItems) && window.selectedItems.length
            ? window.selectedItems[window.selectedItems.length - 1] : null);
    /* En productos con mockup la seleccion es el wrapper de contencion, no el
       texto: se resuelve el owner publico, que es el que lleva el id del modo
       y el que dibuja el punto. */
    if (o?.data?.clipGroup) o = getPublicOwner(o) || o;
    if (!isTextOwner(o)) return false;
    /* Sin saveHistory a proposito: entrar al modo no cambia geometria, y un
       paso de historial sin cambios haria que Ctrl+Z pareciera no hacer nada. */
    if (typeof window !== 'undefined') window._ekkoCurveModeOwnerId = o.id;
    syncCurveHandle();
    syncBendInputs();
    window.updateSelectionBox?.(window.selectedItem || o);
    window.updateContextualMenu?.(window.selectedItem || o);
    if (typeof paper !== "undefined") paper.view?.update?.();
    return true;
}

/** Sale del modo curva conservando la geometria tal cual esta. */
export function exitCurveMode() {
    if (typeof window !== 'undefined') window._ekkoCurveModeOwnerId = null;
    removeCurveHandle();
    if (typeof paper !== "undefined") paper.view?.update?.();
}

/** true si el modo curva esta activo para ese owner. */
export function isCurveMode(owner) {
    if (typeof window === 'undefined') return false;
    const id = window._ekkoCurveModeOwnerId;
    if (id == null || !owner) return false;
    const o = owner.data?.clipGroup ? (getPublicOwner(owner) || owner) : owner;
    return o.id === id;
}

/** El modo sigue al owner cuando una reconstruccion lo reemplaza. */
function transferCurveMode(oldOwner, newOwner) {
    if (typeof window === 'undefined') return;
    if (window._ekkoCurveModeOwnerId != null && oldOwner &&
        window._ekkoCurveModeOwnerId === oldOwner.id && newOwner) {
        window._ekkoCurveModeOwnerId = newOwner.id;
    }
}

let bendState = null;
let bendPending = null;
let bendFrame = null;

const BEND_MAX = 359;
const BEND_SENS_MIN_ANCHO = 90; // textos mas chicos que esto usan esta base (evita tirador imposible de afinar)

/**
 * Comienza el arrastre. NO guarda el owner a proposito: se resuelve en cada
 * frame desde la seleccion, que es lo unico que sobrevive a la reconstruccion.
 */
export function beginBend(point) {
    let owner = window.selectedItem;
    if (owner?.data?.clipGroup) owner = getPublicOwner(owner) || owner;
    if (!isTextOwner(owner)) {
        /* Fallback: el modo curva recuerda a que owner pertenece el tirador.
           Si la seleccion se perdio (p.ej. quedo en una letra interna), igual
           se puede arrancar el arrastre en vez de cortar la interaccion. */
        const modoId = window._ekkoCurveModeOwnerId;
        if (modoId != null) {
            const layer = paper.project.layers?.find(l => l.name === "designLayer") || paper.project.activeLayer;
            const candidato = layer?.children?.find?.(c => c.id === modoId);
            if (candidato && isTextOwner(candidato)) {
                window.selectItem?.(candidato);
                owner = candidato;
            }
        }
    }
    if (!isTextOwner(owner)) return false;
    const curvaturaInicial = Number(owner.data?.curvature) || 0;
    const ancho = Number(owner.bounds?.width) || 0;
    bendState = {
        inicioY: point.y,
        inicioX: point.x,
        ultimoX: point.x,
        ultimoY: point.y,
        curvaturaInicial,
        // Sensibilidad RELATIVA al texto: arrastrar el ancho completo = 180°.
        // Asi un texto de 10mm y uno de 100mm se sienten igual.
        sens: 180 / Math.max(ancho, BEND_SENS_MIN_ANCHO),
        // El signo lo fija la PRIMERA direccion del arrastre cuando el texto
        // arranca recto. Antes se usaba `|| 20`, que inventaba una curvatura
        // inicial: desde texto plano, arrastrar hacia abajo no producia nada
        // util porque el signo ya venia fijado en positivo.
        movido: false
    };
    window.dragging = false;
    window._mouseDragOccurred = true;
    return true;
}

/** Mueve el ancla del arco siguiendo al dedo (solo vertical, 1:1 en proyecto).
 *  El punto medio del texto baja/sube con el tirador en vez de quedar clavado.
 *  El delta se mapea con la parte LINEAL de la matriz (sin traslacion): mapear
 *  con la matriz completa sumaba cientos de unidades por frame y el texto
 *  teleportaba (medido: -1681px en 6 frames). */
function moverAncla(owner, dyProyecto) {
    if (!owner || !dyProyecto) return;
    const d = owner.data?.bendAnchorLocal;
    if (!Array.isArray(d) || d.length !== 2) return;
    try {
        const m = owner.matrix;
        let dx = 0, dy = dyProyecto;
        if (m) {
            const det = m.a * m.d - m.b * m.c;
            if (Math.abs(det) > 1e-9) {
                dx = (m.d * 0 - m.c * dyProyecto) / det;
                dy = (-m.b * 0 + m.a * dyProyecto) / det;
            }
        }
        const a = new paper.Point(d[0], d[1]).add(new paper.Point(dx, dy));
        owner.data = { ...(owner.data || {}), bendAnchorLocal: [a.x, a.y] };
    } catch (_) {}
}

/* Carril SERIALIZADO de operaciones geometricas de texto, GLOBAL.
   MEDIDO: 6 applyTextCurve concurrentes dejaban 6 grupos huerfanos en escena
   (el "texto duplicado"): cada rebuild eliminaba al anterior... que ya no
   estaba, asi que el remove() no eliminaba nada y todos quedaban vivos.
   Y vectorizar mientras un rebuild volaba dejaba el vector sin seleccion.
   Aca hay maximo UN trabajo en vuelo y una COLA en orden (no se pierde nada:
   cada pedido resuelve su promesa). Las curvas se coalescen (solo el ultimo
   valor); la soldadura siempre corre (es final). */
let curvaEnVuelo = null;
const curvaCola = [];

function bombearCarril() {
    if (curvaEnVuelo) return;
    const trabajo = curvaCola.shift();
    if (!trabajo) return;
    /* Si el item quedo sin padre (un rebuild anterior lo reemplazo mientras
       este pedido esperaba), se redirige a la seleccion viva en vez de
       descartar: si no, un slider movido rapido terminaba en un valor viejo
       porque los pedidos intermedios caian sobre objetos muertos. Solo si hay
       seleccion en escena; si no, se descarta sin ruido. No aplica a soldadura:
       vectorizar un objeto muerto no tiene sentido. */
    if (!trabajo.soldar && !trabajo.item?.parent) {
        const sel = window.selectedItem;
        if (!sel?.parent) return;
        trabajo.item = sel;
    }
    curvaEnVuelo = Promise.resolve()
        .then(() => trabajo.soldar
            ? weldTextRun(trabajo.item)
            : applyTextCurveRun(trabajo.item, trabajo.curvatura, trabajo.opciones))
        .catch(() => null)
        .then((salida) => {
            trabajo.espera.forEach((resolver) => { try { resolver(salida); } catch (_) {} });
            curvaEnVuelo = null;
            if (curvaCola.length) bombearCarril();
        });
}

function carrilVacio() {
    return (curvaEnVuelo || Promise.resolve()).then(() => {
        if (curvaCola.length) return carrilVacio();
        return null;
    });
}

/* (Eliminada la bomba anterior: el carril global bombearCarril la reemplaza.
   Quedaba como codigo muerto que referenciaba bendFlying, ya borrado.) */

/** Traduce la posicion del puntero a curvatura objetivo. */
export function updateBend(point) {
    if (!bendState) return false;
    const deltaY = point.y - bendState.inicioY;
    const deltaX = point.x - bendState.inicioX;
    const distancia = Math.sqrt(deltaY * deltaY + deltaX * deltaX);
    if (distancia > 1) bendState.movido = true;

    /* Angulo CONTINUO desde el desplazamiento neto: bajar el dedo (deltaY>0,
       Y crece hacia abajo) resta angulo (convexo), subirlo lo suma (concavo).
       Asi el signo siempre coincide con el lado donde esta el dedo, incluso si
       cruza al otro lado a mitad del arrastre o si ajusta una curva existente.
       Antes el signo se fijaba una vez y un cruce de lado daba el arco al reves. */
    const angulo = Math.max(-BEND_MAX, Math.min(BEND_MAX,
        bendState.curvaturaInicial - deltaY * bendState.sens));
    // seguirY: lo que se movio el dedo desde el ultimo evento (1:1).
    const seguirY = point.y - bendState.ultimoY;
    bendState.ultimoX = point.x;
    bendState.ultimoY = point.y;
    bendPending = { valor: angulo, seguirY };

    /* El carril global (ver bombearCarril) serializa los rebuilds: por mas
       rapido que lleguen los eventos, nunca hay dos reconstrucciones
       superpuestas (eso dejaba grupos duplicados). Aca solo se coalesce a un
       pedido por frame. */
    if (bendFrame) return true;
    bendFrame = requestAnimationFrame(() => {
        bendFrame = null;
        const trabajo = bendPending;
        bendPending = null;
        if (!trabajo) return;
        const owner = window.selectedItem;
        if (!isTextOwner(owner)) return;
        if (trabajo.seguirY) moverAncla(owner, trabajo.seguirY);
        Promise.resolve(applyTextCurve(owner, trabajo.valor, { skipHistory: true }))
            .then(() => {
                syncCurveHandle();
                syncBendInputs();
                paper.view.update();
            })
            .catch(() => null);
    });
    return true;
}

/** Cierra el arrastre y deja un solo paso de historial. */
export function endBend() {
    if (bendFrame) {
        cancelAnimationFrame(bendFrame);
        bendFrame = null;
    }
    if (!bendState && !bendPending && !curvaEnVuelo) return false;
    const movido = bendState ? bendState.movido : true;
    // El ultimo estado pedido SI se aplica: si no, el texto quedaria un frame
    // atras del dedo al soltar.
    const ultimo = bendPending;
    bendState = null;
    bendPending = null;
    window._ekkoCurveDrag = null;
    ocultarPopupBend();
    const cerrar = () => {
        if (movido && typeof window.saveHistory === 'function') window.saveHistory();
        syncCurveHandle();
        syncBendInputs();
        window.updateSelectionBox?.(window.selectedItem);
        window.updateContextualMenu?.(window.selectedItem);
        paper.view.update();
    };
    if (ultimo) {
        const owner = window.selectedItem;
        if (isTextOwner(owner)) {
            if (ultimo.seguirY) moverAncla(owner, ultimo.seguirY);
            // Por el carril normal: se encola ultimo y corre en orden.
            curvaCola.push({ item: owner, curvatura: ultimo.valor,
                opciones: { skipHistory: true }, espera: [] });
            bombearCarril();
        }
    }
    carrilVacio().then(cerrar);
    return movido;
}

/* ---------------------------------------------------------------------------
   LECTURA DE ANGULO EN VIVO: lienzo + barra + panel.
   Mientras se curva, el cliente ve cuantos grados lleva en tres lados a la vez:
   un popup junto al tirador (como el de rotacion), el slider y los campos de
   ambas barras. Sin esto curva a ciegas.
   --------------------------------------------------------------------------- */

function popupBend() {
    if (typeof document === "undefined") return null;
    let p = document.getElementById("ekkoBendPopup");
    if (p && p.isConnected) return p;
    p = document.createElement("div");
    p.id = "ekkoBendPopup";
    p.setAttribute("aria-live", "polite");
    p.style.cssText = [
        "position:fixed", "z-index:10000", "display:none",
        "padding:4px 10px", "border-radius:6px",
        "background:#263747", "color:#fff", "font:600 13px sans-serif",
        "pointer-events:none", "white-space:nowrap"
    ].join(";");
    document.body.appendChild(p);
    return p;
}

/** Muestra el angulo junto al tirador. Resalta multiplos de 45° como Rotar. */
export function mostrarPopupBend(grados) {
    const p = popupBend();
    if (!p) return;
    const g = Math.round(Number(grados) || 0);
    p.textContent = `${g}°`;
    const esSnap = Math.abs(((g % 45) + 45) % 45) < 1e-6;
    p.style.background = esSnap ? "#168447" : "#263747";
    const h = typeof window !== "undefined" ? window._ekkoCurveHandle : null;
    try {
        if (h?.bounds) {
            const v = paper.view.projectToView(h.bounds.center);
            const r = paper.view.element.getBoundingClientRect();
            p.style.left = `${Math.round(r.left + v.x + 16)}px`;
            p.style.top = `${Math.round(r.top + v.y - 14)}px`;
        }
    } catch (_) {}
    p.style.display = "block";
}

export function ocultarPopupBend() {
    const p = typeof document !== "undefined" ? document.getElementById("ekkoBendPopup") : null;
    if (p) p.style.display = "none";
}

/** Escribe el angulo en el slider y en ambas barras + popup. */
export function syncBendInputs(angulo) {
    let g = Number(angulo);
    if (!Number.isFinite(g)) {
        const sel = window.selectedItem;
        const o = sel?.data?.clipGroup && typeof getPublicOwner === "function"
            ? (getPublicOwner(sel) || sel) : sel;
        g = Number(o?.data?.curvature) || 0;
    }
    g = Math.max(-359, Math.min(359, Math.round(g)));
    const slider = document.querySelector('#ctxTextCurvature input[type=range]');
    if (slider && document.activeElement !== slider) slider.value = String(g);
    ["ctxBendAngleVal", "objBendAngleVal"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = `${g}°`;
    });
    // Radio derivado (mismo que guarda el owner): para que la barra muestre
    // valores coherentes con lo que se ve.
    try {
        const sel = window.selectedItem;
        const o = sel?.data?.clipGroup && typeof getPublicOwner === "function"
            ? (getPublicOwner(sel) || sel) : sel;
        const L = Number(o?.data?.bendLength) || 0;
        const t = Math.abs(g) * (Math.PI / 180);
        const r = t > 1e-6 && L > 0 ? Math.round(L / t) : 0;
        ["ctxCurveRadius", "objCurveRadius"].forEach(id => {
            const el = document.getElementById(id);
            /* Con angulo 0 no hay radio: se VACIA en vez de dejar el valor viejo
               (mostrar "76" con "0°" es incoherente). */
            if (el && document.activeElement !== el) el.value = r > 0 ? String(r) : "";
        });
    } catch (_) {}
    if (isBending()) mostrarPopupBend(g);
}

/** Doble clic en el tirador: el texto vuelve a recto. Es lo que hace LightBurn. */
export function clearBend() {
    const owner = window.selectedItem;
    if (!isTextOwner(owner)) return false;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    /* Aplanar sale del modo (ver rama de aplanado en applyTextCurve). */
    exitCurveMode();
    window.applyTextCurve?.(owner, 0, { skipHistory: true });
    syncCurveHandle();
    syncBendInputs(0);
    window.updateSelectionBox?.(window.selectedItem);
    window.updateContextualMenu?.(window.selectedItem);
    paper.view.update();
    return true;
}

export function isBending() {
    return !!bendState;
}

export function applyTextSpacing(item, hspace) {
    const owner = resolveTextTarget(item);
    if (!owner) return;
    const valor = Number(hspace) || 0;

    /* ESPACIADO CERO ES SIN ESPACIADO.

       Antes, con un clic en "Espaciado" sin escribir nada, se armaba igual un
       grupo con un PointText por letra, solo que pegados. El texto se veia
       exactamente igual, pero dejaba de ser un unico PointText: a partir de ahi
       Bold, Fuente y Tamano tenian que pasar por la reconstruccion, y el
       hit-test y el export tomaban otro camino. Convertir sin motivo es peor
       que no hacer nada. */
    if (valor === 0) {
        if (isGroupedText(owner)) {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            rebuildEKKOTextOwner(owner, { hspace: 0 });
        } else {
            owner.data = { ...(owner.data || {}), hspace: 0 };
        }
        paper.view.update();
        return;
    }

    if (typeof window.saveHistory === 'function') window.saveHistory();

    /* Un owner agrupado (curvado o espaciado) se reconstruye SIEMPRE desde el
       string, nunca letra por letra. Antes cada caso hacia su propio camino: el
       curvado re-curvaba en el sitio y el espaciado se aplanaba a mano, dos
       rutas que podian discordar. rebuildEKKOTextOwner conserva la curvatura
       que ya tuviera, asi que cambiar el espaciado de un texto curvado lo
       mantiene curvado. */
    if (isGroupedText(owner)) {
        rebuildEKKOTextOwner(owner, { hspace: valor });
        paper.view.update();
        return;
    }
    if (!(owner instanceof paper.PointText)) {
        paper.view.update();
        return;
    }

    const target = owner;
    {
        target.data = target.data || {};
        target.data.hspace = valor;
        const content = target.content;
        const fontSize = target.fontSize;
        const fontFamily = target.fontFamily;
        const fillColor = target.fillColor;
        const fontWeight = target.fontWeight;
        const fontStyle = target.fontStyle;

        const spacedGroup = new paper.Group();
        spacedGroup.data = {
            ...target.data,
            isSpacedGroup: true,
            textString: content,
            fontSize: fontSize,
            fontFamily: fontFamily,
            fillColor: fillColor,
            fontWeight: fontWeight,
            fontStyle: fontStyle,
            hspace: hspace
        };

        let currentX = target.bounds.left;
        const y = target.point.y;

        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            const charText = new paper.PointText({
                point: new paper.Point(currentX, y),
                content: char,
                fontSize: fontSize,
                fontFamily: fontFamily,
                fillColor: fillColor,
                fontWeight: fontWeight,
                fontStyle: fontStyle
            });
            spacedGroup.addChild(charText);
            currentX += charText.bounds.width + (hspace * fontSize * 0.02);
        }

        const parent = target.parent;
        if (parent) {
            const index = parent.children.indexOf(target);
            parent.insertChild(index, spacedGroup);
        }
        target.remove();

        if (window.selectedItem === item || window.selectedItem === target) {
            /* Ver la nota de applyTextCurve: la lista va explicita. Pasar
               window.selectedItems dejaba la seleccion apuntando al PointText
               recien eliminado. */
            /* Modo antes del commit (mismo motivo que en applyTextCurve). */
            transferCurveMode(target, spacedGroup);
            window.commitSelection?.(spacedGroup, [spacedGroup]);
            window.updateSelectionBox(spacedGroup);
        }
    }
    paper.view.update();
}

/**
 * Devuelve la lista REAL de contornos de un owner de texto vectorizado.
 *
 * Un CompoundPath se abre: de el salen sus Paths hijos, que son los lazos. Un
 * Group se recorre: sus hijos pueden ser CompoundPath (un glifo) y se abren
 * tambien. Sin esto, el clasificador de huecos recibe una letra por lazo y no ve
 * los contadores internos de A, O, P, R, B ni D.
 */
function flattenGlyphContours(node, out = []) {
    if (!node) return out;
    /* Las guias de curvado (eje del tirador y linea base arqueada) son overlay:
       NO son contornos de glifo. Sin este filtro, al vectorizar un texto curvo
       la linea superpuesta al texto se clasificaba como si fuera un agujero. */
    if (node.data && (node.data.isBendGuide || node.data.isHandle)) return out;
    if (node.className === "CompoundPath") {
        Array.from(node.children || []).forEach(child => flattenGlyphContours(child, out));
        return out;
    }
    if (node.className === "Path") {
        out.push(node);
        return out;
    }
    Array.from(node.children || []).forEach(child => flattenGlyphContours(child, out));
    return out;
}

function findTextTarget(item) {
    const owner = getPublicOwner(item);
    if (!owner || isMockupOrMask(owner)) return null;
    if (owner instanceof paper.PointText || owner.data?.isCurvedGroup || owner.data?.isSpacedGroup) return owner;
    if (owner.children) {
        for (const child of owner.children) {
            const publicChild = getPublicOwner(child);
            if (publicChild && publicChild !== owner && !isMockupOrMask(publicChild)) {
                const found = findTextTarget(publicChild);
                if (found) return found;
            }
        }
    }
    return null;
}

/* weldText por el carril: vectorizar mientras un rebuild vuela corrompia la
   seleccion (el vector quedaba huerfano de seleccion). El carril distingue el
   tipo de trabajo: curva o soldadura. */
export function weldText(item) {
    return new Promise((resolver) => {
        curvaCola.push({ soldar: true, item, espera: [resolver] });
        bombearCarril();
    });
}

async function weldTextRun(item) {
    const describe = (value) => value ? {
        className: value.className || value.constructor?.name || null,
        id: value.id ?? null,
        label: value.data?.label ?? null,
        clipGroup: !!value.data?.clipGroup,
        isTextVector: !!value.data?.isTextVector,
        isCurvedGroup: !!value.data?.isCurvedGroup,
        isSpacedGroup: !!value.data?.isSpacedGroup,
        parentClass: value.parent?.className || value.parent?.constructor?.name || null
    } : null;
    const diag = window._ekkoTextVectorDiag = {
        phase: "weldText:start",
        item: describe(item),
        selectedItem: describe(window.selectedItem),
        selectedItems: Array.isArray(window.selectedItems) ? window.selectedItems.map(describe) : [],
        target: null,
        fontFamily: null,
        resolution: null,
        acceptedTarget: false,
        convertedClass: null,
        resultClass: null,
        returnValue: null,
        geometry: null
    };
    if (!item || item.data?.locked) {
        diag.phase = "weldText:rejected-item";
        diag.returnValue = null;
        return null;
    }
    if (typeof window.saveHistory === 'function') window.saveHistory();

    let target = findTextTarget(item);
    if (!target && item && (item.data?.isCurvedGroup || item.data?.isSpacedGroup)) target = item;
    diag.target = describe(target);
    diag.fontFamily = target?.fontFamily || null;
    diag.acceptedTarget = !!(target && (
        target instanceof paper.PointText ||
        target.data?.isCurvedGroup ||
        target.data?.isSpacedGroup
    ));

    if (!diag.acceptedTarget) {
        diag.phase = "weldText:rejected-target";
        diag.returnValue = null;
        return null;
    }

    const pathGroup = target.clone({ insert: false });
    // Paper.js no ofrece contornos para PointText. La ruta OpenType genera
    // CompoundPath real y conserva los contornos internos de los glifos.
    let converted = null;
    let referenceBounds = null;
    try {
        if (target instanceof paper.PointText && document.fonts?.load) {
            try {
                await document.fonts.load(`${Number(target.fontSize) || 42}px "${target.fontFamily}"`, target.content || "");
                paper.view.update();
                // Referencia visual después de cargar la familia real.
                referenceBounds = target.bounds.clone();
            } catch (fontError) {
                // La geometría vectorial se genera con OpenType y no debe
                // fallar solamente porque la fuente CSS todavía no terminó de
                // cargar o no está disponible para el renderer del navegador.
                diag.fontLoadWarning = String(fontError?.message || fontError);
            }
        }

        converted = target instanceof paper.PointText
            ? await textToCompoundPath(target)
            : pathGroup;
    } catch (error) {
        diag.phase = "weldText:font-load-failed";
        diag.error = String(error?.message || error);
        try { pathGroup.remove(); } catch (e) {}
        diag.returnValue = null;
        return null;
    }
    diag.resolution = window._ekkoFontResolution || null;
    diag.phase = "weldText:converted";
    diag.convertedClass = converted?.className || converted?.constructor?.name || null;
    /* Las guias de curvado (eje, linea base, linea de radio) son OVERLAY de
       edicion: viven como hijas del grupo curvado pero NO son geometria. Si
       viajan al resultado, la normalizacion de estilo de mas abajo (fillRule +
       fill negro + stroke null sobre el grupo, que Paper propaga a los hijos)
       repinta la guia abierta del arco: un path abierto con fill se cierra
       implicito y rellena la region de la cuerda. MEDIDO: un disco negro solido
       bajo el texto, que ademas contaminaba bounds, hit-test y export.
       El exportador ya las purga por isHandle; aca se hace lo mismo. */
    if (converted && converted.children) {
        Array.from(converted.children).forEach(child => {
            if (child?.data?.isBendGuide === true) {
                try { child.remove(); } catch (_) {}
            }
        });
    }
    const usable = converted?.children?.length
        ? Array.from(converted.children).filter(Boolean)
        : (converted ? [converted] : []);
    if (!usable.length) {
        diag.phase = "weldText:no-usable-geometry";
        try { pathGroup.remove(); } catch (e) {}
        try { converted?.remove?.(); } catch (e) {}
        diag.returnValue = null;
        return null;
    }

    // Nunca unir los subtrazados del CompoundPath: unite() convierte los
    // contornos internos de A/O/P/R en sólidos y rellena sus huecos.
    // La topología evenodd del CompoundPath es la autoridad geométrica.
    const resultPath = converted.clone({ insert: false });
    resultPath.fillRule = "evenodd";
    resultPath.fillColor = target.fillColor || new paper.Color(0);
    resultPath.strokeColor = null;
    resultPath.strokeWidth = 0;
    // geomBase is the canonical hit-test/CSG geometry. It must be captured
    // only after the final world calibration below; taking it before scale /
    // translation leaves pointer selection and the visible owner divergent.

    const parent = target.parent;
    if (parent) {
        const index = parent.children.indexOf(target);
        parent.insertChild(index, resultPath);
        // PointText's transform belongs to the public owner. Apply it once to
        // the new owner; fontToPath intentionally returned identity-local data.
        if (target.matrix && resultPath.matrix) resultPath.matrix = target.matrix.clone();
    }

    // Calibración final contra la geometría visual del PointText. Esto evita
    // que una matriz del clipGroup, un fallback previo o las métricas de un
    // glifo en mayúscula/minúscula reduzcan la selección al vectorizar.
    const beforeNormalize = resultPath.bounds.clone();
    if (referenceBounds && beforeNormalize.width > 0 && beforeNormalize.height > 0) {
        const sx = referenceBounds.width / beforeNormalize.width;
        const sy = referenceBounds.height / beforeNormalize.height;
        // Paper.js interpreta position/translate de forma local al parent.
        // Convertir directamente a position global desplaza el texto cuando
        // el owner vive dentro de clipGroup. Escalamos y luego trasladamos con
        // delta global convertido al sistema local del parent.
        resultPath.scale(sx, sy);
        const globalDelta = referenceBounds.center.subtract(resultPath.bounds.center);
        const ownerParent = resultPath.parent;
        if (ownerParent?.globalToLocal && resultPath.localToGlobal) {
            const globalOrigin = resultPath.localToGlobal(new paper.Point(0, 0));
            const globalMoved = globalOrigin.add(globalDelta);
            const localOrigin = ownerParent.globalToLocal(globalOrigin);
            const localMoved = ownerParent.globalToLocal(globalMoved);
            resultPath.translate(localMoved.subtract(localOrigin));
        } else {
            resultPath.translate(globalDelta);
        }
        diag.geometry = {
            reference: { width: referenceBounds.width, height: referenceBounds.height, center: referenceBounds.center },
            before: { width: beforeNormalize.width, height: beforeNormalize.height },
            after: { width: resultPath.bounds.width, height: resultPath.bounds.height },
            scale: { x: sx, y: sy }
        };
    }
    // Snapshot the calibrated geometry in the same local space as the public
    // owner.  Cloning now preserves rotation/scale/position for frame and
    // hit-test consumers; the snapshot itself is intentionally identity-local.
    const calibratedBase = resultPath.clone({ insert: false });
    calibratedBase.fillRule = "evenodd";
    const baseMatrix = calibratedBase.matrix?.clone?.();
    calibratedBase.applyMatrix = false;
    calibratedBase.matrix = new paper.Matrix();
    if (baseMatrix && !baseMatrix.isIdentity()) calibratedBase.transform(baseMatrix);
    calibratedBase.applyMatrix = false;
    calibratedBase.matrix = new paper.Matrix();
    resultPath.data.geomBase = calibratedBase;
    resultPath.data.fillRule = "evenodd";
    // Never infer "all contours after index zero are holes". That fallback
    // turns the outer contour of the second glyph in OO into a false hole.
    /* LA LISTA DE CONTORNOS SE APLANA UN NIVEL.

       buildContourRelations trabaja con CONTORNOS: cada path que le pasan es
       un lazo, y decide si es solido o hueco comparandolo con los demás por
       contencion y area.

       Para texto plano el owner vectorizado es un CompoundPath cuyos hijos ya
       son los contornos, asi que children sirve. Para texto CURVO el owner es
       un grupo de CompoundPath, uno por glifo, y cada glifo es un lazo con su
       propio relleno. Si se le pasa esa lista, el clasificador ve "la letra R"
       como un unico contorno sin huecos: nada lo contiene, da profundidad 0, y
       TODOS salen como solido. MEDIDO: "PRUEBA" curvado devolvia 0 huecos, y P
       y R llegaban al laser como manchas llenas.

       Por eso la lista se aplana: de cada CompoundPath salen sus hijos Path, que
       si son los contornos reales. El glifo exterior y su contador quedan como
       dos lazos, y el contador cae dentro del exterior por contencion, que es
       exactamente como se clasifica el texto plano. */
    const contourPaths = flattenGlyphContours(resultPath);
    let contourRecords = Array.isArray(converted.data?.contours)
        ? converted.data.contours.map((record, index) => ({ ...record, contourIndex: record.contourIndex ?? index }))
        : null;
    if (!contourRecords?.length && contourPaths.length) {
        const classified = buildContourRelations(contourPaths, { fillRule: "evenodd" });
        contourRecords = classified.nodes.map(node => {
            const record = {
                ...node.contourRecord,
                contourIndex: node.index,
                contourDepth: node.depth,
                originalIsHole: node.isHole,
                contourRole: node.isHole ? "hole" : "outer",
                fillRule: "evenodd"
            };
            applyContourRecord(node.path, record);
            setSemanticKind(node.path, node.isHole ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID);
            return record;
        });
    }
    if (!contourRecords?.length) {
        diag.phase = "weldText:missing-contour-semantics";
        try { resultPath.remove(); } catch (_) {}
        try { converted.remove(); } catch (_) {}
        try { pathGroup.remove(); } catch (_) {}
        diag.returnValue = null;
        return null;
    }
    resultPath.data.contours = contourRecords;
    // La identidad semántica se estampa después de calibrar la geometría y
    // antes de publicarla. Nunca se publica un vector a medio registrar.
    setSemanticKind(resultPath, VECTOR_KIND.SOLID);
    stampDesignItem(resultPath, {
        source: "text-vector",
        role: "letter",
        isTextVector: true,
        isFusionReceptor: true,
        hasInternalHoles: true
    });
    
    
    resultPath.data = { ...(resultPath.data || {}), source: "text-vector", role: "letter",
        isTextVector: true, isFusionReceptor: true, hasInternalHoles: true,
        fillRule: "evenodd", geomBase: resultPath.data.geomBase };
    /* Un vector es geometria FINAL, no texto editable: se borran las marcas de
       texto curvado/espaciado que venian por el spread del clon.
       MEDIDO: al vectorizar un texto curvo, el resultado conservaba
       isCurvedGroup:true. Con eso el motor de capacidades lo clasificaba como
       TEXT (ofrecia herramientas de texto sobre un vector), el tirador se
       dibujaba sobre el vector, y "Curvar Texto" lo reemplazaba por texto
       regenerado via restoreFlatText, destruyendo el vector (y con el,
       cualquier edicion de nodos que tuviera). data.textString SI se conserva:
       es metadata del origen, no una orden. */
    delete resultPath.data.isCurvedGroup;
    delete resultPath.data.isSpacedGroup;
    delete resultPath.data.curvature;
    delete resultPath.data.radius;
    delete resultPath.data.hspace;
    delete resultPath.data.bendAngle;
    delete resultPath.data.bendRadius;
    delete resultPath.data.bendSign;
    delete resultPath.data.bendLength;
    delete resultPath.data.bendAnchorLocal;
    delete resultPath.data.bendAnchorParent;
    delete resultPath.data.rotateLetters;

    // Si el PointText original vivía dentro de un wrapper de contención,
    // actualizar el owner público antes de eliminar el objeto original.
    const containmentWrapper = target.parent?.data?.clipGroup === true
        ? target.parent
        : null;

    if (containmentWrapper) {
        resultPath.data = {
            ...(resultPath.data || {}),
            publicOwner: true,
            ownerId: resultPath.id
        };

        containmentWrapper.data = {
            ...(containmentWrapper.data || {}),
            publicOwner: resultPath,
            publicOwnerId: resultPath.id,
            transformOwnerId: resultPath.id
        };
    }


    
    target.remove();
    try { converted.remove(); } catch (e) {}
    try { pathGroup.remove(); } catch (e) {}

    // La conversión fue invocada sobre la selección pública; siempre debe
    // publicar el nuevo vector, aunque el target sea un hijo de clipGroup.
    if (typeof window.selectItem === "function") {
        window.selectItem(resultPath);
        // La selección central puede resolver wrappers históricos. El owner
        // recién creado es el CompoundPath y debe quedar publicado como tal.
        if (window.selectedItem !== resultPath && typeof window.commitSelection === "function") {
            window.commitSelection(resultPath, [resultPath]);
            window.updateContextualMenu?.(resultPath);
        }
    } else {
        window.commitSelection?.(resultPath, [resultPath]);
    }
    window.updateSelectionBox?.(resultPath);
    window.refreshEKKOSharedCommands?.();
    diag.phase = "weldText:success";
    diag.resultClass = resultPath.className || resultPath.constructor?.name || null;
    diag.returnValue = describe(resultPath);
    paper.view.update();
    return resultPath;
}

/**
 * Texto -> vector. weldText carga la fuente antes de convertir, asi que el
 * resultado es una PROMESA: quien necesite el owner nuevo (por ejemplo
 * Contorno, que recien vectoriza y despues engrosa) debe esperar el retorno.
 * La firma async lo declara; antes mongooseaba un Promise y los llamadores
 * que usan el valor de retorno creian estar trabajando con un objeto Paper.
 */
export async function convertTextToVector(item = null) {
    const selected = item || window.selectedItem ||
        (Array.isArray(window.selectedItems) ? window.selectedItems[window.selectedItems.length - 1] : null);
    window._ekkoTextVectorDispatch = {
        selected: selected ? {
            className: selected.className || selected.constructor?.name || null,
            label: selected.data?.label ?? null,
            clipGroup: !!selected.data?.clipGroup,
            childCount: selected.children?.length ?? 0
        } : null,
        at: Date.now()
    };
    return weldText(selected);
}

export function toggleBold(item) {
    const owner = resolveTextTarget(item);
    if (!owner) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    const current = (owner.className === "PointText" ? owner.fontWeight : owner.data?.fontWeight) || "normal";
    setFontAttribute(owner, "fontWeight", current === "bold" ? "normal" : "bold");
}

export function toggleItalic(item) {
    const owner = resolveTextTarget(item);
    if (!owner) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();
    const current = (owner.className === "PointText" ? owner.fontStyle : owner.data?.fontStyle) || "normal";
    setFontAttribute(owner, "fontStyle", current === "italic" ? "normal" : "italic");
}

export function toggleUnderline(item) {
    /* Un grupo YA subrayado se quita antes de resolver el texto de adentro.
       Si se buscara primero el PointText hijo, el comando volveria a subrayar
       POR DENTRO en vez de sacar el subrayado de afuera, y cada pulsacion
       anidaba un grupo nuevo. El orden importa: primero se pregunta si ya esta
       subrayado, despues se resuelve el texto. */
    const owner = getPublicOwner(item) || item;
    if (!owner || owner.data?.locked) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const target = (owner instanceof paper.Group && owner.data?.isUnderlinedGroup)
        ? owner
        : resolveTextTarget(owner);
    if (!target) return;

    /* Subrayar un owner agrupado (curvado o espaciado) obligaria a recalcular
       la linea cada vez que cambiaran la fuente, el cuerpo o el espaciado, y el
       grupo quedaria a medias: una linea vieja apuntando a una geometria que ya
       no existe. Se avisa en vez de construir eso. Es el unico caso que
       rebuildEKKOTextOwner no sabe deshacer. */
    if (isGroupedText(target)) {
        notice("El subrayado no se aplica a texto curvado ni espaciado.", { kind: "warn" });
        return;
    }

    if (target instanceof paper.Group && target.data?.isUnderlinedGroup) {
        const line = target.children.find(c => c.data?.isUnderlineLine);
        const originalText = target.children.find(c => c !== line);
        if (originalText && line) {
            const parent = target.parent;
            const index = parent.children.indexOf(target);
            parent.insertChild(index, originalText);
            line.remove();
            target.remove();
            if (window.selectedItem === item || window.selectedItem === target) {
                window.commitSelection?.(originalText, [originalText]);
                window.updateSelectionBox(originalText);
            }
        }
    } else {
        /* La linea del subrayado es GEOMETRIA, no un trazo.

           Antes era un Path.Line con strokeWidth 2 / paper.view.zoom. Eso hacia
           dos cosas malas a la vez: el grosor cambiaba cada vez que el cliente
           hacia zoom, de modo que el SVG grabado no era determinista; y en el
           laser un trazo es una linea de corte, no un subrayado grabado. El
           grosor ademas era FIJO en 2 unidades, asi que un texto de 12 y otro
           de 200 salian con el mismo rayado.

           Ahora es un rectangulo relleno, con grosor y separacion
           proporcionales al cuerpo. Su Y se apoya en bounds.bottom, que en
           Paper.js ya incluye las colas de g j p q y, asi que la linea queda
           debajo del texto mas bajo: que es lo que se espera de un subrayado. */
        const bounds = target.bounds;
        const size = textFontSize(target) || 42;
        const grosor = Math.max(0.4, size * 0.055);
        const separacion = size * 0.12;
        const top = bounds.bottom + separacion * 0.25;
        const underlineLine = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(bounds.left, top, bounds.width, grosor),
            fillColor: target.fillColor || target.strokeColor || new paper.Color(0),
            strokeColor: null,
            strokeWidth: 0
        });
        underlineLine.data = { isUnderlineLine: true, isUnderlineGeometry: true };

        const group = new paper.Group();
        group.data = { ...target.data, isUnderlinedGroup: true };
        const parent = target.parent;
        if (parent) {
            const index = parent.children.indexOf(target);
            parent.insertChild(index, group);
        }
        group.addChild(target);
        group.addChild(underlineLine);

        if (window.selectedItem === item || window.selectedItem === target) {
            window.commitSelection?.(group, [group]);
            window.updateSelectionBox(group);
        }
    }
    paper.view.update();
}
