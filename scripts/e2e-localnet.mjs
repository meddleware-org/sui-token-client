#!/usr/bin/env node
// Real-chain end-to-end check against a local network (`sui start --with-faucet --force-regenesis`,
// gRPC on :9000, faucet on :9123). Uses only the package's public API: deployToken with a keypair
// executor, a refused-finalize recovery through finalizeToken, then listMyTokens and balance checks. Spends nothing real.
//
//   npm run e2e:localnet     (RPC_URL / FAUCET_URL override the defaults)
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { deriveObjectID } from '@mysten/sui/utils'

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
if (!tokens.some((t) => t.coinType === result.coinType && t.treasuryCapId === result.treasuryCapId && t.metadataCapId === result.metadataCapId)) {
  fail('listMyTokens does not list the new coin')
}

// The registry's Currency records the policies `init` applied. Mintable/updatable: neither is recorded.
// `finalize_registration` replaces the pending Currency with a shared one at a derived address under the registry (0xc).
const registryState = async (coinType) => {
  const objectId = deriveObjectID('0xc', `0x2::coin_registry::CurrencyKey<${coinType}>`, new Uint8Array([0]))
  return JSON.stringify((await client.core.getObject({ objectId, include: { json: true } })).object.json)
}
const mintableState = await registryState(result.coinType)
if (/Fixed/.test(mintableState) || /Deleted/.test(mintableState)) fail(`a mintable, updatable coin is recorded as fixed/deleted: ${mintableState}`)
if (!result.metadataCapId || !result.treasuryCapId) fail('a mintable, updatable coin must keep both caps')

const files = buildPackageFiles({ config: { ...config, structName: 'E2ETOKEN' }, result })
if (files['Published.toml']) fail('a localnet result must not produce Published.toml')
if (!files['deployments.md'].includes(result.packageId)) fail('deployments.md lacks the package id')

// Fixed supply + frozen metadata: init applies both in the publish transaction, so no cap ever exists and
// the registry records them (wallets and explorers read these).
const fixedConfig = { ...config, packageName: 'e2e_fixed', moduleName: 'e2efixed', symbol: 'FIX', supplyPolicy: 'fixed', metadataPolicy: 'frozen' }
const fixed = await deployToken({
  config: fixedConfig,
  network: 'localnet',
  sender,
  feeMist: 0n,
  feeTreasury: '0x' + '9'.repeat(64),
  gasBudget: 500_000_000n,
  executor,
})
if (fixed.treasuryCapId || fixed.metadataCapId) fail('a fixed supply with frozen metadata must have no TreasuryCap or MetadataCap')
const fixedBalance = await client.getBalance({ owner: sender, coinType: fixed.coinType })
if (BigInt(fixedBalance.balance.balance) !== 1_000n * 10n ** 6n) fail(`fixed supply: expected 1000 tokens, got ${fixedBalance.balance.balance}`)
const fixedState = await registryState(fixed.coinType)
if (!/Fixed/.test(fixedState)) fail(`the registry does not record the fixed supply: ${fixedState}`)
if (!/Deleted/.test(fixedState)) fail(`the registry does not record the deleted MetadataCap: ${fixedState}`)
const owned = await client.core.listOwnedObjects({ owner: sender })
if (owned.objects.some((o) => /TreasuryCap|MetadataCap/.test(o.type) && o.type.includes(fixed.packageId.slice(2)))) {
  fail('the sender owns a cap of the fixed, frozen coin')
}
console.log(`fixed ${fixed.coinType}: no caps exist; the registry records Fixed supply and Deleted metadata cap`)
// listMyTokens finds it although it has no capability: the wallet holds it and published its package.
const listed = await listMyTokens(client, sender)
const fixedListed = listed.find((t) => t.coinType === fixed.coinType)
if (!fixedListed) fail('listMyTokens does not list the fixed, frozen coin')
if (fixedListed.treasuryCapId || fixedListed.metadataCapId) fail('the fixed, frozen coin is listed with a capability')
if (listed.some((t) => t.coinType.includes('::none::'))) fail('listMyTokens listed an unrelated coin')

// Equal constants: a symbol that equals the name, and an empty description and icon, would leave duplicate
// entries in the constant pool, which the bytecode verifier rejects at publish. The patcher merges them.
const same = await deployToken({
  config: { ...config, packageName: 'e2e_same', moduleName: 'e2esame', symbol: 'SAME', name: 'SAME', description: '', iconUrl: '', initialSupply: 0n },
  network: 'localnet',
  sender,
  feeMist: 0n,
  feeTreasury: '0x' + '9'.repeat(64),
  gasBudget: 500_000_000n,
  executor,
})
console.log(`equal constants published and verified: ${same.coinType}`)

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
if (BigInt(retried.balance.balance) !== 1_000n * 10n ** 6n) fail(`retry left ${retried.balance.balance}, expected 1000 tokens`)
if (finished.treasuryCapId) fail('fixed supply: a TreasuryCap exists after the retry')
if (!/Fixed/.test(await registryState(finished.coinType))) fail('fixed supply: the registry does not record it after the retry')
console.log(`recovered ${finished.coinType}: finalize refused once, finished with finalizeToken (supply minted at publish, fixed in the registry)`)

console.log('e2e-localnet: OK — publish, finalize, fixed/frozen registry state, recovery, balance, listMyTokens and package generation')
