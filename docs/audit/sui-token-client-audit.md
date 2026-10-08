# Security Audit — `sui-token-client`

**Classification:** Internal security review (initial audit — awaiting external review)
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

- AUDIT_TEMPLATE.md (2026-10-02)
- AUDIT_TEMPLATE_SUI_CLIENT.md (2026-09-30)
- AUDIT_TEMPLATE_TS.md (2026-10-03)
- AUDIT_TEMPLATE_OPS.md (2026-09-30) — scoped to `scripts/e2e-localnet.mjs`, which signs on a local
  network only

Not triggered: SUI (no Move here — the template is `sui-token-template`'s audit), SEAL, WALRUS (icon
uploads live in token-deployer-ui), VUE, AUTH, IMG.

**Deployment status:**

- npm `@meddleware/sui-token-client` **0.0.5**, published from tag `v0.0.5` = `6f09bb2` (HEAD of
  `main`), with an SLSA v1 provenance attestation.
- Consumed by token-deployer-ui (`deployToken`, `finalizeToken`, `toSuiTxResult`, `listMyTokens`,
  `generatePackageZip`, `configureTemplateWasm`).
- The live path is the token deployer on testnet and mainnet: user wallets publish coins, and a fee
  goes to the operator treasury.

**Review date:** 2026-10-03
**Reviewer:** Internal review
**Severity ceiling:** High.

- The package builds transactions that publish user packages and move SUI (the fee).
- It produces **permanent** on-chain coin metadata (symbol, name, decimals) and policies (supply,
  metadata, upgradeability).
- A defect can mint wrongly, leave a coin with the wrong permanent identity, or misreport who holds
  authority.
- Realised ceiling at this pass: **Low**. The top defect (F1) is permanent but needs an unusual input.

**Status:** first-pass baseline.

- The predecessor in-app code was reviewed in `token-deployer/docs/audits/token-deployer-sui-audit.md`
  (2026-07-30).
- Its findings 4 (icon URL scheme) and 5 (silent degradation of `extractPublishResult`) apply to code
  that now lives here. Both are resolved, as re-verified in F14.

**Package manager / lockfile:** npm; `package-lock.json` committed.
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
**Peer dependencies:** none.

**Dependencies:**

| Package | Range | Installed |
| --- | --- | --- |
| `@mysten/sui` | `^2.33.1` | 2.33.2 |
| `@mysten/move-bytecode-template` | `~0.4.1` | 0.4.1 (latest) |
| `fflate` | `^0.8.3` | 0.8.3 |

**Template pin:** devDependency `@meddleware/sui-token-template` **1.0.6**, exact, with provenance
attested. The generated artefact records:

| Field | Value |
| --- | --- |
| `moduleSha256` | `41511ed4…e9b7` |
| `sourceSha256` | `58457c5b…727b` |
| Toolchain | 1.81.0 |
| Framework revision | `83f11dc8…b059` |
| Build environment | testnet |

**Sui SDK / transport:** gRPC core API through structural types (`toSuiTxResult` consumes a core
`TransactionResult` with effects and object types). No JSON-RPC.

**Framework targets:** `0x1` (stdlib dependency), `0x2::package::make_immutable`,
`0x2::coin::mint`, `0x2::coin_registry::finalize_registration`,
`0x2::transfer::public_freeze_object`, registry `0xc`. No first-party package IDs.

**OPS front matter (scoped):** `npm run e2e:localnet`. It uses a localnet faucet and an ephemeral
in-process `Ed25519Keypair`, never a stored key. It is not run in CI.

**Location:** `sui-token-client/docs/audit/sui-token-client-audit.md`. This is a new directory in the
repo.

> **Access note:** `meddleware-org/sui-token-client` is not in this session's attached repository
> list. It is public, so it was cloned read-only. Nothing was pushed.

---

## Executive summary

`@meddleware/sui-token-client` is 1,363 lines across 12 modules. The generated artefact and template
files are on top of that.

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

**Measured:**

- 87/87 unit tests; coverage 98.24% statements, 89.21% branches, 99.42% lines;
- tsc, eslint, `npm audit` (0) and `check:template` clean;
- the build emits declarations; pack is 30 files.

**Open findings (all Low or Info):**

1. **F1 — the patcher can produce permanent metadata different from the input.**
   - It locates each constant by its *current* bytes, one field at a time. If the user enters a value
     equal to a later field's template placeholder, the later lookup hits the already patched entry.
   - Probe: `symbol: 'TEMPLATE_NAME', name: 'My Coin'` produced a module whose symbol constant is
     `My Coin` and whose name constant is `TEMPLATE_NAME`.
   - The source renderer has the same order-dependent replace. The downloaded source and the README
     then show a second and a third variant, so bytecode ↔ source parity breaks.
   - Symbol, name and decimals are permanent on-chain, and nothing re-decodes the patched module to
     confirm it matches the config.
2. **F2 — the UpgradeCap is not routed to the recipient.** An `upgradeable` package's UpgradeCap
   always goes to the **sender**, even when a `recipient` is set to receive "the caps". The deployer
   silently keeps upgrade authority over a coin whose other caps were handed to, say, a DAO.
3. **F3 — finalize retries are not idempotent.** After a finalize that executed but whose executor
   threw, a retry can mint the initial supply a second time. This happens when the publish effects
   lacked the Currency reference, the supply is `mintable`, and the recipient is the sender.
4. **F4 — the coin registry never learns the policies.** "Fixed supply" and "frozen metadata" are
   implemented by freezing the caps (`public_freeze_object`). The pinned framework records these in
   the shared `Currency<T>` (`make_supply_fixed`, `delete_metadata_cap`), but freezing leaves the
   registry reporting supply `Unknown` and the metadata cap `Claimed`. Wallets and explorers that read
   the registry cannot show these trust signals.
5. **Info (F5–F12):**
   - `listMyTokens` cannot see fixed-supply or recipient-routed coins;
   - `licenseName` is unvalidated (generated README only);
   - the library accepts a zero-address or unvalidated fee recipient;
   - CI details: `--if-present`; the live tests and localnet e2e are not in CI;
   - template-placeholder values are accepted in other fields too;
   - docs drift.

**Posture:**

- The money and identity paths are carefully engineered, and the extraction from the app tightened
  them.
- The open items are about policy fidelity (F2, F4), idempotent recovery (F3) and a patcher
  post-condition (F1).
- By maintainer instruction this pass records findings only. The base template's resolve-inline rule
  was deliberately not exercised (see the re-verification log).

---

## Threat model / trust boundaries

| Actor / source | Controls | Can do | Bounded by |
| --- | --- | --- | --- |
| Deployer (end user) | the `TokenConfig` (names, text, decimals, supply, policies, recipient, licence) | Choose any token; sign two transactions | `assertTokenConfig`; the patcher's checks; exact-split fee; a preview in the app. **Placeholder collision (F1)** |
| Consuming app (token-deployer-ui) | fee amount, fee recipient (treasury), gas budget, network, executor, wasm source | Route the fee; sign through the wallet | App's build-time zero-treasury guard (token-deployer-ui `vite.config.ts`). The library itself accepts any recipient (F7). |
| Wallet / executor | signs and executes; reports effects | Misreport effects; throw after submission | `assertSuccess` (explicit success only); exact-type parsing; typed post-publish errors; **retry idempotency (F3)** |
| Full node (behind the executor) | effects, object types, owned objects | Lie about effects or listings | Exact struct-tag matching; the coin must belong to the published package; bounded paging |
| `@meddleware/sui-token-template` npm package | the bytecode and source the client ships | Change what every deploy publishes | Exact pin with provenance; hashes vs `build-info.json`; round trip; identifier and default checks; `check:template` in CI |
| `@mysten/move-bytecode-template` (wasm) | module (de)serialisation | Mis-encode the module | Byte-exact round trip checked at generation; the module is verified on-chain at publish; no post-patch check (F1) |
| Recipient (e.g. a DAO or multisig) | receives the supply and the Treasury/Metadata caps | Expects full control | **The UpgradeCap stays with the sender (F2)** |
| Token holders / market | read the coin's on-chain state | Judge supply and metadata mutability | Freezing is effective but not recorded in the registry (F4) |

### On-chain dependency matrix (SUI_CLIENT lens)

| Object / package | ID | Sourced from | Used as | If stale / wrong | Fails |
| --- | --- | --- | --- | --- | --- |
| Move stdlib / Sui framework | `0x1` / `0x2` | constants (`transactions.ts:16-17`) | publish dependencies; call targets | system packages; framework upgrades keep the addresses | n/a — drift test checks signatures live |
| Coin registry | `0xc` | literal | `finalize_registration` argument | system object | n/a |
| Pending `Currency<T>` | from publish effects (id, version, digest) | `extractPublishResult` | a `Receiving` reference in finalize | stale version ⇒ the finalize aborts atomically (retries need a fresh read — F3) | closed |
| `TreasuryCap<T>` / `MetadataCap<T>` / `UpgradeCap` | from effects, exact types | `extractPublishResult` | mint, freeze, transfer | — | closed (exact type; coin from the published package) |
| Fee recipient | caller | app config | `transferObjects(fee)` | wrong address ⇒ fee lost (F7) | open (caller's responsibility) |

### Supply chain & input matrix (TS lens)

| Actor / source | Controls | Bounded by |
| --- | --- | --- |
| Dependency authors | `@mysten/sui`, `@mysten/move-bytecode-template` (wasm), `fflate` | lockfile; `npm audit` in CI and publish |
| Template package | the module and template text files | F14 / `check:template` |
| Untrusted inputs | user config; executor results | `assertTokenConfig`; strict result parsing |
| Embedding host | wasm source URL | `configureTemplateWasm`; a failed init is rethrown and retried |

### Operations (OPS lens, scoped)

| Script | Signs? | Network guard | Irreversible? | Key | Writes IDs |
| --- | --- | --- | --- | --- | --- |
| `scripts/e2e-localnet.mjs` | yes (publish, finalize, a refused-finalize recovery) | defaults to `http://127.0.0.1:9000` / `:9123`. **No guard against `RPC_URL` pointing elsewhere** (F10). | localnet-ephemeral | ephemeral `Ed25519Keypair`, faucet-funded | none |

---

## Severity scale

Critical / High / Medium / Low / Info / Positive.

## Scope

**In scope (HEAD `6f09bb2` = tag `v0.0.5`, 2026-10-02):**

- `src/{index,types,rules,typeNames,transactions,results,deploy,tokens,package}.ts`
- `src/template/{index,patch,artifact,files}.ts`
- `scripts/{gen-template,e2e-localnet,ts-resolve}.mjs`
- `tests/**` (10 unit files, ABI table, integration drift test)
- `package.json`, the lockfile, `tsconfig*.json`, the vitest and eslint configs
- `README.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`
- `.github/workflows/{node-ci,npm-publish}.yml`

**Cross-repo evidence (read-only):**

- the pinned Sui framework source at `83f11dc8…` (`coin_registry.move`: `make_supply_fixed`,
  `delete_metadata_cap`, `SupplyState`, `MetadataCapState`), from the local Move git cache;
- `token-deployer/docs/audits/token-deployer-sui-audit.md` (the predecessor);
- token-deployer-ui CLAUDE.md (the consumer's wiring, its zero-treasury guard, the post-publish error
  routing).

**Out of scope:** the Move template (its own audit); token-deployer-ui (its own audit); the
`@mysten/*` internals.

**Environment / commands (2026-10-03, Node 22.22.2):**

| Command | Result |
| --- | --- |
| `npm ci` | clean |
| `npx vitest run` | **87 passed** (10 files) |
| `npx vitest run --coverage` (coverage plugin installed `--no-save`) | 98.24% statements / 89.21% branches / 100% functions / 99.42% lines. Branch gaps: `deploy.ts` (69.56%), `results.ts` (79.54%) |
| `npx tsc --noEmit` / `npx eslint .` | clean / clean |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm run check:template` | `src/template matches @meddleware/sui-token-template@1.0.6` |
| `npm run build` | `dist/*.d.ts` emitted (removed afterwards) |
| `npm pack --dry-run` | 30 files, 32.4 kB (`src`, `dist`, `CHANGELOG.md`, `README.md`, `LICENSE`, `package.json`) |
| `npm ls` | one `@mysten/sui` (2.33.2) |
| `npm view … dist.attestations` | provenance for `sui-token-client@0.0.5` and `sui-token-template@1.0.6` |
| Scratch probes (deleted afterwards) | `patchTemplateModule` with a placeholder-valued field **swaps constants** (F1; three cases). `buildPackageFiles` with the same input renders a **third** variant in source and README (F1), and doc placeholders in user text are re-substituted (F8) |
| `npm run test:integration` / `npm run e2e:localnet` | **not run**: the sandbox's egress policy blocks the Sui full nodes, and there is no local network |

The clone was left clean (`dist/` and `coverage/` removed).

---

## Findings

### F1 — Placeholder-valued inputs make the patcher, and the source renderer, write values into the wrong slots; there is no post-patch check

**Severity:** Low (likelihood-weighted; the impact is permanent)   **Disposition:** DEFERRED
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

**Remediation / evidence:**

1. Resolve all target indices from the pristine pool **before** writing any field. The generator
   already guarantees each default is unique.
2. Render the source in one pass: one regex alternation, or replace by line or constant name, not
   sequentially.
3. And/or reject any value equal to a template default or identifier.
4. Add a post-condition: decode the output and assert each constant equals the config value, and the
   module and struct identifiers equal the config.
5. Add tests for the three probe cases, covering both the module and the rendered source.

### F2 — An upgradeable package's UpgradeCap goes to the sender, not the recipient

**Severity:** Low   **Disposition:** DEFERRED (pending OQ1)
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

**Remediation / evidence:**

- Transfer the UpgradeCap to `config.recipient || sender` in the publish PTB.
- Or document that upgrade authority always stays with the deployer, and surface it in the result and
  the generated docs.
- Add a test.

### F3 — `finalizeToken` retry is not idempotent

**Severity:** Low   **Disposition:** DEFERRED
**Where:**

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

**Remediation / evidence:**

- Before retrying, check on-chain whether finalize already ran. For example:
  - the Currency's owner or state (shared and registered), or
  - the TreasuryCap's total supply versus the expected initial supply.
- Make `PendingFinalize` carry the expected post-state.
- Classify executor errors after submission as "unknown" rather than "incomplete".
- Add a test where the executor throws after success.

### F4 — Supply and metadata policies freeze the caps instead of recording them in the coin registry

**Severity:** Low   **Disposition:** DEFERRED (pending OQ2)
**Where:** `src/transactions.ts:101-121` (`public_freeze_object` on the TreasuryCap / MetadataCap);
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

**Remediation / evidence:**

- Decide between a third, optional "record policies" transaction and a template-level change (OQ2).
- Until then, document the semantics in the generated README and `deployments.md`, and in the
  deployer UI.

### F5 — `listMyTokens` misses fixed-supply and recipient-routed coins

**Severity:** Info   **Disposition:** DEFERRED
**Where:** `src/tokens.ts:13-45` (discovery by owned `TreasuryCap<T>`).

**Issue / Impact:**

- A fixed-supply coin's TreasuryCap is frozen, so no one owns it. A coin whose caps went to a
  recipient lists under the recipient.
- Either way, the deployer's "my tokens" view omits those coins, which for the deployer UI is most
  fixed-supply launches.
- Conversely, anyone can send a TreasuryCap (it has `store`) to an address, and it will list. That is
  real control, so it is correct, but it is not "deployed by me".

**Remediation / evidence:** add discovery by the publishes the address signed: owned `UpgradeCap`s,
or a lookup of transactions by sender with the template's module shape. Alternatively, document the
current semantics ("coins you can mint").

### F6 — `licenseName` and `licenseText` are not validated

**Severity:** Info   **Disposition:** DEFERRED
**Where:** `src/package.ts:101-113, 241-243`; `src/rules.ts:157` (only the SPDX `license` id is
checked).

**Issue / Impact:**

- `licenseName` is written into the generated README, and `licenseText` into `LICENSE`, unvalidated.
- Both affect only the user's own downloaded package (markdown, not executed), so there is no security
  impact.
- It is inconsistent with the "no unvalidated value reaches generated files" posture.

**Remediation / evidence:** bound and `SAFE_TEXT`-check `licenseName`; bound `licenseText`.

### F7 — The fee recipient and fee amount are trusted from the caller

**Severity:** Info   **Disposition:** ADJUDICATED (the app owns the fee configuration) — with a
suggestion
**Where:** `src/transactions.ts:45-49`; `src/deploy.ts:138-147`.

**Issue:**

- The library splits `feeMist` to `feeRecipient` with no validation: no zero-address check and no
  format check before building. The app's production build refuses a zero treasury
  (`assertTreasuryConfigured`).
- `PublishResult.feeRecipient` and `feeMist` echo the inputs rather than being read from the effects
  or balance changes.

**Impact:** a misconfigured consumer could burn fees to `0x0`, or report a fee that differs from what
executed. That would need a broken app.

**Remediation / evidence:**

- Validate `feeRecipient` as a full address and not `0x0`, as access-gate-client's `toAddress` does.
- Optionally confirm the fee from `balanceChanges` in the result.

### F8 — Placeholder and identifier collisions beyond F1

**Severity:** Info   **Disposition:** DEFERRED (folds into F1's fix)

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

**Remediation / evidence:** substitute in one pass, with a single regex alternation over the
template so inserted text is never rescanned. Alternatively, reject `X[A-Z]+X` and template defaults
in every text field.

### F9 — CI: live tests and e2e never run; `--if-present`

**Severity:** Info   **Disposition:** DEFERRED
**Where:** `.github/workflows/node-ci.yml`, `npm-publish.yml`.

**Positives first:**

- actionlint (digest-pinned), `npm audit` and `check:template` run in Node CI and in the publish
  verification;
- the `.d.ts` build runs in publish.

**Gaps:**

- **Live checks never run.** The ABI-drift and chain-id integration test, and the localnet e2e (the
  only proof that a patched module verifies on-chain and that finalize works), are not run in CI.
- **No build in Node CI.** The declaration build runs only on publish.
- **`--if-present`.** The publish verification uses it, and runs no lint.

**Remediation / evidence:**

- Add a scheduled read-only job for `test:integration`, and a localnet job (`sui start` in CI) for
  `e2e:localnet`.
- Add `npm run build` and `npm pack --dry-run` to Node CI.
- Drop `--if-present`.

### F10 — `e2e-localnet.mjs` has no network guard

**Severity:** Info   **Disposition:** DEFERRED
**Where:** `scripts/e2e-localnet.mjs:15-17`.

**Issue / Impact:**

- `RPC_URL` and `FAUCET_URL` can point anywhere.
- The keypair is ephemeral and funded only by the faucet, so a misdirected run against testnet would
  publish a test coin (no real funds lost), and mainnet has no faucet.
- Still, the OPS lens asks for a chain-identifier guard.

**Remediation / evidence:** assert that the chain identifier is not testnet's (`4c78adac`) or
mainnet's (`35834a8a`) before signing, unless `E2E_ALLOW_PUBLIC=1` is set.

### F11 — Documentation drift

**Severity:** Info   **Disposition:** DEFERRED

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

**Remediation / evidence:** correct each.

### F12 — Coverage branch gaps on the recovery paths

**Severity:** Info   **Disposition:** DEFERRED
**Where:** coverage: `deploy.ts` branches 69.56% (`:126`, `:206`); `results.ts` branches 79.54%.

**Issue / Impact:** untested branches include:

- `toSuiTxResult` for a `FailedTransaction` and mutated objects;
- a publish with a missing MetadataCap;
- finalize with `currencyRef` absent (F3).

These are the post-publish recovery paths users depend on.

**Remediation / evidence:** add tests, including F3's "executor throws after success".

### F13 — Positive: one rule set before every sink, and a verified template artefact

**Severity:** Positive

- **`assertTokenConfig`** (`rules.ts:124-158`) runs in `patchTokenModule`, `deployToken` (through the
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
  - SPDX characters.
- **Defence in depth in the patcher:** it rechecks decimals, `SAFE_TEXT` and the bounds, and refuses a
  duplicate identifier before publishing (which would otherwise fail verification after gas is spent).
- **`gen-template.mjs` checks:**
  - module and source SHA-256 against `build-info.json`;
  - the `a11ceb0b` magic;
  - the source contains every placeholder;
  - a byte-exact decode/encode round trip;
  - each default occurs exactly once in the pool;
  - `TEMPLATE_IMPORTED_IDENTIFIERS` equals the module's actual identifiers;
  - `--check` in CI.
- The template devDependency is pinned exactly and carries provenance.

### F14 — Positive: exact-type result parsing and post-publish error typing (predecessor findings resolved)

**Severity:** Positive. Predecessor `token-deployer-sui-audit.md` findings 4 and 5 are RESOLVED here.

- **Exact-type parsing** (`results.ts:70-117`):
  - exactly one published package;
  - exactly one `0x2::coin::TreasuryCap<T>` with `T` in that package (look-alike framework addresses
    and other coins rejected);
  - Currency and MetadataCap matched by coin type;
  - throws instead of degrading. This resolves predecessor F5.
- **Icon schemes** are allowlisted (`https://`, `ipfs://`). This resolves predecessor F4.
- **Fail-closed status:** only an explicit `success` status counts (`assertSuccess`).
- **Typed post-publish errors:**
  - every failure after the publish executed is a `PublishedError`;
  - `DeployIncompleteError` carries `pending` for `finalizeToken`;
  - `DeployUnconfirmedError` says "do not retry";
  - token-deployer-ui routes them away from the review step.
- **Bounded listing:** `listMyTokens` dedupes by coin type and throws past `maxPages`.

### F15 — Positive: transactions and release chain

**Severity:** Positive

- **Exact fee split.** The fee is split exactly from `tx.gas` inside the publish PTB (predecessor F9).
- **Policies in the signed transactions.** `make_immutable` runs in the same PTB as the publish for
  the immutable policy; finalize applies registration, mint, freezes and transfers atomically.
- **Amounts are `bigint`** (fee, gas, supply), and the mint amount goes through `tx.pure.u64`.
- **Entry-point isolation.** `.` carries no wasm, bytecode or fflate (CLAUDE.md invariant).
- **Wasm init.** It is retried after a failure and the failure is surfaced (`wasm-init.test.ts`).
- **Release chain:**
  - SHA-pinned actions; least privilege;
  - OIDC `--provenance` (0.0.5 verified);
  - `tag == version`; idempotent publish;
  - declarations built at publish.

---

## Section A — Invariant verification matrix

| # | Invariant | Enforced at | Proven by | Status |
| --- | --- | --- | --- | --- |
| A1 | No unvalidated value reaches Move source or bytecode | `assertTokenConfig`; patcher rechecks | `rules.test.ts`, `template.test.ts` | HOLDS |
| A2 | **The patched module and the rendered source encode exactly the config** | `patch.ts`, `package.ts` `renderSource` | template and package tests (normal values only) | **GAP** — F1 |
| A3 | The shipped module is the pinned template's | `gen-template.mjs` + `check:template` | CI | HOLDS |
| A4 | Exact type matching; the coin belongs to the published package | `typeNames.ts`, `results.ts` | look-alike, nested-generic, long-form tests | HOLDS |
| A5 | Only explicit success counts; post-publish failures are typed | `deploy.ts` | deploy tests | HOLDS |
| A6 | **Recovery never duplicates effects** | `finalizeToken` | — | **GAP** — F3 |
| A7 | **The recipient receives every authority** | `transactions.ts` | — | **GAP** — F2 |
| A8 | **Declared policies are discoverable on-chain** | — | — | **GAP** — F4 |
| A9 | Fee split exact, in the publish PTB | `buildPublishTransaction` | `transactions.test.ts` | HOLDS (recipient unvalidated — F7) |
| A10 | No silent truncation | `listMyTokens` | paging tests | HOLDS (coverage semantics — F5) |
| A11 | No environment reads or logging; caller supplies network, fee and executor | src | grep | HOLDS |
| A12 | ABI coupling has a drift test | `tests/abi-table.ts` + integration | completeness test; live (manual) | HOLDS (live not in CI — F9) |

---

## Section B — Supply-chain, publish-authority & capability matrix

### B.1 Dependency & CVE risk

`npm audit --audit-level=high`: 0 (2026-10-03).

| Dependency | Range (installed) | Liveness dependency? | Status | Notes |
| --- | --- | --- | --- | --- |
| `@mysten/sui` | `^2.33.1` (2.33.2) | PTBs, types, BCS | clean | dependency, not peer (same note as access-gate-client F9) |
| `@mysten/move-bytecode-template` | `~0.4.1` (0.4.1) | patching (wasm) | clean | round trip verified at generation; no post-patch check (F1) |
| `fflate` | `^0.8.3` (0.8.3) | zip | clean | |
| `@meddleware/sui-token-template` (dev) | `1.0.6` exact | artefact generation | provenance | hashes checked |

**TS lens shared-dependency matrix row:**

| Package | dependency | devDependency | peer |
| --- | --- | --- | --- |
| `@mysten/sui` | `^2.33.1` | — | — |
| `@mysten/move-bytecode-template` | `~0.4.1` | — | — |
| `typescript` / `vitest` | — | `~6.0.3` / `~5.0.2` | — |

### B.2 Publish authority & CI

| Authority | Where | Custody | Gates |
| --- | --- | --- | --- |
| npm publish `@meddleware/sui-token-client` | `npm-publish.yml` (tag `v*`) | OIDC; `--provenance` | releases |
| Fee treasury | consumer configuration | app (build-time guard) | per-deploy fee |

#### CI & release integrity

| Item | Holds? | Evidence |
| --- | --- | --- |
| Actions pinned | Yes | SHA pins; actionlint by digest |
| Least privilege | Yes | `id-token: write` only on publish |
| OIDC trusted publishing | Yes | 0.0.5 attestation |
| Generated-artefact drift check | Yes | `check:template` in CI and publish |
| Live drift and e2e | No | F9 |

### B.SC-1 ID-constant trace

| Location | Value | Kind | Source of truth |
| --- | --- | --- | --- |
| `transactions.ts:16-17` | `0x1`, `0x2` | system packages | protocol |
| `transactions.ts:87` | `0xc` | coin registry | protocol |
| `package.ts:43-46` | testnet `4c78adac`, mainnet `35834a8a` | chain ids in `Published.toml` | live integration test (manual) |
| `artifact.ts` | template module and hashes | bytecode | `sui-token-template@1.0.6` |

### B.SC-2 Coupling table

| Framework call | Builder | Test |
| --- | --- | --- |
| `publish(modules, [0x1, 0x2])` + `0x2::package::make_immutable` / transfer | `buildPublishTransaction` | exact-command tests |
| `0x2::coin_registry::finalize_registration<T>(0xc, Receiving<Currency<T>>)` | `buildFinalizeTransaction` | exact-command tests; live drift |
| `0x2::coin::mint<T>(&mut TreasuryCap<T>, u64)` | `buildFinalizeTransaction` | same |
| `0x2::transfer::public_freeze_object<TreasuryCap<T> \| MetadataCap<T>>` | `buildFinalizeTransaction` | same; semantics F4 |

### B.SC-3 Parity

The source package is rendered from the same template text, with the same values as the patched
bytecode (`package.ts`). Parity holds for valid inputs. It breaks under F1, where the module, the source and the README each
differ.

---

## Section C — Test-coverage & hermetic/live split

### C.1 Coverage grade — A− (87/87; 98.24% statements, 89.21% branches)

| Dimension | Assessment |
| --- | --- |
| Happy path | Rules, patching, builders (exact commands), parsing, deploy, finalize recovery, listing, package generation, Walrus-URL icons, wasm init |
| Error path | Every rule; look-alike types; missing caps; failed publish and finalize; confirmation failures (typed); listing overflow. **Missing:** executor throws after success (F3); `FailedTransaction` mapping |
| Boundary | Limits per field; decimals 0 and 18; u64 supply edge. **Missing:** placeholder-equal values (F1) |
| Security-relevant | Strong on injection and type matching. Recipient authority (F2) and policy discoverability (F4) are not covered |

**Test layers:**

| Layer | Files | In CI? |
| --- | --- | --- |
| Unit | 10 files, 87 tests | yes |
| Live read (ABI drift + chain ids, testnet and mainnet) | `tests/integration/abi-drift.integration.test.ts` | **no** (F9) |
| Localnet e2e (deploy, refused-finalize recovery, listing, balance, package) | `scripts/e2e-localnet.mjs` | **no** (F9) |
| Real-chain deploy (testnet / mainnet) | token-deployer-ui `e2e:*` | manual, in the consumer |

### C.2 Hermetic vs. live paths

| Path | Hermetic? | Deferred to | Tracking |
| --- | --- | --- | --- |
| Patched module passes on-chain bytecode verification | no | localnet e2e (manual) | F9 |
| Finalize semantics (registration, mint, freeze) | builder shape only | localnet e2e | F3, F4 |
| Framework ABI | arity table | live drift (manual) | F9 |

---

## Section D — Deployment-readiness gates

### pre-localnet

- [x] rules enforced before every sink; artefact verified; strict TS; tests green — F13
- [ ] patcher post-condition and placeholder rejection — F1, F8

### pre-testnet *(the consumer is live on testnet; unmet items are retroactive)*

- [x] exact-type parsing; typed post-publish errors; exact-split fee — F14, F15
- [ ] finalize retry idempotent — F3
- [ ] localnet e2e and live drift in CI — F9

### pre-mainnet *(the consumer deploys on mainnet with a manual guard)*

- [ ] UpgradeCap routing decided and implemented or documented — F2
- [ ] policy discoverability through the coin registry decided — F4
- [ ] fee recipient validated in the library — F7
- [ ] external review

---

## Cross-project themes

- **Supply chain:** the strongest artefact pipeline among the SDKs. A pinned, provenance-attested
  template; hash-checked generation; a round-trip check; CI drift checks.
- **Wire-format coupling:** template bytecode ↔ generated source ↔ the patcher's constant map, kept in
  step by `gen-template.mjs` (broken only by F1). Framework calls are drift-tested live.
- **On-chain-truth boundary:** policies are applied in signed PTBs (good). Their visibility in the
  canonical registry is missing (F4).
- **Chain-access layering (ADR-0001):** this is the domain client for the token template. The
  consumer keeps only UI and wallet wiring; IDs are framework constants.
- **Pre-v0.2 policy:** F1, F2 and F3 may change exported behaviour without shims. The next release is
  0.0.6, with token-deployer-ui bumped in step.
- **Shared with sibling audits:**
  - access-gate-client F9 (`@mysten/sui` as a dependency);
  - walrus-client F7 (recovery that can double-charge or double-act → F3 here);
  - token-deployer-sui predecessor F4 and F5 (resolved — F14).

---

## Normative requirements (MUST / MUST NOT)

1. MUST publish a module whose constants and identifiers equal the validated config, verified after
   patching — **does not hold** (F1).
2. MUST route every authority object to the configured recipient, or disclose otherwise in the result
   and docs — **does not hold** (F2).
3. MUST NOT let a recovery retry repeat an already executed finalize — **does not hold** (F3).
4. MUST make declared supply and metadata policies verifiable through the coin registry, or document
   why not — **does not hold** (F4).
5. MUST validate the fee recipient as a full, non-zero address — **does not hold** in the library
   (F7).

**SUI_CLIENT lens baseline:**

| ID | Holds? | Evidence |
| --- | --- | --- |
| SC-M1 | N/A (framework IDs only) | — |
| SC-M2 | yes | A4 |
| SC-M3 | yes (explicit success; finality awaited before finalize and before reporting) | A5 |
| SC-M4 | yes (`bigint` amounts) | — |
| SC-M5 | caller-supplied network; chain ids drift-tested | — |
| SC-M6 / SC-M7 | N/A | — |
| SC-M8 | N/A | — |
| SC-M9 | yes (created objects by exact type) | F14 |
| SC-M10 | yes | — |

**TS lens baseline:**

| ID | Holds? | Evidence |
| --- | --- | --- |
| TS-M1 | yes (one justified `!` on a parsed type, `tokens.ts:38`) | — |
| TS-M2 | config validated; `licenseName` / `licenseText` not | F6 |
| TS-M3 | yes | — |
| TS-M4 | yes | — |
| TS-M5 | N/A (no fetch; RPC through the caller's client) | — |
| TS-M6 | yes | — |
| TS-M7 | yes | — |
| TS-M8 | yes | — |

**OPS lens (scoped):** ephemeral keys, faucet-only funding — holds. Chain guard — F10.

## Implementation suggestions (SHOULD / MAY)

- **S1** SHOULD add `verifyPatchedModule(bytes, config)` and call it in `patchTokenModule` (F1).
- **S2** SHOULD expose an optional `buildRecordPoliciesTransaction` (`make_supply_fixed`,
  `delete_metadata_cap`) for a third, post-registration step (F4).
- **S3** SHOULD include `upgradeCapOwner` in `PublishResult` and in the generated `deployments.md`
  (F2).
- **S4** MAY derive `feeMist` and `feeRecipient` in the result from the effects' balance changes (F7).

## Open questions (`OQ#`)

1. **OQ1** F2: should the UpgradeCap go to the recipient? Or should "upgradeable with a recipient"
   be refused, so that upgrade authority and coin control are never split silently?
2. **OQ2** F4: record policies through a third transaction (one more signature) or through a template
   change (`make_supply_fixed_init` in `init`)? The latter needs a new template release and
   regenerated bytecode.
3. **OQ3** F5: should "my tokens" mean "coins I can mint" (today) or "coins I deployed"?

## Risks

- **Permanent outcomes:** symbol, name, decimals and package identity cannot be fixed after publish.
  Patcher correctness (F1) and the app's preview are the only safeguards.
- **Wallet / executor behaviour:** recovery correctness depends on executors reporting post-submission
  errors distinguishably (F3).
- **Template coupling:** a template release changes every future coin. The pinned artefact and
  `check:template` bound this.
- **Registry adoption:** as wallets rely more on `coin_registry`, coins without recorded policies look
  riskier than they are (F4).

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

## Pre-save consistency checklist (this pass)

- [x] Section A ↔ findings: GAP rows A2 (F1), A6 (F3), A7 (F2) and A8 (F4).
- [x] Finding header ↔ body: consistent.
- [x] Template line: base + SUI_CLIENT + TS + OPS (scoped) with dates; untriggered lenses named.
- [x] Closing four-part structure present.
- [x] Section D ↔ dispositions.
- [x] Executive summary ↔ dispositions and ceiling (realised Low).
- [x] C.1 counts measured 2026-10-03.
- [x] Re-verification log entry added.
