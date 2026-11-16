#!/usr/bin/env python3
"""Barra dados reais de obra antes de irem para o repositório.

Verifica os arquivos versionados (ou só os que estão no commit, com --staged) e falha se encontrar:
  * arquivos que normalmente carregam dados reais: planilhas (.xlsx/.xlsm/.xls/.csv), PDFs, XMLs de NF-e,
    backups do sistema, pacote dados-projeto.json, figuras.css local ou imagens em web/img/
    (exceções: o que está em docs/exemplos/ e docs/img/, que são fictícios);
  * chave de acesso de NF-e (44 dígitos), CNPJ ou CPF formatados;
  * qualquer termo da sua lista privada `.sensiveis.local` (um por linha: nome da obra, da empresa,
    dos canteiros reais, dos fornecedores reais, de pessoas). Esse arquivo fica fora do git.

Uso:
  python3 ferramentas/seguranca/verificar_dados_sensiveis.py            # todos os arquivos versionados
  python3 ferramentas/seguranca/verificar_dados_sensiveis.py --staged   # só o que vai no próximo commit
Como hook:  ln -s ../../ferramentas/seguranca/pre-commit .git/hooks/pre-commit
"""
import re, subprocess, sys, pathlib

RAIZ = pathlib.Path(__file__).resolve().parents[2]
EXT_PROIBIDAS = {'.xlsx', '.xlsm', '.xls', '.csv', '.pdf'}
PERMITIDOS = ('docs/exemplos/', 'docs/img/')
NOMES_PROIBIDOS = [re.compile(p) for p in (r'(^|/)dados-projeto\.json$', r'(^|/)backup-estoque.*\.json$', r'(^|/)web/figuras\.css$', r'(^|/)web/img/', r'(^|/)\.sensiveis\.local$')]
PADROES = {
    'chave de acesso de NF-e': re.compile(r'(?<!\d)(?:\d{4}[ .]?){10}\d{4}(?!\d)'),
    'CNPJ': re.compile(r'\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b'),
    'CPF': re.compile(r'\b\d{3}\.\d{3}\.\d{3}-\d{2}\b'),
}
IGNORAR_CONTEUDO = ('.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.jar')

def arquivos(staged):
    cmd = ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'] if staged else ['git', 'ls-files']
    return [l for l in subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, check=True).stdout.splitlines() if l]

def main():
    staged = '--staged' in sys.argv
    termos = []
    loc = RAIZ / '.sensiveis.local'
    if loc.exists():
        termos = [t.strip() for t in loc.read_text(encoding='utf-8').splitlines() if t.strip() and not t.startswith('#')]
    problemas = []
    for f in arquivos(staged):
        p = RAIZ / f
        if not p.exists():
            continue
        livre = f.startswith(PERMITIDOS)
        if not livre and p.suffix.lower() in EXT_PROIBIDAS:
            problemas.append(f'{f}: tipo de arquivo que costuma ter dados reais ({p.suffix}). Use dados fictícios em docs/exemplos/.')
        if any(r.search(f) for r in NOMES_PROIBIDOS):
            problemas.append(f'{f}: arquivo local com dados do projeto real; não deve ser versionado.')
        if p.suffix.lower() in IGNORAR_CONTEUDO or p.stat().st_size > 5_000_000:
            continue
        try:
            txt = p.read_text(encoding='utf-8')
        except (UnicodeDecodeError, IsADirectoryError):
            continue
        if f.endswith('verificar_dados_sensiveis.py'):
            continue
        if p.suffix.lower() == '.xml' and re.search(r'<(?:\w+:)?(?:infNFe|nfeProc|CTe)\b', txt):
            problemas.append(f'{f}: XML de NF-e/CT-e (documento fiscal real).')
        for nome, rx in PADROES.items():
            m = rx.search(txt)
            if m and not f.startswith('docs/img/'):
                problemas.append(f'{f}: parece conter {nome} ("{m.group(0)[:20]}…").')
        baixo = txt.lower()
        for t in termos:
            if t.lower() in baixo:
                problemas.append(f'{f}: contém o termo privado "{t}" (da sua lista .sensiveis.local).')
    if problemas:
        print('Dados possivelmente sensíveis encontrados:\n  - ' + '\n  - '.join(problemas))
        print('\nRemova-os (ou troque por dados fictícios) antes de versionar.')
        sys.exit(1)
    print('ok: nenhum dado sensível encontrado' + (' (com a lista .sensiveis.local)' if termos else ''))

if __name__ == '__main__':
    main()
