/* =========================================================================
   EKKO STUDIO — MODO DE INTERFAZ (claro/oscuro) · PIEL ESPACIAL

   Rol: único dueño del atributo data-modo de <body> y del botón 🌓.
   NO escribe style.display en ningún botón (eso es del renderer de la
   cinta). Solo presentación: clase de tema + persistencia local.

   Contrato:
   · El botón NO lleva data-fusion-btn: el renderer/manifiesto no lo
     gobierna y nunca lo oculta.
   · Arranque SIEMPRE en modo claro (v2.9): la primera impresión es la
     del lock screen luminoso, en cada visita. El modo elegido con el
     botón vive solo mientras dura la página (no se persiste).
   ========================================================================= */

(function() {
    'use strict';

    const CLAVE = 'ekko-modo-interfaz-v2';
    const BOTON_ID = 'btnModoTema';

    // El SVG va inline para heredar currentColor del chip y no depender
    // de fuentes de emoji (que renderizan a color imposible de teñir).
    const ICONO_LUNA  = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M21 14.2A9.2 9.2 0 0 1 9.8 3 9.2 9.2 0 1 0 21 14.2Z"/></svg>';
    const ICONO_SOL   = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="4.4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></g></svg>';

    function aplicar(modo) {
        document.body.dataset.modo = modo;
        const btn = document.getElementById(BOTON_ID);
        if (btn) {
            btn.innerHTML = (modo === 'oscuro') ? ICONO_SOL : ICONO_LUNA;
            btn.title = (modo === 'oscuro') ? 'Pasar a modo claro' : 'Pasar a modo oscuro';
            btn.setAttribute('aria-pressed', modo === 'oscuro' ? 'true' : 'false');
        }
    }

    function alternar() {
        const nuevo = document.body.dataset.modo === 'oscuro' ? 'claro' : 'oscuro';
        aplicar(nuevo);                 // el modo no se persiste: vive la sesión
    }

    function crearBoton() {
        if (document.getElementById(BOTON_ID)) return;
        const base = document.getElementById('topPanelControls');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = BOTON_ID;
        btn.className = 'panel-icon-btn';           // vestido por ekko-espacio.css
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Cambiar modo claro/oscuro');
        btn.addEventListener('click', alternar);
        // En la cola de la tira de pestañas (derecha del label): su familia
        // natural. NO data-fusion-btn: el renderer no lo toca.
        const surface = document.getElementById('ekkoTopContextSurface');
        if (surface) surface.appendChild(btn);
        else if (base) base.appendChild(btn);          // red de seguridad
        else document.body.appendChild(btn);
    }

    function arrancar() {
        crearBoton();                                       // primero el botón…
        try { localStorage.removeItem(CLAVE); } catch (e) { /* sin storage */ }
        aplicar('claro');                                   // …y SIEMPRE nace claro
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arrancar, { once: true });
    } else {
        arrancar();
    }
})();
