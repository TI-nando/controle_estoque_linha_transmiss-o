package dev.fernandohenrique.estoquetorres.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public final class CadastroDtos {

    private CadastroDtos() {
    }

    public record CanteiroRequest(
            @NotBlank @Size(max = 120) String nome,
            @Size(max = 160) String local,
            @Size(max = 120) String responsavel,
            Boolean ativo,
            /* tipoTorreId -> meta de torres */
            Map<Long, @PositiveOrZero Integer> metas) {
    }

    public record CanteiroResponse(Long id, String nome, String local, String responsavel, boolean ativo,
                                   Map<Long, Integer> metas) {
    }

    public record ComponenteRequest(
            Long id,
            @NotBlank @Size(max = 120) String nome,
            @NotNull @PositiveOrZero Integer qtdPorTorre,
            @PositiveOrZero BigDecimal pesoKg) {
    }

    public record TipoTorreRequest(
            @NotBlank @Size(max = 30) String codigo,
            @Size(max = 120) String nome,
            @Size(max = 120) String funcao,
            @NotEmpty @Valid List<ComponenteRequest> componentes) {
    }

    public record ComponenteResponse(Long id, String nome, int qtdPorTorre, BigDecimal pesoKg) {
    }

    public record TipoTorreResponse(Long id, String codigo, String nome, String funcao,
                                    List<ComponenteResponse> componentes, BigDecimal pesoPorTorreKg) {
    }
}
