// PTB builders for deploying a coin.
//
// Two transactions, because the one-time-witness `init` creates the TreasuryCap and MetadataCap and
// sends them to the sender — they are not results of `tx.publish`, so they can only be used after the
// publish executes:
//
//   1. buildPublishTransaction — publish the patched module, take the platform fee, and apply the
//      UpgradeCap policy (make immutable, or keep).
//   2. buildFinalizeTransaction — register the currency, mint the initial supply, apply the supply
//      and metadata policies, and move the caps and supply to the recipient.

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
}

/** Publish PTB: publish → (make_immutable | transfer the UpgradeCap) + the fee split from gas. */
export function buildPublishTransaction(args: BuildPublishArgs): Transaction {
  const tx = new Transaction()
  tx.setSender(args.sender)

  const [upgradeCap] = tx.publish({
    modules: [toBase64(args.moduleBytes)],
    dependencies: [MOVE_STDLIB, SUI_FRAMEWORK],
  })

  if (args.packagePolicy === 'immutable') {
    tx.moveCall({ target: `${SUI_FRAMEWORK}::package::make_immutable`, arguments: [upgradeCap] })
  } else {
    tx.transferObjects([upgradeCap], args.sender)
  }

  if (args.feeMist > 0n) {
    const [fee] = tx.splitCoins(tx.gas, [args.feeMist])
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
  treasuryCapId: string
  metadataCapId: string
  /**
   * When given, `finalize_registration` runs first, promoting the pending `Currency<T>` to a shared,
   * discoverable object so wallets read the coin's decimals.
   */
  currencyRef?: CurrencyRef
  sender: string
  gasBudget: bigint
}

/** Finalize PTB: register the currency, mint the initial supply, apply policies, route the caps. */
export function buildFinalizeTransaction(args: BuildFinalizeArgs): Transaction {
  const { config, coinType } = args
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

  if (config.initialSupply > 0n) {
    const amount = config.initialSupply * 10n ** BigInt(config.decimals)
    const minted = tx.moveCall({
      target: `${SUI_FRAMEWORK}::coin::mint`,
      typeArguments: [coinType],
      arguments: [tx.object(args.treasuryCapId), tx.pure.u64(amount)],
    })
    tx.transferObjects([minted], recipient)
  }

  // fixed → freeze the TreasuryCap (no further minting); mintable → keep it with the recipient.
  if (config.supplyPolicy === 'fixed') {
    tx.moveCall({
      target: `${SUI_FRAMEWORK}::transfer::public_freeze_object`,
      typeArguments: [`${SUI_FRAMEWORK}::coin::TreasuryCap<${coinType}>`],
      arguments: [tx.object(args.treasuryCapId)],
    })
  } else if (recipient.toLowerCase() !== args.sender.toLowerCase()) {
    tx.transferObjects([tx.object(args.treasuryCapId)], recipient)
  }

  // frozen → freeze the MetadataCap (no further metadata edits); updatable → keep it.
  if (config.metadataPolicy === 'frozen') {
    tx.moveCall({
      target: `${SUI_FRAMEWORK}::transfer::public_freeze_object`,
      typeArguments: [`${SUI_FRAMEWORK}::coin_registry::MetadataCap<${coinType}>`],
      arguments: [tx.object(args.metadataCapId)],
    })
  } else if (recipient.toLowerCase() !== args.sender.toLowerCase()) {
    tx.transferObjects([tx.object(args.metadataCapId)], recipient)
  }

  tx.setGasBudget(args.gasBudget)
  return tx
}
