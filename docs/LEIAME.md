# JAF Metal — Gestão

Sistema web (funciona no computador, tablet e celular, e pode ser instalado como aplicativo) que substitui a planilha **Almoxarifado.xlsm** e vai além: compras, fornecedores, máquinas e manutenção, ordens de produção, equipe, clientes, financeiro e relatórios.

## Como está organizado

| Pasta / arquivo | O que é |
|---|---|
| `index.html`, `src/`, `public/` | o site: React 19 + TypeScript, montado pelo Vite |
| `src/config.ts` | endereço e chave **publishable** do Supabase da JAF |
| `supabase/schema.sql` | o banco inteiro: tabelas, segurança por perfil e funções. Pode rodar de novo sem perder dados |
| `supabase/auth-simulado.sql` | só para o modo teste (imita o login do Supabase). **Nunca** rodar no Supabase |
| `src/lib/teste.ts`, `src/lib/demo.ts` | modo teste e dados **inventados** (arquivos públicos: nunca pôr dado real aqui). Só entram no build de teste |
| `src/lib/importar.ts` | leitura da planilha Almoxarifado (usada na tela de importação e nos testes) |
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
npm install
npm run dev
```
Abrir `http://localhost:5173/?modo=teste`. O modo teste roda um Postgres de verdade dentro do navegador (PGlite) com o **mesmo** `schema.sql`, com dados inventados. Logins: `dono`, `escritorio`, `almox`, `operador` — senha `teste1234`. `&banco=memoria` começa do zero a cada recarga.

## Situação do banco real

- `schema.sql` aplicado no Supabase da JAF e conferido com `testes/impressao.sql` (impressão digital igual à versão testada).
- Planilha do almoxarifado importada e conferida peça por peça (estoque e valores de cada ano iguais aos da planilha).
- Logins de Dono criados com **senha provisória**: o sistema obriga a criar outra (8+ caracteres) no primeiro acesso. Logins e senhas **nunca** vão para este repositório.
- Cadastro aberto bloqueado no banco (gatilho em `auth.users`): conta só nasce pelo próprio sistema. "Primeiro acesso" fechado.

Não importar a planilha de novo depois que o sistema virar o oficial (a importação substitui o almoxarifado).

## Testes

```bash
npm run tipos                 # TypeScript: nenhum erro de tipo
npm run teste:banco           # banco (134 conferências): perfis, estoque, PEPS, pedidos, financeiro, importação, segurança
npm run build:teste && npm run teste:telas   # roteiro pelas telas (105 × 2 tamanhos) e layout (4 tamanhos × 4 perfis)
# planilha real (fica só no computador): cada peça, movimentação, pedido e contato igual à planilha
PLANILHA=<caminho do .xlsm> node testes/importacao-real.mjs
```

## Publicar

`npm run build` monta a pasta `dist/` só com o sistema real (sem testes e sem o modo teste — o código dele nem entra) e o arquivo `_headers` de segurança. Publicar essa pasta. Os arquivos do app têm nome com "impressão digital": a cada versão o navegador pega o novo sozinho.
