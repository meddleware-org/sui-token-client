// Discover the coins a wallet deployed or still controls. Read-only.
//
// `init` sends the capabilities that exist to the publisher, so an owned `0x2::coin::TreasuryCap<T>` or
// `0x2::coin_registry::MetadataCap<T>` names a coin the wallet can mint or edit. A fixed supply with
// frozen metadata has neither (the registry holds the supply and the metadata cap was deleted), so those
// coins are found the other way round: the wallet holds a balance of a coin whose package it published.

import { normalizeSuiAddress } from '@mysten/sui/utils'
import { frameworkTypeArgument, typePackage } from './typeNames.js'
import type { DeployedToken, OwnedObjectsClient } from './types.js'

/** Pages read per listing before {@link listMyTokens} gives up (50 entries per page by default). */
export const DEFAULT_MAX_TOKEN_PAGES = 20

/** Distinct held coin types whose publisher {@link listMyTokens} will look up before giving up. */
export const DEFAULT_MAX_HELD_COIN_TYPES = 200

/** Packages at or below this address are system packages (std, sui, sui_system, …), never a user's coin. */
const SYSTEM_PACKAGE_LIMIT = 0xffn

/** Held coin types read concurrently when looking up publishers. */
const LOOKUP_CONCURRENCY = 5

const isSystemPackage = (pkg: string) => BigInt(pkg) <= SYSTEM_PACKAGE_LIMIT

async function ownedCaps(
  client: OwnedObjectsClient,
  owner: string,
  type: string,
  coinOf: (objectType: string) => string | null,
  maxPages: number,
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    // A type filter without type arguments matches every instantiation.
    const res: Awaited<ReturnType<OwnedObjectsClient['core']['listOwnedObjects']>> = await client.core.listOwnedObjects({
      owner,
      type,
      cursor,
    })
    for (const obj of res.objects ?? []) {
      const coinType = coinOf(obj.type)
      if (coinType && !found.has(coinType)) found.set(coinType, obj.objectId)
    }
    if (!res.hasNextPage || !res.cursor) return found
    cursor = res.cursor
  }
  throw new Error(`more than ${maxPages} pages of ${type} owned by ${owner}`)
}

async function heldCoinTypes(client: OwnedObjectsClient, owner: string, maxPages: number): Promise<string[]> {
  const types: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const res: Awaited<ReturnType<OwnedObjectsClient['core']['listBalances']>> = await client.core.listBalances({ owner, cursor })
    for (const b of res.balances ?? []) types.push(b.coinType)
    if (!res.hasNextPage || !res.cursor) return types
    cursor = res.cursor
  }
  throw new Error(`more than ${maxPages} pages of balances held by ${owner}`)
}

/** True if `owner` sent the transaction that published `packageId`. */
async function publishedBy(client: OwnedObjectsClient, packageId: string, owner: string): Promise<boolean> {
  const { object } = await client.core.getObject({ objectId: packageId, include: { previousTransaction: true } })
  if (!object.previousTransaction) return false
  const res = await client.core.getTransaction({ digest: object.previousTransaction, include: { transaction: true } })
  const sender = (res.Transaction ?? res.FailedTransaction)?.transaction?.sender
  return typeof sender === 'string' && normalizeSuiAddress(sender) === normalizeSuiAddress(owner)
}

/**
 * List the coins `owner` deployed or controls, one entry per coin type: those whose `TreasuryCap` or
 * `MetadataCap` the wallet owns, then those the wallet holds a balance of in a package it published (this
 * is what lists a fixed supply with frozen metadata, which has no capability).
 *
 * @throws {Error} if a listing is longer than `maxPages` pages, the wallet holds more than `maxHeldCoinTypes`
 *   unrelated coin types to check, or a read fails.
 */
export async function listMyTokens(
  client: OwnedObjectsClient,
  owner: string,
  opts: { maxPages?: number; maxHeldCoinTypes?: number } = {},
): Promise<DeployedToken[]> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_TOKEN_PAGES
  const maxHeld = opts.maxHeldCoinTypes ?? DEFAULT_MAX_HELD_COIN_TYPES
  const treasuries = await ownedCaps(client, owner, '0x2::coin::TreasuryCap', (t) => frameworkTypeArgument(t, 'coin', 'TreasuryCap'), maxPages)
  const metadataCaps = await ownedCaps(
    client,
    owner,
    '0x2::coin_registry::MetadataCap',
    (t) => frameworkTypeArgument(t, 'coin_registry', 'MetadataCap'),
    maxPages,
  )

  // Every coin type reaching `entry` came from a parsed cap type or a parsed held type, so `typePackage` is set;
  // the cap ids are read behind a `has` check on the same map.
  const entry = (coinType: string): DeployedToken => ({
    coinType,
    packageId: typePackage(coinType)!, // parsed above: a coin type with no package never gets here
    ...(treasuries.has(coinType) ? { treasuryCapId: treasuries.get(coinType)! } : {}), // `has` just checked
    ...(metadataCaps.has(coinType) ? { metadataCapId: metadataCaps.get(coinType)! } : {}), // `has` just checked
    label: coinType.split('::').pop() ?? coinType,
  })
  const out = [...new Set([...treasuries.keys(), ...metadataCaps.keys()])].map(entry)

  // Capability-less coins: held, and published by this wallet.
  const known = new Set(out.map((t) => t.coinType))
  const candidates = new Map<string, string[]>() // package id → coin types held from it
  for (const raw of await heldCoinTypes(client, owner, maxPages)) {
    const pkg = typePackage(raw)
    if (!pkg || isSystemPackage(pkg)) continue
    const coinType = raw.replace(/^0x[0-9a-fA-F]+/, pkg)
    if (known.has(coinType)) continue
    candidates.set(pkg, [...(candidates.get(pkg) ?? []), coinType])
  }
  if (candidates.size > maxHeld) {
    throw new Error(`${owner} holds coins from ${candidates.size} packages (limit ${maxHeld}); cannot tell which it published`)
  }
  const packages = [...candidates.keys()]
  const mine = new Set<string>()
  for (let i = 0; i < packages.length; i += LOOKUP_CONCURRENCY) {
    const chunk = packages.slice(i, i + LOOKUP_CONCURRENCY)
    const flags = await Promise.all(chunk.map((pkg) => publishedBy(client, pkg, owner)))
    chunk.forEach((pkg, j) => flags[j] && mine.add(pkg))
  }
  for (const [pkg, types] of candidates) {
    if (!mine.has(pkg)) continue
    for (const coinType of new Set(types)) out.push(entry(coinType))
  }
  return out
}
