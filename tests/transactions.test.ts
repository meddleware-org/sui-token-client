import { describe, it, expect } from 'vitest'
import type { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import {
  buildPublishTransaction,
  buildFinalizeTransaction,
  extractPublishResult,
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
    expect(split.SplitCoins.coin.$kind).toBe('GasCoin')
    expect(pureU64(pureBytesOfInput(tx, split.SplitCoins.amounts[0]))).toBe(1_000_000_000n)

    const [transfer] = byKind(tx, 'TransferObjects')
    expect(pureAddr(pureBytesOfInput(tx, transfer.TransferObjects.address))).toBe(recipient)
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
    expect(pureAddr(pureBytesOfInput(tx, transfer.TransferObjects.address))).toBe(sender)
  })
})

// ─── buildFinalizeTransaction ─────────────────────────────────────────────────

const treasuryCapId = '0x' + 'a'.repeat(64)
const metadataCapId = '0x' + 'b'.repeat(64)
const currencyRef = { objectId: '0x' + 'c'.repeat(64), version: '1', digest: 'CURRENCYDIGEST' }

const finalizeArgs = (config: TokenConfig) => ({
  config,
  coinType,
  treasuryCapId,
  metadataCapId,
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
    const { currencyRef: _cr, ...argsNoCurrency } = finalizeArgs(baseConfig())
    const tx = buildFinalizeTransaction(argsNoCurrency)
    const calls = byKind(tx, 'MoveCall')
    expect(calls.every((c) => c.MoveCall.function !== 'finalize_registration')).toBe(true)
  })

  it('mints supply scaled by decimals to the recipient', () => {
    const tx = buildFinalizeTransaction(finalizeArgs(baseConfig({ initialSupply: 1000n, decimals: 6 })))
    const mint = (byKind(tx, 'MoveCall')).find(
      (c) => c.MoveCall.function === 'mint',
    )
    expect(mint).toBeDefined()
    expect(mint!.MoveCall.typeArguments).toEqual([coinType])
    // 1000 * 10^6
    expect(pureU64(pureBytesOfInput(tx, mint!.MoveCall.arguments[1]))).toBe(1_000_000_000n)
  })

  it('freezes the TreasuryCap under the fixed supply policy', () => {
    const tx = buildFinalizeTransaction(finalizeArgs(baseConfig({ supplyPolicy: 'fixed' })))
    const freeze = (byKind(tx, 'MoveCall')).filter(
      (c) => c.MoveCall.function === 'public_freeze_object',
    )
    expect(freeze.some((c) => c.MoveCall.typeArguments[0].includes('coin::TreasuryCap'))).toBe(true)
  })

  it('freezes the MetadataCap under the frozen metadata policy', () => {
    const tx = buildFinalizeTransaction(finalizeArgs(baseConfig({ metadataPolicy: 'frozen' })))
    const freeze = (byKind(tx, 'MoveCall')).filter(
      (c) => c.MoveCall.function === 'public_freeze_object',
    )
    expect(freeze.some((c) => c.MoveCall.typeArguments[0].includes('coin_registry::MetadataCap'))).toBe(true)
  })

  it('routes both caps to a different recipient when supply/metadata stay open', () => {
    const tx = buildFinalizeTransaction(finalizeArgs(baseConfig({ recipient })))
    const transfers = byKind(tx, 'TransferObjects')
    // TreasuryCap + MetadataCap both go to the recipient (no mint here)
    expect(transfers).toHaveLength(2)
    for (const t of transfers) {
      expect(pureAddr(pureBytesOfInput(tx, t.TransferObjects.address))).toBe(recipient)
    }
  })

  it('does not freeze when policies are open and recipient is the sender', () => {
    const tx = buildFinalizeTransaction(finalizeArgs(baseConfig({ initialSupply: 5n })))
    const freeze = (byKind(tx, 'MoveCall')).filter(
      (c) => c.MoveCall.function === 'public_freeze_object',
    )
    expect(freeze).toHaveLength(0)
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
  ]

  it('extracts package id, coin type, every cap id and the currency reference', () => {
    const { result: r, currencyRef } = extractPublishResult(changes, ctx)
    expect(r.packageId).toBe(PKG)
    expect(r.coinType).toBe(COIN)
    expect(r.treasuryCapId).toBe(id(1))
    expect(r.metadataCapId).toBe(id(2))
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

  it("refuses a TreasuryCap whose coin is not defined in the published package", () => {
    const foreign = changes.map((c) =>
      c.objectType?.startsWith('0x2::coin::TreasuryCap') ? { ...c, objectType: `0x2::coin::TreasuryCap<0x${'c'.repeat(64)}::x::X>` } : c,
    )
    expect(() => extractPublishResult(foreign, ctx)).toThrow(/exactly one TreasuryCap/)
  })

  it('does not take a nested generic for the coin type', () => {
    const nested = [
      { type: 'created', objectType: `0x2::coin::TreasuryCap<0x2::balance::Balance<${COIN}>>`, objectId: id(8) },
      ...changes,
    ]
    // Balance<…> is defined at 0x2, not the published package, so only the real cap matches.
    expect(extractPublishResult(nested, ctx).result.coinType).toBe(COIN)
  })

  it('does not pair a Currency or MetadataCap of another coin', () => {
    const other = `${PKG}::other::OTHER`
    const mixed = changes.map((c) =>
      c.objectType?.includes('coin_registry::') ? { ...c, objectType: c.objectType.replace(COIN, other) } : c,
    )
    const { result, currencyRef } = extractPublishResult(mixed, ctx)
    expect(result.metadataCapId).toBeUndefined()
    expect(result.currencyId).toBeUndefined()
    expect(currencyRef).toBeUndefined()
  })

  it('requires exactly one published package', () => {
    expect(() => extractPublishResult(changes.slice(1), ctx)).toThrow(/exactly one published package/)
    expect(() => extractPublishResult([...changes, { type: 'published', packageId: id(5) }], ctx)).toThrow(/found 2/)
  })
})
