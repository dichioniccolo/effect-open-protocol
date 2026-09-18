# Third-party skills

Vendored unchanged (Markdown only; Codex `agents/openai.y*ml` files, images and eval fixtures omitted).
Each directory carries its upstream MIT `LICENSE`.

| Skill | Upstream | Commit | License |
| --- | --- | --- | --- |
| `better-ui` | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) `skills/better-ui` | `267330e1adfc66a718fb65fa6918c1f06d0a689e` | MIT, Jakub Krehel |
| `better-typography` | jakubkrehel/skills `skills/better-typography` (required by `better-ui`) | `267330e1adfc66a718fb65fa6918c1f06d0a689e` | MIT, Jakub Krehel |
| `better-accessibility` | jakubkrehel/skills `skills/better-accessibility` (required by `better-ui`) | `267330e1adfc66a718fb65fa6918c1f06d0a689e` | MIT, Jakub Krehel |
| `better-layout` | jakubkrehel/skills `skills/better-layout` (required by `better-ui`) | `267330e1adfc66a718fb65fa6918c1f06d0a689e` | MIT, Jakub Krehel |
| `better-colors` | jakubkrehel/skills `skills/better-colors` (required by the three above) | `267330e1adfc66a718fb65fa6918c1f06d0a689e` | MIT, Jakub Krehel |
| `better-writing` | jakubkrehel/skills `skills/better-writing` (required by `better-typography`) | `267330e1adfc66a718fb65fa6918c1f06d0a689e` | MIT, Jakub Krehel |
| `emil-design-eng` | [emilkowalski/skills](https://github.com/emilkowalski/skills) `skills/emil-design-eng` | `85e8e2363b713506e1d5b6e07a0eb2da66be1bc3` | MIT, Emil Kowalski |
| `shadcn` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) `skills/shadcn` | `a87a63b2ca25143d26c8bd0903e4e9bc77b3f824` | MIT, shadcn |
| `migrate-radix-to-base` | shadcn-ui/ui `skills/migrate-radix-to-base` | `a87a63b2ca25143d26c8bd0903e4e9bc77b3f824` | MIT, shadcn |

`shadcn` runs `npx shadcn@latest info --json` when it loads, to inject project context, and pre-approves Bash for the shadcn CLI. Both are upstream behaviour, kept as is.

To update, re-copy from the upstream path at a newer commit and bump the table.
