// @meddleware/sui-token-client/package — the downloadable source package for a token. Mirrors the
// template's CLI generator (03_create_token.sh), so the zip matches what the CLI produces and the
// on-chain bytecode. Text comes from the pinned template package via scripts/gen-template.mjs.
//
// Published.toml: since Sui 1.63 the CLI records deployed addresses there. The deployer bypasses the
// CLI, so it is written whenever a testnet or mainnet PublishResult is supplied.

import { strToU8, zipSync } from 'fflate'
import { assertTokenConfig } from './rules.js'
import { TEMPLATE_BUILD_INFO } from './template/artifact.js'
import { TEMPLATE_FILES } from './template/files.js'
import type { PublishResult, TokenConfig, TokenNetwork } from './types.js'

/** Escape a string for safe use as a literal RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace every occurrence of a plain-string needle. */
function replaceAll(input: string, needle: string, value: string): string {
  return input.replace(new RegExp(esc(needle), 'g'), () => value)
}

/** Apply the shared X…X documentation placeholders. */
function applyDocPlaceholders(input: string, cfg: TokenConfig): string {
  const map: Record<string, string> = {
    XPACKAGENAMEX: cfg.packageName,
    XMODULENAMEX: cfg.moduleName,
    XSTRUCTNAMEX: cfg.structName,
    XSYMBOLX: cfg.symbol,
    XNAMEX: cfg.name,
    XDESCRIPTIONX: cfg.description,
    XDECIMALSX: String(cfg.decimals),
    XPROJECTNAMEX: cfg.projectName,
    XPACKAGEDESCRIPTIONX: cfg.packageDescription,
  }
  let out = input
  for (const [k, v] of Object.entries(map)) out = replaceAll(out, k, v)
  return out
}

// Chain ids of the public networks (hex short form). Localnet has none worth recording.
const CHAIN_IDS: Partial<Record<TokenNetwork, string>> = {
  testnet: '4c78adac',
  mainnet: '35834a8a',
}

const isProprietary = (license: string) =>
  ['none', 'unlicensed', 'noassertion', ''].includes(license.trim().toLowerCase())

function spdxId(license: string): string {
  return isProprietary(license) ? 'UNLICENSED' : license.trim()
}

/** Move.toml: package name + license field. */
function renderMoveToml(cfg: TokenConfig): string {
  let out = replaceAll(TEMPLATE_FILES['Move.toml'], 'sui_token_template', cfg.packageName)
  out = out.replace(/^license = .*$/m, `license = "${spdxId(cfg.license)}"`)
  return out
}

/** The Move source: identifiers, named constants, and the license header. */
function renderSource(cfg: TokenConfig): string {
  let out = TEMPLATE_FILES['source.move']

  // license header (lines 1-2) — always rewritten, whatever licence the template itself carries
  const lines = out.split('\n')
  if (isProprietary(cfg.license)) {
    lines[0] = '// SPDX-License-Identifier: UNLICENSED'
    lines[1] = '// All rights reserved. Proprietary and not licensed for redistribution.'
  } else {
    lines[0] = `// SPDX-License-Identifier: ${spdxId(cfg.license)}`
    lines[1] = `// Licensed under the ${spdxId(cfg.license)} license; see the LICENSE file.`
  }
  out = lines.join('\n')

  out = replaceAll(
    out,
    'module sui_token_template::sui_token_template;',
    `module ${cfg.packageName}::${cfg.moduleName};`,
  )
  out = replaceAll(out, 'SUI_TOKEN_TEMPLATE', cfg.structName)
  out = replaceAll(out, 'XPACKAGEDESCRIPTIONX', cfg.packageDescription)
  out = replaceAll(out, 'XMODULENAMEX', cfg.moduleName)

  out = replaceAll(out, 'const DECIMALS: u8 = 9;', `const DECIMALS: u8 = ${cfg.decimals};`)
  out = replaceAll(out, 'b"TEMPLATE_SYMBOL"', `b"${cfg.symbol}"`)
  out = replaceAll(out, 'b"TEMPLATE_NAME"', `b"${cfg.name}"`)
  out = replaceAll(out, 'b"TEMPLATE_DESCRIPTION"', `b"${cfg.description}"`)
  out = replaceAll(out, 'b"TEMPLATE_ICON_URL"', `b"${cfg.iconUrl}"`)
  return out
}

function renderPublishScript(cfg: TokenConfig): string {
  let out = replaceAll(TEMPLATE_FILES['scripts/publish.sh'], 'SUI_TOKEN_TEMPLATE', cfg.structName)
  out = replaceAll(out, 'XMODULENAMEX', cfg.moduleName)
  out = replaceAll(out, 'XPACKAGENAMEX', cfg.packageName)
  return out
}

/** The template README's licence line, whatever licence the template itself ships with. */
const TEMPLATE_LICENSE_LINE = /^(?:CC0 1\.0 Universal|BSD Zero Clause License).*$/m

function renderReadme(cfg: TokenConfig): string {
  const out = applyDocPlaceholders(TEMPLATE_FILES['README.md'], cfg)
  const licenseName = cfg.licenseName || spdxId(cfg.license)
  return out.replace(
    TEMPLATE_LICENSE_LINE,
    isProprietary(cfg.license)
      ? 'All rights reserved. This package is proprietary and not licensed for redistribution.'
      : `${licenseName} — see the LICENSE file.`,
  )
}

/**
 * Replace a single table row in a markdown section in-place.
 * Matches: `| <fieldName> | \`FILL_IN_AFTER_DEPLOY\` |`
 */
function fillRow(section: string, fieldName: string, value: string): string {
  return section.replace(
    `| ${fieldName} | \`FILL_IN_AFTER_DEPLOY\` |`,
    `| ${fieldName} | \`${value}\` |`,
  )
}

/**
 * Fill the deployment table rows for the specified network section only.
 * Operates on the substring between the section header and the next `## ` heading.
 */
function fillNetworkSection(doc: string, network: string, result: PublishResult): string {
  const header = `## ${network.charAt(0).toUpperCase() + network.slice(1)}\n`
  const start = doc.indexOf(header)
  if (start === -1) return doc
  const afterHeader = start + header.length
  const nextSection = doc.indexOf('\n## ', afterHeader)
  const end = nextSection === -1 ? doc.length : nextSection

  let section = doc.slice(start, end)

  section = fillRow(section, 'Package ID', result.packageId)
  if (result.treasuryCapId) section = fillRow(section, 'TreasuryCap ID', result.treasuryCapId)
  if (result.metadataCapId) section = fillRow(section, 'MetadataCap ID', result.metadataCapId)
  if (result.currencyId) section = fillRow(section, 'Currency object ID', result.currencyId)

  if (result.upgradeCapId) {
    section = fillRow(section, 'UpgradeCap ID (burned)', result.upgradeCapId)
    section = section.replace(
      '| Immutability confirmed | Yes (Y/N) |',
      '| Immutability confirmed | No (pending) |',
    )
  } else {
    section = fillRow(section, 'UpgradeCap ID (burned)', 'burned')
    section = section.replace(
      '| Immutability confirmed | Yes (Y/N) |',
      '| Immutability confirmed | Yes |',
    )
  }

  const deployed = new Date().toISOString().replace('T', ' ').split('.')[0] + ' UTC'
  section = fillRow(section, 'Deployed', deployed)

  return doc.slice(0, start) + section + doc.slice(end)
}

/** Optionally fill deployments.md with the just-published IDs. */
function renderDeployments(cfg: TokenConfig, result?: PublishResult): string {
  let out = applyDocPlaceholders(TEMPLATE_FILES['deployments.md'], cfg)
  if (!result) return out

  // Fill the network-specific table section with known artefact IDs
  out = fillNetworkSection(out, result.network, result)

  // Fill the <PACKAGE_ID> placeholder in the downstream Move.toml reference block
  out = out.replace(/<PACKAGE_ID>/g, result.packageId)

  // Append extra data not represented in the table (coin type, digest)
  const note = [
    '',
    `<!-- Auto-filled by the Token Deployer on ${new Date().toISOString()} (${result.network}) -->`,
    `<!-- Coin type: ${result.coinType} -->`,
    `<!-- Publish digest: ${result.digest} -->`,
    '',
  ].join('\n')
  return `${out.trimEnd()}\n${note}`
}

/**
 * Generate a Published.toml for the deployed package.
 * Since v1.63, the Sui CLI writes Published.toml (not Move.lock) to record deployed
 * addresses per environment. The deployer bypasses the CLI, so we produce this file
 * so the downloaded package is immediately usable as a Move dependency reference.
 * Commit Published.toml to source control; add Pub.*.toml (ephemeral) to .gitignore.
 */
function renderPublishedToml(result: PublishResult): string | null {
  const chainId = CHAIN_IDS[result.network]
  if (!chainId) return null // localnet: an ephemeral chain, nothing durable to record
  const lines = [
    `[published.${result.network}]`,
    `chain-id = "${chainId}"`,
    `original-id = "${result.packageId}"`,
    `published-at = "${result.packageId}"`,
    `version = 1`,
    `toolchain-version = "${TEMPLATE_BUILD_INFO.toolchainVersion}"`,
    `build-config = { flavor = "sui", edition = "2024" }`,
  ]
  if (result.upgradeCapId) {
    lines.push(`upgrade-capability = "${result.upgradeCapId}"`)
  } else {
    lines.push(
      `# upgrade-capability burned via 0x2::package::make_immutable — package is immutable`,
    )
  }
  return lines.join('\n') + '\n'
}

export interface GeneratePackageOptions {
  config: TokenConfig
  /** Full license text; when omitted for a real license, no LICENSE file is written. */
  licenseText?: string
  /** Publish result, to pre-fill deployments.md. */
  result?: PublishResult
}

/** Build the in-memory file map for the generated package. */
export function buildPackageFiles(opts: GeneratePackageOptions): Record<string, string> {
  const { config, licenseText } = opts
  assertTokenConfig(config)
  const out: Record<string, string> = {
    'Move.toml': renderMoveToml(config),
    [`sources/${config.moduleName}.move`]: renderSource(config),
    'scripts/publish.sh': renderPublishScript(config),
    '.gitignore': TEMPLATE_FILES['.gitignore'],
    'README.md': renderReadme(config),
    'deployments.md': renderDeployments(config, opts.result),
    'CLAUDE.md': applyDocPlaceholders(TEMPLATE_FILES['CLAUDE.md'], config),
    'AGENTS.md': applyDocPlaceholders(TEMPLATE_FILES['AGENTS.md'], config),
  }
  // Published.toml records the deployed address per environment (Sui ≥ 1.63 convention).
  const published = opts.result ? renderPublishedToml(opts.result) : null
  if (published) out['Published.toml'] = published
  if (!isProprietary(config.license) && licenseText) {
    out['LICENSE'] = licenseText
  }
  return out
}

/** Zip the generated package. Returns bytes suitable for a download Blob. */
export function generatePackageZip(opts: GeneratePackageOptions): Uint8Array {
  const filesMap = buildPackageFiles(opts)
  const zipInput: Record<string, Uint8Array> = {}
  const root = opts.config.packageName
  for (const [path, content] of Object.entries(filesMap)) {
    zipInput[`${root}/${path}`] = strToU8(content)
  }
  return zipSync(zipInput, { level: 6 })
}
