# AGENTS.md — @meddleware/sui-token-client

## Package identity

| Field | Value |
| --- | --- |
| npm name | `@meddleware/sui-token-client` |
| Version | `0.0.1` |
| Licence | 0BSD |
| Type | TypeScript source package (declaration-only build) |
| Runtime targets | Node.js ≥ 22, browsers (via Vite) |
| Runtime dependencies | `@mysten/sui` `^2.33.1`, `@mysten/move-bytecode-template` `~0.4.1`, `fflate` `^0.8.3` |

## Layout

```text
src/
├── index.ts          — main entry: types, rules, type matching, builders, results, listMyTokens
├── types.ts          — TokenConfig, PublishResult, DeployedToken, OwnedObjectsClient
├── rules.ts          — Move/metadata rules, TOKEN_LIMITS, assertTokenConfig
├── typeNames.ts      — exact, normalised framework-type matching
├── transactions.ts   — publish and finalize PTB builders
├── results.ts        — toSuiTxResult, extractPublishResult (exact types, own package only)
├── tokens.ts         — listMyTokens (paged; throws past the limit)
├── template/         — subpath ./template: wasm set-up, patcher, GENERATED artifact.ts + files.ts
├── deploy.ts         — subpath ./deploy: deployToken, Executor, DeployStep
└── package.ts        — subpath ./package: buildPackageFiles, generatePackageZip
scripts/gen-template.mjs — writes/checks src/template/{artifact,files}.ts from @meddleware/sui-token-template
scripts/e2e-localnet.mjs — real deploy against `sui start --with-faucet --force-regenesis`
tests/                — vitest unit tests
```

## Commands

| Task | Command |
| --- | --- |
| Type-check | `npm run type-check` |
| Lint | `npm run lint` |
| Unit tests | `npm test` |
| Localnet deploy | `npm run e2e:localnet` (needs a local network) |
| Regenerate the template artefact | `npm run gen:template` |
| Check the artefact | `npm run check:template` |
| Build `.d.ts` | `npm run build` |

## Rules for agents

- Read [CLAUDE.md](CLAUDE.md) first; its invariants are binding.
- Never hand-edit `src/template/artifact.ts` or `src/template/files.ts`; bump the exact
  `@meddleware/sui-token-template` devDependency and run `npm run gen:template`.
- Releases: bump `version`, push, tag `v<version>`. `npm-publish.yml` publishes via npm trusted
  publishing.
