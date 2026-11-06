# 阶段：assets — 素材

**产物**：`plan/assets.json`（schema：`schemas/assets.schema.json`） · data-explainer/shorts 可选，documentary 需审批

所有外部图片/视频都通过清单进入工程，每条带许可证与出处，片尾自动署名。

## 清单条目

```json
{ "items": [
  { "id": "launch", "query": "Falcon 9 launch", "provider": ["nasa", "wikimedia"] },
  { "id": "pad", "url": "https://…/pad.jpg", "license": "CC BY 4.0", "author": "…", "source": "https://…" },
  { "id": "cover", "generate": "深蓝夜空下的火箭剪影，电影感，无文字" }
] }
```

- `query`：按 provider 顺序检索（图片默认 NASA → Wikimedia → Openverse；视频默认 NASA → Wikimedia，有 `PEXELS_API_KEY` 时再加 Pexels；视频下载后自动裁成无声 H.264 片段，`clip: [起点秒, 时长秒]`，默认前 20 秒，最长 60 秒），按许可开放度、画幅贴合度、分辨率打分取第一（`pick` 可指定第 N 个）。
- `url`：直链，必须手填 `license`/`author`/`source`。
- `generate`：AI 生成，许可记为 `generated`，片尾标注“AI 生成”。可以直接写一句 prompt，也可以写成对象：

  ```json
  { "id": "pad", "generate": { "prompt": "蓝调时刻海边发射台上的火箭，电影感，无文字", "variants": 3, "brief": "开场远景，上方留出标题位置" }, "query": "Falcon 9 launch pad" },
  { "id": "liftoff", "kind": "video", "generate": { "prompt": "缓慢推近，火箭点火升空", "from": "pad", "duration": 6 } }
  ```

  - 图片：模型按 `model` / `models` 的顺序依次尝试，默认 `gpt-image-2.5` → `grok-imagine-image-quality`；尺寸跟随项目画幅。`variants`（1–4）一次出多张，由视觉模型按 `brief` 挑一张；所有备选都保存为 `<id>.take<k>.*`，`picked` / `pickReason` 记录挑选结果，`pick: N` 可以直接指定。
  - 视频：`kind: "video"`，走 `/videos` 任务接口（提交 → 轮询 → 下载），默认 `grok-imagine-video` → `grok-imagine-video-1.5`。`duration` 取 1–15 秒，`resolution` 默认 720p；`from` 指定一个图片素材，把它当首帧做成动态画面（这类条目会排在最后取）。取回后和下载的视频一样，裁成片段并抽出帧序列。
  - 生成失败时会回落到同一条目的 `url` / `query`，并给出警告；两者都没有时报错。
  - 全局默认写在 `onevideo.json` 的 `image` / `video` / `llm` 段（`baseUrl`、`keyEnv`、`model(s)` 等）。`onevideo doctor` 会显示当前生效的模型顺序。

## 命令

```bash
onevideo assets search "falcon heavy" --provider nasa,wikimedia   # 先看候选
onevideo assets fetch                                              # 下载缺失项 → public/assets/
onevideo assets fetch --only launch --force                        # 重取单个
```

## 许可（详见 `references/licensing.md`）

允许：PD/CC0、CC BY、CC BY-SA、Pexels/Pixabay License、generated、own。拒绝：NC、ND、未知许可。licensing 门在 validate 时检查。

## 用法

在分镜里用 `media` 场景（`props.asset: "<id>"`）或 `quote`/`compare` 的 `asset` 字段引用。
