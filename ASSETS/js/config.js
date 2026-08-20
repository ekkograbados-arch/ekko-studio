/* =========================================================================
   Módulo: ASSETS/js/config.js
   Descripción: Configuración unificada de contactos, redes sociales y monetización.
   ========================================================================= */

export const EKKO_CONFIG = {
    // Datos de Contacto Oficiales de Grabados EKKO
    contacto: {
        whatsapp: "5492804719686", // Número de WhatsApp con código de país
        whatsappLink: "https://wa.me/5492804719686",
        instagram: "https://www.instagram.com/grabados_ekko/",
        facebook: "https://www.facebook.com/profile.php?id=61581674110806",
        tiendaNube: "https://ekkograbados.mitiendanube.com/",
        googleDrive: "https://drive.google.com/drive/folders/1Bt0BAnpn3WCMd9mUCAMnc5Bdg6DxJHqK?usp=sharing",
        youtube: "https://www.youtube.com/@EKKOGRABADOS/playlists",
        email: "contacto@grabadosekko.com" // Correo comercial fallback
    },
    
    // Contenedores listos para propagandas de Google AdSense
    monetizacion: {
        enableAds: false, // Cambiar a true cuando tu cuenta de AdSense esté aprobada
        adsensePublisherId: "ca-pub-XXXXXXXXXXXXXXXX", // ID de editor de AdSense
        adsenseSlotSidebar: "1234567890", // ID de bloque lateral izquierdo
        adsenseSlotFooter: "0987654321",  // ID de bloque de pie de página
    },

    // Parámetros de Seguridad, Exportación y Llave Maestra
    seguridad: {
        watermarkText: "PROPUESTA DE DISEÑO - GRABADOS EKKO",
        watermarkColor: "rgba(128, 128, 128, 0.15)", // Marca de agua transparente
        adminKey: "ekko2026", // Tu contraseña maestra local para remover marcas de agua
        rasterDPI: 300 // Resolución HD para el grabado sin doble quemado
    }
};

window.EKKO_CONFIG = EKKO_CONFIG; // Exposición global para retrocompatibilidad
