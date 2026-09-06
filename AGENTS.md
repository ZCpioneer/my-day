# 朝暮（仓库 `my-day`，npm 包名 `zhaomu`）

## 项目概览

「朝暮」是一个面向作者本人使用的单用户 Android 应用：日志 + Todo + 思维整理 Agent。核心闭环是**一天**：早上（朝）立计划，白天随时聊并抽出待办，晚上（暮）对照完成情况生成当日日记。

- 界面：Vue 3 + TypeScript + Vite，手机宽度，四个底栏入口（对话 / 待办 / 日记 / 设置）
- 壳：Capacitor 7，仅 Android（`appId: com.zhaomu.app`，见 `capacitor.config.ts`），产物为可侧载的 APK，不上架
- 模型：DeepSeek 开放平台，OpenAI 兼容的 Chat Completions + Tool Calls，默认模型 `deepseek-v4-flash`（`src/types.ts` 里的 `DEFAULT_MODEL`）
- 数据全部在本机：聊天 / 待办 / 日记存 IndexedDB（单库 `zhaomu`，见 `src/storage/db.ts`）；设置（API Key、模型、调试开关、朝暮分割小时）存 Capacitor Preferences（Web 端回退 localStorage，见 `src/storage/settings.ts`）
- 网络：原生端必须走 `CapacitorHttp`（`capacitor.config.ts` 已启用；浏览器 `fetch` 直连 `api.deepseek.com` 会跨域失败），由 `src/api/post-json.ts` 的 `activePostJson()` 按平台选择

设计文档在 `docs/superpowers/specs/`（主设计：`2026-09-05-my-day-design.md`），实现计划在 `docs/superpowers/plans/`。UI 静态示意在 `demo/index.html`。

## 构建与测试命令

```bash
npm run dev        # Vite 开发服务器（浏览器调试，fetch 会被 DeepSeek 跨域挡住，属预期）
npm run test       # vitest run（单元测试，一次性跑完）
npm run test:watch # vitest 监听模式
npm run build      # vue-tsc -b && vite build：先类型检查再打包到 dist/
npm run cap:sync   # build 之后 npx cap sync android，把 dist 同步进安卓工程
```

Android 打包：`npm run cap:sync` 后在 `android/` 下用 `./gradlew assembleDebug`（或 Android Studio）生成 APK。Gradle 工程在 `android/`，AGP 8.7.2。

构建时 `vite.config.ts` 通过 `define` 注入版本号（读 `package.json`）和构建时间戳（精确到秒），由 `src/build-info.ts` 暴露，设置页底部显示，用于确认手机上的包是不是最新构建。

推送到用户手机（无线调试 adb install）的完整流程见项目 skill `.kimi-code/skills/deploy-phone/`：adb 全路径、gradlew 必须带的 JAVA_HOME（Android Studio 内置 JBR）、mDNS 设备发现、安装后的时间戳核对。

改动类型相关代码后，至少跑 `npm run test` 和 `npm run build`（build 含 vue-tsc 类型检查，仓库无 lint 配置）。

## 代码组织

```
src/
  main.ts              入口：native 平台加 .native class、启动键盘 inset、挂载 App
  App.vue              根组件：四个 tab、Agent 装配（agentDeps）、跨日滚动、补日记、主动开场
  styles.css           全局样式
  types.ts             全部共享类型（ChatMessage / Todo / DailyLog / Settings / DebugEntry ...）
  agent/
    loop.ts            单 Agent 循环：组装上下文 → 调模型 → 执行工具 → 回传，上限 4 次模型调用
    tools.ts           工具定义：list_todos / propose_todos / set_today_plan / suggest_order
    context.ts         拼发给模型的上下文消息（日期、时刻、模式、昨日日记、待办分桶、历史）
    prompt.ts          系统提示词 + 主动开场 kickoff 文案（中文）
    compose-log.ts     暮：一次性调用生成 DailyLog（不走工具循环）
    compose-plan.ts    整理：一次性调用把待办重排成 today/later 两桶
    parse-json.ts      从模型输出里解析 JSON
  api/
    deepseek.ts        Chat Completions 客户端、ApiError、按状态码给用户文案
    post-json.ts       POST JSON 的平台抽象（CapacitorHttp / fetch）
  storage/
    db.ts              IndexedDB 仓储：chatRepo / todoRepo / logRepo（store：chats/todos/logs）
    settings.ts        设置读写 + effectiveApiKey
  screens/             ChatScreen / TodoScreen / DiaryScreen / SettingsScreen（.vue）
  components/          DebugPanel / RitualBar / TodoConfirm / TodoRow（.vue）
  debug/
    log.ts             屏幕可见的调试日志（debugLog），不写完整 API Key
    default-key.ts     内置默认调试 Key（被 .gitignore 忽略），见「安全注意事项」
    default-key.example.ts  入库的模板文件
  __tests__/           全部 vitest 用例 + setup.ts
  其余顶层模块          dates / ritual / todos / todos-filter / chat-session / diary /
                       ids / keys / keyboard-inset / todo-drag / build-info / rich-text
                       （纯函数小工具，均有对应测试）
docs/superpowers/      specs/（设计）与 plans/（实现计划）
.superpowers/sdd/      子代理驱动开发的任务简报、报告与评审 diff（历史过程文件，不参与构建）
demo/                  静态 UI 示意，非真实功能
android/               Capacitor 生成的原生工程
dist/                  构建产物（cap sync 的 webDir）
```

## 关键架构规则（改动时必须遵守）

- **Agent 永远不直接写待办。** 模型只能调 `propose_todos` / `set_today_plan`，UI 弹确认框（`onPropose` 返回 Promise），用户确认后才落库。循环上限 `MAX_MODEL_CALLS = 4`。
- **没有"帮你勾掉"的工具。** 勾选只发生在待办页；`write_daily_log` 这类工具已被有意移除（见 `src/__tests__/loop.test.ts` 的对应用例）。
- 待办分两桶：`when: "today" | "later"`；字段缺失视为 today（兼容旧数据）。分桶与快照逻辑集中在 `src/todos.ts`（`partitionTodos` / `applyTodayPlan` / `applyFullPlan`），标题去重忽略空白与大小写。桶内手动顺序存 `Todo.order`（缺失按 `createdAt` 兜底），拖拽落点用 `applyMove` 一次性重写涉及桶的 order，仓储入口是 `todoRepo.move`。
- 一天按**本地日历日**（`src/dates.ts` 的 `localDate`）划分，不要用 UTC 日期。朝/暮由 `daySplitHour`（默认 12）切分，见 `src/ritual.ts`。
- 确认今日计划后会关闭当前对话段（`chatRepo.closeSession`），旧消息进 `DayChat.archive`，日记仍读归档。
- 昨日日记每轮注入对话上下文（`runTurn` 里 `logRepo.get(昨天)` → `runAgent` 的 `yesterdayLog`）；当天对话完全空白时（`chat-session.ts` 的 `shouldGreet`）Agent 主动开场一次：kickoff 文案 `KICKOFF_TEXT` 只进 API 调用，不落用户气泡（`runTurn` 的 `silent` 选项）。
- API 请求**非流式**，且显式带 `thinking: { type: "disabled" }`。
- 数据存储就用 IndexedDB + Capacitor Preferences 这两套，不要新加 SQLite 或本地文件存储。

## 代码风格

- TypeScript strict 模式，ES 模块，`@/` 别名指向 `src/`（vite、vitest、tsconfig 三处都已配）。
- Vue 单文件组件用 `<script setup lang="ts">`。
- 注释、提交信息、面向用户的文案（包括错误提示和模型提示词）都用**中文**。
- 业务规则尽量写成不依赖框架的纯函数（如 `todos.ts`、`ritual.ts`、`chat-session.ts`），UI / 存储 / 网络只做薄封装，方便直接单测。
- 副作用可注入：仓储、网络、时间都通过参数传入（如 `AgentDeps`、`Prefs`、`PostJson`），测试里替换。

## 测试

- 框架：vitest + happy-dom + @vue/test-utils（见 `vitest.config.ts`）；`src/__tests__/setup.ts` 引入 `fake-indexeddb/auto`，所以仓储层（IndexedDB）可以在测试里直接用真实现。
- 用例全部在 `src/__tests__/`，命名 `*.test.ts`，与被测模块同名（如 `todos.test.ts` ↔ `todos.ts`）。
- 测试里通过注入假的 `complete` / `postJson` / `now` 来驱动，不打真实网络。
- 新增或修改业务规则时，同步更新对应测试；UI 变更优先考虑屏幕级测试（如 `chat-screen.test.ts`、`todos-screen.test.ts`）。
- 当前基线：28 个测试文件、124 个用例全部通过（`npm run test`）。

## 安全注意事项

- **`src/debug/default-key.ts` 含一把真实的默认调试 API Key，文件头标注 `DEBUG ONLY，正式发布前删除`。** 该文件在 `.gitignore` 中（入库的是模板 `default-key.example.ts`）——不要 `git add` 它，不要把 Key 复制进其他文件、文档或日志。
- 任何日志（包括屏幕 Debug 面板）只能显示掩码后的 Key（`src/keys.ts` 的 `maskKey`，最多前 4 位），绝不打全文。
- 用户 Key 只存本机（Capacitor Preferences），只发往 `https://api.deepseek.com`；不要引入会外发数据的第三方服务。
- 正式发布前必须删除默认 Key，改为强制用户自备。
