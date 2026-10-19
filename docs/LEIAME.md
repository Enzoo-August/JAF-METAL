# JAF Metal — Gestão

Sistema web (funciona no computador, tablet e celular, e pode ser instalado como aplicativo) que substitui a planilha **Almoxarifado.xlsm** e vai além: compras, fornecedores, máquinas e manutenção, ordens de produção, equipe, clientes, financeiro e relatórios.

## Como está organizado

| Pasta / arquivo | O que é |
|---|---|
| `index.html`, `css/`, `js/`, `assets/`, `manifest.webmanifest`, `sw.js` | o site (HTML/JS puro, sem build) |
| `js/config.js` | endereço e chave **publishable** do Supabase da JAF. Em branco = modo teste |
| `supabase/schema.sql` | o banco inteiro: tabelas, segurança por perfil e funções. Pode rodar de novo sem perder dados |
| `supabase/auth-simulado.sql` | só para o modo teste (imita o login do Supabase). **Nunca** rodar no Supabase |
| `js/demo.js` | dados **inventados** do modo teste (arquivo público: nunca pôr dado real aqui) |
| `js/importar.js` | leitura da planilha Almoxarifado (usada na tela de importação e nos testes) |
| `testes/` | testes automáticos (não precisa publicar) |

## Regras que o sistema segue

- **Estoque = soma das movimentações.** Nenhuma movimentação é apagada ou editada: corrigir é "Desfazer" (lança a contrária e fica no histórico).
- **PEPS**: cada entrada (nota) é um lote com o preço pago; a retirada sai do lote mais antigo e usa o preço dele — como a planilha fazia à mão (≈90% das saídas da planilha já seguiam isso).
- **"Comprar"** = estoque abaixo do mínimo (mesma regra da planilha). A sugestão completa até o máximo e desconta o que já está pedido.
- **Toda gravação passa por uma função do banco** que confere o perfil e os dados. As tabelas só têm regra de leitura (RLS) — não dá para burlar pelo navegador.
- Datas "de hoje" no fuso de São Paulo.
- Toque duplo / internet que cai no meio: o envio leva um identificador; o banco não lança duas vezes.

### Perfis
| Perfil | Vê / faz |
|---|---|
| Dono | tudo, inclusive acessos, importação e histórico de alterações |
| Escritório | tudo do dia a dia (financeiro, salários, compras, estoque, produção); não cria acessos |
| Almoxarifado | estoque, compras, fornecedores, máquinas, ordens; **sem** financeiro e salários |
| Produção | retirar peça, ver estoque **sem preços**, ordens (não entrega), chamados de máquina; só vê as próprias retiradas e desfaz até 2 h depois |

## Rodar no computador (teste)

```bash
python -m http.server 5319 --directory JAF-Metal
```
Abrir `http://localhost:5319/?modo=teste` (ou com `config.js` vazio). O modo teste roda um Postgres de verdade dentro do navegador (PGlite) com o **mesmo** `schema.sql`, com dados inventados. Logins: `dono`, `escritorio`, `almox`, `operador` — senha `teste1234`. `?banco=memoria` começa do zero a cada recarga.

## Situação do banco real

- `schema.sql` aplicado no Supabase da JAF e conferido com `testes/impressao.sql` (impressão digital igual à versão testada).
- Planilha do almoxarifado importada e conferida peça por peça (estoque e valores de cada ano iguais aos da planilha).
- Logins de Dono criados com **senha provisória**: o sistema obriga a criar outra (8+ caracteres) no primeiro acesso. Logins e senhas **nunca** vão para este repositório.
- Cadastro aberto bloqueado no banco (gatilho em `auth.users`): conta só nasce pelo próprio sistema. "Primeiro acesso" fechado.

Não importar a planilha de novo depois que o sistema virar o oficial (a importação substitui o almoxarifado).

## Testes

```bash
# banco (126 conferências): perfis, estoque, PEPS, pedidos, financeiro, importação, segurança
PGLITE=<pasta com node_modules/@electric-sql/pglite> node testes/banco.mjs
# planilha real (fica só no computador): estoque peça por peça e valores por ano iguais à planilha
PGLITE=<...> PLANILHA=<caminho do .xlsm> node testes/importacao-real.mjs
```
No navegador (modo teste), console:
```js
fetch('testes/roteiro-ui.js').then(r => r.text()).then(eval); roteiro()   // usa as telas como uma pessoa → window.__r
fetch('testes/auditoria.js').then(r => r.text()).then(eval); auditarPerfis({ sat: 47 })  // botão cortado/coberto, rolagem lateral
```
A cada mudança: trocar o `?v=` no `index.html` e o `CACHE` no `sw.js` (senão o navegador usa o arquivo velho).

## Publicar

`sh publicar.sh` monta a pasta `publicar/` só com o sistema real (sem testes e sem a demonstração) e o arquivo `_headers` de segurança. Publicar essa pasta. O modo teste só liga em `localhost`; no endereço publicado é impossível abrir.
