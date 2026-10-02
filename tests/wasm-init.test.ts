import { describe, it, expect, vi, beforeEach } from 'vitest'

// The browser build's `init` is mocked so the loader contract can be checked under Node.
const { initSpy } = vi.hoisted(() => ({ initSpy: vi.fn() }))
vi.mock('@mysten/move-bytecode-template', async (orig) => ({
  ...(await orig<typeof import('@mysten/move-bytecode-template')>()),
  default: initSpy,
}))

beforeEach(() => {
  vi.resetModules()
  initSpy.mockReset()
})

describe('template wasm initialisation', () => {
  it('loads once, passing the configured source as module_or_path', async () => {
    const { configureTemplateWasm, initTemplateWasm } = await import('../src/template/patch.js')
    configureTemplateWasm('https://cdn.example/move_bytecode_template_bg.wasm')
    await initTemplateWasm()
    await initTemplateWasm()
    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(initSpy).toHaveBeenCalledWith({ module_or_path: 'https://cdn.example/move_bytecode_template_bg.wasm' })
  })

  it('rethrows a load failure and retries on the next call', async () => {
    const { initTemplateWasm } = await import('../src/template/patch.js')
    initSpy.mockRejectedValueOnce(new Error('wasm 404')).mockResolvedValueOnce(undefined)
    await expect(initTemplateWasm()).rejects.toThrow('wasm 404')
    await expect(initTemplateWasm()).resolves.toBeUndefined()
    expect(initSpy).toHaveBeenCalledTimes(2)
  })
})
