package dev.fernandohenrique.estoquetorres.dominio;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Tipo de torre e sua composição (lista de materiais de UMA torre completa). */
@Entity
@Table(name = "tipo_torre")
public class TipoTorre {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String codigo;

    private String nome;

    private String funcao;

    @OneToMany(mappedBy = "tipoTorre", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("ordem asc, id asc")
    private List<Componente> componentes = new ArrayList<>();

    protected TipoTorre() {
    }

    public TipoTorre(String codigo, String nome, String funcao) {
        this.codigo = codigo;
        this.nome = nome;
        this.funcao = funcao;
    }

    public void atualizar(String codigo, String nome, String funcao) {
        this.codigo = codigo;
        this.nome = nome;
        this.funcao = funcao;
    }

    public Componente adicionarComponente(String nome, int qtdPorTorre, java.math.BigDecimal pesoKg) {
        Componente c = new Componente(this, nome, qtdPorTorre, pesoKg, componentes.size());
        componentes.add(c);
        return c;
    }

    public void removerComponente(Componente c) {
        componentes.remove(c);
    }

    public Optional<Componente> componente(Long componenteId) {
        return componentes.stream().filter(c -> c.getId() != null && c.getId().equals(componenteId)).findFirst();
    }

    /** componenteId -> quantidade por torre (somente componentes ativos, qtd > 0). */
    public Map<Long, Integer> composicao() {
        Map<Long, Integer> m = new LinkedHashMap<>();
        componentes.forEach(c -> {
            if (c.getQtdPorTorre() > 0) {
                m.put(c.getId(), c.getQtdPorTorre());
            }
        });
        return m;
    }

    public Long getId() { return id; }
    public String getCodigo() { return codigo; }
    public String getNome() { return nome; }
    public String getFuncao() { return funcao; }
    public List<Componente> getComponentes() { return Collections.unmodifiableList(componentes); }
}
