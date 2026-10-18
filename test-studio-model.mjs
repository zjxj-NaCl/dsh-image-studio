/**
 * Unit tests for the browser-side panel model.
 *
 * This module is pure: no network, no disk, no DOM. Everything the browser half
 * sends to the host is validated here first, so these cases pin the exact
 * messages a user sees when a field is wrong.
 *
 *   node packages/dsh-image-studio/test-studio-model.mjs
 */
import assert from 'node:assert/strict'

import {
  ASPECT_RATIOS,
  GENERATE_COUNTS,
  IMAGE_SIZES,
  MAX_REFERENCE_BYTES,
  QUALITY_VALUES,
  REFERENCE_LIMIT,
  REFERENCE_TYPES,
  RESULT_LIMIT,
  SIZE_PRESETS,
  STUDIO_MODES,
  MODE_LABELS,
  activeResult,
  comfyPayload,
  configPayload,
  createWorkspace,
  formFromConfig,
  formatBytes,
  formatElapsed,
  formatTime,
  generatePayload,
  imageUrl,
  isCredentialRefName,
  normalizeCount,
  normalizeMode,
  previewBatch,
  progressStage,
  referenceFromName,
  resultImages,
  splitDataUrl,
  validateReferenceFile,
  workspace,
} from './src/studio-model.js'

const cases = []
const test = (name, fn) => { cases.push({ name, fn }) }

const PROVIDERS = [
  { id: 'openai-compat', apiKeyRef: 'DSH_IMAGE_STUDIO_API_KEY', baseURL: '', editFormats: ['multipart', 'jsonImageUrlArray'] },
  { id: 'google', apiKeyRef: 'GEMINI_API_KEY', baseURL: 'https://example.test/interactions', editFormats: [] },
]
const EDIT_FORMATS = ['multipart', 'jsonImageUrlArray', 'formReferenceImages', 'xaiJson']

test('the published constants stay in step with the host', () => {
  assert.equal(REFERENCE_LIMIT, 4)
  assert.equal(MAX_REFERENCE_BYTES, 32 * 1024 * 1024)
  assert.deepEqual(REFERENCE_TYPES, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  assert.ok(SIZE_PRESETS.includes('auto'))
  assert.ok(ASPECT_RATIOS.includes('16:9'))
  assert.deepEqual(IMAGE_SIZES, ['1K', '2K', '4K'])
  assert.deepEqual(QUALITY_VALUES, ['low', 'medium', 'high', 'auto'])
})

test('a credential reference name is an environment-variable shape', () => {
  assert.equal(isCredentialRefName('DSH_IMAGE_STUDIO_API_KEY'), true)
  assert.equal(isCredentialRefName('_a1'), true)
  for (const bad of ['1abc', 'a-b', 'a b', '', 'a.b', 42, null, undefined]) {
    assert.equal(isCredentialRefName(bad), false, 'accepted ' + JSON.stringify(bad))
  }
})

test('an image URL is same-origin, escaped, and refuses traversal', () => {
  assert.equal(imageUrl('img-1.png'), '/image-studio/image?name=img-1.png')
  assert.equal(imageUrl('a b.png'), '/image-studio/image?name=a%20b.png')
  for (const bad of ['../secret.png', 'a/b.png', 'C:\\gallery\\img-1.png', 'a:b.png', '', null, undefined]) {
    assert.equal(imageUrl(bad), '', 'accepted ' + JSON.stringify(bad))
  }
  assert.equal(referenceFromName('img-1.png', 'image/png')?.url, '/image-studio/image?name=img-1.png')
  assert.equal(referenceFromName('../x.png'), null)
})

test('the form starts empty and adopts whatever the host reported', () => {
  const blank = formFromConfig()
  assert.equal(blank.provider, '')
  assert.equal(blank.apiKey, '', 'the secret field always starts empty')
  const form = formFromConfig({ provider: 'google', model: 'gemini-3-pro-image', keyRef: 'GEMINI_API_KEY', editFormat: 'multipart', size: '1024x1024' })
  assert.equal(form.provider, 'google')
  assert.equal(form.model, 'gemini-3-pro-image')
  assert.equal(form.keyRef, 'GEMINI_API_KEY')
  assert.equal(form.apiKey, '')
})

test('a configuration is validated into a patch plus an optional secret', () => {
  const result = configPayload(
    { provider: 'openai-compat', baseURL: ' https://api.example.test/v1 ', model: ' stub ', keyRef: 'MY_KEY', editFormat: 'multipart', apiKey: ' sk-live ' },
    PROVIDERS,
    EDIT_FORMATS,
  )
  assert.deepEqual(result.patch, {
    provider: 'openai-compat',
    baseURL: 'https://api.example.test/v1',
    model: 'stub',
    keyRef: 'MY_KEY',
    editFormat: 'multipart',
    size: '',
    quality: '',
    aspectRatio: '',
    imageSize: '',
    workflow: '',
    comfyBaseUrl: '',
    agentBaseUrl: '',
  })
  assert.equal(result.apiKey, 'sk-live')
})

test('a blank configuration is refused field by field', () => {
  assert.throws(() => configPayload({ ...formFromConfig(), provider: '' }, PROVIDERS, EDIT_FORMATS), /请选择图像服务/)
  assert.throws(
    () => configPayload({ ...formFromConfig(), provider: 'unknown' }, PROVIDERS, EDIT_FORMATS),
    /未知的图像服务：unknown/,
  )
  assert.throws(
    () => configPayload({ ...formFromConfig(), provider: 'openai-compat', keyRef: '1bad' }, PROVIDERS, EDIT_FORMATS),
    /密钥引用名只能由字母、数字和下划线组成/,
  )
  assert.throws(
    () => configPayload({ ...formFromConfig(), provider: 'openai-compat', editFormat: 'nope' }, PROVIDERS, EDIT_FORMATS),
    /未知的编辑格式：nope/,
  )
  assert.throws(
    () => configPayload({ ...formFromConfig(), provider: 'openai-compat', baseURL: 'api.example.test/v1' }, PROVIDERS, EDIT_FORMATS),
    /图像服务地址必须是完整的绝对 URL/,
  )
})

test('an unknown edit format is accepted when no catalog has arrived yet', () => {
  const result = configPayload({ ...formFromConfig(), provider: 'openai-compat', editFormat: 'multipart' }, PROVIDERS, [])
  assert.equal(result.patch.editFormat, 'multipart')
})

test('a reference file is checked by type and size before it is read', () => {
  assert.equal(validateReferenceFile({ type: 'image/png', size: 1024 }), 'image/png')
  assert.equal(validateReferenceFile({ type: 'IMAGE/JPEG', size: 10 }), 'image/jpeg')
  assert.throws(() => validateReferenceFile(null), /请选择一张参考图/)
  assert.throws(() => validateReferenceFile({ type: 'image/svg+xml', size: 10 }), /参考图必须是 PNG、JPEG、WebP 或 GIF/)
  assert.throws(
    () => validateReferenceFile({ type: 'image/png', size: MAX_REFERENCE_BYTES + 1 }),
    /单张参考图不能超过 32 MB/,
  )
})

test('a data URL is split into payload and media type', () => {
  assert.deepEqual(splitDataUrl('data:image/png;base64,AAAA'), { mediaType: 'image/png', data: 'AAAA' })
  assert.deepEqual(splitDataUrl('data:IMAGE/PNG;base64,AA=='), { mediaType: 'image/png', data: 'AA==' })
  assert.throws(() => splitDataUrl('not-a-data-url'), /参考图读取失败，请重新选择/)
  assert.throws(() => splitDataUrl(''), /参考图读取失败/)
})

test('a generation request is validated before it reaches the host', () => {
  const form = { provider: 'openai-compat', model: 'stub', prompt: ' a red cube ', negative: ' blurry ', size: '1024x1024', quality: 'high' }
  const reference = { data: 'AAAA', mediaType: 'image/png' }
  // Default mode is text-to-image: references are dropped rather than sent.
  assert.deepEqual(generatePayload(form, [reference]), {
    provider: 'openai-compat',
    mode: 'generate',
    model: 'stub',
    prompt: 'a red cube',
    negative: 'blurry',
    size: '1024x1024',
    quality: 'high',
    aspectRatio: '',
    imageSize: '',
    count: 1,
    referenceImages: [],
  })
  // Image-to-image keeps the references it was given.
  assert.deepEqual(generatePayload({ ...form, mode: 'edit' }, [reference]), {
    provider: 'openai-compat',
    mode: 'edit',
    model: 'stub',
    prompt: 'a red cube',
    negative: 'blurry',
    size: '1024x1024',
    quality: 'high',
    aspectRatio: '',
    imageSize: '',
    count: 1,
    referenceImages: [reference],
  })
})

test('the mode switch decides which endpoint a prompt reaches', () => {
  const form = { provider: 'openai-compat', model: 'stub', prompt: 'x' }
  assert.deepEqual(STUDIO_MODES, ['generate', 'edit', 'comfy'])
  assert.equal(MODE_LABELS.generate, '文生图')
  assert.equal(MODE_LABELS.edit, '图生图')
  assert.equal(MODE_LABELS.comfy, 'ComfyUI 工作流')
  // An unknown or missing mode falls back to text-to-image.
  assert.equal(normalizeMode('edit'), 'edit')
  assert.equal(normalizeMode('generate'), 'generate')
  assert.equal(normalizeMode('comfy'), 'comfy')
  assert.equal(normalizeMode('nope'), 'generate')
  assert.equal(normalizeMode(undefined), 'generate')
  assert.equal(formFromConfig({}).mode, 'generate')
  // Image-to-image without a reference is refused instead of silently degenerating.
  assert.throws(() => generatePayload({ ...form, mode: 'edit' }, []), /图生图至少需要一张参考图/)
})

test('a ComfyUI submission carries one workflow and at most one init image', () => {
  const reference = { name: 'a.png', data: 'AAAA', mediaType: 'image/png' }
  const form = { prompt: 'a red cube', workflow: 'sd35_large', negative: 'blurry' }
  assert.deepEqual(comfyPayload(form, []), {
    workflow: 'sd35_large',
    prompt: 'a red cube',
    negative: 'blurry',
    reference: null,
  })
  assert.deepEqual(comfyPayload({ ...form, workflow: '  sd35_large  ' }, [reference]).workflow, 'sd35_large')
  // The address typed on the studio surface rides along with the submission, so a
  // run needs no saved configuration first.
  assert.deepEqual(comfyPayload({ ...form, comfyBaseUrl: '  http://127.0.0.1:9000  ' }, []).baseUrl, 'http://127.0.0.1:9000')
  assert.equal(Object.hasOwn(comfyPayload({ ...form, comfyBaseUrl: '   ' }, []), 'baseUrl'), false, 'a blank address must not override the saved one')
  assert.equal(Object.hasOwn(comfyPayload(form, []), 'baseUrl'), false)
  const body = comfyPayload(form, [reference])
  assert.deepEqual(body.reference, { data: 'AAAA', mediaType: 'image/png', name: 'a.png' })
  // ComfyUI edit workflows take a single init image; the rest are dropped.
  assert.deepEqual(comfyPayload(form, [reference, { name: 'b.png', data: 'BBBB', mediaType: 'image/png' }]).reference.name, 'a.png')
  assert.throws(() => comfyPayload({ ...form, prompt: '   ' }, []), /请输入提示词/)
  assert.throws(() => comfyPayload({ prompt: 'x', workflow: '  ' }, []), /请先在「生成方式」中选择一个 ComfyUI 工作流/)
  assert.throws(() => comfyPayload({ prompt: 'x', workflow: 'sd15' }, [{ name: 'a.png', mediaType: 'image/png' }]), /参考图数据不完整，请重新选择/)
})

test('the workspace switch keeps the picked references', () => {
  const ws = createWorkspace()
  assert.equal(ws.get().form.mode, 'generate')
  ws.setReferences([{ name: 'a.png', data: 'AAAA', mediaType: 'image/png' }])
  ws.setMode('edit')
  assert.equal(ws.get().form.mode, 'edit')
  assert.equal(ws.get().references.length, 1)
  ws.setMode('nope')
  assert.equal(ws.get().form.mode, 'generate')
  ws.setMode('edit')
  ws.setBusy(true)
  ws.setMode('generate')
  assert.equal(ws.get().form.mode, 'edit')
  ws.setBusy(false)
})

test('a batch size is clamped into the range the panel offers', () => {
  const form = { provider: 'openai-compat', model: 'stub', prompt: 'x' }
  const countOf = (value) => generatePayload({ ...form, count: value }, []).count
  assert.deepEqual(GENERATE_COUNTS, [1, 2, 3, 4])
  assert.equal(normalizeCount('3'), 3)
  assert.equal(normalizeCount(4), 4)
  assert.equal(countOf('2'), 2)
  assert.equal(countOf(undefined), 1)
  assert.equal(countOf(''), 1)
  assert.equal(countOf('0'), 1)
  assert.equal(countOf(-5), 1)
  assert.equal(countOf('nonsense'), 1)
  assert.equal(countOf('9'), 4)
  assert.equal(countOf(2.9), 2)
})

test('a finished batch becomes the newest result and resets the stage', () => {
  const ws = createWorkspace()
  ws.setBusy(true)
  ws.setResult({
    provider: 'google', model: 'stub', mode: 'generate', count: 2, elapsedMs: 1200,
    image: { name: 'img-a.png', bytes: 10 },
    images: [{ name: 'img-a.png', bytes: 10 }, { name: 'img-b.png', bytes: 20 }],
  })
  const state = ws.get()
  assert.equal(state.busy, false)
  assert.equal(state.uncertain, false)
  assert.equal(state.results.length, 1)
  assert.equal(state.results[0].key, state.active)
  assert.equal(state.activeImage, 'img-a.png')
  assert.deepEqual(resultImages(state.results[0]).map((image) => image.name), ['img-a.png', 'img-b.png'])
  assert.equal(activeResult(state).image.name, 'img-a.png')
  const batch = previewBatch(state)
  assert.equal(batch.images.length, 2)
  assert.equal(batch.primary.name, 'img-a.png')
  ws.setActiveImage('img-b.png')
  assert.equal(previewBatch(ws.get()).primary.name, 'img-b.png')
})

test('the session result list is deduplicated, capped, and reselectable', () => {
  const ws = createWorkspace()
  const entry = (name) => ({
    provider: 'google', model: 'stub', mode: 'generate', elapsedMs: 10,
    image: { name, bytes: 1 }, images: [{ name, bytes: 1 }],
  })
  for (let index = 0; index < RESULT_LIMIT + 3; index += 1) ws.setResult(entry('img-' + String(index) + '.png'))
  assert.equal(ws.get().results.length, RESULT_LIMIT)
  assert.equal(ws.get().results[0].image.name, 'img-' + String(RESULT_LIMIT + 2) + '.png')
  // Re-running the same prompt replaces its old entry instead of adding a twin.
  const repeated = ws.get().results[1].image.name
  ws.setResult(entry(repeated))
  assert.equal(ws.get().results.length, RESULT_LIMIT)
  assert.equal(ws.get().results[0].image.name, repeated)
  assert.equal(ws.get().results.filter((item) => item.image.name === repeated).length, 1)
  const older = ws.get().results[2].key
  ws.setActive(older)
  assert.equal(ws.get().active, older)
  assert.equal(ws.get().activeImage, null)
  assert.equal(activeResult(ws.get()).key, older)
  // A stage with no results is empty rather than an error.
  assert.equal(activeResult({ results: [] }), null)
  assert.deepEqual(previewBatch({ results: [] }), { result: null, images: [], primary: null })
  assert.deepEqual(resultImages(null), [])
})

test('a generation is refused when the prompt, model, or references are wrong', () => {
  assert.throws(() => generatePayload({ provider: 'openai-compat', model: 'stub', prompt: '   ' }, []), /请输入提示词/)
  assert.throws(() => generatePayload({ provider: 'openai-compat', model: '', prompt: 'x' }, []), /请先在「模型配置」中填写模型名称/)
  assert.throws(
    () => generatePayload({ provider: 'openai-compat', model: 'stub', prompt: 'x' }, [{ data: '', mediaType: 'image/png' }]),
    /参考图数据不完整/,
  )
  const tooMany = Array.from({ length: REFERENCE_LIMIT + 1 }, () => ({ data: 'AA==', mediaType: 'image/png' }))
  assert.throws(
    () => generatePayload({ provider: 'openai-compat', model: 'stub', prompt: 'x' }, tooMany),
    /参考图最多 4 张/,
  )
})

test('byte counts and timestamps read the way a person expects', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(1024 * 1024 * 3), '3.0 MB')
  assert.equal(formatBytes(-1), '')
  assert.equal(formatBytes('nonsense'), '')
  assert.equal(formatTime(0), '')
  assert.equal(formatTime('nonsense'), '')
  assert.match(formatTime(Date.now()), /^\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.match(formatElapsed(Date.now()), /^\d+ 秒$|^\d+ 分 \d{2} 秒$/)
  assert.equal(formatElapsed(900), '1 秒')
  assert.equal(formatElapsed(65000), '1 分 05 秒')
  assert.equal(formatElapsed(-1), '')
  assert.equal(formatElapsed('nonsense'), '')
})

test('the progress estimate creeps but never claims to be finished', () => {
  const stages = [0, 2900, 5000, 20000, 60000, 200000].map((ms) => progressStage(ms))
  for (const stage of stages) {
    assert.equal(typeof stage.label, 'string')
    assert.ok(stage.label.length > 0)
    assert.ok(stage.ratio > 0 && stage.ratio < 1, 'ratio must stay strictly below 1')
  }
  // The estimate is monotone: waiting longer never rewinds the bar.
  for (let index = 1; index < stages.length; index += 1) {
    assert.ok(stages[index].ratio >= stages[index - 1].ratio)
  }
  assert.equal(progressStage(0).seconds, 0)
  assert.equal(progressStage(45000).seconds, 45)
  assert.equal(progressStage('nonsense').ratio, 0.08)
})

test('the in-flight wording names the right worker for each mode', () => {
  // A ComfyUI run never touches an image service, so no stage may say one is
  // generating — the user would look in the wrong place for a stalled job.
  const comfy = [0, 5000, 20000, 60000, 200000].map((ms) => progressStage(ms, 'comfy'))
  for (const stage of comfy) {
    assert.ok(!/图像服务/.test(stage.label), 'a ComfyUI stage blames an image service: ' + stage.label)
    assert.ok(stage.ratio > 0 && stage.ratio < 1)
  }
  assert.match(comfy[0].label, /工作流|ComfyUI/)
  assert.match(comfy[2].label, /ComfyUI/)
  // The image-service wording is unchanged for the other two modes.
  assert.equal(progressStage(5000).label, progressStage(5000, 'generate').label)
  assert.equal(progressStage(5000, 'edit').label, progressStage(5000).label)
  assert.match(progressStage(5000).label, /图像服务/)
})

test('the workspace keeps one secret-free configuration and gates tabs while busy', () => {
  const ws = createWorkspace()
  const state = ws.get()
  assert.equal(state.tab, 'studio')
  assert.deepEqual(state.providers, [])
  assert.deepEqual(state.references, [])
  assert.equal(state.result, null)
  assert.equal(state.form.apiKey, '')
  assert.equal(ws.get() === state, true, 'get returns the live state object')

  let notified = 0
  const stop = ws.subscribe(() => { notified += 1 })

  ws.applyConfig({
    providers: PROVIDERS,
    editFormats: EDIT_FORMATS,
    key: { ref: 'DSH_IMAGE_STUDIO_API_KEY', configured: false, writable: true },
    status: { ready: false },
    config: { provider: 'openai-compat', model: 'stub', keyRef: 'DSH_IMAGE_STUDIO_API_KEY', editFormat: 'multipart' },
  })
  assert.equal(ws.get().providers.length, 2)
  assert.equal(ws.get().form.model, 'stub')
  assert.equal(ws.get().key.configured, false)

  ws.setKey('sk-typed')
  assert.equal(ws.get().form.apiKey, 'sk-typed')
  assert.equal(ws.get().key.configured, false, 'typing a secret must not claim it is stored')

  ws.acceptSaved({ config: { provider: 'openai-compat', model: 'stub' }, key: { ref: 'DSH_IMAGE_STUDIO_API_KEY', configured: true } })
  assert.equal(ws.get().form.apiKey, '', 'a saved secret is dropped from the form')
  assert.equal(ws.get().key.configured, true)
  assert.equal(ws.get().notice, '模型配置已保存。')

  ws.chooseProvider('google')
  assert.equal(ws.get().form.provider, 'google')
  assert.equal(ws.get().form.baseURL, 'https://example.test/interactions')
  assert.equal(ws.get().form.keyRef, 'GEMINI_API_KEY')
  assert.equal(ws.get().form.editFormat, '', 'a provider without edit formats invents none')

  ws.setBusy(true)
  ws.setTab('config')
  assert.equal(ws.get().tab, 'studio', 'a running generation pins the tab')

  ws.setResult({ image: { name: 'img-1.png' } })
  assert.equal(ws.get().busy, false)
  assert.equal(ws.get().uncertain, false)
  assert.equal(ws.get().result.image.name, 'img-1.png')

  ws.setUncertain(true)
  assert.equal(ws.get().uncertain, true)
  assert.equal(ws.get().busy, false)

  const before = notified
  stop()
  ws.setField('prompt', 'x')
  assert.equal(notified, before, 'unsubscribing stops notifications')
  assert.equal(ws.get().form.prompt, 'x')
})

test('the model catalog belongs to one service and is dropped with it', () => {
  const ws = createWorkspace()
  const state = ws.get()
  assert.deepEqual(state.models, [])
  assert.equal(state.modelsFor, '')
  assert.equal(state.modelsBusy, false)
  assert.equal(state.modelsError, null)

  ws.applyConfig({ providers: PROVIDERS, editFormats: EDIT_FORMATS, config: { provider: 'openai-compat' } })
  assert.equal(ws.get().form.provider, 'openai-compat')

  ws.setModelsBusy(true)
  assert.equal(ws.get().modelsBusy, true)
  assert.equal(ws.get().modelsError, null)

  ws.setModels('openai-compat', ['gpt-image-2', null, 'seedream-5-0-260128', 'gpt-image-2', 42])
  assert.deepEqual(ws.get().models, ['gpt-image-2', 'seedream-5-0-260128'], 'a catalog is normalized to unique strings')
  assert.equal(ws.get().modelsFor, 'openai-compat')
  assert.equal(ws.get().modelsBusy, false, 'a settled catalog clears the busy flag')
  assert.equal(ws.get().modelsError, null)

  ws.setModelsError('读取失败', 'openai-compat')
  assert.deepEqual(ws.get().models, [], 'a failed read drops the stale catalog')
  assert.equal(ws.get().modelsFor, 'openai-compat')
  assert.equal(ws.get().modelsError, '读取失败')

  ws.setModels('openai-compat', ['gpt-image-2'])
  assert.equal(ws.get().modelsError, null, 'a later success clears the previous error')

  ws.chooseProvider('google')
  assert.deepEqual(ws.get().models, [], 'switching service drops a catalog that belongs to the old one')
  assert.equal(ws.get().modelsFor, '')
  assert.equal(ws.get().modelsBusy, false)
  assert.equal(ws.get().modelsError, null)

  ws.setModels('openai-compat', ['stale-model'])
  ws.acceptSaved({ config: { provider: 'google', model: 'gemini-x' }, key: { ref: 'GEMINI_API_KEY', configured: true } })
  assert.deepEqual(ws.get().models, ['stale-model'], 'saving a config keeps the catalog in the state layer')
  assert.equal(ws.get().form.model, 'gemini-x')
})

test('the workflow catalog records what the local ComfyUI reported', () => {
  const ws = createWorkspace()
  const state = ws.get()
  assert.deepEqual(ws.get().workflows, [])
  assert.equal(state.workflowsLoaded, false)
  assert.equal(state.workflowsBusy, false)
  assert.equal(state.workflowsError, null)
  assert.equal(state.workflowsFor, '', 'no address has been read yet')

  ws.setWorkflowsBusy(true)
  assert.equal(ws.get().workflowsBusy, true)
  assert.equal(ws.get().workflowsError, null)

  ws.setWorkflows([
    { name: 'SD 3.5 Large', path: 'duck.json' },
    { name: 'nameless', path: '   ' },
    null,
    { name: 'pathless' },
    { name: 'sd15', path: 'sd15.json' },
  ], '  http://127.0.0.1:9000  ')
  assert.deepEqual(ws.get().workflows.map((entry) => entry.path), ['duck.json', 'sd15.json'], 'only entries with a path survive')
  assert.equal(ws.get().workflowsFor, 'http://127.0.0.1:9000', 'the catalog remembers the address it came from')
  assert.equal(ws.get().workflowsLoaded, true)
  assert.equal(ws.get().workflowsBusy, false)
  assert.equal(ws.get().workflowsError, null)

  ws.setWorkflowsError('读取失败')
  assert.deepEqual(ws.get().workflows, [], 'a failed read drops the stale catalog')
  assert.equal(ws.get().workflowsLoaded, true, 'a failed read still counts as a settled attempt')
  assert.equal(ws.get().workflowsBusy, false)
  assert.equal(ws.get().workflowsError, '读取失败')

  ws.setWorkflows([{ name: 'sd15', path: 'sd15.json' }])
  assert.equal(ws.get().workflowsError, null, 'a later success clears the previous error')

  ws.acceptSaved({ config: { provider: 'google', model: 'gemini-x' }, key: { ref: 'GEMINI_API_KEY', configured: true } })
  assert.deepEqual(ws.get().workflows.map((entry) => entry.path), ['sd15.json'], 'saving a config keeps the catalog in the state layer')
})

test('the exported workspace is a single shared store', () => {
  assert.equal(typeof workspace.get, 'function')
  assert.equal(typeof workspace.subscribe, 'function')
  assert.notEqual(workspace, createWorkspace())
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
console.log('\nThe panel model validates every field before it leaves the browser.')
