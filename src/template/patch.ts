// Client-side patching of the compiled template module.
//
// @mysten/move-bytecode-template's `update_identifiers` / `update_constants` helpers cannot
// round-trip the current binary format (v7), but `deserialize` / `serialize` do, losslessly. So the
// decoded module is patched directly: identifiers renamed in place and constant-pool entries
// overwritten. Verified end to end by scripts/e2e-localnet.mjs.

import init, { deserialize, serialize } from '@mysten/move-bytecode-template'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { assertTokenConfig, isValidDecimals, SAFE_TEXT, TOKEN_LIMITS } from '../rules.js'
import type { TokenConfig } from '../types.js'
import { TEMPLATE_DEFAULTS, TEMPLATE_IDENTIFIERS, TEMPLATE_MODULE_B64 } from './artifact.js'

/** What `@mysten/move-bytecode-template`'s browser build can load its wasm from. */
export type TemplateWasmSource = string | URL | Response | BufferSource | WebAssembly.Module

let wasmSource: TemplateWasmSource | undefined
let initPromise: Promise<void> | null = null

/**
 * Tell the browser build where its wasm is (e.g. a bundler asset URL). Call once at start-up, before
 * the first patch; loading is deferred until then. Unneeded under Node, whose build loads its own wasm.
 */
export function configureTemplateWasm(source?: TemplateWasmSource): void {
  wasmSource = source
  initPromise = null
}

/**
 * Initialise the bytecode wasm once. A failure is rethrown (and the next call retries), so a
 * misconfigured asset surfaces here instead of as an obscure error mid-patch.
 */
export function initTemplateWasm(): Promise<void> {
  if (!initPromise) {
    const load = init as unknown as (options?: { module_or_path?: TemplateWasmSource }) => unknown
    initPromise = Promise.resolve()
      .then(() => load(wasmSource === undefined ? undefined : { module_or_path: wasmSource }))
      .then(() => undefined)
      .catch((err: unknown) => {
        initPromise = null
        throw err
      })
  }
  return initPromise
}

/** The values patched into the module. */
export interface PatchParams {
  moduleName: string
  structName: string
  symbol: string
  name: string
  description: string
  iconUrl: string
  decimals: number
  /** Raw units (whole tokens x 10^decimals) `init` mints to the publisher. Default 0: none. */
  initialSupply?: bigint
  /** `true`: `init` hands the TreasuryCap to the coin registry (needs `initialSupply > 0`). Default false. */
  fixedSupply?: boolean
  /** `true`: `init` deletes the MetadataCap. Default false. */
  frozenMetadata?: boolean
}

interface DecodedConstant {
  type_: unknown
  data: number[]
}

interface DecodedModule {
  identifiers: string[]
  constant_pool: DecodedConstant[]
  function_defs: { code?: { code?: unknown[] } | null }[]
}

const MAX_U64 = (1n << 64n) - 1n

/** BCS bytes of a `u64` constant (little-endian). */
function u64Bytes(value: bigint): number[] {
  return Array.from({ length: 8 }, (_, i) => Number((value >> BigInt(8 * i)) & 0xffn))
}

/**
 * Merge constant-pool entries with the same type and value, and point every `LdConst` at the merged
 * entry. The Move compiler never emits duplicates, and the bytecode verifier REJECTS a module whose pool
 * has any (`DUPLICATE_ELEMENT`, at publish, after gas is spent). Patching can create them: two
 * constants that were distinct in the template become equal when the caller picks the same value (a symbol
 * and a name that match, two empty strings, `FIXED_SUPPLY` and `FROZEN_METADATA` both false).
 */
function dedupeConstantPool(json: DecodedModule): void {
  const seen = new Map<string, number>()
  const pool: DecodedConstant[] = []
  const remap: number[] = []
  json.constant_pool.forEach((c, i) => {
    const key = JSON.stringify([c.type_, c.data])
    let at = seen.get(key)
    if (at === undefined) {
      at = pool.length
      pool.push(c)
      seen.set(key, at)
    }
    remap[i] = at
  })
  if (pool.length === json.constant_pool.length) return
  json.constant_pool = pool
  for (const def of json.function_defs) {
    for (const ins of def.code?.code ?? []) {
      if (ins !== null && typeof ins === 'object' && 'LdConst' in ins) {
        const op = ins as { LdConst: number }
        const to = remap[op.LdConst]
        if (to === undefined) throw new Error('constant index out of range (artefact drift?)')
        op.LdConst = to
      }
    }
  }
}

/** BCS bytes of a `vector<u8>` / `String` constant (uleb length + utf8). */
function vecU8(value: string): number[] {
  return Array.from(bcs.string().serialize(value).toBytes())
}

function sameBytes(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

const TEXT_LIMITS: Record<'symbol' | 'name' | 'description' | 'iconUrl', number> = {
  symbol: TOKEN_LIMITS.symbol,
  name: TOKEN_LIMITS.name,
  description: TOKEN_LIMITS.description,
  iconUrl: TOKEN_LIMITS.iconUrl,
}

/**
 * Patch the template with `params` and return publishable module bytes. A fresh copy of the shipped
 * module is decoded on every call.
 *
 * @throws {Error} if a value breaks the token rules or the artefact lacks an expected default.
 */
export async function patchTemplateModule(params: PatchParams): Promise<Uint8Array> {
  await initTemplateWasm()
  const json = deserialize(fromBase64(TEMPLATE_MODULE_B64)) as unknown as DecodedModule

  // 1) Rename the module and struct identifiers in place (index-preserving, so every handle stays
  //    valid; the verifier does not require sorted identifiers).
  const rename: Record<string, string> = {
    [TEMPLATE_IDENTIFIERS.module]: params.moduleName,
    [TEMPLATE_IDENTIFIERS.struct]: params.structName,
  }
  json.identifiers = json.identifiers.map((id) => (Object.hasOwn(rename, id) ? (rename[id] as string) : id))
  // A duplicate identifier fails bytecode verification on-chain (after gas is spent): refuse it here.
  if (new Set(json.identifiers).size !== json.identifiers.length) {
    throw new Error(`module or struct name collides with an identifier the template already uses`)
  }

  // 2) Overwrite the five constant-pool defaults.
  if (!isValidDecimals(params.decimals)) {
    throw new Error(`decimals must be a whole number ${TOKEN_LIMITS.decimals.min}..${TOKEN_LIMITS.decimals.max}, got ${params.decimals}`)
  }
  const u8 = json.constant_pool.find(
    (c) => c.type_ === 'U8' && sameBytes(c.data, [TEMPLATE_DEFAULTS.decimals]),
  )
  if (!u8) throw new Error(`template U8 constant ${TEMPLATE_DEFAULTS.decimals} not found (artefact drift?)`)
  u8.data = [params.decimals]

  // The supply and metadata policy: one U64 and two Bool entries, each resolved from the pristine pool.
  const initialSupply = params.initialSupply ?? 0n
  const fixedSupply = params.fixedSupply ?? false
  const frozenMetadata = params.frozenMetadata ?? false
  if (initialSupply < 0n || initialSupply > MAX_U64) throw new Error('initial supply must fit a u64')
  if (fixedSupply && initialSupply === 0n) {
    throw new Error('a fixed supply needs an initial supply above zero (the framework refuses to fix an empty one)')
  }
  const supplySlot = json.constant_pool.find((c) => c.type_ === 'U64' && sameBytes(c.data, u64Bytes(BigInt(TEMPLATE_DEFAULTS.initialSupply))))
  const fixedSlot = json.constant_pool.find((c) => c.type_ === 'Bool' && sameBytes(c.data, [TEMPLATE_DEFAULTS.fixedSupply ? 1 : 0]))
  const frozenSlot = json.constant_pool.find((c) => c.type_ === 'Bool' && sameBytes(c.data, [TEMPLATE_DEFAULTS.frozenMetadata ? 1 : 0]))
  if (!supplySlot || !fixedSlot || !frozenSlot || fixedSlot === frozenSlot) {
    throw new Error('template supply or metadata policy constants not found (artefact drift?)')
  }
  supplySlot.data = u64Bytes(initialSupply)
  fixedSlot.data = [fixedSupply ? 1 : 0]
  frozenSlot.data = [frozenMetadata ? 1 : 0]

  // Resolve every target slot from the PRISTINE pool before writing any of them. Looking each field
  // up in turn, after earlier fields were overwritten, lets a value equal to a later template default
  // (say a symbol of "TEMPLATE_NAME") capture the wrong slot.
  const keys = ['symbol', 'name', 'description', 'iconUrl'] as const
  const defaults = new Set<string>(keys.map((k) => TEMPLATE_DEFAULTS[k]))
  const slots = keys.map((key) => {
    const next = params[key]
    if (!SAFE_TEXT.test(next)) throw new Error(`${key} contains quotes, backslashes or control characters`)
    if (next.length > TEXT_LIMITS[key]) throw new Error(`${key} exceeds ${TEXT_LIMITS[key]} characters`)
    // A value that is a template placeholder is never what the user meant, and would make the
    // published constants ambiguous with the template's own.
    if (defaults.has(next) || next.startsWith('TEMPLATE_')) {
      throw new Error(`${key} must not be a template placeholder ("${next}")`)
    }
    const current = vecU8(TEMPLATE_DEFAULTS[key])
    const entry = json.constant_pool.find((c) => c.type_ !== 'U8' && sameBytes(c.data, current))
    if (!entry) throw new Error(`template constant "${TEMPLATE_DEFAULTS[key]}" not found (artefact drift?)`)
    return { key, entry, next }
  })
  if (new Set(slots.map((s) => s.entry)).size !== slots.length) {
    throw new Error('template constants are not distinct (artefact drift?)')
  }
  for (const { entry, next } of slots) entry.data = vecU8(next)
  dedupeConstantPool(json)

  const out = new Uint8Array(serialize(json as unknown as Parameters<typeof serialize>[0]))

  // Post-condition: decode what will be published and confirm every constant and identifier is what
  // the caller asked for, so a patcher bug can never reach the chain (the values are permanent).
  const check = deserialize(out) as unknown as DecodedModule
  const ids = new Set(check.identifiers)
  if (!ids.has(params.moduleName) || !ids.has(params.structName)) throw new Error('patched module lacks the requested identifiers')
  for (const { key, next } of slots) {
    const want = vecU8(next)
    if (!check.constant_pool.some((c) => c.type_ !== 'U8' && sameBytes(c.data, want))) {
      throw new Error(`patched module does not carry the requested ${key}`)
    }
  }
  const dec = check.constant_pool.filter((c) => c.type_ === 'U8' && sameBytes(c.data, [params.decimals]))
  if (dec.length === 0) throw new Error('patched module does not carry the requested decimals')
  const carries = (type: string, data: number[]) => check.constant_pool.some((c) => c.type_ === type && sameBytes(c.data, data))
  if (
    !carries('U64', u64Bytes(initialSupply)) ||
    !carries('Bool', [fixedSupply ? 1 : 0]) ||
    !carries('Bool', [frozenMetadata ? 1 : 0])
  ) {
    throw new Error('patched module does not carry the requested supply and metadata policy')
  }
  return out
}

/** Assert `config` meets every token rule, then patch the module for it. */
export function patchTokenModule(config: TokenConfig): Promise<Uint8Array> {
  assertTokenConfig(config)
  return patchTemplateModule({
    moduleName: config.moduleName,
    structName: config.structName,
    symbol: config.symbol,
    name: config.name,
    description: config.description,
    iconUrl: config.iconUrl,
    decimals: config.decimals,
    initialSupply: config.initialSupply * 10n ** BigInt(config.decimals),
    fixedSupply: config.supplyPolicy === 'fixed',
    frozenMetadata: config.metadataPolicy === 'frozen',
  })
}
