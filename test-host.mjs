/**
 * Route-level test for the packaged host half.
 *
 * Unlike `test-auth.mjs`, nothing here needs a provider: every case is about the
 * panel's own surface — the same-origin guard, the body limits, the gallery, and
 * the 404/405 contract a browser relies on. The provider-shaped cases use a stub
 * upstream so the storage path is exercised end to end, and the ComfyUI cases use
 * a stub ComfyUI server so the read → queue → download chain does too.
 *
 *   node packages/dsh-image-studio/test-host.mjs
 */
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'image-studio-host-'))
process.env.DSH_IMAGE_STUDIO_DATA_DIR = dataDir

const { apply, PANEL_ROUTE } = await import('./lib/index.js')

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let upstreamCalls = 0
/** Every upstream path, in order, so a case can prove which endpoint was chosen. */
const upstreamPaths = []
/** Every upstream authorization header, so a case can prove which key was used. */
const upstreamAuth = []
/** How many of the next upstream calls should fail instead of returning an image. */
let failNext = 0
const upstream = http.createServer((req, res) => {
  upstreamCalls += 1
  upstreamPaths.push(req.url)
  upstreamAuth.push(req.headers.authorization ?? '')
  if (req.headers.authorization !== 'Bearer host-secret') {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end('{"error":{"message":"unauthorized"}}')
    return
  }
  if (failNext > 0) {
    failNext -= 1
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end('{"error":{"message":"upstream exploded"}}')
    return
  }
  if (String(req.url).startsWith('/v1/models')) {
    // A catalog shaped the way a relay answers: an image model and a decoy, so
    // the ranking is observable.
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'text-embedding-3' }, { id: 'gpt-image-2' }] }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data: [{ b64_json: PNG }] }))
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))

// The ComfyUI mode never talks to an image service: it reads the workflow out of
// ComfyUI's own user-data directory, runs it there, and downloads the produced
// image. This stub speaks exactly the four ComfyUI routes the panel uses, so the
// whole read → queue → poll → download → gallery-import chain runs for real.
const comfyPaths = []
const comfyBodies = []
let comfyMode = 'ok'
let comfyUsesV2 = true
const API_WORKFLOW = {
  '3': { class_type: 'LoadImage', inputs: { image: 'example.png', upload: 'image' } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd3.5_large.safetensors' } },
  '5': {
    class_type: 'KSampler',
    inputs: { seed: 1, steps: 20, cfg: 8, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0] },
  },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'placeholder positive', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'placeholder negative', clip: ['4', 1] } },
  '8': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '9': { class_type: 'SaveImage', inputs: { images: ['5', 0] } },
}
const comfy = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const url = new URL(req.url, 'http://127.0.0.1')
    comfyPaths.push(req.method + ' ' + req.url.split('?')[0])
    let parsed
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { parsed = undefined }
    comfyBodies.push(parsed)
    if (url.pathname === '/v2/userdata') {
      if (!comfyUsesV2) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end('{"error":"not found"}')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { type: 'file', name: 'sd35_large.json', path: 'sd35_large.json' },
        { type: 'file', name: 'sd15.json', path: 'sd15.json' },
        { type: 'dir', name: 'scratch', path: 'scratch' },
        { type: 'file', name: 'readme.txt', path: 'readme.txt' },
      ]))
      return
    }
    if (url.pathname === '/userdata') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(['sd35_large.json', 'sd15.json', 'scratch', 'readme.txt']))
      return
    }
    if (url.pathname.startsWith('/userdata/')) {
      const file = decodeURIComponent(url.pathname.slice('/userdata/'.length))
      if (file === 'missing.json') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end('{"error":"no such workflow"}')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(API_WORKFLOW))
      return
    }
    if (url.pathname === '/upload/image') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: 'dsh-reference.png', subfolder: '', type: 'input' }))
      return
    }
    if (url.pathname === '/prompt') {
      if (comfyMode === 'reject') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: '工作流 nope 不存在' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // Real ComfyUI mints the queue id; the plugin no longer sends one, so the
      // stub has to answer with an id of its own for the poll to follow.
      res.end(JSON.stringify({ prompt_id: parsed?.prompt_id ?? 'stub-prompt-id', number: 1, node_errors: {} }))
      return
    }
    if (url.pathname.startsWith('/history/')) {
      const promptId = decodeURIComponent(url.pathname.slice('/history/'.length))
      if (comfyMode === 'error') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ [promptId]: { status: { status_str: 'error', completed: false, messages: [['Execution error', 'model not found']] } } }))
        return
      }
      if (comfyMode === 'empty') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ [promptId]: { status: { status_str: 'success', completed: true }, outputs: {} } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        [promptId]: {
          status: { status_str: 'success', completed: true },
          outputs: { '9': { images: [{ filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }] } },
        },
      }))
      return
    }
    if (url.pathname === '/view') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(Buffer.from(PNG, 'base64'))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"error":"no comfy route"}')
  })
})
await new Promise((resolve) => comfy.listen(0, '127.0.0.1', resolve))
const comfyBaseUrlValue = 'http://127.0.0.1:' + String(comfy.address().port)

const registrations = []
let route = null
const ctx = {
  effect(callback, label) {
    const dispose = callback()
    registrations.push({ label, dispose })
    return dispose
  },
  webServer: {
    register(value) {
      route = value
      return () => { route = null }
    },
  },
  credentials: {
    async resolve(ref) {
      return ref === 'HOST_TEST_KEY' ? { value: 'host-secret' } : undefined
    },
    async describe(ref) {
      return { configured: ref === 'HOST_TEST_KEY', source: 'test', writable: true }
    },
    async set() {},
  },
}

apply(ctx, {
  provider: 'openai-compat',
  baseURL: 'http://127.0.0.1:' + String(upstream.address().port) + '/v1',
  model: 'stub-image-model',
  keyRef: 'HOST_TEST_KEY',
  comfyBaseUrl: comfyBaseUrlValue,
})

if (route === null) throw new Error('the host half registered no web server route')
if (route.kind !== 'prefix') throw new Error('the panel route must claim a whole prefix')

const server = http.createServer((req, res) => {
  if (req.url.startsWith(route.path)) {
    route.handler(req, res)
    return
  }
  res.writeHead(404)
  res.end('no route')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + String(server.address().port)
const base = origin + PANEL_ROUTE

const failures = []
async function check(label, fn) {
  try {
    const detail = await fn()
    console.log('  ok   ' + label + (detail ? ' — ' + detail : ''))
  } catch (error) {
    console.log('  FAIL ' + label + ' — ' + String(error?.message ?? error))
    failures.push(label)
  }
}

const send = (path, init) => fetch(base + path, {
  ...init,
  headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
})

try {
  await check('GET /config reports the provider catalog and the current settings', async () => {
    const body = await (await fetch(base + '/config')).json()
    if (!Array.isArray(body.providers) || body.providers.length === 0) throw new Error('no provider catalog')
    if (!Array.isArray(body.editFormats) || body.editFormats.length !== 4) throw new Error('no edit format catalog')
    if (body.config.model !== 'stub-image-model') throw new Error('the configured model is missing')
    if (body.key?.ref !== 'HOST_TEST_KEY') throw new Error('the key reference is missing')
    return String(body.providers.length) + ' providers, ' + String(body.editFormats.length) + ' edit formats'
  })

  await check('GET /status reports readiness without exposing host paths', async () => {
    const body = await (await fetch(base + '/status')).json()
    if (body.ready !== true) throw new Error('expected a ready panel: ' + JSON.stringify(body))
    if (JSON.stringify(body).includes(dataDir)) throw new Error('a host path leaked into /status')
    if (body.count !== 4) throw new Error('the panel did not publish its batch ceiling')
    if (!(body.timeoutMs > 0)) throw new Error('the panel did not publish its generation budget')
    return 'ready · ' + body.provider + ' / ' + body.model
  })

  await check('GET /models reads the provider catalog with the saved key', async () => {
    const before = upstreamPaths.length
    const body = await (await fetch(base + '/models')).json()
    if (body.ok !== true) throw new Error('the success envelope must carry ok:true: ' + JSON.stringify(body))
    if (!Array.isArray(body.models)) throw new Error('/models did not answer with an array')
    if (body.models.length !== 2) throw new Error('expected both catalog entries, saw ' + JSON.stringify(body.models))
    if (body.models[0] !== 'gpt-image-2') throw new Error('an image model was not ranked first: ' + JSON.stringify(body.models))
    if (body.provider !== 'openai-compat') throw new Error('the catalog did not name its provider')
    const paths = upstreamPaths.slice(before)
    if (paths.length !== 1) throw new Error('expected exactly one upstream call, saw ' + JSON.stringify(paths))
    if (paths[0] !== '/v1/models') throw new Error('the catalog read the wrong endpoint: ' + String(paths[0]))
    if (upstreamAuth[before] !== 'Bearer host-secret') throw new Error('the catalog did not use the saved key')
    return body.models.join(', ')
  })

  await check('GET /models refuses an unknown provider before calling upstream', async () => {
    const before = upstreamPaths.length
    const r = await fetch(base + '/models?provider=nope')
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    const body = await r.json()
    if (!String(body.error).includes('未知的图像服务')) throw new Error('unhelpful error: ' + String(body.error))
    if (upstreamPaths.length !== before) throw new Error('an unknown provider still reached upstream')
    return body.error
  })

  await check('GET /models fails closed when the key is missing', async () => {
    const saved = await send('/config/save', { method: 'POST', body: JSON.stringify({ keyRef: 'HOST_TEST_KEY_MISSING' }) })
    if (!saved.ok) throw new Error('could not point the panel at a missing key: ' + await saved.text())
    try {
      const before = upstreamPaths.length
      const r = await fetch(base + '/models')
      if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
      const body = await r.json()
      if (!String(body.error).includes('HOST_TEST_KEY_MISSING')) throw new Error('the error does not name the reference: ' + String(body.error))
      if (upstreamPaths.length !== before) throw new Error('a missing key still reached upstream')
      return body.error
    } finally {
      await send('/config/save', { method: 'POST', body: JSON.stringify({ keyRef: 'HOST_TEST_KEY' }) })
    }
  })

  await check('GET /gallery starts empty and is an array', async () => {
    const body = await (await fetch(base + '/gallery')).json()
    if (!Array.isArray(body.images)) throw new Error('/gallery did not answer with an array')
    if (body.images.length !== 0) throw new Error('a fresh data directory is not empty')
    return '0 images'
  })

  await check('POST /generate stores an image the gallery then serves', async () => {
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube' }) })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    const list = await (await fetch(base + '/gallery')).json()
    if (list.images.length !== 1) throw new Error('the gallery did not record the image')
    if (list.images[0].name !== body.image.name) throw new Error('the gallery name does not match the result')
    if (typeof list.images[0].createdAt !== 'number') throw new Error('the gallery entry has no timestamp')
    if (list.images[0].bytes !== Buffer.from(PNG, 'base64').length) throw new Error('the recorded byte count is wrong')
    return body.image.name
  })

  await check('GET /image serves the stored bytes', async () => {
    const list = await (await fetch(base + '/gallery')).json()
    const r = await fetch(base + '/image?name=' + encodeURIComponent(list.images[0].name))
    if (!r.ok) throw new Error('HTTP ' + String(r.status))
    if (r.headers.get('content-type') !== 'image/png') throw new Error('wrong media type')
    if (r.headers.get('cache-control') !== 'no-cache') throw new Error('a generated image must not be cached')
    const bytes = Buffer.from(await r.arrayBuffer())
    if (bytes.length !== Buffer.from(PNG, 'base64').length) throw new Error('truncated image')
    return String(bytes.length) + ' bytes'
  })

  await check('GET /image refuses a traversing name', async () => {
    for (const name of ['../secret.png', 'a/b.png', 'a\\b.png', 'a:b.png', '', '..']) {
      const r = await fetch(base + '/image?name=' + encodeURIComponent(name))
      if (r.status !== 400) throw new Error(JSON.stringify(name) + ' answered ' + String(r.status))
    }
    return '6 names refused'
  })

  await check('GET /image answers 404 for a name that is not stored', async () => {
    const r = await fetch(base + '/image?name=missing.png')
    if (r.status !== 404) throw new Error('expected 404, got ' + String(r.status))
    return 'missing.png'
  })

  await check('POST /delete removes one image and reports a repeat as missing', async () => {
    const created = await (await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a blue sphere' }) })).json()
    const first = await send('/delete', { method: 'POST', body: JSON.stringify({ name: created.image.name }) })
    if (!first.ok) throw new Error('delete failed: HTTP ' + String(first.status))
    const second = await send('/delete', { method: 'POST', body: JSON.stringify({ name: created.image.name }) })
    if (second.status !== 404) throw new Error('deleting twice answered ' + String(second.status))
    const list = await (await fetch(base + '/gallery')).json()
    if (list.images.length !== 1) throw new Error('the gallery count did not drop back to one')
    return created.image.name + ' removed'
  })

  await check('POST /delete refuses a traversing name', async () => {
    const r = await send('/delete', { method: 'POST', body: JSON.stringify({ name: '../secret.png' }) })
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    return '../secret.png'
  })

  await check('a blank model or provider in the request falls back to the saved configuration', async () => {
    // /config/save ignores empty strings, so a saved field can never be blanked from
    // the browser: the missing-model guard is only reachable before the first save and
    // is covered at the model layer. Here the fallback itself is the contract.
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube', model: '   ', provider: '' }) })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.model !== 'stub-image-model') throw new Error('the saved model was not used: ' + String(body.model))
    if (body.provider !== 'openai-compat') throw new Error('the saved provider was not used: ' + String(body.provider))
    return body.provider + ' / ' + body.model
  })

  await check('POST /generate refuses an unknown provider before it reaches the provider', async () => {
    const before = upstreamCalls
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube', provider: 'nope' }) })
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    const body = await r.json()
    if (!String(body.error).includes('未知的图像服务')) throw new Error('unhelpful error: ' + String(body.error))
    if (upstreamCalls !== before) throw new Error('the provider was contacted anyway')
    return body.error
  })

  await check('POST /generate refuses an empty prompt before it reaches the provider', async () => {
    const before = upstreamCalls
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: '   ' }) })
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    const body = await r.json()
    if (!String(body.error).includes('提示词')) throw new Error('unhelpful error: ' + String(body.error))
    if (upstreamCalls !== before) throw new Error('the provider was contacted anyway')
    return 'prompt validation is local'
  })

  // The workbench switch is the only thing that decides which endpoint a submission
  // reaches: text-to-image always goes to generations and never uploads a reference.
  const reference = { name: 'ref.png', mediaType: 'image/png', data: PNG }

  await check('mode=generate sends a reference-free request to the generations endpoint', async () => {
    const before = upstreamPaths.length
    const r = await send('/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a red cube', mode: 'generate', referenceImages: [reference] }),
    })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.mode !== 'generate') throw new Error('the response mode is ' + String(body.mode))
    const paths = upstreamPaths.slice(before)
    if (paths.length !== 1) throw new Error('the provider was called ' + String(paths.length) + ' times')
    if (!paths[0].endsWith('/images/generations')) throw new Error('text-to-image used ' + String(paths[0]))
    return paths[0]
  })

  await check('mode=edit sends the reference to the edits endpoint', async () => {
    const before = upstreamPaths.length
    const r = await send('/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'make it blue', mode: 'edit', referenceImages: [reference] }),
    })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.mode !== 'edit') throw new Error('the response mode is ' + String(body.mode))
    const paths = upstreamPaths.slice(before)
    if (paths.length !== 1) throw new Error('the provider was called ' + String(paths.length) + ' times')
    if (!paths[0].endsWith('/images/edits')) throw new Error('image-to-image used ' + String(paths[0]))
    return paths[0]
  })

  await check('mode=edit without a reference is refused before the provider is called', async () => {
    const before = upstreamCalls
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'make it blue', mode: 'edit' }) })
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    const body = await r.json()
    if (!String(body.error).includes('图生图至少需要一张参考图')) throw new Error('unhelpful error: ' + String(body.error))
    if (upstreamCalls !== before) throw new Error('the provider was contacted anyway')
    return body.error
  })

  await check('a missing or unknown mode falls back to the reference heuristic', async () => {
    const noMode = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube' }) })
    if ((await noMode.json()).mode !== 'generate') throw new Error('a reference-free legacy request stopped defaulting to text-to-image')
    const legacyEdit = await send('/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'make it blue', mode: 'nonsense', referenceImages: [reference] }),
    })
    if ((await legacyEdit.json()).mode !== 'edit') throw new Error('a referenced legacy request stopped defaulting to edit')
    return 'generate / edit'
  })

  await check('POST /generate fills the preview grid with a batch of four', async () => {
    const before = upstreamCalls
    const stored = (await (await fetch(base + '/gallery')).json()).images.length
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube', count: 4 }) })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.count !== 4) throw new Error('the batch reported ' + String(body.count) + ' images')
    if (body.requested !== 4) throw new Error('the batch lost its requested size')
    if (!Array.isArray(body.images) || body.images.length !== 4) throw new Error('no images array')
    if (body.image.name !== body.images[0].name) throw new Error('image is no longer the first of images')
    if (new Set(body.images.map((image) => image.name)).size !== 4) throw new Error('the batch overwrote its own files')
    if (upstreamCalls - before !== 4) throw new Error('the provider was called ' + String(upstreamCalls - before) + ' times')
    const names = await (await fetch(base + '/gallery')).json()
    if (names.images.length !== stored + 4) throw new Error('the batch did not reach the gallery: ' + String(names.images.length))
    if (body.partialError !== undefined) throw new Error('a clean batch reported a partial failure')
    return '4 images, ' + String(body.elapsedMs) + ' ms'
  })

  await check('a batch size above the ceiling is clamped instead of refused', async () => {
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a wide sky', count: 99 }) })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.requested !== 4) throw new Error('the ceiling is ' + String(body.requested))
    if (body.count !== 4) throw new Error('the clamped batch returned ' + String(body.count))
    return 'count 99 → 4'
  })

  await check('a batch that partly fails keeps the images it produced', async () => {
    failNext = 2
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube', count: 4 }) })
    failNext = 0
    if (r.status !== 200) throw new Error('a partial batch must still answer 200, got ' + String(r.status))
    const body = await r.json()
    if (body.count !== 2) throw new Error('the surviving count is ' + String(body.count))
    if (typeof body.partialError !== 'string' || !body.partialError.includes('生成失败')) {
      throw new Error('the partial failure is not reported: ' + String(body.partialError))
    }
    return body.count + ' of 4 kept'
  })

  await check('a batch that fails completely reports the provider error', async () => {
    failNext = 4
    const r = await send('/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube', count: 2 }) })
    failNext = 0
    if (r.status !== 502) throw new Error('expected 502, got ' + String(r.status))
    const body = await r.json()
    if (!String(body.error).includes('生成失败')) throw new Error('unhelpful error: ' + String(body.error))
    if (String(body.error).includes('upstream exploded') === false) throw new Error('the provider reason was dropped')
    if (body.images !== undefined) throw new Error('a failed batch reported images')
    return body.error
  })

  // The third generation mode is a hand-off: the panel never speaks to ComfyUI,
  // it reads the Agent's registry and forwards one prompt, then copies whatever
  // artifact paths come back into its own gallery.
  await check('GET /comfy/workflows reads the ComfyUI user-data directory', async () => {
    const before = comfyPaths.length
    const r = await fetch(base + '/comfy/workflows')
    if (r.status !== 200) throw new Error('expected 200, got ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.ok !== true) throw new Error('the envelope is wrong: ' + JSON.stringify(body))
    if (!Array.isArray(body.workflows) || body.workflows.length !== 2) throw new Error('the workflow list is wrong: ' + JSON.stringify(body.workflows))
    if (body.workflows[0].name !== 'sd15' || body.workflows[0].path !== 'sd15.json') throw new Error('the entries are not { name, path }: ' + JSON.stringify(body.workflows))
    if (body.workflows.some((entry) => entry.path === 'readme.txt' || entry.path === 'scratch')) throw new Error('a non-workflow file leaked in')
    const paths = comfyPaths.slice(before)
    if (paths.length !== 1 || paths[0] !== 'GET /v2/userdata') throw new Error('the wrong ComfyUI route was called: ' + JSON.stringify(paths))
    return body.workflows.map((entry) => entry.path).join(', ')
  })

  await check('GET /comfy/workflows falls back to the older /userdata listing', async () => {
    comfyUsesV2 = false
    try {
      const r = await fetch(base + '/comfy/workflows')
      if (r.status !== 200) throw new Error('expected 200, got ' + String(r.status) + ': ' + await r.text())
      const body = await r.json()
      if (!Array.isArray(body.workflows) || body.workflows.length !== 2) throw new Error('the legacy listing was misread: ' + JSON.stringify(body.workflows))
      if (body.workflows[0].path !== 'sd15.json') throw new Error('the plain-string listing did not survive: ' + JSON.stringify(body.workflows))
      return body.workflows.map((entry) => entry.path).join(', ')
    } finally {
      comfyUsesV2 = true
    }
  })

  await check('GET /comfy/workflows reports an unreachable ComfyUI instead of pretending success', async () => {
    const saved = await send('/config/save', { method: 'POST', body: JSON.stringify({ comfyBaseUrl: 'http://127.0.0.1:1' }) })
    if (!saved.ok) throw new Error('could not point the panel at a dead ComfyUI: ' + await saved.text())
    try {
      const r = await fetch(base + '/comfy/workflows')
      if (r.status !== 502) throw new Error('expected 502, got ' + String(r.status))
      const body = await r.json()
      if (!String(body.error).includes('ComfyUI')) throw new Error('unhelpful error: ' + String(body.error))
      return body.error
    } finally {
      await send('/config/save', { method: 'POST', body: JSON.stringify({ comfyBaseUrl: comfyBaseUrlValue }) })
    }
  })

  await check('GET /comfy/workflows honours the address typed on the studio surface', async () => {
    // The studio page lets the ComfyUI address be edited and read back without
    // saving the configuration first, so the query must beat whatever is stored.
    const saved = await send('/config/save', { method: 'POST', body: JSON.stringify({ comfyBaseUrl: 'http://127.0.0.1:1' }) })
    if (!saved.ok) throw new Error('could not point the panel at a dead ComfyUI: ' + await saved.text())
    try {
      const asked = 'http://127.0.0.1:' + String(comfy.address().port) + '/'
      const r = await fetch(base + '/comfy/workflows?baseUrl=' + encodeURIComponent(asked))
      if (r.status !== 200) throw new Error('expected 200, got ' + String(r.status) + ': ' + await r.text())
      const body = await r.json()
      if (body.baseUrl !== asked.replace(/\/+$/, '')) throw new Error('the answer does not name the address it used: ' + JSON.stringify(body.baseUrl))
      if (!Array.isArray(body.workflows) || body.workflows.length !== 2) throw new Error('the workflow list is wrong: ' + JSON.stringify(body.workflows))
      return body.baseUrl
    } finally {
      await send('/config/save', { method: 'POST', body: JSON.stringify({ comfyBaseUrl: comfyBaseUrlValue }) })
    }
  })

  await check('GET /comfy/workflows rejects an unusable address with a fixable 400', async () => {
    const r = await fetch(base + '/comfy/workflows?baseUrl=' + encodeURIComponent('ftp://127.0.0.1:8188'))
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (!String(body.error).includes('http')) throw new Error('unhelpful error: ' + String(body.error))
    return body.error
  })

  await check('POST /comfy/generate runs a workflow and copies its artifact into the gallery', async () => {
    const stored = (await (await fetch(base + '/gallery')).json()).images.length
    const before = comfyPaths.length
    const r = await send('/comfy/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a red cube', workflow: 'sd35_large.json', negative: 'blurry' }),
    })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.ok !== true || body.mode !== 'comfy') throw new Error('the envelope is wrong: ' + JSON.stringify(body))
    if (body.workflow !== 'sd35_large.json') throw new Error('the workflow was lost')
    if (!Array.isArray(body.images) || body.images.length !== 1) throw new Error('the artifact was not imported: ' + JSON.stringify(body.images))
    if (body.image.name !== body.images[0].name) throw new Error('image is no longer the first of images')
    if (body.images[0].mediaType !== 'image/png') throw new Error('the artifact media type is ' + String(body.images[0].mediaType))
    if (typeof body.promptId !== 'string' || body.promptId === '') throw new Error('the prompt id was not reported')
    if (Object.hasOwn(body, 'files')) throw new Error('the browser answer leaked raw image bytes through files')
    const paths = comfyPaths.slice(before)
    // A bare workflow name is looked up under 'workflows/' first, which is where ComfyUI keeps them.
    const expected = ['GET /userdata/workflows%2Fsd35_large.json', 'POST /prompt', 'GET /history/' + String(body.promptId), 'GET /view']
    if (JSON.stringify(paths) !== JSON.stringify(expected)) throw new Error('a reference-free run called ' + JSON.stringify(paths))
    const sent = comfyBodies[comfyBodies.length - 3]
    if (sent.prompt['6'].inputs.text !== 'a red cube') throw new Error('the positive prompt was not written through the sampler link')
    if (sent.prompt['7'].inputs.text !== 'blurry') throw new Error('the negative prompt was not written through the sampler link')
    if (sent.prompt['5'].inputs.seed === 1) throw new Error('the seed was not re-rolled between runs')
    if (sent.prompt['3'].inputs.image !== 'example.png') throw new Error('a reference-free run touched the LoadImage node')
    const list = await (await fetch(base + '/gallery')).json()
    if (list.images.length !== stored + 1) throw new Error('the artifact never reached the gallery')
    if (!list.images.some((entry) => entry.name === body.images[0].name)) throw new Error('the gallery does not list the imported artifact')
    return body.images[0].name
  })

  await check('POST /comfy/generate uploads the reference before it runs the workflow', async () => {
    const before = comfyPaths.length
    const r = await send('/comfy/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'make it blue', workflow: 'sd15.json', reference }),
    })
    if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
    const body = await r.json()
    if (body.initImage !== 'dsh-reference.png') throw new Error('the uploaded name was not reported: ' + String(body.initImage))
    const paths = comfyPaths.slice(before)
    if (paths[1] !== 'POST /upload/image') throw new Error('the reference was not uploaded before the run: ' + JSON.stringify(paths))
    if (paths[2] !== 'POST /prompt') throw new Error('the run did not follow the upload: ' + JSON.stringify(paths))
    const sent = comfyBodies[comfyBodies.length - 3]
    if (sent.prompt['3'].inputs.image !== 'dsh-reference.png') throw new Error('the LoadImage node did not get the uploaded name')
    return paths.join(' → ')
  })

  await check('POST /comfy/generate validates its inputs before it reaches ComfyUI', async () => {
    const before = comfyPaths.length
    const missing = await send('/comfy/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube' }) })
    if (missing.status !== 400) throw new Error('an empty workflow answered ' + String(missing.status))
    if (!String((await missing.json()).error).includes('ComfyUI 工作流')) throw new Error('the empty workflow error is unhelpful')
    const blankPrompt = await send('/comfy/generate', { method: 'POST', body: JSON.stringify({ prompt: '  ', workflow: 'sd15.json' }) })
    if (blankPrompt.status !== 400) throw new Error('a blank prompt answered ' + String(blankPrompt.status))
    if (!String((await blankPrompt.json()).error).includes('提示词')) throw new Error('the blank prompt error is unhelpful')
    const badReference = await send('/comfy/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a red cube', workflow: 'sd15.json', reference: { data: 'AAAA', mediaType: 'image/tiff' } }),
    })
    if (badReference.status !== 400) throw new Error('a TIFF reference answered ' + String(badReference.status))
    if (!String((await badReference.json()).error).includes('PNG、JPEG、WebP 或 GIF')) throw new Error('the bad reference error is unhelpful')
    if (comfyPaths.length !== before) throw new Error('an invalid request still reached ComfyUI')
    return '3 refusals, 0 ComfyUI calls'
  })

  await check('a ComfyUI refusal is reported verbatim', async () => {
    comfyMode = 'reject'
    try {
      const r = await send('/comfy/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube', workflow: 'sd35_large.json' }) })
      if (r.status !== 502) throw new Error('expected 502, got ' + String(r.status))
      const body = await r.json()
      if (!String(body.error).includes('工作流 nope 不存在')) throw new Error('the ComfyUI reason was dropped: ' + String(body.error))
      if (body.images !== undefined) throw new Error('a failed run reported images')
      return body.error
    } finally {
      comfyMode = 'ok'
    }
  })

  await check('a failed ComfyUI execution is reported verbatim', async () => {
    comfyMode = 'error'
    try {
      const r = await send('/comfy/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube', workflow: 'sd35_large.json' }) })
      if (r.status !== 502) throw new Error('expected 502, got ' + String(r.status))
      const body = await r.json()
      if (!String(body.error).includes('model not found')) throw new Error('the execution reason was dropped: ' + String(body.error))
      return body.error
    } finally {
      comfyMode = 'ok'
    }
  })

  await check('a ComfyUI run that produced no image still explains itself', async () => {
    comfyMode = 'empty'
    try {
      const r = await send('/comfy/generate', { method: 'POST', body: JSON.stringify({ prompt: 'a red cube', workflow: 'sd35_large.json' }) })
      if (r.status !== 200) throw new Error('HTTP ' + String(r.status) + ': ' + await r.text())
      const body = await r.json()
      if (!Array.isArray(body.images) || body.images.length !== 0) throw new Error('an empty run invented images')
      if (body.image !== null) throw new Error('an empty run reported an image')
      if (body.count !== 0) throw new Error('an empty run claimed a count')
      return '0 images, still 200'
    } finally {
      comfyMode = 'ok'
    }
  })

  await check('POST /config/save validates each field', async () => {
    const unknownProvider = await send('/config/save', { method: 'POST', body: JSON.stringify({ provider: 'nope' }) })
    if (unknownProvider.status !== 400) throw new Error('an unknown provider was accepted')
    const badRef = await send('/config/save', { method: 'POST', body: JSON.stringify({ keyRef: '1bad' }) })
    if (badRef.status !== 400) throw new Error('a bad key reference was accepted')
    const badFormat = await send('/config/save', { method: 'POST', body: JSON.stringify({ editFormat: 'nope' }) })
    if (badFormat.status !== 400) throw new Error('an unknown edit format was accepted')
    const stored = await send('/config/save', { method: 'POST', body: JSON.stringify({ size: '1792x1024', quality: 'high' }) })
    if (!stored.ok) throw new Error('a valid patch was refused: ' + await stored.text())
    const body = await stored.json()
    if (body.config.size !== '1792x1024' || body.config.quality !== 'high') throw new Error('the patch was not stored')
    return '4 cases'
  })

  await check('a request body above the JSON limit is refused', async () => {
    const r = await send('/config/save', { method: 'POST', body: JSON.stringify({ model: 'x'.repeat(1024 * 1024 + 64) }) })
    if (r.status !== 413) throw new Error('expected 413, got ' + String(r.status))
    const body = await r.json()
    if (typeof body.error !== 'string' || !body.error.includes('大小限制')) throw new Error('unhelpful error: ' + String(body.error))
    return body.error
  })

  await check('a malformed JSON body is refused', async () => {
    const r = await fetch(base + '/config/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    const body = await r.json()
    if (!String(body.error).includes('JSON')) throw new Error('unhelpful error: ' + String(body.error))
    return body.error
  })

  await check('a non-object JSON body is refused', async () => {
    const r = await fetch(base + '/config/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' })
    if (r.status !== 400) throw new Error('expected 400, got ' + String(r.status))
    return 'a JSON array was refused'
  })

  await check('an unknown panel route answers 404', async () => {
    const r = await fetch(base + '/nope')
    if (r.status !== 404) throw new Error('expected 404, got ' + String(r.status))
    if (!(await r.text()).includes('unknown panel route')) throw new Error('the 404 body is not actionable')
    return 'unknown panel route'
  })

  await check('a mutation with the wrong method answers 405 and names the allowed one', async () => {
    const r = await fetch(base + '/generate')
    if (r.status !== 405) throw new Error('expected 405, got ' + String(r.status))
    if (r.headers.get('allow') !== 'POST') throw new Error('Allow is ' + String(r.headers.get('allow')))
    return 'Allow: POST'
  })

  await check('a cross-site mutation is refused', async () => {
    const r = await fetch(base + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ prompt: 'a red cube' }),
    })
    if (r.status !== 403) throw new Error('expected 403, got ' + String(r.status))
    return 'cross-origin mutation rejected'
  })

  await check('a same-origin mutation is accepted', async () => {
    const r = await fetch(base + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ prompt: 'a green pyramid' }),
    })
    if (r.status !== 200) throw new Error('a same-origin POST was refused: HTTP ' + String(r.status))
    return 'accepted'
  })

  await check('a GET never requires the origin guard', async () => {
    const r = await fetch(base + '/gallery', { headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } })
    if (!r.ok) throw new Error('a read was refused: HTTP ' + String(r.status))
    return 'reads stay open'
  })

  await check('every registration is disposed on teardown', async () => {
    if (registrations.length !== 1) throw new Error('expected one effect, saw ' + String(registrations.length))
    for (const entry of registrations) entry.dispose()
    if (route !== null) throw new Error('a disposed effect left its route registered')
    return String(registrations.length) + ' effect(s)'
  })
} finally {
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => upstream.close(resolve))
  await new Promise((resolve) => comfy.close(resolve))
  rmSync(dataDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.log('\n' + String(failures.length) + ' FAILURE(S): ' + failures.join(', '))
  process.exit(1)
}
console.log('\nAll packaged host-half routes pass.')
