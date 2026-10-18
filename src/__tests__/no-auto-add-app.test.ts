import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions, chatCompletionsStream } from "@/api/deepseek";
import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionStreamRequest } from "@/api/deepseek";
import { localDate } from "@/dates";
import { chatRepo, deleteDb, todoRepo } from "@/storage/db";
import App from "@/App.vue";

vi.mock("@/api/deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/deepseek")>();
  return { ...actual, chatCompletions: vi.fn(), chatCompletionsStream: vi.fn() };
});

async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 50; i++) {
    await flushPromises();
    if (await check()) return;
  }
  throw new Error("timed out");
}

/** 解析调用走 chatCompletions（tools 为空）；回复循环走 chatCompletionsStream（带工具）。 */
function mockPipeline(parseJson: string, reply: string) {
  vi.mocked(chatCompletions).mockImplementation(
    async (args: { request: ChatCompletionRequest }): Promise<ChatCompletionResponse> => {
      if (args.request.tools.length === 0) return { content: parseJson, tool_calls: [] };
      return { content: reply, tool_calls: [] };
    },
  );
  vi.mocked(chatCompletionsStream).mockImplementation(
    async (args: {
      request: ChatCompletionStreamRequest;
      onText: (accumulated: string) => void;
    }): Promise<ChatCompletionResponse> => {
      args.onText(reply);
      return { content: reply, tool_calls: [] };
    },
  );
}

function parseJsonWithTasks(tasks: unknown[]): string {
  return JSON.stringify({
    events: [],
    decisions: [],
    tasks,
    projectUpdates: [],
    waitings: [],
    waitingsResolved: [],
  });
}

describe("解析任务一律确认，不再自动记录", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    await chatRepo.append(localDate(), {
      id: "seed",
      role: "user",
      content: "早",
      createdAt: "2026-09-06T00:30:00.000Z",
      mode: "chat",
    });
  });

  it("高置信度也弹确认框：确认前不落库，没有自动记录提示条", async () => {
    mockPipeline(parseJsonWithTasks([{ title: "明早买牛奶", confidence: "high", priority: "high", due: "2099-01-02" }]), "好。");
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("提醒我明早买牛奶");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("记到「以后」吗？"));
    expect(w.text()).toContain("明早买牛奶");
    expect(w.find('[data-testid="auto-toast"]').exists()).toBe(false);
    expect(w.text()).not.toContain("已记下：");
    expect(await todoRepo.list()).toEqual([]);
    await w.get(".btn-yes").trigger("click");
    await waitFor(async () => (await todoRepo.list()).length === 1);
    const todos = await todoRepo.list();
    expect(todos[0].title).toBe("明早买牛奶");
    expect(todos[0].when).toBe("later");
    expect(todos[0].priority).toBe("high");
    expect(todos[0].due).toBe("2099-01-02");
  });

  it("高低混合：两条都进同一个确认框，确认前都不落库", async () => {
    mockPipeline(
      parseJsonWithTasks([
        { title: "明早买牛奶", confidence: "high" },
        { title: "可能得洗车", confidence: "low" },
      ]),
      "好。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("提醒我明早买牛奶；另外好像该洗车了");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("记到「以后」吗？"));
    expect(w.text()).toContain("明早买牛奶");
    expect(w.text()).toContain("可能得洗车");
    expect(w.find('[data-testid="auto-toast"]').exists()).toBe(false);
    expect(await todoRepo.list()).toEqual([]);
    await w.get(".btn-yes").trigger("click");
    await waitFor(async () => (await todoRepo.list()).length === 2);
    expect((await todoRepo.list()).map((t) => t.title).sort()).toEqual(["可能得洗车", "明早买牛奶"]);
  });

  it("以后确认框：清单已有同标题则不弹框", async () => {
    await todoRepo.add({
      id: "exist",
      title: "明早买牛奶",
      status: "open",
      sourceDate: localDate(),
      createdAt: "2026-09-06T01:00:00.000Z",
      when: "later",
    });
    mockPipeline(parseJsonWithTasks([{ title: "明早买牛奶", confidence: "high" }]), "好。");
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("提醒我明早买牛奶");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("好。"));
    expect(w.text()).not.toContain("记到「以后」吗？");
    expect(w.find(".btn-yes").exists()).toBe(false);
    expect((await todoRepo.list()).filter((t) => t.title === "明早买牛奶")).toHaveLength(1);
  });
});
