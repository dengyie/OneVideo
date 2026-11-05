# 阶段：compose / render — 合成与渲染

**产物**：`plan/timeline.json`、`public/music/`、`public/sfx/`、`out/<name>.mp4`

## 步骤

```bash
onevideo music        # 程序化 BGM（按时间轴长度）+ 用到的音效
onevideo timeline     # 编译时间轴：场景时长、字幕、cue、旁白区间
onevideo stills       # 每场景一帧（默认 70% 处）→ out/stills/，逐张看
onevideo render --draft   # 半分辨率快速版（可选）
onevideo render       # 正式渲染 h264 + aac
```

`onevideo studio` 打开 Remotion Studio 实时预览本工程。

## 时间轴怎么算

- 场景时长 = 旁白时长 + hold（默认 0.5s），不低于 `minDuration`；无旁白场景用 `duration`（默认 4s）。
- 字幕是绝对时间，来自每句的实测起止。
- 音乐在旁白区间自动压低到 `duckTo`，0.35s 渐变。
- 转场音效（`sfx.transition`）放在每个场景开头。

## 渲染前必须

- `validate` 0 error。render 会重新编译并跑门控，有 error 时拒绝渲染（`--force` 可跳过，仅限调试）。
- 看过全部 stills：文字溢出、元素重叠、数字格式、图表刻度。

## 音乐（`music`）

预设：`ambient` · `pulse` · `documentary` · `bright`；`seed` 换旋律；`file` 用自带音乐（`public/` 下的相对路径，需有授权），并用 `credit` 写明曲名 · 作者 · 许可。`enabled: false` 关闭。
