# 变更记录

写法参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

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
