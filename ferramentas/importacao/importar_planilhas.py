"""
Importa as planilhas de controle de estruturas de uma obra de LT e gera o pacote web/dados-projeto.json.

Layout esperado (abas e colunas usadas):
  Planilha de estoque (--estoque, .xlsx)
    RESUMO ESTRUTURAS : catálogo de volumes por tipo (grupo, tipo, descrição, peso) e, por canteiro,
                        blocos de 12 colunas cuja última é o ESTOQUE (usado para conciliar o saldo)
    LANÇAMENTO        : recebimentos  (canteiro, NF, romaneio, data, fornecedor, tipo, volume, qtd)
    TRANSFERENCIA     : transferências (origem, destino, romaneio, data, tipo, volume, qtd)
    APLICAÇÃO         : aplicações em torre (canteiro, torre, romaneio, data, tipo, volume, qtd)
    LC <x>            : lista de construção (nº torre, operação, tipo, altura, extensão, pernas A-D, canteiro)
  Planilha de projeto (--projeto, .xlsx/.xlsm)
    TowerTypes        : tipo -> estrutura (Autoportante/Estaiada), estai, fixação

Uso:
  pip install openpyxl
  python ferramentas/importacao/importar_planilhas.py --estoque estoque.xlsx --projeto projeto.xlsm \
         --obra "Nome da obra" --saida web/dados-projeto.json [--altura-base-estaiada 25.5]

ATENÇÃO: o arquivo gerado contém dados reais da obra. Ele está no .gitignore e não deve ir para repositório público.
"""
import argparse, collections, datetime, hashlib, json, re, unicodedata, warnings

import openpyxl

warnings.filterwarnings('ignore')


def norm(s):
    return re.sub(r'\s+', ' ', str(s or '').strip()).upper()


def slug(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-') or 'canteiro'


def num(x):
    return float(str(x).replace(',', '.')) if x not in (None, '') else 0.0


def fmt(x):
    return ('%g' % num(x)).replace('.', ',')


def h(*p):
    return hashlib.md5('|'.join(str(x) for x in p).encode()).hexdigest()[:12]


def dia(d):
    return d.strftime('%Y-%m-%d') if isinstance(d, (datetime.date, datetime.datetime)) else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--estoque', required=True); ap.add_argument('--projeto', required=True)
    ap.add_argument('--obra', default='Obra'); ap.add_argument('--saida', default='web/dados-projeto.json')
    ap.add_argument('--altura-base-estaiada', type=float, default=25.5, help='altura nominal sem extensão das estaiadas (m)')
    ap.add_argument('--aba-lc', default=None, help='nome da aba da lista de construção (padrão: primeira que começa com "LC")')
    a = ap.parse_args()

    wb = openpyxl.load_workbook(a.estoque, read_only=True, data_only=True)
    linhas = lambda aba, ini: list(wb[aba].iter_rows(values_only=True))[ini:]
    # ---- catálogo (RESUMO ESTRUTURAS): canteiros = blocos de 12 colunas a partir da coluna I
    res = list(wb['RESUMO ESTRUTURAS'].iter_rows(values_only=True))
    blocos = {}  # nome do canteiro -> coluna inicial do bloco (a coluna ESTOQUE é a 12ª do bloco)
    cab = next((r for r in res[:30] if any(norm(x) == 'GERAL' for x in r)), [])
    fim = next((j for j, x in enumerate(cab) if norm(x) == 'GERAL'), len(cab))
    for j in range(8, fim, 12):
        textos = [norm(x) for x in cab[j:j + 12] if x and len(norm(x)) > 3]
        if textos:
            blocos[max(textos, key=len)] = j
    vol = []
    for r in res:
        if not r[3] or r[0] != 'EST':
            continue
        vol.append(dict(tipo=norm(r[3]), grupo=str(r[1]).strip(), nome=str(r[4]).strip(), peso=r[6] or 0, forn=r[7],
                        est={c: (r[j + 11] or 0) for c, j in blocos.items()}))
    vid = lambda tipo, grupo, nome: 'v' + h(tipo, grupo, norm(nome))[:10]
    volkey = {(v['tipo'], norm(v['nome'])): vid(v['tipo'], v['grupo'], v['nome']) for v in vol}

    # ---- tipos
    tw = openpyxl.load_workbook(a.projeto, read_only=True, data_only=True)
    info = {}
    for r in list(tw['TowerTypes'].iter_rows(values_only=True))[1:]:
        if r[0] and r[0] not in info:
            info[norm(r[0])] = dict(estrutura=r[1], estai=r[2], fixacao=r[3])
    tipos = {}
    for v in vol:
        t = tipos.setdefault(v['tipo'], dict(id=v['tipo'], codigo=v['tipo'], volumes=[], fornecedor=v['forn']))
        t['volumes'].append(dict(id=vid(v['tipo'], v['grupo'], v['nome']), nome=v['nome'], grupo=v['grupo'], pesoKg=round(float(v['peso'] or 0), 3)))
    for t in tipos.values():
        inf = info.get(t['id'], {})
        t['estrutura'] = inf.get('estrutura') or ''
        t['fixacao'] = inf.get('fixacao') or ''
        t['nome'] = ' – '.join(x for x in [inf.get('estrutura'), inf.get('estai'), inf.get('fixacao')] if x)
        t['regra'] = dict(modo='estaiada', alturaBase=a.altura_base_estaiada, modulo=6, stubs=4, fixos=['TB', 'PINO', 'CALOTA']) \
            if t['estrutura'] == 'Estaiada' else dict(modo='autoportante', stubs=4, fixos=['TB'])

    # ---- canteiros: os que aparecem na LC e no histórico
    aba_lc = a.aba_lc or next(n for n in wb.sheetnames if n.upper().startswith('LC'))
    lc = [r for r in linhas(aba_lc, 6) if r[16] and r[0]]
    nomes = collections.OrderedDict()
    for r in lc:
        nomes[norm(r[43])] = 1
    for aba, col in (('LANÇAMENTO', 1), ('APLICAÇÃO', 1)):
        for r in linhas(aba, 2):
            if r[col]: nomes[norm(r[col])] = 1
    CANT = {n: dict(id=slug(n), nome=n.title(), sigla=n[:2], local='', trecho='') for n in nomes}

    ignoradas, movs, transfs = [], [], []
    def volume(tipo, nome):
        return volkey.get((norm(tipo), norm(nome)))

    # ---- recebimentos (agrupados por canteiro + NF + romaneio + data + tipo)
    grp = collections.OrderedDict()
    for r in linhas('LANÇAMENTO', 2):
        if not (r[1] and r[7] and r[9] not in (None, '')):
            continue
        vv = volume(r[7], r[8])
        if not vv:
            ignoradas.append(['Recebimento sem volume correspondente no catálogo', norm(r[1]), norm(r[7]), str(r[8] or ''), str(r[9])]); continue
        g = grp.setdefault((norm(r[1]), r[2], r[3], dia(r[4]), norm(r[7])), dict(itens=collections.Counter(), forn=set(), obs=set()))
        g['itens'][vv] += int(r[9])
        if r[5]: g['forn'].add(str(r[5]).strip())
        if r[12]: g['obs'].add(str(r[12]).strip())
    datas = sorted(k[3] for k in grp if k[3])
    for (c, nf, rom, d, tp), g in grp.items():
        consolidado = not d
        obs = ', '.join(sorted(g['forn'])) + (' · Obs./RNC: ' + '; '.join(sorted(g['obs'])) if g['obs'] else '')
        if consolidado:
            obs += ' · lançamento consolidado (sem data na planilha); data assumida = primeiro recebimento'
        movs.append(dict(id='imp_r_' + h(c, nf, rom, d, tp), natureza='ENTRADA', canteiroId=CANT[c]['id'], tipoId=tp, data=d or datas[0],
                         documento='Diversas NFs' if consolidado else 'NF %s · Rom. %s' % (nf, rom), obs=obs,
                         itens=[dict(componenteId=k, qtd=q) for k, q in g['itens'].items()]))

    # ---- transferências (origem fora dos canteiros da obra = entrada)
    grp = collections.OrderedDict()
    for r in linhas('TRANSFERENCIA', 2):
        if not (r[1] and r[5] and r[7] not in (None, '')):
            continue
        vv = volume(r[5], r[6])
        if not vv:
            ignoradas.append(['Transferência sem volume correspondente no catálogo', norm(r[1]) + '>' + norm(r[2]), norm(r[5]), str(r[6] or ''), str(r[7])]); continue
        grp.setdefault((norm(r[1]), norm(r[2]), str(r[3]).strip(), dia(r[4]), norm(r[5])), collections.Counter())[vv] += int(r[7])
    for (o, de, rom, d, tp), itens in grp.items():
        it = [dict(componenteId=k, qtd=q) for k, q in itens.items()]
        if o not in CANT or de not in CANT:
            if de in CANT:
                movs.append(dict(id='imp_r_' + h(o, de, rom, d, tp), natureza='ENTRADA', canteiroId=CANT[de]['id'], tipoId=tp, data=d,
                                 documento='Rom. ' + rom, obs='Recebido de %s (fora do sistema)' % o.title(), itens=it))
            continue
        tid = 'imp_t_' + h(o, de, rom, d, tp); q = d + 'T12:00:00.000Z'
        transfs.append(dict(id=tid, numero='ROM ' + rom + ' · ' + tp, origemId=CANT[o]['id'], destinoId=CANT[de]['id'], tipoId=tp, itens=it,
                            status='RECEBIDA', obs='Importada da planilha', romaneio=rom, criadoEm=q, despachadoEm=q, recebidoEm=q,
                            dataDespacho=d, dataRecebimento=d, itensRecebidos=it, criadoPor='importacao', despachadoPor='importacao', recebidoPor='importacao'))
        movs.append(dict(id='ts_' + tid, natureza='TRANSF_SAIDA', canteiroId=CANT[o]['id'], tipoId=tp, data=d, transferenciaId=tid,
                         documento='Rom. ' + rom, obs='Para ' + CANT[de]['nome'], itens=[dict(componenteId=i['componenteId'], qtd=-i['qtd']) for i in it]))
        movs.append(dict(id='te_' + tid, natureza='TRANSF_ENTRADA', canteiroId=CANT[de]['id'], tipoId=tp, data=d, transferenciaId=tid,
                         documento='Rom. ' + rom, obs='De ' + CANT[o]['nome'], itens=it))

    # ---- aplicações em torre
    grp = collections.OrderedDict()
    for r in linhas('APLICAÇÃO', 2):
        if not (r[1] and r[5] and r[7] not in (None, '')):
            continue
        vv = volume(r[5], r[6])
        if not vv:
            ignoradas.append(['Aplicação sem volume correspondente no catálogo', norm(r[1]), norm(r[5]), str(r[6] or ''), str(r[7])]); continue
        grp.setdefault((norm(r[1]), str(r[2]).strip(), str(r[3]).strip(), dia(r[4]), norm(r[5])), collections.Counter())[vv] += int(r[7])
    for (c, local, rom, d, tp), itens in grp.items():
        movs.append(dict(id='imp_a_' + h(c, local, rom, d, tp), natureza='APLICACAO', canteiroId=CANT[c]['id'], tipoId=tp, data=d,
                         numeroTorre=local, documento='Rom. ' + rom, obs='Aplicação na torre ' + local,
                         itens=[dict(componenteId=k, qtd=-q) for k, q in itens.items()]))

    # ---- conciliação: o saldo final passa a ser a coluna ESTOQUE do resumo
    saldo = collections.Counter()
    for m in movs:
        for i in m['itens']:
            saldo[(m['canteiroId'], m['tipoId'], i['componenteId'])] += i['qtd']
    ajustes = collections.defaultdict(list)
    for v in vol:
        for c in CANT:
            if c not in v['est']:
                continue
            k = (CANT[c]['id'], v['tipo'], vid(v['tipo'], v['grupo'], v['nome']))
            d = int(v['est'][c] or 0) - saldo[k]
            if d:
                ajustes[(CANT[c]['id'], v['tipo'])].append(dict(componenteId=k[2], qtd=d))
    hoje = datetime.date.today().isoformat()
    for (c, tp), it in ajustes.items():
        movs.append(dict(id='imp_aj_' + c + '_' + tp, natureza='AJUSTE', canteiroId=c, tipoId=tp, data=hoje, documento='Conciliação',
                         obs='Ajuste para igualar o saldo à coluna ESTOQUE do resumo (linhas da planilha que não puderam ser importadas)', itens=it))
    movs.sort(key=lambda m: (m['data'] or '', m['id']))
    for i, m in enumerate(movs):
        m['criadoEm'] = (m['data'] or hoje) + 'T12:00:%02d.%03dZ' % ((i // 1000) % 60, i % 1000); m['usuarioId'] = 'importacao'

    torres = [dict(n=str(r[0]).strip(), op=r[1], t=norm(r[16]), h=num(r[17]) if r[17] is not None else None, e=num(r[18]),
                   p=[num(x) for x in r[19:23]], c=CANT[norm(r[43])]['id']) for r in lc]
    nota = ('%d ajuste(s) de conciliação para o saldo bater com o resumo.' % sum(len(x) for x in ajustes.values())) if ajustes else ''
    dados = dict(versao=1, geradoEm=hoje, obra=a.obra, fontes=['planilha de estoque', 'planilha de projeto'],
                 canteiros=[c for c in CANT.values() if any(t['c'] == c['id'] for t in torres) or any(m['canteiroId'] == c['id'] for m in movs)],
                 tipos=sorted(tipos.values(), key=lambda t: t['id']), torres=torres, movimentos=movs, transferencias=transfs,
                 ignoradas=ignoradas, notaConciliacao=nota)
    with open(a.saida, 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, separators=(',', ':'))
    print('tipos', len(tipos), 'torres', len(torres), 'movimentos', len(movs), 'transferências', len(transfs),
          'ignoradas', len(ignoradas), 'ajustes', sum(len(x) for x in ajustes.values()), '->', a.saida)


if __name__ == '__main__':
    main()
