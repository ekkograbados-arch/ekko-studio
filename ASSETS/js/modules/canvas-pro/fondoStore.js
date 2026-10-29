/* =========================================================================
   EKKO STUDIO — Almacen de sesiones de fondo (IndexedDB)
   -------------------------------------------------------------------------
   Para que "Editar Fondo" siga funcionando DESPUES de recargar la pagina.

   El problema: el paquete de edicion (la mascara cruda del modelo, la foto
   ORIGINAL completa y el perfil elegido) vivia en la memoria del modulo. Al
   recargar, la marca `data.ekkoFondoClave` sigue en el item porque vive en la
   escena, pero el paquete ya no existe: la ventana respondia

     "La edicion de esta imagen se perdió al recargar la página.
      Quitá el fondo de nuevo para retocarla."

   y el cliente perdia el recorte y los retoques. Photoshop y PhotoRoom no
   hacen eso: la edicion sigue abierta aunque se cierre el programa.

   Por que IndexedDB y no el JSON de la escena:
     - La foto original pesan 1-4 MB y la mascaracruda decenas de KB. La
       escena se guarda como `exportJSON` en HISTORIAL hasta 50 pasos
       (editor.js) y `projectIO.js` NO tiene tope de tamano ni poda de claves:
       meter eso en `data` multiplica x50 el peso de un .ekko.json.
     - El otro motivo es la privacidad: nada sale del equipo. IndexedDB es
       local y la app ya usa el mismo patron para los modelos
       (`ekko-bg-modelos`), asi que no hay backend ni costo.

   Lo que se guarda es la FOTO ORIGINAL tal cual entro (un Blob con los bytes
   exactos de la importacion). Sin ella el pincel "Restaurar" no puede
   devolver color: el canvas 2D NO conserva el RGB de los pixeles
   transparentes, asi que un pixel borrado del recorte solo se puede repintar
   desde la foto de origen (ver `actualizarCapasEn`).

   Si el almacen falla (ventana privada, cuota llena, navegador sin
   IndexedDB) todo devuelve `false` y la edicion sigue funcionando en memoria
   como hasta ahora: se degrada la persistencia, nunca el recorte.
   ========================================================================= */

const NOMBRE_BD = 'ekko-fondo';
const VERSION_BD = 1;
const ALMACEN = 'sesiones';

// Sesiones en disco. Cada una trae la foto original, asi que alcanza para la
// sesion de trabajo de un dia y no llena la cuota del navegador.
//
// El tope cuenta REGISTROS, no fotos: una foto puede ocupar dos (el paquete de
// edicion y la eleccion de fondo, clave `...::fondo`). Con 8 fotos vivas al
// mismo tiempo (`SESION_TOPE` en el modulo) son 16 registros, y 20 deja margen
// para que la poda nunca expulse el paquete de una foto que sigue abierta.
const TOPE = 20;

let ultError = null;
let promesaDb = null;

function abrir() {
    if (promesaDb) return promesaDb;
    promesaDb = new Promise((res, rej) => {
        const idb = typeof window !== 'undefined' ? window.indexedDB : null;
        if (!idb) { rej(new Error('IndexedDB no disponible')); return; }
        let sol;
        try { sol = idb.open(NOMBRE_BD, VERSION_BD); }
        catch (e) { rej(e); return; }
        sol.onupgradeneeded = () => {
            const db = sol.result;
            if (!db.objectStoreNames.contains(ALMACEN)) {
                db.createObjectStore(ALMACEN, { keyPath: 'clave' });
            }
        };
        sol.onsuccess = () => res(sol.result);
        sol.onerror = () => rej(sol.error || new Error('no se pudo abrir ekko-fondo'));
        sol.onblocked = () => rej(new Error('IndexedDB bloqueada por otra pestana'));
    }).catch(err => {
        promesaDb = null;
        ultError = err;
        throw err;
    });
    return promesaDb;
}

function enTx(db, modo, cuerpo) {
    return new Promise((res, rej) => {
        let tx;
        try { tx = db.transaction(ALMACEN, modo); }
        catch (e) { return rej(e); }
        let pedido = null;
        try { pedido = cuerpo(tx.objectStore(ALMACEN)); } catch (e) { return rej(e); }
        tx.oncomplete = () => res(pedido && 'result' in pedido ? pedido.result : undefined);
        tx.onerror = () => rej(tx.error || new Error('error de IndexedDB'));
        tx.onabort = () => rej(tx.error || new Error('transaccion abortada'));
    });
}

/**
 * Borra las sesiones mas viejas hasta dejar TOPE.
 *
 * Se hace despues de cada guardado: si no, la cuota se llena con las fotos de
 * hace un mes y el guardado nuevo falla silenciosamente, que es justo lo que
 * el cliente no puede ver.
 */
async function podar(db) {
    const lista = await new Promise((res, rej) => {
        const salida = [];
        let tx;
        try { tx = db.transaction(ALMACEN, 'readonly'); } catch (e) { return rej(e); }
        const peticion = tx.objectStore(ALMACEN).openCursor();
        peticion.onsuccess = () => {
            const cur = peticion.result;
            if (!cur) { res(salida); return; }
            salida.push({ clave: cur.value.clave, cuando: cur.value.cuando || 0 });
            cur.continue();
        };
        peticion.onerror = () => rej(peticion.error);
        tx.onabort = () => rej(tx.error);
    }).catch(() => null);
    if (!lista || lista.length <= TOPE) return;
    lista.sort((a, b) => (a.cuando || 0) - (b.cuando || 0));
    const aFuera = lista.slice(0, lista.length - TOPE);
    await enTx(db, 'readwrite', (alm) => {
        for (const entrada of aFuera) alm.delete(entrada.clave);
        return null;
    }).catch(() => false);
}

/**
 * Guarda el paquete de una sesion. Devuelve false si no se pudo guardar.
 *
 * `paquete` es texto y binario sin referencias a objetos de la pagina:
 *   clave, cuando, modelo, ancho, alto, caja, params, base, basePng, original
 */
export async function guardar(clave, paquete) {
    if (!clave || !paquete) return false;
    try {
        const db = await abrir();
        await enTx(db, 'readwrite', (alm) => alm.put({ ...paquete, clave, cuando: Date.now() }));
        await podar(db);
        return true;
    } catch (e) {
        ultError = e;
        try { console.warn('[EKKO FONDO] no se pudo guardar la sesion:', e && e.message); } catch (_) {}
        return false;
    }
}

export async function leer(clave) {
    if (!clave) return null;
    try {
        const db = await abrir();
        return (await enTx(db, 'readonly', (alm) => alm.get(clave))) || null;
    } catch (e) {
        ultError = e;
        return null;
    }
}

export async function borrar(clave) {
    if (!clave) return false;
    try {
        const db = await abrir();
        await enTx(db, 'readwrite', (alm) => alm.delete(clave));
        return true;
    } catch (e) {
        ultError = e;
        return false;
    }
}

/** Estado para diagnostico: si el almacen vive o porque no. */
export function estadoAlmacen() {
    return { nombre: NOMBRE_BD, tope: TOPE, error: ultError && (ultError.message || String(ultError)) || null };
}
