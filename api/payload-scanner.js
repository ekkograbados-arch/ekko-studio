/**
 * ========================================================================
 * SERVICIO DE TELEMETRÍA Y OBSERVABILIDAD: api/payload-scanner.js
 * ESTADO: v10.3 (TITANIUM PRECISION) - RED NEURONAL FORENSE
 * ACCIÓN: ESPECÍFICO DE DESPLIEGUE PARA TU SERVIDOR LOCAL / VERCEL
 * DESCRIPCIÓN: Analizador estático y dinámico de carga útil. Examina el
 *              interior de los archivos index.html, styles.css y scripts
 *              JS de módulos para mapear dependencias rotas, escuchadores
 *              en el vacío y estilos latentes del panel social.
 * ========================================================================
 */

const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    // Habilitar CORS para permitir que Chrome se conecte desde localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // En Vercel o local, buscamos la raíz del proyecto ekko-studio/
        const rootDir = path.resolve(process.cwd());

        // 1. Rutas canónicas de los archivos bajo auditoría
        const indexHTMLPath = path.join(rootDir, 'index.html');
        const stylesCSSPath = path.join(rootDir, 'ASSETS', 'css', 'styles.css');
        const contextualMenuPath = path.join(rootDir, 'ASSETS', 'js', 'modules', 'canvas-pro', 'contextualMenu.js');

        // Inicializamos los buzones de recolección de telemetría forense
        const payloadReport = {
            timestamp: new Date().toISOString(),
            status: "HEALTHY",
            brokenLinks: [],
            deadBindings: [],
            latentCSS: [],
            purgeTargets: []
        };

        // 2. VERIFICACIÓN DE VÍNCULOS HUÉRFANOS EN INDEX.HTML
        if (fs.existsSync(indexHTMLPath)) {
            const indexContent = fs.readFileSync(indexHTMLPath, 'utf8');

            // Buscamos llamadas a scripts: <script src="..."></script>
            const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
            let match;
            const declaredScripts = [];

            while ((match = scriptRegex.exec(indexContent)) !== null) {
                const scriptSrc = match[1];
                // Ignorar enlaces externos de CDNs
                if (!scriptSrc.startsWith('http') && !scriptSrc.startsWith('//')) {
                    declaredScripts.push({ src: scriptSrc, line: getLineNumber(indexContent, match.index) });
                }
            }

            // Validamos físicamente la existencia de cada script local en el disco duro
            for (const script of declaredScripts) {
                // Limpiamos parámetros de caché si existen (ej: script.js?v=1.2)
                const cleanSrc = script.src.split('?')[0];
                const physicalPath = path.join(rootDir, cleanSrc);

                if (!fs.existsSync(physicalPath)) {
                    payloadReport.status = "UNHEALTHY";
                    payloadReport.brokenLinks.push({
                        caller: "index.html",
                        target: script.src,
                        line: script.line,
                        error: "FILE_NOT_FOUND",
                        details: `El script es invocado en la línea ${script.line} del HTML, pero el archivo no existe en el disco.`
                    });
                }
            }
        } else {
            payloadReport.status = "UNHEALTHY";
            payloadReport.brokenLinks.push({
                caller: "ROOT",
                target: "index.html",
                line: 0,
                error: "INDEX_MISSING",
                details: "No se encontró el archivo index.html en la raíz de ejecución del servidor."
            });
        }

        // 3. ANALIZADOR DE CARGA ÚTIL EN STYLES.CSS (ESTILOS LATENTES VS HUÉRFANOS)
        if (fs.existsSync(indexHTMLPath) && fs.existsSync(stylesCSSPath)) {
            const indexContent = fs.readFileSync(indexHTMLPath, 'utf8');
            const stylesContent = fs.readFileSync(stylesCSSPath, 'utf8');

            // Buscamos selectores de clase clásicos: .nombre-clase
            const classRegex = /\.([a-zA-Z0-9_-]+)\s*(?=[{,])/g;
            const uniqueSelectors = new Set();
            let classMatch;

            while ((classMatch = classRegex.exec(stylesContent)) !== null) {
                const className = classMatch[1];
                // Excluimos nombres numéricos temporales o pseudo-clases
                if (isNaN(className) && className !== 'active' && className !== 'hidden') {
                    uniqueSelectors.add(className);
                }
            }

            // Clases que pertenecen a la estructura muerta de la v10.2 (Escombros Administrativos)
            const targetPurgeList = ['layout', 'properties', 'editor-area', 'sidebar', 'panel', 'editor-header'];

            // Clases del panel inferior de redes de la v10.1 que deseamos preservar como Latentes
            const targetLatentList = ['footer-ekko', 'footer-logo', 'footer-social', 'copyright'];

            uniqueSelectors.forEach(className => {
                // Buscamos si la clase existe escrita dentro del index.html
                const isUsedInHTML = indexContent.includes(className);

                if (!isUsedInHTML) {
                    if (targetLatentList.includes(className)) {
                        payloadReport.latentCSS.push({
                            selector: `.${className}`,
                            status: "LATENTE",
                            description: "Estructura de panel de comunicación y marca del pie de pantalla listo en reserva."
                        });
                    } else if (targetPurgeList.includes(className)) {
                        payloadReport.status = "UNHEALTHY"; // Sigue habiendo escombros viejos colisionando
                        payloadReport.purgeTargets.push({
                            selector: `.${className}`,
                            status: "PROPUESTO_A_PURGA",
                            description: "Residuo inerte de la maquetación de dos columnas o panel de propiedades obsoleto de la v10.2."
                        });
                    }
                }
            });
        }

        // 4. VERIFICACIÓN DE RECEPTORES AUSENTES EN CONTEXTUALMENU.JS
        if (fs.existsSync(indexHTMLPath) && fs.existsSync(contextualMenuPath)) {
            const indexContent = fs.readFileSync(indexHTMLPath, 'utf8');
            const menuContent = fs.readFileSync(contextualMenuPath, 'utf8');

            // Detectamos llamadas a document.getElementById("...")
            const getElementRegex = /document\.getElementById\(["']([^"']+)["']\)/g;
            const uniqueBindings = new Set();
            let elementMatch;

            while ((elementMatch = getElementRegex.exec(menuContent)) !== null) {
                uniqueBindings.add(elementMatch[1]);
            }

            uniqueBindings.forEach(elementId => {
                // Buscamos si el ID físico existe declarado en el HTML
                const existsInHTML = indexContent.includes(`id="${elementId}"`) || indexContent.includes(`id='${elementId}'`);

                // Filtramos por elementos clave que son escuchadores interactivos
                if (!existsInHTML && (elementId.startsWith('btnCtx') || elementId.startsWith('ctx'))) {
                    payloadReport.status = "UNHEALTHY";
                    payloadReport.deadBindings.push({
                        caller: "contextualMenu.js",
                        targetId: `#${elementId}`,
                        error: "DEAD_BINDING",
                        details: `Se detectó código de escucha activa para el ID '${elementId}', pero el elemento no existe en el index.html.`
                    });
                }
            });
        }

        // Servir el reporte completo en formato JSON para el consumo de Chrome
        return res.status(200).json(payloadReport);

    } catch (error) {
        return res.status(500).json({
            status: "CRITICAL_ERROR",
            error: error.message,
            stack: error.stack
        });
    }
};

// Función auxiliar para identificar el número de línea exacto de un Match
function getLineNumber(text, index) {
    const tempText = text.substring(0, index);
    return tempText.split('\n').length;
}
