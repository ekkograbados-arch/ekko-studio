const fs = require('fs');
const path = require('path');

/**
 * Formatea un slug en un título legible y estético.
 * Ej: "chapita-huesito-16x32" -> "Chapita Huesito 16x32"
 */
function formatTitle(slug) {
  if (!slug) return "";
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
 * Procesa la lista de archivos SVG para agruparlos según el formato estándar:
 * [Categoria]--[Producto]_[VISTA].svg
 */
function parseProducts(files) {
  const productsMap = {};

  // Ordenamos alfabéticamente para asegurar un procesamiento base ordenado
  files.sort().forEach(file => {
    if (!file.toLowerCase().endsWith('.svg')) return;
    
    const nameNoExt = file.substring(0, file.length - 4); // Quitar ".svg"
    
    let categorySlug = "";
    let productSlug = "";
    let vistaName = "Mate"; // Vista por defecto
    
    // Formato Estándar: [Categoria]--[Producto]_[VISTA]
    if (nameNoExt.includes('--')) {
      const parts = nameNoExt.split('--');
      categorySlug = parts[0];
      const rest = parts[1];
      
      if (rest.includes('_')) {
        const restParts = rest.split('_');
        productSlug = restParts[0];
        vistaName = restParts[1];
      } else {
        productSlug = rest;
        vistaName = "Mate";
      }
    } else {
      // Fallback de seguridad si el archivo no sigue el estándar '--'
      if (nameNoExt.includes('_')) {
        const parts = nameNoExt.split('_');
        const mainPart = parts[0];
        vistaName = parts[1];
        
        const dashIdx = mainPart.indexOf('-');
        if (dashIdx !== -1) {
          categorySlug = mainPart.substring(0, dashIdx);
          productSlug = mainPart.substring(dashIdx + 1);
        } else {
          categorySlug = mainPart;
          productSlug = mainPart;
        }
      } else {
        const dashIdx = nameNoExt.indexOf('-');
        if (dashIdx !== -1) {
          categorySlug = nameNoExt.substring(0, dashIdx);
          productSlug = nameNoExt.substring(dashIdx + 1);
        } else {
          categorySlug = nameNoExt;
          productSlug = nameNoExt;
        }
      }
    }
    
    const categoryName = formatTitle(categorySlug);
    const productName = formatTitle(productSlug);
    const formattedVista = formatTitle(vistaName.toLowerCase());
    
    const productId = `${categorySlug}--${productSlug}`;
    
    if (!productsMap[productId]) {
      productsMap[productId] = {
        id: productId,
        nombre: productName,
        category: categoryName,
        svgBase: `ASSETS/mockups-medidas/${file}`,
        superficies: []
      };
    }
    
    // Evitar duplicados de vistas
    if (!productsMap[productId].superficies.some(s => s.nombre === formattedVista)) {
      productsMap[productId].superficies.push({
        nombre: formattedVista,
        svg: `ASSETS/mockups-medidas/${file}`,
        area: vistaName.toLowerCase().includes('virola') ? "anillo" : "silueta"
      });
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
    categoriesMap[cat].productos.push({
      id: prod.id,
      nombre: prod.nombre,
      svgBase: prod.svgBase,
      superficies: prod.superficies
    });
  });

  // Ordenar productos alfabéticamente dentro de cada categoría
  Object.keys(categoriesMap).forEach(cat => {
    categoriesMap[cat].productos.sort((a, b) => a.nombre.localeCompare(b.nombre));
    
    // Ordenar las superficies de cada producto de forma consistente
    categoriesMap[cat].productos.forEach(prod => {
      prod.superficies.sort((a, b) => {
        const order = { "Mate": 0, "Frente": 1, "Dorso": 2, "Virola": 3 };
        const orderA = order[a.nombre] !== undefined ? order[a.nombre] : 4;
        const orderB = order[b.nombre] !== undefined ? order[b.nombre] : 4;
        return orderA - orderB;
      });
    });
  });

  // Ordenar categorías alfabéticamente
  const sortedCategoriesKeys = Object.keys(categoriesMap).sort();
  const sortedCategories = sortedCategoriesKeys.map(cat => categoriesMap[cat]);

  return sortedCategories;
}

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
      return res.status(200).json([]);
    }
    const files = fs.readdirSync(directoryPath);
    const parsed = parseProducts(files);
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
