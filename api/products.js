/**
 * /api/products.js (Optimizado Dinámico v3 - Solución a Preemisión de Vistas y Normalización de Casos)
 *
 * Escanea dinámicamente el directorio "ASSETS/mockups-medidas/", agrupa los archivos SVG
 * por Categorías Generales sin repetir categorías por cada medida, subdivide los productos
 * por medidas/opciones y asigna las vistas correspondientes, asegurando que los archivos específicos
 * de vista (ej: "-frente", "-dorso", "-mate") sobreescriban y actualicen las vistas genéricas iniciales.
 */
const fs = require('fs');
const path = require('path');

// Mapeo estricto de prefijos de archivos a nombres de Categorías unificadas
const CATEGORY_MAPPING = [
  { prefix: 'chapita-huesito', name: 'Chapita Huesito' },
  { prefix: 'mate-acero', name: 'Mate Acero' },
  { prefix: 'mate-de-algarrobo', name: 'Mate de Algarrobo' },
  { prefix: 'mate-algarrobo', name: 'Mate de Algarrobo' },
  { prefix: 'medalla-militar', name: 'Medalla Militar' },
  { prefix: 'medalla-redonda', name: 'Medalla Redonda' },
  { prefix: 'pulsera-chica', name: 'Pulsera Chica' },
  { prefix: 'pulsera-grande', name: 'Pulsera Grande' }
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const directoryPath = path.join(process.cwd(), 'ASSETS', 'mockups-medidas');

    if (!fs.existsSync(directoryPath)) {
      return res.status(404).json({
        success: false,
        error: `No se pudo localizar el directorio '${directoryPath}' en el servidor Vercel.`
      });
    }

    const files = fs.readdirSync(directoryPath);
    const svgFiles = files.filter(f => f.toLowerCase().endsWith('.svg'));
    const products = parseProducts(svgFiles);

    return res.status(200).json(products);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Formatea elegantemente el slug en un título legible y estético.
 * Ej: \"chapita-huesito-16x32\" -> \"Chapita Huesito 16x32\"
 */
function formatTitle(slug) {
  const minorWords = ['de', 'con', 'sin', 'la', 'el', 'y', 'para'];
  const words = slug.split('-');
  const capitalized = words.map((w, index) => {
    const lower = w.toLowerCase();
    if (minorWords.includes(lower) && index > 0) {
      return lower;
    }
    if (lower.includes('mm') || lower.includes('x')) {
      return lower; // Mantener medidas intactas
    }
    return w.charAt(0).toUpperCase() + w.slice(1);
  });

  if (capitalized.length > 0) {
    capitalized[0] = capitalized[0].charAt(0).toUpperCase() + capitalized[0].slice(1);
  }
  return capitalized.join(' ');
}

/**
 * Procesa la lista de archivos SVG para agruparlos según la jerarquía de EKKO Studio.
 */
function parseProducts(files) {
  const productsMap = {};

  // Ordenamos alfabéticamente para asegurar un procesamiento base ordenado
  files.sort().forEach(file => {
    const nameNoExt = file.substring(0, file.length - 4); // Quitar ".svg"
    let cleanName = nameNoExt.replace(/_/g, '-'); // Normalizar guiones bajos

    // Identificar si tiene el prefijo de virola (ej: \"virola-mate-de-algarrobo...\")
    let isVirolaPrefix = false;
    if (cleanName.toLowerCase().startsWith('virola-')) {
      cleanName = cleanName.substring(7);
      isVirolaPrefix = true;
    }

    const parts = cleanName.split('-');
    const lastPart = parts[parts.length - 1].toLowerCase();
    const knownViews = ['frente', 'dorso', 'virola', 'mate'];

    let surfaceName = "";
    let productId = cleanName;

    // Determinar si la última parte es una vista explícita
    const isSpecific = knownViews.includes(lastPart) && !(lastPart === 'virola' && (cleanName.toLowerCase().endsWith('-con-virola') || cleanName.toLowerCase().endsWith('-sin-virola')));

    if (isSpecific) {
      surfaceName = lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
      productId = parts.slice(0, parts.length - 1).join('-');
    }

    // Resolver vista por fallback si no fue identificada por sufijo explícito
    if (!surfaceName) {
      if (isVirolaPrefix) {
        surfaceName = "Virola";
      } else if (cleanName.toLowerCase().includes('mate')) {
        surfaceName = "Mate";
      } else {
        surfaceName = "Frente"; // Fallback por defecto
      }
    }

    // Determinar la categoría general basándose en el prefijo del productId
    let categoryName = "Otros";
    const matched = CATEGORY_MAPPING.find(item => productId.toLowerCase().startsWith(item.prefix));
    if (matched) {
      categoryName = matched.name;
    } else {
      const baseParts = productId.split('-');
      if (baseParts.length >= 2) {
        categoryName = formatTitle(baseParts.slice(0, 2).join('-'));
      } else {
        categoryName = formatTitle(baseParts[0]);
      }
    }

    // Inicializar producto si no existe
    if (!productsMap[productId]) {
      productsMap[productId] = {
        id: productId,
        nombre: formatTitle(productId),
        category: categoryName,
        svgBase: `ASSETS/mockups-medidas/${file}`,
        superficies: []
      };
    }

    const prod = productsMap[productId];

    // Lógica de preemisión: si la vista ya existe pero la nueva es explícita/específica, sobreescribe
    const existingIndex = prod.superficies.findIndex(s => s.nombre === surfaceName);

    let defaultArea = "silueta";
    if (productId.toLowerCase().includes("mate")) {
      defaultArea = "rectangulo";
    }
    if (surfaceName === "Virola") {
      defaultArea = "anillo";
    } else if (surfaceName === "Mate") {
      defaultArea = "rectangulo";
    }

    const currentSurfaceObj = {
      nombre: surfaceName,
      svg: `ASSETS/mockups-medidas/${file}`,
      area: defaultArea,
      isSpecific: isSpecific || isVirolaPrefix
    };

    if (existingIndex !== -1) {
      const existingObj = prod.superficies[existingIndex];
      // Sobreescribimos solo si la nueva definición es específica y la anterior era genérica
      if (!existingObj.isSpecific && currentSurfaceObj.isSpecific) {
        prod.superficies[existingIndex] = currentSurfaceObj;
      }
    } else {
      prod.superficies.push(currentSurfaceObj);
    }
  });

  // Ordenar superficies y limpiar llaves temporales de metadatos
  Object.keys(productsMap).forEach(prodId => {
    const prod = productsMap[prodId];
    prod.superficies.sort((a, b) => {
      const order = { "Mate": 0, "Frente": 1, "Dorso": 2, "Virola": 3 };
      const orderA = order[a.nombre] !== undefined ? order[a.nombre] : 4;
      const orderB = order[b.nombre] !== undefined ? order[b.nombre] : 4;
      return orderA - orderB;
    });

    // Limpiar propiedad de control y actualizar la ruta base al primer SVG real ordenado
    prod.superficies.forEach(s => {
      delete s.isSpecific;
    });

    if (prod.superficies.length > 0) {
      prod.svgBase = prod.superficies[0].svg;
    }
  });

  // Agrupar productos en categorías unificadas
  const categoriesMap = {};
  Object.keys(productsMap).forEach(prodId => {
    const prod = productsMap[prodId];
    const cat = prod.category;

    if (!categoriesMap[cat]) {
      categoriesMap[cat] = {
        categoria: cat,
        productos: []
      };
    }

    const prodCopy = { ...prod };
    delete prodCopy.category;
    categoriesMap[cat].productos.push(prodCopy);
  });

  // Ordenar productos alfabéticamente dentro de cada categoría
  Object.keys(categoriesMap).forEach(cat => {
    categoriesMap[cat].productos.sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  // Ordenar categorías alfabéticamente
  const sortedCategoriesKeys = Object.keys(categoriesMap).sort();
  const sortedCategories = sortedCategoriesKeys.map(cat => categoriesMap[cat]);

  return sortedCategories;
}
