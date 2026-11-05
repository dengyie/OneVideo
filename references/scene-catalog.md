# 场景目录

13 种场景类型，props 的权威定义在 `schemas/storyboard.schema.json` 的 `props.<type>`；`onevideo validate` 按类型校验。`STATIC_TYPES`（quote、bullets、title、chapter、sources）在整片中占比不超过 40%（`gates.staticRatioMax`），同类型连续不超过 2 个（`gates.maxSameTypeRun`）。

## 何时用哪种

| 类型 | 适合 | 必填 | 关键可选 |
|---|---|---|---|
| `title` | 片头、钩子 | `title` | `kicker`、`subtitle`、`date` |
| `chapter` | 章节转场 | `title` | `index`、`subtitle` |
| `stat-cards` | 1–8 个关键数字 | `cards[{value,label}]` | `columns`、卡片 `from`/`format`/`note`/`color`/`cue` |
| `bar-compare` | 同一时点的横向对比 | `items[{label,value}]` | `sort`、`max`、`unit`、`format` |
| `bar-race` | 排名随时间变化 | `periods`、`series[{name,values}]` | `top`、`group`+`groupColors`、`periodCues` |
| `line-chart` | 趋势、增长曲线 | `series[{name,points}]` | `annotations`、`drawCue`、`yMin`/`yMax` |
| `share` | 构成、占比（环形图） | `segments[{label,value}]` | 每段 `cue`、`unit` |
| `timeline` | 事件序列 | `events[{date,title}]`（2–10 个） | `note`、`highlight`、`cue` |
| `compare` | A vs B | `left`、`right` | `vs` |
| `quote` | 引语 | `text` | `author`、`source`、`asset` |
| `bullets` | 要点总结 | `items` | `title` |
| `media` | 照片、视频素材 | `asset` | `motion`（in/out/left/right/up/none）、`fit`、`dim`、`caption` |
| `sources` | 片尾来源 | — | `auto`（默认从 research + assets 生成） |

## 场景通用字段

- `header: {title, subtitle}`：图表场景的标题条。subtitle 写口径和日期（“2026-11-04 收盘 · StockTitan”）。
- `cues: {name: 时间}`：时间可以是秒（负数从结尾倒数）、0–1 比例、旁白里的短语，或 `{phrase, offset}`。props 用 `cue`、`drawCue`、`periodCues` 引用 cue 名，引用未定义的 cue 会报错。
- `enter` / `exit`：`fade`、`slide`、`zoom`、`wipe`、`cut`。
- `background`：`default`、`plain`、`grid`、`stars`、`media`。
- `hold`：旁白结束后停留的时间（默认 0.5s）；`duration` / `minDuration` 给无旁白或需要更长停留的场景。
- `sfx: [{sound, at}]`：`at` 同 cue 语法。
- `intent`：一句话写明这个画面要让观众记住什么，方便审稿。

## 数字格式 `format`

`{prefix, suffix, decimals, compact}`。`compact: "zh"` 输出“亿/万亿”，不指定 `decimals` 时取 3 位有效数字并去掉尾零（1187亿、1.85万亿）。

## bar-race 要点

- `values` 和 `periods` 等长，某期不在榜单用 `null`。
- `periodCues` 把某一期对齐到旁白里的 cue：有 cue 的期是锚点，没 cue 的期在锚点之间均匀插值。最后一期默认出现在场景 72% 处。
- 每次换期只有一段很短的交换动画（≤1.6s），之后停住，让观众读清楚排名。
- 不同时期的数据来源和计价日写进 header subtitle。

## 选型原则

1. 一个场景只讲一件事。两个数字用 stat-cards，十个数字用图表。
2. 能动起来就别静止：用 cue 让卡片、柱子、事件跟着旁白逐个出现。
3. 图表优先于文字：bullets 是最后的手段，不要用它承载数据。
