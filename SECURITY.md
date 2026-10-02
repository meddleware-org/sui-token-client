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
   shell script is refused.
2. **The shipped module is the template's.** The artefact is generated from the pinned template
   package and checked against its recorded hashes; CI fails on drift.
3. **Exact type matching.** Package ids, coin types and caps are read only from objects whose
   normalised types match exactly, and the coin must belong to the package just published.
4. **No silent truncation.** Token listing returns every page or throws.
5. **No keys or secrets.** Signing is delegated to the caller's executor; nothing is logged.


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
