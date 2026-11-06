---
name: onevideo
description: Use when the user wants a narrated video made — data explainers, documentaries, short-form vertical clips — from a topic, article or dataset. Runs a staged, gated pipeline (research → proposal → script → storyboard → assets → voice → compose → render → review → publish) with sourced facts, sentence-level TTS timing, Remotion rendering, automated QC and a publish kit.
---

# OneVideo

OneVideo 把“做一条视频”拆成 10 个阶段。每个阶段都有一份导演文档（`stages/<id>.md`）、一个落盘的产物（`plan/*.json`），以及机械门控；需要人拍板的阶段要审批，审批会锁定产物的哈希。共享的渲染引擎在 `template/`，项目目录里只放数据。

## 工作方式

1. `onevideo status` 显示每个阶段的状态和下一步该读哪份导演文档。**每进入一个阶段，先读对应的 `stages/<id>.md`，再动手。**
2. 创作阶段（research、proposal、script、storyboard）由你写 JSON / Markdown，然后 `onevideo validate`，再把产物给用户看，用户确认后执行 `onevideo approve <stage>`。**不要替用户审批**，除非用户明确授权。
3. 非创作阶段由 CLI 执行：`tts`、`music`、`assets fetch`、`depth`、`timeline`、`render`、`qc`，也可以用 `build` 一次跑到 qc（缺的素材自动下载，有 depth 工具时自动做深度图和亮度网格）。`publish` 要求 review 已审批。
4. 分镜按动效引擎写，不要做成一页一张卡：先读 `references/motion-rules.md`，参考 `examples/spacex-motion`。实拍做主角（`footage` 变速、标题压在主体后），数字进 `canvas` 连续飞行，每个场景都有 `shots`，钩子和结论每句一个 `word` 关键词，有音乐时写 `music.offset: "auto"`。`onevideo timeline` 报出的 rhythm 警告（画面超过 4.5s 没有新东西、连续相同转场）要处理掉，或者向用户说明为什么保留。
5. 渲染后必须执行 `onevideo qc`，并**逐张看** `out/qc/frames/`，确认画面没问题后再 `approve review`。

## 硬规则

- 旁白里的每个数字都要能在 `plan/research.json` 的 facts 里找到，facts 必须有来源（numbers 门控）。不要为了过门控而编造来源。
- 素材只用白名单授权（`references/licensing.md`），CC BY 素材要写作者和来源。
- API key 只从环境变量或本机配置读取，不打印、不写进项目文件。共享 key（`MANGO_API_KEY` 等）只发往 `api.mangoqwq.com`；换 `baseUrl` 必须配专用 `keyEnv`。`~/.zcode` 的 provider 配置仅在显式 `ONEVIDEO_ZCODE_PROVIDER=1` 时读取。
- 已审批的产物被改动后，该阶段显示 stale，需重新给用户看并 `approve`。改了 script 之后必须重跑 `tts`，否则 timings 门控报错、渲染被拦；不要手改 `timeline.json`。

## 命令

```bash
onevideo init <dir> --pipeline data-explainer|documentary|shorts [--style midnight-data] [--aspect 16:9] [--example spacex-motion|spacex-ipo]
onevideo status | validate [--strict] | approve <stage> [--note …]
onevideo tts [--sample|--dry|--force|--only a,b]   # 逐句合成 → plan/timings.json（含响度归一化）
onevideo music [--preset ambient|pulse|documentary|bright]
onevideo assets search <q> [--provider nasa,wikimedia,openverse,pexels] | assets fetch
onevideo depth [asset ids] [--step 2]               # 深度图 + 亮度网格：主体穿越、关键词避让、自动加底、字幕避让
onevideo timeline | stills [--scene id] [--at 0.3,0.7] | studio | render [--draft]
onevideo lib list|search|recipe <name> --id x --set k=v   # 音效 / Lottie / 镜头配方
onevideo qc | publish | build [--draft] | doctor | decide <category> <subject> --selected X
```

未全局安装时，用 `node <repo>/cli/onevideo.mjs …` 调用。

## 参考

- 流水线定义：`pipelines/*.json`；视觉风格：`styles/*.json`
- 写作：`references/writing-zh.md` · 读音：`references/tts-pronunciation.md`
- 场景与动效：`references/motion-rules.md`（先读）· `references/scene-catalog.md`
- 数据与授权：`references/data-integrity.md` · `references/licensing.md`
- 质检：`references/qc-thresholds.md`
- 示例：`examples/spacex-motion/`（动效引擎示范，36s）· `examples/spacex-ipo/`（数据图表版，85s）；`onevideo init demo --example spacex-motion`
