package dev.fernandohenrique.estoquetorres.api.dto;

import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.ItemRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public final class TransferenciaDtos {

    private TransferenciaDtos() {
    }

    public record SolicitacaoRequest(
            @NotNull Long origemId,
            @NotNull Long destinoId,
            @NotNull Long tipoTorreId,
            @Size(max = 500) String observacao,
            @NotEmpty @Valid List<ItemRequest> itens) {
    }

    public record DespachoRequest(LocalDate data, @Size(max = 80) String romaneio, @Size(max = 120) String veiculo) {
    }

    /** recebidos: componenteId -> quantidade conferida. Componente ausente = recebeu tudo. */
    public record RecebimentoRequest(LocalDate data, Map<Long, @PositiveOrZero Integer> recebidos,
                                     @Size(max = 500) String observacao) {
    }

    public record ItemTransferenciaResponse(Long componenteId, String componenteNome, int quantidade, Integer quantidadeRecebida) {
    }

    public record TransferenciaResponse(
            Long id, String numero, String status,
            Long origemId, String origemNome, Long destinoId, String destinoNome,
            Long tipoTorreId, String tipoTorreCodigo,
            String observacao, String romaneio, String veiculo, String obsRecebimento,
            boolean divergencia, boolean divergenciaTratada,
            LocalDateTime criadoEm, LocalDateTime despachadoEm, LocalDateTime recebidoEm, LocalDateTime canceladoEm,
            long versao, List<ItemTransferenciaResponse> itens) {
    }
}
