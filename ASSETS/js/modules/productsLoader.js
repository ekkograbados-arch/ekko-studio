/*
 * ASSETS/js/modules/productsLoader.js (v2 - Frontend con Categorización Unificada y Fallbacks Sanitizados)
 *
 * Reemplaza el catálogo estático por una consulta dinámica asíncrona hacia /api/products de Vercel.
 * Agrupa los fallbacks en las Categorías Generales perfectas en orden alfabético.
 * SANITIZACIÓN ROBUSTA: Protege el sistema contra errores 404 forzando el prefijo "ASSETS/".
 */

// 1. Catálogo de Resguardo (Fallback) unificado con las nuevas Categorías Generales
const CATALOGO_FALLBACK = [
  {
    categoria: "Chapita Huesito",
    productos: [
      {
        id: "chapita-huesito-16x32",
        nombre: "Chapita Huesito 16x32",
        svgBase: "ASSETS/mockups-medidas/chapita-huesito-16x32.svg",
        superficies: [
          { nombre: "Frente", svg: "ASSETS/mockups-medidas/chapita-huesito-16x32.svg", area: "silueta" },
          { nombre: "Dorso", svg: "ASSETS/mockups-medidas/chapita-huesito-16x32.svg", area: "silueta" }
        ]
      },
      {
        id: "chapita-huesito-21x40",
        nombre: "Chapita Huesito 21x40",
        svgBase: "ASSETS/mockups-medidas/chapita-huesito-21x40.svg",
        superficies: [
          { nombre: "Frente", svg: "ASSETS/mockups-medidas/chapita-huesito-21x40.svg", area: "silueta" },
          { nombre: "Dorso", svg: "ASSETS/mockups-medidas/chapita-huesito-21x40.svg", area: "silueta" }
        ]
      }
    ]
  },
  {
    categoria: "Mate Acero",
    productos: [
      {
        id: "mate-acero",
        nombre: "Mate Acero",
        svgBase: "ASSETS/mockups-medidas/mate-acero.svg",
        superficies: [
          { nombre: "Mate", svg: "ASSETS/mockups-medidas/mate-acero.svg", area: "rectangulo" }
        ]
      }
    ]
  },
  {
    categoria: "Mate de Algarrobo",
    productos: [
      {
        id: "mate-algarrobo-con-virola",
        nombre: "Mate Algarrobo con Virola",
        svgBase: "ASSETS/mockups-medidas/mate-de-algarrobo-con-virola.svg",
        superficies: [
          { nombre: "Mate", svg: "ASSETS/mockups-medidas/mate-de-algarrobo-con-virola.svg", area: "rectangulo" },
          { nombre: "Virola", svg: "ASSETS/mockups-medidas/virola-mate-de-algarrobo-con-virola.svg", area: "anillo" }
        ]
      },
      {
        id: "mate-algarrobo-sin-virola",
        nombre: "Mate Algarrobo sin Virola",
        svgBase: "ASSETS/mockups-medidas/mate-algarrobo-sin-virola.svg",
        superficies: [
          { nombre: "Mate", svg: "ASSETS/mockups-medidas/mate-algarrobo-sin-virola.svg", area: "rectangulo" }
        ]
      }
    ]
  },
  {
    categoria: "Medalla Militar",
    productos: [
      {
        id: "medalla-militar-25x45",
        nombre: "Medalla Militar 25x45",
        svgBase: "ASSETS/mockups-medidas/medalla-militar-25x45.svg",
        superficies: [
          { nombre: "Frente", svg: "ASSETS/mockups-medidas/medalla-militar-25x45.svg", area: "silueta" },
          { nombre: "Dorso", svg: "ASSETS/mockups-medidas/medalla-militar-25x45.svg", area: "silueta" }
        ]
      },
      {
        id: "medalla-militar-29x50",
        nombre: "Medalla Militar 29x50",
        svgBase: "ASSETS/mockups-medidas/medalla-militar-29x50.svg",
        superficies: [
          { nombre: "Frente", svg: "ASSETS/mockups-medidas/medalla-militar-29x50.svg", area: "silueta" },
          { nombre: "Dorso", svg: "ASSETS/mockups-medidas/medalla-militar-29x50.svg", area: "silueta" }
        ]
      }
    ]
  },
  {
    categoria: "Medalla Redonda",
    productos: [
      {
        id: "medalla-redonda-25mm",
        nombre: "Medalla Redonda 25mm",
        svgBase: "ASSETS/mockups-medidas/medalla-redonda-25mm.svg",
        superficies: [
          { nombre: "Frente", svg: "ASSETS/mockups-medidas/medalla-redonda-25mm.svg", area: "silueta" },
          { nombre: "Dorso", svg: "ASSETS/mockups-medidas/medalla-redonda-25mm.svg", area: "silueta" }
        ]
      }
    ]
  },
  {
    categoria: "Pulseras",
    productos: [
      {
        id: "pulsera-chica-5x30",
        nombre: "Pulsera Chica 5x30",
        svgBase: "ASSETS/mockups-medidas/pulsera-chica-5x30.svg",
        superficies: [
          { nombre: "Frente", svg: "ASSETS/mockups-medidas/pulsera-chica-5x30.svg", area: "silueta" },
          { nombre: "Dorso", svg: "ASSETS/mockups-medidas/pulsera-chica-5x30.svg", area: "silueta" }
        ]
      },
      {
        id: "pulsera-grande-6x35",
        nombre: "Pulsera Grande 6x35",
        svgBase: "ASSETS/mockups-medidas/pulsera-grande-6x35.svg",
        superficies: [
          { nombre: "Frente", svg: "ASSETS/mockups-medidas/pulsera-grande-6x35.svg", area: "silueta" },
          { nombre: "Dorso", svg: "ASSETS/mockups-medidas/pulsera-grande-6x35.svg", area: "silueta" }
        ]
      }
    ]
  }
];

// Asignación defensiva inicial
window.EKKO_STUDIO_PRODUCTS = CATALOGO_FALLBACK;

/**
 * Sanitiza recursivamente las rutas de un catálogo asegurándose de que posean
 * el prefijo "ASSETS/". Esto previene errores de carga de mockups (404 Not Found)
 * cuando conviven definiciones relativas o formatos legados.
 */
function sanitizeCatalogPaths(catalog) {
  if (!Array.isArray(catalog)) return catalog;
  catalog.forEach(category => {
    if (category.productos && Array.isArray(category.productos)) {
      category.productos.forEach(prod => {
        if (prod.svgBase && !prod.svgBase.startsWith('ASSETS/')) {
          prod.svgBase = 'ASSETS/' + prod.svgBase;
        }
        if (prod.preview && !prod.preview.startsWith('ASSETS/')) {
          prod.preview = 'ASSETS/' + prod.preview;
        }
        if (prod.superficies && Array.isArray(prod.superficies)) {
          prod.superficies.forEach(surf => {
            if (surf.svg && !surf.svg.startsWith('ASSETS/')) {
              surf.svg = 'ASSETS/' + surf.svg;
            }
          });
        }
      });
    }
  });
  return catalog;
}

/**
 * Carga el catálogo dinámicamente desde el backend de Vercel.
 * Si tiene éxito, aplica sanitización de rutas preventiva y actualiza la variable global.
 * Si falla, mantiene el CATALOGO_FALLBACK.
 */
export async function loadDynamicProducts() {
  try {
    console.log("🔍 Consultando catálogo dinámico en Vercel (/api/products)...");
    const response = await fetch('/api/products');
    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0) {
        window.EKKO_STUDIO_PRODUCTS = sanitizeCatalogPaths(data);
        console.log("✅ Catálogo dinámico cargado y sanitizado con éxito desde la API:", window.EKKO_STUDIO_PRODUCTS);
      } else {
        console.warn("⚠️ La API de productos devolvió un catálogo vacío. Usando fallback de resguardo.");
        window.EKKO_STUDIO_PRODUCTS = sanitizeCatalogPaths(CATALOGO_FALLBACK);
      }
    } else {
      console.warn(`❌ Error en respuesta de API (/api/products): Código ${response.status}. Usando fallback.`);
      window.EKKO_STUDIO_PRODUCTS = sanitizeCatalogPaths(CATALOGO_FALLBACK);
    }
  } catch (err) {
    console.warn("La API /api/products no está disponible (modo offline o desarrollo local). Cargando catálogo estático de resguardo.", err);
    window.EKKO_STUDIO_PRODUCTS = sanitizeCatalogPaths(CATALOGO_FALLBACK);
  }
}
