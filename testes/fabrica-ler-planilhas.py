"""Lê as planilhas da fábrica (PCP, Controle de Pedidos, Departamento Técnico, Manutenção e Preventiva)
e monta a carga para Administração → Importar planilha → "Importar as planilhas da fábrica".

uso:  python -I testes/fabrica-ler-planilhas.py "<pasta com as planilhas>" "<arquivo de saída .json>"

Nada de dado real fica no repositório: este script só conhece os NOMES DAS COLUNAS das planilhas.
A carga e o relatório de conferência são gravados fora do repositório (na pasta indicada)."""
import sys, os, re, json, glob, datetime, difflib, unicodedata, warnings, collections
warnings.filterwarnings('ignore')
import openpyxl

PASTA, SAIDA = sys.argv[1], sys.argv[2]
avisos = []
def avisar(txt): avisos.append(txt)

def achar(padrao):
    l = [p for p in glob.glob(os.path.join(PASTA, '*')) if re.search(padrao, os.path.basename(p), re.I) and not os.path.basename(p).startswith('~$')]
    if not l: sys.exit(f'Arquivo não encontrado: {padrao}')
    return sorted(l, key=os.path.getmtime)[-1]

def abrir(padrao):
    p = achar(padrao)
    print('lendo', os.path.basename(p))
    return openpyxl.load_workbook(p, data_only=True, read_only=False)

# ---------------------------------------------------------------- limpeza
def txt(v):
    if v is None: return None
    if isinstance(v, float) and v.is_integer(): v = int(v)
    if isinstance(v, (datetime.datetime, datetime.date)): return v.strftime('%d/%m/%Y')
    s = re.sub(r'\s+', ' ', str(v)).strip()
    if s in ('', '-', '--', '---', '#N/A', '0x', 'None'): return None
    return s

def num(v):
    if v is None or isinstance(v, (datetime.datetime, datetime.time)): return None
    if isinstance(v, bool): return None
    if isinstance(v, (int, float)): return round(float(v), 6)
    s = str(v).strip().lower().replace('kg', '').replace('pçs', '').replace('pç', '').replace('r$', '').strip()
    if not s or s in ('-', '#n/a'): return None
    if ',' in s: s = s.replace('.', '').replace(',', '.')
    try: return round(float(s), 6)
    except ValueError: return None

def data(v, onde=''):
    d = None
    if isinstance(v, datetime.datetime): d = v.date()
    elif isinstance(v, datetime.date): d = v
    elif isinstance(v, str):
        m = re.match(r'^\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s*$', v)
        if m:
            a = int(m.group(3)); a = a + 2000 if a < 100 else a
            try: d = datetime.date(a, int(m.group(2)), int(m.group(1)))
            except ValueError: d = None
    if d is None: return None
    if not (1985 <= d.year <= 2030):
        if onde: avisar(f'{onde}: data fora do normal ({d.isoformat()}) — ficou em branco')
        return None
    return d.isoformat()

def sem(s): return unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode().lower()
def chave_nome(s):
    s = sem(s)
    s = re.sub(r'\b(ltda|s/?a|me|eireli|ind|industria|comercio|com|e|de|do|da|dos|das|cia|&)\b\.?', ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()

def cod(v):
    """Código de produto/material: espaços normalizados, sem mudar a grafia."""
    s = txt(v)
    if not s: return None
    return re.sub(r'\s*\.\s*', '.', s).replace('  ', ' ').strip()

def linhas(ws, cab=1):
    it = ws.iter_rows(min_row=cab, values_only=True)
    hdr = [txt(h) or f'_{i}' for i, h in enumerate(next(it))]
    for n, r in enumerate(it, cab + 1):
        yield n, dict(zip(hdr, r))

def col(r, *nomes):
    for k in nomes:
        for h in r:
            if sem(h).replace(' ', '') == sem(k).replace(' ', ''): return r[h]
    return None

# ================================================================ Departamento Técnico
dt = abrir(r'Departamento T.cnico')

# ---- clientes (siglas + cadastro completo)
clientes = {}
def cliente(nome, **extra):
    nome = txt(nome)
    if not nome: return None
    k = chave_nome(nome)
    alvo = None
    for kk in clientes:
        a, b = kk.split(), k.split()
        if kk == k or (a and b and a[0] == b[0] and (len(a[0]) > 3 or kk.startswith(k) or k.startswith(kk))) \
           or (a and b and difflib.SequenceMatcher(None, a[0], b[0]).ratio() >= .86 and len(a[0]) > 4):
            alvo = kk; break
    if alvo is None:
        clientes[k] = {'nome': nome}; alvo = k
    c = clientes[alvo]
    for x, v in extra.items():
        if v and not c.get(x): c[x] = v
    return c['nome']

def_cod = {'siglas': [], 'tipos': [], 'dispositivos': [], 'ferramentas': [], 'upgrade': []}
ws = dt['Def. Cód. Int.']
for r in ws.iter_rows(min_row=3, values_only=True):
    if txt(r[0]) and txt(r[1]):
        def_cod['siglas'].append({'nome': txt(r[0]), 'sigla': txt(r[1])})
        cliente(r[0], sigla=txt(r[1]))
modo = None
for r in ws.iter_rows(min_row=1, values_only=True):
    d, e, f, g = (txt(x) for x in r[3:7])
    if d and 'Nomenclatura' in d: modo = 'tipos'; continue
    if d and 'Dispositivos' in d: modo = 'disp'; continue
    if d and 'Upgrade' in d: modo = 'up'; continue
    if d in ('Descrição', 'Código'): continue
    if modo == 'tipos' and d and e and g: def_cod['tipos'].append({'prefixo': d.strip(), 'tipo': e, 'descricao': g})
    if modo == 'disp':
        if d and e: def_cod['dispositivos'].append({'descricao': d, 'sigla': e})
        if f and g: def_cod['ferramentas'].append({'descricao': f, 'sigla': g})
        elif d and e is None and f is None and g is None: pass
    if modo == 'up' and d and e and f: def_cod['upgrade'].append({'codigo': d, 'tipo': e, 'descricao': f})
# a linha "Machos Standard / MS" fica sozinha nas colunas D/E
for x in list(def_cod['dispositivos']):
    if x['descricao'].lower().endswith('standard'): def_cod['dispositivos'].remove(x); def_cod['ferramentas'].append(x)

for n, r in linhas(dt['Cad. Clientes']):
    nome = txt(col(r, 'CLIENTES'))
    if not nome: continue
    cliente(nome, razao=nome, contato=txt(col(r, 'CONTATO1')), contato2=txt(col(r, 'CONTATO2')), telefone=txt(col(r, 'TELEFONE')),
            telefone2=txt(col(r, 'FAX / TEL 2')), endereco=txt(col(r, 'ENDEREÇO')), bairro=txt(col(r, 'BAIRRO')), cidade=txt(col(r, 'CIDADE')),
            uf=txt(col(r, 'UF')), cep=txt(col(r, 'CEP')), cnpj=txt(col(r, 'CNPJ')), ie=txt(col(r, 'I.E.')), email=txt(col(r, 'Email')), site=txt(col(r, 'Site')))

# ---- fornecedores (duas listas: Depto Técnico e Manutenção)
fornecedores = {}
def fornecedor(r):
    nome = txt(col(r, 'FORNECEDOR'))
    if not nome: return
    k = chave_nome(nome)
    f = fornecedores.setdefault(k, {'nome': nome})
    obs = txt(col(r, 'OBSERVAÇÕES'))
    site = None
    if obs and re.search(r'(https?://|www\.)', obs, re.I): site, obs = obs, None
    campos = dict(contato=txt(col(r, 'CONTATO')), contato2=txt(col(r, 'Contato 2')), telefone=txt(col(r, 'TELEFONE')),
                  celular=txt(col(r, 'CELULAR', 'Celular / FAX')), endereco=txt(col(r, 'ENDEREÇO')), bairro=txt(col(r, 'BAIRRO')),
                  cidade=txt(col(r, 'CIDADE')), uf=txt(col(r, 'UF')), cep=txt(col(r, 'CEP')), cnpj=txt(col(r, 'CNPJ')), ie=txt(col(r, 'I.E.')),
                  qualificacao=txt(col(r, 'APROV.')), qualif_metodo=txt(col(r, 'MÉTODO')), qualif_validade=data(col(r, 'VALIDADE')),
                  email=(txt(col(r, 'EMAIL')) or '').replace('mailto:', '') or None, site=site, obs=obs)
    if f.get('celular') == 'O mesmo': f['celular'] = None
    for x, v in campos.items():
        if v and v != 'O mesmo' and not f.get(x): f[x] = v
for n, r in linhas(dt['Cad. Fornecedores']): fornecedor(r)

# ---- código inteligente
ws = dt['Tab. Mat. Produtivo']
cint = {'liga': [], 'perfil': [], 'processo': [], 'estado': [], 'medida': []}
for r in ws.iter_rows(min_row=2, values_only=True):
    pares = [('liga', 1, 2), ('perfil', 3, 4), ('processo', 5, 6), ('estado', 7, 8), ('medida', 9, 10)]
    for k, a, b in pares:
        c_, d_ = txt(r[a]), txt(r[b])
        if c_ and d_: cint[k].append({'c': c_.strip(), 'd': d_})

# ---- registros do Departamento Técnico
registros = []
def reg(tipo, **kw):
    kw['tipo'] = tipo
    kw['dados'] = {k: v for k, v in (kw.get('dados') or {}).items() if v not in (None, '')}
    registros.append(kw)

for n, r in linhas(dt['Desenvolvimento'], 5):
    if not txt(col(r, 'Código JAF')): continue
    reg('desenvolvimento', numero=int(num(col(r, 'Nº')) or 0) or None, codigo=cod(col(r, 'Código JAF')), titulo=txt(col(r, 'Descrição')),
        status=txt(col(r, 'Posição')), prazo=data(col(r, 'Prazo'), f'Desenvolvimento linha {n}'), concluido_em=data(col(r, 'Conclusão')),
        responsavel=txt(col(r, 'Responsável')), data=data(col(r, 'Prazo')), dados={'cliente': cliente(col(r, 'Cliente')), 'codigo_cliente': txt(col(r, 'Código Cliente'))})

for n, r in linhas(dt['Projetos']):
    if not txt(col(r, 'Descrição')): continue
    reg('projeto', numero=int(num(col(r, 'Sequência')) or 0) or None, data=data(col(r, 'Data Início'), f'Projetos linha {n}'), codigo=txt(col(r, 'Código')),
        titulo=txt(col(r, 'Descrição')), prazo=data(col(r, 'Prazo Final')), concluido_em=data(col(r, 'Data')), responsavel=txt(col(r, 'Responsável')),
        status='Concluído' if txt(col(r, 'Status')) == 'Ok' else 'Em andamento',
        dados={'peca': txt(col(r, 'Peça')), 'operacao': txt(col(r, 'Op.')), 'aplicacao': txt(col(r, 'Aplicação')), 'aprovacao': data(col(r, 'Aprovação')),
               'resultado': txt(col(r, 'Análise Resultados')), 'responsavel2': txt(col(r, 'Responsável2'))})

for n, r in linhas(dt['Melhorias']):
    if not txt(col(r, 'Objetivo da Melhoria')): continue
    reg('melhoria', numero=int(num(col(r, 'Sequência')) or 0) or None, data=data(col(r, 'Data Início')), titulo=txt(col(r, 'Objetivo da Melhoria')),
        prazo=data(col(r, 'Prazo Final')), concluido_em=data(col(r, 'Data')), responsavel=txt(col(r, 'Responsável')),
        status='Concluído' if txt(col(r, 'Status')) == 'Ok' else 'Em andamento',
        dados={'equipe': txt(col(r, 'Equipe')), 'situacao_atual': str(col(r, 'Descrição da Situação Atual') or '').strip(), 'acoes_planejadas': str(col(r, 'Ações Planejadas') or '').strip(),
               'acoes_implementadas': str(col(r, 'Ações Implementadas') or '').strip(), 'analise': str(col(r, 'Análise dos Resultados') or '').strip()})

for n, r in linhas(dt['Sol. Alt.']):
    if not txt(col(r, 'Descrição da Solicitação')): continue
    reg('alteracao', numero=int(num(col(r, 'Nº')) or 0) or None, data=data(col(r, 'Data')), titulo=str(col(r, 'Descrição da Solicitação')).strip(),
        prazo=data(col(r, 'Prazo')), concluido_em=data(col(r, 'Conclusão')), responsavel=txt(col(r, 'Responsável')),
        status='Concluído' if txt(col(r, 'Status')) == 'Ok' else 'Em andamento',
        dados={'solicitante': txt(col(r, 'Solicitante')), 'setor': txt(col(r, 'Setor')), 'justificativa': str(col(r, 'Justificativa') or '').strip(),
               'analise': str(col(r, 'Análise do Setor Responsável') or '').strip(), 'situacao': txt(col(r, 'Situação')), 'aprovador': txt(col(r, 'Nome'))})

for n, r in linhas(dt['Desvios']):
    if not txt(col(r, 'Motivo')): continue
    reg('desvio', numero=int(num(col(r, 'Sequência')) or 0) or None, data=data(col(r, 'Data')), codigo=txt(col(r, 'Ítem')), titulo=txt(col(r, 'Motivo')),
        concluido_em=data(col(r, 'Data2')), responsavel=txt(col(r, 'Aprovado Por:')), status='Aprovado' if txt(col(r, 'Aprovado Por:')) else 'Aguardando',
        dados={'qtd': txt(col(r, 'Qde')), 'solicitante': txt(col(r, 'Solicitante')), 'instrucoes': str(col(r, 'Instruções') or '').strip(),
               'documentacoes': str(col(r, 'Documentações') or '').strip(), 'observacoes': str(col(r, 'Observações') or '').strip()})

seq = 0
for n, r in linhas(dt['Qualidade Matriz']):
    c = txt(col(r, 'Código'))
    if not c: continue
    seq += 1
    reg('desenho', numero=seq, codigo=c, data=data(col(r, 'Data Distribuição')), responsavel=txt(col(r, 'Responsável')), status='Em uso',
        dados={'rev': txt(col(r, 'Rev.')), 'data_rev': data(col(r, 'Data')), 'tolerancia': txt(col(r, 'Tolerância não Especificada controlar conforme Norma')), 'obs': txt(col(r, 'Observações'))})

for n, r in linhas(dt['Contr.Distrib. Cópia Controlada']):
    c = txt(col(r, 'Nº DESENHO / NORMA'))
    if not c: continue
    reg('copia', numero=int(num(col(r, 'Nº')) or 0) or None, codigo=c, data=data(col(r, 'DATA DISTRIBUIÇÃO')), status='Distribuída',
        dados={'op': txt(col(r, 'OP.')), 'rev': txt(col(r, 'REV.')), 'data_rev': data(col(r, 'DATA REVISÃO')), 'local': txt(col(r, 'LOCAL DE USO'))})

seq = 0
for n, r in linhas(dt['Cad.IMDS']):
    c = txt(col(r, 'Código JAF METAL')) or txt(col(r, 'Código Cliente'))
    if not c: continue
    seq += 1
    reg('imds', numero=seq, codigo=txt(col(r, 'Código JAF METAL')), prazo=data(col(r, 'Prazo')), concluido_em=data(col(r, 'Concluído')),
        data=data(col(r, 'Prazo')), status='Concluído' if txt(col(r, 'Status')) == 'Ok' else 'Em andamento',
        dados={'codigo_cliente': txt(col(r, 'Código Cliente')), 'cadastro_imds': txt(col(r, 'Cadastro IMDS'))})

for n, r in linhas(dt['Atas de Reunião']):
    if not txt(col(r, 'Pauta da Reunião')): continue
    h = col(r, 'Hora')
    reg('ata', numero=int(num(col(r, 'Sequência')) or 0) or None, data=data(col(r, 'Data')), titulo=txt(col(r, 'Pauta da Reunião')), responsavel=txt(col(r, 'Coordenador')),
        status='Concluído', dados={'participantes': txt(col(r, 'Participantes')), 'hora': h.strftime('%H:%M') if isinstance(h, datetime.time) else txt(h),
        'local': txt(col(r, 'Local')), 'assuntos': str(col(r, 'Assuntos Responsável e Data') or '').strip()})

seq = 0
for n, r in linhas(dt['Setup e Prod.']):
    c = txt(col(r, 'Código'))
    if not c: continue
    seq += 1
    reg('setup', numero=seq, codigo=c, status='Ativo', dados={'operacao': txt(col(r, 'Operação')), 'setup_horas': num(col(r, 'Set-Up (Horas)')), 'pecas_hora': num(col(r, 'Peças p/ Hora')),
        'liberar_qualidade': txt(col(r, 'Liberar em Conj. c/ Qualidade?')), 'plano_montagem': txt(col(r, 'Elaborar plano de Montagem?')), 'obs': txt(col(r, 'Observações')), 'planta': txt(col(r, 'Planta'))})

# ================================================================ PCP (cadastros, OFs, matéria-prima)
pcp = abrir(r'^PCP')
produtos = {}
def produto(c, **kw):
    if not c: return None
    p = produtos.setdefault(c.upper(), {'codigo': c})
    for k, v in kw.items():
        if v not in (None, '') and p.get(k) in (None, ''): p[k] = v
    return p

for n, r in linhas(pcp['Cadastro de Material Produtivo']):
    c = cod(col(r, 'Cód. Inteligente'))
    if c: produto(c, descricao=txt(col(r, 'Descrição')), classe='mp')
for n, r in linhas(pcp['Cadastros Componentes']):
    c = cod(col(r, 'Cód. Componente'))
    if not c: continue
    mp = cod(col(r, 'Cód. Matéria Prima'))
    p = produto(c, descricao=txt(col(r, 'Descrição')), mp_codigo=mp, mp_qtd=num(col(r, 'Qde')), mp_unidade=txt(col(r, 'Kg/ Pç', 'Kg / Pç')), operacao=txt(col(r, 'Operação')))
    p['classe'] = 'peca'
estrutura = []
ws = pcp['Cadastros Conjuntos']
for n, r in enumerate(ws.iter_rows(min_row=2, values_only=True), 2):
    c = cod(r[0])
    if not c: continue
    p = produto(c, descricao=txt(r[1]), operacao=txt(r[2])); p['classe'] = 'peca'
    for k in range(16):
        f, q, u = cod(r[3 + 3 * k]) if 3 + 3 * k < len(r) else None, num(r[4 + 3 * k]) if 4 + 3 * k < len(r) else None, txt(r[5 + 3 * k]) if 5 + 3 * k < len(r) else None
        if f and q: estrutura.append({'pai': c, 'filho': f, 'qtd': q, 'unidade': u or 'Pç', 'ordem': k + 1})
        elif f: avisar(f'Cadastros Conjuntos linha {n}: {c} tem o componente {f} sem quantidade — não entrou na estrutura')

# lotes de matéria-prima (E.S.M.)
lotes = []
for n, r in linhas(pcp['E.S.M.'], 2):
    ri = num(col(r, 'R.I.'))
    c = cod(col(r, 'Cód. Material'))
    if not ri or not c: continue
    q = num(col(r, 'Qde/Kg'))
    if not q: avisar(f'E.S.M. linha {n}: RI {int(ri)} sem quantidade — não entrou'); continue
    lotes.append({'ri': int(ri), 'codigo': c, 'qtd': q, 'data': data(col(r, 'Data'), f'E.S.M. RI {int(ri)}'), 'nota': txt(col(r, 'Nota')),
                  'fornecedor': txt(col(r, 'Fornecedor')), 'pedido': txt(col(r, 'Pedido')), 'status': txt(col(r, 'Status')) or 'Aprovado',
                  'saldo_planilha': num(col(r, 'Saldo/ Kg'))})
    if c.upper() not in produtos: produto(c, descricao=txt(col(r, 'Descrição')), classe='mp')

# ordens de fabricação — componentes
ofs = []
for n, r in linhas(pcp['Ordem de Fabricação']):
    c = cod(col(r, 'Código Produto'))
    nof = num(col(r, 'Nº OF'))
    if not c or not nof: continue
    ri = col(r, 'RI'); obs = []
    rin = num(ri)
    if rin is not None and not float(rin).is_integer(): obs.append(f'RI na planilha: {ri}'); rin = None
    extra = txt(r.get('_13'))
    if extra and extra not in ('*',): obs.append(extra)
    st = txt(col(r, 'Status'))
    ofs.append({'numero': int(nof), 'tipo': 'componente', 'codigo': c, 'qtd': num(col(r, 'Qde')) or 0, 'produzido': num(col(r, 'Qde Prod.')),
                'ri': int(rin) if rin else None, 'kg': num(col(r, 'Qde Kg')), 'emitido_por': txt(col(r, 'Emitido')), 'emitida_em': data(col(r, 'Data'), f'OF {int(nof)}'),
                'realizado_por': txt(col(r, 'Realizado')), 'realizada_em': data(col(r, 'Data2'), f'OF {int(nof)}'),
                'status': 'encerrada' if st == 'Encerrada' else 'aberta', 'obs': '; '.join(obs) or None})
# ordens de fabricação — conjuntos (com as OFs/RIs de cada componente)
estr_por_pai = collections.defaultdict(list)
for e in estrutura: estr_por_pai[e['pai'].upper()].append(e)
for n, r in linhas(pcp['OF Conjunto']):
    c = cod(col(r, 'Código'))
    nof = num(col(r, 'Nº OF.'))
    if not c or not nof: continue
    lote = num(col(r, 'Qde Lote')) or 0
    refs = [txt(col(r, f'OF comp. {k}', f'OF comp.{k}')) for k in range(1, 17)]
    comps = []
    for k, e in enumerate(sorted(estr_por_pai.get(c.upper(), []), key=lambda x: x['ordem'])):
        comps.append({'codigo': e['filho'], 'qtd': round(e['qtd'] * lote, 4), 'ref': refs[k] if k < len(refs) else None})
    ofs.append({'numero': int(nof), 'tipo': 'conjunto', 'codigo': c, 'descricao': txt(col(r, 'Descrição')), 'qtd': lote, 'produzido': num(col(r, 'Qde Produzida')),
                'emitido_por': txt(col(r, 'Emitido Por:')), 'emitida_em': data(col(r, 'Data'), f'OF {int(nof)}'), 'realizado_por': txt(col(r, 'Realizado Por:')),
                'realizada_em': data(col(r, 'Data2'), f'OF {int(nof)}'), 'status': 'encerrada' if txt(col(r, 'Status')) == 'Encerrada' else 'aberta', 'componentes': comps})

# histórico: requisições de componentes e serviços externos
for n, r in linhas(pcp['Req. Componentes']):
    c = cod(col(r, 'Cód. Componente'))
    if not c: continue
    reg('requisicao', numero=int(num(col(r, 'Nº Req.')) or 0) or None, codigo=c, data=data(col(r, 'Data')), concluido_em=data(col(r, 'Data2')),
        responsavel=txt(col(r, 'Solicitado Por')), status='Entregue' if txt(col(r, 'Status')) == 'Encerrada' else 'Em aberto',
        dados={'qtd': num(col(r, 'Qde Req.')), 'entregue': num(col(r, 'Qde Entregue')), 'of': txt(col(r, 'OF')), 'entregue_por': txt(col(r, 'Entregue Por'))})
for n, r in linhas(pcp['Sol. Serv. Ext.']):
    if not txt(col(r, 'Descrição do Serviço')) and not txt(col(r, 'Produto')): continue
    reg('servico_externo', numero=int(num(col(r, 'Seq.')) or 0) or None, codigo=txt(col(r, 'Produto')), titulo=txt(col(r, 'Descrição do Serviço')),
        data=data(col(r, 'Data'), f'Serviço externo linha {n}'), responsavel=txt(col(r, 'Emitido Por')),
        status='Retornou' if txt(col(r, 'Status')) == 'Encerrada' else 'Fora (no fornecedor)', concluido_em=data(col(r, 'Data Retorno')),
        dados={'descricao': txt(col(r, 'Descrição')), 'qtd': num(col(r, 'Qde')), 'peso': txt(col(r, 'Peso')), 'of': txt(col(r, 'OF')), 'fornecedor': txt(col(r, 'Fornecedor')),
               'saida': data(col(r, 'Data Saída')), 'qtd_retorno': num(col(r, 'Qde2'))})

# ================================================================ Controle de Pedidos
cp = abrir(r'Controle de Pedidos')
vendas = []
for n, r in linhas(cp['Pedido']):
    cli = txt(col(r, 'Cliente'))
    if not cli or not (txt(col(r, 'Código JAF')) or txt(col(r, 'Cód. Cliente'))): continue
    q = num(col(r, 'Qde'))
    if q is None: avisar(f'Pedido linha {n}: sem quantidade — não entrou'); continue
    vendas.append({'cliente': cliente(cli), 'codigo': cod(col(r, 'Código JAF')), 'codigo_cliente': txt(col(r, 'Cód. Cliente')), 'descricao': txt(col(r, 'Descrição')),
                   'pedido': txt(col(r, 'Pedido')), 'prazo': data(col(r, 'Prazo'), f'Pedido linha {n}'), 'qtd': q, 'valor': num(col(r, 'Valor')) or 0,
                   'entregue': num(col(r, 'Entregue')) or 0, 'entregue_em': data(col(r, 'Data'), f'Pedido linha {n}'), 'obs': txt(col(r, 'Observações'))})
# cadastro técnico: dados do cliente em cada produto + estrutura de quem não está nos conjuntos
tec_por = collections.defaultdict(list)
for n, r in linhas(cp['Cad. Técnico']):
    c = cod(col(r, 'Conjunto'))
    if c: tec_por[c.upper()].append(r)
SIT = {'Item inativo': 'inativo', 'Bloqueado para fabricação': 'bloqueado'}
for k, rs in tec_por.items():
    r = rs[0]; c = cod(col(r, 'Conjunto'))
    obs = [txt(col(x, 'Observações')) for x in rs]
    situ = next((SIT[o] for o in obs if o in SIT), 'ativo')
    nota = next((o for o in obs if o and o not in SIT and o != 'Lotes Intercalados'), None)
    checks = {k2: True for k2, h in (('solic_desenv', 'Solic. Desenv.'), ('rf_pc', 'RF e PC'), ('desenhos', 'Desenhos'), ('planos_montagem', 'Planos de Montagem')) if txt(col(r, h)) == 'Ok'}
    p = produto(c, cliente=cliente(col(r, 'Cliente')), codigo_cliente=txt(col(r, 'Código do Cliente')), desenho_cliente=txt(col(r, 'Desenho do Cliente')),
                revisao=txt(col(r, 'Rev.')), data_revisao=data(col(r, 'Data')), data_entrada=data(col(r, 'Data Entrada')), pecas_mes=num(col(r, 'Pçs / Mês')))
    p['situacao'] = situ; p['checks'] = checks
    if nota: p['obs'] = nota
    if 'classe' not in p: p['classe'] = 'peca'
    # estrutura pelo cadastro técnico, só se o PCP não tem
    if k not in estr_por_pai:
        filhos = collections.OrderedDict()
        for x in rs:
            sc, fc = cod(col(x, 'Sub-Conjunto')), cod(col(x, 'Componente'))
            if sc and sc.upper() != k: filhos.setdefault(sc, (num(col(x, 'Qde')) or 1, 'Pç'))
            elif fc and fc.upper() != k: filhos.setdefault(fc, (num(col(x, 'Qde2')) or 1, txt(col(x, 'Pç/Kg')) or 'Pç'))
            elif fc and fc.upper() == k:
                mat = cod(col(x, 'Material'))
                produto(c, mp_codigo=mat, mp_qtd=num(col(x, 'Qde3')), mp_unidade=txt(col(x, 'Pç/Kg4')))
        for o, (f, (q, u)) in enumerate(filhos.items(), 1):
            estrutura.append({'pai': c, 'filho': f, 'qtd': q, 'unidade': u, 'ordem': o})
        if filhos: estr_por_pai[k] = True
        for x in rs:
            fc = cod(col(x, 'Componente'))
            if fc and fc.upper() != k: produto(fc, mp_codigo=cod(col(x, 'Material')), mp_qtd=num(col(x, 'Qde3')), mp_unidade=txt(col(x, 'Pç/Kg4')), classe='peca')
sem_cad = collections.Counter(v['codigo'] for v in vendas if v['codigo'] and v['codigo'].upper() not in produtos)
for c in [v for v in vendas if v['codigo']]:
    produto(c['codigo'], descricao=c['descricao'], cliente=c['cliente'], codigo_cliente=c['codigo_cliente'], classe='peca')
for p in produtos.values(): p.setdefault('classe', 'peca'); p.setdefault('descricao', p['codigo'])

# ================================================================ Manutenção (módulo 2016) e Preventiva
mn = abrir(r'Manutencao')
pv = abrir(r'Preventiva Maquinas')
for n, r in linhas(mn['Fornecedores']): fornecedor(r)

maquinas = {}
def maquina(c, nome=None, **kw):
    c = txt(c)
    if not c: return None
    c = re.sub(r'^([A-Z]+)\s*0*(\d+)$', lambda m: f'{m.group(1)} {int(m.group(2)):02d}', c.upper()) if re.match(r'^[A-Za-z]+\s*\d+$', c) else c
    m = maquinas.setdefault(c.upper(), {'codigo': c})
    if nome and (not m.get('nome') or len(nome) > len(m['nome'])): m['nome'] = nome
    for k, v in kw.items():
        if v not in (None, '') and m.get(k) in (None, ''): m[k] = v
    return m['codigo']

# o campo "Código" da OS é texto livre ("CR 01 e 02", "Matriz", "Paleteira"): acha a máquina certa sem inventar máquinas
PREDIAL = re.compile(r'predial|banheiro|escrit|bebedouro|caixa d|porta de a|pia |vaso |telhad|portão|portao|ilumina|luz |lâmpada|lampada|arm[aá]rio|geladeira|sala |extintor|ventilador|roteador|servidor|nobreak|prateleira', re.I)
def resolver_maquina(codigo, nome):
    t = txt(codigo) or ''
    achados = [f'{a} {int(b):02d}' for a, b in re.findall(r'\b([A-Z]{2,4})\s?0?(\d{1,2})\b', t.upper())]
    conhecidos = [a for a in achados if a.upper() in maquinas]
    if conhecidos: return conhecidos[0]
    if len(achados) == 1 and re.fullmatch(r'[A-Za-z]{2,4}\s?\d{1,3}', t.strip()): return maquina(achados[0], nome)
    junto = f'{t} {nome or ""}'
    if PREDIAL.search(junto) or sem(t) in ('matriz', 'filial', 'matriz e filial', 'diversos'):
        return 'PRED FIL' if 'filial' in sem(junto) and 'matriz' not in sem(junto) else 'PRED MAT'
    if achados: return maquina(achados[0], nome)
    eq = txt(nome) or t
    if not eq: return 'PRED MAT'
    return maquina('EQ ' + re.sub(r'[^A-Z0-9]+', ' ', sem(eq).upper()).strip()[:24], eq.strip(), grupo='Outro')

# lista da preventiva ("Nome - CÓDIGO")
for r in pv['Link'].iter_rows(min_row=2, values_only=True):
    for v in r:
        s = txt(v)
        m = re.match(r'^(.*?)\s*-\s*([A-Z]{2,4}\s*\d{1,3})\s*$', s or '')
        if m: maquina(m.group(2), m.group(1).strip(' -'))
preventivas, pendencias = [], []
for ws in pv.worksheets:
    if not ws.title.lower().startswith('check'): continue
    m = re.search(r'([A-Z]{2,4})\s*(\d+)\s*$', ws.title.strip())
    codigo = f'{m.group(1)} {int(m.group(2)):02d}'
    cel = {(c.row, c.column): c.value for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 80), max_col=24) for c in row if c.value not in (None, '')}
    nome = txt(cel.get((4, 4)))
    num_cel = txt(cel.get((4, 23)))
    if num_cel and num_cel.replace(' ', '').upper() != codigo.replace(' ', ''): avisar(f'Preventiva: a aba "{ws.title.strip()}" diz NÚMERO {num_cel} — usei {codigo}')
    if nome and '(DESATIVADA)' in nome.upper(): nome = nome.replace('(DESATIVADA)', '').replace('- ', '').strip(' -'); desat = True
    else: desat = False
    hdr = next((rw for (rw, cc), v in cel.items() if cc == 1 and 'ITENS A VERIFICAR' in str(v).upper()), 5)
    resp_row = next((rw for (rw, cc), v in cel.items() if cc == 2 and str(v).strip().lower().startswith('respons')), None)
    fim = resp_row or hdr + 17
    itens = [(rw, txt(cel.get((rw, 2)))) for rw in range(hdr + 2, fim) if txt(cel.get((rw, 2)))]
    sess = [cc for (rw, cc), v in cel.items() if rw == hdr and str(v).strip().lower().startswith('data')]
    for cc in sorted(sess):
        dta = data(cel.get((hdr, cc + 1)), f'Preventiva {codigo}')
        if not dta: continue
        res = [{'item': it, 'situacao': txt(cel.get((rw, cc))) or ''} for rw, it in itens]
        preventivas.append({'maquina': codigo, 'data': dta, 'responsavel': txt(cel.get((resp_row, cc))) if resp_row else None, 'resultados': res})
    ped = next((rw for (rw, cc), v in cel.items() if cc == 1 and 'SEREM REALIZADAS' in str(v).upper()), None)
    if ped:
        for rw in range(ped + 1, ws.max_row + 1 if ws.max_row < 200 else ped + 40):
            d_ = txt(cel.get((rw, 1)))
            if not d_: continue
            st = txt(cel.get((rw, 23)))
            pendencias.append({'maquina': codigo, 'titulo': d_, 'os': txt(cel.get((rw, 20))), 'prazo': data(cel.get((rw, 21))),
                               'status': 'Concluído' if st in ('Ok', 'Concluído') else (st or 'Aberta')})
    maquina(codigo, nome, checklist=[it for _, it in itens], ativo=not desat, oculta=ws.sheet_state != 'visible')

# plano de preventiva (máquinas e dispositivos)
for n, r in linhas(mn['Manut. Preventiva']):
    c = txt(col(r, 'Código'))
    if not c: continue
    desc = txt(col(r, 'Descrição')); alvo = txt(col(r, 'Máquina / Peça'))
    eh_maq = desc and 'preventiva' in desc.lower()
    c = resolver_maquina(c, alvo if eh_maq else desc)
    maquina(c, alvo if eh_maq else desc, preventiva_dias=int(num(col(r, 'Frequência')) or 0) or None, aplicacao=None if eh_maq else alvo)
    if txt(col(r, 'Status')) == 'Desativado': maquinas[c.upper()]['ativo'] = False
    u = data(col(r, 'Última Revisão'))
    if u and not any(p['maquina'] == c and p['data'] == u for p in preventivas):
        preventivas.append({'maquina': c, 'data': u, 'responsavel': None, 'resultados': [], 'os': txt(col(r, 'Documento'))})

# ordens de serviço
oss = []
for n, r in linhas(mn['Ordem de Serviço']):
    nr = num(col(r, 'Nº'))
    if not nr or not txt(col(r, 'Defeito Apresentado')): continue
    c, eqp = txt(col(r, 'Código')), txt(col(r, 'Máq. / Disp.'))
    mc = resolver_maquina(c, eqp)
    tipo = (txt(col(r, 'Tipo')) or 'Corretiva').lower()
    oss.append({'numero': int(nr), 'maquina': mc, 'equipamento': ' — '.join(x for x in (eqp, c) if x) or None,
                'data': data(col(r, 'Data'), f'OS {int(nr)}'), 'solicitante': txt(col(r, 'Solicitante')),
                'problema': str(col(r, 'Defeito Apresentado')).strip(), 'responsavel': txt(col(r, 'Responsável')), 'prazo': data(col(r, 'Prazo')),
                'solucao': str(col(r, 'Serviço Executado') or '').strip() or None, 'pecas': str(col(r, 'Peças Substituídas / Fornecedor / Valor') or '').strip() or None,
                'aprovacao': str(col(r, 'Aprovação Após Manutenção') or '').strip() or None, 'concluida_em': data(col(r, 'Data2')),
                'custo': num(col(r, 'Custo Total')) or 0, 'horas_parada': num(col(r, 'Horas parada')),
                'tipo': tipo if tipo in ('preventiva', 'corretiva', 'preditiva') else 'corretiva',
                'status': 'concluida' if txt(col(r, 'Status')) == 'Concluído' else 'aberta'})

for n, r in linhas(mn['Serviços']):
    if not txt(col(r, 'Descrição')): continue
    hi, ht, th = col(r, 'Início'), col(r, 'Término'), col(r, 'Total Hora')
    hh = lambda t: t.strftime('%H:%M') if isinstance(t, (datetime.time, datetime.datetime)) else txt(t)
    horas = (th.hour + th.minute / 60) if isinstance(th, datetime.time) else (th.days * 24 + th.seconds / 3600 if isinstance(th, datetime.timedelta) else num(th))
    eq = txt(col(r, 'Equipamento'))
    reg('servico_manut', data=data(col(r, 'Data'), f'Serviços linha {n}'), titulo=txt(col(r, 'Descrição')), valor=num(col(r, 'Total')),
        status='Pago' if txt(col(r, 'Status')) == 'Ok' else 'Atenção', maquina=eq if eq and eq.upper() in maquinas else None,
        dados={'inicio': hh(hi), 'termino': hh(ht), 'horas': round(horas, 2) if horas else None, 'equipamento': eq, 'prestador': txt(col(r, 'Fornecedor')),
               'valor_hora': num(col(r, 'R$ Hora')), 'vencimento': data(col(r, 'Vencimento')), 'os': txt(col(r, 'Relatório')), 'obs': txt(col(r, 'Observações'))})

for n, r in linhas(mn['Fluxo de Caixa']):
    if not txt(col(r, 'Descrição')): continue
    reg('gasto_manut', data=data(col(r, 'Data'), f'Fluxo de Caixa linha {n}'), titulo=txt(col(r, 'Descrição')), valor=num(col(r, 'Valor')) or 0,
        status={'Ok': 'Pago', 'Aguardando': 'Aguardando', 'Atenção': 'Atenção'}.get(txt(col(r, 'Status')), 'Pago'),
        dados={'documento': txt(col(r, 'Documento')), 'qtd': num(col(r, 'Qde')), 'fornecedor': txt(col(r, 'Fornecedor')), 'vencimento': data(col(r, 'Vencimento')),
               'plano': txt(col(r, 'Plano de contas')), 'grupo': txt(col(r, 'Peça / Máq. / Disp.')), 'codigo': txt(col(r, 'Código')), 'obs': txt(col(r, 'Observações'))})

for n, r in linhas(mn['Ferramentaria']):
    if not txt(col(r, 'Descrição')): continue
    st = txt(col(r, 'Status'))
    reg('ferramentaria', data=data(col(r, 'Data')), titulo=txt(col(r, 'Descrição')), prazo=data(col(r, 'Prazo')), valor=num(col(r, 'Preço')),
        status='Concluído' if st == 'Ok' else 'Aguardando', dados={'fornecedor': txt(col(r, 'Fornecedor')), 'obs': txt(col(r, 'Observações'))})

# peças críticas: lista nova (Manutenção) + o que só existe na antiga (Preventiva)
vistos = set()
for aba, wb in (('Máquinas Críticas', mn), ('Máquinas Chave', pv)):
    for n, r in linhas(wb[aba]):
        p_ = txt(col(r, 'Lista de Peças'))
        if not p_: continue
        k = (sem(col(r, 'Código')), sem(p_)[:30])
        if k in vistos: continue
        vistos.add(k)
        reg('peca_critica', titulo=p_, valor=num(col(r, 'Preço')), maquina=next((f'{a} {int(b):02d}' for a, b in re.findall(r'([A-Z]{2,4})\s?0?(\d{1,2})', (txt(col(r, 'Código')) or '').upper()) if f'{a} {int(b):02d}' in maquinas), None),
            status='Comprar' if txt(col(r, 'Status')) == 'Comprar' else 'Ok', data=data(col(r, 'Data Troca')), prazo=data(col(r, 'Próxima revisão')),
            dados={'fornecedor': txt(col(r, 'Fornecedor')), 'vida_dias': num(col(r, 'Vida útil')), 'qtd': num(col(r, 'Qde Estoque')), 'min': num(col(r, 'Estoque Mín.')),
                   'max': num(col(r, 'Estoque Máx.')), 'obs': txt(col(r, 'Observações')), 'origem': aba,
                   'maquinas': ' — '.join(x for x in (txt(col(r, 'Código')), txt(col(r, 'Relação de máquinas'))) if x) or None})

# predial: plano anual (Matriz e Filial) + ocorrências
ws = mn['Manut. Predial']
cel = {(c.row, c.column): c.value for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=25) for c in row if c.value not in (None, '')}
for col0, local in ((1, 'Matriz'), (14, 'Filial')):
    codigo = maquina(f'PRED {local[:3].upper()}', f'Predial — {local}', grupo='Predial', preventiva_dias=365)
    itens = [(cc, txt(cel.get((5, cc)))) for cc in range(col0 + 3 if col0 == 1 else col0 + 3, col0 + 12) if txt(cel.get((5, cc)))]
    maquinas[codigo.upper()]['checklist'] = [i for _, i in itens]
    ocorr = {}
    for rw in range(21, ws.max_row + 1):
        nn, dsc = num(cel.get((rw, col0))), txt(cel.get((rw, col0 + 1)))
        if nn and dsc:
            ocorr[int(nn)] = dsc
            pendencias.append({'maquina': codigo, 'titulo': f'{int(nn)}: {dsc}', 'prazo': data(cel.get((rw, col0 + 9))),
                               'status': 'Concluído' if txt(cel.get((rw, col0 + 10))) in ('Ok', 'Concluído') else (txt(cel.get((rw, col0 + 10))) or 'Aberta')})
    for rw in range(6, 19):
        dta = data(cel.get((rw, col0)))
        if not dta: continue
        res = []
        for cc, it in itens:
            v = cel.get((rw, cc)); s = txt(v) or ''
            if num(v) and int(num(v)) in ocorr: s = f'Ocorrência {int(num(v))}'
            res.append({'item': it, 'situacao': s})
        preventivas.append({'maquina': codigo, 'data': dta, 'responsavel': txt(cel.get((rw, col0 + 2))), 'resultados': res})

for p in pendencias:
    reg('pendencia', titulo=p['titulo'], maquina=p['maquina'], prazo=p['prazo'], status=p['status'], dados={'os': p.get('os')})

# peças de manutenção (lista do módulo 2016)
pecas = []
for n, r in linhas(mn['Peças']):
    d_ = txt(col(r, 'DESCRIÇÃO'))
    if not d_: continue
    pecas.append({'codigo': txt(col(r, 'CÓDIGO')), 'descricao': d_, 'utilizacao': txt(col(r, 'UTILIZAÇÃO')), 'fornecedor': txt(col(r, 'FORNECEDOR 1')),
                  'preco': num(col(r, 'PREÇO')), 'ultima_compra': data(col(r, 'ÚLTIMA COMPRA')), 'lote_minimo': txt(col(r, 'LOTE MÍNIMO'))})

# tipo e grupo das máquinas pelo prefixo do código
PREF = {}
for x in def_cod['dispositivos']: PREF[x['sigla']] = ('Dispositivo', x['descricao'])
for x in def_cod['ferramentas']: PREF[x['sigla']] = ('Ferramenta', x['descricao'])
for m in maquinas.values():
    pre = re.match(r'^([A-Z]+)', m['codigo'].upper())
    pre = pre.group(1) if pre else ''
    m.setdefault('nome', m['codigo']); m.setdefault('ativo', True)
    if m.get('grupo'): continue
    if pre in PREF: m['grupo'] = PREF[pre][0]; m.setdefault('tipo', PREF[pre][1])
    elif pre == 'PRED' or 'predial' in sem(m.get('nome')): m['grupo'] = 'Predial'
    elif re.match(r'^[A-Z]{2,4} \d{2}$', m['codigo'].upper()): m['grupo'] = 'Máquina'
    else: m['grupo'] = 'Outro'
    m.setdefault('nome', m['codigo'])
    m.setdefault('ativo', True)

# ================================================================ conferências
cods = {k for k in produtos}
for e in estrutura:
    if e['filho'].upper() not in cods: produto(e['filho'], descricao=e['filho'], classe='peca'); avisar(f'Estrutura: {e["pai"]} usa {e["filho"]}, que não tem cadastro — criei com o próprio código como descrição')
for o in ofs:
    if o['codigo'].upper() not in produtos: produto(o['codigo'], descricao=o.get('descricao') or o['codigo'], classe='peca'); avisar(f'OF {o["numero"]}: código {o["codigo"]} sem cadastro — criei')
ris = {l['ri'] for l in lotes}

ris_of = {o.get('ri') for o in ofs if o.get('ri')}
antigos = [l for l in lotes if (l['data'] or '0000') < '2025-07-01' and (l['saldo_planilha'] or 0) > 0 and l['ri'] not in ris_of]
for l in antigos:
    l['baixa'] = l['qtd']
    l['obs'] = 'Lote anterior a jul/2025 sem uso nas OFs de 2026: saldo zerado na importação (a planilha de 2026 não tem o consumo dos anos anteriores). Se ainda houver material, faça o inventário do lote.'
ri_sem_entrada = collections.Counter(o['ri'] for o in ofs if o.get('ri') and o['ri'] not in ris)

vistos_num = set()
for r_ in registros:
    k = (r_['tipo'], r_.get('numero'))
    if r_.get('numero') is None: continue
    if k in vistos_num: r_['dados']['numero_planilha'] = r_['numero']; r_['numero'] = None
    else: vistos_num.add(k)
carga = {'versao': 1, 'gerado_em': datetime.datetime.now().isoformat(timespec='seconds'),
         'clientes': list(clientes.values()), 'fornecedores': list(fornecedores.values()), 'produtos': list(produtos.values()), 'estrutura': estrutura,
         'lotes': [{k: v for k, v in l.items() if k != 'saldo_planilha'} for l in lotes], 'ofs': ofs, 'vendas': vendas,
         'maquinas': list(maquinas.values()), 'preventivas': preventivas, 'manutencoes': oss, 'registros': registros, 'pecas': pecas,
         'config': {'codigo_inteligente': cint, 'codigos': def_cod}}
with open(SAIDA, 'w', encoding='utf-8') as f: json.dump(carga, f, ensure_ascii=False, separators=(',', ':'))

rel = [f'Carga gerada em {carga["gerado_em"]}', '']
for k in ('clientes', 'fornecedores', 'produtos', 'estrutura', 'lotes', 'ofs', 'vendas', 'maquinas', 'preventivas', 'manutencoes', 'registros', 'pecas'):
    rel.append(f'{k:14} {len(carga[k]):6}')
rel.append('')
for t, n in collections.Counter(r['tipo'] for r in registros).most_common(): rel.append(f'  registro {t:18} {n:6}')
rel += ['', f'R.I. usados nas OFs que NÃO estão na Entrada de Matéria-Prima: {len(ri_sem_entrada)} lotes ({sum(ri_sem_entrada.values())} OFs), do R.I. {min(ri_sem_entrada or [0])} ao {max(ri_sem_entrada or [0])}.',
        '  A planilha E.S.M. parou de ser preenchida; esses recebimentos precisam ser lançados em Matéria-prima → Nova entrada (com o mesmo R.I.).']
rel += ['', f'Lotes de matéria-prima de antes de jul/2025 com saldo na planilha e sem nenhuma OF de 2026: {len(antigos)} (soma {sum(l["saldo_planilha"] or 0 for l in antigos):,.0f} kg/pç).',
        '  A planilha de 2026 só tem as OFs de 2026; o consumo desses lotes em anos anteriores não está nela. Entraram com saldo ZERO (dá para corrigir com o inventário do lote).', '',
        f'Códigos vendidos sem cadastro técnico: {len(sem_cad)} (criados só com a descrição do pedido)'] + [f'  {c} ({n} linhas)' for c, n in sem_cad.most_common(40)]
rel += ['', f'Avisos ({len(avisos)}):'] + ['  ' + a for a in avisos]
rel_arq = os.path.splitext(SAIDA)[0] + ' - conferir.txt'
with open(rel_arq, 'w', encoding='utf-8') as f: f.write('\n'.join(rel))
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
print('\n'.join(rel[:40]))
print('...', len(avisos), 'avisos em', rel_arq)
