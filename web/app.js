// ===== Estoque de Torres – aplicação =====
(function () {
'use strict';
var C = Core;
var S = {
  db: null, user: null, uid: null, canEdit: null, canWrite: null, modo: 'carregando',
  tipos: [], canteiros: [], movimentos: [], transferencias: [], config: {}, torres: [], projeto: {}, ver: 0, imp: null, nfs: [], nfsMeta: {}, impNF: null,
  loaded: {}, names: {}, tabId: 'tab' + Math.random().toString(36).slice(2, 8),
  d: { saldos: new Map(), reservas: new Map(), transito: new Map() }, readonly: false
};
var COLS = ['tipos', 'canteiros', 'movimentos', 'transferencias', 'config', 'projeto', 'planejamento'];

// ---------- utilidades ----------
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function nf(n, d) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }); }
function newId(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function hoje() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function fdata(s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; }
function fdh(s) { if (!s) return ''; var d = new Date(s); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function byNome(a, b) { return String(a.nome || a.codigo || '').localeCompare(String(b.nome || b.codigo || ''), 'pt-BR', { numeric: true }); }
function tipoById(id) { return S.tipos.find(function (t) { return t.id === id; }); }
function cantById(id) { return S.canteiros.find(function (c) { return c.id === id; }); }
function tipoNome(id) { var t = tipoById(id); return t ? (t.codigo ? t.codigo + (t.nome ? ' – ' + t.nome : '') : t.nome) : '(tipo removido)'; }
function tipoCod(id) { var t = tipoById(id); return t ? (t.codigo || t.nome) : '?'; }
function cantNome(id) { var c = cantById(id); return c ? c.nome : '(canteiro removido)'; }
function compNome(tipoId, compId) { var t = tipoById(tipoId); var c = t && (t.volumes || []).find(function (x) { return x.id === compId; }); return c ? c.nome : '(volume removido)'; }
function tiposOrd() { return S.tipos.slice().sort(function (a, b) { return String(a.codigo || a.nome).localeCompare(String(b.codigo || b.nome), 'pt-BR', { numeric: true }); }); }
function cantsOrd(soAtivos) { return S.canteiros.filter(function (c) { return !soAtivos || c.ativo !== false; }).sort(byNome); }
function userName(id) { if (!id) return '—'; if (id === 'local') return 'Você (modo local)'; return S.names[id] || 'Usuário'; }
function estornados() { var s = {}; S.movimentos.forEach(function (m) { if (m.estornoDe) s[m.estornoDe] = m; }); return s; }
function optList(arr, val, labelFn, vazio) {
  return (vazio != null ? '<option value="">' + esc(vazio) + '</option>' : '') + arr.map(function (x) {
    return '<option value="' + esc(x.id) + '"' + (x.id === val ? ' selected' : '') + '>' + esc(labelFn(x)) + '</option>';
  }).join('');
}
function cell(n) { return n === 0 ? '<span class="zero">0</span>' : n < 0 ? '<span class="neg">' + nf(n) + '</span>' : nf(n); }
function itensResumo(tipoId, itens, max) {
  max = max || 4;
  var s = itens.slice(0, max).map(function (i) { return '<span class="tag">' + esc(compNome(tipoId, i.componenteId)) + ' <b class="mono">' + nf(Math.abs(i.qtd)) + '</b></span>'; }).join(' ');
  if (itens.length > max) s += ' <span class="muted small">+' + (itens.length - max) + '</span>';
  return '<span class="chips">' + s + '</span>';
}

// ---------- toasts e modal ----------
function toast(msg, bad) {
  var t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(function () { t.remove(); }, bad ? 7000 : 3800);
}
function modal(title, bodyHtml, opts) {
  opts = opts || {};
  closeModal();
  var bg = document.createElement('div'); bg.className = 'modalbg'; bg.id = 'modal';
  bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><header><h3>' + esc(title) + '</h3><button class="btn ghost" data-x aria-label="Fechar">✕</button></header>' +
    '<div class="body"><div class="errs" hidden></div>' + bodyHtml + '</div><footer><button class="btn" data-x>' + esc(opts.cancel || 'Cancelar') + '</button>' +
    (opts.ok ? '<button class="btn pri" data-ok>' + esc(opts.ok) + '</button>' : '') + '</footer></div>';
  document.body.appendChild(bg);
  $$('[data-x]', bg).forEach(function (b) { b.onclick = closeModal; });
  bg.addEventListener('mousedown', function (e) { if (e.target === bg) closeModal(); });
  var okb = $('[data-ok]', bg);
  if (okb && opts.onOk) okb.onclick = async function () {
    showErrs([]); okb.disabled = true; var txt = okb.textContent; okb.textContent = 'Salvando…';
    try { var r = await opts.onOk(bg); if (r !== false) closeModal(); }
    catch (e) { showErrs(e && e.erros ? e.erros : [errMsg(e)]); }
    finally { okb.disabled = false; okb.textContent = txt; }
  };
  if (opts.onOpen) opts.onOpen(bg);
  var f = $('input,select,textarea', $('.body', bg)); if (f) f.focus();
  return bg;
}
function closeModal() { var m = $('#modal'); if (m) m.remove(); }
function showErrs(list) {
  var e = $('#modal .errs'); if (!e) { if (list.length) toast(list.join(' · '), true); return; }
  if (!list.length) { e.hidden = true; e.innerHTML = ''; return; }
  e.hidden = false; e.innerHTML = '<b>Não foi possível salvar:</b><ul>' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
}
function Falha(erros) { var e = new Error(erros.join('; ')); e.erros = erros; return e; }
function errMsg(e) {
  if (!e) return 'Erro desconhecido';
  if (e.erros) return e.erros.join('; ');
  if (e.code === 'invalid_argument') return 'Sem permissão para gravar (ou dado inválido). Peça ao dono acesso de Colaborador/Editor.';
  if (e.code === 'quota_exceeded') return 'Limite de armazenamento atingido: ' + (e.message || '');
  if (e.code === 'resource_exhausted') return 'Muitas operações seguidas. Aguarde alguns segundos e tente de novo.';
  if (e.code === 'unavailable') return 'Servidor indisponível no momento. Tente novamente.';
  return e.message || String(e);
}
function confirmar(titulo, texto, ok, fn) {
  modal(titulo, '<p style="margin:0">' + texto + '</p>', { ok: ok || 'Confirmar', onOk: fn });
}

// ---------- camada de dados ----------
var Store = {
  sub: function (col, cb, err) {
    if (S.db) return S.db.collection(col).onSnapshot(function (snap) {
      cb(snap.docs.filter(function (d) { return d.exists; }).map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; }), snap.metadata);
    }, err);
    Mem.subs[col] = cb; cb(Mem.list(col), { fromCache: false }); return function () {};
  },
  set: async function (col, id, data) { if (S.db) return withRetry(function () { return S.db.doc(col + '/' + id).set(data); }); Mem.set(col, id, data); },
  update: async function (col, id, data) { if (S.db) return withRetry(function () { return S.db.doc(col + '/' + id).update(data); }); Mem.update(col, id, data); },
  del: async function (col, id) { if (S.db) return withRetry(function () { return S.db.doc(col + '/' + id).delete(); }); Mem.del(col, id); },
  get: async function (col, id) {
    if (S.db) { var d = await S.db.doc(col + '/' + id).get(); if (!d.exists) return null; var o = Object.assign({}, d.data()); o.id = d.id; return o; }
    var x = Mem.data[col] && Mem.data[col][id]; return x ? Object.assign({ id: id }, x) : null;
  },
  query: async function (col, filtros) {
    if (S.db) {
      var q = S.db.collection(col);
      filtros.forEach(function (f) { q = q.where(f[0], f[1], f[2]); });
      var snap = await q.get();
      return snap.docs.filter(function (d) { return d.exists; }).map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; });
    }
    return Mem.list(col).filter(function (o) { return filtros.every(function (f) { return f[1] === '==' ? o[f[0]] === f[2] : true; }); });
  },
  // Trava cooperativa: serializa operações que tiram peças de um canteiro/tipo
  trava: async function (nome) {
    if (!S.db) return;
    var ref = S.db.doc('travas/' + nome);
    for (var i = 0; i < 20; i++) {
      var r = await ref.acquire({ holder: S.uid || S.tabId, ttlMs: 6000 });
      if (r.acquired) return;
      await sleep(400 + Math.random() * 400);
    }
    throw Falha(['Outra pessoa está movimentando este estoque agora. Tente de novo em alguns segundos.']);
  }
};
async function withRetry(fn) {
  try { return await fn(); }
  catch (e) { if (e && e.code === 'unavailable') { await sleep(500 + Math.random() * 800); return fn(); } throw e; }
}
var Mem = {
  data: {}, subs: {},
  list: function (col) { var d = Mem.data[col] || {}; return Object.keys(d).map(function (k) { return Object.assign({ id: k }, d[k]); }); },
  notify: function (col) { if (Mem.subs[col]) Mem.subs[col](Mem.list(col), { fromCache: false }); },
  set: function (col, id, data) { (Mem.data[col] = Mem.data[col] || {})[id] = JSON.parse(JSON.stringify(data)); Mem.notify(col); },
  update: function (col, id, data) { var cur = (Mem.data[col] || {})[id]; if (!cur) throw new Error('Documento não existe'); Object.assign(cur, JSON.parse(JSON.stringify(data))); Mem.notify(col); },
  del: function (col, id) { if (Mem.data[col]) delete Mem.data[col][id]; Mem.notify(col); }
};

// Recalcula a partir do razão "fresco" do servidor, sob trava
async function estadoFresco(canteiroId, tipoId) {
  await Store.trava(canteiroId + '__' + tipoId);
  var movs = await Store.query('movimentos', [['canteiroId', '==', canteiroId], ['tipoId', '==', tipoId]]);
  var trs = await Store.query('transferencias', [['origemId', '==', canteiroId], ['status', '==', 'SOLICITADA']]);
  return { saldos: C.calcularSaldos(movs), reservas: C.calcularReservas(trs), movs: movs };
}

function recalcular() {
  S.d.saldos = C.calcularSaldos(S.movimentos);
  S.d.reservas = C.calcularReservas(S.transferencias);
  S.d.transito = C.calcularTransito(S.transferencias);
  S.d.entrando = C.calcularEntrando(S.transferencias);
}

// ---------- inicialização ----------
async function init() {
  window.addEventListener('hashchange', render);
  $('#hamb').onclick = function () { $('aside').classList.toggle('open'); };
  render();
  var loadTimer = setTimeout(function () {
    if (S.modo === 'carregando') { S.aviso = 'Os dados ainda não chegaram do servidor. Verifique a conexão; a página continua tentando.'; render(); }
  }, 10000);
  var db = null, user = null;
  try {
    var cl = window.claude;
    if (cl && cl.use) {
      var res = await Promise.all([cl.use('db'), cl.use('user')]);
      db = res[0]; user = res[1];
    }
  } catch (e) { db = null; }
  S.db = db; S.user = user;
  if (user) {
    try { S.uid = await user.id(); } catch (e) {}
    try { S.canEdit = await user.canEdit(); } catch (e) {}
    try { S.canWrite = await user.can('data.write'); } catch (e) {}
  }
  if (!db) {
    clearTimeout(loadTimer);
    S.modo = 'local'; S.uid = 'local'; S.canEdit = true; S.canWrite = true;
    COLS.forEach(function (c) { Store.sub(c, function (rows) { onData(c, rows); }); });
    render(); return;
  }
  S.modo = 'online';
  if (S.canWrite === false) S.readonly = true;
  COLS.forEach(function (col) {
    Store.sub(col, function (rows, meta) {
      if (!meta || !meta.fromCache) { S.loaded[col] = true; if (COLS.every(function (c) { return S.loaded[c]; })) { clearTimeout(loadTimer); S.aviso = null; } }
      onData(col, rows);
    }, function (e) {
      clearTimeout(loadTimer);
      S.aviso = e && e.code === 'revoked' ? 'O acesso a esta página mudou. Recarregue para continuar.' : 'Falha ao ler "' + col + '": ' + errMsg(e);
      render();
    });
  });
}
var renderPend = false;
function onData(col, rows) {
  S.ver++;
  if (col === 'config') { S.config = rows.find(function (r) { return r.id === 'geral'; }) || {}; }
  else if (col === 'planejamento') { S.prioridades = rows.find(function (r) { return r.id === 'prioridades'; }) || { tramos: [] }; S.cargas = rows.filter(function (r) { return /^cg_/.test(r.id); }); juntarNFs(); }
  else if (col === 'projeto') {
    var tw = rows.find(function (r) { return r.id === 'torres'; });
    S.torres = tw && Array.isArray(tw.lista) ? tw.lista : [];
    S.projeto = rows.find(function (r) { return r.id === 'info'; }) || {};
    S.estai = rows.find(function (r) { return r.id === 'estai'; }) || null;
    S.nfsMeta = rows.find(function (r) { return r.id === 'nfs_meta'; }) || {};
    var partes = rows.filter(function (r) { return /^nfs_\d+$/.test(r.id) && Number(r.id.slice(4)) < (S.nfsMeta.partes || 0); })
      .sort(function (a, b) { return Number(a.id.slice(4)) - Number(b.id.slice(4)); });
    S.nfsPlan = [].concat.apply([], partes.map(function (p) { return Array.isArray(p.lista) ? p.lista : []; }));
    S.nfeMeta = rows.find(function (r) { return r.id === 'nfe_meta'; }) || {};
    S.nfcMeta = rows.find(function (r) { return r.id === 'nfc_meta'; }) || {};
    S.nfsCtrl = [].concat.apply([], rows.filter(function (r) { return /^nfc_\d+$/.test(r.id) && Number(r.id.slice(4)) < (S.nfcMeta.partes || 0); }).sort(function (a, b) { return Number(a.id.slice(4)) - Number(b.id.slice(4)); }).map(function (p) { return Array.isArray(p.lista) ? p.lista : []; }));
    S.nfsEmp = [].concat.apply([], rows.filter(function (r) { return /^nfe_\d+$/.test(r.id) && Number(r.id.slice(4)) < (S.nfeMeta.partes || 0); }).sort(function (a, b) { return Number(a.id.slice(4)) - Number(b.id.slice(4)); }).map(function (p) { return Array.isArray(p.lista) ? p.lista : []; }));
    juntarNFs();
  }
  else S[col] = rows;
  if (col === 'movimentos' || col === 'transferencias') recalcular();
  if (!renderPend) { renderPend = true; requestAnimationFrame(function () { renderPend = false; resolverNomes(); render(true); }); }
}
var nomesPedidos = {};
async function resolverNomes() {
  if (!S.user || !S.user.profiles) return;
  var ids = {};
  S.movimentos.forEach(function (m) { if (m.usuarioId) ids[m.usuarioId] = 1; });
  S.transferencias.forEach(function (t) { ['criadoPor', 'despachadoPor', 'recebidoPor', 'canceladoPor'].forEach(function (k) { if (t[k]) ids[t[k]] = 1; }); });
  var falta = Object.keys(ids).filter(function (i) { return !nomesPedidos[i] && i !== 'local'; });
  if (!falta.length) return;
  falta.forEach(function (i) { nomesPedidos[i] = 1; });
  try {
    var ps = await S.user.profiles(falta);
    falta.forEach(function (i) { if (ps && ps[i] && ps[i].name) S.names[i] = ps[i].name; });
    render(true);
  } catch (e) {}
}

// ---------- roteamento / layout ----------
var VIEWS = [
  { sec: 'Visão geral' },
  { id: 'painel', t: 'Painel', ic: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z' },
  { id: 'torres', t: 'Torres do projeto', ic: 'M12 2l5 20M12 2L7 22M8 10h8M7 16h10' },
  { id: 'completas', t: 'Torres completas', ic: 'M4 12l5 5L20 6' },
  { id: 'estoque', t: 'Estoque', ic: 'M4 7l8-4 8 4-8 4zm0 5l8 4 8-4M4 17l8 4 8-4' },
  { id: 'fornecimento', t: 'Fornecimento e valor', ic: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { sec: 'Operação' },
  { id: 'remanejamento', t: 'Remanejamento', ic: 'M7 7h11l-3-3m3 3l-3 3M17 17H6l3 3m-3-3l3-3' },
  { id: 'prioridade', t: 'Prioridade de tramos', ic: 'M4 20h16M6 16l3-8 3 5 3-9 3 12' },
  { id: 'notas', t: 'Controle de NFs', ic: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13l2 2 4-4' },
  { id: 'cargas', t: 'Cargas a chegar', ic: 'M2 7h12v9H2zM14 10h4l3 3v3h-7M6 19a2 2 0 100-4 2 2 0 000 4zm11 0a2 2 0 100-4 2 2 0 000 4zM5 4h6' },
  { id: 'transferencias', t: 'Transferências', ic: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M7 20a2 2 0 100-4 2 2 0 000 4zm11 0a2 2 0 100-4 2 2 0 000 4z' },
  { id: 'lancamentos', t: 'Recebimentos e saídas', ic: 'M12 5v14M5 12h14' },
  { id: 'aplicacoes', t: 'Aplicação em torre', ic: 'M12 3l2 6h-4zM9 9h6l2 12H7z' },
  { id: 'inventario', t: 'Inventário', ic: 'M9 5h10M9 12h10M9 19h10M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2' },
  { id: 'historico', t: 'Histórico', ic: 'M12 8v4l3 2M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4' },
  { sec: 'Cadastros' },
  { id: 'canteiros', t: 'Canteiros', ic: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6' },
  { id: 'tipos', t: 'Tipos e volumes', ic: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'importar', t: 'Importar projeto', ic: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3' }
];
// Menu em ordem alfabética dentro de cada seção (o Painel fica sempre no topo)
VIEWS = (function (L) {
  var out = [], bloco = [];
  var fecha = function () { bloco.sort(function (a, b) { return a.id === 'painel' ? -1 : b.id === 'painel' ? 1 : a.t.localeCompare(b.t, 'pt-BR'); }); out = out.concat(bloco); bloco = []; };
  L.forEach(function (v) { if (v.sec) { fecha(); out.push(v); } else bloco.push(v); }); fecha();
  return out;
})(VIEWS);
function rota() { var h = (location.hash || '').replace('#', ''); return VIEWS.some(function (v) { return v.id === h; }) ? h : 'painel'; }
function icon(d) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; }

var lastScroll = {};
function render(fromData) {
  var r = rota();
  if (fromData && $('#modal')) { atualizarModalVivo(); }
  var emTransito = S.transferencias.filter(function (t) { return t.status === 'EM_TRANSITO' || t.status === 'SOLICITADA'; }).length;
  $('nav').innerHTML = VIEWS.map(function (v) {
    if (v.sec) return '<div class="sec">' + v.sec + '</div>';
    var nCg = (S.cargas || []).filter(function (c) { return c.status === 'PREVISTA'; }).length;
    var b = v.id === 'transferencias' && emTransito ? '<span class="badge">' + emTransito + '</span>' : v.id === 'cargas' && nCg ? '<span class="badge">' + nCg + '</span>' : '';
    return '<a href="#' + v.id + '" class="' + (v.id === r ? 'on' : '') + '">' + icon(v.ic) + esc(v.t) + b + '</a>';
  }).join('');
  $('#obraNome').textContent = S.config.nomeObra || 'Linha de transmissão';
  var st = $('#status');
  st.innerHTML = S.modo === 'online' ? '<span class="statusdot"></span> Sincronizado' + (S.readonly ? ' · somente leitura' : '')
    : S.modo === 'local' ? '<span class="statusdot off"></span> Modo local' : '<span class="statusdot off"></span> Conectando…';
  var focusId = document.activeElement && document.activeElement.id;
  var selS = focusId && document.activeElement.selectionStart;
  var main = $('#view');
  var prevView = main.getAttribute('data-v');
  if (prevView === r) lastScroll[r] = window.scrollY;
  var html = '';
  if (S.modo === 'local') html += '<div class="banner warn"><b>Modo local:</b> o banco compartilhado não está disponível nesta visualização, então nada é salvo ao recarregar. Abra pelo link publicado, com login, para usar de verdade.</div>';
  if (S.aviso) html += '<div class="banner bad">' + esc(S.aviso) + '</div>';
  if (S.readonly) html += '<div class="banner info">Você tem acesso somente de leitura. Peça ao dono acesso de Colaborador para lançar movimentações.</div>';
  try { html += V[r](); } catch (e) { console.error(e); html += '<div class="banner bad">Erro ao montar a tela: ' + esc(e.message) + '</div>'; }
  main.innerHTML = html;
  main.setAttribute('data-v', r);
  rotularTabelas(main);
  if (prevView !== r) { main.classList.remove('v-enter'); void main.offsetWidth; main.classList.add('v-enter'); clearTimeout(render._ent); render._ent = setTimeout(function () { main.classList.remove('v-enter'); }, 700); }
  if (V[r + '_bind']) V[r + '_bind']();
  if (focusId) { var el = document.getElementById(focusId); if (el) { el.focus(); try { if (selS != null) el.setSelectionRange(selS, selS); } catch (e) {} } }
  if (prevView === r && lastScroll[r] != null) window.scrollTo(0, lastScroll[r]);
  else if (!fromData) window.scrollTo(0, 0);
  $('aside').classList.remove('open');
}
// Filtros persistem entre renders
var F = {
  estoque: { tipo: '', so: '', q: '' }, torres: { tipo: '', canteiro: '', so: '', q: '', lim: 150, modo: 'mapa' }, completas: { tipo: '', canteiro: '' }, rem: { tipo: '*', destino: '', res: null },
  transf: { status: 'ABERTAS' }, hist: { canteiro: '', tipo: '', natureza: '', de: '', ate: '', q: '', lim: 200 },
  mont: { canteiro: '', tipo: '', q: '' }, inv: { canteiro: '', tipo: '', q: '' }, notas: { status: '', forn: '', canteiro: '', q: '', lim: 100 }, prio: { tramos: [], escopo: 'canteiro', resto: true, carregado: false, novoTipos: [] }
};
function semCadastro() {
  if (!S.tipos.length || !S.canteiros.length) {
    return '<div class="card empty"><b>Projeto ainda não carregado</b>Vá em <a href="#importar">Importar projeto</a> para carregar tipos, volumes, a lista de construção e o histórico das planilhas.</div>';
  }
  return '';
}
function head(t, p, tools) { return '<div class="top"><div><h1>' + esc(t) + '</h1>' + (p ? '<p>' + p + '</p>' : '') + '</div><div class="toolbar">' + (tools || '') + '</div></div>'; }
function podeGravar() { return !S.readonly; }
function podeCadastrar() { return !S.readonly && S.canEdit !== false; }

var V = {};
// ---------- análises compartilhadas (memorizadas por versão dos dados) ----------
var memo = { ver: -1 };
function M() { if (memo.ver !== S.ver) memo = { ver: S.ver, ap: null, aloc: {}, rem: {}, pot: {} }; return memo; }
function aplicado() { var m = M(); if (!m.ap) m.ap = C.aplicadoPorTorre(S.movimentos); return m.ap; }
function torresDo(tipoId) { return S.torres.filter(function (t) { return t.t === tipoId; }); }
function torreByN(n) { return S.torres.find(function (t) { return t.n === n; }); }
function aloc(tipoId) {
  var m = M(); if (!m.aloc[tipoId]) { var t = tipoById(tipoId); m.aloc[tipoId] = t ? C.alocarTipo(t, torresDo(tipoId), cantsOrd(true), S.d.saldos, S.d.reservas, aplicado()) : { torres: {}, sobra: {}, resumo: {} }; }
  return m.aloc[tipoId];
}
function rem(tipoId, destino) {
  var m = M(), k = tipoId + '|' + (destino || '');
  if (!m.rem[k]) { var t = tipoById(tipoId); m.rem[k] = C.sugerirRemanejamento(t, torresDo(tipoId), cantsOrd(true), S.d.saldos, S.d.reservas, aplicado(), { destinoId: destino || null, entrando: S.d.entrando }); }
  return m.rem[k];
}
function potencial(tipoId) {
  var m = M(); if (m.pot[tipoId] == null) { var t = tipoById(tipoId); m.pot[tipoId] = Math.max(C.maximoTeorico(t, torresDo(tipoId), cantsOrd(true), S.d.saldos, S.d.reservas, aplicado()), rem(tipoId).depois); }
  return m.pot[tipoId];
}
function infoTorre(t) { var a = aloc(t.t), i = a.torres[t.n] || { status: 'pendente', kitDisponivel: false, falta: [] }; i.tipoId = t.t; return i; }
var ST_TORRE = { pendente: ['Aguardando', ''], fundacao: ['Stub aplicado', 'info'], parcial: ['Montagem parcial', 'warn'], montada: ['Montada', 'ok'] };
function tagStatus(st) { var x = ST_TORRE[st] || ST_TORRE.pendente; return '<span class="tag ' + x[1] + '">' + x[0] + '</span>'; }
function tagKit(info) {
  if (info.status === 'montada') return '<span class="muted small">—</span>';
  if (info.kitDisponivel) return '<span class="tag ok">Kit completo em estoque</span>';
  var n = info.falta.reduce(function (a, f) { return a + f.qtd; }, 0);
  return '<span class="tag bad" title="' + esc('Falta: ' + info.falta.map(function (f) { return compNome(info.tipoId || '', f.componenteId) + ' ×' + f.qtd; }).join(', ')) + '">Faltam ' + nf(n) + ' vol.</span>';
}
function pesoEstoque() {
  var p = 0, pesos = {};
  S.tipos.forEach(function (t) { (t.volumes || []).forEach(function (v) { pesos[t.id + '|' + v.id] = Number(v.pesoKg || 0); }); });
  S.d.saldos.forEach(function (q, k) { var parts = k.split('|'); if (q > 0) p += q * (pesos[parts[1] + '|' + parts[2]] || 0); });
  return p;
}
function negativos() {
  var out = [];
  S.d.saldos.forEach(function (q, k) { if (q < 0) { var p = k.split('|'); out.push({ c: p[0], t: p[1], comp: p[2], q: q }); } });
  return out;
}

// ---------- PAINEL ----------
V.painel = function () {
  var h = head('Painel', S.config.nomeObra ? esc(S.config.nomeObra) + ' · situação real dos estoques de estruturas' : 'Situação real dos estoques de torres em todos os canteiros.');
  var pe = S.projeto && S.projeto.planilhaEstoque;
  if (pe && pe.em) h += '<p class="small muted" style="margin:-6px 0 12px">Estoque conferido com a planilha da empreiteira <b>' + esc(pe.arquivo || '') + '</b> em ' + fdh(pe.em) + (pe.ultimoMov ? ' · último lançamento da planilha: ' + fdata(pe.ultimoMov) : '') + (podeCadastrar() ? ' · <a href="#importar">atualizar</a>' : '') + '</p>';
  var sc = semCadastro(); if (sc) return h + sc + guiaInicial();
  var tot = { projeto: 0, montadas: 0, prontas: 0, depois: 0, fundacao: 0, ganho: 0, caminho: 0 }, linhas = [];
  tiposOrd().forEach(function (t) {
    var a = aloc(t.id), r = rem(t.id), l = { t: t, projeto: 0, montadas: 0, prontas: 0, depois: r.depois, ganho: r.depois - r.antes, pot: potencial(t.id), fundacao: 0 };
    cantsOrd(true).forEach(function (c) { var x = a.resumo[c.id]; if (!x) return; l.projeto += x.projeto; l.montadas += x.montadas; l.fundacao += x.fundacao; l.prontas += x.prontas; });
    l.caminho = r.antes - l.prontas;
    ['projeto', 'montadas', 'prontas', 'depois', 'fundacao', 'ganho', 'caminho'].forEach(function (k) { tot[k] += l[k]; });
    linhas.push(l);
  });
  var abertas = S.transferencias.filter(function (t) { return t.status === 'SOLICITADA' || t.status === 'EM_TRANSITO'; });
  h += '<div class="kpis">' +
    kpi('Torres no projeto', nf(tot.projeto), nf(tot.montadas) + ' montadas · ' + nf(tot.fundacao) + ' com stub aplicado') +
    kpi('Prontas para montar', nf(tot.prontas), 'kit completo em estoque no próprio canteiro') +
    kpi('Ganho com remanejamento', '+' + nf(tot.ganho), (tot.caminho > 0 ? '+' + nf(tot.caminho) + ' já a caminho · ' : '') + (tot.ganho ? '<a href="#remanejamento">ver sugestões</a>' : 'nada novo a remanejar')) +
    (S.nfs.length ? kpi('Valor em estoque', brl(valorEstoque().total, true), nf(pesoEstoque() / 1000, 0) + ' t · <a href="#fornecimento">fornecimento</a>') : kpi('Peso em estoque', nf(pesoEstoque() / 1000, 1) + ' t', 'estruturas nos canteiros')) +
    kpi('Transferências abertas', nf(abertas.length), nf(abertas.filter(function (t) { return t.status === 'EM_TRANSITO'; }).length) + ' em trânsito') + '</div>' + faixaCargasPainel();

  h += '<div class="card"><h2>Torres por tipo <span class="sub">prontas = kit completo (corpo, extensão, pernas e stubs da torre) disponível no canteiro dela</span></h2><div class="tw"><table><thead><tr><th>Tipo</th><th>Estrutura</th><th class="n">No projeto</th><th class="n">Montadas</th><th class="n">Prontas hoje</th><th class="n">Após remanejar</th><th class="n">Potencial*</th><th>Avanço</th><th></th></tr></thead><tbody>' +
    linhas.map(function (l) {
      var g = l.ganho, pct = l.projeto ? 100 * (l.montadas + l.prontas) / l.projeto : 0;
      return '<tr><td><b>' + esc(l.t.codigo) + '</b></td><td class="small">' + esc(l.t.estrutura || '') + (l.t.fixacao ? ' · ' + esc(l.t.fixacao) : '') + '</td><td class="n">' + nf(l.projeto) + '</td><td class="n">' + cell(l.montadas) + '</td><td class="n"><b>' + cell(l.prontas) + '</b></td>' +
        '<td class="n">' + nf(l.depois) + (g ? ' <span class="tag ok">+' + g + '</span>' : '') + (l.caminho > 0 ? ' <span class="tag info" title="já a caminho">+' + l.caminho + '</span>' : '') + '</td><td class="n">' + nf(l.pot) + '</td>' +
        '<td style="width:130px" title="montadas + prontas sobre o total do projeto"><div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div></td>' +
        '<td>' + (g ? '<a class="btn sm" href="#remanejamento" data-rem="' + esc(l.t.id) + '">Remanejar</a>' : '') + '</td></tr>';
    }).join('') + '<tr style="background:#fafbf9"><td><b>Total</b></td><td></td><td class="n"><b>' + nf(tot.projeto) + '</b></td><td class="n"><b>' + nf(tot.montadas) + '</b></td><td class="n"><b>' + nf(tot.prontas) + '</b></td><td class="n"><b>' + nf(tot.depois) + '</b></td><td></td><td></td><td></td></tr></tbody></table></div>' +
    '<p class="small muted" style="margin:8px 0 0">* Potencial: torres que teriam kit completo se todo o estoque do tipo estivesse num só canteiro.</p></div>';

  var alertas = [];
  negativos().forEach(function (n) { alertas.push('<span class="tag bad">Saldo negativo</span> ' + esc(cantNome(n.c)) + ' · ' + esc(tipoCod(n.t)) + ' · ' + esc(compNome(n.t, n.comp)) + ': <b class="mono">' + nf(n.q) + '</b> — faça um <a href="#inventario">inventário</a>.'); });
  S.transferencias.forEach(function (t) {
    var dias = (Date.now() - new Date(t.despachadoEm || t.criadoEm).getTime()) / 864e5;
    if (t.status === 'EM_TRANSITO' && dias > 7) alertas.push('<span class="tag warn">Em trânsito há ' + Math.floor(dias) + ' dias</span> ' + esc(t.numero));
    if (t.status === 'SOLICITADA' && dias > 5) alertas.push('<span class="tag warn">Solicitada há ' + Math.floor(dias) + ' dias</span> ' + esc(t.numero) + ' (peças reservadas)');
    if (t.status === 'RECEBIDA' && t.divergencia && !t.divergenciaTratada) alertas.push('<span class="tag bad">Divergência no recebimento</span> ' + esc(t.numero) + ' · <a href="#transferencias">ver</a>');
  });
  var porCant = cantsOrd(true).map(function (c) {
    var r = { projeto: 0, montadas: 0, prontas: 0, incompletas: 0 };
    tiposOrd().forEach(function (t) { var x = aloc(t.id).resumo[c.id]; if (x) { r.projeto += x.projeto; r.montadas += x.montadas; r.prontas += x.prontas; r.incompletas += x.incompletas; } });
    return { c: c, r: r };
  });
  h += '<div class="grid2"><div class="card"><h2>Por canteiro</h2><table><thead><tr><th>Canteiro</th><th class="n">Projeto</th><th class="n">Montadas</th><th class="n">Prontas</th><th class="n">Sem kit</th></tr></thead><tbody>' +
    porCant.map(function (x) { return '<tr><td><b>' + esc(x.c.nome) + '</b></td><td class="n">' + nf(x.r.projeto) + '</td><td class="n">' + cell(x.r.montadas) + '</td><td class="n">' + cell(x.r.prontas) + '</td><td class="n">' + cell(x.r.incompletas) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<div class="card"><h2>Alertas</h2>' + (alertas.length ? '<div style="display:flex;flex-direction:column;gap:8px">' + alertas.slice(0, 30).map(function (a) { return '<div class="small">' + a + '</div>'; }).join('') + '</div>' : '<div class="empty" style="padding:12px">Nenhum alerta no momento.</div>') + '</div></div>';
  var ult = S.movimentos.slice().sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); }).slice(0, 8);
  h += '<div class="card"><h2>Últimas movimentações <a class="btn sm" href="#historico" style="margin-left:auto">Ver histórico</a></h2>' + tabelaMovs(ult, true) + '</div>';
  return h;
};
V.painel_bind = function () { $$('[data-rem]').forEach(function (a) { a.onclick = function () { F.rem.tipo = a.getAttribute('data-rem'); F.rem.res = null; }; }); };
function kpi(l, v, h) { return '<div class="kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="h">' + h + '</div></div>'; }
function guiaInicial() {
  return '<div class="card"><h2>Como começar</h2><ol style="margin:0;padding-left:20px;line-height:1.8">' +
    '<li><b>Importe o projeto:</b> em <a href="#importar">Importar projeto</a> carregue tipos, volumes, a lista de construção (todas as torres) e o histórico da planilha de estruturas.</li>' +
    '<li><b>Torres do projeto:</b> veja, torre a torre, o kit necessário (corpo, extensão, pernas, stubs) e se ele está em estoque.</li>' +
    '<li><b>Remanejamento:</b> o sistema indica quais volumes mover entre canteiros para completar o máximo de torres.</li>' +
    '<li><b>No dia a dia:</b> lance recebimentos, transferências e aplicações em torre; o saldo é sempre calculado pelo histórico.</li></ol></div>';
}
// ---- tabela de movimentações reutilizável
function tabelaMovs(movs, compacta) {
  if (!movs.length) return '<div class="empty">Nenhuma movimentação.</div>';
  var est = estornados();
  return '<div class="tw"><table><thead><tr><th>Data</th><th>Natureza</th><th>Canteiro</th><th>Tipo</th><th>Itens</th>' + (compacta ? '' : '<th>Documento / obs.</th><th>Usuário</th><th></th>') + '</tr></thead><tbody>' +
    movs.map(function (m) {
      var tot = m.itens.reduce(function (a, i) { return a + Number(i.qtd); }, 0);
      var cls = m.natureza === 'ENTRADA' || m.natureza === 'TRANSF_ENTRADA' ? 'ok' : m.natureza === 'AJUSTE' || m.natureza === 'ESTORNO' ? 'warn' : m.natureza === 'MONTAGEM' || m.natureza === 'APLICACAO' ? 'acc' : 'info';
      var e = est[m.id];
      var podeEst = !compacta && podeGravar() && !e && !m.estornoDe && ['ENTRADA', 'SAIDA', 'AJUSTE', 'MONTAGEM', 'APLICACAO'].indexOf(m.natureza) >= 0;
      return '<tr><td class="small">' + fdata(m.data) + '<div class="muted" style="font-size:11px">' + fdh(m.criadoEm) + '</div></td>' +
        '<td><span class="tag ' + cls + '">' + esc(C.NATUREZAS[m.natureza] || m.natureza) + '</span>' + (e ? ' <span class="tag bad">estornado</span>' : '') +
        (m.numeroTorre ? '<div class="small">Torre <b>' + esc(m.numeroTorre) + '</b></div>' : '') + '</td>' +
        '<td>' + esc(cantNome(m.canteiroId)) + '</td><td>' + esc(tipoCod(m.tipoId)) + '</td>' +
        '<td>' + itensResumo(m.tipoId, m.itens, compacta ? 3 : 5) + '<div class="small muted">' + (tot > 0 ? '+' : '') + nf(tot) + ' un.</div></td>' +
        (compacta ? '' : '<td class="small">' + esc(m.documento || '') + (m.obs ? '<div class="muted">' + esc(m.obs) + '</div>' : '') + '</td><td class="small">' + esc(userName(m.usuarioId)) + '</td>' +
          '<td>' + (podeEst ? '<button class="btn sm danger" data-estornar="' + esc(m.id) + '">Estornar</button>' : '') + '</td>') + '</tr>';
    }).join('') + '</tbody></table></div>';
}

// ===== ESTOQUE =====
function necessidadePendente(tipoId) {
  var m = M(); m.nec = m.nec || {};
  if (m.nec[tipoId]) return m.nec[tipoId];
  var t = tipoById(tipoId), out = {}, ap = aplicado();
  torresDo(tipoId).forEach(function (tw) {
    if (!t) return;
    var need = C.necessidade(t, tw, ap), o = out[tw.c] = out[tw.c] || {};
    for (var k in need) o[k] = (o[k] || 0) + need[k];
  });
  return (m.nec[tipoId] = out);
}
function gruposOrdenados(tipo) {
  var g = C.porGrupo(tipo);
  return Object.keys(g).sort(function (a, b) {
    var ord = function (x) { return x === 'TB' ? 0 : /^EXT/.test(x) ? 1 : /^PERNA/.test(x) ? 2 : x === 'AP/STB' ? 3 : 4; };
    var num = function (x) { return parseFloat(String(x).replace(/[^\d,]/g, '').replace(',', '.')) || 0; };
    return ord(a) - ord(b) || num(a) - num(b) || a.localeCompare(b);
  }).map(function (k) { return { grupo: k, volumes: g[k].slice().sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true }); }) }; });
}
var NOME_GRUPO = { TB: 'Torre básica / corpo', 'AP/STB': 'Stubs (apoio)', PINO: 'Pino', CALOTA: 'Calota', PRA: 'Para-raios em ancoragem', PRS: 'Para-raios em suspensão' };
function nomeGrupo(g) {
  if (NOME_GRUPO[g]) return NOME_GRUPO[g];
  if (/^EXT/.test(g)) return 'Extensão ' + g.slice(3) + ' m';
  if (/^PERNA/.test(g)) return 'Perna ' + g.slice(5) + ' m';
  return g;
}
V.estoque = function () {
  var h = head('Estoque', 'Por volume: disponível em cada canteiro (físico menos reservado) comparado com o que falta aplicar nas torres pendentes.',
    '<button class="btn" id="expEst">Exportar CSV</button>');
  var sc = semCadastro(); if (sc) return h + sc;
  var f = F.estoque;
  if (!f.tipo || !tipoById(f.tipo)) f.tipo = tiposOrd()[0].id;
  var t = tipoById(f.tipo), cs = cantsOrd(false), nec = necessidadePendente(t.id), G = C.get;
  h += '<div class="card"><div class="row"><div class="field"><label>Tipo de torre</label><select id="fTipo">' + optList(tiposOrd(), f.tipo, function (x) { return tipoNome(x.id); }) + '</select></div>' +
    '<div class="field"><label>Mostrar</label><select id="fSo"><option value="">Todos os volumes</option><option value="falta"' + (f.so === 'falta' ? ' selected' : '') + '>Somente onde falta para as torres</option><option value="saldo"' + (f.so === 'saldo' ? ' selected' : '') + '>Somente com saldo</option></select></div>' +
    '<div class="field"><label>Buscar volume</label><input id="fQ" value="' + esc(f.q || '') + '" placeholder="Ex.: EXTENSAO 12"></div></div></div>';
  var q = (f.q || '').toUpperCase();
  h += '<div class="card"><h2>' + esc(tipoNome(t.id)) + ' <span class="sub">disponível por canteiro · <span class="tag warn" style="font-size:10.5px">-n</span> reservado · <span class="tag info" style="font-size:10.5px">+n</span> a caminho · "Falta" = necessário para as torres pendentes − disponível</span></h2><div class="tw" style="max-height:70vh"><table><thead><tr><th>Volume</th><th class="n">Peso (kg)</th>' +
    cs.map(function (c) { return '<th class="n">' + esc(c.nome) + '</th><th class="n" title="Necessário para as torres pendentes deste canteiro">Nec.</th>'; }).join('') + '<th class="n">Total disp.</th><th class="n">Total nec.</th><th class="n">Falta</th></tr></thead><tbody>';
  var linhas = 0;
  gruposOrdenados(t).forEach(function (g) {
    var corpo = '';
    g.volumes.forEach(function (v) {
      if (q && v.nome.toUpperCase().indexOf(q) < 0 && g.grupo.indexOf(q) < 0) return;
      var totD = 0, totN = 0, cels = '';
      cs.forEach(function (c) {
        var s = G(S.d.saldos, c.id, t.id, v.id), r = G(S.d.reservas, c.id, t.id, v.id), tr = G(S.d.transito, c.id, t.id, v.id), d = s - r, n = (nec[c.id] || {})[v.id] || 0;
        totD += d; totN += n;
        cels += '<td class="n" title="Físico ' + s + ' · reservado ' + r + ' · a caminho ' + tr + '">' + cell(d) + (r ? ' <span class="tag warn" style="font-size:10.5px">-' + r + '</span>' : '') + (tr ? ' <span class="tag info" style="font-size:10.5px">+' + tr + '</span>' : '') + '</td>' +
          '<td class="n muted">' + (n ? nf(n) : '<span class="zero">·</span>') + '</td>';
      });
      var falta = Math.max(0, totN - Math.max(0, totD));
      if (f.so === 'falta' && !falta) return;
      if (f.so === 'saldo' && !totD) return;
      linhas++;
      corpo += '<tr><td>' + esc(v.nome) + '</td><td class="n muted">' + nf(v.pesoKg, 1) + '</td>' + cels + '<td class="n"><b>' + cell(totD) + '</b></td><td class="n">' + nf(totN) + '</td><td class="n">' + (falta ? '<span class="tag bad">' + nf(falta) + '</span>' : '<span class="zero">0</span>') + '</td></tr>';
    });
    if (corpo) h += '<tr><td colspan="' + (5 + cs.length * 2) + '" style="background:#f4f5f2;font-weight:600;font-size:12.5px">' + esc(nomeGrupo(g.grupo)) + ' <span class="muted" style="font-weight:400">(' + esc(g.grupo) + ')</span></td></tr>' + corpo;
  });
  if (!linhas) h += '<tr><td colspan="' + (5 + cs.length * 2) + '" class="empty">Nenhum volume para o filtro.</td></tr>';
  h += '</tbody></table></div></div>';
  return h;
};
V.estoque_bind = function () {
  var a = $('#fTipo'); if (a) a.onchange = function () { F.estoque.tipo = a.value; render(); };
  var b = $('#fSo'); if (b) b.onchange = function () { F.estoque.so = b.value; render(); };
  var qi = $('#fQ'), tm; if (qi) qi.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { F.estoque.q = qi.value; render(); }, 250); };
  var ex = $('#expEst'); if (ex) ex.onclick = exportarEstoque;
};

// ===== TORRES DO PROJETO =====
/** Tramos da LT: trecho entre duas torres de ancoragem (a de ancoragem fecha um tramo e abre o seguinte). */
function tramosAncoragem() {
  var m = M(); if (m.trAnc) return m.trAnc;
  var ts = S.torres.slice().sort(function (a, b) { return a.op - b.op; }), out = [], atual = [];
  var ancora = function (t) { var tp = tipoById(t.t); return tp && figuraTipo(tp) === 'ancoragem'; };
  ts.forEach(function (t, i) {
    atual.push(t);
    if ((ancora(t) && atual.length > 1) || i === ts.length - 1) { out.push(atual); atual = ancora(t) ? [t] : []; }
  });
  m.trAnc = out.map(function (g, k) { return { id: 'A' + (k + 1), nome: 'Tramo ' + (k + 1), de: g[0].n, ate: g[g.length - 1].n, n: g.length, torres: g }; });
  m.trDaTorre = {}; m.trAnc.forEach(function (tr) { tr.torres.forEach(function (t) { if (!m.trDaTorre[t.n]) m.trDaTorre[t.n] = tr; }); });
  return m.trAnc;
}
function tramoDaTorre(n) { tramosAncoragem(); return M().trDaTorre[n]; }
function tramosSalvos() { return (F.prio && F.prio.carregado ? F.prio.tramos : (S.prioridades && S.prioridades.tramos)) || []; }
/** Faixa de operação do filtro de tramo: tramo salvo na aba Prioridade ou trecho personalizado (da torre X até a Y). */
function faixaTramoFiltro() {
  var f = F.torres, a, b;
  if (!f.tramo) return null;
  if (f.tramo === '_custom') { a = torreByN((f.trDe || '').trim()); b = torreByN((f.trAte || '').trim()); }
  else if (f.tramo === '_todos') return null;
  else { var tr = (f.tramo.charAt(0) === 'A' ? tramosAncoragem() : tramosSalvos()).find(function (x) { return x.id === f.tramo; }); if (!tr) return null; a = torreByN(tr.de); b = torreByN(tr.ate); }
  if (!a || !b) return null;
  return { lo: Math.min(a.op, b.op), hi: Math.max(a.op, b.op), de: a.op <= b.op ? a.n : b.n, ate: a.op <= b.op ? b.n : a.n };
}
function filtrarTorres() {
  var f = F.torres, q = (f.q || '').trim(), fx = faixaTramoFiltro();
  return S.torres.filter(function (t) {
    if (fx && (t.op < fx.lo || t.op > fx.hi)) return false;
    if (f.tipo && t.t !== f.tipo) return false;
    if (f.canteiro && t.c !== f.canteiro) return false;
    if (q && String(t.n).indexOf(q) !== 0) return false;
    if (f.so) {
      var i = infoTorre(t);
      if (f.so === 'prontas' && !(i.kitDisponivel && i.status !== 'montada')) return false;
      if (f.so === 'semkit' && (i.kitDisponivel || i.status === 'montada')) return false;
      if (f.so === 'montada' && i.status !== 'montada') return false;
      if (f.so === 'fundacao' && i.status !== 'fundacao') return false;
      if (f.so === 'parcial' && i.status !== 'parcial') return false;
    }
    return true;
  }).sort(function (a, b) { return a.op - b.op; });
}
function pernasTxt(t) { var tp = tipoById(t.t); if (tp && tp.regra && tp.regra.modo === 'estaiada') return '<span class="muted">estaiada</span>'; return (t.p || []).map(function (p) { return C.fmt(p); }).join(' / '); }
V.torres = function () {
  var h = head('Torres do projeto', 'Lista de construção: o kit de cada torre depende do tipo, da extensão e da altura de cada perna.', S.torres.length ? '<button class="btn" id="expTw">Exportar CSV</button>' : '');
  if (!S.torres.length) return h + '<div class="card empty"><b>Lista de construção não carregada</b>Use <a href="#importar">Importar projeto</a> para carregar as torres da LC.</div>';
  var f = F.torres;
  var lista = filtrarTorres();
  h += '<div class="card"><div class="row">' +
    '<div class="field"><label>Canteiro</label><select id="twC">' + optList(cantsOrd(false), f.canteiro, function (x) { return x.nome; }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Tipo</label><select id="twT">' + optList(tiposOrd(), f.tipo, function (x) { return x.codigo; }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Situação</label><select id="twS">' + [['', 'Todas'], ['prontas', 'Prontas para montar (kit em estoque)'], ['semkit', 'Sem kit completo'], ['fundacao', 'Stub aplicado'], ['parcial', 'Montagem parcial'], ['montada', 'Montadas']].map(function (o) { return '<option value="' + o[0] + '"' + (f.so === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Tramo</label><select id="twTr"><option value="">Linha inteira (por canteiro)</option><option value="_todos"' + (f.tramo === '_todos' ? ' selected' : '') + '>Separar por tramos</option>' +
      '<optgroup label="Tramos (entre torres de ancoragem)">' + tramosAncoragem().map(function (tr) { return '<option value="' + tr.id + '"' + (f.tramo === tr.id ? ' selected' : '') + '>' + esc(tr.nome + ' · ' + tr.de + ' → ' + tr.ate + ' · ' + tr.n + ' torres') + '</option>'; }).join('') + '</optgroup>' +
      (tramosSalvos().length ? '<optgroup label="Tramos da aba Prioridade">' + tramosSalvos().map(function (tr, i) { return '<option value="' + esc(tr.id) + '"' + (f.tramo === tr.id ? ' selected' : '') + '>' + esc((tr.nome || 'Tramo ' + (i + 1)) + ' · ' + tr.de + ' → ' + tr.ate) + '</option>'; }).join('') + '</optgroup>' : '') +
      '<option value="_custom"' + (f.tramo === '_custom' ? ' selected' : '') + '>Trecho personalizado…</option></select></div>' +
    (f.tramo === '_custom' ? '<div class="field" style="flex:0 1 110px"><label>Da torre</label><input id="twDe" list="twLista" value="' + esc(f.trDe || '') + '" placeholder="211/2"></div><div class="field" style="flex:0 1 110px"><label>Até a torre</label><input id="twAte" list="twLista" value="' + esc(f.trAte || '') + '" placeholder="230/1"></div>' +
      '<datalist id="twLista">' + S.torres.slice().sort(function (a, b) { return a.op - b.op; }).map(function (t) { return '<option value="' + esc(t.n) + '">'; }).join('') + '</datalist>' : '') +
    '<div class="field"><label>Nº da torre</label><input id="twQ" value="' + esc(f.q || '') + '" placeholder="Ex.: 94/1"></div>' +
    '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label><div class="big" style="font-size:20px">' + nf(lista.length) + ' <span class="small muted">torres</span></div></div>' +
    '<div class="field" style="flex:0 0 auto"><label>Visualização</label><div class="seg"><button class="btn sm' + (f.modo === 'mapa' ? ' pri' : '') + '" data-modo="mapa">Mapa</button><button class="btn sm' + (f.modo === 'lista' ? ' pri' : '') + '" data-modo="lista">Lista</button></div></div></div></div>';
  var fx = faixaTramoFiltro();
  if (f.tramo && !fx) h += '<div class="banner warn">' + (f.tramo === '_custom' ? 'Informe a torre inicial e a final que existam na LC.' : 'Esse tramo não existe mais na aba Prioridade.') + '</div>';
  if (f.modo === 'mapa') return h + (f.tramo && (fx || f.tramo === '_todos') ? mapaPorTramos(lista, fx) : mapaTorres(lista));
  h += '<div class="card"><div class="tw"><table><thead><tr><th>Torre</th><th class="n">Op.</th><th>Tipo</th><th class="n">Altura</th><th class="n">Ext.</th><th>Pernas A/B/C/D</th><th>Tramo</th><th>Canteiro</th><th>Situação</th><th>Kit</th><th></th></tr></thead><tbody>' +
    lista.slice(0, f.lim).map(function (t) {
      var i = infoTorre(t);
      return '<tr><td><b class="mono">' + esc(t.n) + '</b></td><td class="n muted">' + esc(t.op) + '</td><td>' + esc(t.t) + '</td><td class="n">' + (t.h != null ? C.fmt(t.h) : '') + '</td><td class="n">' + C.fmt(t.e || 0) + '</td><td class="small mono">' + pernasTxt(t) + '</td><td class="small">' + esc((tramoDaTorre(t.n) || {}).nome || '') + '</td>' +
        '<td>' + esc(cantNome(t.c)) + '</td><td>' + tagStatus(i.status) + '</td><td>' + tagKit(i) + '</td>' +
        '<td style="white-space:nowrap"><button class="btn sm" data-kit="' + esc(t.n) + '">Ver kit</button>' + (podeGravar() && i.status !== 'montada' ? ' <button class="btn sm pri" data-apl="' + esc(t.n) + '">Aplicar</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' + (lista.length > f.lim ? '<div style="text-align:center;margin-top:12px"><button class="btn" id="twMais">Mostrar mais</button></div>' : '') + '</div>';
  return h;
};
V.torres_bind = function () {
  var f = F.torres;
  [['#twC', 'canteiro'], ['#twT', 'tipo'], ['#twS', 'so']].forEach(function (p) { var e = $(p[0]); if (e) e.onchange = function () { f[p[1]] = e.value; f.lim = 150; render(); }; });
  var q = $('#twQ'), tm; if (q) q.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { f.q = q.value; render(); }, 250); };
  var m = $('#twMais'); if (m) m.onclick = function () { f.lim += 300; render(); };
  var trs = $('#twTr'); if (trs) trs.onchange = function () { f.tramo = trs.value; f.lim = 150; render(); };
  [['#twDe', 'trDe'], ['#twAte', 'trAte']].forEach(function (p) { var e = $(p[0]), tm2; if (e) e.oninput = function () { clearTimeout(tm2); tm2 = setTimeout(function () { f[p[1]] = e.value; if (torreByN(e.value.trim())) render(); }, 300); }; });
  var ex = $('#expTw'); if (ex) ex.onclick = exportarTorres;
  $$('[data-kit]').forEach(function (b) { b.onclick = function () { modalKit(b.getAttribute('data-kit')); }; });
  $$('[data-modo]').forEach(function (b) { b.onclick = function () { f.modo = b.getAttribute('data-modo'); render(); }; });
  $$('.mt-tile').forEach(function (b) { b.onclick = function () { modalKit(b.getAttribute('data-n')); }; b.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); modalKit(b.getAttribute('data-n')); } }; });
  $$('[data-apl]').forEach(function (b) { b.onclick = function () { formAplicacao(b.getAttribute('data-apl')); }; });
};

// ===== MAPA VISUAL DAS TORRES =====
// Miniatura por torre (silhueta autoportante ou estaiada, altura proporcional) colorida pela situação.
// Codificação dupla (cor + traço): pronta = traço cheio verde; incompleta = traço tracejado vermelho; montada = cinza escuro.
var MT_COR = { pronta: '#2f8a57', incompleta: '#c0392b', montada: '#3d4743' };
// Codificação dupla: além da cor, a torre incompleta tem moldura tracejada e o nº de volumes que faltam.
var MT_ROT = { pronta: 'Pronta para montar', incompleta: 'Incompleta (sem kit)', montada: 'Montada' };
function classeMapa(i) { return i.status === 'montada' ? 'montada' : i.kitDisponivel ? 'pronta' : 'incompleta'; }
var FIG_ASPECTO = {"estaiada": 0.365, "ancoragem": 0.305, "transposicao": 0.445, "suspensao": 0.29};
var FIG_NOME = { estaiada: 'Estaiada – suspensão', ancoragem: 'Autoportante – ancoragem', transposicao: 'Autoportante – suspensão / transposição', suspensao: 'Autoportante – suspensão' };
/** Desenho usado para o tipo: estaiada, ancoragem, transposição ou suspensão (pode ser fixado no tipo com o campo "figura"). */
function figuraTipo(tp) {
  if (!tp) return 'suspensao';
  if (tp.figura && FIG_ASPECTO[tp.figura]) return tp.figura;
  var est = (tp.regra && tp.regra.modo === 'estaiada') || /estaiada/i.test(tp.estrutura || '');
  if (est) return 'estaiada';
  if (/transpos/i.test((tp.fixacao || '') + ' ' + (tp.nome || '')) || /TR$/i.test(tp.codigo || '')) return 'transposicao';
  if (/ancoragem|terminal/i.test(tp.fixacao || '')) return 'ancoragem';
  return 'suspensao';
}
function svgTorre(t, cls, fig, escala) {
  var f = fig || figuraTipo(tipoById(t.t));
  var hh = Math.max(46, Math.min(84, 46 + (Number(t.h || 30) - 22) * 1.05)) * (escala || 1);
  return '<span class="mt-img fig-' + f + '" aria-hidden="true" style="width:' + Math.round(hh * FIG_ASPECTO[f]) + 'px;height:' + Math.round(hh) + 'px;color:' + MT_COR[cls] + '' + '"></span>';
}
function mapaTorres(lista) {
  if (!lista.length) return '<div class="card empty">Nenhuma torre para o filtro.</div>';
  var porC = {}, tot = { pronta: 0, incompleta: 0, montada: 0, stub: 0 };
  lista.forEach(function (t) { (porC[t.c] = porC[t.c] || []).push(t); });
  var h = '<div class="card"><div class="mt-leg">' + ['pronta', 'incompleta', 'montada'].map(function (k) {
      return '<span class="mt-legi mt-leg-' + k + '" title="' + MT_ROT[k] + '"><span class="mt-sw" style="background:' + MT_COR[k] + '"></span><span>' + MT_ROT[k] + ' <b class="mono" id="mtc-' + k + '"></b></span></span>';
    }).join('') + '<span class="mt-legi"><span class="mt-dot"></span><span>Stub já aplicado na fundação <b class="mono" id="mtc-stub"></b></span></span>' +
    '<span class="small muted" style="margin-left:auto">Altura da miniatura proporcional à altura da torre · clique para ver o kit</span></div>' +
    '<div class="mt-figs">' + Object.keys(FIG_NOME).map(function (k) {
      var tps = S.tipos.filter(function (t) { return figuraTipo(t) === k; }).map(function (t) { return t.codigo; });
      if (!tps.length) return '';
      return '<span class="mt-figi">' + svgTorre({ t: '', h: 40 }, 'montada', k) + '<span><b>' + FIG_NOME[k] + '</b><br><span class="muted">' + esc(tps.join(', ')) + '</span></span></span>';
    }).join('') + '</div></div>';
  Object.keys(porC).sort(function (a, b) { return byNome(cantById(a) || {}, cantById(b) || {}); }).forEach(function (cid) {
    var ts = porC[cid].slice().sort(function (a, b) { return a.op - b.op; }), cnt = { pronta: 0, incompleta: 0, montada: 0 };
    var tiles = ts.map(function (t) {
      var i = infoTorre(t), cls = classeMapa(i), falta = i.falta.reduce(function (a, x) { return a + x.qtd; }, 0);
      var stub = i.status === 'fundacao' || i.status === 'parcial';
      cnt[cls]++; tot[cls]++; if (stub) tot.stub++;
      var dica = 'Torre ' + t.n + ' · ' + t.t + ' · ' + C.fmt(t.h) + ' m · ' + MT_ROT[cls] + (stub ? ' · stub aplicado' : '') +
        (cls === 'incompleta' ? '\nFaltam ' + falta + ' volume(s): ' + i.falta.slice(0, 6).map(function (x) { return compNome(t.t, x.componenteId) + ' (' + x.qtd + ')'; }).join(', ') + (i.falta.length > 6 ? '…' : '') : '');
      return '<div class="mt-tile mt-' + cls + '" role="button" tabindex="0" data-n="' + esc(t.n) + '" title="' + esc(dica) + '" aria-label="' + esc(dica) + '">' +
        '<div class="mt-fig">' + svgTorre(t, cls) + (stub ? '<span class="mt-dot" style="position:absolute;bottom:1px;left:50%;margin-left:-4px"></span>' : '') + '</div>' +
        '<div class="mt-num">' + esc(t.n) + '</div><div class="mt-sub">' + (cls === 'pronta' ? '✓ kit' : cls === 'montada' ? 'montada' : '−' + falta) + '</div></div>';
    }).join('');
    h += '<div class="card"><h2>' + esc(cantNome(cid)) + ' <span class="sub">' + nf(ts.length) + ' torres na ordem da LC · ' +
      '<span style="color:' + MT_COR.pronta + '">' + cnt.pronta + ' prontas</span> · <span style="color:' + MT_COR.incompleta + '">' + cnt.incompleta + ' incompletas</span> · ' + cnt.montada + ' montadas</span></h2>' +
      '<div class="mt-bar"><i style="width:' + (100 * cnt.montada / ts.length).toFixed(2) + '%;background:' + MT_COR.montada + '"></i><i style="width:' + (100 * cnt.pronta / ts.length).toFixed(2) + '%;background:' + MT_COR.pronta + '"></i><i style="width:' + (100 * cnt.incompleta / ts.length).toFixed(2) + '%;background:#e9b8b2"></i></div>' +
      '<div class="mt-grid">' + tiles + '</div></div>';
  });
  return h.replace('id="mtc-pronta"></b>', 'id="mtc-pronta">' + tot.pronta + '</b>').replace('id="mtc-incompleta"></b>', 'id="mtc-incompleta">' + tot.incompleta + '</b>')
    .replace('id="mtc-montada"></b>', 'id="mtc-montada">' + tot.montada + '</b>').replace('id="mtc-stub"></b>', 'id="mtc-stub">' + tot.stub + '</b>');
}
function tileNeutro(t) {
  var tp = tipoById(t.t), dica = 'Torre ' + t.n + ' · ' + t.t + (tp && tp.nome ? ' (' + tp.nome + ')' : '') + ' · ' + C.fmt(t.h) + ' m · ' + cantNome(t.c);
  return '<div class="mt-tile mt-neutro" role="button" tabindex="0" data-n="' + esc(t.n) + '" title="' + esc(dica) + '"><div class="mt-fig">' +
    svgTorre(t, 'montada') + '</div><div class="mt-num">' + esc(t.n) + '</div><div class="mt-sub" style="color:var(--ink3);font-weight:500">' + esc(t.t) + '</div></div>';
}
/** Visualização por tramo, sem situação de montagem: só as torres de cada tramo, com o desenho do tipo. */
function mapaPorTramos(lista, fx) {
  if (!lista.length) return '<div class="card empty">Nenhuma torre para o filtro.</div>';
  var dentro = {}; lista.forEach(function (t) { dentro[t.n] = 1; });
  var grupos;
  if (fx) grupos = [{ nome: F.torres.tramo === '_custom' ? 'Trecho ' + fx.de + ' → ' + fx.ate : ((F.torres.tramo.charAt(0) === 'A' ? tramosAncoragem() : tramosSalvos()).find(function (x) { return x.id === F.torres.tramo; }) || {}).nome || 'Tramo', torres: lista.slice().sort(function (a, b) { return a.op - b.op; }) }];
  else grupos = tramosAncoragem().map(function (tr) { return { nome: tr.nome, torres: tr.torres.filter(function (t) { return dentro[t.n]; }) }; }).filter(function (g) { return g.torres.length; });
  var h = '<div class="card"><div class="small muted">' + (fx ? '' : nf(grupos.length) + ' tramos · ') + 'Cada tramo vai de uma torre de ancoragem até a próxima; a torre de ancoragem aparece nos dois tramos que ela separa. Clique numa torre para ver o kit.</div></div>';
  h += '<div class="tr-wrap">';
  grupos.forEach(function (g) {
    var cants = {}, tipos = {}; g.torres.forEach(function (t) { cants[cantNome(t.c)] = 1; tipos[t.t] = (tipos[t.t] || 0) + 1; });
    h += '<div class="tr-box"><div class="tr-h"><b>' + esc(g.nome) + '</b> <span class="mono">' + esc(g.torres[0].n) + ' → ' + esc(g.torres[g.torres.length - 1].n) + '</span></div>' +
      '<div class="tr-s">' + g.torres.length + ' torres · ' + esc(Object.keys(cants).join(', ')) + ' · ' + Object.keys(tipos).map(function (k) { return esc(k) + ' ×' + tipos[k]; }).join(', ') + '</div>' +
      '<div class="mt-grid">' + g.torres.map(tileNeutro).join('') + '</div></div>';
  });
  return h + '</div>';
}
function modalKit(n) {
  var t = torreByN(n), tp = t && tipoById(t.t); if (!tp) return;
  var kit = C.kitDaTorre(tp, t), ap = aplicado()[n] || {}, i = infoTorre(t), grupos = C.gruposDaTorre(tp, t);
  var linhas = '';
  grupos.forEach(function (g) {
    var vs = C.porGrupo(tp)[g.grupo] || [];
    if (!vs.length) return;
    linhas += '<tr><td colspan="5" style="background:#f4f5f2;font-weight:600;font-size:12.5px">' + esc(nomeGrupo(g.grupo)) + (g.qtd > 1 ? ' × ' + g.qtd : '') + '</td></tr>';
    vs.forEach(function (v) {
      var need = kit.itens[v.id] || 0, a = ap[v.id] || 0, falta = Math.max(0, need - a), d = C.disponivel(S.d.saldos, S.d.reservas, t.c, tp.id, v.id);
      var faltaAloc = (i.falta || []).some(function (f) { return f.componenteId === v.id; });
      linhas += '<tr' + (faltaAloc ? ' style="background:#fbeaea"' : '') + '><td>' + (faltaAloc ? '<b>' + esc(v.nome) + '</b> <span class="tag bad">falta</span>' : esc(v.nome)) + '</td><td class="n">' + need + '</td><td class="n">' + cell(a) + '</td><td class="n">' + (falta ? '<b>' + falta + '</b>' : '<span class="zero">0</span>') + '</td><td class="n">' + (falta ? (d >= falta ? '<span class="tag ok">' + d + '</span>' : '<span class="tag bad">' + d + '</span>') : cell(d)) + '</td></tr>';
    });
  });
  var peso = C.pesoItens(tp, C.itensDeMapa(kit.itens));
  modal('Torre ' + n + ' · ' + tp.codigo, '<div class="row small"><div><b>Canteiro:</b> ' + esc(cantNome(t.c)) + '</div><div><b>Altura:</b> ' + C.fmt(t.h) + ' m</div><div><b>Extensão:</b> ' + C.fmt(t.e || 0) + ' m</div><div><b>Pernas:</b> ' + pernasTxt(t) + '</div><div><b>Peso do kit:</b> ' + nf(peso / 1000, 2) + ' t</div><div>' + tagStatus(i.status) + ' ' + tagKit(i) + '</div></div>' +
    '<div class="tw" style="max-height:60vh"><table><thead><tr><th>Volume</th><th class="n">Kit</th><th class="n">Aplicado</th><th class="n">Falta aplicar</th><th class="n">Disp. no canteiro</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
    (!i.kitDisponivel && i.status !== 'montada' ? '<div class="banner bad" style="margin:0"><b>O que falta para esta torre ter o kit completo:</b> ' + i.falta.map(function (f) { return esc(compNome(tp.id, f.componenteId)) + ' <b>×' + f.qtd + '</b>'; }).join(' · ') +
      '<div class="small" style="margin-top:4px">O estoque do canteiro é usado primeiro pelas torres anteriores na ordem da LC. Por isso pode faltar um volume que aparece com saldo na tabela abaixo (linhas destacadas). Veja em <a href="#remanejamento">Remanejamento</a> se outro canteiro tem sobra.</div></div>' : ''),
    { cancel: 'Fechar' });
}

// ===== TORRES COMPLETAS (resumo e gargalos) =====
V.completas = function () {
  var h = head('Torres completas', 'Quantas torres cada canteiro consegue montar com o próprio estoque e quais volumes mais travam as demais.');
  var sc = semCadastro(); if (sc) return h + sc;
  if (!S.torres.length) return h + '<div class="card empty"><b>Lista de construção não carregada</b><a href="#importar">Importe o projeto</a>.</div>';
  var f = F.completas;
  // um quadro por canteiro: cada tipo com miniatura, estrutura (estaiada/autoportante) e fixação
  var cants = cantsOrd(true).filter(function (c) { return !f.canteiro || c.id === f.canteiro; });
  h += '<div class="filters"><div class="field"><label>Canteiro</label><select id="cpC">' + optList(cantsOrd(true), f.canteiro || '', function (x) { return x.nome; }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Estrutura</label><select id="cpE"><option value="">Todas</option><option value="Autoportante"' + (f.estr === 'Autoportante' ? ' selected' : '') + '>Autoportante</option><option value="Estaiada"' + (f.estr === 'Estaiada' ? ' selected' : '') + '>Estaiada</option></select></div></div>';
  h += '<div class="cp-grid">' + cants.map(function (c) {
    var tot = { p: 0, m: 0, r: 0, s: 0 };
    var linhas = tiposOrd().filter(function (t) { return !f.estr || (t.estrutura || '') === f.estr; }).map(function (t) {
      var r = aloc(t.id).resumo[c.id] || {}; if (!r.projeto) return '';
      tot.p += r.projeto || 0; tot.m += r.montadas || 0; tot.r += r.prontas || 0; tot.s += r.incompletas || 0;
      var pend = (r.projeto || 0) - (r.montadas || 0), pct = pend ? Math.round(100 * (r.prontas || 0) / pend) : 100;
      return '<div class="cp-row"><div class="cp-fig">' + svgTorre({ t: t.id, h: 30 }, r.prontas ? 'pronta' : 'incompleta', null, 0.62) + '</div>' +
        '<div class="cp-tipo"><b>' + esc(t.codigo) + '</b><span><em class="tag ' + (/estai/i.test(t.estrutura || '') ? 'info' : 'acc') + '">' + esc(t.estrutura || '—') + '</em>' + (t.fixacao ? ' ' + esc(t.fixacao) : '') + '</span><div class="cp-bar" title="' + pct + '% das torres pendentes com kit completo"><div class="bar"><i style="width:' + pct + '%"></i></div><small>' + pct + '%</small></div></div>' +
        '<div class="cp-num"><span>Projeto</span><b>' + nf(r.projeto || 0) + '</b></div><div class="cp-num"><span>Montadas</span><b>' + cell(r.montadas || 0) + '</b></div>' +
        '<div class="cp-num ok"><span>Prontas</span><b>' + (r.prontas ? nf(r.prontas) : '<span class="zero">0</span>') + '</b></div><div class="cp-num"><span>Sem kit</span><b>' + cell(r.incompletas || 0) + '</b></div>' + '</div>';
    }).join('');
    return '<div class="card cp-card"><h2>' + esc(c.nome) + ' <span class="sub">' + nf(tot.p) + ' torres · ' + nf(tot.m) + ' montadas · <b style="color:var(--ok)">' + nf(tot.r) + ' prontas</b> · ' + nf(tot.s) + ' sem kit</span></h2>' + (linhas || '<div class="empty">Nenhuma torre para o filtro.</div>') + '</div>';
  }).join('') + '</div>';
  // gargalos
  var garg = {};
  tiposOrd().forEach(function (t) {
    if (f.tipo && t.id !== f.tipo) return;
    var a = aloc(t.id);
    torresDo(t.id).forEach(function (tw) {
      if (f.canteiro && tw.c !== f.canteiro) return;
      var i = a.torres[tw.n]; if (!i || i.kitDisponivel || i.status === 'montada') return;
      i.falta.forEach(function (x) { var k = t.id + '|' + x.componenteId; var g = garg[k] = garg[k] || { t: t.id, v: x.componenteId, torres: 0, qtd: 0 }; g.torres++; g.qtd += x.qtd; });
    });
  });
  var lista = Object.keys(garg).map(function (k) { return garg[k]; }).sort(function (a, b) { return b.torres - a.torres || b.qtd - a.qtd; });
  h += '<div class="card"><h2>Volumes que mais travam torres <span class="sub">entre as torres sem kit completo · base para cobrar o fornecedor ou remanejar</span></h2><div class="row" style="margin-bottom:12px">' +
    '<div class="field"><label>Tipo</label><select id="gT">' + optList(tiposOrd(), f.tipo, function (x) { return x.codigo; }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Canteiro</label><select id="gC">' + optList(cantsOrd(true), f.canteiro, function (x) { return x.nome; }, 'Todos') + '</select></div></div>' +
    (lista.length ? '<div class="tw" style="max-height:60vh"><table><thead><tr><th>Tipo</th><th>Volume</th><th class="n">Torres travadas</th><th class="n">Qtd. faltante (soma)</th></tr></thead><tbody>' +
      lista.slice(0, 60).map(function (g) { return '<tr><td>' + esc(tipoCod(g.t)) + '</td><td>' + esc(compNome(g.t, g.v)) + '</td><td class="n"><b>' + g.torres + '</b></td><td class="n">' + nf(g.qtd) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="empty">Nenhuma torre travada para o filtro.</div>') + '</div>';
  return h;
};
V.completas_bind = function () {
  var a = $('#gT'); if (a) a.onchange = function () { F.completas.tipo = a.value; render(); };
  var b = $('#gC'); if (b) b.onchange = function () { F.completas.canteiro = b.value; render(); };
  var c = $('#cpC'); if (c) c.onchange = function () { F.completas.canteiro = c.value; render(); };
  var e = $('#cpE'); if (e) e.onchange = function () { F.completas.estr = e.value; render(); };
};

// ===== REMANEJAMENTO =====
V.remanejamento = function () {
  var h = head('Remanejamento', 'Volumes parados num canteiro que completam torres em outro. Quem doa nunca perde uma torre que já está pronta.');
  var sc = semCadastro(); if (sc) return h + sc;
  if (!S.torres.length) return h + '<div class="card empty"><b>Lista de construção não carregada</b><a href="#importar">Importe o projeto</a>.</div>';
  var f = F.rem;
  if (f.tipo && f.tipo !== '*' && !tipoById(f.tipo)) f.tipo = '';
  if (!f.tipo) f.tipo = '*';
  h += '<div class="card"><div class="row"><div class="field"><label>Tipo de torre</label><select id="rTipo"><option value="*"' + (f.tipo === '*' ? ' selected' : '') + '>Todos os tipos</option>' + optList(tiposOrd(), f.tipo, function (x) { return tipoNome(x.id); }) + '</select></div>' +
    '<div class="field"><label>Completar torres em</label><select id="rDest">' + optList(cantsOrd(true), f.destino, function (x) { return x.nome; }, 'Qualquer canteiro (maximizar total)') + '</select></div></div>' +
    '<p class="small muted" style="margin:10px 0 0">Critério: completar primeiro as torres que precisam de menos volumes vindos de fora. Peças já reservadas em transferências solicitadas não entram na conta. O ganho mostrado é verificado: o sistema simula as transferências e recalcula.</p></div>';
  var tipos = f.tipo === '*' ? tiposOrd() : [tipoById(f.tipo)];
  var res = tipos.filter(Boolean).map(function (t) { return { tipo: t, sug: rem(t.id, f.destino), pot: potencial(t.id) }; });
  f.res = res;
  var antes = 0, depois = 0, pot = 0, nTr = 0;
  res.forEach(function (r) { antes += r.sug.antes; depois += r.sug.depois; pot += r.pot; nTr += r.sug.transferencias.length; });
  var hoje0 = 0; res.forEach(function (r) { cantsOrd(true).forEach(function (c) { var x = aloc(r.tipo.id).resumo[c.id]; if (x) hoje0 += x.prontas; }); });
  h += '<div class="kpis">' + kpi('Prontas para montar hoje', nf(hoje0), antes !== hoje0 ? nf(antes) + ' contando o que já está a caminho' : 'kit completo no próprio canteiro') + kpi('Após este remanejamento', nf(depois), depois > antes ? '<span class="tag ok">+' + (depois - antes) + ' torres</span>' : 'sem ganho adicional') +
    kpi('Potencial', nf(pot), 'se todo o estoque estivesse junto') + kpi('Transferências sugeridas', nf(nTr), '') + '</div>';
  if (!nTr) return h + '<div class="card empty"><b>Nenhum remanejamento completa novas torres</b>Com o estoque disponível hoje, mover volumes não gera torre pronta a mais' + (f.destino ? ' em ' + esc(cantNome(f.destino)) : '') + '. Veja os gargalos em <a href="#completas">Torres completas</a>.</div>';
  h += '<div class="card"><h2>Transferências sugeridas <span class="sub">ao gerar, os volumes ficam reservados na origem</span>' +
    (podeGravar() ? '<button class="btn pri sm" id="rGerarTodas" style="margin-left:auto">Gerar todas as solicitações</button>' : '') + '</h2>';
  res.forEach(function (r, ri) {
    if (!r.sug.transferencias.length) return;
    var pc = r.sug.porCanteiro || {};
    h += '<h3 style="font-size:13.5px;margin:16px 0 8px">' + esc(tipoNome(r.tipo.id)) + ' <span class="muted" style="font-weight:400">· ' + Object.keys(pc).filter(function (k) { return pc[k].depois !== pc[k].antes; }).map(function (k) { return esc(cantNome(k)) + ' ' + pc[k].antes + '→' + pc[k].depois + ' prontas'; }).join(', ') + '</span></h3>';
    r.sug.transferencias.forEach(function (t, ti) {
      var peso = C.pesoItens(r.tipo, t.itens), qt = t.itens.reduce(function (a, i) { return a + i.qtd; }, 0);
      h += '<div class="sugg"><div style="flex:1;min-width:260px"><div class="flow"><b>' + esc(cantNome(t.origemId)) + '</b><span class="arrow">→</span><b>' + esc(cantNome(t.destinoId)) + '</b><span class="tag">' + nf(qt) + ' vol.</span>' + (peso ? '<span class="tag">' + nf(peso / 1000, 2) + ' t</span>' : '') + '</div>' +
        (t.torres && t.torres.length ? '<div class="small" style="margin-top:6px">Completa as torres: <b class="mono">' + t.torres.map(esc).join(', ') + '</b></div>' : '') +
        '<div style="margin-top:6px">' + itensResumo(r.tipo.id, t.itens, 40) + '</div></div>' +
        (podeGravar() ? (t.gerada ? '<span class="tag ok">Solicitação ' + esc(t.gerada) + ' criada</span>' : '<button class="btn sm" data-gerar="' + ri + ':' + ti + '">Gerar solicitação</button>') : '') + '</div>';
    });
  });
  return h + '</div>';
};
V.remanejamento_bind = function () {
  var f = F.rem;
  var a = $('#rTipo'); if (a) a.onchange = function () { f.tipo = a.value; render(); };
  var b = $('#rDest'); if (b) b.onchange = function () { f.destino = b.value; render(); };
  var obsDe = function (t) { return 'Remanejamento automático' + (t.torres && t.torres.length ? ' · completa torres ' + t.torres.join(', ') : ''); };
  $$('[data-gerar]').forEach(function (btn) {
    btn.onclick = async function () {
      var p = btn.getAttribute('data-gerar').split(':'); var r = f.res[+p[0]]; var t = r.sug.transferencias[+p[1]];
      btn.disabled = true;
      try { var tr = await criarTransferencia({ origemId: t.origemId, destinoId: t.destinoId, tipoId: r.tipo.id, itens: t.itens, obs: obsDe(t), torres: t.torres }); toast('Solicitação ' + tr.numero + ' criada'); }
      catch (e) { btn.disabled = false; toast(errMsg(e), true); }
    };
  });
  var all = $('#rGerarTodas');
  if (all) all.onclick = async function () {
    all.disabled = true; var n = 0, erros = [], fila = [];
    f.res.forEach(function (r) { r.sug.transferencias.forEach(function (t) { fila.push({ r: r, t: t }); }); });
    for (var i = 0; i < fila.length; i++) {
      var t = fila[i].t;
      try { await criarTransferencia({ origemId: t.origemId, destinoId: t.destinoId, tipoId: fila[i].r.tipo.id, itens: t.itens, obs: obsDe(t), torres: t.torres }); n++; }
      catch (e) { erros.push(cantNome(t.origemId) + ' → ' + cantNome(t.destinoId) + ': ' + errMsg(e)); }
    }
    if (n) toast(n + ' solicitação(ões) criada(s). Acompanhe em Transferências.');
    if (erros.length) toast(erros.join(' | '), true);
    all.disabled = false;
  };
};
// ===== TRANSFERÊNCIAS =====
function numeroTransf() {
  var d = new Date(); var p = function (n) { return String(n).padStart(2, '0'); };
  return 'TR-' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}
async function criarTransferencia(o) {
  var t = tipoById(o.tipoId); var erros = [];
  if (!o.origemId || !o.destinoId) erros.push('Escolha origem e destino.');
  if (o.origemId === o.destinoId) erros.push('Origem e destino precisam ser diferentes.');
  if (!t) erros.push('Escolha o tipo de torre.');
  var itens = (o.itens || []).filter(function (i) { return Number(i.qtd) > 0; });
  if (!itens.length) erros.push('Informe ao menos um componente com quantidade.');
  if (erros.length) throw Falha(erros);
  var fr = await estadoFresco(o.origemId, o.tipoId);
  erros = C.validarSaida(t, fr.saldos, fr.reservas, o.origemId, itens);
  if (erros.length) throw Falha(erros.map(function (e) { return 'Origem sem saldo – ' + e; }));
  var id = newId('t'); var doc = {
    numero: numeroTransf(), origemId: o.origemId, destinoId: o.destinoId, tipoId: o.tipoId,
    itens: itens.map(function (i) { return { componenteId: i.componenteId, qtd: Number(i.qtd) }; }),
    status: 'SOLICITADA', obs: o.obs || '', torres: o.torres || [], criadoEm: new Date().toISOString(), criadoPor: S.uid || null
  };
  await Store.set('transferencias', id, doc);
  doc.id = id; return doc;
}
V.transferencias = function () {
  var h = head('Transferências', 'Remanejamento de peças entre canteiros: solicitação → despacho → recebimento.', podeGravar() ? '<button class="btn pri" id="novaTr">+ Nova transferência</button>' : '');
  var sc = semCadastro(); if (sc) return h + sc;
  var f = F.transf;
  var lista = S.transferencias.filter(function (t) {
    if (f.status === 'ABERTAS') return t.status === 'SOLICITADA' || t.status === 'EM_TRANSITO';
    return !f.status || t.status === f.status;
  }).sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
  var cnt = function (s) { return S.transferencias.filter(function (t) { return t.status === s; }).length; };
  h += '<div class="card"><div class="toolbar">' + [['ABERTAS', 'Abertas', cnt('SOLICITADA') + cnt('EM_TRANSITO')], ['SOLICITADA', 'Solicitadas', cnt('SOLICITADA')], ['EM_TRANSITO', 'Em trânsito', cnt('EM_TRANSITO')], ['RECEBIDA', 'Recebidas', cnt('RECEBIDA')], ['CANCELADA', 'Canceladas', cnt('CANCELADA')], ['', 'Todas', S.transferencias.length]]
    .map(function (x) { return '<button class="btn sm' + (f.status === x[0] ? ' pri' : '') + '" data-st="' + x[0] + '">' + x[1] + ' <span class="mono">' + x[2] + '</span></button>'; }).join('') + '</div></div>';
  if (!lista.length) return h + '<div class="card empty"><b>Nenhuma transferência aqui</b>Crie uma manualmente ou gere a partir do <a href="#remanejamento">remanejamento</a>.</div>';
  h += '<div class="card"><div class="tw"><table><thead><tr><th>Nº</th><th>Status</th><th>Origem → Destino</th><th>Tipo</th><th>Itens</th><th>Datas</th><th></th></tr></thead><tbody>' +
    lista.map(function (t) {
      var stc = { SOLICITADA: 'warn', EM_TRANSITO: 'info', RECEBIDA: 'ok', CANCELADA: '' }[t.status];
      var acoes = '';
      if (podeGravar()) {
        if (t.status === 'SOLICITADA') acoes = '<button class="btn sm pri" data-desp="' + t.id + '">Despachar</button> <button class="btn sm danger" data-canc="' + t.id + '">Cancelar</button>';
        if (t.status === 'EM_TRANSITO') acoes = '<button class="btn sm pri" data-rec="' + t.id + '">Receber</button>';
        if (t.status === 'RECEBIDA' && t.divergencia && !t.divergenciaTratada) acoes = '<button class="btn sm" data-trat="' + t.id + '">Marcar divergência tratada</button>';
      }
      var datas = 'Solicitada ' + fdh(t.criadoEm) + (t.despachadoEm ? '<br>Despachada ' + fdh(t.despachadoEm) : '') + (t.recebidoEm ? '<br>Recebida ' + fdh(t.recebidoEm) : '') + (t.canceladoEm ? '<br>Cancelada ' + fdh(t.canceladoEm) : '');
      var info = [];
      if (t.romaneio) info.push('Romaneio ' + esc(t.romaneio)); if (t.veiculo) info.push(esc(t.veiculo)); if (t.obs) info.push(esc(t.obs));
      return '<tr><td class="mono small"><b>' + esc(t.numero) + '</b></td><td><span class="tag ' + stc + '">' + C.STATUS_TRANSF[t.status] + '</span>' + (t.divergencia ? '<br><span class="tag ' + (t.divergenciaTratada ? '' : 'bad') + '" style="margin-top:4px">divergência' + (t.divergenciaTratada ? ' tratada' : '') + '</span>' : '') + '</td>' +
        '<td><div class="flow">' + esc(cantNome(t.origemId)) + '<span class="arrow">→</span>' + esc(cantNome(t.destinoId)) + '</div>' + (info.length ? '<div class="small muted">' + info.join(' · ') + '</div>' : '') + '</td>' +
        '<td>' + esc(tipoCod(t.tipoId)) + '</td><td>' + itensResumo(t.tipoId, t.itens, 6) + (t.divergencia ? '<div class="small" style="color:var(--bad)">Recebido a menos: ' + t.divergencia.map(function (d) { return esc(compNome(t.tipoId, d.componenteId)) + ' ' + d.qtd; }).join(', ') + '</div>' : '') + '</td>' +
        '<td class="small muted">' + datas + '</td><td style="white-space:nowrap">' + acoes + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
  return h;
};
V.transferencias_bind = function () {
  $$('[data-st]').forEach(function (b) { b.onclick = function () { F.transf.status = b.getAttribute('data-st'); render(); }; });
  var n = $('#novaTr'); if (n) n.onclick = function () { formTransferencia(); };
  $$('[data-desp]').forEach(function (b) { b.onclick = function () { formDespacho(b.getAttribute('data-desp')); }; });
  $$('[data-rec]').forEach(function (b) { b.onclick = function () { formRecebimento(b.getAttribute('data-rec')); }; });
  $$('[data-canc]').forEach(function (b) {
    b.onclick = function () {
      var id = b.getAttribute('data-canc'); var t = S.transferencias.find(function (x) { return x.id === id; });
      confirmar('Cancelar transferência', 'Cancelar <b>' + esc(t.numero) + '</b>? As peças reservadas voltam a ficar disponíveis na origem.', 'Cancelar transferência', async function () {
        var atual = await Store.get('transferencias', id);
        if (!atual || !C.podeTransitar(atual.status, 'CANCELADA')) throw Falha(['Esta transferência já mudou de status (' + (atual ? C.STATUS_TRANSF[atual.status] : 'removida') + ').']);
        await Store.update('transferencias', id, { status: 'CANCELADA', canceladoEm: new Date().toISOString(), canceladoPor: S.uid || null });
        toast('Transferência cancelada');
      });
    };
  });
  $$('[data-trat]').forEach(function (b) {
    b.onclick = async function () { try { await Store.update('transferencias', b.getAttribute('data-trat'), { divergenciaTratada: true }); toast('Divergência marcada como tratada'); } catch (e) { toast(errMsg(e), true); } };
  });
};
function gradeItens(tipo, canteiroId, valores, opts) {
  opts = opts || {};
  if (!tipo) return '<div class="muted small">Escolha o tipo de torre.</div>';
  if (!(tipo.volumes || []).length) return '<div class="muted small">Este tipo não tem volumes cadastrados.</div>';
  var cols = 3 + (canteiroId ? 1 : 0);
  var html = '<div class="row" style="margin-bottom:8px"><div class="field"><label>Filtrar volumes</label><input class="gfiltro" placeholder="Ex.: STUB, EXTENSAO 6, PE 4,5"></div>' +
    (canteiroId ? '<div class="field" style="flex:0 0 auto"><label><input type="checkbox" class="gsaldo"> Só com saldo</label></div>' : '') + '</div>' +
    '<div class="tw" style="max-height:48vh"><table><thead><tr><th>Volume</th><th class="n">Peso (kg)</th>' + (canteiroId ? '<th class="n">' + esc(opts.rotuloSaldo || 'Disponível') + '</th>' : '') + '<th class="n">' + esc(opts.rotuloQtd || 'Quantidade') + '</th></tr></thead><tbody>';
  gruposOrdenados(tipo).forEach(function (g) {
    html += '<tr class="ggrp"><td colspan="' + cols + '" style="background:#f4f5f2;font-weight:600;font-size:12.5px">' + esc(nomeGrupo(g.grupo)) + '</td></tr>';
    g.volumes.forEach(function (v) {
      var disp = canteiroId ? (opts.fisico ? C.get(S.d.saldos, canteiroId, tipo.id, v.id) : C.disponivel(S.d.saldos, S.d.reservas, canteiroId, tipo.id, v.id)) : null;
      var val = valores && valores[v.id] != null ? valores[v.id] : '';
      html += '<tr class="gl" data-nome="' + esc((v.nome + ' ' + g.grupo).toUpperCase()) + '" data-saldo="' + (disp || 0) + '"><td>' + esc(v.nome) + '</td><td class="n muted">' + nf(v.pesoKg, 1) + '</td>' + (canteiroId ? '<td class="n">' + cell(disp) + '</td>' : '') +
        '<td class="n"><input class="num" type="number" min="0" step="1" data-q="' + esc(v.id) + '" value="' + esc(val) + '"></td></tr>';
    });
  });
  return html + '</tbody></table></div>';
}
function ligarFiltroGrade(root) {
  var fi = $('.gfiltro', root), fs = $('.gsaldo', root);
  var ap = function () {
    var q = (fi && fi.value || '').toUpperCase(), so = fs && fs.checked;
    $$('tr.gl', root).forEach(function (tr) {
      var temValor = $('input', tr).value !== '';
      var ok = (!q || tr.getAttribute('data-nome').indexOf(q) >= 0) && (!so || Number(tr.getAttribute('data-saldo')) > 0 || temValor);
      tr.style.display = ok ? '' : 'none';
    });
    $$('tr.ggrp', root).forEach(function (g) {
      var n = g.nextElementSibling, vis = false;
      while (n && n.classList.contains('gl')) { if (n.style.display !== 'none') vis = true; n = n.nextElementSibling; }
      g.style.display = vis ? '' : 'none';
    });
  };
  if (fi) fi.oninput = ap; if (fs) fs.onchange = ap;
  ap();
}
function desenharGrade(box, tipo, cant, opts) {
  var vals = valoresGrade(box), fi = $('.gfiltro', box), fs = $('.gsaldo', box), q = fi ? fi.value : '', sv = fs && fs.checked;
  box.innerHTML = gradeItens(tipo, cant, vals, opts);
  if (q && $('.gfiltro', box)) $('.gfiltro', box).value = q;
  if (sv && $('.gsaldo', box)) $('.gsaldo', box).checked = true;
  ligarFiltroGrade(box);
}
function lerGrade(root) {
  var itens = [], erros = [];
  $$('[data-q]', root).forEach(function (inp) {
    if (inp.value === '') return;
    var v = Number(inp.value);
    if (!isFinite(v) || v < 0 || Math.floor(v) !== v) { erros.push('Quantidade inválida: ' + inp.value); return; }
    if (v > 0) itens.push({ componenteId: inp.getAttribute('data-q'), qtd: v });
  });
  if (erros.length) throw Falha(erros);
  return itens;
}

function valoresGrade(root) { var o = {}; $$('[data-q]', root).forEach(function (i) { if (i.value !== '') o[i.getAttribute('data-q')] = i.value; }); return o; }
var modalVivo = null; // re-render de saldos dentro de modais quando os dados mudam
function atualizarModalVivo() { if (modalVivo) try { modalVivo(); } catch (e) {} }

function formTransferencia(pre) {
  pre = pre || {};
  var body = '<div class="row"><div class="field"><label>Origem</label><select id="tO">' + optList(cantsOrd(true), pre.origemId, function (x) { return x.nome; }, 'Selecione…') + '</select></div>' +
    '<div class="field"><label>Destino</label><select id="tD">' + optList(cantsOrd(true), pre.destinoId, function (x) { return x.nome; }, 'Selecione…') + '</select></div>' +
    '<div class="field"><label>Tipo de torre</label><select id="tT">' + optList(tiposOrd(), pre.tipoId, function (x) { return tipoNome(x.id); }, 'Selecione…') + '</select></div></div>' +
    '<div id="tGrade"></div><div class="field"><label>Observação</label><input id="tObs" placeholder="Motivo, torre a completar, etc."></div>';
  modal('Nova transferência', body, {
    ok: 'Solicitar transferência',
    onOpen: function (m) {
      var draw = function () { desenharGrade($('#tGrade', m), tipoById($('#tT', m).value), $('#tO', m).value, { rotuloSaldo: 'Disponível na origem', rotuloQtd: 'Transferir' }); };
      ['#tO', '#tT'].forEach(function (s) { $(s, m).onchange = draw; }); draw(); modalVivo = draw;
    },
    onOk: async function (m) {
      var tr = await criarTransferencia({ origemId: $('#tO', m).value, destinoId: $('#tD', m).value, tipoId: $('#tT', m).value, itens: lerGrade(m), obs: $('#tObs', m).value.trim() });
      modalVivo = null; toast('Transferência ' + tr.numero + ' solicitada');
    }
  });
}
function formDespacho(id) {
  var t = S.transferencias.find(function (x) { return x.id === id; }); if (!t) return;
  modal('Despachar ' + t.numero, '<div class="flow"><b>' + esc(cantNome(t.origemId)) + '</b><span class="arrow">→</span><b>' + esc(cantNome(t.destinoId)) + '</b> · ' + esc(tipoNome(t.tipoId)) + '</div>' + itensResumo(t.tipoId, t.itens, 30) +
    '<div class="row"><div class="field"><label>Data do despacho</label><input type="date" id="dData" value="' + hoje() + '"></div><div class="field"><label>Romaneio / NF</label><input id="dRom"></div><div class="field"><label>Veículo / transportadora</label><input id="dVei"></div></div>' +
    '<p class="small muted" style="margin:0">Ao despachar, as peças saem do saldo de ' + esc(cantNome(t.origemId)) + ' e aparecem como "em trânsito" para ' + esc(cantNome(t.destinoId)) + '.</p>', {
    ok: 'Confirmar despacho',
    onOk: async function (m) {
      var tipo = tipoById(t.tipoId);
      var fr = await estadoFresco(t.origemId, t.tipoId);
      var atual = await Store.get('transferencias', id);
      if (!atual || atual.status !== 'SOLICITADA') throw Falha(['Esta transferência já mudou de status (' + (atual ? C.STATUS_TRANSF[atual.status] : 'removida') + ').']);
      var erros = C.validarSaida(tipo, fr.saldos, fr.reservas, t.origemId, atual.itens, atual);
      if (erros.length) throw Falha(erros);
      var data = $('#dData', m).value || hoje();
      // id determinístico: repetir a operação não duplica a saída
      await Store.set('movimentos', 'ts_' + id, {
        natureza: 'TRANSF_SAIDA', canteiroId: t.origemId, tipoId: t.tipoId, data: data, criadoEm: new Date().toISOString(), usuarioId: S.uid || null,
        itens: atual.itens.map(function (i) { return { componenteId: i.componenteId, qtd: -Number(i.qtd) }; }),
        transferenciaId: id, documento: t.numero + ($('#dRom', m).value ? ' · ' + $('#dRom', m).value.trim() : ''), obs: 'Para ' + cantNome(t.destinoId)
      });
      await Store.update('transferencias', id, { status: 'EM_TRANSITO', despachadoEm: new Date().toISOString(), dataDespacho: data, despachadoPor: S.uid || null, romaneio: $('#dRom', m).value.trim(), veiculo: $('#dVei', m).value.trim() });
      toast('Despachada: ' + t.numero);
    }
  });
}
function formRecebimento(id) {
  var t = S.transferencias.find(function (x) { return x.id === id; }); if (!t) return;
  var tipo = tipoById(t.tipoId);
  var rows = t.itens.map(function (i) {
    return '<tr><td>' + esc(compNome(t.tipoId, i.componenteId)) + '</td><td class="n">' + nf(i.qtd) + '</td><td class="n"><input class="num" type="number" min="0" max="' + i.qtd + '" step="1" data-r="' + esc(i.componenteId) + '" value="' + i.qtd + '"></td></tr>';
  }).join('');
  modal('Receber ' + t.numero, '<div class="flow"><b>' + esc(cantNome(t.origemId)) + '</b><span class="arrow">→</span><b>' + esc(cantNome(t.destinoId)) + '</b> · ' + esc(tipoNome(t.tipoId)) + '</div>' +
    '<div class="tw"><table><thead><tr><th>Componente</th><th class="n">Enviado</th><th class="n">Recebido</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="row"><div class="field"><label>Data do recebimento</label><input type="date" id="rData" value="' + hoje() + '"></div><div class="field"><label>Observação (obrigatória se houver divergência)</label><input id="rObs"></div></div>', {
    ok: 'Confirmar recebimento',
    onOk: async function (m) {
      var recebidos = [], div = [], erros = [];
      $$('[data-r]', m).forEach(function (inp) {
        var cid = inp.getAttribute('data-r'); var env = t.itens.find(function (i) { return i.componenteId === cid; }).qtd;
        var v = Number(inp.value);
        if (inp.value === '' || !isFinite(v) || v < 0 || Math.floor(v) !== v) { erros.push(compNome(t.tipoId, cid) + ': quantidade inválida'); return; }
        if (v > env) { erros.push(compNome(t.tipoId, cid) + ': recebido maior que o enviado (' + env + '). Lance a diferença como entrada separada.'); return; }
        if (v > 0) recebidos.push({ componenteId: cid, qtd: v });
        if (v < env) div.push({ componenteId: cid, qtd: env - v });
      });
      var obs = $('#rObs', m).value.trim();
      if (div.length && !obs) erros.push('Explique a divergência na observação.');
      if (erros.length) throw Falha(erros);
      await Store.trava(t.destinoId + '__' + t.tipoId);
      var atual = await Store.get('transferencias', id);
      if (!atual || atual.status !== 'EM_TRANSITO') throw Falha(['Esta transferência já mudou de status (' + (atual ? C.STATUS_TRANSF[atual.status] : 'removida') + ').']);
      var data = $('#rData', m).value || hoje();
      if (recebidos.length) await Store.set('movimentos', 'te_' + id, {
        natureza: 'TRANSF_ENTRADA', canteiroId: t.destinoId, tipoId: t.tipoId, data: data, criadoEm: new Date().toISOString(), usuarioId: S.uid || null,
        itens: recebidos, transferenciaId: id, documento: t.numero, obs: 'De ' + cantNome(t.origemId) + (obs ? ' · ' + obs : '')
      });
      var upd = { status: 'RECEBIDA', recebidoEm: new Date().toISOString(), dataRecebimento: data, recebidoPor: S.uid || null, itensRecebidos: recebidos, obsRecebimento: obs };
      if (div.length) upd.divergencia = div;
      await Store.update('transferencias', id, upd);
      toast(div.length ? 'Recebida com divergência: ' + t.numero : 'Recebida: ' + t.numero);
    }
  });
}

// ===== LANÇAMENTOS (entradas/saídas) =====
V.lancamentos = function () {
  var h = head('Recebimentos e saídas', 'Recebimento de volumes do fabricante (por NF / romaneio) e baixas (perda, avaria, devolução).');
  var sc = semCadastro(); if (sc) return h + sc;
  if (!podeGravar()) return h + '<div class="card empty">Somente leitura.</div>';
  h += '<div class="grid2"><div class="card"><h2>Recebimento (entrada)</h2><p class="muted small" style="margin-top:0">Volumes que chegaram ao canteiro vindos do fabricante ou de fora do sistema.</p><button class="btn pri" data-lanc="ENTRADA">+ Lançar entrada</button></div>' +
    '<div class="card"><h2>Saída / baixa</h2><p class="muted small" style="margin-top:0">Perda, avaria, sucata, devolução ao fabricante. Para aplicar em torre, use <a href="#aplicacoes">Aplicação em torre</a>; para outro canteiro, <a href="#transferencias">Transferências</a>.</p><button class="btn" data-lanc="SAIDA">− Lançar saída</button></div></div>';
  var ult = S.movimentos.filter(function (m) { return m.natureza === 'ENTRADA' || m.natureza === 'SAIDA'; }).sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); }).slice(0, 30);
  h += '<div class="card"><h2>Últimos lançamentos</h2>' + tabelaMovs(ult) + '</div>';
  return h;
};
V.lancamentos_bind = function () { $$('[data-lanc]').forEach(function (b) { b.onclick = function () { formLancamento(b.getAttribute('data-lanc')); }; }); bindEstorno(); };
function formLancamento(nat) {
  var entrada = nat === 'ENTRADA';
  var body = '<div class="row"><div class="field"><label>Canteiro</label><select id="lC">' + optList(cantsOrd(true), '', function (x) { return x.nome; }, 'Selecione…') + '</select></div>' +
    '<div class="field"><label>Tipo de torre</label><select id="lT">' + optList(tiposOrd(), '', function (x) { return tipoNome(x.id); }, 'Selecione…') + '</select></div>' +
    '<div class="field"><label>Data</label><input type="date" id="lD" value="' + hoje() + '"></div></div>' +
    (entrada ? '<div class="row"><div class="field" style="flex:0 1 160px"><label>Fornecedor</label><input id="lF" list="lFs" placeholder="Nome do fornecedor"><datalist id="lFs">' + listaFornecedores().map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</datalist></div>' +
      '<div class="field"><label>NF (nº de controle) — várias separadas por vírgula</label><input id="lNF" placeholder="Ex.: 142, 143"></div><div class="field"><label>Romaneio</label><input id="lRom"></div></div><div id="lNFinfo" class="small"></div>' : '') +
    '<div id="lGrade"></div><div class="row">' + (entrada ? '' : '<div class="field"><label>Documento</label><input id="lDoc"></div>') +
    '<div class="field"><label>' + (entrada ? 'Observação' : 'Motivo (obrigatório)') + '</label><input id="lObs" placeholder="' + (entrada ? 'Fornecedor, lote…' : 'Ex.: peça avariada no transporte') + '"></div></div>';
  modal(entrada ? 'Lançar entrada' : 'Lançar saída / baixa', body, {
    ok: entrada ? 'Lançar entrada' : 'Lançar saída',
    onOpen: function (m) {
      var draw = function () { desenharGrade($('#lGrade', m), tipoById($('#lT', m).value), $('#lC', m).value, { rotuloSaldo: entrada ? 'Saldo atual' : 'Disponível', fisico: entrada }); };
      $('#lC', m).onchange = draw; $('#lT', m).onchange = draw; draw(); modalVivo = draw;
      if (entrada) {
        var info = function () {
          var fo = $('#lF', m).value.trim().toUpperCase(), lst = $('#lNF', m).value.split(/\s*,\s*|\s+e\s+/i).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
          var achadas = S.nfs.filter(function (n) { return n.f === fo && lst.indexOf(n.nf) >= 0; });
          var t = tipoById($('#lT', m).value), tonG = 0;
          if (t) { var pz = {}; (t.volumes || []).forEach(function (v) { pz[v.id] = Number(v.pesoKg || 0); }); $$('[data-q]', m).forEach(function (i) { if (i.value) tonG += Number(i.value) * (pz[i.getAttribute('data-q')] || 0) / 1000; }); }
          var el = $('#lNFinfo', m);
          if (!lst.length || !S.nfs.length) { el.innerHTML = ''; return; }
          if (!achadas.length) { el.innerHTML = '<span class="tag warn">NF não encontrada no controle de NFs' + (fo ? ' para ' + esc(fo) : '') + '</span>'; return; }
          var tn = achadas.reduce(function (a, n) { return a + n.q; }, 0), cn = achadas.map(function (n) { return canteiroDaNF(n.can); });
          var dif = tonG - tn;
          el.innerHTML = '<span class="tag ok">' + achadas.length + ' NF(s) no controle</span> ' + nf(tn, 2) + ' t · entrega ' + esc(fdata(achadas[0].dt || achadas[0].de)) + ' · ' + esc(cn.join(', ')) +
            (tonG ? ' · volumes digitados: <b>' + nf(tonG, 2) + ' t</b> ' + (Math.abs(dif) <= Math.max(0.05 * tn, 0.3) ? '<span class="tag ok">peso confere</span>' : '<span class="tag warn">diferença ' + (dif > 0 ? '+' : '') + nf(dif, 2) + ' t</span>') : '') +
            (achadas.length && !$('#lRom', m).value ? '' : '');
          if (!$('#lD', m)._mexeu && achadas[0].dt) $('#lD', m).value = achadas[0].dt;
          if (!$('#lC', m).value) { var c0 = S.canteiros.find(function (c) { return cn[0] === c.nome; }); if (c0) { $('#lC', m).value = c0.id; draw(); } }
        };
        $('#lD', m).addEventListener('change', function () { $('#lD', m)._mexeu = true; });
        ['#lF', '#lNF'].forEach(function (s) { $(s, m).addEventListener('input', info); });
        $('#lGrade', m).addEventListener('input', info);
      }
    },
    onOk: async function (m) {
      var c = $('#lC', m).value, t = tipoById($('#lT', m).value), erros = [];
      if (!c) erros.push('Escolha o canteiro.'); if (!t) erros.push('Escolha o tipo de torre.');
      var itens = lerGrade(m); if (!itens.length) erros.push('Informe ao menos uma quantidade.');
      var obs = $('#lObs', m).value.trim(); if (!entrada && !obs) erros.push('Informe o motivo da saída.');
      var forn = entrada ? $('#lF', m).value.trim().toUpperCase() : '', nfsL = entrada ? $('#lNF', m).value.split(/\s*,\s*|\s+e\s+/i).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean) : [], rom = entrada ? $('#lRom', m).value.trim() : '';
      var doc = entrada ? (nfsL.length ? 'NF ' + nfsL.join(', ') + ' · Rom. ' + (rom || '-') : (rom ? 'Rom. ' + rom : '')) : $('#lDoc', m).value.trim();
      if (entrada && forn && obs.toUpperCase().indexOf(forn) !== 0) obs = forn + (obs ? ' · ' + obs : '');
      if (erros.length) throw Falha(erros);
      if (!entrada) {
        var fr = await estadoFresco(c, t.id);
        erros = C.validarSaida(t, fr.saldos, fr.reservas, c, itens);
        if (erros.length) throw Falha(erros);
      }
      await Store.set('movimentos', newId('m'), {
        natureza: nat, canteiroId: c, tipoId: t.id, data: $('#lD', m).value || hoje(), criadoEm: new Date().toISOString(), usuarioId: S.uid || null,
        itens: itens.map(function (i) { return { componenteId: i.componenteId, qtd: entrada ? i.qtd : -i.qtd }; }), documento: doc, obs: obs, fornecedor: forn, nfs: nfsL, romaneio: rom
      });
      modalVivo = null; toast(entrada ? 'Entrada lançada' : 'Saída lançada');
    }
  });
}
function bindEstorno() {
  $$('[data-estornar]').forEach(function (b) {
    b.onclick = function () {
      var id = b.getAttribute('data-estornar'); var m = S.movimentos.find(function (x) { return x.id === id; }); if (!m) return;
      modal('Estornar lançamento', '<p style="margin:0">Será criado um lançamento inverso de <b>' + esc(C.NATUREZAS[m.natureza]) + '</b> em ' + esc(cantNome(m.canteiroId)) + ' (' + esc(tipoCod(m.tipoId)) + ')' + (m.numeroTorre ? ', torre <b>' + esc(m.numeroTorre) + '</b>' : '') + '. O original continua no histórico.</p>' + itensResumo(m.tipoId, m.itens, 30) +
        '<div class="field"><label>Motivo (obrigatório)</label><input id="eMot"></div>', {
        ok: 'Estornar',
        onOk: async function (md) {
          var mot = $('#eMot', md).value.trim(); if (!mot) throw Falha(['Informe o motivo do estorno.']);
          var tipo = tipoById(m.tipoId);
          var inverso = m.itens.map(function (i) { return { componenteId: i.componenteId, qtd: -Number(i.qtd) }; });
          var saidas = inverso.filter(function (i) { return i.qtd < 0; }).map(function (i) { return { componenteId: i.componenteId, qtd: -i.qtd }; });
          if (saidas.length) {
            var fr = await estadoFresco(m.canteiroId, m.tipoId);
            var er = tipo ? C.validarSaida(tipo, fr.saldos, fr.reservas, m.canteiroId, saidas) : [];
            if (er.length) throw Falha(['O estorno deixaria o saldo negativo:'].concat(er));
          }
          var ja = await Store.get('movimentos', 'es_' + id);
          if (ja) throw Falha(['Este lançamento já foi estornado.']);
          await Store.set('movimentos', 'es_' + id, {
            natureza: 'ESTORNO', canteiroId: m.canteiroId, tipoId: m.tipoId, data: hoje(), criadoEm: new Date().toISOString(), usuarioId: S.uid || null,
            itens: inverso, estornoDe: id, documento: m.documento || '', obs: 'Estorno de ' + (C.NATUREZAS[m.natureza] || m.natureza) + (m.numeroTorre ? ' (torre ' + m.numeroTorre + ')' : '') + ': ' + mot
          });
          toast('Lançamento estornado');
        }
      });
    };
  });
}

// ===== APLICAÇÃO EM TORRE =====
V.aplicacoes = function () {
  var h = head('Aplicação em torre', 'Baixa dos volumes aplicados em cada torre (stubs na fundação, depois a montagem). A torre fica "Montada" quando todo o kit foi aplicado.',
    podeGravar() ? '<button class="btn pri" id="novaApl">+ Registrar aplicação</button>' : '');
  var sc = semCadastro(); if (sc) return h + sc;
  var f = F.mont, est = estornados();
  var lista = S.movimentos.filter(function (m) { return (m.natureza === 'APLICACAO' || m.natureza === 'MONTAGEM') && (!f.canteiro || m.canteiroId === f.canteiro) && (!f.tipo || m.tipoId === f.tipo) && (!f.q || String(m.numeroTorre || '').indexOf(f.q) === 0); })
    .sort(function (a, b) { return String(b.data + b.criadoEm).localeCompare(String(a.data + a.criadoEm)); });
  var torresComAp = {}; lista.forEach(function (m) { if (!est[m.id]) torresComAp[m.numeroTorre] = 1; });
  h += '<div class="card"><div class="row"><div class="field"><label>Canteiro</label><select id="mfC">' + optList(cantsOrd(false), f.canteiro, function (x) { return x.nome; }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Tipo</label><select id="mfT">' + optList(tiposOrd(), f.tipo, function (x) { return x.codigo; }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Nº da torre</label><input id="mfQ" value="' + esc(f.q || '') + '"></div>' +
    '<div class="field" style="flex:0 0 auto"><label>Torres com aplicação</label><div class="big" style="font-size:22px">' + nf(Object.keys(torresComAp).length) + '</div></div></div></div>';
  h += '<div class="card">' + tabelaMovs(lista.slice(0, 300)) + '</div>';
  return h;
};
V.aplicacoes_bind = function () {
  var a = $('#mfC'); if (a) a.onchange = function () { F.mont.canteiro = a.value; render(); };
  var b = $('#mfT'); if (b) b.onchange = function () { F.mont.tipo = b.value; render(); };
  var q = $('#mfQ'), tm; if (q) q.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { F.mont.q = q.value; render(); }, 250); };
  var n = $('#novaApl'); if (n) n.onclick = function () { formAplicacao(); };
  bindEstorno();
};
function formAplicacao(n) {
  var body = '<div class="row"><div class="field"><label>Nº da torre</label><input id="aN" list="aLista" value="' + esc(n || '') + '" placeholder="Ex.: 94/1"><datalist id="aLista">' +
    S.torres.filter(function (t) { return infoTorre(t).status !== 'montada'; }).slice().sort(function (a, b) { return a.op - b.op; }).map(function (t) { return '<option value="' + esc(t.n) + '">' + esc(t.t + ' · ' + cantNome(t.c)) + '</option>'; }).join('') + '</datalist></div>' +
    '<div class="field"><label>Sai do estoque de</label><select id="aC">' + optList(cantsOrd(true), '', function (x) { return x.nome; }) + '</select></div>' +
    '<div class="field"><label>O que aplicar</label><select id="aModo"><option value="tudo">Tudo o que falta (montagem completa)</option><option value="stub">Somente stubs (fundação)</option><option value="manual">Escolher volumes</option></select></div></div>' +
    '<div id="aInfo"></div><div id="aGrade"></div>' +
    '<div class="row"><div class="field"><label>Data</label><input type="date" id="aD" value="' + hoje() + '"></div><div class="field"><label>Romaneio de saída / documento</label><input id="aDoc"></div><div class="field"><label>Equipe / observação</label><input id="aO"></div></div>';
  modal('Registrar aplicação em torre', body, {
    ok: 'Registrar aplicação',
    onOpen: function (m) {
      var ultimo = null;
      var draw = function (forcarModo) {
        var t = torreByN($('#aN', m).value.trim()), info = $('#aInfo', m), grade = $('#aGrade', m);
        if (!t) { info.innerHTML = '<div class="muted small">Informe uma torre da lista de construção.</div>'; grade.innerHTML = ''; return; }
        var tp = tipoById(t.t);
        if (ultimo !== t.n) { $('#aC', m).value = t.c; ultimo = t.n; }
        var c = $('#aC', m).value, modo = $('#aModo', m).value, need = C.necessidade(tp, t, aplicado());
        var stubIds = (C.porGrupo(tp)['AP/STB'] || []).map(function (v) { return v.id; });
        var prev = forcarModo ? {} : (function () { var o = {}; $$('[data-q]', m).forEach(function (i) { if (i.value !== '') o[i.getAttribute('data-q')] = i.value; }); return o; })();
        info.innerHTML = '<div class="small"><b>' + esc(tp.codigo) + '</b> · canteiro da torre: <b>' + esc(cantNome(t.c)) + '</b> · ' + tagStatus(infoTorre(t).status) + (c !== t.c ? ' <span class="tag warn">saindo de outro canteiro</span>' : '') + '</div>';
        var rows = '';
        gruposOrdenados(tp).forEach(function (g) {
          var vs = g.volumes.filter(function (v) { return need[v.id]; });
          if (!vs.length) return;
          rows += '<tr><td colspan="4" style="background:#f4f5f2;font-weight:600;font-size:12.5px">' + esc(nomeGrupo(g.grupo)) + '</td></tr>';
          vs.forEach(function (v) {
            var d = C.disponivel(S.d.saldos, S.d.reservas, c, tp.id, v.id), pad = modo === 'tudo' ? need[v.id] : modo === 'stub' ? (stubIds.indexOf(v.id) >= 0 ? need[v.id] : '') : '';
            var val = prev[v.id] != null ? prev[v.id] : pad;
            rows += '<tr><td>' + esc(v.nome) + '</td><td class="n">' + need[v.id] + '</td><td class="n">' + (d >= need[v.id] ? cell(d) : '<span class="tag bad">' + d + '</span>') + '</td><td class="n"><input class="num" type="number" min="0" max="' + need[v.id] + '" step="1" data-q="' + esc(v.id) + '" value="' + esc(val) + '"></td></tr>';
          });
        });
        grade.innerHTML = rows ? '<div class="tw" style="max-height:46vh"><table><thead><tr><th>Volume</th><th class="n">Falta aplicar</th><th class="n">Disponível</th><th class="n">Aplicar agora</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="banner info">Todo o kit desta torre já foi aplicado.</div>';
      };
      $('#aN', m).oninput = function () { draw(true); }; $('#aC', m).onchange = function () { draw(false); }; $('#aModo', m).onchange = function () { draw(true); };
      draw(true); modalVivo = function () { draw(false); };
    },
    onOk: async function (m) {
      var t = torreByN($('#aN', m).value.trim()), erros = [];
      if (!t) throw Falha(['Informe uma torre da lista de construção.']);
      var tp = tipoById(t.t), c = $('#aC', m).value, itens = lerGrade(m), need = C.necessidade(tp, t, aplicado());
      if (!itens.length) erros.push('Informe ao menos um volume.');
      itens.forEach(function (i) { if (i.qtd > (need[i.componenteId] || 0)) erros.push(compNome(tp.id, i.componenteId) + ': a torre só precisa de mais ' + (need[i.componenteId] || 0)); });
      if (erros.length) throw Falha(erros);
      var fr = await estadoFresco(c, tp.id);
      erros = C.validarSaida(tp, fr.saldos, fr.reservas, c, itens);
      if (erros.length) throw Falha(['Estoque insuficiente em ' + cantNome(c) + ':'].concat(erros));
      await Store.set('movimentos', newId('ap'), {
        natureza: 'APLICACAO', canteiroId: c, tipoId: tp.id, numeroTorre: t.n, data: $('#aD', m).value || hoje(), criadoEm: new Date().toISOString(), usuarioId: S.uid || null,
        itens: itens.map(function (i) { return { componenteId: i.componenteId, qtd: -i.qtd }; }), documento: $('#aDoc', m).value.trim(), obs: $('#aO', m).value.trim() || ('Aplicação na torre ' + t.n)
      });
      modalVivo = null; toast('Aplicação na torre ' + t.n + ' registrada');
    }
  });
}
// ===== INVENTÁRIO =====
V.inventario = function () {
  var h = head('Inventário', 'Conte os volumes no pátio e lance o ajuste: o sistema registra só a diferença, com justificativa.');
  var sc = semCadastro(); if (sc) return h + sc;
  var f = F.inv;
  h += '<div class="card"><div class="row"><div class="field"><label>Canteiro</label><select id="iC">' + optList(cantsOrd(true), f.canteiro, function (x) { return x.nome; }, 'Selecione…') + '</select></div>' +
    '<div class="field"><label>Tipo de torre</label><select id="iT">' + optList(tiposOrd(), f.tipo, function (x) { return tipoNome(x.id); }, 'Selecione…') + '</select></div>' +
    '<div class="field"><label>Filtrar volumes</label><input id="iQ" value="' + esc(f.q || '') + '" placeholder="Ex.: EXTENSAO 12"></div></div></div>';
  var t = tipoById(f.tipo);
  if (!f.canteiro || !t) return h + '<div class="card empty">Escolha o canteiro e o tipo de torre para contar.</div>';
  var q = (f.q || '').toUpperCase();
  h += '<div class="card"><h2>Contagem física · ' + esc(cantNome(f.canteiro)) + ' · ' + esc(tipoNome(t.id)) + '</h2><div class="tw" style="max-height:62vh"><table><thead><tr><th>Volume</th><th class="n">Saldo no sistema</th><th class="n">Reservado</th><th class="n">Contado</th><th class="n">Diferença</th></tr></thead><tbody>';
  gruposOrdenados(t).forEach(function (g) {
    var corpo = '';
    g.volumes.forEach(function (c) {
      if (q && (c.nome + ' ' + g.grupo).toUpperCase().indexOf(q) < 0) return;
      var s = C.get(S.d.saldos, f.canteiro, t.id, c.id), r = C.get(S.d.reservas, f.canteiro, t.id, c.id);
      var v = f.cont && f.cont[c.id] != null ? f.cont[c.id] : '';
      corpo += '<tr><td>' + esc(c.nome) + '</td><td class="n">' + cell(s) + '</td><td class="n">' + cell(r) + '</td><td class="n"><input class="num" type="number" min="0" step="1" id="inv_' + esc(c.id) + '" data-inv="' + esc(c.id) + '" data-s="' + s + '" value="' + esc(v) + '"></td><td class="n" data-dif="' + esc(c.id) + '"></td></tr>';
    });
    if (corpo) h += '<tr><td colspan="5" style="background:#f4f5f2;font-weight:600;font-size:12.5px">' + esc(nomeGrupo(g.grupo)) + '</td></tr>' + corpo;
  });
  h += '</tbody></table></div><div class="row" style="margin-top:12px"><div class="field"><label>Justificativa (obrigatória)</label><input id="iJus" value="' + esc(f.jus || '') + '" placeholder="Ex.: inventário mensal de novembro"></div>' +
    '<div class="field"><label>Data da contagem</label><input type="date" id="iD" value="' + esc(f.data || hoje()) + '"></div>' +
    '<div class="field" style="flex:0 0 auto">' + (podeGravar() ? '<button class="btn pri" id="iLanc">Lançar ajuste</button>' : '') + '</div></div><p class="small muted" style="margin:8px 0 0">Volumes deixados em branco não são alterados. A contagem digitada fica guardada mesmo se você filtrar a lista.</p></div>';
  return h;
};
V.inventario_bind = function () {
  var f = F.inv;
  var a = $('#iC'); if (a) a.onchange = function () { f.canteiro = a.value; f.cont = {}; render(); };
  var b = $('#iT'); if (b) b.onchange = function () { f.tipo = b.value; f.cont = {}; render(); };
  var qi = $('#iQ'), tm; if (qi) qi.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { f.q = qi.value; render(); }, 250); };
  var upd = function () {
    f.cont = f.cont || {};
    $$('[data-inv]').forEach(function (i) {
      var id = i.getAttribute('data-inv'); var el = $('[data-dif="' + id + '"]');
      if (i.value === '') { delete f.cont[id]; el.innerHTML = ''; return; }
      f.cont[id] = i.value; var d = Number(i.value) - Number(i.getAttribute('data-s'));
      el.innerHTML = d === 0 ? '<span class="tag ok">confere</span>' : '<span class="tag ' + (d > 0 ? 'info' : 'bad') + '">' + (d > 0 ? '+' : '') + d + '</span>';
    });
  };
  $$('[data-inv]').forEach(function (i) { i.oninput = upd; }); upd();
  var j = $('#iJus'); if (j) j.oninput = function () { f.jus = j.value; };
  var dd = $('#iD'); if (dd) dd.onchange = function () { f.data = dd.value; };
  var l = $('#iLanc');
  if (l) l.onclick = async function () {
    var erros = [], t = tipoById(f.tipo), cont = f.cont || {};
    if (!f.jus || !f.jus.trim()) erros.push('Informe a justificativa.');
    Object.keys(cont).forEach(function (k) { var v = Number(cont[k]); if (!isFinite(v) || v < 0 || Math.floor(v) !== v) erros.push(compNome(t.id, k) + ': contagem inválida'); });
    if (!Object.keys(cont).length) erros.push('Informe a contagem de ao menos um volume.');
    if (erros.length) return toast(erros.join(' · '), true);
    l.disabled = true;
    try {
      var fr = await estadoFresco(f.canteiro, t.id);
      var itens = [];
      Object.keys(cont).forEach(function (k) { var d = Number(cont[k]) - C.get(fr.saldos, f.canteiro, t.id, k); if (d) itens.push({ componenteId: k, qtd: d }); });
      if (!itens.length) { toast('Tudo confere — nenhum ajuste necessário.'); l.disabled = false; return; }
      await Store.set('movimentos', newId('aj'), { natureza: 'AJUSTE', canteiroId: f.canteiro, tipoId: t.id, data: f.data || hoje(), criadoEm: new Date().toISOString(), usuarioId: S.uid || null, itens: itens, documento: 'Inventário', obs: f.jus.trim() });
      f.cont = {}; f.jus = ''; toast('Ajuste de inventário lançado (' + itens.length + ' volume(s))'); render();
    } catch (e) { l.disabled = false; toast(errMsg(e), true); }
  };
};

// ===== HISTÓRICO =====
function filtrarHist() {
  var f = F.hist, q = (f.q || '').toLowerCase();
  return S.movimentos.filter(function (m) {
    if (f.canteiro && m.canteiroId !== f.canteiro) return false;
    if (f.tipo && m.tipoId !== f.tipo) return false;
    if (f.natureza && m.natureza !== f.natureza) return false;
    if (f.de && String(m.data) < f.de) return false;
    if (f.ate && String(m.data) > f.ate) return false;
    if (q && (String(m.documento || '') + ' ' + (m.obs || '') + ' ' + (m.numeroTorre || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return String(b.data + b.criadoEm).localeCompare(String(a.data + a.criadoEm)); });
}
V.historico = function () {
  var f = F.hist;
  var h = head('Histórico', 'Todas as movimentações (razão do estoque). Nada é apagado: correções são feitas por estorno.', '<button class="btn" id="expHist">Exportar CSV</button>');
  h += '<div class="card"><div class="row"><div class="field"><label>Canteiro</label><select id="hC">' + optList(cantsOrd(false), f.canteiro, function (x) { return x.nome; }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Tipo</label><select id="hT">' + optList(tiposOrd(), f.tipo, function (x) { return tipoNome(x.id); }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Natureza</label><select id="hN"><option value="">Todas</option>' + Object.keys(C.NATUREZAS).map(function (k) { return '<option value="' + k + '"' + (f.natureza === k ? ' selected' : '') + '>' + C.NATUREZAS[k] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>De</label><input type="date" id="hDe" value="' + esc(f.de) + '"></div><div class="field"><label>Até</label><input type="date" id="hAte" value="' + esc(f.ate) + '"></div>' +
    '<div class="field"><label>Buscar (doc., obs., torre)</label><input id="hQ" value="' + esc(f.q) + '"></div></div></div>';
  var lista = filtrarHist();
  h += '<div class="card"><h2>' + nf(lista.length) + ' movimentação(ões)</h2>' + tabelaMovs(lista.slice(0, f.lim)) +
    (lista.length > f.lim ? '<div style="text-align:center;margin-top:12px"><button class="btn" id="hMais">Mostrar mais</button></div>' : '') + '</div>';
  return h;
};
V.historico_bind = function () {
  var f = F.hist;
  [['#hC', 'canteiro'], ['#hT', 'tipo'], ['#hN', 'natureza'], ['#hDe', 'de'], ['#hAte', 'ate']].forEach(function (p) { var e = $(p[0]); if (e) e.onchange = function () { f[p[1]] = e.value; render(); }; });
  var q = $('#hQ'), tm; if (q) q.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { f.q = q.value; render(); }, 250); };
  var m = $('#hMais'); if (m) m.onclick = function () { f.lim += 200; render(); };
  var e = $('#expHist'); if (e) e.onclick = exportarHist;
  bindEstorno();
};

// ===================== NOTAS FISCAIS =====================
// Cores categóricas validadas (ordem fixa; segue o fornecedor, não a posição na tela)
var PALETA_FORN = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
function listaFornecedores() {
  var o = {};
  S.tipos.forEach(function (t) { if (t.fornecedor) o[String(t.fornecedor).trim().toUpperCase()] = 1; });
  S.nfs.forEach(function (n) { if (n.f) o[n.f] = 1; });
  return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
}
function corForn(f) { var l = listaFornecedores(), i = l.indexOf(f); return i >= 0 && i < PALETA_FORN.length ? PALETA_FORN[i] : '#8a948f'; }
function pesoMov(m) {
  var t = tipoById(m.tipoId); if (!t) return 0;
  var p = t._pesos; if (!p) { p = {}; (t.volumes || []).forEach(function (v) { p[v.id] = Number(v.pesoKg || 0); }); Object.defineProperty(t, '_pesos', { value: p, enumerable: false }); }
  return m.itens.reduce(function (a, i) { return a + (p[i.componenteId] || 0) * Number(i.qtd); }, 0) / 1000;
}
function conferencia() { var m = M(); if (!m.conf) m.conf = C.conferirNFs(S.nfs, S.movimentos, pesoMov); return m.conf; }
function precos() { var m = M(); if (!m.precos) m.precos = C.precoPorFornecedor(S.nfs.filter(function (n) { return !(n.origem === 'carga' && !n.v); })); return m.precos; }
function precoDoTipo(t) { var p = precos(), f = String(t.fornecedor || '').trim().toUpperCase(); return p[f] || null; }
/** Valor do estoque físico por canteiro x tipo, com quanto está "aguardando complemento" (não alocado a torre pronta). */
function valorEstoque() {
  var m = M(); if (m.valor) return m.valor;
  var out = { total: 0, ton: 0, aguardando: 0, excedente: 0, linhas: [], semPreco: [] };
  tiposOrd().forEach(function (t) {
    var preco = precoDoTipo(t), pesos = {}, a = aloc(t.id), nec = necessidadePendente(t.id);
    (t.volumes || []).forEach(function (v) { pesos[v.id] = Number(v.pesoKg || 0) / 1000; });
    if (!preco) out.semPreco.push(t.codigo);
    var necTot = {}; Object.keys(nec).forEach(function (c) { for (var k in nec[c]) necTot[k] = (necTot[k] || 0) + nec[c][k]; });
    var dispTot = {};
    cantsOrd(false).forEach(function (c) {
      var ton = 0, sob = 0, sobra = a.sobra[c.id] || {};
      (t.volumes || []).forEach(function (v) {
        var f = C.get(S.d.saldos, c.id, t.id, v.id); if (f > 0) ton += f * pesos[v.id];
        var s = Math.max(0, Math.min(sobra[v.id] || 0, f)); sob += s * pesos[v.id];
        dispTot[v.id] = (dispTot[v.id] || 0) + Math.max(0, f);
      });
      if (!ton) return;
      out.linhas.push({ t: t, c: c, ton: ton, valor: preco ? ton * preco : 0, aguardando: preco ? sob * preco : 0, tonAg: sob });
      out.ton += ton; if (preco) { out.total += ton * preco; out.aguardando += sob * preco; }
    });
    if (preco) (t.volumes || []).forEach(function (v) { var ex = (dispTot[v.id] || 0) - (necTot[v.id] || 0); if (ex > 0) out.excedente += ex * pesos[v.id] * preco; });
  });
  return (m.valor = out);
}
function brl(v, mi) { return mi ? 'R$ ' + nf(v / 1e6, 1) + ' mi' : 'R$ ' + nf(v, 0); }
var ST_NF = { confere: ['Confere', 'ok'], diverge: ['Peso diverge', 'warn'], sem_lancamento: ['NF sem lançamento', 'bad'], sem_nf: ['Lançamento sem NF', 'info'] };
function semNFs(h) { return h + '<div class="card empty"><b>Controle de NFs ainda não carregado</b>Em <a href="#importar">Importar projeto</a>, escolha a planilha <i>Controle de NFs</i> (.xlsx). Dá para atualizar toda semana.</div>'; }

// ---------- CONFERÊNCIA DE NFs ----------
V.notas = function () {
  var aba = F.notas.aba || 'cruz';
  if (aba === 'estoque') return notasEstoque().replace('<div class="top">', abasNotas() + '<div class="top">');
  var h = head('Controle de NFs', 'Controle de notas da empreiteira cruzado com o controle interno de NFs: o que bate, o que falta de um lado ou de outro e onde há diferença de peso, canteiro, romaneio ou data.');
  h = h + abasNotas();
  var sc = semCadastro(); if (sc) return h + sc;
  return h + (aba === 'emp' ? vistaNotasEmp() : vistaCruzamento());
};
function notasEstoque() {
  var h = head('NFs × lançamentos no estoque', 'Notas fiscais de estrutura × volumes lançados no estoque. A conferência é por carga: as NFs lançadas juntas formam um grupo, e o peso dos volumes é comparado com o da nota (tolerância de 5% ou 0,3 t).',
    S.nfs.length ? '<button class="btn" id="expNF">Exportar CSV</button>' : '');
  if (!S.nfs.length) return semNFs(h);
  var sc = semCadastro(); if (sc) return h + sc;
  var c = conferencia(), r = c.resumo, f = F.notas, meta = S.nfsMeta || {};
  h += '<div class="kpis">' + Object.keys(ST_NF).map(function (k) {
    return '<div class="kpi" style="cursor:pointer;' + (f.status === k ? 'outline:2px solid var(--acc)' : '') + '" data-stnf="' + k + '"><div class="l">' + tagNF(k) + '</div><div class="v">' + nf(r[k].n) + '</div><div class="h">' + nf(r[k].t, 1) + ' t' + (k === 'sem_nf' ? ' lançadas' : ' nas notas') + '</div></div>';
  }).join('') + '</div>';
  if (meta.semana) h += '<p class="small muted" style="margin:-6px 0 12px">Planilha: ' + esc(meta.arquivo || '') + ' · ' + esc(meta.semana) + ' · ' + nf(c.nfsEstrutura) + ' NFs de estrutura. Clique num indicador para filtrar.</p>';
  // macro por fornecedor x canteiro
  var mac = {};
  c.grupos.forEach(function (g) {
    g.nfs.forEach(function (n) { var k = n.f + '|' + canteiroDaNF(n.can); var x = mac[k] = mac[k] || { f: n.f, c: canteiroDaNF(n.can), tn: 0, ts: 0 }; x.tn += n.q; });
    g.recs.forEach(function (m) { var k = (g.fornecedor || C.fornecedorDoMov(m)) + '|' + cantNome(m.canteiroId); var x = mac[k] = mac[k] || { f: g.fornecedor || C.fornecedorDoMov(m), c: cantNome(m.canteiroId), tn: 0, ts: 0 }; x.ts += pesoMov(m); });
  });
  var macL = Object.keys(mac).map(function (k) { return mac[k]; }).filter(function (x) { return x.tn > 0.01 || x.ts > 0.01; }).sort(function (a, b) { return a.f.localeCompare(b.f) || a.c.localeCompare(b.c); });
  h += '<div class="card"><h2>Toneladas por fornecedor e canteiro <span class="sub">faturado nas NFs × peso dos volumes lançados</span></h2><div class="tw tw-flat"><table class="tab-linhas"><thead><tr><th>Fornecedor</th><th>Canteiro</th><th class="n">NFs (t)</th><th class="n">Lançado (t)</th><th class="n">Diferença (t)</th><th class="n">%</th></tr></thead><tbody>' +
    macL.map(function (x) { var d = x.ts - x.tn, p = x.tn ? 100 * d / x.tn : 0, ruim = Math.abs(d) >= 0.5 && Math.abs(p) > 5; return '<tr><td><b>' + esc(x.f) + '</b></td><td>' + esc(x.c) + '</td><td class="n">' + nf(x.tn, 1) + '</td><td class="n">' + nf(x.ts, 1) + '</td><td class="n">' + (Math.abs(d) < 0.5 ? '<span class="zero">0</span>' : '<span class="' + (ruim ? 'neg' : '') + '">' + (d > 0 ? '+' : '') + nf(d, 1) + '</span>') + '</td><td class="n">' + (x.tn ? '<span class="' + (ruim ? 'neg' : '') + '">' + (p > 0 ? '+' : '') + nf(p, 1) + '%</span>' : '—') + '</td></tr>'; }).join('') +
    '</tbody></table></div></div>';
  // lista
  var q = (f.q || '').trim().toUpperCase();
  var lista = c.grupos.filter(function (g) {
    if (f.status && g.status !== f.status) return false;
    if (f.forn && g.fornecedor !== f.forn) return false;
    if (f.canteiro) { var cn = cantById(f.canteiro); if (!(g.canteirosSis.indexOf(f.canteiro) >= 0 || g.canteirosNF.some(function (x) { return cn && x.indexOf(cn.nome.toUpperCase()) === 0; }))) return false; }
    if (q && !g.nfs.some(function (n) { return n.nf === q || n.nff === q || n.rom.indexOf(q) >= 0; }) && !g.recs.some(function (m) { return String(m.documento || '').toUpperCase().indexOf(q) >= 0; })) return false;
    return true;
  }).sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
  var forns = {}; c.grupos.forEach(function (g) { if (g.fornecedor) forns[g.fornecedor] = 1; });
  h += '<div class="card"><div class="row" style="margin-bottom:12px"><div class="field"><label>Situação</label><select id="nS"><option value="">Todas</option>' + Object.keys(ST_NF).map(function (k) { return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + ST_NF[k][0] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Fornecedor</label><select id="nF"><option value="">Todos</option>' + Object.keys(forns).sort().map(function (k) { return '<option' + (f.forn === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Canteiro</label><select id="nC">' + optList(cantsOrd(false), f.canteiro, function (x) { return x.nome; }, 'Todos') + '</select></div>' +
    '<div class="field"><label>Buscar NF / romaneio</label><input id="nQ" value="' + esc(f.q || '') + '" placeholder="Nº de controle, NF do fornecedor ou romaneio"></div>' +
    '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label><div class="big" style="font-size:20px">' + nf(lista.length) + ' <span class="small muted">grupos</span></div></div></div>' +
    '<div class="tw tw-flat"><table class="tab-linhas"><thead><tr><th>Situação</th><th>Fornecedor</th><th>NFs (controle / fornecedor)</th><th>Entrega</th><th>Canteiro NF</th><th class="n">NF (t)</th><th class="n">Lançado (t)</th><th class="n">Dif. (t)</th><th>Lançamentos no estoque</th></tr></thead><tbody>' +
    lista.slice(0, f.lim).map(function (g) {
      var cantSis = g.canteirosSis.map(cantNome), cantNF = g.canteirosNF.map(canteiroDaNF);
      var difCant = g.recs.length && g.nfs.length && cantSis.some(function (x) { return cantNF.indexOf(x) < 0; });
      var aCam = g.status === 'sem_lancamento' && g.nfs.length && g.nfs.every(function (n) { return n.origem === 'carga' && !n.dt; });
      return '<tr><td>' + (aCam ? '<span class="tag info">a caminho</span><br><a class="small" href="#cargas">carga prevista' + (g.nfs[0].previsao ? ' p/ ' + fdata(g.nfs[0].previsao) : '') + '</a>' : tagNF(g.status)) + (difCant ? '<br><span class="tag warn" style="margin-top:3px">canteiro diferente</span>' : '') + (g.status === 'sem_lancamento' && g.tonNF < 3 ? '<br><span class="small muted">NF pequena: pode ser só parafusos</span>' : '') + '</td>' +
        '<td>' + esc(g.fornecedor) + '</td><td class="small mono">' + (g.nfs.length ? g.nfs.map(function (n) { return '<b>' + esc(n.nf) + '</b>' + (n.nff ? ' / ' + esc(n.nff) : ''); }).join('<br>') : '<span class="muted">—</span>') + '</td>' +
        '<td class="small">' + esc(fdata(g.nfs.length ? (g.nfs[0].dt || g.nfs[0].de) : g.data)) + '</td><td class="small">' + esc(cantNF.join(', ')) + '</td>' +
        '<td class="n">' + (g.nfs.length ? nf(g.tonNF, 2) : '<span class="zero">—</span>') + '</td><td class="n">' + (g.recs.length ? nf(g.tonSis, 2) : '<span class="zero">—</span>') + '</td>' +
        '<td class="n">' + (g.nfs.length && g.recs.length ? (Math.abs(g.delta) < 0.005 ? '<span class="zero">0</span>' : (g.delta > 0 ? '+' : '') + nf(g.delta, 2)) : '') + '</td>' +
        '<td class="small">' + (g.recs.length ? g.recs.slice(0, 4).map(function (m) { return fdata(m.data) + ' · ' + esc(cantNome(m.canteiroId)) + ' · ' + esc(m.tipoId) + ' · ' + nf(pesoMov(m), 2) + ' t'; }).join('<br>') + (g.recs.length > 4 ? '<br><span class="muted">+' + (g.recs.length - 4) + '</span>' : '') : '<span class="muted">nenhum</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' + (lista.length > f.lim ? '<div style="text-align:center;margin-top:12px"><button class="btn" id="nMais">Mostrar mais</button></div>' : '') +
    '<p class="small muted" style="margin:10px 0 0">O peso "lançado" usa o peso unitário de cada volume do Resumo de Estruturas; pequenas diferenças são esperadas. Diferenças grandes costumam ser volumes lançados com o número de outra NF da mesma carga, ou NF de parafusos (elementos de fixação), que não viram volume.</p></div>';
  return h;
};
function tagNF(k) { var x = ST_NF[k]; return '<span class="tag ' + x[1] + '">' + x[0] + '</span>'; }
function canteiroDaNF(txtC) { var t = String(txtC || '').toUpperCase(); var c = S.canteiros.find(function (x) { return t.indexOf(String(x.nome).toUpperCase()) === 0; }); return c ? c.nome : (t.split(' - ')[0] || '—').replace(/(^|\s)\S/g, function (s) { return s.toUpperCase(); }).replace(/\B\S/g, function (s) { return s.toLowerCase(); }); }
V.notas_bind = function () {
  var f = F.notas;
  ligarNotasNovas();
  $$('[data-stnf]').forEach(function (k) { k.onclick = function () { var s = k.getAttribute('data-stnf'); f.status = f.status === s ? '' : s; f.lim = 100; render(); }; });
  [['#nS', 'status'], ['#nF', 'forn'], ['#nC', 'canteiro']].forEach(function (p) { var e = $(p[0]); if (e) e.onchange = function () { f[p[1]] = e.value; f.lim = 100; render(); }; });
  var q = $('#nQ'), tm; if (q) q.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { f.q = q.value; render(); }, 250); };
  var m = $('#nMais'); if (m) m.onclick = function () { f.lim += 200; render(); };
  var ex = $('#expNF'); if (ex) ex.onclick = exportarNFs;
};
function exportarNFs() {
  var L = [['Situação', 'Fornecedor', 'NF controle', 'NF fornecedor', 'Emissão', 'Entrega', 'Canteiro NF', 'NF (t)', 'Valor NF (R$)', 'Lançado no grupo (t)', 'Diferença do grupo (t)', 'Romaneios NF', 'Lançamentos (data · canteiro · tipo · t · documento)']];
  conferencia().grupos.forEach(function (g) {
    var lanc = g.recs.map(function (m) { return fdata(m.data) + ' · ' + cantNome(m.canteiroId) + ' · ' + m.tipoId + ' · ' + nf(pesoMov(m), 2) + ' · ' + (m.documento || ''); }).join(' | ');
    var linhas = g.nfs.length ? g.nfs : [null];
    linhas.forEach(function (n) {
      L.push([ST_NF[g.status][0], g.fornecedor, n ? n.nf : '', n ? n.nff : '', n ? fdata(n.de) : '', n ? fdata(n.dt) : '', n ? canteiroDaNF(n.can) : '', n ? String(n.q).replace('.', ',') : '', n ? String(n.v).replace('.', ',') : '',
        String(Math.round(g.tonSis * 1000) / 1000).replace('.', ','), g.nfs.length && g.recs.length ? String(Math.round(g.delta * 1000) / 1000).replace('.', ',') : '', n ? n.rom.join(' ') : '', lanc]);
    });
  });
  salvarArquivo('conferencia-nfs-' + hoje() + '.csv', csv(L));
}

// ---------- FORNECIMENTO E VALOR ----------
V.fornecimento = function () {
  var h = head('Fornecimento e valor', 'Quanto já chegou de cada fornecedor, em que ritmo, e quanto vale o estoque de estruturas nos canteiros.');
  if (!S.nfs.length) return semNFs(h);
  var est = S.nfs.filter(C.ehEstrutura), prev = (S.nfsMeta && S.nfsMeta.resumo) || [], pr = precos();
  var porF = {};
  est.forEach(function (n) { var x = porF[n.f] = porF[n.f] || { t: 0, v: 0, car: 0, nfs: 0, ult: '' }; x.t += n.q; x.v += n.v; x.car += n.car; x.nfs++; var d = n.dt || n.de || ''; if (d > x.ult) x.ult = d; });
  var sem = C.recebidoPorSemana(S.nfs), semanas = Object.keys(sem).sort();
  var ultimaSem = semanas[semanas.length - 1];
  var janela = semanas.slice(-4);
  var forns = Object.keys(porF).sort(function (a, b) { return porF[b].t - porF[a].t; });
  var totPrev = 0, totRec = 0;
  var linhasF = forns.map(function (f) {
    var p = prev.find(function (x) { return x.f === f && x.unid === 'ton'; }), x = porF[f];
    var ritmo = janela.reduce(function (a, w) { return a + ((sem[w] || {})[f] || 0); }, 0) / Math.max(1, janela.length);
    var falta = p ? Math.max(0, p.previsto - x.t) : null, semanasRest = falta != null && ritmo > 0 ? falta / ritmo : null;
    var fim = null; if (semanasRest != null && ultimaSem) { var d = new Date(ultimaSem + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Math.ceil(semanasRest * 7)); fim = d.toISOString().slice(0, 10); }
    if (p) { totPrev += p.previsto; totRec += x.t; }
    return { f: f, x: x, p: p, ritmo: ritmo, falta: falta, fim: fim };
  });
  var val = valorEstoque();
  h += '<div class="kpis">' + kpi('Estruturas recebidas', nf(totRec, 0) + ' t', totPrev ? nf(100 * totRec / totPrev, 1) + '% de ' + nf(totPrev, 0) + ' t previstas' : '') +
    kpi('Valor faturado (estruturas)', brl(est.reduce(function (a, n) { return a + n.v; }, 0), true), nf(est.length) + ' NFs') +
    kpi('Valor em estoque', brl(val.total, true), nf(val.ton, 0) + ' t nos canteiros') +
    kpi('Aguardando complemento', brl(val.aguardando, true), 'em estoque, mas não fecham torre pronta') +
    kpi('Excedente ao projeto', brl(val.excedente, true), 'acima do que falta aplicar nas torres') + '</div>';
  h += '<div class="card"><h2>Por fornecedor <span class="sub">ritmo = média das últimas ' + janela.length + ' semanas com entrega · previsão = o que falta ÷ ritmo</span></h2><div class="tw"><table><thead><tr><th>Fornecedor</th><th>Tipos</th><th class="n">Previsto (t)</th><th class="n">Recebido (t)</th><th>Avanço</th><th class="n">Carretas</th><th class="n">R$/t</th><th>Última entrega</th><th class="n">Ritmo (t/sem)</th><th>Previsão de término</th></tr></thead><tbody>' +
    linhasF.map(function (l) {
      var pct = l.p ? 100 * l.x.t / l.p.previsto : null, tipos = S.tipos.filter(function (t) { return String(t.fornecedor || '').toUpperCase() === l.f; }).map(function (t) { return t.codigo; }).join(', ');
      return '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + corForn(l.f) + ';margin-right:6px"></span><b>' + esc(l.f) + '</b></td><td class="small">' + esc(tipos) + '</td><td class="n">' + (l.p ? nf(l.p.previsto, 0) : '—') + '</td><td class="n">' + nf(l.x.t, 0) + '</td>' +
        '<td style="width:150px">' + (pct != null ? '<div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i style="width:' + Math.min(100, pct).toFixed(1) + '%"></i></div><span class="small mono">' + nf(pct, 0) + '%</span></div>' : '') + '</td>' +
        '<td class="n">' + nf(l.x.car) + '</td><td class="n">' + (pr[l.f] ? nf(pr[l.f], 0) : '—') + '</td><td class="small">' + esc(fdata(l.x.ult)) + '</td><td class="n">' + nf(l.ritmo, 0) + '</td>' +
        '<td class="small">' + (l.fim ? '<b>' + esc(fdata(l.fim)) + '</b> <span class="muted">(' + nf(l.falta, 0) + ' t restantes)</span>' : l.falta === 0 ? '<span class="tag ok">concluído</span>' : '<span class="muted">sem ritmo recente</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="small muted" style="margin:8px 0 0">Previsto vem da aba Resumo da planilha de NFs. A previsão é uma extrapolação simples do ritmo recente, não o cronograma do fornecedor.</p></div>';
  h += '<div class="card"><h2>Recebido por semana <span class="sub">toneladas de estrutura pela data de entrega · passe o mouse nas barras</span></h2>' + graficoSemanal(sem, semanas.slice(-20), forns) + '</div>';
  // valor por canteiro x tipo
  var porC = {};
  val.linhas.forEach(function (l) { var x = porC[l.c.id] = porC[l.c.id] || { c: l.c, ton: 0, valor: 0, ag: 0 }; x.ton += l.ton; x.valor += l.valor; x.ag += l.aguardando; });
  h += '<div class="grid2"><div class="card"><h2>Valor do estoque por canteiro</h2><table><thead><tr><th>Canteiro</th><th class="n">t</th><th class="n">Valor</th><th class="n">Aguardando complemento</th></tr></thead><tbody>' +
    Object.keys(porC).map(function (k) { var x = porC[k]; return '<tr><td><b>' + esc(x.c.nome) + '</b></td><td class="n">' + nf(x.ton, 0) + '</td><td class="n">' + brl(x.valor, true) + '</td><td class="n">' + brl(x.ag, true) + '</td></tr>'; }).join('') + '</tbody></table>' +
    (val.semPreco.length ? '<p class="small muted">Sem preço (fornecedor sem NF): ' + esc(val.semPreco.join(', ')) + '</p>' : '') + '</div>' +
    '<div class="card"><h2>Valor por tipo</h2><div class="tw" style="max-height:340px"><table><thead><tr><th>Tipo</th><th>Canteiro</th><th class="n">t</th><th class="n">Valor</th><th class="n">Aguardando</th></tr></thead><tbody>' +
    val.linhas.slice().sort(function (a, b) { return b.valor - a.valor; }).map(function (l) { return '<tr><td><b>' + esc(l.t.codigo) + '</b></td><td>' + esc(l.c.nome) + '</td><td class="n">' + nf(l.ton, 0) + '</td><td class="n">' + brl(l.valor, true) + '</td><td class="n">' + brl(l.aguardando, true) + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>';
  // outros materiais (cabos)
  var outros = {};
  S.nfs.filter(function (n) { return !C.ehEstrutura(n); }).forEach(function (n) { var k = n.f + '|' + (n.desc || '—') + '|' + n.u; var x = outros[k] = outros[k] || { f: n.f, d: n.desc || '—', u: n.u, q: 0, v: 0, nfs: 0, can: {} }; x.q += n.q; x.v += n.v; x.nfs++; x.can[canteiroDaNF(n.can)] = 1; });
  var ol = Object.keys(outros).map(function (k) { return outros[k]; });
  if (ol.length || prev.some(function (p) { return p.unid !== 'ton'; })) {
    h += '<div class="card"><h2>Cabos e acessórios <span class="sub">só acompanhamento de recebimento (o estoque por bobina ainda não é controlado aqui)</span></h2><div class="tw"><table><thead><tr><th>Fornecedor</th><th>Material</th><th class="n">Recebido</th><th>Unid.</th><th class="n">NFs</th><th>Canteiros</th><th class="n">Valor</th></tr></thead><tbody>' +
      ol.map(function (x) { return '<tr><td><b>' + esc(x.f) + '</b></td><td class="small">' + esc(x.d) + '</td><td class="n">' + nf(x.q, 2) + '</td><td>' + esc(x.u) + '</td><td class="n">' + x.nfs + '</td><td class="small">' + esc(Object.keys(x.can).join(', ')) + '</td><td class="n">' + brl(x.v, true) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (prev.filter(function (p) { return p.unid !== 'ton'; }).length ? '<p class="small" style="margin:10px 0 0">Resumo da planilha: ' + prev.filter(function (p) { return p.unid !== 'ton'; }).map(function (p) { return '<b>' + esc(p.f) + '</b> (' + esc(p.material) + ') ' + nf(p.recebido, 1) + ' de ' + nf(p.previsto, 1) + ' ' + esc(p.unid) + ' — ' + nf(100 * p.recebido / p.previsto, 0) + '%'; }).join(' · ') + '</p>' : '') + '</div>';
  }
  return h;
};
function graficoSemanal(sem, semanas, forns) {
  if (!semanas.length) return '<div class="empty">Sem entregas com data.</div>';
  var W = 900, H = 240, pl = 44, pr = 12, pt = 10, pb = 34, n = semanas.length, bw = (W - pl - pr) / n;
  var tot = semanas.map(function (w) { return forns.reduce(function (a, f) { return a + ((sem[w] || {})[f] || 0); }, 0); });
  var max = Math.max.apply(null, tot.concat([1])), passo = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / passo) * passo;
  if (top / passo < 3) { passo /= 2; } var y = function (v) { return pt + (H - pt - pb) * (1 - v / top); };
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="Toneladas recebidas por semana e fornecedor">';
  for (var g = 0; g <= top + 1e-9; g += passo) svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#eceee9"/><text x="' + (pl - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="11" fill="#8a948f">' + nf(g) + '</text>';
  semanas.forEach(function (w, i) {
    var x0 = pl + i * bw + 3, base = 0, segs = forns.filter(function (f) { return (sem[w] || {})[f]; });
    var tip = 'Semana de ' + fdata(w) + ' — ' + nf(tot[i], 1) + ' t' + forns.map(function (f) { var v = (sem[w] || {})[f]; return v ? '\n' + f + ': ' + nf(v, 1) + ' t' : ''; }).join('');
    svg += '<g><title>' + esc(tip) + '</title><rect x="' + (pl + i * bw) + '" y="' + pt + '" width="' + bw + '" height="' + (H - pt - pb) + '" fill="transparent"/>';
    segs.forEach(function (f, j) {
      var v = sem[w][f], y1 = y(base + v), y0 = y(base), hgt = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
      var r = j === segs.length - 1 ? 3 : 0;
      svg += r ? '<path d="M' + x0 + ' ' + (y1 + hgt) + 'V' + (y1 + r) + 'Q' + x0 + ' ' + y1 + ' ' + (x0 + r) + ' ' + y1 + 'H' + (x0 + bw - 6 - r) + 'Q' + (x0 + bw - 6) + ' ' + y1 + ' ' + (x0 + bw - 6) + ' ' + (y1 + r) + 'V' + (y1 + hgt) + 'Z" fill="' + corForn(f) + '"/>'
        : '<rect x="' + x0 + '" y="' + y1 + '" width="' + (bw - 6) + '" height="' + hgt + '" fill="' + corForn(f) + '"/>';
      base += v;
    });
    if (i % Math.ceil(n / 10) === 0 || i === n - 1) svg += '<text x="' + (x0 + (bw - 6) / 2) + '" y="' + (H - pb + 16) + '" text-anchor="middle" font-size="11" fill="#8a948f">' + w.slice(8, 10) + '/' + w.slice(5, 7) + '</text>';
    svg += '</g>';
  });
  svg += '</svg>';
  return '<div class="chips" style="margin-bottom:8px">' + forns.map(function (f) { return '<span class="small" style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><span style="width:10px;height:10px;border-radius:2px;background:' + corForn(f) + '"></span>' + esc(f) + '</span>'; }).join('') + '</div>' + svg +
    '<details style="margin-top:8px"><summary class="small">Ver tabela</summary><div class="tw" style="max-height:240px;margin-top:6px"><table><thead><tr><th>Semana</th>' + forns.map(function (f) { return '<th class="n">' + esc(f) + '</th>'; }).join('') + '<th class="n">Total</th></tr></thead><tbody>' +
    semanas.slice().reverse().map(function (w) { var t = 0; return '<tr><td>' + fdata(w) + '</td>' + forns.map(function (f) { var v = (sem[w] || {})[f] || 0; t += v; return '<td class="n">' + (v ? nf(v, 1) : '<span class="zero">·</span>') + '</td>'; }).join('') + '<td class="n"><b>' + nf(t, 1) + '</b></td></tr>'; }).join('') + '</tbody></table></div></details>';
}

// ---------- importação do controle de NFs (no navegador) ----------
function carregarXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise(function (res, rej) {
    var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = function () { res(window.XLSX); }; s.onerror = function () { rej(new Error('Não consegui carregar o leitor de Excel.')); };
    document.head.appendChild(s);
  });
}
async function lerArquivoNFs(file) {
  var XLSX = await carregarXLSX();
  var wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  var nomeAba = wb.SheetNames.find(function (n) { return /ativos|notas|nf/i.test(n) && !/resumo|dados/i.test(n); }) || wb.SheetNames[0];
  var linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: true, defval: null });
  var nfs = C.lerPlanilhaNFs(linhas);
  var resumo = wb.Sheets.Resumo ? C.lerResumoNFs(XLSX.utils.sheet_to_json(wb.Sheets.Resumo, { header: 1, raw: true, defval: null })) : [];
  var semana = '';
  linhas.slice(0, 8).forEach(function (r) { (r || []).forEach(function (c, j) { if (/semana/i.test(String(c))) { semana = String(c).trim(); var d = r[j + 1]; if (typeof d === 'number') semana += ' (' + fdata(C.serialData(d)) + ')'; } }); });
  return { nfs: nfs, resumo: resumo, semana: semana, arquivo: file.name, aba: nomeAba };
}
var NF_POR_PARTE = 400;
async function gravarNFs(pacote) {
  var partes = [];
  for (var i = 0; i < pacote.nfs.length; i += NF_POR_PARTE) partes.push(pacote.nfs.slice(i, i + NF_POR_PARTE));
  for (i = 0; i < partes.length; i++) await gravarComRetry('projeto', 'nfs_' + i, { lista: partes[i] });
  var antigas = (S.nfsMeta && S.nfsMeta.partes) || 0;
  for (i = partes.length; i < antigas; i++) { try { await Store.del('projeto', 'nfs_' + i); } catch (e) {} }
  await gravarComRetry('projeto', 'nfs_meta', { partes: partes.length, total: pacote.nfs.length, resumo: pacote.resumo, semana: pacote.semana, arquivo: pacote.arquivo, atualizadoEm: new Date().toISOString() });
}
function blocoImportarNFs() {
  var st = S.impNF || {}, meta = S.nfsMeta || {};
  var h = '<div class="card"><h2>Controle de NFs <span class="sub">planilha de notas fiscais da obra · pode atualizar toda semana</span></h2>';
  h += (S.nfsPlan || []).length ? '<p style="margin-top:0" class="small">Carregado: <b>' + nf((S.nfsPlan || []).length) + ' NFs</b> · ' + esc(meta.arquivo || '') + (meta.semana ? ' · ' + esc(meta.semana) : '') + (meta.atualizadoEm ? ' · atualizado em ' + fdh(meta.atualizadoEm) : '') + '. Veja a <a href="#notas">conferência</a> e o <a href="#fornecimento">fornecimento</a>.</p>'
    : '<p style="margin-top:0">Escolha a planilha de controle de notas fiscais (.xlsx). O sistema lê no seu navegador a aba de notas e a aba Resumo; o arquivo não é enviado a lugar nenhum além do banco desta página.</p>';
  if (!podeCadastrar()) return h + '<div class="banner info">Somente o dono ou Editores podem atualizar as NFs.</div></div>';
  h += '<label class="btn"' + (st.lendo || st.gravando ? ' style="opacity:.5;pointer-events:none"' : '') + '>Escolher planilha…<input type="file" id="nfArq" accept=".xlsx,.xlsm,.xls" hidden></label>';
  if (st.lendo) h += ' <span class="small muted">Lendo…</span>';
  if (st.erro) h += '<div class="banner bad" style="margin-top:12px">' + esc(st.erro) + '</div>';
  if (st.pacote) {
    var p = st.pacote, e = p.nfs.filter(C.ehEstrutura);
    h += '<div class="banner info" style="margin-top:12px"><b>' + esc(p.arquivo) + '</b>' + (p.semana ? ' · ' + esc(p.semana) : '') + ': ' + nf(p.nfs.length) + ' NFs (' + nf(e.length) + ' de estrutura, ' + nf(e.reduce(function (a, n) { return a + n.q; }, 0), 0) + ' t, ' + brl(e.reduce(function (a, n) { return a + n.v; }, 0), true) + ')' +
      (p.resumo.length ? ' · Resumo: ' + p.resumo.map(function (r) { return r.f; }).join(', ') : ' · aba Resumo não encontrada') + ((S.nfsPlan || []).length ? '. Substitui as ' + nf((S.nfsPlan || []).length) + ' NFs carregadas.' : '.') + '</div>' +
      '<button class="btn pri" id="nfGravar"' + (st.gravando ? ' disabled' : '') + '>' + (st.gravando ? 'Gravando…' : 'Gravar NFs') + '</button>';
  }
  return h + '</div>';
}
function ligarImportarNFs() {
  var a = $('#nfArq');
  if (a) a.onchange = async function () {
    var file = a.files && a.files[0]; if (!file) return;
    S.impNF = { lendo: true }; render(true);
    try { S.impNF = { pacote: await lerArquivoNFs(file) }; }
    catch (e) { S.impNF = { erro: 'Não consegui ler a planilha: ' + (e.message || e) }; }
    render(true);
  };
  var g = $('#nfGravar');
  if (g) g.onclick = async function () {
    S.impNF.gravando = true; render(true);
    try { await gravarNFs(S.impNF.pacote); S.impNF = {}; toast('Controle de NFs atualizado'); }
    catch (e) { S.impNF.gravando = false; S.impNF.erro = errMsg(e); }
    render(true);
  };
}

// ===================== PRIORIDADE DE TRAMOS =====================
var SIT_COR = { montada: '#3d4743', pronta: '#2f8a57', pronta_transf: '#2b6cb0', incompleta: '#c0392b' };
var SIT_ROT = { montada: 'Montada', pronta: 'Peças no canteiro', pronta_transf: 'Fecha remanejando', incompleta: 'Faltam peças' };
function prioCfg() {
  var f = F.prio;
  if (!f.carregado && S.prioridades) { f.tramos = JSON.parse(JSON.stringify(S.prioridades.tramos || [])); f.escopo = 'obra'; f.resto = S.prioridades.resto !== false; f.carregado = true; }
  return f;
}
function tramosOp(tramos) {
  return tramos.map(function (tr) {
    var a = torreByN(tr.de), b = torreByN(tr.ate);
    return { id: tr.id, nome: tr.nome, deOp: a ? a.op : 0, ateOp: b ? b.op : 0, tipos: [], valido: !!(a && b) };
  });
}
function calcPrio() {
  var f = prioCfg(), m = M(); f.escopo = 'obra'; var k = JSON.stringify([f.tramos, f.resto]);
  if (m.prioK !== k) {
    var tr = tramosOp(f.tramos).filter(function (x) { return x.valido; });
    // o que já foi solicitado/está em trânsito para um canteiro conta como estoque dele (não pede a mesma peça duas vezes)
    var sal = C.saldosComEntrada(S.d.saldos, S.d.entrando);
    m.prio = C.prioridade(S.tipos, S.torres, cantsOrd(true), sal, S.d.reservas, aplicado(), tr, { escopo: f.escopo, resto: f.resto });
    m.prioTr = tr; m.prioK = k;
    if (!m.prioBase) m.prioBase = C.prioridade(S.tipos, S.torres, cantsOrd(true), sal, S.d.reservas, aplicado(), [], { escopo: 'canteiro', resto: true });
  }
  return { r: m.prio, base: m.prioBase, tramos: m.prioTr };
}
var prioSalvarT = null;
function prioSalvar() {
  var f = F.prio; clearTimeout(prioSalvarT);
  prioSalvarT = setTimeout(async function () {
    try { await Store.set('planejamento', 'prioridades', { tramos: f.tramos, escopo: f.escopo, resto: f.resto, atualizadoEm: new Date().toISOString(), atualizadoPor: S.uid || null }); }
    catch (e) { toast('Não salvou as prioridades: ' + errMsg(e), true); }
  }, 500);
}
function mudouPrio() { F.prio.carregado = true; prioSalvar(); render(); }

V.prioridade = function () {
  var h = head('Prioridade de tramos', 'Escolha os tramos que precisam ficar prontos primeiro. O estoque é distribuído nessa ordem e você vê o que já dá para montar, o que depende de transferência e o que falta comprar ou cobrar.');
  var sc = semCadastro(); if (sc) return h + sc;
  if (!S.torres.length) return h + '<div class="card empty"><b>Lista de construção não carregada</b><a href="#importar">Importe o projeto</a>.</div>';
  var f = prioCfg(), P = calcPrio(), R = P.r, B = P.base;
  var listaN = S.torres.slice().sort(function (a, b) { return a.op - b.op; });
  var dl = '<datalist id="prioTorres">' + listaN.map(function (t) { return '<option value="' + esc(t.n) + '">' + esc(t.t + ' · ' + cantNome(t.c) + ' · op ' + t.op) + '</option>'; }).join('') + '</datalist>';
  // ---- configuração
  h += '<div class="card"><div class="row">' +
    '<div class="field" style="flex:1 1 220px"><label>Nome do tramo</label><input id="pNome" placeholder="Ex.: Tramo 1 – travessia do rio"></div>' +
    '<div class="field" style="flex:0 1 130px"><label>Da torre</label><input id="pDe" list="prioTorres" placeholder="211/2" value="' + esc(f.novoDe || '') + '"></div>' +
    '<div class="field" style="flex:0 1 130px"><label>Até a torre</label><input id="pAte" list="prioTorres" placeholder="230/1" value="' + esc(f.novoAte || '') + '"></div>' +
    '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label><button class="btn pri" id="pAdd">+ Priorizar tramo</button></div>' +
    '<div class="field" style="flex:0 1 230px"><label>Depois dos tramos</label><select id="pResto"><option value="1"' + (f.resto ? ' selected' : '') + '>Seguir a LC para o resto das torres</option><option value="0"' + (!f.resto ? ' selected' : '') + '>Considerar só os tramos</option></select></div></div>' + dl +
    '<p class="small muted" style="margin:8px 0 0">Vale para qualquer modelo de torre. Para cada torre do tramo o sistema verifica se as peças estão no canteiro dela; se não estiverem, se dá para completar remanejando sobras de outro canteiro. Dica: clique numa torre da linha abaixo para preencher "Da torre" e em outra para "Até a torre".</p></div>';
  // ---- faixa da linha
  h += faixaLinha(R, P.tramos);
  // ---- lista de tramos
  if (!f.tramos.length) return h + ondeAtacar(B);
  var perdidas = [], ganhas = [];
  S.torres.forEach(function (t) {
    var a = B.torres[t.n], b = R.torres[t.n]; if (!a || !b) return;
    var okA = a.situacao !== 'incompleta', okB = b.situacao !== 'incompleta';
    if (okA && !okB) perdidas.push(t); if (!okA && okB) ganhas.push(t);
  });
  var totPr = 0, totTr = 0, totT = 0, totInc = 0;
  R.tramos.forEach(function (r) { totPr += r.pronta + r.montada; totTr += r.pronta_transf; totT += r.total; totInc += r.incompleta; });
  h += '<div class="kpis">' + kpi('Torres nos tramos', nf(totT), nf(f.tramos.length) + ' tramo(s) priorizado(s)') + kpi('Com as peças no canteiro', nf(totPr), totT ? nf(100 * totPr / totT, 0) + '% dos tramos (inclui montadas)' : '') +
    kpi('Prontas remanejando', nf(totTr), nf(R.transferencias.length) + ' transferência(s) entre canteiros') + kpi('Incompletas', nf(totInc), 'veja o que falta em cada tramo') +
    kpi('Impacto fora dos tramos', (perdidas.length ? '−' : '') + nf(perdidas.length), perdidas.length ? 'torres que deixam de ter kit' : 'nenhuma torre perde kit') + '</div>';
  P.tramos.forEach(function (tr, i) { h += cardTramo(f, R, tr, i); });
  f.tramos.forEach(function (tr, i) { var a = torreByN(tr.de), b = torreByN(tr.ate); if (!a || !b) h += '<div class="banner bad">Tramo "' + esc(tr.nome || ('Tramo ' + (i + 1))) + '": a torre ' + esc(!a ? tr.de : tr.ate) + ' não existe na LC. <button class="btn sm" data-prm="' + i + '">Remover</button></div>'; });
  if (perdidas.length || ganhas.length) {
    h += '<div class="card"><h2>Impacto da priorização <span class="sub">comparado com a distribuição padrão (ordem da LC, cada canteiro com seu estoque)</span></h2>' +
      (perdidas.length ? '<p class="small" style="margin-top:0"><span class="tag bad">deixam de ter kit</span> <b class="mono">' + perdidas.sort(function (a, b) { return a.op - b.op; }).slice(0, 60).map(function (t) { return esc(t.n); }).join(', ') + '</b>' + (perdidas.length > 60 ? ' +' + (perdidas.length - 60) : '') + '</p>' : '') +
      (ganhas.length ? '<p class="small" style="margin-bottom:0"><span class="tag ok">passam a ter kit</span> <b class="mono">' + ganhas.sort(function (a, b) { return a.op - b.op; }).slice(0, 60).map(function (t) { return esc(t.n); }).join(', ') + '</b>' + (ganhas.length > 60 ? ' +' + (ganhas.length - 60) : '') + '</p>' : '') + '</div>';
  }
  return h;
};
function tileSituacao(t, x, extraCls, escala, attr) {
  var cls = x.situacao === 'montada' ? 'montada' : x.situacao === 'incompleta' ? 'incompleta' : 'pronta';
  var falta = (x.falta || []).reduce(function (a, q) { return a + q.qtd; }, 0);
  var fig = svgTorre(t, cls, null, escala); if (x.situacao === 'pronta_transf') fig = fig.replace('color:' + MT_COR.pronta, 'color:' + SIT_COR.pronta_transf);
  var dica = 'Torre ' + t.n + ' · ' + t.t + ' · ' + C.fmt(t.h) + ' m · ' + SIT_ROT[x.situacao] +
    (x.situacao === 'pronta_transf' ? '\nRemanejar: ' + x.origem.map(function (o) { return compNome(t.t, o.componenteId) + ' ×' + o.qtd + ' de ' + cantNome(o.origemId); }).join(', ') : '') +
    (falta ? '\nFalta: ' + x.falta.map(function (q) { return compNome(t.t, q.componenteId) + ' ×' + q.qtd; }).join(', ') : '');
  return '<div class="mt-tile mt-' + cls + (x.situacao === 'pronta_transf' ? ' mt-transf' : '') + (extraCls || '') + '" role="button" tabindex="0" ' + attr + '="' + esc(t.n) + '" title="' + esc(dica) + '">' +
    '<div class="mt-fig">' + fig + '</div><div class="mt-num">' + esc(t.n) + '</div><div class="mt-sub">' + (cls === 'montada' ? 'montada' : x.situacao === 'pronta_transf' ? '⇄ remanej.' : cls === 'pronta' ? '✓ peças' : '−' + falta) + '</div></div>';
}
function faixaLinha(R, tramos) {
  var porC = {}; S.torres.forEach(function (t) { (porC[t.c] = porC[t.c] || []).push(t); });
  var noTramo = {}; tramos.forEach(function (tr, i) { var lo = Math.min(tr.deOp, tr.ateOp), hi = Math.max(tr.deOp, tr.ateOp); S.torres.forEach(function (t) { if (t.op >= lo && t.op <= hi && noTramo[t.n] == null) noTramo[t.n] = i; }); });
  var f = F.prio, selA = torreByN(f.novoDe || ''), selB = torreByN(f.novoAte || '');
  var h = '<div class="card"><h2>A linha inteira <span class="sub">torres na ordem da LC · faixa laranja em cima = já está num tramo priorizado · clique para escolher o início e o fim de um novo tramo</span></h2><div class="mt-leg" style="margin-bottom:6px">' +
    Object.keys(SIT_ROT).map(function (k) { return '<span class="mt-legi"><span class="mt-sw" style="background:' + SIT_COR[k] + '"></span>' + SIT_ROT[k] + '</span>'; }).join('') + '</div>';
  Object.keys(porC).sort(function (a, b) { return byNome(cantById(a) || {}, cantById(b) || {}); }).forEach(function (cid) {
    var ts = porC[cid].sort(function (a, b) { return a.op - b.op; });
    h += '<div class="small" style="margin:12px 0 4px"><b>' + esc(cantNome(cid)) + '</b> <span class="muted">' + esc(ts[0].n) + ' → ' + esc(ts[ts.length - 1].n) + ' · ' + ts.length + ' torres</span></div><div class="mt-grid pr-linha">' +
      ts.map(function (t) {
        var x = R.torres[t.n] || { situacao: 'incompleta', falta: [], origem: [] }, ti = noTramo[t.n];
        var sel = (selA && t.n === selA.n) || (selB && t.n === selB.n) ? ' pr-sel' : (selA && selB && t.op > Math.min(selA.op, selB.op) && t.op < Math.max(selA.op, selB.op) ? ' pr-sel2' : '');
        return tileSituacao(t, x, (ti != null ? ' pr-in' : '') + sel, 0.72, 'data-pc');
      }).join('') + '</div>';
  });
  return h + '</div>';
}
function cardTramo(f, R, tr, i) {
  var r = R.tramos[i], cfg = f.tramos.find(function (x) { return x.id === tr.id; }) || {}, idx = f.tramos.indexOf(cfg);
  var nome = cfg.nome || ('Tramo ' + (idx + 1)), ok = r.pronta + r.montada + r.pronta_transf;
  var pesoFalta = r.faltas.reduce(function (a, g) { var t = tipoById(g.tipoId), v = t && (t.volumes || []).find(function (x) { return x.id === g.componenteId; }); return a + (v ? Number(v.pesoKg || 0) * g.qtd : 0); }, 0);
  var bar = ['montada', 'pronta', 'pronta_transf', 'incompleta'].map(function (k) { return r.total ? '<i style="width:' + (100 * r[k] / r.total).toFixed(2) + '%;background:' + SIT_COR[k] + (k === 'incompleta' ? ';opacity:.45' : '') + '" title="' + SIT_ROT[k] + ': ' + r[k] + '"></i>' : ''; }).join('');
  var h = '<div class="card pr-card"><div class="pr-head"><span class="pr-ord">' + (idx + 1) + '</span><div style="flex:1;min-width:200px"><input class="pr-nome" data-pn="' + idx + '" value="' + esc(nome) + '"><div class="small muted">' + esc(cfg.de) + ' → ' + esc(cfg.ate) + ' · ' + nf(r.total) + ' torres</div></div>' +
    '<div class="toolbar"><button class="btn sm" data-pup="' + idx + '"' + (idx === 0 ? ' disabled' : '') + ' title="Subir prioridade">↑</button><button class="btn sm" data-pdn="' + idx + '"' + (idx === f.tramos.length - 1 ? ' disabled' : '') + ' title="Descer prioridade">↓</button><button class="btn sm danger" data-prm="' + idx + '">Remover</button></div></div>';
  h += '<div class="pr-kpis"><div><div class="big" style="font-size:26px">' + nf(ok) + '<span class="small muted"> / ' + nf(r.total) + '</span></div><div class="small muted">' + (r.total ? nf(100 * ok / r.total, 0) : 0) + '% com kit ou montadas</div></div>' +
    '<div><b style="color:' + SIT_COR.pronta + '">' + r.pronta + '</b> <span class="small">prontas</span></div>' + '<div><b style="color:' + SIT_COR.pronta_transf + '">' + r.pronta_transf + '</b> <span class="small">fecham remanejando</span></div>' +
    '<div><b>' + r.montada + '</b> <span class="small">montadas</span></div><div><b style="color:' + SIT_COR.incompleta + '">' + r.incompleta + '</b> <span class="small">incompletas</span>' + (r.quase ? ' <span class="tag warn">' + r.quase + ' falta ≤ 2 vol.</span>' : '') + '</div>' +
    '<div class="small">Maior trecho contínuo pronto: <b>' + (r.maiorSeq ? r.maiorSeq + ' torres</b> (' + esc(r.seqDe) + ' → ' + esc(r.seqAte) + ')' : 'nenhum</b>') + '</div></div>' +
    '<div class="mt-bar" style="margin:10px 0 12px">' + bar + '</div>';
  // torres do tramo (miniaturas)
  h += '<div class="mt-grid">' + r.torres.map(function (n) { return tileSituacao(torreByN(n), R.torres[n], '', 1, 'data-n'); }).join('') + '</div>';
  // o que falta + transferências
  var trs = R.transferencias.filter(function (t) { return t.tramos.indexOf(i) >= 0; });
  h += '<div class="grid2" style="margin-top:14px"><div><h3 class="pr-h3">O que falta para fechar o tramo' + (pesoFalta ? ' <span class="muted" style="font-weight:400">· ' + nf(pesoFalta / 1000, 2) + ' t</span>' : '') + '</h3>' +
    (r.faltas.length ? '<div class="tw" style="max-height:280px"><table><thead><tr><th>Tipo</th><th>Volume</th><th class="n">Qtd.</th><th class="n">Torres travadas</th></tr></thead><tbody>' +
      r.faltas.slice(0, 40).map(function (g) { return '<tr><td>' + esc(g.tipoId) + '</td><td>' + esc(compNome(g.tipoId, g.componenteId)) + '</td><td class="n"><b>' + nf(g.qtd) + '</b></td><td class="n">' + g.torres + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="small muted" style="margin:6px 0 0">Já considerando o que dá para remanejar de outros canteiros: é o que precisa vir do fornecedor.</p>'
      : '<div class="banner info" style="margin:0">Nada falta: todas as torres do tramo têm kit.</div>') + '</div>' +
    '<div><h3 class="pr-h3">Transferências para este tramo</h3>' + (trs.length ? trs.map(function (t) {
      var tp = tipoById(t.tipoId), qt = t.itens.reduce(function (a, x) { return a + x.qtd; }, 0);
      return '<div class="sugg" style="margin-bottom:8px"><div style="flex:1;min-width:200px"><div class="flow"><b>' + esc(cantNome(t.origemId)) + '</b><span class="arrow">→</span><b>' + esc(cantNome(t.destinoId)) + '</b><span class="tag">' + esc(t.tipoId) + '</span><span class="tag">' + nf(qt) + ' vol.</span>' + (tp ? '<span class="tag">' + nf(C.pesoItens(tp, t.itens) / 1000, 2) + ' t</span>' : '') + '</div><div class="small" style="margin-top:4px">Torres: <b class="mono">' + t.torres.map(esc).join(', ') + '</b></div><div style="margin-top:4px">' + itensResumo(t.tipoId, t.itens, 12) + '</div></div></div>';
    }).join('') + (podeGravar() ? '<button class="btn sm pri" data-pgt="' + i + '">Gerar solicitações de transferência deste tramo</button>' : '')
      : '<p class="small muted" style="margin:0">Nenhuma transferência necessária.</p>') + '</div></div>';
  return h + '</div>';
}
function ondeAtacar(B) {
  var janela = 10, sug = [];
  var porC = {}; S.torres.forEach(function (t) { (porC[t.c] = porC[t.c] || []).push(t); });
  Object.keys(porC).forEach(function (cid) {
    var ts = porC[cid].sort(function (a, b) { return a.op - b.op; });
    for (var i = 0; i + janela <= ts.length; i++) {
      var w = ts.slice(i, i + janela), ok = 0, quase = 0, mont = 0;
      w.forEach(function (t) { var x = B.torres[t.n]; if (!x) return; if (x.situacao !== 'incompleta') { ok++; if (x.situacao === 'montada') mont++; } else if (x.falta.reduce(function (a, f) { return a + f.qtd; }, 0) <= 2) quase++; });
      sug.push({ c: cid, de: w[0].n, ate: w[w.length - 1].n, ok: ok, quase: quase, mont: mont, score: ok * 10 + quase * 4 });
    }
  });
  sug.sort(function (a, b) { return b.score - a.score; });
  var esc2 = [], usados = {};
  sug.forEach(function (s) { if (esc2.length >= 8) return; var k = s.c + Math.floor(S.torres.find(function (t) { return t.n === s.de; }).op / janela); if (usados[k]) return; usados[k] = 1; esc2.push(s); });
  return '<div class="card"><h2>Onde atacar <span class="sub">trechos de ' + janela + ' torres seguidas com mais torres prontas ou quase prontas hoje</span></h2><div class="tw"><table><thead><tr><th>Canteiro</th><th>Trecho</th><th class="n">Prontas</th><th class="n">Faltam ≤ 2 vol.</th><th></th></tr></thead><tbody>' +
    esc2.map(function (s, i) { return '<tr><td>' + esc(cantNome(s.c)) + '</td><td class="mono"><b>' + esc(s.de) + ' → ' + esc(s.ate) + '</b></td><td class="n">' + s.ok + ' / ' + janela + '</td><td class="n">' + (s.quase ? '<span class="tag warn">' + s.quase + '</span>' : '<span class="zero">0</span>') + '</td><td><button class="btn sm" data-pss="' + esc(s.de) + '|' + esc(s.ate) + '">Priorizar este trecho</button></td></tr>'; }).join('') +
    '</tbody></table></div><p class="small muted" style="margin:8px 0 0">Ponto de partida para escolher os tramos. Você também pode definir qualquer trecho no formulário acima.</p></div>';
}
V.prioridade_bind = function () {
  var f = F.prio;
  var rs = $('#pResto'); if (rs) rs.onchange = function () { f.resto = rs.value === '1'; mudouPrio(); };
  var de = $('#pDe'), ate = $('#pAte');
  if (de) de.oninput = function () { f.novoDe = de.value; }; if (ate) ate.oninput = function () { f.novoAte = ate.value; };
  $$('[data-pc]').forEach(function (c) { c.onclick = function () { var n = c.getAttribute('data-pc'); if (!f.novoDe || f.novoAte) { f.novoDe = n; f.novoAte = ''; } else f.novoAte = n; render(); var nm = $('#pNome'); if (nm) nm.focus(); }; });
  var add = $('#pAdd');
  if (add) add.onclick = function () {
    var a = torreByN((de.value || '').trim()), b = torreByN((ate.value || '').trim());
    if (!a || !b) return toast('Informe torres que existam na LC (ex.: ' + S.torres[0].n + ').', true);
    if (a.op > b.op) { var x = a; a = b; b = x; }
    f.tramos.push({ id: newId('tr'), nome: ($('#pNome').value || '').trim() || 'Tramo ' + (f.tramos.length + 1), de: a.n, ate: b.n });
    f.novoDe = f.novoAte = ''; f.novoTipos = []; mudouPrio();
  };
  $$('[data-pss]').forEach(function (b) { b.onclick = function () { var p = b.getAttribute('data-pss').split('|'); f.tramos.push({ id: newId('tr'), nome: 'Trecho ' + p[0] + ' – ' + p[1], de: p[0], ate: p[1], tipos: [] }); mudouPrio(); }; });
  $$('[data-prm]').forEach(function (b) { b.onclick = function () { f.tramos.splice(+b.getAttribute('data-prm'), 1); mudouPrio(); }; });
  $$('[data-pup]').forEach(function (b) { b.onclick = function () { var i = +b.getAttribute('data-pup'); if (i > 0) { var x = f.tramos[i]; f.tramos[i] = f.tramos[i - 1]; f.tramos[i - 1] = x; mudouPrio(); } }; });
  $$('[data-pdn]').forEach(function (b) { b.onclick = function () { var i = +b.getAttribute('data-pdn'); if (i < f.tramos.length - 1) { var x = f.tramos[i]; f.tramos[i] = f.tramos[i + 1]; f.tramos[i + 1] = x; mudouPrio(); } }; });
  $$('[data-pn]').forEach(function (inp) { inp.onchange = function () { f.tramos[+inp.getAttribute('data-pn')].nome = inp.value.trim(); prioSalvar(); }; });
  $$('.mt-tile[data-n]').forEach(function (b) { b.onclick = function () { modalKit(b.getAttribute('data-n')); }; });
  $$('[data-pgt]').forEach(function (b) {
    b.onclick = async function () {
      var i = +b.getAttribute('data-pgt'), R = calcPrio().r, trs = R.transferencias.filter(function (t) { return t.tramos.indexOf(i) >= 0; }), n = 0, erros = [];
      var nome = (f.tramos[i] || {}).nome || ('Tramo ' + (i + 1));
      b.disabled = true;
      for (var k = 0; k < trs.length; k++) {
        var t = trs[k];
        try { await criarTransferencia({ origemId: t.origemId, destinoId: t.destinoId, tipoId: t.tipoId, itens: t.itens, torres: t.torres, obs: 'Prioridade: ' + nome + ' · torres ' + t.torres.join(', ') }); n++; }
        catch (e) { erros.push(cantNome(t.origemId) + ' → ' + cantNome(t.destinoId) + ' (' + t.tipoId + '): ' + errMsg(e)); }
      }
      if (n) toast(n + ' solicitação(ões) criada(s) para ' + nome + '. Acompanhe em Transferências.');
      if (erros.length) toast(erros.join(' | '), true);
      b.disabled = false;
    };
  });
};

// ===== CANTEIROS =====
V.canteiros = function () {
  var h = head('Canteiros', 'Canteiros que recebem e guardam as estruturas.', podeCadastrar() ? '<button class="btn pri" id="novoCant">+ Novo canteiro</button>' : '');
  if (!S.canteiros.length) return h + '<div class="card empty"><b>Nenhum canteiro cadastrado</b>Use <a href="#importar">Importar projeto</a> ou cadastre manualmente.</div>' + configObra();
  h += '<div class="card"><div class="tw"><table><thead><tr><th>Canteiro</th><th>Sigla</th><th>Local</th><th>Trecho</th><th>Responsável</th><th class="n">Torres no projeto</th><th>Situação</th><th></th></tr></thead><tbody>' +
    cantsOrd(false).map(function (c) {
      var n = S.torres.filter(function (t) { return t.c === c.id; }).length;
      return '<tr><td><b>' + esc(c.nome) + '</b></td><td>' + esc(c.sigla || '') + '</td><td>' + esc(c.local || '') + '</td><td class="small">' + esc(c.trecho || '') + '</td><td>' + esc(c.responsavel || '') + '</td><td class="n">' + cell(n) + '</td><td>' + (c.ativo === false ? '<span class="tag">inativo</span>' : '<span class="tag ok">ativo</span>') + '</td>' +
        '<td>' + (podeCadastrar() ? '<button class="btn sm" data-ec="' + esc(c.id) + '">Editar</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
  return h + configObra();
};
function configObra() {
  if (!podeCadastrar()) return '';
  return '<div class="card"><h2>Obra</h2><div class="row"><div class="field"><label>Nome da obra / LT (aparece no topo)</label><input id="cfgNome" value="' + esc(S.config.nomeObra || '') + '" placeholder="Ex.: LT 500 kV …"></div><div class="field"><label>Contratante (quem recebe as NFs da empreiteira)</label><input id="cfgContr" value="' + esc(S.config.nomeContratante || '') + '" placeholder="Ex.: nome da empresa contratante"></div><div class="field" style="flex:0 0 auto"><button class="btn" id="cfgSalvar">Salvar</button></div></div></div>';
}
V.canteiros_bind = function () {
  var n = $('#novoCant'); if (n) n.onclick = function () { formCanteiro(); };
  $$('[data-ec]').forEach(function (b) { b.onclick = function () { formCanteiro(b.getAttribute('data-ec')); }; });
  var s = $('#cfgSalvar'); if (s) s.onclick = async function () { try { var cfg = Object.assign({}, S.config); delete cfg.id; await Store.set('config', 'geral', Object.assign(cfg, { nomeObra: $('#cfgNome').value.trim(), nomeContratante: $('#cfgContr').value.trim() })); toast('Salvo'); } catch (e) { toast(errMsg(e), true); } };
};
function formCanteiro(id) {
  var c = id ? cantById(id) : { ativo: true };
  var temMov = id && (S.movimentos.some(function (m) { return m.canteiroId === id; }) || S.torres.some(function (t) { return t.c === id; }));
  var body = '<div class="row"><div class="field"><label>Nome</label><input id="cN" value="' + esc(c.nome || '') + '"></div><div class="field" style="flex:0 1 100px"><label>Sigla</label><input id="cS" value="' + esc(c.sigla || '') + '"></div><div class="field"><label>Local / cidade</label><input id="cL" value="' + esc(c.local || '') + '"></div></div>' +
    '<div class="row"><div class="field"><label>Trecho da obra</label><input id="cTr" value="' + esc(c.trecho || '') + '"></div><div class="field"><label>Responsável</label><input id="cR" value="' + esc(c.responsavel || '') + '"></div><div class="field" style="flex:0 0 auto"><label><input type="checkbox" id="cA"' + (c.ativo !== false ? ' checked' : '') + '> Ativo</label></div></div>' +
    (id ? '<div style="border-top:1px solid var(--line);padding-top:12px">' + (temMov ? '<span class="small muted">Este canteiro tem histórico ou torres do projeto e não pode ser excluído (desmarque "Ativo" para ocultá-lo).</span>' : '<button class="btn sm danger" id="cDel" type="button">Excluir canteiro</button>') + '</div>' : '');
  modal(id ? 'Editar canteiro' : 'Novo canteiro', body, {
    ok: 'Salvar',
    onOpen: function (m) {
      var d = $('#cDel', m);
      if (d) d.onclick = async function () {
        if (S.transferencias.some(function (t) { return t.origemId === id || t.destinoId === id; })) return showErrs(['Há transferências ligadas a este canteiro.']);
        try { await Store.del('canteiros', id); closeModal(); toast('Canteiro excluído'); } catch (e) { showErrs([errMsg(e)]); }
      };
    },
    onOk: async function (m) {
      var nome = $('#cN', m).value.trim(), erros = [];
      if (!nome) erros.push('Informe o nome.');
      if (S.canteiros.some(function (x) { return x.id !== id && String(x.nome).toLowerCase() === nome.toLowerCase(); })) erros.push('Já existe um canteiro com esse nome.');
      var ativo = $('#cA', m).checked;
      if (id && !ativo && S.transferencias.some(function (t) { return (t.origemId === id || t.destinoId === id) && (t.status === 'SOLICITADA' || t.status === 'EM_TRANSITO'); })) erros.push('Há transferências abertas com este canteiro; conclua-as antes de inativar.');
      if (erros.length) throw Falha(erros);
      await Store.set('canteiros', id || newId('c'), { nome: nome, sigla: $('#cS', m).value.trim(), local: $('#cL', m).value.trim(), trecho: $('#cTr', m).value.trim(), responsavel: $('#cR', m).value.trim(), ativo: ativo, criadoEm: c.criadoEm || new Date().toISOString() });
      toast('Canteiro salvo');
    }
  });
}

// ===== TIPOS DE TORRE =====
function regraTxt(t) {
  var r = t.regra || {};
  if (r.modo === 'estaiada') return 'Estaiada: ' + (r.fixos || []).join(' + ') + ' + extensões de ' + C.fmt(r.modulo || 6) + ' m (e uma de 1,5/3/4,5 m) até a altura (base ' + C.fmt(r.alturaBase || 0) + ' m) + ' + (r.stubs || 0) + ' stubs';
  return 'Autoportante: ' + (r.fixos || ['TB']).join(' + ') + ' + extensão da torre + 1 perna por pé (A/B/C/D, cada uma na sua altura) + ' + (r.stubs || 0) + ' stubs';
}
V.tipos = function () {
  var h = head('Tipos de torre', 'Catálogo de volumes de cada tipo e a regra que monta o kit de cada torre a partir da lista de construção.', podeCadastrar() ? '<button class="btn" id="novoTipo">+ Novo tipo</button>' : '');
  if (!S.tipos.length) return h + '<div class="card empty"><b>Nenhum tipo de torre cadastrado</b>Use <a href="#importar">Importar projeto</a> para carregar os 10 tipos com seus volumes.</div>';
  h += '<div class="card"><div class="tw"><table><thead><tr><th>Tipo</th><th>Estrutura</th><th>Regra do kit</th><th class="n">Volumes</th><th class="n">Torres</th><th></th></tr></thead><tbody>' +
    tiposOrd().map(function (t) {
      var gs = gruposOrdenados(t);
      return '<tr><td><b>' + esc(t.codigo) + '</b></td><td class="small">' + esc(t.estrutura || '') + (t.fixacao ? '<br>' + esc(t.fixacao) : '') + '</td><td class="small">' + esc(regraTxt(t)) +
        '<div class="chips" style="margin-top:4px">' + gs.map(function (g) { return '<span class="tag">' + esc(g.grupo) + ' <b class="mono">' + g.volumes.length + '</b></span>'; }).join('') + '</div></td>' +
        '<td class="n">' + nf((t.volumes || []).length) + '</td><td class="n">' + nf(torresDo(t.id).length) + '</td><td style="white-space:nowrap">' + (podeCadastrar() ? '<button class="btn sm" data-et="' + esc(t.id) + '">Editar</button>' : '<button class="btn sm" data-et="' + esc(t.id) + '">Ver</button>') + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
  return h;
};
V.tipos_bind = function () {
  var n = $('#novoTipo'); if (n) n.onclick = function () { formTipo(); };
  $$('[data-et]').forEach(function (b) { b.onclick = function () { formTipo(b.getAttribute('data-et')); }; });
};
function formTipo(id) {
  var t = id ? tipoById(id) : { codigo: '', estrutura: 'Autoportante', regra: { modo: 'autoportante', stubs: 4, fixos: ['TB'] }, volumes: [] };
  var vols = JSON.parse(JSON.stringify(t.volumes || [])), r = t.regra || {};
  var usados = {};
  if (id) S.movimentos.forEach(function (m) { if (m.tipoId === id) m.itens.forEach(function (i) { usados[i.componenteId] = 1; }); });
  var linhas = function () {
    return vols.map(function (v, i) {
      return '<tr><td><input data-vg="' + i + '" value="' + esc(v.grupo) + '" style="width:90px"></td><td><input data-vn="' + i + '" value="' + esc(v.nome) + '" style="width:100%"></td><td class="n"><input class="num" type="number" min="0" step="0.001" data-vp="' + i + '" value="' + esc(v.pesoKg == null ? '' : v.pesoKg) + '"></td>' +
        '<td>' + (usados[v.id] ? '<span class="small muted">em uso</span>' : '<button class="btn sm ghost danger" data-vr="' + i + '" type="button">✕</button>') + '</td></tr>';
    }).join('');
  };
  var body = '<div class="row"><div class="field" style="flex:0 1 120px"><label>Código</label><input id="tpC" value="' + esc(t.codigo || '') + '"' + (id ? ' disabled' : '') + '></div>' +
    '<div class="field"><label>Estrutura</label><select id="tpE"><option' + (t.estrutura === 'Autoportante' ? ' selected' : '') + '>Autoportante</option><option' + (t.estrutura === 'Estaiada' ? ' selected' : '') + '>Estaiada</option></select></div>' +
    '<div class="field"><label>Fixação</label><input id="tpF" value="' + esc(t.fixacao || '') + '" placeholder="Suspensão, Ancoragem…"></div>' +
    '<div class="field"><label>Fornecedor da estrutura</label><input id="tpFo" list="tpFoL" value="' + esc(t.fornecedor || '') + '" placeholder="Nome do fornecedor"><datalist id="tpFoL">' + listaFornecedores().map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</datalist></div></div>' +
    '<div class="row"><div class="field"><label>Grupos fixos por torre</label><input id="rFix" value="' + esc((r.fixos || ['TB']).join(', ')) + '"></div><div class="field" style="flex:0 1 110px"><label>Stubs/torre</label><input id="rStub" type="number" min="0" value="' + esc(r.stubs != null ? r.stubs : 4) + '"></div>' +
    '<div class="field" style="flex:0 1 130px"><label>Altura base (estaiada)</label><input id="rBase" type="number" step="0.5" value="' + esc(r.alturaBase || '') + '"></div><div class="field" style="flex:0 1 130px"><label>Módulo extensão (m)</label><input id="rMod" type="number" step="0.5" value="' + esc(r.modulo || 6) + '"></div></div>' +
    '<p class="small muted" style="margin:0">Grupos: TB (corpo), EXT6 / EXT12 … (extensão), PERNA4,5 … (uma por pé), AP/STB (stubs), PINO, CALOTA. O kit de cada torre junta 1 de cada volume dos grupos que ela usa.</p>' +
    '<div class="field"><label>Volumes (' + vols.length + ')</label><div class="tw" style="max-height:40vh"><table><thead><tr><th>Grupo</th><th>Volume</th><th class="n">Peso (kg)</th><th></th></tr></thead><tbody id="tpVols"></tbody></table></div><div><button class="btn sm" id="tpAdd" type="button" style="margin-top:8px">+ Volume</button></div></div>';
  modal(id ? 'Tipo ' + t.codigo : 'Novo tipo de torre', body, {
    ok: podeCadastrar() ? 'Salvar' : null,
    onOpen: function (m) {
      var sync = function () {
        $$('[data-vg]', m).forEach(function (i) { vols[+i.getAttribute('data-vg')].grupo = i.value.trim().toUpperCase(); });
        $$('[data-vn]', m).forEach(function (i) { vols[+i.getAttribute('data-vn')].nome = i.value; });
        $$('[data-vp]', m).forEach(function (i) { vols[+i.getAttribute('data-vp')].pesoKg = i.value === '' ? null : Number(i.value); });
      };
      var draw = function () { $('#tpVols', m).innerHTML = linhas(); $$('[data-vr]', m).forEach(function (b) { b.onclick = function () { sync(); vols.splice(+b.getAttribute('data-vr'), 1); draw(); }; }); };
      m._sync = sync; draw();
      $('#tpAdd', m).onclick = function () { sync(); vols.push({ id: newId('v'), grupo: 'TB', nome: '', pesoKg: null }); draw(); };
    },
    onOk: async function (m) {
      m._sync();
      var codigo = (id || $('#tpC', m).value.trim()).toUpperCase(), erros = [];
      if (!codigo) erros.push('Informe o código.');
      if (!id && S.tipos.some(function (x) { return x.id === codigo; })) erros.push('Já existe o tipo ' + codigo + '.');
      if (!/^[A-Za-z0-9_.~:@+-]+$/.test(codigo)) erros.push('Código só pode ter letras, números e - _ .');
      var nomes = {};
      vols.forEach(function (v) {
        v.nome = String(v.nome || '').trim();
        if (!v.nome || !v.grupo) erros.push('Há volume sem nome ou grupo.');
        var k = (v.grupo + '|' + v.nome).toUpperCase(); if (nomes[k]) erros.push('Volume repetido: ' + v.nome); nomes[k] = 1;
        if (v.pesoKg != null && (!isFinite(v.pesoKg) || v.pesoKg < 0)) erros.push(v.nome + ': peso inválido');
      });
      if (erros.length) throw Falha(erros.filter(function (e, i, a) { return a.indexOf(e) === i; }));
      var est = $('#tpE', m).value;
      var regra = { modo: est === 'Estaiada' ? 'estaiada' : 'autoportante', stubs: Number($('#rStub', m).value || 0), fixos: $('#rFix', m).value.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean) };
      if (regra.modo === 'estaiada') { regra.alturaBase = Number($('#rBase', m).value || 0); regra.modulo = Number($('#rMod', m).value || 6); }
      await Store.set('tipos', codigo, { codigo: codigo, estrutura: est, fixacao: $('#tpF', m).value.trim(), nome: [est, $('#tpF', m).value.trim()].filter(Boolean).join(' – '), regra: regra, fornecedor: ($('#tpFo', m).value || '').trim().toUpperCase(), volumes: vols });
      toast('Tipo salvo');
    }
  });
}

// ===== IMPORTAR PROJETO =====
V.importar = function () {
  var h = head('Importar projeto', 'Carrega tipos e volumes, a lista de construção e o histórico de estoque a partir das planilhas da obra.');
  var imp = S.imp || {};
  var nImp = S.movimentos.filter(function (m) { return /^(imp_|ts_imp_|te_imp_)/.test(m.id); }).length;
  h += '<div class="card"><h2>Situação atual</h2><div class="kpis" style="margin:0">' + kpi('Tipos de torre', nf(S.tipos.length), '') + kpi('Torres na LC', nf(S.torres.length), '') + kpi('Lançamentos', nf(S.movimentos.length), nf(nImp) + ' importados') + kpi('Canteiros', nf(S.canteiros.length), '') + '</div>' +
    (S.projeto && S.projeto.importadoEm ? '<p class="small muted" style="margin:10px 0 0">Última importação: ' + fdh(S.projeto.importadoEm) + ' · ' + esc((S.projeto.fontes || []).join(', ')) + '</p>' : '') + '</div>';
  if (S.tipos.length) h += blocoPlanilhaEstoque() + blocoImportarCtrlNF() + blocoImportarNFs() + blocoImportarTAP() + blocoZerar();
  if (!imp.dados) {
    return h + '<div class="card"><h2>Pacote de dados do projeto</h2><p style="margin-top:0">Arquivo <code>dados-projeto.json</code> gerado pelas ferramentas de importação a partir das planilhas da obra (tipos e volumes, lista de construção e histórico de estoque). Sem esse arquivo, o sistema carrega os <b>dados de demonstração</b> (fictícios).</p>' +
      '<button class="btn pri" id="impCarregar">' + (imp.carregando ? 'Carregando…' : 'Carregar e conferir o pacote') + '</button>' + (imp.erro ? '<div class="banner bad" style="margin-top:12px">' + esc(imp.erro) + '</div>' : '') + '</div>';
  }
  var D = imp.dados;
  var porNat = {}; D.movimentos.forEach(function (m) { porNat[m.natureza] = (porNat[m.natureza] || 0) + 1; });
  var aRemover = S.tipos.filter(function (t) { return !D.tipos.some(function (x) { return x.id === t.id; }) && !S.movimentos.some(function (m) { return m.tipoId === t.id; }) && !S.transferencias.some(function (x) { return x.tipoId === t.id; }); });
  h += '<div class="card"><h2>' + esc(D.obra) + '</h2><div class="kpis" style="margin:0 0 12px">' + kpi('Tipos / volumes', nf(D.tipos.length) + ' / ' + nf(D.tipos.reduce(function (a, t) { return a + t.volumes.length; }, 0)), D.tipos.map(function (t) { return t.id; }).join(', ')) +
    kpi('Torres (LC)', nf(D.torres.length), D.canteiros.map(function (c) { return c.nome + ' ' + D.torres.filter(function (t) { return t.c === c.id; }).length; }).join(' · ')) +
    kpi('Lançamentos', nf(D.movimentos.length), Object.keys(porNat).map(function (k) { return (C.NATUREZAS[k] || k) + ' ' + porNat[k]; }).join(' · ')) + kpi('Transferências', nf(D.transferencias.length), 'já recebidas') + '</div>' +
    (D.notaConciliacao ? '<div class="banner info">' + esc(D.notaConciliacao) + '</div>' : '') +
    (D.ignoradas.length ? '<details style="margin-bottom:12px"><summary class="small"><b>' + D.ignoradas.length + ' linhas da planilha não importadas</b> (sem descrição de volume ou volume fora do Resumo)</summary><div class="tw" style="max-height:220px;margin-top:8px"><table><tbody>' + D.ignoradas.map(function (x) { return '<tr>' + x.map(function (c) { return '<td class="small">' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>' : '') +
    (aRemover.length ? '<div class="banner warn">Os tipos sem movimentação que não fazem parte do projeto serão removidos: <b>' + aRemover.map(function (t) { return esc(t.codigo); }).join(', ') + '</b>.</div>' : '') +
    '<p class="small muted">Pode rodar de novo sem duplicar: cada lançamento tem identificador fixo e os já existentes são pulados.</p>';
  if (imp.rodando || imp.fim) {
    var pct = imp.total ? Math.round(100 * imp.feito / imp.total) : 0;
    h += '<div class="bar" style="height:10px;margin:8px 0"><i style="width:' + pct + '%"></i></div><div class="small">' + esc(imp.etapa || '') + ' · ' + nf(imp.feito) + ' de ' + nf(imp.total) + ' (' + pct + '%)</div>' +
      (imp.fim ? '<div class="banner ' + (imp.falhas ? 'warn' : 'info') + '" style="margin-top:12px">' + (imp.falhas ? 'Importação terminou com ' + imp.falhas + ' falha(s). Clique em importar de novo para tentar os que faltaram.' : 'Importação concluída. Veja o <a href="#painel">Painel</a> e as <a href="#torres">Torres do projeto</a>.') + '</div>' : '');
  }
  if (!imp.rodando) h += podeCadastrar() ? '<button class="btn pri" id="impRodar" style="margin-top:12px">' + (imp.fim ? 'Importar de novo (só o que falta)' : 'Importar agora') + '</button>' : '<div class="banner info">Somente o dono ou Editores podem importar.</div>';
  return h + '</div>';
};
V.importar_bind = function () {
  ligarPlanilhaEstoque();
  ligarImportarTAP();
  ligarImportarCtrlNF();
  ligarZerar();
  ligarImportarNFs();
  var c = $('#impCarregar');
  if (c) c.onclick = async function () {
    S.imp = { carregando: true }; render();
    try {
      var r = await fetch('dados-projeto.json', { cache: 'no-store' });
      if (!r.ok) r = await fetch('dados-demo.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      S.imp = { dados: await r.json() };
    } catch (e) { S.imp = { erro: 'Não consegui carregar o pacote de dados (' + (e.message || e) + ').' }; }
    render();
  };
  var b = $('#impRodar'); if (b) b.onclick = function () { importarProjeto(S.imp.dados); };
};
async function gravarComRetry(col, id, data) {
  for (var i = 0; i < 6; i++) {
    try { return await Store.set(col, id, data); }
    catch (e) { if (e && (e.code === 'resource_exhausted' || e.code === 'unavailable') && i < 5) { await sleep(1500 * (i + 1)); continue; } throw e; }
  }
}
async function importarProjeto(D) {
  var imp = S.imp; imp.rodando = true; imp.fim = false; imp.falhas = 0; imp.feito = 0;
  var exM = {}, exT = {}; S.movimentos.forEach(function (m) { exM[m.id] = 1; }); S.transferencias.forEach(function (t) { exT[t.id] = 1; });
  var remover = S.tipos.filter(function (t) { return !D.tipos.some(function (x) { return x.id === t.id; }) && !S.movimentos.some(function (m) { return m.tipoId === t.id; }) && !S.transferencias.some(function (x) { return x.tipoId === t.id; }); });
  var transf = D.transferencias.filter(function (t) { return !exT[t.id]; }), movs = D.movimentos.filter(function (m) { return !exM[m.id]; });
  imp.total = remover.length + D.canteiros.length + D.tipos.length + 3 + transf.length + movs.length;
  var passo = function (et) { imp.etapa = et; imp.feito++; if (imp.feito % 10 === 0 || imp.feito === imp.total) render(true); };
  var tentar = async function (et, fn) { try { await fn(); } catch (e) { imp.falhas++; console.error(et, e); } passo(et); };
  render(true);
  for (var i = 0; i < remover.length; i++) { var tr = remover[i]; await tentar('Removendo tipos modelo', function () { return Store.del('tipos', tr.id); }); }
  for (i = 0; i < D.canteiros.length; i++) {
    var c = D.canteiros[i], atual = cantById(c.id) || {};
    await tentar('Canteiros', function () { return gravarComRetry('canteiros', c.id, { nome: c.nome, sigla: c.sigla, local: c.local, trecho: c.trecho, responsavel: atual.responsavel || '', ativo: atual.ativo !== false, criadoEm: atual.criadoEm || new Date().toISOString() }); });
  }
  for (i = 0; i < D.tipos.length; i++) {
    var t = D.tipos[i], ex = tipoById(t.id), vols = t.volumes.slice();
    if (ex) (ex.volumes || []).forEach(function (v) { var j = vols.findIndex(function (x) { return x.id === v.id; }); if (j < 0) vols.push(v); else vols[j] = Object.assign({}, vols[j], { pesoKg: v.pesoKg != null ? v.pesoKg : vols[j].pesoKg, nome: v.nome || vols[j].nome }); });
    await tentar('Tipos de torre', function () { return gravarComRetry('tipos', t.id, { codigo: t.codigo, nome: t.nome, estrutura: t.estrutura, fixacao: t.fixacao, fornecedor: t.fornecedor || '', regra: t.regra, volumes: vols }); });
  }
  await tentar('Lista de construção', function () { return gravarComRetry('projeto', 'torres', { lista: D.torres, atualizadoEm: new Date().toISOString() }); });
  await tentar('Informações do projeto', function () { return gravarComRetry('projeto', 'info', { obra: D.obra, fontes: D.fontes, importadoEm: new Date().toISOString(), ignoradas: D.ignoradas.length }); });
  await tentar('Nome da obra', function () { return S.config.nomeObra ? Promise.resolve() : gravarComRetry('config', 'geral', { nomeObra: D.obra }); });
  for (i = 0; i < transf.length; i++) { var x = transf[i], dx = Object.assign({}, x); delete dx.id; await tentar('Transferências', function () { return gravarComRetry('transferencias', x.id, dx); }); }
  for (i = 0; i < movs.length; i++) { var mv = movs[i], dm = Object.assign({}, mv); delete dm.id; await tentar('Lançamentos do histórico', function () { return gravarComRetry('movimentos', mv.id, dm); }); }
  imp.rodando = false; imp.fim = true; imp.etapa = 'Concluído';
  render(true);
  toast(imp.falhas ? 'Importação com ' + imp.falhas + ' falha(s)' : 'Projeto importado', !!imp.falhas);
}

// ===== ATUALIZAR ESTOQUE PELA PLANILHA DA EMPREITEIRA =====
async function lerPlanilhaEstoqueArquivo(file) {
  var XLSX = await carregarXLSX();
  var wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true });
  var abas = {};
  wb.SheetNames.forEach(function (n) { if (/RESUMO ESTRUTURAS|LAN.AMENTO|TRANSFER|APLICA|^LC/i.test(n)) abas[n] = Sync.linhasAba(XLSX, wb.Sheets[n]); });
  var pac = Sync.lerPlanilhaEstoque(abas);
  var plano = Sync.planejar(pac, { movimentos: S.movimentos, transferencias: S.transferencias, tipos: S.tipos, torres: S.torres, canteiros: S.canteiros }, hoje());
  var datas = pac.movimentos.map(function (m) { return m.data; }).filter(Boolean).sort();
  return { arquivo: file.name, pac: pac, plano: plano, ultimoMov: datas[datas.length - 1] || '' };
}
function resumoSaldoPlano(pl) {
  var g = {}, peso = {};
  S.tipos.forEach(function (t) { (t.volumes || []).forEach(function (v) { peso[t.id + '|' + v.id] = v.pesoKg || 0; }); });
  (pl.tiposSet || []).forEach(function (x) { (x.data.volumes || []).forEach(function (v) { peso[x.id + '|' + v.id] = v.pesoKg || 0; }); });
  var ks = {}; Object.keys(pl.antes).concat(Object.keys(pl.depois)).forEach(function (k) { ks[k] = 1; });
  Object.keys(ks).forEach(function (k) {
    var d = (pl.depois[k] || 0) - (pl.antes[k] || 0); if (!d) return;
    var p = k.split('|'), gk = p[0] + '|' + p[1], x = g[gk] || (g[gk] = { c: p[0], t: p[1], mais: 0, menos: 0, kg: 0, vols: 0 });
    if (d > 0) x.mais += d; else x.menos -= d; x.kg += d * (peso[p[1] + '|' + p[2]] || 0); x.vols++;
  });
  return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return a.c < b.c ? -1 : a.c > b.c ? 1 : a.t < b.t ? -1 : 1; });
}
function blocoPlanilhaEstoque() {
  var st = S.impEst || {}, pe = (S.projeto && S.projeto.planilhaEstoque) || {};
  var h = '<div class="card"><h2>Atualizar estoque pela planilha da empreiteira <span class="sub">modelo “Resumo de Estruturas” · pode enviar toda semana</span></h2>';
  h += '<p style="margin-top:0" class="small">Escolha a planilha de controle de estoque que a empreiteira envia (abas RESUMO ESTRUTURAS, LANÇAMENTO, TRANSFERENCIA, APLICAÇÃO e LC). O sistema compara com o que já está gravado e mostra o que muda antes de gravar: recebimentos novos, linhas corrigidas ou apagadas na planilha e a diferença de saldo por canteiro. Linhas já importadas não duplicam. ' +
    'No fim, o saldo de cada volume fica igual à coluna <b>ESTOQUE</b> do resumo da planilha.</p>' +
    (pe.em ? '<p class="small muted">Última atualização: <b>' + esc(pe.arquivo || '') + '</b> em ' + fdh(pe.em) + (pe.ultimoMov ? ' · lançamentos até ' + fdata(pe.ultimoMov) : '') + '</p>' : '');
  if (!podeCadastrar()) return h + '<div class="banner info">Somente o dono ou Editores podem atualizar o estoque.</div></div>';
  if (!st.rodando) h += '<label class="btn' + (st.pacote ? '' : ' pri') + '"' + (st.lendo ? ' style="opacity:.5;pointer-events:none"' : '') + '>' + (st.pacote ? 'Escolher outra planilha…' : 'Escolher planilha de estoque…') + '<input type="file" id="estArq" accept=".xlsx,.xlsm" hidden></label>';
  if (st.lendo) h += ' <span class="small muted">Lendo e comparando…</span>';
  if (st.erro) h += '<div class="banner bad" style="margin-top:12px">' + esc(st.erro) + '</div>';
  if (st.fim) h += '<div class="banner ' + (st.falhas ? 'warn' : 'info') + '" style="margin-top:12px">' + (st.falhas ? 'Terminou com ' + st.falhas + ' falha(s). Envie a planilha de novo para gravar o que faltou.' : 'Estoque atualizado com <b>' + esc(st.fim) + '</b>. Veja o <a href="#painel">Painel</a>, o <a href="#estoque">Estoque</a> e as <a href="#torres">Torres do projeto</a>.') + '</div>';
  if (!st.pacote) return h + '</div>';
  var P = st.pacote, pl = P.plano;
  if (st.rodando) {
    var pct = st.total ? Math.round(100 * st.feito / st.total) : 0;
    return h + '<div class="bar" style="height:10px;margin:8px 0"><i style="width:' + pct + '%"></i></div><div class="small">' + esc(st.etapa || '') + ' · ' + nf(st.feito) + ' de ' + nf(st.total) + ' (' + pct + '%)</div></div>';
  }
  h += '<div class="banner info" style="margin-top:12px"><b>' + esc(P.arquivo) + '</b> · ' + nf(P.pac.movimentos.length) + ' lançamentos na planilha' + (P.ultimoMov ? ', o mais recente em ' + fdata(P.ultimoMov) : '') + '.</div>';
  if (pl.vazio && (S.nfeMeta || {}).total === (P.pac.nfsEmp || []).length) return h + '<div class="banner info">Nada mudou: o sistema já está igual a esta planilha.</div></div>';
  if (pl.vazio) return h + '<div class="banner info">O estoque já está igual a esta planilha; falta só guardar as ' + nf((P.pac.nfsEmp || []).length) + ' notas fiscais da empreiteira para o Controle de NFs.</div><div style="margin-top:14px"><button class="btn pri" id="estGravar">Guardar notas</button> <button class="btn" id="estCancelar">Cancelar</button></div></div>';
  var porNat = function (lista) { var c = {}; lista.forEach(function (m) { c[m.natureza] = (c[m.natureza] || 0) + 1; }); return Object.keys(c).map(function (k) { return (C.NATUREZAS[k] || k) + ' ' + c[k]; }).join(' · ') || '—'; };
  var novosR = pl.novos.filter(function (m) { return m.natureza !== 'AJUSTE'; }), dn = novosR.map(function (m) { return m.data; }).filter(Boolean).sort();
  h += '<div class="kpis" style="margin:12px 0">' +
    kpi('Lançamentos novos', nf(novosR.length), (dn.length ? fdata(dn[0]) + (dn.length > 1 ? ' a ' + fdata(dn[dn.length - 1]) : '') + ' · ' : '') + porNat(novosR)) +
    kpi('Corrigidos na planilha', nf(pl.alterados.filter(function (m) { return m.natureza !== 'AJUSTE'; }).length), 'linhas que mudaram desde a última vez') +
    kpi('Apagados na planilha', nf(pl.removidos.length), pl.removidos.length ? porNat(pl.removidos) : 'nenhum') +
    kpi('Ajustes de conciliação', nf(pl.ajustes), 'para o saldo bater com a coluna ESTOQUE') + '</div>' +
    (pl.reidentificados ? '<p class="small muted" style="margin:-4px 0 10px">' + nf(pl.reidentificados) + ' lançamento(s) já existentes só trocam de identificador (sem efeito no saldo).</p>' : '');
  var avisos = [];
  if (pl.absorvidos) avisos.push(nf(pl.absorvidos) + ' recebimento(s) de cargas previstas, lançados aqui no sistema, agora também estão na planilha (mesmo romaneio): vão ser trocados pela linha da planilha, sem contar duas vezes.');
  if (pl.nativos) avisos.push('Há <b>' + nf(pl.nativos) + ' lançamento(s) feitos aqui no sistema</b> (fora da planilha). Eles continuam no histórico, e o ajuste de conciliação compensa a diferença para que o saldo fique igual ao da planilha.');
  if (pl.torresMudou) avisos.push('A lista de construção mudou: ' + pl.torresDiff.novas + ' torre(s) nova(s), ' + pl.torresDiff.alteradas + ' alterada(s), ' + pl.torresDiff.removidas + ' removida(s).');
  pl.tiposSet.forEach(function (x) { avisos.push(x.novo ? 'Tipo novo <b>' + esc(x.id) + '</b> com ' + x.volNovos + ' volumes (cadastrado como autoportante: confira a regra de montagem em Tipos de torre).' : 'Tipo ' + esc(x.id) + ': ' + (x.volNovos ? x.volNovos + ' volume(s) novo(s)' : '') + (x.volNovos && x.pesos ? ', ' : '') + (x.pesos ? x.pesos + ' peso(s) atualizado(s)' : '') + '.'); });
  if (pl.cantNovos.length) avisos.push('Canteiro(s) novo(s): ' + pl.cantNovos.map(function (c) { return esc(c.nome); }).join(', ') + '.');
  if (avisos.length) h += '<div class="banner warn">' + avisos.join('<br>') + '</div>';
  var R = resumoSaldoPlano(pl);
  if (R.length) {
    var tk = R.reduce(function (a, r) { return a + r.kg; }, 0);
    h += '<h3 style="margin:14px 0 6px;font-size:14px">Como o saldo muda</h3><div class="tw"><table><thead><tr><th>Canteiro</th><th>Tipo</th><th class="num">Volumes a mais</th><th class="num">Volumes a menos</th><th class="num">Peso (t)</th></tr></thead><tbody>' +
      R.map(function (r) { return '<tr><td>' + esc(cantNome(r.c)) + '</td><td><b>' + esc(r.t) + '</b></td><td class="num">' + (r.mais ? '+' + nf(r.mais) : '') + '</td><td class="num">' + (r.menos ? '−' + nf(r.menos) : '') + '</td><td class="num">' + (r.kg >= 0 ? '+' : '−') + nf(Math.abs(r.kg) / 1000, 1) + '</td></tr>'; }).join('') +
      '<tr><td colspan="4"><b>Total</b></td><td class="num"><b>' + (tk >= 0 ? '+' : '−') + nf(Math.abs(tk) / 1000, 1) + '</b></td></tr></tbody></table></div>';
  }
  if (novosR.length) h += '<details style="margin-top:10px"><summary class="small"><b>Ver os ' + nf(novosR.length) + ' lançamentos novos</b></summary><div class="tw" style="max-height:260px;margin-top:8px"><table><thead><tr><th>Data</th><th>Natureza</th><th>Canteiro</th><th>Tipo</th><th>Documento</th><th class="num">Volumes</th></tr></thead><tbody>' +
    novosR.slice().sort(function (a, b) { return (b.data || '') < (a.data || '') ? -1 : 1; }).map(function (m) { return '<tr><td>' + fdata(m.data) + '</td><td>' + esc(C.NATUREZAS[m.natureza] || m.natureza) + '</td><td>' + esc(cantNome(m.canteiroId) === '(canteiro removido)' ? m.canteiroId : cantNome(m.canteiroId)) + '</td><td>' + esc(m.tipoId) + '</td><td class="small">' + esc(m.documento || m.numeroTorre || '') + '</td><td class="num">' + nf(m.itens.reduce(function (a, i) { return a + Math.abs(i.qtd); }, 0)) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
  if (P.pac.ignoradas.length) h += '<details style="margin-top:6px"><summary class="small">' + nf(P.pac.ignoradas.length) + ' linha(s) da planilha sem volume correspondente no resumo (entram só pelo ajuste de conciliação)</summary><div class="tw" style="max-height:200px;margin-top:8px"><table><tbody>' + P.pac.ignoradas.map(function (x) { return '<tr>' + x.map(function (c) { return '<td class="small">' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
  return h + '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn pri" id="estGravar">Atualizar estoque</button><button class="btn" id="estCancelar">Cancelar</button></div></div>';
}
function ligarPlanilhaEstoque() {
  var a = $('#estArq');
  if (a) a.onchange = async function () {
    var file = a.files && a.files[0]; if (!file) return;
    S.impEst = { lendo: true }; render(true);
    try { S.impEst = { pacote: await lerPlanilhaEstoqueArquivo(file) }; }
    catch (e) { console.error(e); S.impEst = { erro: 'Não consegui ler a planilha: ' + (e.message || e) }; }
    render(true);
  };
  var c = $('#estCancelar'); if (c) c.onclick = function () { S.impEst = {}; render(true); };
  var g = $('#estGravar'); if (g) g.onclick = function () { gravarPlanilhaEstoque(S.impEst.pacote); };
}
async function gravarPlanilhaEstoque(P) {
  var st = S.impEst, pl = P.plano;
  st.rodando = true; st.falhas = 0; st.feito = 0;
  st.total = Math.ceil((P.pac.nfsEmp || []).length / 250) + 1 + pl.cantNovos.length + pl.tiposSet.length + (pl.torresMudou ? 1 : 0) + pl.trSet.length + pl.movSet.length + pl.movDel.length + pl.trDel.length + 1;
  var passo = function (et) { st.etapa = et; st.feito++; if (st.feito % 10 === 0 || st.feito === st.total) render(true); };
  var tentar = async function (et, fn) { try { await fn(); } catch (e) { st.falhas++; console.error(et, e); } passo(et); };
  render(true);
  var i;
  for (i = 0; i < pl.cantNovos.length; i++) { var c = pl.cantNovos[i]; await tentar('Canteiros', function () { return gravarComRetry('canteiros', c.id, { nome: c.nome, sigla: c.sigla, local: '', trecho: '', responsavel: '', ativo: true, criadoEm: new Date().toISOString() }); }); }
  for (i = 0; i < pl.tiposSet.length; i++) { var t = pl.tiposSet[i]; await tentar('Tipos e volumes', function () { return gravarComRetry('tipos', t.id, t.data); }); }
  if (pl.torresMudou) await tentar('Lista de construção', function () { return gravarComRetry('projeto', 'torres', { lista: P.pac.torres, atualizadoEm: new Date().toISOString() }); });
  for (i = 0; i < pl.trSet.length; i++) { var x = pl.trSet[i]; await tentar('Transferências', function () { return gravarComRetry('transferencias', x.id, x.data); }); }
  for (i = 0; i < pl.movSet.length; i++) { var m = pl.movSet[i]; await tentar('Lançamentos', function () { return gravarComRetry('movimentos', m.id, m.data); }); }
  for (i = 0; i < pl.movDel.length; i++) { var d = pl.movDel[i]; await tentar('Removendo linhas apagadas na planilha', function () { return Store.del('movimentos', d); }); }
  for (i = 0; i < pl.trDel.length; i++) { var dt = pl.trDel[i]; await tentar('Removendo transferências apagadas', function () { return Store.del('transferencias', dt); }); }
  var partesE = []; for (var pe = 0; pe < (P.pac.nfsEmp || []).length; pe += 250) partesE.push(P.pac.nfsEmp.slice(pe, pe + 250));
  for (i = 0; i < partesE.length; i++) { var lst = partesE[i], idx = i; await tentar('Notas da empreiteira', function () { return gravarComRetry('projeto', 'nfe_' + idx, { lista: lst }); }); }
  await tentar('Notas da empreiteira', function () { return gravarComRetry('projeto', 'nfe_meta', { partes: partesE.length, total: (P.pac.nfsEmp || []).length, arquivo: P.arquivo, em: new Date().toISOString() }); });
  await tentar('Registro da atualização', function () {
    var info = Object.assign({}, S.projeto || {}); delete info.id;
    info.planilhaEstoque = { arquivo: P.arquivo, em: new Date().toISOString(), ultimoMov: P.ultimoMov, novos: pl.novos.length, alterados: pl.alterados.length, removidos: pl.removidos.length, por: S.uid || '' };
    return gravarComRetry('projeto', 'info', info);
  });
  S.impEst = { fim: P.arquivo, falhas: st.falhas };
  render(true);
  toast(st.falhas ? 'Atualização com ' + st.falhas + ' falha(s)' : 'Estoque atualizado', !!st.falhas);
}

// ===================== CARGAS A CHEGAR (notas e romaneios previstos) =====================
function cargasPrevistas() { return (S.cargas || []).filter(function (c) { return c.status === 'PREVISTA'; }).sort(function (a, b) { return String(a.previsao || '9999').localeCompare(String(b.previsao || '9999')) || String(a.criadoEm).localeCompare(String(b.criadoEm)); }); }
function pesoItensCarga(itens) {
  return (itens || []).reduce(function (a, i) { var t = tipoById(i.tipoId), v = t && (t.volumes || []).find(function (x) { return x.id === i.componenteId; }); return a + Number(i.qtd || 0) * Number((v && v.pesoKg) || 0); }, 0);
}
function pesoCarga(c) { return c.itens && c.itens.length ? pesoItensCarga(c.itens) : Number(c.pesoNFKg || 0); }
function volsCarga(itens) { return (itens || []).reduce(function (a, i) { return a + Number(i.qtd || 0); }, 0); }
function porTipoCarga(itens) {
  var g = {}, ord = [];
  (itens || []).forEach(function (i) { if (!g[i.tipoId]) { g[i.tipoId] = []; ord.push(i.tipoId); } g[i.tipoId].push(i); });
  return ord.map(function (t) { return { tipoId: t, itens: g[t] }; });
}
// Torres que passam a ter kit completo no próprio canteiro quando as cargas chegarem
function impactoCargas(lista) {
  var m = M(); m.cg = m.cg || {};
  var k = lista.map(function (c) { return c.id + ':' + (c.atualizadoEm || c.criadoEm || ''); }).join(',');
  if (m.cg[k]) return m.cg[k];
  var sal = new Map(S.d.saldos), tipos = {};
  lista.forEach(function (c) { (c.itens || []).forEach(function (i) { var kk = c.canteiroId + '|' + i.tipoId + '|' + i.componenteId; sal.set(kk, (sal.get(kk) || 0) + Number(i.qtd || 0)); tipos[i.tipoId] = 1; }); });
  var r = { total: 0, porTipo: [] };
  Object.keys(tipos).sort().forEach(function (tid) {
    var t = tipoById(tid); if (!t) return;
    var base = aloc(tid), com = C.alocarTipo(t, torresDo(tid), cantsOrd(true), sal, S.d.reservas, aplicado());
    var pronta = function (a, n) { var x = a.torres[n]; return x && x.status !== 'montada' && x.kitDisponivel; };
    var novas = torresDo(tid).filter(function (tw) { return pronta(com, tw.n) && !pronta(base, tw.n); }).map(function (tw) { return tw; });
    var antes = torresDo(tid).filter(function (tw) { return pronta(base, tw.n); }).length, depois = torresDo(tid).filter(function (tw) { return pronta(com, tw.n); }).length;
    var porC = {}; torresDo(tid).forEach(function (tw) { var x = porC[tw.c] = porC[tw.c] || { antes: 0, depois: 0, novas: [] }; if (pronta(base, tw.n)) x.antes++; if (pronta(com, tw.n)) x.depois++; if (pronta(com, tw.n) && !pronta(base, tw.n)) x.novas.push(tw.n); });
    r.total += Math.max(0, depois - antes); r.antes = (r.antes || 0) + antes; r.depois = (r.depois || 0) + depois;
    r.porTipo.push({ tipoId: tid, antes: antes, depois: depois, novas: novas, porC: porC });
  });
  m.cg[k] = r; return r;
}
function resumoTiposCarga(itens) {
  return porTipoCarga(itens).map(function (g) { return '<b>' + esc(tipoCod(g.tipoId)) + '</b> ' + nf(volsCarga(g.itens)) + ' vol.'; }).join(' · ');
}
function faixaCargasPainel() {
  var L = cargasPrevistas(); if (!L.length) return '';
  var p = L.reduce(function (a, c) { return a + pesoCarga(c); }, 0), imp = impactoCargas(L), h0 = hoje();
  var atras = L.filter(function (c) { return c.previsao && c.previsao < h0; }).length, prox = L.find(function (c) { return c.previsao && c.previsao >= h0; });
  return '<div class="banner info" style="margin-bottom:16px"><b>' + nf(L.length) + ' carga(s) a chegar</b> · ' + nf(p / 1000, 1) + ' t' +
    (imp.total ? ' · quando chegarem, <b>+' + nf(imp.total) + ' torre(s)</b> ficam com kit completo' : '') +
    (prox ? ' · próxima prevista para ' + fdata(prox.previsao) + ' (' + esc(cantNome(prox.canteiroId)) + ')' : '') +
    (atras ? ' · <span class="tag warn">' + atras + ' atrasada(s)</span>' : '') + ' · <a href="#cargas">ver cargas</a></div>';
}

V.cargas = function () {
  var h = head('Cargas a chegar', 'Notas fiscais e romaneios de carretas que ainda vão chegar: veja o que vem, para qual canteiro, e quais torres fecham quando a carga chegar. Ao chegar, confira e dê entrada no estoque com um clique.',
    podeGravar() ? '<label class="btn pri"' + ((F.cgImp || {}).lendo ? ' style="opacity:.5;pointer-events:none"' : '') + '>Ler NF / romaneio…<input type="file" id="cgArq" multiple accept=".xml,.pdf,.xlsx,.xls,.xlsm,.csv" hidden></label> <button class="btn" id="cgNova">+ Nova carga manual</button>' : '');
  var sc = semCadastro(); if (sc) return h + sc;
  h += blocoImportarCargas();
  var L = cargasPrevistas(), h0 = hoje(), f = F.cg || (F.cg = { cant: '' });
  var Lf = L.filter(function (c) { return !f.cant || c.canteiroId === f.cant; });
  var peso = Lf.reduce(function (a, c) { return a + pesoCarga(c); }, 0), vols = Lf.reduce(function (a, c) { return a + volsCarga(c.itens); }, 0);
  var imp = impactoCargas(Lf), atras = Lf.filter(function (c) { return c.previsao && c.previsao < h0; });
  var prox = Lf.find(function (c) { return c.previsao && c.previsao >= h0; });
  h += '<div class="kpis">' + kpi('Cargas a chegar', nf(Lf.length), atras.length ? '<span class="tag warn">' + atras.length + ' com previsão vencida</span>' : 'nenhuma atrasada') +
    kpi('Volumes', nf(vols), nf(peso / 1000, 1) + ' t') +
    kpi('Torres prontas p/ montar', nf(imp.depois || 0), 'hoje ' + nf(imp.antes || 0) + (imp.total ? ' · <b>+' + nf(imp.total) + '</b> com as cargas' : '') + ' (tipos das cargas)') +
    kpi('Valor a chegar', (function () { var v = 0, e = false; Lf.forEach(function (c) { var x = valorCarga(c); v += x.v; if (x.est) e = true; }); return v ? brl(v, v >= 1e6) : '—'; })(), Lf.some(function (c) { return valorCarga(c).est; }) ? 'parte estimada pelo R$/t do fornecedor' : 'valor das NFs') +
    kpi('Próxima chegada', prox ? fdata(prox.previsao) : '—', prox ? esc(cantNome(prox.canteiroId)) + ' · ' + esc(prox.fornecedor || '') : 'sem data futura') + '</div>';
  if (S.canteiros.length > 1) h += '<div class="filters"><div class="field" style="max-width:260px"><label>Canteiro</label><select id="cgCant">' + optList(cantsOrd(true), f.cant, function (x) { return x.nome; }, 'Todos') + '</select></div></div>';
  if (!Lf.length) h += '<div class="card"><div class="empty">Nenhuma carga prevista' + (f.cant ? ' para este canteiro' : '') + '. ' + (podeGravar() ? 'Arraste os arquivos de NF (XML) e romaneio no quadro acima, ou clique em <b>Ler NF / romaneio…</b>.' : '') + '</div></div>';
  else {
    var selN = Lf.filter(function (c) { return f.sel && f.sel[c.id]; }).length, pode = podeGravar();
    h += '<div class="card"><h2>Previstas <span class="sub">ordenadas pela data prevista de chegada</span>' + (pode ? '<span style="margin-left:auto;display:flex;gap:8px;align-items:center"><span class="small muted">' + (selN ? selN + ' selecionada(s)' : 'marque as cargas que chegaram') + '</span><button class="btn sm pri" id="cgRecSel"' + (selN ? '' : ' disabled') + '>Dar entrada nas selecionadas</button></span>' : '') + '</h2><div class="tw"><table><thead><tr>' + (pode ? '<th style="width:34px"><input type="checkbox" id="cgSelTodas" title="Selecionar todas"' + (selN && selN === Lf.length ? ' checked' : '') + '></th>' : '') + '<th>Previsão</th><th>Canteiro</th><th>Fornecedor</th><th>NF / Romaneio</th><th>Transporte</th><th>O que vem</th><th class="n">Peso (t)</th><th class="n">Valor NF</th><th>Fecha torres</th><th></th></tr></thead><tbody>' +
      Lf.map(function (c) {
        var im = impactoCargas([c]), atr = c.previsao && c.previsao < h0, novas = [].concat.apply([], im.porTipo.map(function (x) { return x.novas.map(function (t) { return t.n; }); }));
        return '<tr' + (f.sel && f.sel[c.id] ? ' style="background:#fff7ef"' : '') + '>' + (podeGravar() ? '<td><input type="checkbox" data-cgsel="' + esc(c.id) + '"' + (f.sel && f.sel[c.id] ? ' checked' : '') + '></td>' : '') + '<td>' + (c.previsao ? fdata(c.previsao) : '<span class="muted">sem data</span>') + (atr ? ' <span class="tag warn">atrasada</span>' : c.previsao === h0 ? ' <span class="tag info">hoje</span>' : '') + '</td>' +
          '<td>' + esc(cantNome(c.canteiroId)) + '</td><td>' + esc(c.fornecedor || '') + '</td><td class="small">' + (c.nfs && c.nfs.length ? '<b>NF ' + esc(c.nfs.join(', ')) + '</b>' : '<span class="muted">sem NF</span>') + (c.romaneio ? '<br>Rom. ' + esc(c.romaneio) : '') + linhaNF(c) + '</td>' +
          '<td class="small">' + esc(c.transporte || '') + '</td><td class="small">' + resumoTiposCarga(c.itens) + '</td><td class="n">' + (c.itens && c.itens.length ? nf(pesoItensCarga(c.itens) / 1000, 2) : c.pesoNFKg ? nf(c.pesoNFKg / 1000, 2) + ' <span class="tag warn" title="Peso da NF; volumes ainda não informados">só NF</span>' : '—') + '</td>' +
          '<td class="n">' + fmtValorCarga(c) + '</td>' +
          '<td class="small">' + (im.total ? '<span class="tag ok">+' + im.total + '</span> <span title="' + esc(novas.join(', ')) + '">' + esc(novas.slice(0, 6).join(', ')) + (novas.length > 6 ? '…' : '') + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td style="white-space:nowrap">' + (podeGravar() ? '<button class="btn sm pri" data-cgrec="' + esc(c.id) + '">Receber</button> <button class="btn sm" data-cgver="' + esc(c.id) + '">Ver</button> <button class="btn sm" data-cged="' + esc(c.id) + '">Editar</button> <button class="btn sm ghost" data-cgcan="' + esc(c.id) + '" title="Cancelar carga">✕</button>' : '<button class="btn sm" data-cgver="' + esc(c.id) + '">Ver</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    h += '<div class="card"><h2>Quando as cargas chegarem <span class="sub">quanto vai ter em cada canteiro e quantas torres dá para montar</span></h2>' + tabelaDepoisDaChegada(Lf, imp) + '</div>' + blocoEstai(Lf);
  }
  if (!Lf.length) h += blocoEstai([]);
  var hist = (S.cargas || []).filter(function (c) { return c.status !== 'PREVISTA' && (!f.cant || c.canteiroId === f.cant); }).sort(function (a, b) { return String(b.recebidoEm || b.canceladoEm || '').localeCompare(String(a.recebidoEm || a.canceladoEm || '')); }).slice(0, 40);
  if (hist.length) h += '<div class="card"><details><summary><b>Recebidas e canceladas</b> <span class="small muted">(' + hist.length + ' mais recentes)</span></summary><div class="tw" style="margin-top:10px"><table><thead><tr><th>Situação</th><th>Data</th><th>Canteiro</th><th>Fornecedor</th><th>NF / Romaneio</th><th>O que veio</th><th class="n">Peso (t)</th><th></th></tr></thead><tbody>' +
    hist.map(function (c) {
      var rec = c.status === 'RECEBIDA', it = rec ? (c.itensRecebidos || c.itens) : c.itens;
      return '<tr><td>' + (rec ? '<span class="tag ok">Recebida</span>' + (c.divergencia ? ' <span class="tag warn">com diferença</span>' : '') : '<span class="tag">Cancelada</span>') + '</td><td>' + fdata(rec ? c.dataRecebimento : (c.canceladoEm || '').slice(0, 10)) + '</td><td>' + esc(cantNome(c.canteiroId)) + '</td><td>' + esc(c.fornecedor || '') + '</td>' +
        '<td class="small">' + (c.nfs && c.nfs.length ? 'NF ' + esc(c.nfs.join(', ')) : '') + (c.romaneio ? ' · Rom. ' + esc(c.romaneio) : '') + '</td><td class="small">' + resumoTiposCarga(it) + (c.motivoCancelamento ? '<br><span class="muted">' + esc(c.motivoCancelamento) + '</span>' : '') + '</td><td class="n">' + nf(pesoItensCarga(it) / 1000, 2) + '</td><td><button class="btn sm" data-cgver="' + esc(c.id) + '">Ver</button></td></tr>';
    }).join('') + '</tbody></table></div></details></div>';
  return h;
};
V.cargas_bind = function () {
  var n = $('#cgNova'); if (n) n.onclick = function () { formCarga(null); };
  ligarImportarCargas();
  var fc = $('#cgCant'); if (fc) fc.onchange = function () { F.cg.cant = fc.value; render(); };
  $$('[data-cged]').forEach(function (b) { b.onclick = function () { formCarga(b.getAttribute('data-cged')); }; });
  $$('[data-cgrec]').forEach(function (b) { b.onclick = function () { receberCarga(b.getAttribute('data-cgrec')); }; });
  F.cg.sel = F.cg.sel || {};
  $$('[data-cgsel]').forEach(function (x) { x.onchange = function () { if (x.checked) F.cg.sel[x.getAttribute('data-cgsel')] = 1; else delete F.cg.sel[x.getAttribute('data-cgsel')]; render(true); }; });
  var st = $('#cgSelTodas'); if (st) st.onchange = function () { $$('[data-cgsel]').forEach(function (x) { if (st.checked) F.cg.sel[x.getAttribute('data-cgsel')] = 1; else delete F.cg.sel[x.getAttribute('data-cgsel')]; }); render(true); };
  var rs = $('#cgRecSel'); if (rs) rs.onclick = receberSelecionadas;
  $$('[data-cgver]').forEach(function (b) { b.onclick = function () { verCarga(b.getAttribute('data-cgver')); }; });
  $$('[data-cgtorre]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); modalKit(a.getAttribute('data-cgtorre')); }; });
  $$('[data-cgcan]').forEach(function (b) {
    b.onclick = function () {
      var c = (S.cargas || []).find(function (x) { return x.id === b.getAttribute('data-cgcan'); }); if (!c) return;
      modal('Cancelar carga', '<p style="margin-top:0">A carga ' + (c.romaneio ? 'do romaneio <b>' + esc(c.romaneio) + '</b> ' : '') + 'para ' + esc(cantNome(c.canteiroId)) + ' sai da lista de previstas. Nada muda no estoque.</p><div class="field"><label>Motivo</label><input id="cgMot" placeholder="Ex.: carga reprogramada, NF cancelada"></div>', {
        ok: 'Cancelar carga', cancel: 'Voltar',
        onOk: async function (m) { await Store.update('planejamento', c.id, { status: 'CANCELADA', canceladoEm: new Date().toISOString(), canceladoPor: S.uid || null, motivoCancelamento: $('#cgMot', m).value.trim() }); toast('Carga cancelada'); }
      });
    };
  });
};
function cargaById(id) { return (S.cargas || []).find(function (x) { return x.id === id; }); }
function lerNFsTexto(v) { return String(v || '').split(/\s*,\s*|\s*;\s*|\s+e\s+/i).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }

// Grade de volumes com vários tipos na mesma carga (uma carreta pode trazer mais de um tipo)
function editorItensCarga(m, inicial, opts) {
  var vals = {}; (inicial || []).forEach(function (i) { (vals[i.tipoId] = vals[i.tipoId] || {})[i.componenteId] = i.qtd; });
  var st = { tipo: (inicial && inicial[0] && inicial[0].tipoId) || '' };
  var guardar = function () { if (!st.tipo) return; var o = {}; $$('#cgGrade [data-q]', m).forEach(function (i) { if (i.value !== '' && Number(i.value) > 0) o[i.getAttribute('data-q')] = Number(i.value); }); vals[st.tipo] = o; };
  var itens = function () { guardar(); var a = []; Object.keys(vals).forEach(function (t) { Object.keys(vals[t]).forEach(function (c) { if (vals[t][c] > 0) a.push({ tipoId: t, componenteId: c, qtd: vals[t][c] }); }); }); return a; };
  var resumo = function () {
    var it = itens(), el = $('#cgResumo', m); if (!el) return;
    el.innerHTML = it.length ? 'Nesta carga: ' + resumoTiposCarga(it) + ' · <b>' + nf(pesoItensCarga(it) / 1000, 2) + ' t</b>' + (opts && opts.extra ? opts.extra(it) : '') : '<span class="muted">Nenhum volume informado ainda.</span>';
    $$('#cgTipos [data-tp]', m).forEach(function (b) { var t = b.getAttribute('data-tp'), n = Object.keys(vals[t] || {}).reduce(function (a, k) { return a + (vals[t][k] || 0); }, 0); b.className = 'btn sm' + (t === st.tipo ? ' pri' : ''); b.innerHTML = esc(tipoCod(t)) + (n ? ' <span class="badge" style="position:static;margin-left:4px">' + n + '</span>' : '');
      var TF = opts && opts.forn ? tiposDoFornecedor(opts.forn()) : []; b.style.display = !TF.length || TF.indexOf(t) >= 0 || n || !fornecedorDoTipo(t) ? '' : 'none'; });
    var dica = $('#cgTiposDica', m), Fo = opts && opts.forn ? String(opts.forn() || '').trim().toUpperCase() : '', TF2 = tiposDoFornecedor(Fo);
    if (dica) dica.innerHTML = TF2.length ? 'Mostrando os tipos da ' + esc(Fo) + ' (' + TF2.map(esc).join(', ') + '). Cada fornecedor só entrega os tipos dele — ajuste em Tipos e volumes.' : (Fo ? '<span class="tag warn">' + esc(Fo) + ' não tem tipos cadastrados</span>' : '');
  };
  var draw = function () {
    $('#cgGrade', m).innerHTML = gradeItens(tipoById(st.tipo), $('#cgC', m) ? $('#cgC', m).value : '', vals[st.tipo] || {}, { rotuloSaldo: 'Saldo atual', fisico: true, rotuloQtd: opts && opts.rotuloQtd });
    ligarFiltroGrade($('#cgGrade', m)); resumo();
    if (opts && opts.soPrevistos && !st.todos) {
      var vis = 0; $$('#cgGrade tr.gl', m).forEach(function (tr) { var v = $('input', tr).value !== ''; tr.style.display = v ? '' : 'none'; if (v) vis++; });
      $$('#cgGrade tr.ggrp', m).forEach(function (g) { var n = g.nextElementSibling, ok = false; while (n && n.classList.contains('gl')) { if (n.style.display !== 'none') ok = true; n = n.nextElementSibling; } g.style.display = ok ? '' : 'none'; });
      var a = document.createElement('p'); a.className = 'small'; a.style.margin = '6px 0 0'; a.innerHTML = (vis ? 'Mostrando só os volumes previstos deste tipo. ' : 'Nenhum volume previsto deste tipo. ') + '<a href="#" id="cgTodos">Mostrar todos os volumes</a> (para lançar algo que veio sem estar previsto).';
      $('#cgGrade', m).appendChild(a); $('#cgTodos', m).onclick = function (e) { e.preventDefault(); guardar(); st.todos = true; draw(); };
    }
  };
  $('#cgTipos', m).innerHTML = tiposOrd().map(function (t) { return '<button type="button" class="btn sm" data-tp="' + esc(t.id) + '">' + esc(t.codigo) + '</button>'; }).join(' ');
  $$('#cgTipos [data-tp]', m).forEach(function (b) { b.onclick = function () { guardar(); st.tipo = b.getAttribute('data-tp'); draw(); }; });
  $('#cgGrade', m).addEventListener('input', function () { guardar(); resumo(); });
  if (!st.tipo && S.tipos.length === 1) st.tipo = S.tipos[0].id;
  if (st.tipo) draw(); else { $('#cgGrade', m).innerHTML = '<div class="muted small">Escolha acima o tipo de torre para informar os volumes. Uma carga pode ter mais de um tipo.</div>'; resumo(); }
  return { itens: itens, redesenhar: function () {
    if (opts && opts.forn) { var TF = tiposDoFornecedor(opts.forn()); if (TF.length && (!st.tipo || TF.indexOf(st.tipo) < 0) && !Object.keys(vals[st.tipo] || {}).length) { guardar(); st.tipo = TF[0]; } }
    if (st.tipo) { guardar(); draw(); } else resumo(); } };
}

function formCarga(id, rascunho) {
  var c = id ? cargaById(id) : null; if (id && !c) return;
  c = c || rascunho || {};
  var body = '<div class="row"><div class="field"><label>Canteiro de destino</label><select id="cgC">' + optList(cantsOrd(true), c.canteiroId || '', function (x) { return x.nome; }, 'Selecione…') + '</select></div>' +
    '<div class="field"><label>Previsão de chegada</label><input type="date" id="cgD" value="' + esc(c.previsao || '') + '"></div>' +
    '<div class="field"><label>Fornecedor</label><input id="cgF" list="cgFs" value="' + esc(c.fornecedor || '') + '" placeholder="Nome do fornecedor"><datalist id="cgFs">' + listaFornecedores().map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</datalist></div></div>' +
    '<div class="row"><div class="field"><label>NF(s) — várias separadas por vírgula</label><input id="cgNF" value="' + esc((c.nfs || []).join(', ')) + '" placeholder="Ex.: 690, 691"></div>' +
    '<div class="field"><label>Romaneio</label><input id="cgRom" value="' + esc(c.romaneio || '') + '"></div>' +
    '<div class="field"><label>Transportadora / placa / motorista</label><input id="cgTr" value="' + esc(c.transporte || '') + '" placeholder="Opcional"></div></div><div id="cgNFinfo" class="small" style="margin-bottom:8px"></div>' +
    '<div class="field"><label>Tipos de torre na carga</label><div id="cgTipos" style="display:flex;flex-wrap:wrap;gap:6px"></div><div id="cgTiposDica" class="small muted" style="margin-top:4px"></div></div><div id="cgGrade"></div><div id="cgResumo" class="small" style="margin:8px 0"></div>' +
    '<div class="row"><div class="field"><label>Mercadoria da NF</label><input id="cgMerc" value="' + esc(c.mercadoria || mercadoriaDe(c)) + '" placeholder="Ex.: ESTRUTURA METÁLICA GALVANIZADA"></div>' +
    '<div class="field" style="max-width:150px"><label>Emissão da NF</label><input type="date" id="cgEm" value="' + esc(c.emissao || '') + '"></div>' +
    '<div class="field" style="max-width:120px"><label>Volumes (NF)</label><input class="num" type="number" min="0" id="cgVolNF" value="' + esc(c.volumesNF || volumesNFDe(c) || '') + '"></div>' +
    '<div class="field" style="max-width:140px"><label>Peso da NF (t)</label><input class="num" type="number" min="0" step="0.001" id="cgPesoNF" value="' + esc(c.pesoNFKg ? Math.round(c.pesoNFKg) / 1000 : '') + '"></div>' +
    '<div class="field" style="max-width:150px"><label>Valor da NF (R$)</label><input class="num" type="number" min="0" step="0.01" id="cgValNF" value="' + esc(c.valorNF || valorNFDe(c) || '') + '"></div></div>' +
    '<div class="field"><label>Observação</label><input id="cgObs" value="' + esc(c.obs || '') + '" placeholder="Ex.: carreta saiu da fábrica dia 10"></div>';
  var ed;
  modal(id ? 'Editar carga' : 'Nova carga a chegar', body, {
    ok: id ? 'Salvar' : 'Registrar carga',
    onOpen: function (m) {
      ed = editorItensCarga(m, c.itens, {
        forn: function () { return $('#cgF', m).value; },
        extra: function (it) {
          var tn = nfsDaCarga(m).reduce(function (a, n) { return a + n.q; }, 0) || (Number(($('#cgPesoNF', m) || {}).value) || 0); if (!tn) return '';
          var dif = pesoItensCarga(it) / 1000 - tn;
          return ' · NF: ' + nf(tn, 2) + ' t ' + (Math.abs(dif) <= Math.max(0.05 * tn, 0.3) ? '<span class="tag ok">peso confere</span>' : '<span class="tag warn">diferença ' + (dif > 0 ? '+' : '') + nf(dif, 2) + ' t</span>');
        }
      });
      $('#cgC', m).onchange = function () { ed.redesenhar(); };
      var info = function () {
        var ach = nfsDaCarga(m), el = $('#cgNFinfo', m), lst = lerNFsTexto($('#cgNF', m).value);
        if (!lst.length || !S.nfs.length) { el.innerHTML = ''; return; }
        if (!ach.length) { el.innerHTML = '<span class="tag warn">NF ainda não está no controle de NFs</span>'; return; }
        var cn = ach.map(function (n) { return canteiroDaNF(n.can); });
        el.innerHTML = '<span class="tag ok">' + ach.length + ' NF(s) no controle</span> ' + nf(ach.reduce(function (a, n) { return a + n.q; }, 0), 2) + ' t · ' + esc(ach.map(function (n) { return n.desc || ''; }).filter(Boolean).slice(0, 2).join('; ')) + (cn[0] ? ' · destino ' + esc(cn[0]) : '');
        if (!$('#cgC', m).value) { var c0 = S.canteiros.find(function (x) { return cn[0] === x.nome; }); if (c0) { $('#cgC', m).value = c0.id; ed.redesenhar(); } }
        if (!$('#cgF', m).value && ach[0].f) $('#cgF', m).value = ach[0].f;
      };
      ['#cgF', '#cgNF'].forEach(function (s) { $(s, m).addEventListener('input', function () { info(); ed.redesenhar(); }); });
      info(); ed.redesenhar();
    },
    onOk: async function (m) {
      var it = ed.itens(), erros = [], cant = $('#cgC', m).value;
      if (!cant) erros.push('Escolha o canteiro de destino.');
      if (!it.length) erros.push('Informe ao menos um volume da carga.');
      var nfs = lerNFsTexto($('#cgNF', m).value), rom = $('#cgRom', m).value.trim();
      if (!nfs.length && !rom) erros.push('Informe a NF ou o romaneio.');
      var dup = (S.cargas || []).find(function (x) { return x.id !== id && x.status !== 'CANCELADA' && rom && x.romaneio === rom && x.canteiroId === cant; });
      if (dup) erros.push('Já existe uma carga com o romaneio ' + rom + ' para este canteiro.');
      erros = erros.concat(errosFornecedor($('#cgF', m).value, it));
      if (erros.length) throw Falha(erros);
      var doc = { canteiroId: cant, previsao: $('#cgD', m).value || '', fornecedor: $('#cgF', m).value.trim().toUpperCase(), nfs: nfs, romaneio: rom, transporte: $('#cgTr', m).value.trim(), obs: $('#cgObs', m).value.trim(), itens: it, atualizadoEm: new Date().toISOString(),
        mercadoria: $('#cgMerc', m).value.trim().toUpperCase(), emissao: $('#cgEm', m).value || '', volumesNF: Number($('#cgVolNF', m).value) || 0, pesoNFKg: Math.round((Number($('#cgPesoNF', m).value) || 0) * 1000), valorNF: Number($('#cgValNF', m).value) || 0 };
      if (rascunho) { doc.arquivos = rascunho.arquivos || []; doc.origem = rascunho.origem || ''; doc.nfDados = rascunho.nfDados || []; doc.pesoRomaneioKg = rascunho.pesoRomaneioKg || 0; }
      if (id) await Store.update('planejamento', id, doc);
      else await Store.set('planejamento', newId('cg_'), Object.assign(doc, { status: 'PREVISTA', criadoEm: doc.atualizadoEm, criadoPor: S.uid || null }));
      if (rascunho && F.cgImp) { F.cgImp.rascunhos = F.cgImp.rascunhos.filter(function (r) { return r !== rascunho; }); setTimeout(function () { render(true); }, 0); }
      toast(id ? 'Carga atualizada' : 'Carga registrada');
    }
  });
}
function nfsDaCarga(m) {
  var fo = ($('#cgF', m) && $('#cgF', m).value || '').trim().toUpperCase(), lst = lerNFsTexto($('#cgNF', m) && $('#cgNF', m).value);
  if (!lst.length) return [];
  return (S.nfsPlan || []).filter(function (n) { return lst.indexOf(n.nf) >= 0 && (!fo || n.f === fo); });
}
function receberCarga(id) {
  var c = cargaById(id); if (!c) return;
  var body = '<p style="margin-top:0" class="small">Confira os volumes que chegaram em <b>' + esc(cantNome(c.canteiroId)) + '</b>. Os campos já vêm com o previsto; corrija o que veio diferente. Cada tipo vira um recebimento no estoque.</p>' +
    '<div class="row"><div class="field"><label>Data da chegada</label><input type="date" id="cgRD" value="' + hoje() + '"></div><div class="field"><label>Observação / RNC</label><input id="cgRObs" placeholder="Ex.: veio 1 volume a menos"></div></div>' +
    '<div class="field"><label>Tipos de torre na carga</label><div id="cgTipos" style="display:flex;flex-wrap:wrap;gap:6px"></div><div id="cgTiposDica" class="small muted" style="margin-top:4px"></div></div><div id="cgGrade"></div><div id="cgResumo" class="small" style="margin:8px 0"></div>' +
    '<input type="hidden" id="cgC" value="' + esc(c.canteiroId) + '">';
  var ed;
  modal('Receber carga' + (c.romaneio ? ' · Rom. ' + c.romaneio : ''), body, {
    ok: 'Dar entrada no estoque',
    onOpen: function (m) {
      ed = editorItensCarga(m, c.itens, {
        rotuloQtd: 'Chegou', soPrevistos: true, forn: function () { return c.fornecedor; },
        extra: function (it) { var d = difItens(c.itens, it); return d.length ? ' · <span class="tag warn">' + d.length + ' volume(s) diferente(s) do previsto</span>' : ' · <span class="tag ok">igual ao previsto</span>'; }
      });
    },
    onOk: async function (m) {
      var it = ed.itens(); if (!it.length) throw Falha(['Informe o que chegou (ou cancele a carga, se ela não vem mais).']);
      await darEntradaCarga(c, it, $('#cgRD', m).value || hoje(), $('#cgRObs', m).value.trim());
      toast('Carga recebida: estoque atualizado');
    }
  });
}
// Dá entrada de uma carga no estoque: um recebimento por tipo (id fixo, então repetir não duplica) e marca a carga como recebida
async function darEntradaCarga(c, it, data, obsR) {
  var id = c.id, dif = difItens(c.itens, it), ids = [];
  var docBase = c.nfs && c.nfs.length ? 'NF ' + c.nfs.join(', ') + ' · Rom. ' + (c.romaneio || '-') : 'Rom. ' + c.romaneio;
  var grupos = porTipoCarga(it);
  for (var i = 0; i < grupos.length; i++) {
    var g = grupos[i], mid = 'cgm_' + id.slice(3) + '_' + g.tipoId; ids.push(mid);
    await Store.set('movimentos', mid, {
      natureza: 'ENTRADA', canteiroId: c.canteiroId, tipoId: g.tipoId, data: data, criadoEm: new Date().toISOString(), usuarioId: S.uid || null,
      itens: g.itens.map(function (x) { return { componenteId: x.componenteId, qtd: x.qtd }; }), documento: docBase,
      obs: [c.fornecedor, 'carga prevista' + (c.transporte ? ' (' + c.transporte + ')' : ''), obsR, dif.length ? 'diferença em ' + dif.length + ' volume(s) do previsto' : ''].filter(Boolean).join(' · '),
      fornecedor: c.fornecedor || '', nfs: c.nfs || [], romaneio: c.romaneio || '', cargaId: id
    });
  }
  await Store.update('planejamento', id, { status: 'RECEBIDA', dataRecebimento: data, recebidoEm: new Date().toISOString(), recebidoPor: S.uid || null, itensRecebidos: it, divergencia: dif.length, obsRecebimento: obsR || '', movimentos: ids });
}
function receberSelecionadas() {
  var sel = cargasPrevistas().filter(function (c) { return F.cg.sel && F.cg.sel[c.id]; });
  if (!sel.length) return;
  var ok = sel.filter(function (c) { return c.itens && c.itens.length; }), sem = sel.filter(function (c) { return !(c.itens && c.itens.length); });
  var body = '<p style="margin-top:0" class="small">As cargas abaixo entram no estoque <b>com as quantidades previstas</b> (as do romaneio/NF). Se alguma chegou diferente, use o botão <b>Receber</b> dela para conferir item por item.</p>' +
    '<div class="tw" style="max-height:40vh"><table><thead><tr><th>Canteiro</th><th>Fornecedor</th><th>NF / Romaneio</th><th>O que vem</th><th class="n">Peso (t)</th></tr></thead><tbody>' +
    ok.map(function (c) { return '<tr><td>' + esc(cantNome(c.canteiroId)) + '</td><td>' + esc(c.fornecedor || '') + '</td><td class="small">' + (c.nfs && c.nfs.length ? 'NF ' + esc(c.nfs.join(', ')) : '') + (c.romaneio ? ' · Rom. ' + esc(c.romaneio) : '') + '</td><td class="small">' + resumoTiposCarga(c.itens) + '</td><td class="n">' + nf(pesoItensCarga(c.itens) / 1000, 2) + '</td></tr>'; }).join('') +
    '<tr><td colspan="4"><b>Total: ' + ok.length + ' carga(s) · ' + nf(ok.reduce(function (a, c) { return a + volsCarga(c.itens); }, 0)) + ' volumes</b></td><td class="n"><b>' + nf(ok.reduce(function (a, c) { return a + pesoItensCarga(c.itens); }, 0) / 1000, 2) + '</b></td></tr></tbody></table></div>' +
    (sem.length ? '<div class="banner warn">' + sem.length + ' carga(s) selecionada(s) não têm volumes informados (só a NF) e ficam de fora: ' + sem.map(function (c) { return esc(c.romaneio || (c.nfs || []).join(', ')); }).join(', ') + '. Use <b>Receber</b> nelas para informar o que chegou.</div>' : '') +
    '<div class="row"><div class="field" style="max-width:200px"><label>Data da chegada</label><input type="date" id="cgLD" value="' + hoje() + '"></div><div class="field"><label>Observação (vale para todas)</label><input id="cgLObs" placeholder="Opcional"></div></div>' +
    '<div id="cgLProg" class="small muted"></div>';
  modal('Dar entrada nas cargas selecionadas', body, {
    ok: ok.length ? 'Dar entrada em ' + ok.length + ' carga(s)' : 'Fechar',
    onOk: async function (m) {
      if (!ok.length) return;
      var data = $('#cgLD', m).value || hoje(), obs = $('#cgLObs', m).value.trim(), falhas = [], feitas = 0;
      for (var i = 0; i < ok.length; i++) {
        var pr = $('#cgLProg', m); if (pr) pr.textContent = 'Gravando ' + (i + 1) + ' de ' + ok.length + '…';
        try { await darEntradaCarga(ok[i], ok[i].itens.map(function (x) { return Object.assign({}, x); }), data, obs); feitas++; delete F.cg.sel[ok[i].id]; }
        catch (e) { falhas.push((ok[i].romaneio || ok[i].id) + ': ' + errMsg(e)); }
      }
      if (falhas.length) throw Falha(['Entraram ' + feitas + ' de ' + ok.length + '. Falharam:'].concat(falhas));
      toast(feitas + ' carga(s) recebida(s): estoque atualizado');
    }
  });
}
function difItens(prev, real) {
  var a = {}, out = [];
  (prev || []).forEach(function (i) { var k = i.tipoId + '|' + i.componenteId; a[k] = (a[k] || 0) + Number(i.qtd); });
  (real || []).forEach(function (i) { var k = i.tipoId + '|' + i.componenteId; a[k] = (a[k] || 0) - Number(i.qtd); });
  Object.keys(a).forEach(function (k) { if (a[k]) { var p = k.split('|'); out.push({ tipoId: p[0], componenteId: p[1], dif: -a[k] }); } });
  return out;
}
function blocoNFCarga(c) {
  var L = c.nfDados && c.nfDados.length ? c.nfDados : (c.nfs && c.nfs.length ? [{ numero: c.nfs.join(', '), emissao: c.emissao, mercadorias: c.mercadoria ? [{ desc: c.mercadoria }] : [], volumes: c.volumesNF, pesoBrutoKg: c.pesoNFKg, valor: c.valorNF }] : []);
  if (!L.length) return '';
  return '<div class="tw" style="margin-bottom:10px"><table><thead><tr><th>NF</th><th>Emissão</th><th>Mercadoria</th><th class="n">Volumes</th><th class="n">Peso NF (t)</th><th class="n">Valor</th></tr></thead><tbody>' +
    L.map(function (n) { return '<tr><td><b>' + esc(n.numero || '') + '</b>' + (n.chave ? '<br><span class="small mono muted">' + esc(n.chave) + '</span>' : '') + '</td><td>' + fdata(n.emissao) + '</td><td class="small">' + esc((n.mercadorias || []).map(function (x) { return x.desc + (x.qtd ? ' — ' + nf(x.qtd, 3) + ' ' + (x.un || '') : ''); }).join('; ')) + (n.transportadora ? '<br><span class="muted">' + esc(n.transportadora) + (n.placa ? ' · ' + esc(n.placa) : '') + '</span>' : '') + '</td><td class="n">' + (n.volumes ? nf(n.volumes) : '—') + '</td><td class="n">' + (n.pesoLiquidoKg || n.pesoBrutoKg ? nf((n.pesoLiquidoKg || n.pesoBrutoKg) / 1000, 3) : '—') + '</td><td class="n">' + (n.valor ? brl(n.valor) : '—') + '</td></tr>'; }).join('') +
    '</tbody></table></div>' + (c.pesoRomaneioKg ? '<p class="small muted" style="margin:-4px 0 10px">Peso somado no romaneio: ' + nf(c.pesoRomaneioKg / 1000, 3) + ' t · volumes da carga: ' + nf(volsCarga(c.itens)) + ' (' + nf(pesoItensCarga(c.itens) / 1000, 3) + ' t pelo cadastro)</p>' : '');
}
function verCarga(id) {
  var c = cargaById(id); if (!c) return;
  var tab = function (itens, real) {
    var dif = real ? difItens(itens, real) : [], dm = {}; dif.forEach(function (d) { dm[d.tipoId + '|' + d.componenteId] = d.dif; });
    return '<div class="tw" style="max-height:50vh"><table><thead><tr><th>Tipo</th><th>Volume</th><th class="n">Previsto</th>' + (real ? '<th class="n">Chegou</th>' : '') + '</tr></thead><tbody>' +
      (itens || []).map(function (i) { var d = dm[i.tipoId + '|' + i.componenteId] || 0; return '<tr><td>' + esc(tipoCod(i.tipoId)) + '</td><td>' + esc(compNome(i.tipoId, i.componenteId)) + '</td><td class="n">' + nf(i.qtd) + '</td>' + (real ? '<td class="n">' + nf(i.qtd + d) + (d ? ' <span class="tag warn">' + (d > 0 ? '+' : '') + d + '</span>' : '') + '</td>' : '') + '</tr>'; }).join('') +
      (real || []).filter(function (r) { return !(itens || []).some(function (i) { return i.tipoId === r.tipoId && i.componenteId === r.componenteId; }); }).map(function (r) { return '<tr><td>' + esc(tipoCod(r.tipoId)) + '</td><td>' + esc(compNome(r.tipoId, r.componenteId)) + '</td><td class="n">0</td><td class="n">' + nf(r.qtd) + ' <span class="tag warn">não previsto</span></td></tr>'; }).join('') +
      '</tbody></table></div>';
  };
  modal('Carga' + (c.romaneio ? ' · Rom. ' + c.romaneio : ''), '<p style="margin-top:0" class="small">' + esc(cantNome(c.canteiroId)) + ' · ' + esc(c.fornecedor || '') + (c.nfs && c.nfs.length ? ' · NF ' + esc(c.nfs.join(', ')) : '') + (c.previsao ? ' · previsão ' + fdata(c.previsao) : '') + (c.transporte ? ' · ' + esc(c.transporte) : '') +
    (c.status === 'RECEBIDA' ? '<br>Recebida em ' + fdata(c.dataRecebimento) + (c.obsRecebimento ? ' · ' + esc(c.obsRecebimento) : '') : c.status === 'CANCELADA' ? '<br>Cancelada' + (c.motivoCancelamento ? ': ' + esc(c.motivoCancelamento) : '') : '') + (c.obs ? '<br>' + esc(c.obs) : '') + '</p>' +
    blocoNFCarga(c) + '<p class="small" style="margin:0 0 8px"><b>Valor do material:</b> ' + fmtValorCarga(c) + '</p>' + conferenciaRomaneio(c, c.status === 'RECEBIDA' ? (c.itensRecebidos || c.itens) : c.itens) +
    (c.status === 'PREVISTA' ? '<h3 style="font-size:13px;margin:10px 0 6px">Quando esta carga chegar</h3>' + tabelaDepoisDaChegada([c], impactoCargas([c])) + ((c.itens || []).some(function (i) { var t = tipoById(i.tipoId), v = t && (t.volumes || []).find(function (z) { return z.id === i.componenteId; }); return v && String(v.grupo).toUpperCase() === 'ESTAI'; }) ? blocoEstai([c]).replace('<div class="card">', '<div>') : '') + '<h3 style="font-size:13px;margin:12px 0 6px">Volumes do romaneio</h3>' : '') + tab(c.itens, c.status === 'RECEBIDA' ? (c.itensRecebidos || c.itens) : null), { onOpen: function (m) { $$('[data-cgtorre]', m).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); modalKit(a.getAttribute('data-cgtorre')); }; }); } });
}




// ===================== CABO DE ESTAI (torres estaiadas) =====================
// Metragem por torre vem da TAP (aba BD, "Estai + 10%"); o estoque é dos volumes do grupo ESTAI (metros por volume).
function estaiDoc() { return S.estai && S.estai.porTorre ? S.estai : null; }
function metrosDoVolume(t, v) { if (v.metros) return Number(v.metros); var k = estaiDoc() && estaiDoc().kgm && estaiDoc().kgm[t.id]; return k && v.pesoKg ? Number(v.pesoKg) / k : 0; }
function estaiTipos() { var E = estaiDoc(); if (!E) return []; return tiposOrd().filter(function (t) { return (t.regra || {}).modo === 'estaiada' && torresDo(t.id).some(function (tw) { return E.porTorre[tw.n + '|' + t.id]; }); }); }
function metrosEstoque(cid, t, extra) {
  var m = 0; (t.volumes || []).forEach(function (v) { if (String(v.grupo).toUpperCase() !== 'ESTAI') return; var q = Math.max(0, S.d.saldos.get(cid + '|' + t.id + '|' + v.id) || 0) + ((extra && extra[cid + '|' + t.id + '|' + v.id]) || 0); m += q * metrosDoVolume(t, v); });
  return m;
}
// Percorre a LC: quantas torres (ainda não montadas) o estai cobre; e quantas das torres com kit completo
function coberturaEstai(t, cid, metros) {
  var E = estaiDoc(), a = aloc(t.id), resto = metros, restoP = metros, r = { torres: 0, nec: 0, cobertas: 0, prontas: 0, prontasCobertas: 0 };
  torresDo(t.id).filter(function (tw) { return tw.c === cid; }).forEach(function (tw) {
    var x = a.torres[tw.n]; if (x && x.status === 'montada') return;
    var m = E.porTorre[tw.n + '|' + t.id] || 0; if (!m) return;
    r.torres++; r.nec += m;
    if (resto >= m) { resto -= m; r.cobertas++; } else resto = -1;
    if (x && x.kitDisponivel) { r.prontas++; if (restoP >= m) { restoP -= m; r.prontasCobertas++; } }
  });
  return r;
}
function blocoEstai(lista) {
  var E = estaiDoc(), tipos = estaiTipos();
  if (!E || !tipos.length) return '';
  var ch = {}, temCh = false;
  (lista || []).forEach(function (c) { (c.itens || []).forEach(function (i) { var k = c.canteiroId + '|' + i.tipoId + '|' + i.componenteId; ch[k] = (ch[k] || 0) + Number(i.qtd || 0); var t = tipoById(i.tipoId), v = t && (t.volumes || []).find(function (z) { return z.id === i.componenteId; }); if (v && String(v.grupo).toUpperCase() === 'ESTAI') temCh = true; }); });
  var rows = '';
  cantsOrd(true).forEach(function (c) {
    tipos.forEach(function (t) {
      if (!torresDo(t.id).some(function (tw) { return tw.c === c.id; })) return;
      var hoje = metrosEstoque(c.id, t), dep = metrosEstoque(c.id, t, ch), a = coberturaEstai(t, c.id, hoje), b = coberturaEstai(t, c.id, dep);
      if (!a.torres) return;
      rows += '<tr><td>' + esc(c.nome) + '</td><td><b>' + esc(t.codigo) + '</b></td><td class="n">' + nf(a.torres) + '</td><td class="n">' + nf(a.nec, 0) + '</td><td class="n">' + nf(hoje, 0) + '</td><td class="n">' + (dep > hoje ? '+' + nf(dep - hoje, 0) : '—') + '</td><td class="n"><b>' + nf(dep, 0) + '</b></td>' +
        '<td class="n">' + nf(a.cobertas) + (b.cobertas > a.cobertas ? ' → <b>' + nf(b.cobertas) + '</b> <span class="tag ok">+' + (b.cobertas - a.cobertas) + '</span>' : '') + '</td>' +
        '<td class="n">' + nf(a.prontasCobertas) + ' de ' + nf(a.prontas) + (b.prontasCobertas > a.prontasCobertas ? ' → <b>' + nf(b.prontasCobertas) + '</b>' : '') + '</td>' +
        '<td class="n">' + (dep < a.nec ? nf(a.nec - dep, 0) : '<span class="tag ok">coberto</span>') + '</td></tr>';
    });
  });
  if (!rows) return '';
  return '<div class="card"><h2>Cabo de estai — torres estaiadas <span class="sub">metragem por torre da TAP (Estai + 10%) · seguindo a ordem da LC</span></h2><div class="tw"><table><thead><tr><th>Canteiro</th><th>Tipo</th><th class="n">Torres a montar</th><th class="n">Estai necessário (m)</th><th class="n">Estoque (m)</th><th class="n">Chegando (m)</th><th class="n">Vai ficar (m)</th><th class="n">Torres com estai</th><th class="n">Prontas (kit) com estai</th><th class="n">Ainda falta (m)</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="small muted" style="margin:8px 0 0">O estai não faz parte da planilha de estoque da empreiteira: o estoque aqui é o que entrou pelas cargas registradas no sistema (cada volume de cordoalha com a metragem do romaneio). “Prontas (kit) com estai” = torres com todas as peças no canteiro que também têm o cabo garantido. Metragem: ' + esc(E.fonte || 'TAP') + (E.atualizadoEm ? ' · atualizada em ' + fdh(E.atualizadoEm) : '') + '.</p></div>';
}
function blocoImportarTAP() {
  var st = S.impTAP || {}, E = estaiDoc();
  var h = '<div class="card"><h2>Metragem de estai por torre <span class="sub">planilha TAP – Dados Gerais de Projetos (aba BD)</span></h2>' +
    '<p style="margin-top:0" class="small">Usada para saber quantas torres estaiadas o cabo de estai em estoque (e chegando nas cargas) consegue atender. ' + (E ? 'Carregado: <b>' + nf(Object.keys(E.porTorre).length) + ' torres</b>' + (E.atualizadoEm ? ' em ' + fdh(E.atualizadoEm) : '') + '.' : 'Ainda não carregada.') + '</p>';
  if (!podeCadastrar()) return h + '</div>';
  h += '<label class="btn"' + (st.lendo ? ' style="opacity:.5;pointer-events:none"' : '') + '>Escolher planilha TAP…<input type="file" id="tapArq" accept=".xlsm,.xlsx" hidden></label>';
  if (st.lendo) h += ' <span class="small muted">Lendo…</span>';
  if (st.msg) h += '<div class="banner ' + (st.erro ? 'bad' : 'info') + '" style="margin-top:10px">' + esc(st.msg) + '</div>';
  return h + '</div>';
}
function ligarImportarTAP() {
  var a = $('#tapArq'); if (!a) return;
  a.onchange = async function () {
    var f = a.files && a.files[0]; if (!f) return;
    S.impTAP = { lendo: true }; render(true);
    try {
      var XLSX = await carregarXLSX(), wb = XLSX.read(await f.arrayBuffer(), { type: 'array', sheets: ['BD'] });
      if (!wb.Sheets.BD) throw new Error('A planilha não tem a aba BD.');
      var r = Sync.lerTAPEstai(XLSX.utils.sheet_to_json(wb.Sheets.BD, { header: 1, raw: true, defval: null }));
      var porTorre = {}, n = 0; S.torres.forEach(function (t) { var m = r.porTorre[t.n + '|' + t.t]; if (m) { porTorre[t.n + '|' + t.t] = m; n++; } });
      if (!n) throw new Error('Nenhuma torre estaiada da lista de construção foi encontrada na aba BD.');
      await gravarComRetry('projeto', 'estai', { porTorre: porTorre, kgm: r.kgm, fonte: f.name + ' · aba BD · coluna "Estai + 10%"', atualizadoEm: new Date().toISOString() });
      S.impTAP = { msg: 'Metragem de estai carregada para ' + n + ' torres estaiadas da LC.' };
    } catch (e) { console.error(e); S.impTAP = { erro: true, msg: 'Não consegui ler: ' + (e.message || e) }; }
    render(true);
  };
}
// ----- valor do material e estoque depois da chegada -----
function valorCarga(c) {
  var v = valorNFDe(c) || Number(c.valorNF || 0);
  if (v) return { v: v, est: false };
  var p = precos()[String(c.fornecedor || '').trim().toUpperCase()];
  return p ? { v: p * pesoCarga(c) / 1000, est: true } : { v: 0, est: false };
}
function fmtValorCarga(c) { var x = valorCarga(c); return x.v ? brl(x.v) + (x.est ? ' <span class="tag" title="Sem valor na NF: estimado pelo R$/t médio do fornecedor nas NFs">estimado</span>' : '') : '<span class="muted">—</span>'; }
function volsSaldo(cid, t) { var n = 0, kg = 0; (t.volumes || []).forEach(function (v) { var q = Math.max(0, S.d.saldos.get(cid + '|' + t.id + '|' + v.id) || 0); n += q; kg += q * Number(v.pesoKg || 0); }); return { n: n, kg: kg }; }
// Tabela: por canteiro e tipo, quanto tem hoje, quanto chega, quanto fica, e quantas torres dá para montar
function tabelaDepoisDaChegada(lista, imp) {
  var ch = {};
  lista.forEach(function (c) { (c.itens || []).forEach(function (i) { var k = c.canteiroId + '|' + i.tipoId, x = ch[k] = ch[k] || { c: c.canteiroId, t: i.tipoId, n: 0, kg: 0, v: 0 }; var tp = tipoById(i.tipoId), vol = tp && (tp.volumes || []).find(function (z) { return z.id === i.componenteId; }); x.n += Number(i.qtd || 0); x.kg += Number(i.qtd || 0) * Number((vol && vol.pesoKg) || 0); }); var vc = valorCarga(c), pc = pesoItensCarga(c.itens); (c.itens || []).forEach(function (i) { var tp = tipoById(i.tipoId), vol = tp && (tp.volumes || []).find(function (z) { return z.id === i.componenteId; }); if (pc) ch[c.canteiroId + '|' + i.tipoId].v += vc.v * Number(i.qtd || 0) * Number((vol && vol.pesoKg) || 0) / pc; }); });
  var L = Object.keys(ch).map(function (k) { return ch[k]; }).sort(function (a, b) { return cantNome(a.c).localeCompare(cantNome(b.c)) || a.t.localeCompare(b.t); });
  if (!L.length) return '';
  var tot = { hn: 0, hkg: 0, n: 0, kg: 0, v: 0, a: 0, d: 0 };
  var rows = L.map(function (x) {
    var t = tipoById(x.t); if (!t) return '';
    var hj = volsSaldo(x.c, t), it = imp.porTipo.find(function (p) { return p.tipoId === x.t; }), pc = it && it.porC[x.c] || { antes: 0, depois: 0, novas: [] };
    tot.hn += hj.n; tot.hkg += hj.kg; tot.n += x.n; tot.kg += x.kg; tot.v += x.v; tot.a += pc.antes; tot.d += pc.depois;
    return '<tr><td>' + esc(cantNome(x.c)) + '</td><td><b>' + esc(tipoCod(x.t)) + '</b></td><td class="n">' + nf(hj.n) + '<br><span class="small muted">' + nf(hj.kg / 1000, 1) + ' t</span></td><td class="n">+' + nf(x.n) + '<br><span class="small muted">+' + nf(x.kg / 1000, 1) + ' t</span></td><td class="n"><b>' + nf(hj.n + x.n) + '</b><br><span class="small muted">' + nf((hj.kg + x.kg) / 1000, 1) + ' t</span></td>' +
      '<td class="n">' + (x.v ? brl(x.v) : '—') + '</td><td class="n">' + nf(pc.antes) + '</td><td class="n"><b>' + nf(pc.depois) + '</b>' + (pc.depois > pc.antes ? ' <span class="tag ok">+' + (pc.depois - pc.antes) + '</span>' : '') + '</td>' +
      '<td class="small">' + (pc.novas.length ? pc.novas.map(function (n) { return '<a href="#torres" data-cgtorre="' + esc(n) + '">' + esc(n) + '</a>'; }).join(', ') : '<span class="muted">nenhuma nova: a carga adianta peças</span>') + '</td></tr>';
  }).join('');
  return '<div class="tw"><table><thead><tr><th>Canteiro</th><th>Tipo</th><th class="n">Tem hoje<br>(volumes)</th><th class="n">Chegando</th><th class="n">Vai ficar</th><th class="n">Valor chegando</th><th class="n">Torres prontas hoje</th><th class="n">Prontas depois</th><th>Torres que fecham</th></tr></thead><tbody>' + rows +
    '<tr><td colspan="2"><b>Total</b></td><td class="n">' + nf(tot.hn) + '<br><span class="small muted">' + nf(tot.hkg / 1000, 1) + ' t</span></td><td class="n">+' + nf(tot.n) + '<br><span class="small muted">+' + nf(tot.kg / 1000, 1) + ' t</span></td><td class="n"><b>' + nf(tot.hn + tot.n) + '</b><br><span class="small muted">' + nf((tot.hkg + tot.kg) / 1000, 1) + ' t</span></td><td class="n"><b>' + (tot.v ? brl(tot.v) : '—') + '</b></td><td class="n">' + nf(tot.a) + '</td><td class="n"><b>' + nf(tot.d) + '</b></td><td></td></tr></tbody></table></div>' +
    '<p class="small muted" style="margin:8px 0 0">“Tem hoje” = estoque físico do tipo no canteiro. “Prontas” = torres ainda não montadas com o kit completo no próprio canteiro (sem remanejamento), só nos tipos que vêm nas cargas.</p>';
}
// Conferência do romaneio: o que vem, por tipo e grupo de peças
function conferenciaRomaneio(c, itens) {
  var g = {};
  (itens || []).forEach(function (i) { var t = tipoById(i.tipoId), v = t && (t.volumes || []).find(function (z) { return z.id === i.componenteId; }); var k = i.tipoId + '|' + ((v && v.grupo) || '?'), x = g[k] = g[k] || { t: i.tipoId, gr: (v && v.grupo) || '?', n: 0, kg: 0, linhas: 0 }; x.n += Number(i.qtd || 0); x.kg += Number(i.qtd || 0) * Number((v && v.pesoKg) || 0); x.linhas++; });
  var L = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return a.t.localeCompare(b.t) || String(a.gr).localeCompare(String(b.gr)); });
  if (!L.length) return '';
  return '<h3 style="font-size:13px;margin:10px 0 6px">Conferência do romaneio — o que vem por tipo e grupo</h3><div class="tw" style="margin-bottom:10px"><table><thead><tr><th>Tipo</th><th>Grupo</th><th class="n">Volumes diferentes</th><th class="n">Quantidade</th><th class="n">Peso (t)</th></tr></thead><tbody>' +
    L.map(function (x) { return '<tr><td><b>' + esc(tipoCod(x.t)) + '</b></td><td>' + esc(x.gr) + '</td><td class="n">' + nf(x.linhas) + '</td><td class="n">' + nf(x.n) + '</td><td class="n">' + nf(x.kg / 1000, 3) + '</td></tr>'; }).join('') + '</tbody></table></div>';
}
// ----- regra fornecedor × tipo de torre (cada tipo tem um fornecedor, cadastrado em Tipos e volumes) -----
function tiposDoFornecedor(f) { var F = String(f || '').trim().toUpperCase(); return F ? S.tipos.filter(function (t) { return String(t.fornecedor || '').trim().toUpperCase() === F; }).map(function (t) { return t.id; }) : []; }
function fornecedorDoTipo(tid) { var t = tipoById(tid); return t ? String(t.fornecedor || '').trim().toUpperCase() : ''; }
function errosFornecedor(forn, itens) {
  var F = String(forn || '').trim().toUpperCase(), TF = tiposDoFornecedor(F), er = {};
  if (!F || !TF.length) return [];
  (itens || []).forEach(function (i) { var ft = fornecedorDoTipo(i.tipoId); if (ft && ft !== F) er[i.tipoId] = ft; });
  return Object.keys(er).map(function (t) { return t + ' é estrutura da ' + er[t] + ', não da ' + F + ' (a ' + F + ' fornece ' + TF.join(', ') + ').'; });
}
// ----- dados da nota fiscal da carga (mercadoria, volumes, peso, valor) -----
function mercadoriaDe(c) { var d = (c.nfDados || []).map(function (n) { return (n.mercadorias || []).map(function (x) { return x.desc; }).join('; '); }).filter(Boolean); return d.join(' | ') || c.mercadoria || ''; }
function volumesNFDe(c) { var v = (c.nfDados || []).reduce(function (a, n) { return a + (n.volumes || 0); }, 0); return v || c.volumesNF || 0; }
function valorNFDe(c) { var v = (c.nfDados || []).reduce(function (a, n) { return a + (n.valor || 0); }, 0); return v || c.valorNF || 0; }
function linhaNF(c) {
  var mer = c.mercadoria || mercadoriaDe(c), vol = c.volumesNF || volumesNFDe(c), val = c.valorNF || valorNFDe(c), em = c.emissao;
  var p = [];
  if (mer) p.push(esc(mer.length > 60 ? mer.slice(0, 58) + '…' : mer));
  if (vol) p.push(nf(vol) + ' vol. na NF');
  if (c.pesoNFKg) p.push(nf(c.pesoNFKg / 1000, 2) + ' t na NF');
  if (val) p.push(brl(val));
  if (em) p.push('emitida ' + fdata(em));
  return p.length ? '<br><span class="muted">' + p.join(' · ') + '</span>' : '';
}
// NFs das cargas entram no controle de NFs (conferência e fornecimento) como as da planilha
function nfsDeCargas() {
  var out = [];
  (S.cargas || []).forEach(function (c) {
    if (c.status === 'CANCELADA' || !(c.nfs && c.nfs.length)) return;
    var dados = c.nfDados && c.nfDados.length ? c.nfDados : null, rec = c.status === 'RECEBIDA';
    var base = function (num) { return { item: 'carga', nf: String(num).toUpperCase(), nff: String(num).toUpperCase(), f: String(c.fornecedor || '').toUpperCase(), u: 't', de: c.emissao || '', dt: rec ? c.dataRecebimento || '' : '', can: String(cantNome(c.canteiroId)).toUpperCase(), nc: '', rom: String(c.romaneio || '').toUpperCase(), car: c.transporte || '', origem: 'carga', cargaId: c.id, previsao: c.previsao || '' }; };
    var est = function (d) { d = String(d || '').toUpperCase(); return /^EST/.test(d) ? d : 'ESTRUTURA' + (d ? ' · ' + d : ' METÁLICA (carga)'); };
    if (dados) dados.forEach(function (n, i) {
      var r = base(n.numero || c.nfs[i] || c.nfs[0]);
      r.q = (n.pesoLiquidoKg || n.pesoBrutoKg || 0) / 1000 || (i === 0 ? (c.pesoNFKg || pesoItensCarga(c.itens)) / 1000 : 0);
      r.v = n.valor || 0; r.de = n.emissao || r.de; r.desc = est((n.mercadorias || []).map(function (x) { return x.desc; }).join('; '));
      r.obs = 'Lida da NF-e' + (n.chave ? ' · chave ' + n.chave : '') + (n.volumes ? ' · ' + n.volumes + ' vol.' : ''); r.volumes = n.volumes || 0;
      out.push(r);
    });
    else c.nfs.forEach(function (num, i) {
      var r = base(num);
      r.q = i === 0 ? (c.pesoNFKg || pesoItensCarga(c.itens)) / 1000 : 0; r.v = i === 0 ? (c.valorNF || 0) : 0; r.desc = est(c.mercadoria);
      r.obs = 'Informada na carga' + (c.pesoNFKg ? '' : ' (peso pelos volumes)'); r.volumes = i === 0 ? (c.volumesNF || 0) : 0;
      out.push(r);
    });
  });
  return out;
}
function juntarNFs() {
  var plan = S.nfsPlan || [], tem = {};
  plan.forEach(function (n) { tem[n.f + '|' + n.nf] = 1; if (n.nff) tem[n.f + '|' + n.nff] = 1; });
  S.nfs = plan.concat(nfsDeCargas().filter(function (n) { return !tem[n.f + '|' + n.nf]; }));
}
// ----- leitura automática de NF-e (XML) e romaneios (PDF / planilha) -----
function carregarPDFjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  var base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  return new Promise(function (res, rej) {
    var s = document.createElement('script'); s.src = base + 'pdf.min.js';
    s.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; } catch (e) {} res(window.pdfjsLib); };
    s.onerror = function () { rej(new Error('Não consegui carregar o leitor de PDF.')); };
    document.head.appendChild(s);
  });
}
async function lerArquivoCarga(file, ctx) {
  var nome = file.name, ext = (nome.split('.').pop() || '').toLowerCase();
  if (ext === 'xml') return Sync.lerDocumentoCarga({ nome: nome, xml: await file.text() }, ctx);
  if (ext === 'pdf') { var pdf = await carregarPDFjs(); return Sync.lerDocumentoCarga({ nome: nome, linhas: await Sync.linhasDePDF(pdf, new Uint8Array(await file.arrayBuffer())) }, ctx); }
  var XLSX = await carregarXLSX(), wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }), linhas = [];
  wb.SheetNames.slice(0, 5).forEach(function (n) { linhas = linhas.concat(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })); });
  return Sync.lerDocumentoCarga({ nome: nome, linhas: linhas }, ctx);
}
function situacaoRascunho(r) {
  var rom = String(r.romaneio || '').toUpperCase();
  var ja = (S.cargas || []).find(function (c) { return c.status !== 'CANCELADA' && ((rom && String(c.romaneio || '').toUpperCase() === rom) || (r.nfs.length && (c.nfs || []).some(function (n) { return r.nfs.indexOf(n) >= 0; }) && (!r.fornecedor || c.fornecedor === r.fornecedor))); });
  if (ja) return { cod: ja.status === 'RECEBIDA' ? 'recebida' : 'cadastrada', txt: ja.status === 'RECEBIDA' ? 'carga já recebida' : 'já está nas cargas previstas' };
  var mv = rom && S.movimentos.find(function (m) { return m.natureza === 'ENTRADA' && (String(m.romaneio || '').toUpperCase() === rom || new RegExp('ROM\\. (.*\\b)?' + rom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(m.documento || '')); });
  if (mv) return { cod: 'recebida', txt: 'já chegou: recebimento de ' + fdata(mv.data) + ' em ' + cantNome(mv.canteiroId) };
  return { cod: 'nova', txt: '' };
}
function blocoImportarCargas() {
  var st = F.cgImp || {};
  if (!st.lendo && !st.rascunhos && !st.erros) {
    return podeGravar() ? '<div class="card" id="cgDrop" style="border-style:dashed;text-align:center;padding:18px"><b>Arraste aqui os arquivos das cargas</b> <span class="small muted">— XML da NF-e e romaneio em PDF ou planilha, vários de uma vez. O sistema lê fornecedor, NF, romaneio, placa, canteiro de destino e os volumes, e monta as cargas sozinho.</span></div>' : '';
  }
  var h = '<div class="card" id="cgDrop"><h2>Cargas lidas dos arquivos <span class="sub">confira e registre</span></h2>';
  if (st.lendo) return h + '<p class="small muted">Lendo ' + esc(st.lendo) + '…</p></div>';
  (st.erros || []).forEach(function (e) { h += '<div class="banner bad">' + esc(e) + '</div>'; });
  var R = st.rascunhos || [];
  if (!R.length) return h + '<p class="small muted">Nenhuma carga encontrada nos arquivos.</p><button class="btn" id="cgImpFechar">Fechar</button></div>';
  R.forEach(function (r, i) {
    var sit = situacaoRascunho(r), pv = pesoItensCarga(r.itens) + (r.novos || []).reduce(function (a, n) { return a + (n.criar !== false ? n.qtd * (n.pesoKg || 0) : 0); }, 0), dif = r.pesoNFKg ? pv / 1000 - r.pesoNFKg / 1000 : 0;
    var tiposAmb = {}; r.ambiguos.forEach(function (a) { a.opcoes.forEach(function (o) { tiposAmb[o.tipoId] = 1; }); });
    if (r.incluir == null) r.incluir = sit.cod === 'nova' && !!(r.itens.length || r.pesoNFKg || (r.novos || []).length);
    (r.novos || []).forEach(function (n) { if (n.criar == null) n.criar = podeCadastrar() && !!n.tipoId; });
    h += '<div style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px' + (sit.cod !== 'nova' ? ';opacity:.7' : '') + '">' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-cgi-inc="' + i + '"' + (r.incluir ? ' checked' : '') + '> <b>' + esc(r.fornecedor || 'Fornecedor ?') + '</b></label>' +
      '<span class="small">' + (r.nfs.length ? 'NF ' + esc(r.nfs.join(', ')) : '<span class="tag warn">sem NF</span>') + ' · ' + (r.romaneio ? 'Rom. ' + esc(r.romaneio) : '<span class="tag warn">sem romaneio</span>') + (r.emissao ? ' · emitida ' + fdata(r.emissao) : '') + (r.transporte ? ' · ' + esc(r.transporte) : '') + '</span>' +
      '<span class="tag">' + esc(r.origem) + '</span>' + (sit.txt ? '<span class="tag ' + (sit.cod === 'recebida' ? 'ok' : 'info') + '">' + esc(sit.txt) + '</span>' : '') + '</div>' +
      '<div class="row" style="margin-top:8px"><div class="field" style="max-width:220px"><label>Canteiro de destino</label><select data-cgi-c="' + i + '">' + optList(cantsOrd(true), r.canteiroId || '', function (x) { return x.nome; }, 'Selecione…') + '</select></div>' +
      '<div class="field" style="max-width:180px"><label>Previsão de chegada</label><input type="date" data-cgi-d="' + i + '" value="' + esc(r.previsao || '') + '"></div>' +
      (r.ambiguos.length ? '<div class="field" style="max-width:220px"><label>Tipo dos ' + r.ambiguos.length + ' volume(s) sem tipo</label><select data-cgi-t="' + i + '">' + optList(Object.keys(tiposAmb).map(function (t) { return { id: t }; }), r.tipoAmb || '', function (x) { return x.id; }, 'Escolha…') + '</select></div>' : '') + '</div>' +
      '<div class="small">' + (r.itens.length ? 'Volumes reconhecidos: ' + resumoTiposCarga(r.itens) + ' · <b>' + nf(pv / 1000, 2) + ' t</b>' : ((r.novos || []).length ? '<span class="tag info">' + r.novos.reduce(function (a, n) { return a + n.qtd; }, 0) + ' volume(s) ainda sem cadastro — veja abaixo</span>' : '<span class="tag warn">nenhum volume reconhecido</span>') + (r.produtos && !(r.novos || []).length ? ' <span class="muted">a NF descreve: ' + esc(r.produtos.slice(0, 3).join('; ')) + '</span>' : '')) +
      (r.pesoNFKg ? ' · peso da NF ' + nf(r.pesoNFKg / 1000, 2) + ' t' + (r.itens.length || (r.novos || []).length ? (Math.abs(dif) <= Math.max(0.05 * r.pesoNFKg / 1000, 0.3) ? ' <span class="tag ok">peso confere</span>' : ' <span class="tag warn">diferença ' + (dif > 0 ? '+' : '') + nf(dif, 2) + ' t</span>') : '') : '') + '</div>' +
      (r.nfDados && r.nfDados.length ? '<div class="small" style="margin-top:4px">' + r.nfDados.map(function (n) { return '<b>NF ' + esc(n.numero) + (n.serie ? '-' + esc(n.serie) : '') + '</b>: ' + esc((n.mercadorias || []).map(function (x) { return x.desc + ' (' + nf(x.qtd, 3) + ' ' + x.un + ')'; }).join('; ')) + (n.volumes ? ' · ' + nf(n.volumes) + ' vol.' + (n.especie ? ' ' + esc(n.especie) : '') : '') + (n.pesoBrutoKg ? ' · bruto ' + nf(n.pesoBrutoKg / 1000, 3) + ' t' : '') + (n.pesoLiquidoKg ? ' · líquido ' + nf(n.pesoLiquidoKg / 1000, 3) + ' t' : '') + (n.valor ? ' · ' + brl(n.valor) : '') + (n.chave ? ' · <span class="mono">' + esc(n.chave) + '</span>' : ''); }).join('<br>') + '</div>' : '') +
      (tiposDoFornecedor(r.fornecedor).length ? '<div class="small muted">Tipos da ' + esc(r.fornecedor) + (r.fornecedorDeduzido ? ' (fornecedor identificado pelos tipos das peças)' : '') + ': ' + tiposDoFornecedor(r.fornecedor).map(esc).join(', ') + '</div>' : (r.fornecedor ? '<div class="small"><span class="tag warn">' + esc(r.fornecedor) + ' não tem tipos cadastrados</span> <span class="muted">— defina o fornecedor de cada tipo em Tipos e volumes</span></div>' : '<div class="small"><span class="tag warn">fornecedor não identificado</span></div>')) +
      ((r.foraFornecedor || []).length ? '<div class="banner warn" style="margin:6px 0 0;padding:8px 10px">' + r.foraFornecedor.length + ' linha(s) com peça de tipo de outro fornecedor — não entram na carga: ' + r.foraFornecedor.slice(0, 6).map(function (x) { return esc(x.nome) + ' (' + x.tipos.map(function (t) { return esc(t) + ' é da ' + esc(fornecedorDoTipo(t) || '?'); }).join(', ') + ')'; }).join('; ') + (r.foraFornecedor.length > 6 ? '…' : '') + '. Confira se o arquivo é mesmo deste fornecedor.</div>' : '') +
      (r.pesoRomaneioKg ? '<div class="small muted">Peso somado no romaneio: ' + nf(r.pesoRomaneioKg / 1000, 3) + ' t</div>' : '') +
      (r.uds && r.uds.length ? '<details class="small" style="margin-top:4px"><summary>' + r.uds.length + ' unidade(s) de despacho no romaneio (cada uma é um volume)</summary><div class="tw" style="margin-top:6px"><table><thead><tr><th>UD</th><th>Descrição</th><th>Material (SKU)</th><th class="n">Qtd SKU</th><th class="n">Peso (kg)</th></tr></thead><tbody>' + r.uds.map(function (u) { return '<tr><td class="mono">' + esc(u.ud) + '</td><td>' + esc(u.desc) + '</td><td>' + esc(u.sku) + '</td><td class="n">' + nf(u.qtdSku) + '</td><td class="n">' + nf(u.pesoTotal, 0) + '</td></tr>'; }).join('') + '</tbody></table></div></details>' : '') +
      tabelaNovosRascunho(r, i) +
      (r.naoReconhecidos.length ? '<details class="small" style="margin-top:4px"><summary>' + r.naoReconhecidos.length + ' linha(s) do arquivo que parecem volumes mas não estão no cadastro</summary><ul style="margin:4px 0">' + r.naoReconhecidos.slice(0, 30).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' : '') +
      '<div class="small muted" style="margin-top:4px">Arquivo(s): ' + esc(r.arquivos.join(', ')) + ' · <a href="#" data-cgi-rev="' + i + '">revisar volumes</a></div></div>';
  });
  var n = R.filter(function (r) { return r.incluir; }).length;
  return h + '<div style="display:flex;gap:8px"><button class="btn pri" id="cgImpGravar"' + (n ? '' : ' disabled') + '>Registrar ' + n + ' carga(s)</button><button class="btn" id="cgImpFechar">Descartar</button></div></div>';
}
function itensDoRascunho(r) {
  var it = r.itens.slice();
  if (r.tipoAmb) r.ambiguos.forEach(function (a) { var o = a.opcoes.find(function (x) { return x.tipoId === r.tipoAmb; }); if (o) it.push({ tipoId: o.tipoId, componenteId: o.componenteId, qtd: a.qtd }); });
  var m = {}, out = []; it.forEach(function (i) { var k = i.tipoId + '|' + i.componenteId; if (!m[k]) { m[k] = { tipoId: i.tipoId, componenteId: i.componenteId, qtd: 0 }; out.push(m[k]); } m[k].qtd += i.qtd; });
  return out;
}
async function processarArquivosCarga(files) {
  files = Array.prototype.slice.call(files || []); if (!files.length) return;
  var ctx = { tipos: S.tipos, canteiros: S.canteiros, fornecedores: listaFornecedores().concat(S.tipos.map(function (t) { return t.fornecedor; }).filter(Boolean)) };
  ctx.cat = Sync.catalogo(S.tipos);
  var ant = (F.cgImp && F.cgImp.rascunhos) || [], lidos = [], erros = [];
  for (var i = 0; i < files.length; i++) {
    F.cgImp = { lendo: files[i].name + (files.length > 1 ? ' (' + (i + 1) + ' de ' + files.length + ')' : '') }; render(true);
    try { lidos.push(await lerArquivoCarga(files[i], ctx)); } catch (e) { console.error(e); erros.push(files[i].name + ': ' + (e.message || e)); }
  }
  var R = Sync.juntarRascunhos(ant.concat(lidos));
  R.forEach(function (r) {
    if (!r.previsao) { var d = r.emissao ? new Date(r.emissao + 'T12:00:00') : new Date(); d.setDate(d.getDate() + 2); var t = d.toISOString().slice(0, 10); r.previsao = t < hoje() ? hoje() : t; }
    if (!r.tipoAmb && r.ambiguos.length) { var cnt = {}; r.itens.forEach(function (x) { cnt[x.tipoId] = (cnt[x.tipoId] || 0) + 1; }); var best = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0]; if (best && r.ambiguos.every(function (a) { return a.opcoes.some(function (o) { return o.tipoId === best; }); })) r.tipoAmb = best; }
  });
  F.cgImp = { rascunhos: R, erros: erros }; render(true);
}
function ligarImportarCargas() {
  var a = $('#cgArq'); if (a) a.onchange = function () { processarArquivosCarga(a.files); a.value = ''; };
  var dz = $('#cgDrop');
  if (dz && podeGravar()) {
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.style.background = '#fff6ef'; });
    dz.addEventListener('dragleave', function () { dz.style.background = ''; });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.style.background = ''; processarArquivosCarga(e.dataTransfer.files); });
  }
  var R = (F.cgImp && F.cgImp.rascunhos) || [];
  $$('[data-cgi-inc]').forEach(function (x) { x.onchange = function () { R[+x.getAttribute('data-cgi-inc')].incluir = x.checked; render(true); }; });
  $$('[data-cgi-c]').forEach(function (x) { x.onchange = function () { R[+x.getAttribute('data-cgi-c')].canteiroId = x.value; }; });
  $$('[data-cgi-d]').forEach(function (x) { x.onchange = function () { R[+x.getAttribute('data-cgi-d')].previsao = x.value; }; });
  $$('[data-cgi-t]').forEach(function (x) { x.onchange = function () { R[+x.getAttribute('data-cgi-t')].tipoAmb = x.value; render(true); }; });
  $$('[data-cgi-rev]').forEach(function (x) {
    x.onclick = async function (e) {
      e.preventDefault(); var r = R[+x.getAttribute('data-cgi-rev')];
      var er = validarNovos([r]); if (er.length) { F.cgImp.erros = er; render(true); return; }
      try { var extra = await criarVolumesNovos([r]); } catch (err) { F.cgImp.erros = [errMsg(err)]; render(true); return; }
      formCarga(null, Object.assign(r, { itens: itensDoRascunho(r).concat(extra.get(r) || []), ambiguos: [], tipoAmb: '', novos: [] }));
    };
  });
  $$('[data-cgn]').forEach(function (x) {
    var p = x.getAttribute('data-cgn').split(':'), n = R[+p[0]].novos[+p[1]], k = p[2];
    var ap = function () { n[k] = k === 'criar' ? x.checked : k === 'qtd' || k === 'metros' ? Number(x.value) : k === 'pesoKg' ? (x.value === '' ? null : Number(x.value)) : x.value.trim().toUpperCase(); if (k === 'criar' || k === 'tipoId') render(true); };
    x.onchange = ap;
  });
  var f = $('#cgImpFechar'); if (f) f.onclick = function () { F.cgImp = null; render(true); };
  var g = $('#cgImpGravar');
  if (g) g.onclick = async function () {
    var sel = R.filter(function (r) { return r.incluir; }), erros = [];
    sel.forEach(function (r) {
      var nome = (r.fornecedor || '?') + ' ' + (r.romaneio ? 'rom. ' + r.romaneio : 'NF ' + r.nfs.join(','));
      if (!r.canteiroId) erros.push(nome + ': escolha o canteiro de destino.');
      if (r.ambiguos.length && !r.tipoAmb) erros.push(nome + ': escolha o tipo dos volumes sem tipo.');
      if (!r.nfs.length && !r.romaneio) erros.push(nome + ': sem NF e sem romaneio.');
      errosFornecedor(r.fornecedor, itensDoRascunho(r)).forEach(function (e) { erros.push(nome + ': ' + e); });
    });
    erros = erros.concat(validarNovos(sel));
    if (erros.length) { F.cgImp.erros = erros; render(true); return; }
    g.disabled = true; g.textContent = 'Gravando…';
    var ok = 0, extras;
    try { extras = await criarVolumesNovos(sel); } catch (e) { F.cgImp.erros = ['Não consegui cadastrar os volumes novos: ' + errMsg(e)]; render(true); return; }
    for (var i = 0; i < sel.length; i++) {
      var r = sel[i], agora = new Date().toISOString();
      try {
        await Store.set('planejamento', newId('cg_'), { status: 'PREVISTA', canteiroId: r.canteiroId, previsao: r.previsao || '', fornecedor: r.fornecedor || '', nfs: r.nfs, romaneio: r.romaneio || '', transporte: r.transporte || '', obs: 'Lida de ' + r.arquivos.join(', '),
          itens: itensDoRascunho(r).concat(extras.get(r) || []), pesoNFKg: r.pesoNFKg || 0, nfDados: r.nfDados || [], uds: r.uds || [], pesoRomaneioKg: r.pesoRomaneioKg || 0, mercadoria: mercadoriaDe(r), volumesNF: volumesNFDe(r), valorNF: valorNFDe(r), arquivos: r.arquivos, origem: r.origem, emissao: r.emissao || '', criadoEm: agora, atualizadoEm: agora, criadoPor: S.uid || null });
        ok++; R.splice(R.indexOf(r), 1);
      } catch (e) { erros.push(errMsg(e)); }
    }
    F.cgImp = R.length || erros.length ? { rascunhos: R, erros: erros } : null;
    toast(ok + ' carga(s) registrada(s)'); render(true);
  };
}

function tabelaNovosRascunho(r, i) {
  var N = r.novos || []; if (!N.length) return '';
  var codigos = S.tipos.map(function (t) { return t.id; }), tiposNovos = {}, TFr = tiposDoFornecedor(r.fornecedor);
  if (TFr.length) codigos = TFr.concat(codigos.filter(function (c) { return TFr.indexOf(c) < 0 && !fornecedorDoTipo(c); }));
  N.forEach(function (n) { if (n.criar && n.tipoId && codigos.indexOf(n.tipoId) < 0) tiposNovos[n.tipoId] = 1; });
  var h = '<details open style="margin-top:8px"><summary class="small"><b>' + N.length + ' volume(s) que não estão no cadastro</b> — ' + (podeCadastrar() ? 'marque os que devem ser cadastrados; eles entram na carga e passam a ter controle de estoque' : '<span class="tag warn">só o dono ou Editores podem cadastrar volumes novos</span>') + '</summary>' +
    '<datalist id="cgTiposDL">' + codigos.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</datalist>' +
    '<div class="tw" style="margin-top:6px"><table><thead><tr><th>Cadastrar</th><th>Tipo de torre</th><th>Grupo</th><th>Volume</th><th class="n">Qtd</th><th class="n">Peso unit. (kg)</th><th class="n" title="Para cabo de estai: metros de cordoalha em cada volume">m / volume</th></tr></thead><tbody>' +
    N.map(function (n, k) {
      var a = 'data-cgn="' + i + ':' + k + ':', dis = podeCadastrar() ? '' : ' disabled';
      var tnovo = n.tipoId && codigos.indexOf(n.tipoId) < 0;
      return '<tr><td><input type="checkbox" ' + a + 'criar"' + (n.criar ? ' checked' : '') + dis + '></td>' +
        '<td><input ' + a + 'tipoId" list="cgTiposDL" value="' + esc(n.tipoId || '') + '" placeholder="Ex.: V1EL" style="width:90px"' + dis + '>' + (tnovo && n.criar ? ' <span class="tag info">tipo novo</span>' : '') + (!n.tipoId && n.criar ? ' <span class="tag warn">informe</span>' : '') + '</td>' +
        '<td><input ' + a + 'grupo" value="' + esc(n.grupo || '') + '" style="width:90px" title="TB = corpo/básica; EXT6, EXT4,5… = extensão; PERNA3, PERNA4,5… = perna; AP/STB = stub; PINO; CALOTA"' + dis + '></td>' +
        '<td><input ' + a + 'nome" value="' + esc(n.nome) + '" style="min-width:240px"' + dis + '></td>' +
        '<td class="n"><input class="num" type="number" min="1" step="1" ' + a + 'qtd" value="' + esc(n.qtd) + '" style="width:70px"' + dis + '></td>' +
        '<td class="n"><input class="num" type="number" min="0" step="0.001" ' + a + 'pesoKg" value="' + esc(n.pesoKg == null ? '' : n.pesoKg) + '" style="width:90px"' + dis + '></td>' +
        '<td class="n">' + (String(n.grupo).toUpperCase() === 'ESTAI' ? '<input class="num" type="number" min="0" step="1" ' + a + 'metros" value="' + esc(n.metros || '') + '" style="width:80px"' + dis + '>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  if (Object.keys(tiposNovos).length) h += '<p class="small muted" style="margin:6px 0 0">Tipo(s) novo(s) ' + Object.keys(tiposNovos).map(esc).join(', ') + ' serão criados como autoportante. Depois confira a estrutura e a regra de montagem em <a href="#tipos">Tipos e volumes</a> e inclua as torres na lista de construção pela planilha.</p>';
  return h + '</details>';
}
function validarNovos(lista) {
  var er = [];
  lista.forEach(function (r) {
    (r.novos || []).filter(function (n) { return n.criar; }).forEach(function (n) {
      if (!podeCadastrar()) { er.push('Somente o dono ou Editores podem cadastrar volumes novos (' + n.nome + ').'); return; }
      if (!n.tipoId) er.push(n.nome + ': informe o tipo de torre.');
      else if (!/^[A-Za-z0-9_.~:@+-]+$/.test(n.tipoId)) er.push(n.tipoId + ': código de tipo inválido.');
      else { var ft = fornecedorDoTipo(n.tipoId), F = String(r.fornecedor || '').toUpperCase(); if (ft && F && ft !== F) er.push(n.nome + ': o tipo ' + n.tipoId + ' é da ' + ft + ', não da ' + F + '.'); }
      if (!n.nome) er.push('Há volume novo sem nome.');
      if (!n.grupo) er.push(n.nome + ': informe o grupo.');
      if (!(n.qtd > 0) || Math.floor(n.qtd) !== n.qtd) er.push(n.nome + ': quantidade inválida.');
    });
  });
  return er.filter(function (e, i, a) { return a.indexOf(e) === i; });
}
// Cadastra os volumes (e tipos) novos marcados e devolve, por rascunho, os itens que eles geram na carga
async function criarVolumesNovos(lista) {
  var porTipo = {}, saida = new Map();
  lista.forEach(function (r) {
    (r.novos || []).filter(function (n) { return n.criar; }).forEach(function (n) {
      var t = porTipo[n.tipoId];
      if (!t) {
        var ex = tipoById(n.tipoId);
        t = porTipo[n.tipoId] = ex ? { id: ex.id, novo: false, doc: Object.assign({}, ex, { volumes: (ex.volumes || []).map(function (v) { return Object.assign({}, v); }) }), mudou: false }
          : { id: n.tipoId, novo: true, mudou: true, doc: { codigo: n.tipoId, nome: 'Autoportante', estrutura: 'Autoportante', fixacao: '', fornecedor: r.fornecedor || '', regra: { modo: 'autoportante', stubs: 4, fixos: ['TB'] }, volumes: [] } };
        delete t.doc.id;
      }
      var v = t.doc.volumes.find(function (x) { return String(x.nome).toUpperCase() === n.nome && String(x.grupo).toUpperCase() === n.grupo; });
      if (!v) { v = { id: newId('v'), nome: n.nome, grupo: n.grupo, pesoKg: n.pesoKg == null ? null : n.pesoKg }; if (n.metros) v.metros = n.metros; t.doc.volumes.push(v); t.mudou = true; }
      else if (n.metros && !v.metros) { v.metros = n.metros; t.mudou = true; }
      if (!saida.has(r)) saida.set(r, []);
      saida.get(r).push({ tipoId: t.id, componenteId: v.id, qtd: n.qtd });
    });
  });
  var ids = Object.keys(porTipo);
  for (var i = 0; i < ids.length; i++) { var t = porTipo[ids[i]]; if (t.mudou) await gravarComRetry('tipos', t.id, t.doc); }
  lista.forEach(function (r) { (r.novos || []).forEach(function (n) { if (n.criar) n.criado = true; }); r.novos = (r.novos || []).filter(function (n) { return !n.criado; }); });
  return saida;
}

// ===== ZERAR DADOS E RECOMEÇAR (com backup antes) =====
function blocoZerar() {
  if (!podeCadastrar()) return '';
  var st = S.zerar || {};
  var h = '<div class="card" style="border-color:#f1cdca"><h2>Zerar dados e recomeçar <span class="sub">para reconstruir o estoque do zero a partir da planilha da empreiteira</span></h2>';
  if (st.rodando) return h + '<div class="bar" style="height:10px;margin:8px 0"><i style="width:' + (st.total ? Math.round(100 * st.feito / st.total) : 0) + '%"></i></div><p class="small">' + esc(st.etapa || '') + ' · ' + nf(st.feito || 0) + ' de ' + nf(st.total || 0) + '</p></div>';
  if (st.fim) h += '<div class="banner ' + (st.falhas ? 'warn' : 'info') + '">' + (st.falhas ? 'Terminou com ' + st.falhas + ' falha(s): clique de novo em zerar para apagar o que sobrou.' : 'Dados zerados. Agora envie a planilha da empreiteira no quadro <b>Atualizar estoque pela planilha da empreiteira</b>, acima.') + '</div>';
  var n = function (c) { return nf(c); };
  h += '<div class="grid2"><div><p class="small" style="margin-top:0"><b>Será apagado</b></p><ul class="small" style="margin:0;padding-left:18px">' +
    '<li>' + n(S.movimentos.length) + ' lançamentos (recebimentos, aplicações, transferências, ajustes)</li>' +
    '<li>' + n(S.transferencias.length) + ' transferências / remanejamentos</li>' +
    '<li>' + n((S.cargas || []).length) + ' cargas (previstas e recebidas)</li>' +
    '<li>' + n((S.nfsPlan || []).length) + ' NFs do controle de NFs</li>' +
    '<li>Lista de construção (' + n(S.torres.length) + ' torres) e o registro das importações</li></ul></div>' +
    '<div><p class="small" style="margin-top:0"><b>Fica guardado</b> (a planilha da empreiteira não traz isso)</p><ul class="small" style="margin:0;padding-left:18px">' +
    '<li>Tipos de torre, volumes, regras de montagem e fornecedor de cada tipo</li><li>Canteiros e configurações</li><li>Metragem de estai por torre (TAP)</li><li>Tramos de prioridade que você salvou</li></ul></div></div>' +
    '<p class="small" style="margin:12px 0 8px">Antes de apagar, o sistema baixa um <b>arquivo de backup</b> com todos os dados atuais. Sem o backup, nada é apagado.</p>' +
    '<div class="row"><div class="field" style="max-width:260px"><label>Para confirmar, digite ZERAR</label><input id="zrConf" autocomplete="off"></div><div class="field" style="flex:0 0 auto"><button class="btn danger" id="zrBtn" disabled>Baixar backup e zerar</button></div></div>';
  return h + '</div>';
}
function ligarZerar() {
  var i = $('#zrConf'), b = $('#zrBtn'); if (!i || !b) return;
  i.oninput = function () { b.disabled = i.value.trim().toUpperCase() !== 'ZERAR'; };
  b.onclick = async function () {
    b.disabled = true; b.textContent = 'Gerando backup…';
    var cols = ['tipos', 'canteiros', 'config', 'projeto', 'planejamento', 'movimentos', 'transferencias'], dump = { exportadoEm: new Date().toISOString(), obra: S.config.nomeObra || '', colecoes: {} };
    try { for (var k = 0; k < cols.length; k++) dump.colecoes[cols[k]] = await Store.query(cols[k], []); }
    catch (e) { toast('Não consegui ler os dados para o backup: ' + errMsg(e), true); render(true); return; }
    var salvo = false;
    try { var dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; if (dl) { await dl.save({ filename: 'backup-estoque-torres-' + hoje() + '.json', data: JSON.stringify(dump) }); salvo = true; } } catch (e) { salvo = false; }
    if (!salvo && !S.db) salvo = true; // modo local de teste: não há download
    if (!salvo) { toast('O backup não foi baixado, então nada foi apagado.', true); render(true); return; }
    var alvo = [];
    dump.colecoes.movimentos.forEach(function (d) { alvo.push(['movimentos', d.id]); });
    dump.colecoes.transferencias.forEach(function (d) { alvo.push(['transferencias', d.id]); });
    dump.colecoes.planejamento.forEach(function (d) { if (/^cg_/.test(d.id)) alvo.push(['planejamento', d.id]); });
    dump.colecoes.projeto.forEach(function (d) { if (d.id !== 'estai') alvo.push(['projeto', d.id]); });
    S.zerar = { rodando: true, total: alvo.length, feito: 0, etapa: 'Apagando' }; render(true);
    var falhas = 0;
    for (var j = 0; j < alvo.length; j++) {
      try { await Store.del(alvo[j][0], alvo[j][1]); } catch (e) { falhas++; console.error(e); }
      S.zerar.feito = j + 1; S.zerar.etapa = 'Apagando ' + alvo[j][0];
      if (j % 25 === 0 || j === alvo.length - 1) render(true);
    }
    S.impEst = {}; S.zerar = { fim: true, falhas: falhas }; render(true);
    toast(falhas ? 'Zerado com ' + falhas + ' falha(s)' : 'Dados zerados: envie a planilha da empreiteira', !!falhas);
  };
}
// ===================== CONTROLE DE NFs: empreiteira × controle interno =====================
function contratante() { return (S.config && S.config.nomeContratante) || 'contratante'; }
var ST_CZ = { confere: ['Confere', 'ok'], peso: ['Peso diferente', 'warn'], so_emp: ['Só na empreiteira', 'bad'], so_int: ['Só no controle interno', 'info'] };
var ALERTAS_NF = {
  atraso: 'NF do controle interno que não aparece na planilha da empreiteira há mais de 7 dias',
  so_emp: 'Na planilha da empreiteira, mas a NF não está no controle interno',
  peso: 'Peso diferente entre as duas planilhas (acima de 5% ou 0,3 t)',
  troca: 'Romaneio lançado na NF errada (no controle interno é de outra NF)',
  romaneio: 'Romaneio da empreiteira que não aparece no controle interno',
  canteiro: 'Canteiro diferente entre as duas planilhas',
  doiscant: 'Mesma NF lançada em mais de um canteiro',
  data: 'Data de recebimento diferente da entrega (mais de 3 dias)',
  rnc: 'RNC ou observação registrada pela empreiteira',
  semnf: 'Lançamento da empreiteira sem número de NF',
  valor: 'Valor da NF diferente entre as duas planilhas',
  naoenviada: 'Recebida na obra há mais de 3 dias e NF ainda não enviada ao contratante',
  dup: 'NF repetida na planilha da empreiteira',
  sempeso: 'Sem peso na planilha da empreiteira'
};
function fonteEmp() { return (S.nfsCtrl || []).length ? S.nfsCtrl : (S.nfsEmp || []); }
function cruzamentoNF() {
  var m = M(); if (m.cz) return m.cz;
  var int = (S.nfsPlan || []).filter(C.ehEstrutura);
  var envs = fonteEmp().filter(function (e) { return e.enviado && e.d1; }).map(function (e) { return e.d1; }).sort();
  var g = Sync.cruzarNFs(fonteEmp(), int, { hoje: hoje(), envDesde: envs[0] || '', contratante: contratante() });
  g.forEach(function (x) {
    x.alertas = x.flags.map(function (f) { return f.k; });
    if (x.status === 'so_int' && x.diasSemLancar > 7) x.alertas.push('atraso');
    if (x.status === 'so_emp') x.alertas.push('so_emp');
    if (x.status === 'peso') x.alertas.push('peso');
  });
  return (m.cz = g);
}
function cantDe(t) { var s = String(t || '').split(' - ')[0].trim(); var c = S.canteiros.find(function (x) { return String(x.nome).toUpperCase() === s.toUpperCase(); }); return c ? c.nome : s.replace(/(^|\s)\S/g, function (z) { return z.toUpperCase(); }).replace(/\B\S/g, function (z) { return z.toLowerCase(); }); }
function abasNotas() {
  var a = F.notas.aba || 'cruz';
  return '<div class="seg" style="margin-bottom:16px">' + [['cruz', 'Empreiteira × controle interno'], ['emp', 'Notas da empreiteira'], ['estoque', 'NFs × lançamentos no estoque']].map(function (x) { return '<button class="btn' + (a === x[0] ? ' pri' : '') + '" data-nfaba="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
}
function filtrarCZ(g, f) {
  var q = (f.cq || '').trim().toUpperCase();
  return g.filter(function (x) {
    if (f.cst === 'bate') { if (!(x.int.length && x.emp.length && !czDiverge(x))) return false; }
    else if (f.cst === 'diverge') { if (!(x.int.length && x.emp.length && czDiverge(x))) return false; }
    else if (f.cst && x.status !== f.cst) return false;
    if (f.cal && x.alertas.indexOf(f.cal) < 0) return false;
    if (f.cf && x.fornecedor !== f.cf) return false;
    if (f.cc) { var cn = (cantById(f.cc) || {}).nome || ''; var cs = x.int.map(function (n) { return cantDe(n.can); }).concat([].concat.apply([], x.emp.map(function (e) { return e.cants; }))); if (cs.indexOf(cn) < 0) return false; }
    if (q && !x.int.some(function (n) { return n.nf === q || n.nff === q || (n.rom || []).some(function (r) { return String(r).toUpperCase().indexOf(q) >= 0; }); }) && !x.emp.some(function (e) { return e.nfs.indexOf(q) >= 0 || e.nfTxt === q || e.roms.some(function (r) { return String(r).toUpperCase().indexOf(q) >= 0; }); })) return false;
    return true;
  });
}
// ----- contagem por nota: o que falta em cada planilha e o que bate / diverge -----
var DIVERGE_K = ['peso', 'valor', 'canteiro', 'romaneio', 'troca', 'data', 'dup', 'doiscant'];
function czDiverge(x) { return x.status === 'peso' || x.flags.some(function (f) { return DIVERGE_K.indexOf(f.k) >= 0; }); }
function notasPorSituacao(g) {
  var base = function (v) { return String(v || '').toUpperCase().replace(/[A-Z]+$/, ''); };
  var r = { int: 0, emp: 0, bate: 0, diverge: 0, numero: 0, faltaInt: 0, faltaEmp: 0, porF: {}, listaFaltaInt: [], listaFaltaEmp: [] };
  var F = function (f) { return r.porF[f] = r.porF[f] || { int: 0, emp: 0, bate: 0, diverge: 0, faltaInt: 0, faltaEmp: 0 }; };
  g.forEach(function (x) {
    var dv = czDiverge(x), nEmp = x.emp.reduce(function (a, e) { return a + Math.max(1, e.nfs.length); }, 0);
    var numsEmp = {}; x.emp.forEach(function (e) { e.nfs.forEach(function (n) { numsEmp[n] = 1; numsEmp[base(n)] = 1; }); });
    var pf = F(x.fornecedor);
    r.int += x.int.length; r.emp += nEmp; pf.int += x.int.length; pf.emp += nEmp;
    if (!x.emp.length) { r.faltaEmp += x.int.length; pf.faltaEmp += x.int.length; x.int.forEach(function (n) { r.listaFaltaEmp.push({ f: x.fornecedor, nf: n.nf, nff: n.nff, d: n.dt || n.de, t: n.q, can: n.can }); }); return; }
    if (!x.int.length) { r.faltaInt += nEmp; pf.faltaInt += nEmp; x.emp.forEach(function (e) { r.listaFaltaInt.push({ f: x.fornecedor, nf: e.nfTxt, rom: e.roms.join(', '), d: e.d1, t: e.kg / 1000, can: e.cants.join(', '), carga: e.carga }); }); return; }
    x.int.forEach(function (n) { var achou = numsEmp[n.nf] || numsEmp[base(n.nf)] || (n.nff && numsEmp[String(n.nff)]); if (!achou) { r.numero++; r.diverge++; pf.diverge++; } else if (dv) { r.diverge++; pf.diverge++; } else { r.bate++; pf.bate++; } });
  });
  return r;
}
function blocoResumoNotas(g) {
  var r = notasPorSituacao(g), f = F.notas;
  var cardN = function (k, rot, n, sub, cls) { return '<button class="nr-box ' + cls + (k && f.cst === k ? ' on' : '') + '"' + (k ? ' data-czst="' + k + '"' : '') + '><span>' + rot + '</span><b>' + nf(n) + '</b><small>' + sub + '</small></button>'; };
  var h = '<div class="card"><h2>Notas: o que falta e o que bate <span class="sub">contagem por nota fiscal · clique para filtrar a lista</span></h2><div class="nr-grid">' +
    cardN('', 'Na planilha interna', r.int, 'notas de estrutura', 'neu') +
    cardN('', 'Na planilha da empreiteira', r.emp, 'notas', 'neu') +
    cardN('so_emp', 'Faltam na planilha interna', r.faltaInt, 'estão só na empreiteira', 'bad') +
    cardN('so_int', 'Faltam na planilha da empreiteira', r.faltaEmp, 'estão só na interna', 'info') +
    cardN('bate', 'Batendo', r.bate, 'nas duas, sem diferença', 'ok') +
    cardN('diverge', 'Divergentes', r.diverge, 'nas duas, com diferença' + (r.numero ? ' (' + nf(r.numero) + ' com nº diferente)' : ''), 'warn') + '</div>';
  var fs = Object.keys(r.porF).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  var red = function (v) { return v ? '<span class="neg">' + nf(v) + '</span>' : '0'; };
  h += '<div class="tw tw-flat" style="margin-top:14px"><table class="tab-linhas"><thead><tr><th>Fornecedor</th><th class="n">Planilha interna</th><th class="n">Planilha empreiteira</th><th class="n">Batendo</th><th class="n">Divergentes</th><th class="n">Faltam na interna</th><th class="n">Faltam na empreiteira</th></tr></thead><tbody>' +
    fs.map(function (k) { var x = r.porF[k]; return '<tr><td><b>' + esc(k) + '</b></td><td class="n">' + nf(x.int) + '</td><td class="n">' + nf(x.emp) + '</td><td class="n">' + nf(x.bate) + '</td><td class="n">' + red(x.diverge) + '</td><td class="n">' + red(x.faltaInt) + '</td><td class="n">' + red(x.faltaEmp) + '</td></tr>'; }).join('') +
    '<tr><td><b>Total</b></td><td class="n"><b>' + nf(r.int) + '</b></td><td class="n"><b>' + nf(r.emp) + '</b></td><td class="n"><b>' + nf(r.bate) + '</b></td><td class="n"><b>' + nf(r.diverge) + '</b></td><td class="n"><b>' + nf(r.faltaInt) + '</b></td><td class="n"><b>' + nf(r.faltaEmp) + '</b></td></tr></tbody></table></div>';
  h += '<div class="nr-faltas"><details><summary><b>' + nf(r.faltaInt) + ' notas faltando na planilha interna</b> <span class="small muted">— estão na planilha da empreiteira</span></summary>' + listaFaltas(r.listaFaltaInt, true) + '</details>' +
    '<details><summary><b>' + nf(r.faltaEmp) + ' notas faltando na planilha da empreiteira</b> <span class="small muted">— estão na planilha interna</span></summary>' + listaFaltas(r.listaFaltaEmp, false) + '</details>' +
    '<div style="display:flex;justify-content:flex-end"><button class="btn sm" id="czExpFaltas">Exportar faltas (CSV)</button></div></div>';
  return h + '</div>';
}
function listaFaltas(L, daEmp) {
  if (!L.length) return '<p class="small muted">Nenhuma.</p>';
  var g = {}; L.forEach(function (x) { (g[x.f] = g[x.f] || []).push(x); });
  return Object.keys(g).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (f) {
    var it = g[f].sort(function (a, b) { return String(b.d).localeCompare(String(a.d)); });
    return '<div class="nr-forn"><div class="nr-fh"><b>' + esc(f) + '</b> <span class="small muted">' + it.length + ' nota(s) · ' + nf(it.reduce(function (a, x) { return a + (Number(x.t) || 0); }, 0), 1) + ' t</span></div><div class="nr-chips">' +
      it.map(function (x) { return '<span class="nr-chip" title="' + esc((daEmp ? 'Romaneio ' + (x.rom || '—') + (x.carga ? ' · carga ' + x.carga : '') : 'NF fornecedor ' + (x.nff || '—')) + ' · ' + fdata(x.d) + ' · ' + (daEmp ? x.can : cantDe(x.can)) + ' · ' + nf(Number(x.t) || 0, 2) + ' t') + '"><b>' + esc(x.nf || 's/ nº') + '</b> <small>' + fdata(x.d) + '</small></span>'; }).join('') + '</div></div>';
  }).join('');
}
function vistaCruzamento() {
  var f = F.notas, h = '';
  var ctrl = (S.nfsCtrl || []).length, temEmp = fonteEmp().length, temInt = (S.nfsPlan || []).length, me = ctrl ? (S.nfcMeta || {}) : (S.nfeMeta || {}), mi = S.nfsMeta || {};
  h += '<div class="grid2" style="margin-bottom:16px"><div class="card" style="margin:0"><h2>Controle de NFs da empreiteira <span class="sub">' + (ctrl ? 'planilha Materiais Controle NF' : (temEmp ? 'provisório: aba LANÇAMENTO da planilha de estoque' : 'planilha Materiais Controle NF')) + '</span></h2>' + (temEmp ? '<p class="small" style="margin:0"><b>' + nf(temEmp) + '</b> notas · ' + esc(me.arquivo || '') + ((me.em || me.atualizadoEm) ? ' · atualizada em ' + fdh(me.em || me.atualizadoEm) : '') + (ctrl ? '' : '<br>Para usar o controle de notas da empreiteira, envie a planilha <i>Materiais Controle NF</i> em <a href="#importar">Importar projeto</a>.') + '</p>' : '<p class="small" style="margin:0">Ainda não carregada. Envie a planilha <i>Materiais Controle NF</i> em <a href="#importar">Importar projeto</a>.</p>') + '</div>' +
    '<div class="card" style="margin:0"><h2>Controle interno de NFs <span class="sub">planilha Controle de NFs</span></h2>' + (temInt ? '<p class="small" style="margin:0"><b>' + nf((S.nfsPlan || []).filter(C.ehEstrutura).length) + '</b> NFs de estrutura · ' + esc(mi.arquivo || '') + (mi.atualizadoEm ? ' · atualizada em ' + fdh(mi.atualizadoEm) : '') + '</p>' : '<p class="small" style="margin:0">Ainda não carregada. Envie em <a href="#importar">Importar projeto → Controle de NFs</a>.</p>') + '</div></div>';
  if (!temEmp && !temInt) return h;
  var g = cruzamentoNF(), cont = {}, ton = {};
  h += blocoResumoNotas(g);
  Object.keys(ST_CZ).forEach(function (k) { cont[k] = 0; ton[k] = 0; });
  g.forEach(function (x) { cont[x.status]++; ton[x.status] += Math.max(x.tInt, x.tEmp); });
  h += '<div class="kpis">' + Object.keys(ST_CZ).map(function (k) {
    return '<div class="kpi" style="cursor:pointer;' + (f.cst === k ? 'outline:2px solid var(--acc)' : '') + '" data-czst="' + k + '"><div class="l"><span class="tag ' + ST_CZ[k][1] + '">' + ST_CZ[k][0] + '</span></div><div class="v">' + nf(cont[k]) + '</div><div class="h">' + nf(ton[k], 1) + ' t' + (k === 'peso' ? ' · dif. ' + nf(g.filter(function (x) { return x.status === 'peso'; }).reduce(function (a, x) { return a + x.delta; }, 0), 1) + ' t' : '') + '</div></div>';
  }).join('') + '</div>';
  // controles sugeridos
  var al = {}; Object.keys(ALERTAS_NF).forEach(function (k) { al[k] = { n: 0, t: 0 }; });
  g.forEach(function (x) { x.alertas.forEach(function (k) { if (al[k]) { al[k].n++; al[k].t += Math.max(x.tInt, x.tEmp); } }); });
  h += '<div class="card"><h2>Controles sugeridos <span class="sub">clique para ver as notas</span></h2><div class="cz-al">' + Object.keys(ALERTAS_NF).map(function (k) {
    var a = al[k]; return '<button class="cz-ali' + (f.cal === k ? ' on' : '') + (a.n ? '' : ' zero') + '" data-czal="' + k + '"><b>' + nf(a.n) + '</b><span>' + esc(ALERTAS_NF[k]) + '</span><small>' + (a.n ? nf(a.t, 1) + ' t' : 'nenhuma') + '</small></button>';
  }).join('') + '</div></div>';
  var L = filtrarCZ(g, f).sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
  var forns = {}; g.forEach(function (x) { forns[x.fornecedor] = 1; });
  f.clim = f.clim || 100;
  h += '<div class="card"><div class="filters"><div class="field"><label>Situação</label><select id="czS"><option value="">Todas</option><option value="bate"' + (f.cst === 'bate' ? ' selected' : '') + '>Batendo (nas duas, sem diferença)</option><option value="diverge"' + (f.cst === 'diverge' ? ' selected' : '') + '>Divergentes (nas duas, com diferença)</option>' + Object.keys(ST_CZ).map(function (k) { return '<option value="' + k + '"' + (f.cst === k ? ' selected' : '') + '>' + ST_CZ[k][0] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Controle</label><select id="czA"><option value="">Todos</option>' + Object.keys(ALERTAS_NF).map(function (k) { return '<option value="' + k + '"' + (f.cal === k ? ' selected' : '') + '>' + esc(ALERTAS_NF[k]) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Fornecedor</label><select id="czF"><option value="">Todos</option>' + Object.keys(forns).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (k) { return '<option' + (f.cf === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Canteiro</label><select id="czC">' + optList(cantsOrd(false), f.cc, function (x) { return x.nome; }, 'Todos') + '</select></div>' +
    '<div class="field" style="flex:1 1 240px"><label>Buscar NF / romaneio</label><input id="czQ" value="' + esc(f.cq || '') + '" placeholder="Nº da NF (controle ou fornecedor) ou romaneio"></div>' +
    '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label><button class="btn" id="czExp">Exportar CSV</button></div></div>' +
    '<p class="small muted" style="margin:-6px 0 10px">' + nf(L.length) + ' carga(s) · as NFs ligadas entre si (mesma célula na empreiteira ou mesmo romaneio) são comparadas juntas.</p>' +
    '<div class="tw tw-flat"><table class="tab-linhas"><thead><tr><th>Situação</th><th>Fornecedor</th><th>Controle interno<br><span class="small">NF controle / fornecedor · entrega · canteiro</span></th><th class="n">Interno (t)</th><th>Empreiteira<br><span class="small">NF · romaneio · recebimento · canteiro</span></th><th class="n">' + ((S.nfsCtrl || []).length ? 'Carga' : 'Volumes') + '</th><th class="n">Empreiteira (t)</th><th class="n">Dif. (t)</th><th>Alertas</th></tr></thead><tbody>' +
    L.slice(0, f.clim).map(function (x) {
      return '<tr><td><span class="tag ' + ST_CZ[x.status][1] + '">' + ST_CZ[x.status][0] + '</span>' + (x.diasSemLancar > 7 ? '<br><span class="small muted">' + x.diasSemLancar + ' dias</span>' : '') + '</td><td><b>' + esc(x.fornecedor) + '</b></td>' +
        '<td class="small">' + (x.int.length ? x.int.map(function (n) { return '<b class="mono">' + esc(n.nf) + '</b>' + (n.nff ? ' / <span class="mono">' + esc(n.nff) + '</span>' : '') + ' · ' + fdata(n.dt || n.de) + ' · ' + esc(cantDe(n.can)) + ((n.rom || []).length ? '<br><span class="muted">rom. ' + esc(n.rom.join(', ')) + '</span>' : ''); }).join('<br>') : '<span class="muted">—</span>') + '</td>' +
        '<td class="n">' + (x.int.length ? nf(x.tInt, 2) : '—') + '</td>' +
        '<td class="small">' + (x.emp.length ? x.emp.map(function (e) { return '<b class="mono">' + esc(e.nfTxt || 's/ nº') + '</b> · rom. ' + esc(e.roms.join(', ') || '—') + ' · ' + fdata(e.d1) + (e.d2 && e.d2 !== e.d1 ? '–' + fdata(e.d2) : '') + ' · ' + esc(e.cants.join(', ')) + '<br><span class="muted">' + esc(e.tipos.length ? e.tipos.join(', ') : [e.valor ? brl(e.valor) : '', e.placa, e.enviado ? 'enviada ' + (/^\d{4}-/.test(e.enviado) ? fdata(e.enviado) : e.enviado) : (e.fonte === 'controle' && e.d1 ? 'não enviada ao ' + contratante() : '')].filter(Boolean).join(' · ')) + '</span>'; }).join('<br>') : '<span class="muted">—</span>') + '</td>' +
        '<td class="n">' + (x.emp.length ? ((S.nfsCtrl || []).length ? esc(x.emp.map(function (e) { return e.carga; }).filter(Boolean).join(', ')) : nf(x.emp.reduce(function (a, e) { return a + e.vol; }, 0))) : '—') + '</td><td class="n">' + (x.emp.length ? nf(x.tEmp, 2) : '—') + '</td>' +
        '<td class="n">' + (x.int.length && x.emp.length ? (Math.abs(x.delta) < 0.005 ? '<span class="zero">0</span>' : '<span class="' + (x.status === 'peso' ? 'neg' : '') + '">' + (x.delta > 0 ? '+' : '') + nf(x.delta, 2) + '</span>') : '') + '</td>' +
        '<td class="small">' + (x.flags.length ? x.flags.map(function (fl) { return '<div>• ' + esc(fl.t) + '</div>'; }).join('') : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' + (L.length > f.clim ? '<div style="text-align:center;margin-top:12px"><button class="btn" id="czMais">Mostrar mais</button></div>' : '') + '</div>';
  return h;
}
function vistaNotasEmp() {
  if ((S.nfsCtrl || []).length) return vistaControleEmp();
  var f = F.notas, E = (S.nfsEmp || []).slice();
  if (!E.length) return '<div class="card empty"><b>Notas da empreiteira ainda não carregadas</b>Envie a planilha da empreiteira em <a href="#importar">Importar projeto</a>.</div>';
  var cz = cruzamentoNF(), sit = new Map(); cz.forEach(function (x) { x.emp.forEach(function (e) { sit.set(e.f + '|' + e.nfTxt, x.status); }); });
  var q = (f.eq || '').trim().toUpperCase(), forns = {}; E.forEach(function (e) { forns[e.f] = 1; });
  var L = E.filter(function (e) {
    if (f.ef && e.f !== f.ef) return false;
    if (f.ec && e.cants.indexOf((cantById(f.ec) || {}).nome) < 0) return false;
    if (f.ernc && !e.rnc.length) return false;
    if (q && e.nfTxt.indexOf(q) < 0 && !e.roms.some(function (r) { return String(r).toUpperCase().indexOf(q) >= 0; }) && e.tipos.join(' ').indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return String(b.d1).localeCompare(String(a.d1)) || a.f.localeCompare(b.f); });
  var tot = L.reduce(function (a, e) { return { v: a.v + e.vol, kg: a.kg + e.kg }; }, { v: 0, kg: 0 });
  f.elim = f.elim || 150;
  var h = '<div class="kpis">' + kpi('Notas', nf(L.length), 'de ' + nf(E.length) + ' na planilha') + kpi('Volumes', nf(tot.v), 'lançados pela empreiteira') + kpi('Peso', nf(tot.kg / 1000, 1) + ' t', 'pela coluna PESO TOTAL') + kpi('Com RNC / observação', nf(L.filter(function (e) { return e.rnc.length; }).length), 'notas com algum registro') + '</div>';
  h += '<div class="card"><div class="filters"><div class="field"><label>Fornecedor</label><select id="neF"><option value="">Todos</option>' + Object.keys(forns).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (k) { return '<option' + (f.ef === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Canteiro</label><select id="neC">' + optList(cantsOrd(false), f.ec, function (x) { return x.nome; }, 'Todos') + '</select></div>' +
    '<div class="field" style="flex:1 1 220px"><label>Buscar NF, romaneio ou tipo</label><input id="neQ" value="' + esc(f.eq || '') + '"></div>' +
    '<div class="field" style="flex:0 0 auto"><label><input type="checkbox" id="neR"' + (f.ernc ? ' checked' : '') + '> Só com RNC</label></div>' +
    '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label><button class="btn" id="neExp">Exportar CSV</button></div></div>' +
    '<div class="tw tw-flat"><table class="tab-linhas"><thead><tr><th>Recebimento</th><th>Fornecedor</th><th>NF</th><th>Romaneio</th><th>Canteiro</th><th>Tipos</th><th class="n">Volumes</th><th class="n">Peso (t)</th><th>No controle interno</th><th>RNC / observação</th></tr></thead><tbody>' +
    L.slice(0, f.elim).map(function (e) { var st = sit.get(e.f + '|' + e.nfTxt); return '<tr><td>' + fdata(e.d1) + (e.d2 && e.d2 !== e.d1 ? ' a ' + fdata(e.d2) : '') + '</td><td><b>' + esc(e.f) + '</b></td><td class="mono"><b>' + esc(e.nfTxt || '—') + '</b></td><td class="mono small">' + esc(e.roms.join(', ')) + '</td><td>' + esc(e.cants.join(', ')) + '</td><td class="small">' + esc(e.tipos.join(', ')) + '</td><td class="n">' + nf(e.vol) + '</td><td class="n">' + nf(e.kg / 1000, 2) + '</td><td>' + (st ? '<span class="tag ' + ST_CZ[st][1] + '">' + ST_CZ[st][0] + '</span>' : '') + '</td><td class="small">' + esc(e.rnc.join('; ')) + '</td></tr>'; }).join('') +
    '</tbody></table></div>' + (L.length > f.elim ? '<div style="text-align:center;margin-top:12px"><button class="btn" id="neMais">Mostrar mais</button></div>' : '') + '</div>';
  return h;
}

function vistaControleEmp() {
  var f = F.notas, E = S.nfsCtrl.slice(), cz = cruzamentoNF(), sit = new Map();
  cz.forEach(function (x) { x.emp.forEach(function (e) { sit.set(e, x); }); });
  var q = (f.eq || '').trim().toUpperCase(), forns = {}; E.forEach(function (e) { forns[e.f] = 1; });
  var L = E.filter(function (e) {
    if (f.ef && e.f !== f.ef) return false;
    if (f.ec && e.cants.indexOf((cantById(f.ec) || {}).nome) < 0) return false;
    if (f.ernc && !e.rnc.length) return false;
    if (f.enenv && (e.enviado || !e.d1)) return false;
    if (q && e.nfTxt.indexOf(q) < 0 && !e.roms.some(function (r) { return String(r).toUpperCase().indexOf(q) >= 0; }) && String(e.carga).toUpperCase() !== q && String(e.placa).toUpperCase().indexOf(q) < 0 && String(e.cte) !== q) return false;
    return true;
  }).sort(function (a, b) { return String(b.d1).localeCompare(String(a.d1)) || a.f.localeCompare(b.f); });
  var tot = L.reduce(function (a, e) { return { kg: a.kg + e.kg, v: a.v + e.valor }; }, { kg: 0, v: 0 }), nEnv = L.filter(function (e) { return e.d1 && !e.enviado; }).length;
  f.elim = f.elim || 150;
  var h = '<div class="kpis">' + kpi('Notas', nf(L.length), 'de ' + nf(E.length) + ' na planilha da empreiteira') + kpi('Peso', nf(tot.kg / 1000, 1) + ' t', 'líquido, ou bruto quando não há líquido') + kpi('Valor', brl(tot.v, tot.v >= 1e6), 'soma do VALOR NF') + kpi('NF não enviada ao ' + esc(contratante()), nf(nEnv), 'recebidas na obra sem data de envio') + '</div>';
  h += '<div class="card"><div class="filters"><div class="field"><label>Fornecedor</label><select id="neF"><option value="">Todos</option>' + Object.keys(forns).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (k) { return '<option' + (f.ef === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Canteiro</label><select id="neC">' + optList(cantsOrd(false), f.ec, function (x) { return x.nome; }, 'Todos') + '</select></div>' +
    '<div class="field" style="flex:1 1 220px"><label>Buscar NF, romaneio, carga, placa ou CT-e</label><input id="neQ" value="' + esc(f.eq || '') + '"></div>' +
    '<div class="field" style="flex:0 0 auto"><label><input type="checkbox" id="neR"' + (f.ernc ? ' checked' : '') + '> Só com RNC</label><label><input type="checkbox" id="neN"' + (f.enenv ? ' checked' : '') + '> Só não enviadas ao ' + esc(contratante()) + '</label></div>' +
    '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label><button class="btn" id="neExp">Exportar CSV</button></div></div>' +
    '<div class="tw tw-flat"><table class="tab-linhas"><thead><tr><th>Carga</th><th>Fornecedor</th><th>NF</th><th>Data NF</th><th>Recebido na obra</th><th>Enviado ao ' + esc(contratante()) + '</th><th>Canteiro</th><th>Romaneio</th><th>CT-e · placa</th><th class="n">Peso (t)</th><th class="n">Valor</th><th>No controle interno</th><th>RNC</th></tr></thead><tbody>' +
    L.slice(0, f.elim).map(function (e) { var x = sit.get(e); return '<tr><td class="mono">' + esc(e.carga) + '</td><td><b>' + esc(e.f) + '</b></td><td class="mono"><b>' + esc(e.nfTxt || '—') + '</b></td><td>' + fdata(e.dataNF) + '</td><td>' + fdata(e.d1) + '</td><td>' + (e.enviado ? (/^\d{4}-/.test(e.enviado) ? fdata(e.enviado) : esc(e.enviado)) : (e.d1 ? '<span class="tag warn">não enviada</span>' : '')) + '</td><td>' + esc(e.cants.join(', ')) + '</td><td class="mono small">' + esc(e.roms.join(', ')) + '</td><td class="small">' + esc([e.cte, e.placa].filter(Boolean).join(' · ')) + '</td><td class="n">' + (e.kg ? nf(e.kg / 1000, 3) : '—') + '</td><td class="n">' + (e.valor ? brl(e.valor) : '—') + '</td><td>' + (x ? '<span class="tag ' + ST_CZ[x.status][1] + '">' + ST_CZ[x.status][0] + '</span>' : '') + '</td><td class="small">' + esc(e.rnc.join('; ')) + '</td></tr>'; }).join('') +
    '</tbody></table></div>' + (L.length > f.elim ? '<div style="text-align:center;margin-top:12px"><button class="btn" id="neMais">Mostrar mais</button></div>' : '') + '</div>';
  return h;
}
function blocoImportarCtrlNF() {
  var st = S.impCtrl || {}, me = S.nfcMeta || {};
  var h = '<div class="card"><h2>Controle de NFs da empreiteira <span class="sub">planilha “Materiais Controle NF” · pode enviar toda semana</span></h2>' +
    '<p style="margin-top:0" class="small">Notas recebidas nas obras pela empreiteira: carga, placa, data da NF, recebido na obra, enviado ao ' + esc(contratante()) + ', canteiro, nota, CT-e, romaneio, RNC, valor e peso. É cruzada com o controle interno de NFs na tela <a href="#notas">Controle de NFs</a>. ' + (me.total ? 'Carregada: <b>' + nf(me.total) + ' notas</b> · ' + esc(me.arquivo || '') + (me.atualizadoEm ? ' em ' + fdh(me.atualizadoEm) : '') + '.' : 'Ainda não carregada.') + '</p>';
  if (!podeCadastrar()) return h + '</div>';
  h += '<label class="btn"' + (st.lendo ? ' style="opacity:.5;pointer-events:none"' : '') + '>Escolher planilha…<input type="file" id="ctrlArq" accept=".xlsx,.xlsm,.xls" hidden></label>';
  if (st.lendo) h += ' <span class="small muted">Lendo…</span>';
  if (st.msg) h += '<div class="banner ' + (st.erro ? 'bad' : 'info') + '" style="margin-top:10px">' + esc(st.msg) + '</div>';
  return h + '</div>';
}
function ligarImportarCtrlNF() {
  var a = $('#ctrlArq'); if (!a) return;
  a.onchange = async function () {
    var file = a.files && a.files[0]; if (!file) return;
    S.impCtrl = { lendo: true }; render(true);
    try {
      var XLSX = await carregarXLSX(), wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true }), lista = null;
      for (var i = 0; i < wb.SheetNames.length && !lista; i++) { var L = Sync.linhasAba(XLSX, wb.Sheets[wb.SheetNames[i]]); if (Sync.ehControleNFEmp(L)) lista = Sync.lerControleNFEmp(L); }
      if (!lista) throw new Error('Não encontrei a aba com FORNECEDOR, NOTA, ROMANEIO e RECEBIDO NA OBRA.');
      var partes = []; for (var p = 0; p < lista.length; p += 250) partes.push(lista.slice(p, p + 250));
      for (var k = 0; k < partes.length; k++) await gravarComRetry('projeto', 'nfc_' + k, { lista: partes[k] });
      await gravarComRetry('projeto', 'nfc_meta', { partes: partes.length, total: lista.length, arquivo: file.name, atualizadoEm: new Date().toISOString() });
      S.impCtrl = { msg: nf(lista.length) + ' notas carregadas. Veja o cruzamento em Controle de NFs.' };
    } catch (e) { console.error(e); S.impCtrl = { erro: true, msg: 'Não consegui ler: ' + (e.message || e) }; }
    render(true);
  };
}
function ligarNotasNovas() {
  var f = F.notas;
  $$('[data-nfaba]').forEach(function (b) { b.onclick = function () { f.aba = b.getAttribute('data-nfaba'); render(); }; });
  $$('[data-czst]').forEach(function (k) { k.onclick = function () { var s = k.getAttribute('data-czst'); f.cst = f.cst === s ? '' : s; f.clim = 100; render(); }; });
  $$('[data-czal]').forEach(function (k) { k.onclick = function () { var s = k.getAttribute('data-czal'); f.cal = f.cal === s ? '' : s; f.clim = 100; render(); }; });
  [['#czS', 'cst'], ['#czA', 'cal'], ['#czF', 'cf'], ['#czC', 'cc'], ['#neF', 'ef'], ['#neC', 'ec']].forEach(function (p) { var e = $(p[0]); if (e) e.onchange = function () { f[p[1]] = e.value; f.clim = 100; f.elim = 150; render(); }; });
  [['#czQ', 'cq'], ['#neQ', 'eq']].forEach(function (p) { var e = $(p[0]), tm; if (e) e.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { f[p[1]] = e.value; render(); }, 250); }; });
  var r = $('#neR'); if (r) r.onchange = function () { f.ernc = r.checked; render(); };
  var nn = $('#neN'); if (nn) nn.onchange = function () { f.enenv = nn.checked; render(); };
  var m1 = $('#czMais'); if (m1) m1.onclick = function () { f.clim += 200; render(); };
  var m2 = $('#neMais'); if (m2) m2.onclick = function () { f.elim += 300; render(); };
  var xf = $('#czExpFaltas'); if (xf) xf.onclick = function () {
    var r = notasPorSituacao(cruzamentoNF()), L = [['Falta em', 'Fornecedor', 'NF', 'NF fornecedor / romaneio', 'Data', 'Canteiro', 'Peso (t)']];
    r.listaFaltaInt.forEach(function (x) { L.push(['Planilha interna', x.f, x.nf, x.rom || '', fdata(x.d), x.can, String(Math.round((x.t || 0) * 1000) / 1000).replace('.', ',')]); });
    r.listaFaltaEmp.forEach(function (x) { L.push(['Planilha da empreiteira', x.f, x.nf, x.nff || '', fdata(x.d), cantDe(x.can), String(Math.round((x.t || 0) * 1000) / 1000).replace('.', ',')]); });
    salvarArquivo('notas-faltando-' + hoje() + '.csv', csv(L));
  };
  var x1 = $('#czExp'); if (x1) x1.onclick = function () {
    var L = [['Situação', 'Fornecedor', 'NFs controle interno', 'NFs fornecedor', 'Entrega (interno)', 'Canteiro (interno)', 'Romaneios (interno)', 'Interno (t)', 'NF empreiteira', 'Romaneios (empreiteira)', 'Recebimento (empreiteira)', 'Canteiro (empreiteira)', 'Volumes', 'Empreiteira (t)', 'Diferença (t)', 'Alertas']];
    filtrarCZ(cruzamentoNF(), f).forEach(function (x) {
      var br = function (v) { return String(Math.round(v * 1000) / 1000).replace('.', ','); };
      L.push([ST_CZ[x.status][0], x.fornecedor, x.int.map(function (n) { return n.nf; }).join(' '), x.int.map(function (n) { return n.nff; }).join(' '), x.int.map(function (n) { return fdata(n.dt || n.de); }).join(' '), x.int.map(function (n) { return cantDe(n.can); }).join(' '), x.int.map(function (n) { return (n.rom || []).join(' '); }).join(' '), x.int.length ? br(x.tInt) : '',
        x.emp.map(function (e) { return e.nfTxt; }).join(' | '), x.emp.map(function (e) { return e.roms.join(' '); }).join(' | '), x.emp.map(function (e) { return fdata(e.d1); }).join(' '), x.emp.map(function (e) { return e.cants.join(' '); }).join(' '), x.emp.reduce(function (a, e) { return a + e.vol; }, 0) || '', x.emp.length ? br(x.tEmp) : '', x.int.length && x.emp.length ? br(x.delta) : '', x.flags.map(function (fl) { return fl.t; }).join(' | ')]);
    });
    salvarArquivo('cruzamento-nfs-' + hoje() + '.csv', csv(L));
  };
  var x2 = $('#neExp'); if (x2) x2.onclick = function () {
    if ((S.nfsCtrl || []).length) {
      var LC = [['Carga', 'Fornecedor', 'NF', 'Data NF', 'Recebido na obra', 'Enviado ao ' + contratante(), 'Canteiro', 'Romaneio', 'CT-e', 'Placa', 'Peso líquido (kg)', 'Peso bruto (kg)', 'Valor NF', 'RNC']];
      S.nfsCtrl.forEach(function (e) { LC.push([e.carga, e.f, e.nfTxt, fdata(e.dataNF), fdata(e.d1), /^\d{4}-/.test(e.enviado) ? fdata(e.enviado) : e.enviado, e.cants.join(' '), e.roms.join(' '), e.cte, e.placa, String(e.kgLiq).replace('.', ','), String(e.kgBruto).replace('.', ','), String(e.valor).replace('.', ','), e.rnc.join('; ')]); });
      return salvarArquivo('controle-nfs-empreiteira-' + hoje() + '.csv', csv(LC));
    }
    var L = [['Recebimento', 'Fornecedor', 'NF', 'Romaneio', 'Canteiro', 'Tipos', 'Volumes', 'Peso (t)', 'RNC / observação']];
    (S.nfsEmp || []).forEach(function (e) { L.push([fdata(e.d1), e.f, e.nfTxt, e.roms.join(' '), e.cants.join(' '), e.tipos.join(' '), e.vol, String(Math.round(e.kg) / 1000).replace('.', ','), e.rnc.join('; ')]); });
    salvarArquivo('notas-empreiteira-' + hoje() + '.csv', csv(L));
  };
}
function rotularTabelas(root) {
  $$('table.tab-linhas', root).forEach(function (t) {
    var hs = $$('thead th', t).map(function (th) { return (th.childNodes[0] && th.childNodes[0].textContent || th.textContent).trim(); });
    $$('tbody tr', t).forEach(function (tr) { Array.prototype.forEach.call(tr.children, function (td, i) { if (hs[i]) td.setAttribute('data-label', hs[i]); }); });
  });
}
// ===== EXPORTAÇÃO =====
function csv(linhas) {
  return '﻿' + linhas.map(function (l) { return l.map(function (v) { var s = String(v == null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';'); }).join('\r\n');
}
async function salvarArquivo(nome, conteudo) {
  try {
    var dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename: nome, data: conteudo }); return; }
  } catch (e) { if (e && e.code === 'declined') return; }
  modal('Exportar ' + nome, '<p class="small muted" style="margin:0">O download direto não está disponível aqui. Copie o conteúdo e cole numa planilha (separador ";").</p><textarea id="csvTxt" rows="12" style="font-family:var(--mono);font-size:12px">' + esc(conteudo.replace(/^﻿/, '')) + '</textarea>', {
    ok: 'Copiar', onOk: async function (m) { try { await navigator.clipboard.writeText($('#csvTxt', m).value); toast('Copiado'); } catch (e) { $('#csvTxt', m).select(); throw Falha(['Não consegui copiar automaticamente: o texto está selecionado, use Ctrl+C.']); } }
  });
}
function exportarEstoque() {
  var L = [['Canteiro', 'Tipo', 'Grupo', 'Volume', 'Peso unit. (kg)', 'Saldo físico', 'Reservado', 'Disponível', 'A caminho', 'Necessário p/ torres pendentes', 'Peso físico (kg)']];
  tiposOrd().forEach(function (t) {
    var nec = necessidadePendente(t.id);
    cantsOrd(false).forEach(function (c) {
      (t.volumes || []).forEach(function (k) {
        var s = C.get(S.d.saldos, c.id, t.id, k.id), r = C.get(S.d.reservas, c.id, t.id, k.id), tr = C.get(S.d.transito, c.id, t.id, k.id), n = (nec[c.id] || {})[k.id] || 0;
        if (!s && !r && !tr && !n) return;
        L.push([c.nome, t.codigo, k.grupo, k.nome, String(k.pesoKg || '').replace('.', ','), s, r, s - r, tr, n, String(Math.round(s * (k.pesoKg || 0) * 1000) / 1000).replace('.', ',')]);
      });
    });
  });
  salvarArquivo('estoque-estruturas-' + hoje() + '.csv', csv(L));
}
function exportarTorres() {
  var L = [['Torre', 'Operação', 'Tipo', 'Altura (m)', 'Extensão (m)', 'Perna A', 'Perna B', 'Perna C', 'Perna D', 'Canteiro', 'Situação', 'Kit em estoque', 'Volumes faltando']];
  filtrarTorres().forEach(function (t) {
    var i = infoTorre(t), p = t.p || [];
    L.push([t.n, t.op, t.t, C.fmt(t.h), C.fmt(t.e || 0), C.fmt(p[0] || 0), C.fmt(p[1] || 0), C.fmt(p[2] || 0), C.fmt(p[3] || 0), cantNome(t.c), (ST_TORRE[i.status] || [''])[0],
      i.status === 'montada' ? '' : i.kitDisponivel ? 'Sim' : 'Não', i.falta.map(function (f) { return compNome(t.t, f.componenteId) + ' (' + f.qtd + ')'; }).join('; ')]);
  });
  salvarArquivo('torres-' + hoje() + '.csv', csv(L));
}
function exportarHist() {
  var L = [['Data', 'Registrado em', 'Natureza', 'Canteiro', 'Tipo', 'Volume', 'Quantidade', 'Torre', 'Documento', 'Observação', 'Usuário', 'ID']];
  filtrarHist().forEach(function (m) {
    m.itens.forEach(function (i) { L.push([fdata(m.data), fdh(m.criadoEm), C.NATUREZAS[m.natureza] || m.natureza, cantNome(m.canteiroId), tipoCod(m.tipoId), compNome(m.tipoId, i.componenteId), i.qtd, m.numeroTorre || '', m.documento || '', m.obs || '', userName(m.usuarioId), m.id]); });
  });
  salvarArquivo('historico-estoque-' + hoje() + '.csv', csv(L));
}

window.__app = { S: S, Mem: Mem, F: F, Store: Store, render: render };
init();
})();
