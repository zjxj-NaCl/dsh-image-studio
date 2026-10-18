# 发布到云端 Git 仓库（维护者用）

这份文件只服务维护者：把 dsh-image-studio 推到云端 Git，并写好别人进来第一眼看到的东西。使用者只需要 [INSTALL.md](INSTALL.md)。

本文件**不随 npm 包发布**（与 `deploy-local.ps1`、`CONTRIBUTING.md`、`SECURITY.md`、`.github/` 同类，只留在仓库里；`test-package.mjs` 会把这几项钉在 tarball 之外）。目标远端：`https://github.com/zjxj-NaCl/dsh-image-studio`。

## 一、仓库设置（照抄）

| 项 | 值 |
| --- | --- |
| 仓库名 | `dsh-image-studio` |
| 主页 | `https://github.com/zjxj-NaCl/dsh-image-studio` |
| 默认分支 | `main` |
| 可见性 | Public |
| 许可证 | MIT（见 `LICENSE`） |
| About | 见下（GitHub 只给一格，中英二选一；两种都合适） |
| Topics | 见下（20 个，正好用满） |
| Website | 留空——仓库主页就是 README |

**About（英文，GitHub 首选，约 250 字符）**

> Image studio plugin for DeepSeek Harness: text-to-image, image-to-image and local ComfyUI workflows, plus a gallery, a workbench and a model-config panel. Six built-in providers and any OpenAI-compatible endpoint; the host keeps every credential.

**About（中文，约 100 字）**

> 给 DeepSeek Harness 用的生图工作台：文生图、图生图、本机 ComfyUI 工作流，内置画廊、工作台与模型配置面板；六家预置服务加任意 OpenAI 兼容地址，密钥由宿主凭据存储保管，浏览器拿不到。

**Topics（20 个，粘贴时用空格分隔）**

```text
dsh dsh-plugin deepseek-harness cordis deepseek plugin image-generation
text-to-image image-to-image image-editing gallery comfyui openai-compatible
gemini seedream dashscope xai zhipu ai-image mit
```

**一次性开关**

- **Settings → Code security → Private vulnerability reporting：开启。** 不开的话，`SECURITY.md` 与 issue 模板里的私密报告链接是死的。
- Settings → General → Features：Discussions 开不开都行；开了就把「怎么用」类问题引导过去，issue 只留 bug 与建议。
- Settings → Actions → General：保持默认。workflow 只声明了 `contents: read`，也不需要任何 secret。

## 二、首页（README 第一屏）

云端 Git 的首页就是 [README.md](README.md)。第一屏现在回答三个问题：**这是什么、能做什么、我怎么装**；协议、路由、ComfyUI 转换规则、测试细节留给愿意深读的人。已有的部分：

- 顶部导航（中英切换兼 INSTALL / CHANGELOG / CONTRIBUTING / SECURITY 入口）+ 徽章：CI（跑起来才有状态）、release（读 tag）、license、node 下限、零运行时依赖。
- 徽章**不写测试项数**：项数写在「本轮验证」一节里，避免每加一个断言都要同步徽章。
- 英文镜像 [README.en.md](README.en.md)。`test-package.mjs` 会检查两份 README 互链、且都写着当前 tarball 名，所以英文版不会悄悄落后。
- 正文新增「界面」与「常见问题」两节；末尾是「贡献与安全」「许可证」。

## 三、推送

首次已经做过（`main` + `v0.10.1` + `v0.11.0` + `v0.11.1` 都在远端）。之后每发一个版本：

```sh
# 1. 改 package.json 的 version，并在 CHANGELOG.md 顶部加一条
npm test          # build 一致性 + 全部测试 + 发布面自检
npm pack          # 生成 dsh-image-studio-<版本>.tgz，供离线安装
git add -A && git commit -m "release: <版本>"
git tag v<版本>
git push && git push --tags
```

首次推送的原始步骤（供换远端时参考）：

```sh
git remote add origin https://github.com/zjxj-NaCl/dsh-image-studio.git
git push -u origin main
git push origin --tags
```

- **建空仓库**：在 GitHub 建仓时不要勾「Add a README / .gitignore / license」。否则远端先有一条提交，本地 `main` 与它没有共同祖先，第一次 push 会被拒，只能强行覆盖。
- 本仓库把构建产物 `lib/` 一起入库：克隆下来即可 `dsh plugin --profile <profile> add "link:<克隆目录>"` 安装，或直接 `npm pack`。使用者不需要先构建，也不需要联网装依赖（本包没有运行时依赖）。
- 仓库里没有密钥：用户层的 `cordis.patch.yml` 与面板的 `config.json` 都不在仓库内，面板数据在 `<DSH_HOME>/cache/dsh-image-studio/`。
- `npm pack` 的 `.tgz` 已在 `.gitignore` 里，不会误提交。
- 在这台机器上 push/pull 必须提权到 `danger-full-access`：沙盒里 Git Credential Manager 起不来（`couldn't create signal pipe`）。`gh` 未登录、环境里也没有 `GH_TOKEN`，但凭据就存在 GCM 里，`scripts/publish-release.ps1` 会复用它——所以 **Release 可以在命令行直接发**（见第五节）；建仓、改 About/Topics 仍然只能在浏览器里做。

## 四、发布前检查占位符

`test-package.mjs` 会拦住已发布文件里残留的 `REPLACE-ME` 与本机绝对路径，但拦不住文档正文里的示例地址。发布前再跑一次：

```powershell
Select-String -Path README.md, README.en.md, INSTALL.md, CHANGELOG.md, package.json -Pattern 'REPLACE-ME', '<user>', '本仓库地址'
```

顺手确认版本号一次性换干净（三处必须一致）：

```powershell
Select-String -Path README.md, README.en.md, INSTALL.md, package.json -Pattern 'dsh-image-studio-\d+\.\d+\.\d+\.tgz'
```

## 五、GitHub Release（一条命令）

`scripts/publish-release.ps1` 把 `CHANGELOG.md` 里**当前版本那一节**直接发成 Release，并附上 `npm pack` 的 tarball；重复跑只更新正文，不会建第二个：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-release.ps1 -DryRun   # 只看正文
```

- **令牌**：先读 `GH_TOKEN` / `GITHUB_TOKEN`；没设就去 `git credential fill` 取 `https://github.com` 已存的那一条——也就是 `git push` 用的同一个，**不需要手动粘贴，脚本也不打印它**。需要 `repo`（classic）或 `Contents: write`（fine-grained）权限。
- **为什么不用 `curl`**：本机 `curl.exe` 走 schannel，在受限环境里报 `SEC_E_NO_CREDENTIALS`，看着像服务器 403；其实 `api.github.com` 是通的（Node 的 `fetch` 会读 `https_proxy`，`NODE_USE_ENV_PROXY=1` 时自动走系统代理）。列 release、列 tag 这类读接口**完全不需要令牌**：`node -e "fetch('https://api.github.com/zen').then(r=>r.text()).then(console.log)"`。
- 脚本只读 `CHANGELOG.md` 与 `package.json`，不碰源码；`scripts/` 不在 `files` 白名单里，不会进 tarball。

**手动发布（备用）**：Releases 页面点「Draft a new release」，tag 选当前版本，标题与 body 抄 `CHANGELOG.md` 顶部那一节，附件上传 `npm pack` 的 `.tgz`。

发完 Release，`release` 徽章读的还是 tag（不是 Release），两者一致即可。
## 六、还可以补的

- **截图 / GIF**（还没做）：最能说明问题的是「模型配置」里并排的图像服务与模型（打开面板自动读目录）、三种生成方式的切换、以及画廊。放进仓库的 `docs/` 再在 README 的「界面」一节引用；**上传前先确认图里没有服务地址、模型名、密钥引用名之类的私人信息**。
- **发 npm registry**：本包已满足发布条件（`files` 白名单、`repository`、`license`、非 `private`），但目前的分发靠 GitHub tarball / Git 地址就够；要发的话先想清楚包名会不会被占。
- **CI 加一行 Windows**：`.github/workflows/test.yml` 目前只跑 `ubuntu-latest`；把 `runs-on` 换成矩阵就能同时覆盖 `windows-latest`（维护者本机就是 Windows，多一层保险）。
- **Discussions**：想集中收「怎么配某个服务」这类用法问题再开。

## 七、发布检查表

- [ ] `git status` 干净，`main` 上就是要发布的那个提交
- [ ] `npm test` 全绿（含 `test-package.mjs`）
- [ ] `CHANGELOG.md` 顶部版本 == `package.json` 的 `version`，且该条已经写完
- [ ] README（中英两份）/ INSTALL 里的 tarball 名都换了新版本
- [ ] `npm pack` 重新打过（文档一改就必须重打，否则 tarball 里是旧文档）
- [ ] tag 指向发布提交，并已 `git push --tags`
- [ ] GitHub 的 About、Topics 与私密漏洞报告开关按第一节设好
- [ ] Release 已发布：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-release.ps1`（正文取自 CHANGELOG，附件自动挂 tarball）
