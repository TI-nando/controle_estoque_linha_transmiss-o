// ===== Sincronização com a planilha de estoque da empreiteira (puro, sem DOM) =====
// Lê o modelo "Resumo de Estruturas" (abas RESUMO ESTRUTURAS, LANÇAMENTO, TRANSFERENCIA, APLICAÇÃO, LC ...)
// e gera os lançamentos com identificadores estáveis: a mesma linha da planilha gera sempre o mesmo id,
// então reenviar a planilha toda semana só grava o que é novo, mudou ou sumiu.
// A planilha é a referência: um ajuste de conciliação por canteiro/tipo faz o saldo bater com a coluna ESTOQUE.
var Sync = (function () {
  // ---------- md5 (ids compatíveis com a ferramenta de importação em Python) ----------
  function md5(str) {
    var bytes = unescape(encodeURIComponent(str)), n = bytes.length, i;
    var words = []; for (i = 0; i < n; i++) words[i >> 2] |= bytes.charCodeAt(i) << ((i % 4) * 8);
    words[n >> 2] |= 0x80 << ((n % 4) * 8);
    var nb = (((n + 8) >> 6) + 1) * 16; for (i = (n >> 2) + 1; i < nb; i++) words[i] = words[i] | 0;
    words[nb - 2] = n * 8;
    var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21], K = [];
    for (i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (var off = 0; off < nb; off += 16) {
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        var s = S[(i >> 4) * 4 + (i % 4)], t = (A + F + K[i] + (words[off + g] | 0)) | 0;
        A = D; D = C; C = B; B = (B + ((t << s) | (t >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    return [a0, b0, c0, d0].map(function (x) { var h = ''; for (var j = 0; j < 4; j++) h += ('0' + ((x >>> (j * 8)) & 255).toString(16)).slice(-2); return h; }).join('');
  }

  // ---------- normalizações (espelham o importador em Python) ----------
  function ehData(v) { return v && typeof v === 'object' && v.__d !== undefined; }
  function pyStr(v) {
    if (v === null || v === undefined) return 'None';
    if (ehData(v)) return v.__d + ' 00:00:00';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    return String(v);
  }
  function norm(v) { return (v === null || v === undefined || v === '' || v === 0 || v === false ? '' : pyStr(v)).trim().replace(/\s+/g, ' ').toUpperCase(); }
  function slug(s) { return String(s).normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'canteiro'; }
  function num(x) { return x === null || x === undefined || x === '' ? 0 : parseFloat(String(x).replace(',', '.')); }
  function h() { return md5(Array.prototype.map.call(arguments, pyStr).join('|')).slice(0, 12); }
  function dia(v) { return ehData(v) ? v.__d : null; }
  function vazio(v) { return v === null || v === undefined || v === ''; }
  function inteiro(v) { return Math.trunc(Number(v)) || 0; }
  function tituloCaso(s) { return s.toLowerCase().replace(/(^|[^a-zà-ÿ])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); }); }

  // Converte uma aba do SheetJS em linhas (a partir de A1), com datas marcadas como {__d:'aaaa-mm-dd'}
  function linhasAba(XLSX, ws) {
    if (!ws || !ws['!ref']) return [];
    var r = XLSX.utils.decode_range(ws['!ref']), out = [];
    for (var i = 0; i <= r.e.r; i++) {
      var row = [];
      for (var j = 0; j <= r.e.c; j++) {
        var c = ws[XLSX.utils.encode_cell({ r: i, c: j })], v = null;
        if (c) {
          if (c.t === 'n') v = c.z && XLSX.SSF.is_date(c.z) ? { __d: serial(c.v) } : c.v;
          else if (c.t === 'd') v = { __d: c.v.toISOString().slice(0, 10) };
          else if (c.t === 's' || c.t === 'str') v = c.v;
          else if (c.t === 'b') v = c.v;
        }
        row.push(v);
      }
      out.push(row);
    }
    return out;
  }
  function serial(v) { return new Date(Math.round((Math.floor(v + 1e-9) - 25569) * 864e5)).toISOString().slice(0, 10); }

  function acharAba(nomes, alvo) {
    var n = function (s) { return s.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toUpperCase().trim(); };
    return nomes.find(function (x) { return x === alvo; }) || nomes.find(function (x) { return n(x) === n(alvo); });
  }

  // ---------- leitura da planilha ----------
  // abas: {nome: linhas[][]} (use linhasAba). Retorna o pacote no mesmo formato de dados-projeto.json.
  function lerPlanilhaEstoque(abas, opt) {
    opt = opt || {};
    var nomes = Object.keys(abas), faltam = [];
    var aRes = acharAba(nomes, 'RESUMO ESTRUTURAS'), aLan = acharAba(nomes, 'LANÇAMENTO'), aTr = acharAba(nomes, 'TRANSFERENCIA'), aAp = acharAba(nomes, 'APLICAÇÃO');
    var aLc = opt.abaLc || nomes.find(function (x) { return x.toUpperCase().indexOf('LC') === 0; });
    [['RESUMO ESTRUTURAS', aRes], ['LANÇAMENTO', aLan], ['TRANSFERENCIA', aTr], ['APLICAÇÃO', aAp], ['LC (lista de construção)', aLc]].forEach(function (x) { if (!x[1]) faltam.push(x[0]); });
    if (faltam.length) throw new Error('A planilha não está no modelo esperado. Abas não encontradas: ' + faltam.join(', ') + '.');
    var L = function (aba, ini) { return (abas[aba] || []).slice(ini); };
    var cel = function (r, j) { return r && j < r.length ? r[j] : null; };

    // catálogo + coluna ESTOQUE por canteiro
    var res = abas[aRes], cab = res.slice(0, 30).find(function (r) { return r.some(function (x) { return norm(x) === 'GERAL'; }); }) || [];
    var fim = cab.findIndex(function (x) { return norm(x) === 'GERAL'; }); if (fim < 0) fim = cab.length;
    var blocos = [];
    for (var j = 8; j < fim; j += 12) {
      var textos = cab.slice(j, j + 12).map(norm).filter(function (x) { return x && x.length > 3; });
      if (textos.length) { var nome = textos.reduce(function (a, b) { return b.length > a.length ? b : a; }); blocos.push([nome, j]); }
    }
    if (!blocos.length) throw new Error('Não encontrei os blocos de canteiro (cabeçalho com "GERAL") na aba RESUMO ESTRUTURAS.');
    var vol = [];
    res.forEach(function (r) {
      if (!cel(r, 3) || cel(r, 0) !== 'EST') return;
      var est = {}; blocos.forEach(function (b) { est[b[0]] = cel(r, b[1] + 11) || 0; });
      vol.push({ tipo: norm(r[3]), grupo: pyStr(cel(r, 1)).trim(), nome: pyStr(cel(r, 4)).trim(), peso: cel(r, 6) || 0, forn: cel(r, 7), est: est });
    });
    var vid = function (v) { return 'v' + h(v.tipo, v.grupo, norm(v.nome)).slice(0, 10); };
    var volkey = new Map(); vol.forEach(function (v) { volkey.set(v.tipo + '\u0001' + norm(v.nome), vid(v)); });
    var volume = function (tp, nm) { return volkey.get(norm(tp) + '\u0001' + norm(nm)); };
    var tipos = new Map();
    vol.forEach(function (v) {
      if (!tipos.has(v.tipo)) tipos.set(v.tipo, { id: v.tipo, codigo: v.tipo, volumes: [], fornecedor: v.forn == null ? '' : String(v.forn) });
      tipos.get(v.tipo).volumes.push({ id: vid(v), nome: v.nome, grupo: v.grupo, pesoKg: Math.round(Number(v.peso || 0) * 1000) / 1000 });
    });

    // canteiros
    var lc = L(aLc, 6).filter(function (r) { return cel(r, 16) && cel(r, 0); });
    var ordem = [], CANT = {};
    var addC = function (n) { if (!CANT[n]) { CANT[n] = { id: slug(n), nome: tituloCaso(n), sigla: n.slice(0, 2), local: '', trecho: '' }; ordem.push(n); } };
    lc.forEach(function (r) { addC(norm(cel(r, 43))); });
    [[aLan, 1], [aAp, 1]].forEach(function (x) { L(x[0], 2).forEach(function (r) { if (cel(r, x[1])) addC(norm(r[x[1]])); }); });

    var ignoradas = [], movs = [], transfs = [];
    var agrupar = function (m, k, mk) { var g = m.get(k); if (!g) { g = mk(); m.set(k, g); } return g; };
    var somar = function (map, k, q) { map.set(k, (map.get(k) || 0) + q); };
    var itensDe = function (map, sinal) { var a = []; map.forEach(function (q, k) { a.push({ componenteId: k, qtd: sinal * q }); }); return a; };

    // recebimentos
    var grp = new Map();
    L(aLan, 2).forEach(function (r) {
      if (!(cel(r, 1) && cel(r, 7) && !vazio(cel(r, 9)))) return;
      var vv = volume(r[7], r[8]);
      if (!vv) { ignoradas.push(['Recebimento sem volume correspondente no catálogo', norm(r[1]), norm(r[7]), vazio(r[8]) ? '' : pyStr(r[8]), pyStr(r[9])]); return; }
      var k = [norm(r[1]), cel(r, 2), cel(r, 3), dia(cel(r, 4)), norm(r[7])];
      var g = agrupar(grp, k.map(pyStr).join('\u0001'), function () { return { k: k, itens: new Map(), forn: {}, obs: {} }; });
      somar(g.itens, vv, inteiro(r[9]));
      if (cel(r, 5)) g.forn[pyStr(r[5]).trim()] = 1;
      if (cel(r, 12)) g.obs[pyStr(r[12]).trim()] = 1;
    });
    var datas = []; grp.forEach(function (g) { if (g.k[3]) datas.push(g.k[3]); }); datas.sort();
    // registro das notas fiscais da empreiteira (aba LANÇAMENTO), agrupado por fornecedor + nº da NF como está na célula
    var nfe = new Map();
    L(aLan, 2).forEach(function (r) {
      if (!(cel(r, 1) && cel(r, 7) && !vazio(cel(r, 9)))) return;
      var f = norm(cel(r, 5)), txt = vazio(cel(r, 2)) ? '' : pyStr(cel(r, 2)).trim().toUpperCase(), k = f + '|' + txt;
      var x = nfe.get(k); if (!x) { x = { f: f, nfTxt: txt, nfs: separarNFs(txt), roms: {}, cants: {}, datas: {}, vol: 0, kg: 0, tipos: {}, rnc: {}, linhas: 0 }; nfe.set(k, x); }
      var q = inteiro(r[9]), pt = numBR(cel(r, 11)), pu = numBR(cel(r, 10));
      x.linhas++; x.vol += q; x.kg += pt > 0 ? pt : (pu > 0 ? pu * q : 0);
      if (!vazio(cel(r, 3))) x.roms[pyStr(r[3]).trim().toUpperCase()] = 1;
      x.cants[norm(r[1])] = 1; var d = dia(cel(r, 4)); if (d) x.datas[d] = 1; x.tipos[norm(r[7])] = 1;
      if (cel(r, 12)) x.rnc[pyStr(r[12]).trim()] = 1;
    });
    var nfsEmp = []; nfe.forEach(function (x) { var ds = Object.keys(x.datas).sort(); nfsEmp.push({ f: x.f, nfTxt: x.nfTxt, nfs: x.nfs, roms: Object.keys(x.roms), cants: Object.keys(x.cants).map(tituloCaso), d1: ds[0] || '', d2: ds[ds.length - 1] || '', vol: x.vol, kg: Math.round(x.kg * 10) / 10, tipos: Object.keys(x.tipos).sort(), rnc: Object.keys(x.rnc), linhas: x.linhas }); });
    grp.forEach(function (g) {
      var c = g.k[0], nf = g.k[1], rom = g.k[2], d = g.k[3], tp = g.k[4], consolidado = !d, ob = Object.keys(g.obs).sort();
      var obs = Object.keys(g.forn).sort().join(', ') + (ob.length ? ' · Obs./RNC: ' + ob.join('; ') : '');
      if (consolidado) obs += ' · lançamento consolidado (sem data na planilha); data assumida = primeiro recebimento';
      movs.push({ id: 'imp_r_' + h(c, nf, rom, d, tp), natureza: 'ENTRADA', canteiroId: CANT[c].id, tipoId: tp, data: d || datas[0] || null,
        documento: consolidado ? 'Diversas NFs' : 'NF ' + pyStr(nf) + ' · Rom. ' + pyStr(rom), obs: obs, itens: itensDe(g.itens, 1) });
    });

    // transferências (origem fora dos canteiros da obra = entrada)
    grp = new Map();
    L(aTr, 2).forEach(function (r) {
      if (!(cel(r, 1) && cel(r, 5) && !vazio(cel(r, 7)))) return;
      var vv = volume(r[5], r[6]);
      if (!vv) { ignoradas.push(['Transferência sem volume correspondente no catálogo', norm(r[1]) + '>' + norm(r[2]), norm(r[5]), vazio(r[6]) ? '' : pyStr(r[6]), pyStr(r[7])]); return; }
      var k = [norm(r[1]), norm(cel(r, 2)), pyStr(cel(r, 3)).trim(), dia(cel(r, 4)), norm(r[5])];
      somar(agrupar(grp, k.map(pyStr).join('\u0001'), function () { return { k: k, itens: new Map() }; }).itens, vv, inteiro(r[7]));
    });
    grp.forEach(function (g) {
      var o = g.k[0], de = g.k[1], rom = g.k[2], d = g.k[3], tp = g.k[4], it = itensDe(g.itens, 1);
      if (!CANT[o] || !CANT[de]) {
        if (CANT[de]) movs.push({ id: 'imp_r_' + h(o, de, rom, d, tp), natureza: 'ENTRADA', canteiroId: CANT[de].id, tipoId: tp, data: d, documento: 'Rom. ' + rom, obs: 'Recebido de ' + tituloCaso(o) + ' (fora do sistema)', itens: it });
        return;
      }
      var tid = 'imp_t_' + h(o, de, rom, d, tp), q = d + 'T12:00:00.000Z';
      transfs.push({ id: tid, numero: 'ROM ' + rom + ' · ' + tp, origemId: CANT[o].id, destinoId: CANT[de].id, tipoId: tp, itens: it, status: 'RECEBIDA', obs: 'Importada da planilha', romaneio: rom,
        criadoEm: q, despachadoEm: q, recebidoEm: q, dataDespacho: d, dataRecebimento: d, itensRecebidos: it, criadoPor: 'importacao', despachadoPor: 'importacao', recebidoPor: 'importacao' });
      movs.push({ id: 'ts_' + tid, natureza: 'TRANSF_SAIDA', canteiroId: CANT[o].id, tipoId: tp, data: d, transferenciaId: tid, documento: 'Rom. ' + rom, obs: 'Para ' + CANT[de].nome, itens: itensDe(g.itens, -1) });
      movs.push({ id: 'te_' + tid, natureza: 'TRANSF_ENTRADA', canteiroId: CANT[de].id, tipoId: tp, data: d, transferenciaId: tid, documento: 'Rom. ' + rom, obs: 'De ' + CANT[o].nome, itens: it });
    });

    // aplicações em torre
    grp = new Map();
    L(aAp, 2).forEach(function (r) {
      if (!(cel(r, 1) && cel(r, 5) && !vazio(cel(r, 7)))) return;
      var vv = volume(r[5], r[6]);
      if (!vv) { ignoradas.push(['Aplicação sem volume correspondente no catálogo', norm(r[1]), norm(r[5]), vazio(r[6]) ? '' : pyStr(r[6]), pyStr(r[7])]); return; }
      var k = [norm(r[1]), pyStr(cel(r, 2)).trim(), pyStr(cel(r, 3)).trim(), dia(cel(r, 4)), norm(r[5])];
      somar(agrupar(grp, k.map(pyStr).join('\u0001'), function () { return { k: k, itens: new Map() }; }).itens, vv, inteiro(r[7]));
    });
    grp.forEach(function (g) {
      var c = g.k[0], local = g.k[1], rom = g.k[2], d = g.k[3], tp = g.k[4];
      if (!CANT[c]) return;
      movs.push({ id: 'imp_a_' + h(c, local, rom, d, tp), natureza: 'APLICACAO', canteiroId: CANT[c].id, tipoId: tp, data: d, numeroTorre: local, documento: 'Rom. ' + rom, obs: 'Aplicação na torre ' + local, itens: itensDe(g.itens, -1) });
    });

    // estoque informado na planilha (coluna ESTOQUE do resumo), por canteiro|tipo|volume
    var estoque = {};
    vol.forEach(function (v) {
      ordem.forEach(function (c) { if (c in v.est) estoque[CANT[c].id + '|' + v.tipo + '|' + vid(v)] = inteiro(v.est[c] || 0); });
    });
    var torres = lc.map(function (r) {
      return { n: pyStr(r[0]).trim(), op: r[1], t: norm(r[16]), h: r[17] === null || r[17] === undefined ? null : num(r[17]), e: num(r[18]), p: [19, 20, 21, 22].map(function (j) { return num(cel(r, j)); }), c: CANT[norm(r[43])].id };
    });
    var canteiros = ordem.map(function (n) { return CANT[n]; }).filter(function (c) { return torres.some(function (t) { return t.c === c.id; }) || movs.some(function (m) { return m.canteiroId === c.id; }); });
    var tl = []; tipos.forEach(function (t) { tl.push(t); }); tl.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return { canteiros: canteiros, tipos: tl, torres: torres, movimentos: movs, transferencias: transfs, ignoradas: ignoradas, estoque: estoque, nfsEmp: nfsEmp };
  }


  // "52 E 53", "19, 20 E 21", "165, 166 e 168" → ['52','53'] ...
  function separarNFs(txt) {
    var t = String(txt || '').toUpperCase().trim(); if (!t || /DIVERS/.test(t)) return [];
    return t.split(/\s*(?:,|;|\/|\bE\b|&)\s*/).map(function (x) { var d = x.replace(/[^\dA-Z-]/g, ''); return /^\d+$/.test(d) ? String(Number(d)) : d; }).filter(Boolean);
  }
  function numBR2(x) { return numBR(x); }

  // ---------- controle de NFs da empreiteira ("Materiais Controle NF") ----------
  function fornNorm(f) { var x = semAcento(f).replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); return x.replace(/^((?:[A-Z] )+[A-Z])$/, function (m) { return m.replace(/ /g, ''); }); }
  function ehControleNFEmp(linhas) { return linhas.slice(0, 15).some(function (l) { var t = semAcento(l.join(' | ')); return /RECEBIDO NA OBRA/.test(t) && /\bNOTA\b/.test(t) && /ROMANEIO/.test(t); }); }
  function lerControleNFEmp(linhas) {
    var hi = -1, col = {};
    for (var i = 0; i < Math.min(linhas.length, 20); i++) { var t = (linhas[i] || []).map(semAcento); if (t.indexOf('NOTA') >= 0 && t.some(function (x) { return /RECEBIDO NA OBRA/.test(x); })) { hi = i; break; } }
    if (hi < 0) throw new Error('Não encontrei o cabeçalho (FORNECEDOR, NOTA, ROMANEIO, RECEBIDO NA OBRA…).');
    var H = linhas[hi].map(semAcento), H2 = (linhas[hi + 1] || []).map(semAcento);
    var achar = function (re) { var j = H.findIndex(function (x) { return re.test(x); }); if (j < 0) j = H2.findIndex(function (x) { return re.test(x); }); return j; };
    col = { f: achar(/^FORNECEDOR$/), carga: achar(/^CARGA$/), placa: achar(/PLACA/), dnf: achar(/^DATA NF/), desc: achar(/DESCRICAO/), rec: achar(/RECEBIDO NA OBRA/), env: achar(/ENVIADO NF/), cant: achar(/^CANTEIRO$/), nota: achar(/^NOTA$/), cte: achar(/^CT-?E$/), rom: achar(/^ROMANEIO$/), fat: achar(/^FATURA$/), log: achar(/^LOGISTICA$/), rnc: achar(/^RNC$/), val: achar(/^VALOR NF/), pl: achar(/PESO LIQUIDO/), pb: achar(/PESO BRUTO/) };
    if (col.nota < 0 || col.f < 0) throw new Error('Faltam as colunas FORNECEDOR ou NOTA.');
    var v = function (r, k) { return col[k] >= 0 ? r[col[k]] : null; }, txt = function (x) { return vazio(x) || x === '-' ? '' : (ehData(x) ? x.__d : String(x).trim()); };
    var out = [];
    linhas.slice(hi + 1).forEach(function (r) {
      if (!r) return; var f = fornNorm(v(r, 'f')), nota = txt(v(r, 'nota'));
      if (!f || (!nota && !txt(v(r, 'rom')))) return;
      var nfs = separarNFs(nota), rom = txt(v(r, 'rom')), cant = txt(v(r, 'cant')).split('/')[0].trim();
      var pl = numBR(v(r, 'pl')), pb = numBR(v(r, 'pb')), val = numBR(v(r, 'val'));
      out.push({ f: f, nfTxt: nfs.join(', ') || nota.toUpperCase(), nfs: nfs, roms: rom ? [rom] : [], cants: cant ? [cant.replace(/(^|\s)\S/g, function (z) { return z.toUpperCase(); })] : [],
        d1: dia(v(r, 'rec')) || '', d2: dia(v(r, 'rec')) || '', dataNF: dia(v(r, 'dnf')) || '', enviado: dia(v(r, 'env')) || txt(v(r, 'env')),
        carga: txt(v(r, 'carga')), placa: txt(v(r, 'placa')), cte: txt(v(r, 'cte')), fatura: txt(v(r, 'fat')), logistica: txt(v(r, 'log')), desc: txt(v(r, 'desc')),
        rnc: txt(v(r, 'rnc')) ? [txt(v(r, 'rnc'))] : [], valor: val > 0 ? val : 0, kgLiq: pl > 0 ? pl : 0, kgBruto: pb > 0 ? pb : 0, kg: pl > 0 ? pl : (pb > 0 ? pb : 0), vol: 0, tipos: [], fonte: 'controle' });
    });
    return out;
  }
  // ---------- cruzamento: notas da empreiteira × controle interno de NFs ----------
  // emp: pac.nfsEmp; int: NFs do controle interno (lerPlanilhaNFs, só estrutura). Retorna grupos por carga (NFs ligadas entre si).
  function cruzarNFs(emp, int, opt) {
    opt = opt || {}; var tolPct = opt.tolPct || 0.05, tolT = opt.tolT || 0.3, diasTol = opt.diasTol == null ? 3 : opt.diasTol;
    var pai = {}, find = function (x) { while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; } return x; }, uni = function (a, b) { a = find(a); b = find(b); if (a !== b) pai[a] = b; };
    var add = function (x) { if (pai[x] === undefined) pai[x] = x; };
    var idxInt = {}, idxNff = {};
    var idxRom = {}, romOk = function (r) { r = String(r || '').toUpperCase().replace(/[^0-9A-Z-]/g, '').replace(/^-+|-+$/g, '').replace(/^0+/, ''); return /\d{3,}/.test(r) ? r : ''; };
    emp = emp.map(function (e) { var rs = []; e.roms.forEach(function (r) { var p = separarNFs(r); (p.length ? p : [r]).forEach(function (x) { rs.push(x); }); }); return Object.assign({}, e, { romsSep: rs }); });
    var base = function (x) { return String(x || '').toUpperCase().replace(/[A-Z]+$/, ''); };
    int.forEach(function (n, i) { var id = 'i' + i; add(id); if (base(n.nf) !== n.nf && !idxInt[n.f + '|' + base(n.nf)]) idxInt[n.f + '|' + base(n.nf)] = id; idxInt[n.f + '|' + n.nf] = id; if (n.nff) idxNff[n.f + '|' + n.nff] = idxNff[n.f + '|' + n.nff] || id; (n.rom || []).forEach(function (r) { r = romOk(r); if (r) (idxRom[n.f + '|' + r] = idxRom[n.f + '|' + r] || []).push(id); }); });
    emp.forEach(function (e, i) {
      var id = 'e' + i; add(id);
      e.nfs.forEach(function (nf) { var j = idxInt[e.f + '|' + nf] || idxNff[e.f + '|' + nf]; if (j) uni(id, j); });
      // mesma carga: o romaneio lançado pela empreiteira aparece em outra NF do controle interno
      e.romsSep.forEach(function (r) { r = romOk(r); if (!r) return; (idxRom[e.f + '|' + r] || []).forEach(function (j) { uni(id, j); }); if (idxNff[e.f + '|' + r]) uni(id, idxNff[e.f + '|' + r]); });
    });
    var gs = {};
    Object.keys(pai).forEach(function (id) { var r = find(id), g = gs[r] = gs[r] || { int: [], emp: [] }; if (id[0] === 'i') g.int.push(int[+id.slice(1)]); else g.emp.push(emp[+id.slice(1)]); });
    var cant1 = function (t) { return semAcento(String(t || '').split(' - ')[0]).split(' ')[0]; };
    var dif = function (a, b) { return Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5); };
    return Object.keys(gs).map(function (k) {
      var g = gs[k], tInt = g.int.reduce(function (a, n) { return a + (Number(n.q) || 0); }, 0), tEmp = g.emp.reduce(function (a, e) { return a + e.kg; }, 0) / 1000;
      var o = { fornecedor: (g.int[0] || g.emp[0]).f, int: g.int, emp: g.emp, tInt: tInt, tEmp: tEmp, delta: tEmp - tInt, flags: [] };
      if (!g.emp.length) o.status = 'so_int';
      else if (!g.int.length) o.status = 'so_emp';
      else if (!(tEmp > 0)) { o.status = 'confere'; o.semPeso = true; o.flags.push({ k: 'sempeso', t: 'Sem peso na planilha da empreiteira: só NF e romaneio conferidos' }); }
      else o.status = Math.abs(o.delta) <= Math.max(tolPct * tInt, tolT) ? 'confere' : 'peso';
      // NF repetida na planilha da empreiteira
      var vistas = {}, rep = []; g.emp.forEach(function (e) { e.nfs.forEach(function (n) { if (vistas[n]) rep.push(n); vistas[n] = 1; }); });
      if (rep.length) o.flags.push({ k: 'dup', t: 'NF repetida na planilha da empreiteira: ' + rep.filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') });
      // valor da NF
      var vI = g.int.reduce(function (a, n) { return a + (Number(n.v) || 0); }, 0), vE = g.emp.reduce(function (a, e) { return a + (Number(e.valor) || 0); }, 0);
      o.vInt = vI; o.vEmp = vE;
      if (vI > 0 && vE > 0 && Math.abs(vE - vI) > Math.max(0.01 * vI, 1)) o.flags.push({ k: 'valor', t: 'Valor diferente: interno R$ ' + vI.toFixed(2).replace('.', ',') + ' × empreiteira R$ ' + vE.toFixed(2).replace('.', ',') });
      // recebida na obra e NF ainda não enviada ao contratante
      var nEnv = g.emp.filter(function (e) { return e.fonte === 'controle' && e.d1 && !e.enviado && (!opt.envDesde || e.d1 >= opt.envDesde); });
      if (nEnv.length && opt.hoje) { var dd = Math.max.apply(null, nEnv.map(function (e) { return dif(opt.hoje, e.d1); })); if (dd > 3) o.flags.push({ k: 'naoenviada', t: 'Recebida na obra há ' + dd + ' dias e a NF ainda não foi enviada ao ' + (opt.contratante || 'contratante') + '' }); }
      if (g.int.length && g.emp.length) {
        var ci = {}, ce = {}; g.int.forEach(function (n) { ci[cant1(n.can)] = 1; }); g.emp.forEach(function (e) { e.cants.forEach(function (c) { ce[cant1(c)] = 1; }); });
        if (Object.keys(ce).some(function (c) { return !ci[c]; })) o.flags.push({ k: 'canteiro', t: 'Canteiro diferente: interno ' + Object.keys(ci).join('/') + ' × empreiteira ' + Object.keys(ce).join('/') });
        var ri = {}; g.int.forEach(function (n) { (n.rom || []).forEach(function (r) { ri[romOk(r)] = 1; }); if (n.nff) ri[romOk(n.nff)] = 1; }); delete ri[''];
        var re = []; g.emp.forEach(function (e) { e.romsSep.forEach(function (r) { r = romOk(r); if (r) re.push(r); }); });
        var fora = re.filter(function (r) { return Object.keys(ri).length && !ri[r]; });
        // NF lançada pela empreiteira com romaneio de outra NF do controle interno
        var troca = []; g.emp.forEach(function (e) { e.romsSep.forEach(function (r) { r = romOk(r); if (!r) return; var donosN = g.int.filter(function (n) { return (n.rom || []).some(function (x) { return romOk(x) === r; }); }), donos = donosN.map(function (n) { return n.nf; }); if (donos.length && e.nfs.length && !donosN.some(function (n) { return !/\d/.test(n.nf) || e.nfs.indexOf(n.nf) >= 0 || e.nfs.indexOf(base(n.nf)) >= 0 || (n.nff && e.nfs.indexOf(String(n.nff)) >= 0); })) troca.push('NF ' + e.nfTxt + ' com rom. ' + r + ' (no controle é da NF ' + donos.join('/') + ')'); }); });
        if (troca.length) o.flags.push({ k: 'troca', t: 'Romaneio de outra NF: ' + troca.slice(0, 4).join('; ') + (troca.length > 4 ? '…' : '') });
        if (fora.length) o.flags.push({ k: 'romaneio', t: 'Romaneio ' + fora.slice(0, 5).join(', ') + (fora.length > 5 ? '…' : '') + ' da empreiteira não aparece no controle interno' });
        var dt = g.int.map(function (n) { return n.dt; }).filter(Boolean).sort()[0], de = g.emp.map(function (e) { return e.d1; }).filter(Boolean).sort()[0];
        if (dt && de && Math.abs(dif(de, dt)) > diasTol) o.flags.push({ k: 'data', t: 'Recebimento na empreiteira ' + (dif(de, dt) > 0 ? dif(de, dt) + ' dia(s) depois' : -dif(de, dt) + ' dia(s) antes') + ' da entrega do controle interno' });
      }
      if (g.emp.some(function (e) { return e.rnc.length; })) o.flags.push({ k: 'rnc', t: 'RNC/observação: ' + [].concat.apply([], g.emp.map(function (e) { return e.rnc; })).join('; ') });
      if (g.emp.some(function (e) { return !e.nfs.length; })) o.flags.push({ k: 'semnf', t: 'Lançamento da empreiteira sem número de NF (' + g.emp.filter(function (e) { return !e.nfs.length; }).map(function (e) { return e.nfTxt || 'vazio'; }).join(', ') + ')' });
      var cantsEmp = {}; g.emp.forEach(function (e) { e.cants.forEach(function (c) { cantsEmp[c] = 1; }); });
      if (Object.keys(cantsEmp).length > 1) o.flags.push({ k: 'doiscant', t: 'Mesma NF lançada em mais de um canteiro: ' + Object.keys(cantsEmp).join(', ') });
      o.data = (g.int.map(function (n) { return n.dt || n.de; }).filter(Boolean).sort()[0]) || (g.emp.map(function (e) { return e.d1; }).filter(Boolean).sort()[0]) || '';
      if (o.status === 'so_int' && g.int.every(function (n) { return n.dt; })) { var ult = g.int.map(function (n) { return n.dt; }).sort().pop(); o.diasSemLancar = opt.hoje ? dif(opt.hoje, ult) : 0; }
      return o;
    });
  }
  // ---------- plano de sincronização ----------
  var RX_IMP_MOV = /^(imp_|ts_imp_|te_imp_)/, RX_IMP_TR = /^imp_t_/;
  function semMeta(o) { var x = {}; Object.keys(o).sort().forEach(function (k) { if (k !== 'id' && k !== 'criadoEm' && k !== 'usuarioId' && k !== 'atualizadoEm') x[k] = k === 'itens' || k === 'itensRecebidos' ? ordItens(o[k]) : o[k]; }); return JSON.stringify(x); }
  function ordItens(it) { return (it || []).filter(function (i) { return i.qtd; }).map(function (i) { return [i.componenteId, i.qtd]; }).sort(); }

  // pac: lerPlanilhaEstoque(...); atual: {movimentos, transferencias, tipos, torres, canteiros}; hoje: 'aaaa-mm-dd'
  function planejar(pac, atual, hoje) {
    var exM = {}, exT = {};
    atual.movimentos.forEach(function (m) { exM[m.id] = m; });
    atual.transferencias.forEach(function (t) { exT[t.id] = t; });
    // recebimento lançado pelo sistema (carga prevista) que agora também aparece na planilha: a linha da planilha prevalece
    var romPl = {};
    pac.movimentos.forEach(function (m) { var r = /Rom\. (.+)$/.exec(m.documento || ''); if (m.natureza === 'ENTRADA' && r) r[1].split(/\s*,\s*|\s+e\s+/).forEach(function (x) { romPl[m.canteiroId + '|' + m.tipoId + '|' + x.trim().toUpperCase()] = 1; }); });
    var absorvidos = atual.movimentos.filter(function (m) { return !RX_IMP_MOV.test(m.id) && m.natureza === 'ENTRADA' && m.cargaId && m.romaneio && romPl[m.canteiroId + '|' + m.tipoId + '|' + String(m.romaneio).trim().toUpperCase()]; });
    var abs = {}; absorvidos.forEach(function (m) { abs[m.id] = 1; });
    var nativos = atual.movimentos.filter(function (m) { return !RX_IMP_MOV.test(m.id) && !abs[m.id]; });
    // saldo resultante = planilha + lançamentos feitos no próprio sistema; o ajuste fecha a diferença para a coluna ESTOQUE
    var saldo = {};
    var soma = function (m) { (m.itens || []).forEach(function (i) { var k = m.canteiroId + '|' + m.tipoId + '|' + i.componenteId; saldo[k] = (saldo[k] || 0) + (Number(i.qtd) || 0); }); };
    pac.movimentos.forEach(soma); nativos.forEach(soma);
    var aj = {}, ordAj = [];
    Object.keys(pac.estoque).forEach(function (k) {
      var d = pac.estoque[k] - (saldo[k] || 0); if (!d) return;
      var p = k.split('|'), id = 'imp_aj_' + p[0] + '_' + p[1];
      if (!aj[id]) { aj[id] = { id: id, natureza: 'AJUSTE', canteiroId: p[0], tipoId: p[1], data: hoje, documento: 'Conciliação', obs: 'Ajuste para igualar o saldo à coluna ESTOQUE do resumo da planilha (linhas que não puderam ser importadas ou lançamentos feitos fora da planilha)', itens: [] }; ordAj.push(id); }
      aj[id].itens.push({ componenteId: p[2], qtd: d });
    });
    var movs = pac.movimentos.concat(ordAj.map(function (id) { return aj[id]; }));
    var plano = { movSet: [], movDel: [], trSet: [], trDel: [], novos: [], alterados: [], removidos: [], nativos: nativos.length, ajustes: ordAj.length };
    var vistos = {};
    movs.forEach(function (m) {
      vistos[m.id] = 1;
      var ex = exM[m.id];
      if (ex && semMeta(ex) === semMeta(m)) return;
      if (ex && m.natureza === 'AJUSTE' && semMeta(Object.assign({}, ex, { data: hoje })) === semMeta(m)) return;
      var doc = Object.assign({}, m); delete doc.id;
      doc.usuarioId = 'importacao';
      doc.criadoEm = ex && ex.criadoEm ? ex.criadoEm : (m.natureza === 'AJUSTE' ? new Date().toISOString() : (m.data || hoje) + 'T12:00:00.000Z');
      plano.movSet.push({ id: m.id, data: doc });
      (ex ? plano.alterados : plano.novos).push(m);
    });
    atual.movimentos.forEach(function (m) { if (RX_IMP_MOV.test(m.id) && !vistos[m.id]) { plano.movDel.push(m.id); plano.removidos.push(m); } });
    absorvidos.forEach(function (m) { plano.movDel.push(m.id); });
    plano.absorvidos = absorvidos.length;
    // mesma linha com identificador antigo (gerado por versão anterior do importador): não conta como novo/apagado
    var assin = function (m) { return JSON.stringify([m.natureza, m.canteiroId, m.tipoId, m.data, m.documento, m.numeroTorre || '', ordItens(m.itens)]); };
    var rem = {}; plano.removidos.forEach(function (m) { var a = assin(m); (rem[a] = rem[a] || []).push(m); });
    plano.reidentificados = 0;
    plano.novos = plano.novos.filter(function (m) { var l = rem[assin(m)]; if (l && l.length) { var r = l.pop(); plano.removidos.splice(plano.removidos.indexOf(r), 1); plano.reidentificados++; return false; } return true; });
    var vt = {};
    pac.transferencias.forEach(function (t) {
      vt[t.id] = 1; var ex = exT[t.id];
      if (ex && semMeta(ex) === semMeta(t)) return;
      var doc = Object.assign({}, t); delete doc.id; plano.trSet.push({ id: t.id, data: doc });
    });
    atual.transferencias.forEach(function (t) { if (RX_IMP_TR.test(t.id) && !vt[t.id]) plano.trDel.push(t.id); });

    // tipos: acrescenta volumes novos e atualiza peso; mantém a regra de montagem já cadastrada
    plano.tiposSet = [];
    pac.tipos.forEach(function (t) {
      var ex = atual.tipos.find(function (x) { return x.id === t.id; });
      if (!ex) { plano.tiposSet.push({ id: t.id, data: { codigo: t.codigo, nome: t.codigo, estrutura: '', fixacao: '', fornecedor: t.fornecedor || '', regra: { modo: 'autoportante', stubs: 4, fixos: ['TB'] }, volumes: t.volumes }, novo: true, volNovos: t.volumes.length }); return; }
      var vols = (ex.volumes || []).map(function (v) { return Object.assign({}, v); }), mudou = 0, novos = 0;
      t.volumes.forEach(function (v) {
        var a = vols.find(function (x) { return x.id === v.id; });
        if (!a) { vols.push(v); novos++; }
        else if (v.pesoKg && a.pesoKg !== v.pesoKg) { a.pesoKg = v.pesoKg; mudou++; }
      });
      if (novos || mudou) { var d = Object.assign({}, ex, { volumes: vols }); delete d.id; plano.tiposSet.push({ id: t.id, data: d, volNovos: novos, pesos: mudou }); }
    });
    plano.cantNovos = pac.canteiros.filter(function (c) { return !atual.canteiros.some(function (x) { return x.id === c.id; }); });
    plano.torresMudou = JSON.stringify(pac.torres) !== JSON.stringify(atual.torres || []);
    plano.torresDiff = (function () {
      var a = {}, b = {}; (atual.torres || []).forEach(function (t) { a[t.n] = JSON.stringify(t); }); pac.torres.forEach(function (t) { b[t.n] = JSON.stringify(t); });
      var r = { novas: 0, removidas: 0, alteradas: 0 };
      Object.keys(b).forEach(function (n) { if (!a[n]) r.novas++; else if (a[n] !== b[n]) r.alteradas++; });
      Object.keys(a).forEach(function (n) { if (!b[n]) r.removidas++; });
      return r;
    })();
    // saldo antes/depois por canteiro|tipo|volume (para o resumo)
    var depois = {}, antes = {};
    var acum = function (alvo, m) { (m.itens || []).forEach(function (i) { var k = m.canteiroId + '|' + m.tipoId + '|' + i.componenteId; alvo[k] = (alvo[k] || 0) + (Number(i.qtd) || 0); }); };
    atual.movimentos.forEach(function (m) { acum(antes, m); });
    movs.forEach(function (m) { acum(depois, m); }); nativos.forEach(function (m) { acum(depois, m); });
    plano.antes = antes; plano.depois = depois;
    plano.vazio = !plano.movSet.length && !plano.movDel.length && !plano.trSet.length && !plano.trDel.length && !plano.tiposSet.length && !plano.cantNovos.length && !plano.torresMudou;
    return plano;
  }


  // ---------- leitura de NF-e (XML) e romaneio (planilha ou PDF) para cargas a chegar ----------
  function semAcento(x) { return String(x == null ? '' : x).normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  function tag(xml, nome) { var m = new RegExp('<(?:\\w+:)?' + nome + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + nome + '>', 'i').exec(xml); return m ? m[1].trim() : ''; }
  function tags(xml, nome) { var re = new RegExp('<(?:\\w+:)?' + nome + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + nome + '>', 'gi'), out = [], m; while ((m = re.exec(xml))) out.push(m[1]); return out; }
  function desxml(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  function numBR(x) { if (typeof x === 'number') return x; var s = String(x == null ? '' : x).trim(); if (!s) return NaN; if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, ''); return Number(s.replace(',', '.')); }

  // Catálogo para reconhecer volumes pelo nome: [{tipoId, id, nome, n(normalizado), pesoKg}]
  function catalogo(tipos) {
    var c = [];
    tipos.forEach(function (t) { (t.volumes || []).forEach(function (v) { var n = semAcento(v.nome); if (n.length >= 4) c.push({ tipoId: t.id, id: v.id, nome: v.nome, n: n, pesoKg: Number(v.pesoKg || 0) }); }); });
    c.sort(function (a, b) { return b.n.length - a.n.length; });
    return c;
  }
  function camposCabecalho(texto, ctx) {
    var T = semAcento(texto), r = {};
    var reR = /ROMANEIO\s*(?:DE\s+[A-Z]+\s*)?(?:N[O0º°.]*\s*)?[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,})/g, m;
    while ((m = reR.exec(T))) { if (/\d/.test(m[1])) { r.romaneio = m[1].replace(/[.\/-]+$/, ''); break; } reR.lastIndex = m.index + 8; }
    m = /(?:NOTA\s+FISCAL|NF-?E|\bNF)\s*(?:ELETRONICA\s*)?(?:N[O0º°.]*\s*)?[:#\-]?\s*(\d{1,3}(?:\.\d{3})+|\d{2,9})\b/.exec(T); if (m) r.nf = String(Number(m[1].replace(/\./g, '')));
    m = /\b([A-Z]{3}-?\d[A-Z0-9]\d{2})\b/.exec(T); if (m && /\d/.test(m[1])) r.placa = m[1];
    m = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(T); if (m) r.data = m[3] + '-' + m[2] + '-' + m[1];
    (ctx.fornecedores || []).forEach(function (f) { var F = semAcento(f); if (F.length >= 3 && !r.fornecedor && new RegExp('\\b' + F.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(T)) r.fornecedor = String(f).toUpperCase(); });
    (ctx.canteiros || []).forEach(function (c) { var N = semAcento(c.nome); if (N.length >= 3 && !r.canteiroId && T.indexOf(N) >= 0) r.canteiroId = c.id; });
    return r;
  }
  // Reconhece volumes linha a linha. linhas: arrays de células (texto ou número)
  function grupoDoNome(nome) {
    var N = semAcento(nome), m;
    var f = function (x) { return String(Math.round(Number(x.replace(',', '.')) * 10) / 10).replace('.', ','); };
    if ((m = /EXT(?:ENSAO|\.)?\s*(\d+(?:[.,]\d+)?)\s*M/.exec(N))) return 'EXT' + f(m[1]);
    if ((m = /(?:PERNA|\bPE)\s*(\d+(?:[.,]\d+)?)/.exec(N))) return 'PERNA' + f(m[1]);
    if (/STUB|ANCORAGEM|\bAP\b/.test(N)) return 'AP/STB';
    if (/CALOTA/.test(N)) return 'CALOTA';
    if (/\bPINO/.test(N)) return 'PINO';
    if (/ESTAI|CORDOALHA|\bCABO\b/.test(N)) return 'ESTAI';
    return 'TB';
  }
  function itensDeLinhas(linhas, ctx) {
    var cat = ctx.cat, codigos = ctx.tipos.map(function (t) { return t.id; }).sort(function (a, b) { return b.length - a.length; });
    var reCod = codigos.length ? new RegExp('\\b(' + codigos.map(function (c) { return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b') : null;
    var colQ = -1, colP = -1, colT = -1, tipoCtx = '', achados = [], soltos = [], amb = [], novos = [], pesoTotal = 0, fora = [];
    var TF = ctx.tiposForn && ctx.tiposForn.length ? ctx.tiposForn : null, deTF = function (t) { return !TF || TF.indexOf(t) >= 0; };
    var ehNum = function (x) { return /^\d+([.,]\d+)?$/.test(semAcento(x)); };
    var codTipo = function (x) { var u = semAcento(x).replace(/^TIPO\s*/, ''); return /^[A-Z][A-Z0-9\-]{1,7}$/.test(u) && /\d/.test(u) ? u : ''; };
    var qtdDa = function (cel, excluir) {
      var q = NaN;
      if (colQ >= 0 && colQ < cel.length) q = numBR(cel[colQ]);
      if (q > 0) return q;
      var celNums = cel.filter(function (x) { var u = semAcento(x); return u && (!excluir || u.indexOf(excluir) < 0) && ehNum(x); }).map(numBR);
      var inteiros = celNums.filter(function (x) { return Number.isInteger(x) && x > 0 && x < 10000; });
      if (inteiros.length) return inteiros.length > 1 && cel.length > 3 && celNums[0] === inteiros[0] && semAcento(cel[0]) === String(inteiros[0]) ? inteiros[1] : inteiros[0];
      var resto = semAcento(cel.join(' | ')).replace(excluir || '\u0000', ' ');
      var mm = /(?:^|\s|\|)(\d{1,4})(?:\s*(?:VOL|VOLS|UN|PC|PCS|UND)\b)/.exec(resto) || /(?:^|\|)\s*(\d{1,4})\s*(?:\||$)/.exec(resto);
      return mm ? Number(mm[1]) : NaN;
    };
    linhas.forEach(function (row) {
      var cel = row.map(function (x) { return x == null ? '' : x; }), T = semAcento(cel.join(' | '));
      if (!T) return;
      // cabeçalho da tabela de volumes
      var hq = cel.findIndex(function (x) { var u = semAcento(x); return /^(QTD|QTDE|QUANT|QUANTIDADE|QTD\.? ?VOL|VOLUMES?|QTD VOLUMES?)\b/.test(u) && u.length < 25; });
      if (hq >= 0 && cel.some(function (x) { return /DESCRI|VOLUME|PECA|ITEM|MARCA/.test(semAcento(x)); })) {
        colQ = hq;
        colP = cel.findIndex(function (x) { return /^PESO/.test(semAcento(x)); });
        colT = cel.findIndex(function (x) { return /^(TORRE|TIPO|TIPO DE TORRE|ESTRUTURA)$/.test(semAcento(x)); });
        return;
      }
      var cod = reCod && reCod.exec(T), cT = colT >= 0 ? codTipo(cel[colT]) : '';
      var todos = cat.filter(function (v) { return T.indexOf(v.n) >= 0; });
      var cands = todos.filter(function (v) { return deTF(v.tipoId); });
      var tpLinha = cT || (cod ? cod[1] : '');
      var tpConhecido = tpLinha && ctx.tipos.some(function (t) { return t.id === tpLinha; });
      if (tpLinha && !tpConhecido && todos.length) { var pt3 = colP >= 0 ? numBR(cel[colP]) : NaN, q3 = qtdDa(cel, todos[0].n) || 1; if (pt3 > 0) pesoTotal += pt3; novos.push({ nome: todos[0].nome.toUpperCase(), qtd: q3, tipoId: tpLinha, grupo: grupoDoNome(todos[0].nome), pesoKg: pt3 > 0 ? Math.round(pt3 / q3 * 1000) / 1000 : null }); return; }
      if ((!tpLinha && todos.length && !cands.length) || (tpConhecido && TF && !deTF(tpLinha))) {
        fora.push({ nome: (todos[0] || {}).nome || cel.join(' ').trim(), tipos: tpLinha ? [tpLinha] : todos.map(function (v) { return v.tipoId; }).filter(function (x, i, a) { return a.indexOf(x) === i; }), qtd: qtdDa(cel, (todos[0] || {}).n) || 1 });
        return;
      }
      if (!cands.length) {
        var ctxM = /\bTIPO\s*:?\s*([A-Z][A-Z0-9\-]{1,7})\b/.exec(T);
        var textos = cel.filter(function (x) { var u = semAcento(x); return u.length >= 3 && !ehNum(x) && !codTipo(x) && !/^(KG|UN|PC|PCS|VOL|T)$/.test(u); });
        var q = qtdDa(cel);
        if (textos.length && !(q > 0) && colQ < 0 && /TORRE|PERNA|EXTENS|STUB|CALOTA|PINO|\(V\d+\/\d+\)/.test(T) && !/ROMANEIO|NOTA FISCAL|DESTINO|TOTAL/.test(T)) soltos.push(cel.join(' ').trim());
        if (!textos.length || !(q > 0)) { if (ctxM && /\d/.test(ctxM[1])) tipoCtx = ctxM[1]; else if (cod) tipoCtx = cod[1]; return; }
        if (/ROMANEIO|NOTA FISCAL|DESTINO|EMISSAO|TOTAL|PLACA|CLIENTE|OBRA:|MOTORISTA|TRANSPORT/.test(T)) return;
        var pareceVolume = (colQ >= 0) || /TORRE|PERNA|EXTENS|STUB|CALOTA|PINO|CORPO|MONT|PECA|CONJ|VOLUME|\bPE\b|\(V\d+\/\d+\)/.test(T);
        if (!pareceVolume) return;
        var nome = textos.reduce(function (a, b) { return String(b).length > String(a).length ? b : a; });
        var pt = colP >= 0 ? numBR(cel[colP]) : NaN;
        if (pt > 0) pesoTotal += pt;
        novos.push({ nome: String(nome).trim().replace(/\s+/g, ' ').toUpperCase(), qtd: q, tipoId: cT || (cod ? cod[1] : '') || (deTF(tipoCtx) ? tipoCtx : '') || (TF && TF.length === 1 ? TF[0] : ''), grupo: grupoDoNome(nome), pesoKg: pt > 0 ? Math.round(pt / q * 1000) / 1000 : null });
        return;
      }
      var nomeC = cands[0].n, mesmos = cands.filter(function (v) { return v.n === nomeC; });
      var qq = qtdDa(cel, nomeC); if (!(qq > 0)) qq = 1;
      var tp = cT || (cod ? cod[1] : '');
      var esc = tp ? mesmos.find(function (v) { return v.tipoId === tp; }) : ((mesmos.length === 1 ? mesmos[0] : null) || mesmos.find(function (v) { return v.tipoId === tipoCtx; }));
      if (colP >= 0 && numBR(cel[colP]) > 0) pesoTotal += numBR(cel[colP]);
      if (esc) achados.push({ tipoId: esc.tipoId, componenteId: esc.id, qtd: qq, nome: esc.nome });
      else if (tp) { var pt2 = colP >= 0 ? numBR(cel[colP]) : NaN; novos.push({ nome: cands[0].nome.toUpperCase(), qtd: qq, tipoId: tp, grupo: grupoDoNome(cands[0].nome), pesoKg: pt2 > 0 ? Math.round(pt2 / qq * 1000) / 1000 : (cands[0].pesoKg || null) }); }
      else amb.push({ nome: mesmos[0].nome, qtd: qq, opcoes: mesmos.map(function (v) { return { tipoId: v.tipoId, componenteId: v.id }; }) });
    });
    return { itens: achados, ambiguos: amb, naoReconhecidos: soltos, novos: novos, foraFornecedor: fora, pesoTotal: Math.round(pesoTotal * 10) / 10 };
  }
  function juntarItens(itens) { var m = {}, o = []; itens.forEach(function (i) { var k = i.tipoId + '|' + i.componenteId; if (!m[k]) { m[k] = { tipoId: i.tipoId, componenteId: i.componenteId, qtd: 0 }; o.push(m[k]); } m[k].qtd += i.qtd; }); return o; }


  // ---------- DANFE em PDF (nota fiscal impressa) ----------
  function ehDANFE(linhas) { var t = semAcento(linhas.slice(0, 15).map(function (l) { return l.join(' '); }).join(' ')); return /DANFE|DOCUMENTO AUXILIAR DA NOTA FISCAL/.test(t) && /CHAVE DE ACESSO|NF-E/.test(t); }
  function lerDANFE(linhas, ctx, r) {
    var txt = function (l) { return semAcento((l || []).join(' ')); };
    var idx = function (re, ini) { for (var i = ini || 0; i < linhas.length; i++) if (re.test(txt(linhas[i]))) return i; return -1; };
    var i, m, l;
    // número e série
    for (i = 0; i < Math.min(linhas.length, 20); i++) { l = linhas[i].map(semAcento); var k = l.findIndex(function (x) { return /^N[O°º]?\.?$/.test(x) || x === 'NO' || x === 'N°'; }); if (k >= 0 && /^\d[\d.]*$/.test(l[k + 1] || '')) { r.nfs = [String(Number(String(l[k + 1]).replace(/\./g, '')))]; break; } }
    var tudo = linhas.map(txt).join(' \n ');
    if (!r.nfs.length && (m = /\bN[O°º]\.?\s*(\d{3,9})\b/.exec(tudo))) r.nfs = [String(Number(m[1]))];
    m = /SERIE\s+(\d{1,3})\b/.exec(tudo); var serie = m ? m[1] : '';
    var ich = idx(/CHAVE DE ACESSO/), chave = '';
    if (ich >= 0) for (i = ich + 1; i < Math.min(ich + 4, linhas.length); i++) { var d = linhas[i].join('').replace(/\D/g, ''); if (d.length === 44) { chave = d; break; } }
    if (!chave && (m = /((?:\d{4}\s*){11})/.exec(tudo))) { var d2 = m[1].replace(/\D/g, ''); if (d2.length === 44) chave = d2; }
    var ie = idx(/DATA DA EMISSAO/); if (ie >= 0 && linhas[ie + 1]) { var dm = /(\d{2})\/(\d{2})\/(\d{4})/.exec(linhas[ie + 1].join(' ')); if (dm) r.emissao = dm[3] + '-' + dm[2] + '-' + dm[1]; }
    var F = (ctx.fornecedores || []).find(function (f) { var x = semAcento(f); return x.length >= 3 && new RegExp('\\b' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(semAcento((linhas[0] || []).join(' ') + ' ' + (linhas[4] || []).join(' '))); });
    if (!F) { m = /RECEBEMOS DE (.+?) OS PRODUTOS/.exec(txt(linhas[0])); if (m) F = m[1]; }
    r.fornecedor = F ? String(F).toUpperCase() : '';
    var valor = 0, iv = idx(/VALOR TOTAL DA NOTA/); if (iv >= 0 && linhas[iv + 1]) valor = numBR(linhas[iv + 1][linhas[iv + 1].length - 1]) || 0;
    var transp = '', placa = '', it = idx(/RAZAO SOCIAL.*FRETE POR CONTA|FRETE POR CONTA/);
    if (it >= 0 && linhas[it + 1]) { var tl = linhas[it + 1], cut = tl.findIndex(function (x) { return /^\d\s*-/.test(String(x)); }); transp = (cut > 0 ? tl.slice(0, cut) : tl.slice(0, 3)).join(' ').trim(); var pm = /\b([A-Z]{3}-?\d[A-Z0-9]\d{2})\b/.exec(semAcento(tl.join(' '))); if (pm) placa = pm[1]; }
    var vols = 0, esp = '', pb = 0, pl = 0, iq = idx(/QUANTIDADE.*ESPECIE.*PESO BRUTO/);
    if (iq >= 0 && linhas[iq + 1]) { var ql = linhas[iq + 1]; vols = numBR(ql[0]) || 0; esp = /^\d/.test(String(ql[1] || '')) ? '' : String(ql[1] || ''); pb = numBR(ql[ql.length - 2]) || 0; pl = numBR(ql[ql.length - 1]) || 0; if (ql.length < 4) { pb = pl; } }
    var merc = [], ip = idx(/DADOS DO PRODUTO \/ SERVICO$|^DADOS DO PRODUTO/);
    for (i = Math.max(ip, 0); i < linhas.length; i++) { l = linhas[i]; if (l.length >= 9 && /^\d{5,}$/.test(String(l[0])) && /^\d{8}$/.test(String(l[2]))) merc.push({ desc: String(l[1]), qtd: numBR(l[6]), un: String(l[5]), valor: numBR(l[8]) || 0 }); }
    var ic = idx(/INFORMACOES COMPLEMENTARES/), compl = '';
    if (ic >= 0) for (i = ic + 1; i < linhas.length; i++) { var tx = txt(linhas[i]); if (/^DANFE\b|DOCUMENTO AUXILIAR/.test(tx) && i > ic + 3) break; compl += ' ' + linhas[i].join(' '); }
    var C = semAcento(compl);
    m = /(?:REMESSA|ROMANEIO|ROM\.?)\s*(?:N[O°º.]*)?\s*:?\s*0*(\d{3,})/.exec(C); r.romaneio = m ? m[1] : '';
    var cab = camposCabecalho(compl, ctx); r.canteiroId = cab.canteiroId || '';
    r.transporte = [transp, placa].filter(Boolean).join(' · ');
    r.pesoNFKg = pl || pb;
    r.nfDados = [{ numero: r.nfs[0] || '', serie: serie, chave: chave, emissao: r.emissao, fornecedor: r.fornecedor, mercadorias: merc, volumes: vols, especie: esp, pesoBrutoKg: pb, pesoLiquidoKg: pl, valor: valor || merc.reduce(function (a, x) { return a + x.valor; }, 0), placa: placa, transportadora: transp, romaneio: r.romaneio, infCpl: compl.trim().replace(/\s+/g, ' ').slice(0, 400) }];
    r.origem = 'NF (DANFE)';
    if (merc.length) r.produtos = merc.map(function (x) { return x.desc + ' — ' + x.qtd + ' ' + x.un; });
    return r;
  }
  // ---------- romaneio por unidade de despacho (UD): uma linha por volume, descrição quebrada em 2 linhas ----------
  function ehRomaneioUD(linhas) { return linhas.slice(0, 15).some(function (l) { var t = semAcento(l.join(' ')); return /REMESSA/.test(t) && /\bUD\b/.test(t) && /DESCRICAO PA|DESCRICAO SKU/.test(t); }); }
  function lerRomaneioUD(linhas, ctx, r) {
    var tudo = linhas.slice(0, 12).map(function (l) { return l.join(' '); }).join(' \n ');
    var m = /EMPRESA:?\s*(?:\d+\s*-\s*)?([A-Z][A-Z0-9 .&]+?)(?:\s+S\/?A|\s+LTDA|\s*$|\n)/i.exec(tudo);
    var cab = camposCabecalho(tudo, ctx);
    r.fornecedor = cab.fornecedor || (m ? m[1].trim().toUpperCase() : '');
    m = /DT\.?\s*EMISS[AÃ]O:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(tudo); if (m) r.emissao = m[3] + '-' + m[2] + '-' + m[1];
    r.canteiroId = cab.canteiroId || '';
    var dados = [], i;
    for (i = 0; i < linhas.length; i++) {
      var l = linhas[i];
      if (l.length >= 8 && /^\d{1,4}$/.test(String(l[0])) && /^\d{6,}$/.test(String(l[1])) && /^\d{6,}$/.test(String(l[2]))) {
        var antes = linhas[i - 1] || [], depois = linhas[i + 1] || [];
        var desc = ((antes[0] || '') + ' ' + (depois[0] || '')).replace(/\s+/g, ' ').trim(), sku = ((antes[1] || '') + ' ' + (depois[1] || '')).replace(/\s+/g, ' ').trim();
        if (!r.romaneio) r.romaneio = String(Number(l[1]));
        dados.push({ ud: String(l[2]), desc: desc, sku: sku, qtdSku: numBR(l[l.length - 3]), pesoUnit: numBR(l[l.length - 2]), pesoTotal: numBR(l[l.length - 1]) });
      }
    }
    var mt = /PESO TOTAL \(KG\):?\s*([\d.,]+)/i.exec(linhas.map(function (l) { return l.join(' '); }).join(' \n ')); r.pesoRomaneioKg = mt ? numBR(mt[1]) : dados.reduce(function (a, d) { return a + (d.pesoTotal || 0); }, 0);
    r.uds = dados;
    // cada UD é um volume; o tipo de torre vem no fim da descrição ("... - V1EM")
    var sint = [['ITEM', 'TORRE', 'DESCRICAO', 'QTD VOL', 'PESO']].concat(dados.map(function (d, k) {
      var mm = /^(.*?)\s*-\s*([A-Z]\d[A-Z0-9]{1,5})\s*$/.exec(d.desc);
      return [k + 1, mm ? mm[2] : '', mm ? mm[1] : d.desc, 1, d.pesoTotal || ''];
    }));
    return sint;
  }
  function juntarNovos(nv) { var m = {}, o = []; (nv || []).forEach(function (n) { var k = n.tipoId + '|' + n.nome + '|' + n.grupo; if (!m[k]) { m[k] = Object.assign({}, n); o.push(m[k]); } else { var pt = (m[k].pesoKg || 0) * m[k].qtd + (n.pesoKg || 0) * n.qtd; m[k].qtd += n.qtd; m[k].pesoKg = pt ? Math.round(pt / m[k].qtd * 1000) / 1000 : m[k].pesoKg; } }); return o; }
  // fonte: {nome, xml} | {nome, linhas} ; ctx: {tipos, canteiros, fornecedores}
  function lerDocumentoCarga(fonte, ctx) {
    ctx = Object.assign({}, ctx); ctx.cat = ctx.cat || catalogo(ctx.tipos);
    var r = { arquivos: [fonte.nome], fornecedor: '', nfs: [], romaneio: '', emissao: '', canteiroId: '', transporte: '', pesoNFKg: 0, itens: [], ambiguos: [], naoReconhecidos: [], novos: [], foraFornecedor: [], origem: '' };
    var regraForn = function (f) { var F = semAcento(f); ctx.tiposForn = F ? ctx.tipos.filter(function (t) { return semAcento(t.fornecedor) === F; }).map(function (t) { return t.id; }) : null; if (ctx.tiposForn && !ctx.tiposForn.length) ctx.tiposForn = null; };
    if (fonte.xml) {
      var x = fonte.xml; r.origem = 'NF-e';
      if (!/<(?:\w+:)?infNFe/i.test(x)) throw new Error(fonte.nome + ': não parece um XML de NF-e.');
      var emit = tag(x, 'emit'), ide = tag(x, 'ide'), transp = tag(x, 'transp');
      r.fornecedor = desxml(tag(emit, 'xFant') || tag(emit, 'xNome')).toUpperCase();
      var conhecido = (ctx.fornecedores || []).find(function (f) { var F = semAcento(f); return F && semAcento(tag(emit, 'xNome') + ' ' + tag(emit, 'xFant')).indexOf(F) >= 0; });
      if (conhecido) r.fornecedor = String(conhecido).toUpperCase();
      var n = tag(ide, 'nNF'); if (n) r.nfs = [String(Number(n))];
      r.emissao = (tag(ide, 'dhEmi') || tag(ide, 'dEmi')).slice(0, 10);
      var placa = tag(tag(transp, 'veicTransp'), 'placa'), tnome = desxml(tag(tag(transp, 'transporta'), 'xNome'));
      r.transporte = [tnome, placa].filter(Boolean).join(' · ');
      tags(transp, 'vol').forEach(function (v) { var p = numBR(tag(v, 'pesoB') || tag(v, 'pesoL')); if (p > 0) r.pesoNFKg += p; });
      var compl = desxml(tag(x, 'infCpl') + ' ' + tag(x, 'infAdFisco'));
      var cab = camposCabecalho(compl + ' ' + desxml(tag(x, 'entrega')) + ' ' + desxml(tag(x, 'dest')), ctx);
      r.romaneio = cab.romaneio || ''; r.canteiroId = cab.canteiroId || '';
      var linhas = tags(x, 'det').map(function (d) { var pr = tag(d, 'prod'); return [desxml(tag(pr, 'xProd')), numBR(tag(pr, 'qCom')), desxml(tag(pr, 'uCom')), desxml(tag(d, 'infAdProd')), numBR(tag(pr, 'vProd'))]; });
      var idm = /<(?:\w+:)?infNFe[^>]*\bId="(?:NFe)?(\d{44})"/i.exec(x), tot = tag(tag(x, 'total'), 'ICMSTot');
      var vols = tags(transp, 'vol');
      r.nfDados = [{ numero: r.nfs[0] || '', serie: tag(ide, 'serie'), chave: idm ? idm[1] : '', emissao: r.emissao, fornecedor: r.fornecedor, cnpj: tag(emit, 'CNPJ'), natOp: desxml(tag(ide, 'natOp')),
        mercadorias: linhas.map(function (l) { return { desc: l[0], qtd: l[1], un: l[2], valor: l[4] || 0 }; }),
        volumes: vols.reduce(function (a, v) { return a + (numBR(tag(v, 'qVol')) || 0); }, 0), especie: desxml(tag(vols[0] || '', 'esp')),
        pesoBrutoKg: vols.reduce(function (a, v) { return a + (numBR(tag(v, 'pesoB')) || 0); }, 0), pesoLiquidoKg: vols.reduce(function (a, v) { return a + (numBR(tag(v, 'pesoL')) || 0); }, 0),
        valor: numBR(tag(tot, 'vNF')) || linhas.reduce(function (a, l) { return a + (l[4] || 0); }, 0), placa: placa, transportadora: tnome, romaneio: r.romaneio, infCpl: compl.trim().slice(0, 400) }];
      regraForn(r.fornecedor);
      var it = itensDeLinhas([['DESCRICAO', 'QTD']].concat(linhas.map(function (l) { return [l[0] + ' ' + l[3], /^(KG|T|TON)$/i.test(l[2]) ? '' : l[1]]; })), ctx);
      r.itens = it.itens; r.ambiguos = it.ambiguos; r.naoReconhecidos = it.naoReconhecidos; r.novos = it.novos; r.foraFornecedor = it.foraFornecedor;
      if (!r.itens.length && !r.ambiguos.length && !r.novos.length) r.produtos = linhas.map(function (l) { return l[0] + ' — ' + l[1] + ' ' + l[2]; });
    } else if (ehDANFE(fonte.linhas || [])) {
      lerDANFE(fonte.linhas, ctx, r);
    } else {
      r.origem = 'Romaneio';
      var linhasR = fonte.linhas || [], ud = ehRomaneioUD(linhasR), rUD = null;
      if (ud) { linhasR = lerRomaneioUD(linhasR, ctx, r); rUD = { romaneio: r.romaneio, fornecedor: r.fornecedor, emissao: r.emissao, canteiroId: r.canteiroId, peso: r.pesoRomaneioKg }; }
      var cab2 = camposCabecalho(linhasR.slice(0, 40).map(function (l) { return l.join(' '); }).join(' \n '), ctx);
      r.romaneio = cab2.romaneio || ''; if (cab2.nf) r.nfs = [cab2.nf]; r.fornecedor = cab2.fornecedor || ''; r.canteiroId = cab2.canteiroId || ''; r.emissao = cab2.data || ''; r.transporte = cab2.placa || '';
      if (rUD) { r.romaneio = rUD.romaneio || r.romaneio; r.fornecedor = rUD.fornecedor || r.fornecedor; r.emissao = rUD.emissao || r.emissao; r.canteiroId = rUD.canteiroId || r.canteiroId; r.nfs = []; }
      regraForn(r.fornecedor);
      var it2 = itensDeLinhas(linhasR, ctx);
      // sem fornecedor no arquivo: deduz pelo tipo das peças reconhecidas (cada tipo tem um fornecedor)
      if (!r.fornecedor && it2.itens.length) {
        var fs = it2.itens.map(function (i) { var t = ctx.tipos.find(function (x) { return x.id === i.tipoId; }); return t ? semAcento(t.fornecedor) : ''; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
        if (fs.length === 1) { r.fornecedor = fs[0]; regraForn(r.fornecedor); it2 = itensDeLinhas(linhasR, ctx); r.fornecedorDeduzido = true; }
      }
      r.pesoRomaneioKg = (rUD && rUD.peso) || it2.pesoTotal || 0;
      if (rUD && r.uds) (it2.novos || []).forEach(function (n) { if (n.grupo !== 'ESTAI') return; var u = r.uds.find(function (x) { return semAcento(x.desc).indexOf(semAcento(n.nome)) === 0; }); if (u && /CORDOALHA|CABO/.test(semAcento(u.sku)) && u.qtdSku > 0) n.metros = u.qtdSku; });
      r.itens = it2.itens; r.ambiguos = it2.ambiguos; r.naoReconhecidos = it2.naoReconhecidos; r.novos = it2.novos; r.foraFornecedor = it2.foraFornecedor;
    }
    r.itens = juntarItens(r.itens); r.novos = juntarNovos(r.novos);
    if (!r.romaneio) { var mr = /ROM(?:ANEIO)?[\s_\-]*(\d{4,})/i.exec(fonte.nome || ''); if (mr) r.romaneio = mr[1]; }
    if (!r.nfs.length) { var mn = /\bNF[\s_\-]*(\d{2,9})/i.exec(fonte.nome || ''); if (mn) r.nfs = [String(Number(mn[1]))]; }
    return r;
  }
  // Junta NF-e e romaneio da mesma carga (mesmo romaneio ou mesma NF)
  function juntarRascunhos(lista) {
    var out = [];
    lista.forEach(function (d) {
      var nr = function (x) { return String(x || '').replace(/^0+/, '').toUpperCase(); };
      var alvo = out.find(function (o) { return (d.romaneio && o.romaneio && nr(d.romaneio) === nr(o.romaneio)) || d.nfs.some(function (n) { return o.nfs.indexOf(n) >= 0 && (!d.fornecedor || !o.fornecedor || d.fornecedor === o.fornecedor); }); });
      if (!alvo) { out.push(Object.assign({}, d)); return; }
      ['fornecedor', 'romaneio', 'emissao', 'canteiroId', 'transporte'].forEach(function (k) { if (!alvo[k] && d[k]) alvo[k] = d[k]; });
      d.nfs.forEach(function (n) { if (alvo.nfs.indexOf(n) < 0) alvo.nfs.push(n); });
      alvo.pesoNFKg = (alvo.pesoNFKg || 0) + (d.pesoNFKg || 0);
      alvo.nfDados = (alvo.nfDados || []).concat(d.nfDados || []);
      if (!alvo.pesoRomaneioKg && d.pesoRomaneioKg) alvo.pesoRomaneioKg = d.pesoRomaneioKg;
      alvo.arquivos = alvo.arquivos.concat(d.arquivos);
      alvo.origem = alvo.origem === d.origem ? alvo.origem : 'NF-e + romaneio';
      // romaneio tem os volumes detalhados: prevalece sobre os itens da NF
      var nA = alvo.itens.length + alvo.ambiguos.length + (alvo.novos || []).length, nD = d.itens.length + d.ambiguos.length + (d.novos || []).length;
      if (nD > nA || (nD === nA && d.origem === 'Romaneio')) { alvo.itens = d.itens; alvo.ambiguos = d.ambiguos; alvo.naoReconhecidos = d.naoReconhecidos; alvo.novos = d.novos; alvo.foraFornecedor = d.foraFornecedor; if (d.uds) alvo.uds = d.uds; }
    });
    return out;
  }

  // Texto de um PDF agrupado em linhas (cada trecho de texto vira uma célula, da esquerda para a direita)
  async function linhasDePDF(pdfjs, data) {
    var doc = await pdfjs.getDocument({ data: data, isEvalSupported: false }).promise, out = [];
    for (var p = 1; p <= Math.min(doc.numPages, 30); p++) {
      var pg = await doc.getPage(p), tc = await pg.getTextContent(), ls = [];
      tc.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        var y = it.transform[5], x = it.transform[4], l = ls.find(function (q) { return Math.abs(q.y - y) < 3; });
        if (!l) { l = { y: y, it: [] }; ls.push(l); }
        l.it.push({ x: x, s: it.str.trim() });
      });
      ls.sort(function (a, b) { return b.y - a.y; }).forEach(function (l) { out.push(l.it.sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s; })); });
    }
    return out;
  }

  // ---------- metragem de estai por torre (planilha TAP, aba BD) ----------
  function lerTAPEstai(linhas) {
    var hi = -1, cKg = -1, cN = -1, cT = -1, cE = -1;
    for (var i = 0; i < Math.min(linhas.length, 6); i++) { var r = linhas[i] || []; var k = r.findIndex(function (x) { return /^ESTAI\s*\+\s*10%/.test(semAcento(x)); }); if (k >= 0) { hi = i; cKg = k; break; } }
    if (hi < 0) throw new Error('Não encontrei a coluna "Estai + 10%" na aba BD da TAP.');
    // colunas fixas do BD: nº da torre (C), tipo (G), estrutura (P); metros = coluna logo após o peso do estai
    cN = 2; cT = 6; cE = 15;
    var porTorre = {}, kgm = {}, n = 0;
    linhas.slice(hi + 1).forEach(function (r) {
      if (!r || !r[cN] || !r[cT] || semAcento(r[cE]) !== 'ESTAIADA') return;
      var kg = numBR(r[cKg]), m = numBR(r[cKg + 1]); if (!(m > 0)) return;
      var t = semAcento(r[cT]); porTorre[String(r[cN]).trim() + '|' + t] = Math.round(m * 100) / 100; n++;
      if (kg > 0 && !kgm[t]) kgm[t] = Math.round(kg / m / 1.0 * 100) / 100;
    });
    return { porTorre: porTorre, kgm: kgm, torres: n };
  }
  return { lerControleNFEmp: lerControleNFEmp, ehControleNFEmp: ehControleNFEmp, fornNorm: fornNorm, cruzarNFs: cruzarNFs, separarNFs: separarNFs, lerTAPEstai: lerTAPEstai, grupoDoNome: grupoDoNome, linhasDePDF: linhasDePDF, catalogo: catalogo, lerDocumentoCarga: lerDocumentoCarga, juntarRascunhos: juntarRascunhos, md5: md5, linhasAba: linhasAba, lerPlanilhaEstoque: lerPlanilhaEstoque, planejar: planejar, RX_IMP_MOV: RX_IMP_MOV };
})();
if (typeof module !== 'undefined') module.exports = Sync;
