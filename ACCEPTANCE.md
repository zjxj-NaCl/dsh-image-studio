# 验收文档：生图工作台（dsh-image-studio）

本文件给出当前架构的一份**可复现验收清单**：每个验收项都写明它验的是什么、怎么验、判定标准是
什么、以及截至本文档写就时是「已通过」还是「未覆盖」，另标注证据来自真机、stub 还是单元测试。
它不重复 README 的功能介绍，只记录「凭什么说这套架构现在是对的」。

- 适用版本：**0.11.8**（`package.json` 与 `CHANGELOG.md` 一致，测试脚本会强制这一点）
- 上一验收基线：`v0.11.6`（提交 `ce3e700`，`dsh-image-studio-0.11.6.tgz`，35 个文件）；本文档记录的 ComfyUI 真机证据就是那一版，构建戳 `266b27c0476e`
- 本版（`v0.11.8`）改了工作流列表的过滤、同名区分与 BOM 解析（`src/comfy.js`），因此源码与构建产物都变了，构建戳是 `90d585040a51`；发布集合仍是 36 个文件（`v0.11.7` 起含本文件）
- 验收对象：宿主半（路由 / 配置 / 凭据 / 画廊 / 编排 / 对话工具）、浏览器半（面板、工作台、画廊、预览框、模型配置）、本机 ComfyUI 直连链路
- 判定记号：✅ 通过 / ⬜ 未覆盖；括号里的「真机」「stub」「单元」「集成」标的是证据来源，强度不同

> 本文档随包分发：它在 `files` 白名单内，因此与其它发布文件受同一条约束 —— 不含本机绝对路径、不含待替换的仓库占位符。文中一律用「宿主数据目录」「安装目录」这类泛称。

---

## 1. 架构总览

### 1.1 运行形态

- 一个 DSH Cordis 插件包，`dsh.bundle.patch` 指向 `cordis.patch.yml`，单个挂载行（`id: image-studio`）即可生效；浏览器半通过 `dsh.client` 声明被发现。
- **零运行时依赖**：宿主直接用各家 HTTP 契约发请求，没有需要编译的原生模块，也没有 `node_modules` 参与运行。
- 源码 `src/` 经 `build.mjs` 构建到 `lib/`，DSH 只加载 `lib/`；`build.mjs --check` 拒绝不同步的产物。
- 生命周期：**宿主半只在 DSH 启动时注册路由**，升级后必须重启 DSH，刷新浏览器不够。

### 1.2 两半划分

| 模块 | 归属 | 职责 | 可单测 |
| --- | --- | --- | --- |
| `src/index.js` | 宿主半 | 同源路由、配置存储（原子写）、凭据解析、画廊读写、生成编排、ComfyUI 直连编排与产物回灌、把 ComfyUI 运行注册成对话工具、LLM 四条路由代理 | 需 stub `webServer` |
| `src/comfy.js` | 纯函数层 | 本机 ComfyUI 直连客户端：工作流列表、工作流读取（含路径补前缀与整段编码）、UI→API 转换（`toApiGraph`）、提示词与参考图注入（`applyPrompt` / `applyInitImage`）、运行编排（`runWorkflow`）、参考图上传（`uploadImage`）、地址规范化（`comfyBaseUrl`） | 是 |
| `src/tool.js` | 纯函数层 | 对话工具 `comfyui_generate` 的定义：参数 / 输出 schema、执行与 render、附件回图降级、`resolveDefineTool()` | 是 |
| `src/image-api.js` | 纯函数层 | 图像服务适配器：服务目录、端点推导、两族（OpenAI 兼容 / Google）请求与响应解析、模型目录读取与排序、错误脱敏、字节工具（`detectImageMediaType`） | 是 |
| `src/studio-model.js` | 纯浏览器侧 | 常量、校验、payload 组装、workspace 状态机、批次与预览纯函数 | 是（Node 下直接跑） |
| `src/client.js` | 浏览器半 | `.cis-` 样式、画廊、工作台、生成方式切换、预览框、参考图选择器、槽位注册 | stub React |
| `src/model-config.js` | 浏览器半 | 模型配置面板（「图像服务」与「模型」并排一行）、LLM 配置面板、生图助手 | stub React |
| `src/conversation-host.js` / `src/bridge.js` | 遗留 | 旧独立对话桥接，**未被任何 profile 挂载**，仅留存回归 | 是 |

### 1.3 数据落点

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 面板配置 | 宿主数据目录下的 `config.json` | 原子写；只持久化非空的字符串字段，所以「把输入框清空」不会覆盖已存值 |
| 生成结果 | 宿主数据目录下的 `gallery/` | 文件名即裸名，`/image` 只接受裸文件名 |
| 密钥 | DSH 凭据存储 | `config.json` 里只有**引用名**；值从不进入浏览器响应，也不写进面板自己的配置文件 |
| LLM 代理密钥 | 宿主环境变量 `DSH_IMAGE_STUDIO_AGENT_API_KEY` | 「LLM 服务配置」与「生图助手」两个页签转发用；没有凭据引用，面板不保存也不回显 |

宿主数据目录默认在 DSH 主目录的 `cache/dsh-image-studio`，可用 `DSH_IMAGE_STUDIO_DATA_DIR` 整体重定位（测试套件正是靠它隔离真实缓存）。

### 1.4 已发布的链路

```
浏览器 ──POST /image-studio/generate──▶ 宿主 ──▶ 图像服务（OpenAI 兼容 / Google 两族）
   │                                      │
   │                                      └─▶ 凭据服务取密钥，逐请求解析，不缓存
   │
   ├──POST /image-studio/comfy/generate──▶ 宿主 ──▶ 本机 ComfyUI（/prompt → /history → /view）
   │
   └──对话工具 comfyui_generate─────────▶ 同一条 comfyRun 链路（多回一份 files 供附件用）

浏览器 ──/image-studio/llm/*、/assistant──▶ 宿主 ──代理──▶ 项目 Agent（LLM 配置与生图助手）
```

### 1.5 路由表（前缀 `/image-studio`，全部同源）

| 路径 | 方法 | 处理 | 转发 / 超时 |
| --- | --- | --- | --- |
| `/config` | GET | 服务目录 + 当前配置 + 密钥引用描述（不回传密钥值） | 本地，0 |
| `/config/save` | POST | 保存配置；非空 `apiKey` 走凭据服务写入 | 本地，0 |
| `/status` | GET | `{ready, provider, model, keyConfigured, count, timeoutMs}` | 本地，0 |
| `/models` | GET | 读所选服务的模型目录（图像类排前），可选 `?provider=` / `?baseURL=` | 本地，0 |
| `/gallery` | GET | 已生成图片列表（新到旧） | 本地，0 |
| `/image` | GET | 按裸文件名回传图片；穿越名一律 400 | 本地，0 |
| `/delete` | POST | 删除一张图片 | 本地，0 |
| `/generate` | POST | 按 `mode` 直调 generations / edits 并入库；1–4 张串行，部分失败回 `partialError` | 本地，300 秒 |
| `/comfy/workflows` | GET | 读本机 ComfyUI 保存工作流的目录（`/v2/userdata?path=workflows`，回退 `/userdata?dir=workflows`） | 本地，20 秒 |
| `/comfy/generate` | POST | 交给本机 ComfyUI；有参考图先 `/upload/image`；产物复制进面板画廊；响应**不含图片字节** | 本地，300 秒 |
| `/llm/config` | GET | 代理 `GET /v1/llm/config` | 转发，10 秒 |
| `/llm/save` | POST | 代理 `POST /v1/llm/config` | 转发，10 秒 |
| `/llm/test` | POST | 代理 `POST /v1/llm/test` | 转发，45 秒 |
| `/assistant` | POST | 代理 `POST /v1/studio/assistant` | 转发，300 秒 |

守卫与上限：

- 未知子路径 404 `unknown panel route`；方法不符 405 并带 `Allow`。
- 跨站写请求（`Origin` 主机不符，或 `Sec-Fetch-Site: cross-site`）403 `cross-origin mutation rejected`；读不受此限。
- 请求体上限：`/generate` 与 `/comfy/generate` **96 MB**（承载 base64 参考图），其余 JSON **1 MB**。
- 单张图片上限 `MAX_IMAGE_BYTES = 32 MB`；`/comfy/workflows` 与模型目录都有独立超时，读不到只降级成手填，不阻塞生成。

---

## 2. 验收环境与前置

1. 装好后**重启 DSH**（宿主半只在启动时注册路由），确认侧栏出现「生图工作台」。
2. 文生图 / 图生图链路需要：图像服务地址 + 密钥（写入凭据存储）。
3. ComfyUI 链路需要：本机 ComfyUI 在运行，面板「ComfyUI 地址」与它一致（默认 `http://127.0.0.1:8188`），`user/default/workflows/` 下确有 `.json` 工作流。
4. 对话工具需要：本会话的 `tools` 服务可用；`attachments` 服务可用时图片才会随附回上下文（没有则降级为纯文字）。
5. 通用自检（在插件目录下执行）：

```powershell
node build.mjs --check   # 期望：Build outputs match source.
npm test                 # 期望：全部脚本通过，合计 237 项
```

---

## 3. A 组：安装与装载

| 编号 | 验收项 | 方法 | 判定标准 | 结果 |
| --- | --- | --- | --- | --- |
| A1 | 构建产物与源码同步 | `node build.mjs --check` | 输出 `Build outputs match source.`，退出码 0 | ✅ 通过 |
| A2 | 部署集合完整 | 跑部署脚本 | `Updated 36 exact plugin artifacts`，且关键文件逐个比对 SHA256 全 MATCH（0.11.6 那次 10 项，0.11.7 起含 `ACCEPTANCE.md`） | ✅ 通过 |
| A3 | 安装目录版本正确 | 读安装目录的 `package.json` | 版本与仓库一致（当前 0.11.8） | ✅ 通过 |
| A4 | 宿主半装载 | 重启 DSH 后打开面板 | 面板可开，`/image-studio/status` 返回 200 且 `ready` 符合预期 | ✅ 通过（多轮重启） |
| A5 | 浏览器半注册 | `test-client.mjs` + 打开面板 | 注册四个槽位，并渲染出「生成方式」开关、预览框、数量控件、「读取模型」「读取工作流」入口 | ✅ 通过 |
| A6 | 「图像服务」与「模型」并排 | `test-client.mjs` 断言 + 目测 | 两者在同一行（原生 dsh-image-gen 的排布），不再上下堆叠 | ✅ 通过 |

---

## 4. B 组：配置与凭据

| 编号 | 验收项 | 方法 | 判定标准 | 结果 |
| --- | --- | --- | --- | --- |
| B1 | 密钥不出宿主 | `test-auth.mjs`；手动看 `/config` 响应 | 响应里只有引用名与「是否已配置」，没有任何密钥值 | ✅ 通过 |
| B2 | 留空保留已存密钥 | 面板保存两次，第二次密钥留空 | 已存密钥仍可用，文本不回显 | ✅ 通过 |
| B3 | 清空输入框不覆盖已存值 | 把某文本字段清空后保存 | `config.json` 里该字段保持旧值（只持久化非空值） | ✅ 通过 |
| B4 | 配置原子写 | `test-host.mjs` 的保存用例 | 半截写入不会留下损坏的 `config.json` | ✅ 通过 |
| B5 | 密钥逐请求解析 | `test-auth.mjs` | 不跨请求缓存凭据，换引用名立刻生效 | ✅ 通过 |
| B6 | 地址校验 | 填带用户名密码 / 查询参数 / 片段的地址 | 拒绝并给出可读原因 | ✅ 通过 |

---

## 5. C 组：图像服务链路（文生图 / 图生图）

| 编号 | 验收项 | 方法 | 判定标准 | 结果 |
| --- | --- | --- | --- | --- |
| C1 | 文生图请求形状 | `test-image-api.mjs` | 两族（OpenAI 兼容 / Google）的线格式、鉴权头、端点推导正确 | ✅ 通过（stub） |
| C2 | 图生图走 edits / ref-images | `test-host.mjs`、`test-studio-model.mjs` | `mode=edit` 走 edits 或对应格式；缺参考图 400；无 `mode` 回落 `generate` | ✅ 通过 |
| C3 | 批量与部分失败 | `test-host.mjs` | 数量夹紧到 1–4，逐张串行，部分失败保留成功的图并回 `partialError` | ✅ 通过 |
| C4 | 模型目录 | `test-image-api.mjs`、`test-host.mjs` | 读失败以 502 回原因且面板可手填；自动读取静默、手动读取才提示 | ✅ 通过 |
| C5 | **真实图像服务调用** | 用真实密钥请求 OpenAI / Google / xAI / OpenAI 兼容 | 能出图，且密钥错误 / 配额 / 地区限制的真实失败有可读提示 | ⬜ 未覆盖（只跑过 stub） |

> C5 是本次验收最大的缺口：四条图像服务链路从未向真实服务发过请求，所以画质、计费、地区限制这类真实问题都还没有见过。

---

## 6. D 组：ComfyUI 直连链路（本机）

| 编号 | 验收项 | 方法 | 判定标准 | 结果 |
| --- | --- | --- | --- | --- |
| D1 | 工作流列表 | 真实 ComfyUI 上点「读取工作流」 | 返回可运行工作流；`metadata.json`、`<名字>.before-*` 备份与「运行记录 / 验证记录 / …位置」这类笔记被滤掉（本机 102 个 `.json` → 过滤后 31 个） | ✅ 通过（真机，0.11.8 重新统计） |
| D1b | 同名工作流可区分 | `test-comfy.mjs` + 真实目录 | 多个子目录里同名的 `测试_API.json` 在下拉框里带上前缀（`本机实测/测试_API`）；唯一名字不变，`path` 不变 | ✅ 通过 |
| D1c | 带 BOM 的工作流能读 | 真实文件 + `test-comfy.mjs` | 首字节为 `EF BB BF` 的两份工作流照常解析（0.11.7 报「不是有效的 JSON 对象」） | ✅ 通过（真机两份文件） |
| D2 | UI→API 格式转换 | 用 UI 格式工作流跑一次 | 自动转换后提交成功；缺 `input_order` 的自定义节点给出可读提示，不静默错位 | ✅ 通过（真机 46 节点工作流） |
| D3 | `widgets_values` 对齐 | `test-comfy.mjs` | `seed` 之后的 `control_after_generate` 控制框不串位（含未声明的情况）；自定义 socket 不被当成控件 | ✅ 通过 |
| D4 | 提示词落点 | `test-comfy.mjs` + 真机 | 多段式工作流里提示词写进**基准段**（从空 latent 起步、`denoise` 最大的采样段），不写收尾段；Detailer 段角色词保留；正向与负向不串侧 | ✅ 通过（先失败后修复，见 6.1） |
| D5 | 路径三种写法 | `test-comfy.mjs` + 真机 | 完整路径 / 子目录路径 / 裸文件名都能读；不是以 `workflows/` 开头就先补前缀，整段 `%2F` 编码 | ✅ 通过（0.11.6 修复，见 6.1） |
| D6 | 参考图上传 | `test-host.mjs`（stub） | 有参考图先 `/upload/image`，再把返回的引用塞进工作流 | ✅ 通过（stub） |
| D7 | 轮询与取图 | `test-host.mjs` + 真机 | 排队编号取服务端返回值；`/history` 轮询到完成后 `/view` 取图并复制进画廊 | ✅ 通过（真机） |
| D8 | 失败文案 | `test-comfy.mjs` | 任务被拒时给出中文原因，不出现 `[object Object]` | ✅ 通过 |
| D9 | 提示词真的生效 | 纯文生图工作流 + 明确提示词 | 画面内容与提示词一致 | ✅ 通过（0.11.5 修复后，真机） |

### 6.1 真机证据（两轮，都是先失败后修）

| 轮次 | 工作流 | 结果 |
| --- | --- | --- |
| 0.11.3 | 46 节点多段式工作流 | 1 张 PNG 3.16 MB，约 40 秒；那一轮只验了「能出图」，没验提示词是否生效 |
| 0.11.5 前 | 同上 | 提示词被写进 `denoise: 0.14` 的收尾段，画面是工作流自带的角色与参考图 |
| 0.11.5 后 | 同上（UI 格式） | 200 / 1 张 / 约 23 秒，提示词落到基准段；但该工作流自带固定角色词与 ControlNet 参考图，不适合当「提示词说了算」的例证 |
| 0.11.6 | `给提示词就出图` 的纯文生图工作流（10 节点：1 EmptyLatent、2 CLIPTextEncode、1 KSampler） | **24 秒、1 张、1024×1024**，画面正是提示词描述的「木桌上的红苹果」，图片以内容块回到对话 |

失败记录：`0.11.5` 只给「不含斜杠」的名字补 `workflows/` 前缀，于是 `Anima_独立测试/AN01_….json` 这种带子目录的写法被原样请求 `/userdata/Anima_独立测试/…`，报 **`读取工作流文件失败：HTTP 404`**。实测 ComfyUI 只认整段编码的 `/userdata/workflows/Anima_独立测试/…`（`as-given` 整段与分段都是 404，`workflows/` 整段才是 200，`workflows/` 分段是 404）。0.11.6 改为「不以 `workflows/` 开头就补前缀」。

第三轮（`0.11.8`）不是出图，而是拿本机真实目录（102 个 `.json`）逐项比对「ComfyUI 自己能用的文件，面板能不能用」，查出三个差异，都修了并有真机证据：

| 现象 | 真机数据 | 处理 |
| --- | --- | --- |
| 笔记文件被列成工作流 | `运行记录.json`、`安装检查记录.json`、`验证记录.json`、`待修复数据包位置.json` 出现在下拉框，选中必然失败 | 按文件名结尾判定并滤掉；`C01_手部检查_裁切与蒙版.json` 这类含关键词的真工作流不受影响。过滤后 102 → 31 |
| 同名工作流无法区分 | 多个实验子目录各有一份 `测试_API.json`，选项文字完全相同 | 只有重名的加子目录前缀（`本机实测/测试_API`），`path` 不变 |
| 带 BOM 的 JSON 报「不是有效的 JSON 对象」 | `D01c_Klein_参考结构局部修复.json`、`D01c_已有候选_保护与贴回.json` 首三字节是 `EF BB BF`，ComfyUI 前端能开 | 解析前丢掉首个 U+FEFF 再试一次 |

这次核对是在本机 `workflows/` 目录上起桩服务、直接调用 `src/comfy.js` 的真实函数做的：31 条全部取出，笔记与备份泄漏 0，重名标签 0 重复。BOM 修复后这两份文件的读取推进到「缺少节点定义，无法转换」——即已正常解析，只是本地没开 ComfyUI、取不到 `/object_info`，属于另一个已知限制（见 6 节末）。

---

## 7. E 组：对话工具 `comfyui_generate`

| 编号 | 验收项 | 方法 | 判定标准 | 结果 |
| --- | --- | --- | --- | --- |
| E1 | 工具注册得上 | 新会话里让模型自报工具清单 | 安装型插件（拿不到 `defineTool`）也出现 `comfyui_generate` | ✅ 通过（0.11.4 修复后） |
| E2 | schema 合法 | `test-tool.mjs` | 参数与输出都编译成标准 JSON Schema（`required` 数组、`enum`、`items` 保留，无残留 `required: true`） | ✅ 通过 |
| E3 | 参数裁剪 | `test-tool.mjs` | 只发 `prompt` / `negative` / `workflow` / `baseUrl` 的非空值；空提示词直接拒绝 | ✅ 通过 |
| E4 | 图片回到对话 | 真机 | render 输出 text + image 两个块，图片随附到后续上下文 | ✅ 通过（真机，`IMAGE: yes`） |
| E5 | 降级不假装 | `test-tool.mjs` | 没有 `attachments` 或保存失败时只回文字摘要，并在 `note` 里说明原因 | ✅ 通过 |
| E6 | 摘要不含字节 | `test-tool.mjs` | 文字摘要与 HTTP 响应都不含图片字节或 base64 | ✅ 通过（`test-host.mjs` 另有针对 `files` 泄漏的断言） |
| E7 | 默认工作流与面板一致 | 面板选一次工作流后不传 `workflow` | 面板选中即落盘，工具用的就是同一个；未选过则报「请先…选择一个 ComfyUI 工作流」 | ✅ 通过（0.11.5 修复后） |

---

## 8. F 组：安全

| 编号 | 验收项 | 方法 | 判定标准 | 结果 |
| --- | --- | --- | --- | --- |
| F1 | 密钥不外泄 | `test-auth.mjs`、`test-tool.mjs` | 面板响应、工具摘要、错误文案里都没有密钥 | ✅ 通过 |
| F2 | 同源写守卫 | `test-host.mjs` | 外站 `Origin` 的写请求 403；读不受限 | ✅ 通过 |
| F3 | 路径穿越 | `test-host.mjs` | `../` 之类的图片名一律 400，不读也不删 | ✅ 通过 |
| F4 | 体积上限 | `test-host.mjs` | 超限请求体与超限图片都被拒，且不会写到一半 | ✅ 通过 |
| F5 | 错误脱敏 | `test-image-api.mjs` | 上游非 2xx 的错误经脱敏后回传，模型 ID 列表截断到 400 项 | ✅ 通过 |

---

## 9. G 组：发布面

| 编号 | 验收项 | 方法 | 判定标准 | 结果 |
| --- | --- | --- | --- | --- |
| G1 | 测试全绿 | `npm test` | 10 个脚本 237 项，退出码 0 | ✅ 通过 |
| G2 | 测试项分布 | 逐脚本统计 | image-api 23 / studio-model 24 / client 46 / auth 8 / comfy 24 / host 44 / tool 23 / bridge 14 / bridge-route 13 / package 18 | ✅ 通过 |
| G3 | 发布集合完整 | `npm pack` 后核对 | 0.11.6 恰好 35 个文件、0.11.7 起恰好 36 个文件（多出本文件），都与 `files` 展开一致；解到空目录后整套测试能直接跑 | ✅ 通过 |
| G4 | 发布文件干净 | `test-package.mjs` | 不泄漏本机绝对路径、不留待填占位符、版本三处一致、CI 覆盖构建检查与整套测试 | ✅ 通过 |
| G5 | Release 可发 | 发布脚本 | 创建 `v<version>` 并上传 tarball；重复发布走 PATCH 而不是报错 | ✅ 通过（v0.11.3 起每次都用这条路径） |

---

## 10. 已回退：Agent 生图通道（当前不存在）

曾经尝试给面板加第四种生成方式 `agent`（代理项目 Agent 的 `/v1/workflows` 与 `/v1/generate`），**该改动已全部回退**，当前代码里没有任何 Agent 生图链路。回退原因：本项目工作台是独立仓库，Agent 的生图接口不经过 DSH，把它接进本插件属接入目标误解。

核对方式（三条互相独立的证据）：

- `src/studio-model.js` 的 `STUDIO_MODES` 只有 `generate` / `edit` / `comfy` 三种；
- `src/index.js` 的路由表共 14 条，没有 `/agent/workflows` 与 `/agent/generate`；
- 包里不存在 `test-agent-channel.mjs`，`scripts.test` 只串 10 个脚本。

残留的 `agentTarget` / `DSH_IMAGE_STUDIO_AGENT_URL` / `DSH_IMAGE_STUDIO_AGENT_API_KEY` 仅服务于「LLM 服务配置」与「生图助手」两个页签的转发，与生图无关。

---

## 11. 已知限制（不影响当下验收结论，但会影响别人复现）

1. 真实图像服务未验（见 C5）。
2. UI 格式工作流的转换依赖 `/object_info` 里该节点类的 `input_order`；自定义节点包没导出它就转换不了，需在 ComfyUI 里用「导出（API 格式）」另存。
3. 多段式工作流的提示词落点是**推断**出来的：从空 latent 起步、`denoise` 最大的采样段为基准段，再顺着 conditioning 接线找文本编码器。结构特别怪的工作流可能落到兜底分支（按 id 顺序前两个编码器），此时 `strategy` 为 `fallback`，面板会提示。
4. `attachments` 服务缺失或保存失败时，对话工具只回文字摘要（有 `note` 说明），不会假装回了图。
5. 生成任务不可取消：连接中断或超时不等于任务结束，重复提交会重复计费 / 重复跑 ComfyUI。
6. 画廊只存宿主磁盘；助手文本记录只存当前页面内存，关页面即丢。

---

## 12. 复现命令

在 `packages/dsh-image-studio` 目录下：

```powershell
# 1) 构建与一致性
node build.mjs
node build.mjs --check

# 2) 单元与集成测试（每个脚本自带 in-process harness，不依赖 node --test）
npm test

# 3) 打包并核对发布集合
npm pack --cache .tmp-npm-cache      # 产出 dsh-image-studio-<version>.tgz，期望 36 个文件

# 4) 部署到本机安装目录（会先备份到 deployment-backups/<时间戳>-<哈希>）
pwsh -File deploy-local.ps1

# 5) 发布 GitHub Release（需要令牌来自环境变量或 git 凭据）
pwsh -File scripts\publish-release.ps1 -DryRun   # 先看正文
pwsh -File scripts\publish-release.ps1           # 再真发
```

真实 Cordis 注入测试（需要 DSH 依赖，不在 `npm test` 内）：

```powershell
node test-host-inject.mjs '<DSH 安装目录>/resources/app/package.json'
```

---

## 13. 结论

- **可以交付的**：面板与配置、图像服务适配器的线格式（仅 stub）、本机 ComfyUI 直连全链路、对话工具全链路、安全守卫、发布面。这些都有单元或集成测试覆盖，其中 ComfyUI 与对话工具另有一轮真机证据。
- **不能声称已验证的**：真实图像服务的调用与画质（C5）。
- 任何涉及「宿主半」的改动都必须**重启 DSH** 才算装载；只刷新浏览器看到的仍是旧宿主。
