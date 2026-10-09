// Move and metadata rules for a token. The form layer of an app shows these as messages; the
// generators and the patcher call `assertTokenConfig` so an unvalidated config can never produce
// malformed Move source or bytecode.

import type { TokenConfig } from './types.js'

/** Largest amount `coin::mint` accepts (u64). */
export const MAX_U64 = 18_446_744_073_709_551_615n

/** Bounds every app and generator applies (bytes = characters: the allowed text is ASCII). */
export const TOKEN_LIMITS = Object.freeze({
  identifier: 64,
  symbol: 32,
  name: 64,
  description: 256,
  iconUrl: 512,
  packageDescription: 256,
  projectName: 64,
  licenseName: 64,
  /** The full licence text written to LICENSE (the longest common licences are well under this). */
  licenseText: 100_000,
  decimals: Object.freeze({ min: 0, max: 18 }),
})

/** Sui OTW rule: the witness struct is the module name, uppercased. */
export function deriveStructName(moduleName: string): string {
  return moduleName.toUpperCase()
}

/** Move identifier shape: lowercase start, then lowercase/digits/underscores. */
export const MOVE_IDENT = /^[a-z][a-z0-9_]*$/

/**
 * Printable ASCII without the double quote and backslash, so values embed safely in a Move `b"..."`
 * literal of the generated source.
 */
export const SAFE_TEXT = /^[\x20-\x21\x23-\x5b\x5d-\x7e]*$/

const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/

/** SPDX-safe licence identifier characters. */
const LICENSE_ID = /^[A-Za-z0-9.\-+]*$/

/**
 * Schemes allowed for the on-chain `icon_url`. A content guard on top of wallets' own URL handling:
 * it keeps `javascript:`, `data:` and plain `http:` out of the coin metadata. '' (no icon) is allowed.
 */
export const ICON_URL_ALLOWED_SCHEMES = ['https://', 'ipfs://'] as const

/** True if `url` begins with an allowed icon scheme (case-insensitive). */
export function hasAllowedIconScheme(url: string): boolean {
  const u = url.trim().toLowerCase()
  return ICON_URL_ALLOWED_SCHEMES.some((s) => u.startsWith(s))
}

/** Move reserved words; lowercase-compared, which also covers the uppercased struct name. */
export const MOVE_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'abort', 'acquires', 'as', 'break', 'const', 'continue', 'copy', 'else', 'entry', 'enum', 'false',
  'for', 'friend', 'fun', 'has', 'if', 'in', 'invariant', 'let', 'loop', 'macro', 'match', 'module',
  'move', 'mut', 'native', 'package', 'phantom', 'public', 'return', 'script', 'spec', 'struct',
  'true', 'type', 'use', 'while', 'key', 'store', 'drop',
])

/** Validate one Move identifier; returns a message or null. */
export function validateIdentifier(value: string): string | null {
  if (!value) return 'Required'
  if (value.length > TOKEN_LIMITS.identifier) return `${TOKEN_LIMITS.identifier} characters maximum`
  if (!/^[a-z]/.test(value)) return 'Must start with a lowercase letter'
  if (!MOVE_IDENT.test(value)) return 'Lowercase letters, digits and underscores only'
  if (MOVE_RESERVED_WORDS.has(value)) return `"${value}" is a reserved keyword`
  return null
}

/**
 * Identifiers the compiled template module already uses besides its own module and struct names
 * (the framework modules, types and functions it imports). A module named like one of them would
 * duplicate an identifier, and the publish would fail bytecode verification on-chain after the user
 * paid gas. `scripts/gen-template.mjs` checks this list against the shipped module.
 */
export const TEMPLATE_IMPORTED_IDENTIFIERS: ReadonlySet<string> = new Set([
  'Coin', 'CurrencyInitializer', 'MetadataCap', 'String', 'TreasuryCap', 'TxContext', 'coin', 'coin_registry',
  'dummy_field', 'finalize', 'finalize_and_delete_metadata_cap', 'init', 'init_with', 'make_supply_fixed_init',
  'mint', 'new_currency_with_otw', 'public_transfer', 'sender', 'string', 'transfer', 'tx_context', 'utf8',
])

/**
 * Named addresses the generated package's framework dependencies already define; a package named
 * like one of them would not build from the downloadable source.
 */
export const FRAMEWORK_ADDRESS_NAMES: ReadonlySet<string> = new Set(['std', 'sui', 'sui_system', 'bridge', 'deepbook'])

/** Validate a module name: an identifier that the template module does not already use. */
export function validateModuleName(value: string): string | null {
  const err = validateIdentifier(value)
  if (err) return err
  if (TEMPLATE_IMPORTED_IDENTIFIERS.has(value)) return `"${value}" is already used by the coin module`
  return null
}

/** Validate a package name: an identifier that is not a framework address name. */
export function validatePackageName(value: string): string | null {
  const err = validateIdentifier(value)
  if (err) return err
  if (FRAMEWORK_ADDRESS_NAMES.has(value)) return `"${value}" is a Sui framework address name`
  return null
}

/** Parse a whole-token supply ('' = 0) into a non-negative bigint, or null if invalid. */
export function parseSupply(input: string): bigint | null {
  const s = input.trim()
  if (s === '') return 0n
  if (!/^\d+$/.test(s)) return null
  return BigInt(s)
}

/** True if `decimals` is an allowed precision. */
export function isValidDecimals(decimals: number): boolean {
  return Number.isInteger(decimals) && decimals >= TOKEN_LIMITS.decimals.min && decimals <= TOKEN_LIMITS.decimals.max
}

/**
 * Assert every rule a deployable `config` must meet. Called by the patcher, the publish flow and the
 * package generator before any value reaches Move source or bytecode.
 *
 * @throws {Error} naming the first invalid field.
 */
export function assertTokenConfig(config: TokenConfig): void {
  const packageErr = validatePackageName(config.packageName)
  if (packageErr) throw new Error(`Invalid package name: ${packageErr}`)
  const moduleErr = validateModuleName(config.moduleName)
  if (moduleErr) throw new Error(`Invalid module name: ${moduleErr}`)
  if (config.structName !== deriveStructName(config.moduleName)) {
    throw new Error('Invalid struct name: must be the module name uppercased.')
  }
  for (const [label, value, max, required] of [
    ['symbol', config.symbol, TOKEN_LIMITS.symbol, true],
    ['name', config.name, TOKEN_LIMITS.name, true],
    ['description', config.description, TOKEN_LIMITS.description, false],
    ['icon URL', config.iconUrl, TOKEN_LIMITS.iconUrl, false],
    // Written into the generated source (a `///` doc comment) and docs: one safe line each.
    ['package description', config.packageDescription, TOKEN_LIMITS.packageDescription, false],
    ['project name', config.projectName, TOKEN_LIMITS.projectName, false],
  ] as const) {
    if (required && !value.trim()) throw new Error(`Invalid ${label}: required.`)
    if (value.length > max) throw new Error(`Invalid ${label}: ${max} characters maximum.`)
    if (!SAFE_TEXT.test(value)) throw new Error(`Invalid ${label}: contains quotes, backslashes or control characters.`)
  }
  if (config.iconUrl && !hasAllowedIconScheme(config.iconUrl)) {
    throw new Error('Invalid icon URL: only https:// or ipfs:// URLs are allowed.')
  }
  if (!isValidDecimals(config.decimals)) {
    throw new Error(`Invalid decimals: expected a whole number between ${TOKEN_LIMITS.decimals.min} and ${TOKEN_LIMITS.decimals.max}.`)
  }
  if (config.initialSupply < 0n || config.initialSupply * 10n ** BigInt(config.decimals) > MAX_U64) {
    throw new Error('Invalid initial supply: exceeds the maximum for this decimal precision.')
  }
  // The framework refuses to fix an empty supply (it could never be minted), and `init` applies the
  // policy in the publish transaction, so the publish itself would abort after the user signed.
  if (config.supplyPolicy === 'fixed' && config.initialSupply === 0n) {
    throw new Error('Invalid supply policy: a fixed supply needs an initial supply above zero.')
  }
  if (config.recipient && !SUI_ADDRESS.test(config.recipient)) {
    throw new Error('Invalid recipient: expected 0x followed by 64 hex digits.')
  }
  if (!LICENSE_ID.test(config.license)) throw new Error('Invalid license identifier.')
  if (config.licenseName !== undefined) {
    if (config.licenseName.length > TOKEN_LIMITS.licenseName) {
      throw new Error(`Invalid license name: ${TOKEN_LIMITS.licenseName} characters maximum.`)
    }
    if (!SAFE_TEXT.test(config.licenseName)) throw new Error('Invalid license name: contains quotes, backslashes or control characters.')
  }
}

/**
 * Assert a licence text is fit to write to the generated `LICENSE` file: bounded, and free of NUL bytes.
 * (Newlines and the quotes a real licence contains are fine — it is a plain text file, not source.)
 *
 * @throws {Error} if the text is too long or contains a NUL.
 */
export function assertLicenseText(text: string): void {
  if (text.length > TOKEN_LIMITS.licenseText) throw new Error(`Invalid license text: ${TOKEN_LIMITS.licenseText} characters maximum.`)
  if (text.includes('\u0000')) throw new Error('Invalid license text: contains a NUL byte.')
}
