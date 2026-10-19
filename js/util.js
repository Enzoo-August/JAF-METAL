/* JAF Metal — utilidades (formatação, datas, busca) */
'use strict';

const U = (() => {
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfQ = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

  const U = {};

  // ---------- texto / HTML
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.sem = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  U.limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  U.cap = (s) => { s = String(s ?? ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  U.plural = (n, um, varios) => `${U.qtd(n)} ${Math.abs(n) === 1 ? um : (varios || um + 's')}`;

  // ---------- números
  U.num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let t = String(v).trim().replace(/[R$\s]/g, '');
    if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return isFinite(n) ? n : null;
  };
  U.r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  U.r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
  // espaço que não quebra entre "R$" e o número
  U.moeda = (n) => (n === null || n === undefined || n === '') ? '—' : 'R$ ' + nf2.format(Number(n) || 0);
  U.moeda0 = (n) => 'R$ ' + nf0.format(Math.round(Number(n) || 0));
  U.dec = (n) => nf2.format(Number(n) || 0);
  U.qtd = (n) => nfQ.format(Number(n) || 0);
  U.pct = (n) => nf0.format(Math.round((Number(n) || 0) * 100)) + '%';
  // valor para pôr dentro de um <input> (sem separador de milhar)
  U.campoNum = (n, casas = 2) => (n === null || n === undefined || n === '') ? '' : String(Number(Number(n).toFixed(casas))).replace('.', ',');

  // ---------- datas (sempre no fuso de São Paulo)
  U.hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  U.agoraSP = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  U.d = (iso) => { if (!iso) return null; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  U.iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  U.somaDias = (iso, n) => { const d = U.d(iso); d.setDate(d.getDate() + n); return U.iso(d); };
  U.somaMeses = (iso, n) => { const d = U.d(iso); const dia = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n);
    const ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(dia, ult)); return U.iso(d); };
  U.dias = (a, b) => Math.round((U.d(b) - U.d(a)) / 86400000);   // b − a em dias
  U.data = (iso) => { if (!iso) return '—'; const s = String(iso).slice(0, 10).split('-'); return `${s[2]}/${s[1]}/${s[0]}`; };
  U.dataCurta = (iso) => { if (!iso) return '—'; const s = String(iso).slice(0, 10).split('-'); return `${s[2]}/${s[1]}/${s[0].slice(2)}`; };
  U.dataHora = (ts) => { if (!ts) return '—'; const d = new Date(ts);
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  U.mes = (iso) => { const d = U.d(iso); return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').replace(' de ', '/'); };
  U.nomeMes = (m) => ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][m - 1];
  U.relativo = (iso) => {
    if (!iso) return '';
    const n = U.dias(U.hoje(), iso);
    if (n === 0) return 'hoje';
    if (n === 1) return 'amanhã';
    if (n === -1) return 'ontem';
    if (n > 1 && n < 7) return `em ${n} dias`;
    if (n < -1 && n > -7) return `há ${-n} dias`;
    return U.data(iso);
  };

  // ---------- ids
  U.uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  // ---------- busca por relevância (palavras em qualquer ordem)
  // campos: função que devolve [texto principal, ...outros]; código exato/igual ganha
  U.buscar = (lista, termo, campos, limite = 0) => {
    const t = U.sem(U.limpa(termo));
    if (!t) return limite ? lista.slice(0, limite) : lista.slice();
    const palavras = t.split(' ');
    const tj = t.replace(/[\s.\-/]/g, '');
    const res = [];
    for (const item of lista) {
      const cs = campos(item).map(c => U.sem(c));
      const tudo = cs.join(' ');
      if (!palavras.every(p => tudo.includes(p))) {
        // código digitado sem espaço/ponto: "dnmg150604" acha "DNMG 150604"
        if (!(tj.length >= 3 && cs[0].replace(/[\s.\-/]/g, '').includes(tj))) continue;
      }
      const c0 = cs[0], c0j = c0.replace(/[\s.\-/]/g, '');
      let s = 0;
      if (c0 === t || c0j === tj) s = 1000;
      else if (c0.startsWith(t) || c0j.startsWith(tj)) s = 500;
      else if (c0.split(/[\s(/]/).some(w => w.startsWith(palavras[0]))) s = 200;
      else if (cs.slice(1).some(c => c.startsWith(t))) s = 150;
      else if (c0.includes(t)) s = 100;
      s -= c0.length / 1000;
      res.push([s, item]);
    }
    res.sort((a, b) => b[0] - a[0]);
    const out = res.map(r => r[1]);
    return limite ? out.slice(0, limite) : out;
  };

  // ---------- diversos
  U.debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.agrupar = (lista, chave) => { const m = new Map(); for (const x of lista) { const k = typeof chave === 'function' ? chave(x) : x[chave]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  U.soma = (lista, f) => lista.reduce((s, x) => s + (Number(typeof f === 'function' ? f(x) : x[f]) || 0), 0);
  U.porId = (lista) => { const m = new Map(); for (const x of lista) m.set(x.id, x); return m; };
  U.ordenar = (lista, f, desc) => lista.slice().sort((a, b) => { const x = f(a), y = f(b); const r = x < y ? -1 : x > y ? 1 : 0; return desc ? -r : r; });
  U.tel = (t) => String(t || '').replace(/\(0xx(\d\d)\)/i, '($1)').trim();
  U.telZap = (t) => { let d = String(t || '').replace(/^\(0xx/i, '(').replace(/\D/g, ''); if (!d) return ''; if (d.length <= 11) d = '55' + d; return d; };
  U.ehCelular = (t) => { const d = String(t || '').replace(/^\(0xx/i, '(').replace(/\D/g, ''); return /^\d{2}9\d{8}$/.test(d); };
  U.site = (s) => { s = String(s || '').trim(); if (!s) return ''; if (/^mailto:/i.test(s)) return ''; return /^https?:\/\//i.test(s) ? s : 'https://' + s; };
  U.copiar = async (texto) => { try { await navigator.clipboard.writeText(texto); return true; } catch (e) {
    const t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} t.remove(); return ok; } };
  U.carregarScript = (src) => new Promise((ok, falha) => {
    if (document.querySelector(`script[src="${src}"]`)) { const s = document.querySelector(`script[src="${src}"]`); if (s.dataset.ok) return ok(); s.addEventListener('load', ok); s.addEventListener('error', falha); return; }
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => { s.dataset.ok = '1'; ok(); }; s.onerror = () => falha(new Error('Não deu para carregar ' + src.split('/').pop() + '. Confira a internet.'));
    document.head.appendChild(s);
  });
  U.libs = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    chart: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  };
  U.lib = async (...nomes) => { for (const n of nomes) await U.carregarScript(U.libs[n]); };

  // salva um arquivo: no celular abre o "compartilhar"; no computador, "Salvar como" quando dá
  U.salvarArquivo = async (blob, nome) => {
    const arq = new File([blob], nome, { type: blob.type });
    const celular = matchMedia('(pointer: coarse)').matches;
    if (celular && navigator.canShare && navigator.canShare({ files: [arq] })) {
      // no iPhone o "compartilhar" só vale logo depois do toque; se demorou, quem chamou mostra um botão novo
      try { await navigator.share({ files: [arq], title: nome }); return true; } catch (e) { if (e.name === 'AbortError') return false; throw e; }
    }
    if (window.showSaveFilePicker && !celular) {
      try {
        const ext = nome.split('.').pop();
        const h = await window.showSaveFilePicker({ suggestedName: nome, id: 'jaf-' + ext,
          types: [{ description: ext.toUpperCase(), accept: { [blob.type || 'application/octet-stream']: ['.' + ext] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close(); return true;
      } catch (e) { if (e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  };

  return U;
})();
