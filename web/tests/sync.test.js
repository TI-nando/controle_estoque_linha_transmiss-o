// Testes da leitura de planilhas/documentos e do cruzamento de NFs, só com dados fictícios.  Rodar: npm test
const assert = require('assert');
const Sync = require('../sync.js');
const D = require('../dados-demo.json');
const forn = ['FORNECEDOR A', 'FORNECEDOR B'];
const ctx = { tipos: D.tipos, canteiros: D.canteiros, fornecedores: forn };

// 1) várias NFs na mesma célula
assert.deepStrictEqual(Sync.separarNFs('19, 20 e 21'), ['19', '20', '21']);
assert.deepStrictEqual(Sync.separarNFs('000052 E 53'), ['52', '53']);
assert.deepStrictEqual(Sync.separarNFs('DIVERSAS'), []);
// 2) fornecedor escrito de jeitos diferentes vira o mesmo
assert.strictEqual(Sync.fornNorm('X.Y.Z.'), 'XYZ');
assert.strictEqual(Sync.fornNorm(' x y z '), 'XYZ');
// 3) grupo do volume pelo nome
assert.strictEqual(Sync.grupoDoNome('TORRE EXT 7,5M (V1/9)'), 'EXT7,5');
assert.strictEqual(Sync.grupoDoNome('PE 3,0 (V1/2)'), 'PERNA3');
assert.strictEqual(Sync.grupoDoNome('STUB COMPLETO'), 'AP/STB');
assert.strictEqual(Sync.grupoDoNome('CABO CORDOALHA P/ ESTAI'), 'ESTAI');

// 4) romaneio em planilha: reconhece volumes do catálogo pelo nome e a quantidade pela coluna QTD
const tp = D.tipos[0], v1 = tp.volumes[0], v2 = tp.volumes[1];
const linhas = [['ROMANEIO Nº 900001', '', 'NF 123'], [], ['ITEM', 'TORRE', 'DESCRIÇÃO', 'QTD VOL', 'PESO (KG)'],
  [1, tp.id, v1.nome, 3, 30], [2, tp.id, v2.nome, 2, 20], [3, tp.id, 'PECA NOVA SEM CADASTRO (V1/1)', 4, 40]];
const r = Sync.lerDocumentoCarga({ nome: 'rom.xlsx', linhas }, ctx);
assert.strictEqual(r.romaneio, '900001');
assert.deepStrictEqual(r.nfs, ['123']);
const q = Object.fromEntries(r.itens.map(i => [i.componenteId, i.qtd]));
assert.strictEqual(q[v1.id], 3); assert.strictEqual(q[v2.id], 2);
assert.strictEqual(r.novos.length, 1); assert.strictEqual(r.novos[0].qtd, 4); assert.strictEqual(r.novos[0].pesoKg, 10);

// 5) controle de NFs da empreiteira (cabeçalho por nome de coluna) × controle interno
const ctrl = Sync.lerControleNFEmp([
  ['LT', 'FORNECEDOR', 'CARGA', 'PLACA', 'DATA NF', 'DESCRIÇÃO', 'RECEBIDO NA OBRA', 'ENVIADO NF', 'CANTEIRO', 'NOTA', 'CT-E', 'ROMANEIO', 'FATURA', 'LOGÍSTICA', 'RNC', 'VALOR NF', 'PESO LIQUIDO', 'PESO BRUTO'],
  ['X', 'Fornecedor A', '1A', '', null, 'ESTRUTURA', { __d: '2026-01-10' }, { __d: '2026-01-11' }, 'Canteiro Norte', '000010', '', 'R-10', '', '', '', 1000, 2000, 2100],
  ['X', 'Fornecedor A', '1B', '', null, 'ESTRUTURA', { __d: '2026-01-10' }, null, 'Canteiro Norte', '000011', '', 'R-11', '', '', 'faltou 1 volume', 500, 1000, 1050],
  ['X', 'Fornecedor B', '2A', '', null, 'ESTRUTURA', { __d: '2026-01-12' }, null, 'Canteiro Sul', '000099', '', 'R-99', '', '', '', 100, 300, 310]]);
assert.strictEqual(ctrl.length, 3); assert.strictEqual(ctrl[0].f, 'FORNECEDOR A'); assert.deepStrictEqual(ctrl[0].nfs, ['10']); assert.strictEqual(ctrl[0].kg, 2000);
const interno = [
  { f: 'FORNECEDOR A', nf: '10', nff: '5010', q: 2.0, v: 1000, dt: '2026-01-10', de: '2026-01-08', can: 'CANTEIRO NORTE - UF', rom: ['R-10'] },
  { f: 'FORNECEDOR A', nf: '11', nff: '5011', q: 1.6, v: 500, dt: '2026-01-10', de: '2026-01-08', can: 'CANTEIRO NORTE - UF', rom: ['R-11'] },
  { f: 'FORNECEDOR A', nf: '12', nff: '5012', q: 3.0, v: 900, dt: '2025-12-01', de: '2025-11-30', can: 'CANTEIRO NORTE - UF', rom: ['R-12'] }];
const g = Sync.cruzarNFs(ctrl, interno, { hoje: '2026-01-20' });
const st = n => g.find(x => x.int.some(i => i.nf === n) || x.emp.some(e => e.nfs.includes(n))).status;
assert.strictEqual(st('10'), 'confere');
assert.strictEqual(st('11'), 'peso');        // 1,0 t na empreiteira × 1,6 t no interno
assert.strictEqual(st('12'), 'so_int');      // falta na planilha da empreiteira
assert.strictEqual(st('99'), 'so_emp');      // falta no controle interno
assert.ok(g.find(x => x.emp.some(e => e.nfs.includes('11'))).flags.some(f => f.k === 'rnc'));
console.log('sync OK ·', g.length, 'grupos no cruzamento');
