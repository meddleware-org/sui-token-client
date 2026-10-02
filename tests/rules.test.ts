import { describe, it, expect } from 'vitest'
import {
  assertTokenConfig,
  deriveStructName,
  hasAllowedIconScheme,
  isValidDecimals,
  MAX_U64,
  parseSupply,
  TOKEN_LIMITS,
  validateIdentifier,
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
