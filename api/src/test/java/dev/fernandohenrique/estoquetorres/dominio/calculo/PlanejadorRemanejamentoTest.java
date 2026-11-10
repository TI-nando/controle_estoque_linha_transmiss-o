package dev.fernandohenrique.estoquetorres.dominio.calculo;

import dev.fernandohenrique.estoquetorres.dominio.calculo.PlanejadorRemanejamento.EstoqueCanteiro;
import dev.fernandohenrique.estoquetorres.dominio.calculo.PlanejadorRemanejamento.Opcoes;
import dev.fernandohenrique.estoquetorres.dominio.calculo.PlanejadorRemanejamento.Plano;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;

class PlanejadorRemanejamentoTest {

    private static final long PE = 1L, CORPO = 2L, CABECA = 3L;
    private static final Map<Long, Integer> BOM = new LinkedHashMap<>(Map.of(PE, 4, CORPO, 1, CABECA, 1));
    private final PlanejadorRemanejamento planejador = new PlanejadorRemanejamento();

    @Test
    @DisplayName("O pé parado no canteiro X completa a torre do canteiro Y")
    void peDeUmCanteiroCompletaTorreDeOutro() {
        var x = new EstoqueCanteiro(10L, 0, Map.of(PE, 5, CORPO, 1, CABECA, 1)); // 1 torre + 1 pé sobrando
        var y = new EstoqueCanteiro(20L, 0, Map.of(PE, 3, CORPO, 1, CABECA, 1)); // falta 1 pé

        Plano p = planejador.planejar(BOM, List.of(x, y), Opcoes.padrao());

        assertThat(p.torresAntes()).isEqualTo(1);
        assertThat(p.torresDepois()).isEqualTo(2);
        assertThat(p.transferencias()).singleElement().satisfies(t -> {
            assertThat(t.origemId()).isEqualTo(10L);
            assertThat(t.destinoId()).isEqualTo(20L);
            assertThat(t.itens()).containsExactly(new CalculadoraTorres.Item(PE, 1));
        });
    }

    @Test
    @DisplayName("Doador nunca desmonta uma torre completa própria")
    void naoDesmontaTorreDoDoador() {
        var x = new EstoqueCanteiro(10L, 0, Map.of(PE, 4, CORPO, 1, CABECA, 1)); // exatamente 1 torre
        var y = new EstoqueCanteiro(20L, 0, Map.of(PE, 0, CORPO, 1, CABECA, 1));

        Plano p = planejador.planejar(BOM, List.of(x, y), Opcoes.padrao());

        assertThat(p.transferencias()).isEmpty();
        assertThat(p.torresDepois()).isEqualTo(1);
    }

    @Test
    @DisplayName("Canteiro abaixo da meta tem prioridade")
    void priorizaMeta() {
        var doador = new EstoqueCanteiro(1L, 0, Map.of(PE, 1));
        var semMeta = new EstoqueCanteiro(2L, 0, Map.of(PE, 3, CORPO, 1, CABECA, 1));
        var comMeta = new EstoqueCanteiro(3L, 5, Map.of(PE, 3, CORPO, 1, CABECA, 1));

        Plano p = planejador.planejar(BOM, List.of(doador, semMeta, comMeta), Opcoes.padrao());

        assertThat(p.ganhos()).singleElement().satisfies(g -> assertThat(g.canteiroId()).isEqualTo(3L));
    }

    @Test
    @DisplayName("Com destino informado, só completa torres nele")
    void respeitaDestino() {
        var a = new EstoqueCanteiro(1L, 0, Map.of(PE, 8, CORPO, 1, CABECA, 1));
        var b = new EstoqueCanteiro(2L, 0, Map.of(CORPO, 1, CABECA, 1));
        var c = new EstoqueCanteiro(3L, 0, Map.of(CORPO, 1, CABECA, 1));

        Plano p = planejador.planejar(BOM, List.of(a, b, c), new Opcoes(3L, true));

        assertThat(p.ganhos()).extracting(PlanejadorRemanejamento.Ganho::canteiroId).containsExactly(3L);
    }

    @ParameterizedTest
    @ValueSource(longs = {1, 7, 42, 2026})
    @DisplayName("Invariantes em cenários aleatórios")
    void invariantes(long semente) {
        Random r = new Random(semente);
        for (int s = 0; s < 300; s++) {
            List<EstoqueCanteiro> cs = new ArrayList<>();
            for (long c = 1; c <= 6; c++) {
                Map<Long, Integer> m = new HashMap<>();
                BOM.forEach((k, q) -> m.put(k, r.nextInt(q * 3 + 1)));
                cs.add(new EstoqueCanteiro(c, r.nextInt(3) == 0 ? r.nextInt(4) : 0, m));
            }
            Plano p = planejador.planejar(BOM, cs, new Opcoes(null, r.nextBoolean()));

            assertThat(p.torresDepois()).isGreaterThanOrEqualTo(p.torresAntes())
                    .isLessThanOrEqualTo(PlanejadorRemanejamento.maximoTeorico(BOM, cs));

            Map<Long, Map<Long, Integer>> est = new HashMap<>();
            cs.forEach(c -> est.put(c.canteiroId(), new HashMap<>(c.disponivel())));
            p.transferencias().forEach(t -> t.itens().forEach(i -> {
                est.get(t.origemId()).merge(i.componenteId(), -i.quantidade(), Integer::sum);
                est.get(t.destinoId()).merge(i.componenteId(), i.quantidade(), Integer::sum);
            }));
            int total = 0;
            for (EstoqueCanteiro c : cs) {
                assertThat(est.get(c.canteiroId()).values()).allMatch(v -> v >= 0);
                int antes = CalculadoraTorres.torresCompletas(BOM, c.disponivel());
                int depois = CalculadoraTorres.torresCompletas(BOM, est.get(c.canteiroId()));
                assertThat(depois).as("doador perdeu torre").isGreaterThanOrEqualTo(antes);
                total += depois;
            }
            assertThat(total).isEqualTo(p.torresDepois());
        }
    }
}
