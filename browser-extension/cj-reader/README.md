# CommerceOS CJ 行情读取扩展

这是项目自己的 Chrome Manifest V3 扩展，不依赖 Codex、模型或 Playwright。

1. 启动 `npm run desktop`。
2. 在普通 Chrome 的 `chrome://extensions` 开启开发者模式，加载本文件夹（或工作台下载 ZIP 后解压的文件夹）。
3. 在工作台行情节点生成一次性配对码，粘贴到本扩展弹窗。有效期 5 分钟，一次性使用。
4. 通过扩展链接打开 CJ，在正常 Chrome 中自己登录。不要向工作台提交 CJ 密码、Cookie 或验证码。
5. 在工作台采集两组前十，或启用已配置的行情首节点。保持 Chrome 打开；后台约每 30 秒领取一次本机任务，弹窗可立即领取。

扩展仅有 CJ 网站和回环地址 `127.0.0.1:8010` 的站点权限；不申请 cookies、history、debugger 或全站权限。scripting 仅提取两个固定榜单的可见表格，不执行远端代码或接受自定义 URL。既有精确榜单标签页可复用，不跳转用户标签页；缺页则开临时后台页，采集后关闭。遇到安全验证、登录失效或结构变化停止，不解验证码、隐藏自动化特征或绕过访问限制。

连接凭证仅能领取并回传 CJ 两榜任务，不可操作商品、发布、密钥或其他业务接口。服务端只接受回环地址、配对的扩展 Origin、有效凭证和当前任务 ID。凭证 30 天到期，可在工作台撤销；扩展本机存储限制为可信扩展上下文。CJ 登录态始终留在普通 Chrome，项目不复制浏览器配置。

普通 Chrome 能登录不保证未来采集不被限制；确认 CJ 允许该用途。无人值守要求 Chrome、项目同时运行且 CJ 登录有效，不承诺关闭 Chrome 后还能执行。

ZIP 构建（在本目录执行）：

```sh
../../server/.venv/bin/python -m zipfile -c ../../public/downloads/commerceos-cj-reader.zip manifest.json background.js popup.html popup.js popup.css
```
