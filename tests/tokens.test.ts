import { describe, it, expect, vi } from 'vitest'
import { listMyTokens } from '../src/tokens.js'
import type { OwnedObjectsClient } from '../src/types.js'

const PKG = '0x' + 'ab'.repeat(32)
const OWNER = '0x' + 'cd'.repeat(32)

function client(pages: { objects: { objectId: string; type: string }[] }[]) {
  const listOwnedObjects = vi.fn(async ({ cursor }: { cursor?: string | null }) => {
    const i = cursor ? Number(cursor) : 0
    const hasNextPage = i + 1 < pages.length
    return { objects: pages[i].objects, hasNextPage, cursor: hasNextPage ? String(i + 1) : null }
  })
  return { core: { listOwnedObjects } } satisfies OwnedObjectsClient
}

describe('listMyTokens', () => {
  it('lists owned TreasuryCaps, short- and long-form, once per coin type', async () => {
    const c = client([
      {
        objects: [
          { objectId: '0x1', type: `0x2::coin::TreasuryCap<${PKG}::a::A>` },
          { objectId: '0x2', type: `0x${'0'.repeat(63)}2::coin::TreasuryCap<${PKG}::b::B>` },
          { objectId: '0x3', type: `0x2::coin::TreasuryCap<${PKG}::a::A>` },
          { objectId: '0x4', type: '0x2::coin::Coin<0x2::sui::SUI>' },
        ],
      },
    ])
    const tokens = await listMyTokens(c, OWNER)
    expect(c.core.listOwnedObjects).toHaveBeenCalledWith({ owner: OWNER, type: '0x2::coin::TreasuryCap', cursor: null })
    expect(tokens).toEqual([
      { coinType: `${PKG}::a::A`, packageId: PKG, treasuryCapId: '0x1', label: 'A' },
      { coinType: `${PKG}::b::B`, packageId: PKG, treasuryCapId: '0x2', label: 'B' },
    ])
  })

  it('ignores a look-alike TreasuryCap from another address', async () => {
    const c = client([{ objects: [{ objectId: '0x9', type: `0x${'e'.repeat(64)}::coin::TreasuryCap<${PKG}::a::A>` }] }])
    expect(await listMyTokens(c, OWNER)).toEqual([])
  })

  it('reads every page', async () => {
    const c = client([
      { objects: [{ objectId: '0x1', type: `0x2::coin::TreasuryCap<${PKG}::a::A>` }] },
      { objects: [{ objectId: '0x2', type: `0x2::coin::TreasuryCap<${PKG}::b::B>` }] },
      { objects: [{ objectId: '0x3', type: `0x2::coin::TreasuryCap<${PKG}::c::C>` }] },
    ])
    expect((await listMyTokens(c, OWNER)).map((t) => t.label)).toEqual(['A', 'B', 'C'])
    expect(c.core.listOwnedObjects).toHaveBeenCalledTimes(3)
  })

  it('throws past the page limit instead of returning a partial list', async () => {
    const c = client([{ objects: [] }, { objects: [] }, { objects: [] }])
    await expect(listMyTokens(c, OWNER, { maxPages: 2 })).rejects.toThrow(/more than 2 pages/)
  })
})
