# 阶段：review — 成片质检

**产物**：`plan/review.json`、`out/qc/frames/` · **需审批**

## 自动检查（`onevideo qc`）

| 检查 | 失败条件 |
|---|---|
| video-codec / resolution / fps | 与时间轴不符 |
| duration | 偏差 > 0.5s |
| loudness | 偏离 -16 LUFS 超过 ±2（warn）/ ±4（fail） |
| true-peak | > -1 dBTP（warn） |
| silence-in-narration | 旁白区间内出现 > 1.2s 静音（丢句） |
| dead-air | 旁白区间外的长静音（warn） |
| black-frames | 中段出现 > 0.6s 黑场 |
| frozen-segments | > 8s 画面无变化（warn） |
| static-ratio | 近静止采样占比超过上限（warn） |

阈值可在 `onevideo.json` → `qc` 覆盖，见 `references/qc-thresholds.md`。

## 人工检查（必须做）

逐张查看 `out/qc/frames/`（每场景 60% 处一帧）：

- 文字是否溢出、被字幕遮挡、与图形重叠
- 数字与旁白是否一致、格式是否统一
- 字幕是否与画面数字冲突
- 片尾来源是否完整

再完整播放一遍成片，听：读音、停顿、音乐压低是否自然。

## 看节奏（`onevideo sheet` / `onevideo look`）

- `onevideo sheet`：把成片按每秒一格（长片自动放宽）铺成联系表 `out/qc/sheet-NN.jpg`，并输出每个场景从第几格开始。一眼就能看出哪里画面停住了、哪里文字撞在一起、哪里构图或转场重复。
- `onevideo look`：请视觉模型按剪辑标准逐张联系表审片，意见写进 `out/qc/look.json`，每条带时间点、场景、严重度和改法。`--focus` 可以指定重点（例如 `"字幕可读性"`），`--models` 可以换模型。
- look 的意见是第二意见：先在联系表上或用 `onevideo stills --scene <id>` 确认问题存在，再改分镜；确认不是问题的意见可以忽略。

## 结论

verdict 为 fail 时修复后重新渲染；warn 需逐条说明是否接受。全部确认后：`onevideo approve review`。
