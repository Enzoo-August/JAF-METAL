"""Lê as planilhas do RH da JAF e monta o arquivo de importação (importar_rh no banco).

    python -I testes/rh-ler-planilhas.py <pasta com as planilhas> <arquivo de saída .json>

Não grava nada no banco e não guarda dados aqui: o .json sai na pasta indicada (NUNCA dentro do repositório).
Junta as pessoas de todas as planilhas pelo CPF e pelo nome (aceita nome abreviado: "Maria J. Souza" = "Maria Jose Souza")
e imprime um relatório do que não bateu, para conferir antes de importar.
"""
import datetime as dt
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict

import openpyxl

PASTA, SAIDA = sys.argv[1].rstrip('/\\') + '/', sys.argv[2]
sys.stdout.reconfigure(encoding='utf-8')
avisos = []
def aviso(t): avisos.append(t)

# ------------------------------------------------------------------ texto, datas, números
PART = {'de', 'da', 'do', 'das', 'dos', 'e'}
def sem(s): return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def norm(s): return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', sem(s).lower())).strip()
def toks(s): return [re.sub(r'th', 't', t).replace('y', 'i') for t in norm(s).split() if t not in PART]
def limpo(v):
    if v is None: return None
    s = re.sub(r'\s+', ' ', str(v)).strip()
    return None if s in ('', '0', '0.0', '-') else s   # "0" na planilha = campo vazio
def nome_bonito(s):
    s = limpo(s)
    if not s: return s
    if s.isupper() or s.islower():
        s = ' '.join(w.lower() if w.lower() in PART else w.capitalize() for w in s.lower().split())
    return s

def data(v, onde=''):
    if v is None or v == '': return None
    if isinstance(v, dt.datetime): v = v.date()
    if isinstance(v, dt.date):
        return None if v.year < 1900 or v.year > 2100 else v.isoformat()
    s = str(v).strip()
    d = re.sub(r'\D', '', s)
    m = re.match(r'^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$', s)
    if m: dd, mm, aa = int(m[1]), int(m[2]), int(m[3])
    elif len(d) == 8: dd, mm, aa = int(d[:2]), int(d[2:4]), int(d[4:])
    else:
        aviso(f'data que não entendi ({onde}): "{s}"'); return None
    if aa < 100: aa += 2000
    for tentativa in range(4):
        try:
            r = dt.date(aa, mm, dd - tentativa).isoformat()
            if tentativa: aviso(f'data inexistente ({onde}): "{s}" → usei {r}')
            elif not m: aviso(f'data digitada sem barras ({onde}): "{s}" → {r}')
            return r
        except ValueError: continue
    aviso(f'data inválida ({onde}): "{s}"'); return None

def hora(v):
    if v is None or v == '': return None
    if isinstance(v, dt.datetime): v = v.time()
    if isinstance(v, dt.time): return f'{v.hour:02d}:{v.minute:02d}'
    if isinstance(v, dt.timedelta): m = int(v.total_seconds() // 60); return f'{(m // 60) % 24:02d}:{m % 60:02d}'
    if isinstance(v, (int, float)):
        m = round(float(v) % 1 * 1440); return f'{(m // 60) % 24:02d}:{m % 60:02d}'
    m = re.match(r'^(\d{1,2})[:h](\d{2})', str(v).strip())
    return f'{int(m[1]):02d}:{m[2]}' if m else None

def numero(v):
    if v is None or v == '': return None
    if isinstance(v, (int, float)): return round(float(v), 2) or None
    s = str(v).replace('R$', '').strip()
    s = s.replace('.', '').replace(',', '.') if ',' in s else s
    try: return round(float(s), 2)
    except ValueError: return None

def cpf_fmt(v):
    d = re.sub(r'\D', '', str(v or ''))
    if not d: return None
    d = d.zfill(11) if len(d) < 11 else d
    return f'{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}' if len(d) == 11 else str(v)
def cpf_ok(c):
    d = re.sub(r'\D', '', c or '')
    if len(d) != 11 or d == d[0] * 11: return False
    for n in (9, 10):
        s = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        if (s * 10) % 11 % 10 != int(d[n]): return False
    return True

REG = {'matriz': 'Matriz', 'filial': 'Filial', 'up': 'Upgrade', 'upgrade': 'Upgrade', 's r': 'Sem registro', 'sr': 'Sem registro', 'sem registro': 'Sem registro'}
def registro(v): return REG.get(norm(v)) if v else None
def horario(v):
    v = limpo(v)
    if not v: return None
    h = re.findall(r'\d{1,2}:\d{2}', v)
    return f'{h[0].zfill(5)} às {h[1].zfill(5)}' if len(h) == 2 else v
def descanso(v):
    n = norm(v)
    return None if not n else 'Sábado e domingo' if 'sab' in n else 'Domingo' if 'dom' in n else limpo(v)
ACENTO = {'maquina': 'máquina', 'maquinas': 'máquinas', 'logistica': 'logística', 'expedicao': 'expedição', 'producao': 'produção', 'tecnico': 'técnico',
          'automatico': 'automático', 'pcp': 'PCP', 'cnc': 'CNC', 'nc': 'NC', 'mig': 'MIG', 'tig': 'TIG', 'adm': 'administrativo', 'of': 'Of.', 'rh': 'RH'}
def funcao(v):
    v = limpo(v)
    if not v: return None
    s = sem(v).replace('"', ' ').replace("'", ' ')
    s = re.sub(r'\bop\.?\s', 'operador ', s, flags=re.I); s = re.sub(r'\bprep\.?\s', 'preparador ', s, flags=re.I)
    s = re.sub(r'\baux\.?\s', 'auxiliar ', s, flags=re.I); s = re.sub(r'\bassist\.?\s', 'assistente ', s, flags=re.I)
    s = re.sub(r'\bcoord\.?\s', 'coordenador ', s, flags=re.I)
    w = [x for x in re.split(r'\s+', s.lower().strip()) if x]
    out = []
    for i, x in enumerate(w):
        x2 = ACENTO.get(x.strip('.'), x)
        out.append(x2 if x2 != x or (x in PART and i) else (x2 if x2.isupper() else x2.capitalize()))
    r = ' '.join(out).replace(' De ', ' de ').replace(' Da ', ' da ').replace(' Do ', ' do ')
    return re.sub(r'\b([abc])$', lambda m: m[1].upper(), r)
SETORES = {'administracao': 'Administrativo', 'administrativo': 'Administrativo', 'logistica': 'Logística', 'pcp': 'PCP', 'expedicao': 'Expedição',
           'producao': 'Produção', 'manutencao': 'Manutenção', 'almoxarifado': 'Almoxarifado', 'qualidade': 'Qualidade', 'montagem': 'Montagem',
           'engenharia': 'Engenharia', 'copa': 'Copa', 'upgrade': 'Upgrade'}
def setor(v):
    v = limpo(v)
    if not v or re.search(r'\d{1,2}:\d{2}', v) or registro(v) in ('Matriz', 'Filial', 'Sem registro'): return None   # turno ou registro na coluna errada
    return SETORES.get(norm(v)) or nome_bonito(v.title() if v.isupper() else v)

# ------------------------------------------------------------------ pessoas
pessoas = []          # cada uma: dict com 'nome', 'tk', 'cpf', campos e 'privado'
def casar(nome, cpf=None, so_forte=False):
    """devolve a pessoa (ou None): CPF igual > nome igual > nome compatível (abreviado) único"""
    if cpf:
        d = re.sub(r'\D', '', cpf)
        for p in pessoas:
            if p.get('cpf') and re.sub(r'\D', '', p['cpf']) == d: return p
    t = toks(nome)
    if not t: return None
    iguais = [p for p in pessoas if p['tk'] == t] or [p for p in pessoas if sorted(p['tk']) == sorted(t)]
    if len(iguais) == 1: return iguais[0]
    if len(iguais) > 1:
        at = [p for p in iguais if p.get('situacao') != 'desligado']
        return (at or iguais)[0]
    cand = []
    for p in pessoas:
        a, b = sorted((t, p['tk']), key=len)
        if a[0] != b[0] or a[-1] != b[-1] or len(a) < 2: continue
        j, ok = 1, True
        for x in a[1:-1]:
            achou = False
            while j < len(b) - 1:
                y = b[j]; j += 1
                if y == x or (len(x) == 1 and y[0] == x): achou = True; break
            ok = ok and achou
        if ok: cand.append(p)
    if len(cand) == 1: return cand[0]
    if len(cand) > 1:
        at = [p for p in cand if p.get('situacao') != 'desligado']
        if len(at) == 1: return at[0]
        aviso(f'nome ambíguo "{nome}": {[p["nome"] for p in cand]}')
        return None
    if so_forte: return None
    # primeiro nome + último nome dentro do outro (ex.: "Maria Souza")
    cand = [p for p in pessoas if p['tk'][0] == t[0] and t[-1] in p['tk'] and len(t) >= 2]
    return cand[0] if len(cand) == 1 else None

def nova(nome, origem):
    p = {'chave': f'p{len(pessoas) + 1}', 'nome': nome_bonito(nome), 'tk': toks(nome), 'origens': [origem], 'privado': {}}
    pessoas.append(p)
    return p
def poe(p, k, v, forte=False):
    if v is None or v == '': return
    if forte or p.get(k) in (None, ''): p[k] = v
def poe_pr(p, k, v, forte=False):
    if v is None or v == '': return
    if forte or p['privado'].get(k) in (None, ''): p['privado'][k] = v

def abrir(arq): return openpyxl.load_workbook(PASTA + arq, data_only=True, read_only=True)
def linhas(ws): return [list(r) for r in ws.iter_rows(values_only=True)]

REL = 'Relação de Funcionários - Copia.xlsm'
wb = abrir(REL)
# ---- Banco de dados (todas as pessoas, 53 colunas)
L = linhas(wb['Banco de dados'])
ocorr_sem_data = defaultdict(list)
ocorrencias, asos = [], []
TIPO_OC = {'advertencia verbal': 'verbal', 'advertencia formal': 'escrita', 'advertencia escrita': 'escrita', 'suspensao': 'suspensao'}
n_banco = 0
for r in L[2:]:
    r = r + [None] * (53 - len(r))
    if not limpo(r[0]): continue
    n_banco += 1
    cpf = cpf_fmt(r[10])
    p = casar(r[0], cpf, so_forte=True)
    if p:
        aviso(f'Banco de dados: "{r[0]}" aparece 2 vezes (junto as duas linhas; a última vale)')
    else: p = nova(r[0], 'banco')
    sit = norm(r[47])
    poe(p, 'situacao', 'ativo' if sit == 'ativo' else 'desligado' if sit == 'inativo' else None, True)
    poe(p, 'funcao', funcao(r[1]), True); poe(p, 'admissao', data(r[2], f'{r[0]} admissão'), True)
    poe_pr(p, 'celular', limpo(r[3])); poe(p, 'matricula_esocial', limpo(r[4])); poe(p, 'matricula', limpo(r[4]))
    if r[6]: p['cbo'] = str(r[6])
    poe_pr(p, 'salario', numero(r[8]), True); poe_pr(p, 'rg', limpo(r[9])); poe_pr(p, 'cpf', cpf); p['cpf'] = cpf or p.get('cpf')
    poe_pr(p, 'titulo_eleitor', limpo(r[11])); poe_pr(p, 'reservista', limpo(r[12])); poe_pr(p, 'email', (limpo(r[13]) or '').lower() or None)
    poe_pr(p, 'nascimento', data(r[14], f'{r[0]} nascimento')); poe_pr(p, 'naturalidade', nome_bonito(r[16])); poe_pr(p, 'uf_nascimento', (limpo(r[17]) or '').upper()[:2] or None)
    poe_pr(p, 'instrucao', limpo(r[18])); poe_pr(p, 'banco', limpo(r[19]))
    ex = data(r[20], f'{r[0]} exame')
    if ex: asos.append({'pessoa': p, 'tipo': 'Periódico', 'data_exame': ex, 'periodicidade_meses': 12, 'obs': 'Importado da planilha (Exame médico)'})
    poe_pr(p, 'endereco', limpo(r[22])); poe_pr(p, 'numero', limpo(r[23])); poe_pr(p, 'complemento', limpo(r[24])); poe_pr(p, 'bairro', limpo(r[25])); poe_pr(p, 'cep', limpo(r[26]))
    poe(p, 'horario', horario(r[27])); poe(p, 'descanso', descanso(r[28])); p['superior_cargo'] = limpo(r[29])
    poe_pr(p, 'uniforme', limpo(r[30])); poe_pr(p, 'calcado', limpo(r[31])); poe_pr(p, 'chave_celular', limpo(r[32])); poe_pr(p, 'chave_vestiario', limpo(r[33]))
    for k in range(3):
        d, mot, acao = r[34 + 3 * k], limpo(r[35 + 3 * k]), limpo(r[36 + 3 * k])
        if not (d or mot or acao): continue
        tipo = next((v for c, v in TIPO_OC.items() if c in norm(acao)), 'escrita')
        dd = data(d, f'{r[0]} ocorrência {k + 1}')
        if dd: ocorrencias.append({'pessoa': p, 'tipo': tipo, 'data_ocorrencia': dd, 'assunto': mot or acao, 'descricao': f'{mot or ""}{" — " + acao if acao else ""}'.strip(' —')})
        else: ocorr_sem_data[p['chave']].append(f'{mot or ""} ({acao or ""})')
    poe_pr(p, 'obs', limpo(r[43]))
    poe(p, 'demissao', data(r[44], f'{r[0]} demissão'), True); poe(p, 'motivo_demissao', limpo(r[45]), True); poe_pr(p, 'indicacao', limpo(r[46]))
    poe(p, 'registro', registro(r[49])); poe_pr(p, 'emergencia_nome', limpo(r[50])); poe_pr(p, 'emergencia_fone', limpo(r[51])); poe_pr(p, 'telefone_corp', limpo(r[52]))
for p in pessoas:
    if ocorr_sem_data.get(p['chave']):
        p['privado']['obs'] = ((p['privado'].get('obs') or '') + '\nOcorrências sem data na planilha: ' + '; '.join(ocorr_sem_data[p['chave']])).strip()

# ---- Relação_ativos (setor, turno, registro, código, função, salário e o período aquisitivo digitado)
n_ativos = 0
for r in linhas(wb['Relação_ativos'])[2:]:
    r = r + [None] * 14
    if not limpo(r[4]) or not isinstance(r[6], (dt.datetime, dt.date)): continue
    n_ativos += 1
    p = casar(r[4]) or nova(r[4], 'relacao_ativos')
    if 'relacao_ativos' not in p['origens']: p['origens'].append('relacao_ativos')
    p['situacao'] = 'ativo'; p['demissao'] = None; p['motivo_demissao'] = None
    poe(p, 'setor', setor(r[0]), True); poe(p, 'horario', horario(r[1]), True); poe(p, 'registro', registro(r[2]), True); poe(p, 'matricula', limpo(r[3]), True)
    poe(p, 'funcao', funcao(r[5]), True); poe(p, 'admissao', data(r[6], f'{r[4]} admissão'), True); poe_pr(p, 'salario', numero(r[7]), True)
    aq = data(r[8], f'{r[4]} período aquisitivo')
    if aq and p.get('admissao') and aq < p['admissao']:
        aviso(f'Relação ativos: período aquisitivo de "{r[4]}" ({aq}) é antes da admissão ({p["admissao"]}) — usei a admissão')
    elif aq and aq != p.get('admissao'): p['ferias_base'] = aq

# ---- Relação_inativos
n_inat = 0
for r in linhas(wb['Relação_inativos'])[1:]:
    r = r + [None] * 14
    if not limpo(r[4]): continue
    n_inat += 1
    p = casar(r[4]) or nova(r[4], 'relacao_inativos')
    if 'relacao_inativos' not in p['origens']: p['origens'].append('relacao_inativos')
    if p.get('situacao') != 'ativo': p['situacao'] = 'desligado'
    poe(p, 'registro', registro(r[0])); poe(p, 'setor', setor(r[1]) or setor(r[0])); poe(p, 'horario', horario(r[2]) or horario(r[1])); poe(p, 'funcao', funcao(r[5]))
    poe(p, 'admissao', data(r[6], f'{r[4]} admissão')); poe_pr(p, 'salario', numero(r[7]))
    if p['situacao'] == 'desligado':
        poe(p, 'demissao', data(r[8], f'{r[4]} demissão')); poe(p, 'motivo_demissao', limpo(r[9]))

# ---- Consolidado (cadastro da contabilidade: documentos completos)
n_cons = 0
for r in linhas(wb['Consolidado'])[1:]:
    r = r + [None] * 37
    if not limpo(r[1]): continue
    n_cons += 1
    cpf = cpf_fmt(r[23])
    p = casar(r[1], cpf) or nova(r[1], 'consolidado')
    if 'consolidado' not in p['origens']: p['origens'].append('consolidado')
    if not p.get('situacao'): p['situacao'] = 'desligado' if r[14] else 'ativo'
    if r[14] and p['situacao'] == 'desligado': poe(p, 'demissao', data(r[14], f'{r[1]} saída'))
    poe(p, 'admissao', data(r[13], f'{r[1]} admissão')); poe(p, 'funcao', funcao(r[16])); poe_pr(p, 'salario', numero(r[15]))
    if r[17] and not p.get('cbo'): p['cbo'] = str(r[17])
    end = limpo(r[2])
    if end and not p['privado'].get('endereco'):
        partes = [x.strip() for x in end.split(',')]
        poe_pr(p, 'endereco', partes[0]); poe_pr(p, 'numero', partes[1] if len(partes) > 1 else None)
        if len(partes) > 2: poe_pr(p, 'bairro', partes[2])
        if len(partes) > 3: poe_pr(p, 'cidade', partes[3])
        cep = re.search(r'\d{5}-?\d{3}', end); poe_pr(p, 'cep', cep[0] if cep else None)
    poe_pr(p, 'telefone_fixo', limpo(r[3])); poe_pr(p, 'celular', limpo(r[4])); poe_pr(p, 'mae', nome_bonito(r[5])); poe_pr(p, 'pai', nome_bonito(r[6]))
    poe_pr(p, 'nascimento', data(r[7], f'{r[1]} nascimento')); poe_pr(p, 'pais_origem', limpo(r[8])); poe_pr(p, 'naturalidade', limpo(r[9]))
    tira = lambda v: re.sub(r'^\d+\s*-\s*', '', limpo(v) or '') or None
    poe_pr(p, 'raca_cor', tira(r[10])); poe_pr(p, 'sexo', limpo(r[11])); poe_pr(p, 'estado_civil', tira(r[12])); poe_pr(p, 'nacionalidade', tira(r[18]))
    poe_pr(p, 'ctps', limpo(r[19])); poe_pr(p, 'titulo_eleitor', limpo(r[20])); poe_pr(p, 'pis', limpo(r[21])); poe_pr(p, 'rg', limpo(r[22])); poe_pr(p, 'cpf', cpf)
    if cpf and not p.get('cpf'): p['cpf'] = cpf
    poe_pr(p, 'cnh', limpo(r[24])); poe_pr(p, 'cnh_categoria', limpo(r[25])); poe_pr(p, 'cnh_validade', data(r[28], f'{r[1]} validade CNH'))
    poe_pr(p, 'reservista', limpo(r[29])); poe_pr(p, 'categoria_militar', limpo(r[30])); poe_pr(p, 'rg_orgao', limpo(r[31])); poe_pr(p, 'rg_uf', limpo(r[33]))
    poe_pr(p, 'rg_emissao', data(r[34], f'{r[1]} emissão RG')); poe(p, 'matricula_esocial', limpo(r[35]))
    if norm(r[36]) == 'upgrade': poe(p, 'registro', 'Upgrade')

# ---- PROCESSOS
processos = []
for r in linhas(wb['PROCESSOS'])[1:]:
    r = r + [None] * 5
    if not limpo(r[0]): continue
    p = casar(r[0])
    processos.append({'chave': p['chave'] if p else None, 'autor': nome_bonito(r[0]), 'numero': limpo(r[1]), 'data_autuacao': data(r[2], f'processo {r[0]}'),
                      'advogado': limpo(r[3]), 'cnpj_advogado': limpo(r[4])})
    if not p: aviso(f'Processo: autor "{r[0]}" não está no cadastro (fica só o nome)')

# ---- setores e funções da "Tabela Geral"
tg = linhas(wb['Tabela Geral'])
setores_tg = [setor(r[0]) for r in tg[1:] if r and r[0]]
funcoes_tg = [funcao(r[1]) for r in tg[1:] if len(r) > 1 and r[1]]

# ------------------------------------------------------------------ horas extras
HE = 'Planilha de Horas Extras - Rev.1 - Copia.xlsm'
wb2 = abrir(HE)
sal_he = {}
for r in linhas(wb2['Colaboradores'])[3:]:
    r = r + [None] * 4
    if not limpo(r[0]): continue
    p = casar(r[0])
    if not p:
        aviso(f'Colaboradores (horas extras): "{r[0]}" não está no cadastro — criei')
        p = nova(r[0], 'colaboradores_he'); p['situacao'] = 'ativo'; p['funcao'] = funcao(r[1])
    poe_pr(p, 'salario_he', numero(r[2]), True)
    if norm(r[3]) == 'upgrade': poe(p, 'registro', 'Upgrade')
ponto, sem_nome, n_lanc, n_lanc_vazio = [], Counter(), 0, 0
for r in linhas(wb2['Lançamentos'])[5:]:
    r = r + [None] * 8
    if not isinstance(r[0], (dt.datetime, dt.date)) or not limpo(r[1]): continue
    n_lanc += 1
    p = casar(r[1])
    if not p: sem_nome[limpo(r[1])] += 1; continue
    e, i1, i2, s = hora(r[3]), hora(r[4]), hora(r[5]), hora(r[6])
    if not (e or s): n_lanc_vazio += 1; continue
    if i1 and i2: d = {'e1': e, 's1': i1, 'e2': i2, 's2': s}
    else: d = {'e1': e, 's1': s, 'e2': None, 's2': None}
    ponto.append({'pessoa': p, 'data': data(r[0]), **d})
for n, q in sem_nome.items(): aviso(f'Horas extras: "{n}" ({q} lançamentos) não está no cadastro — lançamentos não importados')
feriados = {}
for r in linhas(wb2['Feriados'])[3:]:
    r = r + [None] * 3
    d = data(r[0])
    if d and limpo(r[1]): feriados.setdefault(d, limpo(r[1]))

# ------------------------------------------------------------------ matrizes
matrizes, plano = [], []
NIVEL = re.compile(r'^\s*(\d)\s*[-.]\s*(.+?)\s*$')
CAB = {'colaborador', 'funcionario', 'funcionarios'}
def ler_matriz(ws, nome, tipo, ordem):
    L = linhas(ws)
    h = next(i for i, r in enumerate(L) if any(norm(c) in CAB for c in r if isinstance(c, str)))
    cn = next(j for j, c in enumerate(L[h]) if isinstance(c, str) and norm(c) in CAB)
    ci = cn + 2
    itens_l = L[h]
    if not any(isinstance(c, str) and not re.match(r'^(hab|coluna)\s*\d+$', norm(c)) for c in itens_l[ci:]):
        itens_l = next(L[k] for k in range(h - 1, -1, -1) if sum(1 for c in L[k][ci:] if isinstance(c, str)) >= 2)
    cols = [j for j in range(ci, len(itens_l)) if isinstance(itens_l[j], str) and limpo(itens_l[j])]
    itens = [{'nome': limpo(itens_l[j])} for j in cols]
    legenda, setor_m, gestor, atual, resp = {}, None, None, None, None
    for r in L:
        for j, c in enumerate(r):
            if isinstance(c, str):
                m = NIVEL.match(c)
                if m and len(c) < 40: legenda[int(m[1])] = m[2].strip().rstrip('.')
                if norm(c) == 'setor': setor_m = next((limpo(x) for x in r[j + 1:] if limpo(x)), None)
                if 'gestor responsavel' in norm(c): gestor = next((limpo(x) for x in r[j + 1:] if limpo(x)), None)
                if 'atualiza' in norm(c): atual = next((data(x) for x in r[j + 1:] if isinstance(x, (dt.datetime, dt.date))), atual)
                if norm(c).startswith('responsavel'): resp = limpo(c.split(':', 1)[1]) if ':' in c else resp
                if norm(c) in ('realizado', 'planejado', 'nao requer') and j + 1 < len(r) and isinstance(r[j + 1], (int, float)): legenda[int(r[j + 1])] = limpo(c)
    niveis, pessoas_m = [], 0
    for r in L[h + 1:]:
        r = r + [None] * 60
        nm = limpo(r[cn])
        if not nm:
            if pessoas_m: break
            continue
        if norm(nm).startswith('planejamento') or norm(nm) in ('realizado', 'planejado', 'nao requer', 'legenda'): break
        p = casar(nm)
        if not p:
            aviso(f'Matriz "{nome}": "{nm}" não está no cadastro — criei como ativo (completar os dados)')
            p = nova(nm, 'matriz'); p['situacao'] = 'ativo'; p['funcao'] = funcao(r[cn + 1])
        pessoas_m += 1
        for k, j in enumerate(cols):
            v = r[j]
            if v is None or v == '': continue
            if isinstance(v, (int, float)) and 0 <= v <= 4: niveis.append({'pessoa': p, 'item': k + 1, 'nivel': int(v)})
            else: aviso(f'Matriz "{nome}": valor "{v}" de {nm} em "{itens[k]["nome"]}" não é nível (0 a 4)')
    leg = [{'nivel': k, 'txt': v[:1].upper() + v[1:]} for k, v in sorted(legenda.items())]
    matrizes.append({'nome': nome, 'tipo': tipo, 'setor': setor(setor_m) if setor_m else None, 'gestor': gestor, 'legenda': leg, 'aprovado_por': resp, 'aprovado_em': atual,
                     'ordem': ordem, 'itens': itens, 'niveis': niveis, '_pessoas': pessoas_m})
    # calendário do ano (só na planilha de treinamentos)
    for i, r in enumerate(L):
        if any(isinstance(c, str) and norm(c).startswith('planejamento de treinamentos') for c in r):
            ano = int(re.search(r'(20\d\d)', ' '.join(str(c) for c in r if c))[1])
            cab = L[i + 1]
            meses = {j: k + 1 for k, j in enumerate(j for j, c in enumerate(cab) if isinstance(c, str) and norm(c)[:3] in ('jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'))}
            ci_inst = next((j for j, c in enumerate(cab) if isinstance(c, str) and 'institui' in norm(c)), None)
            ci_mod = next((j for j, c in enumerate(cab) if isinstance(c, str) and 'modalidade' in norm(c)), None)
            for r2 in L[i + 2:]:
                r2 = r2 + [None] * 40
                tr = limpo(r2[1])
                if not tr: break
                for j, mes in meses.items():
                    if r2[j]:
                        dia = int(r2[j]) if isinstance(r2[j], (int, float)) else 1
                        plano.append({'treinamento': tr, 'data': dt.date(ano, mes, dia).isoformat(), 'modalidade': (limpo(r2[ci_mod]) or '').capitalize() or None if ci_mod is not None else None,
                                      'instituicao': limpo(r2[ci_inst]) if ci_inst is not None else None, 'matriz': nome,
                                      'status': 'realizado' if dt.date(ano, mes, dia) < dt.date.today() else 'planejado'})

wb3 = abrir('Plano de treinamentos e competencias-2026.xlsx')
ler_matriz(wb3['Matriz'], 'Treinamentos e competências — Produção Matriz/Filial', 'treinamento', 1)
ler_matriz(wb3['Suporte'], 'Treinamentos e competências — Suporte', 'treinamento', 2)
wb4 = abrir('Procedimentos_SGQ.xlsx')
ler_matriz(wb4['Planilha1'], 'Procedimentos do SGQ', 'procedimento', 1)
for i, (arq, nome) in enumerate([('Versatilidade - Produção - Matriz - 2026.xlsx', 'Versatilidade — Produção Matriz'), ('Versatilidade - Produção - Filial-  2026.xlsx', 'Versatilidade — Produção Filial'),
                                 ('Versatilidade - Expedição - 2026.xlsx', 'Versatilidade — Expedição'), ('Versatilidade - Administrativo - 2026.xlsx', 'Versatilidade — Administrativo'),
                                 ('Versatilidade - Qualidade - Depto Técnico 2025.xlsx', 'Versatilidade — Qualidade e Depto. Técnico')]):
    w = abrir(arq)
    ler_matriz(w[w.sheetnames[0]], nome, 'versatilidade', i + 1)

# ------------------------------------------------------------------ cargos (funções) e organograma
ORG = [('Gerente Geral', None, 'Administrativo'), ('Gerente Técnico', 'Gerente Geral', 'Engenharia'), ('Gerente Comercial', 'Gerente Geral', 'Administrativo'),
       ('Gerente de Produção', 'Gerente Geral', 'Produção'), ('Coordenador de Logística', 'Gerente Comercial', 'Logística'),
       ('Líder de Produção', 'Gerente de Produção', 'Produção'), ('Assistente Administrativo', 'Gerente Geral', 'Administrativo'),
       ('Inspetor Técnico de Qualidade', 'Gerente Geral', 'Qualidade')]
def chefe_da_funcao(f):
    n = norm(f)
    regras = [(('inspetor', 'qualidade'), 'Inspetor Técnico de Qualidade'), (('soldador',), 'Gerente de Produção'), (('pintor',), 'Gerente de Produção'),
              (('montag',), 'Gerente de Produção'), (('motorista',), 'Coordenador de Logística'), (('expedic',), 'Coordenador de Logística'),
              (('pcp',), 'Coordenador de Logística'), (('almox',), 'Coordenador de Logística'), (('vend',), 'Gerente Comercial'), (('compr',), 'Gerente Comercial'),
              (('tecnico',), 'Gerente Técnico'), (('mecanic',), 'Gerente Técnico'), (('eletric',), 'Gerente Técnico'), (('ferrament',), 'Gerente Técnico'),
              (('copeir',), 'Assistente Administrativo'), (('administr',), 'Gerente Geral'), (('preparador',), 'Líder de Produção'),
              (('operador',), 'Líder de Produção'), (('ajudante',), 'Líder de Produção'), (('auxiliar',), 'Líder de Produção'), (('programador',), 'Líder de Produção')]
    for chaves, c in regras:
        if any(k in n for k in chaves): return c
    return 'Gerente Geral'
cargos = {norm(c): {'nome': c, 'superior': s, 'setor': st, 'cbo': None} for c, s, st in ORG}
cbos = defaultdict(Counter)
for p in pessoas:
    if p.get('funcao') and p.get('cbo'): cbos[norm(p['funcao'])][p['cbo']] += 1
for f in [p.get('funcao') for p in pessoas if p.get('situacao') == 'ativo'] + funcoes_tg:
    if not f or norm(f) in cargos: continue
    setores_f = Counter(p.get('setor') for p in pessoas if p.get('funcao') and norm(p['funcao']) == norm(f) and p.get('setor'))
    cargos[norm(f)] = {'nome': f, 'superior': chefe_da_funcao(f), 'setor': setores_f.most_common(1)[0][0] if setores_f else None, 'cbo': None}
for k, c in cargos.items():
    if cbos.get(k): c['cbo'] = cbos[k].most_common(1)[0][0]
for c in cargos.values():
    if c['superior'] and norm(c['superior']) == norm(c['nome']): c['superior'] = None
for p in pessoas:
    if p.get('funcao') and norm(p['funcao']) in cargos: p['cargo'] = cargos[norm(p['funcao'])]['nome']

# chefe direto (pessoa): quando o "Superior Direto" da planilha aponta um cargo que só uma pessoa ativa tem
ativos = [p for p in pessoas if p.get('situacao') == 'ativo']
for p in pessoas:
    sc = p.pop('superior_cargo', None)
    if not sc or p.get('situacao') != 'ativo': continue
    alvo = funcao(sc)
    quem = [q for q in ativos if q is not p and q.get('funcao') and (norm(q['funcao']) == norm(alvo) or set(toks(alvo)) <= set(toks(q['funcao'])))]
    if len(quem) == 1: p['superior'] = quem[0]['chave']

# ------------------------------------------------------------------ conferências e saída
cpfs = Counter(re.sub(r'\D', '', p['privado']['cpf']) for p in pessoas if p['privado'].get('cpf'))
for p in pessoas:
    c = p['privado'].get('cpf')
    if not c: continue
    if cpfs[re.sub(r'\D', '', c)] > 1:
        aviso(f'CPF {c[:3]}.***: repetido em mais de uma pessoa — tirei de "{p["nome"]}" (situação {p.get("situacao")}) para não travar; confira')
        cpfs[re.sub(r'\D', '', c)] -= 1; p['privado']['obs'] = ((p['privado'].get('obs') or '') + f'\nCPF na planilha: {c} (repetido em outra pessoa)').strip(); del p['privado']['cpf']
    elif not cpf_ok(c): aviso(f'CPF de "{p["nome"]}" não confere os dígitos ({c[:3]}.***) — importei assim; corrija no cadastro')
for p in pessoas:
    p.setdefault('situacao', 'ativo')
    if p['situacao'] == 'desligado' and not p.get('demissao'): aviso(f'"{p["nome"]}" está inativo sem data de demissão')
    if p['situacao'] == 'ativo' and not p.get('admissao'): aviso(f'"{p["nome"]}" está ativo sem data de admissão')

def sai_p(p):
    o = {k: p.get(k) for k in ('chave', 'nome', 'funcao', 'cargo', 'setor', 'registro', 'matricula', 'matricula_esocial', 'admissao', 'demissao', 'motivo_demissao',
                              'situacao', 'horario', 'descanso', 'ferias_base', 'superior')}
    o['privado'] = p['privado']
    return o
historico = [{'chave': p['chave'], 'vigencia': p['admissao'], 'cargo': p.get('funcao'), 'salario': p['privado'].get('salario'), 'motivo': 'Admissão', 'setor': p.get('setor'),
              'obs': 'Importado da planilha (salário atual)' if p['situacao'] == 'ativo' else 'Importado da planilha (último salário)'} for p in pessoas if p.get('admissao')]
setores_usados = sorted({p['setor'] for p in pessoas if p.get('setor')} | {x for x in setores_tg if x})
saida = {
    'setores': [{'nome': s} for s in setores_usados],
    'cargos': sorted(cargos.values(), key=lambda c: c['nome']),
    'pessoas': [sai_p(p) for p in pessoas],
    'historico': historico,
    'ponto': [{'chave': x['pessoa']['chave'], 'data': x['data'], 'e1': x['e1'], 's1': x['s1'], 'e2': x['e2'], 's2': x['s2']} for x in ponto],
    'feriados': [{'data': d, 'nome': n} for d, n in sorted(feriados.items())],
    'matrizes': [{**{k: v for k, v in m.items() if k not in ('niveis', '_pessoas')}, 'niveis': [{'chave': n['pessoa']['chave'], 'item': n['item'], 'nivel': n['nivel']} for n in m['niveis']]} for m in matrizes],
    'plano': plano,
    'asos': [{'chave': a['pessoa']['chave'], **{k: v for k, v in a.items() if k != 'pessoa'}} for a in asos],
    'ocorrencias': [{'chave': o['pessoa']['chave'], **{k: v for k, v in o.items() if k != 'pessoa'}} for o in ocorrencias],
    'processos': processos,
    'config': {'jornada': {'previstas': [0, 9, 9, 9, 9, 8, 0]}},
}
# pontos repetidos (mesma pessoa e dia)
vistos, rep = set(), 0
for x in saida['ponto']:
    k = (x['chave'], x['data'])
    if k in vistos: rep += 1
    vistos.add(k)
if rep: aviso(f'Horas extras: {rep} lançamento(s) repetido(s) para a mesma pessoa no mesmo dia — fica o primeiro')
saida['avisos'] = avisos
saida['ponto'] = [[x['chave'], x['data'], x['e1'], x['s1'], x['e2'], x['s2']] for x in saida['ponto']]
json.dump(saida, open(SAIDA, 'w', encoding='utf-8'), ensure_ascii=False, default=str, separators=(',', ':'))

at = [p for p in pessoas if p['situacao'] == 'ativo']
print(f'Banco de dados: {n_banco} linhas · Relação ativos: {n_ativos} · Relação inativos: {n_inat} · Consolidado: {n_cons}')
print(f'Pessoas: {len(pessoas)} ({len(at)} ativas, {len(pessoas) - len(at)} desligadas) · registro ativos: {dict(Counter(p.get("registro") for p in at))}')
print(f'Cargos: {len(cargos)} · Setores: {len(setores_usados)} · Histórico: {len(historico)}')
print(f'Horas extras: {n_lanc} lançamentos → {len(ponto)} importados ({n_lanc_vazio} sem horário) · Feriados: {len(feriados)} · salário HE: {sum(1 for p in pessoas if p["privado"].get("salario_he"))}')
for m in matrizes: print(f'Matriz "{m["nome"]}": {len(m["itens"])} colunas, {m["_pessoas"]} pessoas, {len(m["niveis"])} marcações, legenda {[x["nivel"] for x in m["legenda"]]}')
print(f'Plano do ano: {len(plano)} · Exames (ASO): {len(asos)} · Ocorrências: {len(ocorrencias)} · Processos: {len(processos)} · Chefe direto: {sum(1 for p in pessoas if p.get("superior"))}')
print(f'--- {len(avisos)} aviso(s) para conferir:')
for a in avisos: print(' •', a)
