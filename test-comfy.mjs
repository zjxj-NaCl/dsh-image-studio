/**
 * Unit tests for the direct ComfyUI client.
 *
 * These pin the details that only show up against a real server:
 *  - a workflow in a subfolder has to be fetched with its slashes encoded;
 *  - `widgets_values` is positional, and the UI stores a control box after some
 *    seeds that is not an input at all;
 *  - custom node sockets must never be mistaken for widgets;
 *  - the queue id is minted by ComfyUI, not by us.
 *
 *   node packages/dsh-image-studio/test-comfy.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { applyPrompt, listWorkflows, runWorkflow, toApiGraph, readWorkflow } from './src/comfy.js'

const cases = []
const test = (name, fn) => { cases.push({ name, fn }) }

/** Start a stub ComfyUI, run the body against its URL, then stop it again. */
async function withComfy(handler, body) {
  const requests = []
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url })
    const parsed = new URL(req.url, 'http://127.0.0.1')
    handler(parsed, req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + String(server.address().port)
  try {
    return await body(base, requests)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/** An `/object_info` entry built from an ordered list of `[name, definition]`. */
function spec(entries, extra = {}) {
  const required = {}
  for (const [name, definition] of entries) required[name] = definition
  return {
    input_order: { required: entries.map(([name]) => name) },
    input: { required, ...extra },
  }
}

const LINK = (type) => [type]
const INT = (options = {}) => ['INT', { default: 0, min: 0, max: 100, step: 1, ...options }]
const FLOAT = () => ['FLOAT', { default: 0.5, min: 0, max: 1, step: 0.01 }]
const TEXT = () => ['STRING', { default: '' }]
const CHOICES = (values) => [values, {}]
const BOOL = () => ['BOOLEAN', { default: true }]

/** A UI-format node, with the links it consumes listed as input slots. */
function uiNode(id, type, inputs, widgets) {
  return {
    id,
    type,
    inputs: inputs.map(([name, link]) => ({ name, link })),
    widgets_values: widgets,
  }
}

/** A link tuple: [id, fromNode, fromSlot, toNode, toSlot, type]. */
const link = (id, from, fromSlot, to, toSlot, type = '*') => [id, from, fromSlot, to, toSlot, type]

// --- reading a workflow file -------------------------------------------------

/** The smallest workflow that eadWorkflow accepts: API format already. */
const API_ONLY_WORKFLOW = { 1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } } }

test('a workflow in a subfolder is fetched with its slashes encoded', async () => {
  await withComfy((url, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(API_ONLY_WORKFLOW))
  }, async (base, requests) => {
    await readWorkflow(base, 'workflows/anime style SDXL.json')
    assert.equal(requests.length, 1)
    assert.equal(
      requests[0].url,
      '/userdata/workflows%2Fanime%20style%20SDXL.json',
      'the whole path must travel as one encoded segment',
    )
  })
})

test('a server that wants real slashes is retried once', async () => {
  await withComfy((url, req, res) => {
    if (url.pathname.startsWith('/userdata/workflows/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(API_ONLY_WORKFLOW))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"error":"no such file"}')
  }, async (base, requests) => {
    await readWorkflow(base, 'workflows/a.json')
    assert.deepEqual(requests.map((entry) => entry.url), [
      '/userdata/workflows%2Fa.json',
      '/userdata/workflows/a.json',
    ])
  })
})

test('a bare workflow name is looked for under workflows/ first', async () => {
  // The picker hands out paths like `workflows/a.json`, but a tool call names
  // the file the way the user sees it in ComfyUI, which is just `a.json`.
  await withComfy((url, req, res) => {
    if (url.pathname === '/userdata/workflows%2Fa.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(API_ONLY_WORKFLOW))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"error":"no such file"}')
  }, async (base, requests) => {
    const result = await readWorkflow(base, ' a.json ')
    assert.ok(result.graph['1'], 'the graph comes back')
    assert.deepEqual(requests.map((entry) => entry.url), ['/userdata/workflows%2Fa.json'])
  })
})

test('a bare name outside workflows/ still resolves', async () => {
  await withComfy((url, req, res) => {
    if (url.pathname === '/userdata/a.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(API_ONLY_WORKFLOW))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"error":"no such file"}')
  }, async (base, requests) => {
    const result = await readWorkflow(base, 'a.json')
    assert.ok(result.graph['1'], 'the graph comes back')
    assert.deepEqual(requests.map((entry) => entry.url), [
      '/userdata/workflows%2Fa.json',
      '/userdata/workflows/a.json',
      '/userdata/a.json',
    ])
  })
})
test('a subdirectory path without the workflows/ prefix is scoped too', async () => {
  // Workflows may sit in a folder inside workflows/, which the picker reports
  // as `Anima/a.json`. ComfyUI serves that file only at the fully encoded
  // `workflows/Anima/a.json`, so the prefix has to be added for those as well.
  const fullPath = '/userdata/' + encodeURIComponent('workflows/Anima/a.json')
  await withComfy((url, req, res) => {
    if (url.pathname === fullPath) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(API_ONLY_WORKFLOW))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"error":"no such file"}')
  }, async (base, requests) => {
    const result = await readWorkflow(base, 'Anima/a.json')
    assert.ok(result.graph['1'], 'the graph comes back')
    assert.deepEqual(requests.map((entry) => entry.url), [fullPath])
  })
})

test('a missing workflow is reported as a readable failure', async () => {
  await withComfy((url, req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"error":"no such file"}')
  }, async (base) => {
    await assert.rejects(
      () => readWorkflow(base, 'nope.json'),
      (error) => /读取工作流文件/.test(String(error.message)) && /404/.test(String(error.message)),
    )
  })
})

test('run records and edit backups stay out of the picker', async () => {
  // A real workflows/ folder collected 47 `.before-…` backups and 19
  // `metadata.json` records next to 36 runnable workflows; none of the former
  // can be queued, so the list must not offer them.
  const entries = [
    { name: 'anime style SDXL.json', path: 'workflows/anime style SDXL.json', type: 'file' },
    { name: 'anime style SDXL.before-active-hand-lora-v12-3-20260829-103919.json', path: 'workflows/anime style SDXL.before-active-hand-lora-v12-3-20260829-103919.json', type: 'file' },
    { name: 'metadata.json', path: 'workflows/FLUX/metadata.json', type: 'file' },
    { name: '构图', path: 'workflows/FLUX', type: 'dir' },
    { name: 'A01', path: 'workflows/FLUX/A01.json', type: 'file' },
  ]
  await withComfy((url, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(entries))
  }, async (base) => {
    const listed = await listWorkflows(base)
    assert.deepEqual(listed.workflows.map((entry) => entry.path), [
      'workflows/FLUX/A01.json',
      'workflows/anime style SDXL.json',
    ])
  })
})

test('experiment notes are not offered as workflows', async () => {
  // The same folder also held `运行记录.json`, `安装检查记录.json`,
  // `验证记录.json` and `待修复数据包位置.json`. They parse as JSON and some
  // even carry nodes/links-shaped data, so the picker has to recognise them by
  // name: choosing one is guaranteed to fail at run time.
  const entries = [
    { name: '运行记录.json', path: 'workflows/FLUX/Bpart/测试结果/运行记录.json', type: 'file' },
    { name: '安装检查记录.json', path: 'workflows/FLUX/Cpart/安装检查记录.json', type: 'file' },
    { name: '验证记录.json', path: 'workflows/FLUX/Cpart/验证输出/验证记录.json', type: 'file' },
    { name: '待修复数据包位置.json', path: 'workflows/FLUX/Cpart/本机实测/待修复数据包位置.json', type: 'file' },
    { name: 'readme.json', path: 'workflows/readme.json', type: 'file' },
    // English endings count only as a whole trailing word: a separator before
    // the suffix is enough, no surrounding spaces are required.
    { name: '运行_log.json', path: 'workflows/FLUX/Bpart/运行_log.json', type: 'file' },
    // A real workflow whose name merely *contains* one of those words must stay.
    { name: 'C01_手部检查_裁切与蒙版.json', path: 'workflows/FLUX/Cpart/C01_手部检查_裁切与蒙版.json', type: 'file' },
    { name: 'A01_Klein_Base_FP8_构图.json', path: 'workflows/FLUX/A_构图/A01_Klein_Base_FP8_构图.json', type: 'file' },
    // …and so must names that merely *end* with a suffix's letters: `dialog` and
    // `catalog` both end with `log`, yet both are legitimate workflow names.
    { name: 'dialog.json', path: 'workflows/FLUX/dialog.json', type: 'file' },
    { name: 'catalog.json', path: 'workflows/FLUX/catalog.json', type: 'file' },
  ]
  await withComfy((url, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(entries))
  }, async (base) => {
    const listed = await listWorkflows(base)
    assert.deepEqual(listed.workflows.map((entry) => entry.path), [
      'workflows/FLUX/A_构图/A01_Klein_Base_FP8_构图.json',
      'workflows/FLUX/Cpart/C01_手部检查_裁切与蒙版.json',
      'workflows/FLUX/catalog.json',
      'workflows/FLUX/dialog.json',
    ])
  })
})

test('same-named workflows carry their folder so the picker can tell them apart', async () => {
  // Several experiment folders each hold a `测试_API.json`; a dropdown with four
  // identical labels is unusable because the user cannot see which one they are
  // choosing. Only the colliding names are rewritten, so unique entries keep the
  // short label.
  const entries = [
    { name: '测试_API.json', path: 'workflows/FLUX/Cpart/本机实测/测试_API.json', type: 'file' },
    { name: '测试_API.json', path: 'workflows/SDXL/Bpart/本机实测/测试_API.json', type: 'file' },
    { name: 'anime style SDXL.json', path: 'workflows/anime style SDXL.json', type: 'file' },
  ]
  await withComfy((url, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(entries))
  }, async (base) => {
    const listed = await listWorkflows(base)
    const names = listed.workflows.map((entry) => entry.name)
    // The list is sorted by the original name, so the two `测试_API` entries come
    // together and only their labels gained a folder.
    assert.deepEqual(names, ['本机实测/测试_API', '本机实测/测试_API', 'anime style SDXL'])
    // The path is untouched: the run still addresses the exact file.
    assert.deepEqual(listed.workflows.map((entry) => entry.path).sort(), entries.map((entry) => entry.path).sort())
  })
})

test('a workflow saved with a byte-order mark still reads', async () => {
  // Two files in a real workflows/ tree began with EF BB BF. ComfyUI's own UI
  // reads them, so refusing them here would look like a bug to the user.
  const body = '\uFEFF' + JSON.stringify(API_ONLY_WORKFLOW)
  await withComfy((url, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
  }, async (base) => {
    const { graph } = await readWorkflow(base, 'workflows/bom.json')
    assert.equal(graph['1'].class_type, 'CheckpointLoaderSimple')
  })
})

// --- UI to API conversion ----------------------------------------------------

const KSAMPLER_SPEC = spec([
  ['model', LINK('MODEL')],
  ['seed', INT({ control_after_generate: true })],
  ['steps', INT()],
  ['cfg', FLOAT()],
  ['sampler_name', CHOICES(['euler', 'dpmpp_2m'])],
  ['scheduler', CHOICES(['normal', 'karras'])],
  ['positive', LINK('CONDITIONING')],
  ['negative', LINK('CONDITIONING')],
  ['latent_image', LINK('LATENT')],
  ['denoise', FLOAT()],
])

const KSAMPLER_NODE = uiNode(7, 'KSampler', [
  ['model', 1],
  ['positive', 2],
  ['negative', 3],
  ['latent_image', 4],
], [101, 'randomize', 20, 7, 'dpmpp_2m', 'karras', 1])

function samplerGraph(specs, values) {
  return {
    nodes: [
      uiNode(1, 'CheckpointLoaderSimple', [], ['model.safetensors']),
      uiNode(2, 'CLIPTextEncode', [['clip', 5]], ['a prompt']),
      uiNode(3, 'CLIPTextEncode', [['clip', 5]], ['a negative']),
      uiNode(4, 'EmptyLatentImage', [], [512, 512, 1]),
      uiNode(5, 'CLIPSetLastLayer', [['clip', 6]], ['-1']),
      uiNode(6, 'CheckpointLoaderSimple', [], ['model.safetensors']),
      { ...KSAMPLER_NODE, widgets_values: values },
      uiNode(8, 'VAEDecode', [['samples', 7], ['vae', 9]], []),
      uiNode(9, 'VAELoader', [], ['vae.safetensors']),
    ],
    links: [
      link(1, 1, 0, 7, 0, 'MODEL'),
      link(2, 2, 0, 7, 1, 'CONDITIONING'),
      link(3, 3, 0, 7, 2, 'CONDITIONING'),
      link(4, 4, 0, 7, 3, 'LATENT'),
      link(5, 6, 1, 5, 0, 'CLIP'),
      link(6, 6, 0, 2, 0, 'CLIP'),
    ],
  }
}

const MINIMAL_SPECS = {
  KSampler: KSAMPLER_SPEC,
  CheckpointLoaderSimple: spec([
    ['ckpt_name', CHOICES(['model.safetensors'])],
  ]),
  CLIPTextEncode: spec([['clip', LINK('CLIP')], ['text', TEXT()]]),
  CLIPSetLastLayer: spec([['clip', LINK('CLIP')], ['stop_at_clip_layer', INT()]]),
  EmptyLatentImage: spec([['width', INT()], ['height', INT()], ['batch_size', INT()]]),
  VAEDecode: spec([['samples', LINK('LATENT')], ['vae', LINK('VAE')]]),
  VAELoader: spec([['vae_name', CHOICES(['vae.safetensors'])]]),
}

test('the control box after a seed is not read as steps', () => {
  const api = toApiGraph(samplerGraph(MINIMAL_SPECS, [101, 'randomize', 20, 7, 'dpmpp_2m', 'karras', 1]), MINIMAL_SPECS)
  assert.equal(api['7'].inputs.seed, 101)
  assert.equal(api['7'].inputs.steps, 20, 'steps must not pick up the randomize box')
  assert.equal(api['7'].inputs.cfg, 7)
  assert.equal(api['7'].inputs.sampler_name, 'dpmpp_2m')
  assert.equal(api['7'].inputs.scheduler, 'karras')
  assert.equal(api['7'].inputs.denoise, 1)
})

test('a graph saved without the control box still lines up', () => {
  const api = toApiGraph(samplerGraph(MINIMAL_SPECS, [101, 20, 7, 'dpmpp_2m', 'karras', 1]), MINIMAL_SPECS)
  assert.equal(api['7'].inputs.seed, 101)
  assert.equal(api['7'].inputs.steps, 20)
  assert.equal(api['7'].inputs.denoise, 1)
})

test('an undeclared control box after a seed is stepped over', () => {
  // Impact's DetailerForEach takes a seed but never declares
  // `control_after_generate`; the UI still stores the box, and the values after
  // it must not slide into the wrong inputs.
  const detailer = spec([
    ['image', LINK('IMAGE')],
    ['segs', LINK('SEGS')],
    ['model', LINK('MODEL')],
    ['clip', LINK('CLIP')],
    ['vae', LINK('VAE')],
    ['guide_size', FLOAT()],
    ['guide_size_for', BOOL()],
    ['max_size', FLOAT()],
    ['seed', INT()],
    ['steps', INT()],
    ['cfg', FLOAT()],
    ['sampler_name', CHOICES(['euler', 'dpmpp_2m_sde'])],
    ['scheduler', CHOICES(['normal', 'karras'])],
    ['positive', LINK('CONDITIONING')],
    ['negative', LINK('CONDITIONING')],
    ['denoise', FLOAT()],
  ])
  const graph = {
    nodes: [
      { id: 77, type: 'DetailerForEach', inputs: [], widgets_values: [1280, true, 1280, 525154665039234, 'fixed', 16, 4, 'dpmpp_2m_sde', 'karras', 0.12] },
    ],
    links: [],
  }
  const api = toApiGraph(graph, { DetailerForEach: detailer })
  assert.equal(api['77'].inputs.guide_size, 1280)
  assert.equal(api['77'].inputs.guide_size_for, true)
  assert.equal(api['77'].inputs.max_size, 1280)
  assert.equal(api['77'].inputs.seed, 525154665039234)
  assert.equal(api['77'].inputs.steps, 16, 'steps must not become the control box')
  assert.equal(api['77'].inputs.sampler_name, 'dpmpp_2m_sde')
  assert.equal(api['77'].inputs.denoise, 0.12)
})

test('a custom socket type is a link, not a widget', () => {
  // `BBOX_DETECTOR` is not one of the primitive widget types, so it must be
  // dropped from the widget list rather than swallowing the first value.
  const detector = spec([
    ['bbox_detector', LINK('BBOX_DETECTOR')],
    ['image', LINK('IMAGE')],
    ['threshold', FLOAT()],
    ['dilation', INT()],
    ['crop_factor', FLOAT()],
    ['drop_size', INT()],
    ['labels', TEXT()],
  ])
  const graph = {
    nodes: [
      uiNode(74, 'BboxDetectorSEGS', [['bbox_detector', 1], ['image', 2]].map(([name, id]) => [name, id]), [0.35, 56, 2.15, 10, 'all']),
    ],
    links: [link(1, 73, 0, 74, 0, 'BBOX_DETECTOR'), link(2, 9, 0, 74, 1, 'IMAGE')],
  }
  const api = toApiGraph(graph, { BboxDetectorSEGS: detector })
  assert.deepEqual(api['74'].inputs.bbox_detector, ['73', 0])
  assert.deepEqual(api['74'].inputs.image, ['9', 0])
  assert.equal(api['74'].inputs.threshold, 0.35)
  assert.equal(api['74'].inputs.dilation, 56)
  assert.equal(api['74'].inputs.crop_factor, 2.15)
  assert.equal(api['74'].inputs.drop_size, 10)
  assert.equal(api['74'].inputs.labels, 'all')
})

// --- queueing ----------------------------------------------------------------

const API_WORKFLOW = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
  2: { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'a prompt' } },
 9: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['1', 2] } },
}

/** A stub that accepts a queue and reports one finished picture. */
function happyComfy(promptId = 'minted-id') {
  return (url, req, res) => {
    if (url.pathname === '/prompt') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ prompt_id: promptId, number: 1, node_errors: {} }))
      return
    }
    if (url.pathname.startsWith('/history/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        [decodeURIComponent(url.pathname.slice('/history/'.length))]: {
          status: { status_str: 'success', completed: true },
          outputs: { 9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
        },
      }))
      return
    }
    if (url.pathname === '/view') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      return
    }
    res.writeHead(404)
    res.end()
  }
}

test('the queue id comes from ComfyUI, not from us', async () => {
  await withComfy(happyComfy('f2589047-015f-493b-95eb-5a168838282f'), async (base, requests) => {
    const result = await runWorkflow({ baseUrl: base, graph: API_WORKFLOW, timeoutMs: 10000 })
    assert.equal(result.promptId, 'f2589047-015f-493b-95eb-5a168838282f')
    const posted = requests.filter((entry) => entry.url === '/prompt')
    assert.equal(posted.length, 1)
  })
})

test('a rejected graph is explained without printing an object', async () => {
  await withComfy((url, req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '' },
      node_errors: { 14: { errors: [{ message: 'Value not in list', details: "scheduler: 'karras' not in a list" }] } },
    }))
  }, async (base) => {
    await assert.rejects(
      () => runWorkflow({ baseUrl: base, graph: API_WORKFLOW, timeoutMs: 10000 }),
      (error) => {
        assert.ok(!/\[object Object\]/.test(String(error.message)), 'must never print [object Object]')
        assert.match(String(error.message), /Prompt outputs failed validation/)
        assert.match(String(error.message), /scheduler: 'karras' not in a list/)
        return true
      },
    )
  })
})

test('a queue answer without an id fails instead of polling forever', async () => {
  await withComfy((url, req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ number: 1, node_errors: {} }))
  }, async (base) => {
    await assert.rejects(
      () => runWorkflow({ baseUrl: base, graph: API_WORKFLOW, timeoutMs: 5000 }),
      /没有返回排队编号/,
    )
  })
})

test('a finished run hands back the picture it produced', async () => {
  await withComfy(happyComfy(), async (base) => {
    const result = await runWorkflow({ baseUrl: base, graph: API_WORKFLOW, timeoutMs: 10000 })
    assert.equal(result.images.length, 1)
    assert.equal(result.images[0].name, 'out.png')
    assert.equal(result.images[0].mediaType, 'image/png')
    assert.deepEqual([...result.images[0].data], [0x89, 0x50, 0x4e, 0x47])
  })
})

// --- prompt placement --------------------------------------------------------

/**
 * A three-stage graph shaped like the real 46-node anime workflow: a
 * control-net pass samples from an empty latent, a hires pass samples from the
 * upscaled result, and a refine pass denoises at 0.14 from an inpaint mask.
 */
function stagedWorkflow() {
  const encode = (text) => ({ class_type: 'CLIPTextEncode', inputs: { text, clip: ['5', 0] } })
  return {
    5: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
    3: { class_type: 'EmptyLatentImage', inputs: { width: 896, height: 1344, batch_size: 1 } },
    15: encode('belfast, masterpiece'),
    10: encode('worst quality'),
    13: {
      class_type: 'ControlNetApplyAdvanced',
      inputs: { positive: ['15', 0], negative: ['10', 0], control_net: ['11', 0], image: ['12', 0], strength: 0.55 },
    },
    11: { class_type: 'ControlNetLoader', inputs: { control_net_name: 'cn.safetensors' } },
    12: { class_type: 'LoadImage', inputs: { image: 'ref.png' } },
    14: {
      class_type: 'KSampler',
      inputs: { seed: 1, model: ['5', 0], positive: ['13', 0], negative: ['13', 1], latent_image: ['3', 0], denoise: 1, steps: 30 },
    },
    6: { class_type: 'LatentUpscale', inputs: { samples: ['14', 0], width: 1152, height: 1728 } },
    7: {
      class_type: 'KSampler',
      inputs: { seed: 2, model: ['5', 0], positive: ['13', 0], negative: ['13', 1], latent_image: ['6', 0], denoise: 0.16, steps: 20 },
    },
    400: { class_type: 'LoadImage', inputs: { image: 'face.png' } },
    405: { class_type: 'VAEEncode', inputs: { pixels: ['400', 0], vae: ['5', 2] } },
    406: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['7', 0], mask: ['405', 0] } },
    407: encode('score_9, anime illustration'),
    408: encode('score_6, extra fingers'),
    409: {
      class_type: 'KSampler',
      inputs: { seed: 3, model: ['5', 0], positive: ['407', 0], negative: ['408', 0], latent_image: ['406', 0], denoise: 0.14, steps: 8 },
    },
  }
}

test('the prompt lands in the sampling pass that actually draws the picture', () => {
  const graph = stagedWorkflow()
  const placement = applyPrompt(graph, 'a red cube on a wooden table', 'blurry')
  assert.equal(graph[15].inputs.text, 'a red cube on a wooden table')
  assert.equal(graph[10].inputs.text, 'blurry')
  assert.deepEqual(placement.positiveIds, ['15'])
  assert.deepEqual(placement.negativeIds, ['10'])
})

test('a refine pass behind an inpaint mask is left alone', () => {
  const graph = stagedWorkflow()
  applyPrompt(graph, 'a red cube on a wooden table', 'blurry')
  assert.equal(graph[407].inputs.text, 'score_9, anime illustration')
  assert.equal(graph[408].inputs.text, 'score_6, extra fingers')
  assert.equal(graph[75], undefined)
})

test('the positive walk never crosses into the negative encoder', () => {
  const graph = stagedWorkflow()
  const placement = applyPrompt(graph, 'a red cube', 'blurry')
  assert.ok(!placement.positiveIds.includes('10'), 'negative encoder must not appear as positive')
  assert.ok(!placement.negativeIds.includes('15'), 'positive encoder must not appear as negative')
  assert.equal(graph[15].inputs.text, 'a red cube')
})

test('two passes from an empty latent resolve to the one with the highest denoise', () => {
  const graph = stagedWorkflow()
  graph[7].inputs.latent_image = ['3', 0]
  const placement = applyPrompt(graph, 'a red cube', 'blurry')
  assert.deepEqual(placement.positiveIds, ['15'])
  assert.equal(graph[15].inputs.text, 'a red cube')
  assert.equal(graph[407].inputs.text, 'score_9, anime illustration')
})

test('a graph with no sampler still gets the prompt', () => {
  const graph = {
    1: { class_type: 'CLIPTextEncode', inputs: { text: 'first', clip: ['9', 0] } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'second', clip: ['9', 0] } },
  }
  const placement = applyPrompt(graph, 'a red cube', 'blurry')
  assert.equal(placement.strategy, 'fallback')
  assert.equal(graph[1].inputs.text, 'a red cube')
  assert.equal(graph[2].inputs.text, 'blurry')
})

test('every seed is rerolled so the same workflow never repeats an image', () => {
  const graph = stagedWorkflow()
  applyPrompt(graph, 'a red cube', 'blurry')
  assert.notEqual(graph[14].inputs.seed, 1)
  assert.notEqual(graph[7].inputs.seed, 2)
  assert.notEqual(graph[409].inputs.seed, 3)
})
// --- runner ------------------------------------------------------------------

const failures = []
for (const { name, fn } of cases) {
  try {
    await fn()
    console.log('  ok   ' + name)
  } catch (error) {
    console.log('  FAIL ' + name + '  ' + String(error?.message ?? error))
    failures.push(name)
  }
}

if (failures.length > 0) {
  console.log('\n' + String(failures.length) + ' FAILURE(S): ' + failures.join(', '))
  process.exit(1)
}
console.log('\nThe ComfyUI client reads, converts and queues the way a real server expects.')
