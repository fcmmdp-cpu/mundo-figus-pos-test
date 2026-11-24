// importar-test.js — "Importar historial de ventas".  EXISTE SOLO EN MF TEST.
//
// Este archivo NO forma parte de la caja real: no está en el proyecto de producción,
// ni en su lista de archivos cacheados. Además, por seguridad adicional, toda
// escritura exige que la base abierta sea `mundoFigusPOS_TEST`; en cualquier otra
// base se niega a escribir (lanza error) y la pantalla de importación se oculta.
//
// Garantías de la importación:
//   - Valida TODO el archivo antes de tocar la base. Un solo error => no se importa nada.
//   - Nunca pisa una venta existente: solo agrega IDVenta que todavía no están.
//     (Si un IDVenta ya existe con contenido distinto, queda el local y se informa.)
//   - Escribe solo en el store `ventas`, en UNA transacción (todo o nada), con add().
//   - No encola nada en syncQueue, no toca stock/catálogo/config y no usa la red.
//     (Además esta versión TEST no tiene URL de Google Sheets: no puede sincronizar.)

const Importador = (() => {
  const BASE_TEST = 'mundoFigusPOS_TEST';
  const MAX_BYTES = 100 * 1024 * 1024;
  const MAX_VENTAS = 200000;
  const MAX_ERRORES = 15;
  const ESTADOS = ['Confirmada', 'Anulada'];
  const SYNC = ['pendiente', 'sincronizada'];
  const PAGOS = ['Efectivo', 'Transferencia', 'Mixto'];
  const NUM_VENTA = ['Subtotal', 'Descuento', 'TotalCobrado', 'Efectivo', 'Transferencia', 'CostoTotal', 'Ganancia'];
  const NUM_LINEA = ['PrecioUnitario', 'SubtotalLinea', 'DescuentoLinea', 'CostoUnitario', 'CostoTotal', 'GananciaLinea'];

  const esTest = () => typeof DB_NAME === 'string' && DB_NAME === BASE_TEST;
  const esNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  function fechaValida(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [a, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // Serialización canónica (claves ordenadas) para comparar dos ventas.
  function canon(x) {
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (esObj(x)) return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }

  // ---------- Validación estructural de una venta ----------
  function validarVenta(v, i, errores, advertencias) {
    const id = esObj(v) && typeof v.IDVenta === 'string' ? v.IDVenta : null;
    const ref = `Venta #${i + 1}` + (id ? ` (${id})` : '');
    const err = (m) => errores.push(`${ref}: ${m}`);
    const adv = (m) => advertencias.push(`${ref}: ${m}`);
    if (!esObj(v)) { err('no es un objeto.'); return; }
    if (!id || !id.trim() || id.length > 100) err('IDVenta ausente o inválido.');
    if (!fechaValida(v.Fecha)) err('Fecha inválida (se espera AAAA-MM-DD).');
    if (typeof v.Hora !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v.Hora)) err('Hora inválida (se espera HH:MM).');
    // Las ventas anteriores a la corrección de hora local pueden no tener Timestamp: se acepta, con aviso.
    if (v.Timestamp === undefined) adv('sin Timestamp (se usará la Hora para ordenar).');
    else if (!esNum(v.Timestamp) || v.Timestamp <= 0) err('Timestamp inválido.');
    if (!ESTADOS.includes(v.Estado)) err(`Estado inválido (${JSON.stringify(v.Estado)}).`);
    if (!SYNC.includes(v.syncStatus)) err(`syncStatus inválido (${JSON.stringify(v.syncStatus)}).`);
    if (!PAGOS.includes(v.TipoPago)) err(`TipoPago inválido (${JSON.stringify(v.TipoPago)}).`);
    if (!esNum(v.TotalCobrado) || v.TotalCobrado < 0) err('TotalCobrado inválido.');
    for (const k of NUM_VENTA) {
      if (k === 'TotalCobrado') continue;
      if (v[k] === undefined) adv(`falta ${k}.`);
      else if (!esNum(v[k])) err(`${k} no es un número.`);
    }
    if (!Array.isArray(v.detalle) || v.detalle.length === 0) { err('detalle ausente o vacío.'); return; }
    let sumaSub = 0, sumaOk = true;
    v.detalle.forEach((l, j) => {
      const e2 = (m) => err(`línea ${j + 1}: ${m}`);
      if (!esObj(l)) { e2('no es un objeto.'); sumaOk = false; return; }
      if (l.IDVenta !== v.IDVenta) e2('IDVenta de la línea no coincide con la venta.');
      if (l.Tipo !== 'Artículo' && l.Tipo !== 'Combo') e2(`Tipo inválido (${JSON.stringify(l.Tipo)}).`);
      if (typeof l.Articulo !== 'string' || !l.Articulo) e2('Articulo (nombre) ausente.');
      if (!esNum(l.Cantidad) || l.Cantidad <= 0) e2('Cantidad inválida.');
      for (const k of NUM_LINEA) {
        if (l[k] === undefined) adv(`línea ${j + 1}: falta ${k}.`);
        else if (!esNum(l[k])) e2(`${k} no es un número.`);
      }
      if (esNum(l.SubtotalLinea)) sumaSub += l.SubtotalLinea; else sumaOk = false;
    });
    // Coherencias numéricas: solo avisan (no bloquean).
    if (sumaOk && esNum(v.Subtotal) && Math.abs(sumaSub - v.Subtotal) > 0.01) adv(`la suma de líneas (${sumaSub}) no coincide con Subtotal (${v.Subtotal}).`);
    if (esNum(v.Efectivo) && esNum(v.Transferencia) && esNum(v.TotalCobrado) &&
        Math.abs(v.Efectivo + v.Transferencia - v.TotalCobrado) > 0.01) adv('Efectivo + Transferencia no coincide con TotalCobrado.');
  }

  // ---------- Validación de todo el archivo ----------
  // `texto`: contenido del archivo. `bytes`: tamaño (opcional). Devuelve {ok, errores, advertencias, respaldo}.
  async function validar(texto, bytes) {
    const errores = [], advertencias = [];
    const fin = () => ({ ok: errores.length === 0, errores, advertencias, respaldo: errores.length === 0 ? datos : null });
    let datos = null;
    if (typeof bytes === 'number' && bytes > MAX_BYTES) { errores.push('El archivo es demasiado grande (más de 100 MB).'); return fin(); }
    if (typeof texto !== 'string' || !texto.trim()) { errores.push('El archivo está vacío.'); return fin(); }
    try { datos = JSON.parse(texto); } catch (e) { errores.push('No es un JSON válido (el archivo está dañado o no es un respaldo).'); datos = null; return fin(); }
    if (!esObj(datos)) { errores.push('La estructura no corresponde a un respaldo de ventas.'); datos = null; return fin(); }
    if (datos.formato !== Respaldo.FORMATO) { errores.push('Este archivo no es un respaldo de ventas de Mundo Figus POS (campo "formato" incorrecto).'); datos = null; return fin(); }
    if (datos.version !== Respaldo.VERSION) { errores.push(`Versión de respaldo no soportada (${JSON.stringify(datos.version)}).`); datos = null; return fin(); }
    if (!Array.isArray(datos.ventas)) { errores.push('El archivo no contiene la lista de ventas.'); datos = null; return fin(); }
    if (datos.ventas.length === 0) { errores.push('El respaldo no contiene ninguna venta.'); datos = null; return fin(); }
    if (datos.ventas.length > MAX_VENTAS) { errores.push('El respaldo tiene demasiadas ventas.'); datos = null; return fin(); }
    if (!esObj(datos.resumen)) errores.push('Falta el resumen del respaldo.');
    if (typeof datos.huella !== 'string') errores.push('Falta la huella de integridad.');

    // IDVenta repetidos dentro del archivo
    const vistos = new Set(); const repetidos = [];
    datos.ventas.forEach((v) => {
      const id = esObj(v) ? v.IDVenta : undefined;
      if (typeof id === 'string') { if (vistos.has(id)) repetidos.push(id); vistos.add(id); }
    });
    if (repetidos.length) errores.push(`Hay ${repetidos.length} IDVenta repetidos dentro del archivo (por ej. ${repetidos[0]}).`);

    // Cada venta
    const errVentas = [], advVentas = [];
    datos.ventas.forEach((v, i) => validarVenta(v, i, errVentas, advVentas));
    errVentas.slice(0, MAX_ERRORES).forEach((m) => errores.push(m));
    if (errVentas.length > MAX_ERRORES) errores.push(`… y ${errVentas.length - MAX_ERRORES} errores más.`);
    advVentas.slice(0, 5).forEach((m) => advertencias.push(m));
    if (advVentas.length > 5) advertencias.push(`… y ${advVentas.length - 5} advertencias más.`);

    // Integridad (solo si la estructura básica es sana, para no dar ruido)
    if (!errVentas.length && !repetidos.length && esObj(datos.resumen) && typeof datos.huella === 'string') {
      const h = await Respaldo.huella(JSON.stringify(datos.ventas));
      if (h !== datos.huella) errores.push('La huella de integridad no coincide: el archivo fue modificado o se dañó después de exportarlo.');
      const real = Respaldo.resumir(datos.ventas);
      for (const k of ['totalVentas', 'confirmadas', 'anuladas', 'lineasDetalle', 'totalCobradoConfirmadas']) {
        if (datos.resumen[k] !== real[k]) errores.push(`El resumen declarado no coincide con el contenido (${k}: declara ${datos.resumen[k]}, contiene ${real[k]}).`);
      }
    }
    return fin();
  }

  // ---------- Plan de importación (función pura) ----------
  function planificar(ventasArchivo, existentes) {
    const porId = new Map(existentes.map((v) => [v.IDVenta, v]));
    const nuevas = [], iguales = [], conflictos = [];
    for (const v of ventasArchivo) {
      const ya = porId.get(v.IDVenta);
      if (!ya) nuevas.push(v);
      else if (canon(ya) === canon(v)) iguales.push(v.IDVenta);
      else conflictos.push(v.IDVenta);
    }
    return { nuevas, iguales, conflictos };
  }

  // ---------- Escritura: única operación que modifica la base ----------
  // add() (no put): si un IDVenta existiera, falla y la transacción entera se aborta.
  async function aplicar(nuevas) {
    if (!esTest()) throw new Error('Importación bloqueada: solo se permite en la base de la versión TEST.');
    if (!nuevas.length) return 0;
    const db = await DB.openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('ventas', 'readwrite');
      const store = t.objectStore('ventas');
      nuevas.forEach((v) => store.add(v));
      t.oncomplete = () => resolve(nuevas.length);
      t.onerror = () => reject(t.error || new Error('Error al escribir.'));
      t.onabort = () => reject(t.error || new Error('Importación abortada: no se guardó nada.'));
    });
  }

  // ---------- Pantalla ----------
  function init() {
    const bloque = document.getElementById('bloqueImportar');
    if (!bloque) return;
    if (!esTest()) { bloque.style.display = 'none'; return; }
    const input = document.getElementById('inputImportarArchivo');
    const btnElegir = document.getElementById('btnImportarElegir');
    const btnOk = document.getElementById('btnImportarConfirmar');
    const info = document.getElementById('importarInfo');
    let pendiente = null;

    // En la tablet el modal desplaza: se acerca el mensaje (y el botón) a la vista.
    const mostrar = (t) => { info.textContent = t; try { info.scrollIntoView({ block: 'nearest' }); } catch (e) { /* sin scroll */ } };
    const reset = () => { pendiente = null; btnOk.classList.add('hidden'); input.value = ''; };

    // Se vacía el campo para que elegir dos veces el mismo archivo vuelva a disparar la lectura.
    btnElegir.addEventListener('click', () => { input.value = ''; input.click(); });
    input.addEventListener('change', async () => {
      pendiente = null; btnOk.classList.add('hidden');
      const f = input.files && input.files[0];
      if (!f) return;
      input.value = ''; // el objeto File sigue siendo válido
      mostrar('Leyendo y validando ' + f.name + '…');
      try {
        const texto = await f.text();
        const r = await validar(texto, f.size);
        if (!r.ok) {
          mostrar('NO SE IMPORTÓ NADA. El archivo no es válido:\n• ' + r.errores.join('\n• '));
          return;
        }
        const existentes = await DB.getAll('ventas');
        const plan = planificar(r.respaldo.ventas, existentes);
        const s = r.respaldo.resumen;
        const lineas = [
          `Archivo válido: ${f.name}`,
          `Contiene ${s.totalVentas} ventas (${s.confirmadas} confirmadas, ${s.anuladas} anuladas), ${s.fechaDesde} a ${s.fechaHasta}.`,
          `Nuevas para importar: ${plan.nuevas.length}`,
          `Ya existentes e idénticas (se omiten): ${plan.iguales.length}`,
        ];
        if (plan.conflictos.length) lineas.push(`Ya existentes pero DIFERENTES (se conserva la local, no se pisa): ${plan.conflictos.length}`);
        if (r.advertencias.length) lineas.push('Advertencias (no bloquean):\n• ' + r.advertencias.join('\n• '));
        if (plan.nuevas.length === 0) lineas.push('No hay nada nuevo que importar.');
        mostrar(lineas.join('\n'));
        if (plan.nuevas.length) {
          pendiente = plan;
          btnOk.textContent = `IMPORTAR ${plan.nuevas.length} VENTAS NUEVAS`;
          btnOk.classList.remove('hidden');
          try { btnOk.scrollIntoView({ block: 'nearest' }); } catch (e) { /* sin scroll */ }
        }
      } catch (e) {
        console.error('Importador:', e);
        mostrar('NO SE IMPORTÓ NADA. Error al leer el archivo: ' + (e && e.message ? e.message : e));
      }
    });

    btnOk.addEventListener('click', async () => {
      if (!pendiente) return;
      const plan = pendiente;
      btnOk.disabled = true;
      try {
        const n = await aplicar(plan.nuevas);
        mostrar(`Importación terminada: ${n} ventas agregadas. Omitidas por ya existir: ${plan.iguales.length + plan.conflictos.length}. ` +
                'Abrí Estadísticas para verlas.');
      } catch (e) {
        console.error('Importador:', e);
        mostrar('La importación falló y NO se guardó nada: ' + (e && e.message ? e.message : e));
      } finally {
        btnOk.disabled = false;
        reset();
      }
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      try { init(); } catch (e) { console.error('Importador (init):', e); }
    });
  }

  const API = { validar, planificar, aplicar, canon, esTest };
  if (typeof window !== 'undefined') window.Importador = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  return API;
})();
