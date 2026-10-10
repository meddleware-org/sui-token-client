#!/usr/bin/env node
// Generate src/template/artifact.ts (the compiled template module + its build info) and
// src/template/files.ts (the text files the package generator renders) from the pinned
// @meddleware/sui-token-template devDependency. One generator, one source of truth.
//
// It checks itself before writing: the bytecode and source hashes match the package's
// build-info.json, the module decodes and re-encodes byte for byte, and the identifiers and the
// default constants the patcher replaces are present in both the source and the constant pool.
// `--check` fails (exit 1) when the committed files differ from what the package produces.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deserialize, serialize } from '@mysten/move-bytecode-template'
import { bcs } from '@mysten/sui/bcs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const pkgDir = dirname(require.resolve('@meddleware/sui-token-template/package.json'))
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const read = (p) => readFileSync(join(pkgDir, p))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const fail = (msg) => {
  console.error(`gen-template: ${msg}`)
  process.exit(1)
}

const IDENTIFIERS = { module: 'sui_token_template', struct: 'SUI_TOKEN_TEMPLATE' }
const DEFAULTS = {
  decimals: 9,
  symbol: 'TEMPLATE_SYMBOL',
  name: 'TEMPLATE_NAME',
  description: 'TEMPLATE_DESCRIPTION',
  iconUrl: 'TEMPLATE_ICON_URL',
  // Supply and metadata policy (raw units / booleans). The booleans differ on purpose, like every default.
  initialSupply: 1000000007,
  fixedSupply: true,
  frozenMetadata: false,
}

const mv = read('bytecode/sui_token_template.mv')
const info = JSON.parse(read('bytecode/build-info.json').toString('utf8'))
const source = read('sources/sui_token_template.move').toString('utf8')

if (sha(mv) !== info.moduleSha256) fail('bytecode hash differs from build-info.json moduleSha256')
if (sha(source) !== info.sourceSha256) fail('source hash differs from build-info.json sourceSha256')
if (mv.subarray(0, 4).toString('hex') !== 'a11ceb0b') fail('bytecode is not publishable Move bytecode')

// Source carries the identifiers and the defaults the patcher replaces.
for (const needle of [
  `module ${IDENTIFIERS.module}::${IDENTIFIERS.module};`,
  IDENTIFIERS.struct,
  `const DECIMALS: u8 = ${DEFAULTS.decimals};`,
  ...['symbol', 'name', 'description', 'iconUrl'].map((k) => `b"${DEFAULTS[k]}"`),
  'const INITIAL_SUPPLY: u64 = 1_000_000_007;',
  `const FIXED_SUPPLY: bool = ${DEFAULTS.fixedSupply};`,
  `const FROZEN_METADATA: bool = ${DEFAULTS.frozenMetadata};`,
]) {
  if (!source.includes(needle)) fail(`source is missing ${needle}`)
}

// The module decodes, re-encodes byte for byte, and its constant pool holds each default once.
const decoded = deserialize(mv)
if (!Buffer.from(serialize(decoded)).equals(mv)) fail('decode/encode round trip changed the bytecode')
for (const id of Object.values(IDENTIFIERS)) {
  if (!decoded.identifiers.includes(id)) fail(`identifier ${id} not in the module`)
}
// rules.ts lists the identifiers the module uses besides its own; module names must avoid them.
const rulesSrc = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8')
const listed = /TEMPLATE_IMPORTED_IDENTIFIERS[^[]*\[([^\]]*)\]/.exec(rulesSrc)
const listedIds = listed ? [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort() : []
const actualIds = decoded.identifiers.filter((id) => !Object.values(IDENTIFIERS).includes(id)).sort()
if (JSON.stringify(listedIds) !== JSON.stringify(actualIds)) {
  fail(`TEMPLATE_IMPORTED_IDENTIFIERS in src/rules.ts must be exactly: ${actualIds.join(', ')}`)
}
const pool = decoded.constant_pool
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
if (pool.filter((c) => c.type_ === 'U8' && same(c.data, [DEFAULTS.decimals])).length !== 1) {
  fail(`U8 constant ${DEFAULTS.decimals} is not in the constant pool exactly once`)
}
const u64le = (n) => Array.from({ length: 8 }, (_, i) => Number((BigInt(n) >> BigInt(8 * i)) & 0xffn))
if (pool.filter((c) => c.type_ === 'U64' && same(c.data, u64le(DEFAULTS.initialSupply))).length !== 1) {
  fail(`U64 constant ${DEFAULTS.initialSupply} is not in the constant pool exactly once`)
}
for (const [label, value] of [['FIXED_SUPPLY', DEFAULTS.fixedSupply], ['FROZEN_METADATA', DEFAULTS.frozenMetadata]]) {
  if (pool.filter((c) => c.type_ === 'Bool' && same(c.data, [value ? 1 : 0])).length !== 1) {
    fail(`Bool constant ${label} = ${value} is not in the constant pool exactly once`)
  }
}
for (const k of ['symbol', 'name', 'description', 'iconUrl']) {
  const bytes = Array.from(bcs.string().serialize(DEFAULTS[k]).toBytes())
  if (pool.filter((c) => c.type_ !== 'U8' && same(c.data, bytes)).length !== 1) {
    fail(`constant "${DEFAULTS[k]}" is not in the constant pool exactly once`)
  }
}

const header = `// Generated by scripts/gen-template.mjs from @meddleware/sui-token-template@${version} — do not edit.
// Regenerate with \`npm run gen:template\` after bumping that package.
`
const artifact = `${header}
/** The compiled template module (base64), as published by \`sui move build --build-env testnet\`. */
export const TEMPLATE_MODULE_B64 =
  '${mv.toString('base64')}'

/** How the module was built (the template package's \`bytecode/build-info.json\`). */
export const TEMPLATE_BUILD_INFO = Object.freeze({
  templateVersion: '${version}',
  toolchainVersion: '${info.toolchainVersion}',
  buildEnv: '${info.buildEnv}',
  frameworkRev: '${info.frameworkRev}',
  sourceSha256: '${info.sourceSha256}',
  moduleSha256: '${info.moduleSha256}',
} as const)

/** Identifiers compiled into the module (renamed at patch time). */
export const TEMPLATE_IDENTIFIERS = Object.freeze({
  module: '${IDENTIFIERS.module}',
  struct: '${IDENTIFIERS.struct}',
} as const)

/**
 * Constant-pool defaults the patcher replaces. Distinct on purpose: identical Move constants
 * deduplicate into one pool entry that could not be patched independently.
 */
export const TEMPLATE_DEFAULTS = Object.freeze({
  decimals: ${DEFAULTS.decimals},
  symbol: '${DEFAULTS.symbol}',
  name: '${DEFAULTS.name}',
  description: '${DEFAULTS.description}',
  iconUrl: '${DEFAULTS.iconUrl}',
  initialSupply: ${DEFAULTS.initialSupply},
  fixedSupply: ${DEFAULTS.fixedSupply},
  frozenMetadata: ${DEFAULTS.frozenMetadata},
} as const)
`

const FILES = {
  'Move.toml': 'Move.toml',
  'Move.lock': 'Move.lock',
  'source.move': 'sources/sui_token_template.move',
  'scripts/publish.sh': 'templates/publish.sh',
  '.gitignore': 'templates/gitignore',
  'README.md': 'templates/README.md',
  'deployments.md': 'templates/deployments.md',
  'CLAUDE.md': 'templates/CLAUDE.md',
  'AGENTS.md': 'templates/AGENTS.md',
}
const entries = Object.entries(FILES).map(
  ([key, path]) => `  ${JSON.stringify(key)}: ${JSON.stringify(read(path).toString('utf8'))},`,
)
const files = `${header}
/** A template text file, by its path in a generated package (\`source.move\` = the module). */
export type TemplateFile = ${Object.keys(FILES).map((k) => JSON.stringify(k).replace(/"/g, "'")).join(' | ')}

/** The template's text files. */
export const TEMPLATE_FILES: Readonly<Record<TemplateFile, string>> = Object.freeze({
${entries.join('\n')}
})
`

const outputs = [
  [join(root, 'src/template/artifact.ts'), artifact],
  [join(root, 'src/template/files.ts'), files],
]
if (process.argv.includes('--check')) {
  const stale = outputs.filter(([path, text]) => {
    try {
      return readFileSync(path, 'utf8') !== text
    } catch {
      return true
    }
  })
  if (stale.length) fail(`${stale.map(([p]) => p.slice(root.length + 1)).join(', ')} differ from @meddleware/sui-token-template@${version} — run npm run gen:template`)
  console.log(`src/template matches @meddleware/sui-token-template@${version}.`)
} else {
  for (const [path, text] of outputs) writeFileSync(path, text)
  console.log(`Wrote src/template/artifact.ts and files.ts from @meddleware/sui-token-template@${version}.`)
}
