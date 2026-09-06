# 结构化记忆架构设计（解析层 + Timeline/State/Memory + Context Builder）

日期：2026-09-06
状态：已实现，同日修订：**长期记忆（Memory 层）整体下线**——定位收敛为「当天的整理秘书」，偏好/目标/感慨类输入不抽不存。`memories` store 保留占位（v2 已发布），解析契约、路由、确认框、设置页、上下文中的 memory 相关部分均已移除；语料中偏好/目标类用例的正确结果改为「不落任何库」。下文中 Memory 相关章节仅作历史记录。
实现计划：`docs/superpowers/plans/2026-09-06-structured-memory.md`
产品名：朝暮（仓库 `my-day`）

## 0. 背景与目标

V0 的 Agent 是「整段聊天记录 + 待办快照」直接喂模型，信息没有结构：说过的事、要做的任务、等项目进展、长期偏好全混在对话流里，检索和更新都不稳。

本次改造把 Agent 的核心从「依赖聊天记录」改为「先解析、再分层落库、按需组装」：

1. 每条用户输入先经**独立解析调用**拆成结构化信息：Event（发生了什么）、Task（待办）、Project（项目进展）、Waiting（等待回复）、Decision（已做决定），外加 Memory 候选（长期记忆）。
2. 数据分三层：**Timeline**（原始对话 + 结构化事实，事实来源）、**State**（当前状态：待办、进行中的项目、等待中）、**Memory**（长期影响行为的信息：稳定偏好、长期目标、持续关注）。
3. 回复前由 **Context Builder** 按当前输入动态组装上下文，不再整段历史全量注入。
4. 待办与记忆的写入保留 **Human-in-the-loop**：用户确认后才落库。

### 非目标

- 不做多 Agent、不做向量检索/embedding、不做知识图谱。
- 不新增底栏 tab；State 层先只喂上下文和待办页露出。
- 存储仍是 IndexedDB + Capacitor Preferences，不加 SQLite/文件存储。
- 解析与回复均走现有 `deepseek` 客户端，非流式、`thinking: disabled`。

## 1. 数据模型

### Timeline 层

`chats` store 保留原样（原始对话，含归档机制）。

新增 `events` store（keyPath `id`）：

```ts
interface TimelineEvent {
  id: string;
  date: string;              // 本地日历日
  createdAt: string;
  kind: "event" | "decision";
  text: string;              // 一句事实
  fromMessageId: string;     // 溯源到原始消息
}
```

### State 层

`Todo` 扩展（三个字段全部可选，缺失走兜底，旧数据行为不变）：

```ts
interface Todo {
  // ...现有字段不变
  priority?: "high" | "normal";   // 缺失 = normal
  due?: string;                   // ISO 日期或日期时间
  projectId?: string;
}
```

新增 `projects` store（keyPath `id`）：

```ts
interface Project {
  id: string;
  title: string;
  status: "active" | "done" | "paused";
  note?: string;             // 最近进展
  createdAt: string;
  updatedAt: string;
}
```

新增 `waitings` store（keyPath `id`）：

```ts
interface Waiting {
  id: string;
  text: string;              // 在等什么
  waitingOn?: string;        // 等谁/等什么条件
  since: string;
  resolvedAt?: string;       // 有值 = 已解决
  fromMessageId: string;
}
```

### Memory 层

新增 `memories` store（keyPath `id`）：

```ts
interface Memory {
  id: string;
  text: string;
  kind: "preference" | "goal" | "watch";   // 稳定偏好 / 长期目标 / 持续关注
  createdAt: string;
}
```

### DB 迁移

`DB_VERSION` 1 → 2，`onupgradeneeded` 增量补建 `events` / `projects` / `waitings` / `memories` 四个 store（现有三个 store 不动）。旧版本升上来不丢数据；新字段全部可选，读取侧用纯函数兜底。

新仓储（与现有 chatRepo/todoRepo/logRepo 同风格，薄封装）：

- `eventRepo.add / listRecent(days)` — Timeline 事实，按日期倒序限量。
- `projectRepo.list / upsertByTitle(title, patch)` — 按归一化标题（忽略空白与大小写，同 `todos.ts` 的 norm）匹配，存在则更新 `note`/`updatedAt`/`status`，不存在则新建。
- `waitingRepo.add / listOpen / resolve(id)`。
- `memoryRepo.add / list / remove`（硬删）。

## 2. 解析管道（`src/agent/parse.ts`）

每条**非 silent** 的用户消息，在回复循环之前先跑一次独立解析调用。

### 输入

- 本条用户输入文本；
- 轻量上下文：今日日期、现有项目标题列表、现有待办标题列表（供关联与去重判断）；
- **不放聊天历史**——解析只针对当前这句话，历史已由过去的解析处理过。

### 输出契约

要求模型只输出一个 JSON 对象（复用 `parse-json.ts` 的 `parseJsonObject` 容错解析）：

```ts
interface ParsedTask {
  title: string;
  reason?: string;
  priority?: "high" | "normal";
  due?: string;          // ISO，模型按今日日期推算
  project?: string;      // 项目标题（优先从现有项目里选）
}

interface ParseResult {
  events: string[];
  decisions: string[];
  tasks: ParsedTask[];
  projectUpdates: { project: string; note: string; status?: "active" | "done" | "paused" }[];
  waitings: { text: string; waitingOn?: string }[];
  waitingsResolved: string[];   // 按文本匹配已解决的等待（P2 启用闭环）
  memories: { text: string; kind: "preference" | "goal" | "watch" }[];
}
```

六类全空 = 纯闲聊。`asParseResult(raw)` 做逐字段校验与兜底：非法条目丢弃，绝不抛异常。

### 判定规则（写进解析提示词，同时是测试语料的分类标准）

**随口一说 ≠ 真正待办**。以下都不是 task：

- 愿望与假设：「好想去看海」「要是有空真想学吉他」；
- 吐槽与情绪：「今天累死了」；
- 已经发生、无需行动的事：「中午吃了螺蛳粉」（是 event）；
- 别人的事：「我同事要跳槽了」（是 event）。

只有**用户自己要采取的行动**才是 task：「明天下午三点前交稿」「记得给妈妈回电话」。

**短期任务 ≠ 长期记忆**。进 Memory 的只有三种：

- 稳定偏好（preference）：「我早上不开会」「以后都想先写代码再回消息」；
- 长期目标（goal）：「今年写完初稿」「年底瘦五公斤」；
- 持续关注（watch）：「留意膝盖恢复」「盯着房价」。

判定口诀：**一个月后它还会影响给用户的建议吗？** 会 → memory 候选；不会 → 归 Timeline 或 State。单次事件、具体任务、临时状态一律不进 Memory。

### 失败兜底

解析调用失败（网络断、JSON 无法解析）只记 debug 面板（新事件 `parse_fail`），返回全空 ParseResult，对话照常进入回复循环。**解析永远不阻塞回复。**

## 3. 落库路由与确认流

解析结果的六个去向（`src/agent/route-parse.ts`，纯函数 + 注入仓储）：

| 解析产出 | 去向 | 是否确认 |
|---|---|---|
| events / decisions | `eventRepo.add`（Timeline） | 自动 |
| projectUpdates | `projectRepo.upsertByTitle`（State） | 自动 |
| waitings | `waitingRepo.add`（State） | 自动 |
| waitingsResolved | `waitingRepo.resolve`（P2） | 自动 |
| tasks | 确认框 → `todoRepo`（State） | **确认** |
| memories | 确认框 → `memoryRepo`（Memory） | **确认** |

tasks 落库前过 `filterProposedTodos` 同款去重（忽略空白与大小写，对现有待办标题去重）。tasks 一律进「以后」桶（`when: "later"`）——「今天做什么」由朝仪式的 `set_today_plan` 管理，解析层只负责捕获；`due`/`priority`/`projectId` 随确认写入。`project` 标题在落库时匹配现有项目（含本次 projectUpdates 新建的），匹配不上就不关联，不隐式建项目。

确认框复用 `TodoConfirm`：tasks 展示标题 + 优先级/截止/项目徽标；memories 换文案（「这句要记进长期记忆吗？」+ 类别标签），逐条勾选，全部不选 = 这次不记。两类确认在同一轮内串行弹出（先 tasks 后 memories）。

### 一轮对话的完整数据流

```
用户输入
 → 原始消息落 chats（拿到 messageId）
 → parse（1 次模型调用；silent 轮跳过）
 → 自动落库：events/decisions、projectUpdates、waitings
 → 确认：tasks → todos；memories 候选 → memories
 → Context Builder 组装 → 回复循环 → 助手消息落 chats
```

## 4. 回复循环与工具调整

`src/agent/loop.ts` 与 `tools.ts`：

- **移除 `propose_todos`**：抽取职责归解析层，loop 不再自己提议新待办。
- **移除 `suggest_order`**：只记对话不落库，无实际效果。
- 保留 `list_todos`（模型自查）与 `set_today_plan`（定今日计划是重排，不是抽取；确认流不变）。
- 系统提示词改写：说明「新事项由系统自动解析并弹确认框」，loop 职责收敛为回复 + 计划重排。

## 5. Context Builder（`src/agent/context.ts`）

**P1（增量版）**：现有事实块结构不变，追加三块 State/Memory 摘要——进行中项目（标题+最近进展）、等待中事项、全部记忆（逐条）；聊天历史从全量改为**当前会话段最近 12 条**（事实已被解析层抽走，历史只负责语气与连贯）。

**P2（动态组装版）**：按本条 ParseResult 动态选取——

- 解析关联到项目 X → 注入 X 的进展与近期相关 events（按标题词匹配，纯函数 `matchProject`）；
- 解析产出 task/waiting → 注入对应桶的现状（已有）；
- 纯闲聊 → 最少注入（日期时刻 + 记忆 + 待办分桶）；
- 近期 events 摘要默认带最近 3 天、每天最多 10 条。

## 6. 界面

- **待办页**：TodoRow 展示 priority（「急」标）、due（日期标签）、项目名。不加编辑 UI。
- **设置页（P2）**：「长期记忆」区块，列出全部记忆（类别 + 文本），可逐条删除。
- 确认框改动见第 3 节。不加新底栏 tab。

## 7. 错误处理

- 解析失败：debug 记 `parse_fail`，返回空结果，流程继续。
- 确认框挂起时收到新消息：现有 `awaiting` 串行化已挡住（runTurn 在 awaiting 时直接 return），流程不变。
- DB 升级失败/旧数据：新字段全可选，读取兜底；迁移只加 store 不改旧数据。

## 8. 测试体系

### 语料库（`src/agent/parse-corpus.ts`）

结构化语料数据文件：`{ input, expect: { tasks?, notTasks?, events?, memories?, notMemories?, waitings?, decisions? } }[]`。首批 ≥ 20 条，覆盖两类核心区分：

- 「随口一说 vs 真正待办」：愿望/假设/吐槽/过去式/别人的事 vs 明确行动；
- 「短期任务 vs 长期记忆」：一次性任务 vs 稳定偏好/长期目标/持续关注；
- 边界案例：「明天记得交稿」（task+due）、「他说下周给我答复」（waiting）、「定了，就用 Postgres」（decision）、「项目联调完了」（projectUpdate+event）。

语料被两类消费者共用：

1. **mock 单测**（进 `npm run test`）：注入假 `complete` 返回构造的 ParseResult JSON，验证解析校验、落库路由、去重、确认流、字段兜底——测管道接线的确定性。
2. **eval 脚本**（P2，`npm run eval:parse`，人工运行、打真实 API、不进 `test`）：用同一语料验证真实模型判断的通过率。

### 分层测试

- `parse.test.ts`：ParseResult 校验兜底、提示词包含判定规则、失败不抛。
- `route-parse.test.ts`：六类产出各自去向、tasks/memories 不进库只进确认、项目按标题归一化匹配。
- `db.test.ts` 扩展：v1→v2 迁移保留旧数据、四个新仓储 CRUD。
- `loop.test.ts` 更新：`propose_todos`/`suggest_order` 已移除；`list_todos`/`set_today_plan` 保留。
- `context.test.ts` 更新：三块新摘要注入、历史截断 12 条。
- 屏幕级：chat 流程里解析 → 确认 → 落库（chat-screen 测试扩展）。

## 9. 分期

### P1（核心，本次实现）

types 扩展 → db v2 + 四个仓储 → 解析管道 + 语料库 → 落库路由 → 确认框扩展与 App.vue 接线 → loop 工具精简 + 提示词改写 → Context Builder P1 增量版（三块摘要 + 历史截断）→ 待办页字段露出 → 全部测试。

### P2（整合）

Context Builder 动态组装 → 设置页记忆管理 → waitingsResolved 解决闭环 → `eval:parse` 脚本 → 日记生成读 events 增强。

## 10. 验收标准

- `npm run test` 与 `npm run build` 全绿；语料 mock 单测全过。
- 手动路径：说一句「随便聊聊」不弹任何确认；说「明天下午三点前交稿」弹出带截止时间的确认框，确认后待办页可见「急/截止」标记；说「以后早上别给我排会」弹出记忆确认，确认后下一轮对话上下文里能看到该记忆。
- 断网时对话照常（解析静默失败），不卡回复。
