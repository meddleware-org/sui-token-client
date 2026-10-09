// PTB builders for deploying a coin.
//
// Two transactions, because the one-time-witness `init` creates the coin's objects and sends them to
// the sender — they are not results of `tx.publish`, so they can only be used after the publish
// executes:
//
//   1. buildPublishTransaction — publish the patched module, take the platform fee, and apply the
//      UpgradeCap policy (make immutable, or send it to the recipient).
//   2. buildFinalizeTransaction — register the currency and move what `init` left with the sender
//      (the initial supply, the TreasuryCap unless the supply is fixed, the MetadataCap unless the
//      metadata is frozen) to the recipient. The supply and metadata policies are applied by `init`
//      itself, in the publish transaction, so they are recorded in the coin registry.

import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import type { TokenConfig } from './types.js'

const SUI_FRAMEWORK = '0x2'
const MOVE_STDLIB = '0x1'

export interface BuildPublishArgs {
  moduleBytes: Uint8Array
  sender: string
  feeMist: bigint
  feeRecipient: string
  gasBudget: bigint
  packagePolicy: TokenConfig['packagePolicy']
  /**
   * Receives the UpgradeCap of an `upgradeable` package (default: the sender). The recipient is who
   * the coin's caps go to, so upgrade authority travels with them rather than staying with the deployer.
   */
  recipient?: string
}

/** Publish PTB: publish → (make_immutable | transfer the UpgradeCap) + the fee split from gas. */
export function buildPublishTransaction(args: BuildPublishArgs): Transaction {
  const tx = new Transaction()
  tx.setSender(args.sender)

  const [upgradeCap] = tx.publish({
    modules: [toBase64(args.moduleBytes)],
    dependencies: [MOVE_STDLIB, SUI_FRAMEWORK],
  })
  if (!upgradeCap) throw new Error('publish returned no UpgradeCap')

  if (args.packagePolicy === 'immutable') {
    tx.moveCall({ target: `${SUI_FRAMEWORK}::package::make_immutable`, arguments: [upgradeCap] })
  } else {
    tx.transferObjects([upgradeCap], args.recipient || args.sender)
  }

  if (args.feeMist > 0n) {
    // A misconfigured consumer must not burn the fee to 0x0 or a truncated address.
    if (!/^0x[0-9a-fA-F]{64}$/.test(args.feeRecipient) || /^0x0+$/.test(args.feeRecipient)) {
      throw new Error('Invalid fee recipient: expected a full, non-zero address (0x followed by 64 hex digits).')
    }
    const [fee] = tx.splitCoins(tx.gas, [args.feeMist])
    if (!fee) throw new Error('splitCoins returned no coin')
    tx.transferObjects([fee], args.feeRecipient)
  }

  tx.setGasBudget(args.gasBudget)
  return tx
}

/** Full reference of the pending `Currency<T>` (owned by the registry address `0xc`). */
export interface CurrencyRef {
  objectId: string
  version: string
  digest: string
}

export interface BuildFinalizeArgs {
  config: TokenConfig
  coinType: string
  /** The TreasuryCap `init` handed to the sender: present exactly when the supply is mintable. */
  treasuryCapId?: string
  /** The MetadataCap `init` handed to the sender: present exactly when the metadata is updatable. */
  metadataCapId?: string
  /** The initial supply `init` minted to the sender: present exactly when the initial supply is above zero. */
  initialCoinId?: string
  /**
   * When given, `finalize_registration` runs first, promoting the pending `Currency<T>` to a shared,
   * discoverable object so wallets read the coin's decimals.
   */
  currencyRef?: CurrencyRef
  sender: string
  gasBudget: bigint
}

/**
 * What a finalize transaction would do: register the currency (when there is a pending reference) and move
 * whatever `init` left with the sender to the recipient. False when there is nothing to do (no reference and
 * the recipient is the sender), in which case there is no transaction to run.
 */
export function finalizeHasWork(args: Pick<BuildFinalizeArgs, 'config' | 'currencyRef' | 'sender'>): boolean {
  const recipient = args.config.recipient || args.sender
  return Boolean(args.currencyRef) || recipient.toLowerCase() !== args.sender.toLowerCase()
}

/**
 * Finalize PTB: register the currency and route what `init` created to the recipient.
 *
 * The supply and metadata policies are NOT applied here. `init` applied them in the publish transaction
 * (a fixed supply was handed to the coin registry; frozen metadata deleted its cap), so there is no cap
 * left to freeze and nothing to mint. This transaction only moves objects, and a repeat of one that already
 * ran fails atomically (the receiving reference is stale and the sender no longer owns the objects).
 */
export function buildFinalizeTransaction(args: BuildFinalizeArgs): Transaction {
  const { config, coinType } = args
  assertObjectsMatchPolicy(args)
  const tx = new Transaction()
  tx.setSender(args.sender)
  const recipient = config.recipient || args.sender

  if (args.currencyRef) {
    tx.moveCall({
      target: `${SUI_FRAMEWORK}::coin_registry::finalize_registration`,
      typeArguments: [coinType],
      arguments: [tx.object('0xc'), tx.receivingRef(args.currencyRef)],
    })
  }

  const held = [args.initialCoinId, args.treasuryCapId, args.metadataCapId].filter((id): id is string => Boolean(id))
  if (recipient.toLowerCase() !== args.sender.toLowerCase() && held.length > 0) {
    tx.transferObjects(held.map((id) => tx.object(id)), recipient)
  }

  tx.setGasBudget(args.gasBudget)
  return tx
}

/** Refuse object ids that cannot exist under the chosen policies (a caller wiring the wrong result). */
function assertObjectsMatchPolicy(args: BuildFinalizeArgs): void {
  const { config } = args
  if (config.supplyPolicy === 'fixed' && args.treasuryCapId) {
    throw new Error('A fixed supply has no TreasuryCap: init handed it to the coin registry.')
  }
  if (config.supplyPolicy === 'mintable' && !args.treasuryCapId) throw new Error('A mintable supply needs its TreasuryCap id.')
  if (config.metadataPolicy === 'frozen' && args.metadataCapId) {
    throw new Error('Frozen metadata has no MetadataCap: init deleted it.')
  }
  if (config.metadataPolicy === 'updatable' && !args.metadataCapId) throw new Error('Updatable metadata needs its MetadataCap id.')
  if (config.initialSupply > 0n && !args.initialCoinId) throw new Error('An initial supply needs the minted Coin id.')
  if (config.initialSupply === 0n && args.initialCoinId) throw new Error('No initial supply was requested, but a Coin id was given.')
}
