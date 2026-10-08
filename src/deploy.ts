// @meddleware/sui-token-client/deploy — patch → publish → confirm → finalize → result, decoupled
// from any wallet through an `Executor`.

import type { Transaction } from '@mysten/sui/transactions'
import { extractPublishResult, type SuiTxResult } from './results.js'
import { deriveStructName } from './rules.js'
import { patchTokenModule } from './template/patch.js'
import { buildFinalizeTransaction, buildPublishTransaction, type CurrencyRef } from './transactions.js'
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

/** Everything needed to finish a published token with {@link finalizeToken}. */
export interface PendingFinalize {
  /** The validated config (struct name derived, recipient defaulted to the sender). */
  config: TokenConfig
  /** The publish result: package, coin type and the caps the finalize step acts on. */
  result: PublishResult
  /** The pending `Currency<T>`'s reference from the publish effects. */
  currencyRef?: CurrencyRef
  sender: string
  gasBudget: bigint
}

/**
 * Something failed after the publish transaction executed: the coin exists on-chain, so the caller
 * must not run a fresh deploy (it would publish a second coin and pay the fee again).
 * `publishDigest` identifies the publish. Subclasses say what remains to do.
 */
export class PublishedError extends Error {
  readonly publishDigest: string

  constructor(message: string, publishDigest: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'PublishedError'
    this.publishDigest = publishDigest
  }
}

/**
 * The coin was published, but the finalize step (currency registration, initial supply, supply and
 * metadata policies, cap routing) did not complete — the second signature was refused or the
 * transaction failed. `pending` lets the caller retry with {@link finalizeToken}; until then the
 * caps stay with the sender and the chosen policies are not applied.
 */
export class DeployIncompleteError extends PublishedError {
  readonly pending: PendingFinalize

  constructor(pending: PendingFinalize, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`Published ${pending.result.coinType}, but finishing its setup failed: ${reason}`, pending.result.digest, cause)
    this.name = 'DeployIncompleteError'
    this.pending = pending
  }
}

/**
 * The finalize transaction executed successfully but could not be confirmed (e.g. indexing timed
 * out). The coin is fully set up; do **not** retry — `result` is the deploy's outcome.
 */
export class DeployUnconfirmedError extends PublishedError {
  readonly result: PublishResult
  readonly digest: string

  constructor(result: PublishResult, digest: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`Finalized ${result.coinType} (transaction ${digest}), but confirmation failed: ${reason}`, result.digest, cause)
    this.name = 'DeployUnconfirmedError'
    this.result = result
    this.digest = digest
  }
}

/** The one read {@link finalizeToken} makes to learn whether an earlier attempt already ran. */
export interface FinalizeCheckClient {
  core: {
    getObject(options: { objectId: string; include?: { json?: boolean } }): Promise<{ object: { json?: unknown } }>
  }
}

/** True if the TreasuryCap's total supply already covers the initial mint: an earlier finalize ran. */
async function alreadyMinted(client: FinalizeCheckClient, pending: PendingFinalize): Promise<boolean> {
  const { config, result } = pending
  if (config.initialSupply <= 0n || !result.treasuryCapId) return false
  const { object } = await client.core.getObject({ objectId: result.treasuryCapId, include: { json: true } })
  const supply = (object.json as { total_supply?: { value?: unknown } } | null | undefined)?.total_supply?.value
  const total = typeof supply === 'string' && /^\d{1,20}$/.test(supply) ? BigInt(supply) : null
  return total !== null && total >= config.initialSupply * 10n ** BigInt(config.decimals)
}

/**
 * Run (or retry) the finalize step of a published token: register the currency, mint the initial
 * supply, apply the supply and metadata policies and route the caps. Resolves once confirmed.
 *
 * A retry can follow an attempt that executed on-chain but whose executor then threw. Whether blindly
 * repeating it is safe depends on the config (a stale `currencyRef` aborts it atomically; a frozen or
 * moved TreasuryCap blocks the mint), except when `currencyRef` is absent, the supply is mintable and
 * the recipient is the sender: then the retry is valid and would mint the initial supply AGAIN. Pass
 * `client` to check the TreasuryCap's supply first (the retry is skipped if the mint already ran);
 * that case refuses to run without one.
 *
 * @throws {Error} if the finalize transaction fails or returns no success status (retryable), or the
 *   retry cannot be made safe without a `client`.
 * @throws {DeployUnconfirmedError} if it executed but could not be confirmed (do not retry).
 */
export async function finalizeToken(args: {
  pending: PendingFinalize
  executor: Executor
  onStep?: (step: DeployStep) => void
  client?: FinalizeCheckClient
}): Promise<PublishResult> {
  const { pending, client } = args
  const unsafeToRepeat =
    pending.config.initialSupply > 0n &&
    pending.config.supplyPolicy !== 'fixed' &&
    !pending.currencyRef &&
    (pending.config.recipient || pending.sender).toLowerCase() === pending.sender.toLowerCase()
  if (client) {
    if (await alreadyMinted(client, pending)) {
      args.onStep?.('done')
      return pending.result
    }
  } else if (unsafeToRepeat) {
    throw new Error(
      'finalizeToken: a retry could mint the initial supply twice (no Currency reference, mintable, recipient is the sender). Pass a client so the supply can be checked first.',
    )
  }
  const digest = await executeFinalize(args)
  return confirmFinalize(args, digest)
}

/** Sign and execute the finalize transaction; resolves with its digest once it succeeded. */
async function executeFinalize(args: {
  pending: PendingFinalize
  executor: Executor
  onStep?: (step: DeployStep) => void
}): Promise<string> {
  const { pending, executor, onStep } = args
  const { result } = pending
  if (!result.treasuryCapId || !result.metadataCapId) {
    throw new Error('Published, but the TreasuryCap or MetadataCap is missing from the effects.')
  }
  onStep?.('finalizing')
  const fin = await executor.signAndExecute(
    buildFinalizeTransaction({
      config: pending.config,
      coinType: result.coinType,
      treasuryCapId: result.treasuryCapId,
      metadataCapId: result.metadataCapId,
      currencyRef: pending.currencyRef,
      sender: pending.sender,
      gasBudget: pending.gasBudget,
    }),
  )
  assertSuccess(fin, 'Finalize')
  return fin.digest
}

/** Wait for an executed finalize. A failure here is not a reason to retry: the setup is on-chain. */
async function confirmFinalize(
  args: { pending: PendingFinalize; executor: Executor; onStep?: (step: DeployStep) => void },
  digest: string,
): Promise<PublishResult> {
  args.onStep?.('confirming-finalize')
  try {
    await args.executor.waitForTransaction(digest)
  } catch (e) {
    throw new DeployUnconfirmedError(args.pending.result, digest, e)
  }
  args.onStep?.('done')
  return args.pending.result
}

/**
 * Deploy a token end to end: patch the template, publish it (with the fee and the package policy),
 * then finalize — register the currency, mint, apply the supply and metadata policies and route the
 * caps. Resolves once the finalize transaction is confirmed.
 *
 * @throws {Error} if the config breaks a token rule, the publish fails, or its effects do not name
 *   exactly one package and one TreasuryCap of its coin.
 * @throws {DeployIncompleteError} if the coin was published but not finished (publish confirmation
 *   or the finalize step failed); finish with {@link finalizeToken} and the error's `pending`.
 * @throws {DeployUnconfirmedError} if everything executed but the finalize was not confirmed; the
 *   coin is set up — do not retry.
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
      recipient: config.recipient || args.sender,
    }),
  )
  assertSuccess(pub, 'Publish')
  // The publish executed: from here on the coin exists, so every failure must say so (and how to
  // finish) rather than invite a second deploy.
  let parsed: ReturnType<typeof extractPublishResult>
  try {
    parsed = extractPublishResult(pub.objectChanges ?? [], {
      network: args.network,
      digest: pub.digest,
      feeRecipient: args.feeTreasury,
      feeMist: args.feeMist,
    })
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new PublishedError(`Published (transaction ${pub.digest}), but its effects could not be read: ${reason}`, pub.digest, e)
  }
  const { result, currencyRef } = parsed
  if (!result.treasuryCapId || !result.metadataCapId) {
    throw new PublishedError(
      `Published (transaction ${pub.digest}), but the TreasuryCap or MetadataCap is missing from the effects.`,
      pub.digest,
    )
  }
  // Always finalize: `finalize_registration` promotes the pending Currency<T> to a shared object so
  // wallets read the coin's decimals; without it they show raw base units.
  const pending: PendingFinalize = {
    config: { ...config, recipient: config.recipient || args.sender },
    result,
    currencyRef,
    sender: args.sender,
    gasBudget: args.gasBudget,
  }
  onStep?.('confirming')
  try {
    await executor.waitForTransaction(pub.digest)
  } catch (e) {
    throw new DeployIncompleteError(pending, e)
  }

  let digest: string
  try {
    digest = await executeFinalize({ pending, executor, onStep })
  } catch (e) {
    throw new DeployIncompleteError(pending, e)
  }
  // Executed: a confirmation failure from here on must not invite a retry.
  return confirmFinalize({ pending, executor, onStep }, digest)
}

export { toSuiTxResult, type CoreExecutionResult, type SuiTxResult } from './results.js'
