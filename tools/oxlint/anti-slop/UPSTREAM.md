# anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Copied from: `skills/install-anti-slop/assets/anti-slop/` (identical to
  upstream `src/` minus the `*.test.ts` files), via the skill's
  `scripts/install.mjs`, on 2026-09-18.
- Installed paths: `tools/oxlint/anti-slop/index.ts` (plugin `anti-slop`) and
  `tools/oxlint/anti-slop/effect/index.ts` (plugin `anti-slop-effect`),
  registered in `.oxlintrc.json`.
- Dependencies: `@oxlint/plugins` pinned to `1.83.0`, the installed `oxlint`
  version.

## Local deviations

- `shared/dictionary-types.ts`: `unsafeMembers[0]` became
  `(unsafeMembers[0] ?? null)`, so the file type-checks under this repo's
  `noUncheckedIndexedAccess`. The guard above it already ensures the element
  exists, so behaviour is unchanged.
