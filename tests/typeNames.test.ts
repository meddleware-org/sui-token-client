import { describe, it, expect } from 'vitest'
import { frameworkTypeArgument, isFrameworkType, normalizeType, treasuryCapCoinType, typePackage } from '../src/typeNames.js'

const PKG = '0x' + 'a1'.repeat(32)
const LONG2 = '0x' + '0'.repeat(63) + '2'

describe('type matching', () => {
  it('matches framework types in short and long form only at 0x2', () => {
    expect(isFrameworkType('0x2::package::UpgradeCap', 'package', 'UpgradeCap')).toBe(true)
    expect(isFrameworkType(`${LONG2}::package::UpgradeCap`, 'package', 'UpgradeCap')).toBe(true)
    expect(isFrameworkType(`0x${'2'.repeat(64)}::package::UpgradeCap`, 'package', 'UpgradeCap')).toBe(false)
    expect(isFrameworkType('0x2::package::UpgradeCapX', 'package', 'UpgradeCap')).toBe(false)
  })

  it('returns the normalised coin type of an exact TreasuryCap', () => {
    expect(treasuryCapCoinType(`0x2::coin::TreasuryCap<${PKG}::m::M>`)).toBe(`${PKG}::m::M`)
    expect(treasuryCapCoinType(`0x2::coin::TreasuryCap<0x${'a1'.repeat(32)}::m::M>`)).toBe(`${PKG}::m::M`)
    expect(treasuryCapCoinType('0x2::coin::TreasuryCap<u64>')).toBeNull()
    expect(treasuryCapCoinType(`0x3::coin::TreasuryCap<${PKG}::m::M>`)).toBeNull()
    expect(treasuryCapCoinType('not a type')).toBeNull()
  })

  it('keeps a nested generic intact as the type argument', () => {
    expect(frameworkTypeArgument(`0x2::coin::TreasuryCap<0x2::balance::Balance<${PKG}::m::M>>`, 'coin', 'TreasuryCap')).toBe(
      `${LONG2}::balance::Balance<${PKG}::m::M>`,
    )
  })

  it('reads the package of a type and normalises types', () => {
    expect(typePackage(`${PKG}::m::M`)).toBe(PKG)
    expect(normalizeType('0x2::sui::SUI')).toBe(`${LONG2}::sui::SUI`)
    expect(normalizeType(42)).toBeNull()
  })
})
