## 改了什么

## 为什么

## 怎么验证的

```sh
npm test
```

- [ ] `npm test` 全绿（含 `build.mjs --check`）
- [ ] 只手改了 `src/`，`lib/` 是 `npm run build` 生成的（没有手改产物）
- [ ] 面向使用者的行为变了就补了测试；文档变了就同步了 `README.md` / `INSTALL.md`
- [ ] `CHANGELOG.md` 顶部版本与 `package.json` 的 `version` 一致
- [ ] 没有提交密钥、真实服务地址、token 或本机绝对路径
