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
}

interface DecodedConstant {
  type_: unknown
  data: number[]
}

interface DecodedModule {
  identifiers: string[]
  constant_pool: DecodedConstant[]
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
  json.identifiers = json.identifiers.map((id) => rename[id] ?? id)

  // 2) Overwrite the five constant-pool defaults.
  if (!isValidDecimals(params.decimals)) {
    throw new Error(`decimals must be a whole number ${TOKEN_LIMITS.decimals.min}..${TOKEN_LIMITS.decimals.max}, got ${params.decimals}`)
  }
  const u8 = json.constant_pool.find(
    (c) => c.type_ === 'U8' && sameBytes(c.data, [TEMPLATE_DEFAULTS.decimals]),
  )
  if (!u8) throw new Error(`template U8 constant ${TEMPLATE_DEFAULTS.decimals} not found (artefact drift?)`)
  u8.data = [params.decimals]

  for (const key of ['symbol', 'name', 'description', 'iconUrl'] as const) {
    const next = params[key]
    if (!SAFE_TEXT.test(next)) throw new Error(`${key} contains quotes, backslashes or control characters`)
    if (next.length > TEXT_LIMITS[key]) throw new Error(`${key} exceeds ${TEXT_LIMITS[key]} characters`)
    const current = vecU8(TEMPLATE_DEFAULTS[key])
    const entry = json.constant_pool.find((c) => c.type_ !== 'U8' && sameBytes(c.data, current))
    if (!entry) throw new Error(`template constant "${TEMPLATE_DEFAULTS[key]}" not found (artefact drift?)`)
    entry.data = vecU8(next)
  }

  return new Uint8Array(serialize(json as unknown as Parameters<typeof serialize>[0]))
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
  })
}
