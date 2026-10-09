import { describe, it, expect } from 'vitest'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { BUILDERS, allMoveCalls, exportedBuilders } from './abi-table.js'

describe('ABI table (feeds the live drift check)', () => {
  it('covers every exported transaction builder', () => {
    expect(Object.keys(BUILDERS).sort()).toEqual(exportedBuilders)
  })

  it('lists every framework call the builders can make', () => {
    const calls = allMoveCalls()
    for (const c of calls) expect(c.package).toBe(normalizeSuiAddress('0x2'))
    expect(calls.map((c) => `${c.module}::${c.function}`).sort()).toEqual([
      'coin_registry::finalize_registration',
      'package::make_immutable',
    ])
  })
})
