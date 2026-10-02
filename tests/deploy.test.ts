import { describe, it, expect, vi } from 'vitest'
import { deployToken, toSuiTxResult } from '../src/deploy.js'
import type { CoreExecutionResult, Executor, SuiTxResult } from '../src/deploy.js'
import { extractPublishResult } from '../src/index.js'
import type { TokenConfig } from '../src/types.js'

const sender = '0x' + '1'.repeat(64)
const treasury = '0x' + '2'.repeat(64)

function baseConfig(over: Partial<TokenConfig> = {}): TokenConfig {
  return {
    packageName: 'my_token', moduleName: 'mytoken', structName: 'IGNORED',
    symbol: 'MTK', name: 'My Token', description: 'desc', iconUrl: '', decimals: 9,
    initialSupply: 0n, supplyPolicy: 'mintable', metadataPolicy: 'updatable', packagePolicy: 'immutable',
    recipient: sender, license: 'MIT', packageDescription: '', projectName: '',
    ...over,
  }
}

const PKG = '0x' + 'a1'.repeat(32)
const COIN = `${PKG}::mytoken::MYTOKEN`

const publishChanges = (coinType: string): SuiTxResult['objectChanges'] => [
  { type: 'published', packageId: PKG },
  { type: 'created', objectType: `0x2::coin::TreasuryCap<${coinType}>`, objectId: '0xT' },
  { type: 'created', objectType: `0x2::coin_registry::MetadataCap<${coinType}>`, objectId: '0xM' },
  // version + digest are present in real Sui RPC responses and required for finalize_registration
  { type: 'created', objectType: `0x2::coin_registry::Currency<${coinType}>`, objectId: '0xC', version: '1', digest: 'CURRENCYDIGEST' },
]

type SignAndExecute = Executor['signAndExecute']

function mockExecutor(overrides: Partial<Executor> = {}): Executor {
  return {
    signAndExecute: vi.fn<SignAndExecute>(async () => ({
      digest: '0xDIGEST',
      objectChanges: publishChanges(COIN),
      effects: { status: { status: 'success' } },
    })),
    waitForTransaction: vi.fn<Executor['waitForTransaction']>(async () => {}),
    ...overrides,
  }
}

describe('deployToken', () => {
  it('always runs a finalize tx (for coin_registry::finalize_registration); struct name is derived', async () => {
    const exec = mockExecutor()
    const steps: string[] = []
    const result = await deployToken({
      config: baseConfig(), network: 'testnet', sender, feeMist: 500_000_000n, feeTreasury: treasury,
      gasBudget: 500_000_000n, executor: exec, onStep: (s) => steps.push(s),
    })
    expect(result.coinType).toBe(COIN)
    expect(result.packageId).toBe(PKG)
    expect(result.treasuryCapId).toBe('0xT')
    // publish + finalize (finalize_registration is always required)
    expect((exec.signAndExecute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
    expect(steps).toEqual(['patching', 'publishing', 'confirming', 'finalizing', 'confirming-finalize', 'done'])
  })

  it('runs a finalize tx for initial supply as well', async () => {
    const exec = mockExecutor()
    const steps: string[] = []
    await deployToken({
      config: baseConfig({ initialSupply: 1000n }), network: 'testnet', sender,
      feeMist: 0n, feeTreasury: treasury, gasBudget: 500_000_000n, executor: exec,
      onStep: (s) => steps.push(s),
    })
    expect((exec.signAndExecute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
    expect(steps).toContain('finalizing')
  })

  it('refuses an invalid config before patching or signing', async () => {
    const exec = mockExecutor()
    await expect(
      deployToken({
        config: baseConfig({ symbol: 'BAD"' }), network: 'testnet', sender, feeMist: 0n, feeTreasury: treasury,
        gasBudget: 1n, executor: exec,
      }),
    ).rejects.toThrow(/Invalid symbol/)
    expect(exec.signAndExecute).not.toHaveBeenCalled()
  })

  it('passes the currency reference to finalize_registration', async () => {
    const exec = mockExecutor()
    await deployToken({
      config: baseConfig(), network: 'testnet', sender, feeMist: 0n, feeTreasury: treasury,
      gasBudget: 500_000_000n, executor: exec,
    })
    const finalize = (exec.signAndExecute as ReturnType<typeof vi.fn>).mock.calls[1][0]
    expect(JSON.stringify(finalize.getData())).toContain('finalize_registration')
  })

  it('throws with the effects error when publish fails', async () => {
    const exec = mockExecutor({
      signAndExecute: vi.fn<SignAndExecute>(async () => ({
        digest: '0xD', objectChanges: [], effects: { status: { status: 'failure', error: 'InsufficientGas' } },
      })),
    })
    await expect(
      deployToken({
        config: baseConfig(), network: 'testnet', sender, feeMist: 0n, feeTreasury: treasury,
        gasBudget: 1n, executor: exec,
      }),
    ).rejects.toThrow(/InsufficientGas/)
  })

  it('treats a result without an effects status as a failure (never as success)', async () => {
    const exec = mockExecutor({
      signAndExecute: vi.fn<SignAndExecute>(async () => ({ digest: '0xD', objectChanges: [] })),
    })
    await expect(
      deployToken({
        config: baseConfig(), network: 'testnet', sender, feeMist: 0n, feeTreasury: treasury,
        gasBudget: 1n, executor: exec,
      }),
    ).rejects.toThrow(/no effects status returned/)
  })
})

describe('toSuiTxResult (gRPC core execution → SuiTxResult)', () => {
  const coinType = COIN
  const written = (objectId: string, idOperation: 'Created' | 'None', version: string) => ({
    objectId,
    inputState: 'Unknown',
    inputVersion: null,
    inputDigest: null,
    inputOwner: null,
    outputState: 'ObjectWrite',
    outputVersion: version,
    outputDigest: `D${version}`,
    outputOwner: null,
    idOperation,
  })
  const tx = (success: boolean) => ({
    digest: 'TXDIGEST',
    status: success ? { success: true, error: null } : { success: false, error: { message: 'MoveAbort(7)' } },
    effects: {
      changedObjects: [
        { ...written(PKG, 'Created', '1'), outputState: 'PackageWrite' },
        written('0xT', 'Created', '5'),
        written('0xC', 'Created', '5'),
        written('0xGAS', 'None', '5'),
      ],
    },
    objectTypes: {
      // gRPC may render framework addresses in long form.
      '0xT': `0x${'0'.repeat(63)}2::coin::TreasuryCap<${coinType}>`,
      '0xC': `0x2::coin_registry::Currency<${coinType}>`,
      '0xGAS': '0x2::coin::Coin<0x2::sui::SUI>',
    },
  })

  it('maps package writes, created and mutated objects', () => {
    const res = toSuiTxResult({ $kind: 'Transaction', Transaction: tx(true) } as unknown as CoreExecutionResult)
    expect(res.digest).toBe('TXDIGEST')
    expect(res.effects?.status?.status).toBe('success')
    expect(res.objectChanges).toEqual([
      { type: 'published', packageId: PKG },
      { type: 'created', objectId: '0xT', objectType: expect.stringContaining('::coin::TreasuryCap<'), version: '5', digest: 'D5' },
      { type: 'created', objectId: '0xC', objectType: `0x2::coin_registry::Currency<${coinType}>`, version: '5', digest: 'D5' },
      { type: 'mutated', objectId: '0xGAS', objectType: '0x2::coin::Coin<0x2::sui::SUI>', version: '5', digest: 'D5' },
    ])
  })

  it('feeds extractPublishResult (package id, coin type, currency ref)', () => {
    const res = toSuiTxResult({ $kind: 'Transaction', Transaction: tx(true) } as unknown as CoreExecutionResult)
    const out = extractPublishResult(res.objectChanges ?? [], {
      network: 'testnet', digest: res.digest, feeRecipient: treasury, feeMist: 0n,
    })
    expect(out.currencyRef).toEqual({ objectId: '0xC', version: '5', digest: 'D5' })
    expect(out.result).toMatchObject({
      packageId: PKG,
      coinType,
      treasuryCapId: '0xT',
      currencyId: '0xC',
      currencyVersion: '5',
      currencyDigest: 'D5',
    })
  })

  it('reports a failed transaction as a failure status (not a throw)', () => {
    const res = toSuiTxResult({ $kind: 'FailedTransaction', FailedTransaction: tx(false) } as unknown as CoreExecutionResult)
    expect(res.effects?.status).toEqual({ status: 'failure', error: 'MoveAbort(7)' })
  })
})
