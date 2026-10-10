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
  identifier and default constant (text, decimals, `INITIAL_SUPPLY`, `FIXED_SUPPLY`, `FROZEN_METADATA`)
  exists once. CI runs `check:template`.
- **`@mysten/sui` is a peer dependency** (`^2.33.2`, also a devDependency for tests): the host shares one
  copy. `@mysten/move-bytecode-template` and `fflate` stay dependencies.
- **Generated files are rendered literally, in one pass.** `replaceMany` (function replacers only; never a
  replacement string, which would expand `$&`); `Move.lock` is the template's with only the root package
  line renamed; lookups keyed by a caller or node value use `Object.hasOwn`.
- **Template identifiers.** `TEMPLATE_IMPORTED_IDENTIFIERS` (rules.ts) must equal the shipped
  module's identifiers besides its own (`check:template` fails otherwise); module names avoid them.
- **One rule set.** `assertTokenConfig` (rules.ts) is called by the patcher, `deployToken` and the
  package generator. Decimals are 0–18 everywhere; text fields are printable ASCII without `"` or
  `\`, bounded by `TOKEN_LIMITS`; icons are `https://` or `ipfs://`.
- **Exact types.** Results and token listing compare parsed, normalised struct tags (typeNames.ts),
  never substrings. The coin is named by the one `0x2::coin_registry::Currency<T>` whose `T` is defined
  in the package the transaction published; its TreasuryCap, MetadataCap and initial `Coin<T>` pair with
  it by exact `T`.
- **Policies are applied by `init`, never by a later transaction.** The patched constants
  (`INITIAL_SUPPLY`, `FIXED_SUPPLY`, `FROZEN_METADATA`) make the coin's own `init` mint the supply,
  hand a fixed supply to the registry and delete a frozen `MetadataCap`, all in the publish transaction,
  so the registry records them and no cap exists to freeze or leak. The finalize transaction only
  registers the currency and moves what exists; `assertResultMatchesPolicy` stops the flow if what the
  publish created contradicts the policy. Do not add freezing or minting back to the finalize step.
- **The patched constant pool has no duplicates.** The verifier rejects a pool with equal entries, and
  patching creates them (symbol equal to name, empty strings, both flags false). `dedupeConstantPool`
  merges them and remaps `LdConst`; keep it the last step before serialising.
- **A published coin is never stranded or duplicated.** Every failure after the publish executed is a
  `PublishedError`: `DeployIncompleteError` (finish with `finalizeToken(pending)`),
  `DeployUnconfirmedError` (set up, not confirmed — do not retry) or a plain `PublishedError`
  (unreadable effects). Callers must never answer one with a fresh deploy.
- **No silent truncation.** `listMyTokens` reads every page or throws past `maxPages`, and throws when a
  wallet holds more than `maxHeldCoinTypes` packages' coins to check. It lists a coin for an owned
  TreasuryCap or MetadataCap, or for a held balance whose package the wallet published (the only way to find a
  fixed supply with frozen metadata, which has no capability); a failed lookup throws.
- **No environment reads.** No `import.meta.env`, no logging of transactions; the caller supplies the
  network, fee, treasury, gas budget and executor.
- **Wasm failures surface.** `initTemplateWasm` initialises once and rethrows a load failure (the next
  call retries). Browsers call `configureTemplateWasm(url | Response | bytes | Module)` first; Node
  needs nothing.

## Testing

`npm test` (vitest, 148 tests): rules, type matching (look-alike packages, nested generics, long-form
addresses), builders (exact PTB commands), result parsing, deploy flow with a mock executor, wasm
initialisation, patching, Walrus-URL icons, package generation, paged token listing.
`tests/abi-table.test.ts` fails if an exported builder is missing from the ABI table
(`tests/abi-table.ts`). `npm run test:integration` reads the public testnet and mainnet full nodes:
every framework call the builders make must exist with the same visibility, type-parameter and
parameter counts (trailing `TxContext` excluded), and the chain ids written into Published.toml
must match each network.
`npm run e2e:localnet` deploys real coins on a local network and checks the balance, the listing and the
generated package; a fixed-supply, frozen-metadata coin (no caps exist, the registry's `Currency` records
`Fixed` and a deleted metadata cap); a coin whose constants are equal (merged pool); recovery through
`finalizeToken`; and a second finalize that the chain refuses without effect.
