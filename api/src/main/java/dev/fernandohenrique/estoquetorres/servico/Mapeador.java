package dev.fernandohenrique.estoquetorres.servico;

import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.CanteiroResponse;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.ComponenteResponse;
import dev.fernandohenrique.estoquetorres.api.dto.CadastroDtos.TipoTorreResponse;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.ItemResponse;
import dev.fernandohenrique.estoquetorres.api.dto.MovimentacaoDtos.MovimentoResponse;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.ItemTransferenciaResponse;
import dev.fernandohenrique.estoquetorres.api.dto.TransferenciaDtos.TransferenciaResponse;
import dev.fernandohenrique.estoquetorres.dominio.Canteiro;
import dev.fernandohenrique.estoquetorres.dominio.Componente;
import dev.fernandohenrique.estoquetorres.dominio.Movimento;
import dev.fernandohenrique.estoquetorres.dominio.TipoTorre;
import dev.fernandohenrique.estoquetorres.dominio.Transferencia;
import dev.fernandohenrique.estoquetorres.dominio.calculo.CalculadoraTorres;

import java.math.BigDecimal;
import java.util.List;

/** Converte entidades em DTOs. Deve ser chamado dentro de transação (relacionamentos LAZY). */
final class Mapeador {

    private Mapeador() {
    }

    static CanteiroResponse canteiro(Canteiro c) {
        return new CanteiroResponse(c.getId(), c.getNome(), c.getLocal(), c.getResponsavel(), c.isAtivo(), c.getMetas());
    }

    static TipoTorreResponse tipo(TipoTorre t) {
        List<ComponenteResponse> comps = t.getComponentes().stream()
                .map(c -> new ComponenteResponse(c.getId(), c.getNome(), c.getQtdPorTorre(), c.getPesoKg())).toList();
        return new TipoTorreResponse(t.getId(), t.getCodigo(), t.getNome(), t.getFuncao(), comps, pesoPorTorre(t));
    }

    static BigDecimal pesoPorTorre(TipoTorre t) {
        return t.getComponentes().stream()
                .filter(c -> c.getPesoKg() != null)
                .map(c -> c.getPesoKg().multiply(BigDecimal.valueOf(c.getQtdPorTorre())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    static BigDecimal peso(TipoTorre t, List<CalculadoraTorres.Item> itens) {
        BigDecimal p = BigDecimal.ZERO;
        for (CalculadoraTorres.Item i : itens) {
            BigDecimal unit = t.componente(i.componenteId()).map(Componente::getPesoKg).orElse(null);
            if (unit != null) {
                p = p.add(unit.multiply(BigDecimal.valueOf(i.quantidade())));
            }
        }
        return p;
    }

    static List<ItemResponse> itens(TipoTorre t, List<CalculadoraTorres.Item> itens) {
        return itens.stream().map(i -> new ItemResponse(i.componenteId(), nomeComponente(t, i.componenteId()), i.quantidade())).toList();
    }

    static String nomeComponente(TipoTorre t, Long componenteId) {
        return t.componente(componenteId).map(Componente::getNome).orElse("(componente " + componenteId + ")");
    }

    static MovimentoResponse movimento(Movimento m) {
        List<ItemResponse> itens = m.getItens().stream()
                .map(i -> new ItemResponse(i.getComponente().getId(), i.getComponente().getNome(), i.getQuantidade())).toList();
        return new MovimentoResponse(m.getId(), m.getNatureza().name(), m.getNatureza().descricao(),
                m.getCanteiro().getId(), m.getCanteiro().getNome(), m.getTipoTorre().getId(), m.getTipoTorre().getCodigo(),
                m.getDataMovimento(), m.getCriadoEm(), m.getUsuario(), m.getDocumento(), m.getObservacao(),
                m.getNumeroTorre(), m.getTransferencia() == null ? null : m.getTransferencia().getId(),
                m.getEstornoDe() == null ? null : m.getEstornoDe().getId(), itens);
    }

    static TransferenciaResponse transferencia(Transferencia t) {
        List<ItemTransferenciaResponse> itens = t.getItens().stream()
                .map(i -> new ItemTransferenciaResponse(i.getComponente().getId(), i.getComponente().getNome(), i.getQuantidade(), i.getQuantidadeRecebida()))
                .toList();
        return new TransferenciaResponse(t.getId(), t.getNumero(), t.getStatus().name(),
                t.getOrigem().getId(), t.getOrigem().getNome(), t.getDestino().getId(), t.getDestino().getNome(),
                t.getTipoTorre().getId(), t.getTipoTorre().getCodigo(),
                t.getObservacao(), t.getRomaneio(), t.getVeiculo(), t.getObsRecebimento(),
                t.temDivergencia(), t.isDivergenciaTratada(),
                t.getCriadoEm(), t.getDespachadoEm(), t.getRecebidoEm(), t.getCanceladoEm(), t.getVersao(), itens);
    }
}
