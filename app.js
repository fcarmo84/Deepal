/* Carga Barata — planeador de carregamentos pelo custo real.
   Tudo corre no navegador. As definições e a casa ficam guardadas só neste dispositivo. */
'use strict';

/* ---------------- carros ----------------
   Curvas de carregamento (kW por % de bateria) segundo EVKX; modelo físico de consumo
   calibrado para valores reais em autoestrada. */
const CARS = {
  deepal: { name: 'Deepal S07', short: 'Deepal S07', sub: '77,6 kWh', cap: 77.6, tesla: false,
    phys: { cda: 0.65, massKg: 2050, crr: 0.009, drive: 0.88, auxKw: 0.5 },
    curve: [1,10,19,29,38,47,56,65,75,84,93,92,91,91,90,89,88,87,87,86,85,84,83,82,82,81,80,79,78,78,77,76,75,74,74,73,72,71,70,69,69,68,67,66,65,65,64,63,62,61,61,60,59,58,57,57,56,55,54,53,52,52,51,50,49,48,48,47,46,45,44,44,43,42,41,40,39,39,38,37,36,35,35,34,33,32,31,31,30,29,28,27,26,26,25,24,23,22,22,21,20] },
  m3rwd: { name: 'Model 3 RWD', short: 'M3 RWD', sub: '57,5 kWh', cap: 57.5, tesla: true,
    phys: { cda: 0.55, massKg: 1820, crr: 0.008, drive: 0.89, auxKw: 0.4 },
    curve: [50,62,74,86,98,110,121,133,145,157,169,168,160,151,146,141,138,135,133,130,129,128,127,126,125,124,124,123,122,121,120,119,116,115,114,112,110,109,108,106,104,103,101,100,97,95,94,92,90,88,86,84,82,80,79,77,75,73,71,70,68,66,65,64,62,60,58,57,56,55,53,52,51,50,48,47,46,46,45,44,43,43,42,41,40,39,38,37,37,35,34,31,28,25,22,20,17,14,11,8,5] },
  m3lr: { name: 'Model 3 Long Range', short: 'M3 LR', sub: 'Long Range · 75 kWh', cap: 75, tesla: true,
    phys: { cda: 0.55, massKg: 1880, crr: 0.008, drive: 0.90, auxKw: 0.4 },
    curve: [100,103,108,108,108,108,230,235,240,245,249,249,249,249,249,249,241,238,234,231,228,224,219,215,208,207,202,196,191,186,184,179,175,169,165,159,156,152,147,143,140,135,130,125,121,116,112,108,104,100,96,92,89,87,85,84,82,80,80,79,78,77,75,74,73,71,69,67,64,64,62,61,59,58,57,55,54,52,49,47,45,43,42,40,39,37,37,35,34,32,30,29,28,28,27,26,26,25,22,18,13] },
};
const CAR = () => CARS[S.car] || CARS.deepal;
function consAt(v){
  const m = CAR().phys, ms = v / 3.6, rho = 1.2;
  const aero = 0.5 * rho * m.cda * ms * ms, roll = m.crr * m.massKg * 9.81;   // N = J/m
  const wheel = (aero + roll) * 100000 / 3.6e6;                                 // kWh/100 km
  return wheel / m.drive + m.auxKw * 100 / v;
}
const consNow = () => consAt(S.cruise) * S.consAdj / 100;
// tempo: o OSRM conta com os limites (120 km/h nas autoestradas); ~70 % do tempo é autoestrada
const speedFactor = () => 0.3 + 0.7 * 120 / Math.max(60, S.cruise);
const driveFactor = () => S.timeFactor / 100 * speedFactor();

const ES_OPS = [
  ['Zunder', 0.59], ['Tesla', 0.55], ['Iberdrola', 0.49], ['IONITY', 0.69],
  ['Endesa', 0.59], ['Wenea', 0.56], ['Atlante', 0.39], ['Electra', 0.49], ['Fastned', 0.59]
];
// chave partilhada definida no GitHub (secret OCM_KEY), injetada em config.js na publicação
const SITE_OCM_KEY = (window.CARGA_CONFIG && window.CARGA_CONFIG.ocmKey) || '';
const ocmKey = () => S.ocmKey || SITE_OCM_KEY;
const DEFAULTS = {
  car: 'deepal', cap: 77.6, cruise: 120, consAdj: 100, soc0: 100, resStop: 10, resEnd: 15, eff: 95,
  timeFactor: 90, minStop: 20, meal: true, mealMin: 45, maxLeg: 230, minGap: 80, timeVal: 10,
  ptPrice: 0.49, cbAtl: 50, cbOther: 20, gemVal: 100, teslaOwner: 0.38,
  ptMode: 'go', goInclOpc: true, cemePrice: 0.15, egme: 0.1088, vat: 23, opcGuess: 0.20,
  esPrices: Object.fromEntries(ES_OPS), esOther: 0.55,
  detourF: 1.3, skipBroken: true, ocmKey: '', ret: false, retPct: 40,
  home: null, from: null, to: null,
  stops: 0, alt: 0, avoid: {}, force: {}, target: {}, filter: 'all'
};
const KEY = 'carga-barata-v1';
let S = load();
function load(){
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  try { const raw = localStorage.getItem(KEY); if (raw) { const v = JSON.parse(raw); Object.assign(s, v); s.esPrices = Object.assign({}, DEFAULTS.esPrices, v.esPrices || {}); } } catch (e) {}
  return s;
}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* ---------------- utilitários ---------------- */
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtE = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace('.', ',') + ' €';
const fmtP = v => v.toFixed(2).replace('.', ',');
const fmtMin = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${String(r).padStart(2, '0')}` : `${r} min`; };
const fmtKm = k => Math.round(k) + ' km';
const R_EARTH = 6371;
function hav(lat1, lon1, lat2, lon2){
  const r = Math.PI / 180, dLa = (lat2 - lat1) * r, dLo = (lon2 - lon1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}
function setStatus(msg, err){ const el = $('status'); if (!msg) { el.hidden = true; return; } el.hidden = false; el.className = 'status' + (err ? ' err' : ''); el.textContent = msg; }

/* ---------------- dados dos postos ---------------- */
let PT = [], ES = [], PT_DATE = '', PT_TARIFFS = null;
async function loadData(){
  try {
    const [pt, es] = await Promise.all([fetch('data/pt-stations.json').then(r => r.json()), fetch('data/es-stations.json').then(r => r.json())]);
    PT_DATE = pt.updated; PT_TARIFFS = pt.tariffs_updated || null;
    PT = pt.sites.map(r => ({ id: 'pt:' + r[0] + ':' + r[8] + ',' + r[9], n: r[1], c: r[2], o: opName(r[3], r[4]), a: !!r[4], kw: r[5], p: r[6], st: r[7], la: r[8], lo: r[9], cc: 'PT', opc: r[10] || null }));
    ES = es.sites.map(s => ({ id: 'es:' + s.name, n: s.name, c: s.city, o: s.operator, a: false, kw: s.kw, p: s.points, st: 'unknown', la: s.lat, lo: s.lon, cc: 'ES', manual: true }));
    $('pt-date').textContent = 'atualizado a ' + new Date(PT_DATE).toLocaleDateString('pt-PT');
  } catch (e) {
    setStatus('Não consegui carregar a lista de postos. Recarrega a página.', true);
  }
}
function opName(o, atl){
  if (atl) return 'Atlante';
  const m = [['REPSOL','Repsol'],['Galp','Galp'],['Iberdrola','Iberdrola | bp pulse'],['EDP','EDP'],['Powerdot','Powerdot'],['IONITY','IONITY'],['Prio','PRIO'],['Cepsa','Cepsa'],['Continente','Continente'],['EVIO','EVIO'],['MOTA','Mota-Engil'],['Tesla','Tesla'],['Helexia','Helexia'],['Mobiletric','Mobiletric'],['Zunder','Zunder'],['Plenitude','Plenitude'],['Fastned','Fastned'],['Electra','Electra']];
  for (const [k, v] of m) if ((o || '').toLowerCase().includes(k.toLowerCase())) return v;
  return (o || 'Operador desconhecido').split(',')[0].slice(0, 28);
}

/* ---------------- pesquisa de locais (Nominatim) ---------------- */
async function geocode(q){
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=pt&countrycodes=pt,es,fr,ad&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('pesquisa ' + r.status);
  return (await r.json()).map(p => ({ name: shortName(p), full: p.display_name, lat: +p.lat, lon: +p.lon }));
}
function shortName(p){ const parts = (p.display_name || '').split(',').map(s => s.trim()); return parts.slice(0, 2).join(', '); }

function bindPlace(which){
  const input = $(which), list = $(which + '-sugg');
  const show = items => {
    list.innerHTML = items.map((it, i) => `<li><button type="button" data-i="${i}">${esc(it.name)}<small>${esc(it.full || '')}</small></button></li>`).join('');
    list.hidden = !items.length;
    list.querySelectorAll('button').forEach(b => b.onclick = () => { choose(items[+b.dataset.i]); });
  };
 const choose = it => {
    if (!isFinite(it.lat)) return;
    S[which] = { name: it.name, lat: it.lat, lon: it.lon };
    if (it.setHome) S.home = { name: 'Casa', lat: it.lat, lon: it.lon };
    input.value = it.name; list.hidden = true; save();
  };
  let timer = null, seq = 0;
  input.addEventListener('input', () => {
    S[which] = null;
    clearTimeout(timer);
    const q = input.value.trim();
    const base = [];
    if (S.home && 'casa'.startsWith(q.toLowerCase())) base.push({ name: 'Casa', full: 'A tua casa', lat: S.home.lat, lon: S.home.lon });
    if (q.length < 3) { show(base); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const res = await geocode(q);
        if (my !== seq) return;
        const items = base.concat(res);
        if (!S.home && which === 'from') res.slice(0, 2).forEach(r => items.push({ ...r, name: r.name, full: 'Guardar como a minha casa', setHome: true }));
        show(items.length ? items : [{ name: 'Sem resultados', full: 'Tenta outro nome', lat: NaN }]);
      } catch (e) { show([{ name: 'A pesquisa falhou', full: 'Verifica a ligação à internet', lat: NaN }]); }
    }, 450);
  });
  input.addEventListener('focus', () => { if (!input.value && S.home) show([{ name: 'Casa', full: 'A tua casa', lat: S.home.lat, lon: S.home.lon }]); });
  document.addEventListener('click', e => { if (!list.contains(e.target) && e.target !== input) list.hidden = true; });
  return { choose };
}

/* ---------------- rota (OSRM) ---------------- */
async function fetchRoutes(a, b){
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&alternatives=2&steps=false`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('rota ' + r.status);
  const j = await r.json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error('sem rota');
  return j.routes.map(rt => prepareRoute(rt.geometry.coordinates, rt.distance / 1000, rt.duration / 60));
}
function prepareRoute(coords, km, min){
  // pontos de amostragem a cada ~0,5 km com quilómetro acumulado (escalado à distância do OSRM)
  const pts = []; let cum = 0;
  for (let i = 0; i < coords.length; i++) {
    const [lo, la] = coords[i];
    if (i) cum += hav(coords[i - 1][1], coords[i - 1][0], la, lo);
    if (!pts.length || cum - pts[pts.length - 1].km >= 0.5 || i === coords.length - 1) pts.push({ la, lo, km: cum });
  }
  const sc = km / (cum || 1); pts.forEach(p => p.km *= sc);
  const grid = new Map(), cell = 0.05;
  pts.forEach((p, i) => { const k = Math.floor(p.la / cell) + ':' + Math.floor(p.lo / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  pts.forEach(p => { x0 = Math.min(x0, p.lo); x1 = Math.max(x1, p.lo); y0 = Math.min(y0, p.la); y1 = Math.max(y1, p.la); });
  return { coords, pts, grid, cell, km, min, bbox: [x0, y0, x1, y1] };
}
function nearest(rt, la, lo, maxKm){
  const c = rt.cell, gi = Math.floor(la / c), gj = Math.floor(lo / c), span = Math.ceil(maxKm / 4) + 1;
  let best = null;
  for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) {
    const ids = rt.grid.get((gi + a) + ':' + (gj + b)); if (!ids) continue;
    for (const i of ids) { const p = rt.pts[i]; const d = hav(la, lo, p.la, p.lo); if (!best || d < best.d) best = { d, km: p.km }; }
  }
  return best && best.d <= maxKm ? best : null;
}

/* ---------------- postos ao longo da rota ---------------- */
async function stationsFor(rt){
  const [x0, y0, x1, y1] = rt.bbox, pad = 0.15;
  const inBox = s => s.lo >= x0 - pad && s.lo <= x1 + pad && s.la >= y0 - pad && s.la <= y1 + pad;
  const out = [], seen = new Set();
  const add = (s, maxKm) => {
    const n = nearest(rt, s.la, s.lo, maxKm); if (!n) return;
    const key = s.la.toFixed(3) + ',' + s.lo.toFixed(3) + ',' + s.o;
    if (seen.has(key)) { const prev = out.find(o => o.key === key); if (prev) { prev.kw = Math.max(prev.kw, s.kw); prev.p += s.p; if (s.st === 'available') prev.st = 'available'; } return; }
    seen.add(key);
    out.push({ ...s, key, km: Math.max(0.1, Math.min(rt.km - 0.1, n.km)), off: +n.d.toFixed(1) });
  };
  PT.filter(inBox).forEach(s => add(s, s.a ? 10 : 3));
  let ocm = [];
  if (ocmKey()) { try { ocm = await fetchOCM(rt); } catch (e) { console.warn('OCM', e); setStatus('O Open Charge Map não respondeu; uso só a lista manual de Espanha.', true); } }
  if (ocm.length) ocm.filter(inBox).forEach(s => add(s, 3));
  ES.filter(inBox).forEach(s => {
    // se o OCM já trouxe um posto no mesmo sítio, ignora a entrada manual
    if (ocm.some(o => hav(o.la, o.lo, s.la, s.lo) < 1.5 && o.o.toLowerCase().includes(s.o.toLowerCase()))) return;
    add(s, 12);
  });
  out.sort((a, b) => a.km - b.km);
  return out;
}
function encodePolyline(points){
  let out = '', pla = 0, plo = 0;
  const enc = v => { v = v < 0 ? ~(v << 1) : (v << 1); let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of points) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); out += enc(a - pla) + enc(b - plo); pla = a; plo = b; }
  return out;
}
async function fetchOCM(rt){
  // ~1 ponto a cada 8 km chega para um corredor de 3 km
  const step = Math.max(1, Math.floor(rt.pts.length / 120));
  const pts = rt.pts.filter((p, i) => i % step === 0 || i === rt.pts.length - 1).map(p => [p.la, p.lo]);
  const url = 'https://api.openchargemap.io/v3/poi/?output=json&compact=false&verbose=false&maxresults=800&levelid=3&distance=3&distanceunit=km'
    + '&key=' + encodeURIComponent(ocmKey()) + '&polyline=' + encodeURIComponent(encodePolyline(pts));
  const r = await fetch(url);
  if (!r.ok) throw new Error('ocm ' + r.status);
  const j = await r.json();
  return j.map(p => {
    const ai = p.AddressInfo || {}, cc = ai.Country?.ISOCode || '';
    const conns = p.Connections || [];
    const ccs = conns.filter(c => c.ConnectionTypeID === 33 || /CCS/i.test(c.ConnectionType?.Title || ''));
    const kw = Math.max(0, ...ccs.map(c => +c.PowerKW || 0));
    const op = p.OperatorInfo?.Title || 'Operador desconhecido';
    return { id: 'ocm:' + p.ID, n: ai.Title || op, c: ai.Town || '', o: shortOp(op), a: /atlante/i.test(op), kw: kw || 50, p: p.NumberOfPoints || ccs.length || 1,
      st: p.StatusType && p.StatusType.IsOperational === false ? 'outOfOrder' : 'unknown', la: +ai.Latitude, lo: +ai.Longitude, cc, ocm: true };
  }).filter(s => s.cc && s.cc !== 'PT' && isFinite(s.la) && isFinite(s.lo) && s.kw >= 40);
}
function shortOp(o){ for (const [k] of ES_OPS) if (o.toLowerCase().includes(k.toLowerCase())) return k; return o.split(/[\s(]/).slice(0, 2).join(' '); }

/* ---------------- preços ----------------
   Cada posto tem uma tarifa: €/kWh, €/min, €/carregamento e a % devolvida em Gems.
   Portugal, modo Atlante Go: preço fixo por kWh (opcionalmente + tarifa do operador noutras redes).
   Portugal, modo cartão normal: (cartão + operador + IEC) por kWh, operador por minuto,
   operador + taxa MOBI.E por carregamento, tudo com IVA. Os preços do operador vêm do tarifário MOBI.E. */
const IEC = 0.001;
function tariff(st){
  const vat = 1 + S.vat / 100, opc = st.opc || null;
  if (CAR().tesla && /tesla/i.test(st.o || '')) return { e: S.teslaOwner, t: 0, f: 0, gemRate: 0, opcKnown: true, label: `Supercharger (dono Tesla) ${fmtP(S.teslaOwner)} €/kWh` };
  if (st.cc === 'PT') {
    const oe = opc ? opc[0] : S.opcGuess, ot = opc ? opc[1] : 0, of = opc ? opc[2] : 0;
    if (S.ptMode === 'ceme') {
      return { e: (S.cemePrice + oe + IEC) * vat, t: ot * vat, f: (of + S.egme) * vat, gemRate: 0, opcKnown: !!opc,
        label: `cartão ${fmtP(S.cemePrice)} + operador ${fmtP(oe)} €/kWh${ot ? ` + ${fmtP(ot)} €/min` : ''} (sem IVA)` };
    }
    const gemRate = (st.a ? S.cbAtl : S.cbOther) / 100;
    if (st.a || S.goInclOpc) return { e: S.ptPrice, t: 0, f: 0, gemRate, opcKnown: true, label: `Atlante Go ${fmtP(S.ptPrice)} €/kWh` };
    return { e: S.ptPrice + oe * vat, t: ot * vat, f: of * vat, gemRate, opcKnown: !!opc,
      label: `Atlante Go ${fmtP(S.ptPrice)} + operador ${fmtP(oe)} €/kWh${ot ? ` + ${fmtP(ot)} €/min` : ''}` };
  }
  const p = S.esPrices[st.o] ?? S.esOther;
  return { e: p, t: 0, f: 0, gemRate: 0, opcKnown: true, label: `${fmtP(p)} €/kWh` };
}
function costOf(tf, kwh, min){
  if (kwh < 0.05) return { paid: 0, gem: 0, eff: 0 };
  const paid = kwh * tf.e + min * tf.t + tf.f, gem = paid * tf.gemRate * S.gemVal / 100;
  return { paid, gem, eff: paid - gem };
}
// preço efetivo de referência: 25 kWh carregados a partir de 20 %
function refPrice(st){
  const tb = chargeTables(st.kw), s1 = 20; let s2 = s1; while (s2 < 100 && tb.E[s2] - tb.E[s1] < 25) s2++;
  const kwh = tb.E[s2] - tb.E[s1];
  return costOf(tariff(st), kwh, tb.T[s2] - tb.T[s1]).eff / kwh;
}

/* ---------------- física do carregamento ---------------- */
function chargeTables(kw){
  const T = new Float64Array(101), E = new Float64Array(101), pct = S.cap / 100, eff = S.eff / 100;
  for (let s = 0; s < 100; s++) {
    const C = CAR().curve, p = Math.max(1, Math.min((C[s] + C[s + 1]) / 2, kw));
    T[s + 1] = T[s] + (pct / (eff * p)) * 60;
    E[s + 1] = E[s] + pct / eff;
  }
  return { T, E };
}

/* ---------------- otimizador: programação dinâmica ----------------
   Estado: (paragem j, paragens feitas n, refeição feita m, bateria s%).
   'cheap' minimiza € + valor do tempo extra; 'fast' minimiza só o tempo (como uma app de rotas comum). */
const MAXN = 6;
const endFloor = () => S.ret ? Math.max(S.resEnd, Math.min(100, S.retPct)) : S.resEnd;
function plan(route, stations, mode){
  const pool = stations.filter(st => !S.avoid[st.id] && !(S.skipBroken && st.st === 'outOfOrder'));
  const nodes = [{ km: 0, off: 0, start: true }, ...pool, { km: route.km, off: 0, end: true }];
  const N = nodes.length, M = S.meal ? 2 : 1, SS = 101;
  const tables = nodes.map(n => (n.start || n.end) ? null : chargeTables(n.kw));
  const prices = nodes.map(n => (n.start || n.end) ? null : tariff(n));
  const det = nodes.map(n => (n.off || 0) * S.detourF);
  const pctPerKm = consNow() / S.cap;
  const forced = nodes.map((n, i) => (n.id && S.force[n.id]) ? i : -1).filter(i => i >= 0);
  const size = N * (MAXN + 1) * M * SS;
  const val = new Float64Array(size).fill(Infinity), par = new Int32Array(size).fill(-1), parT = new Int16Array(size).fill(-1);
  const idx = (j, n, m, s) => ((j * (MAXN + 1) + n) * M + m) * SS + s;
  const soc0 = Math.max(0, Math.min(100, Math.round(S.soc0)));
  val[idx(0, 0, 0, soc0)] = 0;
  const targets = []; for (let t = 0; t <= 100; t += 5) targets.push(t);
  const tv = S.timeVal / 60;

  for (let j = 0; j < N - 1; j++) {
    for (let n = 0; n <= MAXN; n++) for (let m = 0; m < M; m++) for (let s = 0; s < SS; s++) {
      const v0 = val[idx(j, n, m, s)]; if (v0 === Infinity) continue;
      const opts = [];
      if (j === 0) opts.push({ t: s, add: 0, m2: m, n2: n, mm: 0 });
      else {
        const tb = tables[j], pr = prices[j], detMin = det[j] * 2 / 50 * 60;
        for (const mm of (S.meal && m === 0 ? [0, 1] : [0])) {
          const minDwell = mm ? S.mealMin : S.minStop;
          const fixed = S.target[nodes[j].id];
          const tset = fixed != null ? new Set([Math.max(s, Math.min(100, fixed))]) : new Set([s, ...targets.filter(t => t > s)]);
          for (const t of tset) {
            const cm = tb.T[t] - tb.T[s], kwh = tb.E[t] - tb.E[s];
            const add = mode === 'fast' ? (cm + detMin + kwh * 0.02) : (costOf(pr, kwh, cm).eff + tv * (Math.max(0, cm - minDwell) + detMin));
            opts.push({ t, add, m2: m | mm, n2: n + 1, mm });
          }
        }
      }
      for (const o of opts) {
        if (o.n2 > MAXN) continue;
        const base = v0 + o.add;
        for (let k = j + 1; k < N; k++) {
          if (forced.some(f => f > j && f < k)) break;
          const road = nodes[k].km - nodes[j].km;
          if (road > S.maxLeg || road * pctPerKm > o.t) break;
          if (!nodes[k].end && road < S.minGap) continue;
          const dist = road + det[j] + det[k];
          if (dist > S.maxLeg) continue;
          const sa = Math.floor(o.t - dist * pctPerKm + 1e-9);
          if (sa < (nodes[k].end ? endFloor() : S.resStop)) continue;
          const id2 = idx(k, o.n2, o.m2, sa);
          if (base < val[id2]) { val[id2] = base; par[id2] = idx(j, n, m, s); parT[id2] = o.t * 2 + o.mm; }
        }
      }
    }
  }
  const out = {};
  for (let n = 0; n <= MAXN; n++) {
    let best = Infinity, bi = -1;
    for (const m of (S.meal ? [1] : [0])) for (let s = 0; s < SS; s++) { const v = val[idx(N - 1, n, m, s)]; if (v < best) { best = v; bi = idx(N - 1, n, m, s); } }
    if (bi >= 0) out[n] = rebuild(bi);
  }
  return out;

  function rebuild(endId){
    const steps = []; let cur = endId;
    while (cur >= 0) {
      const s = cur % SS, r1 = (cur - s) / SS, m = r1 % M, r2 = (r1 - m) / M, n = r2 % (MAXN + 1), j = (r2 - n) / (MAXN + 1);
      steps.push({ j, s, tcode: parT[cur] }); cur = par[cur];
    }
    steps.reverse();
    const stops = []; let drive = 0, cash = 0, gems = 0, eff = 0, kwhT = 0, dwell = 0;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i], node = nodes[st.j];
      if (i) drive += node.km - nodes[steps[i - 1].j].km + det[steps[i - 1].j] + det[st.j];
      if (node.start || node.end) continue;
      const nx = steps[i + 1], tDep = Math.floor(nx.tcode / 2), isMeal = nx.tcode % 2 === 1;
      const tb = tables[st.j], pr = prices[st.j];
      const cm = tb.T[tDep] - tb.T[st.s], kwh = tb.E[tDep] - tb.E[st.s];
      const d = Math.max(cm, isMeal ? S.mealMin : S.minStop);
      const c = costOf(pr, kwh, cm);
      cash += c.paid; gems += c.gem; eff += c.eff; kwhT += kwh; dwell += d + det[st.j] * 2 / 50 * 60;
      stops.push({ node, arr: st.s, dep: tDep, kwh, cm, dwell: d, meal: isMeal, price: pr, cost: c.paid, gem: c.gem });
    }
    const minPerKm = route.min / route.km * driveFactor();
    const driveMin = drive * minPerKm;
    return { stops, cash, gems, eff, kwh: kwhT, drive, driveMin, dwell, total: driveMin + dwell, endSoc: steps[steps.length - 1].s, minPerKm };
  }
}

/* ---------------- estado da viagem ---------------- */
let ROUTES = [], RT = null, STATIONS = [], RES = {}, FAST = {}, map = null, layers = null;
const score = r => r.eff + r.total * S.timeVal / 60;

async function calculate(){
  if (!S.from || !S.to) { setStatus('Escolhe a origem e o destino na lista de sugestões.', true); return; }
  $('go').disabled = true; setStatus('A calcular a rota…');
  try {
    ROUTES = await fetchRoutes(S.from, S.to);
    S.alt = Math.min(S.alt || 0, ROUTES.length - 1);
    await selectRoute(S.alt, true);
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus('Não consegui calcular a rota agora (o serviço de rotas pode estar ocupado). Tenta outra vez dentro de um minuto.', true);
  } finally { $('go').disabled = false; }
}
async function selectRoute(i, fresh){
  S.alt = i; RT = ROUTES[i];
  if (fresh) S.stops = 0;
  setStatus('A procurar postos ao longo da rota…');
  RT.stations = RT.stations || await stationsFor(RT);
  STATIONS = RT.stations;
  setStatus('');
  recompute(true);
}
function recompute(pickStops){
  if (!RT) return;
  RES = plan(RT, STATIONS, 'cheap');
  FAST = plan(RT, STATIONS, 'fast');
  const avail = Object.keys(RES).map(Number).filter(n => n >= 1);
  if (pickStops || !RES[S.stops]) {
    const cand = avail.filter(n => n >= 2 && n <= 3);
    const pool = cand.length ? cand : avail;
    S.stops = pool.length ? pool.reduce((a, b) => score(RES[a]) <= score(RES[b]) ? a : b) : 0;
  }
  save(); render();
}

/* ---------------- desenho ---------------- */
function render(){
  renderChanges();
  $('results').hidden = false;
  // caminhos alternativos
  $('alts-wrap').hidden = ROUTES.length < 2;
  $('alts').innerHTML = '';
  ROUTES.forEach((rt, i) => {
    const b = document.createElement('button'); b.className = 'tab'; b.type = 'button';
    b.setAttribute('aria-pressed', String(i === S.alt));
    b.innerHTML = `<b>${i === 0 ? 'Mais rápido' : 'Alternativa ' + i}</b><span>${fmtKm(rt.km)} · ${fmtMin(rt.min * driveFactor())}</span>`;
    b.onclick = () => { if (i !== S.alt) selectRoute(i, true); };
    $('alts').appendChild(b);
  });
  $('meta').innerHTML = `<span class="num">${fmtKm(RT.km)}</span><span>≈ ${fmtMin(RT.min * driveFactor())} ao volante</span><span>${S.cruise} km/h · ${consNow().toFixed(1).replace('.', ',')} kWh/100 km</span><span>${STATIONS.length} postos rápidos na rota</span>`;

  // velocidade em autoestrada
  $('speeds').innerHTML = '';
  [100, 110, 120, 130].forEach(v => {
    const s = document.createElement('button'); s.className = 'tab'; s.type = 'button'; s.setAttribute('aria-pressed', String(S.cruise === v));
    s.innerHTML = `<b>${v} km/h</b><span>${(consAt(v) * S.consAdj / 100).toFixed(1).replace('.', ',')} kWh/100</span>`;
    s.onclick = () => { if (S.cruise === v) return; S.cruise = v; save(); recompute(true); };
    $('speeds').appendChild(s);
  });
  // número de paragens
  $('tabs').innerHTML = '';
  const feas = Object.keys(RES).map(Number).filter(n => n >= 1 && n <= 5);
  const maxShow = Math.max(3, ...feas);
  for (let n = 1; n <= maxShow; n++) {
    const r = RES[n], b = document.createElement('button');
    b.className = 'tab'; b.type = 'button'; b.disabled = !r; b.setAttribute('aria-pressed', String(S.stops === n));
    b.innerHTML = `<b>${n} ${n === 1 ? 'paragem' : 'paragens'}</b><span>${r ? fmtE(r.eff) : 'impossível'}</span>`;
    b.onclick = () => { S.stops = n; save(); render(); };
    $('tabs').appendChild(b);
  }
  const r = RES[S.stops];
  if (!r) {
    $('stops').innerHTML = '<p class="note">Não há plano possível com estas regras. Aumenta o máximo a conduzir sem parar, baixa a reserva mínima ou verifica se há postos suficientes na rota.</p>';
    ['k-eff','k-time','k-kwh'].forEach(k => $(k).textContent = '—'); $('compare').textContent = '';
    drawMap(null); return;
  }
  $('k-eff').textContent = fmtE(r.eff);
  $('k-eff-s').textContent = r.gems > 0.005 ? `pagas ${fmtE(r.cash)}, recebes ${fmtE(r.gems)} em Gems` : `pagas ${fmtE(r.cash)}`;
  $('k-time').textContent = fmtMin(r.total);
  $('k-time-s').textContent = `${fmtMin(r.dwell)} parado`;
  $('k-kwh').textContent = Math.round(r.kwh) + ' kWh';
  $('k-kwh-s').textContent = `chegas com ${r.endSoc}%`;

  const f = FAST[S.stops], cmp = $('compare');
  if (f) {
    const dE = f.eff - r.eff, dT = r.total - f.total;
    if (dE > 0.25) { cmp.className = 'compare'; cmp.innerHTML = `Uma app que só procura o carregamento mais rápido gastaria <b class="num">${fmtE(f.eff)}</b> com o mesmo número de paragens. Este plano poupa <b class="num">${fmtE(dE)}</b>${dT > 1 ? ` e demora mais <b class="num">${fmtMin(dT)}</b>` : dT < -1 ? ` e até é <b class="num">${fmtMin(-dT)}</b> mais curto` : ' sem demorar mais'}.`; }
    else { cmp.className = 'compare neutral'; cmp.textContent = `Aqui o plano mais barato e o mais rápido praticamente coincidem (diferença de ${fmtE(Math.max(0, dE))}).`; }
  } else cmp.textContent = '';

  renderStops(r); renderChart(r); drawMap(r); renderList(r);
}

const gmapsTo = n => `https://www.google.com/maps/dir/?api=1&destination=${n.la},${n.lo}&travelmode=driving`;
function renderStops(r){
  const el = $('stops'); el.innerHTML = '';
  const add = h => el.insertAdjacentHTML('beforeend', h);
  add(`<div class="stop"><div class="km">0<small>KM</small></div><div class="card"><h3>Partida · ${esc(S.from.name)}</h3><div class="chips"><span class="chip num">${S.soc0}% de bateria</span></div></div></div>`);
  let prev = 0;
  r.stops.forEach(p => {
    const n = p.node, leg = n.km - prev; prev = n.km;
    add(`<div class="leg"><div class="rail"></div><div class="num">${fmtKm(leg)} · ≈ ${fmtMin(leg * r.minPerKm)}</div></div>`);
    const chips = [
      n.a ? `<span class="chip atl">Atlante${p.price.gemRate ? ` · ${Math.round(p.price.gemRate * 100)}% em Gems` : ''}</span>` : `<span class="chip ${n.cc !== 'PT' ? 'es' : ''}">${esc(n.o)}${n.cc !== 'PT' ? ' · ' + (n.cc === 'ES' ? 'Espanha' : n.cc) : ''}</span>`,
      `<span class="chip num">${Math.round(n.kw)} kW</span>`,
      p.meal ? '<span class="chip meal">Refeição</span>' : '<span class="chip">Pausa</span>',
      n.off > 0.9 ? `<span class="chip warn">desvio ≈ ${Math.round(n.off * S.detourF * 2)} km</span>` : '',
      n.st === 'unknown' && n.cc === 'PT' ? '<span class="chip warn">estado desconhecido</span>' : '',
      n.manual ? '<span class="chip warn">confirmar posto</span>' : ''
    ].join('');
    const kwhTxt = p.kwh > 0.05 ? `${p.kwh.toFixed(1).replace('.', ',')} kWh` : 'só pausa';
    add(`<div class="stop"><div class="km">${Math.round(n.km)}<small>KM</small></div><div class="card">
      <div><div class="label">${esc(n.c)}</div><h3>${esc(n.n)}</h3></div>
      <div class="chips">${chips}</div>
      <div class="socbar" aria-label="Carregar de ${p.arr}% a ${p.dep}%"><i class="low" style="left:0;width:${p.arr}%"></i><i style="left:${p.arr}%;width:${Math.max(0, p.dep - p.arr)}%"></i></div>
      <div class="facts">
        <div><b>${p.arr}% → ${p.dep}%</b><span>bateria</span></div>
        <div><b>${kwhTxt}</b><span>energia</span></div>
        <div><b>${fmtMin(p.cm)}</b><span>a carregar · parado ${fmtMin(p.dwell)}</span></div>
        <div><b>${fmtE(p.cost - p.gem)}</b><span>${p.gem > 0.005 ? `pagas ${fmtE(p.cost)}, −${fmtE(p.gem)} Gems` : p.kwh > 0.05 ? `≈ ${fmtP(p.cost / p.kwh)} €/kWh tudo incluído` : 'sem custo'}</span></div>
      </div>
      <div class="adj"><span>Sair com</span><button class="btn sm" type="button" data-adj="${esc(n.id)}" data-v="${Math.max(p.arr, p.dep - 5)}" aria-label="Menos 5%" ${p.dep <= p.arr ? 'disabled' : ''}>−5%</button><b class="num">${p.dep}%</b><button class="btn sm" type="button" data-adj="${esc(n.id)}" data-v="${Math.min(100, p.dep + 5)}" aria-label="Mais 5%" ${p.dep >= 100 ? 'disabled' : ''}>+5%</button>${S.target[n.id] != null ? `<button class="btn sm" type="button" data-auto="${esc(n.id)}">Automático</button>` : '<span class="note">automático</span>'}</div>
      <div class="rowbtns"><a class="btn sm" href="${gmapsTo(n)}" target="_blank" rel="noopener">Google Maps</a><a class="btn sm" href="https://waze.com/ul?ll=${n.la},${n.lo}&navigate=yes" target="_blank" rel="noopener">Waze</a><button class="btn sm" type="button" data-avoid="${esc(n.id)}">Evitar este posto</button>${S.force[n.id] ? `<button class="btn sm" type="button" data-unforce="${esc(n.id)}">Deixar de obrigar</button>` : ''}</div>
    </div></div>`);
  });
  const last = RT.km - prev;
  add(`<div class="leg"><div class="rail"></div><div class="num">${fmtKm(last)} · ≈ ${fmtMin(last * r.minPerKm)}</div></div>`);
  add(`<div class="stop"><div class="km end">${Math.round(RT.km)}<small>KM</small></div><div class="card"><h3>Chegada · ${esc(S.to.name)}</h3><div class="chips"><span class="chip num">${r.endSoc}% de bateria</span>${S.ret ? `<span class="chip atl">pronto para a volta (mínimo ${endFloor()}%)</span>` : `<span class="chip">reserva pedida ${S.resEnd}%</span>`}</div></div></div>`);
  bindStationButtons(el);
}
function renderChanges(){
  const el = $('changes');
  const avoided = STATIONS.filter(s => S.avoid[s.id]), adjusted = STATIONS.filter(s => S.target[s.id] != null), forced = STATIONS.filter(s => S.force[s.id] && S.target[s.id] == null);
  if (!avoided.length && !forced.length && !adjusted.length) { el.hidden = true; el.innerHTML = ''; return; }
  const parts = [];
  if (adjusted.length) parts.push(adjusted.length === 1 ? `ajustaste a carga em <b>${esc(adjusted[0].n)}</b>` : `ajustaste a carga em <b>${adjusted.length} paragens</b>`);
  if (avoided.length) parts.push(avoided.length === 1 ? `evitaste <b>${esc(avoided[0].n)}</b>` : `evitaste <b>${avoided.length} postos</b>`);
  if (forced.length) parts.push(forced.length === 1 ? `obrigaste a parar em <b>${esc(forced[0].n)}</b>` : `obrigaste <b>${forced.length} paragens</b>`);
  el.hidden = false;
  el.innerHTML = `<span>Nesta viagem ${parts.join(' e ')}.</span><div class="rowbtns">${avoided.length ? '<button class="btn" type="button" id="see-avoided">Ver</button>' : ''}<button class="btn strong" type="button" id="reset-trip">Repor viagem</button></div>`;
  $('reset-trip').onclick = () => { STATIONS.forEach(s => { delete S.avoid[s.id]; delete S.force[s.id]; delete S.target[s.id]; }); recompute(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  if ($('see-avoided')) $('see-avoided').onclick = () => { S.filter = 'off'; save(); $('d-list').open = true; render(); $('d-list').scrollIntoView({ behavior: 'smooth' }); };
}
function bindStationButtons(el){
  el.querySelectorAll('[data-avoid]').forEach(b => b.onclick = () => { S.avoid[b.dataset.avoid] = true; delete S.force[b.dataset.avoid]; delete S.target[b.dataset.avoid]; recompute(); });
  el.querySelectorAll('[data-unavoid]').forEach(b => b.onclick = () => { delete S.avoid[b.dataset.unavoid]; recompute(); });
  el.querySelectorAll('[data-force]').forEach(b => b.onclick = () => { S.force[b.dataset.force] = true; recompute(); });
  el.querySelectorAll('[data-unforce]').forEach(b => b.onclick = () => { delete S.force[b.dataset.unforce]; delete S.target[b.dataset.unforce]; recompute(); });
  el.querySelectorAll('[data-adj]').forEach(b => b.onclick = () => { const id = b.dataset.adj; S.target[id] = +b.dataset.v; S.force[id] = true; recompute(); });
  el.querySelectorAll('[data-auto]').forEach(b => b.onclick = () => { const id = b.dataset.auto; delete S.target[id]; delete S.force[id]; recompute(); });
}

function renderChart(r){
  const W = 640, H = 190, L = 34, R = 10, T = 10, B = 28, w = W - L - R, h = H - T - B;
  const x = km => L + km / RT.km * w, y = s => T + (100 - s) / 100 * h;
  let g = '';
  [0, 25, 50, 75, 100].forEach(s => { g += `<line x1="${L}" x2="${W - R}" y1="${y(s)}" y2="${y(s)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(s) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="Overpass Mono, monospace">${s}%</text>`; });
  const stepKm = RT.km > 800 ? 200 : RT.km > 300 ? 100 : 50;
  for (let k = 0; k <= RT.km; k += stepKm) g += `<text x="${x(k)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="Overpass Mono, monospace">${k}</text>`;
  const firstES = STATIONS.find(s => s.cc !== 'PT'), lastPT = [...STATIONS].reverse().find(s => s.cc === 'PT');
  if (firstES && lastPT && lastPT.km < firstES.km) { const bk = (firstES.km + lastPT.km) / 2;
    g += `<line x1="${x(bk)}" x2="${x(bk)}" y1="${T}" y2="${T + h}" stroke="var(--es)" stroke-dasharray="3 4" stroke-width="1.5"/><text x="${x(bk) + 5}" y="${T + 12}" font-size="11" fill="var(--es)" font-weight="700" font-family="Overpass, sans-serif">fronteira ≈</text>`; }
  g += `<rect x="${L}" y="${y(S.resStop)}" width="${w}" height="${y(0) - y(S.resStop)}" fill="var(--warn-soft)" opacity=".8"/>`;
  const pts = [[0, S.soc0]]; r.stops.forEach(p => { pts.push([p.node.km, p.arr]); pts.push([p.node.km, p.dep]); }); pts.push([RT.km, r.endSoc]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join(' ');
  g += `<path d="${d} L ${x(RT.km)} ${y(0)} L ${x(0)} ${y(0)} Z" fill="var(--gem)" opacity=".12"/><path d="${d}" fill="none" stroke="var(--gem)" stroke-width="2.5" stroke-linejoin="round"/>`;
  r.stops.forEach(p => { g += `<circle cx="${x(p.node.km)}" cy="${y(p.dep)}" r="4.5" fill="${p.node.a ? 'var(--gem)' : 'var(--surface)'}" stroke="var(--gem)" stroke-width="2"/>`; });
  $('chart').innerHTML = g;
}

function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function drawMap(r){
  if (typeof L === 'undefined') { $('map').innerHTML = '<p class="note" style="padding:12px">O mapa não carregou. Verifica a ligação à internet.</p>'; return; }
  if (!map) {
    map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© contribuidores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    layers = L.layerGroup().addTo(map);
  }
  layers.clearLayers();
  const sign = cssVar('--sign') || '#1f4f9a', gem = cssVar('--gem') || '#0b8063', ink = '#18202b', muted = '#7b8592';
  ROUTES.forEach((rt, i) => { if (rt !== RT) L.polyline(rt.coords.map(c => [c[1], c[0]]), { color: muted, weight: 4, opacity: .55, dashArray: '6 8' }).on('click', () => selectRoute(i, true)).addTo(layers); });
  const line = L.polyline(RT.coords.map(c => [c[1], c[0]]), { color: sign, weight: 5, opacity: .9 }).addTo(layers);
  const used = new Set(r ? r.stops.map(p => p.node.id) : []);
  STATIONS.forEach(st => {
    if (used.has(st.id)) return;
    const rp = refPrice(st), tf = tariff(st);
    L.circleMarker([st.la, st.lo], { radius: 5, color: '#fff', weight: 1.5, fillColor: st.a ? gem : (st.cc === 'PT' ? muted : '#a8452f'), fillOpacity: S.avoid[st.id] ? .25 : .9 })
      .bindPopup(`<b>${esc(st.n)}</b><br>${esc(st.c)} · ${esc(st.o)} · ${Math.round(st.kw)} kW<br>km ${Math.round(st.km)} · ≈ ${fmtP(rp)} €/kWh efetivo<br><small>${esc(tf.label)}</small><br>${S.avoid[st.id] ? `<button class="btn sm" data-unavoid="${esc(st.id)}">Voltar a usar</button>` : `<button class="btn sm" data-force="${esc(st.id)}">Parar aqui</button> <button class="btn sm" data-avoid="${esc(st.id)}">Evitar</button>`}`)
      .addTo(layers);
  });
  if (r) r.stops.forEach((p, i) => {
    const n = p.node, icon = L.divIcon({ className: '', html: `<div class="stopicon" style="background:${n.a ? gem : ink}">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
    L.marker([n.la, n.lo], { icon }).bindPopup(`<b>${i + 1}. ${esc(n.n)}</b><br>${p.arr}% → ${p.dep}% · ${fmtE(p.cost - p.gem)}`).addTo(layers);
  });
  const end = (ll, color) => L.marker(ll, { icon: L.divIcon({ className: '', html: `<div class="endicon" style="background:${color}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(layers);
  end([S.from.lat, S.from.lon], ink); end([S.to.lat, S.to.lon], sign);
  map.fitBounds(line.getBounds(), { padding: [24, 24] });
  map.off('popupopen').on('popupopen', e => bindStationButtons(e.popup.getElement()));
  setTimeout(() => map.invalidateSize(), 50);
  const wp = r ? r.stops.map(p => `${p.node.la},${p.node.lo}`).join('|') : '';
  $('gmaps').href = `https://www.google.com/maps/dir/?api=1&origin=${S.from.lat},${S.from.lon}&destination=${S.to.lat},${S.to.lon}` + (wp ? `&waypoints=${encodeURIComponent(wp)}` : '') + '&travelmode=driving';
}

function renderList(r){
  const used = new Set(r.stops.map(p => p.node.id));
  const F = [['all','Todos'],['atl','Só Atlante'],['pt','Portugal'],['es','Fora de Portugal'],['off','Evitados']];
  $('filters').innerHTML = F.map(([k, t]) => `<button class="flt" type="button" aria-pressed="${S.filter === k}" data-f="${k}">${t}</button>`).join('');
  $('filters').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.filter = b.dataset.f; save(); renderList(r); });
  const list = STATIONS.filter(st => S.filter === 'atl' ? st.a : S.filter === 'pt' ? st.cc === 'PT' : S.filter === 'es' ? st.cc !== 'PT' : S.filter === 'off' ? S.avoid[st.id] : true);
  $('list-count').textContent = STATIONS.length;
  $('slist').innerHTML = list.map(st => {
    const rp = refPrice(st), tf = tariff(st), off = !!S.avoid[st.id];
    const meta = [st.o, Math.round(st.kw) + ' kW', st.p + (st.p === 1 ? ' ponto' : ' pontos'), st.off > 0.9 ? `desvio ≈ ${Math.round(st.off * S.detourF * 2)} km` : null, st.st === 'outOfOrder' ? 'avariado' : null, st.st === 'unknown' && st.cc === 'PT' ? 'estado desconhecido' : null, st.manual ? 'lista manual' : null, st.cc === 'PT' && !st.opc && (S.ptMode === 'ceme' || !S.goInclOpc) ? 'sem tarifa do operador (estimada)' : null].filter(Boolean).join(' · ');
    const btn = off ? `<button class="btn sm" type="button" data-unavoid="${esc(st.id)}">Repor</button>`
      : `<button class="btn sm" type="button" data-avoid="${esc(st.id)}">Evitar</button>` + (S.force[st.id] ? `<button class="btn sm" type="button" data-unforce="${esc(st.id)}">Não obrigar</button>` : `<button class="btn sm" type="button" data-force="${esc(st.id)}">Parar aqui</button>`);
    return `<div class="srow ${off ? 'off' : ''} ${used.has(st.id) ? 'used' : ''}"><div class="k">${Math.round(st.km)} km${used.has(st.id) ? '<br>no plano' : ''}</div>
      <div class="n"><b>${esc(st.n)}</b><span>${esc(st.c)} · ${esc(meta)}</span></div>
      <div class="p"><b>${fmtP(rp)} €</b><div class="rowbtns">${btn}</div></div></div>`;
  }).join('') || '<p class="note">Nenhum posto neste filtro.</p>';
  bindStationButtons($('slist'));
}

/* ---------------- definições ---------------- */
const FIELDS = [
  ['O carro', [['cap','Bateria útil','kWh',.1],['consAdj','Ajuste de consumo (inverno, carga, vento)','%',5],['soc0','Bateria à partida','%',1],['resStop','Mínimo ao chegar a um posto','%',1],['resEnd','Mínimo ao chegar ao destino','%',1],['timeFactor','Tempo de condução face ao estimado','%',5]]],
  ['As paragens', [['minStop','Pausa mínima em cada paragem','min',1],['mealMin','Duração da refeição','min',1],['maxLeg','Máximo a conduzir sem parar','km',5],['minGap','Mínimo entre paragens','km',5],['timeVal','Quanto vale para ti 1 hora a mais','€/h',1]]],
  ['Portugal · Atlante Go', [['ptPrice','Preço em qualquer rede','€/kWh',.01],['cbAtl','Gems em postos Atlante','%',1],['cbOther','Gems noutras redes','%',1],['gemVal','Quanto valem os Gems para ti','%',5]]],
];
function renderSettings(){
  const f = (k, l, u, st, val) => `<div class="field"><label for="f-${k}">${l}</label><div class="in"><input id="f-${k}" type="number" inputmode="decimal" step="${st}" value="${val}" data-k="${k}"><span class="u">${u}</span></div></div>`;
  let h = FIELDS.map(([t, fs]) => `<div class="grp"><h4>${t}</h4><div class="fields">${fs.map(([k, l, u, st]) => f(k, l, u, st, S[k])).join('')}</div></div>`).join('');
  h += `<div class="grp"><h4>Como pagas em Portugal</h4>
    <label class="check"><input type="radio" name="ptmode" value="go" ${S.ptMode !== 'ceme' ? 'checked' : ''}> Atlante Go (preço fixo por kWh)</label>
    <label class="check"><input type="radio" name="ptmode" value="ceme" ${S.ptMode === 'ceme' ? 'checked' : ''}> Cartão ou app normal (preço do cartão + preço de cada operador)</label>
    <label class="check"><input type="checkbox" id="f-goIncl" ${S.goInclOpc ? 'checked' : ''}> O Atlante Go já inclui o preço do operador noutras redes</label>
    <div class="fields">${f('cemePrice', 'Preço do teu cartão (sem IVA)', '€/kWh', .01, S.cemePrice)}${f('egme', 'Taxa MOBI.E por carregamento (sem IVA)', '€', .0001, S.egme)}${f('vat', 'IVA', '%', 1, S.vat)}${f('opcGuess', 'Preço do operador quando não é conhecido', '€/kWh', .01, S.opcGuess)}</div>
    <p class="note">Os preços de cada operador vêm do tarifário oficial da MOBI.E (${PT_TARIFFS ? 'atualizado a ' + new Date(PT_TARIFFS).toLocaleDateString('pt-PT') : 'ainda por carregar'}) e são atualizados todas as semanas.</p></div>`;
  h += `<div class="grp"><h4>Espanha e outros países · €/kWh</h4><div class="fields">${ES_OPS.map(([op]) => f('es-' + op, op, '€/kWh', .01, S.esPrices[op])).join('')}${f('esOther', 'Outras redes', '€/kWh', .01, S.esOther)}${CAR().tesla ? f('teslaOwner', 'Supercharger com o teu Tesla', '€/kWh', .01, S.teslaOwner) : ''}</div></div>`;
  h += `<div class="grp"><h4>Opções</h4>
    <label class="check"><input type="checkbox" id="f-meal" ${S.meal ? 'checked' : ''}> Uma das paragens é para comer (usa a duração da refeição)</label>
    <label class="check"><input type="checkbox" id="f-skipBroken" ${S.skipBroken ? 'checked' : ''}> Ignorar postos marcados como avariados</label></div>
  <div class="grp"><h4>Casa</h4><p class="note">${S.home ? `Guardada neste telemóvel (${S.home.lat.toFixed(3)}, ${S.home.lon.toFixed(3)}).` : 'Ainda não definida. Pesquisa a tua morada no campo «De» e escolhe «Guardar como a minha casa».'}</p>
    <div class="rowbtns">${S.from ? '<button class="btn" type="button" id="set-home">Usar a origem atual como casa</button>' : ''}${S.home ? '<button class="btn" type="button" id="del-home">Apagar casa</button>' : ''}</div></div>
  <div class="grp"><h4>Postos em Espanha (opcional)</h4>
    <div class="field"><label for="f-ocm">Chave do Open Charge Map</label><div class="in"><input id="f-ocm" type="text" autocomplete="off" spellcheck="false" value="${esc(S.ocmKey)}" placeholder="${SITE_OCM_KEY ? 'chave da app já ativa' : 'cola aqui a tua chave'}"></div></div>
    <p class="note">Com a chave, a app procura todos os postos rápidos reais fora de Portugal ao longo da rota. Sem ela, usa só a lista curta manual. A chave fica guardada só neste telemóvel.</p></div>
  <p class="note">Os Gems só se usam em postos Atlante e expiram em 6 meses. Se não carregas na Atlante com frequência, baixa o valor dos Gems.</p>
  <div class="rowbtns"><button class="btn" type="button" id="reset">Repor valores iniciais</button></div>`;
  $('settings').innerHTML = h;
  $('settings').querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('change', () => {
    const v = parseFloat(String(inp.value).replace(',', '.')), k = inp.dataset.k;
    if (!isFinite(v)) { inp.value = k.startsWith('es-') ? S.esPrices[k.slice(3)] : S[k]; return; }
    if (k.startsWith('es-')) S.esPrices[k.slice(3)] = v; else S[k] = v;
    save(); recompute();
  }));
  $('f-meal').onchange = e => { S.meal = e.target.checked; recompute(); };
  document.querySelectorAll('input[name="ptmode"]').forEach(r => r.onchange = () => { S.ptMode = r.value; save(); recompute(); });
  $('f-goIncl').onchange = e => { S.goInclOpc = e.target.checked; recompute(); };
  $('f-skipBroken').onchange = e => { S.skipBroken = e.target.checked; recompute(); };
  $('f-ocm').onchange = e => { S.ocmKey = e.target.value.trim(); save(); ROUTES.forEach(r => r.stations = null); if (RT) selectRoute(S.alt); };
  if ($('set-home')) $('set-home').onclick = () => { S.home = { name: 'Casa', lat: S.from.lat, lon: S.from.lon }; save(); renderSettings(); };
  if ($('del-home')) $('del-home').onclick = () => { S.home = null; save(); renderSettings(); };
  $('reset').onclick = () => { const keep = { home: S.home, from: S.from, to: S.to, ocmKey: S.ocmKey, car: S.car, cap: CAR().cap }; S = JSON.parse(JSON.stringify(DEFAULTS)); Object.assign(S, keep); save(); renderSettings(); recompute(true); };
}

function renderCars(){
  $('cars').innerHTML = Object.entries(CARS).map(([k, c]) => `<button type="button" class="car" aria-pressed="${S.car === k}" data-car="${k}"><b>${c.short}</b><span>${c.sub}</span></button>`).join('');
  $('cars').querySelectorAll('[data-car]').forEach(b => b.onclick = () => {
    const k = b.dataset.car; if (k === S.car) return;
    S.car = k; S.cap = CARS[k].cap; S.target = {}; save(); renderCars(); renderSettings(); if (RT) recompute(true);
  });
  $('car-note').textContent = `Curva de carregamento do ${CAR().name} segundo EVKX (estimada).`;
}

/* ---------------- arranque ---------------- */
async function init(){
  await loadData();
  bindPlace('from'); bindPlace('to');
  if (S.from) $('from').value = S.from.name;
  if (S.to) $('to').value = S.to.name;
  renderCars();
  $('swap').onclick = () => { [S.from, S.to] = [S.to, S.from]; $('from').value = S.from?.name || ''; $('to').value = S.to?.name || ''; save(); };
  $('from-geo').onclick = () => {
    if (!navigator.geolocation) { setStatus('Este navegador não dá a localização.', true); return; }
    setStatus('A obter a tua localização…');
    navigator.geolocation.getCurrentPosition(p => { S.from = { name: 'Aqui', lat: p.coords.latitude, lon: p.coords.longitude }; $('from').value = 'Aqui'; save(); setStatus(''); },
      () => setStatus('Não consegui obter a localização. Escreve a origem.', true), { enableHighAccuracy: false, timeout: 10000 });
  };
  $('ret').checked = !!S.ret; $('ret-pct').value = S.retPct; $('ret-pct').disabled = !S.ret;
  $('ret').onchange = e => { S.ret = e.target.checked; $('ret-pct').disabled = !S.ret; save(); if (RT) recompute(true); };
  $('ret-pct').onchange = e => { const v = parseFloat(e.target.value); if (!isFinite(v)) { e.target.value = S.retPct; return; } S.retPct = Math.max(10, Math.min(100, Math.round(v))); e.target.value = S.retPct; save(); if (RT && S.ret) recompute(true); };
  $('trip').addEventListener('submit', e => { e.preventDefault(); document.querySelectorAll('.sugg').forEach(l => l.hidden = true); calculate(); });
  renderSettings();
  if (S.from && S.to) calculate();
  else setStatus(S.home ? 'Escolhe o destino e toca em Calcular.' : 'Começa por pesquisar a tua casa no campo «De» e escolhe «Guardar como a minha casa». Fica guardada só neste telemóvel.');
}
init();
