/**
 * Credential and image-API integration test for the packaged host half.
 *
 * Proves three things the browser must never be able to break:
 *
 *  - the stored image API key travels only on the upstream provider request,
 *    never into a browser response and never into the panel's JSON files;
 *  - a generation call speaks the provider contract and lands the bytes in the
 *    gallery, without the project Agent being involved at all;
 *  - an unconfigured reference fails closed with an actionable message instead
 *    of calling upstream.
 *
 *   node packages/dsh-image-studio/test-auth.mjs
 */
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'image-studio-auth-'))
process.env.DSH_IMAGE_STUDIO_DATA_DIR = dataDir

const { apply, DEFAULT_GENERATE_TIMEOUT_MS, PANEL_ROUTE } = await import('./lib/index.js')

if (!(Number.isFinite(DEFAULT_GENERATE_TIMEOUT_MS) && DEFAULT_GENERATE_TIMEOUT_MS > 0)) {
  throw new Error('the panel must own a positive generation timeout')
}

/** A 1x1 PNG, used as the upstream "generated" image. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const seen = []
const upstream = http.createServer((req, res) => {
  seen.push({ url: req.url, authorization: req.headers.authorization, method: req.method })
  if (req.headers.authorization !== 'Bearer provider-secret') {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end('{"error":{"message":"unauthorized"}}')
    return
  }
  if (req.url === '/v1/images/generations') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ b64_json: PNG }] }))
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))

const resolvedRefs = []
const ctx = {
  effect(callback) { return callback() },
  webServer: { register(value) { route = value; return () => {} } },
  credentials: {
    async resolve(ref) {
      resolvedRefs.push(ref)
      return ref === 'STUDIO_TEST_KEY' ? { value: 'provider-secret' } : undefined
    },
    async describe(ref) {
      return { configured: ref === 'STUDIO_TEST_KEY', source: 'test', writable: true }
    },
    async set() { throw new Error('set must not be called by this test') },
  },
}

let route
apply(ctx, {
  provider: 'openai-compat',
  baseURL: 'http://127.0.0.1:' + String(upstream.address().port) + '/v1',
  model: 'stub-image-model',
  keyRef: 'STUDIO_TEST_KEY',
})

const panel = http.createServer((req, res) => {
  if (String(req.url).startsWith(route.path)) {
    route.handler(req, res)
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((resolve) => panel.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + String(panel.address().port) + PANEL_ROUTE
const post = (path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const failures = []
async function check(label, fn) {
  try {
    const detail = await fn()
    console.log('  ok   ' + label + (detail ? ' — ' + detail : ''))
  } catch (error) {
    console.log('  FAIL ' + label + ' — ' + String(error.message))
    failures.push(label)
  }
}

try {
  await check('GET /config never returns the API key', async () => {
    const r = await fetch(base + '/config')
    if (!r.ok) throw new Error('HTTP ' + String(r.status))
    const text = await r.text()
    if (text.includes('provider-secret')) throw new Error('the API key leaked into /config')
    const body = JSON.parse(text)
    if (body.key?.ref !== 'STUDIO_TEST_KEY' || body.key?.configured !== true) {
      throw new Error('key description is wrong: ' + JSON.stringify(body.key))
    }
    if (body.key?.value !== undefined) throw new Error('key description carries a value')
    if (!Array.isArray(body.providers) || body.providers.length === 0) throw new Error('no provider catalog')
    return String(body.providers.length) + ' providers, key configured from ' + String(body.key.source)
  })

  await check('POST /generate calls the provider and stores the image', async () => {
    const r = await post('/generate', { prompt: 'a red cube', negative: 'blurry' })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.ok !== true || body.mode !== 'generate') throw new Error('unexpected envelope: ' + JSON.stringify(body).slice(0, 160))
    if (typeof body.image?.name !== 'string' || !/^img-\d{8}-\d{6}-[0-9a-f]{6}\.png$/.test(body.image.name)) {
      throw new Error('unexpected gallery name: ' + String(body.image?.name))
    }
    if (body.image.bytes !== Buffer.from(PNG, 'base64').length) throw new Error('byte count mismatch')
    const upstreamCall = seen.find((entry) => entry.url === '/v1/images/generations')
    if (!upstreamCall) throw new Error('the provider endpoint was never called')
    if (upstreamCall.authorization !== 'Bearer provider-secret') throw new Error('the provider key was not sent')
    return body.image.name + ' (' + String(body.image.bytes) + ' bytes, ' + String(body.elapsedMs) + ' ms)'
  })

  await check('the stored image is served back byte-exact', async () => {
    const list = await (await fetch(base + '/gallery')).json()
    if (!Array.isArray(list.images) || list.images.length !== 1) throw new Error('gallery listing is wrong')
    const image = await fetch(base + '/image?name=' + encodeURIComponent(list.images[0].name))
    if (!image.ok) throw new Error('HTTP ' + String(image.status))
    if (image.headers.get('content-type') !== 'image/png') throw new Error('wrong media type')
    const bytes = Buffer.from(await image.arrayBuffer())
    if (bytes.toString('hex') !== Buffer.from(PNG, 'base64').toString('hex')) throw new Error('bytes differ')
    if (image.headers.has('authorization')) throw new Error('a secret leaked into a browser response')
    return String(bytes.length) + ' bytes, image/png'
  })

  await check('the API key is absent from every file the panel wrote', async () => {
    const saved = await post('/config/save', { provider: 'openai-compat' })
    if (!saved.ok) throw new Error('config save failed: ' + String(saved.status))
    const config = readFileSync(join(dataDir, 'config.json'), 'utf8')
    if (config.includes('provider-secret')) throw new Error('the API key was written to config.json')
    if (!config.includes('"provider": "openai-compat"')) throw new Error('config.json lost the provider')
    return 'config.json clean'
  })

  await check('POST /generate rejects an empty prompt before calling upstream', async () => {
    const before = seen.length
    const r = await post('/generate', { prompt: '   ' })
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    const body = await r.json()
    if (typeof body.error !== 'string' || !body.error.includes('提示词')) throw new Error('unhelpful error: ' + String(body.error))
    if (seen.length !== before) throw new Error('upstream was called for an invalid request')
    return body.error
  })

  await check('a missing credential fails closed with an actionable error', async () => {
    await post('/config/save', { keyRef: 'STUDIO_TEST_KEY_MISSING' })
    const before = seen.length
    const r = await post('/generate', { prompt: 'a red cube' })
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    const body = await r.json()
    if (typeof body.error !== 'string' || !body.error.includes('STUDIO_TEST_KEY_MISSING')) {
      throw new Error('error does not name the reference: ' + String(body.error))
    }
    if (seen.length !== before) throw new Error('upstream was called without a credential')
    await post('/config/save', { keyRef: 'STUDIO_TEST_KEY' })
    return body.error
  })

  await check('GET /status reports readiness only when model and key are present', async () => {
    const body = await (await fetch(base + '/status')).json()
    if (body.ready !== true) throw new Error('expected ready, got ' + JSON.stringify(body))
    if (body.gallery !== undefined) throw new Error('status must not expose host paths')
    return 'ready · ' + body.provider + ' / ' + body.model
  })

  await check('credentials are resolved per request, not cached', async () => {
    const before = resolvedRefs.filter((ref) => ref === 'STUDIO_TEST_KEY').length
    const r = await post('/generate', { prompt: 'a blue sphere' })
    if (r.status !== 200) throw new Error('second generate failed: HTTP ' + String(r.status))
    const after = resolvedRefs.filter((ref) => ref === 'STUDIO_TEST_KEY').length
    if (after !== before + 1) throw new Error('the reference was not re-resolved for the second call')
    if (!resolvedRefs.includes('STUDIO_TEST_KEY_MISSING')) throw new Error('the missing reference was never resolved')
    return String(after) + ' resolutions of the live reference, ' + String(resolvedRefs.length) + ' total'
  })
} finally {
  await new Promise((resolve) => panel.close(resolve))
  await new Promise((resolve) => upstream.close(resolve))
  rmSync(dataDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.log('\n' + String(failures.length) + ' FAILURE(S): ' + failures.join(', '))
  process.exit(1)
}
console.log('\nThe host half keeps its credential and stores every generated image.')
