# 安装与部署（dsh-image-studio）

这份文件写给**第一次把本插件装到自己的 DSH 上**的人。装好之后怎么配模型、怎么用三种生成方式，看 [README.md](README.md)。

安装 = ①把包加进某个 profile 的依赖，②让这个包出现在该 profile 的 `dsh.profile.bundles` 列表里。**这两步交给 DSH 的插件管理器做，不要手改 profile 的 `package.json`。**

## 前置条件

| 项 | 要求 |
| --- | --- |
| DSH | 桌面版（Electron）或 `dsh` CLI，且目标 profile 已初始化。本包在 DSH Desktop Next **2.0.17-next**（`@deepseek-ai/dsh` 0.2.0-rc.2、`@deepseek-ai/cordis` 4.0.4）上验证 |
| Node | `>=22.19.0`。插件本身跑在 DSH 的宿主进程里，这个下限只约束本仓库的构建与测试；桌面版自带的是 v24.21.0。本包只用 Node 内置 API，**没有第三方运行时依赖**，不需要编译原生模块 |
| 网络 | 安装可以完全离线（用随包 tarball）；只有真正生成图片时才需要访问图像服务 |
| 图像服务 | 六家预置服务之一（OpenAI / Google / Seedream / DashScope / xAI / 智谱）、自填的 OpenAI 兼容地址，或本机 ComfyUI。密钥在装完之后于面板内配置，**不需要**写进任何配置文件 |
| 可选 | 本机 ComfyUI（默认 `http://127.0.0.1:8188`）。只有使用「ComfyUI 工作流」生成方式才需要 |

## 安装

### 路线 A：桌面版图形界面（推荐）

1. 打开 **设置 → 插件**。
2. 点 **添加插件**，在输入框里填下列任一形式：
   - **离线包绝对路径**：`C:\path\to\dsh-image-studio-0.11.7.tgz`（或在 macOS / Linux 上 `/path/to/dsh-image-studio-0.11.7.tgz`）
   - **Git 地址**：`https://github.com/zjxj-NaCl/dsh-image-studio.git`
   - **包名**：`dsh-image-studio`（仅在发布到 registry 之后才有意义；中国大陆可在「安装源」里选国内镜像）
3. 确认安装。安装失败时对话框会给出原因；连不上 GitHub 时会提供「改用国内镜像」。
4. **重启 DSH**。宿主半的同源路由只在启动时注册，首次安装和每次升级后都必须重启；只刷新前端不会加载新的宿主半。

### 路线 B：命令行（非 desktop profile）

```sh
# 离线 tarball
dsh plugin --profile web add ./dsh-image-studio-0.11.7.tgz
# 发布到 registry 之后
dsh plugin --profile web add dsh-image-studio
# 直接指向源码目录（开发用）
dsh plugin --profile web add "link:C:\path\to\dsh-image-studio"
```

- 换成你要装的目标 profile 名替换 `web`。`desktop` 这个 profile 由 Electron 持有，**CLI 会拒绝针对它的插件管理请求**——桌面版请用路线 A 或桌面版的内置命令。
- `dsh plugin` 在 profile 目录里把参数转发给 pnpm。DSH peer 兼容性检查在 pnpm 运行之前完成：不通过就什么都不会下载。git 地址与 tarball 必须先抓取才能读到它的声明，因此这两个形式是在安装**之后**判定，不通过时会把 profile 清单与锁文件恢复原样。

### 路线 C：从源码构建

```sh
git clone https://github.com/zjxj-NaCl/dsh-image-studio.git dsh-image-studio
cd dsh-image-studio
npm test          # 不需要网络，也不需要装 DSH
npm pack          # 得到 dsh-image-studio-0.11.7.tgz
```

拿到 tarball 后按路线 A 或 B 安装。`src/` 是可读源码，`lib/` 是构建产物（由 `npm run build` 生成，不要手改）。

> Windows PowerShell 默认禁止运行 `npm.ps1`（ExecutionPolicy），若 `npm` 报“禁止运行脚本”，把命令里的 `npm` 换成 `npm.cmd` 即可；`node` 不受影响。

## 安装后：让面板能出图

安装只是把面板挂上。要真正生成图片，还要在面板里配一次：

1. 打开 **生图工作台** 的 **模型配置** 页签。
2. **图像服务** 与 **模型** 并排一行：选服务；打开面板时会自动读一次该服务的模型目录（读到就变成下拉，读不到就保留手填）。
3. **服务地址**：留空用该服务默认地址；OpenAI 兼容渠道必须填完整基础地址（例如 `https://example.com/v1`）。
4. **密钥引用名** 与 **写入密钥**：引用名是在 DSH 凭据服务里的名字，留空用该服务的默认名；密钥值只在保存时经凭据服务写入，**永不回显**，留空即保留原值。
5. 需要的话再调 **编辑请求格式**、**尺寸 / 比例 / 分辨率档位 / 质量**（按服务能力下发，不支持就自动不发）。
6. 只有用「ComfyUI 工作流」模式时，才需要填 **ComfyUI 地址** 并点「读取工作流」。
7. 只有要用 **LLM 服务配置** 与 **生图助手** 两个页签时，才需要填 **Agent 地址（可选）**；它的密钥只能通过环境变量 `DSH_IMAGE_STUDIO_AGENT_API_KEY` 提供。

面板自己的数据放在 `<DSH_HOME>/cache/dsh-image-studio/`（默认 `~/.dsh/cache/dsh-image-studio/`），里面是 `config.json` 与 `gallery/`。改了 `DSH_HOME`，这个目录跟着走；`DSH_IMAGE_STUDIO_DATA_DIR` 可以单独指定它。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_HOME` | DSH 主目录，决定面板数据目录（默认 `~/.dsh`） |
| `DSH_IMAGE_STUDIO_DATA_DIR` | 直接指定面板数据目录，优先于 `DSH_HOME` |
| `DSH_IMAGE_STUDIO_AGENT_URL` | 「LLM 服务配置」「生图助手」转发到的项目 Agent 地址 |
| `DSH_IMAGE_STUDIO_AGENT_API_KEY` | 该项目 Agent 的密钥。**只能**用环境变量，面板不保存、也不回显 |

## 卸载与升级

- **升级**：插件管理器目前不支持自动更新。升级 = 卸载旧版 + 用新版 tarball/包名重新安装；面板数据目录会保留。
- **卸载**：在插件管理界面卸载 `dsh-image-studio`。面板数据目录不会被自动删除，需要时手动删掉 `<DSH_HOME>/cache/dsh-image-studio/`。
- 升级或卸载之后重启 DSH。

## 排错

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 插件列表里看不到它 | 只装成了依赖、没有选进组合包；或者装完没重启 | 用插件管理器安装（它会一并选入组合包）；重启 DSH |
| 面板能打开，一生成就提示未配置密钥 | 该引用名下还没有密钥 | 在「模型配置」里填密钥并保存；确认引用名与凭据里的名字一致 |
| 生成返回 502 | 图像服务返回了错误 | 提示里是脱敏后的上游原文，按原文修配置或换模型 |
| 生成返回 504 | 等待超时，结果**待确认** | 先到图像服务的后台核对是否已经出图，再手动解除提交锁。插件不会自动重试 |
| 「读取模型」读不到列表 | 服务地址与密钥还没保存 | 先保存地址与密钥再读。读取失败不影响使用：直接手填模型名 |
| ComfyUI 模式报「缺少「X」的节点定义」 | 工作流是 UI 格式，而 ComfyUI 没导出该节点的定义 | 在 ComfyUI 里用「导出（API 格式）」另存一份工作流再选它 |
| 安装时提示无法访问 GitHub | 网络 | 改用国内镜像源，或用离线 tarball |
| 安装被拒绝，错误码 `incompatible-version` | 本包声明的 DSH peer 与目标运行时不符 | 换用匹配的 DSH 版本；确认理解风险后，才用 `dsh plugin --profile <name> allow-version <pkg@ver> --dsh-version <runtime> --accept-risk` 加豁免 |

上表都没解决：按 [issue 模板](.github/ISSUE_TEMPLATE/bug_report.md) 里要的信息（DSH 版本、插件版本、图像服务、复现步骤）开一个 [issue](https://github.com/zjxj-NaCl/dsh-image-studio/issues)。**贴之前先去掉密钥、token 和你的私有服务地址。** 安全类问题不要开公开 issue，走 [SECURITY.md](SECURITY.md) 的私密通道。

## 安全

- 图像服务密钥只存在于 DSH 凭据存储与宿主内存，从不进入浏览器响应，也不写进面板的 `config.json`（那里只有引用名）。
- 项目 Agent 的密钥只从环境变量读取。
- 生成的图片只写在本机磁盘（面板数据目录下的 `gallery/`）。除了你选的图像服务与本机 ComfyUI，插件不把图片发给任何其他地方。
- 浏览器半只访问同源路由 `/image-studio`，因此不涉及 CORS，也不会把密钥交给页面。
