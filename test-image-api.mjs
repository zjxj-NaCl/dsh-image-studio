/**
 * Unit tests for the host-side image API adapters.
 *
 * Every case runs against a local stub HTTP server, so the assertions are about
 * the exact wire contract the panel sends and the normalization it does on the
 * way back — no provider account and no network access are involved.
 *
 *   node packages/dsh-image-studio/test-image-api.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'

import {
  EDIT_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_MODEL_IDS,
  MODEL_LIST_TIMEOUT_MS,
  PROVIDERS,
  decodeBase64,
  detectImageMediaType,
  editImage,
  extensionFor,
  generateImage,
  googleModelsEndpoint,
  imageEndpoint,
  imageMediaType,
  isCredentialRefName,
  listModels,
  modelsEndpoint,
  parseModelIds,
  providerById,
  rankModelIds,
  redactSecrets,
  requireProvider,
} from './src/image-api.js'

/** Collected cases, run in order by the small harness at the bottom. */
const cases = []
const test = (name, fn) => { cases.push({ name, fn }) }

/** A 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** A tiny JPEG header, enough for the magic-number check. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

/** A reference image in the shape `editImage` expects. */
const REFERENCE = { data: new Uint8Array(PNG), mediaType: 'image/png' }

/** Run `body` against a throwaway HTTP server that records every request. */
async function withServer(handler, body) {
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const record = { method: req.method, url: req.url, headers: req.headers, body: raw, text: raw.toString('utf8') }
      requests.push(record)
      try {
        handler(record, res)
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(String(error))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + String(server.address().port)
  try {
    return await body(origin, requests)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/** Answer with a JSON body. */
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
}

test('the provider registry is complete and self-consistent', () => {
  assert.equal(MAX_IMAGE_BYTES, 32 * 1024 * 1024)
  assert.equal(EDIT_FORMATS.length, 4)
  assert.deepEqual([...PROVIDERS.map((entry) => entry.id)].sort(), [
    'dashscope', 'google', 'openai', 'openai-compat', 'seedream', 'xai', 'zhipu',
  ])
  const seen = new Set()
  for (const provider of PROVIDERS) {
    assert.equal(seen.has(provider.id), false, 'duplicate provider id ' + provider.id)
    seen.add(provider.id)
    assert.ok(['openai', 'google'].includes(provider.family), provider.id + ' has an unknown family')
    assert.equal(typeof provider.label, 'string')
    assert.equal(typeof provider.baseURL, 'string')
    assert.ok(isCredentialRefName(provider.apiKeyRef), provider.id + ' has an unusable key reference')
    for (const format of provider.editFormats) {
      assert.ok(EDIT_FORMATS.includes(format), provider.id + ' lists an unknown edit format ' + format)
    }
  }
  assert.equal(providerById('openai').family, 'openai')
  assert.equal(providerById('nope'), undefined)
  assert.equal(requireProvider('google').family, 'google')
  assert.throws(() => requireProvider('nope'), /未知的图像服务：nope/)
})

test('a credential reference name is an environment-variable shape', () => {
  assert.equal(isCredentialRefName('DSH_IMAGE_STUDIO_API_KEY'), true)
  assert.equal(isCredentialRefName('_x'), true)
  assert.equal(isCredentialRefName('a1'), true)
  for (const bad of ['1abc', 'a-b', 'a b', '', '   ', 'a.b', 42, null, undefined, {}]) {
    assert.equal(isCredentialRefName(bad), false, 'accepted ' + JSON.stringify(bad))
  }
})

test('an endpoint is built onto the base URL and refuses nonsense', () => {
  assert.equal(imageEndpoint('https://api.x.ai/v1', 'generations'), 'https://api.x.ai/v1/images/generations')
  assert.equal(imageEndpoint('https://api.x.ai/v1/', 'edits'), 'https://api.x.ai/v1/images/edits')
  assert.throws(() => imageEndpoint('', 'generations'), /图像服务地址不能为空/)
  assert.throws(() => imageEndpoint('undefined', 'generations'), /图像服务地址必须是完整的绝对 URL/)
  assert.throws(() => imageEndpoint('ftp://host/v1', 'generations'), /图像服务地址必须是 http\(s\) URL/)
})

test('a generation speaks images/generations and returns normalized bytes', async () => {
  await withServer((request, res) => {
    json(res, 200, { data: [{ b64_json: PNG.toString('base64'), mime_type: 'image/png' }] })
  }, async (origin, requests) => {
    const image = await generateImage({
      provider: 'openai-compat',
      apiKey: 'secret-value',
      baseURL: origin + '/v1',
      model: 'stub-model',
      prompt: 'a red cube',
      size: '1024x1024',
    })
    assert.equal(requests.length, 1)
    const request = requests[0]
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/v1/images/generations')
    assert.equal(request.headers.authorization, 'Bearer secret-value')
    assert.equal(request.headers['content-type'], 'application/json')
    const sent = JSON.parse(request.text)
    assert.equal(sent.model, 'stub-model')
    assert.equal(sent.prompt, 'a red cube')
    assert.equal(sent.size, '1024x1024')
    assert.equal(sent.quality, undefined, 'a provider without quality support must not receive it')
    assert.equal(image.mediaType, 'image/png')
    assert.equal(Buffer.from(image.data).toString('hex'), PNG.toString('hex'))
  })
})

test('a provider that takes no pixel size never receives one', async () => {
  await withServer((request, res) => {
    json(res, 200, { data: [{ b64_json: PNG.toString('base64') }] })
  }, async (origin, requests) => {
    await generateImage({
      provider: 'xai',
      apiKey: 'k',
      baseURL: origin + '/v1',
      model: 'grok-image',
      prompt: 'a blue sphere',
      size: '1024x1024',
      quality: 'high',
    })
    const sent = JSON.parse(requests[0].text)
    assert.equal(sent.size, undefined)
    assert.equal(sent.quality, undefined)
  })
})

test('a seedream generation asks for a URL instead of inline base64', async () => {
  await withServer((request, res) => {
    json(res, 200, { data: [{ b64_json: PNG.toString('base64') }] })
  }, async (origin, requests) => {
    await generateImage({ provider: 'seedream', apiKey: 'k', baseURL: origin + '/v1', model: 'm', prompt: 'p' })
    assert.equal(JSON.parse(requests[0].text).response_format, 'url')
  })
})

test('a URL answer is followed and downloaded', async () => {
  await withServer((request, res) => {
    if (request.url === '/v1/images/generations') {
      json(res, 200, { data: [{ url: 'http://' + request.headers.host + '/img.png' }] })
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(PNG)
  }, async (origin, requests) => {
    const image = await generateImage({
      provider: 'openai', apiKey: 'k', baseURL: origin + '/v1', model: 'm', prompt: 'p',
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[1].url, '/img.png')
    assert.equal(image.mediaType, 'image/png')
    assert.equal(image.data.length, PNG.length)
  })
})

test('an inline data URL answer is decoded without a second request', async () => {
  await withServer((request, res) => {
    json(res, 200, { data: [{ url: 'data:image/png;base64,' + PNG.toString('base64') }] })
  }, async (origin, requests) => {
    const image = await generateImage({ provider: 'openai', apiKey: 'k', baseURL: origin + '/v1', model: 'm', prompt: 'p' })
    assert.equal(requests.length, 1)
    assert.equal(image.mediaType, 'image/png')
    assert.equal(Buffer.from(image.data).toString('hex'), PNG.toString('hex'))
  })
})

test('a Google generation uses the interactions envelope and its own header', async () => {
  await withServer((request, res) => {
    json(res, 200, { output_image: { data: PNG.toString('base64'), mime_type: 'image/png' } })
  }, async (origin, requests) => {
    const image = await generateImage({
      provider: 'google',
      apiKey: 'google-secret',
      baseURL: origin + '/v1beta/interactions',
      model: 'gemini-3-pro-image',
      prompt: 'a green pyramid',
      aspectRatio: '16:9',
      imageSize: '2K',
    })
    const request = requests[0]
    assert.equal(request.url, '/v1beta/interactions')
    assert.equal(request.headers['x-goog-api-key'], 'google-secret')
    assert.equal(request.headers.authorization, undefined)
    const sent = JSON.parse(request.text)
    assert.equal(sent.input, 'a green pyramid')
    assert.deepEqual(sent.response_format, { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '2K' })
    assert.equal(image.mediaType, 'image/png')
    assert.equal(Buffer.from(image.data).toString('hex'), PNG.toString('hex'))
  })
})

test('a Google answer found in a model_output step is accepted', async () => {
  await withServer((request, res) => {
    json(res, 200, { steps: [{ type: 'other' }, { type: 'model_output', content: [{ type: 'text' }, { type: 'image', data: PNG.toString('base64'), mime_type: 'image/png' }] }] })
  }, async (origin) => {
    const image = await generateImage({ provider: 'google', apiKey: 'k', baseURL: origin + '/interactions', model: 'm', prompt: 'p' })
    assert.equal(Buffer.from(image.data).toString('hex'), PNG.toString('hex'))
  })
})

test('every edit wire shape is sent the way the provider expects', async () => {
  const cases = [
    ['multipart', (request) => {
      assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/)
      assert.match(request.text, /name="model"/)
      assert.match(request.text, /name="prompt"/)
      assert.match(request.text, /name="image"; filename="reference-1\.png"/)
    }],
    ['jsonImageUrlArray', (request) => {
      assert.equal(request.headers['content-type'], 'application/json')
      const sent = JSON.parse(request.text)
      assert.equal(sent.images.length, 1)
      assert.match(sent.images[0].image_url, /^data:image\/png;base64,/)
      assert.equal(sent.n, 1)
      assert.equal(sent.response_format, 'url')
    }],
    ['formReferenceImages', (request) => {
      assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/)
      assert.match(request.text, /name="reference_images"/)
      assert.ok(request.text.includes(PNG.toString('base64')))
    }],
    ['xaiJson', (request) => {
      assert.equal(request.headers['content-type'], 'application/json')
      const sent = JSON.parse(request.text)
      assert.equal(sent.image.type, 'image_url')
      assert.match(sent.image.url, /^data:image\/png;base64,/)
    }],
  ]
  for (const [format, inspect] of cases) {
    await withServer((request, res) => {
      json(res, 200, { data: [{ b64_json: PNG.toString('base64') }] })
    }, async (origin, requests) => {
      const image = await editImage({
        provider: 'openai-compat',
        apiKey: 'k',
        baseURL: origin + '/v1',
        model: 'm',
        prompt: 'make it blue',
        referenceImages: [REFERENCE],
        editFormat: format,
      })
      assert.equal(requests.length, 1, format + ' made the wrong number of requests')
      assert.equal(requests[0].url, '/v1/images/edits', format + ' used the wrong endpoint')
      inspect(requests[0])
      assert.equal(image.mediaType, 'image/png')
    })
  }
})

test('a provider refuses an edit format it does not implement', async () => {
  await withServer((request, res) => {
    json(res, 200, { data: [{ b64_json: PNG.toString('base64') }] })
  }, async (origin, requests) => {
    await assert.rejects(
      editImage({
        provider: 'seedream',
        apiKey: 'k',
        baseURL: origin + '/v1',
        model: 'm',
        prompt: 'p',
        referenceImages: [REFERENCE],
        editFormat: 'xaiJson',
      }),
      /不支持所选的编辑格式：xaiJson/,
    )
    assert.equal(requests.length, 0, 'an unsupported format must not reach the network')
  })
})

test('a Google edit labels multiple references in order', async () => {
  await withServer((request, res) => {
    json(res, 200, { output_image: { data: PNG.toString('base64'), mime_type: 'image/png' } })
  }, async (origin, requests) => {
    await editImage({
      provider: 'google',
      apiKey: 'k',
      baseURL: origin + '/interactions',
      model: 'm',
      prompt: 'merge these',
      referenceImages: [REFERENCE, { data: new Uint8Array(JPEG), mediaType: 'image/jpeg' }],
    })
    const sent = JSON.parse(requests[0].text)
    assert.equal(sent.input.length, 5)
    assert.equal(sent.input[0].text, '图 1 (Image 1):')
    assert.equal(sent.input[1].mime_type, 'image/png')
    assert.equal(sent.input[2].text, '图 2 (Image 2):')
    assert.equal(sent.input[3].mime_type, 'image/jpeg')
    assert.equal(sent.input[4].text, 'merge these')
  })
})

test('upstream failures surface a redacted, actionable message', async () => {
  await withServer((request, res) => {
    json(res, 400, 'the key secret-value is not entitled to this model')
  }, async (origin) => {
    await assert.rejects(
      generateImage({ provider: 'openai', apiKey: 'secret-value', baseURL: origin + '/v1', model: 'm', prompt: 'p' }),
      (error) => {
        assert.match(error.message, /图像请求失败 \(400\)/)
        assert.match(error.message, /\[redacted\]/)
        assert.equal(error.message.includes('secret-value'), false, 'the API key leaked into an error')
        return true
      },
    )
  })
})

test('a malformed or empty upstream answer is rejected', async () => {
  await withServer((request, res) => json(res, 200, 'not json at all'), async (origin) => {
    await assert.rejects(
      generateImage({ provider: 'openai', apiKey: 'k', baseURL: origin + '/v1', model: 'm', prompt: 'p' }),
      /不是有效 JSON/,
    )
  })
  await withServer((request, res) => json(res, 200, { data: [] }), async (origin) => {
    await assert.rejects(
      generateImage({ provider: 'openai', apiKey: 'k', baseURL: origin + '/v1', model: 'm', prompt: 'p' }),
      /未返回图像数据/,
    )
  })
  await withServer((request, res) => json(res, 200, { steps: [] }), async (origin) => {
    await assert.rejects(
      generateImage({ provider: 'google', apiKey: 'k', baseURL: origin + '/interactions', model: 'm', prompt: 'p' }),
      /未返回图像/,
    )
  })
})

test('an oversized image is refused before it is stored', async () => {
  await withServer((request, res) => {
    json(res, 200, { data: [{ b64_json: PNG.toString('base64') }] })
  }, async (origin) => {
    await assert.rejects(
      generateImage({ provider: 'openai', apiKey: 'k', baseURL: origin + '/v1', model: 'm', prompt: 'p', maxBytes: 8 }),
      /超过 8 字节上限/,
    )
  })
})

test('the byte-level helpers behave', () => {
  assert.equal(redactSecrets('a secret-value b secret-value', 'secret-value'), 'a [redacted] b [redacted]')
  assert.equal(redactSecrets('unchanged', ''), 'unchanged')
  assert.equal(redactSecrets(undefined, 'x'), '')

  assert.equal(Buffer.from(decodeBase64(PNG.toString('base64'))).toString('hex'), PNG.toString('hex'))
  assert.equal(Buffer.from(decodeBase64('data:image/png;base64,' + PNG.toString('base64'))).toString('hex'), PNG.toString('hex'))
  assert.throws(() => decodeBase64(''), /图像数据为空/)

  assert.equal(detectImageMediaType(new Uint8Array(PNG)), 'image/png')
  assert.equal(detectImageMediaType(new Uint8Array(JPEG)), 'image/jpeg')
  assert.equal(detectImageMediaType(new Uint8Array(Buffer.from('GIF89a....', 'latin1'))), 'image/gif')
  assert.equal(detectImageMediaType(new Uint8Array(Buffer.from('RIFF....WEBPVP8 ', 'latin1'))), 'image/webp')
  assert.equal(detectImageMediaType(new Uint8Array(Buffer.from('nonsense', 'latin1'))), undefined)

  assert.equal(imageMediaType('image/jpeg; charset=binary'), 'image/jpeg')
  assert.equal(imageMediaType('IMAGE/JPG'), 'image/jpeg')
  assert.equal(imageMediaType('image/webp'), 'image/webp')
  assert.equal(imageMediaType('image/svg+xml'), undefined)

  assert.equal(extensionFor('image/jpeg'), 'jpg')
  assert.equal(extensionFor('image/webp'), 'webp')
  assert.equal(extensionFor('image/gif'), 'gif')
  assert.equal(extensionFor('image/png'), 'png')
})

test('a model catalog URL is built per family', () => {
  assert.equal(MODEL_LIST_TIMEOUT_MS, 15000)
  assert.equal(MAX_MODEL_IDS, 400)
  assert.equal(modelsEndpoint('https://relay.example/v1'), 'https://relay.example/v1/models')
  assert.equal(modelsEndpoint('https://relay.example/v1/'), 'https://relay.example/v1/models')
  assert.throws(() => modelsEndpoint(''), /图像服务地址不能为空/)
  assert.throws(() => modelsEndpoint('not a url'), /图像服务地址必须是完整的绝对 URL/)
  assert.throws(() => modelsEndpoint('ftp://example.com/v1'), /图像服务地址必须是 http\(s\) URL/)

  // Google swaps the operation segment for `models`, keeping the version path.
  assert.equal(
    googleModelsEndpoint('https://generativelanguage.googleapis.com/v1beta/interactions'),
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
  )
  assert.equal(
    googleModelsEndpoint('https://generativelanguage.googleapis.com/v1beta'),
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
  )
  assert.equal(
    googleModelsEndpoint('https://proxy.example/'),
    'https://proxy.example/models?pageSize=1000',
  )
  assert.throws(() => googleModelsEndpoint('nope'), /图像服务地址必须是完整的绝对 URL/)
})

test('a catalog payload is parsed per family and deduped', () => {
  assert.deepEqual(
    parseModelIds({ data: [{ id: 'gpt-image-2' }, { id: 'text-embedding-3' }] }, 'openai'),
    ['gpt-image-2', 'text-embedding-3'],
  )
  assert.deepEqual(parseModelIds({ models: [{ id: 'grok-2-image' }] }, 'openai'), ['grok-2-image'])
  assert.deepEqual(
    parseModelIds({ models: [{ name: 'models/gemini-3-pro-image' }, { name: 'gemini-2.5-flash' }] }, 'google'),
    ['gemini-3-pro-image', 'gemini-2.5-flash'],
  )
  assert.deepEqual(parseModelIds(null, 'openai'), [])
  assert.deepEqual(parseModelIds({ data: [{}] }, 'openai'), [])

  // Image-capable ids float to the top; everything else keeps its order behind them.
  assert.deepEqual(
    rankModelIds(['text-embedding-3', 'gpt-image-2', 'gpt-image-2', 'flux-pro', 'grok-2', '']),
    ['gpt-image-2', 'flux-pro', 'text-embedding-3', 'grok-2'],
  )
  assert.deepEqual(rankModelIds(undefined), [])
})

test('a model catalog is read from the provider with its own credentials', async () => {
  await withServer((request, res) => {
    json(res, 200, { data: [{ id: 'text-embedding-3' }, { id: 'gpt-image-2' }] })
  }, async (origin, requests) => {
    const models = await listModels({ provider: 'openai-compat', baseURL: origin + '/v1', apiKey: 'secret-value' })
    assert.deepEqual(models, ['gpt-image-2', 'text-embedding-3'])
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'GET')
    assert.equal(requests[0].url, '/v1/models')
    assert.equal(requests[0].headers.authorization, 'Bearer secret-value')
  })
})

test('a Google catalog is read with its own header and listing shape', async () => {
  await withServer((request, res) => {
    json(res, 200, { models: [{ name: 'models/imagen-4' }, { name: 'models/gemini-2.5-flash' }] })
  }, async (origin, requests) => {
    const models = await listModels({ provider: 'google', baseURL: origin + '/v1beta/interactions', apiKey: 'google-key' })
    assert.deepEqual(models, ['imagen-4', 'gemini-2.5-flash'])
    assert.equal(requests[0].url, '/v1beta/models?pageSize=1000')
    assert.equal(requests[0].headers['x-goog-api-key'], 'google-key')
    assert.equal(requests[0].headers.authorization, undefined)
  })
})

test('a catalog flood is truncated to the advertised ceiling', async () => {
  await withServer((request, res) => {
    const data = []
    for (let index = 0; index < MAX_MODEL_IDS + 50; index += 1) data.push({ id: 'model-' + String(index) })
    json(res, 200, { data })
  }, async (origin) => {
    const models = await listModels({ provider: 'openai-compat', baseURL: origin + '/v1', apiKey: 'secret-value' })
    assert.equal(models.length, MAX_MODEL_IDS)
  })
})

test('a failing model catalog is redacted and never throws raw', async () => {
  await withServer((request, res) => {
    json(res, 401, { error: { message: 'bad key secret-value' } })
  }, async (origin) => {
    await assert.rejects(
      () => listModels({ provider: 'openai-compat', baseURL: origin + '/v1', apiKey: 'secret-value' }),
      (error) => error.message.includes('读取模型列表失败 (401)') &&
        error.message.includes('[redacted]') &&
        !error.message.includes('secret-value'),
    )
  })

  await withServer((request, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('<html>not json</html>')
  }, async (origin) => {
    await assert.rejects(
      () => listModels({ provider: 'openai-compat', baseURL: origin + '/v1', apiKey: 'secret-value' }),
      /模型列表返回的不是有效 JSON/,
    )
  })

  await assert.rejects(() => listModels({ provider: 'nope' }), /未知的图像服务：nope/)
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
console.log('\nThe image API adapters speak every provider contract they advertise.')
