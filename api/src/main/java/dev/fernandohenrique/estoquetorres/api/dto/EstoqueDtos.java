package dev.fernandohenrique.estoquetorres.api.dto;

import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.ItemResponse;

import java.math.BigDecimal;
import java.util.List;

public final class EstoqueDtos {

    private EstoqueDtos() {
    }

    /** fisico = no pátio; reservado = em transferência solicitada; disponivel = fisico - reservado. */
    public record PosicaoItem(Long canteiroId, String canteiroNome, Long tipoTorreId, String tipoTorreCodigo,
                              Long componenteId, String componenteNome, int qtdPorTorre,
                              int fisico, int reservado, int disponivel, int aCaminho) {
    }

    public record LinhaAnalise(Long canteiroId, String canteiroNome, Long tipoTorreId, String tipoTorreCodigo,
                               int meta, int torresCompletas, int torresCompletasComTransito,
                               List<ItemResponse> faltaParaProximaTorre) {
    }

    public record ResumoTipo(Long tipoTorreId, String codigo, int hoje, int aposRemanejar, int maximoTeorico) {
    }

    public record PainelResponse(int torresCompletas, long torresMontadas, long transferenciasAbertas,
                                 long transferenciasEmTransito, BigDecimal pesoEstoqueKg, List<ResumoTipo> porTipo) {
    }

    public record TransferenciaSugerida(Long origemId, String origemNome, Long destinoId, String destinoNome,
                                        List<ItemResponse> itens, BigDecimal pesoKg) {
    }

    public record GanhoCanteiro(Long canteiroId, String canteiroNome, int antes, int depois) {
    }

    public record RemanejamentoResponse(Long tipoTorreId, String tipoTorreCodigo, int torresAntes, int torresDepois,
                                        int maximoTeorico, List<TransferenciaSugerida> transferencias,
                                        List<GanhoCanteiro> ganhos) {
    }

    public record GerarSolicitacoesRequest(Long tipoTorreId, Long destinoId, Boolean respeitarMeta) {
    }
}
