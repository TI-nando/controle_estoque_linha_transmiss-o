package dev.fernandohenrique.estoquetorres.dominio.calculo;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Cálculos sobre a composição (lista de materiais) de um tipo de torre.
 * A composição é um mapa componenteId -> quantidade por torre.
 * Classe pura: não depende de JPA nem de Spring, para ser testada isoladamente.
 */
public final class CalculadoraTorres {

    private CalculadoraTorres() {
    }

    /** Quantas torres completas cabem no estoque informado (componenteId -> quantidade). */
    public static int torresCompletas(Map<Long, Integer> qtdPorTorre, Map<Long, Integer> estoque) {
        int min = Integer.MAX_VALUE;
        boolean algum = false;
        for (var e : qtdPorTorre.entrySet()) {
            int porTorre = e.getValue();
            if (porTorre <= 0) {
                continue;
            }
            algum = true;
            int tem = Math.max(0, estoque.getOrDefault(e.getKey(), 0));
            min = Math.min(min, tem / porTorre);
        }
        return algum ? min : 0;
    }

    /** O que falta para chegar a {@code n} torres completas. */
    public static List<Item> faltaPara(Map<Long, Integer> qtdPorTorre, Map<Long, Integer> estoque, int n) {
        List<Item> falta = new ArrayList<>();
        qtdPorTorre.forEach((comp, porTorre) -> {
            if (porTorre <= 0) {
                return;
            }
            int precisa = porTorre * n - Math.max(0, estoque.getOrDefault(comp, 0));
            if (precisa > 0) {
                falta.add(new Item(comp, precisa));
            }
        });
        return falta;
    }

    /** Itens consumidos pela montagem de {@code n} torres. */
    public static List<Item> itensDaMontagem(Map<Long, Integer> qtdPorTorre, int n) {
        List<Item> itens = new ArrayList<>();
        qtdPorTorre.forEach((comp, porTorre) -> {
            if (porTorre > 0) {
                itens.add(new Item(comp, porTorre * n));
            }
        });
        return itens;
    }

    public record Item(Long componenteId, int quantidade) {
    }
}
