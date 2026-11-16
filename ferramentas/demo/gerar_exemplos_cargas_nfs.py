"""Gera exemplos FICTÍCIOS para testar, sem dados reais:

  docs/exemplos/controle-nfs-empreiteira-demo.xlsx -> controle de notas da empreiteira (formato "Materiais Controle NF"),
      derivado do controle interno de demonstração, com algumas diferenças de propósito
      (nota faltando de cada lado, peso diferente, RNC, NF não enviada ao contratante)
  docs/exemplos/romaneio-demo.xlsx                 -> romaneio de uma carga a chegar, com volumes do catálogo demo
      e uma peça sem cadastro (para testar o cadastro automático)

Uso:  python3 ferramentas/demo/gerar_exemplos_cargas_nfs.py
"""
import json, pathlib, datetime as dt
import openpyxl

RAIZ = pathlib.Path(__file__).resolve().parents[2]
EX = RAIZ / 'docs' / 'exemplos'
demo = json.loads((RAIZ / 'web' / 'dados-demo.json').read_text())

# ---- controle de notas da empreiteira, a partir do controle interno demo ----
src = openpyxl.load_workbook(EX / 'controle-nfs-demo.xlsx', data_only=True)['Notas']
linhas = [r for r in src.iter_rows(min_row=6, values_only=True) if r[2]]
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Controle NF'
ws.append([]); ws.append([None, 'CONTROLE DE NOTAS – EMPREITEIRA DEMO (dados fictícios)']); ws.append([])
ws.append([None, 'LT', 'FORNECEDOR', 'CARGA', 'PLACA', 'DATA NF', 'DESCRIÇÃO', 'RECEBIDO NA OBRA', 'ENVIADO NF CONTRATANTE', 'CANTEIRO',
           'NOTA', 'CT-E', 'ROMANEIO', 'FATURA', 'LOGÍSTICA', 'RNC', 'VALOR NF', 'PESO LIQUIDO', 'PESO BRUTO'])
for i, r in enumerate(linhas):
    if i == 3:            # uma nota que a empreiteira não lançou
        continue
    nf, forn, ton, emis, entr, can, val, obs = r[2], r[5], r[6] or 0, r[8], r[9], r[14], r[16], r[19] or ''
    rom = obs.replace('ROM.:', '').strip()
    peso = ton * 1000 * (0.8 if i == 5 else 1)          # peso diferente de propósito
    env = None if i in (1, 2) else (entr + dt.timedelta(days=1) if entr else None)
    ws.append([None, 'DEMO', forn, '%dA' % (i + 1), 'ABC%dD%02d' % (i % 10, i), emis, 'ESTRUTURA METÁLICA', entr, env,
               (can or '').title(), '%06d' % nf, None, rom, 'Contratante', 'Transportadora Demo', 'faltou 1 volume' if i == 7 else None,
               val, round(peso, 1), round(peso * 1.02, 1)])
f = linhas[0]
ws.append([None, 'DEMO', f[5], '99A', 'XYZ9Z99', f[8], 'ESTRUTURA METÁLICA', f[9], None, (f[14] or '').title(), '009999', None, '9999',
           'Contratante', 'Transportadora Demo', None, 12345.67, 1500.0, 1530.0])   # nota que falta no controle interno
wb.save(EX / 'controle-nfs-empreiteira-demo.xlsx')

# ---- romaneio de uma carga a chegar ----
tp = next(t for t in demo['tipos'] if t['regra']['modo'] == 'autoportante')
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Romaneio'
ws.append(['FORNECEDOR A – ROMANEIO DE CARGA (dados fictícios)'])
ws.append(['ROMANEIO Nº 7999', '', 'NF 999', 'DATA', '10/03/2026'])
ws.append(['DESTINO: CANTEIRO NORTE']); ws.append([])
ws.append(['ITEM', 'TORRE', 'DESCRIÇÃO DO VOLUME', 'QTD VOL', 'PESO (KG)'])
for i, v in enumerate(tp['volumes'][:6], 1):
    ws.append([i, tp['id'], v['nome'], 2, round(2 * (v.get('pesoKg') or 100), 1)])
ws.append([7, tp['id'], 'PEÇA EXTRA SEM CADASTRO (V1/1)', 1, 80.0])
wb.save(EX / 'romaneio-demo.xlsx')
print('ok:', EX / 'controle-nfs-empreiteira-demo.xlsx', EX / 'romaneio-demo.xlsx')
