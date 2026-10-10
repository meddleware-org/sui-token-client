# Security Policy

## Scope

This policy covers the `@meddleware/sui-token-client` package source (`src/**`):

- the token rules and their enforcement;
- the template patcher and the generated template artefact;
- the publish and finalize transaction builders;
- publish-result parsing and owned-token discovery;
- the source-package generator.

It does not cover:

- the `sui-token-template` Move package (see that repo's `SECURITY.md`);
- the token deployer app, its fee configuration and wallet wiring;
- the `@mysten/sui` and `@mysten/move-bytecode-template` packages (report upstream to
  [Mysten Labs](https://github.com/MystenLabs));
- the caller-supplied wallet, signer and RPC endpoint.

## Security model (invariants)

A report showing any of these violated is in scope and treated as high severity.

1. **No unvalidated value reaches Move.** Every config passes `assertTokenConfig` before patching,
   publishing or generating source; a value that could break a Move `b"..."` literal or the generated
   shell script is refused. This covers Move source and bytecode, and the generated docs (licence name and
   text are bounded and checked too); the patcher re-decodes its output and refuses placeholder-valued
   inputs that would write into the wrong slot. Generated files are rendered in one literal pass (no `$`
   expansion, no re-scanning of a value for template keys).
2. **The shipped module is the template's.** The artefact is generated from the pinned template
   package and checked against its recorded hashes; CI fails on drift. A generated package's `Move.lock` is
   the template's own, with only the root package line renamed.
3. **Exact type matching.** Package ids, coin types and caps are read only from objects whose
   normalised types match exactly, and the coin must belong to the package just published.
4. **No silent truncation.** Token listing returns every page or throws.
5. **No keys or secrets.** Signing is delegated to the caller's executor; nothing is logged.
6. **A published coin is never stranded or duplicated.** Every failure after the publish executed is a
   typed `PublishedError`; the caller finishes with `finalizeToken(pending)` and never answers one with a
   fresh deploy.

### What the policies mean (and do not)

The coin's own `init` applies the supply and metadata policies in the publish transaction (since 0.0.9,
template 1.0.8). The finalize transaction only registers the currency and moves what exists.

- **Fixed supply**: `init` mints the whole supply and hands the `TreasuryCap` to the coin registry
  (`make_supply_fixed`), so no `TreasuryCap` exists and nobody can mint again. The shared `Currency<T>`
  records the supply as fixed, so registry-reading wallets and explorers can show it. A fixed supply needs an
  initial supply above zero.
- **Frozen metadata**: `init` deletes the `MetadataCap`, so the name, symbol, description and icon can never
  change, and the registry records the cap as deleted.
- **Mintable supply and updatable metadata**: the recipient receives the `TreasuryCap` and the `MetadataCap`;
  the registry records neither as fixed or deleted.
- **Upgrade authority** of an upgradeable package goes to the recipient (the sender when none is set); an
  `immutable` package burns it.
- **Retrying a finalize** is safe: it mints nothing, and a repeat of one that already ran is refused by the
  chain without effect (the receiving reference is stale and the sender no longer owns the objects). There is
  no `client` option on `finalizeToken`; the retry needs only the `pending` the error carries.


## Supported versions

Only the latest published npm version receives security fixes.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email **<security@meddleware.co.uk>** with:

- a description and its impact;
- steps to reproduce or a proof of concept;
- the package version or commit SHA.

You will receive an acknowledgement within **3 business days**. Confirmed issues get a resolution
plan within **14 days**. Critical issues (CVSS ≥ 9.0) are acknowledged the same day.

## Disclosure

Once a fix is released, a security advisory is published on the GitHub repository. Reporters are
credited unless they prefer to remain anonymous.
