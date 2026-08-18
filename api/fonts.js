const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const fontsDir = path.join(process.cwd(), 'ASSETS', 'fonts');
    if (!fs.existsSync(fontsDir)) {
      return res.status(200).json([]);
    }
    const files = fs.readdirSync(fontsDir);
    const fonts = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ext === '.ttf' || ext === '.otf' || ext === '.woff' || ext === '.woff2';
      })
      .map(file => {
        const nameWithoutExt = path.basename(file, path.extname(file));
        const family = 'ekko_' + nameWithoutExt.toLowerCase().replace(/[^a-z0-9]/g, '_');
        return { name: nameWithoutExt, family: family, file: file };
      });

    // Ordenar alfabéticamente por nombre de la tipografía
    fonts.sort((a, b) => a.name.localeCompare(b.name));

    // Cabeceras CORS y Caché para máxima velocidad
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate');
    return res.status(200).json(fonts);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
