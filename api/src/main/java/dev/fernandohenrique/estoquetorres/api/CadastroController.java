package dev.fernandohenrique.estoquetorres.api;

import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.CanteiroRequest;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.CanteiroResponse;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.TipoTorreRequest;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.TipoTorreResponse;
import dev.fernandohenrique.estoquetorres.servico.CadastroService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
@Tag(name = "Cadastros", description = "Canteiros, metas e tipos de torre com sua composição")
public class CadastroController {

    private final CadastroService service;

    public CadastroController(CadastroService service) {
        this.service = service;
    }

    @GetMapping("/canteiros")
    public List<CanteiroResponse> listarCanteiros() {
        return service.listarCanteiros();
    }

    @PostMapping("/canteiros")
    @ResponseStatus(HttpStatus.CREATED)
    public CanteiroResponse criarCanteiro(@Valid @RequestBody CanteiroRequest req) {
        return service.criarCanteiro(req);
    }

    @PutMapping("/canteiros/{id}")
    public CanteiroResponse atualizarCanteiro(@PathVariable Long id, @Valid @RequestBody CanteiroRequest req) {
        return service.atualizarCanteiro(id, req);
    }

    @DeleteMapping("/canteiros/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void excluirCanteiro(@PathVariable Long id) {
        service.excluirCanteiro(id);
    }

    @GetMapping("/tipos-torre")
    public List<TipoTorreResponse> listarTipos() {
        return service.listarTipos();
    }

    @GetMapping("/tipos-torre/{id}")
    public TipoTorreResponse detalharTipo(@PathVariable Long id) {
        return service.detalharTipo(id);
    }

    @PostMapping("/tipos-torre")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Cria um tipo de torre com a composição de uma torre completa")
    public TipoTorreResponse criarTipo(@Valid @RequestBody TipoTorreRequest req) {
        return service.criarTipo(req);
    }

    @PutMapping("/tipos-torre/{id}")
    public TipoTorreResponse atualizarTipo(@PathVariable Long id, @Valid @RequestBody TipoTorreRequest req) {
        return service.atualizarTipo(id, req);
    }

    @DeleteMapping("/tipos-torre/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void excluirTipo(@PathVariable Long id) {
        service.excluirTipo(id);
    }
}
