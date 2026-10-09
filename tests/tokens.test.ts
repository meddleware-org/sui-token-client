import { describe, it, expect, vi } from 'vitest'
import { listMyTokens } from '../src/tokens.js'
import type { OwnedObjectsClient } from '../src/types.js'

const PKG = '0x' + 'ab'.repeat(32)
const OTHER_PKG = '0x' + 'ef'.repeat(32)
const OWNER = '0x' + 'cd'.repeat(32)
const SUI = '0x2::sui::SUI'

interface Fake {
  /** Owned objects per type filter, in pages. */
  owned?: Record<string, { objectId: string; type: string }[][]>
  /** Held coin types, in pages. */
  balances?: string[][]
  /** package id → publisher address; a missing package has no previous transaction. */
  publishers?: Record<string, string>
}

function client(fake: Fake = {}) {
  const listOwnedObjects = vi.fn(async ({ type, cursor }: { type?: string; cursor?: string | null }) => {
    const pages = fake.owned?.[type ?? ''] ?? [[]]
    const i = cursor ? Number(cursor) : 0
    const hasNextPage = i + 1 < pages.length
    return { objects: pages[i]!, hasNextPage, cursor: hasNextPage ? String(i + 1) : null }
  })
  const listBalances = vi.fn(async ({ cursor }: { cursor?: string | null }) => {
    const pages = fake.balances ?? [[]]
    const i = cursor ? Number(cursor) : 0
    const hasNextPage = i + 1 < pages.length
    return { balances: pages[i]!.map((coinType) => ({ coinType })), hasNextPage, cursor: hasNextPage ? String(i + 1) : null }
  })
  const getObject = vi.fn(async ({ objectId }: { objectId: string }) => ({
    object: { previousTransaction: objectId in (fake.publishers ?? {}) ? `tx-${objectId}` : null },
  }))
  const getTransaction = vi.fn(async ({ digest }: { digest: string }) => ({
    Transaction: { transaction: { sender: fake.publishers?.[digest.replace(/^tx-/, '')] } },
  }))
  return { core: { listOwnedObjects, listBalances, getObject, getTransaction } } satisfies OwnedObjectsClient
}

const TREASURY = '0x2::coin::TreasuryCap'
const METADATA = '0x2::coin_registry::MetadataCap'

describe('listMyTokens: owned capabilities', () => {
  it('lists owned TreasuryCaps, short- and long-form, once per coin type', async () => {
    const c = client({
      owned: {
        [TREASURY]: [
          [
            { objectId: '0x1', type: `0x2::coin::TreasuryCap<${PKG}::a::A>` },
            { objectId: '0x2', type: `0x${'0'.repeat(63)}2::coin::TreasuryCap<${PKG}::b::B>` },
            { objectId: '0x3', type: `0x2::coin::TreasuryCap<${PKG}::a::A>` },
            { objectId: '0x4', type: '0x2::coin::Coin<0x2::sui::SUI>' },
          ],
        ],
      },
    })
    const tokens = await listMyTokens(c, OWNER)
    expect(c.core.listOwnedObjects).toHaveBeenCalledWith({ owner: OWNER, type: TREASURY, cursor: null })
    expect(tokens).toEqual([
      { coinType: `${PKG}::a::A`, packageId: PKG, treasuryCapId: '0x1', label: 'A' },
      { coinType: `${PKG}::b::B`, packageId: PKG, treasuryCapId: '0x2', label: 'B' },
    ])
  })

  it('merges a TreasuryCap and a MetadataCap of the same coin into one entry, and lists a coin with only a MetadataCap', async () => {
    const c = client({
      owned: {
        [TREASURY]: [[{ objectId: '0x1', type: `0x2::coin::TreasuryCap<${PKG}::a::A>` }]],
        [METADATA]: [
          [
            { objectId: '0x5', type: `0x2::coin_registry::MetadataCap<${PKG}::a::A>` },
            { objectId: '0x6', type: `0x2::coin_registry::MetadataCap<${PKG}::b::B>` },
          ],
        ],
      },
    })
    expect(await listMyTokens(c, OWNER)).toEqual([
      { coinType: `${PKG}::a::A`, packageId: PKG, treasuryCapId: '0x1', metadataCapId: '0x5', label: 'A' },
      { coinType: `${PKG}::b::B`, packageId: PKG, metadataCapId: '0x6', label: 'B' },
    ])
  })

  it('ignores a look-alike capability from another address', async () => {
    const c = client({
      owned: {
        [TREASURY]: [[{ objectId: '0x9', type: `0x${'e'.repeat(64)}::coin::TreasuryCap<${PKG}::a::A>` }]],
        [METADATA]: [[{ objectId: '0x8', type: `0x${'e'.repeat(64)}::coin_registry::MetadataCap<${PKG}::a::A>` }]],
      },
    })
    expect(await listMyTokens(c, OWNER)).toEqual([])
  })

  it('reads every page', async () => {
    const c = client({
      owned: {
        [TREASURY]: [
          [{ objectId: '0x1', type: `0x2::coin::TreasuryCap<${PKG}::a::A>` }],
          [{ objectId: '0x2', type: `0x2::coin::TreasuryCap<${PKG}::b::B>` }],
          [{ objectId: '0x3', type: `0x2::coin::TreasuryCap<${PKG}::c::C>` }],
        ],
      },
    })
    expect((await listMyTokens(c, OWNER)).map((t) => t.label)).toEqual(['A', 'B', 'C'])
    expect(c.core.listOwnedObjects).toHaveBeenCalledWith({ owner: OWNER, type: TREASURY, cursor: '2' })
  })

  it('throws past the page limit instead of returning a partial list', async () => {
    const c = client({ owned: { [TREASURY]: [[], [], []] } })
    await expect(listMyTokens(c, OWNER, { maxPages: 2 })).rejects.toThrow(/more than 2 pages/)
  })
})

describe('listMyTokens: coins with no capability (fixed supply, frozen metadata)', () => {
  it('lists a held coin whose package the wallet published', async () => {
    const c = client({ balances: [[SUI, `${PKG}::fixed::FIXED`]], publishers: { [PKG]: OWNER } })
    expect(await listMyTokens(c, OWNER)).toEqual([{ coinType: `${PKG}::fixed::FIXED`, packageId: PKG, label: 'FIXED' }])
  })

  it('does not list a held coin someone else published (a coin merely received)', async () => {
    const c = client({ balances: [[`${OTHER_PKG}::x::X`]], publishers: { [OTHER_PKG]: '0x' + '11'.repeat(32) } })
    expect(await listMyTokens(c, OWNER)).toEqual([])
  })

  it('compares the publisher by normalised address', async () => {
    const c = client({ balances: [[`${PKG}::fixed::FIXED`]], publishers: { [PKG]: OWNER.toUpperCase().replace('0X', '0x') } })
    expect(await listMyTokens(c, OWNER)).toHaveLength(1)
  })

  it('never looks up SUI or other system packages', async () => {
    const c = client({ balances: [[SUI, '0x1::foo::Foo', `0x${'0'.repeat(63)}2::sui::SUI`]] })
    expect(await listMyTokens(c, OWNER)).toEqual([])
    expect(c.core.getObject).not.toHaveBeenCalled()
  })

  it('does not look up a coin already listed through its capability, and looks each package up once', async () => {
    const c = client({
      owned: { [TREASURY]: [[{ objectId: '0x1', type: `0x2::coin::TreasuryCap<${PKG}::a::A>` }]] },
      balances: [[`${PKG}::a::A`, `${OTHER_PKG}::x::X`, `${OTHER_PKG}::y::Y`]],
      publishers: { [OTHER_PKG]: OWNER },
    })
    const tokens = await listMyTokens(c, OWNER)
    expect(tokens.map((t) => t.label)).toEqual(['A', 'X', 'Y'])
    expect(tokens[1]).toEqual({ coinType: `${OTHER_PKG}::x::X`, packageId: OTHER_PKG, label: 'X' })
    expect(c.core.getObject).toHaveBeenCalledTimes(1)
  })

  it('reads every balance page and refuses to guess when a wallet holds too many packages', async () => {
    const pages = [[`${PKG}::a::A`], [`${OTHER_PKG}::b::B`]]
    const c = client({ balances: pages, publishers: { [PKG]: OWNER } })
    expect((await listMyTokens(c, OWNER)).map((t) => t.label)).toEqual(['A'])
    await expect(listMyTokens(c, OWNER, { maxHeldCoinTypes: 1 })).rejects.toThrow(/cannot tell which it published/)
    await expect(listMyTokens(client({ balances: [[], [], []] }), OWNER, { maxPages: 2 })).rejects.toThrow(/more than 2 pages of balances/)
  })

  it('surfaces a failed lookup instead of silently dropping the coin', async () => {
    const c = client({ balances: [[`${PKG}::a::A`]], publishers: { [PKG]: OWNER } })
    c.core.getTransaction.mockRejectedValueOnce(new Error('node unavailable'))
    await expect(listMyTokens(c, OWNER)).rejects.toThrow(/node unavailable/)
  })
})
