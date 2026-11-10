package dev.fernandohenrique.estoquetorres.servico;

import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.CanteiroRequest;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.CanteiroResponse;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.ComponenteRequest;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.TipoTorreRequest;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.TipoTorreResponse;
import dev.fernandohenrique.estoquetorres.dominio.Canteiro;
import dev.fernandohenrique.estoquetorres.dominio.Componente;
import dev.fernandohenrique.estoquetorres.dominio.RecursoNaoEncontradoException;
import dev.fernandohenrique.estoquetorres.dominio.RegraNegocioException;
import dev.fernandohenrique.estoquetorres.dominio.StatusTransferencia;
import dev.fernandohenrique.estoquetorres.dominio.TipoTorre;
import dev.fernandohenrique.estoquetorres.repositorio.CanteiroRepository;
import dev.fernandohenrique.estoquetorres.repositorio.MovimentoRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TipoTorreRepository;
import dev.fernandohenrique.estoquetorres.repositorio.TransferenciaRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Cadastros de canteiros (com metas) e tipos de torre (com composição). */
@Service
@Transactional
public class CadastroService {

    private final CanteiroRepository canteiros;
    private final TipoTorreRepository tipos;
    private final MovimentoRepository movimentos;
    private final TransferenciaRepository transferencias;

    public CadastroService(CanteiroRepository canteiros, TipoTorreRepository tipos,
                           MovimentoRepository movimentos, TransferenciaRepository transferencias) {
        this.canteiros = canteiros;
        this.tipos = tipos;
        this.movimentos = movimentos;
        this.transferencias = transferencias;
    }

    // ===== canteiros =====

    @Transactional(readOnly = true)
    public List<CanteiroResponse> listarCanteiros() {
        return canteiros.findAllByOrderByNomeAsc().stream().map(Mapeador::canteiro).toList();
    }

    public CanteiroResponse criarCanteiro(CanteiroRequest req) {
        String nome = req.nome().trim();
        if (canteiros.existsByNomeIgnoreCase(nome)) {
            throw new RegraNegocioException("Já existe um canteiro chamado " + nome + ".");
        }
        validarMetas(req);
        Canteiro c = new Canteiro(nome, req.local(), req.responsavel());
        c.atualizar(nome, req.local(), req.responsavel(), req.ativo() == null || req.ativo());
        c.definirMetas(req.metas());
        return Mapeador.canteiro(canteiros.save(c));
    }

    public CanteiroResponse atualizarCanteiro(Long id, CanteiroRequest req) {
        Canteiro c = canteiros.findById(id).orElseThrow(() -> new RecursoNaoEncontradoException("Canteiro", id));
        String nome = req.nome().trim();
        if (canteiros.existsByNomeIgnoreCaseAndIdNot(nome, id)) {
            throw new RegraNegocioException("Já existe um canteiro chamado " + nome + ".");
        }
        boolean ativo = req.ativo() == null ? c.isAtivo() : req.ativo();
        if (c.isAtivo() && !ativo && transferencias.existeAbertaCom(id, EnumSet.of(StatusTransferencia.SOLICITADA, StatusTransferencia.EM_TRANSITO))) {
            throw new RegraNegocioException("Há transferências abertas com este canteiro; conclua-as antes de inativar.");
        }
        validarMetas(req);
        c.atualizar(nome, req.local(), req.responsavel(), ativo);
        c.definirMetas(req.metas());
        return Mapeador.canteiro(c);
    }

    public void excluirCanteiro(Long id) {
        Canteiro c = canteiros.findById(id).orElseThrow(() -> new RecursoNaoEncontradoException("Canteiro", id));
        if (movimentos.existsByCanteiroId(id) || transferencias.existsByOrigemIdOrDestinoId(id, id)) {
            throw new RegraNegocioException("O canteiro tem histórico de estoque e não pode ser excluído. Inative-o.");
        }
        canteiros.delete(c);
    }

    private void validarMetas(CanteiroRequest req) {
        if (req.metas() == null) return;
        for (Long tipoId : req.metas().keySet()) {
            if (!tipos.existsById(tipoId)) {
                throw new RegraNegocioException("Meta para tipo de torre inexistente: " + tipoId);
            }
        }
    }

    // ===== tipos de torre =====

    @Transactional(readOnly = true)
    public List<TipoTorreResponse> listarTipos() {
        return tipos.findAllByOrderByCodigoAsc().stream().map(Mapeador::tipo).toList();
    }

    @Transactional(readOnly = true)
    public TipoTorreResponse detalharTipo(Long id) {
        return Mapeador.tipo(tipos.findById(id).orElseThrow(() -> new RecursoNaoEncontradoException("Tipo de torre", id)));
    }

    public TipoTorreResponse criarTipo(TipoTorreRequest req) {
        String codigo = req.codigo().trim();
        if (tipos.existsByCodigoIgnoreCase(codigo)) {
            throw new RegraNegocioException("Já existe um tipo com o código " + codigo + ".");
        }
        validarComposicao(req.componentes());
        TipoTorre t = new TipoTorre(codigo, req.nome(), req.funcao());
        for (ComponenteRequest c : req.componentes()) {
            if (c.id() != null) {
                throw new RegraNegocioException("Na criação, os componentes não devem ter id.");
            }
            t.adicionarComponente(c.nome().trim(), c.qtdPorTorre(), c.pesoKg());
        }
        return Mapeador.tipo(tipos.save(t));
    }

    /**
     * Atualiza o tipo e sua composição. Componentes com id são atualizados, sem id são criados,
     * e os que sumirem da lista são removidos — exceto se tiverem movimentação (aí use qtd 0).
     */
    public TipoTorreResponse atualizarTipo(Long id, TipoTorreRequest req) {
        TipoTorre t = tipos.findById(id).orElseThrow(() -> new RecursoNaoEncontradoException("Tipo de torre", id));
        String codigo = req.codigo().trim();
        if (tipos.existsByCodigoIgnoreCaseAndIdNot(codigo, id)) {
            throw new RegraNegocioException("Já existe um tipo com o código " + codigo + ".");
        }
        validarComposicao(req.componentes());
        t.atualizar(codigo, req.nome(), req.funcao());

        Set<Long> mantidos = new HashSet<>();
        req.componentes().forEach(c -> { if (c.id() != null) mantidos.add(c.id()); });
        for (Componente existente : new ArrayList<>(t.getComponentes())) {
            if (!mantidos.contains(existente.getId())) {
                if (movimentos.componenteTemMovimento(existente.getId())) {
                    throw new RegraNegocioException("O componente " + existente.getNome()
                            + " tem movimentação e não pode ser removido. Coloque 0 em 'quantidade por torre'.");
                }
                t.removerComponente(existente);
            }
        }
        int ordem = 0;
        for (ComponenteRequest c : req.componentes()) {
            if (c.id() == null) {
                t.adicionarComponente(c.nome().trim(), c.qtdPorTorre(), c.pesoKg()).atualizar(c.nome().trim(), c.qtdPorTorre(), c.pesoKg(), ordem);
            } else {
                Componente existente = t.componente(c.id()).orElseThrow(() ->
                        new RegraNegocioException("Componente " + c.id() + " não pertence a este tipo."));
                existente.atualizar(c.nome().trim(), c.qtdPorTorre(), c.pesoKg(), ordem);
            }
            ordem++;
        }
        return Mapeador.tipo(tipos.saveAndFlush(t));
    }

    public void excluirTipo(Long id) {
        TipoTorre t = tipos.findById(id).orElseThrow(() -> new RecursoNaoEncontradoException("Tipo de torre", id));
        if (movimentos.existsByTipoTorreId(id) || transferencias.existsByTipoTorreId(id)) {
            throw new RegraNegocioException("O tipo tem histórico de estoque e não pode ser excluído.");
        }
        tipos.delete(t);
    }

    private static void validarComposicao(List<ComponenteRequest> comps) {
        List<String> erros = new ArrayList<>();
        Set<String> nomes = new HashSet<>();
        for (ComponenteRequest c : comps) {
            if (!nomes.add(c.nome().trim().toLowerCase())) {
                erros.add("Componente repetido: " + c.nome());
            }
        }
        if (comps.stream().noneMatch(c -> c.qtdPorTorre() > 0)) {
            erros.add("A torre precisa de ao menos um componente com quantidade maior que zero.");
        }
        if (!erros.isEmpty()) {
            throw new RegraNegocioException(erros);
        }
    }
}
