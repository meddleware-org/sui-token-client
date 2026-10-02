// @meddleware/sui-token-client/deploy — patch → publish → confirm → finalize → result, decoupled
// from any wallet through an `Executor`.

import type { Transaction } from '@mysten/sui/transactions'
import { extractPublishResult, type SuiTxResult } from './results.js'
import { deriveStructName } from './rules.js'
import { patchTokenModule } from './template/patch.js'
import { buildFinalizeTransaction, buildPublishTransaction } from './transactions.js'
import type { PublishResult, TokenConfig, TokenNetwork } from './types.js'

/** Signs and runs transactions for {@link deployToken} (a wallet adapter, or a keypair in tests). */
export interface Executor {
  /** Sign and execute; the result must carry the object changes and the effects status. */
  signAndExecute(tx: Transaction): Promise<SuiTxResult>
  /** Resolve once `digest` is indexed, so the objects it created can be read. */
  waitForTransaction(digest: string): Promise<void>
}

export type DeployStep = 'patching' | 'publishing' | 'confirming' | 'finalizing' | 'confirming-finalize' | 'done'

export interface DeployArgs {
  config: TokenConfig
  network: TokenNetwork
  sender: string
  feeMist: bigint
  feeTreasury: string
  gasBudget: bigint
  executor: Executor
  onStep?: (step: DeployStep) => void
}

/** Only an explicit `success` status counts; a missing status is a failure, never a success. */
function assertSuccess(res: SuiTxResult, what: string): void {
  const status = res.effects?.status?.status
  if (status !== 'success') {
    throw new Error(`${what} failed: ${res.effects?.status?.error ?? status ?? 'no effects status returned'}`)
  }
}

/**
 * Deploy a token end to end: patch the template, publish it (with the fee and the package policy),
 * then finalize — register the currency, mint, apply the supply and metadata policies and route the
 * caps. Resolves once the finalize transaction is confirmed.
 *
 * @throws {Error} if the config breaks a token rule, either transaction fails, or the publish
 *   effects do not name exactly one package and one TreasuryCap of its coin.
 */
export async function deployToken(args: DeployArgs): Promise<PublishResult> {
  const { executor, onStep } = args
  const config: TokenConfig = { ...args.config, structName: deriveStructName(args.config.moduleName) }

  onStep?.('patching')
  const moduleBytes = await patchTokenModule(config)

  onStep?.('publishing')
  const pub = await executor.signAndExecute(
    buildPublishTransaction({
      moduleBytes,
      sender: args.sender,
      feeMist: args.feeMist,
      feeRecipient: args.feeTreasury,
      gasBudget: args.gasBudget,
      packagePolicy: config.packagePolicy,
    }),
  )
  assertSuccess(pub, 'Publish')
  onStep?.('confirming')
  await executor.waitForTransaction(pub.digest)

  const { result, currencyRef } = extractPublishResult(pub.objectChanges ?? [], {
    network: args.network,
    digest: pub.digest,
    feeRecipient: args.feeTreasury,
    feeMist: args.feeMist,
  })
  if (!result.treasuryCapId || !result.metadataCapId) {
    throw new Error('Published, but the TreasuryCap or MetadataCap is missing from the effects.')
  }

  // Always finalize: `finalize_registration` promotes the pending Currency<T> to a shared object so
  // wallets read the coin's decimals; without it they show raw base units.
  onStep?.('finalizing')
  const fin = await executor.signAndExecute(
    buildFinalizeTransaction({
      config: { ...config, recipient: config.recipient || args.sender },
      coinType: result.coinType,
      treasuryCapId: result.treasuryCapId,
      metadataCapId: result.metadataCapId,
      currencyRef,
      sender: args.sender,
      gasBudget: args.gasBudget,
    }),
  )
  assertSuccess(fin, 'Finalize')
  onStep?.('confirming-finalize')
  await executor.waitForTransaction(fin.digest)

  onStep?.('done')
  return result
}

export { toSuiTxResult, type CoreExecutionResult, type SuiTxResult } from './results.js'
