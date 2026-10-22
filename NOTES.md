# dsh-usage-pulse 本地开发备忘

给"在这台机器上继续开发它的人"看的：当前挂在哪、改完怎么生效、怎么验证、有哪些坑。
面向使用者的说明在 [README.md](./README.md)。

## 它是什么

DSH 的"用量电表"插件，分两半：

- 宿主半 `index.js`：监听 session 事件流，把 DeepSeek token 用量按北京时间小时桶聚合，
  按官方峰谷价算钱，持久化到磁盘，并通过同源路由 `GET /usage-pulse/api/snapshot?sessionId=<id>`
  给输入框旁的挂件供数。只存聚合数字（小时桶 + 会话总量），**不存任何对话内容**。
- 客户端半 `client.js`：一个紧凑的输入框 dock 挂件 —— 当前峰谷时段与倒计时、今日花费（CNY）、
  展开后的会话明细、24 小时 / 7 天柱状图与当前单价。每 5 秒轮询一次上面的路由。

- 包名 / 目录名：`dsh-usage-pulse`
- 仓库：https://github.com/hunyu-feng/dsh-usage-pulse
- 未发布 npm；本地以 `file:` 依赖挂在 desktop profile

## 本地挂载状态（desktop profile）

- 源码目录：`C:\Users\wang7\Documents\deepseek-harness\default-workspace\dsh-usage-pulse`
- `package.json` 依赖：`"dsh-usage-pulse": "file:C:/Users/wang7/Documents/deepseek-harness/default-workspace/dsh-usage-pulse"`
- `dsh.profile.bundles` 中包含 `dsh-usage-pulse`

**故意没改的内部名字**（改了会丢用户数据或让 UI 对不上）：

- `index.js` 里 `export const name = 'usage-pulse'`、路由 `/usage-pulse/api/snapshot`、
  客户端 NS `usage-pulse`、`data-usage-pulse` 样式属性、localStorage 键 `usage-pulse`。
- `cordis.patch.yml` 的 entry **id 仍是 `usage-pulse`**，只有 `name` 改成了 `dsh-usage-pulse`。
  profile 的 override 是按 id 匹配的，id 一变就可能和已有配置失配。
- 数据目录仍是 `~/.dsh-usage-pulse`（可用 `DSH_USAGE_PULSE_DIR` 覆盖）。

只有 `package.json` 的 name、仓库 URL、patch 的 `name`、`client.js` 的 `id`
跟着新命名走了。

## 改完代码怎么生效（最容易踩的坑）

**禁用再启用插件不会重新加载代码。** DSH 用 ESM 加载，模块缓存按绝对路径算，
同一个路径再次 import 拿到的还是旧模块。

- 宿主半改动：重启 DSH 宿主；或换目录名后 `remove_bundle` + `install_bundle`
  （路径变 = 模块 URL 变）；或用 dev 副本（复制目录、改 name 与 patch id、`node_modules` 软链）。
- 客户端半改动：`client.js` 是运行时由宿主下发给 Web UI 的，同样走模块缓存 ——
  宿主重启后刷新页面即可；只刷新页面不会拿到新代码。

## 怎么验证

```bash
# 宿主半与价格/节假日逻辑的单元测试（node --test）
node --test

# 宿主半是否活着（同源路由，返回 ok:true）
curl -s http://127.0.0.1:62053/usage-pulse/api/snapshot | head -c 200
```

Web UI 里看输入框下方的挂件是否显示峰谷时段与今日花费；展开能看 24h/7d 柱状图即为正常。

## 已知限制

- 价格表与节假日表是写死的常量（`index.js` 的 PRICING / `holidays.js` 的 HOLIDAYS）。
  DeepSeek 调价或发新节假日时需要手工更新，更新后重启宿主。
- 时区固定按北京时间（UTC+8，无夏令时）切桶，改时区要动 `BJ` 常量。
- 只统计 DeepSeek 的计费口径（峰谷价）；换别的 provider 时费用列没有意义。
- 快照是轮询的（5s），不是推送；页面隐藏时浏览器会降频，倒计时可能跳秒。

## 改名历史

- 2026-10-22：包名 `dsh-plugin-usage-pulse` → `dsh-usage-pulse`，目录 `usage-pulse` →
  `dsh-usage-pulse`，仓库同步改名（GitHub 会自动重定向旧地址）。运行时的 id / 路由 /
  数据目录刻意保持不变，见上文。
