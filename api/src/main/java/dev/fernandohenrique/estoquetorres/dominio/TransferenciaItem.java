package dev.fernandohenrique.estoquetorres.dominio;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "transferencia_item")
public class TransferenciaItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "transferencia_id")
    private Transferencia transferencia;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "componente_id")
    private Componente componente;

    @Column(nullable = false)
    private int quantidade;

    @Column(name = "quantidade_recebida")
    private Integer quantidadeRecebida;

    protected TransferenciaItem() {
    }

    TransferenciaItem(Transferencia transferencia, Componente componente, int quantidade) {
        this.transferencia = transferencia;
        this.componente = componente;
        this.quantidade = quantidade;
    }

    void registrarRecebido(int recebido) {
        this.quantidadeRecebida = recebido;
    }

    public Long getId() { return id; }
    public Componente getComponente() { return componente; }
    public int getQuantidade() { return quantidade; }
    public Integer getQuantidadeRecebida() { return quantidadeRecebida; }
}
