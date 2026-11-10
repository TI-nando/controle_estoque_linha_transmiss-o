# Estoque de Torres — API (Java / Spring Boot)

> Parte do projeto [Estoque de Torres](../README.md). Esta API implementa o modelo da **versão 1** (composição fixa por tipo de torre); o kit por torre e a conferência de NFs estão na interface web e são o próximo passo aqui.

Controle de estoque de **torres de linha de transmissão** distribuídas em vários canteiros de obra,
com cálculo de **torres completas** e **remanejamento automático** de peças entre canteiros
(ex.: um pé parado no canteiro X completa uma torre no canteiro Y).

Java 21 · Spring Boot 3.5 · Spring Data JPA · Flyway · H2 / PostgreSQL · OpenAPI (Swagger) · JUnit 5

---

## O problema

Cada tipo de torre é formado por componentes em quantidades fixas — por exemplo
4 pés, 4 extensões, 1 corpo, 1 cabeça. As peças chegam do fabricante em canteiros diferentes, e é
comum um canteiro ter quase tudo para uma torre enquanto a peça que falta está parada em outro.

O sistema responde três perguntas:

1. **O que eu tenho de verdade em cada canteiro?** (físico, reservado, disponível, a caminho)
2. **Quantas torres completas cada canteiro consegue montar e o que falta para a próxima?**
3. **Quais peças devo mover, e de onde para onde, para completar o máximo de torres?**

## Decisões de arquitetura

| Decisão | Por quê |
|---|---|
| **Razão append-only** (`movimento` + `movimento_item`) — o saldo é sempre `SUM(quantidade)` | O saldo nunca diverge do histórico. Nada é apagado: correções são feitas por **estorno**, o que garante auditoria completa. |
| **Trava pessimista no canteiro** (`SELECT … FOR UPDATE`) em toda operação que retira peças | Duas pessoas não conseguem consumir o mesmo saldo ao mesmo tempo (saída, montagem, transferência, estorno). |
| **Bloqueio otimista** (`@Version`) na transferência | Dois usuários despachando/recebendo a mesma transferência → o segundo recebe HTTP 409. |
| **Restrições no banco** como última barreira | `unique(estorno_de_id)` impede estorno duplo; `unique(transferencia_id, natureza)` impede envio/recebimento duplicado. |
| **Reserva** em transferências `SOLICITADA` | A peça prometida a outro canteiro não pode ser usada numa montagem enquanto isso. |
| **Regra de negócio em classes puras** (`dominio/calculo`) | `CalculadoraTorres` e `PlanejadorRemanejamento` não dependem de Spring/JPA e são testadas isoladamente, inclusive com testes de invariantes em cenários aleatórios. |
| **Máquina de estados** em `StatusTransferencia` | `SOLICITADA → EM_TRANSITO → RECEBIDA`, ou `SOLICITADA → CANCELADA`. Transições inválidas são recusadas. |
| Erros no padrão **RFC 7807** (`ProblemDetail`) com a lista `erros` | O front-end mostra exatamente o que está errado (ex.: "Pé: precisa de 4, disponível 3 em Canteiro Y"). |

### Algoritmo de remanejamento

Guloso, em `PlanejadorRemanejamento`:

1. Para cada canteiro calcula as torres completas atuais (o "compromisso").
2. O **excedente** de um canteiro é o que sobra depois de garantir as torres que ele já monta —
   **um doador nunca perde uma torre completa**.
3. A cada passo escolhe o canteiro cuja próxima torre (a) está abaixo da meta, (b) precisa de menos
   peças de fora, (c) envolve menos transferências — e só aceita se o excedente dos outros cobrir tudo.
4. Repete até não ser possível completar mais nenhuma torre e consolida as movimentações em
   transferências origem → destino.

Também calcula o **máximo teórico** (se todo o estoque estivesse num só canteiro) para mostrar
quanto do potencial o remanejamento alcança.

## Modelo

```
canteiro ──< canteiro_meta >── tipo_torre ──< componente
    │                              │
    └──< movimento >───────────────┘        movimento ──< movimento_item >── componente
              │  (natureza: ENTRADA, SAIDA, AJUSTE, TRANSF_SAIDA, TRANSF_ENTRADA, MONTAGEM, ESTORNO)
              └── transferencia ──< transferencia_item >── componente
```

## Como rodar

```bash
# H2 em arquivo (padrão, zero configuração)
mvn spring-boot:run

# PostgreSQL
docker compose up -d
mvn spring-boot:run -Dspring-boot.run.profiles=postgres
```

- Swagger: http://localhost:8080/swagger-ui.html
- Console H2: http://localhost:8080/h2 (JDBC URL `jdbc:h2:file:./data/estoque-torres`)

Testes:

```bash
mvn test
```

## Endpoints principais

| Método | Rota | O que faz |
|---|---|---|
| `GET/POST/PUT/DELETE` | `/api/canteiros` | Canteiros e metas de torres por tipo |
| `GET/POST/PUT/DELETE` | `/api/tipos-torre` | Tipos de torre e composição |
| `GET` | `/api/painel` | Indicadores gerais |
| `GET` | `/api/estoque?canteiroId=&tipoTorreId=` | Físico, reservado, disponível, a caminho |
| `GET` | `/api/estoque/torres-completas?tipoTorreId=` | Torres completas e falta para a próxima |
| `GET` | `/api/remanejamento?tipoTorreId=&destinoId=&respeitarMeta=` | Sugestão de transferências |
| `POST` | `/api/remanejamento/solicitacoes` | Gera as solicitações da sugestão |
| `POST` | `/api/movimentos/entradas` · `/saidas` · `/montagens` · `/inventarios` | Lançamentos |
| `POST` | `/api/movimentos/{id}/estorno` | Estorno |
| `GET` | `/api/movimentos` | Histórico paginado com filtros |
| `POST` | `/api/transferencias` | Solicita (reserva na origem) |
| `POST` | `/api/transferencias/{id}/despacho` · `/recebimento` · `/cancelamento` | Fluxo da transferência |

O usuário responsável vai no cabeçalho `X-Usuario` (substituir por Spring Security/JWT na próxima versão).

### Exemplo: o pé do canteiro X completa a torre do canteiro Y

```bash
curl "localhost:8080/api/remanejamento?tipoTorreId=1"
```
```json
[{
  "tipoTorreCodigo": "SL", "torresAntes": 1, "torresDepois": 2, "maximoTeorico": 2,
  "transferencias": [{
    "origemNome": "Canteiro X", "destinoNome": "Canteiro Y",
    "itens": [{ "componenteNome": "Pé", "quantidade": 1 }], "pesoKg": 350.000
  }],
  "ganhos": [{ "canteiroNome": "Canteiro Y", "antes": 0, "depois": 1 }]
}]
```

## Próximos passos

- Spring Security com perfis (almoxarife, planejamento, gestor)
- Integrar o front-end a esta API
- Rastreio por lote/marca do fabricante e localização no pátio
- Distância entre canteiros no critério do remanejamento (custo de frete)
- Testcontainers com PostgreSQL nos testes de integração
