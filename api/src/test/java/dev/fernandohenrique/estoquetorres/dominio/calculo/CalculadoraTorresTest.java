package dev.fernandohenrique.estoquetorres.dominio.calculo;

import dev.fernandohenrique.estoquetorres.dominio.StatusTransferencia;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CalculadoraTorresTest {

    private static final Map<Long, Integer> BOM = Map.of(1L, 4, 2L, 1, 3L, 0);

    @Test
    void contaTorresCompletasPeloComponenteMaisEscasso() {
        assertThat(CalculadoraTorres.torresCompletas(BOM, Map.of(1L, 9, 2L, 5))).isEqualTo(2);
        assertThat(CalculadoraTorres.torresCompletas(BOM, Map.of(1L, 9))).isZero();
    }

    @Test
    void componenteComQuantidadeZeroNaoLimita() {
        assertThat(CalculadoraTorres.torresCompletas(BOM, Map.of(1L, 4, 2L, 1))).isEqualTo(1);
    }

    @Test
    void saldoNegativoNaoGeraTorre() {
        assertThat(CalculadoraTorres.torresCompletas(BOM, Map.of(1L, -4, 2L, 1))).isZero();
    }

    @Test
    void faltaParaProximaTorre() {
        assertThat(CalculadoraTorres.faltaPara(BOM, Map.of(1L, 5, 2L, 1), 2))
                .containsExactlyInAnyOrder(new CalculadoraTorres.Item(1L, 3), new CalculadoraTorres.Item(2L, 1));
    }

    @Test
    void maquinaDeEstadosDaTransferencia() {
        assertThat(StatusTransferencia.SOLICITADA.podeIrPara(StatusTransferencia.EM_TRANSITO)).isTrue();
        assertThat(StatusTransferencia.SOLICITADA.podeIrPara(StatusTransferencia.CANCELADA)).isTrue();
        assertThat(StatusTransferencia.EM_TRANSITO.podeIrPara(StatusTransferencia.CANCELADA)).isFalse();
        assertThat(StatusTransferencia.RECEBIDA.proximos()).isEmpty();
    }
}
