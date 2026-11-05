// Narration text handling: caption-line splitting, TTS pronunciation, number extraction.

const SENTENCE_END = /[。！？!?；;…]/;
const CLAUSE_END = /[，,、：:]/;
const TRAILING = /[。！？!?；;…，,、：:\s]+$/u;

// Visible width: CJK and full-width chars count 1, ASCII counts 0.55 (proportional fonts).
export function visualLength(s) {
  let n = 0;
  for (const ch of s) n += /[\u0000-ÿ]/.test(ch) ? 0.55 : 1;
  return n;
}

// Approximate spoken syllables: numbers read longer than they look ("2024" → 4, "3500" → 4),
// Latin letters are spelled or blended, punctuation is silent. Used for speech-rate checks.
export function spokenLength(s) {
  let n = 0;
  for (const ch of s) n += /\d/.test(ch) ? 1.6 : /[A-Za-z]/.test(ch) ? 0.6 : /[\p{Script=Han}%]/u.test(ch) ? 1 : 0;
  return n;
}

// Split narration into caption lines; each line is also one TTS request,
// so its measured audio duration gives exact caption timing.
export function splitLines(text, maxChars = 24) {
  const lines = [];
  for (const sentence of chunk(text, SENTENCE_END)) {
    const pause = "sentence";
    if (visualLength(sentence) <= maxChars) { push(lines, sentence, pause); continue; }
    let cur = "";
    const clauses = chunk(sentence, CLAUSE_END);
    clauses.forEach((c, i) => {
      if (cur && visualLength(cur + c) > maxChars) { flushLong(lines, cur, maxChars, "clause"); cur = c; }
      else cur += c;
      if (i === clauses.length - 1) flushLong(lines, cur, maxChars, pause);
    });
  }
  return lines;
}

function chunk(text, re) {
  const out = [];
  let cur = "";
  for (const ch of text.replace(/\s*\n\s*/g, "")) {
    cur += ch;
    if (re.test(ch)) { out.push(cur); cur = ""; }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function push(lines, raw, pause) {
  const text = raw.replace(TRAILING, "").trim();
  if (text) lines.push({ text, pause });
}

// A clause longer than maxChars is cut at the last safe boundary (never inside a Latin word or number).
function flushLong(lines, s, maxChars, pause) {
  let rest = s;
  while (visualLength(rest.replace(TRAILING, "")) > maxChars) {
    const chars = [...rest];
    let cut = 0, w = 0;
    for (let i = 0; i < chars.length; i++) {
      w += visualLength(chars[i]);
      if (w > maxChars) break;
      const a = chars[i], b = chars[i + 1] ?? "";
      if (!(/[A-Za-z0-9.%]/.test(a) && /[A-Za-z0-9.%]/.test(b))) cut = i + 1;
    }
    if (cut === 0) cut = Math.max(1, Math.floor(chars.length / 2));
    push(lines, chars.slice(0, cut).join(""), "clause");
    rest = chars.slice(cut).join("");
  }
  push(lines, rest, pause);
}

const BUILTIN_RULES = [
  [/(\d+(?:\.\d+)?)\s*%/g, "百分之$1"],
  [/[×x](\d+(?:\.\d+)?)(?![A-Za-z])/g, "$1倍"],
  // Ranges only with a tilde/en dash or a spaced hyphen; "2024-06" (date) and "-3" (negative) keep their reading.
  [/(\d)\s*[~～–]\s*(\d)/g, "$1到$2"],
  [/(\d)\s+-\s+(\d)/g, "$1到$2"],
  [/——|—/g, "，"],
  [/\bvs\.?\b/gi, "对比"],
];

// Text sent to TTS; the caption keeps the written form.
export function speakable(text, lexicon = {}) {
  let s = text;
  const keys = Object.keys(lexicon).sort((a, b) => b.length - a.length);
  for (const k of keys) s = s.split(k).join(lexicon[k]);
  for (const [re, rep] of BUILTIN_RULES) s = s.replace(re, rep);
  return s;
}

// Numeric claims in narration ("1.85万亿", "36年", "百分之61" is not matched — write digits).
export function extractNumbers(text) {
  const re = /\d+(?:[.,]\d+)*\s*(?:万亿|亿|万|千|百|%|倍|年|月|日|美元|元)?/g;
  return [...text.matchAll(re)].map((m) => m[0].replace(/\s+/g, ""));
}

const MAGNITUDE = { 万亿: 1e12, 亿: 1e8, 万: 1e4, 千: 1e3, 百: 1e2 };

// "1,000美元" → { value: 1000, unit: "美元", amount: 1000 }; amount applies Chinese magnitude units.
export function parseNumber(token) {
  const m = token.replace(/\s+/g, "").match(/^(\d+(?:[.,]\d+)*)(.*)$/);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  return { value, unit: m[2], amount: value * (MAGNITUDE[m[2]] ?? 1) };
}

export const normalizeForMatch = (s) => s.replace(/[\s，,。！？!?；;、：:“”"'‘’（）()《》【】\-—…]/g, "");
