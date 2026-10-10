# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.11] - 2026-10-10

### Added

- `buildPackageFiles` and `generatePackageZip` write `Move.lock`: the template's framework pin (template 1.0.9) with the root package line renamed, as `03_create_token.sh` does, so a generated package builds against the framework revision the template was tested with
- `e2e:localnet` shows that a second `finalizeToken` of an already finalized coin is refused by the chain without effect, and that the generated `Move.lock` pins the new package

### Changed

- **Breaking (pre-v0.2):** `@mysten/sui` (`^2.33.2`) is a peer dependency, no longer a dependency, so a host bundle holds one copy; it stays a devDependency for tests. CI runs `npm ls --all`
- Template regenerated from @meddleware/sui-token-template 1.0.9 (`Move.lock` shipped; `publish.sh` uses an `object_state` helper)
- Finalize compares the sender and the recipient with `normalizeSuiAddress` (case and zero padding), not `toLowerCase`

### Fixed

- The generated `scripts/publish.sh` is rendered in one pass: a module named like a template key (`xmodulenamex`) no longer breaks the coin-type suffix and variable names
- The README licence line is written literally: `$&`, `$'` and `` $` `` in the licence name are no longer expanded
- `Published.toml` chain ids, the patcher's identifier rename and the object-type lookup in `toSuiTxResult` use own keys only (`Object.hasOwn`): a network named `constructor` no longer writes a garbage chain id

### Security

- `SECURITY.md`, the README and `AGENTS.md` describe the policies as `init` applies them (the registry records a fixed supply and a deleted MetadataCap; finalize mints nothing and a repeat is refused)

## [0.0.10] - 2026-10-09

### Changed

- **Breaking (pre-v0.2):** `listMyTokens` also lists coins with no capability: a fixed supply with frozen metadata is found because the wallet holds it and published its package. `DeployedToken.treasuryCapId` is optional and `metadataCapId` added; the listing reads `MetadataCap`s, balances and the publishing transaction of each held package (new `maxHeldCoinTypes`, `OwnedObjectsClient` needs `listBalances`, `getObject`, `getTransaction`)

## [0.0.9] - 2026-10-09

### Changed

- **Breaking (pre-v0.2):** the supply and metadata policies are applied by the coin's own `init` in the publish transaction (template 1.0.8: `INITIAL_SUPPLY`, `FIXED_SUPPLY`, `FROZEN_METADATA`), so the coin registry records a fixed supply and a deleted MetadataCap. `buildFinalizeTransaction` only registers the currency and moves what exists (new `initialCoinId`; `treasuryCapId`/`metadataCapId` optional; no freezing or minting); `finalizeToken` loses its `client` option (a repeat is rejected without effect); `PublishResult.initialCoinId`, `finalizeHasWork`, `assertResultMatchesPolicy` added; a fixed supply needs an initial supply above zero. Fixed: the patcher now merges equal constant-pool entries (the verifier rejects duplicates: a symbol equal to the name, empty strings, both flags false)

## [0.0.8] - 2026-10-09

### Changed

- Template regenerated from @meddleware/sui-token-template 1.0.7 (generator validation and staging; no Move or bytecode change)

## [0.0.7] - 2026-10-08

### Fixed

- `licenseName` and `licenseText` are validated (bounded; the name also against the safe-text rule, the text
  against NUL bytes) before they reach the generated README and LICENSE.
- `buildPublishTransaction` refuses a fee recipient that is not a full, non-zero address when a fee is charged.
- `e2e-localnet.mjs` refuses to run against a public network (chain-identifier check) unless
  `E2E_ALLOW_PUBLIC=1`.

### Changed

- CI builds the declarations and checks the tarball, runs lint without `--if-present`, and the tag workflow
  runs the same workflow as CI. A weekly workflow runs the read-only testnet suite.
- Documentation: the UpgradeCap goes to the recipient; `listMyTokens` means "coins you can mint"; what the
  fixed-supply and frozen-metadata policies do and do not record in the coin registry; the finalize-retry rule.

## [0.0.6] - 2026-10-08

### Changed (breaking, pre-v0.2)

- **Placeholder-valued inputs can no longer land in the wrong slot.** The patcher resolves every
  constant from the pristine pool before writing any, refuses a symbol/name/description/icon that is a
  template placeholder, and decodes the patched module to confirm each constant, identifier and the
  decimals before returning it. The downloadable source and README are rendered in one pass, so a value
  containing another template key (say `XMODULENAMEX`) is no longer rewritten and the outputs agree
  with the bytecode.
- **The UpgradeCap of an `upgradeable` package goes to the recipient** (default the sender), so
  upgrade authority travels with the caps. `BuildPublishArgs` gains `recipient`.
- **`finalizeToken` can no longer mint the initial supply twice.** Pass `client`: it reads the
  TreasuryCap's supply and skips the retry if the mint already ran. A retry in the one unsafe shape (no
  Currency reference, mintable, recipient = sender) refuses to run without a client.
- The generated README states how the supply and metadata policies are enforced (frozen caps, not
  registry state), what the registry therefore does not show, and who holds the UpgradeCap.

## [0.0.5] - 2026-10-02

### Changed

- Every failure after the publish executed is a `PublishedError` (with `publishDigest`), so callers
  can tell "a coin exists — do not deploy again" from "nothing happened":
  - `DeployIncompleteError` (a `PublishedError`) now also covers a publish whose confirmation failed;
  - the new `DeployUnconfirmedError` (a `PublishedError`, with `result`) reports a finalize that
    executed but was not confirmed — the coin is set up, do not retry;
  - unreadable publish effects throw a plain `PublishedError` naming the transaction.

## [0.0.4] - 2026-10-02

### Added

- **Recovery between publish and finalize.** When the coin is published but the finalize step fails
  (the second signature is refused, or the transaction fails), `deployToken` throws
  `DeployIncompleteError` whose `pending` holds the config, the publish result and the currency
  reference; `finalizeToken({ pending, executor })` finishes the setup later (currency registration,
  initial supply, supply and metadata policies, cap routing). A finalize that executed but could not
  be confirmed is reported as such and never offered for retry. Proven on localnet
  (`e2e:localnet`: refuse once, finish, supply minted, fixed-supply cap frozen).

### Changed

- `"sideEffects": false`: no module has import-time effects.

## [0.0.3] - 2026-10-02

### Fixed

- `assertTokenConfig` checks `packageDescription` (≤ 256) and `projectName` (≤ 64) like the other
  text fields (printable ASCII without `"` or `\`). The description is written into a `///` comment
  of the generated source, where a newline could add code the published bytecode does not contain.

## [0.0.2] - 2026-10-02

### Fixed

- A module named like an identifier the template module already uses (`coin`, `transfer`,
  `string`, `init`, …) duplicated that identifier, so the publish failed bytecode verification
  on-chain after the user paid gas. `validateModuleName` and `assertTokenConfig` now refuse it, the
  patcher refuses any duplicate identifier, and `check:template` keeps the list
  (`TEMPLATE_IMPORTED_IDENTIFIERS`) equal to the shipped module's.
- A package named like a framework address (`sui`, `std`, `sui_system`, `bridge`, `deepbook`) is
  refused (`validatePackageName`): the downloadable source package would not build.

### Changed

- `noUncheckedIndexedAccess` is on.

## [0.0.1] - 2026-10-02

First release. The token logic moves here from `token-deployer-ui` (B7), which keeps its UI.

### Added

- **Rules.** `assertTokenConfig`, `TOKEN_LIMITS` (decimals 0–18 everywhere), identifier, supply and
  icon-scheme rules.
- **Exact type matching** (`typeNames`) — replaces substring checks and the unanchored
  `TreasuryCap<…>` regular expression. `extractPublishResult` accepts only a TreasuryCap of a coin
  defined in the package just published, returns the currency reference, and throws unless exactly one
  package and one such cap exist.
- **`./template`** — the generated module and build info from `@meddleware/sui-token-template` 1.0.6,
  `configureTemplateWasm` for any bundler, `initTemplateWasm` (once; rethrows failures).
- **`./deploy`** — `deployToken` without environment reads or transaction logging.
- **`./package`** — the source package; the toolchain comes from the template's build info, and a
  localnet result no longer gets a testnet `Published.toml`.
- **`listMyTokens(client, owner, { maxPages })`** — paged; throws past the limit.
- `scripts/gen-template.mjs` (`gen:template` / `check:template`) and `scripts/e2e-localnet.mjs`.
