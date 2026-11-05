# QC 阈值

`onevideo qc` 检查渲染出的 mp4，结果写入 `plan/review.json`，每帧审查图放在 `out/qc/frames/`。项目可在 `onevideo.json` 的 `qc` 里覆盖任意阈值（深合并）。

| 检查 | 默认阈值 | fail / warn |
|---|---|---|
| video-codec | h264 | 其他编码 warn |
| resolution / fps | 与 timeline 一致 | 不一致 fail |
| audio-codec | aac | 其他编码 warn |
| duration | 与 timeline 相差 ≤0.5s | 超出 fail |
| loudness | −16 LUFS ±2 | 超出 2 LU warn，超出 4 LU fail |
| true-peak | ≤ −1 dBTP | 超出 warn |
| silence-in-narration | 静音段 > 1.2s，阈值 −45 dB | 落在旁白区间内 fail（掉句） |
| dead-air | 同上 | 落在旁白区间外 warn |
| black-frames | 平均亮度 < 10，持续 > 0.6s | 片中出现 fail（首尾 0.5s 不算） |
| frozen-segments | 与 1s 前的帧差 < 0.6，持续 > 8s | warn |
| static-ratio | 静止采样占比 ≤ 45% | 超出 warn |

## 实现要点

- 帧分析把视频缩到 64×36 灰度，按 `sampleFps`（默认 2）抽样。帧差比较的是**当前帧与 `frozen.window` 秒之前的那一帧**，而不是相邻帧，所以缓慢但持续的运动也算运动，和人眼的感受一致。
- 响度用 ffmpeg 的 `loudnorm` 测量。旁白在 TTS 阶段已统一归一化到 `tts.loudness`（默认 −16 LUFS），背景音乐只会让整体响度再高约 0.3–0.5 LU。
- Remotion 自带的 ffmpeg 缺少 `fps`、`select` 等滤镜，所以抽帧和帧分析在 JS 里做（`decodeGrayPng`）。

## 通过之后

verdict 为 PASS 也要**逐张看完** `out/qc/frames/`（每个场景在 60% 处截一帧），重点看：

1. 文字有没有溢出、重叠，或压到字幕带。
2. 图表的数字和旁白是否一致，单位、精度是否统一。
3. 片尾来源是否完整。

确认后执行 `onevideo approve review`。publish 会拒绝 verdict 为 FAIL 的版本。

## 调整阈值的原则

只有当内容本身合理时才放宽阈值。例如纪录片里刻意的长镜头，可以把 `frozen.maxRun` 调到 12。不要为了让 QC 变绿而调阈值，应该先修画面或音频。
