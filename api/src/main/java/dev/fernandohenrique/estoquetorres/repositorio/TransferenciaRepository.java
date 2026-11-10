package dev.fernandohenrique.estoquetorres.repositorio;

import dev.fernandohenrique.estoquetorres.dominio.StatusTransferencia;
import dev.fernandohenrique.estoquetorres.dominio.Transferencia;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface TransferenciaRepository extends JpaRepository<Transferencia, Long> {

    /** Reservado na origem por transferências SOLICITADAS: [componenteId, soma]. */
    @Query("""
            select i.componente.id, sum(i.quantidade)
              from TransferenciaItem i
             where i.transferencia.origem.id = :canteiroId
               and i.transferencia.tipoTorre.id = :tipoId
               and i.transferencia.status = :status
             group by i.componente.id
            """)
    List<Object[]> somaPorOrigem(@Param("canteiroId") Long canteiroId, @Param("tipoId") Long tipoId,
                                 @Param("status") StatusTransferencia status);

    /** [origemId, destinoId, tipoId, componenteId, soma] das transferências no status informado. */
    @Query("""
            select t.origem.id, t.destino.id, t.tipoTorre.id, i.componente.id, sum(i.quantidade)
              from TransferenciaItem i join i.transferencia t
             where t.status = :status
             group by t.origem.id, t.destino.id, t.tipoTorre.id, i.componente.id
            """)
    List<Object[]> somaGeral(@Param("status") StatusTransferencia status);

    List<Transferencia> findByStatusInOrderByCriadoEmDesc(Collection<StatusTransferencia> status);

    List<Transferencia> findAllByOrderByCriadoEmDesc();

    boolean existsByOrigemIdOrDestinoId(Long origemId, Long destinoId);

    boolean existsByTipoTorreId(Long tipoTorreId);

    @Query("""
            select count(t) > 0 from Transferencia t
             where (t.origem.id = :canteiroId or t.destino.id = :canteiroId) and t.status in :status
            """)
    boolean existeAbertaCom(@Param("canteiroId") Long canteiroId, @Param("status") Collection<StatusTransferencia> status);

    boolean existsByNumero(String numero);
}
