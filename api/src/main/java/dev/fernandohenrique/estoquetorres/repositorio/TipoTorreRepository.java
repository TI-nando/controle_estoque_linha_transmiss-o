package dev.fernandohenrique.estoquetorres.repositorio;

import dev.fernandohenrique.estoquetorres.dominio.TipoTorre;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TipoTorreRepository extends JpaRepository<TipoTorre, Long> {

    @EntityGraph(attributePaths = "componentes")
    List<TipoTorre> findAllByOrderByCodigoAsc();

    boolean existsByCodigoIgnoreCase(String codigo);

    boolean existsByCodigoIgnoreCaseAndIdNot(String codigo, Long id);
}
