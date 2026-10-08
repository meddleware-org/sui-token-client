#!/usr/bin/env node
// Real-chain end-to-end check against a local network (`sui start --with-faucet --force-regenesis`,
// gRPC on :9000, faucet on :9123). Uses only the package's public API: deployToken with a keypair
// executor, a refused-finalize recovery through finalizeToken, then listMyTokens and balance checks. Spends nothing real.
//
//   npm run e2e:localnet     (RPC_URL / FAUCET_URL override the defaults)
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const { DeployIncompleteError, deployToken, finalizeToken, toSuiTxResult } = await import('../src/deploy.ts')
const { listMyTokens } = await import('../src/tokens.ts')
const { buildPackageFiles } = await import('../src/package.ts')

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:9000'
const FAUCET_URL = process.env.FAUCET_URL ?? 'http://127.0.0.1:9123'
const client = new SuiGrpcClient({ network: 'localnet', baseUrl: RPC_URL })
const signer = new Ed25519Keypair()
const sender = signer.toSuiAddress()
const fail = (msg) => {
  console.error(`e2e-localnet: FAIL — ${msg}`)
  process.exit(1)
}

// OPS guard: this run publishes a test coin and expects a faucet. Refuse a public network unless asked.
const { chainIdentifier } = await client.core.getChainIdentifier()
const PUBLIC = { '4c78adac': 'testnet', '35834a8a': 'mainnet' }
const short = Buffer.from(Buffer.from((await import('@mysten/sui/utils')).fromBase58(chainIdentifier))).subarray(0, 4).toString('hex')
if (PUBLIC[short] && process.env.E2E_ALLOW_PUBLIC !== '1') {
  fail(`${RPC_URL} serves ${PUBLIC[short]} (${short}); this script is for a local network. Set E2E_ALLOW_PUBLIC=1 to override.`)
}

await requestSuiFromFaucetV2({ host: FAUCET_URL, recipient: sender })
for (let i = 0; ; i++) {
  const { balance } = await client.getBalance({ owner: sender })
  if (BigInt(balance.balance) > 0n) break
  if (i > 30) fail('the faucet never funded the sender')
  await new Promise((r) => setTimeout(r, 1000))
}

const executor = {
  async signAndExecute(transaction) {
    return toSuiTxResult(
      await client.signAndExecuteTransaction({ signer, transaction, include: { effects: true, objectTypes: true } }),
    )
  },
  async waitForTransaction(digest) {
    await client.waitForTransaction({ digest })
  },
}

const config = {
  packageName: 'e2e_token',
  moduleName: 'e2etoken',
  structName: '',
  symbol: 'E2E',
  name: 'E2E Token',
  description: 'sui-token-client localnet check',
  iconUrl: 'https://example.com/e2e.png',
  decimals: 6,
  initialSupply: 1_000n,
  supplyPolicy: 'mintable',
  metadataPolicy: 'updatable',
  packagePolicy: 'immutable',
  recipient: '',
  license: '0BSD',
  packageDescription: 'E2E',
  projectName: 'E2E',
}

const steps = []
const result = await deployToken({
  config,
  network: 'localnet',
  sender,
  feeMist: 1_000_000n,
  feeTreasury: '0x' + '9'.repeat(64),
  gasBudget: 500_000_000n,
  executor,
  onStep: (s) => steps.push(s),
})
console.log(`deployed ${result.coinType} (package ${result.packageId}, ${steps.join(' → ')})`)
if (result.upgradeCapId) fail('an immutable publish returned an UpgradeCap')

const { balance } = await client.getBalance({ owner: sender, coinType: result.coinType })
if (BigInt(balance.balance) !== 1_000n * 10n ** 6n) fail(`expected 1000 tokens at 6 decimals, got ${balance.balance}`)

const tokens = await listMyTokens(client, sender)
if (!tokens.some((t) => t.coinType === result.coinType && t.treasuryCapId === result.treasuryCapId)) {
  fail('listMyTokens does not list the new coin')
}

const files = buildPackageFiles({ config: { ...config, structName: 'E2ETOKEN' }, result })
if (files['Published.toml']) fail('a localnet result must not produce Published.toml')
if (!files['deployments.md'].includes(result.packageId)) fail('deployments.md lacks the package id')

// Recovery: refuse the finalize signature, then finish the published coin with finalizeToken.
let refused = false
const refusingOnce = {
  ...executor,
  async signAndExecute(transaction) {
    if (refused === false && JSON.stringify(transaction.getData()).includes('finalize_registration')) {
      refused = true
      throw new Error('User rejected the request')
    }
    return executor.signAndExecute(transaction)
  },
}
let pending = null
try {
  await deployToken({
    config: { ...config, packageName: 'e2e_retry', moduleName: 'e2eretry', symbol: 'RTY', supplyPolicy: 'fixed' },
    network: 'localnet',
    sender,
    feeMist: 0n,
    feeTreasury: '0x' + '9'.repeat(64),
    gasBudget: 500_000_000n,
    executor: refusingOnce,
  })
  fail('a refused finalize did not raise DeployIncompleteError')
} catch (e) {
  if (!(e instanceof DeployIncompleteError)) throw e
  pending = e.pending
}
const finished = await finalizeToken({ pending, executor })
const retried = await client.getBalance({ owner: sender, coinType: finished.coinType })
if (BigInt(retried.balance.balance) !== 1_000n * 10n ** 6n) fail(`retry minted ${retried.balance.balance}, expected 1000 tokens`)
const cap = await client.getObject({ objectId: finished.treasuryCapId })
if (cap.object?.owner?.$kind !== 'Immutable') fail('fixed supply: the TreasuryCap was not frozen on retry')
console.log(`recovered ${finished.coinType}: finalize refused once, finished with finalizeToken (supply minted, cap frozen)`)

console.log('e2e-localnet: OK — publish, finalize, recovery, balance, listMyTokens and package generation')
