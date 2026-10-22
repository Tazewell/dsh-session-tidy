# dsh-session-tidy

DSH 的会话整理插件：**删除**（进可恢复的回收站）和**改写已经发出去的请求**（分叉重发）。

> Delete DSH sessions into a recoverable trash, and edit an already-sent request by branching.

DSH 目前只能归档会话：归档只是把 id 记进 `archivedSessionIds`，日志目录原封不动。
这个插件补上了真正的删除，以及「发错了想改」这件事：会话从列表消失、文件移到回收站，
7 天内可以原样恢复；任意一条用户消息都能改，改完从一个新分支继续。

## 使用

侧边栏里每个会话的悬浮操作区和「…」菜单各有一个**删除**入口：

1. 点击删除 → 确认对话框显示会话标题。
2. 确认后 Host 先停止该会话正在跑的任务（子代理、后台命令、定时提醒），
   再把它移入回收站，并清掉投影缓存。
3. 侧边栏底部的垃圾桶按钮打开**回收站**，可以：
   - 恢复：文件回到原来的会话目录、重新挂回原工作区、解除归档；
   - 彻底删除：立即删掉回收站里的目录，不可恢复；
   - 清空回收站：删除全部记录（会二次确认）。

当前正在主视图打开的会话不能删除：对话框会提示先切换到其他会话。

## 修改任意一条请求（发送后 / 停止后）

**每条用户消息下面**（时间、复制按钮那一行）都多了一个铅笔图标：鼠标移到那条消息上才会显现，
点它就改这条请求——不必是最后一条。

1. 点击某条消息的铅笔 → 对话框「修改这条请求」里就显示这条请求的原文，**可以直接改**。
2. 确认后插件在该请求之前 **fork** 出一个分支会话，把**改好的内容**写进新会话的
   输入框草稿，并自动切过去。分支的历史正好停在「这条请求之前」，所以这条提问
   和它后面（以及它自己的半截回答）都不会带过去。
3. 在分支里看过没问题就回车发送。

切点取的是**上一条已完成 turn 的结尾**（`turn/end` 的 seq），不是「消息 seq − 1」：
用户消息前面还有它自己那条 turn 的 `turn/start`、`step/start`，按 seq − 1 切会让宿主
给这个空 turn 补一个「forked」结束，界面上就会多出一行没有内容的「已完成，用时 1 秒」。
规则还会跳过这种空 turn（两条 `turn-tail` 相邻），所以之前编辑留下的空壳会在下一次
编辑时一起丢掉。

对话框里有一个默认勾选的选项「把原会话移入回收站（7 天内可恢复）」：

- **勾选**（默认）：分支沿用原会话的标题，原会话进回收站，侧边栏里看起来就是「同一个
  会话被改掉了」；想找回来随时去回收站恢复。
- **取消勾选**：原会话保留，分支标题加 ` (1)` 后缀，两个会话并存，可以对照。

如果原会话移入回收站失败（比如文件一时被占用），分支照常保留并提示原因，
不会因为回收失败把已建好的分支丢掉。

为什么要 fork：DSH 目前没有「原地截断会话日志」的能力（只能归档、不能回退），
fork 是唯一能「替换掉这条请求」又不丢历史的方式。

实现说明：用户气泡的操作行（时间和复制按钮）由官方组件写死、没有开放 Slot，
插件是在渲染完成后把铅笔注入到 `[data-chat-flow-kind="user"]` 气泡里的
`[data-clock="start"]` 操作行，节点 key 取自 `data-chat-node-key`，
再用它回到 chat 投影里取 seq 和原文；样式只用 `--dsw-alias-*` 变量，
会话卸载时会把注入的节点和样式一并清掉。

限制与说明：

- 只能取回**文本**：附件、`@` 引用的 chip 不会跟着过去（正文会保留）。
- 会话正在跑的时候铅笔置灰（先停止，再编辑）；没有可编辑文本（比如只发了图片）的消息不显示。
- 改的是较早的消息时，那条消息之后的对话只存在于原会话里——所以默认把原会话放进回收站，
  取消勾选就能两边都留着。
- 草稿是写给分支会话的，取消编辑不会污染当前会话的草稿。
- 分支和原会话共享同一条前缀历史，所以上下文是连续的。

## 存储与保留

```
~/.dsh/session-trash/entries/<时间戳>-<会话 id>/
  meta.json      # id、标题、原工作区、删除时间、字节数
  session/       # 原来的会话目录
```

- 回收站保留 **7 天**，过期条目在下次打开回收站时惰性清理。
- 删除只发生在 `~/.dsh` 内，路径会做目录逃逸校验；接口只接受**本机回环**调用、
  同源请求并带 `x-dsh-plugin: session-tidy` 头，杜绝任意网页或局域网客户端调用。
- 想立即清空磁盘占用，用回收站里的「彻底删除 / 清空回收站」。

## 安装

包名 `dsh-session-tidy`（npm），bundle 名同名。

**插件管理器（推荐）**：用 `plugin_manager` 的 `install_bundle` 指向包目录（或解压后的目录），
或在插件市场里按包名安装。管理器会负责 profile 的 `package.json`、`cordis.patch.yml` 与依赖。

**手动登记**：在 `~/.dsh/profiles/<profile>/package.json` 里加

```json
"dependencies": { "dsh-session-tidy": "^1.0.0" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-session-tidy"] } }
```

再在 profile 目录安装依赖并重启 DSH。Host 半随插件树加载，Client 半在刷新页面后出现。

**本地开发**：把仓库目录用目录联接挂到 profile 的 `node_modules/dsh-session-tidy`，
依赖写 `"dsh-session-tidy": "link:<绝对路径>"`；bundle patch 会让 HMR 直接重排插件树。

### 卸载

1. 从 profile `package.json` 的 `bundles` 与依赖里删掉 `dsh-session-tidy`。
2. 删除 `node_modules/dsh-session-tidy`。
3. 需要的话删除 `~/.dsh/session-trash`。

## 结构

- `index.js` — Host 入口：解析 DSH home、注册 `/plugin/session-tidy` 前缀路由，
  删除前调用 `workspaceRegistry.archiveSession(id, { stopActivity: true })`，
  恢复后重新 `attachSession` 并 `unarchiveSession`。
- `lib/trash.js` — 回收站存储：移动（跨盘回退到复制+删除）、meta、恢复、清理、过期。
- `lib/routes.js` — HTTP 层：`GET trash`、`POST delete|restore|purge|empty`，含同源与请求头校验。
- `client.js` — 浏览器侧：会话行删除按钮、菜单项、侧边栏底部回收站入口、
  每条用户消息的悬停铅笔（注入到官方气泡操作行）、确认框 / 回收站对话框 / Toast
  （全部使用 `--dsw-alias-*` 主题变量，跟随明暗主题）。
- `cordis.patch.yml` — bundle patch，插入 `session-tidy` 这一行。

## 测试

```bash
node --test "test/*.test.mjs"
```

38 个用例覆盖回收站存储、HTTP 路由（回环/同源校验、回滚、错误码）、Host 注册，
Client 的插槽注册与词典完整性，以及消息铅笔的注入 / 禁用 / 取值、弹窗内直接编辑、
空内容禁用确认、fork 切点（上一条 turn/end、跳过空 turn）、草稿写入（写入的是改后文本）、
原会话入回收站与失败提示。

实际联调记录（隔离的 `DSH_HOME` + 独立端口，未触碰真实会话）：

- `POST delete` → 归档并移入回收站、`session_projcache` 同步清除；
- `GET trash` → 列出条目（含标题、大小、时间）；
- `POST restore` → 文件回到原目录、条目清空；
- `POST purge` / `empty` → 目录删除；
- 无标记头 / 跨源 → 403，路径逃逸 id → 400；
- 对「注册表已知」和「注册表未知」两类会话都验证过删除与恢复。

已安装到 desktop profile 并现场确认 `/plugin/session-tidy/trash` 返回
`{"ok":true,"entries":[]}`，说明 Host 半已生效；浏览器内的最终视觉呈现
需要在实际页面里确认。

## 暂未做（后续备选）

- 空会话 / 空分支批量清理
- 分支血缘标记与「回到原会话」
- 编辑时带上附件与 `@` 引用
- 批量清理面板（按工作区筛选、按大小排序、批量删除）
- 导出会话、存储占用统计