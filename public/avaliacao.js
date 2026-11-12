/* Pesquisa rápida com a equipe da JAF (página pública, sem login).
 * Só grava a resposta pela função enviar_avaliacao do banco; não lê nada.
 * A chave abaixo é a "publishable" (pública por natureza), a mesma do aplicativo. */
(function () {
  'use strict';
  var URL_RPC = 'https://chsfffwivmhjrftvylbl.supabase.co/rest/v1/rpc/enviar_avaliacao';
  var CHAVE = 'sb_publishable_FRZXelaTsURBe6CMI6y1HQ_rB7dpQKp';
  var SETORES = [
    ['pcp', 'PCP', 'emitir OF, acompanhar as entregas e montar o romaneio'],
    ['comercial', 'Comercial', 'lançar pedidos de clientes e comprar matéria-prima'],
    ['rh', 'RH', 'cadastrar pessoas, lançar o ponto e ver férias e banco de horas'],
    ['almoxarifado', 'Almoxarifado', 'dar entrada e saída de peças e saber o que comprar'],
    ['producao', 'Produção', 'ver e apontar as OFs e o passo a passo da peça'],
    ['financeiro', 'Financeiro / Escritório', 'lançar contas e acompanhar o fluxo de caixa'],
    ['engenharia', 'Engenharia / Qualidade', 'cadastrar produtos e fazer os registros técnicos'],
    ['manutencao', 'Manutenção', 'abrir OS e acompanhar a preventiva das máquinas'],
    ['direcao', 'Direção', 'acompanhar a empresa pelos relatórios e indicadores'],
    ['outro', 'Outro', 'fazer as tarefas do seu dia a dia']
  ];
  var resp = {};
  var $ = function (id) { return document.getElementById(id); };

  function marcar(grupo, botao) {
    grupo.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-checked', b === botao ? 'true' : 'false'); });
  }
  function grupoEscolha(grupo, chave, aoEscolher) {
    grupo.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', function () {
        resp[chave] = b.dataset.v; marcar(grupo, b);
        var bl = grupo.closest('.bloco'); if (bl) bl.classList.remove('falta');
        if (aoEscolher) aoEscolher(b.dataset.v);
      });
    });
  }

  var setores = $('setores');
  SETORES.forEach(function (s) {
    var b = document.createElement('button'); b.type = 'button'; b.dataset.v = s[0]; b.textContent = s[1]; setores.appendChild(b);
  });
  grupoEscolha(setores, 'setor', function (v) {
    var s = SETORES.find(function (x) { return x[0] === v; });
    $('tarefa').textContent = s ? s[2] : SETORES[SETORES.length - 1][2];
  });

  document.querySelectorAll('.bloco[data-q]').forEach(function (bl) {
    var q = bl.dataset.q, grupo = bl.querySelector('.nota') || bl.querySelector('.chips');
    if (grupo.classList.contains('nota')) {
      for (var i = 0; i <= 10; i++) {
        var b = document.createElement('button'); b.type = 'button'; b.dataset.v = String(i); b.textContent = String(i);
        b.setAttribute('aria-label', 'Nota ' + i); grupo.appendChild(b);
      }
    }
    grupoEscolha(grupo, q);
  });

  var form = $('form'), aviso = $('aviso'), enviar = $('enviar');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var faltam = [];
    if (!resp.setor) faltam.push(setores.closest('.bloco'));
    ['melhorou', 'tarefa', 'tempo', 'futuro'].forEach(function (q) { if (resp[q] == null) faltam.push(document.querySelector('.bloco[data-q="' + q + '"]')); });
    faltam.forEach(function (bl) { bl.classList.add('falta'); });
    if (faltam.length) {
      aviso.textContent = faltam.length === 1 ? 'Falta responder 1 pergunta (marcada em vermelho).' : 'Faltam ' + faltam.length + ' respostas (marcadas em vermelho).';
      aviso.hidden = false; faltam[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    aviso.hidden = true; enviar.disabled = true; enviar.textContent = 'Enviando…';
    var corpo = { p: {
      setor: resp.setor, melhorou: +resp.melhorou, tarefa: +resp.tarefa,
      tempo: resp.tempo, futuro: +resp.futuro, comentario: $('comentario').value.trim()
    } };
    fetch(URL_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CHAVE }, body: JSON.stringify(corpo) })
      .then(function (r) {
        if (r.ok) return;
        return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j && j.message ? j.message : 'Não foi possível enviar.'); });
      })
      .then(function () {
        try { localStorage.setItem('jaf.pesquisa.ok', 'true'); } catch (e) { /* modo privado */ }
        form.hidden = true; $('fim').hidden = false; window.scrollTo(0, 0);
      })
      .catch(function (err) {
        var m = String(err && err.message || '');
        aviso.textContent = /Failed to fetch|NetworkError|Load failed/i.test(m) ? 'Sem internet. Confira a conexão e toque em Enviar de novo.' : m;
        aviso.hidden = false;
      })
      .finally(function () { enviar.disabled = false; enviar.textContent = 'Enviar respostas'; });
  });

  $('outra').addEventListener('click', function () {
    resp = {}; form.reset();
    document.querySelectorAll('[aria-checked="true"]').forEach(function (b) { b.setAttribute('aria-checked', 'false'); });
    $('tarefa').textContent = SETORES[SETORES.length - 1][2];
    $('fim').hidden = true; form.hidden = false; window.scrollTo(0, 0);
  });
})();
