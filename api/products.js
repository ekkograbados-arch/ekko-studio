/**
 * /api/products.js (Optimizado Dinámico - Orden Alfabético Absoluto sin Duplicaciones)
 *
 * Escanea dinámicamente el directorio "ASSETS/mockups-medidas/", agrupa los archivos SVG
 * por Categoría, Producto y Superficie de forma 100% automatizada siguiendo la nomenclatura:
 * nomenclature: [category]-[product_name_without_view]-[VISTA].svg
 */
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // Cabeceras de CORS para máxima compatibilidad
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
 * Ej: "chapita-huesito" -> "Chapita Huesito"
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
 * Procesa la lista de archivos SVG para agruparlos siguiendo la estructura de EKKO Studio.
 */
function parseProducts(files) {
  const productsMap = {};

  // Ordenamos los nombres de archivos para garantizar orden alfabético base
  files.sort().forEach(file => {
    const nameNoExt = file.substring(0, file.length - 4); // Quitar ".svg"
    const nameNoExtLower = nameNoExt.toLowerCase();

    // Determinar la superficie/vista al final del nombre
    const parts = nameNoExt.split('-');
    const lastPart = parts[parts.length - 1].toLowerCase();
    
    const knownViews = ['frente', 'dorso', 'virola', 'mate'];
    let surfaceName = "";
    let productId = "";

    if (knownViews.includes(lastPart)) {
      // Tiene sufijo de vista conocido
      surfaceName = lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
      productId = parts.slice(0, parts.length - 1).join('-');
    } else {
      // Archivo base genérico o sin vista explícita
      productId = nameNoExt;
      if (nameNoExtLower.includes('mate')) {
        surfaceName = "Mate";
      } else if (nameNoExtLower.includes('virola')) {
        surfaceName = "Virola";
      } else {
        surfaceName = "Frente"; // Fallback por defecto
      }
    }

    // Extraer la categoría del producto (quitando las medidas finales ej: -16x32, -25mm)
    // El slug de categoría será todo el productId antes de la medida numérica.
    const categorySlug = productId
      .replace(/-\d+x\d+$/, '')
      .replace(/-\d+mm$/, '')
      .replace(/-\d+x\d+mm$/, '');

    // Inicializar el producto si no existe
    if (!productsMap[productId]) {
      productsMap[productId] = {
        id: productId,
        nombre: formatTitle(productId),
        category: formatTitle(categorySlug),
        svgBase: `ASSETS/mockups-medidas/${file}`,
        superficies: []
      };
    }

    const prod = productsMap[productId];

    // Evitar duplicaciones de superficies
    const hasSurface = prod.superficies.some(s => s.nombre === surfaceName);
    if (!hasSurface) {
      let defaultArea = "silueta";
      if (productId.toLowerCase().includes("mate")) {
        defaultArea = "rectangulo";
      }
      if (surfaceName === "Virola") {
        defaultArea = "anillo";
      } else if (surfaceName === "Mate") {
        defaultArea = "rectangulo";
      }

      prod.superficies.push({
        nombre: surfaceName,
        svg: `ASSETS/mockups-medidas/${file}`,
        area: defaultArea
      });
    }
  });

  // Ordenar las superficies de cada producto en el orden oficial: Mate, Frente, Dorso, Virola
  Object.keys(productsMap).forEach(prodId => {
    const prod = productsMap[prodId];
    prod.superficies.sort((a, b) => {
      const order = { "Mate": 0, "Frente": 1, "Dorso": 2, "Virola": 3 };
      const orderA = order[a.nombre] !== undefined ? order[a.nombre] : 4;
      const orderB = order[b.nombre] !== undefined ? order[b.nombre] : 4;
      return orderA - orderB;
    });

    if (prod.superficies.length > 0) {
      prod.svgBase = prod.superficies[0].svg;
    }
  });

  // Agrupar productos en categorías
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
    delete prodCopy.category; // Limpiar propiedad temporal
    categoriesMap[cat].productos.push(prodCopy);
  });

  // Ordenar alfabéticamente los productos de cada categoría
  Object.keys(categoriesMap).forEach(cat => {
    categoriesMap[cat].productos.sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  // Ordenar alfabéticamente las categorías por su nombre y retornar array plano
  const sortedCategoriesKeys = Object.keys(categoriesMap).sort();
  const sortedCategories = sortedCategoriesKeys.map(cat => categoriesMap[cat]);

  return sortedCategories;
}
