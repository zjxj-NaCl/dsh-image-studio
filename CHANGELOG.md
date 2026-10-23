# 变更记录

写法参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.11.7] - 2026-10-22

把验收记录留在仓库里的同时，也让它跟着包走：新增 `ACCEPTANCE.md`（架构总览、16 条路由、A–G 七组验收项、真机证据、已知限制、复现命令），并纳入 `files` 白名单与部署清单，发布集合从 35 个文件变成 36 个。

### 修复

- **文档里有一段不存在的功能**：`ACCEPTANCE.md` 初稿把一条已回退的「Agent 生图通道」写成了「未发布改动」，还据此声称路由 16 条、多一个 `test-agent-channel.mjs`、发布集合会变成 36 个。实际 `STUDIO_MODES` 只有 `generate` / `edit` / `comfy`，路由 14 条，包里没有那个测试文件。现已改为记录「该改动已回退」，并补齐核对方式。

### 变更

- `package.json` 的 `files`、`deploy-local.ps1` 的 35 项清单（及那句件数断言）、`test-package.mjs` 的 `DOCUMENTS` 三处同步加入 `ACCEPTANCE.md`。
- 中英文 README 的导航栏与末尾链接加上验收文档入口，产物名与件数同步为 0.11.7 / 36 个文件；`INSTALL.md` 的离线包名同步。
- 测试无新增用例：仍 10 个脚本 234 项。

## [0.11.6] - 2026-10-18

0.11.5 之后剩下的一个路径问题：工作流放在 `workflows/` 的子目录里时，对话工具仍然报 404。

### 修复

- **子目录里的工作流读不到（404）**：0.11.5 只给「不含斜杠」的名字补 `workflows/` 前缀，于是 `Anima_独立测试/AN01_…json` 这种带子目录的写法被原样去请求 `/userdata/Anima_独立测试/…`，而 ComfyUI 只认 `/userdata/workflows/Anima_独立测试/…`（且整段 `%2F` 编码）。现在只要路径不是以 `workflows/` 开头就补前缀，原样路径只在 `workflows/` 未命中时作为回落。

### 变更

- `test-comfy.mjs` 20 → **21 项**：新增「不带 `workflows/` 前缀的子目录路径也只请求补全后的完整编码路径」。测试合计 233 → **234 项**。
## [0.11.5] - 2026-10-18

对话里第一次真正出图之后暴露了三个问题：裸文件名读不到工作流、面板选的工作流从不落盘、提示词被写进多段式工作流的收尾段（所以画面不变）。三个都修了，并用同一张 46 节点的工作流在真机上验过「提示词生效」。

### 修复

- **裸文件名读不到工作流（404）**：ComfyUI 把工作流放在 `workflows/` 下，而调用方通常只写文件名（`anime style SDXL.json`）。`readWorkflow` 现在对不含斜杠的名字先试 `workflows/x.json`，再按原样试一次；带路径的写法照旧。
- **面板选中的工作流从不落盘**：`workflow` 过去只在界面状态里，只有点「保存配置」才写 `config.json`，于是对话工具不传 `workflow` 时永远报「请先在「生成方式」中选择一个 ComfyUI 工作流」。现在在下拉里挑中（或手填框失焦）就 `POST /config/save` 只保存这一个字段，工具的默认值与面板选择不再脱节。
- **提示词被写进多段式工作流的收尾段**：`applyPrompt` 原来只认「采样器的 positive 直接指向文本编码节点」，而真实工作流把 conditioning 先过 `ControlNetApplyAdvanced` 之类的节点，于是它跳过了真正出图的那一段（`denoise: 1`），把提示词写进了 `denoise: 0.14` 的 inpaint 收尾段 —— 图能出来，但和提示词无关。现在先沿 `latent_image` 找出「从空 latent 起步」的采样段，取其中 `denoise` 最大的作为基准段；再顺着 conditioning 接线（`positive`/`negative`/`conditioning` 输入）走到该段的文本编码节点。`positive` 与 `negative` 各走各的一侧，`ControlNetApplyAdvanced` 同时有两个槽也不会把负向词写进正向。

### 变更

- `applyPrompt` 的返回值多了 `positiveIds` / `negativeIds`（实际写入的节点集合），`strategy` 现在是 `sampler` 或 `fallback`；旧的 `positiveId` / `negativeId` 字段保留。
- `src/comfy.js` 新增 `collectTextEncoders`、`startsFromEmptyLatent`、`baseSamplerId`、`readUserDataFile`；删掉旧的 `resolveConditioning` 与未使用的 `CONDITIONING_KEYS`。
- 面板里挑选工作流即保存，README 的 ComfyUI 链路步骤同步改写（选了就会写盘、`workflow` 可只写文件名、基准段与 Detailer 段的区别）。
- `test-comfy.mjs` 12 → **20 项**：裸文件名先查 `workflows/`、裸名在别处也能解析、多段式工作流的提示词落点（基准段而非收尾段、Detailer 段不被改写、正负不串侧、两个空 latent 段取 denoise 大者、无采样器时按序回落、每个 seed 都重掷）。测试合计 225 → **233 项**。

## [0.11.4] - 2026-10-18

`comfyui_generate` 现在真的会出现在对话里：安装型插件过去取不到 `defineTool`，注册函数直接返回，工具在任何会话里都不存在。这一版改成交出宿主本身就能接受的原始定义。

### 修复

- **对话工具注册不上**：插件此前只能通过 VM 沙盒全局 `harness.defineTool` 或 `import('@deepseek-ai/dsh-tools')` 拿到 `defineTool`。安装型插件两条都拿不到 —— `~/.dsh/plugins/` 下面解析不到 `@deepseek-ai/*`，沙盒全局也只有动态包才有 —— 于是 `registerTool()` 一开头就 return，`comfyui_generate` 静默消失。现在：宿主给 `defineTool` 就用它的简写规格，没有就交原始定义 `{ name, description, parameters, output: { schema, render }, timeoutMs, execute }`，`parameters` 与 `output.schema` 都是标准 JSON Schema（`required` 数组、`enum`、`items` 原样保留）。
- **原始定义没有参数校验**：`tools.register()` 只校验 `output` 声明，所以在 `execute` 里自己拒绝空 `prompt`（文案与面板一致：`缺少提示词：prompt 不能为空。`），不会拿着空提示词去敲 ComfyUI。

### 变更

- `src/tool.js` 新增 `makeComfyTool()`（原始定义，安装型插件用）与 `makeComfyToolSpec()`（`defineTool` 简写），两者共用同一份执行与 render 行为；新增导出 `TOOL_PARAMETER_SPEC`、`TOOL_PARAMETERS_JSON_SCHEMA`、`OUTPUT_JSON_SCHEMA`。
- `test-tool.mjs` 18 → **23 项**：JSON Schema 编译（`required` 数组、`enum`、`items`、无残留 `required: true`）、空提示词拒绝、两份定义不共享可变 schema、原始定义与简写行为一致。测试合计 220 → **225 项**。

## [0.11.3] - 2026-10-18

真机联调一轮：接上本机真实的 ComfyUI 后暴露了四个协议细节，全部修掉，现在从生成界面选工作流、跑、看图整条链路实测通过。

### 修复

- **子目录里的工作流读不出来（404）**：真实 ComfyUI 的 user-data 路由在 `workflows/` 下只认**整条路径一次编码**（斜杠也编码成 `%2F`），按段编码一律 404；而 `/v2/userdata?path=` 对文件返回 `Requested path is not a directory`。改为先用整条路径编码读取，仅在 404 时回退旧的分段写法。
- **KSampler 的采样器和降噪权重错位**：`widgets_values` 是按位置存的，UI 在 seed 之后还多存一个 `control_after_generate`（"randomize" / "fixed"）控制框，它不是节点输入。症状是采样器读成序号、`denoise` 读到 `karras`。现在按 `control_after_generate` 声明插入占位并在转换时跳过，同时按值的类型做一次跳步（Impact 的 `DetailerForEach` 有 seed 却不声明这个控制框）。
- **自定义 socket 被当成控件**：原来用「已知连线类型」黑名单判断，`BBOX_DETECTOR` 这类第三方类型不在名单里，于是 `BboxDetectorSEGS` 把 `bbox_detector` 当控件，后面的 `threshold` / `dilation` 整体串位。改为「已知控件类型」白名单（`INT` / `FLOAT` / `STRING` / `BOOLEAN` / `COMBO`），未知类型一律视为连线。
- **排队编号**：真实 ComfyUI 不再接受调用方自带 `prompt_id`（要求规范小写 UUID），现在只发 `{ prompt, client_id }`，取服务端返回的 `prompt_id` 去轮询；没返回编号时直接报错而不是空转。
- **任务被拒时只显示 `[object Object]`**：新增 `promptRejection`，把 `error.message` / `error.details` 与 `node_errors` 里最多三个问题节点的说明拼成一行中文提示。

### 变更

- 工作流下拉不再把 `metadata.json`（运行记录）与 `<名字>.before-*`（脚本备份）当成工作流：本机 102 个 `.json` 里 47 个备份 + 19 个记录，过滤后正好 36 个可用工作流。
- 新增 `test-comfy.mjs`（12 项）：路径编码与 404 回退、seed 后控制框（含未声明）的对齐、自定义 socket、服务端排队编号、拒绝文案、列表过滤。测试合计 208 → **220 项**。
- `test-host.mjs` 的 ComfyUI stub 改为自己生成排队编号（与真实服务端一致）。
## [0.11.2] - 2026-10-18

「ComfyUI 工作流」这一屏不再依赖「模型配置」：地址与工作流就放在提示词上方，填地址、读列表、选工作流，直接运行。

### 新增

- **生成界面的「ComfyUI 地址」与「工作流」两栏**：切到 `comfy` 后出现在「生成方式」下方。地址留空则用面板保存的值，再缺省回落到 `http://127.0.0.1:8188`；点「读取工作流」按当前地址拉取列表，选中的工作流随本次提交一起发出，**不必先去「模型配置」保存**。改地址后列表失效并退回手填框，避免把另一台机器的工作流名发过去。
- `GET /comfy/workflows` 支持可选的 `?baseUrl=`，把该次读取指向临时地址；非法 http(s) 地址以 400 拒绝（用户可改），连不上仍以 502 回传原因。

### 变更

- `comfyPayload` 在地址非空时把 `baseUrl` 一起提交；地址为空则**不带这个键**，让宿主回落到已保存配置（而不是直接回落到默认地址）。
- 工作流目录记住它读自哪个地址（状态层新增 `workflowsFor`），生成界面只显示与当前地址匹配的列表。
- 文档：README 中英文同步说明生成界面的这两栏、`/comfy/workflows` 的 `?baseUrl=`、以及测试项数 202 → **208** 项（`test-client.mjs` 46、`test-host.mjs` 44）。
## [0.11.1] - 2026-10-15

只动仓库与文档，插件代码一行没改：把云端首页和「别人怎么参与」补齐。随包发布的文档集也跟着变了，所以按 patch 升版本。

### 新增

- **`README.en.md`**：中文 README 的英文镜像；两份 README 互相链接，`test-package.mjs` 会检查这一点，也会检查它写对了当前 tarball 名。
- **GitHub Actions CI**（`.github/workflows/test.yml`）：`ubuntu-latest` + Node 22 上跑 `node build.mjs --check` → `npm test`，再 `npm pack`、把 tarball 解到新目录**重跑一遍 `npm test`**——用别人真正拿到的那个包自证自足。
- **`CONTRIBUTING.md`**：环境、常用命令、源码/产物约定（`lib/` 不可手改、`build.mjs` 的声明限制）、测试入口、密钥纪律、提 PR 清单。
- **`SECURITY.md`**：私密报告通道、会被受理的问题类型（密钥外泄、路径穿越、跨站写、越权读、上游地址被劫持）、明确**不算**漏洞的设计边界、密钥存放方式。
- **`.github/` 模板**：问题反馈模板（带环境表与自查清单）、功能建议模板（带影响面勾选）、`config.yml` 联系入口、PR 模板清单。
- README 顶部加徽章（CI / release / license / node / 零运行时依赖）与中英切换导航；正文新增「界面」与「常见问题」两节。

### 变更

- README 的安装段改写为可照做的三步（拿包 → 装并重启 → 配），命令统一写成跨平台的 `npm`（Windows PowerShell 若禁止运行 `npm.ps1`，改用 `npm.cmd`，`INSTALL.md` 里已注明）。
- README 末尾新增「贡献与安全」「许可证」两节，指向 `CONTRIBUTING.md`、`SECURITY.md` 与 `LICENSE`。
- `package.json`：`files` 追加 `README.en.md`，版本升到 `0.11.1`。
- `test-package.mjs` 新增两项断言（中英文 README 互链、CI 覆盖构建检查与整套测试），并把 `CONTRIBUTING.md` / `SECURITY.md` / `.github/` 纳入「不得进 tarball」的清单。测试合计 200 → **202 项**。

## [0.11.0] - 2026-10-15

面向「别人也能直接部署」的一次整理：补上安装文档与打包自检，去掉所有作者本机专属的路径，并让面板数据跟着 `DSH_HOME` 走。

### 新增

- **`INSTALL.md`**：前置条件、三条安装路线（桌面版图形界面 / `dsh plugin` 命令行 / 离线 tarball 与源码）、安装后的必要配置、环境变量、卸载与升级、排错表。
- **`test-package.mjs`**：打包前自检——`files` 白名单是否覆盖 `exports` 与构建产物的每一项、`dsh.bundle.patch` 是否存在、`CHANGELOG` 顶部版本与 `package.json` 是否一致、随包发布出去的文件里是否残留作者本机绝对路径。
- **`PUBLISH.md`**（维护者用，不随包发布）：云端 Git 仓库的仓库名、About 文案（中英）、Topics、推送与打标步骤、发布检查表。
- 「模型配置」新增 **Agent 地址（可选）** 输入框。此前 `agentBaseUrl` 虽然能被宿主读取与保存，面板却没有任何入口。

### 变更

- 面板数据目录改为跟随 `DSH_HOME`：`<DSH_HOME>/cache/dsh-image-studio/`（默认仍是 `~/.dsh/cache/dsh-image-studio/`）。`DSH_IMAGE_STUDIO_DATA_DIR` 依旧优先。
- 项目 Agent 地址：去掉结尾的全部斜杠，并在保存时校验（必须是 http(s)，且不能带用户名/密码）。默认值与外层不一致时以配置为准。
- 项目 Agent 的密钥**只从环境变量** `DSH_IMAGE_STUDIO_AGENT_API_KEY` 读取（trim 后非空才使用）。此前还会回落到 `config.json` 里的 `agentApiKey`，而浏览器根本写不进那个字段，属隐藏的不一致。
- `package.json`：补 `author`、`repository`、`homepage`、`bugs`（指向 `https://github.com/zjxj-NaCl/dsh-image-studio`）；`engines.node` 保持 `>=22.19.0`（插件跑在 DSH 宿主进程里，这个下限只约束本仓库的构建与测试）；`files` 追加 `src`、`build.mjs`、`INSTALL.md`、`CHANGELOG.md`、`test-*.mjs`，让下载到的包可以自己重建与自测；`npm test` 追加 `test-package.mjs`。
- `deploy-local.ps1` 改为从 `$env:USERPROFILE` 推导安装目录（原文件把作者本机用户名与完整路径写进了两处），并在文件头注明这是维护者自用的脚本，普通用户请按 `INSTALL.md` 安装。
- README：顶部新增「安装」段指向 `INSTALL.md`；「模型接入」表补 Agent 地址与环境变量说明；「本轮验证」改写为可复现的测试与验证说明；真实 Cordis 注入测试不再写死本机绝对路径。
- README 首页重写为「一句话定位 → 能做什么 → 安装入口」，`README.md` / `INSTALL.md` 里的仓库地址换成真实地址。

### 移除

- 配置里不再出现 `agentApiKey` 字段（老配置文件里的这个键会被忽略；`/config` 也不会回传它）。

## [0.10.1] - 2026-10-15

独立仓库的起点，同时是可直接打包的基线。

- 「图像服务」与「模型」并排一行；打开面板与切换图像服务时各**自动读取一次**模型目录，读到即变成下拉（含「（未选择）」空项；不在列表里的配置值以「（当前配置，不在列表中）」保留），读不到就保留手填输入框。自动读取是静默的，带提示的失败只出现在手动点「读取模型」时。
- 打包与挂载所需的元数据齐全：`cordis.patch.yml` 里的 `insert` 声明、`dsh.bundle.patch`、`dsh.client.platform`、`files` 白名单、`main` / `exports`。
- 测试覆盖宿主路由、浏览器半、图像 API 适配器、凭据与对话工具（`npm test`，不需要 DSH 环境）。
