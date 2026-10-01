/* =========================================================================
   DIALOGO DEL CODIGO QR
   -------------------------------------------------------------------------
   Reemplaza al prompt del navegador, que para esto no servia: es una caja
   del sistema operativo, no avisa cuanto link se le puede recortar, no dice
   que plataforma es, y obliga a escribir a mano un link largo. Este dialogo
   vive en el estilo de la app, acepta el link pegado y muestra, mientras se
   escribe, quantos modulos va a necesitar y cuanto se le puede recortar.

   Lo que NO hace, y es importante decirlo: no inventa un formato "de nota de
   voz". Un QR lleva un texto. Lo que el celular haga despues depende del
   link. El dialogo informa que plataforma se va a abrir y, cuando el link es
   un chat de WhatsApp, aclara que abre el chat pero no reproduce audio. Es
   mejor que el cliente lo sepa antes de grabar que descubrirlo con el celular en
   la mano.
   ========================================================================= */
(function () {
    'use strict';

    let abierto = null;

    const ESTILO = `
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, .48);
        z-index: 2147483000;
        font: 400 14px/1.4 system-ui, "Segoe UI", sans-serif;
    `;

    function cerrar() {
        if (!abierto) return;
        abierto.remove();
        abierto = null;
        document.removeEventListener("keydown", alPulsarTecla, true);
    }

    function alPulsarTecla(evento) {
        if (!abierto) return;
        if (evento.key === 'Escape') { evento.preventDefault(); cerrar(); }
        if (evento.key === 'Enter' && !evento.shiftKey) {
            const enCampo = evento.target && evento.target.tagName === 'INPUT';
            if (enCampo) { evento.preventDefault(); confirmar(); }
        }
    }

    function confirmar() {
        if (!abierto) return;
        const valor = abierto.querySelector('.ekko-qr-campo').value.trim();
        const enviar = abierto.__alConfirmar;
        // Campo vacio: entra el link de la casa. Antes se mandaba vacio y
        // salia un QR sin contenido, que es lo peor que puede pasar: un
        // grabado que no lleva a ningun lado y no se nota hasta que lo leen.
        const usarPorDefecto = abierto.__porDefecto;
        cerrar();
        enviar?.(valor || usarPorDefecto);
    }

    /* El velo cierra con Escape y con el Enter manda a confirmar(). Se
       atienden en captura, antes de que el evento llegue al boton o al
       campo, y con stopImmediatePropagation para que ningun otro handler los
       atrase. Sin esto, el clic en "Crear QR" cerraba el dialogo desde el
       velo y el boton nunca llegaba a correr: el cliente apretaba y no pasaba
       nada, que es la falla mas dificil de ver. */
    function alPulsarTecla(evento) {
        if (!abierto) return;
        if (evento.key === 'Escape') {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            cerrar();
            return;
        }
        if (evento.key === 'Enter' && !evento.shiftKey) {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            confirmar();
        }
    }

    /**
     * Muestra el dialogo.
     * @param {object} opciones { porDefecto, alConfirmar }
     */
    window.abrirDialogoQr = function (opciones = {}) {
        cerrar();
        const alConfirmar = opciones.alConfirmar;
        const velo = document.createElement('div');
        velo.setAttribute('style', ESTILO);

        velo.innerHTML = `
            <div class="ekko-qr-caja" style="
                width: min(460px, 92vw);
                background: var(--ekko-panel-main, #ffffff);
                border: 1px solid var(--ekko-border, #cbd5e1);
                border-radius: 12px;
                box-shadow: 0 24px 60px rgba(15,23,42,.32);
                padding: 20px 20px 16px;
                color: var(--ekko-text-main, #0f172a);
            ">
                <div style="font-size: 15px; font-weight: 700; margin-bottom: 4px;">Codigo QR</div>
                <div style="font-size: 12.5px; color: var(--ekko-text-secondary, #64748b); margin-bottom: 14px;">
                    Pega el enlace que quieras dejar grabado. Mientras mas corto, mejor: cada caracter es un
                    modulo mas de ancho y el codigo se lee con mas margen.
                </div>
                <input class="ekko-qr-campo" type="url" spellcheck="false" autocomplete="off"
                    placeholder="${opciones.porDefecto || 'instagram.com/grabados_ekko'}"
                    style="width: 100%; box-sizing: border-box; padding: 9px 11px; font-size: 13.5px;
                        border: 1px solid var(--ekko-border, #cbd5e1); border-radius: 8px;
                        background: #fff; color: inherit; font-family: inherit;">
                <div class="ekko-qr-info" style="margin-top: 10px; font-size: 12px; line-height: 1.5;
                    min-height: 18px;"></div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                    <button type="button" class="ekko-qr-cancelar" style="
                        padding: 8px 14px; font: inherit; font-size: 13px; cursor: pointer;
                        border: 1px solid var(--ekko-border, #cbd5e1); border-radius: 8px;
                        background: transparent; color: inherit;">Cancelar</button>
                    <button type="button" class="ekko-qr-aceptar" style="
                        padding: 8px 16px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
                        border: none; border-radius: 8px; color: #fff;
                        background: var(--ekko-accent-main, #405d6d);">Crear QR</button>
                </div>
            </div>
        `;

        const campo = velo.querySelector('.ekko-qr-campo');
        const info = velo.querySelector('.ekko-qr-info');

        /* Mientras se escribe, se dice que plataforma es, cuanto se puede
           recortar y si el link abre un chat o reproduce audio. El cliente
           ve el efecto de pegar un link largo antes de confirmar. */
        const refrescar = () => {
            const bruto = campo.value.trim();
            if (!bruto) { info.textContent = ''; return; }
            const prep = window.EKKO_QR_LINK?.limpiarLink?.(bruto) || { texto: bruto, cambiado: false };
            const desc = window.EKKO_QR_LINK?.descriptorDeLink?.(prep.texto) || {};
            const partes = [];
            if (desc.plataforma) partes.push(`Plataforma: ${desc.plataforma}.`);
            if (desc.esChatConTexto) {
                partes.push('Abre el chat con el mensaje escrito, no reproduce audio. ' +
                    'Para que suene solo, el link debe apuntar al archivo de audio.');
            } else if (desc.reproduceAudio) {
                partes.push('El celular reproduce el audio al escanear.');
            }
            if (prep.cambiado) {
                partes.push(`Se quitan ${prep.economia} caracteres de rastreo: el QR queda mas chico.`);
            }
            info.innerHTML = partes.join(' ');
            info.style.color = desc.esChatConTexto ? '#b45309' : 'var(--ekko-text-secondary, #64748b)';
        };
        campo.addEventListener('input', refrescar);

        velo.querySelector('.ekko-qr-aceptar').addEventListener('click', confirmar);
        velo.querySelector('.ekko-qr-cancelar').addEventListener('click', cerrar);
        /* El velo solo cierra si el clic cae en el fondo oscurecido, nunca si
           nacio dentro de la caja. Antes cerraba con cualquier clic y se
           comia el del boton: el dialogo se cerraba sin hacer nada. Con
           currentTarget se mira el velo y con target el elemento real, asi
           que un clic en un campo o un boton no lo cierra. */
        velo.addEventListener('click', (ev) => {
            if (ev.target === velo && ev.currentTarget === velo) cerrar();
        });
        document.addEventListener('keydown', alPulsarTecla, true);

        // El callback se guarda ANTES de mostrar nada: si el cliente aprieta
        // Enter mientras el campo toma el foco, confirmar() ya lo encuentra.
        velo.__alConfirmar = alConfirmar;
        velo.__porDefecto = opciones.porDefecto || '';
        abierto = velo;
        document.body.appendChild(velo);
        velo.style.display = 'flex';
        // Sin valor por defecto: el cliente ve el link escrito y lo reemplaza
        // si quiere otra cosa. Si solo aprieta Crear, va el de la casa.
        campo.focus();
    };
})();
