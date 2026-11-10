// Testes das regras de negócio com os dados de demonstração.  Rodar:  npm test  (na pasta web/)
const assert = require('assert');
const C = require('../core.js');
const D = require('../dados-demo.json');
const { tipos, torres, canteiros } = D;
const s = C.calcularSaldos(D.movimentos), r = C.calcularReservas([]), ap = C.aplicadoPorTorre(D.movimentos);

// 1) toda torre da lista de construção monta um kit com grupos existentes no catálogo
for (const tw of torres) {
  const tp = tipos.find(t => t.id === tw.t);
  assert.deepStrictEqual(C.kitDaTorre(tp, tw).gruposAusentes, [], 'grupo ausente na torre ' + tw.n);
}
// 2) estaiada: (altura − base) vira módulos de 6 m + um módulo menor
const es = { id: 'X', regra: { modo: 'estaiada', alturaBase: 24, modulo: 6, stubs: 4, fixos: ['TB'] }, volumes: [] };
assert.deepStrictEqual(C.gruposDaTorre(es, { h: 37.5 }).map(g => g.grupo + 'x' + g.qtd), ['TBx1', 'EXT6x2', 'EXT1,5x1', 'AP/STBx4']);
// 3) autoportante: uma perna por pé, cada uma na sua altura
const au = { id: 'Y', regra: { modo: 'autoportante', stubs: 4, fixos: ['TB'] }, volumes: [{ id: 'e', grupo: 'EXT6' }] };
assert.deepStrictEqual(C.gruposDaTorre(au, { e: 6, p: [3, 3, 4.5, 6] }).map(g => g.grupo + 'x' + g.qtd), ['TBx1', 'EXT6x1', 'PERNA3x2', 'PERNA4,5x1', 'PERNA6x1', 'AP/STBx4']);

// 4) remanejamento: nunca piora, nenhum doador perde torre pronta e o ganho anunciado se confirma
let antes = 0, depois = 0;
for (const tp of tipos) {
  const tt = torres.filter(t => t.t === tp.id);
  const base = C.alocarTipo(tp, tt, canteiros, s, r, ap);
  const sug = C.sugerirRemanejamento(tp, tt, canteiros, s, r, ap, {});
  assert.ok(sug.depois >= sug.antes);
  const movs = D.movimentos.slice();
  sug.transferencias.forEach(x => {
    movs.push({ canteiroId: x.origemId, tipoId: tp.id, itens: x.itens.map(i => ({ ...i, qtd: -i.qtd })) });
    movs.push({ canteiroId: x.destinoId, tipoId: tp.id, itens: x.itens });
  });
  const s2 = C.calcularSaldos(movs), apos = C.alocarTipo(tp, tt, canteiros, s2, r, ap);
  let soma = 0;
  for (const c of canteiros) {
    assert.ok(apos.resumo[c.id].prontas >= base.resumo[c.id].prontas, 'doador perdeu torre pronta');
    tp.volumes.forEach(v => assert.ok(C.disponivel(s2, r, c.id, tp.id, v.id) >= Math.min(0, C.disponivel(s, r, c.id, tp.id, v.id)), 'saldo negativo'));
    soma += apos.resumo[c.id].prontas;
  }
  assert.strictEqual(soma, sug.depois, 'ganho anunciado não se confirma');
  antes += sug.antes; depois += sug.depois;
}
// 5) transferência solicitada conta no destino (não sugere a mesma peça duas vezes)
const t0 = tipos.find(tp => C.sugerirRemanejamento(tp, torres.filter(t => t.t === tp.id), canteiros, s, r, ap, {}).transferencias.length);
if (t0) {
  const tt = torres.filter(t => t.t === t0.id), sug = C.sugerirRemanejamento(t0, tt, canteiros, s, r, ap, {});
  const trs = sug.transferencias.map(x => ({ ...x, status: 'SOLICITADA' }));
  const sug2 = C.sugerirRemanejamento(t0, tt, canteiros, s, C.calcularReservas(trs), ap, { entrando: C.calcularEntrando(trs) });
  assert.strictEqual(sug2.antes, sug.depois);
}
// 6) máquina de estados da transferência
assert.ok(C.podeTransitar('SOLICITADA', 'EM_TRANSITO') && !C.podeTransitar('EM_TRANSITO', 'CANCELADA'));
console.log('core OK · torres prontas ' + antes + ' → ' + depois + ' com remanejamento');
