package dev.fernandohenrique.estoquetorres.dominio;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Remanejamento de componentes de um canteiro para outro. */
@Entity
@Table(name = "transferencia")
public class Transferencia {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String numero;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "origem_id")
    private Canteiro origem;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "destino_id")
    private Canteiro destino;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tipo_torre_id")
    private TipoTorre tipoTorre;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private StatusTransferencia status;

    private String observacao;
    private String romaneio;
    private String veiculo;

    @Column(name = "obs_recebimento")
    private String obsRecebimento;

    @Column(name = "divergencia_tratada", nullable = false)
    private boolean divergenciaTratada;

    @Column(name = "criado_em", nullable = false)
    private LocalDateTime criadoEm;
    @Column(name = "criado_por")
    private String criadoPor;
    @Column(name = "despachado_em")
    private LocalDateTime despachadoEm;
    @Column(name = "despachado_por")
    private String despachadoPor;
    @Column(name = "recebido_em")
    private LocalDateTime recebidoEm;
    @Column(name = "recebido_por")
    private String recebidoPor;
    @Column(name = "cancelado_em")
    private LocalDateTime canceladoEm;
    @Column(name = "cancelado_por")
    private String canceladoPor;

    /** Bloqueio otimista: duas pessoas não mudam o status ao mesmo tempo. */
    @Version
    private long versao;

    @OneToMany(mappedBy = "transferencia", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<TransferenciaItem> itens = new ArrayList<>();

    protected Transferencia() {
    }

    public Transferencia(String numero, Canteiro origem, Canteiro destino, TipoTorre tipoTorre, String observacao, String usuario) {
        if (origem.getId().equals(destino.getId())) {
            throw new RegraNegocioException("Origem e destino precisam ser diferentes.");
        }
        if (!origem.isAtivo() || !destino.isAtivo()) {
            throw new RegraNegocioException("Origem e destino precisam ser canteiros ativos.");
        }
        this.numero = numero;
        this.origem = origem;
        this.destino = destino;
        this.tipoTorre = tipoTorre;
        this.observacao = observacao;
        this.status = StatusTransferencia.SOLICITADA;
        this.criadoEm = LocalDateTime.now();
        this.criadoPor = usuario;
    }

    public void adicionarItem(Componente componente, int quantidade) {
        if (quantidade <= 0) {
            throw new RegraNegocioException(componente.getNome() + ": quantidade deve ser maior que zero.");
        }
        itens.add(new TransferenciaItem(this, componente, quantidade));
    }

    private void mudarPara(StatusTransferencia novo) {
        if (!status.podeIrPara(novo)) {
            throw new RegraNegocioException("Transferência " + numero + " está " + status + " e não pode ir para " + novo + ".");
        }
        status = novo;
    }

    public void despachar(String usuario, String romaneio, String veiculo) {
        mudarPara(StatusTransferencia.EM_TRANSITO);
        this.despachadoEm = LocalDateTime.now();
        this.despachadoPor = usuario;
        this.romaneio = romaneio;
        this.veiculo = veiculo;
    }

    /**
     * @param recebidos componenteId -> quantidade conferida no destino (ausente = recebeu tudo)
     */
    public void receber(String usuario, Map<Long, Integer> recebidos, String obs) {
        List<String> erros = new ArrayList<>();
        boolean divergencia = false;
        for (TransferenciaItem i : itens) {
            int r = recebidos == null ? i.getQuantidade() : recebidos.getOrDefault(i.getComponente().getId(), i.getQuantidade());
            if (r < 0) {
                erros.add(i.getComponente().getNome() + ": quantidade recebida inválida.");
            } else if (r > i.getQuantidade()) {
                erros.add(i.getComponente().getNome() + ": recebido (" + r + ") maior que o enviado (" + i.getQuantidade() + "). Lance a sobra como entrada.");
            }
            divergencia |= r < i.getQuantidade();
        }
        if (divergencia && (obs == null || obs.isBlank())) {
            erros.add("Explique a divergência na observação do recebimento.");
        }
        if (!erros.isEmpty()) {
            throw new RegraNegocioException(erros);
        }
        mudarPara(StatusTransferencia.RECEBIDA);
        itens.forEach(i -> i.registrarRecebido(recebidos == null ? i.getQuantidade()
                : recebidos.getOrDefault(i.getComponente().getId(), i.getQuantidade())));
        this.recebidoEm = LocalDateTime.now();
        this.recebidoPor = usuario;
        this.obsRecebimento = obs;
    }

    public void cancelar(String usuario) {
        mudarPara(StatusTransferencia.CANCELADA);
        this.canceladoEm = LocalDateTime.now();
        this.canceladoPor = usuario;
    }

    public void marcarDivergenciaTratada() {
        if (!temDivergencia()) {
            throw new RegraNegocioException("Esta transferência não tem divergência.");
        }
        this.divergenciaTratada = true;
    }

    public boolean temDivergencia() {
        return itens.stream().anyMatch(i -> i.getQuantidadeRecebida() != null && i.getQuantidadeRecebida() < i.getQuantidade());
    }

    public Long getId() { return id; }
    public String getNumero() { return numero; }
    public Canteiro getOrigem() { return origem; }
    public Canteiro getDestino() { return destino; }
    public TipoTorre getTipoTorre() { return tipoTorre; }
    public StatusTransferencia getStatus() { return status; }
    public String getObservacao() { return observacao; }
    public String getRomaneio() { return romaneio; }
    public String getVeiculo() { return veiculo; }
    public String getObsRecebimento() { return obsRecebimento; }
    public boolean isDivergenciaTratada() { return divergenciaTratada; }
    public LocalDateTime getCriadoEm() { return criadoEm; }
    public String getCriadoPor() { return criadoPor; }
    public LocalDateTime getDespachadoEm() { return despachadoEm; }
    public LocalDateTime getRecebidoEm() { return recebidoEm; }
    public LocalDateTime getCanceladoEm() { return canceladoEm; }
    public long getVersao() { return versao; }
    public List<TransferenciaItem> getItens() { return Collections.unmodifiableList(itens); }
}
