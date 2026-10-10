// Publish-result parsing. Every object is matched by its exact, normalised type, and the coin type
// must belong to the package this transaction published — a TreasuryCap of any other coin (or of a
// look-alike framework address) is never taken for the new token.

import type { SuiClientTypes } from '@mysten/sui/client'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { CurrencyRef } from './transactions.js'
import { frameworkTypeArgument, isFrameworkType, typePackage } from './typeNames.js'
import type { PublishResult, TokenConfig, TokenNetwork } from './types.js'

/** One object change, in the shape {@link toSuiTxResult} produces. */
export interface ObjectChange {
  type: string
  objectType?: string
  objectId?: string
  packageId?: string
  version?: string
  digest?: string
}

/** A transaction outcome: its digest, object changes and effects status. */
export interface SuiTxResult {
  digest: string
  objectChanges?: ObjectChange[]
  effects?: { status?: { status?: string; error?: string } }
}

/** The core-API execution result {@link toSuiTxResult} consumes (effects + object types). */
export type CoreExecutionResult = SuiClientTypes.TransactionResult<{ effects: true; objectTypes: true }>

/**
 * Map a core-API (gRPC) execution result onto {@link SuiTxResult}: created and mutated objects come
 * from `effects.changedObjects` (types from `objectTypes`), and a newly written package becomes the
 * `published` entry. A failed transaction is returned with a failure status, not thrown.
 */
export function toSuiTxResult(res: CoreExecutionResult): SuiTxResult {
  const tx = res.Transaction ?? res.FailedTransaction
  const types = tx.objectTypes ?? {}
  const objectChanges: ObjectChange[] = []
  for (const c of tx.effects?.changedObjects ?? []) {
    if (c.outputState === 'PackageWrite') {
      if (c.idOperation === 'Created') objectChanges.push({ type: 'published', packageId: c.objectId })
    } else if (c.outputState === 'ObjectWrite') {
      objectChanges.push({
        type: c.idOperation === 'Created' ? 'created' : 'mutated',
        objectId: c.objectId,
        objectType: Object.hasOwn(types, c.objectId) ? types[c.objectId] : undefined,
        version: c.outputVersion ?? undefined,
        digest: c.outputDigest ?? undefined,
      })
    }
  }
  const status = tx.status.success ? { status: 'success' } : { status: 'failure', error: tx.status.error.message }
  return { digest: tx.digest, objectChanges, effects: { status } }
}

/** A parsed publish: the result, plus the pending currency's reference for `finalize_registration`. */
export interface ParsedPublish {
  result: PublishResult
  /** Present when the effects carried the pending `Currency<T>`'s version and digest. */
  currencyRef?: CurrencyRef
}

/**
 * Read the package id, coin type and the created objects out of a publish's object changes.
 *
 * The coin type comes from the pending `Currency<T>` (every coin has exactly one, and it exists whatever
 * the policies are). The `TreasuryCap` is absent for a fixed supply and the `MetadataCap` for frozen
 * metadata, because `init` applied those policies in the publish transaction.
 *
 * @throws {Error} unless exactly one package was published, exactly one `Currency<T>` of a coin defined
 *   in that package was created, and no more than one of each of its other objects.
 */
export function extractPublishResult(
  objectChanges: readonly ObjectChange[],
  ctx: { network: TokenNetwork; digest: string; feeRecipient: string; feeMist: bigint },
): ParsedPublish {
  const published = objectChanges.filter((c) => c.type === 'published' && c.packageId)
  if (published.length !== 1) {
    throw new Error(`expected exactly one published package in the effects, found ${published.length}`)
  }
  const packageId = normalizeSuiAddress(published[0]?.packageId ?? '')
  const created = objectChanges.filter((c) => c.type === 'created' && c.objectId && c.objectType)

  const currencies = created.filter((c) => {
    const coin = frameworkTypeArgument(c.objectType, 'coin_registry', 'Currency')
    return coin !== null && typePackage(coin) === packageId
  })
  if (currencies.length !== 1) {
    throw new Error(`expected exactly one Currency for a coin of ${packageId}, found ${currencies.length}`)
  }
  const currency = currencies[0]
  const coinType = currency ? frameworkTypeArgument(currency.objectType, 'coin_registry', 'Currency') : null
  if (!currency || !coinType) throw new Error('Currency without a coin type')

  const ofCoin = (module: string, name: string, what: string) => {
    const found = created.filter((c) => frameworkTypeArgument(c.objectType, module, name) === coinType)
    if (found.length > 1) throw new Error(`expected at most one ${what} for ${coinType}, found ${found.length}`)
    return found[0]
  }
  const treasury = ofCoin('coin', 'TreasuryCap', 'TreasuryCap')
  const metadataCap = ofCoin('coin_registry', 'MetadataCap', 'MetadataCap')
  const initialCoin = ofCoin('coin', 'Coin', 'initial supply Coin')
  const upgradeCap = created.find((c) => isFrameworkType(c.objectType, 'package', 'UpgradeCap'))

  const result: PublishResult = {
    network: ctx.network,
    packageId,
    coinType,
    treasuryCapId: treasury?.objectId,
    metadataCapId: metadataCap?.objectId,
    initialCoinId: initialCoin?.objectId,
    currencyId: currency.objectId,
    currencyVersion: currency.version,
    currencyDigest: currency.digest,
    upgradeCapId: upgradeCap?.objectId,
    digest: ctx.digest,
    feeRecipient: ctx.feeRecipient,
    feeMist: ctx.feeMist.toString(),
  }
  const currencyRef =
    currency.objectId && currency.version && currency.digest
      ? { objectId: currency.objectId, version: currency.version, digest: currency.digest }
      : undefined
  return { result, currencyRef }
}

/**
 * Check that what a publish created matches the policies the config asked `init` to apply: a fixed
 * supply has no TreasuryCap, a mintable one has exactly one; frozen metadata has no MetadataCap, updatable
 * metadata has one; a supply above zero is one initial Coin. A mismatch means the patched constants did
 * not do what was asked, so the caller must stop rather than route caps that should not exist.
 *
 * @throws {Error} naming the first mismatch.
 */
export function assertResultMatchesPolicy(
  config: Pick<TokenConfig, 'supplyPolicy' | 'metadataPolicy' | 'initialSupply'>,
  result: Pick<PublishResult, 'treasuryCapId' | 'metadataCapId' | 'initialCoinId'>,
): void {
  if (config.supplyPolicy === 'fixed' && result.treasuryCapId) {
    throw new Error('the supply is meant to be fixed, but a TreasuryCap exists')
  }
  if (config.supplyPolicy === 'mintable' && !result.treasuryCapId) {
    throw new Error('the supply is meant to be mintable, but no TreasuryCap was created')
  }
  if (config.metadataPolicy === 'frozen' && result.metadataCapId) {
    throw new Error('the metadata is meant to be frozen, but a MetadataCap exists')
  }
  if (config.metadataPolicy === 'updatable' && !result.metadataCapId) {
    throw new Error('the metadata is meant to be updatable, but no MetadataCap was created')
  }
  if (config.initialSupply > 0n && !result.initialCoinId) {
    throw new Error('an initial supply was requested, but no Coin was created')
  }
  if (config.initialSupply === 0n && result.initialCoinId) {
    throw new Error('no initial supply was requested, but a Coin was created')
  }
}
