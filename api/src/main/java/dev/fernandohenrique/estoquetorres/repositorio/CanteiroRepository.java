package dev.fernandohenrique.estoquetorres.repositorio;

import dev.fernandohenrique.estoquetorres.dominio.Canteiro;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface CanteiroRepository extends JpaRepository<Canteiro, Long> {

    /**
     * Trava a linha do canteiro (SELECT ... FOR UPDATE) até o fim da transação.
     * Toda operação que tira peças de um canteiro passa por aqui, então duas pessoas
     * não conseguem consumir o mesmo saldo ao mesmo tempo.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Canteiro c where c.id = :id")
    Optional<Canteiro> travar(@Param("id") Long id);

    boolean existsByNomeIgnoreCase(String nome);

    boolean existsByNomeIgnoreCaseAndIdNot(String nome, Long id);

    List<Canteiro> findAllByOrderByNomeAsc();

    List<Canteiro> findByAtivoTrueOrderByNomeAsc();
}
