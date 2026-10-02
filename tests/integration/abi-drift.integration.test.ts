// ABI drift: every framework call the builders make must still exist on each public network with
// the same visibility, type-parameter count and parameter count (a trailing TxContext is injected
// by the runtime and not counted), and each network's chain id must match the one written into a
// generated Published.toml.
//
//   npm run test:integration   (sets GRPC_TESTNET; reads public testnet and mainnet full nodes)
import { describe, it, expect } from 'vitest'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { buildPackageFiles } from '../../src/package.js'
import type { TokenConfig } from '../../src/types.js'
import { allMoveCalls } from '../abi-table.js'

const RUN = !!process.env.GRPC_TESTNET
const NETWORKS = {
  testnet: process.env.GRPC_TESTNET_URL || 'https://fullnode.testnet.sui.io:443',
  mainnet: process.env.GRPC_MAINNET_URL || 'https://fullnode.mainnet.sui.io:443',
} as const

const TX_CONTEXT = normalizeStructTag('0x2::tx_context::TxContext')
const isTxContext = (p: { body: { $kind: string; datatype?: { typeName: string } } }) =>
  p.body.$kind === 'datatype' && !!p.body.datatype && normalizeStructTag(p.body.datatype.typeName) === TX_CONTEXT

const config = {
  packageName: 'my_token', moduleName: 'mytoken', structName: 'MYTOKEN', symbol: 'MTK', name: 'My Token',
  description: '', iconUrl: '', decimals: 9, initialSupply: 0n, supplyPolicy: 'mintable', metadataPolicy: 'updatable',
  packagePolicy: 'immutable', recipient: '0x' + '1'.repeat(64), license: 'MIT', packageDescription: '', projectName: '',
} satisfies TokenConfig

/** The chain id this package writes into Published.toml for `network`. */
function recordedChainId(network: keyof typeof NETWORKS): string | undefined {
  const pub = buildPackageFiles({
    config,
    result: { network, packageId: '0x1', coinType: '0x1::mytoken::MYTOKEN', digest: 'D', feeRecipient: '0x1', feeMist: '0' },
  })['Published.toml']
  return pub?.match(/chain-id = "([0-9a-f]+)"/)?.[1]
}

for (const [network, baseUrl] of Object.entries(NETWORKS) as [keyof typeof NETWORKS, string][]) {
  describe.skipIf(!RUN)(`ABI drift (${network} full node)`, () => {
    const client = new SuiGrpcClient({ network, baseUrl })

    it('Published.toml records the live chain id', async () => {
      const { chainIdentifier } = await client.core.getChainIdentifier()
      expect(recordedChainId(network)).toBe(toHex(fromBase58(chainIdentifier).slice(0, 4)))
    })

    for (const call of allMoveCalls()) {
      it(`${call.module}::${call.function} matches the on-chain signature`, async () => {
        const { function: fn } = await client.core.getMoveFunction({
          packageId: call.package,
          moduleName: call.module,
          name: call.function,
        })
        expect(fn.visibility === 'public' || fn.isEntry).toBe(true)
        expect(fn.typeParameters.length).toBe(call.typeArguments)
        const params = fn.parameters.filter((p, i) => !(i === fn.parameters.length - 1 && isTxContext(p)))
        expect(params.length).toBe(call.arguments)
      })
    }
  })
}
