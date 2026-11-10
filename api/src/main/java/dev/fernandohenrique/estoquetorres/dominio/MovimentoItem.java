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
@Table(name = "movimento_item")
public class MovimentoItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "movimento_id")
    private Movimento movimento;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "componente_id")
    private Componente componente;

    /** Com sinal: + entra, - sai. */
    @Column(nullable = false)
    private int quantidade;

    protected MovimentoItem() {
    }

    MovimentoItem(Movimento movimento, Componente componente, int quantidade) {
        this.movimento = movimento;
        this.componente = componente;
        this.quantidade = quantidade;
    }

    public Long getId() { return id; }
    public Movimento getMovimento() { return movimento; }
    public Componente getComponente() { return componente; }
    public int getQuantidade() { return quantidade; }
}
