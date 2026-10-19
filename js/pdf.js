/* JAF Metal — PDFs (texto de verdade, com jsPDF; não é "foto" da tela) */
'use strict';

const PDF = (() => {
  const P = {};
  let logo = null;

  async function carregarLogo() {
    if (logo) return logo;
    const r = await fetch('assets/logo.png');
    const b = await r.blob();
    logo = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); });
    return logo;
  }

  async function novo(orientacao = 'p') {
    await U.lib('jspdf');
    await U.lib('autotable');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: orientacao, unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'normal');
    return doc;
  }

  function cabecalho(doc, titulo, sub) {
    const W = doc.internal.pageSize.getWidth();
    const emp = S.cfg('empresa', {});
    if (logo) doc.addImage(logo, 'PNG', 14, 10, 52, 10.8);
    doc.setFontSize(8.5); doc.setTextColor(90);
    const linhas = [emp.razao || emp.nome || 'JAF Metal', [emp.cnpj ? 'CNPJ ' + emp.cnpj : '', emp.ie ? 'IE ' + emp.ie : ''].filter(Boolean).join(' · '),
      [emp.endereco, emp.cidade && emp.uf ? emp.cidade + '/' + emp.uf : emp.cidade].filter(Boolean).join(' — '),
      [emp.telefone, emp.email].filter(Boolean).join(' · ')].filter(Boolean);
    linhas.forEach((l, i) => doc.text(l, W - 14, 12 + i * 4, { align: 'right' }));
    doc.setDrawColor(63, 102, 161); doc.setLineWidth(0.6); doc.line(14, 26, W - 14, 26);
    doc.setTextColor(20); doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text(titulo, 14, 35);
    doc.setFont('helvetica', 'normal');
    if (sub) { doc.setFontSize(9.5); doc.setTextColor(90); doc.text(sub, 14, 41); }
    return sub ? 46 : 41;
  }

  function rodape(doc) {
    const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140);
      doc.text(`Gerado em ${U.dataHora(new Date().toISOString())} por ${API.sessao?.nome || ''}`, 14, H - 8);
      doc.text(`Página ${i} de ${n}`, W - 14, H - 8, { align: 'right' });
    }
  }

  const estiloTabela = {
    styles: { font: 'helvetica', fontSize: 8.8, cellPadding: 1.8, textColor: 25, lineColor: [210, 216, 224], lineWidth: 0.15 },
    headStyles: { fillColor: [28, 42, 61], textColor: 255, fontStyle: 'bold', fontSize: 8.2 },
    alternateRowStyles: { fillColor: [246, 248, 251] },
    margin: { left: 14, right: 14, bottom: 16 },
  };

  // ---------------------------------------------------------------- pedido de compra
  P.pedido = async (ped) => {
    await carregarLogo().catch(() => null);
    const doc = await novo();
    const f = S.get('fornecedores', ped.fornecedor_id) || {};
    const W = doc.internal.pageSize.getWidth();
    let y = cabecalho(doc, `Pedido de compra nº ${ped.numero}`, `Data: ${U.data(ped.data)}${ped.prazo ? '   ·   Entrega combinada: ' + U.data(ped.prazo) : ''}`);
    doc.setFontSize(9); doc.setTextColor(90); doc.text('FORNECEDOR', 14, y + 2);
    doc.setTextColor(20); doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(f.razao || f.nome || '', 14, y + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const info = [f.razao && f.nome !== f.razao ? f.nome : '', f.cnpj ? 'CNPJ ' + f.cnpj : '', f.contato ? 'Contato: ' + f.contato : '',
      [U.tel(f.telefone), U.tel(f.celular)].filter(Boolean).join(' / '), f.email].filter(Boolean);
    doc.text(doc.splitTextToSize(info.join('   ·   '), W - 28), 14, y + 12);
    y += 20;
    const itens = C.itensDoPedido(ped.id);
    doc.autoTable({
      ...estiloTabela, startY: y,
      head: [['#', 'Código', 'Descrição', 'Qtd', 'Preço unit.', 'Total']],
      body: itens.map((i, n) => { const p = S.get('pecas', i.peca_id) || {};
        return [n + 1, p.codigo || '', p.descricao || '', `${U.qtd(i.qtd)} ${p.unidade || ''}`, U.moeda(i.valor / i.qtd), U.moeda(i.valor)]; }),
      columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 42, font: 'courier' }, 3: { halign: 'right', cellWidth: 18 }, 4: { halign: 'right', cellWidth: 25 }, 5: { halign: 'right', cellWidth: 27 } },
    });
    y = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(10);
    const sub = U.soma(itens, 'valor');
    const lin = [['Subtotal', U.moeda(sub)]];
    if (ped.frete) lin.push(['Frete', U.moeda(ped.frete)]);
    lin.forEach(([k, v]) => { doc.text(k, W - 60, y); doc.text(v, W - 14, y, { align: 'right' }); y += 5; });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text('Total', W - 60, y + 1); doc.text(U.moeda(sub + (Number(ped.frete) || 0)), W - 14, y + 1, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    y += 10;
    const obs = [ped.documento ? 'Referência: ' + ped.documento : '', ped.obs && ped.obs !== 'Importado da planilha' ? 'Observações: ' + ped.obs : ''].filter(Boolean);
    if (obs.length) { doc.text(doc.splitTextToSize(obs.join('\n'), W - 28), 14, y); y += 6 + obs.length * 5; }
    doc.text('Por favor, confirme o recebimento deste pedido e o prazo de entrega. Informe o número do pedido na nota fiscal.', 14, Math.min(y + 4, 260));
    doc.line(W - 84, 278, W - 14, 278); doc.text(API.sessao?.nome || '', W - 49, 283, { align: 'center' });
    rodape(doc);
    return doc.output('blob');
  };

  // ---------------------------------------------------------------- tabela genérica (relatórios, lista de compras)
  // colunas: [{t, w, alinhar:'right', mono}], linhas: [[...]], totais: [...]
  P.tabela = async (titulo, sub, colunas, linhas, opt = {}) => {
    await carregarLogo().catch(() => null);
    const doc = await novo(opt.deitado ? 'l' : 'p');
    let y = cabecalho(doc, titulo, sub);
    const cs = {};
    colunas.forEach((c, i) => { cs[i] = {}; if (c.w) cs[i].cellWidth = c.w; if (c.alinhar) cs[i].halign = c.alinhar; if (c.mono) cs[i].font = 'courier'; });
    if (opt.grupos) {
      for (const g of opt.grupos) {
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20); doc.text(g.titulo, 14, y + 3);
        doc.setFont('helvetica', 'normal');
        doc.autoTable({ ...estiloTabela, startY: y + 5, head: [colunas.map(c => c.t)], body: g.linhas, foot: g.totais ? [g.totais] : undefined,
          footStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: 'bold' }, columnStyles: cs });
        y = doc.lastAutoTable.finalY + 8;
      }
    } else {
      doc.autoTable({ ...estiloTabela, startY: y + 2, head: [colunas.map(c => c.t)], body: linhas, foot: opt.totais ? [opt.totais] : undefined,
        footStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: 'bold' }, columnStyles: cs });
    }
    rodape(doc);
    return doc.output('blob');
  };

  // abre o PDF / compartilha / salva
  P.entregar = async (blob, nome) => {
    try { await U.salvarArquivo(blob, nome); }
    catch (e) {
      if (e.name !== 'NotAllowedError') { UI.erro(e); return; }
      // o aparelho exige um toque novo para compartilhar
      UI.modal({
        titulo: 'Arquivo pronto', corpo: `<p>${UI.ic('ok')} <b>${U.esc(nome)}</b></p><p class="sub">Toque em Compartilhar para mandar por WhatsApp, e-mail ou salvar.</p>`,
        aoAbrir: (el, j) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'btn pri'; b.innerHTML = UI.ic('enviar') + '<span>Compartilhar</span>';
          b.onclick = () => navigator.share({ files: [new File([blob], nome, { type: blob.type })], title: nome }).then(() => j.fechar(true)).catch(() => {});
          el.querySelector('.janela-pe').appendChild(b);
        },
      });
    }
  };

  return P;
})();
