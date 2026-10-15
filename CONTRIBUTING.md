# 参与开发

欢迎 issue 与 PR。动手之前先读这一页，能省掉一轮来回；使用者请直接看 [INSTALL.md](INSTALL.md)。

## 环境

| 项 | 要求 |
| --- | --- |
| Node | `>=22.19.0`（`package.json` 的 `engines`。插件跑在 DSH 宿主进程里，这个下限只约束本仓库的构建与测试） |
| 依赖 | 无。零运行时依赖，**不需要 `npm install` 就能构建与测试**，也没有锁文件 |
| DSH | 只有跑真实 Cordis 注入测试时才需要 |

## 常用命令

```sh
node build.mjs          # 把 src/ 打成本地 lib/（产物带源文件 SHA256 头）
node build.mjs --check  # 只校验 lib/ 与 src/ 是否同步，不写文件
npm test                # 上面第一行 + 全部 test-*.mjs，含发布面自检
```

`npm test` = `build.mjs --check` → `test-image-api` → `test-studio-model` → `test-client` → `test-auth` → `test-host` → `test-tool` → `test-bridge` → `test-bridge-route` → `test-package`。整条链不需要 DSH、不联网、不调用任何真实图像服务。

## 源码与产物

- **`src/` 是唯一可以手改的地方**；`lib/` 由 `build.mjs` 生成，改了会被 `--check` 拒绝。本仓库故意把 `lib/` 一起入库：克隆下来即可安装，使用者不必先构建。
- 浏览器半（`src/client.js`、`src/model-config.js` 等）只允许 `export (async )?(const|function|class)` 形式的声明，`build.mjs` 遇到 `import` / `export` 语句会报 `Unsupported module syntax`。它把这些声明拼进一个 `new Function('window', …)` 里，落盘前会先验证打包结果能被构造出来。
- 新增 `src/*.js` 时要在 `build.mjs` 的 `names` 列表与产物表里同时登记，否则不会进 `lib/`。

## 测试

每个 `test-*.mjs` 自带 runner，用 `node:assert/strict`，**不依赖 `node --test`**（`node --test` 以管道派生子进程，在受限沙箱里会固定 EPERM）：

```sh
node test-package.mjs   # 也可以只跑某一个
```

- 面向使用者的行为改动必须带测试；纯文档改动不必。
- `test-package.mjs` 守的是发布面：`files` 白名单、`exports` / `dsh.bundle.patch` 指向的文件是否真的会发布、`CHANGELOG` 与 `package.json` 的版本是否一致、有没有本机绝对路径、有没有残留的仓库占位符、README 与英文 README 是否互链、CI 是否覆盖构建检查与整套测试。**动了 `files`、`package.json` 元数据、文档结构或 `.github/workflows/` 就要顺带跑它。**
- 真实 Cordis 注入测试不在 `npm test` 里（需要 DSH 的依赖）：

  ```sh
  node test-host-inject.mjs '<DSH 安装目录>/resources/app/package.json'
  ```

  路径填错时脚本以非 0 退出并说明原因，不算测试失败。

## 密钥

不要把任何真实密钥、token、私有服务地址写进源码、测试、文档或截图。面板只保存**引用名**，值经 `ctx.credentials.set(ref, value)` 交给 DSH 凭据服务，插件的 `config.json` 里没有密钥值，浏览器侧也拿不到。测试里出现的都是假 key。

## 提 PR

- 一个 PR 做一件事，写清「改了什么 / 为什么 / 怎么验证的」。
- `npm test` 全绿再提。动过 `src/` 就把重新生成的 `lib/` 一起提交。
- 面向使用者的行为或文档变了，在 `CHANGELOG.md` 顶部补一条（写法参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)）。
- 发布一个版本：`package.json` 改 `version` → 跑 `npm test` → `npm pack` → `git tag` → 推 tag。完整步骤见 [PUBLISH.md](PUBLISH.md)。

## 许可

提交即视为同意以 MIT 许可（见 [LICENSE](LICENSE)）发布你的贡献。
