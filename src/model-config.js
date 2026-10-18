/**
 * Model configuration and the text assistant.
 *
 * Two independent halves:
 *
 *  - `ModelConfigPanel` configures the *image* service this panel calls: which
 *    provider, which address, which model, which credential reference, and
 *    optionally a new API key to store. The key itself is write-only — the host
 *    only ever reports whether the reference currently resolves.
 *  - `LLMConfigPanel` and `StudioAssistant` talk to the project Agent through the
 *    host's same-origin proxy. That traffic is unrelated to image generation and
 *    shares only this panel's route prefix.
 */

export const CONFIG_STYLES = `
.cis-services{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);padding:10px 16px;max-height:45vh;overflow:auto;}
.cis-service-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
.cis-assistant-log{height:180px;overflow:auto;display:flex;flex-direction:column;gap:8px;}
.cis-assistant-message{padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;white-space:pre-wrap;word-break:break-word;font-size:12px;}
.cis-assistant-message.user{background:var(--dsw-alias-bg-layer-2);}
.cis-service-body{padding-top:12px;}
.cis-badge{font-size:11px;padding:2px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);}
.cis-badge.ok{color:var(--dsw-alias-state-success-primary);}
.cis-badge.warn{color:var(--dsw-alias-state-warn-primary);}
@media(max-width:850px){.cis-service-grid{grid-template-columns:minmax(0,1fr);}.cis-services{max-height:55vh;}}
`

/** The image-service configuration surface. */
export function ModelConfigPanel() {
  const ws = useWorkspace()
  const form = ws.form
  const provider = ws.providers.find((entry) => entry.id === form.provider)
  const locked = ws.saving || ws.busy
  const save = async () => {
    let payload
    try {
      payload = Model.configPayload(form, ws.providers, ws.editFormats)
    } catch (error) {
      Model.workspace.setError(error.message)
      return
    }
    Model.workspace.setSaving(true)
    Model.workspace.setError(null)
    const res = await callPanel('/config/save', { method: 'POST', body: { ...payload.patch, apiKey: payload.apiKey } })
    Model.workspace.setSaving(false)
    if (!res.ok) {
      Model.workspace.setError(res.error)
      return
    }
    Model.workspace.acceptSaved(res.data)
  }
  const options = (values, current) => values.map((value) => h('option', { value, key: value }, value === '' ? '（不指定）' : value))
  // The catalog is only valid for the provider it was read from, and only while
  // the user has not switched away from it.
  const catalogFresh = ws.modelsFor !== '' && ws.modelsFor === form.provider
  const catalog = catalogFresh ? ws.models : []
  const knownModel = catalog.includes(form.model)
  const workflowCatalog = ws.workflows
  const knownWorkflow = workflowCatalog.some((entry) => entry.path === form.workflow)
  const loadModels = () => void refreshModels()
  // Choosing a service should hand the user a model dropdown rather than a manual
  // step, so the catalog is read once when the panel appears and again whenever
  // the service changes. A catalog that is already fresh for this service is
  // kept, and the automatic read stays silent about failures.
  React.useEffect(() => {
    const current = Model.workspace.get()
    const active = String(current.form.provider ?? '')
    if (active === '') return
    if (current.modelsFor === active && (current.models.length > 0 || current.modelsBusy)) return
    void refreshModels({ silent: true })
  }, [form.provider])
  return h('section', { className: 'cis-column', 'aria-label': '图像模型配置' },
    h('div', { className: 'cis-label' }, '图像服务与模型'),
    h('div', { className: 'cis-hint' },
      '生图由面板直接调用所选图像服务；「ComfyUI 工作流」模式不走这里，而是直连本机 ComfyUI。密钥写入 DSH 凭据存储，面板只记录引用名，不回传密钥内容。'),
    h('div', { className: 'cis-row' },
      h('label', { className: 'cis-field' }, h('span', { className: 'cis-label' }, '图像服务'),
        h('select', { className: 'cis-select', value: form.provider, disabled: locked,
          onChange: (event) => Model.workspace.chooseProvider(event.target.value) },
          ...ws.providers.map((entry) => h('option', { value: entry.id, key: entry.id }, entry.label)))),
      // The model sits beside the service, the way the built-in image settings
      // draw them. The enclosing label already draws the heading, so the fallback
      // is a bare input rather than field(), which would add a second 「模型」 heading.
      h('label', { className: 'cis-field' }, h('span', { className: 'cis-label' }, '模型'),
        catalog.length > 0
          ? h('select', {
            className: 'cis-select',
            value: form.model,
            disabled: locked,
            onChange: (event) => Model.workspace.setField('model', event.target.value),
          },
            // Without this the browser paints the first option while the form still
            // holds no model, so an empty selection has to stay visibly empty.
            form.model === '' ? h('option', { value: '', key: '' }, '（未选择）') : null,
            // Keep the configured model selectable even when the service no longer
            // lists it, so saving an unchanged form cannot silently drop it.
            form.model !== '' && !knownModel
              ? h('option', { value: form.model, key: form.model }, form.model + '（当前配置，不在列表中）')
              : null,
            ...catalog.map((value) => h('option', { value, key: value }, value)))
          : h('input', { className: 'cis-input', value: form.model, disabled: locked,
            onChange: (event) => Model.workspace.setField('model', event.target.value) }))),
    field('服务地址', form.baseURL, (value) => Model.workspace.setField('baseURL', value), {
      disabled: locked,
      hint: provider?.baseURL ? '留空则使用默认：' + provider.baseURL : '兼容渠道必须填写完整的基础地址，例如 https://example.com/v1',
    }),
    h('div', { className: 'cis-actions' },
      button(ws.modelsBusy ? '正在读取…' : '读取模型', loadModels, locked || ws.modelsBusy),
      catalog.length > 0 ? h('span', { className: 'cis-hint' }, '共 ' + catalog.length + ' 个模型') : null),
    h('span', { className: 'cis-hint' },
      '列表由所选图像服务的模型目录读取，需要先保存可用的服务地址与密钥；面板打开时会自动读一次。'),
    catalog.length > 0
      ? null
      : h('span', { className: 'cis-hint' }, '读取失败时可以直接填写模型名。'),
    ws.modelsError ? h('span', { className: 'cis-warn' }, ws.modelsError) : null,
    field('ComfyUI 地址', form.comfyBaseUrl, (value) => Model.workspace.setField('comfyBaseUrl', value), {
      disabled: locked,
      placeholder: Model.DEFAULT_COMFY_URL,
      hint: '本机 ComfyUI 的 HTTP 地址。留空则用 ' + Model.DEFAULT_COMFY_URL + '；经过 ssh 隧道或改过端口时填这里。',
    }),
    h('label', { className: 'cis-field' }, h('span', { className: 'cis-label' }, 'ComfyUI 工作流'),
      workflowCatalog.length > 0
        ? h('select', {
          className: 'cis-select',
          value: form.workflow,
          disabled: locked,
          onChange: (event) => Model.workspace.setField('workflow', event.target.value),
        },
          h('option', { value: '', key: '' }, '（不指定）'),
          form.workflow !== '' && !knownWorkflow
            ? h('option', { value: form.workflow, key: form.workflow }, form.workflow + '（当前配置，不在列表中）')
            : null,
          ...workflowCatalog.map((entry) => h('option', { value: entry.path, key: entry.path }, entry.name)))
        : h('input', { className: 'cis-input', value: form.workflow, disabled: locked,
          onChange: (event) => Model.workspace.setField('workflow', event.target.value) }),
      h('div', { className: 'cis-actions' },
        button(ws.workflowsBusy ? '正在读取…' : '读取工作流', () => void refreshWorkflows(), locked || ws.workflowsBusy),
        workflowCatalog.length > 0 ? h('span', { className: 'cis-hint' }, '共 ' + workflowCatalog.length + ' 个工作流') : null),
      h('span', { className: 'cis-hint' },
        '列表读自 ComfyUI 自己保存工作流的目录。选中「ComfyUI 工作流」生成方式时必填；UI 格式的工作流会自动转换后提交，读不到时也可以手工填写文件名。'),
      ws.workflowsError ? h('span', { className: 'cis-warn' }, ws.workflowsError) : null),
    field('Agent 地址（可选）', form.agentBaseUrl, (value) => Model.workspace.setField('agentBaseUrl', value), {
      disabled: locked,
      placeholder: 'http://127.0.0.1:8080',
      hint: '「LLM 服务配置」与「生图助手」把请求转发到这里（对方需要提供 /v1/llm/config 等路由）。留空则用 http://127.0.0.1:8080；不用这两个页签就不必填。密钥只从环境变量 DSH_IMAGE_STUDIO_AGENT_API_KEY 读取，面板不保存也不回显。',
    }),
    h('div', { className: 'cis-row' },
      h('label', { className: 'cis-field' }, h('span', { className: 'cis-label' }, '密钥引用名'),
        h('input', { className: 'cis-input', value: form.keyRef, disabled: locked,
          onChange: (event) => Model.workspace.setField('keyRef', event.target.value) })),
      h('label', { className: 'cis-field' }, h('span', { className: 'cis-label' }, ws.key?.configured ? '替换密钥（留空保留）' : '写入密钥'),
        h('input', { className: 'cis-input', type: 'password', autoComplete: 'off', value: form.apiKey, disabled: locked,
          placeholder: '不会回显', onChange: (event) => Model.workspace.setKey(event.target.value) }))),
    h('div', { className: 'cis-hint' },
      ws.key?.configured
        ? '当前引用已配置（来源：' + String(ws.key.source ?? '已存储') + (ws.key.writable ? '，可覆盖' : '，只读') + '）。'
        : '当前引用尚未配置密钥' + (ws.key?.writable === false ? '，且被只读来源遮蔽。' : '。') + ' 留空则保留原值。'),
    h('label', { className: 'cis-field' }, h('span', { className: 'cis-label' }, '编辑请求格式'),
      h('select', { className: 'cis-select', value: form.editFormat, disabled: locked,
        onChange: (event) => Model.workspace.setField('editFormat', event.target.value) },
        ...options(ws.editFormats, form.editFormat)),
      h('span', { className: 'cis-hint' }, '仅参考图编辑时使用。多数兼容渠道用 multipart；部分渠道有各自的 JSON 契约。')),
    h('div', { className: 'cis-row' },
      field('尺寸', form.size, (value) => Model.workspace.setField('size', value), { disabled: locked, list: 'cis-sizes' }),
      field('比例', form.aspectRatio, (value) => Model.workspace.setField('aspectRatio', value), { disabled: locked, list: 'cis-ratios' })),
    h('datalist', { id: 'cis-sizes' }, ...Model.SIZE_PRESETS.map((value) => h('option', { value, key: value }))),
    h('datalist', { id: 'cis-ratios' }, ...Model.ASPECT_RATIOS.map((value) => h('option', { value, key: value }))),
    h('div', { className: 'cis-row' },
      field('分辨率档位', form.imageSize, (value) => Model.workspace.setField('imageSize', value), { disabled: locked, hint: '部分渠道支持 1K/2K/4K。' }),
      field('质量', form.quality, (value) => Model.workspace.setField('quality', value), { disabled: locked })),
    h('div', { className: 'cis-actions' },
      button('保存模型配置', () => void save(), locked, true),
      button('重新读取', () => void refreshConfig(), locked)),
    ws.notice ? h('div', { className: 'cis-status ok', role: 'status' }, ws.notice) : null,
    ws.error ? h('div', { className: 'cis-status err', role: 'alert' }, ws.error) : null)
}

/** Re-read the host configuration and gallery listing. */
export async function refreshConfig() {
  const res = await callPanel('/config')
  if (!res.ok) {
    Model.workspace.setError('读取模型配置失败：' + res.error)
    return
  }
  Model.workspace.applyConfig(res.data)
  Model.workspace.setStatus({ ready: res.data.status?.ready === true, keyConfigured: res.data.key?.configured === true })
}

/**
 * Read the model catalog of the currently selected image service.
 *
 * The list is a convenience, not a precondition: on failure the panel keeps the
 * hand-typed model and only shows why the read failed.
 */
export async function refreshModels(options = {}) {
  // The panel reads the catalog on its own as soon as it opens, so that attempt
  // is silent: an unreachable service must fall back to hand typing instead of
  // painting a warning nobody asked for. The 「读取模型」 button reports failures.
  const silent = options.silent === true
  const form = Model.workspace.get().form
  const provider = String(form.provider ?? '')
  if (provider === '') {
    if (!silent) Model.workspace.setModelsError('请先选择图像服务。', provider)
    return
  }
  Model.workspace.setModelsBusy(true)
  const query = '?provider=' + encodeURIComponent(provider) +
    (String(form.baseURL ?? '') === '' ? '' : '&baseURL=' + encodeURIComponent(form.baseURL))
  const res = await callPanel('/models' + query)
  if (!res.ok) {
    if (silent) Model.workspace.setModelsError(null, provider)
    else Model.workspace.setModelsError(res.error, provider)
    return
  }
  const models = Array.isArray(res.data?.models) ? res.data.models : []
  Model.workspace.setModels(provider, models)
  if (models.length === 0) {
    Model.workspace.setModelsError(silent ? null : '该服务没有返回任何模型，请手工填写模型名。', provider)
  }
}

/**
 * Read the workflow library of a local ComfyUI server.
 *
 * Nothing here goes through the Agent: the workflows are whatever the user has
 * saved in ComfyUI itself, and that list doubles as the readiness check for
 * the `comfy` mode.
 */
export async function refreshWorkflows() {
  // The address in the form is where this read points: the generation surface and
  // the configuration surface edit the same field, so typing a machine there and
  // reading its workflows never requires saving first.
  const baseUrl = String(Model.workspace.get().form.comfyBaseUrl ?? '').trim()
  Model.workspace.setWorkflowsBusy(true)
  const res = await callPanel('/comfy/workflows' + (baseUrl === '' ? '' : '?baseUrl=' + encodeURIComponent(baseUrl)))
  if (!res.ok) {
    Model.workspace.setWorkflowsError('读取工作流失败：' + res.error)
    return
  }
  const workflows = Array.isArray(res.data?.workflows) ? res.data.workflows : []
  // The list is only valid for the address it was read from.
  Model.workspace.setWorkflows(workflows, baseUrl)
  if (workflows.length === 0) {
    Model.workspace.setWorkflowsError('ComfyUI 的 workflows 目录里没有工作流；请先在 ComfyUI 里保存一份工作流（建议用「导出（API 格式）」）。')
  }
}

/** The Agent's LLM settings, used for prompt polishing and the assistant. */
export function LLMConfigPanel() {
  const [current, setCurrent] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [toolsTest, setToolsTest] = React.useState(false)
  const [notice, setNotice] = React.useState('正在读取LLM配置…')
  const adopt = (data) => {
    setCurrent(data)
    setDraft({ provider: data.provider, base_url: data.base_url, model: data.model, api_key: '', clear_key: false })
  }
  const refresh = async () => {
    const res = await callPanel('/llm/config')
    if (!res.ok || !res.data.profiles) {
      setNotice('LLM配置读取失败：' + (res.error ?? '接口版本不匹配，请重启项目Agent'))
      return
    }
    adopt(res.data)
    setNotice('已读取当前配置。密钥不会回传；输入新密钥才替换，留空保留。')
  }
  React.useEffect(() => { void refresh() }, [])
  const edit = (patch) => {
    if (busy) return
    setDraft({ ...draft, ...patch })
    setNotice('草稿未保存，测试不会切换当前服务。')
  }
  const selectProvider = (id) => {
    const profile = current.profiles[id]
    setDraft({ provider: id, base_url: profile.base_url, model: profile.model, api_key: '', clear_key: false })
    setNotice('已切换配置草稿，尚未生效。')
  }
  const run = async (save) => {
    if (busy || !draft) return
    if (save && !window.confirm('保存将写入Agent私有配置并立即切换HTTP服务的LLM；正在运行的终端进程需重启。确认保存？')) return
    if (!save && !window.confirm('将向所填LLM地址发送一条短测试文本' + (toolsTest ? '及一个无实际动作的工具定义' : '') + '，远程API可能计费；不会发送图片或生图草稿。继续？')) return
    setBusy(true)
    setNotice(save ? '正在保存并切换…' : '正在检测所填模型，配置不会改变…')
    try {
      const body = { ...draft, revision: current.revision }
      if (!save) body.test_tools = toolsTest
      const res = await callPanel(save ? '/llm/save' : '/llm/test', { method: 'POST', body })
      if (!res.ok) {
        setNotice(res.error)
        return
      }
      if (save) {
        if (!res.data.config) {
          setNotice('保存响应不完整，请刷新核实，不要盲目重复保存。')
          return
        }
        adopt(res.data.config)
        Model.workspace.setNotice('已保存并切换。提示词整理和生图助手共用此模型；未触发生图。')
        setNotice('已保存并切换。')
      } else setNotice(res.data.message ?? '测试响应不完整')
    } finally {
      setBusy(false)
    }
  }
  const managed = current?.profiles?.[draft?.provider]?.managed_fields ?? []
  const profile = current?.profiles?.[draft?.provider]
  return h('section', { className: 'cis-column', 'aria-label': 'LLM服务配置与连接测试' },
    h('div', { className: 'cis-label' }, 'LLM 服务配置与连接测试'),
    current ? h('div', { className: 'cis-hint' }, '当前生效：' + current.provider + ' / ' + current.model) : null,
    draft ? h('div', { className: 'cis-column' },
      h('label', { className: 'cis-field' }, h('span', { className: 'cis-label' }, 'LLM后端'),
        h('select', { className: 'cis-select', value: draft.provider, disabled: busy || current.provider_managed,
          onChange: (event) => selectProvider(event.target.value) },
          h('option', { value: 'ollama' }, 'Ollama（本地，可选）'),
          h('option', { value: 'openai' }, 'OpenAI API'),
          h('option', { value: 'openai_compatible' }, 'OpenAI兼容API / 本地服务'))),
      field('LLM服务地址', draft.base_url, (value) => edit({ base_url: value }), { disabled: busy || managed.includes('base_url'), hint: 'Ollama填服务根地址；API填含 /v1 等前缀的基础地址。远程建议HTTPS。' }),
      field('LLM模型名称', draft.model, (value) => edit({ model: value }), { disabled: busy || managed.includes('model') }),
      draft.provider !== 'ollama' ? field('API密钥（留空保留）', draft.api_key, (value) => edit({ api_key: value, clear_key: false }), {
        type: 'password', autoComplete: 'off', disabled: busy || managed.includes('api_key'),
        hint: profile?.key_configured ? '此服务已有密钥，原值不回显。' : '尚未配置密钥；无鉴权的本地兼容服务可留空。',
      }) : null,
      draft.provider !== 'ollama' ? checkbox('明确清除该服务的已存密钥', draft.clear_key, (value) => edit({ clear_key: value, api_key: '' }), busy || managed.includes('api_key')) : null,
      checkbox('同时验证tools调用（不执行工具）', toolsTest, setToolsTest, busy),
      h('div', { className: 'cis-actions' }, button('测试LLM连接', () => void run(false), busy || !draft.base_url || !draft.model),
        button('保存并启用LLM', () => void run(true), busy || !draft.base_url || !draft.model, true),
        button('重新读取LLM配置', () => void refresh(), busy))) : null,
    h('div', { className: 'cis-status', role: 'status' }, notice),
    h('div', { className: 'cis-hint' }, '连接测试会调用所选模型，远程API可能产生费用。保存不会发送测试请求；环境变量管理的字段不可在此改写。'))
}

/** A text-only assistant for prompt wording. It never triggers generation. */
export function StudioAssistant() {
  const ws = useWorkspace()
  const [text, setText] = React.useState('')
  const [contextEnabled, setContextEnabled] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [log, setLog] = React.useState([])
  const [notice, setNotice] = React.useState('仅讨论提示词与参数，不执行生图。')
  const send = async () => {
    if (busy || !text.trim()) return
    const conversation = [...log, { role: 'user', content: text }].slice(-24)
    const body = { messages: conversation }
    if (contextEnabled) {
      body.context = { workflow: ws.form.provider + '/' + ws.form.model, prompt: ws.form.prompt ?? '', negative_prompt: ws.form.negative ?? '' }
    }
    setBusy(true)
    setNotice('等待当前LLM回答；不会触发生图…')
    try {
      const res = await callPanel('/assistant', { method: 'POST', body })
      if (!res.ok || typeof res.data.content !== 'string' || res.data.generated !== false) {
        setNotice(res.error ?? '回答不完整；未提交生图。不会自动重试。')
        return
      }
      setLog([...conversation, { role: 'assistant', content: res.data.content }])
      setText('')
      setNotice('回答来自 ' + res.data.provider + ' / ' + res.data.model + '；仅文本建议，未生图。')
    } finally {
      setBusy(false)
    }
  }
  const useAnswer = () => {
    if (busy) return
    const answer = log.slice().reverse().find((entry) => entry.role === 'assistant')
    if (!answer || !window.confirm('将最后回答作为提示词填入草稿，覆盖已有文本；请核对是否包含解释。不会自动生成。继续？')) return
    Model.workspace.setField('prompt', answer.content)
    Model.workspace.setTab('studio')
    setNotice('已填入提示词草稿，尚未生成。')
  }
  return h('section', { className: 'cis-column', 'aria-label': '生图助手' },
    h('div', { className: 'cis-label' }, '生图助手 · ' + (ws.form.model || 'LLM配置待读取')),
    h('div', { className: 'cis-assistant-log', role: 'log', 'aria-live': 'polite' },
      ...log.map((entry, index) => h('div', { key: index, className: 'cis-assistant-message ' + entry.role }, (entry.role === 'user' ? '我：' : '助手：') + entry.content))),
    field('给生图助手的消息', text, setText, { textarea: true, disabled: busy, maxLength: 16000 }),
    checkbox('主动附带当前服务与提示词草稿', contextEnabled, setContextEnabled, busy),
    h('div', { className: 'cis-hint' }, '使用远程API时，消息及勾选的草稿会发送给所配置服务；不会发送图片或本地文件。'),
    h('div', { className: 'cis-actions' }, button('发送给生图助手', () => void send(), busy || !text.trim()),
      button('最后回答填入提示词', useAnswer, busy || !log.some((entry) => entry.role === 'assistant')),
      button('清空助手记录', () => { if (window.confirm('只清空本页面的助手文本记录？不会删除DSH历史会话或图片。')) setLog([]) }, busy)),
    h('div', { className: 'cis-status', role: 'status' }, notice))
}
