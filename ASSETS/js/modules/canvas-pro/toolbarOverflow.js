/* =========================================================================
   MAS HERRAMIENTAS DE LA BARRA SUPERIOR
   -------------------------------------------------------------------------
   Cuando la fila de la barra superior no entra en la ventana, los ULTIMOS
   botones quedan fuera de alcance: se los ve cortados y no hay forma de
   apretarlos. No es que fallen, es que estan fuera de la vista.

   Aca se resuelve como en Word: lo que no entra se oculta de la fila y
   aparece en el menu "Mas herramientas" (el boton ...). Los botones siguen
   siendo los mismos objetos del DOM, no hay lista de acciones que pueda
   desincronizarse: el menu aprieta el boton real.

   LA MEDICION ES LA CLAVE. Se usa scrollWidth de la barra, que es la unica
   medida fiable: sumar los offsetWidth a mano miente, porque el padding de
   los .top-group y los margenes entre grupos no se accounted. Antes de
   decidir, se comparan las dos cosas: si con TODOS visibles la fila no
   desborda, no se oculta nada.
   ========================================================================= */
(function () {
    'use strict';

    const CLASE_OCULTO = 'ekko-overflowed';
    let menu = null;
    let guardados = [];
    let enCurso = false;
    let ultimaMedicion = 0;

    /**
     * Los observadores tambien ven los cambios de clase que hace ESTE
     * modulo. Sin este freno, medir -> cambiar -> medir -> cambiar seria un
     * bucle eterno. reacomodar es idempotente: con el mismo ancho siempre
     * deja lo mismo, asi que descartar lo que pasa enseguida no pierde nada.
     */
    function movido() { return Date.now() - ultimaMedicion < 600; }

    function barra() { return document.getElementById('topBar'); }
    function botonMas() { return document.getElementById('topPanelOverflow'); }

    /** Botones de la fila, en orden, tal como el motor los dejo. */
    function candidatos() {
        const b = barra();
        if (!b) return [];
        return Array.from(b.querySelectorAll('button.btn-action'))
            .filter(el => !el.closest('#topPanelControls'));
    }

    /** Enseña todo de nuevo y mide cuanto ocupa la fila completa. */
    function medirTodoVisible(botones) {
        const b = barra();
        if (!b) return 0;
        botones.forEach(el => el.classList.remove(CLASE_OCULTO));
        // Los grupos se esconderian con sus botones; hay que medirlos como
        // el cliente los ve, no como quedan en el DOM.
        b.scrollLeft = 0;
        return b.scrollWidth;
    }

    /**
     * Oculta, del final hacia el principio, lo que no entra. Se decide por
     * scrollWidth real: se va sacando de a uno hasta que la fila deja de
     * desbordar, en vez de estimar con numeros.
     */
    function reacomodar() {
        const b = barra();
        const mas = botonMas();
        if (!b || !mas || enCurso) return;
        const botones = candidatos();
        if (!botones.length) return;

        enCurso = true;
        try {
            // Que no haya ancho medido (la barra se acaba de montar o esta
            // escondida) daria disponible 0 y ocultaria todo, que es lo
            // contrario de lo que se quiere.
            if (!b.clientWidth) { programar(200); return; }

            // La pregunta es UNA: la fila desborda su propia caja? El bloque
            // de controles de paneles ya vive dentro de la barra (va con
            // margin-left:auto), asi que su ancho ya esta descontado: no hay
            // que restarlo otra vez o la fila parece desbordar siempre.
            const disponible = b.clientWidth;

            const total = medirTodoVisible(botones);
            b.scrollLeft = 0;

            // Todo entra: no se oculta nada y el menu no aparece.
            if (disponible <= 0 || total <= disponible) {
                mas.style.display = 'none';
                mas.title = 'Mas herramientas';
                guardados = [];
                cerrarMenu();
                return;
            }

            // Se van ocultando del final hacia el principio, uno por uno,
            // y se para en cuanto la fila entra. El ultimo en caer es el
            // primero que se ve recortado, que es justo el orden en que el
            // cliente los echa de menos.
            const sobrantes = [];
            for (let i = botones.length - 1; i >= 0; i--) {
                const el = botones[i];
                el.classList.add(CLASE_OCULTO);
                sobrantes.unshift(el);
                if (b.scrollWidth <= disponible) break;
            }

            b.scrollLeft = 0;
            // Se llego escondiendo hasta el PRIMERO y la fila sigue
            // desbordando: con la ventana tan angosta no caben ni las
            // herramientas ni los controles. Esconder todas las deja al
            // cliente con un menu de 29 botones y una fila vacia, que es peor
            // que la barra con su scroll horizontal. En ese caso se devuelven
            // todas a la fila.
            if (b.scrollWidth > disponible || sobrantes.length === botones.length) {
                botones.forEach(el => el.classList.remove(CLASE_OCULTO));
                mas.style.display = 'none';
                mas.title = 'Mas herramientas';
                guardados = [];
                cerrarMenu();
                return;
            }
            if (!sobrantes.length) {
                mas.style.display = 'none';
                mas.title = 'Mas herramientas';
                guardados = [];
                cerrarMenu();
                return;
            }
            mas.style.display = 'inline-flex';
            mas.title = 'Mas herramientas (' + sobrantes.length + ')';
            // El menu NO se abre aqui: se deja anotado que botones sobran y se
            // espera al clic. Si se abriera en cada medida, el menu estaria
            // siempre abierto y el primer clic del cliente solo serviria para
            // cerrarlo, que es justo lo que pasaba.
            guardados = sobrantes;
            cerrarMenu();
        } finally {
            enCurso = false;
            ultimaMedicion = Date.now();
        }
    }

    /** Menu con las herramientas que no entraron. */
    function construirMenu(ancla, sobrantes) {
        cerrarMenu();
        menu = document.createElement('div');
        menu.id = 'ekkoMasHerramientas';

        const titulo = document.createElement('div');
        titulo.className = 'ekko-mas-titulo';
        titulo.textContent = 'Mas herramientas';
        menu.appendChild(titulo);

        sobrantes.forEach((el) => {
            // Se clona solo el Aspecto. El original sigue escondido en la
            // fila, y al apretar se le avisa a EL: el motor, el historial y
            // la barra emergente escuchan al elemento real, no al clon.
            const clon = el.cloneNode(true);
            clon.classList.remove(CLASE_OCULTO);
            clon.style.display = 'flex';
            clon.style.width = '100%';
            clon.style.justifyContent = 'flex-start';
            clon.style.textAlign = 'left';
            clon.style.whiteSpace = 'nowrap';
            clon.addEventListener('click', (ev) => {
                ev.stopPropagation();
                el.click();
                cerrarMenu();
            });
            menu.appendChild(clon);
        });

        document.body.appendChild(menu);
        const r = ancla.getBoundingClientRect();
        const ancho = menu.offsetWidth || 232;
        const alto = menu.offsetHeight || 300;
        menu.style.left = Math.max(8, Math.min(window.innerWidth - ancho - 8, r.right - ancho)) + 'px';
        menu.style.top = Math.max(8, Math.min(window.innerHeight - alto - 8, r.bottom + 6)) + 'px';
    }

    function cerrarMenu() {
        if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
        menu = null;
    }

    /** Reintento espaciado, para cuando todavia no hay nada que medir. */
    let reintento = null;
    function programar(ms) {
        clearTimeout(reintento);
        reintento = setTimeout(reacomodar, ms);
    }

    function alternar(ancla) {
        if (menu) { cerrarMenu(); return; }
        const b = barra();
        const sobrantes = guardados && guardados.length
            ? guardados
            : Array.from(b ? b.querySelectorAll('.' + CLASE_OCULTO) : []);
        if (sobrantes.length) construirMenu(ancla, sobrantes);
    }

    function arrancar() {
        const mas = botonMas();
        if (!mas) { setTimeout(arrancar, 400); return; }

        // El clic se escucha por DELEGACION en el documento, no pegado al
        // boton. El coordinador de paneles vuelve a dibujar el bloque de
        // controles de paneles, y con el boton dentro: un listener pegado al
        // nodo viejo se queda escuchando a un elemento que ya no esta en la
        // pagina, y el menu no abre nunca. Delegando, da igual si el boton
        // se reemplaza.
        document.addEventListener('click', (ev) => {
            const ancla = ev.target && ev.target.closest && ev.target.closest('#topPanelOverflow');
            if (!ancla) return;
            // Ese mismo boton abre tambien el menu de paneles. Los dos
            // menus no caben a la vez. stopImmediatePropagation CORTA de
            // verdad: stopPropagation solo impide que el evento llegue a
            // otros elementos, pero los otros listeners del mismo boton se
            // ejecutarian igual y se abririan los dos menus superpuestos.
            ev.preventDefault();
            ev.stopImmediatePropagation();
            alternar(ancla);
        }, true);

        document.addEventListener('click', (ev) => {
            if (!menu) return;
            if (menu.contains(ev.target)) return;
            if (ev.target.closest && ev.target.closest('#topPanelOverflow')) return;
            cerrarMenu();
        });

        let pendiente = null;
        window.addEventListener('resize', () => {
            cerrarMenu();
            clearTimeout(pendiente);
            pendiente = setTimeout(reacomodar, 120);
        });

        // El ancho de la barra cambia por motivos que no son resize: se abre
        // o se esconde el panel lateral, el cliente maximiza, cambia la
        // escala. Por eso se vigila su tamano real en vez de esperarse al
        // evento de resize.
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => { if (movido()) return; clearTimeout(pendiente); pendiente = setTimeout(reacomodar, 90); })
                .observe(barra());
        }

        // El motor de capacidades habilita, deshabilita y esconde botones
        // segun lo que este seleccionado: cambia la fila sin cambiar la
        // ventana. Se avisa de eso con un observador, que es mas fiable que
        // adivinar que funcion refresca.
        if (typeof MutationObserver === 'function') {
            new MutationObserver(() => { if (movido()) return; clearTimeout(pendiente); pendiente = setTimeout(reacomodar, 90); })
                .observe(barra(), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled'] });
        }

        // El motor de capacidades cambia los botones segun la seleccion:
        // si eso mete o saca herramientas, hay que volver a medir.
        ['refreshEKKOSharedCommands', 'refreshAllToolbars', 'refreshSharedCommands'].forEach((n) => {
            if (typeof window[n] !== 'function') return;
            const previo = window[n];
            window[n] = function () {
                const r = previo.apply(this, arguments);
                reacomodar();
                return r;
            };
        });
        document.addEventListener('ekko:seleccion-cambio', () => reacomodar());

        reacomodar();
        console.log('%c[EKKO TOP] Herramientas que no entran, agrupadas en "mas".', 'color:#7c3aed;font-weight:bold;');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arrancar, { once: true });
    } else {
        arrancar();
    }
    window.EKKO_REACOMODAR_BARRA = reacomodar;
    // Gancho de prueba: permite abrir el menu sin pasar por el clic, para
    // distinguir si el boton no dispara o si el menu no se construye.
    window.EKKO_MAS_HERRAMIENTAS = { alternar, cerrar: cerrarMenu, arrancado: true };
})();
