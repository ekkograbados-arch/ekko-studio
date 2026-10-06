// -------------------------------------------------------------------------
// ACTUALIZAR ICONOS
//
// Un solo comando que hace las dos cosas que hay que hacer cada vez que se
// agrega o se saca una herramienta:
//
//   1. REVISA que el set este sano
//        - alguna herramienta sin icono?
//        - algun icono en dos herramientas?
//        - alguna referencia rota?
//        - el sprite depende de alguna variable de CSS?
//
//   2. REGENERA preview.html, la pagina donde se miran los iconos antes de
//      subirlos. El HTML sale con los iconos ya incrustados, sin una sola
//      linea de JavaScript: por eso no puede quedar en blanco.
//
// COMO SE USA:
//
//     node ASSETS/ui/actualizar-iconos.mjs
//
// Despues: abrir preview.html y mirar. Para verlo en el navegador, se
// abre en http://127.0.0.1:8772/ASSETS/ui/preview.html
// -------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

const HTML = path.join(RAIZ, 'index.html');
const SPRITE = path.join(AQUI, 'ekko-icons.svg');
const PREVIEW = path.join(AQUI, 'preview.html');

// Que herramienta usa cada icono. Se mantiene a mano; si aparece un icono
// que no esta en esta tabla, la pagina lo muestra con el nombre que trae el
// id, y por eso no se rompe nada.
const NOMBRES = {
  'ekko-cargar': 'Cargar Imagen / SVG',
  'ekko-texto': 'Agregar Texto',
  'ekko-qr': 'QR',
  'ekko-fusionar': 'Fusionar',
  'ekko-separar': 'Quitar Fusion',
  'ekko-calado': 'Calado',
  'ekko-rellenar': 'Rellenar',
  'ekko-solidos-huecos': 'Solidos / Huecos',
  'ekko-agrupar': 'Agrupar',
  'ekko-desagrupar': 'Desagrupar',
  'ekko-descomponer': 'Descomponer Vector',
  'ekko-nodos': 'Editar Nodos',
  'ekko-contorno': 'Contorno',
  'ekko-vectorizar': 'Texto a Vector',
  'ekko-corte': 'Corte de lineas',
  'ekko-lineas': 'Lineas',
  'ekko-formas': 'Formas preestablecidas',
  'ekko-lapiz': 'Lapiz a mano',
  'ekko-quitar-fondo': 'Quitar Fondo',
  'ekko-trazar': 'Trazar Imagen',
  'ekko-editar-imagen': 'Editar Imagen',
  'ekko-curvar': 'Curvar Texto',
  'ekko-alinear': 'Alinear',
  'ekko-distribuir': 'Distribuir',
  'ekko-union': 'Union',
  'ekko-restar': 'Restar',
  'ekko-interseccion': 'Interseccion',
  'ekko-diferencia': 'Diferencia',
  'ekko-auditar': 'Auditar Vectores',
  'ekko-vista': 'Ajustar Vista',
  'ekko-reglas': 'Reglas',
  'ekko-guias': 'Guias',
  'ekko-deshacer': 'Deshacer',
  'ekko-rehacer': 'Rehacer',
  'ekko-flecha': 'Flecha'
};

const escapar = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ---------------------------------------------------------------------
   1) LEER
   --------------------------------------------------------------------- */

const html = fs.readFileSync(HTML, 'utf8');
const sprite = fs.readFileSync(SPRITE, 'utf8');

const ini = html.indexOf('id="topBar"');
const fin = html.indexOf('id="topPanelControls"');
if (ini < 0 || fin < 0 || fin < ini) {
  console.log('ERROR: no encontre los limites de la cinta en index.html');
  process.exit(1);
}
const cinta = html.slice(ini, fin);

// herramientas de la cinta: id propio, o data-fusion-btn, o el boton de Cargar
const herramientas = [];
for (const m of cinta.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
  const atributos = m[1];
  const cuerpo = m[2];
  const esHerramienta = /id="btn|id="proBtn/.test(atributos)
    || /data-fusion-btn=/.test(atributos)
    || /onclick="openAssetLoader/.test(atributos);
  if (!esHerramienta) continue;

  const icono = (cuerpo.match(/#(ekko-[a-z0-9-]+)/i) || [])[1] || '';
  const etiqueta = cuerpo.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  herramientas.push({ icono, etiqueta });
}

// simbolos del sprite, con su geometria y sus atributos
const simbolos = [];
for (const m of sprite.matchAll(/<symbol\s+([^>]*?)>([\s\S]*?)<\/symbol>/g)) {
  const attrsCrudos = m[1];
  const dentro = m[2].trim();
  const id = (attrsCrudos.match(/id="([^"]+)"/) || [])[1];
  if (!id) continue;

  const viewBox = (attrsCrudos.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 24 24';
  const atributosTrazo = [];
  for (const attr of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']) {
    const v = (attrsCrudos.match(new RegExp('\\b' + attr + '="([^"]*)"')) || [])[1];
    if (v) atributosTrazo.push(attr + '="' + v + '"');
  }
  simbolos.push({ id, viewBox, trazo: atributosTrazo.join(' '), dentro });
}

/* ---------------------------------------------------------------------
   2) REVISAR
   --------------------------------------------------------------------- */

const fallas = [];
const avisos = [];

const sinIcono = herramientas.filter(h => !h.icono);
if (sinIcono.length) {
  fallas.push(sinIcono.length + ' herramienta(s) SIN icono: ' +
    sinIcono.map(h => h.etiqueta || '(sin etiqueta)').join(', '));
}

const porIcono = new Map();
for (const h of herramientas) {
  if (!h.icono) continue;
  if (!porIcono.has(h.icono)) porIcono.set(h.icono, []);
  porIcono.get(h.icono).push(h.etiqueta || h.icono);
}
const repetidos = [...porIcono.entries()].filter(([, l]) => l.length > 1);
for (const [icono, lista] of repetidos) {
  fallas.push('icono "' + icono + '" en ' + lista.length + ' herramientas: ' + lista.join(' + '));
}

const nombresSprite = simbolos.map(s => s.id);
const dupSprite = nombresSprite.filter((v, i, a) => a.indexOf(v) !== i);
if (dupSprite.length) fallas.push('simbolo duplicado en el sprite: ' + [...new Set(dupSprite)].join(', '));

const rutas = [...html.matchAll(/#(ekko-[a-z0-9-]+)/gi)].map(m => m[1]);
const rotas = [...new Set(rutas)].filter(r => !nombresSprite.includes(r));
if (rotas.length) fallas.push('referencias rotas en index.html: ' + rotas.join(', '));

if (/var\(/.test(sprite)) fallas.push('el sprite usa variables de CSS; deberia ser autonomo');

const enCinta = new Set(herramientas.map(h => h.icono).filter(Boolean));
const sinBoton = nombresSprite.filter(id => !enCinta.has(id));
if (sinBoton.length) {
  avisos.push(sinBoton.length + ' icono(s) dibujados sin boton todavia: ' + sinBoton.join(', '));
}

/* ---------------------------------------------------------------------
   3) DIBUJAR CADA ICONO
   Los atributos de trazo viajan en un <g> que los envuelve, igual que
   hace el <use> del sprite en la aplicacion.
   --------------------------------------------------------------------- */

function icono(simbolo, tamano, clase) {
  return '<svg class="' + clase + '" viewBox="' + simbolo.viewBox + '" '
    + 'width="' + tamano + '" height="' + tamano + '" aria-hidden="true" '
    + 'role="img"><g ' + simbolo.trazo + '>' + simbolo.dentro + '</g></svg>';
}

function celda(simbolo, herramienta, estado) {
  const nombre = NOMBRES[simbolo.id]
    || simbolo.id.replace('ekko-', '').replace(/-/g, ' ');
  return ''
    + '<div class="celda' + (estado ? ' ' + estado : '') + '">'
    +   '<div class="grande">' + icono(simbolo, 54, '') + '</div>'
    +   '<span class="demo">' + icono(simbolo, 14, '') + escapar(nombre) + '</span>'
    +   '<div class="uso">' + escapar(nombre) + '</div>'
    +   '<div class="id">' + escapar(simbolo.id) + '</div>'
    + '</div>';
}

/* ---------------------------------------------------------------------
   4) ESCRIBIR LA PAGINA
   --------------------------------------------------------------------- */

const enLaCinta = simbolos.filter(s => enCinta.has(s.id));
const sueltos = simbolos.filter(s => !enCinta.has(s.id));

function avisoHtml(texto, tipo) {
  return '<li class="' + tipo + '">' + escapar(texto) + '</li>';
}

const listaAvisos = [
  ...fallas.map(t => avisoHtml(t, 'mal')),
  ...avisos.map(t => avisoHtml(t, 'nota'))
].join('\n      ');

const pagina = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EKKO Studio - Iconos (antes de subirlos)</title>
<style>
/* ------------------------------------------------------------------------
   Pagina de trabajo, no parte de la aplicacion.

   Esta pagina se GENERA con  node ASSETS/ui/actualizar-iconos.mjs
   Los iconos van incrustados en el HTML, sin JavaScript: por eso no puede
   quedar en blanco. Para cambiar algo, se cambia el sprite y se corre el
   comando otra vez.
   ------------------------------------------------------------------------ */

body {
  margin: 0; padding: 24px 28px 60px;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  background: #ffffff; color: #26343d;
}

/* El oscuro importa: el icono toma el color del boton, asi que hay que
   ver que se lea en las dos superficies. Con :has() no hace falta JS. */
body:has(#oscuro:checked) { background: #0d0d20; color: #e8edf2; }
body:has(#oscuro:checked) .sub,
body:has(#oscuro:checked) h2,
body:has(#oscuro:checked) .uso,
body:has(#oscuro:checked) .id { color: #94a3b8; }
body:has(#oscuro:checked) .barra { border-color: #24304a; }
body:has(#oscuro:checked) .celda { border-color: #24304a; background: #141a33; }
body:has(#oscuro:checked) .demo { background: #1d2749; border-color: #33415c; color: #e8edf2; }
body:has(#oscuro:checked) .resumen { background: #141a33; }

h1 { font-size: 19px; margin: 0 0 4px; }
.sub { color: #5d6c76; margin: 0 0 18px; font-size: 13px; max-width: 70ch; }
code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
body:has(#oscuro:checked) code { background: #1d2749; }

.barra {
  display: flex; gap: 18px; align-items: center; flex-wrap: wrap;
  margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid #dde5ea;
}
.barra label { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; }
.barra input[type=checkbox] { width: 15px; height: 15px; cursor: pointer; accent-color: #405d6d; }
.barra .cuenta { font-size: 12px; color: #5d6c76; }
body:has(#oscuro:checked) .barra .cuenta { color: #94a3b8; }

.resumen {
  margin: 0 0 22px; padding: 11px 15px; border-radius: 8px;
  background: #f1f5f9; font-size: 12.5px;
}
.resumen ul { margin: 6px 0 0; padding-left: 20px; }
.resumen li { margin: 3px 0; }
.resumen .mal { color: #b91c1c; }
.resumen .nota { color: #8a6d1f; }
.resumen .ok { color: #15803d; }

.celda {
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  padding: 12px 6px 10px; border: 1px solid #dde5ea;
  border-radius: 8px; background: #f7fafb;
}
.grande { width: 54px; height: 54px; line-height: 0; }

/* boton de mentira: mismo padding y misma fuente que los de la cinta */
.demo {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
  background: #d1dce3; color: #26343d;
  font-size: 12px; font-weight: 500; white-space: nowrap;
}
.uso { font-size: 11px; color: #5d6c76; text-align: center; line-height: 1.3; }
.id { font-size: 10px; color: #94a3b8; font-family: ui-monospace, Consolas, monospace; }
.nuevo { border-color: #f5c518; box-shadow: 0 0 0 2px rgba(245, 197, 24, .25); }

.rejilla {
  display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
}
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
     color: #5d6c76; margin: 30px 0 12px; }
</style>
</head>
<body>

<h1>EKKO Studio &mdash; iconos de la marca</h1>
<p class="sub">
  Cada icono sale en grande para revisar el dibujo y al lado, dentro de un boton
  con el mismo padding y la misma fuente que los de la cinta, al tamano real
  (13.8&nbsp;px). Ese segundo es el que importa: un icono puede verse bien en
  grande y ser ilegible en un boton.
  Para cambiar algo: se edita <code>ekko-icons.svg</code> y se corre
  <code>node ASSETS/ui/actualizar-iconos.mjs</code>.
</p>

<div class="barra">
  <label><input type="checkbox" id="oscuro"> Ver en oscuro</label>
  <span class="cuenta">${simbolos.length} iconos &middot; ${herramientas.length} herramientas en la cinta</span>
</div>

<div class="resumen">
  ${fallas.length === 0
    ? '<span class="ok">Sin problemas: cada herramienta tiene su icono y ninguno se repite.</span>'
    : ''}
  <ul>
      ${listaAvisos}
  </ul>
</div>

<h2>En la cinta ahora (${enLaCinta.length})</h2>
<div class="rejilla">
${enLaCinta.map(s => '  ' + celda(s, null, '')).join('\n')}
</div>

<h2>Dibujados, todavia sin boton (${sueltos.length})</h2>
<div class="rejilla">
${sueltos.map(s => '  ' + celda(s, null, 'nuevo')).join('\n')}
</div>

</body>
</html>
`;

fs.writeFileSync(PREVIEW, pagina, 'utf8');

/* ---------------------------------------------------------------------
   5) AVISAR
   --------------------------------------------------------------------- */

console.log('');
console.log('ICONOS DE EKKO - ' + herramientas.length + ' herramientas en la cinta, ' +
            simbolos.length + ' iconos dibujados');
console.log('-'.repeat(66));
if (fallas.length === 0) {
  console.log('  ok  cada herramienta tiene su icono y ninguno se repite');
} else {
  for (const f of fallas) console.log('  FALLA  ' + f);
}
for (const a of avisos) console.log('  --    ' + a);
console.log('-'.repeat(66));
console.log('preview.html regenerado con ' + simbolos.length + ' iconos incrustados (sin JavaScript)');
console.log('  ' + PREVIEW);
console.log('  abrir: http://127.0.0.1:8772/ASSETS/ui/preview.html');
console.log('');
process.exit(fallas.length === 0 ? 0 : 1);