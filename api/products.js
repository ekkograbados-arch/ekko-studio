/**
 * /api/products.js (Optimizado para Vercel Serverless NFT)
 * 
 * Escanea dinámicamente el directorio de mockups SVG ("ASSETS/mockups-medidas/"),
 * procesa y agrupa los productos por categorías ordenadas alfabéticamente,
 * y genera las superficies de grabado ("Frente", "Dorso", "Virola", etc.)
 * de forma 100% automática.
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
        // RUTA ESTÁTICA Y DIRECTA: Permite que Vercel Node File Trace (NFT) rastree y bundlee los archivos
        const directoryPath = path.join(process.cwd(), 'ASSETS', 'mockups-medidas');

        // Si no se encuentra físicamente, devolvemos un error descriptivo
        if (!fs.existsSync(directoryPath)) {
            return res.status(404).json({ 
                success: false, 
                error: `No se pudo localizar el directorio '${directoryPath}' en el servidor Vercel. Asegúrate de configurar 'includeFiles' en vercel.json.` 
            });
        }

        const files = fs.readdirSync(directoryPath);
        const svgFiles = files.filter(f => f.toLowerCase().endsWith('.svg'));

        const products = parseProducts(svgFiles);
        return res.status(200).json(products);

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

/**
 * Formatea elegantemente el identificador (slug) en un título legible
 * Ej: "mate-algarrobo-sin-virola" -> "Mate de Algarrobo sin Virola"
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
            return lower;
        }
        return w.charAt(0).toUpperCase() + w.slice(1);
    });

    if (capitalized.length > 0) {
        capitalized[0] = capitalized[0].charAt(0).toUpperCase() + capitalized[0].slice(1);
    }
    return capitalized.join(' ');
}

/**
 * Procesa la lista de archivos SVG planos para agruparlos en productos y categorías
 */
function parseProducts(files) {
    const productsMap = {};

    files.sort().forEach(file => {
        const nameNoExt = file.substring(0, file.length - 4);
        
        const isVirola = nameNoExt.startsWith('virola-');
        const isFrente = nameNoExt.endsWith('-frente');
        const isDorso = nameNoExt.endsWith('-dorso');

        let productId = nameNoExt;
        if (isVirola) {
            productId = nameNoExt.substring(7); // Quitar 'virola-'
        } else if (isFrente) {
            productId = nameNoExt.substring(0, nameNoExt.length - 7); // Quitar '-frente'
        } else if (isDorso) {
            productId = nameNoExt.substring(0, nameNoExt.length - 6); // Quitar '-dorso'
        }

        const firstWord = productId.split('-')[0].toLowerCase();
        let category = "Otros";
        
        if (firstWord === 'medalla') category = \"Medallas\";
        else if (firstWord === 'chapita') category = \"Chapitas\";
        else if (firstWord === 'pulsera') category = \"Pulseras\";
        else if (firstWord === 'mate') category = \"Mates\";
        else if (firstWord === 'termo') category = \"Termos\";
        else {
            category = firstWord.charAt(0).toUpperCase() + firstWord.slice(1) + "s";
        }

        if (!productsMap[productId]) {
            productsMap[productId] = {
                id: productId,
                nombre: formatTitle(productId),
                category: category,
                svgBase: `ASSETS/mockups-medidas/${productId}.svg`,
                superficies: []
            };
        }

        const prod = productsMap[productId];
        let defaultArea = "silueta";
        if (productId.includes("mate")) {
            defaultArea = "rectangulo";
        }

        if (isVirola) {
            prod.superficies.push({
                nombre: "Virola",
                svg: `ASSETS/mockups-medidas/${file}`,
                area: "anillo"
            });
        } else if (isFrente) {
            prod.superficies.push({
                nombre: "Frente",
                svg: `ASSETS/mockups-medidas/${file}`,
                area: defaultArea
            });
        } else if (isDorso) {
            prod.superficies.push({
                nombre: "Dorso",
                svg: `ASSETS/mockups-medidas/${file}`,
                area: defaultArea
            });
        } else {
            if (["Medallas", "Chapitas", "Pulseras"].includes(category)) {
                prod.superficies.push({
                    nombre: "Frente",
                    svg: `ASSETS/mockups-medidas/${file}`,
                    area: defaultArea
                });
                prod.superficies.push({
                    nombre: "Dorso",
                    svg: `ASSETS/mockups-medidas/${file}`,
                    area: defaultArea
                });
            } else {
                const surfaceName = (category === "Mates") ? "Mate" : "Frente";
                prod.superficies.push({
                    nombre: surfaceName,
                    svg: `ASSETS/mockups-medidas/${file}`,
                    area: defaultArea
                });
            }
        }
    });

    Object.keys(productsMap).forEach(prodId => {
        const prod = productsMap[prodId];
        prod.superficies.sort((a, b) => {
            const order = { "Mate": 0, "Frente": 0, "Dorso": 1, "Virola": 2 };
            const orderA = order[a.nombre] !== undefined ? order[a.nombre] : 3;
            const orderB = order[b.nombre] !== undefined ? order[b.nombre] : 3;
            return orderA - orderB;
        });
        if (prod.superficies.length > 0) {
            prod.svgBase = prod.superficies[0].svg;
        }
    });

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

    Object.keys(categoriesMap).forEach(cat => {
        categoriesMap[cat].productos.sort((a, b) => a.nombre.localeCompare(b.nombre));
    });

    const sortedCategories = Object.keys(categoriesMap).sort().map(cat => categoriesMap[cat]);
    return sortedCategories;
}
