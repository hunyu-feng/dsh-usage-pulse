# Usage Pulse · 峰谷用量

> 本地开发备忘（怎么改、改完怎么生效、踩过的坑）：见 [NOTES.md](./NOTES.md)。

A DSH Web UI plugin that keeps DeepSeek's **peak / off-peak pricing**, your **token spend** and your
**hourly usage** visible right below the composer — updated live, no page reload.

一个 DSH Web UI 插件：在输入框下方实时显示 DeepSeek 的**峰谷时段与价格**、**token 用量与花费**，以及**分时用量图表**。

![status: peak/off-peak badge with live countdown](https://img.shields.io/badge/price-peak%20%2F%20off--peak-16b8a6)

## Features · 功能

- **Live regime badge** — `峰时` / `谷时 5 折` with a countdown to the next price switch, computed in
  Beijing time (`Asia/Shanghai`), including Chinese statutory holidays (peak is Mon–Fri 09:00–12:00
  and 14:00–18:00, holidays and weekends are always off-peak).
- **When the cheap window starts** — the expando shows the next off-peak window (`下一谷段 今天 12:00
  开始 · 4 小时后`) and when the current segment began, and while peak is running the pill itself shows
  `谷段 12:00 起`.
- **Today at a glance** — today's spend in CNY plus total tokens, refreshed every 5 seconds.
- **Session breakdown** — expand the pill to see this session's requests, tokens and cost, plus the
  cache-hit / cache-miss / output split and how much of today's spend happened in peak vs off-peak
  hours.
- **Hourly & daily usage** — 24 one-hour bars (amber = peak hours) and the last 7 days, so you can see
  when you spend.
- **Official unit prices** — the current tier's CNY / 1M-token prices for `deepseek-flash` and
  `deepseek-v4-pro` (peak and off-peak are exactly ×2 / ×1).
- **Bilingual UI** — 中文 / English through the harness locale service.

## How pricing is computed · 计费口径

Prices follow the official page <https://api-docs.deepseek.com/quick_start/pricing/> (verified
2026-10-22, CNY per 1M tokens):

| Model | Band | Cache hit | Cache miss | Output |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | peak | 0.04 | 2 | 8 |
| `deepseek-flash` | off-peak | 0.02 | 1 | 4 |
| `deepseek-v4-pro` | peak | 0.30 | 9.0 | 27.0 |
| `deepseek-v4-pro` | off-peak | 0.15 | 4.5 | 13.5 |

Peak = Beijing time **Mon–Fri 09:00–12:00 and 14:00–18:00**, excluding Chinese statutory holidays.
Everything else (nights, weekends, holidays) is off-peak, at exactly half the peak price.

Usage is read from the harness session event feed (`assistant/message` → `usage`), where
`inputTokens` already excludes cache hits: `cost = miss·missRate + hit·hitRate + output·outRate`
(`cacheWriteTokens` is billed at the cache-miss rate). Estimates only — Search / Fetch request fees
are not included.

## Privacy · 隐私

Only aggregates are stored, never conversation content: per-hour counters (tokens and cost) and
per-session totals, kept for 35 / 120 days respectively and capped at 300 sessions. The file lives at
`~/.dsh-usage-pulse/usage.json` (override with `DSH_USAGE_PULSE_DIR`). All computation is local; the
widget talks to the host over a same-origin route only.

## Install · 安装

This repository is a DSH plugin bundle: `package.json` declares the `dsh.bundle` manifest and
`cordis.patch.yml` inserts the plugin, so it installs the same way as any other plugin.

```bash
# once the entry is listed in the community catalog
dsh plugin add hunyu-feng/dsh-usage-pulse
```

For a local checkout, point the DSH plugin manager at the directory containing `package.json`
(`plugin_manager install_bundle` in the Web UI). No restart is needed: the widget appears in the
composer dock right after install.

## Files

| File | Purpose |
| --- | --- |
| `index.js` | Host half: event aggregation, pricing, persistence, `GET /usage-pulse/api/snapshot` |
| `client.js` | Client half: composer-dock widget + detail panel |
| `holidays.js` | Chinese statutory holidays (off-peak days) |
| `locale/` | Bundle metadata (zh / en) |
| `cordis.patch.yml` | Loader patch that inserts the plugin |

## Notes

- Peak-regime accuracy depends on `holidays.js`: add the next year's State Council holiday list once
  it is published (usually the preceding November). A stale list only mislabels holiday days.
- Usage that happens while the plugin is disabled is not backfilled (the persisted session log is a
  concatenated zstd frame stream that Node cannot decode frame-by-frame reliably).

Licensed under the MIT License.
