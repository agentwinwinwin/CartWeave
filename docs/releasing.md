# 后续版本如何更新

开发工作区与公开仓库分开。不要把整份使用中的项目目录、数据库或浏览器资料拖进 GitHub。

1. 将需要发布的源码改动合入公开仓库副本，保留副本的 README、许可证、合成夹具和隐私排除规则。
2. 审阅 git diff，确认没有重新引入个人路径、真实账号、业务快照或照片。
3. 在副本执行：

```bash
git add .
node scripts/check-publication.cjs
npm run test:workflow
npm run test:store
npm run test:skills
node --test scripts/test-cj-extension.cjs
npm run build
```

再按 README 运行后端回归。自动隐私扫描只检查已登记路径与部分字符串形态，JSON、图片、ZIP 和提交身份仍需人工核对。

4. 更新 CHANGELOG，解释新增能力、未实现范围以及契约/迁移影响。
5. 使用 GitHub 的非个人邮箱提交。提交前检查 git var GIT_AUTHOR_IDENT，不在公开仓库配置真实邮箱。
6. 已有写入权限时提交并推送 main。版本发布可创建 v0.x.y 标签；不要 force push 覆盖远端，也不要重用标签指向不同代码。

源代码发版不会升级使用者已经冻结的流程、Skill、接口包或数据库。它们有独立版本和迁移规则；需要显式安装、确认和重新冻结时，应在变更说明中写清楚。

GitHub Actions 的状态是远端实际执行结果，不用本机测试结果伪造绿色徽章或生产稳定性承诺。
