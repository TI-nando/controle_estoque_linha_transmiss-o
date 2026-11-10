package dev.fernandohenrique.estoquetorres.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Fluxo completo pela API: cadastro → entradas → análise → remanejamento →
 * despacho → recebimento → montagem → estorno → inventário.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FluxoEstoqueTest {

    @Autowired
    MockMvc mvc;
    @Autowired
    ObjectMapper json;

    @Test
    @DisplayName("Pé parado no canteiro X completa torre no canteiro Y")
    void fluxoCompleto() throws Exception {
        // --- cadastro
        JsonNode tipo = enviar("/api/tipos-torre", Map.of("codigo", "SL", "nome", "Suspensão leve", "componentes", List.of(
                Map.of("nome", "Pé", "qtdPorTorre", 4, "pesoKg", 350),
                Map.of("nome", "Corpo", "qtdPorTorre", 1, "pesoKg", 2200),
                Map.of("nome", "Cabeça", "qtdPorTorre", 1, "pesoKg", 1800))), status().isCreated());
        long tipoId = tipo.get("id").asLong();
        Map<String, Long> comp = new HashMap<>();
        tipo.get("componentes").forEach(c -> comp.put(c.get("nome").asText(), c.get("id").asLong()));

        long x = enviar("/api/canteiros", Map.of("nome", "Canteiro X"), status().isCreated()).get("id").asLong();
        long y = enviar("/api/canteiros", Map.of("nome", "Canteiro Y", "metas", Map.of(String.valueOf(tipoId), 2)), status().isCreated()).get("id").asLong();
        enviar("/api/canteiros", Map.of("nome", "canteiro x"), status().isUnprocessableEntity());

        // --- entradas: X tem 1 torre + 1 pé; Y só falta 1 pé
        entrada(x, tipoId, Map.of(comp.get("Pé"), 5, comp.get("Corpo"), 1, comp.get("Cabeça"), 1));
        entrada(y, tipoId, Map.of(comp.get("Pé"), 3, comp.get("Corpo"), 1, comp.get("Cabeça"), 1));

        JsonNode analise = ler("/api/estoque/torres-completas?tipoTorreId=" + tipoId);
        assertThat(linha(analise, y).get("torresCompletas").asInt()).isZero();
        assertThat(linha(analise, y).get("faltaParaProximaTorre").get(0).get("quantidade").asInt()).isEqualTo(1);

        // --- saída maior que o disponível é recusada
        enviar("/api/movimentos/saidas", Map.of("canteiroId", x, "tipoTorreId", tipoId, "observacao", "teste",
                "itens", List.of(Map.of("componenteId", comp.get("Pé"), "quantidade", 6))), status().isUnprocessableEntity());

        // --- remanejamento sugere X -> Y (1 pé)
        JsonNode sug = ler("/api/remanejamento?tipoTorreId=" + tipoId).get(0);
        assertThat(sug.get("torresAntes").asInt()).isEqualTo(1);
        assertThat(sug.get("torresDepois").asInt()).isEqualTo(2);

        JsonNode criadas = enviar("/api/remanejamento/solicitacoes", Map.of("tipoTorreId", tipoId), status().isCreated());
        assertThat(criadas).hasSize(1);
        long trId = criadas.get(0).get("id").asLong();
        assertThat(criadas.get(0).get("status").asText()).isEqualTo("SOLICITADA");

        // reservado: X não pode mais montar usando o pé reservado + não pode baixar 5 pés
        enviar("/api/movimentos/saidas", Map.of("canteiroId", x, "tipoTorreId", tipoId, "observacao", "teste",
                "itens", List.of(Map.of("componenteId", comp.get("Pé"), "quantidade", 5))), status().isUnprocessableEntity());

        // --- despacho e recebimento
        JsonNode desp = enviar("/api/transferencias/" + trId + "/despacho", Map.of("romaneio", "ROM-1"), status().isOk());
        assertThat(desp.get("status").asText()).isEqualTo("EM_TRANSITO");
        enviar("/api/transferencias/" + trId + "/cancelamento", Map.of(), status().isUnprocessableEntity());
        JsonNode rec = enviar("/api/transferencias/" + trId + "/recebimento", Map.of(), status().isOk());
        assertThat(rec.get("status").asText()).isEqualTo("RECEBIDA");

        assertThat(linha(ler("/api/estoque/torres-completas?tipoTorreId=" + tipoId), y).get("torresCompletas").asInt()).isEqualTo(1);

        // --- montagem em Y, número duplicado recusado, estorno devolve as peças
        JsonNode mont = enviar("/api/movimentos/montagens", Map.of("canteiroId", y, "tipoTorreId", tipoId, "numeroTorre", "0101"), status().isCreated());
        enviar("/api/movimentos/montagens", Map.of("canteiroId", x, "tipoTorreId", tipoId, "numeroTorre", "0101"), status().isUnprocessableEntity());
        enviar("/api/movimentos/" + mont.get("id").asLong() + "/estorno", Map.of("motivo", "lançado errado"), status().isCreated());
        enviar("/api/movimentos/" + mont.get("id").asLong() + "/estorno", Map.of("motivo", "de novo"), status().isUnprocessableEntity());
        assertThat(linha(ler("/api/estoque/torres-completas?tipoTorreId=" + tipoId), y).get("torresCompletas").asInt()).isEqualTo(1);

        // --- inventário: contou 2 corpos em X (sistema tem 1) -> ajuste +1
        JsonNode aj = enviar("/api/movimentos/inventarios", Map.of("canteiroId", x, "tipoTorreId", tipoId, "justificativa", "contagem mensal",
                "contagens", List.of(Map.of("componenteId", comp.get("Corpo"), "quantidadeContada", 2))), status().isCreated());
        assertThat(aj.get("itens").get(0).get("quantidade").asInt()).isEqualTo(1);
        mvc.perform(post("/api/movimentos/inventarios").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(
                Map.of("canteiroId", x, "tipoTorreId", tipoId, "justificativa", "recontagem",
                        "contagens", List.of(Map.of("componenteId", comp.get("Corpo"), "quantidadeContada", 2)))))).andExpect(status().isNoContent());

        // --- componente com movimentação não pode ser removido do tipo
        enviar("/api/tipos-torre/" + tipoId, Map.of("codigo", "SL", "componentes", List.of(
                Map.of("id", comp.get("Pé"), "nome", "Pé", "qtdPorTorre", 4))), status().isUnprocessableEntity(), true);

        JsonNode painel = ler("/api/painel");
        assertThat(painel.get("transferenciasAbertas").asInt()).isZero();
        assertThat(ler("/api/movimentos").get("totalElements").asInt()).isGreaterThanOrEqualTo(7);
    }

    // ---------- apoio ----------

    private void entrada(long canteiro, long tipo, Map<Long, Integer> itens) throws Exception {
        List<Map<String, Object>> lista = itens.entrySet().stream()
                .map(e -> Map.<String, Object>of("componenteId", e.getKey(), "quantidade", e.getValue())).toList();
        enviar("/api/movimentos/entradas", Map.of("canteiroId", canteiro, "tipoTorreId", tipo, "documento", "NF 1", "itens", lista), status().isCreated());
    }

    private JsonNode linha(JsonNode analise, long canteiroId) {
        for (JsonNode l : analise) {
            if (l.get("canteiroId").asLong() == canteiroId) return l;
        }
        throw new AssertionError("canteiro " + canteiroId + " não aparece na análise: " + analise);
    }

    private JsonNode ler(String url) throws Exception {
        return json.readTree(mvc.perform(get(url)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private JsonNode enviar(String url, Object corpo, ResultMatcher esperado) throws Exception {
        return enviar(url, corpo, esperado, false);
    }

    private JsonNode enviar(String url, Object corpo, ResultMatcher esperado, boolean put) throws Exception {
        var req = (put ? org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(url) : post(url))
                .contentType(MediaType.APPLICATION_JSON).header("X-Usuario", "teste")
                .content(json.writeValueAsString(corpo));
        String body = mvc.perform(req).andExpect(esperado).andReturn().getResponse().getContentAsString();
        return body.isBlank() ? json.nullNode() : json.readTree(body);
    }
}
