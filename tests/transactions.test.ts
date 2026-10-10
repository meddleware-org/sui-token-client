import { describe, it, expect } from 'vitest'
import type { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import {
  buildPublishTransaction,
  buildFinalizeTransaction,
  assertResultMatchesPolicy,
  extractPublishResult,
  finalizeHasWork,
} from '../src/index.js'
import type { TokenConfig } from '../src/types.js'

const sender = '0x' + '1'.repeat(64)
const recipient = '0x' + '2'.repeat(64)
const coinType = '0xPKG::mytoken::MYTOKEN'

// ─── introspection helpers over Transaction.getData() ─────────────────────────

type Cmd = ReturnType<Transaction['getData']>['commands'][number]

function commands(tx: Transaction): Cmd[] {
  return tx.getData().commands
}

function byKind<K extends Cmd['$kind']>(tx: Transaction, kind: K): Extract<Cmd, { $kind: K }>[] {
  return commands(tx).filter((c): c is Extract<Cmd, { $kind: K }> => c.$kind === kind)
}

/** Resolve an `{ Input: n }` argument to its decoded Pure bytes. */
function pureBytesOfInput(tx: Transaction, arg: unknown): Uint8Array {
  const idx = (arg as { $kind: string; Input: number }).Input
  const input = tx.getData().inputs[idx] as { $kind: string; Pure?: { bytes: string } }
  if (input.$kind !== 'Pure' || !input.Pure) throw new Error('expected a Pure input')
  return fromBase64(input.Pure.bytes)
}

function pureAddr(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function pureU64(bytes: Uint8Array): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true)
}

function baseConfig(over: Partial<TokenConfig> = {}): TokenConfig {
  return {
    packageName: 'my_token', moduleName: 'mytoken', structName: 'MYTOKEN',
    symbol: 'MTK', name: 'My Token', description: 'desc', iconUrl: '', decimals: 9,
    initialSupply: 0n, supplyPolicy: 'mintable', metadataPolicy: 'updatable',
    packagePolicy: 'immutable', recipient: sender, license: 'MIT',
    packageDescription: '', projectName: '',
    ...over,
  }
}

const publishArgs = (over: Partial<Parameters<typeof buildPublishTransaction>[0]> = {}) => ({
  moduleBytes: new Uint8Array([1, 2, 3]),
  sender,
  feeMist: 1_000_000_000n,
  feeRecipient: recipient,
  gasBudget: 500_000_000n,
  packagePolicy: 'immutable' as const,
  ...over,
})

describe('fee recipient', () => {
  it('refuses a zero, truncated or malformed fee recipient when a fee is charged', () => {
    for (const bad of ['0x' + '0'.repeat(64), '0x12ab', 'nope', '']) {
      expect(() => buildPublishTransaction(publishArgs({ feeRecipient: bad })), bad).toThrow(/fee recipient/)
    }
  })

  it('does not look at the recipient when no fee is charged', () => {
    expect(() => buildPublishTransaction(publishArgs({ feeMist: 0n, feeRecipient: '' }))).not.toThrow()
  })
})

// ─── buildPublishTransaction ──────────────────────────────────────────────────

describe('buildPublishTransaction', () => {
  it('publishes the module and sets sender + gas budget', () => {
    const tx = buildPublishTransaction(publishArgs())
    const publish = byKind(tx, 'Publish')
    expect(publish).toHaveLength(1)
    expect(tx.getData().sender).toBe(sender)
    expect(tx.getData().gasData.budget).toBe('500000000')
  })

  it('splits EXACTLY the fee from the gas coin to the configured treasury', () => {
    const tx = buildPublishTransaction(publishArgs({ feeMist: 1_000_000_000n }))
    const [split] = byKind(tx, 'SplitCoins')
    expect(split).toBeDefined()
    // must split from the gas coin, not an arbitrary coin
    expect(split!.SplitCoins.coin.$kind).toBe('GasCoin')
    expect(pureU64(pureBytesOfInput(tx, split!.SplitCoins.amounts[0]))).toBe(1_000_000_000n)

    const [transfer] = byKind(tx, 'TransferObjects')
    expect(pureAddr(pureBytesOfInput(tx, transfer!.TransferObjects.address))).toBe(recipient)
  })

  it('omits the fee split entirely when feeMist is 0', () => {
    const tx = buildPublishTransaction(publishArgs({ feeMist: 0n }))
    expect(byKind(tx, 'SplitCoins')).toHaveLength(0)
  })

  it('makes the package immutable under the immutable policy', () => {
    const tx = buildPublishTransaction(publishArgs({ packagePolicy: 'immutable' }))
    const calls = byKind(tx, 'MoveCall')
    expect(calls.some((c) => c.MoveCall.function === 'make_immutable')).toBe(true)
  })

  it('transfers the UpgradeCap to the sender under the upgradeable policy', () => {
    const tx = buildPublishTransaction(publishArgs({ packagePolicy: 'upgradeable', feeMist: 0n }))
    expect(byKind(tx, 'MoveCall')).toHaveLength(0)
    const [transfer] = byKind(tx, 'TransferObjects')
    // the only transfer is the UpgradeCap -> sender (no fee split here)
    expect(pureAddr(pureBytesOfInput(tx, transfer!.TransferObjects.address))).toBe(sender)
  })

  it('sends the UpgradeCap to the recipient when there is one, so upgrade authority travels with the caps', () => {
    const tx = buildPublishTransaction(publishArgs({ packagePolicy: 'upgradeable', feeMist: 0n, recipient }))
    const [transfer] = byKind(tx, 'TransferObjects')
    expect(pureAddr(pureBytesOfInput(tx, transfer!.TransferObjects.address))).toBe(recipient)
  })
})

// ─── buildFinalizeTransaction ─────────────────────────────────────────────────

const treasuryCapId = '0x' + 'a'.repeat(64)
const metadataCapId = '0x' + 'b'.repeat(64)
const initialCoinId = '0x' + 'd'.repeat(64)
const currencyRef = { objectId: '0x' + 'c'.repeat(64), version: '1', digest: 'CURRENCYDIGEST' }

/** The objects `init` leaves with the sender under `config`'s policies. */
const finalizeArgs = (config: TokenConfig) => ({
  config,
  coinType,
  treasuryCapId: config.supplyPolicy === 'mintable' ? treasuryCapId : undefined,
  metadataCapId: config.metadataPolicy === 'updatable' ? metadataCapId : undefined,
  initialCoinId: config.initialSupply > 0n ? initialCoinId : undefined,
  currencyRef,
  sender,
  gasBudget: 500_000_000n,
})

describe('buildFinalizeTransaction', () => {
  it('calls finalize_registration first when currencyRef is provided', () => {
    const tx = buildFinalizeTransaction(finalizeArgs(baseConfig()))
    const calls = byKind(tx, 'MoveCall')
    // finalize_registration is the first MoveCall in the PTB
    expect(calls[0]?.MoveCall?.function).toBe('finalize_registration')
    expect(calls[0]?.MoveCall?.typeArguments).toEqual([coinType])
  })

  it('omits finalize_registration when currencyRef is absent', () => {
    const { currencyRef: _cr, ...argsNoCurrency } = finalizeArgs(baseConfig({ recipient }))
    const tx = buildFinalizeTransaction(argsNoCurrency)
    const calls = byKind(tx, 'MoveCall')
    expect(calls.every((c) => c.MoveCall.function !== 'finalize_registration')).toBe(true)
  })

  it('treats the sender and a recipient in another case or zero padding as the same account', () => {
    const padded = '0x' + 'AB'.repeat(32)
    const short = '0x' + '0'.repeat(62) + '0a'
    expect(finalizeHasWork({ config: baseConfig({ recipient: padded }), sender: padded.toLowerCase() })).toBe(false)
    expect(finalizeHasWork({ config: baseConfig({ recipient: '0xa' }), sender: short })).toBe(false)
    const tx = buildFinalizeTransaction({ ...finalizeArgs(baseConfig({ recipient: '0xa', initialSupply: 5n })), sender: short })
    expect(byKind(tx, 'TransferObjects')).toHaveLength(0)
  })

  it('never mints or freezes: init applied the policies in the publish transaction', () => {
    for (const config of [
      baseConfig({ recipient, initialSupply: 1000n }),
      baseConfig({ recipient, initialSupply: 1000n, supplyPolicy: 'fixed', metadataPolicy: 'frozen' }),
      baseConfig({ recipient: sender, initialSupply: 5n }),
    ]) {
      const fns = byKind(buildFinalizeTransaction(finalizeArgs(config)), 'MoveCall').map((c) => c.MoveCall.function)
      expect(fns, JSON.stringify(config.supplyPolicy)).toEqual(['finalize_registration'])
    }
  })

  it('moves the initial coin, the TreasuryCap and the MetadataCap to a different recipient in one transfer', () => {
    const tx = buildFinalizeTransaction(finalizeArgs(baseConfig({ recipient, initialSupply: 1000n })))
    const transfers = byKind(tx, 'TransferObjects')
    expect(transfers).toHaveLength(1)
    const t = transfers[0]!
    expect(pureAddr(pureBytesOfInput(tx, t.TransferObjects.address))).toBe(recipient)
    expect(t.TransferObjects.objects).toHaveLength(3)
  })

  it('moves only what exists: a fixed supply with frozen metadata is just the minted coin', () => {
    const tx = buildFinalizeTransaction(
      finalizeArgs(baseConfig({ recipient, initialSupply: 7n, supplyPolicy: 'fixed', metadataPolicy: 'frozen' })),
    )
    expect(byKind(tx, 'TransferObjects')[0]!.TransferObjects.objects).toHaveLength(1)
  })

  it('transfers nothing when the recipient is the sender', () => {
    const tx = buildFinalizeTransaction(finalizeArgs(baseConfig({ initialSupply: 5n })))
    expect(byKind(tx, 'TransferObjects')).toHaveLength(0)
  })

  it('refuses ids that cannot exist under the policy', () => {
    const fixed = baseConfig({ initialSupply: 1n, supplyPolicy: 'fixed' })
    expect(() => buildFinalizeTransaction({ ...finalizeArgs(fixed), treasuryCapId })).toThrow(/fixed supply has no TreasuryCap/)
    const frozen = baseConfig({ metadataPolicy: 'frozen' })
    expect(() => buildFinalizeTransaction({ ...finalizeArgs(frozen), metadataCapId })).toThrow(/no MetadataCap/)
    const mintable = baseConfig()
    expect(() => buildFinalizeTransaction({ ...finalizeArgs(mintable), treasuryCapId: undefined })).toThrow(/needs its TreasuryCap/)
    const updatable = baseConfig()
    expect(() => buildFinalizeTransaction({ ...finalizeArgs(updatable), metadataCapId: undefined })).toThrow(/needs its MetadataCap/)
    const supplied = baseConfig({ initialSupply: 3n })
    expect(() => buildFinalizeTransaction({ ...finalizeArgs(supplied), initialCoinId: undefined })).toThrow(/needs the minted Coin/)
    expect(() => buildFinalizeTransaction({ ...finalizeArgs(baseConfig()), initialCoinId })).toThrow(/No initial supply/)
  })

  it('reports whether there is anything to run', () => {
    expect(finalizeHasWork({ config: baseConfig(), currencyRef, sender })).toBe(true)
    expect(finalizeHasWork({ config: baseConfig({ recipient }), sender })).toBe(true)
    expect(finalizeHasWork({ config: baseConfig(), sender })).toBe(false)
  })
})

// ─── extractPublishResult ─────────────────────────────────────────────────────

describe('extractPublishResult', () => {
  const PKG = '0x' + 'a1'.repeat(32)
  const COIN = `${PKG}::mytoken::MYTOKEN`
  const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
  const ctx = { network: 'testnet' as const, digest: 'DIG', feeRecipient: recipient, feeMist: 1_000_000_000n }
  const changes = [
    { type: 'published', packageId: PKG },
    { type: 'created', objectType: `0x2::coin::TreasuryCap<${COIN}>`, objectId: id(1) },
    { type: 'created', objectType: `0x2::coin_registry::MetadataCap<${COIN}>`, objectId: id(2) },
    { type: 'created', objectType: `0x2::coin_registry::Currency<${COIN}>`, objectId: id(3), version: '7', digest: 'CDIG' },
    { type: 'created', objectType: '0x2::package::UpgradeCap', objectId: id(4) },
    { type: 'created', objectType: `0x2::coin::Coin<${COIN}>`, objectId: id(6) },
  ]

  it('extracts package id, coin type, every cap id and the currency reference', () => {
    const { result: r, currencyRef } = extractPublishResult(changes, ctx)
    expect(r.packageId).toBe(PKG)
    expect(r.coinType).toBe(COIN)
    expect(r.treasuryCapId).toBe(id(1))
    expect(r.metadataCapId).toBe(id(2))
    expect(r.initialCoinId).toBe(id(6))
    expect(r.currencyId).toBe(id(3))
    expect(r.upgradeCapId).toBe(id(4))
    expect(r.feeRecipient).toBe(recipient)
    expect(r.feeMist).toBe('1000000000')
    expect(currencyRef).toEqual({ objectId: id(3), version: '7', digest: 'CDIG' })
  })

  it('reads long-form framework addresses and normalises the coin type', () => {
    const long = changes.map((c) => ({ ...c, objectType: c.objectType?.replace(/^0x2::/, '0x' + '0'.repeat(63) + '2::') }))
    const { result } = extractPublishResult(long, ctx)
    expect(result.coinType).toBe(COIN)
    expect(result.metadataCapId).toBe(id(2))
  })

  it('leaves the upgrade cap undefined for an immutable publish', () => {
    const immutable = changes.filter((c) => !(c.objectType ?? '').includes('UpgradeCap'))
    const { result, currencyRef } = extractPublishResult(immutable, { ...ctx, network: 'mainnet', feeMist: 0n })
    expect(result.upgradeCapId).toBeUndefined()
    expect(currencyRef?.version).toBe('7')
  })

  it('ignores a look-alike TreasuryCap from another address', () => {
    const lookalike = [
      { type: 'created', objectType: `0x${'b'.repeat(64)}::coin::TreasuryCap<${COIN}>`, objectId: id(9) },
      ...changes,
    ]
    expect(extractPublishResult(lookalike, ctx).result.treasuryCapId).toBe(id(1))
  })

  it('refuses a Currency whose coin is not defined in the published package', () => {
    const foreign = changes.map((c) =>
      c.objectType?.startsWith('0x2::coin_registry::Currency') ? { ...c, objectType: `0x2::coin_registry::Currency<0x${'c'.repeat(64)}::x::X>` } : c,
    )
    expect(() => extractPublishResult(foreign, ctx)).toThrow(/exactly one Currency/)
  })

  it('takes the coin type from the Currency, so a fixed supply (no TreasuryCap) and frozen metadata (no MetadataCap) parse', () => {
    const fixedFrozen = changes.filter((c) => !/TreasuryCap|MetadataCap/.test(c.objectType ?? ''))
    const { result } = extractPublishResult(fixedFrozen, ctx)
    expect(result.coinType).toBe(COIN)
    expect(result.treasuryCapId).toBeUndefined()
    expect(result.metadataCapId).toBeUndefined()
    expect(result.initialCoinId).toBe(id(6))
  })

  it('refuses a second TreasuryCap or initial Coin of the same coin', () => {
    const twice = [...changes, { type: 'created', objectType: `0x2::coin::TreasuryCap<${COIN}>`, objectId: id(7) }]
    expect(() => extractPublishResult(twice, ctx)).toThrow(/at most one TreasuryCap/)
    const coins = [...changes, { type: 'created', objectType: `0x2::coin::Coin<${COIN}>`, objectId: id(8) }]
    expect(() => extractPublishResult(coins, ctx)).toThrow(/at most one initial supply Coin/)
  })

  it('does not take a nested generic for the coin type', () => {
    const nested = [
      { type: 'created', objectType: `0x2::coin::TreasuryCap<0x2::balance::Balance<${COIN}>>`, objectId: id(8) },
      ...changes,
    ]
    // Balance<…> is defined at 0x2, not the published package, so only the real Currency names the coin.
    expect(extractPublishResult(nested, ctx).result.coinType).toBe(COIN)
  })

  it('does not pair a MetadataCap or initial Coin of another coin', () => {
    const other = `${PKG}::other::OTHER`
    const mixed = changes.map((c) =>
      /MetadataCap|::Coin</.test(c.objectType ?? '') ? { ...c, objectType: (c.objectType ?? '').replace(COIN, other) } : c,
    )
    const { result } = extractPublishResult(mixed, ctx)
    expect(result.metadataCapId).toBeUndefined()
    expect(result.initialCoinId).toBeUndefined()
    expect(result.currencyId).toBe(id(3))
  })

  it('names the coin by its Currency, whichever coin of the published package that is', () => {
    const other = `${PKG}::other::OTHER`
    const swapped = changes.map((c) =>
      c.objectType?.includes('coin_registry::Currency') ? { ...c, objectType: c.objectType.replace(COIN, other) } : c,
    )
    // The other Currency becomes the only one, so it names the coin; the caps of MYTOKEN then pair with nothing.
    const { result } = extractPublishResult(swapped, ctx)
    expect(result.coinType).toBe(other)
    expect(result.treasuryCapId).toBeUndefined()
  })

  it('requires exactly one published package', () => {
    expect(() => extractPublishResult(changes.slice(1), ctx)).toThrow(/exactly one published package/)
    expect(() => extractPublishResult([...changes, { type: 'published', packageId: id(5) }], ctx)).toThrow(/found 2/)
  })
})

describe('assertResultMatchesPolicy', () => {
  const ids = { treasuryCapId: 'T', metadataCapId: 'M', initialCoinId: 'C' }
  const cfg = (over: Partial<TokenConfig> = {}) => baseConfig({ initialSupply: 1n, ...over })

  it('accepts the objects each policy leaves behind', () => {
    expect(() => assertResultMatchesPolicy(cfg(), ids)).not.toThrow()
    expect(() => assertResultMatchesPolicy(cfg({ supplyPolicy: 'fixed', metadataPolicy: 'frozen' }), { initialCoinId: 'C' })).not.toThrow()
    expect(() => assertResultMatchesPolicy(baseConfig(), { treasuryCapId: 'T', metadataCapId: 'M' })).not.toThrow()
  })

  it('refuses every mismatch between the policy and what was created', () => {
    expect(() => assertResultMatchesPolicy(cfg({ supplyPolicy: 'fixed' }), ids)).toThrow(/meant to be fixed/)
    expect(() => assertResultMatchesPolicy(cfg(), { ...ids, treasuryCapId: undefined })).toThrow(/meant to be mintable/)
    expect(() => assertResultMatchesPolicy(cfg({ metadataPolicy: 'frozen' }), ids)).toThrow(/meant to be frozen/)
    expect(() => assertResultMatchesPolicy(cfg(), { ...ids, metadataCapId: undefined })).toThrow(/meant to be updatable/)
    expect(() => assertResultMatchesPolicy(cfg(), { ...ids, initialCoinId: undefined })).toThrow(/no Coin was created/)
    expect(() => assertResultMatchesPolicy(baseConfig(), ids)).toThrow(/no initial supply was requested/)
  })
})
