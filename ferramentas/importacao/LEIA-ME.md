# Importação das planilhas da obra

`importar_planilhas.py` lê a planilha de controle de estruturas (catálogo/resumo, recebimentos, transferências,
aplicações e lista de construção) e a planilha de dados do projeto (tipos de torre), e gera `web/dados-projeto.json`.

```bash
pip install openpyxl
python importar_planilhas.py --estoque estoque.xlsx --projeto projeto.xlsm --obra "Nome da obra" --saida ../../web/dados-projeto.json
```

- O layout esperado das abas e colunas está no topo do script.
- O saldo final é conciliado com a coluna de estoque do resumo. As diferenças viram um ajuste de conciliação, e as linhas não importadas aparecem no relatório da tela de importação.
- **O arquivo gerado contém dados reais e não deve ser versionado** (já está no `.gitignore`).
