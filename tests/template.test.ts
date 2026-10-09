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
      expect(back.constant_pool.some((c) => typeof c.type_ === 'object' && asStr(c.data) === v)).toBe(true)
    }
    // no template defaults remain
    for (const def of [
      TEMPLATE_DEFAULTS.symbol,
      TEMPLATE_DEFAULTS.name,
      TEMPLATE_DEFAULTS.description,
      TEMPLATE_DEFAULTS.iconUrl,
    ]) {
      expect(back.constant_pool.some((c) => typeof c.type_ === 'object' && asStr(c.data) === def)).toBe(false)
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
    expect(back.constant_pool.some((c) => typeof c.type_ === 'object' && c.data.length === 1 && c.data[0] === 0)).toBe(true)
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
    const order = back.constant_pool.filter((c) => typeof c.type_ === 'object').map((c) => asStr(c.data))
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

describe('patchTemplateModule supply and metadata policy', () => {
  const base = { moduleName: 'mycoin', structName: 'MYCOIN', symbol: 'MYC', name: 'My Coin', description: 'desc', iconUrl: '', decimals: 6 }
  const u64 = (n: bigint) => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(8 * i)) & 0xffn))
  const consts = (back: Decoded, type: string) => back.constant_pool.filter((c) => c.type_ === type).map((c) => c.data)

  it('writes the raw initial supply and both policy flags into their own constants', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const bytes = await patchTemplateModule({ ...base, initialSupply: 1_234_567_000_000n, fixedSupply: true, frozenMetadata: true })
    const back = deserialize(bytes) as unknown as Decoded
    expect(consts(back, 'U64')).toEqual([u64(1_234_567_000_000n)])
    // Both flags are true, and the verifier rejects a pool with duplicates: one shared entry.
    expect(consts(back, 'Bool')).toEqual([[1]])
    // the shipped defaults are gone
    expect(consts(back, 'U64')).not.toContainEqual(u64(BigInt(TEMPLATE_DEFAULTS.initialSupply)))
  })

  it('defaults to no initial supply, mintable, updatable (the old behaviour)', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const back = deserialize(await patchTemplateModule(base)) as unknown as Decoded
    expect(consts(back, 'U64')).toEqual([u64(0n)])
    expect(consts(back, 'Bool')).toEqual([[0]])
  })

  it('keeps the two flags apart: fixed does not freeze the metadata, frozen does not fix the supply', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const fixedOnly = deserialize(await patchTemplateModule({ ...base, initialSupply: 1n, fixedSupply: true })) as unknown as Decoded
    const frozenOnly = deserialize(await patchTemplateModule({ ...base, frozenMetadata: true })) as unknown as Decoded
    // pool order is the template's: FIXED_SUPPLY first, FROZEN_METADATA second
    expect(consts(fixedOnly, 'Bool')).toEqual([[1], [0]])
    expect(consts(frozenOnly, 'Bool')).toEqual([[0], [1]])
  })

  it('refuses a fixed supply with nothing minted, and a supply beyond u64', async () => {
    await (init as unknown as () => Promise<unknown>)()
    await expect(patchTemplateModule({ ...base, fixedSupply: true })).rejects.toThrow(/fixed supply needs an initial supply/)
    await expect(patchTemplateModule({ ...base, initialSupply: 1n << 64n })).rejects.toThrow(/u64/)
    await expect(patchTemplateModule({ ...base, initialSupply: -1n })).rejects.toThrow(/u64/)
  })
})

describe('patched constant pool has no duplicates (the verifier rejects them) and LdConst follows the merge', () => {
  interface Full extends Decoded {
    function_defs: { code?: { code?: unknown[] } | null }[]
  }
  const base = { moduleName: 'mycoin', structName: 'MYCOIN', symbol: 'MYC', name: 'My Coin', description: 'desc', iconUrl: 'https://example.com/i.png', decimals: 6 }

  /** The value each LdConst loads, as `type:bytes`, over every function. */
  const loaded = (back: Full): string[] =>
    back.function_defs.flatMap((d) =>
      (d.code?.code ?? []).flatMap((ins) => {
        if (ins === null || typeof ins !== 'object' || !('LdConst' in ins)) return []
        const c = back.constant_pool[(ins as { LdConst: number }).LdConst]!
        return [`${JSON.stringify(c.type_)}:${c.data.join(',')}`]
      }),
    )
  const str = (v: string) => `${JSON.stringify({ Vector: 'U8' })}:${[v.length, ...Buffer.from(v)].join(',')}`

  it('merges a symbol and a name that are equal, and every constant still loads its own value', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const bytes = await patchTemplateModule({ ...base, symbol: 'SAME', name: 'SAME', initialSupply: 9n })
    const back = deserialize(bytes) as unknown as Full
    const keys = back.constant_pool.map((c) => JSON.stringify([c.type_, c.data]))
    expect(new Set(keys).size).toBe(keys.length)
    expect(loaded(back).sort()).toEqual(
      [
        `"U64":${[9, 0, 0, 0, 0, 0, 0, 0].join(',')}`,
        '"Bool":0',
        '"Bool":0',
        '"U8":6',
        str('SAME'),
        str('SAME'),
        str('desc'),
        str('https://example.com/i.png'),
      ].sort(),
    )
  })

  it('merges two empty strings and both false flags in one module', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const back = deserialize(await patchTemplateModule({ ...base, description: '', iconUrl: '' })) as unknown as Full
    const keys = back.constant_pool.map((c) => JSON.stringify([c.type_, c.data]))
    expect(new Set(keys).size).toBe(keys.length)
    expect(loaded(back).filter((v) => v === str('')).length).toBe(2)
  })

  it('leaves a module with distinct constants untouched (no merge, same pool size)', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const back = deserialize(await patchTemplateModule({ ...base, initialSupply: 3n, fixedSupply: true })) as unknown as Full
    expect(back.constant_pool).toHaveLength(8)
  })
})
