# Painel WhatsApp Status — WAME API

Painel web (frontend + backend) para operar uma instância da WhatsApp API da
[WAME](https://wame.api.br) e, principalmente, **publicar imagens e vídeos em
Status (stories) com legenda**, escolhendo quem vê.

> Camada não oficial. Este painel integra a API da WAME e não é afiliado,
> endossado ou suportado pela WhatsApp ou pela Meta. O uso é de responsabilidade
> de quem publica.

---

## 1. O que está pronto

O projeto é **funcional de ponta a ponta**: rotas, telas, banco, integração com a
WAME e testes automatizados.

| Área | Estado |
|---|---|
| Banco (Postgres + Drizzle), 5 tabelas de negócio | Pronto, migration gerada |
| Cliente da API WAME (status, instância, contatos, mensagens) | Pronto |
| Rotas tRPC com escopo por dono | Pronto |
| Compositor de Status (imagem/vídeo/texto/áudio + legenda + audiência) | Pronto |
| Histórico, Contatos, Mensagens, Configurações, Visão geral | Pronto |
| Autenticação (e-mail/senha, sessão por cookie) | Pronto |
| `pnpm typecheck` | **0 erros** |
| `pnpm test` | **149 testes, 12 suítes, todas passando** |

### O que ainda falta para ir ao ar

Duas coisas dependem de **você**, não de código:

1. **A chave da API WAME.** O painel guarda a chave (mascarada em toda leitura),
   mas a chave real vem da sua conta WAME. Sem ela o painel abre, mas não publica.
2. **Variáveis de ambiente** — copie `.env.example` para `.env` e preencha
   `DATABASE_URL`, `JWT_SECRET` e as duas chaves de armazenamento
   (`APP_STORAGE_*`). Sem as de armazenamento, o envio de mídia falha.

---

## 2. Arquitetura

```
client/                  React 19 + Vite + Tailwind v4 + wouter
  src/pages/             as 9 telas do painel
  src/components/        shell (sidebar), InstanceProvider, estados de UI
  src/lib/               formatação (datas, bytes) e upload em 3 passos
  src/_core/             SDK da plataforma — NÃO editar
server/                  Hono + tRPC
  routers.ts             procedimentos finos (validação zod → db/serviços)
  db.ts                  todo acesso a dados, sempre filtrado por dono
  services/wame.ts       cliente HTTP da WAME (a chave só existe aqui)
  _core/                 SDK da plataforma — NÃO editar
shared/wame.ts           contrato da WAME compartilhado cliente ↔ servidor
shared/constants.ts      constantes compartilhadas
drizzle/schema.ts        schema do banco + migrations
```

### Duas decisões que valem explicar

**A chave da API nunca chega ao navegador.** A chave WAME é o segmento `{key}`
de *todas* as rotas (`https://server.wame.api.br/{key}/status/image`). Ela é
gravada no banco e usada apenas em `server/services/wame.ts`. Toda leitura passa
por `maskApiKey()`, então a interface só mostra `abcd••••••gh`. O navegador fala
com o nosso tRPC, nunca com a WAME.

**O corpo do Status é montado em um só lugar.** `buildStatusPayload()` em
`shared/wame.ts` monta o JSON exato de cada tipo. `statusJidList` só é enviado
quando o operador **estreita** a audiência: omitir o campo faz a API usar a
privacidade da própria instância (ou seja, "todos"), enquanto enviar uma lista
vazia publicaria para ninguém. Esse detalhe é a diferença entre "todos" e
"alguns", e está coberto por teste.

---

## 3. Modelo de dados

Um operador por conta; **toda tabela tem `user_id` e toda consulta filtra por
ele** — uma linha de outra conta não é legível nem gravável.

| Tabela | Para que serve |
|---|---|
| `whatsapp_instances` | Instância WAME: chave, servidor, webhooks, estado de conexão em cache |
| `status_posts` | Cada publicação: tipo, legenda, URL da mídia, audiência, estado, resposta da API |
| `contacts` | Agenda sincronizada da instância + contatos digitados à mão |
| `media_assets` | Imagem/vídeo/áudio enviado, com a URL pública entregue à WAME |
| `message_logs` | Mensagens diretas (texto/imagem) enviadas pela instância |

Um envio **falho** também é gravado (Estado `failed` + mensagem do provider) — é
exatamente a linha que o operador precisa para entender e refazer.

---

## 4. Endpoints da WAME usados

Conferidos contra a documentação oficial (`https://server.wame.api.br/docs/swagger.json`).

| Operação | Rota |
|---|---|
| Publicar Status (imagem / vídeo / texto / áudio) | `POST /{key}/status/{image,video,text,audio}` |
| Mencionar alguém num Status já publicado | `POST /{key}/status/mention` |
| Verificar conexão (barato, sem Graph API) | `GET /{key}/instance/health` |
| Detalhes / conectar por QR / webhooks / desconectar | `GET` · `POST` · `PUT` · `DELETE /{key}/instance` |
| Listar contatos | `GET /{key}/contacts` |
| Enviar mensagem | `POST /{key}/message/{text,image}` |

---

## 5. Rodando localmente

```bash
pnpm install
cp .env.example .env      # preencha DATABASE_URL e JWT_SECRET
pnpm db:migrate           # cria as tabelas
pnpm dev                  # API (3001) + web (3000) juntos
```

Verificações:

```bash
pnpm typecheck            # 0 erros
pnpm test                 # 149 testes
pnpm build && pnpm start  # build de produção (Hono serve o SPA + a API)
```

> As migrations vão por TCP (`drizzle.config.ts`). Se o seu Postgres for Neon,
> prefira a URL **direta** (sem pooler) para migrar.

---

## 6. Fluxo de trabalho em paralelo (branch / PR)

Como mais de uma pessoa (ou agente) mexe neste repositório, a regra é simples:
**ninguém comita direto na `main`.** A `main` é o que está entregue e testado.

### Preparar

```bash
git clone git@github.com:pablofonteneleadv/painel-whatsapp-status.git
cd painel-whatsapp-status
pnpm install
```

### Ciclo de trabalho

```bash
# 1. Traga o que mudou antes de começar — sempre
 git checkout main && git pull --rebase

# 2. Crie um branch curto e específico
git checkout -b feat/agendamento-de-status     # ou fix/, chore/, docs/

# 3. Trabalhe, comite pequeno
git add -A && git commit -m "feat: agenda publicação de status"

# 4. Antes de abrir o PR, releia o que você mudou
git fetch origin && git rebase origin/main
git diff --stat origin/main

# 5. Push e abra o PR (o GitHub mostra o link no retorno do push)
git push -u origin feat/agendamento-de-status
```

### Regras que evitam conflito

- **Um branch por assunto.** Branch que mistura duas frentes trava o rebase.
- **Rebase, não merge, na `main`:** mantém o histórico linear e o PR legível.
- **Rode `pnpm typecheck && pnpm test` antes de abrir o PR.** O typecheck limpo é
  o contrato: um erro de tipo no branch é um erro na `main` depois do merge.
- **Áreas de conflito provável** — combine antes de mexer em duas ao mesmo tempo:
  * `shared/wame.ts` (contrato da API; mudar aqui muda os dois lados),
  * `drizzle/schema.ts` (mudança de schema exige migration nova, nunca editar
    uma migration já aplicada),
  * `server/routers.ts` e `client/src/App.tsx` (todo mundo adiciona rota neles).
- **Nunca comite o `.env`.** Ele está no `.gitignore`; use o `.env.example` como
  referência de quais chaves existem.
- **Migration nova a cada mudança de schema:**
  ```bash
  # edite drizzle/schema.ts
  pnpm db:generate    # cria drizzle/migrations/000N_*.sql
  pnpm db:migrate
  ```

### Papéis sugeridos

| Branch | Quem mantém | O que aceita |
|---|---|---|
| `main` | protegido | só PR revisado e com `typecheck` + testes verdes |
| `feat/*` | quem está construindo | funcionalidade nova |
| `fix/*` | quem corrige | correção de bug, com teste que reproduz |

---

## 7. Fora de escopo (declarado)

Estes itens **não** estão implementados e são melhorias futuras, não bugs:

- **Execução de agendamento (cron).** O schema tem `scheduled_at`, mas não existe
  agendador neste projeto: nada dispara uma publicação sozinho. O fluxo real é
  "publicar agora". Para agendar, o caminho é um job externo (cron do servidor,
  GitHub Actions com `schedule`, ou um worker) chamando a rota de publicação.
- **Recebimento de webhooks.** Os webhooks são *configurados* na instância
  (`PUT /instance`), mas não há rota que os receba e processe eventos de entrada.
- **Campanhas em massa com templates da Meta**, canais Instagram/Messenger/Telegram,
  chamadas, grupos, catálogo e Pix.
- **Envio de e-mail e 2FA.** Não há provedor de e-mail configurado; a recuperação
  de senha e a verificação em duas etapas ficam para depois.

---

## 8. Convenções de código

- **`_core/` é intocável.** É o SDK do scaffold: autenticação, storage, conexão
  de banco e o cliente tRPC. O código de negócio **não** reimplementa sessão nem
  fala com o banco por fora de `server/db.ts`.
- **`server/services/README.md`** descreve o padrão para uma integração externa —
  `server/services/wame.ts` é o exemplo vivo dele.
- **Procedimentos finos.** Uma rota em `server/routers.ts` valida com zod, chama
  `server/db.ts` ou `server/services/*` e mapeia o erro para um `TRPCError` com
  mensagem acionável. Nenhuma consulta SQL mora no router.
- **Todo acesso a dados é escopado por dono.** `server/db.ts` recebe sempre o
  `userId` e filtra por ele; não existe consulta sem dono.
- **Testes.** `server/routers.test.ts` mocka os módulos `_core` que tocam banco ou
  ambiente, mas deixa `./_core/trpc` e `server/services/wame.ts` **reais** — é por
  isso que ele consegue verificar a URL, o método HTTP e o corpo JSON que a WAME
  receberia. Siga esse padrão ao testar uma rota nova: mocke a fronteira de I/O,
  nunca a lógica que você quer provar.

## Fluxo de sincronização (dois repositórios em paralelo)

- Remoto deste repo: `origin` (branch `main`). O repositório original de construção continua em paralelo.
- Trabalhe em branches de feature (`feature/<nome>`) e abra Pull Request para `main`.
- Para trazer mudanças de um lado ao outro: adicione o outro repo como remoto extra (`git remote add upstream <url>`), `git fetch upstream`, e aplique via `git cherry-pick` ou `git merge` em uma branch, nunca direto em `main`.
- Revise PRs antes do merge; nunca dê `push --force` em `main`.
