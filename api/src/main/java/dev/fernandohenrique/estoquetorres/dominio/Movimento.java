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

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Lançamento no razão do estoque. O razão é <b>append-only</b>: nada é alterado ou apagado;
 * correções são feitas por estorno. Saldo = soma das quantidades (com sinal) dos itens.
 */
@Entity
@Table(name = "movimento")
public class Movimento {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Natureza natureza;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "canteiro_id")
    private Canteiro canteiro;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tipo_torre_id")
    private TipoTorre tipoTorre;

    @Column(name = "data_movimento", nullable = false)
    private LocalDate dataMovimento;

    @Column(name = "criado_em", nullable = false)
    private LocalDateTime criadoEm;

    private String usuario;
    private String documento;
    private String observacao;

    @Column(name = "numero_torre")
    private String numeroTorre;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "transferencia_id")
    private Transferencia transferencia;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "estorno_de_id")
    private Movimento estornoDe;

    @OneToMany(mappedBy = "movimento", cascade = CascadeType.ALL)
    private List<MovimentoItem> itens = new ArrayList<>();

    protected Movimento() {
    }

    public Movimento(Natureza natureza, Canteiro canteiro, TipoTorre tipoTorre, LocalDate data, String usuario) {
        this.natureza = natureza;
        this.canteiro = canteiro;
        this.tipoTorre = tipoTorre;
        this.dataMovimento = data == null ? LocalDate.now() : data;
        this.usuario = usuario;
        this.criadoEm = LocalDateTime.now();
    }

    /** Quantidade com sinal: positiva entra no canteiro, negativa sai. */
    public Movimento item(Componente componente, int quantidadeComSinal) {
        if (quantidadeComSinal != 0) {
            itens.add(new MovimentoItem(this, componente, quantidadeComSinal));
        }
        return this;
    }

    public Movimento documento(String documento) { this.documento = documento; return this; }
    public Movimento observacao(String observacao) { this.observacao = observacao; return this; }
    public Movimento numeroTorre(String numeroTorre) { this.numeroTorre = numeroTorre; return this; }
    public Movimento transferencia(Transferencia t) { this.transferencia = t; return this; }

    /** Cria o lançamento inverso deste. */
    public Movimento estorno(String usuario, String motivo) {
        if (!natureza.estornavel()) {
            throw new RegraNegocioException("Lançamentos de " + natureza.descricao() + " não podem ser estornados diretamente.");
        }
        Movimento e = new Movimento(Natureza.ESTORNO, canteiro, tipoTorre, LocalDate.now(), usuario);
        e.estornoDe = this;
        e.documento = documento;
        e.numeroTorre = null;
        e.observacao = "Estorno de " + natureza.descricao() + (numeroTorre != null ? " (torre " + numeroTorre + ")" : "") + ": " + motivo;
        itens.forEach(i -> e.item(i.getComponente(), -i.getQuantidade()));
        return e;
    }

    public Long getId() { return id; }
    public Natureza getNatureza() { return natureza; }
    public Canteiro getCanteiro() { return canteiro; }
    public TipoTorre getTipoTorre() { return tipoTorre; }
    public LocalDate getDataMovimento() { return dataMovimento; }
    public LocalDateTime getCriadoEm() { return criadoEm; }
    public String getUsuario() { return usuario; }
    public String getDocumento() { return documento; }
    public String getObservacao() { return observacao; }
    public String getNumeroTorre() { return numeroTorre; }
    public Transferencia getTransferencia() { return transferencia; }
    public Movimento getEstornoDe() { return estornoDe; }
    public List<MovimentoItem> getItens() { return Collections.unmodifiableList(itens); }
}
