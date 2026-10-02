// @meddleware/sui-token-client — deploy coins from @meddleware/sui-token-template.
//
// Entry points (each loads only what it needs):
//   .           types, Move rules, transaction builders, publish-result parsing, listMyTokens
//   ./template  the compiled template module, wasm set-up and the patcher
//   ./deploy    deployToken (patch → publish → finalize) behind an Executor
//   ./package   the downloadable source package (files and zip)

export type {
  DeployedToken,
  MetadataPolicy,
  OwnedObjectsClient,
  PackagePolicy,
  PublishResult,
  SupplyPolicy,
  TokenConfig,
  TokenNetwork,
} from './types.js'
export {
  assertTokenConfig,
  deriveStructName,
  hasAllowedIconScheme,
  ICON_URL_ALLOWED_SCHEMES,
  isValidDecimals,
  MAX_U64,
  MOVE_IDENT,
  MOVE_RESERVED_WORDS,
  parseSupply,
  SAFE_TEXT,
  TOKEN_LIMITS,
  validateIdentifier,
  validateModuleName,
  validatePackageName,
  TEMPLATE_IMPORTED_IDENTIFIERS,
  FRAMEWORK_ADDRESS_NAMES,
} from './rules.js'
export {
  frameworkTypeArgument,
  isFrameworkType,
  normalizeType,
  treasuryCapCoinType,
  typePackage,
} from './typeNames.js'
export {
  buildFinalizeTransaction,
  buildPublishTransaction,
  type BuildFinalizeArgs,
  type BuildPublishArgs,
  type CurrencyRef,
} from './transactions.js'
export {
  extractPublishResult,
  toSuiTxResult,
  type CoreExecutionResult,
  type ObjectChange,
  type ParsedPublish,
  type SuiTxResult,
} from './results.js'
export { DEFAULT_MAX_TOKEN_PAGES, listMyTokens } from './tokens.js'
