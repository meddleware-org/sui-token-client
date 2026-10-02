// Publish-result parsing. Every object is matched by its exact, normalised type, and the coin type
// must belong to the package this transaction published — a TreasuryCap of any other coin (or of a
// look-alike framework address) is never taken for the new token.

import type { SuiClientTypes } from '@mysten/sui/client'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { CurrencyRef } from './transactions.js'
import { frameworkTypeArgument, isFrameworkType, treasuryCapCoinType, typePackage } from './typeNames.js'
import type { PublishResult, TokenNetwork } from './types.js'

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
        objectType: types[c.objectId],
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
 * Read the package id, coin type and the created caps out of a publish's object changes.
 *
 * @throws {Error} unless exactly one package was published and exactly one `TreasuryCap<T>` of a coin
 *   defined in that package was created.
 */
export function extractPublishResult(
  objectChanges: readonly ObjectChange[],
  ctx: { network: TokenNetwork; digest: string; feeRecipient: string; feeMist: bigint },
): ParsedPublish {
  const published = objectChanges.filter((c) => c.type === 'published' && c.packageId)
  if (published.length !== 1) {
    throw new Error(`expected exactly one published package in the effects, found ${published.length}`)
  }
  const packageId = normalizeSuiAddress(published[0].packageId!)
  const created = objectChanges.filter((c) => c.type === 'created' && c.objectId && c.objectType)

  const treasuries = created.filter((c) => {
    const coin = treasuryCapCoinType(c.objectType)
    return coin !== null && typePackage(coin) === packageId
  })
  if (treasuries.length !== 1) {
    throw new Error(`expected exactly one TreasuryCap for a coin of ${packageId}, found ${treasuries.length}`)
  }
  const treasury = treasuries[0]
  const coinType = treasuryCapCoinType(treasury.objectType)!

  const ofCoin = (module: string, name: string) =>
    created.find((c) => frameworkTypeArgument(c.objectType, module, name) === coinType)
  const currency = ofCoin('coin_registry', 'Currency')
  const metadataCap = ofCoin('coin_registry', 'MetadataCap')
  const upgradeCap = created.find((c) => isFrameworkType(c.objectType, 'package', 'UpgradeCap'))

  const result: PublishResult = {
    network: ctx.network,
    packageId,
    coinType,
    treasuryCapId: treasury.objectId,
    metadataCapId: metadataCap?.objectId,
    currencyId: currency?.objectId,
    currencyVersion: currency?.version,
    currencyDigest: currency?.digest,
    upgradeCapId: upgradeCap?.objectId,
    digest: ctx.digest,
    feeRecipient: ctx.feeRecipient,
    feeMist: ctx.feeMist.toString(),
  }
  const currencyRef =
    currency?.objectId && currency.version && currency.digest
      ? { objectId: currency.objectId, version: currency.version, digest: currency.digest }
      : undefined
  return { result, currencyRef }
}
