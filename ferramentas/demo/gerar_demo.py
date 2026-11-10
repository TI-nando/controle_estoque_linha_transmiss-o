"""
Gera DADOS FICTÍCIOS de demonstração no mesmo formato que o sistema usa:

  web/dados-demo.json                    -> pacote de projeto (tipos, volumes, torres, histórico)
  docs/exemplos/controle-nfs-demo.xlsx   -> planilha de notas fiscais para testar a importação

Nenhum dado aqui vem de obra real: nomes, códigos, pesos, valores e quantidades são inventados.
Uso:  python ferramentas/demo/gerar_demo.py
"""
import json, random, hashlib, datetime, pathlib, collections

RAIZ = pathlib.Path(__file__).resolve().parents[2]
rnd = random.Random(2026)


def h(*p):
    return hashlib.md5('|'.join(map(str, p)).encode()).hexdigest()[:10]


def fmt(x):
    return ('%g' % x).replace('.', ',')


CANTEIROS = [dict(id='norte', nome='Canteiro Norte', sigla='CN', local='Cidade A', trecho='km 0 a km 60'),
             dict(id='sul', nome='Canteiro Sul', sigla='CS', local='Cidade B', trecho='km 60 a km 120')]
FORN = {'AS1': 'FORNECEDOR A', 'AA1': 'FORNECEDOR A', 'ES1': 'FORNECEDOR B'}
PRECO_T = {'FORNECEDOR A': 11800.0, 'FORNECEDOR B': 12600.0}


def volumes_tipo(cod, estaiada):
    v = []
    def add(grupo, nome, peso):
        v.append(dict(id='v' + h(cod, grupo, nome), nome=nome, grupo=grupo, pesoKg=round(peso, 1)))
    n_tb = 6 if estaiada else 8
    for i in range(1, n_tb + 1):
        add('TB', 'CORPO (V%d/%d)' % (i, n_tb), rnd.uniform(400, 2200))
    if estaiada:
        for e in (1.5, 3, 4.5, 6):
            for i in range(1, 3):
                add('EXT' + fmt(e), 'MASTRO EXT %sm (V%d/2)' % (fmt(e), i), rnd.uniform(80, 260) * e / 3)
        add('PINO', 'PINO DE ARTICULAÇÃO (V1/1)', 180)
        add('CALOTA', 'CALOTA (V1/1)', 95)
    else:
        for e in (0, 3, 6, 9):
            for i in range(1, 3):
                add('EXT' + fmt(e), 'EXTENSÃO %sm (V%d/2)' % (fmt(e), i), rnd.uniform(150, 700) * (1 + e / 6))
        for p in (1.5, 3, 4.5, 6, 7.5, 9):
            add('PERNA' + fmt(p), 'PÉ %s (V1/1)' % fmt(p), 60 + p * 35)
    add('AP/STB', 'STUB COMPLETO', 140 if estaiada else 230)
    return v


TIPOS = []
for cod, est, fix in (('AS1', 'Autoportante', 'Suspensão'), ('AA1', 'Autoportante', 'Ancoragem'), ('ES1', 'Estaiada', 'Suspensão')):
    regra = dict(modo='estaiada', alturaBase=24.0, modulo=6, stubs=4, fixos=['TB', 'PINO', 'CALOTA']) if est == 'Estaiada' \
        else dict(modo='autoportante', stubs=4, fixos=['TB'])
    TIPOS.append(dict(id=cod, codigo=cod, nome=est + ' – ' + fix, estrutura=est, fixacao=fix, fornecedor=FORN[cod],
                      regra=regra, volumes=volumes_tipo(cod, est == 'Estaiada')))
TP = {t['id']: t for t in TIPOS}
G = {t['id']: collections.defaultdict(list) for t in TIPOS}
for t in TIPOS:
    for v in t['volumes']:
        G[t['id']][v['grupo']].append(v)


def kit(tw):
    t = TP[tw['t']]; r = t['regra']; k = collections.Counter()
    def add(g, q=1):
        for v in G[t['id']].get(g, []):
            k[v['id']] += q
    for g in r['fixos']:
        add(g)
    if r['modo'] == 'estaiada':
        e = round(tw['h'] - r['alturaBase'], 1); n = int(e // 6); resto = round(e - 6 * n, 1)
        if n: add('EXT6', n)
        if resto: add('EXT' + fmt(resto))
    else:
        add('EXT' + fmt(tw['e']))
        for p in tw['p']:
            add('PERNA' + fmt(p))
    add('AP/STB', r['stubs'])
    return k


# ---- lista de construção (80 torres fictícias)
torres = []
for i in range(1, 81):
    tipo = rnd.choices(['AS1', 'AA1', 'ES1'], [5, 2, 4])[0]
    num = '%d/%d' % ((i + 1) // 2, 1 + (i + 1) % 2)
    if tipo == 'ES1':
        hh = 24 + rnd.choice([0, 1.5, 3, 6, 7.5, 9, 12, 13.5]); tw = dict(n=num, op=i, t=tipo, h=hh, e=0.0, p=[0.0] * 4)
    else:
        e = rnd.choice([0, 3, 6, 9]); base = rnd.choice([1.5, 3, 4.5, 6]); pernas = [min(9, max(1.5, base + rnd.choice([0, 0, 1.5, -1.5]))) for _ in range(4)]
        tw = dict(n=num, op=i, t=tipo, h=24 + e + max(pernas), e=float(e), p=[float(x) for x in pernas])
    tw['c'] = 'norte' if i <= 44 else 'sul'
    torres.append(tw)

# ---- recebimentos: o fornecedor entrega os kits por carga, às vezes no canteiro "errado" e com volumes faltando
movs, nfs = [], []
dia0 = datetime.date(2026, 3, 2)
nf_seq = {'FORNECEDOR A': 100, 'FORNECEDOR B': 500}
rom_seq = 7000
pendente = collections.defaultdict(collections.Counter)  # (fornecedor, canteiro, tipo) -> volumes
for tw in torres[:68]:
    k = kit(tw); c = tw['c'] if rnd.random() > 0.18 else ('sul' if tw['c'] == 'norte' else 'norte')
    for vid, q in k.items():
        if rnd.random() < 0.06:
            q = max(0, q - 1)  # volume ainda não entregue
        if q:
            pendente[(FORN[tw['t']], c, tw['t'])][vid] += q
peso = {(t['id'], v['id']): v['pesoKg'] for t in TIPOS for v in t['volumes']}
cargas = []
for (f, c, tp), cnt in pendente.items():
    itens = list(cnt.items()); rnd.shuffle(itens)
    atual, ton = collections.Counter(), 0.0
    for vid, q in itens:
        for _ in range(q):
            atual[vid] += 1; ton += peso[(tp, vid)] / 1000
            if ton > rnd.uniform(24, 34):
                cargas.append((f, c, tp, atual)); atual, ton = collections.Counter(), 0.0
    if atual:
        cargas.append((f, c, tp, atual))
rnd.shuffle(cargas)
item = 0
for i, (f, c, tp, cnt) in enumerate(cargas):
    data = dia0 + datetime.timedelta(days=int(i * 2.3) + rnd.randint(0, 1))
    nf_seq[f] += 1; rom_seq += 1
    nf, rom = str(nf_seq[f]), str(rom_seq)
    ton = sum(peso[(tp, v)] * q for v, q in cnt.items()) / 1000
    lancar = rnd.random() > 0.08      # 8% das notas ficam sem lançamento no estoque
    registrar_nf = rnd.random() > 0.05  # 5% dos lançamentos sem nota no controle
    if lancar:
        movs.append(dict(id='demo_r_' + h(nf, f), natureza='ENTRADA', canteiroId=c, tipoId=tp, data=data.isoformat(),
                         documento='NF %s · Rom. %s' % (nf, rom), obs=f, fornecedor=f, nfs=[nf], romaneio=rom,
                         itens=[dict(componenteId=v, qtd=q) for v, q in cnt.items()]))
    if registrar_nf:
        item += 1
        ton_nf = ton * (rnd.uniform(0.8, 0.9) if rnd.random() < 0.07 else rnd.uniform(0.985, 1.015))
        nfs.append(dict(item=item, nf=nf, nff=str(880000 + item * 7), f=f, q=round(ton_nf, 4), de=(data - datetime.timedelta(days=3)).isoformat(),
                        dt=data.isoformat(), can=next(x['nome'] for x in CANTEIROS if x['id'] == c).upper(), v=round(ton_nf * PRECO_T[f], 2), rom=rom, car=1))

# ---- aplicações: stubs em algumas torres e 3 torres montadas, a partir do que existe no canteiro
saldo = collections.Counter()
for m in movs:
    for it in m['itens']:
        saldo[(m['canteiroId'], m['tipoId'], it['componenteId'])] += it['qtd']
stub = {t['id']: G[t['id']]['AP/STB'][0]['id'] for t in TIPOS}
dataA = dia0 + datetime.timedelta(days=60)
montadas = 0
for tw in torres[:30]:
    k = kit(tw); s = (tw['c'], tw['t'])
    completa = montadas < 3 and all(saldo[s + (v,)] >= q for v, q in k.items())
    uso = k if completa else {stub[tw['t']]: 4}
    if not all(saldo[s + (v,)] >= q for v, q in uso.items()):
        continue
    for v, q in uso.items():
        saldo[s + (v,)] -= q
    montadas += completa
    movs.append(dict(id='demo_a_' + h(tw['n']), natureza='APLICACAO', canteiroId=tw['c'], tipoId=tw['t'], data=dataA.isoformat(),
                     numeroTorre=tw['n'], documento='Rom. saída %d' % (900 + tw['op']), obs='Aplicação na torre ' + tw['n'],
                     itens=[dict(componenteId=v, qtd=-q) for v, q in uso.items()]))

movs.sort(key=lambda m: (m['data'], m['id']))
for i, m in enumerate(movs):
    m['criadoEm'] = m['data'] + 'T12:00:%02d.%03dZ' % ((i // 1000) % 60, i % 1000); m['usuarioId'] = 'importacao'

dados = dict(versao=1, geradoEm=datetime.date.today().isoformat(), obra='LT Demo 500 kV · Trecho 1 (dados fictícios)',
             fontes=['ferramentas/demo/gerar_demo.py'], canteiros=CANTEIROS, tipos=TIPOS, torres=torres,
             movimentos=movs, transferencias=[], ignoradas=[],
             notaConciliacao='Dados de demonstração gerados por script: obra, fornecedores, volumes, pesos e valores são fictícios.')
saida = RAIZ / 'web' / 'dados-demo.json'
saida.write_text(json.dumps(dados, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('ok', saida, 'torres', len(torres), 'movimentos', len(movs), 'nfs', len(nfs), 'montadas', montadas)

# ---- planilha de NFs fictícia (mesmo layout que o leitor espera)
try:
    import openpyxl
except ImportError:
    print('openpyxl não instalado: planilha de NFs de exemplo não gerada'); raise SystemExit
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Notas'
ws['B2'] = 'CONTROLE DE NOTAS FISCAIS – OBRA DEMO (dados fictícios)'; ws['S3'] = 'Obra Semana 10'
cab = ['ITEM', 'NF (CONTROLE)', 'NF (FORNECEDOR)', 'Tipo de Nota', 'FORNECEDOR', 'QUANT.', 'UNID.', 'DATA DE EMISSÃO', 'DATA DE ENTREGA',
       'NF enviado para lançamento', 'DESCRIÇÃO DO MATERIAL', 'TIPO / APLICAÇÃO', 'RECEBIDO POR', 'CANTEIRO DE REFERÊNCIA', 'NÃO CONFORMIDADE',
       'VALOR NF (R$)', 'VALOR CONTÁBIL (R$)', 'CENTRO DE CUSTO', 'OBSERVAÇÕES', '', 'Qtd Carretas']
for j, c in enumerate(cab):
    ws.cell(row=5, column=2 + j, value=c or None)
for i, n in enumerate(nfs):
    r = 6 + i
    vals = [n['item'], int(n['nf']), int(n['nff']), 'Venda', n['f'], n['q'], 'ton', datetime.date.fromisoformat(n['de']), datetime.date.fromisoformat(n['dt']),
            None, 'EST. METÁLICAS E ELEM. FIXAÇÃO', 'MONT. ELETROMECÂNICA', 'Almoxarifado', n['can'], None, n['v'], None, None, 'ROM.: ' + n['rom'], None, n['car']]
    for j, v in enumerate(vals):
        ws.cell(row=r, column=2 + j, value=v)
rs = wb.create_sheet('Resumo')
rs['B2'] = 'OBRA DEMO – RESUMO DE FORNECIMENTO'
for j, c in enumerate(['Logo', 'Fornecedor', 'Material', 'Qtd Carretas Recebidas', 'Previsto (ton)', 'Recebido (ton)', '% Recebido']):
    rs.cell(row=4, column=2 + j, value=c)
for i, f in enumerate(sorted(PRECO_T)):
    rec = sum(n['q'] for n in nfs if n['f'] == f)
    prev = sum(sum(peso[(tw['t'], v)] * q for v, q in kit(tw).items()) for tw in torres if FORN[tw['t']] == f) / 1000
    for j, v in enumerate([None, f, 'Estruturas Metálicas', sum(1 for n in nfs if n['f'] == f), round(prev, 3), round(rec, 3), rec / prev]):
        rs.cell(row=5 + i, column=2 + j, value=v)
dest = RAIZ / 'docs' / 'exemplos' / 'controle-nfs-demo.xlsx'
dest.parent.mkdir(parents=True, exist_ok=True); wb.save(dest)
print('ok', dest)
