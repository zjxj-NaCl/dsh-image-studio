/**
 * Unit tests for the conversational ComfyUI tool.
 *
 * This module is pure: the ComfyUI run and the attachment store are injected,
 * so these cases pin exactly what the model sees — which fields travel back
 * into the conversation, and which deliberately do not.
 *
 *   node packages/dsh-image-studio/test-tool.mjs
 */
import assert from 'node:assert/strict'

import {
  IMAGE_VALUE_SCHEMA,
  OUTPUT_SCHEMA,
  TOOL_NAME,
  TOOL_TIMEOUT_MS,
  makeComfyTool,
  resolveDefineTool,
} from './src/tool.js'

const cases = []
const test = (name, fn) => { cases.push({ name, fn }) }

/** One image the ComfyUI pipeline produced, as the host hands it over. */
const FILE = {
  data: new Uint8Array([1, 2, 3, 4]),
  mediaType: 'image/png',
  name: 'img-20261015-101500-aabbcc.png',
}

/** A run result shaped exactly like `comfyRun`'s answer. */
function result(files) {
  return {
    ok: true,
    workflow: 'sd35_large.json',
    mode: 'comfy',
    baseUrl: 'http://127.0.0.1:8188',
    count: files.length,
    elapsedMs: 4200,
    files,
    images: files.length === 0
      ? []
      : [{ name: FILE.name, mediaType: 'image/png', bytes: 4, url: '/image-studio/image?name=img-20261015-101500-aabbcc.png' }],
  }
}

/** A successful save through the attachment store. */
const REF = {
  attachmentId: 'sha256:' + 'ab'.repeat(32),
  mediaType: 'image/png',
  bytes: 4,
  width: 1024,
  height: 1024,
  name: FILE.name,
  downloadUrl: '/not/exposed',
}

test('the tool advertises itself under a stable name and budget', () => {
  assert.equal(TOOL_NAME, 'comfyui_generate')
  assert.equal(TOOL_TIMEOUT_MS, 300000)
})

test('the output schema describes every field the model can receive', () => {
  assert.equal(OUTPUT_SCHEMA.type, 'object')
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false)
  for (const key of ['ok', 'workflow', 'count', 'elapsedMs', 'gallery', 'text']) {
    assert.equal(OUTPUT_SCHEMA.properties[key].required, true, key + ' must be reported always')
  }
  for (const key of ['image', 'note']) {
    assert.equal(OUTPUT_SCHEMA.properties[key].required, undefined, key + ' stays optional')
  }
})

test('the image schema asks for the fields the attachment store returns', () => {
  assert.equal(IMAGE_VALUE_SCHEMA.additionalProperties, false)
  for (const key of ['attachmentId', 'mediaType', 'bytes', 'width', 'height']) {
    assert.equal(IMAGE_VALUE_SCHEMA.properties[key].required, true, key)
  }
  assert.deepEqual(IMAGE_VALUE_SCHEMA.properties.mediaType.enum, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  assert.equal(Object.hasOwn(IMAGE_VALUE_SCHEMA.properties, 'downloadUrl'), false, 'no store internals are described')
})

test('only prompt, negative, workflow and baseUrl reach the run', async () => {
  const seen = []
  const tool = makeComfyTool({ run: async (body) => { seen.push(body); return result([]) } })
  await tool.execute({
    prompt: '  a duck  ',
    negative: 'blurry',
    workflow: ' sd15.json ',
    baseUrl: ' http://127.0.0.1:8189 ',
    surprisingExtra: 'ignored',
  })
  assert.deepEqual(seen, [{ prompt: '  a duck  ', negative: 'blurry', workflow: 'sd15.json', baseUrl: 'http://127.0.0.1:8189' }])
})

test('empty optional arguments are dropped rather than sent as blanks', async () => {
  const seen = []
  const tool = makeComfyTool({ run: async (body) => { seen.push(body); return result([]) } })
  await tool.execute({ prompt: 'a duck', negative: undefined, workflow: '   ', baseUrl: '', })
  assert.deepEqual(seen, [{ prompt: 'a duck' }])
})

test('a run with an image hands it back into the conversation', async () => {
  const admitted = []
  const tool = makeComfyTool({ run: async () => result([FILE]), admit: async (file) => { admitted.push(file); return REF } })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.deepEqual(admitted.map((file) => file.name), [FILE.name], 'the produced file is stored as an attachment')
  assert.equal(admitted[0].data, FILE.data, 'the bytes are handed over untouched')
  assert.equal(admitted[0].mediaType, 'image/png')
  assert.equal(value.image.attachmentId, REF.attachmentId)
  assert.equal(value.image.width, 1024)
  assert.equal(value.image.height, 1024)
  assert.equal(Object.hasOwn(value.image, 'downloadUrl'), false, 'store-only fields are dropped')
  assert.equal(value.count, 1)
  assert.equal(value.ok, true)
})

test('a failing attachment store degrades to the text summary', async () => {
  const tool = makeComfyTool({
    run: async () => result([FILE]),
    admit: async () => { throw new Error('no attachment service is mounted') },
  })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.equal(Object.hasOwn(value, 'image'), false, 'no image block is invented')
  assert.match(value.note, /no attachment service is mounted/)
  assert.match(value.text, /这次只回传文字摘要/, 'the summary says where the picture stayed')
  assert.match(value.text, /画廊文件：.*img-20261015-101500-aabbcc\.png/, 'the gallery name still reaches the model')
  assert.equal(value.count, 1, 'the run itself still succeeded')
})

test('a store that answers without an id degrades to the text summary', async () => {
  const tool = makeComfyTool({ run: async () => result([FILE]), admit: async () => ({ mediaType: 'image/png', bytes: 4 }) })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.equal(Object.hasOwn(value, 'image'), false)
  assert.equal(Object.hasOwn(value, 'note'), false, 'a missing admission is not treated as an error to report')
})

test('a host with no attachment support reports text only', async () => {
  const tool = makeComfyTool({ run: async () => result([FILE]) })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.equal(Object.hasOwn(value, 'image'), false)
  assert.match(value.text, /这次只回传文字摘要/)
})

test('a run that produced nothing is reported honestly', async () => {
  const tool = makeComfyTool({ run: async () => result([]), admit: async () => REF })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.equal(value.count, 0)
  assert.deepEqual(value.gallery, [])
  assert.equal(Object.hasOwn(value, 'image'), false, 'no file means nothing to store')
  assert.match(value.text, /产出 0 张图/)
  assert.match(value.text, /（没有产出图片）/)
})

test('the gallery summary never carries image bytes', async () => {
  const tool = makeComfyTool({ run: async () => result([FILE]), admit: async () => REF })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.deepEqual(value.gallery, [{ name: FILE.name, mediaType: 'image/png', bytes: 4, url: '/image-studio/image?name=img-20261015-101500-aabbcc.png' }])
  assert.equal(JSON.stringify(value).includes('"data"'), false, 'bytes must stay out of anything the model reads')
})

test('a malformed run answer is normalized rather than forwarded', async () => {
  const tool = makeComfyTool({ run: async () => null })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.equal(value.workflow, '')
  assert.equal(value.count, 0)
  assert.equal(value.elapsedMs, 0)
  assert.deepEqual(value.gallery, [])
  assert.match(value.text, /产出 0 张图/)
})

test('the elapsed time is rounded up to whole seconds', async () => {
  const tool = makeComfyTool({ run: async () => ({ ...result([FILE]), elapsedMs: 800 }), admit: async () => REF })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.equal(value.elapsedMs, 800)
  assert.match(value.text, /用时 1 秒/)
})

test('a conversion note from the pipeline is passed along', async () => {
  const tool = makeComfyTool({
    run: async () => ({ ...result([FILE]), note: '这个工作流是 UI 格式，面板已自动转换成 API 格式后提交。' }),
    admit: async () => REF,
  })
  const value = await tool.execute({ prompt: 'a duck' })
  assert.equal(value.note, '这个工作流是 UI 格式，面板已自动转换成 API 格式后提交。')
})

test('render puts the image beside its own text block', async () => {
  const tool = makeComfyTool({ run: async () => result([FILE]), admit: async () => REF })
  const value = await tool.execute({ prompt: 'a duck' })
  const blocks = tool.output.render({}, value)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[0], { type: 'text', text: value.text })
  assert.equal(blocks[1].type, 'image')
  assert.equal(blocks[1].attachment.attachmentId, REF.attachmentId)
})

test('render stays a single text block when no image came back', async () => {
  const tool = makeComfyTool({ run: async () => result([]) })
  const value = await tool.execute({ prompt: 'a duck' })
  const blocks = tool.output.render({}, value)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
})

test('the specification is a complete defineTool definition', () => {
  const tool = makeComfyTool({ run: async () => result([]) })
  assert.equal(tool.name, TOOL_NAME)
  assert.equal(typeof tool.description, 'string')
  assert.ok(tool.description.length > 20)
  assert.equal(tool.timeoutMs, TOOL_TIMEOUT_MS)
  assert.equal(tool.parameters.prompt.required, true, 'a run without a prompt is meaningless')
  assert.equal(tool.parameters.workflow.required, undefined)
  assert.equal(tool.parameters.baseUrl.required, undefined)
  for (const name of Object.keys(tool.parameters)) {
    assert.equal(typeof tool.parameters[name].description, 'string', name + ' needs a description')
  }
})

test('resolveDefineTool answers with a factory or nothing at all', async () => {
  const resolved = await resolveDefineTool()
  assert.ok(resolved === null || typeof resolved === 'function', 'never anything else')
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
console.log('\nThe conversational tool keeps bytes out of the transcript and images in it.')
