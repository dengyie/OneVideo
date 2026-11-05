# 阶段：voice — 配音

**产物**：`plan/timings.json`、`public/audio/*.wav`

## 步骤

1. `onevideo tts --dry`：打印每行的切分、停顿类型和实际读法（lexicon 替换后）。检查英文缩写、数字读法。
2. `onevideo tts --sample`：只合成第一句，给用户试听，确认音色和语速。
3. `onevideo tts`：逐句合成。按内容哈希缓存，只改一句就只重合成那一句。
4. `onevideo validate`：rate 门检查每场景语速（3.5–6.2 音节/秒）。

## 配置（`onevideo.json` → `tts`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `model` | `mimo-v2.5-tts` | OpenAI 兼容 `/audio/speech` |
| `voice` | `mimo_default` | |
| `baseUrl` | `https://api.mangoqwq.com/v1` | |
| `keyEnv` | `MANGO_API_KEY` | 未设置时回落到 `~/.zcode/v2/provider_config.json` 中的 key；key 不会打印 |
| `speed` / `instructions` | — | 透传给模型 |
| `pause` | `{sentence: 0.32, clause: 0.16}` | 句间/逗号停顿秒数 |
| `syllablesPerSecond` | 4.8 | budget 门的估算语速 |

## 读音问题

见 `references/tts-pronunciation.md`。单行修正用 `lines[].speak`，全局修正用 `lexicon`。修改后 `onevideo tts` 只会重合成受影响的行。
