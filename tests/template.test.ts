import { describe, it, expect } from 'vitest'
import init, { deserialize } from '@mysten/move-bytecode-template'
import { patchTemplateModule } from '../src/template/patch.js'
import { TEMPLATE_DEFAULTS } from '../src/template/artifact.js'

const asStr = (data: number[]) => Buffer.from(data.slice(1)).toString('utf8')

interface Decoded {
  identifiers: string[]
  constant_pool: { type_: unknown; data: number[] }[]
}

describe('patchTemplateModule', () => {
  it('renames identifiers and patches all five constants, producing a valid module', async () => {
    await (init as unknown as () => Promise<unknown>)()

    const bytes = await patchTemplateModule({
      moduleName: 'mycoin',
      structName: 'MYCOIN',
      symbol: 'MYC',
      name: 'My Coin',
      description: 'A great coin',
      iconUrl: 'https://example.com/icon.svg',
      decimals: 6,
    })

    // valid Move module magic
    expect(Buffer.from(bytes.slice(0, 4)).toString('hex')).toBe('a11ceb0b')

    const back = deserialize(bytes) as unknown as Decoded

    // identifiers renamed; template identifiers gone
    expect(back.identifiers).toContain('mycoin')
    expect(back.identifiers).toContain('MYCOIN')
    expect(back.identifiers).not.toContain('sui_token_template')
    expect(back.identifiers).not.toContain('SUI_TOKEN_TEMPLATE')

    // constants patched
    expect(back.constant_pool.some((c) => c.type_ === 'U8' && c.data[0] === 6)).toBe(true)
    for (const v of ['MYC', 'My Coin', 'A great coin', 'https://example.com/icon.svg']) {
      expect(back.constant_pool.some((c) => c.type_ !== 'U8' && asStr(c.data) === v)).toBe(true)
    }
    // no template defaults remain
    for (const def of [
      TEMPLATE_DEFAULTS.symbol,
      TEMPLATE_DEFAULTS.name,
      TEMPLATE_DEFAULTS.description,
      TEMPLATE_DEFAULTS.iconUrl,
    ]) {
      expect(back.constant_pool.some((c) => c.type_ !== 'U8' && asStr(c.data) === def)).toBe(false)
    }
  })

  it('supports an empty icon URL', async () => {
    const bytes = await patchTemplateModule({
      moduleName: 'noicon',
      structName: 'NOICON',
      symbol: 'NIC',
      name: 'No Icon',
      description: 'desc',
      iconUrl: '',
      decimals: 9,
    })
    const back = deserialize(bytes) as unknown as Decoded
    // empty string encodes as a single 0x00 length byte
    expect(back.constant_pool.some((c) => c.type_ !== 'U8' && c.data.length === 1 && c.data[0] === 0)).toBe(true)
  })

  it('rejects out-of-range decimals', async () => {
    await expect(
      patchTemplateModule({
        moduleName: 'x', structName: 'X', symbol: 'X', name: 'X', description: 'X', iconUrl: '', decimals: 300,
      }),
    ).rejects.toThrow(/decimals/)
  })

  it('rejects a string constant with control chars or backslashes (defence in depth)', async () => {
    await expect(
      patchTemplateModule({
        moduleName: 'x', structName: 'X', symbol: 'E\nVIL', name: 'X', description: 'X', iconUrl: '', decimals: 9,
      }),
    ).rejects.toThrow(/control characters|quotes|backslashes/)

    await expect(
      patchTemplateModule({
        moduleName: 'x', structName: 'X', symbol: 'X', name: 'X', description: 'X',
        iconUrl: 'x'.repeat(600), decimals: 9,
      }),
    ).rejects.toThrow(/exceeds/)
  })
})

// Temporary test to check Walrus blob URL patching

describe('patchTemplateModule placeholder-valued inputs (F1)', () => {
  const base = { moduleName: 'mycoin', structName: 'MYCOIN', symbol: 'MYC', name: 'My Coin', description: 'desc', iconUrl: 'https://example.com/i.png', decimals: 6 }

  it('refuses a value that is a template placeholder instead of writing it into the wrong slot', async () => {
    await (init as unknown as () => Promise<unknown>)()
    for (const over of [
      { symbol: TEMPLATE_DEFAULTS.name },
      { name: TEMPLATE_DEFAULTS.description },
      { description: TEMPLATE_DEFAULTS.iconUrl },
      { iconUrl: TEMPLATE_DEFAULTS.symbol },
      { name: 'TEMPLATE_ANYTHING' },
    ]) {
      await expect(patchTemplateModule({ ...base, ...over })).rejects.toThrow(/template placeholder/)
    }
  })

  it('resolves all slots from the pristine pool: distinct values land in their own constants', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const bytes = await patchTemplateModule({ ...base, symbol: 'AAA', name: 'BBB', description: 'CCC', iconUrl: 'https://d.example/' })
    const back = deserialize(bytes) as unknown as Decoded
    const order = back.constant_pool.filter((c) => c.type_ !== 'U8').map((c) => asStr(c.data))
    expect(order.indexOf('AAA')).toBeLessThan(order.indexOf('BBB'))
    expect(order.indexOf('BBB')).toBeLessThan(order.indexOf('CCC'))
    expect(order.indexOf('CCC')).toBeLessThan(order.indexOf('https://d.example/'))
  })

  it('accepts identical symbol and name, and empty description and icon', async () => {
    await (init as unknown as () => Promise<unknown>)()
    await expect(patchTemplateModule({ ...base, symbol: 'SAME', name: 'SAME', description: '', iconUrl: '' })).resolves.toBeInstanceOf(Uint8Array)
  })
})

describe('patchTemplateModule identifier guard', () => {
  it('refuses a module name that duplicates an identifier the template uses', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const base = { structName: 'X', symbol: 'S', name: 'N', description: '', iconUrl: '', decimals: 6 }
    await expect(patchTemplateModule({ ...base, moduleName: 'coin', structName: 'COIN' })).rejects.toThrow(/collides/)
    await expect(patchTemplateModule({ ...base, moduleName: 'my_coin', structName: 'TreasuryCap' })).rejects.toThrow(/collides/)
  })
})

