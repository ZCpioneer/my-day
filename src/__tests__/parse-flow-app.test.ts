import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions } from "@/api/deepseek";
import type { ChatCompletionRequest, ChatCompletionResponse } from "@/api/deepseek";
import { localDate } from "@/dates";
import { chatRepo, deleteDb, eventRepo, projectRepo, todoRepo, waitingRepo } from "@/storage/db";
import App from "@/App.vue";

vi.mock("@/api/deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/deepseek")>();
  return { ...actual, chatCompletions: vi.fn() };
});

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 50; i++) {
    await flushPromises();
    if (check()) return;
  }
  throw new Error("timed out");
}

/** 区分解析调用（tools 为空）与回复调用（带工具）。注意 chatCompletions 的参数是 { request } 包装。 */
function mockPipeline(parseJson: string, reply: string) {
  vi.mocked(chatCompletions).mockImplementation(
    async (args: { request: ChatCompletionRequest }): Promise<ChatCompletionResponse> => {
      if (args.request.tools.length === 0) return { content: parseJson, tool_calls: [] };
      return { content: reply, tool_calls: [] };
    },
  );
}

describe("解析 → 确认 → 落库", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    // 垫一条消息，让 shouldGreet 为假，避免主动开场与用例抢 awaiting。
    await chatRepo.append(localDate(), {
      id: "seed",
      role: "user",
      content: "早",
      createdAt: "2026-09-06T00:30:00.000Z",
      mode: "chat",
    });
  });

  it("任务经确认框落库并带 priority/due/项目；事件与等待自动落库", async () => {
    mockPipeline(
      JSON.stringify({
        events: ["解析层联调完了"],
        decisions: [],
        tasks: [{ title: "明天下午三点前交稿", priority: "high", due: "2099-01-02", project: "接私活" }],
        projectUpdates: [{ project: "接私活", note: "快到截止了" }],
        waitings: [{ text: "等房东答复", waitingOn: "房东" }],
        waitingsResolved: [],
      }),
      "已记下。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("明天下午三点前得交稿，接私活那个项目快截止了，房东那边还等答复");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("记到「以后」吗？"));
    expect(w.text()).toContain("急");
    expect(w.text()).toContain("接私活");
    await w.get(".btn-yes").trigger("click");
    await waitFor(() => w.text().includes("已记下。"));
    const todos = await todoRepo.list();
    expect(todos).toHaveLength(1);
    expect(todos[0].priority).toBe("high");
    expect(todos[0].due).toBe("2099-01-02");
    const projects = await projectRepo.list();
    expect(projects.map((p) => p.title)).toEqual(["接私活"]);
    expect(todos[0].projectId).toBe(projects[0].id);
    expect((await waitingRepo.listOpen()).map((x) => x.text)).toEqual(["等房东答复"]);
    expect((await eventRepo.listRecent(1)).map((e) => e.text)).toEqual(["解析层联调完了"]);
  });

  it("纯闲聊不弹任何确认框", async () => {
    mockPipeline("{}", "哈哈是啊。");
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("今天天气真好");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("哈哈是啊。"));
    expect(w.text()).not.toContain("记到「以后」吗？");
    expect(w.text()).not.toContain("记进长期记忆吗？");
    expect(await todoRepo.list()).toEqual([]);
  });

  it("偏好/目标类话语不落任何库、不弹确认框", async () => {
    mockPipeline(
      JSON.stringify({
        events: [],
        decisions: [],
        tasks: [],
        projectUpdates: [],
        waitings: [],
        waitingsResolved: [],
      }),
      "明白了。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("以后早上别给我排会");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("明白了。"));
    expect(w.text()).not.toContain("记到「以后」吗？");
    expect(await todoRepo.list()).toEqual([]);
    expect(await eventRepo.listRecent(1)).toEqual([]);
  });

  it("解析失败（非 JSON）时对话照常", async () => {
    mockPipeline("聊得很好", "回复来了。");
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("随便说点啥");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("回复来了。"));
    expect(await todoRepo.list()).toEqual([]);
  });
});
