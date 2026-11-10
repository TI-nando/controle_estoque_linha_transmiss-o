package dev.fernandohenrique.estoquetorres.repositorio;

import dev.fernandohenrique.estoquetorres.dominio.Movimento;
import dev.fernandohenrique.estoquetorres.dominio.Natureza;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface MovimentoRepository extends JpaRepository<Movimento, Long>, JpaSpecificationExecutor<Movimento> {

    /** Saldo físico de um canteiro/tipo: [componenteId, soma]. */
    @Query("""
            select i.componente.id, sum(i.quantidade)
              from MovimentoItem i
             where i.movimento.canteiro.id = :canteiroId
               and i.movimento.tipoTorre.id = :tipoId
             group by i.componente.id
            """)
    List<Object[]> saldoPorComponente(@Param("canteiroId") Long canteiroId, @Param("tipoId") Long tipoId);

    /** Saldo físico de toda a obra: [canteiroId, tipoId, componenteId, soma]. */
    @Query("""
            select m.canteiro.id, m.tipoTorre.id, i.componente.id, sum(i.quantidade)
              from MovimentoItem i join i.movimento m
             group by m.canteiro.id, m.tipoTorre.id, i.componente.id
            """)
    List<Object[]> saldoGeral();

    boolean existsByEstornoDeId(Long movimentoId);

    boolean existsByCanteiroId(Long canteiroId);

    boolean existsByTipoTorreId(Long tipoTorreId);

    @Query("select count(i) > 0 from MovimentoItem i where i.componente.id = :componenteId")
    boolean componenteTemMovimento(@Param("componenteId") Long componenteId);

    /** Existe montagem registrada (e não estornada) para este número de torre? */
    @Query("""
            select count(m) > 0 from Movimento m
             where m.natureza = :natureza and m.numeroTorre = :numero
               and not exists (select 1 from Movimento e where e.estornoDe = m)
            """)
    boolean existeMontagemAtiva(@Param("numero") String numeroTorre, @Param("natureza") Natureza natureza);

    @Query("select count(m) from Movimento m where m.natureza = :natureza and not exists (select 1 from Movimento e where e.estornoDe = m)")
    long contarAtivos(@Param("natureza") Natureza natureza);
}
