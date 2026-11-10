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
var COLS = ['tipos', 'canteiros', 'movimentos', 'transferencias', 'config', 'projeto'];

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
  else if (col === 'projeto') {
    var tw = rows.find(function (r) { return r.id === 'torres'; });
    S.torres = tw && Array.isArray(tw.lista) ? tw.lista : [];
    S.projeto = rows.find(function (r) { return r.id === 'info'; }) || {};
    S.nfsMeta = rows.find(function (r) { return r.id === 'nfs_meta'; }) || {};
    var partes = rows.filter(function (r) { return /^nfs_\d+$/.test(r.id) && Number(r.id.slice(4)) < (S.nfsMeta.partes || 0); })
      .sort(function (a, b) { return Number(a.id.slice(4)) - Number(b.id.slice(4)); });
    S.nfs = [].concat.apply([], partes.map(function (p) { return Array.isArray(p.lista) ? p.lista : []; }));
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
  { id: 'notas', t: 'Conferência de NFs', ic: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13l2 2 4-4' },
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
function rota() { var h = (location.hash || '').replace('#', ''); return VIEWS.some(function (v) { return v.id === h; }) ? h : 'painel'; }
function icon(d) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; }

var lastScroll = {};
function render(fromData) {
  var r = rota();
  if (fromData && $('#modal')) { atualizarModalVivo(); }
  var emTransito = S.transferencias.filter(function (t) { return t.status === 'EM_TRANSITO' || t.status === 'SOLICITADA'; }).length;
  $('nav').innerHTML = VIEWS.map(function (v) {
    if (v.sec) return '<div class="sec">' + v.sec + '</div>';
    var b = v.id === 'transferencias' && emTransito ? '<span class="badge">' + emTransito + '</span>' : '';
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
  if (V[r + '_bind']) V[r + '_bind']();
  if (focusId) { var el = document.getElementById(focusId); if (el) { el.focus(); try { if (selS != null) el.setSelectionRange(selS, selS); } catch (e) {} } }
  if (prevView === r && lastScroll[r] != null) window.scrollTo(0, lastScroll[r]);
  else if (!fromData) window.scrollTo(0, 0);
  $('aside').classList.remove('open');
}
// Filtros persistem entre renders
var F = {
  estoque: { tipo: '', so: '', q: '' }, torres: { tipo: '', canteiro: '', so: '', q: '', lim: 150 }, completas: { tipo: '', canteiro: '' }, rem: { tipo: '*', destino: '', res: null },
  transf: { status: 'ABERTAS' }, hist: { canteiro: '', tipo: '', natureza: '', de: '', ate: '', q: '', lim: 200 },
  mont: { canteiro: '', tipo: '', q: '' }, inv: { canteiro: '', tipo: '', q: '' }, notas: { status: '', forn: '', canteiro: '', q: '', lim: 100 }
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
function infoTorre(t) { var a = aloc(t.t); return a.torres[t.n] || { status: 'pendente', kitDisponivel: false, falta: [] }; }
var ST_TORRE = { pendente: ['Aguardando', ''], fundacao: ['Stub aplicado', 'info'], parcial: ['Montagem parcial', 'warn'], montada: ['Montada', 'ok'] };
function tagStatus(st) { var x = ST_TORRE[st] || ST_TORRE.pendente; return '<span class="tag ' + x[1] + '">' + x[0] + '</span>'; }
function tagKit(info) {
  if (info.status === 'montada') return '<span class="muted small">—</span>';
  if (info.kitDisponivel) return '<span class="tag ok">Kit completo em estoque</span>';
  var n = info.falta.reduce(function (a, f) { return a + f.qtd; }, 0);
  return '<span class="tag bad">Faltam ' + nf(n) + ' vol.</span>';
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
    kpi('Transferências abertas', nf(abertas.length), nf(abertas.filter(function (t) { return t.status === 'EM_TRANSITO'; }).length) + ' em trânsito') + '</div>';

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
  }).map(function (k) { return { grupo: k, volumes: g[k] }; });
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
function filtrarTorres() {
  var f = F.torres, q = (f.q || '').trim();
  return S.torres.filter(function (t) {
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
    '<div class="field"><label>Nº da torre</label><input id="twQ" value="' + esc(f.q || '') + '" placeholder="Ex.: 94/1"></div>' +
    '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label><div class="big" style="font-size:20px">' + nf(lista.length) + ' <span class="small muted">torres</span></div></div></div></div>';
  h += '<div class="card"><div class="tw"><table><thead><tr><th>Torre</th><th class="n">Op.</th><th>Tipo</th><th class="n">Altura</th><th class="n">Ext.</th><th>Pernas A/B/C/D</th><th>Canteiro</th><th>Situação</th><th>Kit</th><th></th></tr></thead><tbody>' +
    lista.slice(0, f.lim).map(function (t) {
      var i = infoTorre(t);
      return '<tr><td><b class="mono">' + esc(t.n) + '</b></td><td class="n muted">' + esc(t.op) + '</td><td>' + esc(t.t) + '</td><td class="n">' + (t.h != null ? C.fmt(t.h) : '') + '</td><td class="n">' + C.fmt(t.e || 0) + '</td><td class="small mono">' + pernasTxt(t) + '</td>' +
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
  var ex = $('#expTw'); if (ex) ex.onclick = exportarTorres;
  $$('[data-kit]').forEach(function (b) { b.onclick = function () { modalKit(b.getAttribute('data-kit')); }; });
  $$('[data-apl]').forEach(function (b) { b.onclick = function () { formAplicacao(b.getAttribute('data-apl')); }; });
};
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
      linhas += '<tr><td>' + esc(v.nome) + '</td><td class="n">' + need + '</td><td class="n">' + cell(a) + '</td><td class="n">' + (falta ? '<b>' + falta + '</b>' : '<span class="zero">0</span>') + '</td><td class="n">' + (falta ? (d >= falta ? '<span class="tag ok">' + d + '</span>' : '<span class="tag bad">' + d + '</span>') : cell(d)) + '</td></tr>';
    });
  });
  var peso = C.pesoItens(tp, C.itensDeMapa(kit.itens));
  modal('Torre ' + n + ' · ' + tp.codigo, '<div class="row small"><div><b>Canteiro:</b> ' + esc(cantNome(t.c)) + '</div><div><b>Altura:</b> ' + C.fmt(t.h) + ' m</div><div><b>Extensão:</b> ' + C.fmt(t.e || 0) + ' m</div><div><b>Pernas:</b> ' + pernasTxt(t) + '</div><div><b>Peso do kit:</b> ' + nf(peso / 1000, 2) + ' t</div><div>' + tagStatus(i.status) + ' ' + tagKit(i) + '</div></div>' +
    '<div class="tw" style="max-height:60vh"><table><thead><tr><th>Volume</th><th class="n">Kit</th><th class="n">Aplicado</th><th class="n">Falta aplicar</th><th class="n">Disp. no canteiro</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
    (!i.kitDisponivel && i.status !== 'montada' ? '<p class="small muted" style="margin:0">Observação: o disponível do canteiro é compartilhado com as torres anteriores na ordem da LC; a coluna "Kit" desta tela considera só esta torre.</p>' : ''),
    { cancel: 'Fechar' });
}

// ===== TORRES COMPLETAS (resumo e gargalos) =====
V.completas = function () {
  var h = head('Torres completas', 'Quantas torres cada canteiro consegue montar com o próprio estoque e quais volumes mais travam as demais.');
  var sc = semCadastro(); if (sc) return h + sc;
  if (!S.torres.length) return h + '<div class="card empty"><b>Lista de construção não carregada</b><a href="#importar">Importe o projeto</a>.</div>';
  var f = F.completas;
  h += '<div class="card"><div class="tw"><table><thead><tr><th>Tipo</th>' + cantsOrd(true).map(function (c) { return '<th class="n" colspan="4" style="text-align:center">' + esc(c.nome) + '</th>'; }).join('') + '</tr><tr><th></th>' +
    cantsOrd(true).map(function () { return '<th class="n">Proj.</th><th class="n">Mont.</th><th class="n">Prontas</th><th class="n">Sem kit</th>'; }).join('') + '</tr></thead><tbody>' +
    tiposOrd().map(function (t) {
      var a = aloc(t.id);
      return '<tr><td><b>' + esc(t.codigo) + '</b></td>' + cantsOrd(true).map(function (c) {
        var r = a.resumo[c.id] || {};
        return '<td class="n muted">' + cell(r.projeto || 0) + '</td><td class="n">' + cell(r.montadas || 0) + '</td><td class="n"><b>' + (r.prontas ? '<span class="tag ok">' + r.prontas + '</span>' : '<span class="zero">0</span>') + '</b></td><td class="n">' + cell(r.incompletas || 0) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div></div>';
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
  return Object.keys(o).sort();
}
function corForn(f) { var l = listaFornecedores(), i = l.indexOf(f); return i >= 0 && i < PALETA_FORN.length ? PALETA_FORN[i] : '#8a948f'; }
function pesoMov(m) {
  var t = tipoById(m.tipoId); if (!t) return 0;
  var p = t._pesos; if (!p) { p = {}; (t.volumes || []).forEach(function (v) { p[v.id] = Number(v.pesoKg || 0); }); Object.defineProperty(t, '_pesos', { value: p, enumerable: false }); }
  return m.itens.reduce(function (a, i) { return a + (p[i.componenteId] || 0) * Number(i.qtd); }, 0) / 1000;
}
function conferencia() { var m = M(); if (!m.conf) m.conf = C.conferirNFs(S.nfs, S.movimentos, pesoMov); return m.conf; }
function precos() { var m = M(); if (!m.precos) m.precos = C.precoPorFornecedor(S.nfs); return m.precos; }
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
  var h = head('Conferência de NFs', 'Notas fiscais de estrutura × volumes lançados no estoque. A conferência é por carga: as NFs lançadas juntas formam um grupo, e o peso dos volumes é comparado com o da nota (tolerância de 5% ou 0,3 t).',
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
  h += '<div class="card"><h2>Toneladas por fornecedor e canteiro <span class="sub">faturado nas NFs × peso dos volumes lançados</span></h2><div class="tw"><table><thead><tr><th>Fornecedor</th><th>Canteiro</th><th class="n">NFs (t)</th><th class="n">Lançado (t)</th><th class="n">Diferença (t)</th><th class="n">%</th></tr></thead><tbody>' +
    macL.map(function (x) { var d = x.ts - x.tn, p = x.tn ? 100 * d / x.tn : 0; return '<tr><td><b>' + esc(x.f) + '</b></td><td>' + esc(x.c) + '</td><td class="n">' + nf(x.tn, 1) + '</td><td class="n">' + nf(x.ts, 1) + '</td><td class="n">' + (Math.abs(d) < 0.5 ? '<span class="zero">0</span>' : '<span class="tag ' + (d < 0 ? 'bad' : 'info') + '">' + (d > 0 ? '+' : '') + nf(d, 1) + '</span>') + '</td><td class="n muted">' + (x.tn ? (p > 0 ? '+' : '') + nf(p, 1) + '%' : '—') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
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
    '<div class="tw"><table><thead><tr><th>Situação</th><th>Fornecedor</th><th>NFs (controle / fornecedor)</th><th>Entrega</th><th>Canteiro NF</th><th class="n">NF (t)</th><th class="n">Lançado (t)</th><th class="n">Dif. (t)</th><th>Lançamentos no estoque</th></tr></thead><tbody>' +
    lista.slice(0, f.lim).map(function (g) {
      var cantSis = g.canteirosSis.map(cantNome), cantNF = g.canteirosNF.map(canteiroDaNF);
      var difCant = g.recs.length && g.nfs.length && cantSis.some(function (x) { return cantNF.indexOf(x) < 0; });
      return '<tr><td>' + tagNF(g.status) + (difCant ? '<br><span class="tag warn" style="margin-top:3px">canteiro diferente</span>' : '') + (g.status === 'sem_lancamento' && g.tonNF < 3 ? '<br><span class="small muted">NF pequena: pode ser só parafusos</span>' : '') + '</td>' +
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
  h += S.nfs.length ? '<p style="margin-top:0" class="small">Carregado: <b>' + nf(S.nfs.length) + ' NFs</b> · ' + esc(meta.arquivo || '') + (meta.semana ? ' · ' + esc(meta.semana) : '') + (meta.atualizadoEm ? ' · atualizado em ' + fdh(meta.atualizadoEm) : '') + '. Veja a <a href="#notas">conferência</a> e o <a href="#fornecimento">fornecimento</a>.</p>'
    : '<p style="margin-top:0">Escolha a planilha de controle de notas fiscais (.xlsx). O sistema lê no seu navegador a aba de notas e a aba Resumo; o arquivo não é enviado a lugar nenhum além do banco desta página.</p>';
  if (!podeCadastrar()) return h + '<div class="banner info">Somente o dono ou Editores podem atualizar as NFs.</div></div>';
  h += '<label class="btn"' + (st.lendo || st.gravando ? ' style="opacity:.5;pointer-events:none"' : '') + '>Escolher planilha…<input type="file" id="nfArq" accept=".xlsx,.xlsm,.xls" hidden></label>';
  if (st.lendo) h += ' <span class="small muted">Lendo…</span>';
  if (st.erro) h += '<div class="banner bad" style="margin-top:12px">' + esc(st.erro) + '</div>';
  if (st.pacote) {
    var p = st.pacote, e = p.nfs.filter(C.ehEstrutura);
    h += '<div class="banner info" style="margin-top:12px"><b>' + esc(p.arquivo) + '</b>' + (p.semana ? ' · ' + esc(p.semana) : '') + ': ' + nf(p.nfs.length) + ' NFs (' + nf(e.length) + ' de estrutura, ' + nf(e.reduce(function (a, n) { return a + n.q; }, 0), 0) + ' t, ' + brl(e.reduce(function (a, n) { return a + n.v; }, 0), true) + ')' +
      (p.resumo.length ? ' · Resumo: ' + p.resumo.map(function (r) { return r.f; }).join(', ') : ' · aba Resumo não encontrada') + (S.nfs.length ? '. Substitui as ' + nf(S.nfs.length) + ' NFs carregadas.' : '.') + '</div>' +
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
  return '<div class="card"><h2>Obra</h2><div class="row"><div class="field"><label>Nome da obra / LT (aparece no topo)</label><input id="cfgNome" value="' + esc(S.config.nomeObra || '') + '" placeholder="Ex.: LT 500 kV …"></div><div class="field" style="flex:0 0 auto"><button class="btn" id="cfgSalvar">Salvar</button></div></div></div>';
}
V.canteiros_bind = function () {
  var n = $('#novoCant'); if (n) n.onclick = function () { formCanteiro(); };
  $$('[data-ec]').forEach(function (b) { b.onclick = function () { formCanteiro(b.getAttribute('data-ec')); }; });
  var s = $('#cfgSalvar'); if (s) s.onclick = async function () { try { await Store.set('config', 'geral', { nomeObra: $('#cfgNome').value.trim() }); toast('Salvo'); } catch (e) { toast(errMsg(e), true); } };
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
    '<div class="field"><label>Fixação</label><input id="tpF" value="' + esc(t.fixacao || '') + '" placeholder="Suspensão, Ancoragem…"></div></div>' +
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
      await Store.set('tipos', codigo, { codigo: codigo, estrutura: est, fixacao: $('#tpF', m).value.trim(), nome: [est, $('#tpF', m).value.trim()].filter(Boolean).join(' – '), regra: regra, fornecedor: t.fornecedor || '', volumes: vols });
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
  if (S.tipos.length) h += blocoImportarNFs();
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
