// Exact, normalised type matching. Object types are compared as parsed struct tags — never by
// substring — so a look-alike package (`0xbad::coin::TreasuryCap<…>`) or a nested generic never
// matches a framework type.

import { normalizeStructTag, normalizeSuiAddress, parseStructTag } from '@mysten/sui/utils'

const FRAMEWORK = normalizeSuiAddress('0x2')

type StructTag = ReturnType<typeof parseStructTag>

function parse(type: unknown): StructTag | null {
  if (typeof type !== 'string') return null
  try {
    return parseStructTag(type)
  } catch {
    return null
  }
}

/** `type` normalised, or null if it is not a valid struct tag. */
export function normalizeType(type: unknown): string | null {
  const tag = parse(type)
  return tag ? normalizeStructTag(tag) : null
}

/** True if `type` is exactly the framework (`0x2`) struct `module::name` with no type arguments. */
export function isFrameworkType(type: unknown, module: string, name: string): boolean {
  const tag = parse(type)
  return (
    tag !== null &&
    normalizeSuiAddress(tag.address) === FRAMEWORK &&
    tag.module === module &&
    tag.name === name &&
    tag.typeParams.length === 0
  )
}

/**
 * If `type` is exactly `0x2::<module>::<name><T>` with one struct type argument, the normalised `T`;
 * otherwise null.
 */
export function frameworkTypeArgument(type: unknown, module: string, name: string): string | null {
  const tag = parse(type)
  if (
    !tag ||
    normalizeSuiAddress(tag.address) !== FRAMEWORK ||
    tag.module !== module ||
    tag.name !== name ||
    tag.typeParams.length !== 1
  ) {
    return null
  }
  const [arg] = tag.typeParams
  return arg === undefined || typeof arg === 'string' ? null : normalizeStructTag(arg)
}

/** The normalised package address a struct type is defined in, or null. */
export function typePackage(type: unknown): string | null {
  const tag = parse(type)
  return tag ? normalizeSuiAddress(tag.address) : null
}

/** The `TreasuryCap<T>` coin type `T`, or null if `type` is not exactly a framework TreasuryCap. */
export function treasuryCapCoinType(type: unknown): string | null {
  return frameworkTypeArgument(type, 'coin', 'TreasuryCap')
}
