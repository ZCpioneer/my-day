# 日记页改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日记页每一天都是一张完整卡：日期、星期、情绪、正文在一起；历史默认收起仍露出报头和两行摘要，点开后寄语和编辑在同一张卡里出现。

**Architecture:** 纯展示层。`dates.ts` 补星期/日序号/月份文案；`LogCard` 去掉 `bare`，用 `kicker` / `collapsible` / `collapsed` 区分今天和历史；`DiaryScreen` 改为今天 + 可折叠周报卡 + 按月历史。`App.vue` 的数据与事件接口不变。

**Tech Stack:** Vue 3 + TypeScript + Vite，vitest + happy-dom + @vue/test-utils。全局样式在 `src/styles.css`。

**Spec:** `docs/superpowers/specs/2026-09-14-diary-page-redesign.md`

## Global Constraints

- 中文用户文案与注释
- 不改 `DailyLog` / `WeeklyLog`、不新开 store、不改 compose / 落库调用链
- 不换晨光浅色 token、系统字体、手机宽度
- 不把 `src/debug/default-key.ts` 加入 git
- 每个任务提交信息用中文

## File map

| 文件 | 职责 |
| --- | --- |
| Modify `src/dates.ts` | `weekdayLabel` / `dayNumLabel` / `monthLabel` |
| Modify `src/__tests__/dates.test.ts` | 上述纯函数单测 |
| Modify `src/components/LogCard.vue` | 报头 + 同卡折叠，删除 `bare` |
| Modify `src/__tests__/log-card.test.ts` | 报头、折叠、toggle、编辑 |
| Modify `src/screens/DiaryScreen.vue` | 页头星期、矮空态、周报同卡折叠、按月历史 |
| Modify `src/__tests__/diary-screen.test.ts` | 页面级行为 |
| Modify `src/__tests__/app-diary-history.test.ts` | 摘要可见 + 展开后编辑落库 |
| Modify `src/styles.css` | 报头/截断/空态；删除 `.log-day*` `.log-card--bare` |
| Modify `AGENTS.md` | 日记页现状描述 |

---

### Task 1: 日期文案纯函数

**Files:**
- Modify: `src/dates.ts`
- Modify: `src/__tests__/dates.test.ts`

**Interfaces:**
- Consumes: 现有 `localDate`（`monthLabel` 默认 `todayIso`）
- Produces:

```ts
export function weekdayLabel(iso: string): string; // 「周日」…「周六」
export function dayNumLabel(iso: string): string;  // 「5日」
export function monthLabel(iso: string, todayIso?: string): string; // 「9月」或「2025年12月」
```

- [ ] **Step 1: Write the failing test**

在 `src/__tests__/dates.test.ts` 末尾追加：

```ts
import { dayNumLabel, monthLabel, weekdayLabel } from "@/dates";

describe("weekdayLabel", () => {
  it("按本地日历日给中文星期，周日是周日", () => {
    // 2026-09-07 是周一（与 weekKey 用例同一锚点）
    expect(weekdayLabel("2026-09-07")).toBe("周一");
    expect(weekdayLabel("2026-09-13")).toBe("周日");
    expect(weekdayLabel("2026-09-14")).toBe("周一");
  });
});

describe("dayNumLabel", () => {
  it("去掉月、去掉前导零", () => {
    expect(dayNumLabel("2026-09-05")).toBe("5日");
    expect(dayNumLabel("2026-09-13")).toBe("13日");
  });
});

describe("monthLabel", () => {
  it("同年只写月，跨年带年", () => {
    expect(monthLabel("2026-09-05", "2026-09-14")).toBe("9月");
    expect(monthLabel("2025-12-01", "2026-09-14")).toBe("2025年12月");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/dates.test.ts`

Expected: FAIL，`weekdayLabel` 未导出。

- [ ] **Step 3: Write minimal implementation**

在 `src/dates.ts` 的 `dayLabel` 之后加入：

```ts
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** 「周一」式的星期；周日是「周日」。 */
export function weekdayLabel(iso: string): string {
  return WEEKDAYS[fromIso(iso).getDay()] ?? "";
}

/** 「5日」式的日序号。 */
export function dayNumLabel(iso: string): string {
  return `${Number(iso.split("-")[2])}日`;
}

/** 同年「9月」，跨年「2025年12月」。 */
export function monthLabel(iso: string, todayIso: string = localDate()): string {
  const [y, m] = iso.split("-").map(Number);
  const ty = Number(todayIso.slice(0, 4));
  return y === ty ? `${Number(m)}月` : `${y}年${Number(m)}月`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/dates.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dates.ts src/__tests__/dates.test.ts
git commit -m "feat: 日记页用的星期、日序号、月份文案"
```

---

### Task 2: LogCard 报头与同卡折叠

**Files:**
- Modify: `src/components/LogCard.vue`
- Modify: `src/__tests__/log-card.test.ts`
- Modify: `src/styles.css`（卡片报头/截断，删除 `bare`）

**Interfaces:**
- Consumes: `DailyLog`；`dayLabel` / `weekdayLabel` / `dayNumLabel`
- Produces: props `log` / `kicker?` / `collapsible?` / `collapsed?`；emit `save` / `toggle`；根节点 `data-log-day`；正文 `data-log-state`。删除 `bare`。

- [ ] **Step 1: Write the failing test**

把 `src/__tests__/log-card.test.ts` 整文件换成：

```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LogCard from "@/components/LogCard.vue";
import type { DailyLog } from "@/types";

function mkLog(over: Partial<DailyLog> = {}): DailyLog {
  return {
    date: "2026-09-07",
    state: "今天还行",
    updatedAt: "2026-09-07T12:00:00.000Z",
    ...over,
  };
}

describe("LogCard 展示", () => {
  it("今天报头带 kicker、日期和星期，情绪在报头", () => {
    const w = mount(LogCard, {
      props: { log: mkLog({ mood: "😮‍💨", cheer: "辛苦了" }), kicker: "今天" },
    });
    expect(w.text()).toContain("今天");
    expect(w.text()).toContain("9月7日");
    expect(w.text()).toContain("周一");
    expect(w.get("[data-log-mood]").text()).toBe("😮‍💨");
    expect(w.get("[data-log-state]").text()).toBe("今天还行");
    expect(w.get("[data-log-cheer]").text()).toBe("辛苦了");
    expect(w.text()).not.toContain("早计划");
    expect(w.text()).not.toContain("做成了");
    expect(w.find("h3").exists()).toBe(false);
  });

  it("历史报头是日序号+星期，不重复月份", () => {
    const w = mount(LogCard, { props: { log: mkLog(), collapsible: true, collapsed: true } });
    expect(w.get("[data-log-day]").attributes("data-log-day")).toBe("2026-09-07");
    expect(w.text()).toContain("7日");
    expect(w.text()).toContain("周一");
    expect(w.text()).not.toContain("9月7日");
  });

  it("旧日记没有 mood/cheer 时不渲染寄语块", () => {
    const w = mount(LogCard, { props: { log: mkLog() } });
    expect(w.find("[data-log-mood]").exists()).toBe(false);
    expect(w.find("[data-log-cheer]").exists()).toBe(false);
  });
});

describe("LogCard 折叠", () => {
  it("收起时露出正文、藏寄语和编辑", () => {
    const w = mount(LogCard, {
      props: {
        log: mkLog({ cheer: "早点休息" }),
        collapsible: true,
        collapsed: true,
      },
    });
    expect(w.get("[data-log-state]").text()).toBe("今天还行");
    expect(w.find("[data-log-cheer]").exists()).toBe(false);
    expect(w.find("[data-log-edit]").exists()).toBe(false);
    expect(w.get("[data-log-day]").attributes("aria-expanded")).toBe("false");
  });

  it("展开后寄语和编辑出现", () => {
    const w = mount(LogCard, {
      props: {
        log: mkLog({ cheer: "早点休息" }),
        collapsible: true,
        collapsed: false,
      },
    });
    expect(w.get("[data-log-cheer]").text()).toBe("早点休息");
    expect(w.find("[data-log-edit]").exists()).toBe(true);
    expect(w.get("[data-log-day]").attributes("aria-expanded")).toBe("true");
  });

  it("点卡片 emit toggle；点编辑不 toggle", async () => {
    const w = mount(LogCard, {
      props: { log: mkLog({ cheer: "寄" }), collapsible: true, collapsed: false },
    });
    await w.get("[data-log-day]").trigger("click");
    expect(w.emitted("toggle")).toHaveLength(1);
    await w.get("[data-log-edit]").trigger("click");
    expect(w.emitted("toggle")).toHaveLength(1);
  });
});

describe("LogCard 编辑", () => {
  it("点编辑载入现文，保存 emit 更新后的日志", async () => {
    const w = mount(LogCard, { props: { log: mkLog() } });
    await w.get("[data-log-edit]").trigger("click");
    const state = w.get<HTMLTextAreaElement>("[data-log-edit-state]");
    expect(state.element.value).toBe("今天还行");
    await state.setValue("改过的状态");
    await w.get("[data-log-edit-save]").trigger("click");
    const saved = w.emitted("save");
    expect(saved).toHaveLength(1);
    const log = (saved![0] as DailyLog[])[0];
    expect(log.state).toBe("改过的状态");
    expect(log.date).toBe("2026-09-07");
    expect(w.find("[data-log-edit-state]").exists()).toBe(false);
  });

  it("取消不 emit，恢复展示", async () => {
    const w = mount(LogCard, { props: { log: mkLog() } });
    await w.get("[data-log-edit]").trigger("click");
    await w.get("[data-log-edit-state]").setValue("写到一半");
    await w.get("[data-log-edit-cancel]").trigger("click");
    expect(w.emitted("save")).toBeUndefined();
    expect(w.find("[data-log-edit-state]").exists()).toBe(false);
    expect(w.get("[data-log-state]").text()).toBe("今天还行");
  });

  it("清空状态不允许保存", async () => {
    const w = mount(LogCard, { props: { log: mkLog() } });
    await w.get("[data-log-edit]").trigger("click");
    await w.get("[data-log-edit-state]").setValue("   ");
    expect(w.get("[data-log-edit-save]").attributes("disabled")).toBeDefined();
    await w.get("[data-log-edit-save]").trigger("click");
    expect(w.emitted("save")).toBeUndefined();
  });

  it("编辑可改 mood/cheer，保存带上；清空则落为 undefined", async () => {
    const w = mount(LogCard, { props: { log: mkLog({ mood: "😊", cheer: "不错" }) } });
    await w.get("[data-log-edit]").trigger("click");
    expect(w.get<HTMLInputElement>("[data-log-edit-mood]").element.value).toBe("😊");
    expect(w.get<HTMLTextAreaElement>("[data-log-edit-cheer]").element.value).toBe("不错");
    await w.get("[data-log-edit-mood]").setValue("🥳");
    await w.get("[data-log-edit-cheer]").setValue("  ");
    await w.get("[data-log-edit-save]").trigger("click");
    const log = (w.emitted("save")![0] as DailyLog[])[0];
    expect(log.mood).toBe("🥳");
    expect(log.cheer).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/log-card.test.ts`

Expected: FAIL（还没有 `data-log-state` / `toggle` / 新报头）。

- [ ] **Step 3: Write minimal implementation**

把 `src/components/LogCard.vue` 整文件换成：

```vue
<template>
  <div
    class="log-card"
    :class="{ 'log-card--collapsible': collapsible, 'log-card--collapsed': collapsed }"
    :data-log-day="log.date"
    :aria-expanded="collapsible ? (!collapsed).toString() : undefined"
    @click="onCardClick"
  >
    <div class="log-core">
      <div class="log-mast">
        <div class="log-mast-when">
          <span v-if="kicker" class="log-kicker">{{ kicker }}</span>
          <span class="log-when">{{ whenLabel }}</span>
        </div>
        <span v-if="log.mood" class="mood-emoji" data-log-mood>{{ log.mood }}</span>
      </div>
      <template v-if="!editing">
        <p class="log-state" :class="{ 'log-state--clamp': collapsed }" data-log-state>{{ log.state }}</p>
        <p v-if="!collapsed && log.cheer" class="log-cheer" data-log-cheer>{{ log.cheer }}</p>
        <div v-if="!collapsed" class="log-actions">
          <button type="button" class="log-edit-btn" data-log-edit @click.stop="startEdit">编辑</button>
        </div>
      </template>
      <template v-else>
        <div class="log-block">
          <div class="lab">状态</div>
          <div class="log-mood-row">
            <input v-model="draftMood" class="log-mood-input" data-log-edit-mood maxlength="4" placeholder="emoji" />
            <textarea v-model="draftState" class="log-textarea" data-log-edit-state rows="4"></textarea>
          </div>
        </div>
        <div class="log-block">
          <div class="lab">秘书寄语</div>
          <textarea v-model="draftCheer" class="log-textarea" data-log-edit-cheer rows="2"></textarea>
        </div>
        <div class="log-actions">
          <button type="button" class="log-edit-btn" data-log-edit-cancel @click.stop="cancelEdit">取消</button>
          <button
            type="button"
            class="log-edit-btn log-edit-btn--primary"
            data-log-edit-save
            :disabled="!canSave"
            @click.stop="saveEdit"
          >
            保存
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { dayLabel, dayNumLabel, weekdayLabel } from "@/dates";
import type { DailyLog } from "@/types";

const props = withDefaults(
  defineProps<{
    log: DailyLog;
    kicker?: string;
    collapsible?: boolean;
    collapsed?: boolean;
  }>(),
  { collapsible: false, collapsed: false },
);

const emit = defineEmits<{ save: [log: DailyLog]; toggle: [] }>();

const whenLabel = computed(() =>
  props.kicker
    ? `${dayLabel(props.log.date)} · ${weekdayLabel(props.log.date)}`
    : `${dayNumLabel(props.log.date)} ${weekdayLabel(props.log.date)}`,
);

const editing = ref(false);
const draftState = ref("");
const draftMood = ref("");
const draftCheer = ref("");

const canSave = computed(() => draftState.value.trim().length > 0);

function onCardClick(e: MouseEvent) {
  if (!props.collapsible || editing.value) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest("button, input, textarea")) return;
  emit("toggle");
}

function startEdit() {
  draftState.value = props.log.state;
  draftMood.value = props.log.mood ?? "";
  draftCheer.value = props.log.cheer ?? "";
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

function saveEdit() {
  if (!canSave.value) return;
  editing.value = false;
  const mood = draftMood.value.trim();
  const cheer = draftCheer.value.trim();
  emit("save", {
    ...props.log,
    state: draftState.value.trim(),
    mood: mood || undefined,
    cheer: cheer || undefined,
    updatedAt: new Date().toISOString(),
  });
}
</script>
```

在 `src/styles.css` 里，把从 `.log-card {` 到 `.log-day-arrow { ... }` 的整段（含 `.log-card--bare` / `.log-core h3` / `.log-day*`）替换为：

```css
.log-card {
  padding: 5px;
  border-radius: 24px;
  background: transparent;
}
.log-card--collapsible { cursor: pointer; }
.log-card--collapsible:active .log-core { filter: brightness(0.97); }
.log-core {
  background: var(--panel);
  border-radius: 18px;
  padding: 18px 16px 16px;
  box-shadow: var(--shadow-card);
}
.log-mast {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.log-mast-when {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.log-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--dawn);
}
.log-when {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.log-state {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--paper-dim);
}
.log-state--clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.log-block { margin-bottom: 14px; }
.log-block .lab {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--dawn);
  margin-bottom: 6px;
}
.log-block p {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--paper-dim);
}
```

并把 `.mood-emoji` 改成报头用的尺寸（删掉 `margin-right` 依赖）：

```css
.mood-emoji { font-size: 20px; line-height: 1; }
```

`.mood`（琥珀色）留给周报「下周建议」，不要删。

在文件末尾（或现有 `@media` 旁）加：

```css
@media (prefers-reduced-motion: reduce) {
  .log-card--collapsible:active .log-core { filter: none; }
  .log-edit-btn, .diary-compose-btn, .weekly-btn { transition: none; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/log-card.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/LogCard.vue src/__tests__/log-card.test.ts src/styles.css
git commit -m "feat: 日记卡日期和正文放在同一张卡里"
```

---

### Task 3: DiaryScreen 页结构

**Files:**
- Modify: `src/screens/DiaryScreen.vue`
- Modify: `src/__tests__/diary-screen.test.ts`
- Modify: `src/styles.css`（`diary-empty`、周报报头；删除旧 `.empty` 在日记里的用法即可）

**Interfaces:**
- Consumes: Task 2 的 `LogCard` props；`weekdayLabel` / `monthLabel` / `dayLabel` / `localDate`
- Produces: 仍 emit `compose` / `composeWeekly` / `save`。历史卡片 `data-log-day`。周报条 `data-weekly-toggle`，生成按钮仍 `data-weekly-compose`。

- [ ] **Step 1: Write the failing test**

把 `src/__tests__/diary-screen.test.ts` 整文件换成：

```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DiaryScreen from "@/screens/DiaryScreen.vue";
import { localDate, monthLabel, weekdayLabel } from "@/dates";
import type { DailyLog, WeeklyLog } from "@/types";

function mkLog(date: string, state: string, over: Partial<DailyLog> = {}): DailyLog {
  return {
    date,
    state,
    updatedAt: `${date}T12:00:00.000Z`,
    ...over,
  };
}

function mkWeekly(): WeeklyLog {
  return {
    week: "2026-W37",
    from: "2026-09-07",
    to: "2026-09-13",
    done: "做完了解析层",
    undone: "周报剩一点",
    next: "下周先收周报",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
}

describe("DiaryScreen", () => {
  it("emits compose from 整理成日记 and disables while composing", async () => {
    const w = mount(DiaryScreen, { props: { daily: null, pastLogs: [] } });
    expect(w.text()).toContain("整理成日记");
    expect(w.text()).toContain("明天打开会补上昨天");
    expect(w.text()).not.toContain("晚");
    expect(w.text()).toContain(weekdayLabel(localDate()));
    await w.get("[data-diary-compose]").trigger("click");
    expect(w.emitted("compose")).toHaveLength(1);

    await w.setProps({ composing: true });
    expect(w.get("[data-diary-compose]").attributes("disabled")).toBeDefined();
  });

  it("已有今天日记时底栏是重新整理", () => {
    const w = mount(DiaryScreen, { props: { daily: mkLog("2026-09-07", "今天还行"), pastLogs: [] } });
    expect(w.get("[data-diary-compose]").text()).toBe("重新整理");
  });

  it("历史按月分组，默认露出摘要，点开才见寄语和编辑", async () => {
    const w = mount(DiaryScreen, {
      props: {
        daily: mkLog("2026-09-06", "今天还行"),
        pastLogs: [
          mkLog("2026-09-05", "昨天挺累", { cheer: "早点睡" }),
          mkLog("2026-09-04", "前天平静", { cheer: "稳住" }),
        ],
      },
    });
    expect(w.text()).toContain("9月");
    expect(w.text()).not.toContain("以往");
    expect(w.text()).toContain("昨天挺累");
    expect(w.text()).toContain("前天平静");
    expect(w.text()).not.toContain("早点睡");
    expect(w.text()).not.toContain("早计划");
    expect(w.get('[data-log-day="2026-09-05"]').find("[data-log-edit]").exists()).toBe(false);

    await w.get('[data-log-day="2026-09-05"]').trigger("click");
    expect(w.text()).toContain("早点睡");
    expect(w.text()).not.toContain("稳住");

    await w.get('[data-log-day="2026-09-05"]').trigger("click");
    expect(w.text()).not.toContain("早点睡");
  });

  it("跨月历史出现月标题", () => {
    const w = mount(DiaryScreen, {
      props: {
        daily: mkLog("2026-09-01", "今天"),
        pastLogs: [mkLog("2026-08-31", "八月最后")],
      },
    });
    expect(w.text()).toContain(monthLabel("2026-08-31"));
    expect(w.text()).toContain("八月最后");
  });

  it("周报区：未生成时显示「生成本周周报」，点击 emit composeWeekly", async () => {
    const w = mount(DiaryScreen, { props: { daily: mkLog("2026-09-07", "今天还行"), pastLogs: [], weekly: null } });
    const btn = w.get("[data-weekly-compose]");
    expect(btn.text()).toContain("生成本周周报");
    await btn.trigger("click");
    expect(w.emitted("composeWeekly")).toHaveLength(1);
  });

  it("周报区：已生成默认只显示区间，点开才见正文和重新生成", async () => {
    const w = mount(DiaryScreen, {
      props: { daily: null, pastLogs: [], weekly: mkWeekly() },
    });
    expect(w.text()).toContain("9月7日");
    expect(w.text()).toContain("9月13日");
    expect(w.text()).not.toContain("做完了解析层");
    await w.get("[data-weekly-toggle]").trigger("click");
    expect(w.text()).toContain("做完了解析层");
    expect(w.text()).toContain("下周先收周报");
    const btn = w.get("[data-weekly-compose]");
    expect(btn.text()).toContain("重新生成");
    await btn.trigger("click");
    expect(w.emitted("composeWeekly")).toHaveLength(1);
  });

  it("周报区：生成中按钮禁用，失败显示中文错误", async () => {
    const w = mount(DiaryScreen, {
      props: { daily: null, pastLogs: [], weekly: null, composingWeekly: true },
    });
    const btn = w.get("[data-weekly-compose]");
    expect(btn.text()).toContain("正在生成");
    expect(btn.attributes("disabled")).toBeDefined();

    await w.setProps({ composingWeekly: false, weeklyError: "模型这轮没回上，再说一次" });
    expect(w.get("[data-weekly-error]").text()).toContain("模型这轮没回上");
  });

  it("LogCard 保存往上转发 save", async () => {
    const daily = mkLog("2026-09-07", "旧状态");
    const w = mount(DiaryScreen, { props: { daily, pastLogs: [], weekly: null } });
    await w.get("[data-log-edit]").trigger("click");
    await w.get("[data-log-edit-state]").setValue("新状态");
    await w.get("[data-log-edit-save]").trigger("click");
    const saved = w.emitted("save");
    expect(saved).toHaveLength(1);
    expect((saved![0] as DailyLog[])[0].state).toBe("新状态");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/diary-screen.test.ts`

Expected: FAIL（仍有「以往」、周报默认展开、底栏文案未改）。

- [ ] **Step 3: Write minimal implementation**

把 `src/screens/DiaryScreen.vue` 整文件换成：

```vue
<template>
  <section class="screen on">
    <div class="diary-scroll">
      <div class="diary-head">
        <h2>日记</h2>
        <div class="count">{{ weekdayLabel(localDate()) }}</div>
      </div>
      <div v-if="!daily" class="diary-empty">
        <p>点下面「整理成日记」。今天不整的话，明天打开会补上昨天。</p>
      </div>
      <LogCard v-else :log="daily" kicker="今天" @save="emit('save', $event)" />
      <div v-if="weekly" class="log-card">
        <div class="log-core">
          <button
            type="button"
            class="weekly-mast"
            data-weekly-toggle
            :aria-expanded="weeklyOpen"
            @click="weeklyOpen = !weeklyOpen"
          >
            <span>本周 · {{ weekRange }}</span>
            <span class="weekly-caret" aria-hidden="true">{{ weeklyOpen ? "▴" : "▾" }}</span>
          </button>
          <template v-if="weeklyOpen">
            <div class="log-block">
              <div class="lab">完成了</div>
              <p>{{ weekly.done }}</p>
            </div>
            <div class="log-block">
              <div class="lab">没做完</div>
              <p>{{ weekly.undone }}</p>
            </div>
            <div class="log-block">
              <div class="lab">下周建议</div>
              <div class="mood">{{ weekly.next }}</div>
            </div>
            <div class="log-actions">
              <button
                type="button"
                class="log-edit-btn"
                data-weekly-compose
                :disabled="composingWeekly"
                @click="emit('composeWeekly')"
              >
                {{ composingWeekly ? "正在生成…" : "重新生成" }}
              </button>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="weekly-empty">
        <button
          data-weekly-compose
          class="weekly-btn"
          type="button"
          :disabled="composingWeekly"
          @click="emit('composeWeekly')"
        >
          {{ composingWeekly ? "正在生成…" : "生成本周周报" }}
        </button>
      </div>
      <p v-if="weeklyError" class="weekly-error" data-weekly-error>{{ weeklyError }}</p>
      <template v-for="group in pastGroups" :key="group.key">
        <div class="section-label">{{ group.label }}</div>
        <LogCard
          v-for="log in group.logs"
          :key="log.date"
          :log="log"
          collapsible
          :collapsed="!openDates.has(log.date)"
          @toggle="toggleDay(log.date)"
          @save="emit('save', $event)"
        />
      </template>
    </div>
    <div class="diary-compose">
      <button
        data-diary-compose
        class="diary-compose-btn"
        type="button"
        :disabled="composing"
        @click="emit('compose')"
      >
        {{ composeLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import LogCard from "@/components/LogCard.vue";
import { dayLabel, localDate, monthLabel, weekdayLabel } from "@/dates";
import type { DailyLog, WeeklyLog } from "@/types";

const props = defineProps<{
  daily: DailyLog | null;
  pastLogs: DailyLog[];
  composing?: boolean;
  weekly?: WeeklyLog | null;
  composingWeekly?: boolean;
  weeklyError?: string;
}>();

const emit = defineEmits<{ compose: []; composeWeekly: []; save: [log: DailyLog] }>();

const weekRange = computed(() =>
  props.weekly ? `${dayLabel(props.weekly.from)}–${dayLabel(props.weekly.to)}` : "",
);

const composeLabel = computed(() => {
  if (props.composing) return "正在整理…";
  return props.daily ? "重新整理" : "整理成日记";
});

const pastGroups = computed(() => {
  const today = localDate();
  const groups: { key: string; label: string; logs: DailyLog[] }[] = [];
  for (const log of props.pastLogs) {
    const key = log.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.logs.push(log);
    else groups.push({ key, label: monthLabel(log.date, today), logs: [log] });
  }
  return groups;
});

const openDates = ref(new Set<string>());
const weeklyOpen = ref(false);

function toggleDay(date: string) {
  const next = new Set(openDates.value);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  openDates.value = next;
}
</script>
```

在 `src/styles.css` 的 `.empty` 规则旁增加日记空态（不要改全局 `.empty`）：

```css
.diary-empty {
  background: var(--panel);
  border-radius: 18px;
  padding: 16px;
  box-shadow: var(--shadow-card);
  color: var(--mute);
  font-size: 13.5px;
  line-height: 1.7;
}
```

在 `.weekly-empty` 之前增加周报报头：

```css
.weekly-mast {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--paper);
  font: inherit;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
}
.weekly-caret {
  font-size: 12px;
  color: var(--mute);
  font-weight: 500;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/diary-screen.test.ts src/__tests__/log-card.test.ts`

Expected: PASS。跨月标题用 `monthLabel("2026-08-31")`（与页面同一默认 today），不要写死「8月」或「2026年8月」。

- [ ] **Step 5: Commit**

```bash
git add src/screens/DiaryScreen.vue src/__tests__/diary-screen.test.ts src/styles.css
git commit -m "feat: 日记页按月排列，周报不再打断时间线"
```

---

### Task 4: App 级回归与文档

**Files:**
- Modify: `src/__tests__/app-diary-history.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 3 的页面行为（折叠仍露出 `state`；`data-log-day` 点击展开后才能编辑）
- Produces: 无新 API

- [ ] **Step 1: Write the failing test**

把 `app-diary-history.test.ts` 里「以往」和「看不见正文」的断言改掉。`mkLog` 加上可选 `cheer`，折叠/展开用寄语区分：

```ts
function mkLog(date: string, state: string, cheer?: string): DailyLog {
  return {
    date,
    state,
    ...(cheer ? { cheer } : {}),
    updatedAt: `${date}T12:00:00.000Z`,
  };
}
```

替换第一个用例：

```ts
it("shows past logs with preview and expands on tap", async () => {
  const yesterday = shiftLocalDate(localDate(), -1);
  const twoDaysAgo = shiftLocalDate(localDate(), -2);
  await logRepo.put(mkLog(yesterday, "昨天的状态", "昨天寄语"));
  await logRepo.put(mkLog(twoDaysAgo, "前天的状态", "前天寄语"));
  const w = mount(App);
  await waitFor(() => w.text().includes("今天随便聊聊"));
  await w.get('[data-nav="diary"]').trigger("click");
  await waitFor(() => w.text().includes("昨天的状态"));
  expect(w.text()).toContain("前天的状态");
  expect(w.text()).not.toContain("昨天寄语");
  await w.get(`[data-log-day="${yesterday}"]`).trigger("click");
  expect(w.text()).toContain("昨天寄语");
  expect(w.text()).not.toContain("前天寄语");
});
```

第三个用例（以往区编辑）把 `toContain("以往")` 改成等正文摘要：

```ts
await waitFor(() => w.text().includes("昨天的状态"));
await w.get(`[data-log-day="${yesterday}"]`).trigger("click");
await waitFor(() => w.get("[data-log-edit]").exists());
```

今天那张若存在会先有一个编辑按钮；这个用例没有今天日记，展开历史后才出现 `[data-log-edit]`。`waitFor(() => w.find("[data-log-edit]").exists())` 即可，然后照旧改状态保存。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/app-diary-history.test.ts`

Expected: 若 Task 3 已完成，这条在改测试后应直接接近 PASS；若还断言「以往」则会 FAIL。先改测试再跑。

- [ ] **Step 3: 改 AGENTS.md 日记段**

把这一句：

> 日记页不只显示今天：`logs` 按日期存全部日记，页面上方是今天（缺失时显示空态 + 「整理成日记」），中间「周报」区（本周未生成显示「生成本周周报」，已生成显示卡片 + 重新生成；`compose-week.ts` 聚合本周日记 + 待办完成情况落 `weeklyRepo`），下方「以往」区按日期倒序列出历史日记，默认折叠只显示日期，点击展开完整卡片（`LogCard`）。

换成：

> 日记页不只显示今天：`logs` 按日期存全部日记。上方是今天（缺失时矮空态卡 + 底栏「整理成日记」；已有则底栏「重新整理」）。今天和历史共用 `LogCard`：日期、星期、情绪、正文在同一张卡里，没有日期条和 `bare` 拆法。历史按月分组，默认收起仍露出报头和两行摘要，点开后寄语和编辑在同一张卡里出现（可多开）。周报夹在今天和历史之间：未生成显示「生成本周周报」，已生成默认只显示本周区间，点开才见三段正文 + 重新生成（`compose-week.ts` 聚合本周日记 + 待办完成情况落 `weeklyRepo`）。日记可编辑：`LogCard` 编辑模式只改模型写的文字（state/mood/cheer），保存经 App 侧 `logRepo.put` 落库并刷新双区。数据由 App 侧 `refreshPastLogs`（`logRepo.list()` 排除今天）在启动、跨日、补日记成功后刷新。

代码组织里 `dates` 那一行若只写 `weekKey/weekDates`，补上 `weekdayLabel/dayNumLabel/monthLabel`。

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run test`

Expected: 全部 PASS。然后 `npm run build`（含 vue-tsc）。

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/app-diary-history.test.ts AGENTS.md
git commit -m "test: 日记历史摘要可见；同步 Agents 描述"
```

---

## Self-review

- Spec 覆盖：报头、同卡折叠、两行摘要、按月、周报默认收起、矮空态、底栏「重新整理」、编辑链、删除 `bare` / 「以往」——均有对应任务。
- 无 TBD。跨月标题的测试与 `monthLabel(iso)` 默认 today 对齐，不写死年份。
- `LogCard` emit `toggle` 与 `DiaryScreen.toggleDay` 名称一致；`data-log-day` / `data-weekly-toggle` / `data-weekly-compose` / `data-diary-compose` 与测试一致。
- `App.vue` 不改 props。
