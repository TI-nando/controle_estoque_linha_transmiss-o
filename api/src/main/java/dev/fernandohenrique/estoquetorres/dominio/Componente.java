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

import java.math.BigDecimal;

/** Componente de um tipo de torre (pé, extensão, corpo, cabeça...). */
@Entity
@Table(name = "componente")
public class Componente {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tipo_torre_id")
    private TipoTorre tipoTorre;

    @Column(nullable = false)
    private String nome;

    /** 0 = componente fora de uso (preserva o histórico). */
    @Column(name = "qtd_por_torre", nullable = false)
    private int qtdPorTorre;

    @Column(name = "peso_kg")
    private BigDecimal pesoKg;

    @Column(nullable = false)
    private int ordem;

    protected Componente() {
    }

    Componente(TipoTorre tipoTorre, String nome, int qtdPorTorre, BigDecimal pesoKg, int ordem) {
        this.tipoTorre = tipoTorre;
        this.nome = nome;
        this.qtdPorTorre = qtdPorTorre;
        this.pesoKg = pesoKg;
        this.ordem = ordem;
    }

    public void atualizar(String nome, int qtdPorTorre, BigDecimal pesoKg, int ordem) {
        this.nome = nome;
        this.qtdPorTorre = qtdPorTorre;
        this.pesoKg = pesoKg;
        this.ordem = ordem;
    }

    public Long getId() { return id; }
    public TipoTorre getTipoTorre() { return tipoTorre; }
    public String getNome() { return nome; }
    public int getQtdPorTorre() { return qtdPorTorre; }
    public BigDecimal getPesoKg() { return pesoKg; }
    public int getOrdem() { return ordem; }
}
