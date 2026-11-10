package dev.fernandohenrique.estoquetorres.dominio;

import java.util.List;

/** Violação de regra de negócio (ex.: saldo insuficiente). Mapeada para HTTP 422. */
public class RegraNegocioException extends RuntimeException {

    private final List<String> erros;

    public RegraNegocioException(String erro) {
        this(List.of(erro));
    }

    public RegraNegocioException(List<String> erros) {
        super(String.join("; ", erros));
        this.erros = List.copyOf(erros);
    }

    public List<String> getErros() {
        return erros;
    }
}
