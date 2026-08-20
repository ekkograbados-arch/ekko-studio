/* =========================================================================
   Módulo: ASSETS/js/config.js
   Descripción: Configuración unificada de contactos, redes sociales y monetización.
   DISEÑO ANTICRASH: No utiliza la palabra clave 'export' para evitar que el
   navegador aborte la carga de la página si se incluye mediante una etiqueta
   <script> estándar en el archivo index.html.
   ========================================================================= */

window.EKKO_CONFIG = {
    // Datos de Contacto Oficiales de Grabados EKKO
    contacto: {
        whatsapp: "5492804719686", // Número de WhatsApp con código de país para enlaces directos
        whatsappLink: "https://wa.me/5492804719686",
        instagram: "https://www.instagram.com/grabados_ekko/",
        facebook: "https://www.facebook.com/profile.php?id=61581674110806",
        tiendaNube: "https://ekkograbados.mitiendanube.com/",
        googleDrive: "https://drive.google.com/drive/folders/1Bt0BAnpn3WCMd9mUCAMnc5Bdg6DxJHqK?usp=sharing",
        youtube: "https://www.youtube.com/@EKKOGRABADOS/playlists",
        email: "contacto@grabadosekko.com" // Casilla de correo comercial
    },
    
    // Contenedores vacíos reservados para anuncios de Google AdSense en el futuro
    monetizacion: {
        enableAds: false, // Cambiar a true cuando se active la cuenta de AdSense
        adsensePublisherId: "ca-pub-XXXXXXXXXXXXXXXX", // Reemplazar con tu ID real de AdSense
        adsenseSlotSidebar: "1234567890", // Bloque de anuncio lateral izquierdo
        adsenseSlotFooter: "0987654321",  // Bloque de anuncio en el pie de página
    },

    // Parámetros de Seguridad, Exportación y Llave de Taller
    seguridad: {
        watermarkText: "PROPUESTA DE DISEÑO - GRABADOS EKKO",
        watermarkColor: "rgba(128, 128, 128, 0.15)", // Marca de agua ultra fina para LightBurn
        adminKey: "ekko2026", // Tu clave administrativa local
        rasterDPI: 300 // DPI para la imagen rasterizada unificada del grabado seguro
    }
};
