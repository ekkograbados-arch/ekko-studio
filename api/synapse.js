const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    // Cabeceras de seguridad y desactivación de caché para lectura en caliente de disco
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const rootDir = process.cwd();
        const filesList = [];

        function walk(dir) {
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                const fullPath = path.join(dir, file);
                const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

                // Filtro absoluto de directorios del sistema de control y paquetes
                if (
                    file === 'node_modules' ||
                    file === '.git' ||
                    file === '.next' ||
                    file === '.vercel' ||
                    relPath.startsWith('node_modules/') ||
                    relPath.startsWith('.git/') ||
                    relPath.startsWith('.next/') ||
                    relPath.startsWith('.vercel/')
                ) {
                    return;
                }

                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    walk(fullPath);
                } else {
                    const ext = path.extname(file).toLowerCase();
                    const isCode = ['.js', '.html', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.woff2', '.woff', '.otf', '.ttf'].includes(ext);
                    
                    if (isCode) {
                        let linesCount = 0;
                        let isText = ['.js', '.html', '.css', '.json', '.svg'].includes(ext);
                        
                        if (isText) {
                            try {
                                const content = fs.readFileSync(fullPath, 'utf8');
                                linesCount = content.split('\n').length;
                            } catch (e) {
                                // Fallback silencioso si no se puede leer
                            }
                        }

                        filesList.push({
                            path: relPath,
                            size: stat.size,
                            lines: linesCount,
                            mtime: stat.mtimeMs,
                            isText: isText
                        });
                    }
                }
            });
        }

        walk(rootDir);

        return res.status(200).json({
            success: true,
            totalFiles: filesList.length,
            files: filesList
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};
