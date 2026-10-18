# AI 日程秘书（仓库 `my-day`，npm 包名 `ai-secretary`）

## 项目概览

「AI 日程秘书」是一个面向作者本人使用的单用户 Android 应用：以**专业可靠的 AI 秘书**为人设，帮你整理日常所有事情——随口说，它记住、抽待办、排优先级。核心闭环是**一天**：早上立计划，白天随时聊并抽出待办，晚上对照完成情况生成当日日记。

- 界面：Vue 3 + TypeScript + Vite，手机宽度。底栏三个入口（对话 / 待办 / 日记），设置在顶栏齿轮。视觉是「晨光浅色」（雾灰底 + 米白卡片 + 沉稳蓝），变量与规则都在 `src/styles.css`。
- 壳：Capacitor 7，仅 Android（`appId: com.aisecretary.app`，见 `capacitor.config.ts`），产物为可侧载的 APK，不上架
- 模型：DeepSeek 开放平台，OpenAI 兼容的 Chat Completions + Tool Calls，默认模型 `deepseek-v4-flash`（`src/types.ts` 里的 `DEFAULT_MODEL`）
- 数据全部在本机：聊天 / 待办 / 日记 / 事件 / 项目 / 等待 / 周报存 IndexedDB（单库 `ai-secretary`，**v2**，见 `src/storage/db.ts`）；设置（API Key、模型、早晚分割小时、语音 Key、「以后」栏折叠组）存 Capacitor Preferences（Web 端回退 localStorage，见 `src/storage/settings.ts`）
- 网络：DeepSeek 全平台裸 `fetch`（CORS 已放开）。`capacitor.config.ts` 关掉 `CapacitorHttp` 的 fetch patch——patch 会把响应缓冲完才返回，破坏 SSE 流式。`activePostJson()` 一律返回 fetch；`nativePostJson`（CapacitorHttp）只给百炼 ASR / TTS 在原生端 fetch 被 CORS 挡住时兜底。
- 提醒：`@capacitor/local-notifications`（官方插件，全本地不外发），规划逻辑在 `src/notify.ts`
- 语音：对话页顶部分段「文字对话 / 语音模式」。文字模式纯打字；切到语音模式即开麦会话，开口才录、停顿约 1 秒提交（VAD 在 `src/speech/vad.ts`；点 orb 可提前结束本句或打断朗读），阿里云百炼 `qwen3-asr-flash` 转写（`src/api/dashscope-asr.ts`，一次 POST，音频走 wav data URI；不走流式 WebSocket），同一条对话线程里出字；回复整句落库后用百炼 `qwen3-tts-flash` 合成（`src/api/dashscope-tts.ts`，音色 Cherry），`HTMLAudioElement` 播放（`src/speech/tts.ts`）。录音：WebView 内 MediaRecorder → 16k 单声道 WAV → base64（`src/speech/`）。凭证只留一个 `asrAppKey`（百炼 API Key，识别与朗读共用）存设置，空则回退 `DEFAULT_DEBUG_ASR_KEY`（`effectiveAsrKey`）。原生 Manifest 必须同时有 `RECORD_AUDIO` 和 `MODIFY_AUDIO_SETTINGS`（Capacitor 的 `onPermissionRequest` 会两个一起要，缺后者时系统已授权麦克风也会被当成整次拒绝）。WebView 权限弹窗由 Capacitor 7 `BridgeWebChromeClient` 处理，MainActivity 不用改

前身是「朝暮」（appId `com.zhaomu.app`）；底层标识已全部更换，新旧应用数据不互通。

## 构建与测试命令

```bash
npm run dev        # Vite 开发服务器（DeepSeek 已支持 CORS，浏览器也可直连真实 API）
npm run test       # vitest run（单元测试，一次性跑完；只跑 src/__tests__/）
npm run test:watch # vitest 监听模式
npm run eval:parse # 真实 API eval：跑 eval/**/*.test.ts（解析语料 + 回复语料 + 日记情绪层），需 DEEPSEEK_API_KEY，人工运行，不进 test
npm run build      # vue-tsc -b && vite build：先类型检查再打包到 dist/
npm run cap:sync   # build 之后 npx cap sync android，把 dist 同步进安卓工程
```

Android 打包：`npm run cap:sync` 后在 `android/` 下用 `./gradlew assembleDebug`（或 Android Studio）生成 APK。Gradle 工程在 `android/`，AGP 8.7.2，compile/targetSdk 35，Java 21。

构建时 `vite.config.ts` 通过 `define` 注入版本号（读 `package.json`）和构建时间戳（精确到秒），由 `src/build-info.ts` 暴露，设置页底部显示，用于确认手机上的包是不是最新构建。

推送到用户手机（无线调试 adb install）的完整流程见项目 skill `.kimi-code/skills/deploy-phone/`：adb 全路径、gradlew 必须带的 JAVA_HOME（Android Studio 内置 JBR）、mDNS 设备发现、安装后的时间戳核对。

改动类型相关代码后，至少跑 `npm run test` 和 `npm run build`（build 含 vue-tsc 类型检查，仓库无 lint 配置）。提交前跑 `npm run check:secrets`，确认跟踪文件里没有 Key。

## 代码组织

```
src/
  main.ts              入口：native 平台加 .native class、启动键盘 inset、挂载 App
  App.vue              根组件：三底栏 + 顶栏设置、Agent 装配（agentDeps）、跨日滚动、补日记、主动开场、
                       解析回复并行（runParseSide / lastParseResult / proposeTail）、
                       提醒重排（refreshReminders）、待办手动新增/编辑、点开通知切待办页
  styles.css           全局样式（晨光浅色）
  types.ts             全部共享类型（ChatMessage / Todo / DailyLog / WeeklyLog / Settings / DebugEntry ...）
  agent/
    loop.ts            回复循环：组装上下文 → 调模型（有 completeStream 时流式）→ 执行工具 → 回传，上限 4 次模型调用
    parse.ts           解析层：每条非 silent 输入过一次独立解析调用（与回复并行），输出 ParseResult；失败不阻塞对话
    route-parse.ts     解析产出路由：事实自动落库；tasks 一律出确认候选（不按置信度静默落库）
    parse-corpus.ts    解析语料（随口一说/真正待办的判断基准；偏好/目标类应为「不落库」）
    parse-eval.ts      语料打分（scoreCase，纯函数）
    reply-corpus.ts    回复侧语料（冒头不提议 / 答完才提议）
    reply-eval.ts      回复语料打分
    clarify.ts         引导问认法、归属窗口、进框前剥组
    tools.ts           回复循环工具定义：list_todos / set_today_plan / propose_todos
    context.ts         Context Builder：今天/以后/已完成 + 项目/等待 + 按上一轮解析选取的近期事件 + 历史截断 12 条
    prompt.ts          秘书人设系统提示词（极简、重点加粗）+ 早/晚主动开场 kickoff 文案 + 周报提示词（中文）
    compose-log.ts     晚：一次性调用生成 DailyLog（状态复盘 state + 情绪层 mood/cheer；今日计划对照只作为输入，不单列成段）
    compose-week.ts    周报：一次性调用聚合本周日记 + 待办完成情况生成 WeeklyLog
    compose-plan.ts    整理：一次性调用把待办重排成 today/later 两桶
    parse-json.ts      从模型输出里解析 JSON
  api/
    deepseek.ts        Chat Completions 客户端（chatCompletions 非流式 / chatCompletionsStream 流式 SSE）、ApiError、按状态码给用户文案
    sse.ts             增量 SSE 解析器（纯函数：任意切分 chunk → data 载荷，处理 [DONE] 与多行 data）
    post-json.ts       POST JSON：activePostJson = fetch；nativePostJson = CapacitorHttp，仅 ASR / TTS 原生兜底
    dashscope-asr.ts   百炼语音识别（qwen3-asr-flash，一次 POST 回全文）
    dashscope-tts.ts   百炼语音合成（qwen3-tts-flash，一次 POST 回 wav URL）
  storage/
    db.ts              IndexedDB 仓储（DB v2：v2 新增 weekly store）：chatRepo / todoRepo / logRepo / eventRepo / projectRepo / waitingRepo / weeklyRepo
    settings.ts        设置读写 + effectiveApiKey / effectiveAsrKey + 「以后」栏折叠组
  notify.ts            提醒规划纯函数：未完成带 due 待办（不限桶）+ 逾期早催 + 21:00 催日记 → ReminderSpec[]；Notifier 接口可注入
  notify-capacitor.ts  LocalNotifications 薄封装（原生=真实现，web/测试=no-op）；点开通知切待办页
  screens/             ChatScreen（文字/语音分段、流式气泡、语音连续对话）/ TodoScreen / DiaryScreen（含周报区）/ SettingsScreen（.vue）
  speech/              录音（recorder）/ 一句一停监听（listen）/ VAD / HTMLAudio 播放 / WAV 工具
  components/          DebugPanel / TodoConfirm / TodoDraftSheet（待办页新增/编辑） / TodoRow / GroupSheet / LogCard（可编辑）（.vue）
  debug/
    log.ts             屏幕可见的调试日志（debugLog），不写完整 API Key
    default-key.ts     本地调试回退（gitignore，可含 Key，禁止提交）
    default-key.example.ts  入库模板，两行必须是空字符串
  __tests__/           全部 vitest 用例 + setup.ts
  其余顶层模块          dates（含 weekKey/weekDates/weekdayLabel/dayNumLabel/monthLabel）/ ritual / todos / todos-filter / chat-session（含 shouldEveningGreet）/ diary /
                       ids / keys / keyboard-inset / todo-drag / build-info / rich-text /
                       norm（归一化）/ todo-meta（徽标文案、due 拆拼）/ todo-groups（以后栏分区）
                       （纯函数小工具多数有对应测试；入口/薄封装以屏幕级或间接覆盖为准）
eval/                  真实 API eval（`npm run eval:parse`，不进 npm test）：parse.eval.test.ts 解析语料、reply.eval.test.ts 回复语料、diary-mood.eval.test.ts 日记情绪层
android/               Capacitor 生成的原生工程
dist/                  构建产物（cap sync 的 webDir）
```

## 关键架构规则（改动时必须遵守）

- **数据分两层。** Timeline = `chats`（原始对话）+ `events`（结构化事实：event/decision），是事实来源；State = `todos` + `projects` + `waitings`（当前状态）。**不做长期记忆**：偏好/目标/感慨类输入不抽、不存，也不要重新加 memories store。
- **解析与回复并行。** `runTurn` 里 `runParseSide` 挂起不 await、`runAgent` 立即开始；解析调用不慢气泡，但 **tasks 出确认框要等本轮回复结束**。本轮回复还在问、且没有执行 `propose_todos` 时，解析 tasks 不弹框（事实/等待仍马上落库）。回复工具和「阶段」仍用 `isClarifyQuestion`（正文非空，且同时命中「像在提问」和短名单：拆/哪几步/哪摊/归属/切入/先定/先跑）。解析框另用更宽的 `replyStillAsking`：有 `？`/`?`，或出现「对吧 / 说清 / 要不要记」。解析（`parse.ts` 的 `parseInput`，独立一次模型调用，只输出 JSON；带最近 6 条对话做上下文）完成后才更新 `lastParseResult` 并走 `route-parse.ts` 分流：events/decisions/projects/waitings 自动落库；**tasks 一律进确认框**（`App.vue` 的 `onPropose`，确认前每条候选可展开「调整」改归属/截止/耗时/急），**不静默落库、没有自动记录提示条**。解析失败记 `parse_fail`，成功记 `parse_ok`（抽出的 tasks）。去重和标题合并记 `dedupe`（旧 → 新），还在问不弹框记 `todo_rejected` 并写明原因和候选标题。这些进屏幕调试日志，不写 API Key。对话照常。确认框与回复循环的 `propose_todos` 共用互斥队列 `proposeTail`。**弹框前按 `normKey` 过滤已记录待办；未完成标题一方包含另一方也丢掉，本批内互相包含留更长的那句**（仅 kind 为 later 时；today 计划框里的条目本来就在清单里不能整表滤）。整理结果在弹框前用同一包含关系并成一条，`applyFullPlan` 把写长的标题改回原条，不新插。滤完没有新候选就直接不弹框。回复循环：模型正文是引导问时 **不执行任何工具**，问句即本轮最终回复（`loop.ts`）；上下文注入「阶段」（答上一问 / 普通）。秘书人设带「先聊清楚再记」：一摊事刚冒头只问一句；只有用户拆出具体步骤或明确说记下来才提议。`project` 进框前必须能在本句+上一轮用户+上一轮秘书里对上，否则剥掉（`prepareLaterProposals`）。不要把新事塞进现有项目，除非用户亲口说了归属。秘书说话极简：默认一两句、最多三句，重点用 `**加粗**`。解析层同样：刚冒头的栏目/项目不是 task，`project` 只有用户点名归属才填。
- **回复循环不抽取，但可以提议。** loop 工具只有 `list_todos` / `set_today_plan` / `propose_todos`。不要加回 `suggest_order` 或其它排序工具。`propose_todos` 走确认框、确认后经 `addTodos` 落库进「以后」，并按 `normKey` 与未完成标题的包含关系跳过已有待办。硬规则：不得口头声称已记下，只能用工具提议（`prompt.ts`）。回复上下文由 `context.ts` 组装：项目/等待摘要 + 按**上一轮** ParseResult 动态选取的近期事件（`selectRelevantEvents`，首轮/纯闲聊不注入；本轮提到的事下一轮才进注入）+ 历史截断最近 12 条（`HISTORY_LIMIT`）。循环上限 `MAX_MODEL_CALLS = 4`。**回复轮流式输出**：`AgentDeps.completeStream` 存在时优先走 `chatCompletionsStream`（SSE 解析在 `src/api/sse.ts`，tool_calls 分片按 index 重组），`onReplyDelta` 把累积文本推到 ChatScreen 的流式气泡（不落库、不进消息数组，`runAgent` 返回后先撤气泡再追加正式消息）；工具轮/silent 轮无文本天然不出气泡。解析、整理、日记、周报等一次性调用仍非流式。请求显式带 `thinking: { type: "disabled" }`。
- **没有"帮你勾掉"的工具。** 勾选只发生在待办页；不要加回 `write_daily_log` 这类会在对话里写日记或改勾选的工具。
- 待办分两桶：`when: "today" | "later"`；字段缺失视为 today。分桶与快照逻辑集中在 `src/todos.ts`（`partitionTodos` / `applyTodayPlan` / `applyFullPlan`），标题去重忽略空白与大小写（统一入口 `src/norm.ts` 的 `normKey`，全仓库只此一份实现）。桶内手动顺序存 `Todo.order`（缺失按 `createdAt` 兜底），拖拽落点用 `applyMove` 一次性重写涉及桶的 order，仓储入口是 `todoRepo.move`。结构化字段 `priority` / `due` / `estimate`（分钟）/ `reason` / `projectId` 由解析层填充并落库，展示徽标用 `src/todo-meta.ts` 的 `todoMeta`（急/截止/约多久/项目，`isOverdue` 逾期标红）；对话上下文与 `list_todos` 工具结果里的待办摘要同样带这些属性（`context.ts` 的 `formatBucket`）。「以后」栏按项目分区展示（组 = 复用 `Project`，非真层级）：分区/进度/自动完成/组排序的纯函数在 `src/todo-groups.ts`（`partitionLater` / `syncProjectStatuses` / `applyProjectMove`），`applyMove` 的落点支持带 `projectId`（跨组拖拽即改归属）；组内最后一条勾掉组自动 done、来新任务自动回 active（`App.vue` 的 `syncProjects` 在所有任务变更点调用）。「以后」里 due 已过的未完成项用 `isOverdueLater` 提到今日栏「逾期」分区展示（不改 `when`）；今天桶隔夜留下的用 `isLeftover` 标。待办页可手动新增/编辑：FAB 或空态按钮打开 `TodoDraftSheet`（草稿类型 `TodoDraft`），经 `onAddTodo` / `onUpdateTodo` 走 `todoRepo.add` / `todoRepo.update`（`applyTodoPatch`），按 `normKey` 跳过未完成重复标题，不调模型。删除有短暂撤销。待办页「在等」区可点「等到了」。
- 一天按**本地日历日**（`src/dates.ts` 的 `localDate`）划分，不要用 UTC 日期。早/晚由 `daySplitHour`（默认 12）切分，见 `src/ritual.ts`。周报按 **ISO 周**（周一起、本地时区）划分，周键 `weekKey` / 周日期 `weekDates` 在 `src/dates.ts`。
- 确认今日计划后会关闭当前对话段（`chatRepo.closeSession`），旧消息进 `DayChat.archive`，日记仍读归档。
- 昨日日记每轮注入对话上下文（`runTurn` 里 `logRepo.get(昨天)` → `runAgent` 的 `yesterdayLog`）；当天对话完全空白时（`chat-session.ts` 的 `shouldGreet`）Agent 主动开场一次：按时段选文案——`shouldEveningGreet`（本地小时 ≥ 18 且当天还没日记）成立用 `EVENING_KICKOFF_TEXT`（对照早上计划逐条问进展），否则用 `KICKOFF_TEXT`；kickoff 文案只进 API 调用，不落用户气泡（`runTurn` 的 `silent` 选项，silent 轮跳过解析）。
- 日记页不只显示今天：`logs` 按日期存全部日记。上方是今天（缺失时 `diary-empty` 矮卡 + 底栏「整理成日记」；已有则底栏「重新整理」）。今天和历史共用 `LogCard`：日期、星期、情绪、正文在同一张卡里，没有日期条和 `bare` 拆法。历史按月分组，默认收起仍露出报头和两行摘要，点开后寄语和编辑在同一张卡里出现（可多开）。周报夹在今天和历史之间：未生成显示「生成本周周报」；已生成进页默认只显示本周区间，点开才见三段正文 + 重新生成；刚生成/重新生成会自动展开（`compose-week.ts` 聚合本周日记 + 待办完成情况落 `weeklyRepo`）。日记可编辑：`LogCard` 编辑模式只改模型写的文字（state/mood/cheer），保存经 App 侧 `logRepo.put` 落库并刷新双区。数据由 App 侧 `refreshPastLogs`（`logRepo.list()` 排除今天）在启动、跨日、补日记成功后刷新。
- **本地通知提醒**：`src/notify.ts` 的 `planReminders` 纯函数输出 ReminderSpec[]——所有未完成且带 due 的待办（不限桶）：未来 due 带时间到点（文案「该办了」）、纯日期当天 9:00；已逾期且当天 9:00 未过再催一次（「已逾期」）；今天没日记时 21:00 催日记。调度策略是先 `cancelAll` 再全量 `schedule`（`rescheduleReminders`），有东西要挂才懒请求权限，拒绝/失败只记 debug（`DebugEvent` 有 `"notify"`）。点开通知切到待办页（`listenNotificationOpen`）。重排时机：启动、今日计划确认、`syncProjects`（所有任务变更汇聚点）、跨日、日记写完（撤掉当晚催日记）。非原生平台 no-op。
- 数据存储就用 IndexedDB + Capacitor Preferences 这两套，不要新加 SQLite 或本地文件存储。不要引入会外发数据的第三方服务（含 Google Fonts 这类远程字体）。

## 代码风格

- TypeScript strict 模式，ES 模块，`@/` 别名指向 `src/`（vite、vitest、tsconfig 三处都已配）。
- Vue 单文件组件用 `<script setup lang="ts">`。
- 注释、提交信息、面向用户的文案（包括错误提示和模型提示词）都用**中文**。
- 业务规则尽量写成不依赖框架的纯函数（如 `todos.ts`、`ritual.ts`、`chat-session.ts`、`notify.ts`），UI / 存储 / 网络只做薄封装，方便直接单测。
- 副作用可注入：仓储、网络、时间都通过参数传入（如 `AgentDeps`、`Prefs`、`PostJson`、`Notifier`），测试里替换。

## 测试

- 框架：vitest + happy-dom + @vue/test-utils（见 `vitest.config.ts`）；`src/__tests__/setup.ts` 引入 `fake-indexeddb/auto`，所以仓储层（IndexedDB）可以在测试里直接用真实现。
- 用例全部在 `src/__tests__/`，命名 `*.test.ts`，与被测模块同名（如 `todos.test.ts` ↔ `todos.ts`）。
- 测试里通过注入假的 `complete` / `completeStream` / `postJson` / `now` / `Notifier` 来驱动，不打真实网络。App 级用例 mock `@/api/deepseek` 时**必须同时 mock `chatCompletions` 与 `chatCompletionsStream`**（回复轮有 completeStream 时走后者，漏 mock 会打到真实 fetch）：其参数是 `{ apiKey, request, postJson }` 包装，解析调用（`tools: []`）与回复调用（带工具）按此区分；`beforeEach` 垫一条消息可避免主动开场抢 `awaiting`。
- 新增或修改业务规则时，同步更新对应测试；UI 变更优先考虑屏幕级测试（如 `chat-screen.test.ts`、`todos-screen.test.ts`）。待办页手动新增/编辑对应 `app-add-todo.test.ts`；提醒对应 `notify.test.ts` / `notify-app.test.ts`（mock `@/notify-capacitor` 时 `listenNotificationOpen` 必须返回卸载函数）。
- 解析判断的稳定性由语料保证：`src/agent/parse-corpus.ts` 是基准，`parse-corpus.test.ts` 验完整性（进 `npm run test`），`eval/parse.eval.test.ts` 用真实 API 打分（人工跑，模型可用 `EVAL_MODEL` 环境变量覆盖）。回复侧同理：`reply-corpus.ts` + `reply-corpus.test.ts` + `eval/reply.eval.test.ts`。`eval/diary-mood.eval.test.ts` 打日记情绪层。三条 eval 都走 `npm run eval:parse`。

## 安全注意事项

- **仓库不包含 API Key。** `src/debug/default-key.example.ts` 两行都是空字符串。本机调试回退是 `src/debug/default-key.ts`，已在 `.gitignore` 中；缺文件时 `scripts/ensure-debug-key.mjs`（`npm install` / `dev` / `test` / `build` 之前）会从模板复制一份空文件。这个文件可以填 Key，但不要 `git add -f`，不要把 Key 抄进其它文件、文档、日志或提交说明。`npm run check:secrets` 扫已跟踪文件。
- 写进 `default-key.ts` 的 Key 会被 Vite 打进 `dist/` 和调试 APK。这些产物已忽略。不要把 `dist/`、`android/app/src/main/assets/public` 或 APK 发给别人，也不要强行提交。
- 给日常使用的 Key 写在应用设置里，只存本机（Capacitor Preferences，浏览器回退 localStorage）。
- 任何日志（包括屏幕 Debug 面板）只能显示掩码后的 Key（`src/keys.ts` 的 `maskKey`，最多前 4 位），绝不打全文。
- 对话发往 `https://api.deepseek.com`，语音识别和朗读发往 `https://dashscope.aliyuncs.com`；不要引入会外发数据的第三方服务。
