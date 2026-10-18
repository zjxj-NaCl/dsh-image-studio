# DSH 生图工作台（dsh-image-studio）

[English](README.en.md) · [安装](INSTALL.md) · [变更记录](CHANGELOG.md) · [参与开发](CONTRIBUTING.md) · [安全策略](SECURITY.md)

[![test](https://github.com/zjxj-NaCl/dsh-image-studio/actions/workflows/test.yml/badge.svg)](https://github.com/zjxj-NaCl/dsh-image-studio/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/tag/zjxj-NaCl/dsh-image-studio?label=release)](https://github.com/zjxj-NaCl/dsh-image-studio/tags)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522.19-339933.svg)](package.json)
[![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](package.json)

> 给 DeepSeek Harness 用的生图插件：文生图、图生图、本机 ComfyUI 工作流三种方式，配一个画廊、一个工作台与一块模型配置面板。密钥由宿主解析并交给 DSH 凭据存储保管，浏览器从头到尾不接触密钥。

能做什么：

- **三种生成方式**：文生图、图生图（最多 4 张参考图、单张 ≤ 32 MB）、本机 ComfyUI 工作流（UI 格式的工作流会自动转成 API 格式再提交；这条路线只取第一张参考图）。
- **六家预置服务 + 自填渠道**：OpenAI、Google、Seedream、DashScope、xAI、智谱，以及任意 OpenAI 兼容地址。
- **模型目录自己读**：打开面板时自动读一次所选服务的模型列表，读到就变下拉，读不到就保留手填框。
- **批量与画廊**：一次最多 4 张、逐张串行；结果落盘入库，可全屏查看，也能「继续编辑」反复迭代。
- **对话里也能画**：把本机 ComfyUI 注册成对话工具 `comfyui_generate`，在对话里给的提示词能直接出图。
- **没有第三方运行时依赖**：宿主按各家 HTTP 契约直接请求，浏览器只访问同源路由 `/image-studio`，因此不涉及 CORS，也不需要编译原生模块。

装：[INSTALL.md](INSTALL.md)（桌面版图形界面 / `dsh plugin` 命令行 / 离线 tarball 三条路线）。许可：MIT。

## 界面

DSH 插件包，在 DeepSeek Harness Web GUI 侧栏提供两个入口：

- **生图画廊**（`image-studio-gallery`，order 50）：列出本面板生成过的全部图片，可全屏查看、删除。
- **生图工作台**（`image-studio-workbench`，order 49）：在「文生图 / 图生图 / ComfyUI 工作流」之间切换，填写提示词（图生图再配参考图）生成或编辑图片；内置「模型配置」页签与 LLM 配置/生图助手。

宿主半在 `webServer` 上注册同源前缀路由 `/image-studio`，**由宿主解析密钥、直接按服务方 HTTP 契约请求、并把结果写入本地画廊**。前两种模式不经过项目 Agent；「ComfyUI 工作流」模式也不经过——宿主直接对本机 ComfyUI 发 HTTP：从它自己保存工作流的目录读列表，向它排队提示词，再把它产出的图片复制进面板画廊。浏览器既不接触图像服务密钥，也不接触 Agent 密钥，因此不涉及 CORS。

> 截图还没放进来。想贡献的话把 PNG 放进仓库的 `docs/` 目录再在这里引用；**上传前先确认图里没有服务地址、模型名、密钥引用名之类的私人信息**——「模型配置」页签里就有前两样。

## 安装

前置条件、三条安装路线（桌面版图形界面 / `dsh plugin` 命令行 / 源码构建）、装后配置、环境变量、卸载升级与排错表都在 [INSTALL.md](INSTALL.md)。最短路径三步：

1. **拿到安装包**：`npm pack` 生成 `dsh-image-studio-0.11.4.tgz`；也可以让插件管理器直接读 Git 地址 `https://github.com/zjxj-NaCl/dsh-image-studio.git`，或指向你克隆下来的目录。
2. **装**：在 DSH 的插件管理界面里选这个压缩包（或填上面的 Git 地址 / 本地路径），装完**重启 DSH**——宿主半只在启动时注册路由，只刷新前端不生效。
3. **配**：在面板的「模型配置」里填服务地址、模型名与密钥。安装不等于配置；密钥经 DSH 凭据服务保存，**不写进**本插件的 `config.json`。数据落在 `<DSH_HOME>/cache/dsh-image-studio/`（未设置 `DSH_HOME` 时即 `~/.dsh/cache/dsh-image-studio/`）。

## 模型接入

配置在面板的「模型配置」页签内完成，写进 `<DSH_HOME>/cache/dsh-image-studio/config.json`（默认即 `~/.dsh/cache/dsh-image-studio/config.json`）：

| 字段 | 说明 |
| --- | --- |
| 图像服务 | 决定线格式与默认地址，见下表。与「模型」并排一行 |
| 服务地址 | 留空则用该服务默认地址；兼容渠道必须填写完整基础地址（例如 `https://example.com/v1`） |
| 模型 | 服务端接受的模型名，生成前必填，与「图像服务」并排一行。**面板打开时会自动读一次**所选服务的模型目录，读到即变成下拉（含一个「（未选择）」空项；配置里的值万一不在列表中，会以「（当前配置，不在列表中）」保留，不会被静默丢掉），读不到或列表为空则保留手填框 |
| ComfyUI 地址 | 仅「ComfyUI 工作流」模式使用。本机 ComfyUI 的 HTTP 地址，留空则用 `http://127.0.0.1:8188`；改过端口或走 ssh 隧道时填这里 |
| ComfyUI 工作流 | 仅「ComfyUI 工作流」模式使用。点「读取工作流」从本机 ComfyUI 保存工作流的目录拉取 `workflows/*.json` 成为下拉；未读取成功或列表为空时保留手填框 |
| 密钥引用名 | 凭据引用名，只允许字母、数字、下划线且不能以数字开头 |
| 密钥 | 不回显。填入并保存时经宿主凭据服务写入 provider 管理的可存储源；留空保留原值 |
| 编辑请求格式 | 仅在图生图（`mode: edit`）时生效，见下表 |
| 尺寸/比例/分辨率档位/质量 | 按所选服务能力下发，不支持时不下发 |

支持的服务（`PROVIDERS`）：

| id | 默认地址 | 默认密钥引用名 |
| --- | --- | --- |
| `openai-compat` | 无（必填） | `DSH_IMAGE_STUDIO_API_KEY` |
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `google` | `https://generativelanguage.googleapis.com/v1beta/interactions` | `GEMINI_API_KEY` |
| `seedream` | `https://ark.cn-beijing.volces.com/api/v3` | `ARK_API_KEY` |
| `dashscope` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` |
| `xai` | `https://api.x.ai/v1` | `XAI_API_KEY` |
| `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |

编辑请求格式（`EDIT_FORMATS`）：`multipart`（多数兼容渠道）、`jsonImageUrlArray`（部分渠道的自家 JSON 契约，字段为 `images: [{ image_url }]`）、`formReferenceImages`、`xaiJson`。所选服务不支持某格式时，面板会在发出请求前拒绝。

密钥不落在 `config.json` 里：面板只保存引用名，值经 `ctx.credentials.set(ref, value)` 交给 DSH 凭据服务。未配置密钥时生成会失败并提示引用名，不会静默回落。

## 生成方式：文生图、图生图与 ComfyUI 工作流

工作台表单的第一项是分段开关 `ModeSwitch`（`cis-switch`），三选一：

| 模式 | 请求面 | 参考图 | 提交按钮 |
| --- | --- | --- | --- |
| `generate` 文生图 | `POST {服务地址}/images/generations` | 不提交（即使用户上传了也丢弃） | `生成图片` |
| `edit` 图生图 | `POST {服务地址}/images/edits` | 至少 1 张，最多 4 张 | `开始编辑` |
| `comfy` ComfyUI 工作流 | 本机 ComfyUI `POST /prompt`（有参考图时先 `POST /upload/image`） | 可选，只取第 1 张 | `运行工作流` |

- 提交体带显式 `mode` 字段（`'generate'` / `'edit'`）。前端在 `generatePayload` 里就按模式裁剪 `referenceImages`：文生图恒为空数组，图生图才携带参考图；图生图缺参考图直接抛 `图生图至少需要一张参考图`，不会退化成一个空编辑请求。宿主 `handleGenerate` 同样校验（`mode:'edit'` 且无参考图 → 400 同一文案）。
- 为兼容直接调用方，请求里**没有** `mode`（或值不认识）时宿主回落到旧启发式「有参考图即编辑，否则生成」；面板自身总会带上 `mode`。
- 切换模式**保留已上传的参考图**，来回切不会丢，只是文生图下不会被提交。忙碌（`busy`）时开关禁用，避免一次提交中途换面。
- 预览框的「继续编辑」会取回选中图、加入参考图并自动切到 `edit`；空态与「参考图」提示文案都跟随当前模式变化。
- `comfy` 与另外两种模式走完全不同的链路，因此**不读图像服务配置**：它不提交尺寸/比例/档位/质量，也不显示「生成数量」控件（工作流本身不接面板的批量参数）。提示词与第一张参考图由宿主直接交给本机 ComfyUI，所选工作流也直接读自 ComfyUI 保存工作流的目录——整个 ComfyUI 模式不经过项目 Agent，面板也不需要 Agent 侧有 ComfyUI 工作流注册表。切到 `comfy` 时，「生成方式」下面会多出**这一屏自己的**「ComfyUI 地址」与「工作流」两栏：填地址、点「读取工作流」、从下拉里挑一个，就能直接运行并出图，**不必先去「模型配置」保存**（那里保留同名字段，编辑的是同一个值）。

### ComfyUI 工作流链路

1. 切到 `comfy` 后，面板若尚未读到工作流目录，会用当前地址自动 `GET /comfy/workflows`（宿主查本机 ComfyUI 的 `GET /v2/userdata?path=workflows`，旧版回退 `GET /userdata?dir=workflows`）填下拉。地址栏留空则用面板配置值，再缺省回落到 `http://127.0.0.1:8188`；把它改成别的机器/端口后点「读取工作流」重取即可，请求会带上 `?baseUrl=` 临时覆盖，不必先保存配置。读不到时下拉退回手填框，按文件名写也行。
2. 提交 `POST /comfy/generate`，体为 `{workflow, prompt, negative, reference, baseUrl?}`；`workflow` 就是下拉里选中的文件名，提示词由宿主注入工作流，`baseUrl` 只在这次请求里覆盖地址，`reference` 只有第一张会被采用。
3. 若有参考图：宿主把字节 multipart 上传（`POST /upload/image`，`type=input`、`overwrite=true`），拿到 ComfyUI 返回的文件名，写进图里第一个 `LoadImage` 节点的 `image` 输入框。
4. 宿主 `POST /prompt` 提交 `{prompt, client_id, prompt_id}`，其中 `prompt` 是注入过提示词的 API 格式图。
5. 宿主每秒轮询 `GET /history/{prompt_id}`，直到 `outputs` 出现或 `status.status_str` 变成 `error`（超时由宿主 `DEFAULT_GENERATE_TIMEOUT_MS` 控制）。
6. 逐张 `GET /view?filename=&subfolder=&type=` 取回字节，按幻数判定媒体类型后写入面板画廊，响应里返回与图像服务模式同形的 `images` 数组。
7. 若一次运行没有产出图片，仍返回 200，`images` 为空、`image` 为 `null`、`count` 为 0——面板不会把「ComfyUI 跑完了」当成「画廊里已有图」。

### 工作流格式与提示词注入

ComfyUI 的 `/prompt` 只接受 **API 格式**（`{nodeId: {class_type, inputs}}`），而 ComfyUI 保存到 `workflows/` 的文件多数是 **UI 格式**（带 `nodes`/`links`/`groups`）。官方并没有公开的转换路由，因此宿主自带的 `src/comfy.js` 负责两件事：

- **UI → API 转换**（`toApiGraph`）：先建 `links` → 来源节点的映射，跳过 `Note`/`PrimitiveNode`/`Reroute`、被 `mode: 2/4` 禁用或落在静音组（`groups[].muted`）内的节点，再按 `/object_info` 里该类节点的 `input_order`（缺失时退回节点定义里的声明顺序）把 `widgets_values` 落成具名输入框的值。转换依赖 ComfyUI 自己的节点定义，缺哪一个节点类的定义就以 502 报「缺少「X」的节点定义，无法转换；请改用 ComfyUI 的「导出（API 格式）」另存一份工作流。」——这是刻意的不静默：猜错控件顺序会得到一张语义错误的图。转换成功时响应带 `note` 说明发生过转换。已经是 API 格式的文件（`isApiFormat`）原样使用，不碰 `/object_info`。
- **提示词注入**（`applyPrompt`）：顺着 KSampler / SamplerCustom 等采样器节点的 `positive`/`negative` 链接找到目标 CLIPTextEncode（含 SDXL / Flux / HunyuanDiT / QwenImage 变体），写 `text` 并给采样器的 `seed` 重掷随机值，避免同一个提示词每次出同一张图。找不到采样器时退回「按节点顺序，第一个文本编码节点作正向、第二个作负向」，此时响应带 `note` 提醒确认结果。参考图走同一套思路：只对 `LoadImage` 节点的 `image` 输入框写值，工作流里没有这个节点就以 400 拒绝，而不是默默丢弃参考图。

这样做的前提是工作流里存在可被识别的采样器与文本编码节点。完全不用采样器、或把提示词埋在自定义子节点里的图，面板找不到可以写入的位置，请先在 ComfyUI 里把它整理成常规结构，或改用面板能识别的节点类型。

失败语义：ComfyUI 拒绝队列（`HTTP 200` + `error` 体，或 `node_errors` 非空）、执行报错（`GET /history` 里 `status.status_str === "error"`）、连接失败一律以 502 回传原文（截断 500 字符，含 `messages` 与问题节点号）；参考图上传失败 400；参数缺失在本地就拦下（空提示词、空工作流、非法参考图），不会打给 ComfyUI。

## 生成与画廊

- 文生图 → `POST {服务地址}/images/generations`；图生图 → `POST {服务地址}/images/edits`（最多 4 张参考图，单张 ≤ 32 MB，PNG/JPEG/WebP/GIF），按所选编辑格式编码；ComfyUI 工作流 → 本机 ComfyUI 的 `POST /prompt`（见上一节）。
- 「生成数量」可选 1–4 张，一次提交逐张串行请求：全部失败返回 502/504（沿用首条错误），部分成功仍返回 200 并把失败原因放进 `partialError`，工作台在预览框下方以告警条显示。上限由宿主 `MAX_GENERATE_COUNT = 4` 与 `/status` 的 `count` 共同公布，超限值被夹紧而不是报错。该控件只在文生图/图生图下显示。
- 结果写入 `<DSH_HOME>/cache/dsh-image-studio/gallery/img-<YYYYMMDD-HHMMSS>-<6hex>.<ext>`，并在响应里返回名称、媒体类型、字节数与同源 URL。
- 负向提示词以 `\n\n不要出现：` 追加到正向词后（图像服务本身没有独立的负向字段）。
- 生成超时由面板持有（默认 300000 ms）。图像 API 从浏览器看来是同步调用、没有可轮询的队列，因此超时是结束挂起请求的唯一手段。超时返回 504 并标记为「结果待确认」，面板**不会自动重试**：请先到图像服务后台核实是否已产生图片，再手动解除提交锁。ComfyUI 模式同理：它确实有可轮询的队列，但宿主会一直轮询到这个超时为止，超时后 ComfyUI 里已经排队的任务不会自动取消。

## 生成预览框

工作台右侧是预览框（`PreviewStage`），对应 dsh-image-gen 的多图画布：

- 等待期间显示旋转指示、阶段文案与进度条。阶段按已等待时长分档（`progressStage`：<3 s「正在提交提示词…」、<12 s「图像服务正在生成…」、<45 s「仍在生成，请勿重复提交…」、<120 s「生成较慢，仍在等待图像服务返回…」，再久则提示可继续等待或按超时处理），**进度比例恒小于 1** —— 图像服务不回报真实进度，这里只表示「仍在等待」，不会假装完成。ComfyUI 模式换一套措辞（读工作流、ComfyUI 加载模型、采样），因为那条链路根本没有远程图像服务在跑。
- 有结果时按 `cis-batch` 网格并排展示本批全部图片（2 列，单张时占满一行），每张带左上 `#1`…`#N` 编号徽章，点击切换选中（选中项品牌色描边 + 右上 `✓`），双击或「全屏查看」进入 `cis-overlay` 全屏。
- 结果下方是操作条：`全屏查看` / `继续编辑` / `再次生成` / `删除这张`。事实行显示 `服务：provider / model · 文生图|参考图编辑 · 字节 · 耗时 · 本批 N 张`（`文生图|参考图编辑` 直接取响应的 `mode`）；ComfyUI 工作流的结果改显示 `工作流：<文件名> · ComfyUI 工作流`，因为那条链路没有 provider/model，也不受面板批量参数影响。
- 「继续编辑」把选中图取回浏览器、转成参考图、自动切到「图生图」并回到表单，用于迭代。本会话结果保留最近 12 批（`RESULT_LIMIT`），按文件名去重，新结果置顶；更早的图片请查「生图画廊」。

## 宿主路由

前缀 `/image-studio`，全部同源：

| 路径 | 方法 | 处理 |
| --- | --- | --- |
| `/config` | GET | 服务目录 + 当前配置 + 密钥引用描述（不回传密钥值） |
| `/config/save` | POST | 保存配置；非空 `apiKey` 走凭据服务写入 |
| `/status` | GET | `{ready, provider, model, keyConfigured, count, timeoutMs}` |
| `/models` | GET | 读所选图像服务的模型目录，返回 `{ok, provider, models}`（图像类模型排在前面）；可选 `?provider=`/`?baseURL=` 覆盖当前配置 |
| `/gallery` | GET | 已生成图片列表（新到旧） |
| `/image` | GET | 按名回传图片；名称限定为裸文件名，穿越名一律 400 |
| `/delete` | POST | 删除一张图片 |
| `/generate` | POST | 按 `mode` 直调 generations/edits 并入库；`count` 1–4 张逐张串行，部分失败返回 `partialError` |
| `/comfy/workflows` | GET | 读本机 ComfyUI 保存工作流的目录（`GET /v2/userdata?path=workflows`，回退 `/userdata?dir=workflows`），返回 `{ok, baseUrl, workflows: [{name, path}]}`（20 秒超时）。可选 `?baseUrl=` 临时覆盖地址（生成界面改完地址不保存就能读），非法 http(s) 地址按 400 拒绝 |
| `/comfy/generate` | POST | 把 `{workflow, prompt, negative, reference, baseUrl?}` 交给本机 ComfyUI（有参考图先 `/upload/image`），轮询 `/history` 后把 `/view` 取到的图片复制进面板画廊；`baseUrl` 可临时覆盖面板配置的地址。响应只回画廊条目与文字摘要，不含图片字节 |
| `/llm/config` | GET | 代理 Agent 的 `GET /v1/llm/config` |
| `/llm/save` | POST | 代理 Agent 的 `POST /v1/llm/config` |
| `/llm/test` | POST | 代理 Agent 的 `POST /v1/llm/test` |
| `/assistant` | POST | 代理 Agent 的 `POST /v1/studio/assistant` |

未知子路径 404 `unknown panel route`；方法不符 405 并带 `Allow`；跨站写请求（`Origin` 主机不符或 `Sec-Fetch-Site: cross-site`）403 `cross-origin mutation rejected`（读不受此限制）。请求体上限：`/generate` 与 `/comfy/generate` 96 MB（承载 base64 参考图），其余 JSON 1 MB。

模型目录只是便利，不是硬依赖：读取失败以 502 回传原因，面板保留手填模型名。面板打开与切换服务时各自动读一次，这条自动路径是静默的（失败只回落成手填，不弹错），带提示的失败只出现在手动点「读取模型」时。上游非 2xx 时错误信息经 `redactSecrets` 脱敏，且最多保留 400 项（`MAX_MODEL_IDS`）、15 秒超时（`MODEL_LIST_TIMEOUT_MS`）。工作流目录同理：`GET /comfy/workflows` 只是把 ComfyUI 的 userdata 列表（`*.json`、非目录）过滤后转回，读取失败 502，面板按文件名手写即可。

LLM 相关四条路由仍转发给项目 Agent，只服务于「LLM 服务配置与连接测试」与「生图助手」：

1. 可选 Ollama、OpenAI API 或 OpenAI 兼容 API。Ollama 填服务根地址；兼容 API 填实际基础地址（例如带 `/v1` 的地址）。
2. 输入的密钥不会立即生效，原值不回显；留空保留已存密钥，勾选清除才删除。地址不能带用户名、密码、查询参数或片段。
3. 「测试LLM连接」只向草稿地址/模型发送短文本，可选附带无实际动作的 tools 定义，不执行工具、不保存、不切换、不生图。远程 API 可能计费。
4. 「保存并启用LLM」合并写入 Agent 私有配置（默认 `agent.local.json`，或 `AGENT_CONFIG_FILE` 指定位置）并立即切换 HTTP Agent；运行中的终端 Agent 是独立进程，须重启才能读取新配置。保存本身不测试连接。

环境变量优先级最高，其管理字段在 UI 禁用。密钥保存在本机私有 JSON，不是加密保险库，请限制该文件读取权限，不要提交或分享。

## 对话工具：comfyui_generate

除面板之外，插件把「跑一次 ComfyUI 工作流」注册为对话可调用的工具（DSH 的 tools 服务），让对话里写下的提示词直接进 ComfyUI：

- 工具名 `comfyui_generate`，超时 300 秒（`TOOL_TIMEOUT_MS`）。参数只有四个：`prompt`（必填）、`negative`、`workflow`、`baseUrl`；空白项不会进入请求，`baseUrl` 可临时覆盖面板「ComfyUI 地址」里配置的地址（地址仍须是合法 http(s)，且不带用户名密码）。
- 执行的是面板同一条链路：`comfyRun(options, body)` → 必要时上传参考图 → `POST /prompt` → 轮询 `/history` → `GET /view` → 复制进面板画廊。`comfyRun` 多返回的 `files`（图片字节）只给工具用，`handleComfyGenerate` 会在 HTTP 响应里剥掉它。
- 结果留了两条路径：挂载了 `attachments` 服务时，把第一张图交给 `attachments.saveImage`，render 输出 `[{type:'text'}, {type:'image', attachment}]`，图片会随附到后续上下文，模型真的能看见；没有附件服务、或保存失败（尺寸/类型不受支持等）时降级为纯文字摘要，并在 `note` 里说明原因 —— 不会假装已经回图。
- 文字摘要只含工作流名、产出张数、耗时与画廊文件名，**不含图片字节，也不含 base64**。
- 注册方式看宿主给什么：能拿到 `defineTool`（动态沙盒包会收到全局 `harness.defineTool`）就用它的简写规格，否则直接交一份**原始定义** —— `{ name, description, parameters, output: { schema, render }, timeoutMs, execute }`，其中 `parameters` 与 `output.schema` 都是标准 JSON Schema。安装型插件走的正是后者，既不需要 `import`，也不依赖任何沙盒全局。`tools`/`attachments` 未挂载时不注册工具，面板其余功能不受影响。

## 安全与限制

- 密钥值只存在于宿主内存与 DSH 凭据存储，从不进入浏览器响应，也不写入面板自己的 `config.json`。
- 每次生成都重新解析凭据，不跨请求缓存。
- 同一页面运行期间锁定提交，禁止重复点击；连接中断/超时不等同任务取消。
- 画廊记录只存在宿主磁盘，助手文本记录只存在当前页面内存；关闭页面不取消已发出的图像请求。
- 生成完成不代表画质合格。请求进行中禁止切换 LLM 配置，配置版本过期须重新读取。

## 常见问题

- **装完没反应、面板打不开？** 宿主那一半只在 DSH 启动时注册路由：**重启一次 DSH**，只刷新浏览器不会加载它。
- **「读取模型」读不到列表？** 这是便利功能，不是硬依赖。列表来自所选图像服务的模型目录，前提是服务地址与密钥都已保存；读不到就直接手填模型名，生成不受影响。
- **密钥存在哪？** 值经 `ctx.credentials.set(ref, value)` 进 DSH 凭据存储，插件的 `config.json` 里只有引用名；浏览器从头到尾拿不到密钥值，面板也不回显。升级或卸载不会删除凭据。
- **要不要联网装依赖？** 不要。零运行时依赖，宿主直接按各家 HTTP 契约发请求，也没有需要编译的原生模块。
- **ComfyUI 模式连不上？** 确认本机 ComfyUI 的端口与面板「ComfyUI 地址」一致（默认 `http://127.0.0.1:8188`）、`user/default/workflows/` 里确有 `.json` 工作流；报「缺少「X」的节点定义」时，请在 ComfyUI 里改用「导出（API 格式）」另存一份。细节见 [INSTALL.md](INSTALL.md) 的排错表。
- **能一次生成多张吗？** 一次最多 4 张、逐张串行；部分失败会保留成功的图，并在预览框下方给出失败原因。
- **支持哪些服务？** OpenAI、Google、Seedream、DashScope、xAI、智谱，以及任意 OpenAI 兼容地址，见下面的「模型接入」。

## 开发

在 `packages/dsh-image-studio` 目录执行：

```powershell
npm run build
npm test
```

可读源码在 `src`，DSH 加载 `lib`；不要手改 `lib`。`build.mjs --check` 会拒绝不同步的产物。

模块划分：

- `src/index.js` — 宿主半：同源路由、配置存储（原子写）、凭据解析、画廊读写、生成编排，以及 ComfyUI 模式的直连编排与产物回灌（`comfyRun` 返回带 `files` 的 plain JSON 供对话工具取字节，`handleComfyGenerate` 剥掉 `files` 后只回画廊条目；`handleComfyWorkflows`/`comfyTarget`），以及把 ComfyUI 运行注册成对话工具（`registerTool`）。LLM 四条路由仍代理给项目 Agent（`proxyJson`/`callAgent`）。
- `src/comfy.js` — 本机 ComfyUI 直连客户端：工作流列表（`GET /v2/userdata?path=workflows`，回退 `/userdata?dir=workflows`）、工作流读取、UI→API 转换（`toApiGraph`）、提示词与参考图注入（`applyPrompt` / `applyInitImage`）、运行编排（`runWorkflow`：`POST /prompt` → 轮询 `GET /history/{id}` → `GET /view`）、参考图上传（`uploadImage`）、地址规范化（`comfyBaseUrl`）。无 DSH 依赖，可单测。
- `src/tool.js` — 对话工具 `comfyui_generate` 的定义（参数/输出 schema、执行与 render、附件回图降级）：无 Node API、无 cordis 依赖，可单测。`makeComfyTool()` 产出宿主可直接注册的原始定义（参数与输出都编译成标准 JSON Schema），`makeComfyToolSpec()` 是给 `defineTool` 的简写版本，`resolveDefineTool()` 取不到工厂时返回 `null` —— 这时用原始定义，工具照样注册得上。
- `src/image-api.js` — 自包含图像 API 适配器：服务目录、端点推导（含模型目录端点 `modelsEndpoint`/`googleModelsEndpoint`）、两族（OpenAI 兼容 / Google）请求与响应解析、模型目录读取（`listModels`/`parseModelIds`/`rankModelIds`）、错误脱敏、字节工具（含 `detectImageMediaType`，ComfyUI 产物靠它定媒体类型）。无磁盘与浏览器依赖，可单测。
- `src/studio-model.js` — 纯浏览器侧：常量（含 `STUDIO_MODES`/`MODE_LABELS` 三模式）、校验、payload 组装（`generatePayload` 按 `mode` 裁剪参考图；`comfyPayload` 组装工作流请求且只取第一张参考图）、workspace 状态机（含 `setMode`、模型目录 `models`/`modelsFor`/`modelsBusy`/`modelsError` 与 `setModels`、工作流目录 `workflows`/`workflowsLoaded`/`workflowsBusy`/`workflowsError` 与 `setWorkflows`）、批次/预览纯函数（`resultImages`、`previewBatch`、`normalizeCount`、`normalizeMode`、`progressStage`、`formatElapsed`）。
- `src/client.js` — 浏览器半：`.cis-` 样式、画廊、生图工作台、三模式切换（`ModeSwitch`）、生成预览框、参考图选择器、槽位注册。
- `src/model-config.js` — 模型配置面板（「图像服务」与「模型」并排一行，进面板/换服务时静默自动读取模型目录；另有「读取模型」「读取工作流」两个手动入口与 ComfyUI 地址输入框）、LLM 配置面板、生图助手。
- `src/conversation-host.js` / `src/bridge.js` — 旧独立对话桥接，保留但**未被任何 profile 挂载**；面板内的生图助手已覆盖该用途，勿再挂载。

测试脚本（均自带 in-process harness，不依赖 `node --test`）：

| 脚本 | 覆盖 |
| --- | --- |
| `test-image-api.mjs` | 适配器的线格式、脱敏、上限、畸形响应、模型目录端点与解析 |
| `test-studio-model.mjs` | 校验文案、payload（含文生图/图生图分流、`comfyPayload` 的单工作流与单参考图裁剪、`normalizeMode` 回落）、批次夹紧、预览纯函数、workspace 行为（含 `setMode`、模型目录与工作流目录的归属与清除） |
| `test-client.mjs` | 浏览器半能在 stub React 下渲染、注册四个槽位、并渲染出「生成方式」开关、预览框、生成数量控件与「读取模型」「读取工作流」入口；「图像服务」与「模型」确实坐在同一行，且模型目录的自动读取接线存在 |
| `test-auth.mjs` | 密钥不外泄、生成入库、逐请求解析凭据 |
| `test-tool.mjs` | 对话工具的输出/附件 schema、参数与输出都编译成标准 JSON Schema（`required` 数组、`enum`、`items` 全保留，无残留的 `required: true`）、空提示词直接拒绝、两份定义不共享可变 schema、参数裁剪、回图与降级（附件保存失败或返回空 id 时只回文字摘要）、画廊摘要不含图片字节、耗时取整、render 的 text/image 块、原始定义与 `defineTool` 简写行为一致、`resolveDefineTool()` 只能是 function 或 null |
| `test-comfy.mjs` | ComfyUI 直连的线格式：子目录工作流要整条路径编码（404 时回退分段编码）、`widgets_values` 里 seed 后的控制框不串位（含未声明的情况）、自定义 socket 不被当成控件、排队编号由服务端生成、拒绝原因不含 `[object Object]`、工作流列表过滤掉 `metadata.json` 与 `.before-*` 备份 |
| `test-host.mjs` | 全部宿主路由（含 `/models`、`/comfy/workflows`）、穿越名、同源守卫、请求体上限、`mode` 分流（generations vs edits、缺参考图 400、无 `mode` 回落）、批量生成的成功/夹紧/部分失败/全失败，以及 ComfyUI 直连链路（stub ComfyUI：userdata 列表与 legacy 回退、上传参考图 → `/prompt` → `/history` → `/view` → 把产物复制进画廊、HTTP 200 拒绝 bodies、执行报错原文回传、无图结果、本地校验不打 ComfyUI） |
| `test-bridge.mjs` / `test-bridge-route.mjs` | 旧对话半的留存回归 |
| `test-package.mjs` | 发布面：`files` 白名单覆盖全部构建产物与源码、`main`/`exports`/`dsh.bundle.patch` 指向的文件确实会被别人拿到、`cordis.patch.yml` 只挂载本包一次、版本在 `package.json` 与 `CHANGELOG.md` 里一致、`repository`/`homepage`/`bugs` 是可点击的真实地址、中英文两份 README 互链、CI 覆盖构建检查与整套测试、已发布的文本文件里既没有本机绝对路径也没有待替换的仓库占位符 |

真实 Cordis 兼容测试（需要 DSH 依赖，不在 `npm test` 内）：

```powershell
node test-host-inject.mjs '<DSH 安装目录>/resources/app/package.json'
```

`<DSH 安装目录>` 换成你机器上的实际位置：Windows 桌面版通常在 `%LOCALAPPDATA%\Programs\DSH NEXT\resources\app\package.json`，也可以用「设置 → 关于」里显示的安装路径拼出来。填错路径时脚本以非 0 退出并说明原因，不算测试失败。

插件升级后须重启 DSH 才能加载新的宿主路由，仅刷新前端不保证生效。

## 本轮验证

`npm test`（build 一致性 + 上表全部脚本）通过：`test-image-api.mjs` 23 项、`test-studio-model.mjs` 24 项、`test-client.mjs` 46 项、`test-host.mjs` 44 项、`test-auth.mjs` 8 项、`test-tool.mjs` 23 项、`test-comfy.mjs` 12 项、`test-package.mjs` 18 项，另有旧对话半的 `test-bridge.mjs` 14 项与 `test-bridge-route.mjs` 13 项（合计 225 项）。

发布形态也验过一次：`npm pack` 出的 `dsh-image-studio-0.11.4.tgz` 内恰好 35 个文件（与 `files` 展开一致，没有多也没有少），把它解到空目录后**整套 `npm test` 与真实 cordis 注入测试（`test-host-inject.mjs`，4 项）都能直接跑过**——即别人拿到的 tarball 自带源码、构建脚本与全部测试，不依赖本仓库里的任何其它文件。宿主半在真实 DSH 上的启动检查仅覆盖路由挂载，仍需重启后人工看一眼面板。GitHub Actions 上跑的就是同一条链：`node build.mjs --check` → `npm test` → 打包、解包后再 `npm test`。

尚未验收的部分：真实图像服务调用与画质（本插件未发送真实图像 API 请求），以及**真实 ComfyUI 端到端**——`/comfy/workflows` 与 `/comfy/generate` 只在 stub ComfyUI 下测过（改到直连方案时本机没有任何监听端口，ComfyUI 与项目 Agent 都没启动）。真机需要确认三件事：ComfyUI 的 `--listen`/端口与面板「ComfyUI 地址」一致；它的 `user/default/workflows/` 里确有 `.json` 工作流；UI 格式的工作流能被 `toApiGraph` 转换（转换依赖 `/object_info` 里该节点的 `input_order`，自定义节点包若没有导出这两个顺序就转换不了，此时请在 ComfyUI 里用「导出（API 格式）」另存一份）。UI→API 转换与提示词真正落到哪个节点也值得先拿一张简单的工作流试：面板会说明它用的是 KSampler 链接还是顺序回落（`note`）。

## 贡献与安全

- 想在本地改：开发环境、源码/产物约定、测试入口与提 PR 的清单见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 发现安全问题（密钥外泄、路径穿越、跨站写等）：**不要开公开 issue**，按 [SECURITY.md](SECURITY.md) 走私密通道。
- 只是想提问题或建议：直接开 [issue](https://github.com/zjxj-NaCl/dsh-image-studio/issues)，模板会提示该带上哪些环境信息。
- 版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE) © 2026 zjxj-NaCl
