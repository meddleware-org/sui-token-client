// Shared types for deploying a coin from @meddleware/sui-token-template.

/** A Sui network a token can be deployed to. */
export type TokenNetwork = 'testnet' | 'mainnet' | 'localnet'

/** Whether the deployer keeps the ability to mint more supply after launch. */
export type SupplyPolicy = 'fixed' | 'mintable'

/** Whether description/icon stay updatable (MetadataCap retained) or are frozen. */
export type MetadataPolicy = 'updatable' | 'frozen'

/** Whether the package code can be upgraded, or is made immutable at publish. */
export type PackagePolicy = 'immutable' | 'upgradeable'

/**
 * Every choice behind a token. `packageName`, `moduleName` and `structName` are baked into the coin
 * type and are permanent; `symbol`, `name` and `decimals` are permanent on-chain.
 */
export interface TokenConfig {
  /** Move package name, e.g. "my_token" (snake_case identifier). */
  packageName: string
  /** Move module name, e.g. "mytoken" (snake_case identifier). */
  moduleName: string
  /** One-time-witness struct name: always the module name uppercased (see `deriveStructName`). */
  structName: string

  symbol: string
  name: string
  description: string
  /** Icon URL (`https://` or `ipfs://`), or '' for none. */
  iconUrl: string
  /** 0..18; conventionally 9 on Sui. */
  decimals: number

  /** Whole-token initial supply minted to the recipient (before decimals scaling); 0 for none. */
  initialSupply: bigint
  supplyPolicy: SupplyPolicy
  metadataPolicy: MetadataPolicy
  packagePolicy: PackagePolicy

  /** Address that receives the caps and initial supply; '' means the sender. */
  recipient: string

  /** SPDX id (e.g. "0BSD", "MIT") or "NONE" for proprietary. Affects the generated package only. */
  license: string
  /** Human-readable licence name for the generated README (defaults to the SPDX id). */
  licenseName?: string
  /** Free text used only in generated docs. */
  packageDescription: string
  projectName: string
}

/** A successful on-chain publish. */
export interface PublishResult {
  network: TokenNetwork
  packageId: string
  /** Full coin type `<packageId>::<module>::<STRUCT>` (normalised). */
  coinType: string
  /** Absent for a fixed supply: the registry took the cap in `init`. */
  treasuryCapId?: string
  /** Absent for frozen metadata: `init` deleted the cap. */
  metadataCapId?: string
  /** The initial supply, one `Coin<T>` owned by the publisher until finalize moves it; absent for a zero supply. */
  initialCoinId?: string
  currencyId?: string
  /** Version and digest of the pending `Currency<T>` — needed for `finalize_registration`. */
  currencyVersion?: string
  currencyDigest?: string
  upgradeCapId?: string
  digest: string
  /** Where the platform fee was sent, and how much (MIST). */
  feeRecipient: string
  feeMist: string
}

/** One coin a wallet controls (holds the `TreasuryCap<T>` for). */
export interface DeployedToken {
  /** Full coin type, e.g. `0x<pkg>::mytoken::MYTOKEN` (normalised). */
  coinType: string
  /** The package the coin type is defined in. */
  packageId: string
  /** Object id of the owned `TreasuryCap<T>`. */
  treasuryCapId: string
  /** The one-time-witness struct name — a compact display label. */
  label: string
}

/** The owned-object listing a core Sui client exposes (e.g. `SuiGrpcClient`). */
export interface OwnedObjectsClient {
  core: {
    listOwnedObjects(options: {
      owner: string
      type?: string
      cursor?: string | null
      limit?: number
    }): Promise<{ objects: { objectId: string; type: string }[]; hasNextPage: boolean; cursor: string | null }>
  }
}
