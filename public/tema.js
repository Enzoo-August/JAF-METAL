// tema antes de desenhar (evita "piscar" claro no modo escuro). Arquivo separado: a regra de segurança do site não aceita código solto na página.
try { var t = localStorage.getItem('jaf.tema') || 'auto';
  document.documentElement.dataset.tema = (t === 'escuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)) ? 'escuro' : 'claro'; } catch (e) {}
