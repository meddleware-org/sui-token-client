# CLAUDE.md — @meddleware/sui-token-client

## What this package is

The client for [`@meddleware/sui-token-template`](https://github.com/meddleware-org/sui-token-template):
everything an app needs to deploy a Sui coin from the template without the Sui CLI — the Move and
metadata rules, the compiled template module and its patcher, the publish and finalize transactions,
publish-result parsing, owned-token discovery and the downloadable source package. Apps (the token
deployer) keep only their UI, wallet wiring and form messages.

## Architectural invariants

- **Entry points stay apart.** `.` carries no wasm, bytecode or fflate; `./template` holds the wasm
  set-up and the module; `./deploy` and `./package` import what they need. Do not re-export
  `./template` from `.`.
- **The template is pinned and generated.** `src/template/artifact.ts` (module + build info) and
  `src/template/files.ts` come only from `scripts/gen-template.mjs`, reading the exact
  `@meddleware/sui-token-template` devDependency. The generator checks the bytecode and source hashes
  against the package's `build-info.json`, a byte-exact decode/encode round trip, and that each
  identifier and default constant exists once. CI runs `check:template`.
- **One rule set.** `assertTokenConfig` (rules.ts) is called by the patcher, `deployToken` and the
  package generator. Decimals are 0–18 everywhere; text fields are printable ASCII without `"` or
  `\`, bounded by `TOKEN_LIMITS`; icons are `https://` or `ipfs://`.
- **Exact types.** Results and token listing compare parsed, normalised struct tags (typeNames.ts),
  never substrings. A TreasuryCap counts only if it is `0x2::coin::TreasuryCap<T>` and `T` is defined
  in the package the transaction published.
- **No silent truncation.** `listMyTokens` reads every page or throws past `maxPages`.
- **No environment reads.** No `import.meta.env`, no logging of transactions; the caller supplies the
  network, fee, treasury, gas budget and executor.
- **Wasm failures surface.** `initTemplateWasm` initialises once and rethrows a load failure (the next
  call retries). Browsers call `configureTemplateWasm(url | Response | bytes | Module)` first; Node
  needs nothing.

## Testing

`npm test` (vitest, 76 tests): rules, type matching (look-alike packages, nested generics, long-form
addresses), builders (exact PTB commands), result parsing, deploy flow with a mock executor, wasm
initialisation, patching, Walrus-URL icons, package generation, paged token listing.
`tests/abi-table.test.ts` fails if an exported builder is missing from the ABI table
(`tests/abi-table.ts`). `npm run test:integration` reads the public testnet and mainnet full nodes:
every framework call the builders make must exist with the same visibility, type-parameter and
parameter counts (trailing `TxContext` excluded), and the chain ids written into Published.toml
must match each network.
`npm run e2e:localnet` deploys a real coin on a local network and checks the balance, the listing and
the generated package.
