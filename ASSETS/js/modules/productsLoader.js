/**
 * ASSETS/js/modules/productsLoader.js (Integración Frontend para Carga Dinámica - Corregido)
 * 
 * Reemplaza el array estático por una consulta dinámica asíncrona hacia /api/products
 * de Vercel. Si el backend está desconectado u opera localmente, se activa 
 * automáticamente un fallback robusto sobre el catálogo preexistente.
 */

// 1. Definición de Fallback de Resguardo (idéntico al catálogo estático productos.js original)
const CATALOGO_FALLBACK = [
  {
    categoria: "Medallas",
    productos: [
      { id: "medalla-militar-25x45", nombre: "Medalla Militar 25x45", svgBase: "ASSETS/mockups-medidas/medalla-militar-25x45.svg", superficies: [ { nombre: "Frente", svg: "ASSETS/mockups-medidas/medalla-militar-25x45.svg", area: "silueta" }, { nombre: "Dorso", svg: "ASSETS/mockups-medidas/medalla-militar-25x45.svg", area: "silueta" } ] },
      { id: "medalla-militar-29x50", nombre: "Medalla Militar 29x50", svgBase: "ASSETS/mockups-medidas/medalla-militar-29x50.svg", superficies: [ { nombre: "Frente", svg: "ASSETS/mockups-medidas/medalla-militar-29x50.svg", area: "silueta" }, { nombre: "Dorso", svg: "ASSETS/mockups-medidas/medalla-militar-29x50.svg", area: "silueta" } ] },
      { id: "medalla-redonda-25mm", nombre: "Medalla Redonda 25mm", svgBase: "ASSETS/mockups-medidas/medalla-redonda-25mm.svg", superficies: [ { nombre: "Frente", svg: "ASSETS/mockups-medidas/medalla-redonda-25mm.svg", area: "silueta" }, { nombre: "Dorso", svg: "ASSETS/mockups-medidas/medalla-redonda-25mm.svg", area: "silueta" } ] }
    ]
  },
  {
    categoria: "Chapitas",
    productos: [
      { id: "chapita-huesito-16x32", nombre: "Chapita Huesito 16x32", svgBase: "ASSETS/mockups-medidas/chapita-huesito-16x32.svg", superficies: [ { nombre: "Frente", svg: "ASSETS/mockups-medidas/chapita-huesito-16x32.svg", area: "silueta" }, { nombre: "Dorso", svg: "ASSETS/mockups-medidas/chapita-huesito-16x32.svg", area: "silueta" } ] },
      { id: "chapita-huesito-21x40", nombre: "Chapita Huesito 21x40", svgBase: "ASSETS/mockups-medidas/chapita-huesito-21x40.svg", superficies: [ { nombre: "Frente", svg: "ASSETS/mockups-medidas/chapita-huesito-21x40.svg", area: "silueta" }, { nombre: "Dorso", svg: "ASSETS/mockups-medidas/chapita-huesito-21x40.svg", area: "silueta" } ] }
    ]
  },
  {
    categoria: "Pulseras",
    productos: [
      { id: "pulsera-chica-5x30", nombre: "Pulsera Chica 5x30", svgBase: "ASSETS/mockups-medidas/pulsera-chica-5x30.svg", superficies: [ { nombre: "Frente", svg: "ASSETS/mockups-medidas/pulsera-chica-5x30.svg", area: "silueta" }, { nombre: "Dorso", svg: "ASSETS/mockups-medidas/pulsera-chica-5x30.svg", area: "silueta" } ] },
      { id: "pulsera-grande-6x35", nombre: "Pulsera Grande 6x35", svgBase: "ASSETS/mockups-medidas/pulsera-grande-6x35.svg", superficies: [ { nombre: "Frente", svg: "ASSETS/mockups-medidas/pulsera-grande-6x35.svg", area: "silueta" }, { nombre: "Dorso", svg: "ASSETS/mockups-medidas/pulsera-grande-6x35.svg", area: "silueta" } ] }
    ]
  },
  {
    categoria: "Mates",
    productos: [
      { id: "mate-acero", nombre: "Mate Acero", svgBase: "ASSETS/mockups-medidas/mate-acero.svg", superficies: [ { nombre: "Mate", svg: "ASSETS/mockups-medidas/mate-acero.svg", area: "rectangulo" } ] },
      { id: "mate-algarrobo-sin-virola", nombre: "Mate Algarrobo Sin Virola", svgBase: "ASSETS/mockups-medidas/mate-algarrobo-sin-virola.svg", superficies: [ { nombre: "Mate", svg: "ASSETS/mockups-medidas/mate-algarrobo-sin-virola.svg", area: "rectangulo" } ] },
      { id: "mate-algarrobo-con-virola", nombre: "Mate Algarrobo Con Virola", svgBase: "ASSETS/mockups-medidas/mate-de-algarrobo-con-virola.svg", superficies: [ { nombre: "Mate", svg: "ASSETS/mockups-medidas/mate-de-algarrobo-con-virola.svg", area: "rectangulo" }, { nombre: "Virola", svg: "ASSETS/mockups-medidas/virola-mate-de-algarrobo-con-virola.svg", area: "anillo" } ] }
    ]
  }
];

// Asignación inicial defensiva inmediata (sincronizada en el inicio de renderizado)
window.EKKO_STUDIO_PRODUCTS = CATALOGO_FALLBACK;

/**
 * Carga el catálogo dinámicamente desde el backend y refresca la barra lateral
 */
export async function loadDynamicProducts() {
    try {
        console.log("🔍 Consultando catálogo dinámico en Vercel...");
        const response = await fetch('/api/products');
        
        if (!response.ok) {
            throw new Error(`Código de estado HTTP: ${response.status}`);
        }
        
        const products = await response.json();
        
        // CORRECCIÓN DE PRECEDENCIA: Reemplaza !products.success === false por products.success !== false
        if (products && products.length > 0 && products.success !== false) {
            window.EKKO_STUDIO_PRODUCTS = products;
            console.log("🎒 Catálogo dinámico cargado y ordenado con éxito:", products);
            
            // Re-renderizar pestañas laterales si el editor ya cargó la UI
            if (typeof window.renderCategories === "function") {
                window.renderCategories();
            } else if (typeof renderCategories === "function") {
                renderCategories();
            }
        } else {
            console.warn("La API retornó un catálogo vacío o un formato de error. Usando fallback.");
        }
    } catch (err) {
        console.warn("La API /api/products no está disponible (modo offline o desarrollo local). Cargando catálogo estático de resguardo.", err);
    }
}
