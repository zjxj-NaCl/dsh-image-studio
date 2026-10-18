/**
 * Image studio bundle, browser half.
 *
 * Renders two entries:
 *
 *  - `image-studio-gallery` — a grid of every image this panel has generated,
 *    with a full-size viewer.
 *  - `image-studio-workbench` — the generation surface, plus the model
 *    configuration that decides where those images come from.
 *
 * Both talk only to this deployment's own origin: the host half owns the image
 * API credential and relays the Agent LLM calls, so the browser never holds a
 * secret and there is no CORS surface.
 */

import * as React from 'react'
import * as Model from './studio-model.js'
import { CONFIG_STYLES, LLMConfigPanel, ModelConfigPanel, StudioAssistant, refreshConfig, refreshWorkflows } from './model-config.js'

/** Same-origin prefix owned by this bundle's host half. */
const PANEL = '/image-studio'

const STYLES = `
.cis-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}
.cis-head{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.cis-title{font-size:14px;font-weight:600;}
.cis-meta{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cis-spacer{flex:1;}
.cis-body{flex:1;min-height:0;overflow:auto;padding:16px;}
.cis-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;}
.cis-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);cursor:pointer;display:flex;flex-direction:column;}
.cis-card:hover{border-color:var(--dsw-alias-brand-primary);}
.cis-thumb{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:var(--dsw-alias-bg-layer-2);}
.cis-name{padding:6px 8px;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all;line-height:1.4;}
.cis-empty{padding:40px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.8;}
.cis-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px;}
.cis-full{max-width:92vw;max-height:82vh;object-fit:contain;border-radius:8px;}
.cis-cap{color:#fff;font-size:12px;opacity:.85;word-break:break-all;text-align:center;}
.cis-split{display:flex;gap:16px;align-items:flex-start;}
.cis-col{display:flex;flex-direction:column;gap:10px;}
.cis-col.form{flex:1 1 430px;min-width:340px;max-width:580px;}
.cis-col.preview{flex:1 1 520px;min-width:320px;}
.cis-field{display:flex;flex-direction:column;gap:4px;}
.cis-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);}
.cis-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6;}
.cis-warn{font-size:11px;color:var(--dsw-alias-state-warn-primary);line-height:1.5;}
.cis-input,.cis-select,.cis-area{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;}
.cis-area{min-height:96px;resize:vertical;line-height:1.5;}
.cis-input:disabled,.cis-select:disabled{opacity:.55;cursor:not-allowed;}
.cis-row{display:flex;gap:8px;}
.cis-row>*{flex:1;min-width:0;}
.cis-btn{padding:7px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;font-family:inherit;}
.cis-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);}
.cis-btn:disabled{opacity:.5;cursor:not-allowed;}
.cis-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:600;}
.cis-drop{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;}
.cis-drop:hover{border-color:var(--dsw-alias-brand-primary);}
.cis-thumb2{max-width:100%;max-height:140px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);display:block;}
.cis-status{font-size:12px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);white-space:pre-wrap;line-height:1.5;}
.cis-status.err{color:var(--dsw-alias-state-error-primary);}
.cis-status.ok{color:var(--dsw-alias-state-success-primary);}
.cis-mode{display:flex;gap:6px;flex-wrap:wrap;}
.cis-mode button{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;font-family:inherit;}
.cis-mode button.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:600;}
.cis-mode button:disabled{opacity:.45;cursor:not-allowed;}
.cis-switch{display:inline-flex;gap:2px;padding:2px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);}
.cis-switch button{padding:6px 16px;border-radius:7px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;font-family:inherit;}
.cis-switch button.on{background:var(--dsw-alias-brand-primary);color:#fff;font-weight:600;}
.cis-switch button:disabled{opacity:.45;cursor:not-allowed;}
.cis-count{display:flex;gap:6px;flex-wrap:wrap;}
.cis-count button{min-width:44px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;font-family:inherit;}
.cis-count button.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:600;}
.cis-count button:disabled{opacity:.45;cursor:not-allowed;}
.cis-actions{display:flex;gap:6px;flex-wrap:wrap;}
.cis-column{display:flex;flex-direction:column;gap:10px;min-width:0;}
.cis-details{white-space:pre-wrap;word-break:break-word;font-size:12px;}
.cis-check{display:flex;align-items:start;gap:8px;font-size:12px;line-height:1.6;}
.cis-check input{flex:none;}
.cis-pending{font-size:12px;color:var(--dsw-alias-label-secondary);}
.cis-references{display:flex;gap:8px;flex-wrap:wrap;}
.cis-reference{position:relative;width:88px;}
.cis-reference img{width:88px;height:88px;object-fit:cover;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);display:block;}
.cis-reference button{position:absolute;top:4px;right:4px;padding:0 6px;line-height:18px;}
.cis-col.preview{flex:1 1 520px;min-width:320px;display:flex;flex-direction:column;gap:10px;}
.cis-stage{position:relative;flex:1;min-height:300px;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;}
.cis-stage.batch{align-items:stretch;padding:10px;}
.cis-stage-img{max-width:100%;max-height:62vh;object-fit:contain;display:block;cursor:zoom-in;}
.cis-batch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%;}
.cis-batch.single{grid-template-columns:minmax(0,1fr);}
.cis-cell{position:relative;display:flex;align-items:center;justify-content:center;min-height:150px;border:2px solid transparent;border-radius:10px;overflow:hidden;cursor:pointer;background:var(--dsw-alias-bg-layer-2);}
.cis-cell.on{border-color:var(--dsw-alias-brand-primary);}
.cis-cell img{width:100%;height:100%;max-height:34vh;object-fit:contain;display:block;}
.cis-mark{position:absolute;top:8px;right:8px;width:20px;height:20px;line-height:19px;text-align:center;border-radius:50%;background:var(--dsw-alias-brand-primary);color:#fff;font-size:12px;font-weight:700;}
.cis-badge{position:absolute;top:10px;left:10px;padding:2px 9px;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font-size:11px;font-weight:600;pointer-events:none;}
.cis-stage-empty{display:flex;flex-direction:column;gap:6px;align-items:center;padding:32px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.9;}
.cis-progress{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;width:100%;box-sizing:border-box;padding:32px;}
.cis-spin{width:28px;height:28px;border-radius:50%;border:3px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:cis-spin .9s linear infinite;}
@keyframes cis-spin{to{transform:rotate(360deg);}}
.cis-bar{width:min(440px,80%);height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}
.cis-bar>span{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .4s ease;}
.cis-ribbon{display:flex;gap:8px;overflow-x:auto;padding:2px 0;}
.cis-ribbon-item{position:relative;flex:none;width:78px;height:78px;border-radius:8px;overflow:hidden;border:2px solid transparent;cursor:pointer;background:var(--dsw-alias-bg-layer-2);}
.cis-ribbon-item.on{border-color:var(--dsw-alias-brand-primary);}
.cis-ribbon-item img{width:100%;height:100%;object-fit:cover;display:block;}
.cis-ribbon-tag{position:absolute;bottom:0;left:0;right:0;font-size:10px;text-align:center;background:rgba(0,0,0,.55);color:#fff;}
.cis-pill{font-size:11px;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}
.cis-pill.ok{color:var(--dsw-alias-state-success-primary);}
.cis-pill.err{color:var(--dsw-alias-state-error-primary);}
.cis-pill.busy{color:var(--dsw-alias-brand-primary);}
.cis-inline{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
@media(max-width:900px){.cis-split{flex-direction:column;}.cis-col.form,.cis-col.side,.cis-col.preview{min-width:0;width:100%;max-width:none;}.cis-head{flex-wrap:wrap;}.cis-body{padding:12px;}.cis-stage{min-height:220px;}}
`

/** Gallery icon: a framed picture. */
function GalleryIcon(props) {
  const size = props?.size ?? 18
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { opacity: props?.active ? 1 : 0.75 },
  },
    React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2.5 }),
    React.createElement('circle', { cx: 8.6, cy: 8.6, r: 1.5 }),
    React.createElement('path', { d: 'M21 15.5l-4.6-4.6L7 20.3' }),
  )
}

/** Studio icon: a landscape with a sun. */
function StudioIcon(props) {
  const size = props?.size ?? 18
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { opacity: props?.active ? 1 : 0.75 },
  },
    React.createElement('path', { d: 'M4 20l4-9 4 6 3-4 5 7z' }),
    React.createElement('circle', { cx: 8.5, cy: 6.5, r: 1.6 }),
  )
}

/**
 * Call one panel route and decode its JSON answer.
 *
 * @param path - the panel-relative path.
 * @param options - optional method and body.
 * @returns the decoded body, or a synthesized error object.
 */
async function callPanel(path, options = {}) {
  try {
    const response = await fetch(PANEL + path, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const text = await response.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = undefined }
    if (!response.ok) {
      return { ok: false, status: response.status, uncertain: [502, 504].includes(response.status), error: parsed?.error ?? ('HTTP ' + String(response.status)) }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.ok === false || parsed.error !== undefined) {
      return { ok: false, uncertain: true, error: parsed?.error ?? parsed?.message ?? '响应不完整，任务结果待确认；请勿重复提交' }
    }
    return { ok: true, data: parsed }
  } catch (error) {
    return { ok: false, uncertain: true, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Read a picked file as a data URL.
 *
 * @param file - the selected File.
 * @returns the data URL text.
 */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** The gallery surface: everything this panel has generated. */
function Gallery() {
  const ws = useWorkspace()
  const [state, setState] = React.useState({ loading: true, images: [], error: null })
  const [selected, setSelected] = React.useState(null)

  const load = React.useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }))
    void callPanel('/gallery').then((res) => {
      if (!res.ok) {
        setState({ loading: false, images: [], error: res.error })
        return
      }
      Model.workspace.setGallery(res.data?.images ?? [])
      setState({ loading: false, images: res.data?.images ?? [], error: null })
    })
  }, [])

  React.useEffect(() => { load() }, [load, ws.result, ws.galleryTick])

  const remove = async (name) => {
    if (!window.confirm('删除这张图片？文件会从面板存储中移除。')) return
    const res = await callPanel('/delete', { method: 'POST', body: { name } })
    if (!res.ok) {
      setState((previous) => ({ ...previous, error: res.error }))
      return
    }
    if (selected?.name === name) setSelected(null)
    load()
  }

  const children = [
    React.createElement('div', { className: 'cis-head', key: 'head' },
      React.createElement('div', { className: 'cis-title' }, '生图画廊'),
      React.createElement('div', { className: 'cis-meta' }, state.loading ? '读取中…' : String(state.images.length) + ' 张图片'),
      React.createElement('div', { className: 'cis-spacer' }),
      React.createElement('button', { className: 'cis-btn', onClick: load }, '刷新'),
    ),
  ]

  if (state.error) {
    children.push(React.createElement('div', { className: 'cis-body', key: 'err' },
      React.createElement('div', { className: 'cis-status err' }, state.error)))
  } else if (!state.loading && state.images.length === 0) {
    children.push(React.createElement('div', { className: 'cis-body', key: 'empty' },
      React.createElement('div', { className: 'cis-empty' }, '还没有图片。先在「生图工作台」中生成一张。')))
  } else {
    children.push(React.createElement('div', { className: 'cis-body', key: 'grid' },
      React.createElement('div', { className: 'cis-grid' },
        state.images.map((image) => React.createElement('div', {
          className: 'cis-card', key: image.name, title: image.name,
          onClick: () => setSelected(image),
        },
          React.createElement('img', { className: 'cis-thumb', loading: 'lazy', alt: image.name, src: Model.imageUrl(image.name) }),
          React.createElement('div', { className: 'cis-name' }, image.name),
          React.createElement('div', { className: 'cis-name' },
            Model.formatBytes(image.bytes) + (Model.formatTime(image.createdAt) ? ' · ' + Model.formatTime(image.createdAt) : '')),
          React.createElement('div', { className: 'cis-actions', onClick: (event) => event.stopPropagation() },
            React.createElement('button', { className: 'cis-btn', onClick: () => void remove(image.name) }, '删除'),
          ),
        )))))
  }

  if (selected !== null) {
    children.push(React.createElement('div', {
      className: 'cis-overlay', key: 'overlay', onClick: () => setSelected(null),
    },
      React.createElement('img', { className: 'cis-full', alt: selected.name, src: Model.imageUrl(selected.name) }),
      React.createElement('div', { className: 'cis-cap' }, selected.name + ' · 点击任意处关闭'),
    ))
  }

  return React.createElement('div', { className: 'cis-root' }, children)
}

/**
 * Pick and decode up to four reference images for an edit call.
 *
 * Only the ComfyUI surface is limited to one image; the label says so, because
 * anything past the first is silently dropped by the `comfy` payload.
 */
function ReferencePicker() {
  const ws = useWorkspace()
  const [notice, setNotice] = React.useState(null)
  const locked = ws.busy
  const mode = Model.normalizeMode(ws.form.mode)
  const editing = mode === 'edit'
  const comfy = mode === 'comfy'
  const pick = async (files) => {
    if (locked) return
    setNotice(null)
    const next = [...ws.references]
    for (const file of Array.from(files ?? [])) {
      try {
        const mediaType = Model.validateReferenceFile(file)
        const { data } = Model.splitDataUrl(await readAsDataUrl(file))
        if (next.length >= Model.REFERENCE_LIMIT) throw new Error('参考图最多 ' + String(Model.REFERENCE_LIMIT) + ' 张')
        next.push({ name: file.name, mediaType, data, url: URL.createObjectURL(file) })
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error))
        break
      }
    }
    Model.workspace.setReferences(next)
  }
  const label = comfy
    ? '参考图（可选，只用第一张）'
    : editing
      ? '参考图（图生图必填，最多 ' + String(Model.REFERENCE_LIMIT) + ' 张）'
      : '参考图（文生图不使用，最多 ' + String(Model.REFERENCE_LIMIT) + ' 张）'
  return h('div', { className: 'cis-field' },
    h('span', { className: 'cis-label' }, label),
    h('input', {
      className: 'cis-input', type: 'file', accept: Model.REFERENCE_TYPES.join(','), multiple: true, disabled: locked,
      onChange: (event) => { void pick(event.target.files); event.target.value = '' },
    }),
    ws.references.length > 0 ? h('div', { className: 'cis-references' },
      ...ws.references.map((reference, index) => h('div', { className: 'cis-reference', key: index },
        h('img', { src: reference.url, alt: reference.name }),
        h('button', { className: 'cis-btn', disabled: locked, onClick: () => Model.workspace.setReferences(ws.references.filter((_, i) => i !== index)) }, '×')))) : null,
    h('span', { className: 'cis-hint' }, comfy
      ? '作为图生图的初始图上传给工作流；除第一张外的选择会被忽略。单张上限 ' + String(Math.round(Model.MAX_REFERENCE_BYTES / 1024 / 1024)) + ' MB。'
      : editing
        ? '图生图会把这些图发给编辑接口，单张上限 ' + String(Math.round(Model.MAX_REFERENCE_BYTES / 1024 / 1024)) + ' MB。'
        : '当前是文生图，参考图不会被提交；切到「图生图」即用它们修复或变换。单张上限 ' + String(Math.round(Model.MAX_REFERENCE_BYTES / 1024 / 1024)) + ' MB。'),
    notice ? h('span', { className: 'cis-warn' }, notice) : null)
}

/**
 * The text-to-image / image-to-image / ComfyUI-workflow switch.
 *
 * All three modes share one prompt box and one reference picker; only this
 * switch decides which endpoint a submitted prompt reaches.
 */
function ModeSwitch() {
  const ws = useWorkspace()
  const locked = ws.busy
  return h('div', { className: 'cis-switch', role: 'tablist' },
    ...Model.STUDIO_MODES.map((mode) => h('button', {
      type: 'button', key: mode, role: 'tab', disabled: locked,
      'aria-selected': ws.form.mode === mode,
      className: ws.form.mode === mode ? 'on' : '',
      onClick: () => Model.workspace.setMode(mode),
    }, Model.MODE_LABELS[mode])))
}

/** Re-render once a second while a generation is in flight. */
function useElapsed(active) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/**
 * The generation preview frame.
 *
 * One submitted prompt can come back with up to four images, so the stage draws
 * the whole batch at once, marks every cell with its index, and keeps one cell
 * selected for the action bar underneath. While a request is in flight the same
 * stage shows an honest time-based progress estimate instead.
 */
function PreviewStage(props) {
  const ws = useWorkspace()
  const [zoom, setZoom] = React.useState(null)
  const [notice, setNotice] = React.useState(null)
  const [working, setWorking] = React.useState(false)
  const now = useElapsed(ws.busy)
  const batch = Model.previewBatch(ws)
  const images = batch.images
  const primary = batch.primary
  const elapsed = ws.busy ? Math.max(0, now - (ws.busySince || now)) : 0
  const stage = Model.progressStage(elapsed, Model.normalizeMode(ws.form.mode))

  const remove = async (name) => {
    if (!window.confirm('删除这张图片？文件会从面板存储中移除。')) return
    setWorking(true)
    const res = await callPanel('/delete', { method: 'POST', body: { name } })
    setWorking(false)
    if (!res.ok) { setNotice(res.error); return }
    setNotice(null)
    Model.workspace.refreshGallery()
  }

  const useAsReference = async (image) => {
    if (ws.references.length >= Model.REFERENCE_LIMIT) {
      setNotice('参考图最多 ' + String(Model.REFERENCE_LIMIT) + ' 张，请先移除一张。')
      return
    }
    setWorking(true)
    try {
      const response = await fetch(Model.imageUrl(image.name))
      if (!response.ok) throw new Error('读取图片失败')
      const blob = await response.blob()
      const { mediaType, data } = Model.splitDataUrl(await readAsDataUrl(blob))
      Model.workspace.setReferences([...ws.references, { name: image.name, mediaType, data, url: URL.createObjectURL(blob) }])
      // The user asked to edit this image, so make the switch agree with the intent.
      Model.workspace.setMode('edit')
      Model.workspace.setTab('studio')
      setNotice('已加入参考图并切到「图生图」，改写提示词后即可编辑。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  const children = [
    h('div', { className: 'cis-label', key: 'label' },
      ws.busy ? '正在生成…' : images.length > 1 ? '本次结果 · ' + String(images.length) + ' 张' : '本次结果'),
  ]

  if (ws.busy) {
    children.push(h('div', { className: 'cis-stage', key: 'stage' },
      h('div', { className: 'cis-progress' },
        h('div', { className: 'cis-spin' }),
        h('div', { className: 'cis-hint' }, stage.label),
        h('div', { className: 'cis-bar' }, h('span', { style: { width: String(Math.round(stage.ratio * 100)) + '%' } })),
        h('div', { className: 'cis-hint' }, '已等待 ' + Model.formatElapsed(elapsed) + ' · 最多等待 ' + String(Math.round((ws.status?.timeoutMs ?? 300000) / 1000)) + ' 秒。'))))
  } else if (images.length === 0) {
    children.push(h('div', { className: 'cis-stage', key: 'stage' },
      h('div', { className: 'cis-stage-empty' },
        h('div', null, '尚无本次会话的生成结果。'),
        h('div', null, ws.form.mode === 'edit'
          ? '选好参考图、写完提示词后点「开始编辑」，结果会出现在这里，并同时存入「生图画廊」。'
          : '填写提示词后点「生成图片」，结果会出现在这里，并同时存入「生图画廊」。'))))
  } else {
    children.push(h('div', { className: 'cis-stage batch', key: 'stage' },
      h('div', { className: 'cis-batch' + (images.length === 1 ? ' single' : '') },
        ...images.map((image, index) => {
          const selected = primary !== null && image.name === primary.name
          return h('div', {
            className: 'cis-cell' + (selected ? ' on' : ''),
            key: image.name,
            title: image.name,
            onClick: () => Model.workspace.setActiveImage(image.name),
            onDoubleClick: () => setZoom(image),
          },
            h('img', { alt: image.name, src: Model.imageUrl(image.name) }),
            h('div', { className: 'cis-badge' }, '#' + String(index + 1)),
            selected ? h('div', { className: 'cis-mark' }, '✓') : null)
        }))))
  }

  if (images.length > 0 && !ws.busy) {
    const facts = [
      Model.formatBytes(primary?.bytes),
      Model.formatElapsed(batch.result?.elapsedMs ?? 0),
      batch.result?.count > 1 ? '本批 ' + String(batch.result.count) + ' 张' : null,
    ].filter(Boolean).join(' · ')
    children.push(h('div', { className: 'cis-actions', key: 'actions' },
      button('全屏查看', () => setZoom(primary), working || primary === null),
      button('继续编辑', () => void useAsReference(primary), working || primary === null || ws.references.length >= Model.REFERENCE_LIMIT),
      button('再次生成', () => props?.onRegenerate?.(), working || ws.busy, true),
      button('删除这张', () => void remove(primary.name), working || primary === null)))
    const headline = batch.result?.mode === 'comfy'
      ? '工作流：' + String(batch.result?.workflow ?? '') + ' · ComfyUI 工作流'
      : '服务：' + String(batch.result?.provider ?? '') + ' / ' + String(batch.result?.model ?? '') +
        ' · ' + (batch.result?.mode === 'edit' ? '参考图编辑' : '文生图')
    children.push(h('div', { className: 'cis-hint', key: 'facts' },
      headline + (facts === '' ? '' : ' · ' + facts)))
    if (batch.result?.partialError) {
      children.push(h('div', { className: 'cis-warn', key: 'partial' },
        '部分图片未能生成：' + String(batch.result.partialError)))
    }
    if (notice) children.push(h('div', { className: 'cis-hint', key: 'notice' }, notice))
    if (images.length > 1) {
      children.push(h('div', { className: 'cis-ribbon', key: 'ribbon' },
        ...images.map((image, index) => h('div', {
          className: 'cis-ribbon-item' + (primary !== null && image.name === primary.name ? ' on' : ''),
          key: image.name, title: image.name,
          onClick: () => Model.workspace.setActiveImage(image.name),
        },
          h('img', { alt: image.name, src: Model.imageUrl(image.name) }),
          h('div', { className: 'cis-ribbon-tag' }, '#' + String(index + 1))))))
    }
  }

  if (zoom !== null) {
    children.push(h('div', {
      className: 'cis-overlay', key: 'zoom', onClick: () => setZoom(null),
    },
      h('img', { className: 'cis-full', alt: zoom.name, src: Model.imageUrl(zoom.name) }),
      h('div', { className: 'cis-cap' }, zoom.name + ' · ' + Model.formatBytes(zoom.bytes) + ' · 点击任意处关闭')))
  }

  return h('div', { className: 'cis-col preview' }, children)
}

/** The generation surface. */
function StudioWorkbench() {
  const ws = useWorkspace()
  const [prompt, setPrompt] = React.useState('')
  const [negative, setNegative] = React.useState('')
  const [notice, setNotice] = React.useState(null)
  React.useEffect(() => { void refreshConfig() }, [])
  const busy = ws.busy
  const ready = ws.status?.ready === true
  const mode = Model.normalizeMode(ws.form.mode)
  const editing = mode === 'edit'
  const comfy = mode === 'comfy'
  const workflowReady = String(ws.form.workflow ?? '').trim() !== ''
  // The address on screen is where the ComfyUI surface points right now. It is the
  // same form field the configuration panel edits, so a machine can be selected
  // and run without saving the configuration first.
  const comfyBase = String(ws.form.comfyBaseUrl ?? '').trim()
  // A workflow list belongs to the address it was read from; showing one read from
  // another machine would offer names that cannot be fetched.
  const workflowCatalog = ws.workflowsFor === comfyBase ? ws.workflows : []
  const knownWorkflow = workflowCatalog.some((entry) => entry.path === ws.form.workflow)
  // The workflow list is whatever the local ComfyUI has saved, so it is only
  // worth reading once the user actually picks the ComfyUI surface. Changing the
  // address afterwards is an explicit 「读取工作流」 click rather than an effect,
  // so typing an address does not fire a request per keystroke.
  React.useEffect(() => {
    if (!comfy || ws.workflowsLoaded || ws.workflowsBusy) return
    void refreshWorkflows()
  }, [comfy, ws.workflowsLoaded, ws.workflowsBusy])
  const generate = async () => {
    if (busy) return
    let body
    try {
      body = comfy
        ? Model.comfyPayload({ ...ws.form, prompt, negative }, ws.references)
        : Model.generatePayload({ ...ws.form, prompt, negative }, ws.references)
    } catch (error) {
      Model.workspace.setError(error.message)
      return
    }
    Model.workspace.setBusy(true)
    setNotice(comfy
      ? '正在把提示词交给本机 ComfyUI 工作流，可能需要数分钟，请勿重复提交…'
      : '正在调用图像服务，可能需要一到数分钟，请勿重复提交…')
    const res = await callPanel(comfy ? '/comfy/generate' : '/generate', { method: 'POST', body })
    if (!res.ok) {
      if (res.uncertain) {
        Model.workspace.setUncertain(true)
        setNotice(null)
        return
      }
      Model.workspace.setBusy(false)
      Model.workspace.setError(res.error)
      setNotice(null)
      return
    }
    Model.workspace.setResult(res.data)
    Model.workspace.setReferences([])
    setNotice(res.data?.note ? String(res.data.note) : '生成完成，已存入画廊。')
  }
  return h('div', { className: 'cis-root' },
    h('div', { className: 'cis-head', key: 'head' },
      h('div', { className: 'cis-title' }, '生图工作台'),
      h('div', { className: 'cis-mode' },
        button('生图', () => Model.workspace.setTab('studio'), busy, ws.tab === 'studio'),
        button('模型配置', () => Model.workspace.setTab('config'), busy, ws.tab === 'config')),
      h('div', { className: 'cis-spacer' }),
      h('div', { className: 'cis-meta' },
        // Readiness is per-mode: a ComfyUI run does not touch the image service,
        // so an unconfigured image key must not mark the workbench unready, and
        // naming the image provider there would point at the wrong worker.
        comfy
          ? (workflowReady ? '已就绪' : '尚未就绪') + ' · ComfyUI' + (workflowReady ? ' / ' + ws.form.workflow : ' / 未选工作流')
          : (ready ? '已就绪' : '尚未就绪') + ' · ' + (ws.form.provider || '未选服务') + (ws.form.model ? ' / ' + ws.form.model : ' / 未填模型'))),
    ws.uncertain ? h('div', { className: 'cis-status err', role: 'alert', style: { flex: 'none', margin: '12px 16px 0' } },
      '上一次生成的结果无法确认。请先到图像服务后台核对是否已产生图片，再决定是否重试；面板不会自动重试。',
      h('div', { className: 'cis-actions', style: { paddingTop: '8px' } },
        button('我已核实，解除提交锁', () => {
          if (window.confirm('确认已核对图像服务后台，没有再等待中的重复任务？此操作不会自动重试。')) Model.workspace.setUncertain(false)
        }, false, true))) : null,
    h('div', { className: 'cis-body' },
      h('div', { hidden: ws.tab !== 'studio' },
        h('div', { className: 'cis-split' },
          h('div', { className: 'cis-col form' },
            h('div', { className: 'cis-field' },
              h('span', { className: 'cis-label' }, '生成方式'),
              h(ModeSwitch),
              h('span', { className: 'cis-hint' }, comfy
                ? 'ComfyUI 工作流：把提示词交给本机 ComfyUI 里选中的工作流执行；可选一张参考图走它的 LoadImage 节点，产物会回灌进画廊。'
                : editing
                  ? '图生图：把参考图交给编辑接口，按提示词修改或变换。'
                  : '文生图：只按提示词出图，不会上传参考图。')),
            // The ComfyUI surface carries its own address and its own workflow
            // picker: it talks straight to that server, so the image-service
            // configuration has nothing to say about where it runs or what it runs.
            comfy ? h('div', { className: 'cis-field' },
              h('span', { className: 'cis-label' }, 'ComfyUI 地址'),
              h('div', { className: 'cis-row' },
                h('input', {
                  className: 'cis-input', value: ws.form.comfyBaseUrl, disabled: busy,
                  placeholder: Model.DEFAULT_COMFY_URL,
                  onChange: (event) => Model.workspace.setField('comfyBaseUrl', event.target.value),
                }),
                button(ws.workflowsBusy ? '正在读取…' : '读取工作流', () => void refreshWorkflows(), busy || ws.workflowsBusy)),
              h('span', { className: 'cis-hint' }, '填本机 ComfyUI 的 HTTP 地址；留空则用 ' + Model.DEFAULT_COMFY_URL + '。改地址后点「读取工作流」重新取列表，不必先去「模型配置」保存。')) : null,
            comfy ? h('label', { className: 'cis-field' },
              h('span', { className: 'cis-label' }, '工作流'),
              workflowCatalog.length > 0
                ? h('select', {
                  className: 'cis-select', value: ws.form.workflow, disabled: busy,
                  onChange: (event) => Model.workspace.setField('workflow', event.target.value),
                },
                  h('option', { value: '', key: '' }, '（请选择工作流）'),
                  // Keep a configured workflow selectable even when this server no
                  // longer lists it, so the form cannot silently lose it.
                  ws.form.workflow !== '' && !knownWorkflow
                    ? h('option', { value: ws.form.workflow, key: ws.form.workflow }, ws.form.workflow + '（当前配置，不在列表中）')
                    : null,
                  ...workflowCatalog.map((entry) => h('option', { value: entry.path, key: entry.path }, entry.name)))
                // The enclosing label already draws the heading, so the manual
                // fallback is a bare input rather than field().
                : h('input', {
                  className: 'cis-input', value: ws.form.workflow, disabled: busy,
                  placeholder: 'sd35_large',
                  onChange: (event) => Model.workspace.setField('workflow', event.target.value),
                }),
              workflowCatalog.length > 0
                ? h('span', { className: 'cis-hint' }, '共 ' + workflowCatalog.length + ' 个工作流，读自 ' + (comfyBase === '' ? Model.DEFAULT_COMFY_URL : comfyBase))
                : h('span', { className: 'cis-hint' }, '还没读到工作流列表：填好地址后点「读取工作流」，或手工填写 ComfyUI 里的工作流文件名。'),
              ws.workflowsError ? h('span', { className: 'cis-warn' }, ws.workflowsError) : null) : null,
            field('提示词', prompt, setPrompt, { textarea: true, disabled: busy, maxLength: 8000 }),
            field('负向提示词（可选）', negative, setNegative, { textarea: true, disabled: busy, maxLength: 4000 }),
            h(ReferencePicker),
            comfy ? null : h('div', { className: 'cis-field' },
              h('span', { className: 'cis-label' }, '生成数量'),
              h('div', { className: 'cis-count' },
                ...Model.GENERATE_COUNTS.map((value) => h('button', {
                  type: 'button', key: value, disabled: busy,
                  className: String(value) === String(ws.form.count) ? 'on' : '',
                  onClick: () => Model.workspace.setField('count', String(value)),
                }, String(value) + ' 张'))),
              h('span', { className: 'cis-hint' }, '一次提交最多取回 ' + String(Model.GENERATE_COUNTS[Model.GENERATE_COUNTS.length - 1]) + ' 张；慢速服务建议先用 1 张试跑。')),
            h('div', { className: 'cis-actions' },
              button(comfy ? '运行工作流' : editing ? '开始编辑' : '生成图片', () => void generate(), busy || prompt.trim() === '' || (comfy && !workflowReady), true),
              button('清空提示词', () => { setPrompt(''); setNegative(''); Model.workspace.setError(null) }, busy)),
            ws.error ? h('div', { className: 'cis-status err', role: 'alert' }, ws.error) : null,
            notice ? h('div', { className: 'cis-status', role: 'status' }, notice) : null,
            h('div', { className: 'cis-hint' }, comfy
              ? '工作流里的尺寸、步数、采样器等都以 ComfyUI 保存的值为准；「模型配置」里的尺寸/比例/档位/质量不会提交。\n生成结果会复制进面板存储，可在「生图画廊」查看。'
              : '参数取自「模型配置」当前值：' + [
                ws.form.size ? '尺寸 ' + ws.form.size : null,
                ws.form.aspectRatio ? '比例 ' + ws.form.aspectRatio : null,
                ws.form.imageSize ? '档位 ' + ws.form.imageSize : null,
                ws.form.quality ? '质量 ' + ws.form.quality : null,
              ].filter(Boolean).join(' · ') + (ws.form.size || ws.form.aspectRatio || ws.form.imageSize || ws.form.quality ? '' : '仅使用模型默认尺寸。') + '\n生成结果保存在面板存储中，可在「生图画廊」查看。')),
          h(PreviewStage, { onRegenerate: () => void generate() }))),
      h('div', { hidden: ws.tab !== 'config' },
        h('div', { className: 'cis-service-grid' }, h(ModelConfigPanel), h(StudioAssistant)),
        h('div', { style: { paddingTop: '16px' } }, h(LLMConfigPanel)))))
}

/**
 * Register both surfaces into the shell.
 *
 * @param ctx - the client plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: GALLERY_SLOT_ID },
    Gallery,
  )), 'dsh-image-studio: gallery panel')

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: STUDIO_SLOT_ID },
    StudioWorkbench,
  )), 'dsh-image-studio: studio panel')

  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: GALLERY_SLOT_ID, label: '生图画廊', order: 50 },
    GalleryIcon,
  )), 'dsh-image-studio: gallery entry')

  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: STUDIO_SLOT_ID, label: '生图工作台', order: 49 },
    StudioIcon,
  )), 'dsh-image-studio: studio entry')

  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = STYLES + CONFIG_STYLES
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-image-studio: styles')
}

/** Slot ids registered by this bundle. */
export const GALLERY_SLOT_ID = 'image-studio-gallery'

/** Slot id of the generation surface. */
export const STUDIO_SLOT_ID = 'image-studio-workbench'

export const inject = ['slots']

function useWorkspace() {
  const [state, setState] = React.useState(Model.workspace.get())
  React.useEffect(() => { const dispose = Model.workspace.subscribe(setState); setState(Model.workspace.get()); return dispose }, [])
  return state
}
const h = React.createElement
function button(label, onClick, disabled = false, primary = false, key) {
  return h('button', { type: 'button', key, className: 'cis-btn' + (primary ? ' primary' : ''), onClick, disabled }, label)
}
function field(label, value, onChange, options = {}) {
  const { textarea, hint, ...props } = options
  return h('label', { className: 'cis-field' }, h('span', { className: 'cis-label' }, label),
    h(textarea ? 'textarea' : 'input', { className: textarea ? 'cis-area' : 'cis-input', value,
      onChange: event => onChange(event.target.value), ...props }), hint ? h('span', { className: 'cis-hint' }, hint) : null)
}
function checkbox(label, checked, onChange, disabled = false) {
  return h('label', { className: 'cis-check' }, h('input', { type: 'checkbox', checked, disabled,
    onChange: event => onChange(event.target.checked) }), label)
}
