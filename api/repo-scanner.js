/**
 * ========================================================================
 * RUTA DESTINO EN TU DISCO LOCAL: api/repo-scanner.js
 * ACCIÓN: CREAR ARCHIVO NUEVO EN LA CARPETA "api"
 * ESTADO: VERSIÓN 10.3 (SANEADA Y AUTOMATIZADA) - INDEXADOR DE DISCO
 * DESCRIPCIÓN: Escanea físicamente el directorio local del proyecto, 
 *              identificando la presencia de archivos, carpetas, mockups y tipografías.
 *              Funciona tanto en Vercel (Serverless) como en tu servidor local (Node.js / Express).
 * ========================================================================
 */

const fs = require('fs');
const path = require('path');

// Carpetas que deben excluirse del escaneo para evitar saturación de RAM
const EXCLUDED_DIRS = new Set([
    'node_modules',
    '.git',
    '.vercel',
    '.github',
    'scratch'
]);

// Extensiones de archivos que rastrea nuestra Red Neuronal
const ALLOWED_EXTENSIONS = new Set([
    '.html', '.css', '.js', '.json', '.svg', '.png', '.jpg', '.jpeg', '.ttf', '.otf', '.woff', '.woff2'
]);

/**
 * Función recursiva para caminar por los directorios y recopilar metadatos físicos
 */
function scanDirectory(dirPath, rootDir, fileList = []) {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!EXCLUDED_DIRS.has(file)) {
                scanDirectory(fullPath, rootDir, fileList);
            }
        } else {
            const ext = path.extname(file).toLowerCase();
            if (ALLOWED_EXTENSIONS.has(ext)) {
                fileList.push({
                    path: relativePath,
                    name: file,
                    size: stat.size,
                    mtime: stat.mtimeMs, // Timestamp para detectar modificaciones rápidas
                    ext: ext
                });
            }
        }
    }
    return fileList;
}

module.exports = async (req, res) => {
    // Configuración de cabeceras CORS para permitir que tu Chrome (F12) lea la API sin bloqueos locales
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // El directorio raíz es el padre de 'api/', es decir, el directorio del proyecto
        const rootDir = path.resolve(__dirname, '..');
        
        console.log(`[REPO-SCANNER] Iniciando escaneo físico en: ${rootDir}`);
        
        const physicalFiles = scanDirectory(rootDir, rootDir);

        // Devolvemos el mapa físico estructurado
        res.status(200).json({
            success: true,
            timestamp: Date.now(),
            root: rootDir,
            totalFiles: physicalFiles.length,
            files: physicalFiles
        });

    } catch (error) {
        console.error('[REPO-SCANNER] Error crítico durante el escaneo:', error);
        res.status(500).json({
            success: false,
            error: 'ERROR_DIR_SCAN_FAILED',
            message: error.message
        });
    }
};
