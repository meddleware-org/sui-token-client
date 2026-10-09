# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
