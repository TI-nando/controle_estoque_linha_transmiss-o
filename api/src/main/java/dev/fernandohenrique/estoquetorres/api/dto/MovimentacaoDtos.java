package dev.fernandohenrique.estoquetorres.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public final class MovimentacaoDtos {

    private MovimentacaoDtos() {
    }

    public record ItemRequest(@NotNull Long componenteId, @NotNull @Positive Integer quantidade) {
    }

    /** Entrada (recebimento do fabricante) ou saída/baixa (perda, sucata, devolução). */
    public record LancamentoRequest(
            @NotNull Long canteiroId,
            @NotNull Long tipoTorreId,
            LocalDate data,
            @Size(max = 120) String documento,
            @Size(max = 500) String observacao,
            @NotEmpty @Valid List<ItemRequest> itens) {
    }

    public record MontagemRequest(
            @NotNull Long canteiroId,
            @NotNull Long tipoTorreId,
            @NotBlank @Size(max = 40) String numeroTorre,
            LocalDate data,
            @Size(max = 500) String observacao) {
    }

    public record ContagemRequest(@NotNull Long componenteId, @NotNull @PositiveOrZero Integer quantidadeContada) {
    }

    public record InventarioRequest(
            @NotNull Long canteiroId,
            @NotNull Long tipoTorreId,
            LocalDate data,
            @NotBlank @Size(max = 500) String justificativa,
            @NotEmpty @Valid List<ContagemRequest> contagens) {
    }

    public record EstornoRequest(@NotBlank @Size(max = 300) String motivo) {
    }

    public record ItemResponse(Long componenteId, String componenteNome, int quantidade) {
    }

    public record MovimentoResponse(
            Long id, String natureza, String naturezaDescricao,
            Long canteiroId, String canteiroNome, Long tipoTorreId, String tipoTorreCodigo,
            LocalDate data, LocalDateTime criadoEm, String usuario, String documento, String observacao,
            String numeroTorre, Long transferenciaId, Long estornoDeId, List<ItemResponse> itens) {
    }
}
