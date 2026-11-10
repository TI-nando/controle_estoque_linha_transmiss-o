package dev.fernandohenrique.estoquetorres.api;

import dev.fernandohenrique.estoquetorres.dominio.RecursoNaoEncontradoException;
import dev.fernandohenrique.estoquetorres.dominio.RegraNegocioException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;

/** Respostas de erro no formato RFC 7807 (application/problem+json), com a lista "erros". */
@RestControllerAdvice
public class TratadorDeErros {

    @ExceptionHandler(RegraNegocioException.class)
    public ProblemDetail regra(RegraNegocioException e) {
        return problema(HttpStatus.UNPROCESSABLE_ENTITY, "Regra de negócio violada", e.getErros());
    }

    @ExceptionHandler(RecursoNaoEncontradoException.class)
    public ProblemDetail naoEncontrado(RecursoNaoEncontradoException e) {
        return problema(HttpStatus.NOT_FOUND, "Não encontrado", List.of(e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail validacao(MethodArgumentNotValidException e) {
        List<String> erros = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage()).toList();
        return problema(HttpStatus.BAD_REQUEST, "Dados inválidos", erros);
    }

    @ExceptionHandler({ObjectOptimisticLockingFailureException.class, PessimisticLockingFailureException.class})
    public ProblemDetail concorrencia(Exception e) {
        return problema(HttpStatus.CONFLICT, "Alteração simultânea",
                List.of("Outra pessoa alterou este registro ao mesmo tempo. Atualize e tente novamente."));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ProblemDetail integridade(DataIntegrityViolationException e) {
        return problema(HttpStatus.CONFLICT, "Conflito de dados",
                List.of("A operação viola uma restrição do banco (registro duplicado ou já processado)."));
    }

    private static ProblemDetail problema(HttpStatus status, String titulo, List<String> erros) {
        ProblemDetail p = ProblemDetail.forStatusAndDetail(status, String.join("; ", erros));
        p.setTitle(titulo);
        p.setProperty("erros", erros);
        return p;
    }
}
