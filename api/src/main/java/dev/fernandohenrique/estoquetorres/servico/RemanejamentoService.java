package dev.fernandohenrique.estoquetorres.servico;

import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.GanhoCanteiro;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.PainelResponse;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.RemanejamentoResponse;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.ResumoTipo;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.TransferenciaSugerida;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.ItemRequest;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.SolicitacaoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.TransferenciaResponse;
import dev.fernandohenrique.estoquetorres.dominio.Canteiro;
import dev.fernandohenrique.estoquetorres.dominio.Componente;
import dev.fernandohenrique.estoquetorres.dominio.Natureza;
import dev.fernandohenrique.estoquetorres.dominio.RecursoNaoEncontradoException;
import dev.fernandohenrique.estoquetorres.dominio.StatusTransferencia;
import dev.fernandohenrique.estoquetorres.dominio.TipoTorre;
import dev.fernandohenrique.estoquetorres.dominio.calculo.PlanejadorRemanejamento;
import dev.fernandohenrique.estoquetorres.dominio.calculo.PlanejadorRemanejamento.EstoqueCanteiro;
import dev.fernandohenrique.estoquetorres.dominio.calculo.PlanejadorRemanejamento.Opcoes;
import dev.fernandohenrique.estoquetorres.dominio.calculo.PlanejadorRemanejamento.Plano;
import dev.fernandohenrique.estoquetorres.repositorio.CanteiroRepository;
import dev.fernandohenrique.estoquetorres.repositorio.MovimentoRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TipoTorreRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TransferenciaRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class RemanejamentoService {

    private final EstoqueService estoque;
    private final TransferenciaService transferenciaService;
    private final CanteiroRepository canteiros;
    private final TipoTorreRepository tipos;
    private final MovimentoRepository movimentos;
    private final TransferenciaRepository transferencias;
    private final PlanejadorRemanejamento planejador = new PlanejadorRemanejamento();

    public RemanejamentoService(EstoqueService estoque, TransferenciaService transferenciaService,
                                CanteiroRepository canteiros, TipoTorreRepository tipos,
                                MovimentoRepository movimentos, TransferenciaRepository transferencias) {
        this.estoque = estoque;
        this.transferenciaService = transferenciaService;
        this.canteiros = canteiros;
        this.tipos = tipos;
        this.movimentos = movimentos;
        this.transferencias = transferencias;
    }

    /** Sugestões de remanejamento para um tipo (ou todos, se tipoId for nulo). */
    public List<RemanejamentoResponse> sugerir(Long tipoId, Long destinoId, boolean respeitarMeta) {
        EstoqueService.Posicao pos = estoque.posicao();
        List<Canteiro> ativos = canteiros.findByAtivoTrueOrderByNomeAsc();
        Map<Long, Canteiro> porId = ativos.stream().collect(Collectors.toMap(Canteiro::getId, Function.identity()));
        if (destinoId != null && !porId.containsKey(destinoId)) {
            throw new RecursoNaoEncontradoException("Canteiro ativo", destinoId);
        }
        List<RemanejamentoResponse> out = new ArrayList<>();
        for (TipoTorre t : tiposDe(tipoId)) {
            List<EstoqueCanteiro> entrada = ativos.stream()
                    .map(c -> new EstoqueCanteiro(c.getId(), c.metaDo(t.getId()), pos.disponivelDo(c.getId(), t))).toList();
            Plano plano = planejador.planejar(t.composicao(), entrada, new Opcoes(destinoId, respeitarMeta));
            List<TransferenciaSugerida> sugeridas = plano.transferencias().stream()
                    .map(s -> new TransferenciaSugerida(s.origemId(), porId.get(s.origemId()).getNome(),
                            s.destinoId(), porId.get(s.destinoId()).getNome(),
                            Mapeador.itens(t, s.itens()), Mapeador.peso(t, s.itens())))
                    .toList();
            List<GanhoCanteiro> ganhos = plano.ganhos().stream()
                    .map(g -> new GanhoCanteiro(g.canteiroId(), porId.get(g.canteiroId()).getNome(), g.antes(), g.depois())).toList();
            out.add(new RemanejamentoResponse(t.getId(), t.getCodigo(), plano.torresAntes(), plano.torresDepois(),
                    PlanejadorRemanejamento.maximoTeorico(t.composicao(), entrada), sugeridas, ganhos));
        }
        return out;
    }

    /** Transforma a sugestão atual em solicitações de transferência (tudo ou nada). */
    @Transactional
    public List<TransferenciaResponse> gerarSolicitacoes(Long tipoId, Long destinoId, boolean respeitarMeta, String usuario) {
        List<TransferenciaResponse> criadas = new ArrayList<>();
        for (RemanejamentoResponse r : sugerir(tipoId, destinoId, respeitarMeta)) {
            for (TransferenciaSugerida s : r.transferencias()) {
                List<ItemRequest> itens = s.itens().stream().map(i -> new ItemRequest(i.componenteId(), i.quantidade())).toList();
                criadas.add(transferenciaService.solicitar(new SolicitacaoRequest(s.origemId(), s.destinoId(), r.tipoTorreId(),
                        "Gerada pelo remanejamento automático", itens), usuario));
            }
        }
        return criadas;
    }

    public PainelResponse painel() {
        EstoqueService.Posicao pos = estoque.posicao();
        List<Canteiro> ativos = canteiros.findByAtivoTrueOrderByNomeAsc();
        int completas = 0;
        List<ResumoTipo> porTipo = new ArrayList<>();
        BigDecimal peso = BigDecimal.ZERO;
        for (TipoTorre t : tipos.findAllByOrderByCodigoAsc()) {
            List<EstoqueCanteiro> entrada = ativos.stream()
                    .map(c -> new EstoqueCanteiro(c.getId(), c.metaDo(t.getId()), pos.disponivelDo(c.getId(), t))).toList();
            Plano p = planejador.planejar(t.composicao(), entrada, Opcoes.padrao());
            completas += p.torresAntes();
            porTipo.add(new ResumoTipo(t.getId(), t.getCodigo(), p.torresAntes(), p.torresDepois(),
                    PlanejadorRemanejamento.maximoTeorico(t.composicao(), entrada)));
            for (Canteiro c : canteiros.findAll()) {
                for (Componente k : t.getComponentes()) {
                    int f = pos.fisico(c.getId(), t.getId(), k.getId());
                    if (f > 0 && k.getPesoKg() != null) {
                        peso = peso.add(k.getPesoKg().multiply(BigDecimal.valueOf(f)));
                    }
                }
            }
        }
        long abertas = transferencias.findByStatusInOrderByCriadoEmDesc(EnumSet.of(StatusTransferencia.SOLICITADA, StatusTransferencia.EM_TRANSITO)).size();
        long transito = transferencias.findByStatusInOrderByCriadoEmDesc(EnumSet.of(StatusTransferencia.EM_TRANSITO)).size();
        return new PainelResponse(completas, movimentos.contarAtivos(Natureza.MONTAGEM), abertas, transito, peso, porTipo);
    }

    private List<TipoTorre> tiposDe(Long tipoId) {
        if (tipoId == null) {
            return tipos.findAllByOrderByCodigoAsc();
        }
        return List.of(tipos.findById(tipoId).orElseThrow(() -> new RecursoNaoEncontradoException("Tipo de torre", tipoId)));
    }
}
