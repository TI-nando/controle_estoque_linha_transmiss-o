package dev.fernandohenrique.estoquetorres.api;

import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.GerarSolicitacoesRequest;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.LinhaAnalise;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.PainelResponse;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.PosicaoItem;
import dev.fernandohenrique.estoquetorres.api.dto.EstoqueDtos.RemanejamentoResponse;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.TransferenciaResponse;
import dev.fernandohenrique.estoquetorres.servico.EstoqueService;
import dev.fernandohenrique.estoquetorres.servico.RemanejamentoService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
@Tag(name = "Estoque e remanejamento")
public class EstoqueController {

    private final EstoqueService estoque;
    private final RemanejamentoService remanejamento;

    public EstoqueController(EstoqueService estoque, RemanejamentoService remanejamento) {
        this.estoque = estoque;
        this.remanejamento = remanejamento;
    }

    @GetMapping("/painel")
    @Operation(summary = "Indicadores: torres completas, ganho possível com remanejamento, montadas, trânsito, peso")
    public PainelResponse painel() {
        return remanejamento.painel();
    }

    @GetMapping("/estoque")
    @Operation(summary = "Posição de estoque: físico, reservado, disponível e a caminho, por canteiro/tipo/componente")
    public List<PosicaoItem> posicao(@RequestParam(required = false) Long canteiroId,
                                     @RequestParam(required = false) Long tipoTorreId) {
        return estoque.posicaoDetalhada(canteiroId, tipoTorreId);
    }

    @GetMapping("/estoque/torres-completas")
    @Operation(summary = "Torres completas por canteiro e o que falta para a próxima")
    public List<LinhaAnalise> torresCompletas(@RequestParam(required = false) Long tipoTorreId) {
        return estoque.analise(tipoTorreId);
    }

    @GetMapping("/remanejamento")
    @Operation(summary = "Sugere transferências para completar o máximo de torres sem desmontar as completas dos doadores")
    public List<RemanejamentoResponse> sugerir(@RequestParam(required = false) Long tipoTorreId,
                                               @RequestParam(required = false) Long destinoId,
                                               @RequestParam(defaultValue = "true") boolean respeitarMeta) {
        return remanejamento.sugerir(tipoTorreId, destinoId, respeitarMeta);
    }

    @PostMapping("/remanejamento/solicitacoes")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Gera as solicitações de transferência da sugestão atual (tudo ou nada)")
    public List<TransferenciaResponse> gerar(@RequestBody(required = false) GerarSolicitacoesRequest req,
                                             @RequestHeader(value = "X-Usuario", required = false) String usuario) {
        GerarSolicitacoesRequest r = req == null ? new GerarSolicitacoesRequest(null, null, true) : req;
        return remanejamento.gerarSolicitacoes(r.tipoTorreId(), r.destinoId(), r.respeitarMeta() == null || r.respeitarMeta(), usuario);
    }
}
