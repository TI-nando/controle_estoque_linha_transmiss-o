package dev.fernandohenrique.estoquetorres.servico;

import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.ContagemRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.InventarioRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.ItemRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.LancamentoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.MontagemRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.MovimentoResponse;
import dev.fernandohenrique.estoquetorres.dominio.Canteiro;
import dev.fernandohenrique.estoquetorres.dominio.Componente;
import dev.fernandohenrique.estoquetorres.dominio.Movimento;
import dev.fernandohenrique.estoquetorres.dominio.MovimentoItem;
import dev.fernandohenrique.estoquetorres.dominio.Natureza;
import dev.fernandohenrique.estoquetorres.dominio.RecursoNaoEncontradoException;
import dev.fernandohenrique.estoquetorres.dominio.RegraNegocioException;
import dev.fernandohenrique.estoquetorres.dominio.TipoTorre;
import dev.fernandohenrique.estoquetorres.dominio.calculo.CalculadoraTorres;
import dev.fernandohenrique.estoquetorres.repositorio.CanteiroRepository;
import dev.fernandohenrique.estoquetorres.repositorio.MovimentoRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TipoTorreRepository;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Lançamentos no razão: entradas, saídas, montagens, inventário e estornos. */
@Service
@Transactional
public class MovimentacaoService {

    private final MovimentoRepository movimentos;
    private final CanteiroRepository canteiros;
    private final TipoTorreRepository tipos;
    private final EstoqueService estoque;

    public MovimentacaoService(MovimentoRepository movimentos, CanteiroRepository canteiros,
                               TipoTorreRepository tipos, EstoqueService estoque) {
        this.movimentos = movimentos;
        this.canteiros = canteiros;
        this.tipos = tipos;
        this.estoque = estoque;
    }

    public MovimentoResponse entrada(LancamentoRequest req, String usuario) {
        Canteiro c = canteiro(req.canteiroId(), false);
        TipoTorre t = tipo(req.tipoTorreId());
        exigirAtivo(c);
        Map<Long, Integer> itens = consolidar(t, req.itens());
        Movimento m = new Movimento(Natureza.ENTRADA, c, t, req.data(), usuario)
                .documento(req.documento()).observacao(req.observacao());
        itens.forEach((k, q) -> m.item(componente(t, k), q));
        return Mapeador.movimento(movimentos.save(m));
    }

    public MovimentoResponse saida(LancamentoRequest req, String usuario) {
        if (req.observacao() == null || req.observacao().isBlank()) {
            throw new RegraNegocioException("Informe o motivo da saída na observação.");
        }
        Canteiro c = canteiro(req.canteiroId(), true);
        TipoTorre t = tipo(req.tipoTorreId());
        Map<Long, Integer> itens = consolidar(t, req.itens());
        estoque.validarSaida(c, t, itens, null);
        Movimento m = new Movimento(Natureza.SAIDA, c, t, req.data(), usuario)
                .documento(req.documento()).observacao(req.observacao());
        itens.forEach((k, q) -> m.item(componente(t, k), -q));
        return Mapeador.movimento(movimentos.save(m));
    }

    /** Montagem de uma torre: baixa a composição completa do tipo no canteiro. */
    public MovimentoResponse montagem(MontagemRequest req, String usuario) {
        Canteiro c = canteiro(req.canteiroId(), true);
        TipoTorre t = tipo(req.tipoTorreId());
        String numero = req.numeroTorre().trim();
        Map<Long, Integer> bom = t.composicao();
        if (bom.isEmpty()) {
            throw new RegraNegocioException("O tipo " + t.getCodigo() + " não tem componentes cadastrados.");
        }
        if (movimentos.existeMontagemAtiva(numero, Natureza.MONTAGEM)) {
            throw new RegraNegocioException("A torre " + numero + " já está registrada como montada. Estorne o registro anterior se estiver errado.");
        }
        Map<Long, Integer> saida = new LinkedHashMap<>();
        CalculadoraTorres.itensDaMontagem(bom, 1).forEach(i -> saida.put(i.componenteId(), i.quantidade()));
        try {
            estoque.validarSaida(c, t, saida, null);
        } catch (RegraNegocioException e) {
            List<String> erros = new ArrayList<>();
            erros.add("Estoque insuficiente para uma torre " + t.getCodigo() + " completa:");
            erros.addAll(e.getErros());
            throw new RegraNegocioException(erros);
        }
        Movimento m = new Movimento(Natureza.MONTAGEM, c, t, req.data(), usuario)
                .numeroTorre(numero).documento("Torre " + numero).observacao(req.observacao());
        saida.forEach((k, q) -> m.item(componente(t, k), -q));
        return Mapeador.movimento(movimentos.save(m));
    }

    /**
     * Inventário: compara a contagem física com o saldo e lança somente a diferença.
     * @return vazio se tudo confere
     */
    public Optional<MovimentoResponse> inventario(InventarioRequest req, String usuario) {
        Canteiro c = canteiro(req.canteiroId(), true);
        TipoTorre t = tipo(req.tipoTorreId());
        Map<Long, Integer> fisico = estoque.fisico(c.getId(), t.getId());
        Movimento m = new Movimento(Natureza.AJUSTE, c, t, req.data(), usuario)
                .documento("Inventário").observacao(req.justificativa());
        java.util.Set<Long> vistos = new java.util.HashSet<>();
        for (ContagemRequest ct : req.contagens()) {
            if (!vistos.add(ct.componenteId())) {
                throw new RegraNegocioException("Componente repetido na contagem: " + Mapeador.nomeComponente(t, ct.componenteId()));
            }
            Componente k = componente(t, ct.componenteId());
            int diferenca = ct.quantidadeContada() - fisico.getOrDefault(k.getId(), 0);
            m.item(k, diferenca);
        }
        if (m.getItens().isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(Mapeador.movimento(movimentos.save(m)));
    }

    public MovimentoResponse estornar(Long movimentoId, String motivo, String usuario) {
        Movimento original = movimentos.findById(movimentoId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Movimento", movimentoId));
        if (original.getEstornoDe() != null) {
            throw new RegraNegocioException("Um estorno não pode ser estornado.");
        }
        // trava antes de checar, para dois estornos simultâneos não passarem juntos
        Canteiro c = canteiro(original.getCanteiro().getId(), true);
        if (movimentos.existsByEstornoDeId(movimentoId)) {
            throw new RegraNegocioException("Este lançamento já foi estornado.");
        }
        Movimento estorno = original.estorno(usuario, motivo);
        Map<Long, Integer> saida = new LinkedHashMap<>();
        for (MovimentoItem i : estorno.getItens()) {
            if (i.getQuantidade() < 0) {
                saida.merge(i.getComponente().getId(), -i.getQuantidade(), Integer::sum);
            }
        }
        if (!saida.isEmpty()) {
            try {
                estoque.validarSaida(c, original.getTipoTorre(), saida, null);
            } catch (RegraNegocioException e) {
                List<String> erros = new ArrayList<>();
                erros.add("O estorno deixaria o saldo negativo:");
                erros.addAll(e.getErros());
                throw new RegraNegocioException(erros);
            }
        }
        return Mapeador.movimento(movimentos.save(estorno));
    }

    @Transactional(readOnly = true)
    public Page<MovimentoResponse> listar(Long canteiroId, Long tipoId, Natureza natureza, LocalDate de, LocalDate ate,
                                          String numeroTorre, Pageable pageable) {
        Specification<Movimento> spec = (root, query, cb) -> {
            List<Predicate> p = new ArrayList<>();
            if (canteiroId != null) p.add(cb.equal(root.get("canteiro").get("id"), canteiroId));
            if (tipoId != null) p.add(cb.equal(root.get("tipoTorre").get("id"), tipoId));
            if (natureza != null) p.add(cb.equal(root.get("natureza"), natureza));
            if (de != null) p.add(cb.greaterThanOrEqualTo(root.get("dataMovimento"), de));
            if (ate != null) p.add(cb.lessThanOrEqualTo(root.get("dataMovimento"), ate));
            if (numeroTorre != null && !numeroTorre.isBlank()) p.add(cb.equal(root.get("numeroTorre"), numeroTorre.trim()));
            return cb.and(p.toArray(Predicate[]::new));
        };
        return movimentos.findAll(spec, pageable).map(Mapeador::movimento);
    }

    // ---------- apoio ----------

    private Canteiro canteiro(Long id, boolean travar) {
        return (travar ? canteiros.travar(id) : canteiros.findById(id))
                .orElseThrow(() -> new RecursoNaoEncontradoException("Canteiro", id));
    }

    private TipoTorre tipo(Long id) {
        return tipos.findById(id).orElseThrow(() -> new RecursoNaoEncontradoException("Tipo de torre", id));
    }

    private static void exigirAtivo(Canteiro c) {
        if (!c.isAtivo()) {
            throw new RegraNegocioException("O canteiro " + c.getNome() + " está inativo.");
        }
    }

    static Componente componente(TipoTorre t, Long componenteId) {
        return t.componente(componenteId).orElseThrow(() ->
                new RegraNegocioException("O componente " + componenteId + " não pertence ao tipo " + t.getCodigo() + "."));
    }

    /** Valida que os componentes são do tipo e soma linhas repetidas. */
    static Map<Long, Integer> consolidar(TipoTorre t, List<ItemRequest> itens) {
        Map<Long, Integer> m = new LinkedHashMap<>();
        for (ItemRequest i : itens) {
            componente(t, i.componenteId());
            m.merge(i.componenteId(), i.quantidade(), Integer::sum);
        }
        if (m.isEmpty()) {
            throw new RegraNegocioException("Informe ao menos um componente.");
        }
        return m;
    }
}
