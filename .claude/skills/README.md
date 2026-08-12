# Skills instaladas para o Claude Code

Origem: `.agents/skills/` (formato neutro, usado por outros agentes). Este
diretório é a cópia adaptada ao Claude Code e **também é versionado** — as duas
árvores são artefatos distintos para runtimes distintos, não backup uma da
outra.

Ao alterar uma skill, decida onde a mudança pertence:

- Regra de conteúdo (o que a skill ensina) → edite `.agents/skills/` e
  propague para cá, reaplicando as adaptações da tabela abaixo.
- Adaptação de runtime (caminhos, tools, MCP) → edite só a cópia afetada.

Como as árvores divergem, verifique o desvio antes de commitar:

```bash
diff -rq .agents/skills .claude/skills
```

O resultado esperado é só a lista de arquivos desta tabela mais os `agents/`
removidos e o `FULL-GUIDE.md` renomeado. Qualquer outra diferença é drift.

| Skill | Origem | Adaptação aplicada |
| --- | --- | --- |
| `lex-editor-electron` | própria do projeto | rodapé de proveniência corrigido; seção de navegação graphify |
| `playwright` | upstream (Codex) | `$CODEX_HOME` → `.claude/skills`; preferência por `mcp__playwright__*`; aponta para a suíte `test:e2e` do repo |
| `security-best-practices` | upstream (Codex) | orientação graphify-first; `WebSearch`/`WebFetch`/`find-docs`; menção a "codex" removida |
| `security-threat-model` | upstream (Codex) | orientação graphify-first e uso do subagente `Explore` |
| `vercel-composition-patterns` | Vercel (MIT) | frontmatter em linha única; escopo React 19/Electron; `AGENTS.md` → `FULL-GUIDE.md` |
| `vercel-react-best-practices` | Vercel (MIT) | escopo React 19/Electron (sem Next.js/RSC); `AGENTS.md` → `FULL-GUIDE.md` |
| `web-design-guidelines` | Vercel | `argument-hint` movido para o topo do frontmatter |
| `writing-guidelines` | Vercel | `argument-hint` movido para o topo do frontmatter |
| `graphify` | instalada previamente | — |

Adaptações comuns a todas as cópias:

- `agents/openai.yaml` (manifesto de interface do Codex) removido — o Claude
  Code usa apenas `name` e `description` do frontmatter para acionar a skill.
- `AGENTS.md` interno das skills Vercel renomeado para `FULL-GUIDE.md`, para não
  competir com o `AGENTS.md` de contrato na raiz do repositório.

## Reinstalar após mudanças em `.agents/skills/`

```bash
cp -r .agents/skills/<nome> .claude/skills/<nome>
rm -rf .claude/skills/<nome>/agents
```

Reaplique as adaptações da tabela acima na cópia. Reinicie a sessão do Claude
Code para recarregar o catálogo de skills.
