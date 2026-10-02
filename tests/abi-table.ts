// Every transaction builder, built for each policy branch with placeholder ids, and the framework
// Move calls it produces. Shared by the offline completeness test and the live ABI-drift check
// (tests/integration/abi-drift).
import type { Transaction } from '@mysten/sui/transactions'
import * as client from '../src/index.js'
import type { TokenConfig } from '../src/types.js'

const sender = '0x' + '1'.repeat(64)
const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const coinType = `${id(9)}::mytoken::MYTOKEN`
const config: TokenConfig = {
  packageName: 'my_token', moduleName: 'mytoken', structName: 'MYTOKEN', symbol: 'MTK', name: 'My Token',
  description: '', iconUrl: '', decimals: 9, initialSupply: 1n, supplyPolicy: 'fixed', metadataPolicy: 'frozen',
  packagePolicy: 'immutable', recipient: sender, license: 'MIT', packageDescription: '', projectName: '',
}
const publish = (packagePolicy: TokenConfig['packagePolicy']) =>
  client.buildPublishTransaction({
    moduleBytes: new Uint8Array([0xa1, 0x1c, 0xeb, 0x0b]), sender, feeMist: 1n, feeRecipient: id(2), gasBudget: 1n, packagePolicy,
  })
const finalize = (over: Partial<TokenConfig>) =>
  client.buildFinalizeTransaction({
    config: { ...config, ...over }, coinType, treasuryCapId: id(3), metadataCapId: id(4),
    currencyRef: { objectId: id(5), version: '1', digest: '11111111111111111111111111111111' }, sender, gasBudget: 1n,
  })

/** Builder name → transactions covering every Move call it can make. */
export const BUILDERS: Record<string, () => Transaction[]> = {
  buildPublishTransaction: () => [publish('immutable'), publish('upgradeable')],
  buildFinalizeTransaction: () => [finalize({}), finalize({ supplyPolicy: 'mintable', metadataPolicy: 'updatable', initialSupply: 0n })],
}

export interface MoveCallShape {
  package: string
  module: string
  function: string
  typeArguments: number
  arguments: number
}

/** The Move calls in `tx`, as target + arity. */
export function moveCalls(tx: Transaction): MoveCallShape[] {
  return tx.getData().commands.flatMap((c) =>
    c.$kind === 'MoveCall'
      ? [{
          package: c.MoveCall.package,
          module: c.MoveCall.module,
          function: c.MoveCall.function,
          typeArguments: c.MoveCall.typeArguments.length,
          arguments: c.MoveCall.arguments.length,
        }]
      : [],
  )
}

/** Every distinct Move call the builders make. */
export function allMoveCalls(): MoveCallShape[] {
  const seen = new Map<string, MoveCallShape>()
  for (const build of Object.values(BUILDERS)) {
    for (const tx of build()) {
      for (const call of moveCalls(tx)) seen.set(`${call.package}::${call.module}::${call.function}`, call)
    }
  }
  return [...seen.values()]
}

/** Exported builder names (`build…Transaction`). */
export const exportedBuilders = Object.keys(client).filter((k) => /^build\w*(Tx|Transaction)$/.test(k)).sort()
