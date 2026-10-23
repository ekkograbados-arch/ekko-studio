/* ============================================================
   EXPERIENCIA DE ENTRADA UNIFICADA (rueda, teclado, sync)

   UNA SOLA REGLA PARA TODOS LOS CONTROLES NUMERICOS, en el panel
   superior o en cualquiera de las barras emergentes:

   - RUEDA DEL MOUSE sobre un campo numerico o sobre una barra
     deslizante: modifica el valor. Rueda arriba = mas, abajo = menos.
   - MUESCA = el paso del campo redondeado a ENTERO (max(paso, 1)),
     para que cada muesca se VEA en el numero (un paso de 0.01mm
     no se ve y el cliente cree que no anda).
   - SHIFT + rueda = muesca x 10 (saltos grandes).
   - ALT + rueda = paso fino (una decima de la muesca; en campos mm
     usa el paso crudo del campo, por ejemplo 0.01).
   - Rango respetado: nunca la rueda pasa el min o el max del campo.
   - ESPEJO: si el campo tiene una barra deslizante emparejada (o la
     barra tiene campo), el otro control se queda SIEMPRE con el
     mismo valor, pase lo que pase (rueda, tecleo o flechas).
   - TECLEO y FLECHAS nativas siguen vivos; este modulo solo espeja
     el valor al par y se asegura que el motor escuche (input en
     vivo + change despues de una rafaga, con debounce).
   - FLECHAS DEL TECLADO sobre campos de texto numericos (los que no
     tienen flechas nativas del navegador) tambien modifican.
   - PageUp/PageDown = muesca x 10 en el campo enfocado.

   Cero acoplamiento con el motor: este modulo no sabe que es un
  	tamano de fuente o un espaciado; solo edita el valor del control
   y despacha eventos como si el usuario lo hubiera hecho a mano.
   ============================================================ */

const SELECTOR_USABLE = 'input[type=number], input[type=range], input.toolbar-input-number';

function numeroDe(valorCrudo) {
    if (typeof valorCrudo !== 'string') return NaN;
    return Number(valorCrudo.replace(',', '.'));
}

/* La muesca de la rueda: el paso del campo, redondeado a entero y
   nunca menor a 1 (la muesca se ve en el numero). */
function muescaDe(campo) {
    const paso = Math.abs(numeroDe(campo.step) || 1);
    return Math.max(1, Math.ceil(paso - 0.0001));
}

/* Paso fino (ALT): una decima de la muesca; si el campo trae paso
   decimal propio (mm con 0.01) se usa el crudo del campo. */
function pasoFinoDe(campo) {
    const crudo = Math.abs(numeroDe(campo.step) || 0);
    if (crudo > 0 && crudo < 1) return crudo;
    return Math.max(0.1, Math.round((muescaDe(campo) / 10) * 100) / 100);
}

/* Verifica que el campo declare min/max reales. */
function limitesDe(campo) {
    const min = campo.min !== '' && Number.isFinite(numeroDe(campo.min)) ? numeroDe(campo.min) : -Infinity;
    const max = campo.max !== '' && Number.isFinite(numeroDe(campo.max)) ? numeroDe(campo.max) : Infinity;
    return { min, max };
}

/* El elemento emparejado: la barra de un campo numerico o el campo
   numerico de una barra. Convencion de la app: el contenedor de una
   barra lleva la id DEL CAMPO + "Slider" (ctxTextSpacing +
   ctxTextSpacingSlider). Espejo deterministico por id: si el
   contenedor no lleva ese formato, no se espeja (nada que hacer).
   El eclecticismo sin regla agarraba CAMPO EQUIVOCADO del mismo
   grupo y ensucia la experiencia con valores cruzados. */
function parDe(campo) {
    if (campo.type === 'range') {
        let cont = campo.closest('[id$="Slider"]');
        while (cont && typeof cont.id === 'string' && cont.id.length > 'Slider'.length) {
            const candidato = document.getElementById(cont.id.slice(0, -'Slider'.length));
            if (candidato && candidato !== campo && (candidato.type === 'number' || candidato.type === 'text' || (candidato.className || '').indexOf('toolbar-input-number') >= 0)) {
                return candidato;
            }
            cont = cont.parentElement ? cont.parentElement.closest('[id$="Slider"]') : null;
        }
        return null;
    }
    if (campo.id) {
        const cont = document.getElementById(campo.id + 'Slider');
        if (cont) {
            const rango = cont.querySelector('input[type=range]');
            if (rango && rango !== campo) return rango;
        }
    }
    return null;
}

/* Aplica un valor nuevo al campo: acota al rango, muestra el valor,
   menciona al motor (input en vivo) y cierra la rafaga con change
   (debounce 250ms, para que el historial no se llene por tick). */
function aplicarValor(campo, valorSiguiente) {
    const li = limitesDe(campo);
    let v = Math.min(li.max, Math.max(li.min, valorSiguiente));
    if (!Number.isFinite(v)) return;
    v = Math.round(v * 100) / 100;   /* ruido de flotantes fuera */
    campo.value = String(v);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    if (campo.__ekkoCierre) clearTimeout(campo.__ekkoCierre);
    campo.__ekkoCierre = setTimeout(() => {
        try { campo.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    }, 250);
    espejarPar(campo);
}

/* Espeja el valor al control emparejado, con guarda anti-bucle: el
   espejo recibe el valor con una bandera, asi el listener de entrada
   no vuelve a espejar al que empezÃ³. */
function espejarPar(origen) {
    const espejo = parDe(origen);
    if (!espejo) return;
    try {
        espejo.__ekkoEspejo = true;
        espejo.value = origen.value;
        espejo.dispatchEvent(new Event('input', { bubbles: true }));
        if (espejo.__ekkoCierre) clearTimeout(espejo.__ekkoCierre);
        espejo.__ekkoCierre = setTimeout(() => {
            try { espejo.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        }, 250);
    } catch (_) {}
}

/* ==== RUEDA SOBRE CAMPOS Y BARRAS (delegado global) ============
   passive:false solo aqui para poder frenar el scroll de pagina
   mientras se usa la rueda sobre un control. */
document.addEventListener('wheel', function (e) {
    const campo = e.target;
    if (!(campo instanceof HTMLElement)) return;
    if (!campo.matches(SELECTOR_USABLE)) return;
    const dir = e.deltaY < 0 ? 1 : (e.deltaY > 0 ? -1 : 0);
    if (!dir) return;
    e.preventDefault();
    const actual = numeroDe(campo.value) || 0;
    let paso;
    if (e.shiftKey) paso = muescaDe(campo) * 10;
    else if (e.altKey) paso = pasoFinoDe(campo);
    else paso = muescaDe(campo);
    aplicarValor(campo, actual + dir * paso);
}, { passive: false });

/* ==== ESPEJO EN CALIENTE (tecleo, flechas nativas, drag) =========
   Cualquier 'input' real de un control numerico o barra queda
   replicado en su par; el drag de la barra tambien llega aca. */
document.addEventListener('input', function (e) {
    const campo = e.target;
    if (!(campo instanceof HTMLElement)) return;
    if (!campo.matches(SELECTOR_USABLE)) return;
    if (campo.__ekkoEspejo) { campo.__ekkoEspejo = false; return; }
    espejarPar(campo);
}, true);

/* ==== FLECHAS DEL TECLADO =======================================
   En type=number y range son nativas; en los campos de texto
   numericos (ctxRotation entra aca) las sumamos nosotros. En todos
   los casos el 'input' que dispara el navegador ya llega al espejo
   de arriba, asi flechas = misma experiencia que la rueda. */
document.addEventListener('keydown', function (e) {
    const campo = e.target;
    if (!(campo instanceof HTMLElement)) return;
    if (!campo.matches(SELECTOR_USABLE)) return;
    const actual = numeroDe(campo.value) || 0;
    let paso = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (campo.type === 'number' || campo.type === 'range') return; /* nativo */
        paso = e.shiftKey ? muescaDe(campo) * 10 : (e.altKey ? pasoFinoDe(campo) : muescaDe(campo));
        if (e.key === 'ArrowDown') paso = -paso;
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        paso = (e.key === 'PageUp' ? 1 : -1) * muescaDe(campo) * 10;
    } else {
        return;
    }
    e.preventDefault();
    aplicarValor(campo, actual + paso);
});

/* Sello de version de la experiencia de entrada. Si en la consola no
   coincide con el paquete entregado, es codigo viejo (cache). */
window.EKKO_INPUT_BUILD = "20261022-experiencia-entrada";
/* UN SOLO DUEÑO DE LA RUEDA: esta bandera apaga el receptor viejo de
   contextualMenu.js (permanece registrado pero sale de inmediato), para
   que los saltos no se acumulen con reglas distintas. */
window.EKKO_INPUT_HANDLES_WHEEL = true;
