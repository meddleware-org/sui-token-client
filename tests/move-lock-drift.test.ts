import { describe, it, expect, vi } from 'vitest'
import type { TokenConfig } from '../src/types.js'

const config: TokenConfig = {
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

// Template drift in Move.lock must fail loudly rather than render a lock that pins the wrong package.
async function renderWithLock(lock: string) {
  vi.resetModules()
  vi.doMock('../src/template/files.js', async (original) => {
    const real = await original<typeof import('../src/template/files.js')>()
    return { ...real, TEMPLATE_FILES: { ...real.TEMPLATE_FILES, 'Move.lock': lock } }
  })
  const { buildPackageFiles } = await import('../src/package.js')
  return () => buildPackageFiles({ config })
}

describe('Move.lock template drift', () => {
  const root = '[pinned.testnet.sui_token_template]'

  it('refuses a lock without the root package pin', async () => {
    expect(await renderWithLock('[move]\nversion = 4\n')).toThrow(/exactly one line/)
  })

  it('refuses a lock with two root package pins', async () => {
    expect(await renderWithLock(`${root}\nuse_environment = "testnet"\n${root}\n`)).toThrow(/exactly one line/)
  })

  it('refuses a lock that still names the template elsewhere', async () => {
    expect(await renderWithLock(`${root}\ndeps = { x = "sui_token_template" }\n`)).toThrow(/still in Move.lock/)
  })

  it('renders a well-formed lock', async () => {
    const files = (await renderWithLock(`${root}\nuse_environment = "testnet"\n`))()
    expect(files['Move.lock']).toBe('[pinned.testnet.my_token]\nuse_environment = "testnet"\n')
  })
})
