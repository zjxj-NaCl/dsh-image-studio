/**
 * Create or update the GitHub Release for the version in package.json.
 *
 * Why this file exists: `api.github.com` is reachable from this machine, but
 * only through Node's own fetch — that path honours the system proxy
 * (`https_proxy` + `NODE_USE_ENV_PROXY=1`). Plain `curl.exe` fails here with
 * `schannel: SEC_E_NO_CREDENTIALS`, and that failure reads like a 403 from the
 * server when it is really the local TLS stack refusing to run. Reading the API
 * needs no credential at all; only writing a release does.
 *
 * A token needs `repo` (classic) or `Contents: write` (fine-grained). It is read
 * from GH_TOKEN / GITHUB_TOKEN and is never printed, echoed into an error, or
 * written anywhere.
 *
 *   GH_TOKEN=<token> node scripts/publish-release.mjs
 *   node scripts/publish-release.mjs --dry-run
 *
 * On Windows, `scripts/publish-release.ps1` fills the token from the git
 * credential store, so nothing has to be pasted at all.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const API = 'https://api.github.com'
const USER_AGENT = 'dsh-image-studio-release'
const dryRun = process.argv.includes('--dry-run')

/** The repository slug, from the manifest's `repository` field. */
function repositorySlug(manifest) {
  const field = manifest.repository
  const raw = typeof field === 'string' ? field : String(field?.url ?? '')
  const match = raw.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/)
  if (match === null) throw new Error('package.json has no GitHub repository to publish to: ' + raw)
  return match[1] + '/' + match[2]
}

/** The changelog section for one version, without its heading. */
function changelogBody(version) {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n')
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith('## [' + version + ']'))
  if (start === -1) throw new Error('CHANGELOG.md has no section for ' + version)
  const body = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## [')) break
    body.push(line)
  }
  return body.join('\n').trim()
}

/** One request against the API, with the headers GitHub insists on. */
async function call(path, token, init = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.headers ?? {}),
  }
  if (token !== '') headers.Authorization = 'Bearer ' + token
  let response
  try {
    response = await fetch(path.startsWith('http') ? path : API + path, { ...init, headers })
  } catch (error) {
    throw new Error(
      'Cannot reach api.github.com (' + String(error?.cause?.code ?? error?.message ?? error) + '). ' +
      'This shell needs the system proxy: https_proxy is read by Node when NODE_USE_ENV_PROXY=1.',
    )
  }
  const text = await response.text()
  let data = null
  try {
    data = text === '' ? null : JSON.parse(text)
  } catch {
    data = null
  }
  return { status: response.status, headers: response.headers, data, text }
}

/** The tarballs sitting in the repo root, newest first. */
function tarballs(version) {
  const name = 'dsh-image-studio-' + version + '.tgz'
  return existsSync(join(root, name)) ? [{ path: join(root, name), name }] : []
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = manifest.version
const tag = 'v' + version
const slug = repositorySlug(manifest)
const body = changelogBody(version)
const token = String(process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '').trim()

if (dryRun) {
  console.log('repository: ' + slug)
  console.log('tag: ' + tag)
  console.log('token: ' + (token === '' ? 'missing (a dry run does not need one)' : 'present, ' + String(token.length) + ' chars'))
  console.log('assets: ' + (tarballs(version).map((entry) => entry.name).join(', ') || '(none in the repo root)'))
  console.log('--- body ---')
  console.log(body)
  process.exit(0)
}

if (token === '') {
  console.error('No token. Set GH_TOKEN (or run scripts/publish-release.ps1, which reads the git credential store).')
  process.exit(1)
}

const existing = await call('/repos/' + slug + '/releases/tags/' + tag, token)
let release
if (existing.status === 200) {
  release = existing.data
  console.log('updating release ' + tag + ' (' + String(release.id) + ')')
  const updated = await call('/repos/' + slug + '/releases/' + String(release.id), token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag, body, tag_name: tag }),
  })
  if (updated.status !== 200) {
    console.error('PATCH failed: ' + String(updated.status) + ' ' + updated.text.slice(0, 300))
    process.exit(1)
  }
  release = updated.data
} else if (existing.status === 404) {
  console.log('creating release ' + tag)
  const created = await call('/repos/' + slug + '/releases', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: tag, body, draft: false, prerelease: false }),
  })
  if (created.status !== 201) {
    console.error('POST failed: ' + String(created.status) + ' ' + created.text.slice(0, 300))
    if (created.status === 401 || created.status === 403) {
      console.error('The token cannot write releases: it needs `repo` (classic) or `Contents: write` (fine-grained).')
    }
    process.exit(1)
  }
  release = created.data
} else {
  console.error('Cannot read releases: ' + String(existing.status) + ' ' + existing.text.slice(0, 300))
  process.exit(1)
}

for (const asset of tarballs(version)) {
  const already = Array.isArray(release.assets) && release.assets.some((entry) => entry.name === asset.name)
  if (already) {
    console.log('asset already attached: ' + asset.name)
    continue
  }
  const uploadUrl = String(release.upload_url).replace(/\{.*\}$/, '') + '?name=' + encodeURIComponent(asset.name)
  const bytes = readFileSync(asset.path)
  const uploaded = await call(uploadUrl, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(statSync(asset.path).size) },
    body: bytes,
  })
  if (uploaded.status !== 201) {
    console.error('asset upload failed: ' + String(uploaded.status) + ' ' + uploaded.text.slice(0, 300))
    process.exit(1)
  }
  console.log('attached ' + asset.name + ' (' + String(bytes.length) + ' bytes)')
}

console.log('done: ' + release.html_url)
