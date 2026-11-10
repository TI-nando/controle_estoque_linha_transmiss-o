package dev.fernandohenrique.estoquetorres.servico;

import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.LinhaAnalise;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.PosicaoItem;
import dev.fernandohenrique.estoquetorres.dominio.Canteiro;
import dev.fernandohenrique.estoquetorres.dominio.Componente;
import dev.fernandohenrique.estoquetorres.dominio.RegraNegocioException;
import dev.fernandohenrique.estoquetorres.dominio.StatusTransferencia;
import dev.fernandohenrique.estoquetorres.dominio.TipoTorre;
import dev.fernandohenrique.estoquetorres.dominio.Transferencia;
import dev.fernandohenrique.estoquetorres.dominio.calculo.CalculadoraTorres;
import dev.fernandohenrique.estoquetorres.repositorio.CanteiroRepository;
import dev.fernandohenrique.estoquetorres.repositorio.MovimentoRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TipoTorreRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TransferenciaRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Consultas de saldo. O saldo nunca é armazenado: é sempre a soma do razão (movimentos),
 * o que elimina divergência entre "saldo" e "histórico".
 */
@Service
@Transactional(readOnly = true)
public class EstoqueService {

    private final MovimentoRepository movimentos;
    private final TransferenciaRepository transferencias;
    private final CanteiroRepository canteiros;
    private final TipoTorreRepository tipos;

    public EstoqueService(MovimentoRepository movimentos, TransferenciaRepository transferencias,
                          CanteiroRepository canteiros, TipoTorreRepository tipos) {
        this.movimentos = movimentos;
        this.transferencias = transferencias;
        this.canteiros = canteiros;
        this.tipos = tipos;
    }

    // ---------- saldo de um canteiro/tipo ----------

    public Map<Long, Integer> fisico(Long canteiroId, Long tipoId) {
        return paraMapa(movimentos.saldoPorComponente(canteiroId, tipoId));
    }

    public Map<Long, Integer> reservado(Long canteiroId, Long tipoId) {
        return paraMapa(transferencias.somaPorOrigem(canteiroId, tipoId, StatusTransferencia.SOLICITADA));
    }

    public Map<Long, Integer> disponivel(Long canteiroId, Long tipoId) {
        Map<Long, Integer> d = new HashMap<>(fisico(canteiroId, tipoId));
        reservado(canteiroId, tipoId).forEach((k, v) -> d.merge(k, -v, Integer::sum));
        return d;
    }

    /**
     * Garante que o canteiro tem disponível tudo o que vai sair.
     * <b>Deve ser chamado com o canteiro travado</b> ({@link CanteiroRepository#travar}).
     *
     * @param ignorarReservaDe transferência cuja própria reserva não conta contra ela (no despacho)
     */
    public void validarSaida(Canteiro canteiro, TipoTorre tipo, Map<Long, Integer> saida, Transferencia ignorarReservaDe) {
        Map<Long, Integer> disp = disponivel(canteiro.getId(), tipo.getId());
        if (ignorarReservaDe != null) {
            ignorarReservaDe.getItens().forEach(i -> disp.merge(i.getComponente().getId(), i.getQuantidade(), Integer::sum));
        }
        List<String> erros = new ArrayList<>();
        saida.forEach((comp, qtd) -> {
            int tem = disp.getOrDefault(comp, 0);
            if (qtd > tem) {
                erros.add(Mapeador.nomeComponente(tipo, comp) + ": precisa de " + qtd + ", disponível " + tem + " em " + canteiro.getNome());
            }
        });
        if (!erros.isEmpty()) {
            throw new RegraNegocioException(erros);
        }
    }

    // ---------- posição geral ----------

    public record Chave(Long canteiroId, Long tipoId, Long componenteId) {
    }

    public record Posicao(Map<Chave, Integer> fisico, Map<Chave, Integer> reservado, Map<Chave, Integer> aCaminho) {
        public int fisico(Long c, Long t, Long k) { return fisico.getOrDefault(new Chave(c, t, k), 0); }
        public int reservado(Long c, Long t, Long k) { return reservado.getOrDefault(new Chave(c, t, k), 0); }
        public int aCaminho(Long c, Long t, Long k) { return aCaminho.getOrDefault(new Chave(c, t, k), 0); }
        public int disponivel(Long c, Long t, Long k) { return fisico(c, t, k) - reservado(c, t, k); }

        public Map<Long, Integer> disponivelDo(Long canteiroId, TipoTorre tipo) {
            Map<Long, Integer> m = new HashMap<>();
            tipo.getComponentes().forEach(k -> m.put(k.getId(), disponivel(canteiroId, tipo.getId(), k.getId())));
            return m;
        }

        public Map<Long, Integer> disponivelMaisChegando(Long canteiroId, TipoTorre tipo) {
            Map<Long, Integer> m = disponivelDo(canteiroId, tipo);
            m.replaceAll((k, v) -> v + aCaminho(canteiroId, tipo.getId(), k));
            return m;
        }
    }

    public Posicao posicao() {
        Map<Chave, Integer> fis = new HashMap<>();
        for (Object[] r : movimentos.saldoGeral()) {
            fis.put(new Chave((Long) r[0], (Long) r[1], (Long) r[2]), ((Number) r[3]).intValue());
        }
        Map<Chave, Integer> res = new HashMap<>();
        for (Object[] r : transferencias.somaGeral(StatusTransferencia.SOLICITADA)) {
            res.merge(new Chave((Long) r[0], (Long) r[2], (Long) r[3]), ((Number) r[4]).intValue(), Integer::sum);
        }
        Map<Chave, Integer> cam = new HashMap<>();
        for (Object[] r : transferencias.somaGeral(StatusTransferencia.EM_TRANSITO)) {
            cam.merge(new Chave((Long) r[1], (Long) r[2], (Long) r[3]), ((Number) r[4]).intValue(), Integer::sum);
        }
        return new Posicao(fis, res, cam);
    }

    public List<PosicaoItem> posicaoDetalhada(Long canteiroId, Long tipoId) {
        Posicao p = posicao();
        List<PosicaoItem> out = new ArrayList<>();
        for (Canteiro c : canteiros.findAllByOrderByNomeAsc()) {
            if (canteiroId != null && !canteiroId.equals(c.getId())) continue;
            for (TipoTorre t : tipos.findAllByOrderByCodigoAsc()) {
                if (tipoId != null && !tipoId.equals(t.getId())) continue;
                for (Componente k : t.getComponentes()) {
                    int f = p.fisico(c.getId(), t.getId(), k.getId());
                    int r = p.reservado(c.getId(), t.getId(), k.getId());
                    int a = p.aCaminho(c.getId(), t.getId(), k.getId());
                    if (f == 0 && r == 0 && a == 0) continue;
                    out.add(new PosicaoItem(c.getId(), c.getNome(), t.getId(), t.getCodigo(), k.getId(), k.getNome(),
                            k.getQtdPorTorre(), f, r, f - r, a));
                }
            }
        }
        return out;
    }

    /** Torres completas por canteiro x tipo e o que falta para a próxima. */
    public List<LinhaAnalise> analise(Long tipoId) {
        Posicao p = posicao();
        List<LinhaAnalise> out = new ArrayList<>();
        for (TipoTorre t : tipos.findAllByOrderByCodigoAsc()) {
            if (tipoId != null && !tipoId.equals(t.getId())) continue;
            Map<Long, Integer> bom = t.composicao();
            for (Canteiro c : canteiros.findByAtivoTrueOrderByNomeAsc()) {
                Map<Long, Integer> disp = p.disponivelDo(c.getId(), t);
                int completas = CalculadoraTorres.torresCompletas(bom, disp);
                int comTransito = CalculadoraTorres.torresCompletas(bom, p.disponivelMaisChegando(c.getId(), t));
                boolean temAlgo = disp.values().stream().anyMatch(v -> v > 0);
                if (!temAlgo && c.metaDo(t.getId()) == 0 && comTransito == 0) continue;
                out.add(new LinhaAnalise(c.getId(), c.getNome(), t.getId(), t.getCodigo(), c.metaDo(t.getId()),
                        completas, comTransito, Mapeador.itens(t, CalculadoraTorres.faltaPara(bom, disp, completas + 1))));
            }
        }
        return out;
    }

    private static Map<Long, Integer> paraMapa(List<Object[]> linhas) {
        Map<Long, Integer> m = new HashMap<>();
        for (Object[] r : linhas) {
            m.put((Long) r[0], ((Number) r[1]).intValue());
        }
        return m;
    }
}
