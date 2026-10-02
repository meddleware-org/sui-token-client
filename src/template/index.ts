// @meddleware/sui-token-client/template — the compiled template module and its patcher. Kept
// apart from the main entry so the wasm and the bytecode load only where a deploy happens.

export {
  configureTemplateWasm,
  initTemplateWasm,
  patchTemplateModule,
  patchTokenModule,
  type PatchParams,
  type TemplateWasmSource,
} from './patch.js'
export { TEMPLATE_BUILD_INFO, TEMPLATE_DEFAULTS, TEMPLATE_IDENTIFIERS, TEMPLATE_MODULE_B64 } from './artifact.js'
