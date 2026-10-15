/**
 * Pure panel state and validation for the image studio.
 *
 * Nothing here touches the network or the disk: the browser half keeps one
 * workspace object, and every value that leaves it for the host is checked here
 * first so the panel can show a precise message instead of a server error.
 */

/** The host refuses more than this many reference images per edit call. */
export const REFERENCE_LIMIT = 4

/** Keep in step with `MAX_IMAGE_BYTES` in `image-api.js`. */
export const MAX_REFERENCE_BYTES = 32 * 1024 * 1024

/** Media types the host accepts as a reference image. */
export const REFERENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Common pixel sizes; the field stays free text for anything else. */
export const SIZE_PRESETS = ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792', 'auto']

/** Providers that take an aspect ratio instead of a pixel size (xAI, Gemini). */
export const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9']

/** Resolution classes offered by Gemini and Grok-class endpoints. */
export const IMAGE_SIZES = ['1K', '2K', '4K']

/** Quality values accepted by the OpenAI-compatible image endpoints. */
export const QUALITY_VALUES = ['low', 'medium', 'high', 'auto']

/** How many results of this session the preview stage keeps around. */
export const RESULT_LIMIT = 12

/** How many images one submitted prompt may produce. */
export const GENERATE_COUNTS = [1, 2, 3, 4]

/**
 * The three surfaces of the workbench.
 *
 * `generate` is text-to-image and sends no reference at all; `edit` is
 * image-to-image and requires at least one reference image; `comfy` hands the
 * prompt to one node-graph workflow in the local ComfyUI registry, which is why
 * it needs its own saved workflow instead of a model name. The switch decides which one a submitted prompt uses, so the same prompt text cannot
 * accidentally edit an image that is still queued from an earlier upload.
 */
export const STUDIO_MODES = ['generate', 'edit', 'comfy']

/** Human labels for the mode switch, keyed by mode id. */
export const MODE_LABELS = { generate: '文生图', edit: '图生图', comfy: 'ComfyUI 工作流' }

/** Where a locally running ComfyUI server is expected when the form is blank. */
export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A credential reference name is an environment-variable-shaped identifier. */
export function isCredentialRefName(value) {
  return typeof value === 'string' && REF_PATTERN.test(value)
}

/** The same-origin URL for one stored image. Empty when the name is unusable. */
export function imageUrl(name) {
  const value = String(name ?? '')
  if (value === '' || /[\\/:\x00]/.test(value) || value.includes('..')) return ''
  return '/image-studio/image?name=' + encodeURIComponent(value)
}

/** The browser-side half of a stored image's URL. */
export function referenceFromName(name, mediaType = 'image/png') {
  const url = imageUrl(name)
  return url === '' ? null : { name, mediaType, url }
}

/** Build the editable form state out of the configuration the host reported. */
export function formFromConfig(config = {}) {
  return {
    provider: config.provider ?? '',
    baseURL: config.baseURL ?? '',
    model: config.model ?? '',
    keyRef: config.keyRef ?? '',
    editFormat: config.editFormat ?? '',
    size: config.size ?? '',
    quality: config.quality ?? '',
    aspectRatio: config.aspectRatio ?? '',
    imageSize: config.imageSize ?? '',
    agentBaseUrl: config.agentBaseUrl ?? '',
    workflow: config.workflow ?? '',
    comfyBaseUrl: config.comfyBaseUrl ?? '',
    mode: 'generate',
    count: '1',
    apiKey: '',
  }
}

/**
 * Validate the configuration form.
 *
 * @returns `{ patch, apiKey }`, where a non-empty `apiKey` is a new secret the
 *   host will write through the credential service.
 * @throws Error with a message meant for the user.
 */
export function configPayload(form, providers = [], editFormats = []) {
  const provider = String(form.provider ?? '').trim()
  if (provider === '') throw new Error('请选择图像服务')
  if (providers.length > 0 && !providers.some((entry) => entry.id === provider)) throw new Error('未知的图像服务：' + provider)
  const keyRef = String(form.keyRef ?? '').trim()
  if (keyRef !== '' && !isCredentialRefName(keyRef)) throw new Error('密钥引用名只能由字母、数字和下划线组成，且不能以数字开头')
  const editFormat = String(form.editFormat ?? '').trim()
  if (editFormat !== '' && editFormats.length > 0 && !editFormats.includes(editFormat)) throw new Error('未知的编辑格式：' + editFormat)
  const baseURL = String(form.baseURL ?? '').trim()
  if (baseURL !== '' && !/^https?:\/\//i.test(baseURL)) throw new Error('图像服务地址必须是完整的绝对 URL')
  return {
    patch: {
      provider,
      baseURL,
      model: String(form.model ?? '').trim(),
      keyRef,
      editFormat,
      size: String(form.size ?? '').trim(),
      quality: String(form.quality ?? '').trim(),
      aspectRatio: String(form.aspectRatio ?? '').trim(),
      imageSize: String(form.imageSize ?? '').trim(),
      agentBaseUrl: String(form.agentBaseUrl ?? '').trim(),
      workflow: String(form.workflow ?? '').trim(),
      comfyBaseUrl: String(form.comfyBaseUrl ?? '').trim(),
    },
    apiKey: String(form.apiKey ?? '').trim(),
  }
}

/** Validate one browser File before it is read, so the browser never stalls. */
export function validateReferenceFile(file) {
  if (!file) throw new Error('请选择一张参考图')
  const mediaType = String(file.type ?? '').toLowerCase()
  if (!REFERENCE_TYPES.includes(mediaType)) throw new Error('参考图必须是 PNG、JPEG、WebP 或 GIF')
  if (Number(file.size) > MAX_REFERENCE_BYTES) {
    throw new Error('单张参考图不能超过 ' + String(Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)) + ' MB')
  }
  return mediaType
}

/** Split one data URL into the base64 payload and the declared media type. */
export function splitDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(String(dataUrl ?? ''))
  if (!match) throw new Error('参考图读取失败，请重新选择')
  return { mediaType: match[1].toLowerCase(), data: match[2] }
}

/**
 * Validate a generation request.
 *
 * @returns the body the host's `/generate` route expects.
 * @throws Error with a message meant for the user.
 */
export function generatePayload(form, references = []) {
  const prompt = String(form.prompt ?? '').trim()
  if (prompt === '') throw new Error('请输入提示词')
  const model = String(form.model ?? '').trim()
  if (model === '') throw new Error('请先在「模型配置」中填写模型名称')
  const mode = normalizeMode(form.mode)
  const list = []
  for (const reference of references) {
    if (typeof reference?.data !== 'string' || reference.data === '') throw new Error('参考图数据不完整，请重新选择')
    list.push({ data: reference.data, mediaType: reference.mediaType })
  }
  if (list.length > REFERENCE_LIMIT) throw new Error('参考图最多 ' + String(REFERENCE_LIMIT) + ' 张')
  if (mode === 'edit' && list.length === 0) throw new Error('图生图至少需要一张参考图')
  return {
    provider: String(form.provider ?? '').trim(),
    mode,
    model,
    prompt,
    negative: String(form.negative ?? '').trim(),
    size: String(form.size ?? '').trim(),
    quality: String(form.quality ?? '').trim(),
    aspectRatio: String(form.aspectRatio ?? '').trim(),
    imageSize: String(form.imageSize ?? '').trim(),
    count: normalizeCount(form.count),
    referenceImages: mode === 'edit' ? list : [],
  }
}

/** Clamp a mode onto the three surfaces the workbench offers. */
export function normalizeMode(value) {
  return STUDIO_MODES.includes(value) ? value : 'generate'
}

/**
 * Validate a ComfyUI submission.
 *
 * Everything outside the panel belongs to ComfyUI, so all this checks is what
 * the panel itself can know: a prompt, a chosen workflow, and at most one
 * reference image (the graph takes a single initial image).
 *
 * @returns the body the host's `/comfy/generate` route expects.
 * @throws Error with a message meant for the user.
 */
export function comfyPayload(form, references = []) {
  const prompt = String(form.prompt ?? '').trim()
  if (prompt === '') throw new Error('请输入提示词')
  const workflow = String(form.workflow ?? '').trim()
  if (workflow === '') throw new Error('请先在「生成方式」中选择一个 ComfyUI 工作流')
  const first = references[0]
  let reference = null
  if (first !== undefined) {
    if (typeof first?.data !== 'string' || first.data === '') throw new Error('参考图数据不完整，请重新选择')
    reference = { data: first.data, mediaType: first.mediaType, name: String(first.name ?? '') }
  }
  return {
    workflow,
    prompt,
    negative: String(form.negative ?? '').trim(),
    reference,
  }
}


/** Clamp a requested batch size into the offered range. */
export function normalizeCount(value) {
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number) || number < 1) return 1
  const max = GENERATE_COUNTS[GENERATE_COUNTS.length - 1]
  return number > max ? max : number
}

/** Human-readable size for a byte count. */
export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return String(value) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  return (value / 1024 / 1024).toFixed(1) + ' MB'
}

/** A short local timestamp for a gallery entry. */
export function formatTime(milliseconds) {
  const value = Number(milliseconds)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  const pad = (part) => String(part).padStart(2, '0')
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** A duration a person can read at a glance, e.g. `1 分 05 秒`. */
export function formatElapsed(milliseconds) {
  const value = Number(milliseconds)
  if (!Number.isFinite(value) || value < 0) return ''
  const total = Math.round(value / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return String(seconds) + ' 秒'
  return String(minutes) + ' 分 ' + String(seconds).padStart(2, '0') + ' 秒'
}

/**
 * The phase one in-flight generation is in, for the preview stage.
 *
 * One panel call is a single opaque POST, so this is an honest time-based
 * estimate rather than real server progress: the bar creeps and never claims to
 * be finished. `ratio` stays below 1 until the answer actually arrives.
 *
 * `mode` only chooses the wording: a ComfyUI run does not touch an image
 * service, so it must not say one is generating.
 */
export function progressStage(milliseconds, mode = 'generate') {
  const value = Number(milliseconds)
  const seconds = Number.isFinite(value) && value > 0 ? Math.round(value / 1000) : 0
  // A local ComfyUI run is a different animal: the prompt is queued, then the
  // sampler works, so the wording must not blame a remote image service.
  if (mode === 'comfy') {
    if (seconds < 3) return { label: '正在读取工作流并排队…', ratio: 0.08, seconds }
    if (seconds < 12) return { label: 'ComfyUI 正在加载模型…', ratio: 0.3, seconds }
    if (seconds < 45) return { label: 'ComfyUI 正在采样，请勿重复提交…', ratio: 0.62, seconds }
    if (seconds < 120) return { label: '工作流仍在执行，请勿重复提交…', ratio: 0.82, seconds }
    return { label: '本地工作流常需数分钟，可以继续等待或按超时提示处理。', ratio: 0.92, seconds }
  }
  if (seconds < 3) return { label: '正在提交提示词…', ratio: 0.08, seconds }
  if (seconds < 12) return { label: '图像服务正在生成…', ratio: 0.3, seconds }
  if (seconds < 45) return { label: '仍在生成，请勿重复提交…', ratio: 0.62, seconds }
  if (seconds < 120) return { label: '生成较慢，仍在等待图像服务返回…', ratio: 0.82, seconds }
  return { label: '已等待较久，可以继续等待或按超时提示处理。', ratio: 0.92, seconds }
}

/**
 * The result the preview stage shows large.
 *
 * Falls back to the newest entry when nothing was explicitly selected, so a
 * fresh generation always becomes the visible one.
 */
export function activeResult(state) {
  const results = Array.isArray(state?.results) ? state.results : []
  if (results.length === 0) return null
  return results.find((entry) => entry.key === state?.active) ?? results[0]
}

/** Every image one answer produced, newest API shape and old single-image shape. */
export function resultImages(result) {
  if (!result) return []
  const list = Array.isArray(result.images) && result.images.length > 0 ? result.images : [result.image]
  return list.filter((image) => image && typeof image.name === 'string' && image.name !== '')
}

/**
 * What the preview stage draws: the active result and all of its images,
 * together with the one the action bar acts on.
 */
export function previewBatch(state) {
  const result = activeResult(state)
  const images = resultImages(result)
  if (images.length === 0) return { result, images, primary: null }
  const primary = images.find((image) => image.name === state?.activeImage) ?? images[0]
  return { result, images, primary }
}

/**
 * The panel's single store.
 *
 * `tab` selects one of the three surfaces. `form` is the editable copy of the
 * host configuration plus the write-only `apiKey` field, and it is always
 * cleared of the secret once the host confirms a save.
 */
export function createWorkspace() {
  let state = {
    tab: 'studio',
    providers: [],
    editFormats: [],
    key: null,
    status: null,
    gallery: [],
    galleryTick: 0,
    form: formFromConfig({}),
    references: [],
    busy: false,
    busySince: 0,
    saving: false,
    models: [],
    modelsFor: '',
    modelsBusy: false,
    modelsError: null,
    workflows: [],
    workflowsLoaded: false,
    workflowsBusy: false,
    workflowsError: null,
    result: null,
    results: [],
    active: null,
    activeImage: null,
    error: null,
    notice: null,
    uncertain: false,
    assistantOpen: false,
  }
  const listeners = new Set()
  const update = (patch) => {
    state = { ...state, ...patch }
    listeners.forEach((fn) => fn(state))
    return state
  }
  return {
    get: () => state,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    update,
    setTab: (tab) => {
      if (state.busy) return
      return update({ tab, error: null })
    },
    /**
     * Switch between text-to-image, image-to-image and the ComfyUI graph mode.
     *
     * The uploaded references are kept, so switching back and forth does not
     * lose the images the user just picked; only `edit` and `comfy` submit them.
     */
    setMode: (mode) => {
      if (state.busy) return
      return update({ form: { ...state.form, mode: normalizeMode(mode) }, error: null })
    },
    /** Adopt the configuration the host reported, keeping any half-typed secret. */
    applyConfig: (data) => update({
      providers: Array.isArray(data?.providers) ? data.providers : state.providers,
      editFormats: Array.isArray(data?.editFormats) ? data.editFormats : state.editFormats,
      key: data?.key ?? state.key,
      status: data?.status ?? state.status,
      form: { ...formFromConfig(data?.config), apiKey: state.form.apiKey },
    }),
    /** Adopt one provider's defaults, but never overwrite what the user typed. */
    chooseProvider: (id) => {
      const provider = state.providers.find((entry) => entry.id === id)
      return update({
        // A catalog belongs to one service, so switching services drops it.
        models: [],
        modelsFor: '',
        modelsBusy: false,
        modelsError: null,
        form: {
          ...state.form,
          provider: id,
          baseURL: provider?.baseURL ?? '',
          keyRef: provider?.apiKeyRef ?? state.form.keyRef,
          editFormat: provider?.editFormats?.[0] ?? state.form.editFormat,
        },
      })
    },
    setField: (key, value) => update({ form: { ...state.form, [key]: value }, error: null }),
    /** Record a new secret in the form; the stored value is untouched until saved. */
    setKey: (value) => update({ form: { ...state.form, apiKey: value }, error: null }),
    setKeyInfo: (key) => update({ key }),
    /**
     * Record the model catalog read from one provider.
     *
     * `modelsFor` names the provider the list belongs to, so a list read for a
     * previously configured service is never shown against the current one.
     */
    setModels: (provider, models) => update({
      models: Array.isArray(models)
        ? [...new Set(models.filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))]
        : [],
      modelsFor: String(provider ?? ''),
      modelsBusy: false,
      modelsError: null,
    }),
    setModelsBusy: (modelsBusy) => update({
      modelsBusy: Boolean(modelsBusy),
      modelsError: modelsBusy ? null : state.modelsError,
    }),
    setModelsError: (error, provider) => update({
      models: [],
      modelsFor: String(provider ?? state.form.provider ?? ''),
      modelsBusy: false,
      modelsError: error ?? null,
    }),
    /**
     * Record the workflow list read from the local ComfyUI server.
     *
     * Entries are `{ name, path }`: `path` is what the host needs to fetch the
     * file, and an entry without one cannot be run, so it is dropped.
     * `workflowsLoaded` distinguishes "ComfyUI answered with an empty directory"
     * from "we have not asked yet", so the panel can show a real empty state.
     */
    setWorkflows: (workflows) => update({
      workflows: Array.isArray(workflows)
        ? workflows.filter((entry) => entry && typeof entry.path === 'string' && entry.path.trim() !== '')
        : [],
      workflowsLoaded: true,
      workflowsBusy: false,
      workflowsError: null,
    }),
    setWorkflowsBusy: (workflowsBusy) => update({
      workflowsBusy: Boolean(workflowsBusy),
      workflowsError: workflowsBusy ? null : state.workflowsError,
    }),
    setWorkflowsError: (error) => update({
      workflows: [],
      workflowsLoaded: true,
      workflowsBusy: false,
      workflowsError: error ?? null,
    }),
    setStatus: (status) => update({ status }),
    setGallery: (images) => update({ gallery: Array.isArray(images) ? images : [] }),
    /** Ask every surface that lists stored images to reload. */
    refreshGallery: () => update({ galleryTick: state.galleryTick + 1 }),
    setReferences: (references) => update({ references, error: null }),
    /**
     * Record one finished generation.
     *
     * The newest result is also `active`, i.e. the one the preview stage shows
     * large. `results` is capped so a long session cannot grow without bound.
     */
    setResult: (result) => {
      const image = result?.image
      const entry = image
        ? { ...result, key: String(image.name) + ':' + String(Date.now()) }
        : null
      const results = entry === null ? state.results : [entry, ...state.results.filter((item) => item.image?.name !== image.name)].slice(0, RESULT_LIMIT)
      return update({
        result,
        results,
        active: entry?.key ?? state.active,
        activeImage: entry === null ? state.activeImage : resultImages(result)[0]?.name ?? null,
        busy: false,
        busySince: 0,
        uncertain: false,
        error: null,
        notice: null,
      })
    },
    /** Focus one earlier result of this session in the preview stage. */
    setActive: (key) => update({ active: key, activeImage: null }),
    /** Focus one image inside the active batch, for the action bar. */
    setActiveImage: (name) => update({ activeImage: name }),
    setSaving: (saving) => update({ saving }),
    setBusy: (busy) => update({ busy, busySince: busy ? Date.now() : 0, error: busy ? null : state.error }),
    setError: (error) => update({ error: error ?? null }),
    setNotice: (notice) => update({ notice: notice ?? null, error: null }),
    setUncertain: (uncertain) => update({ uncertain, busy: false, busySince: 0 }),
    toggleAssistant: () => update({ assistantOpen: !state.assistantOpen }),
    /** Accept the saved configuration and drop the secret from the form. */
    acceptSaved: (data) => update({
      saving: false,
      form: { ...formFromConfig(data?.config), apiKey: '' },
      key: data?.key ?? state.key,
      notice: '模型配置已保存。',
      error: null,
    }),
  }
}

export const workspace = createWorkspace()
