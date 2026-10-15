# 发布到云端 Git 仓库（维护者用）

这份文件只服务维护者：把 dsh-image-studio 推到云端 Git，并写好别人进来第一眼看到的东西。使用者只需要 [INSTALL.md](INSTALL.md)。

本文件**不随 npm 包发布**（与 `deploy-local.ps1` 同类，只留在仓库里）。目标远端：`https://github.com/zjxj-NaCl/dsh-image-studio`。

## 一、仓库设置（照抄）

| 项 | 值 |
| --- | --- |
| 仓库名 | `dsh-image-studio` |
| 主页 | `https://github.com/zjxj-NaCl/dsh-image-studio` |
| 默认分支 | `main` |
| 可见性 | Public |
| 许可证 | MIT（见 `LICENSE`） |
| About | 见下（GitHub 只有一格，中英二选一；两种语言都合适） |
| Topics | 见下 |

**About（英文，GitHub 首选，约 190 字符）**

> Image studio plugin for DeepSeek Harness: text-to-image, image-to-image and local ComfyUI workflows, plus a gallery and a model-config panel. Credentials stay in the host credential store; the browser never sees them.

**About（中文，约 80 字）**

> 给 DeepSeek Harness 用的生图工作台：文生图、图生图、本机 ComfyUI 工作流，内置画廊与模型配置；密钥由宿主凭据存储保管，浏览器拿不到。

**Topics（14 个）**

```text
dsh  dsh-plugin  deepseek-harness  cordis  plugin
image-generation  text-to-image  image-to-image  gallery
comfyui  openai-compatible  gemini  dashscope  zhipu
```

## 二、首页（README 第一屏）

云端 Git 的首页就是 [README.md](README.md)。第一屏要回答三个问题：**这是什么、能做什么、我怎么装**；协议、路由、ComfyUI 转换规则、测试细节留给愿意深读的人。现在 README 的开头已经改成「一句话定位 → 六条要点 → 安装入口」，正文顺序未动。

第一屏刻意不写版本号、不挂徽章：没有 CI 可挂，写了就得每次手动同步；版本一致性只由 `test-package.mjs` 保证 `CHANGELOG` 与 `package.json` 两边对齐。

## 三、推送

首次：

```sh
git remote add origin https://github.com/zjxj-NaCl/dsh-image-studio.git
git push -u origin main
git push origin --tags
```

之后每发一个版本：

```sh
# 1. 改 package.json 的 version，并在 CHANGELOG.md 顶部加一条
npm test          # build 一致性 + 全部测试 + 发布面自检
npm pack          # 生成 dsh-image-studio-<版本>.tgz，供离线安装
git add -A && git commit -m "release: <版本>"
git tag v<版本>
git push && git push --tags
```

- **建空仓库**：在 GitHub 建仓时不要勾「Add a README / .gitignore / license」。否则远端先有一条提交，本地 `main` 与它没有共同祖先，第一次 push 会被拒，只能强行覆盖。
- 本仓库把构建产物 `lib/` 一起入库：克隆下来即可 `dsh plugin --profile <profile> add "link:<克隆目录>"` 安装，或直接 `npm pack`。使用者不需要先构建，也不需要联网装依赖（本包没有运行时依赖）。
- 仓库里没有密钥：用户层的 `cordis.patch.yml` 与面板的 `config.json` 都不在仓库内，面板数据在 `<DSH_HOME>/cache/dsh-image-studio/`。
- `npm pack` 的 `.tgz` 已在 `.gitignore` 里，不会误提交。

## 四、发布前检查占位符

`test-package.mjs` 会拦住已发布文件里残留的 `REPLACE-ME` 与本机绝对路径，但拦不住文档正文里的示例地址。发布前再跑一次：

```powershell
Select-String -Path README.md, INSTALL.md, CHANGELOG.md, package.json -Pattern 'REPLACE-ME', '<user>', '本仓库地址'
```

## 五、可选加分项

- **截图 / GIF**：最能说明问题的是「模型配置」里并排的图像服务与模型（打开面板自动读目录）、三种生成方式的切换、以及画廊。截图放 `docs/` 后在 README 第一屏引用；放之前先确认图里没有服务地址、密钥引用名之类的私人信息。
- **英文 README**（`README.en.md`）：About 已备英文版，正文未翻译；等真有海外访客再补。
- **CI**：本包测试不需要 DSH、也不联网，可在 GitHub Actions 的 `ubuntu-latest` + Node 22 上直接跑 `npm test`（含 `build.mjs --check`）。若加 workflow，只跑测试，不要在其中调用真实图像服务。

## 六、发布检查表

- [ ] `git status` 干净，`main` 上就是要发布的那个提交
- [ ] `npm test` 全绿（含 `test-package.mjs`）
- [ ] `CHANGELOG.md` 顶部版本 == `package.json` 的 `version`，且该条已经写完
- [ ] `npm pack` 重新打过（README / INSTALL 动过就必须重打，否则 tarball 里是旧文档）
- [ ] tag 指向发布提交（当前 `v0.11.0`）
- [ ] GitHub 的 About 与 Topics 按第一节填好
