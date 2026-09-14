# 日记页：日期与正文同一张卡

日期：2026-09-14  
状态：已与用户对齐（历史日记同一张卡里折叠），待实现

## 问题

历史日记现在是两截：日期在 `.log-day-head` 一张独立灰卡上，正文在 `LogCard bare` 里（日期被藏掉、卡片壳被剥掉）。折叠时只剩日期，展开时眼睛还要跳一次才能把「哪一天」和「写了什么」对上。

同一页还有三套语言：今天是完整日记卡，周报是另一张完整卡并插在今天和历史中间，历史是设置页手风琴。页面不像在翻日记。

## 目标

日记页按日连续可读。每一天（今天和历史）都是同一张 `LogCard`：日期、星期、情绪、正文在同一张纸上。历史默认收起时仍露出报头 + 两行摘要；点开后寄语和编辑在**同一张卡里**出现。去掉日期条 / `bare` 这套拆法。

## 非目标

- 不改 `DailyLog` / `WeeklyLog` 字段，不新开 store
- 不改生成日记、补昨天、生成周报、编辑落库的调用链（`composeDailyLog` / `composeWeekly` / `logRepo.put`）
- 不换晨光浅色、系统字体、手机宽度
- 不做纸质日记式「全部永远展开」
- 不加搜索、按月日历、情绪筛选
- 不把周报做成独立 tab

## 用户可见行为

从上到下：

1. 页头：左「日记」，右当天星期（`周一`…`周日`），不再用口号「记每一天」
2. **今天**
   - 有日记：一张卡，默认展开。报头「今天」+「9月14日 · 周一」+ 情绪 emoji；下面是复盘正文；有寄语则蓝底一句；右下「编辑」
   - 无日记：一张矮空态卡（不要巨大「晚」字，不要 `margin: auto` 把下面内容挤走）。文案仍说明点下面整理、今晚不整明天会补昨天
3. **周报**（让路，不打断按日时间线）
   - 未生成：一条按钮「生成本周周报」
   - 已生成：同一张卡的报头「本周 · 9月7日–9月13日」，默认收起，点开才看到完成了 / 没做完 / 下周建议 / 重新生成
   - 失败文案仍在周报块下方，中文
4. **历史**：按月分组（同年「9月」，跨年「2025年12月」）。不再出现「以往」
   - 每条默认收起：报头「13日 周六」+ 情绪 + 正文两行截断。寄语和「编辑」不出现
   - 点卡片（点到编辑/输入框除外）在同一张卡里展开：截断取消，寄语和编辑出现
   - 可同时展开多条，不互斥
   - 编辑中忽略折叠点击
5. 底栏按钮：没有今天日记时「整理成日记」；已有时「重新整理」；进行中「正在整理…」

编辑规则不变：只改 `state` / `mood` / `cheer`，空状态不能保存，取消不写库。

## 架构

数据流不动：`App.vue` 仍传 `daily` / `pastLogs` / `weekly` 等，仍听 `compose` / `composeWeekly` / `save`。改的是展示层。

```
dates.ts          星期 / 日序号 / 月份文案
LogCard.vue       唯一的一天卡片（去掉 bare）
DiaryScreen.vue   今天 + 周报条 + 按月历史
styles.css        报头、截断、空态、删掉 .log-day*
```

### `src/dates.ts`

在现有 `dayLabel` 旁增加（全部按本地日历日，不碰 UTC）：

- `weekdayLabel(iso)` → `周日`…`周六`（`Date#getDay()`：0=周日）
- `dayNumLabel(iso)` → `5日` / `13日`（去前导零）
- `monthLabel(iso, todayIso = localDate())` → 与 `todayIso` 同年则 `9月`，否则 `2025年12月`

`dayLabel` 仍给今天报头和周报区间用。

### `LogCard.vue`

删掉 `bare`。

```ts
defineProps<{
  log: DailyLog;
  kicker?: string;       // 今天传「今天」；历史不传
  collapsible?: boolean; // 历史 true
  collapsed?: boolean;   // 历史默认 true
}>();
defineEmits<{ save: [log: DailyLog]; toggle: [] }>();
```

- 报头永远在卡内。`kicker` 有值：`今天` + `9月14日 · 周一`；否则：`13日 周六`
- 情绪 emoji 只在报头右侧，不再塞进正文琥珀色盒子
- 展示态正文是普通段落（`.log-state`）。`collapsed` 时两行截断，且不渲染寄语、不渲染编辑
- 根节点带 `data-log-day="log.date"`。`collapsible` 时 `aria-expanded="!collapsed"`；点击卡片 emit `toggle`，`button/input/textarea` 上的点击不触发；`editing` 时不触发
- 编辑态仍用「状态 / 秘书寄语」标签，逻辑与现在相同

今天：`<LogCard :log="daily" kicker="今天" @save />`（不传 collapsible）  
历史：`<LogCard :log="log" collapsible :collapsed="!openDates.has(log.date)" @toggle="toggleDay(log.date)" @save />`

### `DiaryScreen.vue`

- 用 `localDate()` + `weekdayLabel` 画页头星期
- 今天空态改 `diary-empty` 矮卡
- 周报：未生成保持 `data-weekly-compose`；已生成用一张卡，报头 `data-weekly-toggle`，`weeklyOpen` 默认 `false`
- `pastLogs`（已按日期倒序）按 `date.slice(0, 7)` 分组，组标题 `monthLabel`
- `openDates: Set<string>` 默认空（全收起，但摘要可见）。可多开
- 底栏文案按有无 `daily` 切换「整理成日记」/「重新整理」
- 删除 `.log-day` / `.log-day-head` / 「展开」「收起」字样

### 样式

晨光浅色 token 不变。

- 删 `.log-card--bare`、`.log-day`、`.log-day-head`、`.log-day-arrow`
- `.log-mast`：左右报头（日/星期 vs emoji）
- `.log-state--clamp`：`-webkit-line-clamp: 2`
- `.diary-empty`：米白卡，不要 `margin: auto`
- `.weekly-mast`：周报收起时的报头，视觉接近日记报头
- 可折叠卡 `:active` 轻微压暗；`prefers-reduced-motion: reduce` 时去掉过渡。展开不动画 `height`

## 错误处理

- 周报失败：仍 `weeklyError`，位置在周报块下
- 日记生成失败：仍由 App 现有逻辑处理，本改版不碰
- 旧日记没有 `mood` / `cheer`：报头无 emoji，展开后无寄语块（与现在一致）

## 测试

不打真实网络。

- `dates.test.ts`：星期、日序号、同年/跨年月份
- `log-card.test.ts`：报头文案；收起藏寄语和编辑、露出正文；点击 emit `toggle`；编辑/保存/取消仍成立；无 `bare`
- `diary-screen.test.ts`：空态无「晚」；历史按月、默认能读到摘要、展开后才见寄语/编辑；无「以往」；周报默认不展示三段正文；已有今天时底栏「重新整理」
- `app-diary-history.test.ts`：折叠时两条历史的正文摘要都可见（不再断言「看不见昨天的状态」）；点开后可编辑落库

## Key Decisions

1. **同一张卡折叠，而不是手风琴头+身。** 用户明确选这个。日期永不离开正文。
2. **折叠仍露出两行正文。** 否则又回到「只看见日期」。
3. **周报默认收起，仍留在今天和历史之间。** 让路但不新开 tab。
4. **按月分组替换「以往」。** 「以往」是仓库分区名，不是用户翻日记的单位。
5. **展示态去掉「状态」标签和琥珀色整段底。** 那是表单腔；编辑态保留字段标签。
6. **不动数据层。** 纯 UI。

## 非决策（已关闭）

- 全部永远展开：否
- 只把日期搬进卡、折叠条仍独立：否
