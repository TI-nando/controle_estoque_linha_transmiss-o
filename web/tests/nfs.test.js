// Leitura da planilha de NFs e conferência NF × estoque (usa a planilha fictícia de docs/exemplos).
const assert = require('assert');
const path = require('path');
const XLSX = require('xlsx');
const C = require('../core.js'), D = require('../dados-demo.json');
const wb = XLSX.readFile(path.join(__dirname, '../../docs/exemplos/controle-nfs-demo.xlsx'));
const nfs = C.lerPlanilhaNFs(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }));
const res = C.lerResumoNFs(XLSX.utils.sheet_to_json(wb.Sheets.Resumo, { header: 1, raw: true, defval: null }));
assert.ok(nfs.length > 10 && nfs.every(n => n.nf && n.f && n.q > 0 && /^\d{4}-\d{2}-\d{2}$/.test(n.dt)));
assert.ok(res.length >= 2 && res.every(x => x.previsto > 0 && x.unid === 'ton'));
const peso = {}; D.tipos.forEach(t => t.volumes.forEach(v => peso[t.id + '|' + v.id] = v.pesoKg || 0));
const pesoMov = m => m.itens.reduce((a, i) => a + (peso[m.tipoId + '|' + i.componenteId] || 0) * i.qtd, 0) / 1000;
const c = C.conferirNFs(nfs, D.movimentos, pesoMov);
// cada recebimento cai em exatamente um grupo
const vistos = {}; c.grupos.forEach(g => g.recs.forEach(m => { assert.ok(!vistos[m.id]); vistos[m.id] = 1; }));
assert.strictEqual(Object.keys(vistos).length, D.movimentos.filter(m => m.natureza === 'ENTRADA').length);
assert.ok(c.resumo.confere.n > 0);
// cargas com várias NFs ("NF 1, 2 e 3 · Rom. X") formam um grupo só
assert.deepStrictEqual(C.nfsDoMov({ documento: 'NF 142, 143, 144 e 145 · Rom. 7431' }).nfs, ['142', '143', '144', '145']);
console.log('nfs OK · ' + Object.entries(c.resumo).map(([k, v]) => k + ' ' + v.n).join(' · '));
