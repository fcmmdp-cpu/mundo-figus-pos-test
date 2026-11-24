// demo-datos.js — SOLO PARA LA VERSIÓN TEST. Genera ventas ficticias para probar Estadísticas.
//
// Seguridad: en el navegador se niega a escribir si la base no es la de prueba
// (mundoFigusPOS_TEST). Aunque alguien copiara este archivo a la caja real, no
// puede tocar la base real. Los datos son inventados (no son ventas reales).

(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ARTICULOS = [
    ['A001', 'Sobre Mundial 2026 (x5)', 'Figuritas', 'Mundial 2026', 600, 1000],
    ['A002', 'Sobre Pokémon (x4)', 'Figuritas', 'Pokémon', 700, 1200],
    ['A003', 'Sobre Dragon Ball (x4)', 'Figuritas', 'Dragon Ball', 800, 1300],
    ['A010', 'Álbum Mundial 2026 tapa blanda', 'Álbumes', 'Mundial 2026', 3500, 6000],
    ['A011', 'Álbum Pokémon', 'Álbumes', 'Pokémon', 4000, 7000],
    ['A020', 'Mazo naipes español', 'Naipes', 'Naipes', 1500, 2800],
    ['A021', 'Mazo Truco Argentina', 'Naipes', 'Naipes', 1800, 3200],
    ['A030', 'Extensión Pokémon (sobre)', 'Extensiones', 'Pokémon', 900, 1600],
    ['A031', 'Extensión Mundial (sobre)', 'Extensiones', 'Mundial 2026', 1100, 1900],
    ['A040', 'Carpeta 9 bolsillos', 'Otros', '', 2000, 3500],
    ['A041', 'Portamazo rígido', 'Otros', '', 500, 900],
  ].map(([ID, Articulo, Categoria, Coleccion, PCosto, PVenta]) => ({
    ID, Articulo, Categoria, Coleccion, PCosto, PVenta, Stock: 500, Activo: 'Sí', MostrarEnCaja: 'Sí',
  }));

  const COMBOS = [
    { IDCombo: 'C001', Nombre: 'Álbum + 20 sobres', Coleccion: 'Mundial 2026', PrecioVenta: 22000, Activo: 'Sí', CostoCombo: 15500 },
    { IDCombo: 'C002', Nombre: 'Álbum + 20 sobres', Coleccion: 'Pokémon', PrecioVenta: 26000, Activo: 'Sí', CostoCombo: 18000 },
    { IDCombo: 'C003', Nombre: 'Mazo + 5 sobres', Coleccion: 'Mundial 2026', PrecioVenta: 7000, Activo: 'Sí', CostoCombo: 4500 },
  ];

  const DETALLE_COMBOS = [
    { IDCombo: 'C001', IDArticulo: 'A010', Cantidad: 1 }, { IDCombo: 'C001', IDArticulo: 'A001', Cantidad: 20 },
    { IDCombo: 'C002', IDArticulo: 'A011', Cantidad: 1 }, { IDCombo: 'C002', IDArticulo: 'A002', Cantidad: 20 },
    { IDCombo: 'C003', IDArticulo: 'A020', Cantidad: 1 }, { IDCombo: 'C003', IDArticulo: 'A001', Cantidad: 5 },
  ];

  // Peso relativo de cada hora de feria (10 a 19 h).
  const PESO_HORA = { 10: 0.5, 11: 1.2, 12: 1.8, 13: 1.4, 14: 0.7, 15: 1.1, 16: 1.6, 17: 1.9, 18: 1.2, 19: 0.5 };

  function fechaMas(hoy, dias) {
    const [y, m, d] = hoy.split('-').map(Number);
    const f = new Date(y, m - 1, d + dias);
    const p = (n) => String(n).padStart(2, '0');
    return `${f.getFullYear()}-${p(f.getMonth() + 1)}-${p(f.getDate())}`;
  }

  // Devuelve { articulos, combos, detalleCombos, ventas } deterministas para una semilla.
  function generarDemo({ hoy, semilla = 2026, offsets = [-15, -14, -8, -7, -1, 0] }) {
    const rnd = mulberry32(semilla);
    const entre = (a, b) => a + rnd() * (b - a);
    const entero = (a, b) => Math.floor(entre(a, b + 1));
    const elegirPonderado = (pesos) => {
      const total = Object.values(pesos).reduce((x, y) => x + y, 0);
      let r = rnd() * total;
      for (const k of Object.keys(pesos)) { r -= pesos[k]; if (r <= 0) return k; }
      return Object.keys(pesos)[0];
    };

    const artPorId = Object.fromEntries(ARTICULOS.map((a) => [a.ID, a]));
    const comboPorId = Object.fromEntries(COMBOS.map((c) => [c.IDCombo, c]));
    // Productos vendibles con su peso de popularidad.
    const catalogoVenta = [
      ['A', 'A001', 6], ['A', 'A002', 4], ['A', 'A003', 3], ['A', 'A010', 2], ['A', 'A011', 1.5],
      ['A', 'A020', 2], ['A', 'A021', 1], ['A', 'A030', 1.5], ['A', 'A031', 1.5], ['A', 'A040', 0.8],
      ['A', 'A041', 0.8], ['C', 'C001', 0.9], ['C', 'C002', 0.7], ['C', 'C003', 0.8],
    ];
    const pesoTotal = catalogoVenta.reduce((acc, p) => acc + p[2], 0);
    const elegirProducto = () => {
      let r = rnd() * pesoTotal;
      for (const p of catalogoVenta) { r -= p[2]; if (r <= 0) return p; }
      return catalogoVenta[0];
    };

    const ventas = [];
    offsets.forEach((off, idxJ) => {
      const fecha = fechaMas(hoy, off);
      const [y, m, d] = fecha.split('-').map(Number);
      const cantidad = entero(60, 170);
      for (let n = 0; n < cantidad; n++) {
        const h = Number(elegirPonderado(PESO_HORA));
        const min = entero(0, 59);
        const seg = entero(0, 59);
        const ts = new Date(y, m - 1, d, h, min, seg).getTime();

        // Líneas del ticket (1 a 4 productos distintos).
        const lineasMapa = new Map();
        const cantLineas = entero(1, 4);
        for (let l = 0; l < cantLineas; l++) {
          const [tipo, id] = elegirProducto();
          const esSobre = tipo === 'A' && artPorId[id].Categoria === 'Figuritas';
          const q = tipo === 'C' ? 1 : (esSobre ? entero(1, 6) : entero(1, 2));
          const key = tipo + id;
          lineasMapa.set(key, { tipo, id, q: (lineasMapa.get(key)?.q || 0) + q });
        }
        const lineas = Array.from(lineasMapa.values());

        let subtotal = 0;
        const base = lineas.map((l) => {
          const precio = l.tipo === 'A' ? artPorId[l.id].PVenta : comboPorId[l.id].PrecioVenta;
          const costoU = l.tipo === 'A' ? artPorId[l.id].PCosto : comboPorId[l.id].CostoCombo;
          const nombre = l.tipo === 'A' ? artPorId[l.id].Articulo : comboPorId[l.id].Nombre;
          const sub = precio * l.q;
          subtotal += sub;
          return { l, precio, costoU, nombre, sub };
        });

        let descuento = 0;
        if (rnd() < 0.12) descuento = Math.round((subtotal * entre(0.03, 0.12)) / 100) * 100;
        const totalCobrado = subtotal - descuento;

        let costoTotal = 0;
        const detalle = base.map(({ l, precio, costoU, nombre, sub }) => {
          const proporcion = subtotal > 0 ? sub / subtotal : 0;
          const descLinea = Math.round(descuento * proporcion * 100) / 100;
          const costoLinea = costoU * l.q;
          costoTotal += costoLinea;
          return {
            Tipo: l.tipo === 'A' ? 'Artículo' : 'Combo', IDProducto: l.id, Articulo: nombre,
            Cantidad: l.q, PrecioUnitario: precio, SubtotalLinea: sub, DescuentoLinea: descLinea,
            CostoUnitario: costoU, CostoTotal: costoLinea, GananciaLinea: sub - descLinea - costoLinea,
          };
        });

        const r = rnd();
        let tipoPago = 'Efectivo', efectivo = totalCobrado, transferencia = 0;
        if (r > 0.9) {
          tipoPago = 'Mixto';
          efectivo = Math.round((totalCobrado * entre(0.2, 0.8)) / 100) * 100;
          transferencia = totalCobrado - efectivo;
        } else if (r > 0.6) {
          tipoPago = 'Transferencia'; efectivo = 0; transferencia = totalCobrado;
        }

        const pad = (x) => String(x).padStart(2, '0');
        const idVenta = `VTA-DEVDEMO-${ts}-${(1000 + n * 7 + idxJ).toString(36).toUpperCase()}`;
        ventas.push({
          IDVenta: idVenta, Fecha: fecha, Hora: `${pad(h)}:${pad(min)}`, Timestamp: ts,
          Canal: 'Feria', Cliente: '', Localidad: '',
          Subtotal: subtotal, Descuento: descuento, TotalCobrado: totalCobrado,
          Efectivo: efectivo, Transferencia: transferencia, TipoPago: tipoPago,
          CostoTotal: costoTotal, Ganancia: totalCobrado - costoTotal,
          Estado: rnd() < 0.03 ? 'Anulada' : 'Confirmada',
          detalle: detalle.map((x) => Object.assign({ IDVenta: idVenta }, x)),
          syncStatus: 'sincronizada',
        });
      }
    });

    // Ventas "viejas" sin Timestamp (como las anteriores a la corrección de hora local).
    ventas.filter((v) => v.Fecha === fechaMas(hoy, offsets[0])).slice(0, 5).forEach((v) => { delete v.Timestamp; });

    return { articulos: ARTICULOS, combos: COMBOS, detalleCombos: DETALLE_COMBOS, ventas };
  }

  // Solo navegador: carga/borra la base de PRUEBA.
  async function cargarEnBase(opciones) {
    if (typeof DB_NAME === 'undefined' || DB_NAME !== 'mundoFigusPOS_TEST') {
      throw new Error('Esta carga solo funciona en la versión TEST (base mundoFigusPOS_TEST).');
    }
    await DB.openDB();
    // Protección: esta carga VACÍA las ventas. Si hay ventas que no son de demostración
    // (por ejemplo un historial real importado), se niega para no destruirlas.
    const previas = await DB.getAll('ventas');
    if (previas.some((v) => !String(v.IDVenta).startsWith('VTA-DEVDEMO-'))) {
      throw new Error('La base TEST tiene ventas importadas (no son de demostración). No se cargó nada. Si querés usar los datos de demostración, primero tocá "Borrar todo lo de la versión TEST".');
    }
    for (const s of ['articulos', 'combos', 'detalleCombos', 'ventas', 'syncQueue', 'espera']) await DB.clearStore(s);
    const dato = generarDemo(opciones);
    await DB.putAll('articulos', dato.articulos);
    await DB.putAll('combos', dato.combos);
    await DB.putAll('detalleCombos', dato.detalleCombos);
    await DB.putAll('ventas', dato.ventas);
    return dato.ventas.length;
  }

  async function borrarBase() {
    if (typeof DB_NAME === 'undefined' || DB_NAME !== 'mundoFigusPOS_TEST') {
      throw new Error('Esta acción solo funciona en la versión TEST (base mundoFigusPOS_TEST).');
    }
    await DB.openDB();
    for (const s of ['articulos', 'combos', 'detalleCombos', 'ventas', 'syncQueue', 'espera']) await DB.clearStore(s);
  }

  const API = { generarDemo, cargarEnBase, borrarBase, fechaMas };
  if (typeof window !== 'undefined') window.DemoDatos = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
