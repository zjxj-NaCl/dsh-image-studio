/**
 * Execute the packaged client bundle in a stub environment.
 *
 * The real shell provides window.__ModuleLoader__, React, and the slots
 * service. This harness supplies minimal stand-ins so the bundle's apply() runs
 * for real: any syntax error, missing export, or bad slot registration surfaces
 * here instead of in the browser.
 *
 *   node packages/dsh-image-studio/test-client.mjs
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')

const failures = []
function check(label, condition, detail) {
  if (condition) console.log('  ok   ' + label)
  else { console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); failures.push(label) }
}

const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: initial => ({ current: initial }),
  useEffect: () => {},
  useCallback: (fn) => fn,
}

let loaded = null
const stubWindow = { __ModuleLoader__: { load: (entry) => { loaded = entry } } }
const stubRequire = (id) => {
  if (id === 'react') return react
  throw new Error('unexpected require: ' + id)
}
const stubDocument = {
  createElement: () => ({ style: {}, dataset: {}, remove() {} }),
  head: { append() {}, appendChild() {} },
}

const evaluate = new Function('window', 'document', 'fetch', 'FileReader', source)
evaluate(stubWindow, stubDocument, () => { throw new Error('fetch must not run at load') }, function FileReader() {})

check('bundle called __ModuleLoader__.load', loaded !== null)
check('bundle id is dsh-image-studio', loaded?.id === 'dsh-image-studio', String(loaded?.id))

const exported = loaded.factory(stubRequire)
check('exports.apply is a function', typeof exported.apply === 'function')
check('exports.inject declares slots',
  Array.isArray(exported.inject) && exported.inject.includes('slots'), String(exported.inject))

const registrations = []
const injections = []
const effects = []
const slots = {
  register: (options, component) => { registrations.push({ options, component }); return () => {} },
  inject: (key, callback) => { injections.push(key); callback(); return () => {} },
}
const ctx = {
  slots,
  effect: (callback, label) => { effects.push(label); return callback() },
  get: (name) => (name === 'slots' ? slots : undefined),
  inject: () => {},
}

exported.apply(ctx)

console.log('\nregistrations:')
for (const entry of registrations) console.log('  ' + JSON.stringify(entry.options))

check('registered exactly 4 entries, no separate conversation panel', registrations.length === 4, String(registrations.length))
check('injected into "main" twice', injections.filter((k) => k === 'main').length === 2, JSON.stringify(injections))
check('injected into "sidebar.panellist" twice',
  injections.filter((k) => k === 'sidebar.panellist').length === 2, JSON.stringify(injections))

const mainKeys = registrations.filter((r) => r.options.name === 'main').map((r) => r.options.key)
check('main keys are the two expected ids',
  mainKeys.includes('image-studio-gallery') && mainKeys.includes('image-studio-workbench'), JSON.stringify(mainKeys))

const panelIds = registrations.filter((r) => r.options.name === 'sidebar.panellist').map((r) => r.options.id)
check('panellist ids match the main keys (icon selects the panel)',
  panelIds.includes('image-studio-gallery') && panelIds.includes('image-studio-workbench'), JSON.stringify(panelIds))

const labels = registrations.filter((r) => r.options.name === 'sidebar.panellist').map((r) => r.options.label)
check('panellist labels are non-empty strings',
  labels.length === 2 && labels.every((l) => typeof l === 'string' && l.length > 0), JSON.stringify(labels))

const gallery = registrations.find((r) => r.options.key === 'image-studio-gallery')
const studio = registrations.find((r) => r.options.key === 'image-studio-workbench')
check('both main components are functions',
  typeof gallery?.component === 'function' && typeof studio?.component === 'function')
check('styles effect registered', effects.some((l) => String(l).includes('styles')), JSON.stringify(effects))

for (const [label, entry] of [['Gallery', gallery], ['Studio', studio]]) {
  try {
    const tree = entry.component({})
    check(label + ' renders a tree', tree != null && tree.type === 'div')
  } catch (error) {
    check(label + ' renders a tree', false, String(error.message))
  }
}

/**
 * Collect every string rendered anywhere in a stub element tree.
 *
 * Function components are expanded in place, because there is no reconciler here:
 * a nested component such as the preview box would otherwise stay invisible.
 */
function texts(node, found = [], depth = 0) {
  if (depth > 24) return found
  if (typeof node === 'string') found.push(node)
  else if (Array.isArray(node)) for (const child of node) texts(child, found, depth + 1)
  else if (node != null && typeof node === 'object') {
    if (typeof node.type === 'function') { texts(node.type(node.props ?? {}), found, depth + 1); return found }
    for (const child of Array.isArray(node.children) ? node.children : []) texts(child, found, depth + 1)
  }
  return found
}

const studioTexts = texts(studio.component({}))
check('studio is titled 生图工作台', studioTexts.includes('生图工作台'), studioTexts.slice(0, 6).join(' | '))
check('studio offers the 模型配置 tab', studioTexts.includes('模型配置'), JSON.stringify(studioTexts.slice(0, 12)))
check('studio has no SDXL/four-stage wording',
  !studioTexts.some((t) => /sdxl|四阶段|阶段|精修|接缝/i.test(t)), JSON.stringify(studioTexts.filter((t) => /sdxl|阶段|精修|接缝/i.test(t))))

check('studio carries a generation preview box', studioTexts.includes('本次结果'), JSON.stringify(studioTexts.slice(0, 8)))
check('the preview box explains its empty state',
  studioTexts.some((t) => String(t).includes('尚无本次会话的生成结果')), JSON.stringify(studioTexts.filter((t) => String(t).includes('尚无'))))
check('studio offers the 生成数量 control', studioTexts.includes('生成数量'), JSON.stringify(studioTexts.slice(0, 8)))
check('the batch control offers one image and the ceiling',
  ['1 张', '2 张', '3 张', '4 张'].every((label) => studioTexts.includes(label)), JSON.stringify(studioTexts.filter((t) => String(t).endsWith(' 张'))))

// The preview box must show every image of a batch, numbered, and only then allow a
// full-screen look at one of them. Function components are expanded like texts() does.
function classes(node, found = [], depth = 0) {
  if (depth > 24) return found
  if (Array.isArray(node)) for (const child of node) classes(child, found, depth + 1)
  else if (node != null && typeof node === 'object') {
    if (typeof node.type === 'function') { classes(node.type(node.props ?? {}), found, depth + 1); return found }
    if (typeof node.props?.className === 'string') found.push(node.props.className)
    for (const child of Array.isArray(node.children) ? node.children : []) classes(child, found, depth + 1)
  }
  return found
}
const studioClasses = classes(studio.component({}))
check('the preview box reserves a batch grid', studioClasses.some((c) => c.includes('cis-col preview')), JSON.stringify(studioClasses.filter((c) => c.includes('preview'))))
check('the preview box keeps the full-screen overlay available',
  classes(studio.component({})).includes('cis-overlay') === false,
  'closed until a result is opened')

// The workbench must expose text-to-image and image-to-image as one switch, and
// the form must say which one is active.
check('studio offers the 生成方式 switch', studioTexts.includes('生成方式'), JSON.stringify(studioTexts.slice(0, 10)))
check('the switch offers 文生图 and 图生图',
  studioTexts.includes('文生图') && studioTexts.includes('图生图'),
  JSON.stringify(studioTexts.filter((t) => /文生图|图生图/.test(String(t)))))
check('the switch is a real segmented control',
  studioClasses.some((c) => c.includes('cis-switch')), JSON.stringify(studioClasses.filter((c) => c.includes('switch'))))
check('the default mode describes text-to-image',
  studioTexts.some((t) => String(t).includes('文生图：只按提示词出图')),
  JSON.stringify(studioTexts.filter((t) => String(t).includes('文生图'))))
check('the reference picker follows the active mode',
  studioTexts.some((t) => String(t).includes('当前是文生图，参考图不会被提交')),
  JSON.stringify(studioTexts.filter((t) => String(t).includes('参考图'))))
check('the submit button names the text-to-image action', studioTexts.includes('生成图片'), JSON.stringify(studioTexts.filter((t) => /生成|编辑/.test(String(t)))))

// The model comes from the provider catalog, so the configuration panel must offer a
// read button; until a catalog arrives it keeps the manual field as a fallback.
check('the config panel offers to read the model catalog', studioTexts.includes('读取模型'), JSON.stringify(studioTexts.filter((t) => String(t).includes('模型')).slice(0, 10)))
check('the config panel explains where the model list comes from',
  studioTexts.some((t) => String(t).includes('列表由所选图像服务的模型目录读取')),
  JSON.stringify(studioTexts.filter((t) => String(t).includes('模型目录'))))
check('the manual model field stays as a fallback until a catalog arrives',
  studioTexts.some((t) => String(t).includes('读取失败时可以直接填写模型名')),
  JSON.stringify(studioTexts.filter((t) => String(t).includes('读取模型'))))
check('an empty catalog does not claim a model count',
  !studioTexts.some((t) => /^共 \d+ 个模型$/.test(String(t))),
  JSON.stringify(studioTexts.filter((t) => String(t).includes('个模型'))))
// The fallback used to render field('模型', …) inside a heading that already said
// 「模型」, so the panel showed the same word twice.
check('the model heading is drawn exactly once',
  studioTexts.filter((t) => String(t) === '模型').length === 1,
  JSON.stringify(studioTexts.filter((t) => String(t).includes('模型'))))

// 图像服务 and 模型 are drawn side by side, the way the built-in image settings put
// Provider next to Model, so the service picker and its model field share one row.
function configRows(node, found = [], depth = 0) {
  if (depth > 24 || node == null || typeof node === 'string') return found
  if (Array.isArray(node)) { for (const child of node) configRows(child, found, depth + 1); return found }
  if (typeof node !== 'object') return found
  if (typeof node.type === 'function') { configRows(node.type(node.props ?? {}), found, depth + 1); return found }
  if (node.props?.className === 'cis-row') found.push(node)
  for (const child of Array.isArray(node.children) ? node.children : []) configRows(child, found, depth + 1)
  return found
}
function rowHeadings(row) {
  const headings = []
  for (const child of Array.isArray(row.children) ? row.children : []) {
    if (child == null || typeof child !== 'object' || child.props?.className !== 'cis-field') continue
    const label = (Array.isArray(child.children) ? child.children : []).find(
      (inner) => inner != null && typeof inner === 'object' && inner.props?.className === 'cis-label')
    headings.push([...(Array.isArray(label?.children) ? label.children : [])].join(''))
  }
  return headings
}
const configRowHeadings = configRows(studio.component({})).map(rowHeadings)
check('the service picker and the model field share one row',
  configRowHeadings.some((headings) => headings.join('|') === '图像服务|模型'),
  JSON.stringify(configRowHeadings))
check('the model catalog is read automatically, not only on a click',
  source.includes('refreshModels({ silent: true })') && source.includes('}, [form.provider])'),
  'the panel must read the catalog when it opens and when the service changes')

// The third generation mode runs a workflow on the user's own ComfyUI server, so
// the config panel reads that server's saved workflows the same way it reads the
// model catalog: a button plus a manual fallback, plus the address it reads from.
check('the config panel offers to read the workflow list', studioTexts.includes('读取工作流'), JSON.stringify(studioTexts.filter((t) => String(t).includes('工作流'))))
check('the config panel names the ComfyUI workflow field', studioTexts.includes('ComfyUI 工作流'), JSON.stringify(studioTexts.filter((t) => String(t).includes('ComfyUI'))))
check('the config panel explains where the workflow list comes from',
  studioTexts.some((t) => String(t).includes('列表读自 ComfyUI 自己保存工作流的目录')),
  JSON.stringify(studioTexts.filter((t) => String(t).includes('ComfyUI')).slice(0, 8)))
check('the config panel lets the ComfyUI address be overridden', studioTexts.includes('ComfyUI 地址'), JSON.stringify(studioTexts.filter((t) => String(t).includes('地址'))))
check('an empty workflow list does not claim a count',
  !studioTexts.some((t) => /^共 \d+ 个工作流$/.test(String(t))),
  JSON.stringify(studioTexts.filter((t) => String(t).includes('个工作流'))))

const galleryTexts = texts(gallery.component({}))
check('gallery is titled 生图画廊', galleryTexts.includes('生图画廊'), galleryTexts.slice(0, 6).join(' | '))

if (failures.length > 0) {
  console.log('\n' + String(failures.length) + ' FAILURE(S): ' + failures.join(', '))
  process.exit(1)
}
console.log('\nClient bundle executes and registers all four slots correctly.')
