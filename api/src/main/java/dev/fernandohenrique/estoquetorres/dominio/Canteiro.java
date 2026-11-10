package dev.fernandohenrique.estoquetorres.dominio;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.Table;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@Entity
@Table(name = "canteiro")
public class Canteiro {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String nome;

    private String local;

    private String responsavel;

    @Column(nullable = false)
    private boolean ativo = true;

    @Column(name = "criado_em", nullable = false)
    private LocalDateTime criadoEm;

    /** tipoTorreId -> número de torres que o canteiro precisa montar. */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "canteiro_meta", joinColumns = @JoinColumn(name = "canteiro_id"))
    @MapKeyColumn(name = "tipo_torre_id")
    @Column(name = "quantidade")
    private Map<Long, Integer> metas = new HashMap<>();

    protected Canteiro() {
    }

    public Canteiro(String nome, String local, String responsavel) {
        this.nome = nome;
        this.local = local;
        this.responsavel = responsavel;
        this.criadoEm = LocalDateTime.now();
    }

    public void atualizar(String nome, String local, String responsavel, boolean ativo) {
        this.nome = nome;
        this.local = local;
        this.responsavel = responsavel;
        this.ativo = ativo;
    }

    public void definirMetas(Map<Long, Integer> novas) {
        metas.clear();
        if (novas != null) {
            novas.forEach((tipo, qtd) -> {
                if (qtd != null && qtd > 0) {
                    metas.put(tipo, qtd);
                }
            });
        }
    }

    public int metaDo(Long tipoTorreId) {
        return metas.getOrDefault(tipoTorreId, 0);
    }

    public Long getId() { return id; }
    public String getNome() { return nome; }
    public String getLocal() { return local; }
    public String getResponsavel() { return responsavel; }
    public boolean isAtivo() { return ativo; }
    public LocalDateTime getCriadoEm() { return criadoEm; }
    public Map<Long, Integer> getMetas() { return Map.copyOf(metas); }
}
