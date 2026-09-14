# 语音模式云端朗读（互相说话）

日期：2026-09-14  
状态：已与用户对齐，待实现

## 问题

语音模式已经能：开口录音 → 百炼识别 → 同一条对话线程出字。回复落库后会调用 `src/speech/tts.ts` 的 `speak()`，界面也会进入「秘书在说」。

但朗读走的是浏览器 `window.speechSynthesis`。Android WebView（本应用 APK）上这个接口经常是空响：调用成功、文字已出现，喇叭没有声音。仓库里没有原生 TTS 插件。

用户要的是互相说话：我说完，秘书把那句话说出来。

## 目标

语音模式下，秘书回复写完后用百炼 `qwen3-tts-flash` 合成中文语音，用网页 `Audio` 播放（WebView 里能出声）。播完再听下一句；点一下可打断。

文字模式仍然只打字、不朗读。

## 非目标

- 边出字边按句合成，或 WebSocket 实时 TTS
- 原生 Android TTS 插件，或混用 `speechSynthesis` 作回退（两种声音会打架；系统接口在真机上不可靠）
- 设置页选音色、语速、音量
- 文字模式朗读
- 改听/识别/流式出字/确认框/日记/待办

## 用户可见行为

一轮语音对话：

1. 开口，停顿约 1 秒，识别成字，发出去（现有）
2. 气泡里秘书的字照旧流式出现（现有）
3. 整句写完并落库后：去掉 `**加粗**` 等标记，送百炼合成，喇叭播放
4. 播完自动再听；点圆形按钮打断，立刻开始听

边界：

- 只在语音模式出声。切回文字、离开对话页，马上停播并 abort 合成请求
- 同一句只读一次（沿用现有 `spokenId`）
- 确认待办框出现时不抢麦；若这句还没读，可以边看着确认框边听它说完
- 合成或播放失败：字已在屏幕上，不弹红字、不卡住循环，跳过出声继续听
- 识别失败仍按现有文案提示（那是用户这句没送出去）
- 不新加设置项。仍用同一个百炼 Key（`asrAppKey` / `effectiveAsrKey`）
- 音色固定 Cherry。设置页文案「语音识别 API Key」改为「语音 API Key」

## 架构

三层，和识别同一套路：屏幕不管 Key、不管 HTTP。

```
回复写完 → strip 标记 → 百炼合成（URL） → Audio 播放 → 播完/打断 → 再听
```

### 1. `src/api/dashscope-tts.ts`（新）

一次 HTTPS POST，非流式。

- URL：`https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- 模型：`qwen3-tts-flash`
- Header：`Authorization: Bearer <effectiveAsrKey>`，与识别相同
- Body：

```json
{
  "model": "qwen3-tts-flash",
  "input": {
    "text": "<纯文本>",
    "voice": "Cherry",
    "language_type": "Chinese"
  }
}
```

- 成功：从 `output.audio.url` 取出 wav 地址（文档有效期 24 小时，本应用拿来马上播，不缓存）
- 默认用 `fetch`（可传 `AbortSignal`）。`status === 0` 且原生平台、调用方未注入 `postJson` 时，退到 `nativePostJson`（与识别相同）。测试注入 `postJson` 时不走 abortable fetch
- 空 Key、非 200、没有 url：抛中文错误，由 `speakReply` 吞掉。截断 500 字在 `speakReply` 里做，本模块按传入文本原样发送

### 2. `src/speech/tts.ts`（只负责播放，不发 HTTP）

不再调用 `speechSynthesis`。

- 保留 `stripForSpeech`（去 `**加粗**`、标题符、换行变句号）
- 新增 `playAudio(url, signal)`：若 URL 以 `http://` 开头则改成 `https://`，用 `HTMLAudioElement` 播放；`ended` / `error` / abort 时结束。失败或取消都 resolve，不抛
- `cancelSpeech` 改为暂停并清空当前 Audio
- 导出 `warmupAudio()`：创建并 muted 播放一段极短静音 data URI，成功后 unmute。`ChatScreen` 在进入语音模式的点击路径里（`runVoiceSession` 开头、麦克风手势还在时）调用一次；后续 `playAudio` 复用这个元素。预热失败忽略，不挡进语音模式

### 3. 装配

职责分开，和识别平行：

- `dashscope-tts.ts`：只合成，返回 url
- `tts.ts`：只播放
- `App.vue` 注入 `speakReply(text, signal)`：`stripForSpeech` → 截断 500 字 → `synthesizeSpeech`（`effectiveAsrKey`）→ `playAudio`。失败记 `debugLog`（`http_fail`，`tts: …`，Key 掩码），然后 resolve，不抛给界面
- `ChatScreen` 的 `speakLatest` 改为调 `speakReply`，不再 import 合成或系统朗读。没有 `speakReply` 时跳过出声
- 打断：`speakLatest` 现有的 `AbortSignal` 同时交给合成 fetch 和 `playAudio`

`PostJson` 类型不改（没有 signal）。合成默认走 `fetch`+`AbortSignal`；测试可注入 `postJson`，调用前后若已 abort 则丢弃结果。原生 CORS 回退仍用 `nativePostJson`（打断后若请求已发出，播放前检查 abort，不播）。

`asrAppKey` 字段名不改，避免设置迁移。注释和设置页文案改为「识别与朗读共用」。

## 失败处理

| 情况 | 行为 |
| --- | --- |
| 无语音 Key | 进不了听（现有）；提示改为「还没配置语音凭证，去设置页填一下」 |
| 合成网络不通 / HTTP 非 200 / 无 url | 跳过出声，继续听；Debug 记 `http_fail`（`tts: …`，Key 掩码） |
| `Audio.play()` 被拒或解码失败 | 同上，跳过出声继续听 |
| 点打断 / 切文字 / 卸载 | abort 合成，立刻停播 |
| 回复超过 500 字 | 只合成前 500 字 |

识别错误路径不变。

## 测试

不打真实百炼。注入 `postJson` 和假 `Audio`。

- `src/__tests__/dashscope-tts.test.ts`（新）：北京 multimodal 地址、模型、`Cherry` + `Chinese`、成功返回 url、空 Key、网络不通（status 0）、HTTP 错误、响应没有音频
- `src/__tests__/tts.test.ts`（改）：`stripForSpeech` 保持；http→https；播完结束；abort 停播；播放失败也 resolve；不再断言 `speechSynthesis`
- `src/__tests__/chat-screen.test.ts`：回复完成后调用 `speakReply`；`speakReply` 失败不出现识别那种红字，循环可继续
- `src/__tests__/settings-screen.test.ts`：文案为「语音 API Key」

验证：`npm run test` 与 `npm run build`。

## 文档

- `AGENTS.md` 语音段：朗读改为百炼 `qwen3-tts-flash` + `Audio` 播放，不再写系统 TTS / `speechSynthesis`
- `README.md` 若仍写系统朗读，同步改一句

不把 Key 写入文档或日志全文。

## 实现顺序

1. `dashscope-tts.ts` + 单测
2. 改 `tts.ts` 播放 + 单测
3. `App.vue` / `ChatScreen` 注入与循环；设置页文案
4. 更新文档
5. `npm run test` 与 `npm run build`
