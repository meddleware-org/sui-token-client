import { describe, it, expect } from 'vitest'
import init, { deserialize } from '@mysten/move-bytecode-template'
import { patchTemplateModule } from '../src/template/patch.js'

const asStr = (data: number[]) => Buffer.from(data.slice(1)).toString('utf8')
interface Decoded { constant_pool: { type_: unknown; data: number[] }[] }

describe('Walrus blob URL patching', () => {
  it('patches a 99-char Walrus blob URL correctly', async () => {
    await (init as unknown as () => Promise<unknown>)()
    const BLOB_URL = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/OVB5WTWEqkOktRXHIXTBybPAERD0wfORn8NQ1a2lbFQ'
    const bytes = await patchTemplateModule({
      moduleName: 'mycoin', structName: 'MYCOIN',
      symbol: 'MYC', name: 'My Coin', description: 'A test',
      iconUrl: BLOB_URL, decimals: 9,
    })
    // Valid magic bytes
    expect(Buffer.from(bytes.slice(0, 4)).toString('hex')).toBe('a11ceb0b')
    // Round-trips through deserialize
    const back = deserialize(bytes) as unknown as Decoded
    // Icon URL constant present
    const iconEntry = back.constant_pool.find(c => c.type_ !== 'U8' && asStr(c.data).startsWith('https://aggregator'))
    expect(iconEntry).toBeTruthy()
    expect(asStr(iconEntry!.data)).toBe(BLOB_URL)
  })
})
