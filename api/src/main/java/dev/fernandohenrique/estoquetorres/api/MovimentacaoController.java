package dev.fernandohenrique.estoquetorres.api;

import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.EstornoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.InventarioRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.LancamentoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.MontagemRequest;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.MovimentoResponse;
import dev.fernandohenrique.estoquetorres.dominio.Natureza;
import dev.fernandohenrique.estoquetorres.servico.MovimentacaoService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@RestController
@RequestMapping("/api/movimentos")
@Tag(name = "Movimentações", description = "Razão do estoque: nada é apagado, correções por estorno")
public class MovimentacaoController {

    private static final String USUARIO = "X-Usuario";
    private final MovimentacaoService service;

    public MovimentacaoController(MovimentacaoService service) {
        this.service = service;
    }

    @GetMapping
    public Page<MovimentoResponse> listar(@RequestParam(required = false) Long canteiroId,
                                          @RequestParam(required = false) Long tipoTorreId,
                                          @RequestParam(required = false) Natureza natureza,
                                          @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate de,
                                          @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate ate,
                                          @RequestParam(required = false) String numeroTorre,
                                          @PageableDefault(size = 50, sort = {"dataMovimento", "id"}, direction = Sort.Direction.DESC) Pageable pageable) {
        return service.listar(canteiroId, tipoTorreId, natureza, de, ate, numeroTorre, pageable);
    }

    @PostMapping("/entradas")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Recebimento de peças (fabricante, fornecedor)")
    public MovimentoResponse entrada(@Valid @RequestBody LancamentoRequest req, @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.entrada(req, usuario);
    }

    @PostMapping("/saidas")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Baixa de peças (perda, avaria, sucata, devolução). Observação obrigatória")
    public MovimentoResponse saida(@Valid @RequestBody LancamentoRequest req, @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.saida(req, usuario);
    }

    @PostMapping("/montagens")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Registra a montagem de uma torre e baixa toda a composição do canteiro")
    public MovimentoResponse montagem(@Valid @RequestBody MontagemRequest req, @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.montagem(req, usuario);
    }

    @PostMapping("/inventarios")
    @Operation(summary = "Lança a diferença entre a contagem física e o saldo. 204 se tudo conferir")
    public ResponseEntity<MovimentoResponse> inventario(@Valid @RequestBody InventarioRequest req, @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.inventario(req, usuario)
                .map(m -> ResponseEntity.status(HttpStatus.CREATED).body(m))
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/{id}/estorno")
    @ResponseStatus(HttpStatus.CREATED)
    public MovimentoResponse estornar(@PathVariable Long id, @Valid @RequestBody EstornoRequest req,
                                      @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.estornar(id, req.motivo(), usuario);
    }
}
