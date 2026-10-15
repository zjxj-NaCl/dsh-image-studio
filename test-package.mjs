/**
 * Packaging checks: what `npm pack` would publish has to be installable by
 * someone else, and must not carry this machine's paths.
 *
 * These cases guard the parts of "deployable" that are easy to break silently:
 * the `files` allowlist drifting away from the build output, a `dsh` or
 * `exports` target that points at a file nobody ships, a version that appears
 * in three places but only two agree, an author-local absolute path landing in
 * a published document, a repository placeholder shipping to readers, and the
 * reader-facing surface (English README, CI) quietly falling behind the code.
 *
 *   node packages/dsh-image-studio/test-package.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')
const manifest = JSON.parse(read('package.json'))

const cases = []
const test = (name, fn) => { cases.push({ name, fn }) }

/** Expand the manifest allowlist the way npm does for our entries (no nested globs). */
function publishedFiles() {
  const out = new Set()
  // npm always ships the manifest, whatever `files` says.
  out.add('package.json')
  const add = (relativePath) => {
    if (!existsSync(join(root, relativePath))) throw new Error('files entry does not exist: ' + relativePath)
    out.add(relativePath)
  }
  for (const entry of manifest.files) {
    if (entry.includes('*')) {
      const star = entry.indexOf('*')
      const prefix = entry.slice(0, star)
      const suffix = entry.slice(star + 1)
      let matches = 0
      for (const name of readdirSync(root)) {
        if (name.startsWith(prefix) && name.endsWith(suffix) && statSync(join(root, name)).isFile()) {
          out.add(name)
          matches += 1
        }
      }
      if (matches === 0) throw new Error('files pattern matches nothing: ' + entry)
      continue
    }
    if (statSync(join(root, entry)).isDirectory()) {
      const walk = (dir) => {
        for (const name of readdirSync(join(root, dir))) {
          const relativePath = dir + '/' + name
          if (statSync(join(root, relativePath)).isDirectory()) walk(relativePath)
          else out.add(relativePath)
        }
      }
      walk(entry)
      continue
    }
    add(entry)
  }
  return out
}

const published = publishedFiles()

/** Files that build.mjs produces; the tarball is useless without every one of them. */
const BUILD_OUTPUTS = [
  'lib/index.js', 'lib/image-api.js', 'lib/comfy.js', 'lib/tool.js',
  'lib/client.js', 'lib/conversation-host.js', 'lib/bridge.js',
]

/** Sources build.mjs bundles; shipping them lets a downloader rebuild and audit. */
const SOURCES = [
  'src/index.js', 'src/image-api.js', 'src/comfy.js', 'src/tool.js', 'src/client.js',
  'src/studio-model.js', 'src/model-config.js', 'src/conversation-host.js', 'src/bridge.js',
]

const DOCUMENTS = ['README.md', 'README.en.md', 'INSTALL.md', 'CHANGELOG.md', 'LICENSE']

const TEXT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt', '.ps1']

/**
 * Absolute paths that only exist on one machine. The character classes keep
 * these patterns from matching their own source lines below.
 */
const LOCAL_PATH_PATTERNS = [
  /[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/,
  /(^|[^A-Za-z0-9._-])\/Users\/[^/\s]+/,
  /(^|[^A-Za-z0-9._-])\/home\/[^/\s]+/,
]

/**
 * The same scan one layer up: a file that ships to readers must not still ask
 * them to substitute a repository or an account name. Built by concatenation so
 * this list does not match its own source lines.
 */
const PLACEHOLDER_PATTERNS = [
  new RegExp('REPLACE' + '-' + 'ME'),
  new RegExp('<' + 'user' + '>'),
  new RegExp('<' + '本仓库地址' + '>'),
]

test('the manifest describes a publishable package', () => {
  assert.equal(manifest.name, 'dsh-image-studio')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.private, undefined, 'private would make the tarball unpublishable')
  assert.ok(typeof manifest.description === 'string' && manifest.description.length > 20)
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length >= 8)
  assert.ok(manifest.author?.name, 'a published package names its author')
  // The repository fields are what a visitor clicks through from the registry;
  // keep the owner segment free so a fork or an account rename stays valid.
  assert.match(manifest.repository?.url ?? '', /^git\+https:\/\/github\.com\/[^/]+\/dsh-image-studio\.git$/)
  assert.match(manifest.homepage ?? '', /^https:\/\/github\.com\/[^/]+\/dsh-image-studio#readme$/)
  assert.match(manifest.bugs?.url ?? '', /^https:\/\/github\.com\/[^/]+\/dsh-image-studio\/issues$/)
})

test('the runtime floor matches the harness it runs inside', () => {
  // The plugin executes inside the DSH host process, so this floor only governs
  // the dev/test path (build + the test-*.mjs scripts). It must stay at or above
  // the node line DSH itself ships, and must not be tightened past it: an
  // installed plugin never runs under the owner's node.
  assert.equal(manifest.engines?.node, '>=22.19.0')
  assert.ok(manifest.peerDependencies?.['@deepseek-ai/cordis'], 'the cordis peer range is what the installer checks')
  assert.match(manifest.peerDependencies['@deepseek-ai/cordis'], /^>=4/)
  assert.ok(manifest.peerDependencies?.react)
  for (const name of ['@deepseek-ai/cordis', 'react']) {
    assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, name + ' must stay an optional peer')
  }
  assert.equal(manifest.dependencies, undefined, 'no runtime dependencies: the host provides every service')
})

test('every entry point the manifest promises exists', () => {
  assert.ok(published.has(manifest.main), 'main is not published: ' + manifest.main)
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const file = typeof target === 'string' ? target : target.default
    assert.ok(file, 'no default target for ' + subpath)
    assert.ok(existsSync(join(root, file)), 'exports target is missing: ' + file)
    assert.ok(published.has(file.replace(/^\.\//, '')), 'exports target is not published: ' + file)
  }
})

test('the dsh declarations are installable and complete', () => {
  assert.equal(manifest.dsh?.client?.platform, 'web')
  const patch = manifest.dsh?.bundle?.patch
  assert.ok(patch, 'dsh.bundle.patch is what mounts the host half')
  assert.ok(existsSync(join(root, patch)), 'missing bundle patch: ' + patch)
  assert.ok(published.has(patch.replace(/^\.\//, '')), 'the bundle patch is not published: ' + patch)
})

test('the bundle patch mounts exactly this package once', () => {
  const patch = read('cordis.patch.yml')
  const names = [...patch.matchAll(/name:\s*([^\s,}\]]+)/g)].map((match) => match[1])
  assert.deepEqual(names, [manifest.name], 'the insert list must mount this package and nothing else')
  assert.match(patch, new RegExp('- id: [^\\s]+'))
  assert.match(patch, /insert:/)
})

test('the published set carries every build output', () => {
  for (const file of BUILD_OUTPUTS) {
    assert.ok(existsSync(join(root, file)), 'not built: ' + file)
    assert.ok(published.has(file), 'build output is not published: ' + file)
  }
})

test('the published set carries the sources and the build script', () => {
  assert.ok(published.has('build.mjs'), 'without build.mjs the tarball cannot rebuild or self-check')
  for (const file of SOURCES) {
    assert.ok(published.has(file), 'source is not published: ' + file)
  }
})

test('the published set carries the documents', () => {
  for (const file of DOCUMENTS) {
    assert.ok(published.has(file), 'document is not published: ' + file)
  }
})

test('the published set carries the test suite', () => {
  const tests = [...published].filter((file) => /^test-.+\.mjs$/.test(file))
  assert.ok(tests.length >= 9, 'expected the whole suite, found ' + String(tests.length))
  for (const name of readdirSync(root)) {
    if (/^test-.+\.mjs$/.test(name)) assert.ok(published.has(name), 'test not published: ' + name)
  }
})

test('maintenance-only files stay out of the tarball', () => {
  for (const file of [
    'deploy-local.ps1', 'PUBLISH.md', 'CONTRIBUTING.md', 'SECURITY.md',
    'package-lock.json', 'node_modules',
  ]) {
    assert.ok(!published.has(file), 'should not be published: ' + file)
  }
  for (const file of published) {
    assert.ok(!file.startsWith('deployment-backups/'), 'a deployment backup would be published: ' + file)
    assert.ok(!file.startsWith('.github/'), 'CI and templates belong to the repository, not the tarball: ' + file)
    assert.ok(!file.includes('.tmp-'), 'a scratch file would be published: ' + file)
  }
})

test('the changelog and the installer agree with the version', () => {
  const changelog = read('CHANGELOG.md')
  const first = changelog.match(/^##\s*\[?(\d+\.\d+\.\d+)\]?/m)
  assert.ok(first, 'CHANGELOG.md has no released version heading')
  assert.equal(first[1], manifest.version, 'CHANGELOG top version differs from package.json')
  assert.ok(read('INSTALL.md').includes('dsh-image-studio-' + manifest.version + '.tgz'), 'INSTALL.md does not name the current tarball')
})

test('README points a first-time installer at the install document', () => {
  const readme = read('README.md')
  assert.match(readme, /INSTALL\.md/, 'README.md must link INSTALL.md')
  assert.match(readme, /##\s*安装/)
})

test('an English README mirrors the Chinese one', () => {
  assert.ok(published.has('README.en.md'), 'README.en.md is not published: the registry page would show Chinese only')
  const english = read('README.en.md')
  assert.ok(english.length > 1000, 'README.en.md looks truncated')
  assert.match(read('README.md'), /README\.en\.md/, 'the Chinese README must link the English one')
  assert.match(english, /README\.md/, 'the English README must link back to the Chinese one')
  assert.match(
    english,
    new RegExp('dsh-image-studio-' + manifest.version.replace(/\./g, '\\.') + '\\.tgz'),
    'the English README must name the current tarball, not a stale version',
  )
})

test('CI runs the build check and the whole suite', () => {
  const workflowPath = '.github/workflows/test.yml'
  // CI config is maintenance-only and deliberately left out of the tarball, so
  // inside an extracted package there is nothing to read — only the "did not
  // ship" half still applies.
  assert.ok(!published.has(workflowPath), 'CI config must not ship inside the tarball')
  if (!existsSync(join(root, workflowPath))) return
  const workflow = read(workflowPath)
  assert.match(workflow, /actions\/checkout@/)
  assert.match(workflow, /actions\/setup-node@/)
  assert.match(workflow, /node-version:\s*'22'/)
  assert.match(workflow, /node build\.mjs --check/)
  assert.match(workflow, /npm test/)
  // The point of CI here is the artifact a stranger installs, so it must also
  // repack and re-test from the extracted tarball.
  assert.match(workflow, /npm pack/)
})

test('no published file leaks one machine absolute path', () => {
  const offenders = []
  for (const file of published) {
    const extension = file.slice(file.lastIndexOf('.'))
    if (!TEXT_EXTENSIONS.includes(extension)) continue
    const lines = read(file).split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (LOCAL_PATH_PATTERNS.some((pattern) => pattern.test(line))) {
        offenders.push(file + ':' + String(index + 1) + ' -> ' + line.trim().slice(0, 120))
      }
    }
  }
  assert.deepEqual(offenders, [], 'author-local paths found:\n' + offenders.join('\n'))
})

test('no published file still asks the reader to fill in an address', () => {
  const offenders = []
  for (const file of published) {
    const extension = file.slice(file.lastIndexOf('.'))
    if (!TEXT_EXTENSIONS.includes(extension)) continue
    const lines = read(file).split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(line))) {
        offenders.push(file + ':' + String(index + 1) + ' -> ' + line.trim().slice(0, 120))
      }
    }
  }
  assert.deepEqual(offenders, [], 'unreplaced placeholders found:\n' + offenders.join('\n'))
})

test('the licence file is the licence the manifest declares', () => {
  const licence = read('LICENSE')
  assert.match(licence, /MIT License/)
  assert.match(licence, /Permission is hereby granted/)
  assert.ok(licence.length > 500, 'LICENSE looks truncated')
})

test('npm test runs this script too', () => {
  assert.match(manifest.scripts.test, /test-package\.mjs/)
  assert.match(manifest.scripts['check:build'], /build\.mjs --check/)
  assert.match(manifest.scripts.prepack, /build\.mjs/)
})

const failures = []
for (const { name, fn } of cases) {
  try {
    await fn()
    console.log('  ok   ' + name)
  } catch (error) {
    console.log('  FAIL ' + name + ' — ' + String(error?.message ?? error))
    failures.push(name)
  }
}

if (failures.length > 0) {
  console.log('\n' + String(failures.length) + ' FAILURE(S): ' + failures.join(', '))
  process.exit(1)
}
console.log('\nThe tarball publishes ' + String(published.size) + ' files, all of them installable elsewhere.')
