package dev.fernandohenrique.estoquetorres.dominio.calculo;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Sugere transferências de componentes entre canteiros para maximizar o número de
 * torres completas de um tipo.
 *
 * <p>Algoritmo guloso. A cada passo escolhe o canteiro cuja próxima torre:
 * <ol>
 *   <li>está abaixo da meta do canteiro (prioridade);</li>
 *   <li>exige menos peças vindas de fora;</li>
 *   <li>envolve menos transferências.</li>
 * </ol>
 * Um canteiro só doa o seu <b>excedente</b>: o que sobra depois de garantir as torres
 * completas que ele já consegue montar. Assim, nenhum doador perde uma torre completa.
 *
 * <p>Classe pura (sem Spring/JPA) para ser testada isoladamente.
 */
public final class PlanejadorRemanejamento {

    private static final int LIMITE_ITERACOES = 10_000;

    public Plano planejar(Map<Long, Integer> qtdPorTorre, List<EstoqueCanteiro> canteiros, Opcoes opcoes) {
        Objects.requireNonNull(qtdPorTorre);
        Objects.requireNonNull(canteiros);
        Opcoes op = opcoes == null ? Opcoes.padrao() : opcoes;

        Map<Long, Integer> comps = new LinkedHashMap<>();
        qtdPorTorre.forEach((k, v) -> {
            if (v != null && v > 0) {
                comps.put(k, v);
            }
        });
        if (comps.isEmpty() || canteiros.isEmpty()) {
            return new Plano(0, 0, List.of(), List.of());
        }

        // cópias mutáveis
        Map<Long, Map<Long, Integer>> est = new LinkedHashMap<>();
        Map<Long, Integer> compromisso = new HashMap<>();
        Map<Long, Integer> meta = new HashMap<>();
        for (EstoqueCanteiro c : canteiros) {
            Map<Long, Integer> copia = new HashMap<>();
            comps.keySet().forEach(k -> copia.put(k, c.disponivel().getOrDefault(k, 0)));
            est.put(c.canteiroId(), copia);
            compromisso.put(c.canteiroId(), CalculadoraTorres.torresCompletas(comps, copia));
            meta.put(c.canteiroId(), Math.max(0, c.meta()));
        }
        Map<Long, Integer> inicial = new HashMap<>(compromisso);
        int antes = compromisso.values().stream().mapToInt(Integer::intValue).sum();
        List<Movimento> movimentos = new ArrayList<>();

        for (int iter = 0; iter < LIMITE_ITERACOES; iter++) {
            Candidato melhor = null;
            for (Long destino : est.keySet()) {
                if (op.destinoId() != null && !op.destinoId().equals(destino)) {
                    continue;
                }
                if (op.respeitarMeta() && meta.get(destino) > 0 && compromisso.get(destino) >= meta.get(destino)) {
                    continue;
                }
                Candidato c = avaliar(destino, comps, est, compromisso, meta);
                if (c != null && (melhor == null || c.compareTo(melhor) > 0)) {
                    melhor = c;
                }
            }
            if (melhor == null) {
                break;
            }
            for (Movimento m : melhor.plano()) {
                est.get(m.origemId()).merge(m.componenteId(), -m.quantidade(), Integer::sum);
                est.get(m.destinoId()).merge(m.componenteId(), m.quantidade(), Integer::sum);
                movimentos.add(m);
            }
            compromisso.merge(melhor.destinoId(), 1, Integer::sum);
        }

        int depois = compromisso.values().stream().mapToInt(Integer::intValue).sum();
        List<Ganho> ganhos = new ArrayList<>();
        compromisso.forEach((cid, n) -> {
            if (n > inicial.get(cid)) {
                ganhos.add(new Ganho(cid, inicial.get(cid), n));
            }
        });
        ganhos.sort(Comparator.comparing(Ganho::canteiroId));
        return new Plano(antes, depois, consolidar(movimentos), ganhos);
    }

    /** Máximo de torres se todo o estoque disponível estivesse num único canteiro. */
    public static int maximoTeorico(Map<Long, Integer> qtdPorTorre, List<EstoqueCanteiro> canteiros) {
        Map<Long, Integer> total = new HashMap<>();
        canteiros.forEach(c -> c.disponivel().forEach((k, v) -> total.merge(k, Math.max(0, v), Integer::sum)));
        return CalculadoraTorres.torresCompletas(qtdPorTorre, total);
    }

    private Candidato avaliar(Long destino, Map<Long, Integer> comps, Map<Long, Map<Long, Integer>> est,
                              Map<Long, Integer> compromisso, Map<Long, Integer> meta) {
        int falta = 0;
        List<Movimento> plano = new ArrayList<>();
        for (var comp : comps.entrySet()) {
            Long compId = comp.getKey();
            int porTorre = comp.getValue();
            int precisa = (compromisso.get(destino) + 1) * porTorre - est.get(destino).get(compId);
            if (precisa <= 0) {
                continue;
            }
            falta += precisa;
            List<Long> doadores = est.keySet().stream()
                    .filter(d -> !d.equals(destino))
                    .filter(d -> excedente(d, compId, porTorre, est, compromisso) > 0)
                    .sorted(Comparator.comparingInt((Long d) -> excedente(d, compId, porTorre, est, compromisso)).reversed())
                    .toList();
            int resto = precisa;
            for (Long d : doadores) {
                if (resto <= 0) {
                    break;
                }
                int x = Math.min(resto, excedente(d, compId, porTorre, est, compromisso));
                plano.add(new Movimento(d, destino, compId, x));
                resto -= x;
            }
            if (resto > 0) {
                return null; // não há excedente suficiente na obra para esta torre
            }
        }
        boolean abaixoMeta = meta.get(destino) > 0 && compromisso.get(destino) < meta.get(destino);
        return new Candidato(destino, plano, abaixoMeta, falta);
    }

    private static int excedente(Long canteiro, Long comp, int porTorre,
                                 Map<Long, Map<Long, Integer>> est, Map<Long, Integer> compromisso) {
        return est.get(canteiro).get(comp) - compromisso.get(canteiro) * porTorre;
    }

    private static List<TransferenciaSugerida> consolidar(List<Movimento> movimentos) {
        Map<String, Map<Long, Integer>> porPar = new LinkedHashMap<>();
        Map<String, long[]> pares = new HashMap<>();
        for (Movimento m : movimentos) {
            String chave = m.origemId() + ">" + m.destinoId();
            porPar.computeIfAbsent(chave, k -> new LinkedHashMap<>()).merge(m.componenteId(), m.quantidade(), Integer::sum);
            pares.putIfAbsent(chave, new long[]{m.origemId(), m.destinoId()});
        }
        List<TransferenciaSugerida> out = new ArrayList<>();
        porPar.forEach((chave, itens) -> {
            long[] p = pares.get(chave);
            List<CalculadoraTorres.Item> lista = itens.entrySet().stream()
                    .map(e -> new CalculadoraTorres.Item(e.getKey(), e.getValue())).toList();
            out.add(new TransferenciaSugerida(p[0], p[1], lista));
        });
        return out;
    }

    // ---- tipos de entrada e saída -------------------------------------------------

    /** Estoque disponível (físico - reservado) de um canteiro para o tipo de torre em análise. */
    public record EstoqueCanteiro(Long canteiroId, int meta, Map<Long, Integer> disponivel) {
    }

    /**
     * @param destinoId     se informado, só completa torres neste canteiro
     * @param respeitarMeta para de completar torres num canteiro que já atingiu a meta
     */
    public record Opcoes(Long destinoId, boolean respeitarMeta) {
        public static Opcoes padrao() {
            return new Opcoes(null, true);
        }
    }

    public record Plano(int torresAntes, int torresDepois, List<TransferenciaSugerida> transferencias, List<Ganho> ganhos) {
    }

    public record TransferenciaSugerida(Long origemId, Long destinoId, List<CalculadoraTorres.Item> itens) {
    }

    public record Ganho(Long canteiroId, int antes, int depois) {
    }

    private record Movimento(Long origemId, Long destinoId, Long componenteId, int quantidade) {
    }

    private record Candidato(Long destinoId, List<Movimento> plano, boolean abaixoMeta, int falta)
            implements Comparable<Candidato> {
        @Override
        public int compareTo(Candidato o) {
            if (abaixoMeta != o.abaixoMeta) {
                return abaixoMeta ? 1 : -1;
            }
            if (falta != o.falta) {
                return Integer.compare(o.falta, falta); // menos falta é melhor
            }
            return Integer.compare(o.plano.size(), plano.size());
        }
    }
}
