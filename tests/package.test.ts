import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildPackageFiles, generatePackageZip } from '../src/package.js'
import { TEMPLATE_BUILD_INFO } from '../src/template/artifact.js'
import { TEMPLATE_FILES } from '../src/template/files.js'
import type { PublishResult, TokenConfig } from '../src/types.js'

const baseConfig: TokenConfig = {
  packageName: 'my_token',
  moduleName: 'mytoken',
  structName: 'MYTOKEN',
  symbol: 'MTK',
  name: 'My Token',
  description: 'A friendly token',
  iconUrl: 'https://example.com/icon.png',
  decimals: 8,
  initialSupply: 0n,
  supplyPolicy: 'mintable',
  metadataPolicy: 'updatable',
  packagePolicy: 'immutable',
  recipient: '0x' + 'ab'.repeat(32),
  license: 'MIT',
  licenseName: 'MIT License',
  packageDescription: 'Official MYTOKEN token.',
  projectName: 'My Project',
}

const REQUIRED = [
  'Move.toml',
  'Move.lock',
  'sources/mytoken.move',
  'scripts/publish.sh',
  '.gitignore',
  'README.md',
  'deployments.md',
  'CLAUDE.md',
  'AGENTS.md',
]

describe('rendered source and docs are one-pass (F1)', () => {
  it('a value containing another template key is not rewritten', () => {
    const cfg = { ...baseConfig, packageDescription: 'About XMODULENAMEX and SUI_TOKEN_TEMPLATE', description: 'see XSYMBOLX' }
    const f = buildPackageFiles({ config: cfg })
    const src = f['sources/mytoken.move'] as string
    expect(src).toContain('About XMODULENAMEX and SUI_TOKEN_TEMPLATE')
    expect(src).toContain('b"see XSYMBOLX"')
    expect(src).toContain('b"MTK"')
    expect(src).toContain('b"My Token"')
    expect(src).not.toContain('TEMPLATE_')
  })

  it('documents how the supply and metadata policies are enforced and what the registry shows', () => {
    const fixed = buildPackageFiles({ config: { ...baseConfig, initialSupply: 21n, supplyPolicy: 'fixed', metadataPolicy: 'frozen' } })['README.md'] as string
    expect(fixed).toContain('## Supply and metadata policies')
    expect(fixed).toMatch(/Fixed supply.*registry took the TreasuryCap.*registry reports the supply as fixed/s)
    expect(fixed).toMatch(/Frozen metadata.*deleted.*registry reports the metadata capability as deleted/s)
    expect(fixed).not.toMatch(/registry still reports/)
    const open = buildPackageFiles({ config: { ...baseConfig, packagePolicy: 'upgradeable' } })['README.md'] as string
    expect(open).toMatch(/Mintable supply/)
    expect(open).toMatch(/UpgradeCap was sent to the recipient/)
  })
})

describe('buildPackageFiles', () => {
  it('produces the full mwsui_token-shaped file set (+ LICENSE for a real license)', () => {
    const f = buildPackageFiles({ config: baseConfig, licenseText: 'MIT LICENSE\n...' })
    for (const p of REQUIRED) expect(Object.keys(f)).toContain(p)
    expect(f['LICENSE']).toBe('MIT LICENSE\n...')
  })

  it('leaves no unresolved placeholders or template identifiers', () => {
    const f = buildPackageFiles({ config: baseConfig, licenseText: 'x' })
    for (const [path, content] of Object.entries(f)) {
      if (path === 'LICENSE') continue
      expect(content, `${path} X…X`).not.toMatch(/X[A-Z_]+X/)
      expect(content, `${path} sui_token_template`).not.toContain('sui_token_template')
      expect(content, `${path} TEMPLATE_ default`).not.toMatch(/TEMPLATE_(SYMBOL|NAME|DESCRIPTION|ICON_URL)/)
    }
  })

  it('substitutes the Move source identifiers and named constants', () => {
    const src = buildPackageFiles({ config: baseConfig })['sources/mytoken.move']
    expect(src).toContain('module my_token::mytoken;')
    expect(src).toContain('const DECIMALS: u8 = 8;')
    expect(src).toContain('b"MTK"')
    expect(src).toContain('b"My Token"')
    expect(src).toContain('b"https://example.com/icon.png"')
    expect(src).toContain('SPDX-License-Identifier: MIT')
    expect(src).toContain('MYTOKEN')
  })

  it('sets the Move.toml license field', () => {
    expect(buildPackageFiles({ config: baseConfig })['Move.toml']).toMatch(/^license = "MIT"$/m)
  })

  it('rewrites the licence header and README line for the 0BSD default, whatever the template ships with', () => {
    const f = buildPackageFiles({ config: { ...baseConfig, license: '0BSD', licenseName: 'BSD Zero Clause License' } })
    const src = f['sources/mytoken.move']!
    expect(src.split('\n')[0]).toBe('// SPDX-License-Identifier: 0BSD')
    expect(src.split('\n')[1]).toBe('// Licensed under the 0BSD license; see the LICENSE file.')
    expect(src).not.toMatch(/CC0|public domain/)
    expect(f['README.md']).toContain('BSD Zero Clause License — see the LICENSE file.')
    expect(f['README.md']).not.toMatch(/CC0 1\.0 Universal/)
    expect(f['Move.toml']).toMatch(/^license = "0BSD"$/m)
  })

  it('handles a proprietary (NONE) license: no LICENSE file, UNLICENSED fields', () => {
    const cfg = { ...baseConfig, license: 'NONE' }
    const f = buildPackageFiles({ config: cfg, licenseText: 'ignored' })
    expect(f['LICENSE']).toBeUndefined()
    expect(f['Move.toml']).toMatch(/^license = "UNLICENSED"$/m)
    expect(f['sources/mytoken.move']).toContain('SPDX-License-Identifier: UNLICENSED')
    expect(f['README.md']).toContain('All rights reserved')
  })

  it('refuses to generate from an unsafe config (defence in depth)', () => {
    // Values that bypass the form validator must still be rejected here so no
    // injectable Move source or shell script can ever be produced.
    expect(() => buildPackageFiles({ config: { ...baseConfig, symbol: 'E\nVIL' } })).toThrow(/symbol/)
    expect(() => buildPackageFiles({ config: { ...baseConfig, name: 'a"b' } })).toThrow(/name/)
    expect(() => buildPackageFiles({ config: { ...baseConfig, packageName: 'Bad-Name' } })).toThrow(/package name/)
    expect(() => buildPackageFiles({ config: { ...baseConfig, moduleName: 'module' } })).toThrow(/module name/)
    expect(() => buildPackageFiles({ config: { ...baseConfig, structName: 'WRONG' } })).toThrow(/struct name/)
    expect(() => buildPackageFiles({ config: { ...baseConfig, decimals: 99 } })).toThrow(/decimals/)
    expect(() => buildPackageFiles({ config: { ...baseConfig, license: 'MIT; rm -rf' } })).toThrow(/license/)
    // icon-URL scheme allowlist re-asserted downstream (layered on the form check)
    expect(() => buildPackageFiles({ config: { ...baseConfig, iconUrl: 'javascript:alert(1)' } })).toThrow(/icon URL/)
    expect(() => buildPackageFiles({ config: { ...baseConfig, iconUrl: 'http://x.io/a.png' } })).toThrow(/icon URL/)
  })

  it('pre-fills deployments.md table in-place for the deployed network', () => {
    const result: PublishResult = {
      network: 'testnet', packageId: '0xPKG', coinType: '0xPKG::mytoken::MYTOKEN',
      treasuryCapId: '0xT', metadataCapId: '0xM', currencyId: '0xC', upgradeCapId: undefined,
      digest: '0xDIG', feeRecipient: '0xFEE', feeMist: '500000000',
    }
    const dep = buildPackageFiles({ config: baseConfig, result })['deployments.md']!
    // Package ID, caps, and currency are in the Testnet table
    expect(dep).toContain('| Package ID | `0xPKG` |')
    expect(dep).toContain('| TreasuryCap ID | `0xT` |')
    expect(dep).toContain('| MetadataCap ID | `0xM` |')
    expect(dep).toContain('| Currency object ID | `0xC` |')
    // UpgradeCap burned: cell shows "burned", immutability confirmed: Yes
    expect(dep).toContain('| UpgradeCap ID (burned) | `burned` |')
    expect(dep).toContain('| Immutability confirmed | Yes |')
    // Mainnet section is NOT filled (still has placeholders)
    const mainnetStart = dep.indexOf('## Mainnet')
    expect(dep.slice(mainnetStart)).toContain('FILL_IN_AFTER_DEPLOY')
    // Coin type and digest appear in the appended comment
    expect(dep).toContain('<!-- Coin type: 0xPKG::mytoken::MYTOKEN -->')
    expect(dep).toContain('<!-- Publish digest: 0xDIG -->')
    // Package ID fills the downstream Move.toml reference block
    expect(dep).toContain('mytoken = "0xPKG"')
  })

  it('shows pending immutability when upgradeCapId is present', () => {
    const result: PublishResult = {
      network: 'testnet', packageId: '0xPKG', coinType: '0xPKG::mytoken::MYTOKEN',
      upgradeCapId: '0xUCAP',
      digest: '0xDIG', feeRecipient: '0xFEE', feeMist: '500000000',
    }
    const dep = buildPackageFiles({ config: baseConfig, result })['deployments.md']!
    expect(dep).toContain('| UpgradeCap ID (burned) | `0xUCAP` |')
    expect(dep).toContain('| Immutability confirmed | No (pending) |')
  })

  it('includes Published.toml when a result is given', () => {
    const result: PublishResult = {
      network: 'testnet', packageId: '0xPKG', coinType: '0xPKG::mytoken::MYTOKEN',
      upgradeCapId: undefined,
      digest: '0xDIG', feeRecipient: '0xFEE', feeMist: '500000000',
    }
    const f = buildPackageFiles({ config: baseConfig, result })
    const pub = f['Published.toml']
    expect(pub).toBeDefined()
    expect(pub).toContain('[published.testnet]')
    expect(pub).toContain('chain-id = "4c78adac"')
    expect(pub).toContain('original-id = "0xPKG"')
    expect(pub).toContain('published-at = "0xPKG"')
    expect(pub).toContain('version = 1')
    // No upgrade-capability line when cap is burned
    expect(pub).not.toContain('upgrade-capability =')
    expect(pub).toContain('make_immutable')
  })

  it('Published.toml includes upgrade-capability when cap is not burned', () => {
    const result: PublishResult = {
      network: 'testnet', packageId: '0xPKG', coinType: '0xPKG::mytoken::MYTOKEN',
      upgradeCapId: '0xUCAP',
      digest: '0xDIG', feeRecipient: '0xFEE', feeMist: '500000000',
    }
    const f = buildPackageFiles({ config: baseConfig, result })
    expect(f['Published.toml']).toContain('upgrade-capability = "0xUCAP"')
  })

  it('Published.toml uses mainnet chain-id for mainnet results', () => {
    const result: PublishResult = {
      network: 'mainnet', packageId: '0xPKG', coinType: '0xPKG::mytoken::MYTOKEN',
      digest: '0xDIG', feeRecipient: '0xFEE', feeMist: '500000000',
    }
    const f = buildPackageFiles({ config: baseConfig, result })
    expect(f['Published.toml']).toContain('[published.mainnet]')
    expect(f['Published.toml']).toContain('chain-id = "35834a8a"')
  })

  it('records the toolchain that built the shipped bytecode', () => {
    const result: PublishResult = {
      network: 'testnet', packageId: '0xPKG', coinType: '0xPKG::mytoken::MYTOKEN',
      digest: '0xDIG', feeRecipient: '0xFEE', feeMist: '0',
    }
    const pub = buildPackageFiles({ config: baseConfig, result })['Published.toml']
    expect(pub).toContain(`toolchain-version = "${TEMPLATE_BUILD_INFO.toolchainVersion}"`)
    expect(pub).toContain('chain-id = "4c78adac"')
  })

  it('writes no Published.toml for a localnet result (no durable chain id)', () => {
    const result: PublishResult = {
      network: 'localnet', packageId: '0xPKG', coinType: '0xPKG::mytoken::MYTOKEN',
      digest: '0xDIG', feeRecipient: '0xFEE', feeMist: '0',
    }
    const f = buildPackageFiles({ config: baseConfig, result })
    expect(f['Published.toml']).toBeUndefined()
    expect(f['deployments.md']).toContain('0xPKG')
  })

  it('omits Published.toml when no result is given', () => {
    const f = buildPackageFiles({ config: baseConfig })
    expect(f['Published.toml']).toBeUndefined()
  })
})

describe('generatePackageZip', () => {
  it('zips under a package-named root and round-trips', () => {
    const zip = generatePackageZip({ config: baseConfig, licenseText: 'MIT' })
    const entries = unzipSync(zip)
    expect(Object.keys(entries)).toContain('my_token/Move.toml')
    expect(Object.keys(entries)).toContain('my_token/sources/mytoken.move')
    expect(strFromU8(entries['my_token/Move.toml']!)).toContain('name = "my_token"')
  })
})

describe('supply and metadata policy in the generated source', () => {
  const src = (over: Partial<TokenConfig>) => buildPackageFiles({ config: { ...baseConfig, ...over } })['sources/mytoken.move'] as string

  it('writes the raw initial supply (whole tokens x 10^decimals) and both flags', () => {
    const s = src({ initialSupply: 1000n, decimals: 6, supplyPolicy: 'fixed', metadataPolicy: 'frozen' })
    expect(s).toContain('const INITIAL_SUPPLY: u64 = 1000000000;')
    expect(s).toContain('const FIXED_SUPPLY: bool = true;')
    expect(s).toContain('const FROZEN_METADATA: bool = true;')
  })

  it('defaults to no supply, mintable, updatable', () => {
    const s = src({})
    expect(s).toContain('const INITIAL_SUPPLY: u64 = 0;')
    expect(s).toContain('const FIXED_SUPPLY: bool = false;')
    expect(s).toContain('const FROZEN_METADATA: bool = false;')
  })

  it('carries the metadata policy into publish.sh and the policies into the docs', () => {
    const f = buildPackageFiles({ config: { ...baseConfig, initialSupply: 7n, supplyPolicy: 'fixed', metadataPolicy: 'frozen' } })
    expect(f['scripts/publish.sh']).toContain('METADATA_POLICY="frozen"')
    expect(f['CLAUDE.md']).toContain('`fixed`')
    expect(f['CLAUDE.md']).toMatch(/initial supply `7` whole tokens/)
  })
})

describe('Move.lock carries the template framework pin (template F7)', () => {
  const lock = (over: Partial<TokenConfig> = {}) => buildPackageFiles({ config: { ...baseConfig, ...over } })['Move.lock'] as string

  it('renames only the root package pin', () => {
    const out = lock()
    expect(out).toContain('[pinned.testnet.my_token]')
    expect(out).not.toContain('sui_token_template')
    expect(out).toContain('[pinned.testnet.MoveStdlib]')
    expect(out).toContain('[pinned.testnet.Sui]')
  })

  it('differs from the template lock by exactly that one line', () => {
    const template = TEMPLATE_FILES['Move.lock'].split('\n')
    const out = lock().split('\n')
    expect(out).toHaveLength(template.length)
    const changed = out.flatMap((l, i) => (l === template[i] ? [] : [[template[i], l]]))
    expect(changed).toEqual([['[pinned.testnet.sui_token_template]', '[pinned.testnet.my_token]']])
  })

  it('keeps the framework revision of the template', () => {
    const rev = /rev = "([0-9a-f]{40})"/.exec(TEMPLATE_FILES['Move.lock'])?.[1]
    expect(rev).toBeDefined()
    expect(lock()).toContain(`rev = "${rev}"`)
  })

  it('is part of the zip', () => {
    const entries = unzipSync(generatePackageZip({ config: baseConfig }))
    expect(strFromU8(entries['my_token/Move.lock']!)).toContain('[pinned.testnet.my_token]')
  })
})

describe('literal-safe substitution in publish.sh and the README licence line (F18)', () => {
  it('a module named like a template key is not rewritten in publish.sh', () => {
    const f = buildPackageFiles({ config: { ...baseConfig, moduleName: 'xmodulenamex', structName: 'XMODULENAMEX' } })
    const script = f['scripts/publish.sh'] as string
    expect(script).toContain('COIN_TYPE_SUFFIX="::xmodulenamex::XMODULENAMEX"')
    expect(script).toContain('XMODULENAMEX_TOKEN_PACKAGE_ID=')
    expect(script).not.toMatch(/xmodulenamex_TOKEN/)
  })

  it('a package, module and struct that contain other keys come through verbatim', () => {
    const f = buildPackageFiles({
      config: { ...baseConfig, packageName: 'xpackagenamex', moduleName: 'xmetadatapolicyx', structName: 'XMETADATAPOLICYX' },
    })
    const script = f['scripts/publish.sh'] as string
    expect(script).toContain('COIN_TYPE_SUFFIX="::xmetadatapolicyx::XMETADATAPOLICYX"')
    expect(script).toContain('Publishing xpackagenamex package')
    expect(script).toContain('METADATA_POLICY="updatable"')
    expect(script).not.toContain('XPACKAGENAMEX')
  })

  it.each(['A$&B$\'C', 'A$`B', '$$ and $1 and $<x>'])('licence name %s is written literally in the README', (licenseName) => {
    const readme = buildPackageFiles({ config: { ...baseConfig, licenseName } })['README.md'] as string
    expect(readme).toContain(`${licenseName} — see the LICENSE file.`)
    expect(readme).not.toContain('BSD Zero Clause')
  })

  it('renders hostile text fields literally in every generated file', () => {
    const f = buildPackageFiles({ config: { ...baseConfig, description: "x$&y$'z", packageDescription: 'p$`q$$r' } })
    expect(f['README.md']).toContain("x$&y$'z")
    expect(f['sources/mytoken.move']).toContain('p$`q$$r')
    expect(f['sources/mytoken.move']).toContain('b"x$&y$\'z"')
  })
})

describe('Published.toml chain ids are looked up by own key (F19)', () => {
  const result = (network: string): PublishResult => ({
    network: network as PublishResult['network'], packageId: '0xPKG', coinType: '0xPKG::mytoken::MYTOKEN',
    digest: '0xDIG', feeRecipient: '0xFEE', feeMist: '0',
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])('%s writes no Published.toml', (network) => {
    const f = buildPackageFiles({ config: baseConfig, result: result(network) })
    expect(f['Published.toml']).toBeUndefined()
  })

  it('still records testnet and mainnet', () => {
    expect(buildPackageFiles({ config: baseConfig, result: result('testnet') })['Published.toml']).toContain('chain-id = "4c78adac"')
    expect(buildPackageFiles({ config: baseConfig, result: result('mainnet') })['Published.toml']).toContain('chain-id = "35834a8a"')
  })
})
