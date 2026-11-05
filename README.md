# OneVideo

用 Claude Code 生产带旁白视频（数据解说、纪录片、竖屏短视频）的流水线和 Skill。整个过程分阶段推进，每一步都有门控。

```
research → proposal → script → storyboard → assets → voice → compose → render → review → publish
  事实+来源   方案      逐句脚本    分镜/图表     授权素材   TTS+响度   时间轴     Remotion   自动 QC   字幕/章节/简介
```

## 特性

- **引擎共享，项目只存数据**：项目目录里只有 `onevideo.json`、`plan/*.json`、`public/`、`out/`，所有项目共用 `template/` 下的 Remotion 引擎。
- **阶段状态机**：创作阶段要人工审批，审批时锁定产物哈希。上游改动后，下游自动标记为 stale。
- **机械门控**：
  - 数字门控：旁白里的每个数字都要对上 research 里有来源的 fact，`claims` 引用的 fact id 必须存在。
  - 语速门控：按音节估算，范围 3.5–6.2 音节/秒。
  - 字幕长度、场景时长、素材授权白名单。
- **逐句 TTS 计时**：字幕和画面揭示跟着真实语音时间走。整片统一做 BS.1770 响度归一化（默认 −16 LUFS），带软限幅。
- **场景库**：标题、数据卡、柱状图竞赛、折线、对比、时间线、引用、图片/视频 Ken Burns、章节卡、片尾等；风格和动效节奏可配置。
- **素材**：NASA、Wikimedia Commons、Openverse 免 key 可用；Pexels（可选）；也可以通过 OpenAI 兼容接口生图。授权信息自动进入简介。
- **程序化配乐和音效**：零依赖合成，没有版权问题。
- **渲染后 QC**：检查编码、分辨率、帧率、时长、响度、真峰值、旁白中的静音、黑帧、冻结画面、静态占比，并按场景抽帧供人工审阅。
- **发布包**：SRT/VTT 字幕、章节时间戳、带全部来源与素材署名的简介。

## 安装

需要 Node ≥ 20。

```bash
git clone https://github.com/dengyie/OneVideo.git && cd OneVideo
npm run setup            # 安装 template/ 的 Remotion（自带 ffmpeg）
npm link                 # 可选：全局提供 onevideo 命令
onevideo doctor
```

TTS 和生图使用 OpenAI 兼容接口，key 从环境变量 `MANGO_API_KEY` 读取（接口地址和 env 名可在 `onevideo.json` 里改），永远不会打印出来。

## 快速开始

```bash
onevideo init my-video --example spacex-ipo   # 从完整示例起步
cd my-video
onevideo status          # 各阶段状态 + 下一步该读的导演文档
onevideo validate        # schema + 门控
onevideo tts --sample    # 先试听一句
onevideo build           # tts → music → timeline → render → qc → publish
```

成片位于 `out/<name>.mp4`，审阅帧在 `out/qc/frames/`，发布包在 `out/publish/`。

从零开始的项目用 `onevideo init my-video --pipeline data-explainer --style midnight-data`，再按 `onevideo status` 的提示逐个阶段推进。

## 作为 Claude Code Skill 使用

```bash
ln -s "$PWD" ~/.claude/skills/onevideo
```

之后对 Claude 说“帮我做一条关于 X 的视频”即可。`SKILL.md` 约定了工作方式：每个阶段先读 `stages/<id>.md`，交给用户审批，渲染后逐帧看图。

## 目录

| 路径 | 内容 |
|---|---|
| `cli/` | `onevideo` 命令，零 npm 依赖 |
| `template/` | Remotion 引擎（场景组件、风格、动效） |
| `pipelines/` | data-explainer / documentary / shorts 的阶段定义 |
| `stages/` | 每个阶段的导演文档 |
| `styles/` | 视觉风格 token |
| `schemas/` | 项目与各 plan 产物的 JSON Schema |
| `references/` | 中文写作、TTS 读音、数据可信、授权、场景、动效、QC 阈值 |
| `examples/spacex-ipo/` | 完整示例（SpaceX IPO 数据解说） |
| `tests/` | `npm test`（node:test） |

## 许可

MIT。本项目的阶段化与导演文档思路参考了 [OpenMontage](https://github.com/calesthio/OpenMontage)（AGPL-3.0），但没有包含它的任何代码或文本，全部重新实现。
