# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
