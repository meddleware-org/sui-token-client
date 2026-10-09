# @meddleware/sui-token-client

Deploy Sui coins from [`@meddleware/sui-token-template`](https://github.com/meddleware-org/sui-token-template)
without the Sui CLI: the Move rules, the compiled template and its patcher, the publish and finalize
transactions, publish-result parsing, owned-token discovery, and the downloadable source package.

## Install

```bash
npm install @meddleware/sui-token-client @mysten/sui
```

## Entry points

| Import | Contents |
| --- | --- |
| `@meddleware/sui-token-client` | `TokenConfig` and friends, `assertTokenConfig`, `TOKEN_LIMITS`, the identifier/supply/icon rules, `buildPublishTransaction`, `buildFinalizeTransaction`, `extractPublishResult`, `toSuiTxResult`, `listMyTokens`, exact type helpers |
| `@meddleware/sui-token-client/template` | `configureTemplateWasm`, `initTemplateWasm`, `patchTemplateModule`, `patchTokenModule`, the generated `TEMPLATE_*` artefact and `TEMPLATE_BUILD_INFO` |
| `@meddleware/sui-token-client/deploy` | `deployToken`, `finalizeToken`, `PublishedError`, `DeployIncompleteError`, `DeployUnconfirmedError`, `Executor`, `DeployStep` |
| `@meddleware/sui-token-client/package` | `buildPackageFiles`, `generatePackageZip` |

The main entry loads no wasm, bytecode or zip code, so lists and forms stay light.

## Deploy a coin

```ts
import { deployToken, toSuiTxResult } from '@meddleware/sui-token-client/deploy'
import { configureTemplateWasm } from '@meddleware/sui-token-client/template'
import wasmUrl from '@mysten/move-bytecode-template/web/move_bytecode_template_bg.wasm?url' // Vite

configureTemplateWasm(wasmUrl) // browsers only; Node loads its own wasm

const result = await deployToken({
  config,                       // a TokenConfig; checked with assertTokenConfig first
  network: 'testnet',
  sender,
  feeMist: 0n,
  feeTreasury,
  gasBudget: 500_000_000n,
  executor: {
    signAndExecute: async (tx) =>
      toSuiTxResult(await client.signAndExecuteTransaction({ signer, transaction: tx, include: { effects: true, objectTypes: true } })),
    waitForTransaction: async (digest) => void (await client.waitForTransaction({ digest })),
  },
  onStep: (step) => console.log(step),
})
// result: { packageId, coinType, treasuryCapId?, metadataCapId?, initialCoinId?, currencyId, upgradeCapId?, digest, … }
```

Two transactions are signed: the publish (with the fee and the package policy) and the finalize
(currency registration, and the coin's objects to the recipient). The coin's own `init` applies the
initial supply and the supply and metadata policies **in the publish transaction**: it mints the supply to
the publisher; a `fixed` supply is handed to the coin registry (no `TreasuryCap` exists, and the registry
reports the supply as fixed); `frozen` metadata deletes the `MetadataCap` (the registry reports it as
deleted). So `treasuryCapId` is absent for a fixed supply, `metadataCapId` for frozen metadata, and
`initialCoinId` is the minted coin. A fixed supply needs an initial supply above zero (the framework
refuses to fix an empty one). The `UpgradeCap` of an upgradeable package goes to the recipient too (the
publish transaction transfers it).


If the coin is published but the second signature (finalize) is refused or fails, `deployToken`
throws `DeployIncompleteError`. Its `pending` field finishes the setup later — offer the user a
retry:

```ts
import { DeployIncompleteError, finalizeToken } from '@meddleware/sui-token-client/deploy'

try {
  await deployToken({ /* … */ })
} catch (e) {
  // Safe to repeat even if the first attempt landed: it is rejected without effect (nothing is minted here).
  if (e instanceof DeployIncompleteError) await finalizeToken({ pending: e.pending, executor })
  else throw e
}
```

Until then the caps stay with the sender and the supply and metadata policies are not applied.

Every failure after the publish executed is a `PublishedError` (with `publishDigest`): never answer
one with a fresh deploy, which would publish a second coin. `DeployUnconfirmedError` means the
setup executed but was not confirmed — show its `result`; do not retry.

## Rules

`assertTokenConfig` enforces, and `TOKEN_LIMITS` exposes for forms:

- package and module names: Move identifiers (`[a-z][a-z0-9_]*`, ≤ 64, not reserved); a module
  name may not be one the template module already uses (`TEMPLATE_IMPORTED_IDENTIFIERS`, e.g. `coin`,
  `transfer`) and a package name may not be a framework address (`sui`, `std`, …); the struct is
  the module name uppercased;
- symbol ≤ 32, name ≤ 64, description ≤ 256, icon URL ≤ 512, package description ≤ 256, project
  name ≤ 64 — printable ASCII without `"` or `\`;
- icons: `https://` or `ipfs://` (or none);
- decimals 0–18; initial supply × 10^decimals ≤ u64::MAX.

## Owned tokens

```ts
import { listMyTokens } from '@meddleware/sui-token-client'
const tokens = await listMyTokens(client, owner) // every page; throws past maxPages
```

A coin is listed when the wallet owns its `0x2::coin::TreasuryCap<T>` (it can mint) or
`0x2::coin_registry::MetadataCap<T>` (it can edit), both matched by exact type; the entry carries the
`treasuryCapId` / `metadataCapId` it owns. A fixed supply with frozen metadata has neither (the registry holds
the supply and the cap was deleted), so a second rule lists it: the wallet holds a balance of the coin **and**
sent the transaction that published its package (one `getObject` and one `getTransaction` per held package;
SUI and system packages are skipped; a failed read throws rather than dropping a coin). A coin whose caps
went to a recipient is listed under the recipient; a coin the wallet merely received is not listed. Anyone can
send a `TreasuryCap` to an address (it has `store`); that is real control, so it lists, but it is not "deployed
by me". The result of `deployToken` is the authoritative record of what a session deployed.

## The template artefact

`src/template/artifact.ts` and `src/template/files.ts` are generated from the pinned
`@meddleware/sui-token-template` by `npm run gen:template`, which checks the template's recorded
hashes and a byte-exact round trip. `TEMPLATE_BUILD_INFO` records the toolchain and framework that
built the module.

## Development

```bash
npm test               # unit tests
npm run test:integration  # ABI drift + chain ids against public testnet and mainnet
npm run e2e:localnet   # real deploy on `sui start --with-faucet --force-regenesis`
npm run check:template # artefact matches the pinned template
```

## License

BSD Zero Clause License (`0BSD`). See [LICENSE](LICENSE).
