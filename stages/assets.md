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

- `query`：按 provider 顺序检索（默认 NASA → Wikimedia → Openverse；视频走 Pexels，需要 `PEXELS_API_KEY`），按许可开放度、画幅贴合度、分辨率打分取第一（`pick` 可指定第 N 个）。
- `url`：直链，必须手填 `license`/`author`/`source`。
- `generate`：AI 生图（默认 `gpt-image-2.5`，经 Mango API）；许可记为 `generated`，片尾标注“AI 生成”。

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
