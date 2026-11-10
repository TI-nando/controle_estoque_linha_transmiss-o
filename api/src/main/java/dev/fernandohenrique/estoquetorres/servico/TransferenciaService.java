package dev.fernandohenrique.estoquetorres.servico;

import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.DespachoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.RecebimentoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.SolicitacaoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.TransferenciaResponse;
import dev.fernandohenrique.estoquetorres.dominio.Canteiro;
import dev.fernandohenrique.estoquetorres.dominio.Movimento;
import dev.fernandohenrique.estoquetorres.dominio.Natureza;
import dev.fernandohenrique.estoquetorres.dominio.RecursoNaoEncontradoException;
import dev.fernandohenrique.estoquetorres.dominio.StatusTransferencia;
import dev.fernandohenrique.estoquetorres.dominio.TipoTorre;
import dev.fernandohenrique.estoquetorres.dominio.Transferencia;
import dev.fernandohenrique.estoquetorres.dominio.TransferenciaItem;
import dev.fernandohenrique.estoquetorres.repositorio.CanteiroRepository;
import dev.fernandohenrique.estoquetorres.repositorio.MovimentoRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TipoTorreRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TransferenciaRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;

/**
 * Fluxo de remanejamento entre canteiros:
 * solicitar (reserva na origem) → despachar (sai da origem) → receber (entra no destino).
 */
@Service
@Transactional
public class TransferenciaService {

    private static final String ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final TransferenciaRepository transferencias;
    private final MovimentoRepository movimentos;
    private final CanteiroRepository canteiros;
    private final TipoTorreRepository tipos;
    private final EstoqueService estoque;

    public TransferenciaService(TransferenciaRepository transferencias, MovimentoRepository movimentos,
                                CanteiroRepository canteiros, TipoTorreRepository tipos, EstoqueService estoque) {
        this.transferencias = transferencias;
        this.movimentos = movimentos;
        this.canteiros = canteiros;
        this.tipos = tipos;
        this.estoque = estoque;
    }

    public TransferenciaResponse solicitar(SolicitacaoRequest req, String usuario) {
        Canteiro origem = canteiros.travar(req.origemId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Canteiro de origem", req.origemId()));
        Canteiro destino = canteiros.findById(req.destinoId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Canteiro de destino", req.destinoId()));
        TipoTorre tipo = tipos.findById(req.tipoTorreId())
                .orElseThrow(() -> new RecursoNaoEncontradoException("Tipo de torre", req.tipoTorreId()));

        Map<Long, Integer> itens = MovimentacaoService.consolidar(tipo, req.itens());
        estoque.validarSaida(origem, tipo, itens, null);

        Transferencia t = new Transferencia(novoNumero(), origem, destino, tipo, req.observacao(), usuario);
        itens.forEach((k, q) -> t.adicionarItem(MovimentacaoService.componente(tipo, k), q));
        return Mapeador.transferencia(transferencias.save(t));
    }

    public TransferenciaResponse despachar(Long id, DespachoRequest req, String usuario) {
        Transferencia t = buscar(id);
        Canteiro origem = canteiros.travar(t.getOrigem().getId()).orElseThrow();
        Map<Long, Integer> saida = new java.util.LinkedHashMap<>();
        t.getItens().forEach(i -> saida.merge(i.getComponente().getId(), i.getQuantidade(), Integer::sum));
        // a reserva da própria transferência não conta contra ela
        estoque.validarSaida(origem, t.getTipoTorre(), saida, t);

        LocalDate data = req == null ? null : req.data();
        t.despachar(usuario, req == null ? null : req.romaneio(), req == null ? null : req.veiculo());
        Movimento m = new Movimento(Natureza.TRANSF_SAIDA, origem, t.getTipoTorre(), data, usuario)
                .transferencia(t)
                .documento(t.getNumero() + (t.getRomaneio() != null && !t.getRomaneio().isBlank() ? " · " + t.getRomaneio() : ""))
                .observacao("Para " + t.getDestino().getNome());
        t.getItens().forEach(i -> m.item(i.getComponente(), -i.getQuantidade()));
        movimentos.save(m);
        return Mapeador.transferencia(transferencias.saveAndFlush(t));
    }

    public TransferenciaResponse receber(Long id, RecebimentoRequest req, String usuario) {
        Transferencia t = buscar(id);
        canteiros.travar(t.getDestino().getId()).orElseThrow();
        t.receber(usuario, req == null ? null : req.recebidos(), req == null ? null : req.observacao());

        Movimento m = new Movimento(Natureza.TRANSF_ENTRADA, t.getDestino(), t.getTipoTorre(), req == null ? null : req.data(), usuario)
                .transferencia(t)
                .documento(t.getNumero())
                .observacao("De " + t.getOrigem().getNome() + (t.getObsRecebimento() != null && !t.getObsRecebimento().isBlank() ? " · " + t.getObsRecebimento() : ""));
        for (TransferenciaItem i : t.getItens()) {
            m.item(i.getComponente(), i.getQuantidadeRecebida());
        }
        if (!m.getItens().isEmpty()) {
            movimentos.save(m);
        }
        return Mapeador.transferencia(transferencias.saveAndFlush(t));
    }

    public TransferenciaResponse cancelar(Long id, String usuario) {
        Transferencia t = buscar(id);
        t.cancelar(usuario);
        return Mapeador.transferencia(transferencias.saveAndFlush(t));
    }

    public TransferenciaResponse marcarDivergenciaTratada(Long id) {
        Transferencia t = buscar(id);
        t.marcarDivergenciaTratada();
        return Mapeador.transferencia(transferencias.saveAndFlush(t));
    }

    @Transactional(readOnly = true)
    public TransferenciaResponse detalhar(Long id) {
        return Mapeador.transferencia(buscar(id));
    }

    @Transactional(readOnly = true)
    public List<TransferenciaResponse> listar(List<StatusTransferencia> status) {
        List<Transferencia> lista = status == null || status.isEmpty()
                ? transferencias.findAllByOrderByCriadoEmDesc()
                : transferencias.findByStatusInOrderByCriadoEmDesc(EnumSet.copyOf(status));
        return lista.stream().map(Mapeador::transferencia).toList();
    }

    private Transferencia buscar(Long id) {
        return transferencias.findById(id).orElseThrow(() -> new RecursoNaoEncontradoException("Transferência", id));
    }

    private String novoNumero() {
        String data = LocalDate.now().format(DateTimeFormatter.ofPattern("yyMMdd"));
        for (int tentativa = 0; tentativa < 20; tentativa++) {
            StringBuilder sb = new StringBuilder("TR-").append(data).append('-');
            for (int i = 0; i < 4; i++) {
                sb.append(ALFABETO.charAt(RANDOM.nextInt(ALFABETO.length())));
            }
            if (!transferencias.existsByNumero(sb.toString())) {
                return sb.toString();
            }
        }
        throw new IllegalStateException("Não foi possível gerar número de transferência único");
    }
}
