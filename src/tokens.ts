// Discover the coins a wallet controls: the deploy sends the TreasuryCap to the sender, so every
// owned `0x2::coin::TreasuryCap<T>` names one coin. Read-only.

import { treasuryCapCoinType, typePackage } from './typeNames.js'
import type { DeployedToken, OwnedObjectsClient } from './types.js'

/** Pages read before {@link listMyTokens} gives up (50 objects per page by default). */
export const DEFAULT_MAX_TOKEN_PAGES = 20

/**
 * List the coins `owner` controls, newest listing order, one entry per coin type.
 *
 * @throws {Error} if the owner holds more TreasuryCaps than `maxPages` pages can list.
 */
export async function listMyTokens(
  client: OwnedObjectsClient,
  owner: string,
  opts: { maxPages?: number } = {},
): Promise<DeployedToken[]> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_TOKEN_PAGES
  const seen = new Set<string>()
  const out: DeployedToken[] = []
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    // A type filter without type arguments matches every TreasuryCap<T> instantiation.
    const res: Awaited<ReturnType<OwnedObjectsClient['core']['listOwnedObjects']>> = await client.core.listOwnedObjects({
      owner,
      type: '0x2::coin::TreasuryCap',
      cursor,
    })
    for (const obj of res.objects ?? []) {
      const coinType = treasuryCapCoinType(obj.type)
      if (!coinType || seen.has(coinType)) continue
      seen.add(coinType)
      out.push({
        coinType,
        packageId: typePackage(coinType)!,
        treasuryCapId: obj.objectId,
        label: coinType.split('::').pop() ?? coinType,
      })
    }
    if (!res.hasNextPage || !res.cursor) return out
    cursor = res.cursor
  }
  throw new Error(`more than ${maxPages} pages of TreasuryCaps owned by ${owner}`)
}
