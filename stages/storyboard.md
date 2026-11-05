# 阶段：storyboard — 分镜

**产物**：`plan/storyboard.json`（schema：`schemas/storyboard.schema.json`）

给每个脚本场景选一个场景类型并填数据。类型清单与 props 见 `references/scene-catalog.md`。

## 每个场景

```json
{ "id": "ipo", "type": "stat-cards",
  "header": { "title": "上市当天", "subtitle": "来源：…" },
  "cues": { "price": "发行价", "cap": { "phrase": "市值约", "offset": 0.2 } },
  "sfx": [{ "sound": "pop", "at": "发行价" }],
  "props": { "cards": [{ "value": 135, "format": { "prefix": "$" }, "label": "发行价", "cue": "price" }] } }
```

- **cues** 把画面变化钉在旁白上：值可以是旁白里的短语（取该短语开始说出的时刻）、`{phrase, offset}`、0–1 之间的比例（场景长度的百分比）或秒数。props 里的 `cue`/`drawCue`/`periodCues` 引用这些名字；引用未定义的 cue 会报错。
- 没写 cue 的元素按默认节奏在场景前 55% 依次出现。
- `enter`/`exit`：fade · slide · zoom · wipe · cut；不写用风格默认。
- `duration`（无旁白场景）、`minDuration`（数据动画需要的最短时间）、`hold`（旁白结束后额外停留秒数）。
- `captions: false` 关闭本场景字幕（片尾来源页）。
- `sources` 场景的 `props.auto: true` 自动汇总 research 来源与素材署名。

## 原则（详见 `references/motion-rules.md`）

- 连续同类型场景不超过 2 个（variety 门）。
- 静态类（title/quote/bullets/chapter/sources）合计不超过约 40% 的场景（documentary 30%）。
- 图表里的数字必须来自 research 的 `value`；不要在分镜里手算新数字。
- 一屏一个焦点：数字卡 ≤4 张一排，排名竞赛 top ≤10，饼图 ≤6 段。

## 检查

`onevideo validate` 之后 `onevideo tts && onevideo timeline && onevideo stills`，逐张看 `out/stills/`，再进入渲染。
