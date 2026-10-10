# Security Audit — `sui-token-client`

**Classification:** Internal security review (re-verified 2026-10-10 — awaiting external review)
**Project:** sui-token-client (`@meddleware/sui-token-client`) — the client for
`@meddleware/sui-token-template`. It covers:

- the Move and metadata rules;
- the generated template artefact and its bytecode patcher;
- the publish and finalize PTBs;
- exact-type publish-result parsing;
- the `deployToken` / `finalizeToken` orchestration, with typed post-publish errors;
- owned-token discovery;
- the downloadable source-package generator.

It is extracted from token-deployer-ui (workspace B7, 2026-10-02).

**Project type:** TS SDK (npm package; TypeScript source plus a declaration build) + a localnet e2e
script
**Template:**

- AUDIT_TEMPLATE.md (2026-10-08)
- AUDIT_TEMPLATE_SUI_CLIENT.md (2026-10-08)
- AUDIT_TEMPLATE_TS.md (2026-10-08)
- AUDIT_TEMPLATE_OPS.md (2026-10-08) — scoped to `scripts/e2e-localnet.mjs`, which signs on a local
  network only

Not triggered: SUI (no Move here — the template is `sui-token-template`'s audit), SEAL, WALRUS (icon
URLs are text; uploads live in token-deployer-ui), VUE, AUTH, IMG (no image), PROXY, WORKERS, the Go
and Rust lenses, SITE, PLATFORM.

**Deployment status:**

- npm `@meddleware/sui-token-client` **0.0.10** (`latest`), published from tag `v0.0.10` = `e70a5ab`,
  with an SLSA v1 provenance attestation (checked 2026-10-09). `main` is ahead of it: `fb7301b` (a
  Dependabot lockfile-only bump) and the 0.0.11 fix wave of 2026-10-10 (commit `994b951`; not yet released).
  Baseline of this audit: 0.0.5 at `6f09bb2`, 2026-10-02.
- Releases since the baseline: 0.0.6 `6d3b7c2`, 0.0.7 `bd58328`, 0.0.8 `75dd34a` (template 1.0.7
  regeneration), 0.0.9 `677330f` and 0.0.10 `e70a5ab` (both 2026-10-09; template 1.0.8).
- Pins `@meddleware/sui-token-template` **1.0.8** exactly in 0.0.10, so every coin it publishes applies its
  supply and metadata policies in its own `init` (closes F4). The 0.0.11 work pins **1.0.9** (adds the shipped
  `Move.lock`; `publish.sh` uses an `object_state` helper).
- Consumed by token-deployer-ui 0.0.35 (`^0.0.10`: `deployToken`, `finalizeToken`, `toSuiTxResult`,
  `listMyTokens`, `generatePackageZip`, `configureTemplateWasm`).
- The live path is the token deployer on testnet and mainnet: user wallets publish coins, and a fee
  goes to the operator treasury.
- `npm run e2e:localnet` passed on 2026-10-09 (including a fixed-supply coin with frozen metadata, an
  equal-constants publish, recovery and the capability-less listing).

**Review date:** 2026-10-03, re-verified 2026-10-09 and 2026-10-10
**Reviewer:** Internal review
**Severity ceiling:** High.

- The package builds transactions that publish user packages and move SUI (the fee).
- It produces **permanent** on-chain coin metadata (symbol, name, decimals) and policies (supply,
  metadata, upgradeability).
- A defect can mint wrongly, leave a coin with the wrong permanent identity, or misreport who holds
  authority.
- Realised ceiling at the 2026-10-03 baseline: **Low** (F1, permanent but needing an unusual input).
  Realised ceiling at 2026-10-09: **Info** (no open finding above Info: F11, F17–F20). At 2026-10-10 the
  only open finding is F20 (Info, ACCEPTED-RISK).

**Status:** re-verified 2026-10-10, 0.0.11 work (first-pass baseline 2026-10-03).

- The predecessor in-app code was reviewed in `token-deployer/docs/audits/token-deployer-sui-audit.md`
  (2026-07-30).
- Its findings 4 (icon URL scheme) and 5 (silent degradation of `extractPublishResult`) apply to code
  that now lives here. Both are resolved, as re-verified in F14.

**Package manager / lockfile:** npm; `package-lock.json` committed (CI and publish install with `npm ci`).
**Module format:** ESM.
**Publish model:** ships `src` (runtime, `default` condition) and `dist` (`.d.ts`, `types`
condition), built by `prepublishOnly`. Entry points:

| Entry | Runtime |
| --- | --- |
| `.` | `src/index.ts` |
| `./template` | `src/template/index.ts` |
| `./deploy` | `src/deploy.ts` |
| `./package` | `src/package.ts` |

**Runtime targets:** browsers (Vite, wasm configured with `configureTemplateWasm`) and Node.
**Peer dependencies:** `@mysten/sui` `^2.33.2` (F17, 0.0.11; also a devDependency for tests).

**Dependencies:**

| Package | Range | Installed |
| --- | --- | --- |
| `@mysten/sui` (peer; dev for tests) | `^2.33.2` | 2.33.2 |
| `@mysten/move-bytecode-template` | `~0.4.1` | 0.4.1 (latest) |
| `fflate` | `^0.8.3` | 0.8.3 |

**Template pin:** devDependency `@meddleware/sui-token-template` **1.0.9**, exact, with provenance
attested (1.0.6 at the baseline, 1.0.8 in 0.0.10). The generated artefact records:

| Field | Value |
| --- | --- |
| `moduleSha256` | `96298cca…9630` |
| `sourceSha256` | `a6bfae1e…3623` |
| Toolchain | 1.81.0 |
| Framework revision | `83f11dc8…b059` |
| Build environment | testnet |

**Sui SDK / transport:** gRPC core API through structural types (`toSuiTxResult` consumes a core
`TransactionResult` with effects and object types; `listMyTokens` uses `listOwnedObjects`,
`listBalances`, `getObject` and `getTransaction`). No JSON-RPC.

**Framework targets:** `0x1` (stdlib dependency), `0x2` (framework dependency),
`0x2::package::make_immutable`, `0x2::coin_registry::finalize_registration`, registry `0xc`. The
`coin::mint` and `transfer::public_freeze_object` calls of the baseline are gone: `init` applies the
policies (F4). No first-party package IDs.

**OPS front matter (scoped):** `npm run e2e:localnet`. It uses a localnet faucet and an ephemeral
in-process `Ed25519Keypair`, never a stored key. It refuses a public network (chain-identifier check)
unless `E2E_ALLOW_PUBLIC=1` (F10). It is not run in CI; it is run by hand before each release (last run
2026-10-09: PASS). CLI: none is called by the script; `sui start` is run by the operator (the installed
`sui` is 1.81.0, equal to the template's recorded toolchain).

**Location:** `sui-token-client/docs/audit/sui-token-client-audit.md`. This is a new directory in the
repo.

> **Access note:** `meddleware-org/sui-token-client` is not in this session's attached repository
> list. It is public, so it was cloned read-only. Nothing was pushed.

---

## Executive summary

`@meddleware/sui-token-client` is about 1,670 lines across 11 hand-written modules (0.0.11). The
generated artefact and template files (`src/template/artifact.ts`, `files.ts`) are on top of that.

**What holds (verified):**

- **Layered rules.** One rule set (`assertTokenConfig`) runs before patching, publishing and package
  generation. Its checks:
  - Move identifiers, reserved words, template and framework name collisions;
  - printable ASCII with no `"` or `\`, bounded per field;
  - `https://` and `ipfs://` icons only;
  - decimals 0–18;
  - supply × 10^decimals ≤ u64;
  - full-length recipient address.
- **Generated, verified artefact.** It comes from the exactly pinned template package. The generator
  checks the module and source hashes against `build-info.json`, a byte-exact decode/encode round
  trip, the identifier list, and that each default occurs once. CI runs `check:template`, and it
  matched at review.
- **Exact type matching.** Results and listings compare parsed struct tags. A TreasuryCap counts only
  if it is the framework's `TreasuryCap<T>` with `T` in the package just published.
- **Fail-closed status.** Only an explicit `success` effects status counts.
- **Typed post-publish errors.** A published coin is never answered with a second deploy:
  `PublishedError`, `DeployIncompleteError` (with a `finalizeToken` recovery) and
  `DeployUnconfirmedError`.
- **Bounded listing.** `listMyTokens` throws rather than truncate.
- **Exact fee.** The fee is split exactly from gas inside the publish PTB.
- **Tooling.** Declarations ship in `dist`; there is an ABI table plus a live drift test (framework
  calls and chain IDs).

**Measured (2026-10-10, 0.0.11):**

- 148/148 unit tests (11 files); coverage 97.92% statements, 90.97% branches, 100% functions, 99.17% lines;
- tsc, eslint, `npm audit --audit-level=high` (0), `npm ls --all` and `check:template` (`@meddleware/sui-token-template@1.0.9`) clean;
- the live read-only suite passed 6/6 on 2026-10-09 (weekly in CI); `e2e:localnet` PASS (2026-10-10, sui 1.81.0, including the refused second finalize);
- the build emits declarations; pack is 30 files.

**Findings, current state (2026-10-10):**

1. **The four findings that mattered are RESOLVED.**
   - **F1** (placeholder-valued inputs in the wrong slot): the patcher resolves every slot from the
     pristine pool, refuses a placeholder-valued text field and decodes its output; the source and README
     render in one pass (0.0.6). **F2** (the UpgradeCap goes to the recipient, 0.0.6). **F3** (finalize
     retries cannot mint twice: 0.0.6 added a check, 0.0.9 removed the minting from finalize altogether).
   - **F4** (the registry never learned the policies): the supply and metadata policies now run in the
     coin's own `init` in the publish transaction (template 1.0.8, client 0.0.9), so the registry records
     `Fixed` and a deleted MetadataCap; proven on localnet.
2. **The Info items are RESOLVED too:** F5 (capability-less coins are listed, 0.0.10), F6 (licence
   fields validated), F7 (fee recipient validated), F8 (one-pass doc substitution), F10 (e2e network
   guard), F12 (recovery-path tests). **F9** (CI) is MITIGATED: the release gate equals CI, the build
   and tarball are checked, and a weekly workflow runs the live read-only suite; the localnet e2e is
   still run by hand before a release.
3. **New since the baseline:** **F16** (RESOLVED): the patcher merges equal constant-pool entries,
   which the bytecode verifier rejects. The Info items found at the 2026-10-09 re-verification are
   RESOLVED in 0.0.11: **F11** (docs described the freeze design), **F17** (`@mysten/sui` is now a peer:
   TS-M9), **F18** (the generated `publish.sh` and the README licence line substituted naively) and **F19**
   (`CHAIN_IDS` was indexed with a caller-supplied network). One remains, Info and not mainnet-gated: **F20**
   (`listMyTokens` fails closed past 200 foreign coin packages: ACCEPTED-RISK; OQ4).

**Posture:**

- The money and identity paths are carefully engineered, and the extraction from the app tightened
  them. Every baseline finding has a fix with a test, and the two decisions that were open (OQ2, the
  registry; OQ1, the UpgradeCap) were taken and implemented.
- The remaining item is F20, an availability limit on the listing that fails closed. The 2026-10-09
  documentation drift (F11), the packaging rule (F17) and the three hygiene items in generated files (F18,
  F19, `Move.lock`) are fixed in 0.0.11. None touched funds or the permanent on-chain values.
- Evidence for the permanent values is layered: the rule set, the pristine-pool patcher with its decoded
  post-condition, the constant-pool dedupe, the result-versus-policy check after the publish, and a
  localnet run that reads the registry's recorded state.

---

## Threat model / trust boundaries

| Actor / source | Controls | Can do | Bounded by |
| --- | --- | --- | --- |
| Deployer (end user) | the `TokenConfig` (names, text, decimals, supply, policies, recipient, licence) | Choose any token; sign two transactions | `assertTokenConfig`; the patcher's pristine-pool resolution, placeholder refusal and decoded post-condition (F1); exact-split fee; a preview in the app |
| Consuming app (token-deployer-ui) | fee amount, fee recipient (treasury), gas budget, network, executor, wasm source | Route the fee; sign through the wallet | App's build-time zero-treasury guard (token-deployer-ui `vite.config.ts`). The library itself refuses a zero, short or malformed fee recipient when a fee is charged (F7, 0.0.7). |
| Wallet / executor | signs and executes; reports effects | Misreport effects; throw after submission | `assertSuccess` (explicit success only); exact-type parsing; typed post-publish errors; `assertResultMatchesPolicy` after the publish; a repeated finalize is rejected without effect (F3) |
| Full node (behind the executor) | effects, object types, owned objects | Lie about effects or listings | Exact struct-tag matching; the coin must belong to the published package; bounded paging; a failed lookup throws (F5, F20) |
| `@meddleware/sui-token-template` npm package | the bytecode and source the client ships | Change what every deploy publishes | Exact pin with provenance; hashes vs `build-info.json`; round trip; identifier and default checks; `check:template` in CI |
| `@mysten/move-bytecode-template` (wasm) | module (de)serialisation | Mis-encode the module | Byte-exact round trip checked at generation; the patched output is decoded again and checked (F1); equal constants are merged (F16); the module is verified on-chain at publish |
| Recipient (e.g. a DAO or multisig) | receives the initial supply, the TreasuryCap and MetadataCap that exist, and the UpgradeCap of an upgradeable package | Expects full control | The UpgradeCap goes to the recipient (F2, 0.0.6) |
| Token holders / market | read the coin's on-chain state | Judge supply and metadata mutability | `init` records a fixed supply and a deleted MetadataCap in the coin registry (F4, template 1.0.8 / client 0.0.9) |

### On-chain dependency matrix (SUI_CLIENT lens)

| Object / package | ID | Sourced from | Used as | If stale / wrong | Fails |
| --- | --- | --- | --- | --- | --- |
| Move stdlib / Sui framework | `0x1` / `0x2` | constants (`transactions.ts:16-17`) | publish dependencies; call targets | system packages; framework upgrades keep the addresses | n/a — drift test checks signatures live |
| Coin registry | `0xc` | literal | `finalize_registration` argument | system object | n/a |
| Pending `Currency<T>` | from publish effects (id, version, digest) | `extractPublishResult` | a `Receiving` reference in finalize | stale version ⇒ the finalize is rejected without effect (a repeat is safe — F3; observed on localnet, S5) | closed |
| `TreasuryCap<T>` / `MetadataCap<T>` / `Coin<T>` / `UpgradeCap` | from effects, exact types | `extractPublishResult` | transfer to the recipient (no mint, no freeze) | — | closed (exact type; coin from the published package) |
| Fee recipient | caller | app config | `transferObjects(fee)` | a zero or short address is refused in the library (F7); a wrong but valid address is the caller's responsibility | closed for malformed; open for wrong-but-valid |

### Supply chain & input matrix (TS lens)

| Actor / source | Controls | Bounded by |
| --- | --- | --- |
| Dependency authors | `@mysten/sui`, `@mysten/move-bytecode-template` (wasm), `fflate` | lockfile; `npm ci`; `npm audit --audit-level=high` in CI and (through the reusable workflow) in publish; weekly grouped Dependabot (npm and Actions) |
| Registry (npm) / CI runner / maintainer | the tarball for a version; the build; the publish | lockfile integrity; OIDC trusted publishing with provenance (checked on 0.0.10); SHA-pinned Actions; `npm@11.20.0` pinned for the publish; tag must equal the version |
| Template package | the module and template text files | F14 / `check:template` |
| Untrusted inputs | user config; executor results | `assertTokenConfig`; strict result parsing |
| Embedding host | wasm source URL; the `@mysten/sui` copies in the bundle | `configureTemplateWasm`; a failed init is rethrown and retried; one `@mysten/sui` copy, enforced by the peer declaration (F17, 0.0.11) |

### Operations (OPS lens, scoped)

| Script | Signs? | Network guard | Irreversible? | Key | Writes IDs |
| --- | --- | --- | --- | --- | --- |
| `scripts/e2e-localnet.mjs` | yes (publish, finalize, a fixed-supply/frozen-metadata coin, an equal-constants publish, a refused-finalize recovery, a refused second finalize) | defaults to `http://127.0.0.1:9000` / `:9123`. Hard-fails when the chain identifier is testnet's or mainnet's unless `E2E_ALLOW_PUBLIC=1` (F10, 0.0.7). | localnet-ephemeral | ephemeral `Ed25519Keypair`, faucet-funded | none |

---

## Severity scale

Critical / High / Medium / Low / Info / Positive.

## Scope

**In scope (HEAD `fb7301b` on `main` plus the 0.0.11 working tree, 2026-10-10; release tag `v0.0.10` = `e70a5ab`; baseline `6f09bb2` = tag `v0.0.5`, 2026-10-02):**

- `src/{index,types,rules,typeNames,transactions,results,deploy,tokens,package}.ts`
- `src/template/{index,patch,artifact,files}.ts`
- `scripts/{gen-template,e2e-localnet,ts-resolve}.mjs`
- `tests/**` (11 unit files, the ABI table, the integration drift test)
- `package.json`, the lockfile, `tsconfig*.json`, the vitest and eslint configs
- `README.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`
- `.github/workflows/{node-ci,npm-publish,live}.yml`, `.github/dependabot.yml`

**Cross-repo evidence (read-only):**

- the pinned Sui framework source at `83f11dc8…` (`coin_registry.move`: `make_supply_fixed`,
  `delete_metadata_cap`, `SupplyState`, `MetadataCapState`), from the local Move git cache;
- `sui-token-template` 1.0.9 (policies applied in `init` since 1.0.8 `5451c0e`; `Move.lock` shipped since 1.0.9) and its audit;
- `token-deployer/docs/audits/token-deployer-sui-audit.md` (the predecessor);
- token-deployer-ui CLAUDE.md and `package.json` (the consumer's wiring, its zero-treasury guard, the
  post-publish error routing, the `^0.0.10` pin).

**Out of scope:** the Move template (its own audit); token-deployer-ui (its own audit); the
`@mysten/*` internals.

**Environment / commands (2026-10-10, 0.0.11 working tree; the 2026-10-09 figures were Node 24.13.0, the baseline ran on Node 22.22.2):**

| Command | Result |
| --- | --- |
| `npm ci` | clean |
| `npx vitest run` | **148 passed** (11 files) |
| `npx vitest run --coverage` (coverage plugin installed `--no-save`, then removed) | 97.92% statements / 90.97% branches / 100% functions / 99.17% lines. Branch gaps: `deploy.ts` (66.66%: the `cause instanceof Error` fallbacks and optional `onStep` calls), `results.ts` (86.11%), `patch.ts` (88%) |
| `npx tsc --noEmit` / `npx eslint .` | clean / clean |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm run check:template` | `src/template matches @meddleware/sui-token-template@1.0.9` |
| `npm run test:integration` (`GRPC_TESTNET=1`; reads public testnet and mainnet full nodes) | **6 passed** (the chain id and the `make_immutable` / `finalize_registration` signatures, per network) |
| `npm pack --dry-run` | 30 files, 45.7 kB (`src`, `dist`, `CHANGELOG.md`, `README.md`, `LICENSE`, `package.json`); no tests or fixtures |
| `npm ls` | one `@mysten/sui` (2.33.2); `typescript` 6.0.3 |
| `npm view @meddleware/sui-token-client@0.0.10 dist.attestations` | SLSA v1 provenance present |
| Scratch probes (deleted afterwards) | `buildPackageFiles` with a module named `xmodulenamex` leaves a wrong struct name and env-variable names in the generated `scripts/publish.sh`, and a `licenseName` of `A$&B$'C` is pattern-expanded in the README (F18); a `network` of `constructor` writes `chain-id = "function Object() { [native code] }"` into `Published.toml` (F19) |
| `npm run e2e:localnet` | **PASS 2026-10-10** against a local `sui start --with-faucet --force-regenesis` (sui 1.81.0): fixed-supply + frozen-metadata coin (no caps, registry records `Fixed` and a deleted MetadataCap); equal-constants publish; recovery; a second finalize refused by the chain without effect; listing; the generated `Move.lock`. The baseline probes of F1 and F8 were repeated as unit tests (`tests/template.test.ts`, `tests/package.test.ts`) |

The clone was left clean (`coverage/` removed; the lockfile is byte-identical to `HEAD`).

---

## Findings

### F1 — Placeholder-valued inputs make the patcher, and the source renderer, write values into the wrong slots; there is no post-patch check

**Severity:** Low (likelihood-weighted; the impact is permanent)   **Disposition:** RESOLVED (0.0.6, `6d3b7c2`; constant-pool merge 0.0.9, `677330f`)
**Where:**

- `src/template/patch.ts:117-125`: looks up each field's entry by its *current* bytes, in turn
  (symbol, name, description, iconUrl), and overwrites it;
- `src/package.ts:85-88` (`renderSource`): the same sequential `replaceAll` of `b"TEMPLATE_*"`
  over a string that already contains earlier user values.

**Issue:**

- The string constants are found with `constant_pool.find(c => sameBytes(c.data, vecU8(default)))`,
  one field at a time, **after** earlier fields have already been overwritten.
- If a user value equals a later field's template default (`TEMPLATE_NAME`, `TEMPLATE_DESCRIPTION`,
  `TEMPLATE_ICON_URL`), the later lookup can match the already patched entry. The wrong slot is
  overwritten, and the real slot keeps its placeholder.
- `SAFE_TEXT` allows these strings, and nothing rejects them.
- Probe (pool order: symbol, name, description, icon):

| Input | Resulting constants |
| --- | --- |
| `symbol: 'TEMPLATE_NAME', name: 'My Coin'` | symbol = `My Coin`, name = `TEMPLATE_NAME` |
| `name: 'TEMPLATE_DESCRIPTION', description: 'real description'` | name = `real description`, description = `TEMPLATE_DESCRIPTION` |
| `description: 'TEMPLATE_ICON_URL', iconUrl: 'https://…'` | description = the URL, icon = `TEMPLATE_ICON_URL` |

- The patched module is not decoded again to confirm that each constant equals the intended value.
- **The source renderer collides too, differently.** `renderSource` first replaces
  `b"TEMPLATE_SYMBOL"` with `b"TEMPLATE_NAME"`, then replaces *every* `b"TEMPLATE_NAME"` with the
  name. For the first probe input, the outputs disagree three ways:

| Output | Symbol | Name |
| --- | --- | --- |
| On-chain bytecode | `My Coin` | `TEMPLATE_NAME` |
| Downloaded source (`sources/<module>.move`) | `My Coin` | `My Coin` |
| Generated README (from the config) | `TEMPLATE_NAME` | `My Coin` |

- That breaks the package's bytecode ↔ source parity promise. The source compiles, since identical
  constants are deduplicated, but it does not reproduce the published module, so source
  verification fails.

**Impact:**

- A coin is published with a symbol and name the user did not choose. Both are permanent, and the
  name may be a literal template placeholder.
- The downloadable source and the README describe a different coin from the one on-chain.
- Only the deployer can trigger this, with an unusual value. There is no third-party exploit.

**Remediation / evidence (2026-10-09):** fixed in 0.0.6 (`6d3b7c2`), re-read against 0.0.10.

- `src/template/patch.ts` resolves every text slot from the pristine pool before writing any
  (`slots = keys.map(...)`, then `entry.data = ...`), and refuses a symbol, name, description or icon that
  equals a template default or starts with `TEMPLATE_` (`patch.ts:184-206`). It checks the slots are
  distinct, then decodes the serialised output and confirms each text constant, both identifiers, the
  decimals and the three policy constants are present (`patch.ts:211-232`).
- `src/package.ts` renders the source, README and docs with `replaceMany`, one left-to-right pass over a
  regex alternation, so inserted user text is never rescanned (`package.ts:29-32, 89-102`).
- Tests that pin it: `tests/template.test.ts` "placeholder-valued inputs (F1)" (refusal; distinct values
  land in their own constants; equal and empty values accepted) and `tests/package.test.ts` "rendered
  source and docs are one-pass (F1)".
- Residual, stated plainly: the post-condition checks that each value is present in the pool, not which
  `LdConst` loads it (after the merge of F16 two constants can share one entry by design). The load sites
  are pinned by the `template.test.ts` merge tests ("every constant still loads its own value") and the
  localnet publish. The generated `publish.sh` and the README licence line were not covered by this fix
  (F18, resolved in 0.0.11).

**Baseline recommendation (2026-10-03, implemented as listed):**

1. Resolve all target indices from the pristine pool **before** writing any field. The generator
   already guarantees each default is unique.
2. Render the source in one pass: one regex alternation, or replace by line or constant name, not
   sequentially.
3. And/or reject any value equal to a template default or identifier.
4. Add a post-condition: decode the output and assert each constant equals the config value, and the
   module and struct identifiers equal the config.
5. Add tests for the three probe cases, covering both the module and the rendered source.

### F2 — An upgradeable package's UpgradeCap goes to the sender, not the recipient

**Severity:** Low   **Disposition:** RESOLVED (0.0.6, `6d3b7c2`; OQ1 decided: the recipient)
**Where:** `src/transactions.ts:39-43` (`tx.transferObjects([upgradeCap], args.sender)`);
`src/types.ts` (`recipient`: "Address that receives the caps and initial supply");
README line 51 ("caps to the recipient").

**Issue:**

- With `packagePolicy: 'upgradeable'` and a non-empty `recipient`, `finalize` moves the TreasuryCap
  (if mintable), the MetadataCap (if updatable) and the supply to the recipient.
- But the publish PTB transferred the **UpgradeCap** to the sender, and nothing moves it later.
- The deployer keeps the power to upgrade the coin's package (its `init` cannot rerun, but new public
  functions can be added) without the recipient knowing.
- The generated `deployments.md` records the UpgradeCap ID but not its owner.

**Impact:**

- A recipient such as a DAO or multisig believes it controls the coin, while the deployer retains
  upgrade authority. That is a governance and trust gap.
- The `immutable` policy (the default in the template's own pipeline) is unaffected.

**Remediation / evidence (2026-10-09):** `buildPublishTransaction` now takes `recipient` and runs
`tx.transferObjects([upgradeCap], args.recipient || args.sender)` for an `upgradeable` package
(`transactions.ts:49`); `deployToken` passes `config.recipient || args.sender`
(`deploy.ts`, publish call). The generated README states who holds the UpgradeCap (`package.ts`,
`policyNote`). Tests: `tests/transactions.test.ts` "transfers the UpgradeCap to the sender under the
upgradeable policy" and "sends the UpgradeCap to the recipient when there is one, so upgrade authority
travels with the caps". OQ1 is decided (see the log). The `deployments.md` template still records the
UpgradeCap id without naming its owner; the README note covers it.

**Baseline recommendation (2026-10-03, first option implemented):**

- Transfer the UpgradeCap to `config.recipient || sender` in the publish PTB.
- Or document that upgrade authority always stays with the deployer, and surface it in the result and
  the generated docs.
- Add a test.

### F3 — `finalizeToken` retry is not idempotent

**Severity:** Low   **Disposition:** RESOLVED (0.0.6 `6d3b7c2` added a supply check; 0.0.9 `677330f` removed the cause)
**Where (at the baseline, `6f09bb2`):**

- `src/deploy.ts:100-115`: `finalizeToken` is documented as "retryable" on any `Error`;
- `:118` (`executeFinalize`);
- `:73-82` (`DeployIncompleteError`) and `:228-232`: wrap *any* finalize failure, including an
  executor that threw after the transaction was submitted;
- `:212-213`: `pending.config.recipient` defaults to the sender.

**Issue:** `DeployIncompleteError` is raised whether finalize *failed* or *succeeded on-chain but the
executor threw* (a network error after submission, or a wallet error after broadcast). `finalizeToken`
retries blindly. Whether a retry is safe depends on the configuration:

| Case | Retry outcome |
| --- | --- |
| `currencyRef` present | Safe. The `Receiving` reference is stale after the first finalize, so the retry aborts atomically. |
| Fixed supply | Safe. The frozen TreasuryCap blocks the mint. |
| Recipient ≠ sender | Safe. The sender no longer owns the caps. |
| `currencyRef` **absent** (effects lacked the Currency's version or digest), `mintable`, and recipient = sender | **Unsafe.** The retry is valid and **mints the initial supply again**. |

**Impact:** a duplicated initial supply in an edge case. It is visible on-chain and fixable only by
burning.

**Remediation / evidence (2026-10-09):** the unsafe case no longer exists.

- 0.0.6 made `finalizeToken({ client })` read the TreasuryCap's supply before a retry. 0.0.9 went further:
  the policies and the initial supply are applied by the coin's own `init` in the publish transaction, so
  `buildFinalizeTransaction` mints and freezes nothing. It only registers the currency
  (`finalize_registration`, with a `Receiving` reference) and transfers what the sender holds
  (`transactions.ts:109-131`). `finalizeToken` lost its `client` option (`deploy.ts:112-123`).
- A repeat of a finalize that already ran is rejected without effect: the `Receiving` reference of the
  pending Currency is stale, and the sender no longer owns the transferred objects. Nothing can be minted
  twice. `finalizeHasWork` returns false when there is no reference and the recipient is the sender, so no
  empty transaction is run.
- Tests: `tests/deploy.test.ts` "finalizeToken finishes a pending deploy with one more signature",
  "finalizeToken has nothing to run when there is no pending currency and the recipient is the sender" and
  "does not invite a retry when the finalize executed but its confirmation failed"; `tests/transactions.test.ts`
  "never mints or freezes: init applied the policies in the publish transaction" and "reports whether there
  is anything to run". The localnet run recovers a refused finalize with `finalizeToken`.
- Not exercised against a chain: the second finalize that is rejected (chain semantics, not modelled by a
  mock executor). Run against a localnet on 2026-10-10 (S5): the chain refuses it without effect.

**Baseline recommendation (2026-10-03, superseded by removing the minting):**

- Before retrying, check on-chain whether finalize already ran. For example:
  - the Currency's owner or state (shared and registered), or
  - the TreasuryCap's total supply versus the expected initial supply.
- Make `PendingFinalize` carry the expected post-state.
- Classify executor errors after submission as "unknown" rather than "incomplete".
- Add a test where the executor throws after success.

### F4 — Supply and metadata policies freeze the caps instead of recording them in the coin registry

**Severity:** Low   **Disposition:** RESOLVED (template 1.0.8 `5451c0e` + client 0.0.9 `677330f`; OQ2 decided: apply the policies in `init`)
**Where (at the baseline):** `src/transactions.ts:101-121` (`public_freeze_object` on the TreasuryCap / MetadataCap);
the pinned framework `coin_registry.move` (`make_supply_fixed` `:299`, `delete_metadata_cap` `:393`,
`is_supply_fixed` `:607`, `is_metadata_cap_deleted` `:575`, `SupplyState` `:126`,
`MetadataCapState` `:151`).

**Issue:**

- **Fixed supply.** Freezing the TreasuryCap makes minting impossible: `mint` needs `&mut`. But the
  shared `Currency<T>` keeps `SupplyState::Unknown`, so `is_supply_fixed` and `total_supply` report
  nothing.
- **Frozen metadata.** Freezing the MetadataCap leaves `MetadataCapState::Claimed(id)` rather than
  `Deleted`.
- **What wallets see.** Explorers and wallets that read the registry, which is the purpose of the new
  `coin_registry`, cannot show a fixed supply or immutable metadata. Buyers must instead find the
  frozen cap and know what freezing implies.
- **Why it isn't one line to fix.** `finalize_registration` shares the `Currency` within the finalize
  PTB, and a freshly shared object cannot be borrowed `&mut` later in the same PTB.
  - Recording the policy therefore needs either a third transaction (`make_supply_fixed` and
    `delete_metadata_cap` on the shared Currency),
  - or `make_supply_fixed_init` in the template's `init` (a template change).

**Impact:** the coins' strongest trust properties are invisible to standard tooling. The supply is
effectively fixed, but cannot be proven through the registry.

**Remediation / evidence (2026-10-09):** the template-level option was chosen and implemented.

- `@meddleware/sui-token-template` 1.0.8 applies the policies in `init`: `INITIAL_SUPPLY` is minted to
  the publisher, `FIXED_SUPPLY` hands the TreasuryCap to the registry (`make_supply_fixed_init`), and
  `FROZEN_METADATA` runs `finalize_and_delete_metadata_cap`. The client patches the three constants
  (`patch.ts:165-181`, `patchTokenModule`), pins 1.0.8 exactly and no longer freezes or mints
  (`transactions.ts`). A fixed supply with a zero initial supply is refused (`rules.ts:157-161`; the
  framework refuses to fix an empty supply).
- After the publish, `assertResultMatchesPolicy` (`results.ts:136-158`) stops the flow with a
  `PublishedError` if what was created contradicts the policy (a TreasuryCap for a fixed supply, a
  MetadataCap for frozen metadata, a missing or unexpected initial Coin).
- Proven on a chain: `npm run e2e:localnet` (2026-10-09) deploys a fixed-supply, frozen-metadata coin,
  asserts no TreasuryCap or MetadataCap exists, reads the registry's `Currency` and checks it records
  `Fixed` and a deleted MetadataCap, and that a mintable, updatable coin records neither.
  Hermetic tests: `tests/template.test.ts` "supply and metadata policy", `tests/transactions.test.ts`
  "assertResultMatchesPolicy" and the `extractPublishResult` cases without caps, `tests/deploy.test.ts`
  "deploys a fixed supply with frozen metadata".
- The generated README states the policies as the registry records them (`package.ts`, `policyNote`;
  `tests/package.test.ts`). `SECURITY.md` described the old freeze semantics until 0.0.11 (F11).

**Baseline recommendation (2026-10-03, second option implemented):**

- Decide between a third, optional "record policies" transaction and a template-level change (OQ2).
- Until then, document the semantics in the generated README and `deployments.md`, and in the
  deployer UI.

### F5 — `listMyTokens` misses fixed-supply and recipient-routed coins

**Severity:** Info   **Disposition:** RESOLVED (0.0.7 `bd58328` documented the semantics; 0.0.10 `e70a5ab` lists capability-less coins; OQ3 decided)
**Where (at the baseline):** `src/tokens.ts:13-45` (discovery by owned `TreasuryCap<T>`).

**Issue / Impact:**

- A fixed-supply coin's TreasuryCap is frozen, so no one owns it. A coin whose caps went to a
  recipient lists under the recipient.
- Either way, the deployer's "my tokens" view omits those coins, which for the deployer UI is most
  fixed-supply launches.
- Conversely, anyone can send a TreasuryCap (it has `store`) to an address, and it will list. That is
  real control, so it is correct, but it is not "deployed by me".

**Remediation / evidence (2026-10-09):** `listMyTokens` (`tokens.ts:81-131`) lists a coin in two
ways. First, the wallet owns its `TreasuryCap<T>` or `MetadataCap<T>` (both matched by exact type through
`frameworkTypeArgument`). Second, the wallet holds a balance of a coin whose package it published: it reads
every balance page, skips SUI and system packages, then for each other package reads the package object's
`previousTransaction` and compares that transaction's sender (normalised) with the owner. A fixed supply
with frozen metadata has no capability, and this second rule is what finds it (the holder of the minted coin
published the package). `DeployedToken` now has optional `treasuryCapId` and a new `metadataCapId`.

- Bounds: every listing reads all pages or throws past `maxPages`; more than `maxHeldCoinTypes` (200)
  foreign coin packages throws (F20); a failed lookup throws rather than dropping a coin.
- Documented semantics (README "Owned tokens", `CLAUDE.md`): a coin whose caps went to a recipient lists
  under the recipient if it holds a cap; a coin the wallet merely received is not listed; an owned
  `TreasuryCap` sent by someone else lists, because it is real control. `deployToken`'s result is the
  authoritative record of a session. This is OQ3's decision.
- Tests: `tests/tokens.test.ts` "owned capabilities" (5 cases) and "coins with no capability" (7 cases:
  published by the wallet, merely received, normalised publisher, system packages never looked up, once per
  package, paging and the too-many-packages refusal, a failed lookup surfaces); the localnet run lists the
  fixed, frozen coin.

**Baseline recommendation (2026-10-03, both options taken):** add discovery by the publishes the address
signed: owned `UpgradeCap`s, or a lookup of transactions by sender with the template's module shape.
Alternatively, document the current semantics ("coins you can mint").

### F6 — `licenseName` and `licenseText` are not validated

**Severity:** Info   **Disposition:** RESOLVED (0.0.7, `bd58328`)
**Where (at the baseline):** `src/package.ts:101-113, 241-243`; `src/rules.ts:157` (only the SPDX `license` id is
checked).

**Issue / Impact:**

- `licenseName` is written into the generated README, and `licenseText` into `LICENSE`, unvalidated.
- Both affect only the user's own downloaded package (markdown, not executed), so there is no security
  impact.
- It is inconsistent with the "no unvalidated value reaches generated files" posture.

**Remediation / evidence (2026-10-09):** `assertTokenConfig` bounds `licenseName` (64) and checks it against
`SAFE_TEXT` (`rules.ts:166-171`); `assertLicenseText` bounds the text (100,000 characters) and refuses a NUL
byte (`rules.ts:180-183`), and `buildPackageFiles` calls it (`package.ts:268`). Test: `tests/rules.test.ts`
"licence fields". One related defect in the README licence line was fixed in 0.0.11 (F18).

**Baseline recommendation (2026-10-03, implemented):** bound and `SAFE_TEXT`-check `licenseName`; bound
`licenseText`.

### F7 — The fee recipient and fee amount are trusted from the caller

**Severity:** Info   **Disposition:** RESOLVED (0.0.7, `bd58328`; validation moved into the library)
**Where (at the baseline):** `src/transactions.ts:45-49`; `src/deploy.ts:138-147`.

**Issue:**

- The library splits `feeMist` to `feeRecipient` with no validation: no zero-address check and no
  format check before building. The app's production build refuses a zero treasury
  (`assertTreasuryConfigured`).
- `PublishResult.feeRecipient` and `feeMist` echo the inputs rather than being read from the effects
  or balance changes.

**Impact:** a misconfigured consumer could burn fees to `0x0`, or report a fee that differs from what
executed. That would need a broken app.

**Remediation / evidence (2026-10-09):** `buildPublishTransaction` refuses a fee recipient that is not
`0x` plus 64 hex digits, or is all zeros, whenever a fee is charged (`transactions.ts:52-56`); with no fee
the recipient is not looked at. Test: `tests/transactions.test.ts` "fee recipient" (zero, truncated,
malformed refused; ignored when no fee). The app's own zero-treasury guard remains as a second layer.
`PublishResult.feeRecipient` and `feeMist` still echo the inputs rather than being read from the effects:
the optional second suggestion is S4 (MAY), not a defect.

**Baseline recommendation (2026-10-03, first point implemented):**

- Validate `feeRecipient` as a full address and not `0x0`, as access-gate-client's `toAddress` does.
- Optionally confirm the fee from `balanceChanges` in the result.

### F8 — Placeholder and identifier collisions beyond F1

**Severity:** Info   **Disposition:** RESOLVED (0.0.6, `6d3b7c2`, with F1; one residual in generated scripts, resolved in 0.0.11: F18)

**Where:** `src/package.ts:25-40` (`applyDocPlaceholders`: a sequential `replaceAll` over a map
whose values are user text); `:83-84` (`renderSource` inserts `packageDescription` before
substituting `XMODULENAMEX`).

`assertTokenConfig` blocks module names that collide with the template's imported identifiers
(F13). It does not reject:

- text fields equal to template defaults (F1);
- text fields containing the `X…X` tokens the package generator substitutes.

Probe results:

- **`symbol: 'XNAMEX'`.** The generated README renders the title as `My Token (My Token)` and the
  Symbol row as `My Token`, because `XSYMBOLX` is replaced first and the inserted `XNAMEX` is then
  replaced too. The bytecode and source are correct (`b"XNAMEX"`).
- **`packageDescription: 'Mod XMODULENAMEX here'`.** The source doc comment becomes
  `/// Mod mytoken here`.

This only affects the user's own generated docs and comments, not on-chain values.

**Remediation / evidence (2026-10-09):** `applyDocPlaceholders` and `renderSource` both go through
`replaceMany`, a single regex alternation (longest key first) applied in one pass, so inserted text is
never rescanned (`package.ts:29-32, 35-51, 89-102`). Test: `tests/package.test.ts` "a value containing
another template key is not rewritten" (a description containing `XSYMBOLX`, a package description
containing `XMODULENAMEX` and `SUI_TOKEN_TEMPLATE`). `renderPublishScript` and the README licence line were
not moved to the same pass until 0.0.11 (F18).

**Baseline recommendation (2026-10-03, first option implemented):** substitute in one pass, with a single
regex alternation over the template so inserted text is never rescanned. Alternatively, reject `X[A-Z]+X`
and template defaults in every text field.

### F9 — CI: live tests and e2e never run; `--if-present`

**Severity:** Info   **Disposition:** MITIGATED (0.0.7, `bd58328`; the localnet e2e is run by hand before each release)
**Where (at the baseline):** `.github/workflows/node-ci.yml`, `npm-publish.yml`.

**Positives first:**

- actionlint (digest-pinned), `npm audit` and `check:template` run in Node CI and in the publish
  verification;
- the `.d.ts` build runs in publish.

**Gaps:**

- **Live checks never run.** The ABI-drift and chain-id integration test, and the localnet e2e (the
  only proof that a patched module verifies on-chain and that finalize works), are not run in CI.
- **No build in Node CI.** The declaration build runs only on publish.
- **`--if-present`.** The publish verification uses it, and runs no lint.

**Remediation / evidence (2026-10-09):** three of the four gaps are closed.

- `live.yml` (new, `bd58328`) runs `npm run test:integration` weekly (Monday 05:27 UTC) and on
  `workflow_dispatch`, with `permissions: contents: read`, no secrets and no signing, SHA-pinned Actions.
  Last local run 2026-10-09: 6/6.
- `node-ci.yml` now builds the declarations and checks the tarball (`package.json` and `dist/index.d.ts`
  present), and runs `npm run lint:js` without `--if-present`. `npm-publish.yml` calls it as a reusable
  workflow (`workflow_call`), so the release job is the CI job: audit, `check:template`, type-check, lint,
  tests, declarations, pack. Publish itself pins `npm@11.20.0`, requires tag equal to version and skips an
  already-published version (idempotent).
- Dependabot (`.github/dependabot.yml`, `3d23cb5`): weekly, grouped, npm and GitHub Actions.
- **Residual (why MITIGATED, not RESOLVED):** `e2e:localnet`, the only proof that a patched module
  verifies on-chain and that finalize works, is not a CI job; `live.yml` says it is run by hand before a
  release (it needs a `sui` binary and `sui start`). The maintainer ran it on 2026-10-09 (PASS). A CI
  localnet job would need a pinned `sui` installer (OPS lens) and is a maintainer decision.

**Baseline recommendation (2026-10-03, partly taken):**

- Add a scheduled read-only job for `test:integration`, and a localnet job (`sui start` in CI) for
  `e2e:localnet`.
- Add `npm run build` and `npm pack --dry-run` to Node CI.
- Drop `--if-present`.

### F10 — `e2e-localnet.mjs` has no network guard

**Severity:** Info   **Disposition:** RESOLVED (0.0.7, `bd58328`)
**Where (at the baseline):** `scripts/e2e-localnet.mjs:15-17`.

**Issue / Impact:**

- `RPC_URL` and `FAUCET_URL` can point anywhere.
- The keypair is ephemeral and funded only by the faucet, so a misdirected run against testnet would
  publish a test coin (no real funds lost), and mainnet has no faucet.
- Still, the OPS lens asks for a chain-identifier guard.

**Remediation / evidence (2026-10-09):** `scripts/e2e-localnet.mjs:26-32` reads the chain identifier
before the faucet request or any signature, takes its first four bytes, and fails (`process.exit(1)`) when
they are testnet's `4c78adac` or mainnet's `35834a8a`, unless `E2E_ALLOW_PUBLIC=1`. The check runs before
the ephemeral key is funded. No test covers the guard itself (it is a script, exercised by running it).

**Baseline recommendation (2026-10-03, implemented):** assert that the chain identifier is not testnet's
(`4c78adac`) or mainnet's (`35834a8a`) before signing, unless `E2E_ALLOW_PUBLIC=1` is set.

### F11 — Documentation drift

**Severity:** Info   **Disposition:** RESOLVED (0.0.11, commit `994b951`)

**Resolution (2026-10-10):** `SECURITY.md` "What the policies mean" is rewritten to the `init`-applied design (the
registry records a fixed supply and a deleted MetadataCap; finalize mints nothing; a repeat is refused by the
chain; no `client` option) and no longer splits the numbered invariants (now 1-6; the literal one-pass rendering
and the `Move.lock` rule are stated). The README sentence now says only the registration and the transfer to the
recipient wait for the finalize. `AGENTS.md` shows version `0.0.11`, Node 24 LTS (CI) and `@mysten/sui` as a
peer. `CLAUDE.md` is at 144 tests and names the peer, literal-rendering and `Object.hasOwn` rules. Evidence: the
five files in the 0.0.11 diff; the e2e step that pins the second-finalize behaviour the text now describes
(S5).

**Baseline text (2026-10-03):**

- README line 51 says finalize sends "caps to the recipient", but the UpgradeCap stays with the
  sender (F2).
- `SECURITY.md` invariant 1 ("No unvalidated value reaches Move") is true for Move source and
  bytecode. It does not cover generated docs (F6, F8), and is silent on the patcher post-condition
  (F1).
- `SECURITY.md` does not state:
  - the policy semantics (freeze vs registry, F4);
  - that upgrade authority stays with the deployer (F2);
  - the finalize-retry caveat (F3).
- `AGENTS.md` and CLAUDE.md are otherwise current (87 tests; entry points; invariants).

**Status 2026-10-09 (re-read against 0.0.10):** most of the baseline list is fixed, but the 0.0.9 redesign
(policies applied in `init`) left new drift.

- Fixed: the README states that the UpgradeCap goes to the recipient (0.0.6); `CLAUDE.md` is current (126
  tests, the init-applied policies, the constant-pool rule, the listing rule); the generated README
  documents the policies as the registry records them; `SECURITY.md` invariant 1 now covers the generated
  docs and the patcher's decoded post-condition.
- **Still stale, and contradicting the code:**
  - `SECURITY.md`, "What the policies mean (and do not)": it says a fixed supply "freezes the `TreasuryCap`"
    and does **not** mark the registry, that frozen metadata leaves the cap state at `Claimed`, that
    recording these "needs a template change", and that a finalize retry "can mint the initial supply
    twice unless … `finalizeToken({ client })` checks the chain first". All four describe the 0.0.6 design;
    since 0.0.9 the registry records both policies (F4), `finalizeToken` has no `client` option and mints
    nothing (F3). The same sub-section also splits the numbered invariant list, so item 5 sits under it.
  - `README.md`, after the recovery example: "Until then the caps stay with the sender and the supply and
    metadata policies are not applied." The policies are applied by `init`, in the publish transaction;
    only the registration and the transfer to the recipient wait for the finalize.
  - `AGENTS.md`: version row `0.0.1`; "Node.js >= 22" (the workspace runs Node 24 LTS only, and
    `package.json` has no `engines` field).
- Impact: a reader of `SECURITY.md` believes the package gives a weaker guarantee than it does; no code or
  funds are affected. Under the base template a `SECURITY.md` that contradicts the audit is itself a finding.

**Baseline recommendation (2026-10-03, done in 0.0.11):** correct each. Remaining fix: rewrite the "What the policies mean"
sub-section from the README's wording, renumber the invariants, and correct the README sentence and the
`AGENTS.md` rows. Single solution, no decision needed; to be shipped with the next patch.

### F12 — Coverage branch gaps on the recovery paths

**Severity:** Info   **Disposition:** RESOLVED (tests added across 0.0.6-0.0.10)
**Where (at the baseline):** coverage: `deploy.ts` branches 69.56% (`:126`, `:206`); `results.ts` branches 79.54%.

**Issue / Impact:** untested branches include:

- `toSuiTxResult` for a `FailedTransaction` and mutated objects;
- a publish with a missing MetadataCap;
- finalize with `currencyRef` absent (F3).

These are the post-publish recovery paths users depend on.

**Remediation / evidence (2026-10-09):** the three named paths are covered.

- `toSuiTxResult` for a failed transaction and for mutated objects: `tests/deploy.test.ts` "maps package
  writes, created and mutated objects", "reports a failed transaction as a failure status (not a throw)".
- A publish with a missing MetadataCap or TreasuryCap: `assertResultMatchesPolicy` tests
  ("refuses every mismatch between the policy and what was created") and `tests/deploy.test.ts`
  "reports a publish whose objects contradict the chosen policy as published, with the digest".
- Finalize with `currencyRef` absent: "finalizeToken has nothing to run when there is no pending currency and
  the recipient is the sender", and "omits finalize_registration when currencyRef is absent".
- The "executor throws after success" test is moot: finalize mints nothing (F3), and the stale-reference
  rejection is chain behaviour (S5, observed on localnet 2026-10-10).
- Current figures: `deploy.ts` branches 66.66%, `results.ts` 85.71%. The deploy.ts gaps are the
  `cause instanceof Error ? … : String(cause)` fallbacks of the two error constructors and optional
  `onStep` calls, not recovery logic.

**Baseline recommendation (2026-10-03, implemented):** add tests, including F3's "executor throws after
success".

### F13 — Positive: one rule set before every sink, and a verified template artefact

**Severity:** Positive

- **`assertTokenConfig`** (`rules.ts:127-172`) runs in `patchTokenModule`, `deployToken` (through the
  patcher) and `buildPackageFiles`. Its checks:
  - package names (not framework address names);
  - module names (not template-imported identifiers or reserved words);
  - `structName == upper(moduleName)`;
  - `SAFE_TEXT` (no quotes, backslashes or control characters, so no `b"…"` or `///` injection);
  - per-field bounds;
  - `https://` and `ipfs://` icons;
  - decimals 0–18;
  - supply overflow against u64;
  - recipient format;
  - a fixed supply needs an initial supply above zero;
  - SPDX characters and the licence name.
- **Defence in depth in the patcher:** it rechecks decimals, `SAFE_TEXT` and the bounds, refuses a
  placeholder-valued text field, refuses a duplicate identifier before publishing (which would otherwise
  fail verification after gas is spent), merges equal constants (F16) and decodes its own output.
- **`gen-template.mjs` checks:**
  - module and source SHA-256 against `build-info.json`;
  - the `a11ceb0b` magic;
  - the source contains every placeholder;
  - a byte-exact decode/encode round trip;
  - each default (text, decimals, `INITIAL_SUPPLY`, `FIXED_SUPPLY`, `FROZEN_METADATA`) occurs exactly once
    in the pool;
  - `TEMPLATE_IMPORTED_IDENTIFIERS` equals the module's actual identifiers;
  - `--check` in CI.
- The template devDependency is pinned exactly (1.0.9 at 0.0.11) and carries provenance; `check:template` matched at
  review.

### F14 — Positive: exact-type result parsing and post-publish error typing (predecessor findings resolved)

**Severity:** Positive. Predecessor `token-deployer-sui-audit.md` findings 4 and 5 are RESOLVED here.

- **Exact-type parsing** (`results.ts:74-126`, refreshed 2026-10-09):
  - exactly one published package;
  - exactly one `0x2::coin_registry::Currency<T>` with `T` defined in that package (look-alike framework
    addresses and other coins rejected). The coin type comes from the Currency, which exists whatever
    the policies are; at the baseline it came from the TreasuryCap, which a fixed supply no longer has;
  - the TreasuryCap, MetadataCap and initial `Coin<T>` are matched to it by exact `T`, at most one each;
  - `assertResultMatchesPolicy` then compares what exists with the chosen policies;
  - throws instead of degrading. This resolves predecessor F5.
- **Icon schemes** are allowlisted (`https://`, `ipfs://`). This resolves predecessor F4.
- **Fail-closed status:** only an explicit `success` status counts (`assertSuccess`).
- **Typed post-publish errors:**
  - every failure after the publish executed is a `PublishedError`;
  - `DeployIncompleteError` carries `pending` for `finalizeToken`;
  - `DeployUnconfirmedError` says "do not retry";
  - token-deployer-ui routes them away from the review step.
- **Bounded listing:** `listMyTokens` dedupes by coin type, throws past `maxPages` and past
  `maxHeldCoinTypes`, and surfaces a failed lookup (F5, F20).

### F15 — Positive: transactions and release chain

**Severity:** Positive

- **Exact fee split.** The fee is split exactly from `tx.gas` inside the publish PTB (predecessor F9).
- **Policies in the signed transactions.** `make_immutable` runs in the same PTB as the publish for the
  immutable policy; an upgradeable package's UpgradeCap goes to the recipient in that PTB (F2). The supply
  and metadata policies are applied by `init` in the same transaction (F4); finalize only registers the
  currency and transfers what exists, atomically.
- **Amounts are `bigint`** (fee, gas, supply); the initial supply is scaled to raw units as a `bigint` and
  written as a `u64` constant (`u64Bytes`, refused above 2^64 - 1); the fee goes through `splitCoins`.
- **Entry-point isolation.** `.` carries no wasm, bytecode or fflate (CLAUDE.md invariant).
- **Wasm init.** It is retried after a failure and the failure is surfaced (`wasm-init.test.ts`).
- **Release chain:**
  - SHA-pinned actions; least privilege;
  - OIDC `--provenance` (0.0.10 verified);
  - `tag == version`; idempotent publish;
  - the release job is the CI workflow (`workflow_call`); declarations built and the tarball checked;
  - weekly grouped Dependabot for npm and Actions.

### F16 — The patcher could write a constant pool the bytecode verifier rejects (equal constants)

**Severity:** Low   **Disposition:** RESOLVED (0.0.9, `677330f`)
**Where:** `src/template/patch.ts:90-116` (`dedupeConstantPool`, called at `:207`). Not in the baseline; fixed
with the policy constants, which add two equal-by-default flags.

**Issue:** the template's constants are distinct on purpose, so the patcher can overwrite them
independently. Patching can make two of them equal: a symbol equal to the name, an empty description and
icon, `FIXED_SUPPLY` and `FROZEN_METADATA` both false. The Move compiler never emits an equal pair, and
the bytecode verifier rejects a module whose pool has one (`DUPLICATE_ELEMENT`). The publish would fail
on-chain after the user signed and gas was reserved.

**Impact:** a valid, common configuration (for example symbol and name both `SAME`, or no description and
no icon) could not be published. No funds are lost beyond the failed transaction's gas, and no wrong
coin is created.

**Remediation / evidence:** `dedupeConstantPool` merges entries of the same type and value and remaps every
`LdConst` to the merged entry; it is the last step before serialising. Tests: `tests/template.test.ts`
"patched constant pool has no duplicates (the verifier rejects them) and LdConst follows the merge"
(equal symbol and name, with every constant still loading its own value; two empty strings and both false
flags in one module; a module with distinct constants is left untouched). Localnet: the equal-constants
publish in `e2e:localnet` is verified on-chain (2026-10-09).

### F17 — `@mysten/sui` is a runtime dependency, not a peer dependency

**Severity:** Info   **Disposition:** RESOLVED (0.0.11, commit `994b951`; decision D34)
**Where:** `package.json` `dependencies` (`@mysten/sui` `^2.33.1`); `README.md` install line
(`npm install @meddleware/sui-token-client @mysten/sui`).

**Issue:**

- TS-M9 (TS lens, 2026-10-08) requires `@mysten/*` packages that the host must share to be peer
  dependencies, so a bundle holds one copy. access-gate-client, seal-client, walrus-client and
  wallet-adapter declare `@mysten/sui` as a peer (`^2.33.2`); this package declares it as a dependency
  with a lower floor (`^2.33.1`).
- Today `npm ls` shows one copy in this repo (2.33.2) and token-deployer-ui declares `^2.34.0`, so the
  ranges overlap and npm dedupes. Nothing enforces that: a host pinning an older or newer major would get
  a second `@mysten/sui`, and `Transaction` instances built here would then be signed by another copy.
- The README already tells the user to install `@mysten/sui` themselves.

**Impact:** a possible duplicate SDK copy in an embedding host (type or `instanceof` mismatch at signing).
No data or funds are affected, and the consumer is aligned today.

**Resolution (2026-10-10):** `@mysten/sui` is in `peerDependencies` (`^2.33.2`) and `devDependencies` (`^2.33.2`, for
the tests); the README install line explains the peer; `node-ci.yml` runs `npm ls --all` after `npm ci` (exit 0
locally). Evidence: `package.json`, `package-lock.json`, `.github/workflows/node-ci.yml`, `npm ls --all`.

**Remediation (baseline):** move `@mysten/sui` to `peerDependencies` (`^2.33.2`) with a matching
devDependency, as access-gate-client did (its F9, 0.0.6), and add `npm ls --all` to CI. `@mysten/move-bytecode-template`
(`~0.4.1`, the wasm) and `fflate` stay dependencies: the host does not share them. Pre-v0.2 policy: a
patch bump, no shim.

### F18 — The generated `publish.sh` and the README licence line still substitute naively

**Severity:** Info   **Disposition:** RESOLVED (0.0.11, commit `994b951`)
**Where:** `src/package.ts:105-111` (`renderPublishScript`: four sequential `replaceAll` calls);
`:146-153` (`renderReadmeLicense`: `String.replace` with the licence name as the replacement string).

**Issue:** F8's fix moved the source, README body and docs to one pass but not these two.

- `renderPublishScript` replaces `SUI_TOKEN_TEMPLATE` by the struct name first, then `XMODULENAMEX` and the
  other keys over the result. A module named `xmodulenamex` has the struct name `XMODULENAMEX`, which is
  then rewritten to `xmodulenamex`. Probe: the generated script has `COIN_TYPE_SUFFIX="::xmodulenamex::xmodulenamex"`
  and lower-case environment-variable names, so its coin-type match fails.
- `renderReadmeLicense` passes `${licenseName} — see the LICENSE file.` as a replacement string, so `$&` and
  `$'` in the licence name are expanded. Probe: `A$&B$'C` renders as `ABSD Zero Clause License (0BSD) — see
  the LICENSE file.B` and `C — see the LICENSE file.`.

**Impact:** only the user's own downloaded package: a broken helper script for a deliberately odd module
name, and a garbled README line for a licence name containing `$&` or `$'`. Neither reaches the chain
and neither is reachable by a third party. The Move source and bytecode are not affected.

**Resolution (2026-10-10):** `renderPublishScript` renders with `replaceMany` (one pass) and `renderReadmeLicense`
gives `String.replace` a function replacer. Evidence: `tests/package.test.ts` ("literal-safe substitution in
publish.sh and the README licence line": module `xmodulenamex` with struct `XMODULENAMEX`, a package and module
named like other keys, licence names `A$&B$'C`, `` A$`B `` and `$$ and $1 and $<x>`, hostile text fields); the 15 new
package tests fail against the 0.0.10 source.

**Remediation (baseline):** render the script with `replaceMany` (one pass) and give `String.replace` a
function replacer for the licence line. Add one test per case. Single solution, no decision needed.

### F19 — `CHAIN_IDS` is indexed by a caller-supplied network name without `Object.hasOwn`

**Severity:** Info   **Disposition:** RESOLVED (0.0.11, commit `994b951`)
**Where:** `src/package.ts:54-57, 235` (`CHAIN_IDS[result.network]`).

**Issue:** the TS lens (*Caller-keyed lookups*) asks for `Object.hasOwn` or a `Map` when a record is
indexed by a network name or id. `network` is typed `TokenNetwork`, but a plain-JavaScript caller (or a
cast) can pass `constructor`. Probe: `buildPackageFiles` then writes a `Published.toml` with
`[published.constructor]` and `chain-id = "function Object() { [native code] }"`.

**Impact:** a malformed `Published.toml` in the user's own downloaded package, from a caller bug. Not
reachable from user input in the consumer (the network comes from its own config).

**Resolution (2026-10-10):** `chainIdOf` reads `CHAIN_IDS` by own key only. Every other lookup keyed by a caller or
node value in `src` was checked: `rename[id]` in the patcher (module identifiers) and `types[c.objectId]` in
`toSuiTxResult` (object ids from the node) had the same shape and now use `Object.hasOwn`; the remaining
indexed reads use fixed internal keys (`TEMPLATE_DEFAULTS[k]`, `TEXT_LIMITS[key]`, the `replaceMany` match). Evidence:
`tests/package.test.ts` ("Published.toml chain ids are looked up by own key": `constructor`, `toString`,
`__proto__`, `hasOwnProperty`, `valueOf` write no `Published.toml`; testnet and mainnet still do),
`tests/deploy.test.ts` (object id `constructor` gets no inherited type).

**Remediation (baseline):** `Object.hasOwn(CHAIN_IDS, result.network) ? CHAIN_IDS[result.network] : undefined`
(or a `Map`). One test.

### F20 — `listMyTokens` throws for a wallet that holds coins from more than 200 foreign packages

**Severity:** Info   **Disposition:** ACCEPTED-RISK (fail closed by design; the limit is a caller option)
**Where:** `src/tokens.ts:16, 109-118` (`DEFAULT_MAX_HELD_COIN_TYPES = 200`).

**Issue:** the capability-less rule (F5) must look up the publisher of every held coin's package. Anyone
can send a coin of their own package to any address, so an attacker can make a victim wallet hold many
foreign packages. Past `maxHeldCoinTypes` the function throws instead of returning a partial list, and
within the limit it makes one `getObject` and one `getTransaction` per package (five at a time).

**Impact:** a spammed wallet cannot list its tokens with the default limit (a denial of the listing, not
of the wallet's funds), and a wallet near the limit pays up to 400 reads per call. The list is never
wrong: it is either complete or an error.

**Remediation / evidence (ACCEPTED-RISK):** the alternative is a silent partial list, which the "no silent
truncation" invariant forbids. Callers can raise `maxHeldCoinTypes` or catch the error and fall back to the
capability-based rows. Not verified here: how token-deployer-ui presents the error (its own audit).

**Re-evaluated 2026-10-10 (OQ4):** no single best-practice fix exists. A cheaper read does not exist (the publisher
of a package is only known from its publishing transaction), a silent skip breaks the no-truncation invariant, and
returning a partial list with an `incomplete` flag changes the return type and the consumer contract (a product
choice). Left ACCEPTED-RISK; the options and the recommendation are in OQ4.

### F21 — Generated packages carry no `Move.lock` (client half of template F7)

**Severity:** Info   **Disposition:** RESOLVED (0.0.11, commit `994b951`; found 2026-10-10)
**Where:** `src/package.ts` `buildPackageFiles`; `scripts/gen-template.mjs` `FILES`.

**Issue:** `@meddleware/sui-token-template` 1.0.9 ships `Move.lock` (the framework revision it was built and tested
with) and its CLI generator copies it into every generated package with the root package pin renamed. The
client's source package did not, so a downloaded package resolved the framework at whatever the toolchain
picked, not the revision the shipped bytecode was built against.

**Impact:** a generated package could build to different bytecode than the one published (framework drift). No
funds or on-chain values were affected; the published coin is the patched template bytecode.

**Resolution (2026-10-10):** `gen-template.mjs` reads `Move.lock` into `TEMPLATE_FILES`; `renderMoveLock` replaces
exactly the one line `[pinned.testnet.sui_token_template]` with `[pinned.testnet.<packageName>]` (as `set_line` in
`03_create_token.sh`), fails on template drift (not exactly one such line, or the template name left over), and
`Move.lock` is in the file map and the zip. Evidence: `tests/package.test.ts` ("Move.lock carries the template
framework pin": only the root pin changes, the revision equals the template's, zip entry present),
`scripts/e2e-localnet.mjs` (the generated lock pins the new package), `npm run check:template` (1.0.9).

---

## Section A — Invariant verification matrix

| # | Invariant | Enforced at | Proven by | Status |
| --- | --- | --- | --- | --- |
| A1 | No unvalidated value reaches Move source or bytecode | `assertTokenConfig`; patcher rechecks (`rules.ts:127-172`, `patch.ts`) | `rules.test.ts`, `template.test.ts` | HOLDS |
| A2 | The patched module and the rendered Move source encode exactly the config | `patch.ts:184-232` (pristine-pool slots, placeholder refusal, decoded post-condition), `package.ts` `replaceMany` | `template.test.ts` (F1 cases), `package.test.ts` (one-pass; hostile values) | HOLDS — F1, F18 (the generated `publish.sh` and README licence line render in one literal pass) |
| A3 | The shipped module is the pinned template's | `gen-template.mjs` + `check:template` | CI (`node-ci.yml`) | HOLDS |
| A4 | Exact type matching; the coin belongs to the published package | `typeNames.ts`, `results.ts` | look-alike, nested-generic, long-form tests | HOLDS |
| A5 | Only explicit success counts; post-publish failures are typed | `deploy.ts` (`assertSuccess`, `PublishedError` family) | `deploy.test.ts` | HOLDS |
| A6 | Recovery never duplicates effects | `buildFinalizeTransaction` mints and freezes nothing; `finalizeToken` | `transactions.test.ts`, `deploy.test.ts`; `e2e:localnet` runs a second finalize and the chain refuses it without effect (S5, 2026-10-10) | HOLDS — F3 |
| A7 | The recipient receives every authority that exists | `transactions.ts:49, 124-127` | `transactions.test.ts` (UpgradeCap, supply and caps to the recipient) | HOLDS — F2 |
| A8 | Declared policies are discoverable on-chain | template 1.0.8 `init`; `patch.ts` constants; `assertResultMatchesPolicy` | `template.test.ts`, `transactions.test.ts`; `e2e:localnet` reads the registry's `Fixed` and deleted-cap state | HOLDS — F4 |
| A9 | Fee split exact, in the publish PTB; recipient validated | `buildPublishTransaction` | `transactions.test.ts` | HOLDS — F7 |
| A10 | No silent truncation | `listMyTokens` | `tokens.test.ts` (paging, too many packages, failed lookup) | HOLDS — F5, F20 |
| A11 | No environment reads or logging; caller supplies network, fee and executor | `src/**` | grep (no `console`, `process`, `import.meta.env`) | HOLDS |
| A12 | ABI coupling has a drift test | `tests/abi-table.ts` + `tests/integration/abi-drift.integration.test.ts` | completeness test; live suite weekly in `live.yml` (6/6 on 2026-10-09) | HOLDS |
| A13 | The patched constant pool has no duplicates and every `LdConst` points at its own value | `dedupeConstantPool` (`patch.ts:90-116`) | `template.test.ts` merge tests; localnet equal-constants publish | HOLDS — F16 |
| A14 | What the publish created matches the chosen policies | `assertResultMatchesPolicy` (`results.ts:136-158`), called by `deployToken` and `buildFinalizeTransaction` | `transactions.test.ts`, `deploy.test.ts` | HOLDS — F4 |
| A15 | TS: compiler strictness | `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`; `skipLibCheck` hides only declaration files, not `src` | `tsc --noEmit` in CI | HOLDS |
| A16 | TS: assertions at trust boundaries are justified | the `as unknown as` casts in `patch.ts:36, 142, 209, 213` act on the shipped module and the patcher's own output, not on RPC data; the `!` on `tokens.ts:99-103` follow `has` guards or a coin type already parsed from a struct tag, and each carries an inline reason since 0.0.11 | code reading; no `any`, no `eslint-disable` | HOLDS (code-only) — S6 |
| A17 | TS: untrusted data is validated field by field, fail closed | `extractPublishResult` copies fields into a fresh literal; `listMyTokens` copies ids; unknown shapes yield `null` or a throw | `transactions.test.ts`, `tokens.test.ts` | HOLDS — no JSON is parsed here, so there is no size check to make |
| A18 | TS: no swallowed rejections | the one `.catch` rethrows (`patch.ts:40`); the one `catch {}` returns `null` so an unparseable type never matches (`typeNames.ts:15`) | `wasm-init.test.ts`, `typeNames.test.ts` | HOLDS |
| A19 | TS: network I/O has timeouts | no `fetch` in `src`; RPC runs through the caller's client; the wasm URL is loaded by the SDK from a host-supplied source | grep | N/A (host-supplied wasm load has no timeout here) |
| A20 | TS: encoding is correct for non-ASCII input | text is ASCII-only by rule; BCS strings via `bcs.string()`, base64 via SDK helpers, zip via `strToU8`; no `btoa`/`atob` | grep; `rules.test.ts` | HOLDS |
| A21 | TS: no secrets in output, no dynamic code, no test-only mode | no logging or `eval`; no mock mode in `src` (mocks live in `tests/`) | grep | HOLDS |
| A22 | TS: caller-keyed lookups use `Object.hasOwn` | `chainIdOf` (`Object.hasOwn`), the patcher's identifier rename and `toSuiTxResult`'s type lookup use own keys | `package.test.ts` (`constructor`, `__proto__`, …), `deploy.test.ts` | HOLDS — F19 |
| A23 | TS: comments and docs match the code | source comments, `SECURITY.md`, the README, `AGENTS.md` and `CLAUDE.md` describe the `init`-applied design | reading | HOLDS — F11 |
| A24 | SC: ABI mirroring | `buildPublishTransaction` / `buildFinalizeTransaction`; `make_immutable` (1 arg), `finalize_registration<T>(0xc, Receiving)` | exact-command tests (target, argument values and order); live arity check | HOLDS |
| A25 | SC: package-id semantics | only `0x1`, `0x2`, `0xc` literals; the coin type is read from the publish effects | n/a | N/A (no first-party package ids) |
| A26 | SC: network / chain binding | the caller owns the RPC client and the wallet chain; `network` labels the result; chain ids written into `Published.toml` match each network | live drift test; localnet gets no `Published.toml` | HOLDS (code-only) |
| A27 | SC: value encoding | amounts are `bigint`; the supply is scaled as a `bigint` and checked against u64 in `rules.ts` and `patch.ts`; the recipient and fee recipient must be full 66-character addresses; `tokens.ts` compares normalised addresses | `rules.test.ts`, `transactions.test.ts` | HOLDS — `transactions.ts` compares the sender and the recipient with `normalizeSuiAddress` since 0.0.11 (S6) |
| A28 | SC: funds in the PTB | one `splitCoins(tx.gas, [fee])` to the recipient, the UpgradeCap or `make_immutable`, and the `transferObjects` of what `init` created; nothing else moves | `transactions.test.ts` (exact commands) | HOLDS |
| A29 | SC: capabilities and irreversible operations | `make_immutable` consumes the UpgradeCap only under the `immutable` policy, in the publish PTB the user signs; the UI confirmation lives in token-deployer-ui | `transactions.test.ts` | HOLDS |
| A30 | SC: execution result | `assertSuccess`; `waitForTransaction` before the finalize and before returning; a wait failure is `DeployIncompleteError` / `DeployUnconfirmedError`, never swallowed | `deploy.test.ts` | HOLDS |
| A31 | SC: read parsing | struct tags parsed and normalised, never matched by suffix; missing type or field fails closed | `typeNames.test.ts`, `transactions.test.ts` | HOLDS |
| A32 | SC: events, off-chain signature verification, dry-run PTBs | none used | n/a | N/A |
| A33 | SC: client-side publish | pinned and hash-checked bytecode; patcher post-condition; UpgradeCap policy in the publish PTB; created ids by exact type; two-phase recovery; layered injection guards | F1, F2, F13, F14, F16 | HOLDS |
| A34 | SC: chain-access layering (ADR-0001) | this package is the single domain client for the token template; the consumer keeps UI and wallet wiring | token-deployer-ui `package.json`/`CLAUDE.md` | HOLDS |

---

## Section B — Supply-chain, publish-authority & capability matrix

### B.1 Dependency & CVE risk

`npm audit --audit-level=high`: 0 (2026-10-10); `npm ls --all` exits 0 and runs in CI.

| Dependency | Range (installed) | Liveness dependency? | Status | Notes |
| --- | --- | --- | --- | --- |
| `@mysten/sui` | peer `^2.33.2` (dev 2.33.2) | PTBs, types, BCS | clean | a peer since 0.0.11, as in the sibling SDKs (F17) |
| `@mysten/move-bytecode-template` | `~0.4.1` (0.4.1) | patching (wasm); a load failure surfaces and the next call retries | clean | round trip checked at generation; decoded post-check at patch time (F1) |
| `fflate` | `^0.8.3` (0.8.3) | zip | clean | |
| `@meddleware/sui-token-template` (dev) | `1.0.9` exact | artefact generation | provenance | hashes checked by `check:template` |
| Sui full nodes (public) | n/a | `test:integration` and the caller's executor | n/a | the library makes no RPC calls except the reads of `listMyTokens`, through the caller's client; all fail closed |

**TS lens shared-dependency matrix row:**

| Package | dependency | devDependency | peer |
| --- | --- | --- | --- |
| `@mysten/sui` | — | `^2.33.2` (tests) | `^2.33.2` (F17) |
| `@mysten/move-bytecode-template` | `~0.4.1` (third-party wasm helper; the same range in token-deployer-ui) | — | — |
| `typescript` / `vitest` | — | `~6.0.3` / `~5.0.2` (installed 6.0.3 / 5.0.3) | — |

#### B.TS-1 Packaging

| Check | Result |
| --- | --- |
| `exports` / `types` | four entry points, each with a `types` condition (`dist/*.d.ts`) and a `default` condition (`src/*.ts`) |
| `files` | `src`, `dist`, `CHANGELOG.md`; `npm pack --dry-run`: 30 files, 45.7 kB, no tests, fixtures, `.env*` or keys (`README.md`, `LICENSE` and `package.json` are added by npm). `SECURITY.md` is not shipped |
| `sideEffects` | `false`, accurate: no module has import-time effects (the wasm is loaded on the first patch) |
| Ships-source | consumers resolve types from `dist`; CI builds the declarations and checks the tarball |

#### B.TS-2 Install-time code

| Item | Where | Reason |
| --- | --- | --- |
| `prepublishOnly` | `package.json` | builds `dist` before a publish |
| `preinstall` / `install` / `postinstall` / `prepare`, `allowScripts`, `overrides` | none | — |
| Dependency install scripts | `fsevents` 2.3.3 only (optional, macOS, a dev dependency of the test runner) | not a runtime dependency |

#### B.TS-3 Supply-chain gates

- Lockfile committed; CI and publish install with `npm ci`; the publish job pins `npm@11.20.0`.
- `npm audit --audit-level=high` runs in `node-ci.yml`, which the publish `verify` job reuses; no allowlist
  is in use.
- The weekly `live.yml` and the grouped weekly Dependabot configuration (npm and Actions) keep SHAs and
  ranges fresh. The 2026-10-09 triage merged the minor and patch group (`fb7301b`, lockfile only; not yet
  released).

### B.2 Publish authority & CI

| Authority | Where | Custody | Gates |
| --- | --- | --- | --- |
| npm publish `@meddleware/sui-token-client` | `npm-publish.yml` (tag `v*`) | OIDC trusted publishing; `--provenance` | releases |
| Fee treasury | consumer configuration | app (build-time guard) plus the library's address check | per-deploy fee |
| Capabilities of published coins | created by the coin's `init` | the recipient (or the sender); the registry holds a fixed supply's cap; the UpgradeCap goes to the recipient or is burned | per coin |

#### CI & release integrity

| Item | Holds? | Evidence |
| --- | --- | --- |
| Actions pinned | Yes | SHA pins in all three workflows; actionlint by digest |
| Least privilege | Yes | `contents: read` everywhere; `id-token: write` only on the publish job |
| OIDC trusted publishing | Yes | 0.0.10 attestation (SLSA v1) |
| Tag-gated, idempotent publish | Yes | `v*` tags; tag equals `package.json`; registry check before publishing |
| Release gate equals CI | Yes | `verify` calls `node-ci.yml` (`workflow_call`) |
| Automated dependency updates | Yes | `.github/dependabot.yml`: weekly, grouped, npm and Actions |
| Secrets never echoed | Yes | no secrets are used |
| Real funds manual | Yes | no CI job signs; `live.yml` is read-only; the e2e uses a faucet on a local chain |
| Test-only modes | N/A | no mock or test mode in `src` |
| Generated-artefact drift check | Yes | `check:template` in CI and publish |
| Live drift | Yes | weekly `live.yml`, `workflow_dispatch` |
| Localnet e2e | No (by hand) | F9 (MITIGATED) |

### B.SC-1 ID-constant trace

| Location | Value | Kind | Source of truth |
| --- | --- | --- | --- |
| `transactions.ts:18-19` | `0x1`, `0x2` | system packages | protocol |
| `transactions.ts:120` | `0xc` | coin registry | protocol |
| `package.ts` (`CHAIN_IDS`) | testnet `4c78adac`, mainnet `35834a8a` | chain ids in `Published.toml` | live integration test (weekly) |
| `artifact.ts` | template module and hashes | bytecode | `sui-token-template@1.0.9` |

No first-party package id is held: the table needs no per-network original-id / published-at record.

### B.SC-2 Coupling table

| Framework call | Builder | Test |
| --- | --- | --- |
| `publish(modules, [0x1, 0x2])` + `0x2::package::make_immutable` / transfer of the UpgradeCap | `buildPublishTransaction` | exact-command tests; live arity check (`make_immutable`) |
| `0x2::coin_registry::finalize_registration<T>(0xc, Receiving<Currency<T>>)` | `buildFinalizeTransaction` | exact-command tests; live arity check |
| `transferObjects` of the initial `Coin<T>`, TreasuryCap and MetadataCap | `buildFinalizeTransaction` | same |

`coin::mint` and `transfer::public_freeze_object` are no longer called (F4); the ABI table lists only the
two Move calls above.

### B.SC-3 Parity

The source package is rendered from the same template text, with the same values as the patched
bytecode (`package.ts`), in one pass. Parity holds for valid inputs and for placeholder-valued ones (F1:
refused, or rendered once). Outside the Move source, the generated `publish.sh` and the README licence
line are rendered in the same literal pass (F18, 0.0.11); the generated `Move.lock` is the template's with the root pin renamed (F21).

### B.OPS-1 Runbook linkage

| Script | Purpose | Dry-run command | Recovery command | Linked from |
| --- | --- | --- | --- | --- |
| `scripts/e2e-localnet.mjs` | real deploy against a local network, with registry-state, recovery, refused-second-finalize and listing checks | n/a (it signs only with an ephemeral key on a chain it refuses to run against if public) | rerun after `sui start --with-faucet --force-regenesis` | README "Development", `CLAUDE.md` "Testing", `AGENTS.md` |
| `scripts/gen-template.mjs` | writes or checks the template artefact (no chain access) | `npm run check:template` | `npm run gen:template` | README, `CLAUDE.md`, `AGENTS.md` |

---

## Section C — Test-coverage & hermetic/live split

### C.1 Coverage grade — A (148/148; 97.92% statements, 90.97% branches, 100% functions, 99.17% lines; 2026-10-10)

| Dimension | Assessment |
| --- | --- |
| Happy path | Rules, patching (text, decimals, supply and policy constants), builders (exact commands), parsing, deploy, finalize recovery, listing (both rules), package generation, Walrus-URL icons, wasm init |
| Error path | Every rule; look-alike types; missing and extra caps (`assertResultMatchesPolicy`); failed publish and finalize; confirmation failures (typed); failed transaction mapping; listing overflow and failed lookup; a second finalize rejected by a real chain (`e2e:localnet`, S5) |
| Boundary | Limits per field; decimals 0 and 18; u64 supply edge; placeholder-valued text; equal constants; empty strings; a fixed supply with zero supply; a module named like a template key in the generated script and `$` sequences in the licence name (F18) |
| Security-relevant | Strong on injection, type matching, policy fidelity and the patcher post-condition. Recipient authority and registry-recorded policies are covered (F2, F4). Prototype keys in `CHAIN_IDS` and in the object-type map are covered (F19); so is the generated `Move.lock` (F21) |

**Test layers:**

| Layer | Files | In CI? | Gate |
| --- | --- | --- | --- |
| Unit | 11 files, 148 tests | yes (`node-ci.yml`, and the publish `verify`) | `npm test` |
| Live read (ABI drift + chain ids, testnet and mainnet) | `tests/integration/abi-drift.integration.test.ts` (6 tests) | yes, weekly (`live.yml`) | `GRPC_TESTNET=1` (`npm run test:integration`) |
| Localnet e2e (deploy, registry state of fixed/frozen coins, equal-constants publish, refused-finalize recovery, refused second finalize, listing, balance, package) | `scripts/e2e-localnet.mjs` | **no** (run by hand before a release; PASS 2026-10-10) | needs `sui start --with-faucet`; `E2E_ALLOW_PUBLIC=1` overrides the public-network guard |
| Real-chain deploy (testnet / mainnet) | token-deployer-ui `e2e:*` | manual, in the consumer | the consumer's own gates |

### C.2 Hermetic vs. live paths

| Path | Hermetic? | Deferred to | Tracking |
| --- | --- | --- | --- |
| Patched module passes on-chain bytecode verification | no | localnet e2e (manual before a release; PASS 2026-10-10) | F9, F16 |
| Finalize semantics (registration, transfers) and the registry's recorded policies | builder shape only | localnet e2e | F3, F4 |
| A repeated finalize is rejected without effect | no (needs a chain) | localnet e2e (PASS 2026-10-10: the chain reports the consumed Currency as not found; balance and registry state unchanged) | F3, S5 |
| Framework ABI | arity table | live drift (weekly) | F9 |
| Capability-less listing against real balances and packages | mocked client | localnet e2e (fixed/frozen coin listed) | F5 |

---

## Section D — Deployment-readiness gates

### pre-localnet

- [x] rules enforced before every sink; artefact verified; strict TS; tests green — F13 (148/148, tsc, eslint clean; 0.0.11)
- [x] patcher post-condition and placeholder rejection — F1, F8 (0.0.6, `6d3b7c2`)
- [x] strict type-check and lint green; no swallowed promises on security paths — A15, A18
- [x] untrusted parsers validate every field (no JSON parsed; effects and types parsed strictly) — A17
- [x] the e2e script is the only signing script; it uses an ephemeral key and refuses a public chain — F10
- [x] every builder and parser tested; no JSON-RPC; full-type matching; effects status checked — A24, A30, A31

### pre-testnet *(the consumer is live on testnet)*

- [x] exact-type parsing; typed post-publish errors; exact-split fee — F14, F15
- [x] finalize retry idempotent — F3 (0.0.9: finalize mints nothing)
- [x] live drift in CI (weekly `live.yml`, 6/6 on 2026-10-09); localnet e2e run by hand before a release (PASS 2026-10-10) — F9 (MITIGATED; a CI localnet job is a maintainer decision)
- [x] `npm pack` contents verified (30 files); B.TS-2 inventory complete — B.TS-1, B.TS-2
- [x] audit gate in CI and publish (`npm audit --audit-level=high`, 0) and `npm ci` — B.TS-3
- [x] consumed ids: system ids only, chain ids drift-tested; ABI-drift test green — B.SC-1, A12
- [x] shared-dependency matrix aligned with ADR-0001: `@mysten/sui` is a peer (`^2.33.2`) and a devDependency; `npm ls --all` in CI — F17 (0.0.11, commit `994b951`; `package.json`, `node-ci.yml`)
- [x] `SECURITY.md` consistent with the code — F11 (0.0.11, commit `994b951`; rewritten policies section, README, `AGENTS.md`, `CLAUDE.md`)
- [x] generated packages carry the template's `Move.lock` (root pin renamed) — F21 (0.0.11, commit `994b951`; template 1.0.9, template audit F7 client half)
- [x] a second finalize is refused by a real chain without effect — S5 (`e2e:localnet`, PASS 2026-10-10)

### pre-mainnet *(the consumer deploys on mainnet with a manual guard)*

- [x] UpgradeCap routing decided and implemented — F2 (OQ1)
- [x] policy discoverability through the coin registry — F4 (OQ2); proven on localnet
- [x] fee recipient validated in the library — F7
- [x] chain ids for mainnet drift-tested live (weekly) — A12
- [x] no raw `btoa`/`atob`, every fetch with a timeout (none), no unjustified assertions at trust boundaries (the `!` lines carry reasons, A16, S6), caller-keyed lookups by own key — F19 (0.0.11, commit `994b951`; `tests/package.test.ts`, `tests/deploy.test.ts`)
- [ ] external review — maintainer-only (`OPERATOR_TASKS.md`, external review before mainnet)

---

## Cross-project themes

- **Supply chain:** the strongest artefact pipeline among the SDKs. A pinned, provenance-attested
  template (1.0.9); hash-checked generation; a round-trip check; CI drift checks; `npm ci`, `npm ls --all`, an
  audit gate in CI and publish, SHA-pinned Actions, OIDC provenance (0.0.10), grouped weekly Dependabot.
  `@mysten/sui` is a peer, as in the fleet pattern (F17, 0.0.11).
- **Wire-format coupling:** template bytecode ↔ generated source ↔ the patcher's constant map, kept in
  step by `gen-template.mjs` (including the three policy constants) and, at patch time, by the pristine-pool
  resolution, the constant-pool merge and the decoded post-condition (F1, F16). Framework calls are drift-tested
  live every week.
- **On-chain-truth boundary:** the supply and metadata policies are applied by the coin's own `init` in the
  signed publish transaction, and the coin registry records them (F4). The library checks what the publish
  created against the policy before it goes on. Nothing in the client decides accounting.
- **Deployment readiness:** Section D is current; the one unticked item is the external review
  (maintainer-only).
- **Chain-access layering (ADR-0001):** this is the domain client for the token template. The consumer
  keeps only UI and wallet wiring (token-deployer-ui 0.0.35 pins `^0.0.10`); IDs are framework constants.
- **Pre-v0.2 policy:** every fix since the baseline was a patch bump that changed exported behaviour without
  shims (0.0.6, 0.0.9, 0.0.10 and 0.0.11 are marked breaking in the CHANGELOG). F11, F17-F19 and F21 shipped
  in 0.0.11; token-deployer-ui follows with `^0.0.11` (it already declares `@mysten/sui` `^2.34.0`).
- **Shared with sibling audits:**
  - access-gate-client F9 (`@mysten/sui` as a peer: fixed there, fixed here as F17 in 0.0.11);
  - walrus-client F7 (recovery that can double-charge or double-act: resolved here as F3);
  - sui-token-template audit F6 (registry policies, closed by template 1.0.8), F7 (`Move.lock`: the client half is
    F21 here) and F9 (client coupling);
  - token-deployer-sui predecessor F4 and F5 (resolved: F14).

---

## Normative requirements (MUST / MUST NOT)

1. MUST publish a module whose constants and identifiers equal the validated config, verified after
   patching — **holds** (F1: pristine-pool slots, placeholder refusal, decoded post-condition; F16: valid
   constant pool).
2. MUST route every authority object to the configured recipient, or disclose otherwise in the result
   and docs — **holds** (F2: the UpgradeCap goes to the recipient; the generated README says so).
3. MUST NOT let a recovery retry repeat an already executed finalize — **holds** (F3: finalize mints and
   freezes nothing; a repeat is rejected by the chain, observed on localnet 2026-10-10, S5).
4. MUST make declared supply and metadata policies verifiable through the coin registry, or document
   why not — **holds** (F4: applied in `init`; `e2e:localnet` reads the registry).
5. MUST validate the fee recipient as a full, non-zero address — **holds** (F7).
6. MUST keep `SECURITY.md`, `README.md` and `AGENTS.md` consistent with the code — **holds** (F11, 0.0.11).
7. MUST declare the `@mysten/sui` copy the host shares as a peer dependency (TS-M9) — **holds** (F17, 0.0.11).
8. MUST render every generated file literally and carry the template's `Move.lock` (template F7) — **holds**
   (F18, F21, 0.0.11).

**SUI_CLIENT lens baseline:**

| ID | Holds? | Evidence |
| --- | --- | --- |
| SC-M1 | N/A (framework IDs only; no first-party package) | B.SC-1 |
| SC-M2 | yes | A4, A31 |
| SC-M3 | yes (explicit success; finality awaited before finalize and before reporting) | A5, A30 |
| SC-M4 | yes (`bigint` amounts; full-form addresses; `tokens.ts` and `transactions.ts` compare normalised addresses, S6) | A27 |
| SC-M5 | caller-supplied network, RPC client and wallet; chain ids drift-tested; no first-party ids to fail closed | A26 |
| SC-M6 / SC-M7 | N/A (no signature verification, no authorising events) | A32 |
| SC-M8 | N/A (no dry-run PTBs) | A32 |
| SC-M9 | yes (created objects by exact type, coin type from the Currency) | F14 |
| SC-M10 | yes (this package is the domain client) | A34 |

**TS lens baseline:**

| ID | Holds? | Evidence |
| --- | --- | --- |
| TS-M1 | yes (`strict`, `noUncheckedIndexedAccess`; the casts and `!` are on trusted or guarded values, the `!` lines carry inline reasons, S6) | A15, A16 |
| TS-M2 | yes (config, licence fields and effects validated; no JSON parsed) | F6, A17 |
| TS-M3 | yes | A27 |
| TS-M4 | yes | A18 |
| TS-M5 | N/A (no fetch; RPC through the caller's client; the wasm source is host-supplied) | A19 |
| TS-M6 | yes (no logging, no dynamic code) | A21 |
| TS-M7 | yes (`files` whitelist, 30-file pack; install-time inventory in B.TS-2) | B.TS-1, B.TS-2 |
| TS-M8 | yes (`npm ci`, `npm ls --all`, audit gate with no allowlist, npm pinned; `@mysten/sui` is a peer) | B.TS-3, F17 |
| TS-M9 | yes (`@mysten/sui` is a peer dependency; `.d.ts` declarations are shipped) | F17 |

**OPS lens (scoped):**

| ID | Holds? | Evidence |
| --- | --- | --- |
| OPS-M1 | yes (chain-identifier check before signing; the signer is the ephemeral key; no CLI is called) | F10 |
| OPS-M2 | N/A (a Node script, no shell) | — |
| OPS-M3 | N/A (publishes only to a throwaway chain; the immutable policy is exercised on localnet) | — |
| OPS-M4 | yes (gRPC objects, not scraped text) | — |
| OPS-M5 | N/A for recovery commands on an ephemeral chain; the script prints the coin types and package ids it creates | — |
| OPS-M6 | N/A (writes no ids) | — |
| OPS-M7 | yes (no key in CI; the CI jobs do not sign) | B.2 |
| OPS-M8 | yes (no real-chain job exists; `live.yml` is read-only) | B.2 |
| OPS-M9 | N/A (touches no global CLI state) | — |

## Implementation suggestions (SHOULD / MAY)

- **S1** (F1) *Implemented in 0.0.6:* the patcher decodes and checks its own output
  (`patchTemplateModule`); the `verifyPatchedModule` helper proposed at the baseline was not needed.
- **S2** (F4) *Superseded:* the optional third "record policies" transaction was replaced by applying the
  policies in `init` (OQ2).
- **S3** MAY include `upgradeCapOwner` in `PublishResult` and in the generated `deployments.md` (F2); the
  README note already states who holds the UpgradeCap.
- **S4** MAY derive `feeMist` and `feeRecipient` in the result from the effects' balance changes (F7).
- **S5** *Implemented in 0.0.11:* `e2e:localnet` runs `finalizeToken` a second time on an already finalized
  coin; the chain refuses it (the consumed Currency is "not found") and the balance and registry state do not
  change (F3, C.2; PASS 2026-10-10).
- **S6** *Implemented in 0.0.11:* `transactions.ts` compares addresses with `normalizeSuiAddress`, and the `!`
  assertions in `tokens.ts` carry an inline reason (A16, A27).
- **S7** SHOULD add `engines` to `package.json`, matching the workspace's Node 24 LTS decision (F11). Not done:
  the fleet's `engines` strings differ (`^22.18.0 || >=24.12.0` in the apps; none in the sibling SDKs), so the
  value is a fleet decision, not a local one (OQ5).

## Open questions (`OQ#`)

1. **OQ1** F2: should the UpgradeCap go to the recipient? Or should "upgradeable with a recipient"
   be refused, so that upgrade authority and coin control are never split silently?
   (Decided 2026-10-08: the UpgradeCap goes to the recipient, default the sender — see F2, 0.0.6.)
2. **OQ2** F4: record policies through a third transaction (one more signature) or through a template
   change (`make_supply_fixed_init` in `init`)? The latter needs a new template release and
   regenerated bytecode.
   (Decided 2026-10-09: through the template, applied in `init` — see F4, template 1.0.8 and client 0.0.9.)
3. **OQ3** F5: should "my tokens" mean "coins I can mint" (today) or "coins I deployed"?
   (Decided 2026-10-09: "coins you can mint or edit, plus coins you hold from a package you published";
   a coin whose caps went to a recipient lists under the recipient, a coin merely received does not — see F5,
   0.0.7 and 0.0.10.)
4. **OQ4** F20: what should `listMyTokens` do for a wallet holding coins from more than `maxHeldCoinTypes`
   foreign packages? Options: (a) throw, as today (fail closed, complete or an error); (b) return the
   capability-based rows plus an `incomplete: true` marker for the capability-less part, which changes the
   return type and every caller; (c) raise the default limit, which only moves the cliff and the read cost.
   Recommendation: keep (a). The caller already has the escape hatches (`maxHeldCoinTypes`, or catch and show the
   capability rows), and (b) is a consumer-contract decision for token-deployer-ui's owner.
5. **OQ5** S7: which `engines` value should the SDK packages declare (`^22.18.0 || >=24.12.0` as the apps do, or
   `>=24`)? Recommendation: decide once for the fleet, then add it here in a patch.

## Risks

- **Permanent outcomes:** symbol, name, decimals and package identity cannot be fixed after publish.
  Patcher correctness (F1, F16), the result-versus-policy check and the app's preview are the safeguards;
  the localnet e2e is the only proof that a patched module verifies on-chain, and it is not a CI job (F9).
- **Wallet / executor behaviour:** recovery depends on executors reporting post-submission errors
  distinguishably (F3); a mistaken classification cannot now duplicate a mint, but it can misreport whether
  the setup is complete.
- **Template coupling:** a template release changes every future coin. The pinned artefact, `check:template`
  and the constant-by-constant generator checks bound this; a template that changed the shape of `init`
  would need the patcher and the policy check to follow.
- **Framework drift:** the registry API (`make_supply_fixed`, `finalize_registration`) is a framework
  contract; the weekly live suite and the pinned framework revision (`83f11dc8…`) bound it.
- **Third-party liveness:** none of the client's own paths depends on a hosted service; the caller's RPC
  endpoint, wallet and the wasm source are its liveness dependencies, and all fail closed.

---

## Re-verification log

- 2026-10-03 — first-pass baseline at `6f09bb2` (tag `v0.0.5`, npm 0.0.5 with provenance).
  - **Lenses:** AUDIT_TEMPLATE.md (2026-10-02) + SUI_CLIENT (2026-09-30) + TS (2026-10-03) + OPS
    (2026-09-30, the e2e script only).
  - **Measured:** 87/87 tests; coverage 98.24 / 89.21 / 99.42; tsc, eslint, audit (0) and
    `check:template` clean; build OK; pack 30 files.
  - **Probes:** confirmed F1 (patcher and source renderer) and F8 (doc placeholders). All deleted
    afterwards. Checked the pinned framework's `coin_registry` API
    for F4.
  - **Predecessor:** token-deployer-sui audit findings 4 and 5 recorded as resolved here (F14).
  - **Not run:** the live integration test and the localnet e2e (egress, no local network).
  - **Recorded:** F1–F15; OQ1–OQ3.
  - **No findings resolved:** by maintainer instruction this pass only records findings. Remediation,
    including single-solution fixes under the resolve-inline rule, is to be applied separately, with
    each disposition moved to RESOLVED and the diff cited.

- 2026-10-09 — Re-verified at `main` `fb7301b` (release tag `v0.0.10` = `e70a5ab`, npm `latest`, provenance
  present) against template 1.0.8 and the 2026-10-09 localnet run.
  - **Measured:** vitest 126/126 (10 files); coverage 97.88 / 90.71 / 100 / 99.15; tsc, eslint,
    `npm audit --audit-level=high` (0) and `check:template` (1.0.8) clean; live read-only suite 6/6; pack
    30 files, 43.9 kB. `e2e:localnet` was not re-run here; the maintainer's 2026-10-09 run passed.
  - **F1-F8, F10 and F12 RESOLVED** (0.0.6 `6d3b7c2`: F1, F2, F3 first part, F8; 0.0.7 `bd58328`: F6, F7,
    F10; 0.0.9 `677330f`: F3 final, F4; 0.0.10 `e70a5ab`: F5; tests for F12 across 0.0.6-0.0.10).
    **F9 MITIGATED:** weekly live suite, build and tarball check, no `--if-present`, release gate equals CI;
    the localnet e2e stays a manual pre-release run. **F11 DEFERRED** (docs; see below). F13-F15 stay
    Positive and were refreshed.
  - **New findings:** F16 (RESOLVED: the patcher merges equal constants, which the verifier rejects);
    F17 (Info, DEFERRED: `@mysten/sui` is a dependency, not a peer; TS-M9); F18 (Info, DEFERRED: the
    generated `publish.sh` and the README licence line still substitute naively; probed); F19 (Info,
    DEFERRED: `CHAIN_IDS[network]` without `Object.hasOwn`; probed); F20 (Info, ACCEPTED-RISK: the
    listing throws past 200 foreign coin packages).
  - **F11 contradiction found:** `SECURITY.md` ("What the policies mean") still describes the freeze
    design and a finalize retry that can mint twice, which the 0.0.9 code no longer does; the README says
    "the supply and metadata policies are not applied" until the finalize; `AGENTS.md` is at version
    `0.0.1`. Documentation only; fix is the next patch.
  - **Decisions recorded:** OQ1 (the UpgradeCap goes to the recipient, 0.0.6), OQ2 (policies applied in
    `init` by the template, 1.0.8 / 0.0.9), OQ3 (listing semantics, 0.0.7 / 0.0.10).
  - **Lens coverage:** the Template line moved to the registry's 2026-10-08 dates (base, SUI_CLIENT, TS,
    OPS). New lens items checked: TS-M9 (does not hold, F17), B.TS-1/2/3, the TS caller-keyed lookup row
    (F19), the SC client-side-publish row (holds), OPS-M1/M7/M8 for the e2e script (hold), base CI and
    release items (hold). No other lens is triggered.
  - **Sections:** A rows A2, A6, A7, A8, A10, A12 moved to HOLDS; A13-A34 added for the policy design and
    the TS and SC lens categories (GAP rows: A22 F19, A23 F11). Section D ticked with evidence; the
    unticked items are F17 and F11 (next patch) and the external review (maintainer-only,
    `OPERATOR_TASKS.md`).
  - **Not verified:** the second-finalize rejection against a real chain (S5); how token-deployer-ui
    shows the `listMyTokens` limit error (F20; its own audit).
  - Pre-save consistency checklist re-run (below).

- 2026-10-10 — Fix wave for 0.0.11 (local commit `994b951`; not released) against template 1.0.9.
  - **Done:** re-pinned `@meddleware/sui-token-template` to 1.0.9 and regenerated `src/template` (`check:template`
    passes; hashes unchanged, `files.ts` now also carries `Move.lock` and the new `publish.sh`); **F21 found and
    RESOLVED** (generated packages now carry `Move.lock` with the root pin renamed: the client half of template
    audit F7); **F11, F17, F18, F19 RESOLVED**; S5 and S6 implemented; F20 re-evaluated, stays ACCEPTED-RISK
    (OQ4); S7 left open (OQ5); F9 left as is (the localnet e2e is a manual pre-release run).
  - **Measured:** vitest 148/148 (11 files; 19 of the new tests fail against the 0.0.10 source); tsc, eslint,
    `npm audit --audit-level=high` (0), `npm ls --all`, `check:template` (1.0.9) and `npm run build` clean; pack
    30 files, 45.7 kB; `npm run e2e:localnet` PASS against a local `sui start --with-faucet --force-regenesis`
    (sui 1.81.0), including the new refused-second-finalize step and the generated-`Move.lock` check. Coverage
    97.92 / 90.97 / 100 / 99.17 (plugin installed `--no-save`, then removed).
  - **Lookups checked (F19):** every record or object indexed by a caller or node value in `src`
    (`CHAIN_IDS`, the patcher's `rename`, `toSuiTxResult`'s `types`); the rest use fixed internal keys.
  - **Next:** release 0.0.11 (tag after the orchestrator's review), then token-deployer-ui `^0.0.11`. Template
    audit F7 can move to RESOLVED citing 0.0.11 (`tests/package.test.ts` "Move.lock carries the template
    framework pin", `scripts/e2e-localnet.mjs`, F21 here).
  - Pre-save consistency checklist re-run (below).

## Pre-save consistency checklist (2026-10-10 re-verification)

- [x] Section A ↔ findings — no GAP rows remain; A2, A6-A8, A10, A13, A22 and A23 are HOLDS beside RESOLVED findings.
- [x] Finding header ↔ body — each RESOLVED finding's evidence describes what was done; baseline text and
  recommendations are kept under separate labels.
- [x] Template line: base + SUI_CLIENT + TS + OPS (scoped) with the registry's 2026-10-08 dates; untriggered
  lenses named.
- [x] Closing four-part structure in order.
- [x] Open questions stay listed; decisions are recorded as `(Decided …)` notes and in the log.
- [x] Section D ↔ dispositions — the only unticked item is the maintainer-only external review.
- [x] Executive summary matches the dispositions and the ceiling (Info; F20 the one open finding).
- [x] Counts and versions re-measured 2026-10-10 (tests, coverage, pack, template); provenance as of 2026-10-09.
- [x] Re-verification log entry added.
