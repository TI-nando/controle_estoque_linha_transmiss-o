// ===== Núcleo de regras de negócio (puro, sem DOM) =====
// Modelo da obra:
//  tipos:   [{id, codigo, estrutura, regra:{modo:'estaiada'|'autoportante', alturaBase, modulo, stubs, fixos:[grupos]},
//             volumes:[{id, nome, grupo:'TB'|'EXT6'|'PERNA4,5'|'AP/STB'|'PINO'|'CALOTA'|'PRA'|..., pesoKg}]}]
//  torres:  [{n:'94/1', op:ordem, t:tipoId, h:altura, e:extensao, p:[A,B,C,D], c:canteiroId}]   (lista de construção)
//  movimentos: [{natureza, canteiroId, tipoId, itens:[{componenteId(=volumeId), qtd com sinal}], numeroTorre?}]
//  Saldo = soma do razão. Kit da torre = TB + extensão + pernas + stubs (+ pino/calota nas estaiadas).
var Core = (function () {
  var NATUREZAS = {
    ENTRADA: 'Recebimento', SAIDA: 'Saída / baixa', AJUSTE: 'Ajuste de inventário',
    TRANSF_SAIDA: 'Transferência (envio)', TRANSF_ENTRADA: 'Transferência (recebimento)',
    APLICACAO: 'Aplicação em torre', MONTAGEM: 'Aplicação em torre', ESTORNO: 'Estorno'
  };
  var STATUS_TRANSF = { SOLICITADA: 'Solicitada', EM_TRANSITO: 'Em trânsito', RECEBIDA: 'Recebida', CANCELADA: 'Cancelada' };

  function key(c, t, v) { return c + '|' + t + '|' + v; }
  function get(map, c, t, v) { return map.get(key(c, t, v)) || 0; }
  function fmt(x) { return String(Math.round(Number(x) * 10) / 10).replace('.', ','); }
  function grupoExt(e) { return 'EXT' + fmt(e); }
  function grupoPerna(p) { return 'PERNA' + fmt(p); }

  // ---------- saldos ----------
  function calcularSaldos(movimentos) {
    var s = new Map();
    for (var i = 0; i < movimentos.length; i++) {
      var m = movimentos[i]; if (!m || !m.itens) continue;
      for (var j = 0; j < m.itens.length; j++) {
        var it = m.itens[j], k = key(m.canteiroId, m.tipoId, it.componenteId);
        s.set(k, (s.get(k) || 0) + Number(it.qtd || 0));
      }
    }
    return s;
  }
  function somaTransf(transferencias, status, lado) {
    var r = new Map();
    transferencias.forEach(function (t) {
      if (t.status !== status) return;
      t.itens.forEach(function (it) {
        var k = key(lado === 'origem' ? t.origemId : t.destinoId, t.tipoId, it.componenteId);
        r.set(k, (r.get(k) || 0) + Number(it.qtd || 0));
      });
    });
    return r;
  }
  function calcularReservas(tr) { return somaTransf(tr, 'SOLICITADA', 'origem'); }
  function calcularTransito(tr) { return somaTransf(tr, 'EM_TRANSITO', 'destino'); }
  function calcularEntrando(tr) {
    var a = somaTransf(tr, 'SOLICITADA', 'destino'), b = somaTransf(tr, 'EM_TRANSITO', 'destino');
    b.forEach(function (q, k) { a.set(k, (a.get(k) || 0) + q); }); return a;
  }
  function disponivel(saldos, reservas, c, t, v) { return get(saldos, c, t, v) - get(reservas, c, t, v); }
  // Para planejar, saldo negativo (erro de lançamento, sinalizado nos alertas) conta como zero: não existe peça negativa.
  function estoqueDo(saldos, reservas, c, tipo) {
    var o = {};
    (tipo.volumes || []).forEach(function (v) { o[v.id] = Math.max(0, disponivel(saldos, reservas, c, tipo.id, v.id)); });
    return o;
  }
  /** Saldo físico (negativos zerados) + o que já está vindo para cada canteiro (solicitado ou em trânsito). */
  function saldosComEntrada(saldos, entrando) {
    var m = new Map();
    saldos.forEach(function (q, k) { m.set(k, Math.max(0, q)); });
    if (entrando) entrando.forEach(function (q, k) { m.set(k, (m.get(k) || 0) + q); });
    return m;
  }

  // ---------- kit de uma torre ----------
  function porGrupo(tipo) {
    if (tipo._g) return tipo._g;
    var g = {};
    (tipo.volumes || []).forEach(function (v) { (g[v.grupo] = g[v.grupo] || []).push(v); });
    Object.defineProperty(tipo, '_g', { value: g, enumerable: false });
    return g;
  }
  /** Grupos (com quantidade) que formam a torre. */
  function gruposDaTorre(tipo, torre) {
    var r = tipo.regra || { modo: 'autoportante', stubs: 4, fixos: ['TB'] };
    var out = [];
    (r.fixos || ['TB']).forEach(function (g) { out.push({ grupo: g, qtd: 1 }); });
    if (r.modo === 'estaiada') {
      var e = Math.round((Number(torre.h || 0) - Number(r.alturaBase || 0)) * 10) / 10;
      if (e > 0) {
        var mod = Number(r.modulo || 6), n = Math.floor(e / mod + 1e-9), resto = Math.round((e - n * mod) * 10) / 10;
        if (n) out.push({ grupo: grupoExt(mod), qtd: n });
        if (resto > 0) out.push({ grupo: grupoExt(resto), qtd: 1 });
      }
    } else {
      var ge = grupoExt(torre.e || 0);
      if (Number(torre.e || 0) > 0 || porGrupo(tipo)[ge]) out.push({ grupo: ge, qtd: 1, opcional: !(Number(torre.e || 0) > 0) });
      var pernas = {};
      (torre.p || []).forEach(function (p) { if (Number(p) > 0) { var g = grupoPerna(p); pernas[g] = (pernas[g] || 0) + 1; } });
      Object.keys(pernas).forEach(function (g) { out.push({ grupo: g, qtd: pernas[g] }); });
    }
    if (r.stubs) out.push({ grupo: 'AP/STB', qtd: Number(r.stubs) });
    return out;
  }
  /** {itens:{volumeId:qtd}, gruposAusentes:[...]} */
  function kitDaTorre(tipo, torre) {
    var g = porGrupo(tipo), itens = {}, ausentes = [];
    gruposDaTorre(tipo, torre).forEach(function (x) {
      var vs = g[x.grupo];
      if (!vs || !vs.length) { if (!x.opcional) ausentes.push(x.grupo); return; }
      vs.forEach(function (v) { itens[v.id] = (itens[v.id] || 0) + x.qtd; });
    });
    return { itens: itens, gruposAusentes: ausentes };
  }

  // Aplicado por torre (aplicações/montagens menos estornos delas)
  function aplicadoPorTorre(movimentos) {
    var byId = {}, ap = {};
    movimentos.forEach(function (m) { byId[m.id] = m; });
    movimentos.forEach(function (m) {
      var num = m.numeroTorre;
      if (m.natureza === 'ESTORNO' && m.estornoDe && byId[m.estornoDe]) num = byId[m.estornoDe].numeroTorre;
      if (!num) return;
      if (m.natureza !== 'APLICACAO' && m.natureza !== 'MONTAGEM' && m.natureza !== 'ESTORNO') return;
      var o = ap[num] = ap[num] || {};
      m.itens.forEach(function (it) { o[it.componenteId] = (o[it.componenteId] || 0) - Number(it.qtd); });
    });
    return ap;
  }
  /** O que ainda falta aplicar na torre. */
  function necessidade(tipo, torre, aplicado) {
    var k = kitDaTorre(tipo, torre).itens, a = (aplicado && aplicado[torre.n]) || {}, out = {};
    Object.keys(k).forEach(function (v) { var q = k[v] - (a[v] || 0); if (q > 0) out[v] = q; });
    return out;
  }
  function statusTorre(tipo, torre, aplicado) {
    var a = (aplicado && aplicado[torre.n]) || {};
    var algum = Object.keys(a).some(function (k) { return a[k] > 0; });
    var falta = necessidade(tipo, torre, aplicado);
    if (!Object.keys(falta).length) return algum ? 'montada' : 'pendente';
    if (!algum) return 'pendente';
    var stubIds = (porGrupo(tipo)['AP/STB'] || []).map(function (v) { return v.id; });
    var soStub = Object.keys(a).every(function (k) { return a[k] <= 0 || stubIds.indexOf(k) >= 0 || /PINO/.test(nomeVol(tipo, k)); });
    return soStub ? 'fundacao' : 'parcial';
  }
  function nomeVol(tipo, id) { var v = (tipo.volumes || []).find(function (x) { return x.id === id; }); return v ? v.nome : ''; }

  function cobre(estoque, need) { for (var k in need) if ((estoque[k] || 0) < need[k]) return false; return true; }
  function tirar(estoque, need) { for (var k in need) estoque[k] = (estoque[k] || 0) - need[k]; }
  function faltaContra(estoque, need) {
    var f = []; for (var k in need) { var x = need[k] - Math.max(0, estoque[k] || 0); if (x > 0) f.push({ componenteId: k, qtd: x }); } return f;
  }
  function soma(need) { var s = 0; for (var k in need) s += need[k]; return s; }

  /**
   * Para um tipo: aloca o estoque disponível de cada canteiro às torres pendentes dele, na ordem da LC.
   * Retorna {torres:{n:{status, kitDisponivel, falta[]}}, sobra:{canteiroId:{vol:qtd}}, resumo:{canteiroId:{...}}}
   */
  function alocarTipo(tipo, torresTipo, canteiros, saldos, reservas, aplicado) {
    var res = { torres: {}, sobra: {}, resumo: {} };
    canteiros.forEach(function (c) {
      var est = estoqueDo(saldos, reservas, c.id, tipo);
      var minhas = torresTipo.filter(function (t) { return t.c === c.id; }).sort(function (a, b) { return a.op - b.op; });
      var r = { projeto: minhas.length, montadas: 0, prontas: 0, incompletas: 0, fundacao: 0 };
      var pend = [];
      minhas.forEach(function (t) {
        var st = statusTorre(tipo, t, aplicado);
        if (st === 'montada') { r.montadas++; res.torres[t.n] = { status: st, kitDisponivel: true, falta: [] }; return; }
        if (st === 'fundacao') r.fundacao++;
        var need = necessidade(tipo, t, aplicado);
        if (cobre(est, need)) { tirar(est, need); r.prontas++; res.torres[t.n] = { status: st, kitDisponivel: true, falta: [] }; }
        else pend.push({ t: t, need: need, st: st });
      });
      pend.forEach(function (p) { r.incompletas++; res.torres[p.t.n] = { status: p.st, kitDisponivel: false, falta: faltaContra(est, p.need), need: p.need }; });
      res.sobra[c.id] = est; res.resumo[c.id] = r;
    });
    return res;
  }

  /**
   * Remanejamento para um tipo. Doadores só cedem a SOBRA (o que não está alocado às torres
   * que eles já conseguem montar), então nenhum canteiro perde uma torre pronta.
   * opts: {destinoId}
   */
  function sugerirRemanejamento(tipo, torresTipo, canteiros, saldos, reservas, aplicado, opts) {
    opts = opts || {};
    var ativos = canteiros.filter(function (c) { return c.ativo !== false; });
    // O que já está vindo (solicitado ou em trânsito) conta no destino: evita sugerir duas vezes a mesma peça
    saldos = saldosComEntrada(saldos, opts.entrando);
    var base = alocarTipo(tipo, torresTipo, ativos, saldos, reservas, aplicado);
    var sobra = {}; ativos.forEach(function (c) { sobra[c.id] = Object.assign({}, base.sobra[c.id]); });
    var antes = 0; ativos.forEach(function (c) { antes += base.resumo[c.id].prontas; });
    var cand = torresTipo.filter(function (t) {
      var x = base.torres[t.n];
      return x && !x.kitDisponivel && sobra[t.c] && (!opts.destinoId || t.c === opts.destinoId);
    }).map(function (t) { return { t: t, need: base.torres[t.n].need }; });
    var movs = [], completadas = [];
    var guard = 5000;
    while (cand.length && guard-- > 0) {
      var melhor = null, melhorI = -1;
      for (var i = 0; i < cand.length; i++) {
        var c = cand[i], own = sobra[c.t.c], ext = 0, ok = true, plano = [];
        for (var v in c.need) {
          var falta = c.need[v] - Math.max(0, own[v] || 0);
          if (falta <= 0) continue;
          ext += falta;
          var doadores = ativos.filter(function (d) { return d.id !== c.t.c && (sobra[d.id][v] || 0) > 0; })
            .sort(function (a, b) { return (sobra[b.id][v] || 0) - (sobra[a.id][v] || 0); });
          for (var j = 0; j < doadores.length && falta > 0; j++) {
            var x = Math.min(falta, sobra[doadores[j].id][v]);
            plano.push({ origemId: doadores[j].id, componenteId: v, qtd: x }); falta -= x;
          }
          if (falta > 0) { ok = false; break; }
        }
        if (!ok) continue;
        var score = [-ext, -plano.length, -c.t.op];
        if (!melhor || cmp(score, melhor.score) > 0) { melhor = { c: c, plano: plano, score: score }; melhorI = i; }
      }
      if (!melhor) break;
      var dest = melhor.c.t.c, own2 = sobra[dest];
      melhor.plano.forEach(function (p) { sobra[p.origemId][p.componenteId] -= p.qtd; own2[p.componenteId] = (own2[p.componenteId] || 0) + p.qtd; movs.push({ origemId: p.origemId, destinoId: dest, componenteId: p.componenteId, qtd: p.qtd }); });
      tirar(own2, melhor.c.need);
      completadas.push({ n: melhor.c.t.n, canteiroId: dest, pecasDeFora: -melhor.score[0] });
      cand.splice(melhorI, 1);
    }
    var porPar = new Map();
    movs.forEach(function (m) {
      var k = m.origemId + '>' + m.destinoId;
      if (!porPar.has(k)) porPar.set(k, { origemId: m.origemId, destinoId: m.destinoId, tipoId: tipo.id, itens: {}, torres: [] });
      var t = porPar.get(k); t.itens[m.componenteId] = (t.itens[m.componenteId] || 0) + m.qtd;
    });
    completadas.forEach(function (x) { porPar.forEach(function (t) { if (t.destinoId === x.canteiroId && t.torres.indexOf(x.n) < 0) t.torres.push(x.n); }); });
    var transfs = Array.from(porPar.values()).map(function (t) {
      return { origemId: t.origemId, destinoId: t.destinoId, tipoId: t.tipoId, torres: t.torres,
        itens: Object.keys(t.itens).map(function (k) { return { componenteId: k, qtd: t.itens[k] }; }) };
    });
    // Verificação: aplica as transferências num saldo simulado e recalcula (resultado garantido, não estimado)
    var sim = new Map(saldos);
    transfs.forEach(function (t) { t.itens.forEach(function (i) {
      var ko = key(t.origemId, tipo.id, i.componenteId), kd = key(t.destinoId, tipo.id, i.componenteId);
      sim.set(ko, (sim.get(ko) || 0) - i.qtd); sim.set(kd, (sim.get(kd) || 0) + i.qtd);
    }); });
    var ver = alocarTipo(tipo, torresTipo, ativos, sim, reservas, aplicado), depois = 0, porCanteiro = {};
    ativos.forEach(function (c) { depois += ver.resumo[c.id].prontas; porCanteiro[c.id] = { antes: base.resumo[c.id].prontas, depois: ver.resumo[c.id].prontas }; });
    return { antes: antes, depois: depois, transferencias: transfs, completadas: completadas, porCanteiro: porCanteiro };
  }
  function cmp(a, b) { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

  /** Potencial: quantas torres pendentes ficariam com kit se todo o estoque do tipo estivesse junto
   *  (prioriza as torres que precisam de menos peças). */
  function maximoTeorico(tipo, torresTipo, canteiros, saldos, reservas, aplicado) {
    var pool = {};
    canteiros.forEach(function (c) { if (c.ativo === false) return; var e = estoqueDo(saldos, reservas, c.id, tipo); for (var k in e) pool[k] = (pool[k] || 0) + Math.max(0, e[k]); });
    var pend = torresTipo.filter(function (t) { return statusTorre(tipo, t, aplicado) !== 'montada'; })
      .map(function (t) { var n = necessidade(tipo, t, aplicado); return { n: n, s: soma(n), op: t.op }; })
      .sort(function (a, b) { return a.s - b.s || a.op - b.op; });
    var n = 0;
    pend.forEach(function (p) { if (cobre(pool, p.n)) { tirar(pool, p.n); n++; } });
    return n;
  }

  // ---------- validações ----------
  function validarSaida(tipo, saldos, reservas, canteiroId, itens, ignorarReservaDe) {
    var erros = [];
    itens.forEach(function (it) {
      var nome = nomeVol(tipo, it.componenteId) || it.componenteId;
      if (!(Number(it.qtd) > 0) || Math.floor(it.qtd) !== Number(it.qtd)) { erros.push(nome + ': quantidade inválida'); return; }
      var disp = disponivel(saldos, reservas, canteiroId, tipo.id, it.componenteId);
      if (ignorarReservaDe) { var t = ignorarReservaDe.itens.find(function (x) { return x.componenteId === it.componenteId; }); if (t) disp += Number(t.qtd); }
      if (Number(it.qtd) > disp) erros.push(nome + ': pedido ' + it.qtd + ', disponível ' + disp);
    });
    return erros;
  }
  var TRANSICOES = { SOLICITADA: ['EM_TRANSITO', 'CANCELADA'], EM_TRANSITO: ['RECEBIDA'], RECEBIDA: [], CANCELADA: [] };
  function podeTransitar(de, para) { return (TRANSICOES[de] || []).indexOf(para) >= 0; }
  function pesoItens(tipo, itens) {
    var p = 0;
    itens.forEach(function (it) { var v = (tipo.volumes || []).find(function (x) { return x.id === it.componenteId; }); if (v && v.pesoKg) p += Number(v.pesoKg) * Math.abs(Number(it.qtd)); });
    return p;
  }
  function itensDeMapa(m) { return Object.keys(m).map(function (k) { return { componenteId: k, qtd: m[k] }; }); }


  // ===================== NOTAS FISCAIS =====================
  function txt(x) { if (x == null) return ''; if (typeof x === 'number' && Math.floor(x) === x) return String(x); return String(x).trim(); }
  function up(x) { return txt(x).toUpperCase().replace(/\s+/g, ' '); }
  function serialData(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    var m = String(v).match(/(\d{2})\/(\d{2})\/(\d{4})/); if (m) return m[3] + '-' + m[2] + '-' + m[1];
    m = String(v).match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null;
  }
  function num(v) { if (typeof v === 'number') return v; var n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
  /** Lê a aba de NFs (linhas como arrays). Localiza o cabeçalho pelo texto, então aguenta coluna inserida/movida. */
  function lerPlanilhaNFs(linhas) {
    var hi = -1, col = {};
    for (var i = 0; i < Math.min(linhas.length, 30); i++) {
      var r = linhas[i] || [], j = r.map(up);
      if (j.indexOf('ITEM') >= 0 && j.some(function (x) { return x.indexOf('FORNECEDOR') >= 0; })) { hi = i; break; }
    }
    if (hi < 0) throw new Error('Não encontrei o cabeçalho (coluna ITEM / FORNECEDOR) na aba de notas.');
    (linhas[hi] || []).forEach(function (h, j) {
      var x = up(h);
      if (x === 'ITEM') col.item = j;
      else if (x.indexOf('NF') === 0 && x.indexOf('FORNECEDOR') >= 0) col.nff = j;
      else if (x.indexOf('NF') === 0 && !/ENVIAD|LAN[CÇ]AM/.test(x) && col.nf == null) col.nf = j; // NF de controle interno (1ª coluna NF que não é do fornecedor)
      else if (x === 'FORNECEDOR') col.f = j;
      else if (x.indexOf('QUANT') === 0) col.q = j;
      else if (x.indexOf('UNID') === 0) col.u = j;
      else if (x.indexOf('EMISS') >= 0) col.de = j;
      else if (x.indexOf('ENTREGA') >= 0) col.dt = j;
      else if (x.indexOf('DESCRI') === 0) col.desc = j;
      else if (x.indexOf('CANTEIRO') === 0) col.can = j;
      else if (x.indexOf('CONFORMIDADE') >= 0) col.nc = j;
      else if (x.indexOf('VALOR NF') === 0) col.v = j;
      else if (x.indexOf('OBSERVA') === 0) col.obs = j;
      else if (x.indexOf('CARRETA') >= 0) col.car = j;
      else if (x.indexOf('RECEBIDO POR') === 0) col.rp = j;
    });
    ['nf', 'f', 'q', 'u'].forEach(function (k) { if (col[k] == null) throw new Error('Coluna obrigatória não encontrada: ' + k); });
    var out = [];
    for (i = hi + 1; i < linhas.length; i++) {
      var r = linhas[i] || [], g = function (k) { return col[k] == null ? null : r[col[k]]; };
      if ((!txt(g('nf')) && !txt(g('nff'))) || !txt(g('f'))) continue;
      var obs = txt(g('obs'));
      out.push({
        item: num(g('item')) || out.length + 1, nf: up(g('nf')) || up(g('nff')), nff: up(g('nff')), f: up(g('f')), q: num(g('q')), u: txt(g('u')).toLowerCase(),
        de: serialData(g('de')), dt: serialData(g('dt')), desc: txt(g('desc')), can: up(g('can')), nc: txt(g('nc')), v: num(g('v')),
        rom: (obs.match(/\d{4,9}/g) || []), obs: obs.slice(0, 160), car: num(g('car')) || 0
      });
    }
    return out;
  }
  /** Lê a aba Resumo: previsto x recebido por fornecedor/material (localiza colunas pelo cabeçalho). */
  function lerResumoNFs(linhas) {
    var out = [], col = null, unid = 'ton';
    linhas.forEach(function (r) {
      r = r || []; var u = r.map(up);
      var jf = u.indexOf('FORNECEDOR'), jp = u.findIndex(function (x) { return /^PREVISTO/.test(x); });
      if (jf >= 0 && jp >= 0) {
        var m = String(r[jp]).match(/\((\w+)\)/); unid = m ? m[1].toLowerCase() : 'ton';
        col = { f: jf, mat: u.indexOf('MATERIAL'), car: u.findIndex(function (x) { return /CARRETA/.test(x); }), prev: jp, rec: u.findIndex(function (x) { return /^RECEBIDO/.test(x); }) };
        return;
      }
      if (!col) return;
      var f = up(r[col.f]), prev = r[col.prev];
      if (f && typeof prev === 'number') out.push({ f: f, material: col.mat >= 0 ? txt(r[col.mat]) : '', unid: unid, previsto: prev, recebido: col.rec >= 0 ? num(r[col.rec]) : 0, carretas: col.car >= 0 ? num(r[col.car]) : 0 });
    });
    return out;
  }
  function ehEstrutura(n) { return /^EST/i.test(n.desc || '') && (n.u === 'ton' || n.u === 't'); }
  function fornecedorDoMov(m) { if (m.fornecedor) return up(m.fornecedor); var o = up(String(m.obs || '').split(' · ')[0].split(',')[0]); var d = o.match(/^RECEBIDO DE (\S+)/); return d ? 'DEPÓSITO ' + d[1] : o; }
  /** NFs e romaneio informados num recebimento. Aceita "NF 142, 143 e 145 · Rom. 7431". */
  function nfsDoMov(m) {
    if (m.nfs && m.nfs.length) return { nfs: m.nfs.map(up), rom: up(m.romaneio) };
    var mm = String(m.documento || '').match(/^NF\s+(.+?)\s+·\s+Rom\.\s*(.*)$/);
    if (!mm) return { nfs: [], rom: '' };
    return { nfs: mm[1].split(/\s*,\s*|\s+e\s+/i).map(up).filter(function (x) { return x && x !== '-' && x !== 'NONE'; }), rom: up(mm[2]) };
  }
  /**
   * Confere NFs de estrutura contra os recebimentos lançados. Unidade = carga (NFs lançadas juntas).
   * pesoMov(m) -> toneladas do recebimento. Retorna {grupos:[...], resumo:{...}}
   */
  function conferirNFs(nfs, movimentos, pesoMov, tol) {
    tol = tol || { pct: 0.05, min: 0.3 };
    var est = nfs.filter(ehEstrutura), byKey = {}, byNff = {}, par = {};
    function f(x) { if (par[x] == null) par[x] = x; while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
    function un(a, b) { par[f(a)] = f(b); }
    est.forEach(function (n, i) { var k = 'N|' + n.f + '|' + n.nf; if (!byKey[n.f + '|' + n.nf]) byKey[n.f + '|' + n.nf] = []; byKey[n.f + '|' + n.nf].push(i); f(k); if (n.nff) byNff[n.f + '|' + n.nff] = n.nf; });
    var recs = movimentos.filter(function (m) { return m.natureza === 'ENTRADA'; });
    recs.forEach(function (m) {
      var fo = fornecedorDoMov(m), info = nfsDoMov(m), achou = false; f('M|' + m.id);
      info.nfs.forEach(function (nf) {
        var k = byKey[fo + '|' + nf] ? nf : byNff[fo + '|' + nf];
        if (k) { un('M|' + m.id, 'N|' + fo + '|' + k); achou = true; }
      });
      if (!achou && info.rom && byNff[fo + '|' + info.rom]) un('M|' + m.id, 'N|' + fo + '|' + byNff[fo + '|' + info.rom]);
    });
    var G = {};
    Object.keys(byKey).forEach(function (k) { var r = f('N|' + k), g = G[r] = G[r] || { nfs: [], recs: [] }; byKey[k].forEach(function (i) { g.nfs.push(est[i]); }); });
    recs.forEach(function (m) { var r = f('M|' + m.id), g = G[r] = G[r] || { nfs: [], recs: [] }; g.recs.push(m); });
    var grupos = Object.keys(G).map(function (k) {
      var g = G[k], tn = 0, ts = 0, cn = {}, cs = {};
      g.nfs.forEach(function (n) { tn += n.q; cn[n.can] = 1; });
      g.recs.forEach(function (m) { ts += pesoMov(m); cs[m.canteiroId] = 1; });
      var st = !g.recs.length ? 'sem_lancamento' : !g.nfs.length ? 'sem_nf' : Math.abs(ts - tn) <= Math.max(tol.pct * tn, tol.min) ? 'confere' : 'diverge';
      var datas = g.nfs.map(function (n) { return n.dt || n.de || ''; }).concat(g.recs.map(function (m) { return m.data || ''; })).filter(Boolean).sort();
      return { id: k, nfs: g.nfs, recs: g.recs, tonNF: tn, tonSis: ts, delta: ts - tn, status: st, canteirosNF: Object.keys(cn), canteirosSis: Object.keys(cs),
        fornecedor: (g.nfs[0] && g.nfs[0].f) || (g.recs[0] && fornecedorDoMov(g.recs[0])) || '', data: datas[datas.length - 1] || '' };
    });
    var resumo = { confere: { n: 0, t: 0 }, diverge: { n: 0, t: 0 }, sem_lancamento: { n: 0, t: 0 }, sem_nf: { n: 0, t: 0 } };
    grupos.forEach(function (g) { var r = resumo[g.status]; r.n++; r.t += g.status === 'sem_nf' ? g.tonSis : g.tonNF; });
    return { grupos: grupos, resumo: resumo, nfsEstrutura: est.length };
  }
  /** R$/t médio por fornecedor nas NFs de estrutura. */
  function precoPorFornecedor(nfs) {
    var a = {};
    nfs.filter(ehEstrutura).forEach(function (n) { var x = a[n.f] = a[n.f] || { t: 0, v: 0 }; x.t += n.q; x.v += n.v; });
    var o = {}; Object.keys(a).forEach(function (k) { if (a[k].t > 0) o[k] = a[k].v / a[k].t; }); return o;
  }
  /** Toneladas recebidas por semana (segunda-feira) e fornecedor, pela data de entrega. */
  function recebidoPorSemana(nfs, filtro) {
    var o = {};
    nfs.filter(filtro || ehEstrutura).forEach(function (n) {
      var d = n.dt || n.de; if (!d) return;
      var dt = new Date(d + 'T12:00:00Z'), dow = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - dow);
      var w = dt.toISOString().slice(0, 10), x = o[w] = o[w] || {}; x[n.f] = (x[n.f] || 0) + n.q;
    });
    return o;
  }


  // ===================== PRIORIDADE DE TRAMOS =====================
  /**
   * Distribui o estoque seguindo uma ordem de prioridade: primeiro as torres dos tramos (na ordem em que foram
   * priorizados, e dentro de cada tramo na ordem da LC), depois — se opts.resto — as demais torres na ordem da LC.
   * tramos: [{id, nome, deOp, ateOp, tipos?:[tipoId]}]
   * opts: {escopo: 'canteiro' (só estoque do canteiro da torre) | 'obra' (pode puxar de outros canteiros), resto: bool}
   */
  function prioridade(tipos, torres, canteiros, saldos, reservas, aplicado, tramos, opts) {
    opts = opts || {};
    var ativos = canteiros.filter(function (c) { return c.ativo !== false; });
    var tpById = {}; tipos.forEach(function (t) { tpById[t.id] = t; });
    var est = {};
    tipos.forEach(function (t) { est[t.id] = {}; ativos.forEach(function (c) { est[t.id][c.id] = estoqueDo(saldos, reservas, c.id, t); }); });
    var porOp = torres.slice().sort(function (a, b) { return a.op - b.op; });
    var ordem = [], visto = {};
    tramos.forEach(function (tr, ti) {
      var lo = Math.min(tr.deOp, tr.ateOp), hi = Math.max(tr.deOp, tr.ateOp);
      porOp.forEach(function (t) {
        if (visto[t.n] || t.op < lo || t.op > hi) return;
        if (tr.tipos && tr.tipos.length && tr.tipos.indexOf(t.t) < 0) return;
        visto[t.n] = 1; ordem.push({ t: t, tramo: ti });
      });
    });
    if (opts.resto !== false) porOp.forEach(function (t) { if (!visto[t.n]) ordem.push({ t: t, tramo: -1 }); });
    var res = {}, movs = [];
    ordem.forEach(function (o) {
      var t = o.t, tp = tpById[t.t]; if (!tp || !est[t.t][t.c]) return;
      var st = statusTorre(tp, t, aplicado);
      if (st === 'montada') { res[t.n] = { tramo: o.tramo, situacao: 'montada', status: st, falta: [], origem: [] }; return; }
      var need = necessidade(tp, t, aplicado), own = est[t.t][t.c];
      if (cobre(own, need)) { tirar(own, need); res[t.n] = { tramo: o.tramo, situacao: 'pronta', status: st, falta: [], origem: [] }; return; }
      if (opts.escopo === 'obra' && o.tramo >= 0) { // transferência só para torres dos tramos priorizados
        var plano = [], ok = true, falta = [];
        for (var v in need) {
          var q = need[v] - Math.max(0, own[v] || 0); if (q <= 0) continue;
          var doad = ativos.filter(function (c) { return c.id !== t.c && (est[t.t][c.id][v] || 0) > 0; })
            .sort(function (a, b) { return (est[t.t][b.id][v] || 0) - (est[t.t][a.id][v] || 0); });
          for (var j = 0; j < doad.length && q > 0; j++) { var x = Math.min(q, est[t.t][doad[j].id][v]); plano.push({ origemId: doad[j].id, componenteId: v, qtd: x }); q -= x; }
          if (q > 0) { ok = false; falta.push({ componenteId: v, qtd: q }); }
        }
        if (ok) {
          plano.forEach(function (p) { est[t.t][p.origemId][p.componenteId] -= p.qtd; own[p.componenteId] = (own[p.componenteId] || 0) + p.qtd; movs.push({ origemId: p.origemId, destinoId: t.c, tipoId: t.t, componenteId: p.componenteId, qtd: p.qtd, n: t.n, tramo: o.tramo }); });
          tirar(own, need);
          res[t.n] = { tramo: o.tramo, situacao: 'pronta_transf', status: st, falta: [], origem: plano };
          return;
        }
        res[t.n] = { tramo: o.tramo, situacao: 'incompleta', status: st, falta: falta, origem: [] };
        return;
      }
      res[t.n] = { tramo: o.tramo, situacao: 'incompleta', status: st, falta: faltaContra(own, need), origem: [] };
    });
    // resumo por tramo
    var resumo = tramos.map(function (tr, ti) {
      var ts = ordem.filter(function (o) { return o.tramo === ti; }).map(function (o) { return o.t; });
      var r = { total: ts.length, montada: 0, pronta: 0, pronta_transf: 0, incompleta: 0, quase: 0, maiorSeq: 0, seqDe: null, seqAte: null, faltas: {}, torres: ts.map(function (t) { return t.n; }) };
      var seq = 0, ini = null;
      ts.forEach(function (t) {
        var x = res[t.n]; if (!x) return; r[x.situacao]++;
        var ok = x.situacao !== 'incompleta';
        if (ok) { if (!seq) ini = t.n; seq++; if (seq > r.maiorSeq) { r.maiorSeq = seq; r.seqDe = ini; r.seqAte = t.n; } } else seq = 0;
        if (!ok) {
          var tot = x.falta.reduce(function (a, f) { return a + f.qtd; }, 0); if (tot <= 2) r.quase++;
          x.falta.forEach(function (f) { var k = t.t + '|' + f.componenteId, g = r.faltas[k] = r.faltas[k] || { tipoId: t.t, componenteId: f.componenteId, qtd: 0, torres: 0 }; g.qtd += f.qtd; g.torres++; });
        }
      });
      r.faltas = Object.keys(r.faltas).map(function (k) { return r.faltas[k]; }).sort(function (a, b) { return b.torres - a.torres || b.qtd - a.qtd; });
      return r;
    });
    // transferências agregadas
    var porPar = {};
    movs.forEach(function (m) {
      var k = m.origemId + '>' + m.destinoId + '>' + m.tipoId, x = porPar[k] = porPar[k] || { origemId: m.origemId, destinoId: m.destinoId, tipoId: m.tipoId, itens: {}, torres: [], tramos: {} };
      x.itens[m.componenteId] = (x.itens[m.componenteId] || 0) + m.qtd; if (x.torres.indexOf(m.n) < 0) x.torres.push(m.n); x.tramos[m.tramo] = 1;
    });
    var transfs = Object.keys(porPar).map(function (k) { var x = porPar[k]; return { origemId: x.origemId, destinoId: x.destinoId, tipoId: x.tipoId, torres: x.torres, tramos: Object.keys(x.tramos).map(Number), itens: itensDeMapa(x.itens) }; });
    return { torres: res, tramos: resumo, transferencias: transfs };
  }

  return {
    NATUREZAS: NATUREZAS, STATUS_TRANSF: STATUS_TRANSF, key: key, get: get, fmt: fmt,
    calcularSaldos: calcularSaldos, calcularReservas: calcularReservas, calcularTransito: calcularTransito, calcularEntrando: calcularEntrando, saldosComEntrada: saldosComEntrada,
    disponivel: disponivel, estoqueDo: estoqueDo, porGrupo: porGrupo, gruposDaTorre: gruposDaTorre, kitDaTorre: kitDaTorre,
    aplicadoPorTorre: aplicadoPorTorre, necessidade: necessidade, statusTorre: statusTorre,
    alocarTipo: alocarTipo, sugerirRemanejamento: sugerirRemanejamento, maximoTeorico: maximoTeorico,
    validarSaida: validarSaida, prioridade: prioridade, lerPlanilhaNFs: lerPlanilhaNFs, lerResumoNFs: lerResumoNFs, conferirNFs: conferirNFs, precoPorFornecedor: precoPorFornecedor, recebidoPorSemana: recebidoPorSemana, ehEstrutura: ehEstrutura, nfsDoMov: nfsDoMov, fornecedorDoMov: fornecedorDoMov, serialData: serialData, podeTransitar: podeTransitar, pesoItens: pesoItens, itensDeMapa: itensDeMapa, cobre: cobre
  };
})();
if (typeof module !== 'undefined') module.exports = Core;
