package dev.fernandohenrique.estoquetorres.api;

import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.DespachoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.RecebimentoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.SolicitacaoRequest;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.TransferenciaResponse;
import dev.fernandohenrique.estoquetorres.dominio.StatusTransferencia;
import dev.fernandohenrique.estoquetorres.servico.TransferenciaService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/transferencias")
@Tag(name = "Transferências", description = "SOLICITADA → EM_TRANSITO → RECEBIDA (ou CANCELADA)")
public class TransferenciaController {

    private static final String USUARIO = "X-Usuario";
    private final TransferenciaService service;

    public TransferenciaController(TransferenciaService service) {
        this.service = service;
    }

    @GetMapping
    public List<TransferenciaResponse> listar(@RequestParam(required = false) List<StatusTransferencia> status) {
        return service.listar(status);
    }

    @GetMapping("/{id}")
    public TransferenciaResponse detalhar(@PathVariable Long id) {
        return service.detalhar(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Solicita transferência; as peças ficam reservadas na origem")
    public TransferenciaResponse solicitar(@Valid @RequestBody SolicitacaoRequest req, @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.solicitar(req, usuario);
    }

    @PostMapping("/{id}/despacho")
    @Operation(summary = "Despacha: as peças saem do saldo da origem e ficam em trânsito")
    public TransferenciaResponse despachar(@PathVariable Long id, @Valid @RequestBody(required = false) DespachoRequest req,
                                           @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.despachar(id, req, usuario);
    }

    @PostMapping("/{id}/recebimento")
    @Operation(summary = "Recebe no destino, com conferência por componente e registro de divergência")
    public TransferenciaResponse receber(@PathVariable Long id, @Valid @RequestBody(required = false) RecebimentoRequest req,
                                         @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.receber(id, req, usuario);
    }

    @PostMapping("/{id}/cancelamento")
    public TransferenciaResponse cancelar(@PathVariable Long id, @RequestHeader(value = USUARIO, required = false) String usuario) {
        return service.cancelar(id, usuario);
    }

    @PostMapping("/{id}/divergencia-tratada")
    public TransferenciaResponse divergenciaTratada(@PathVariable Long id) {
        return service.marcarDivergenciaTratada(id);
    }
}
