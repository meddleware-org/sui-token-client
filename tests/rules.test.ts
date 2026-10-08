import { describe, it, expect } from 'vitest'
import {
  assertLicenseText,
  assertTokenConfig,
  deriveStructName,
  hasAllowedIconScheme,
  isValidDecimals,
  MAX_U64,
  parseSupply,
  TOKEN_LIMITS,
  validateIdentifier,
  validateModuleName,
  validatePackageName,
} from '../src/rules.js'
import type { TokenConfig } from '../src/types.js'

const good: TokenConfig = {
  packageName: 'my_token',
  moduleName: 'mytoken',
  structName: 'MYTOKEN',
  symbol: 'MTK',
  name: 'My Token',
  description: 'A friendly token',
  iconUrl: 'https://example.com/i.png',
  decimals: 9,
  initialSupply: 1_000_000n,
  supplyPolicy: 'fixed',
  metadataPolicy: 'frozen',
  packagePolicy: 'immutable',
  recipient: '',
  license: '0BSD',
  packageDescription: 'd',
  projectName: 'p',
}
const bad = (over: Partial<TokenConfig>) => () => assertTokenConfig({ ...good, ...over })

describe('deriveStructName', () => {
  it('uppercases the module name (Sui OTW rule)', () => {
    expect(deriveStructName('mwsui')).toBe('MWSUI')
    expect(deriveStructName('sui_token_template')).toBe('SUI_TOKEN_TEMPLATE')
  })
})

describe('validateIdentifier', () => {
  it('accepts a valid identifier and rejects shape, keyword and length violations', () => {
    expect(validateIdentifier('my_token2')).toBeNull()
    expect(validateIdentifier('')).toBe('Required')
    expect(validateIdentifier('2abc')).toMatch(/lowercase letter/)
    expect(validateIdentifier('MyToken')).toMatch(/lowercase letter/)
    expect(validateIdentifier('my-token')).toMatch(/Lowercase letters/)
    expect(validateIdentifier('public')).toMatch(/reserved/)
    expect(validateIdentifier('a'.repeat(TOKEN_LIMITS.identifier + 1))).toMatch(/maximum/)
  })
})

describe('assertTokenConfig', () => {
  it('accepts a well-formed config', () => {
    expect(() => assertTokenConfig(good)).not.toThrow()
    expect(() => assertTokenConfig({ ...good, iconUrl: '', description: '' })).not.toThrow()
  })

  it('requires the struct name to be the uppercased module name', () => {
    expect(bad({ structName: 'OTHER' })).toThrow(/struct name/)
  })

  it('rejects invalid identifiers and reserved words', () => {
    expect(bad({ packageName: 'My-Token' })).toThrow(/package name/)
    expect(bad({ moduleName: 'module', structName: 'MODULE' })).toThrow(/module name/)
  })

  it('keeps the package description and project name to one safe line', () => {
    // The description lands in a `///` comment of the generated source; a newline would escape it.
    expect(bad({ packageDescription: 'ok\npublic fun steal() {}' })).toThrow(/package description/)
    expect(bad({ projectName: 'a"b' })).toThrow(/project name/)
    expect(bad({ packageDescription: 'x'.repeat(TOKEN_LIMITS.packageDescription + 1) })).toThrow(/package description/)
    expect(() => assertTokenConfig({ ...good, packageDescription: 'A fine token.', projectName: 'My Project' })).not.toThrow()
  })

  it('rejects module names the template module already uses, and framework package names', () => {
    // A duplicate identifier would fail bytecode verification on-chain, after gas is spent.
    for (const name of ['coin', 'transfer', 'string', 'init', 'coin_registry', 'tx_context']) {
      expect(bad({ moduleName: name, structName: deriveStructName(name) })).toThrow(/already used by the coin module/)
    }
    for (const name of ['sui', 'std', 'sui_system']) {
      expect(bad({ packageName: name })).toThrow(/framework address name/)
    }
  })

  it('requires symbol and name, and bounds every text field', () => {
    expect(bad({ symbol: '   ' })).toThrow(/symbol: required/)
    expect(bad({ name: '' })).toThrow(/name: required/)
    expect(bad({ symbol: 'S'.repeat(TOKEN_LIMITS.symbol + 1) })).toThrow(/symbol/)
    expect(bad({ name: 'N'.repeat(TOKEN_LIMITS.name + 1) })).toThrow(/name/)
    expect(bad({ description: 'd'.repeat(TOKEN_LIMITS.description + 1) })).toThrow(/description/)
    expect(bad({ iconUrl: 'https://' + 'i'.repeat(TOKEN_LIMITS.iconUrl) })).toThrow(/icon URL/)
  })

  it('rejects characters that would break a Move byte string', () => {
    for (const v of ['a"b', 'a\\b', 'a\nb', 'a\u0000b', 'é']) {
      expect(bad({ description: v })).toThrow(/quotes, backslashes or control/)
    }
  })

  it('allows only https:// and ipfs:// icons', () => {
    expect(bad({ iconUrl: 'javascript:alert(1)' })).toThrow(/icon URL/)
    expect(bad({ iconUrl: 'http://example.com/i.png' })).toThrow(/icon URL/)
    expect(bad({ iconUrl: 'data:image/png;base64,AA' })).toThrow(/icon URL/)
    expect(() => assertTokenConfig({ ...good, iconUrl: 'ipfs://cid' })).not.toThrow()
  })

  it('bounds decimals to 0..18 whole numbers', () => {
    expect(bad({ decimals: 19 })).toThrow(/decimals/)
    expect(bad({ decimals: -1 })).toThrow(/decimals/)
    expect(bad({ decimals: 1.5 })).toThrow(/decimals/)
    expect(() => assertTokenConfig({ ...good, decimals: 0, initialSupply: 0n })).not.toThrow()
  })

  it('rejects a supply that overflows u64 at the chosen precision', () => {
    expect(bad({ decimals: 18, initialSupply: MAX_U64 / 10n ** 18n + 1n })).toThrow(/initial supply/)
    expect(() => assertTokenConfig({ ...good, decimals: 0, initialSupply: MAX_U64 })).not.toThrow()
  })

  it('validates an optional recipient and the licence id', () => {
    expect(bad({ recipient: '0xabc' })).toThrow(/recipient/)
    expect(() => assertTokenConfig({ ...good, recipient: '0x' + 'f'.repeat(64) })).not.toThrow()
    expect(bad({ license: 'MIT; rm -rf' })).toThrow(/license/)
  })
})

describe('small helpers', () => {
  it('hasAllowedIconScheme is case-insensitive and trims', () => {
    expect(hasAllowedIconScheme('  HTTPS://x')).toBe(true)
    expect(hasAllowedIconScheme('ftp://x')).toBe(false)
  })

  it('isValidDecimals matches TOKEN_LIMITS', () => {
    expect(isValidDecimals(TOKEN_LIMITS.decimals.max)).toBe(true)
    expect(isValidDecimals(TOKEN_LIMITS.decimals.max + 1)).toBe(false)
  })

  it('parseSupply parses whole numbers and blank', () => {
    expect(parseSupply('')).toBe(0n)
    expect(parseSupply(' 42 ')).toBe(42n)
    expect(parseSupply('1.5')).toBeNull()
    expect(parseSupply('-1')).toBeNull()
  })
})

describe('validateModuleName / validatePackageName', () => {
  it('apply the identifier rules first, then the collision rules', () => {
    expect(validateModuleName('my_coin')).toBeNull()
    expect(validateModuleName('Coin')).toMatch(/lowercase/)
    expect(validateModuleName('coin')).toMatch(/already used/)
    expect(validatePackageName('my_token')).toBeNull()
    expect(validatePackageName('sui')).toMatch(/framework/)
    // A package may share a framework module's name; only addresses collide.
    expect(validatePackageName('coin')).toBeNull()
  })
})

describe('licence fields', () => {
  it('bounds and checks licenseName', () => {
    expect(() => assertTokenConfig({ ...good, licenseName: 'MIT License' })).not.toThrow()
    expect(() => assertTokenConfig({ ...good, licenseName: 'x'.repeat(TOKEN_LIMITS.licenseName + 1) })).toThrow(/license name/)
    expect(() => assertTokenConfig({ ...good, licenseName: 'a"b' })).toThrow(/license name/)
    expect(() => assertTokenConfig({ ...good, licenseName: 'a\nb' })).toThrow(/license name/)
  })

  it('accepts a real multi-line licence text and refuses an oversized or NUL-containing one', () => {
    expect(() => assertLicenseText('Permission is hereby granted, "free of charge"\nto any person…')).not.toThrow()
    expect(() => assertLicenseText('x'.repeat(TOKEN_LIMITS.licenseText + 1))).toThrow(/maximum/)
    expect(() => assertLicenseText('ok\u0000bad')).toThrow(/NUL/)
  })
})

