package dev.fernandohenrique.estoquetorres.dominio;

import java.util.EnumSet;
import java.util.Set;

/**
 * Máquina de estados da transferência entre canteiros.
 * <pre>
 * SOLICITADA --despachar--> EM_TRANSITO --receber--> RECEBIDA
 *     \--cancelar--> CANCELADA
 * </pre>
 * SOLICITADA reserva as peças na origem; EM_TRANSITO já saiu da origem e ainda não entrou no destino.
 */
public enum StatusTransferencia {
    SOLICITADA,
    EM_TRANSITO,
    RECEBIDA,
    CANCELADA;

    public Set<StatusTransferencia> proximos() {
        return switch (this) {
            case SOLICITADA -> EnumSet.of(EM_TRANSITO, CANCELADA);
            case EM_TRANSITO -> EnumSet.of(RECEBIDA);
            case RECEBIDA, CANCELADA -> EnumSet.noneOf(StatusTransferencia.class);
        };
    }

    public boolean podeIrPara(StatusTransferencia destino) {
        return proximos().contains(destino);
    }
}
