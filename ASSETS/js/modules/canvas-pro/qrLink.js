/* =========================================================================
   PREPARACION DE LINKS PARA EL QR
   -------------------------------------------------------------------------
   Un QR codifica TEXTO, y cada caracter es un modulo mas de ancho. Un link
   largo no es un QR un poco mas grande: es un salto de version, que duplica
   la cantidad de modulos y deja el codigo sin margen para leerse.

   Medido con el link de Instagram de EKKO Studio, grabando a 4 mm:

     instagram.com/grabados_ekko          version 2   328 modulos   0.138 mm
     https://www.instagram.com/.../       version 3   431 modulos   0.121 mm
     api.whatsapp.com/send?phone=...      version 5   708 modulos   0.098 mm
     + parametros utm de tracking         version 5   674 modulos   0.098 mm

   El ultimo caso es el que duele: los links que se copian del boton de
   compartir de Instagram o de WhatsApp vienen con parametros de tracking que
   no cambian a donde lleva el link, solo sirven para medir. En 4 mm ese QR no
   se lee ni con zoom.

   Por eso se limpian antes de codificar. No se cambia a donde va el link: se
   le saca el lastre que no cambia el destino.

   LO QUE NO SE PUEDE HACER, y conviene tenerlo claro: no hay forma de que un
   QR "suene" como una nota de voz al escanear. El QR lleva un texto y lo
   que pase despues lo decide el celular. Un link wa.me abre WhatsApp pero
   no reproduce un audio. Lo unico confiable es que el link apunte al archivo
   de audio y el sistema lo toque solo. Esta funcion no promete otra cosa: si
   el link es de audio, lo reconoce y lo avisa para que el cliente sepa lo
   que va a pasar, pero no inventa un formato que despues no exista.
   ========================================================================= */

/* PARAMETROS QUE NO CAMBIAN A DONDE LLEVA EL LINK.
   Son de medicion: de donde vino el click, con que campana, desde que
   plataforma. Quitarlos deja el link igual de funcional. */
const PARAMETROS_DE_SEGUIMIENTO = new Set([
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid",
    "igshid", "igsh", "si", "ref", "ref_src", "ref_url", "source", "s",
    "_ga", "_gl", "mc_cid", "mc_eid", "mkt_tok", "trk", "trkCampaign"
]);

/* Como se abre cada plataforma, para que quede claro ante que va a caer el
   cliente. No cambia el link: solo sirve para avisar con precision. */
const PLATAFORMAS = [
    { nombre: "WhatsApp", probar: (u) => /(^|\.)(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)$/i.test(u.hostname) },
    { nombre: "Instagram", probar: (u) => /(^|\.)(instagram\.com)$/i.test(u.hostname) },
    { nombre: "Facebook", probar: (u) => /(^|\.)(facebook\.com|fb\.me|messenger\.com)$/i.test(u.hostname) },
    { nombre: "TikTok", probar: (u) => /(^|\.)(tiktok\.com|vm\.tiktok\.com)$/i.test(u.hostname) },
    { nombre: "Telegram", probar: (u) => /(^|\.)(t\.me|telegram\.me|telegram\.org)$/i.test(u.hostname) },
    { nombre: "YouTube", probar: (u) => /(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname) },
    { nombre: "Spotify", probar: (u) => /(^|\.)(spotify\.com|spoti\.fi)$/i.test(u.hostname) },
    { nombre: "Google Maps", probar: (u) => /(^|\.)(maps\.app\.goo\.gl|maps\.google\.[a-z.]+|goo\.gl\/maps)$/i.test(u.hostname) },
    { nombre: "Linktree", probar: (u) => /(^|\.)(linktr\.ee)$/i.test(u.hostname) },
    { nombre: "Beacons", probar: (u) => /(^|\.)(beacons\.ai)$/i.test(u.hostname) }
];

/* Extensiones de audio. Un link a uno de estos archivos si lo reproduce el
   celular; un link a una pagina de chat, no. */
const AUDIO_POR_EXTENSION = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|weba)(\?|#|$)/i;

/**
 * Dice que va a pasar cuando el cliente escanee este link.
 * Se usa para avisar con palabras, no para cambiar nada.
 */
function descriptorDeLink(url) {
    try {
        const u = new URL(url.includes("//") ? url : "https://" + url);
        const plataforma = PLATAFORMAS.find(p => p.probar(u));
        const esAudio = AUDIO_POR_EXTENSION.test(u.pathname + u.search);
        // wa.me con ?text= abre el chat con el mensaje escrito: es un mensaje
        // de texto, no una nota de voz. D distinguished para no prometer audio.
        const esWhatsAppTexto = plataforma?.nombre === "WhatsApp" && /[?&]text=/i.test(url);
        return {
            plataforma: plataforma?.nombre || null,
            esAudio,
            esChatConTexto: esWhatsAppTexto,
            reproduceAudio: esAudio || (plataforma?.nombre === "Telegram")
        };
    } catch (_) {
        return { plataforma: null, esAudio: false, esChatConTexto: false, reproduceAudio: false };
    }
}

/**
 * Limpia el link: quita lo que no cambia el destino.
 * NO toca el contenido: la ruta, el texto del mensaje o el id siguen igual.
 */
function limpiarLink(texto) {
    const crudo = String(texto || "").trim();
    if (!crudo) return { texto: crudo, cambiado: false };
    // Si no parece un link (un numero de WhatsApp, un texto suelto), no se
    // toca: el cliente puede estar codificando cualquier cosa.
    if (!/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(crudo)) {
        return { texto: crudo, cambiado: false, esLink: false };
    }
    try {
        const conEsquema = /^[a-z]+:\/\//i.test(crudo) ? crudo : "https://" + crudo;
        const u = new URL(conEsquema);

        // 1) Parametros de seguimiento y anclas de fragmentos.
        for (const clave of [...u.searchParams.keys()]) {
            if (PARAMETROS_DE_SEGUIMIENTO.has(clave.toLowerCase())) u.searchParams.delete(clave);
        }
        u.hash = "";

        // 2) La barra final no lleva a ningun lado.
        const ruta = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;

        // 3) Reensamblar sin https:// ni www. cuando no hacen falta: el
        //    celular abre las dos formas igual y cada prefijo son 8 y 4
        //    caracteres que el QR tiene que pagar.
        const sinWww = u.hostname.replace(/^www\./, "");
        let salida = sinWww + ruta;
        if (u.search) salida += "?" + u.searchParams.toString();

        return {
            texto: salida,
            original: crudo,
            cambiado: salida !== crudo,
            economia: crudo.length - salida.length,
            esLink: true
        };
    } catch (_) {
        return { texto: crudo, cambiado: false, esLink: true };
    }
}

if (typeof window !== "undefined") {
    window.EKKO_QR_LINK = { limpiarLink, descriptorDeLink, PARAMETROS_DE_SEGUIMIENTO, AUDIO_POR_EXTENSION };
}
