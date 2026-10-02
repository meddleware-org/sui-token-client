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
| `@meddleware/sui-token-client/deploy` | `deployToken`, `Executor`, `DeployStep` |
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
// result: { packageId, coinType, treasuryCapId, metadataCapId, currencyId, upgradeCapId?, digest, … }
```

Two transactions are signed: the publish (with the fee and the package policy) and the finalize
(currency registration, initial mint, supply and metadata policies, caps to the recipient).

## Rules

`assertTokenConfig` enforces, and `TOKEN_LIMITS` exposes for forms:

- package and module names: Move identifiers (`[a-z][a-z0-9_]*`, ≤ 64, not reserved); a module
  name may not be one the template module already uses (`TEMPLATE_IMPORTED_IDENTIFIERS`, e.g. `coin`,
  `transfer`) and a package name may not be a framework address (`sui`, `std`, …); the struct is
  the module name uppercased;
- symbol ≤ 32, name ≤ 64, description ≤ 256, icon URL ≤ 512 — printable ASCII without `"` or `\`;
- icons: `https://` or `ipfs://` (or none);
- decimals 0–18; initial supply × 10^decimals ≤ u64::MAX.

## Owned tokens

```ts
import { listMyTokens } from '@meddleware/sui-token-client'
const tokens = await listMyTokens(client, owner) // every page; throws past maxPages
```

A coin is listed for each owned `0x2::coin::TreasuryCap<T>` (exact type match).

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
