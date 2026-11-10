package dev.fernandohenrique.estoquetorres.dominio;

/** Natureza de um lançamento no razão do estoque. O sinal da quantidade vem do item. */
public enum Natureza {
    ENTRADA("Recebimento"),
    SAIDA("Saída / baixa"),
    AJUSTE("Ajuste de inventário"),
    TRANSF_SAIDA("Transferência (envio)"),
    TRANSF_ENTRADA("Transferência (recebimento)"),
    MONTAGEM("Montagem de torre"),
    ESTORNO("Estorno");

    private final String descricao;

    Natureza(String descricao) {
        this.descricao = descricao;
    }

    public String descricao() {
        return descricao;
    }

    /** Lançamentos que o usuário pode estornar diretamente (os de transferência seguem o fluxo próprio). */
    public boolean estornavel() {
        return this == ENTRADA || this == SAIDA || this == AJUSTE || this == MONTAGEM;
    }
}
