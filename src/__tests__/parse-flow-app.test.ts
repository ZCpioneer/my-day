import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { chatCompletions, chatCompletionsStream } from "@/api/deepseek";
import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionStreamRequest } from "@/api/deepseek";
import { localDate } from "@/dates";
import { debugLog } from "@/debug/log";
import { chatRepo, deleteDb, eventRepo, projectRepo, todoRepo, waitingRepo } from "@/storage/db";
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

/** 解析调用走 chatCompletions（tools 为空）；回复循环走 chatCompletionsStream（带工具）。注意两者的参数都是 { request } 包装。 */
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
        tasks: [{ title: "明天下午三点前交稿", reason: "客户催得紧", priority: "high", due: "2099-01-02", estimate: 90, project: "接私活" }],
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
    // 并行后回复可能早就显示完了，等落库只能看数据库本身
    await waitFor(async () => (await todoRepo.list()).length === 1);
    await waitFor(() => w.text().includes("已记下。"));
    const todos = await todoRepo.list();
    expect(todos).toHaveLength(1);
    expect(todos[0].priority).toBe("high");
    expect(todos[0].due).toBe("2099-01-02");
    expect(todos[0].reason).toBe("客户催得紧");
    expect(todos[0].estimate).toBe(90);
    const projects = await projectRepo.list();
    expect(projects.map((p) => p.title)).toEqual(["接私活"]);
    expect(todos[0].projectId).toBe(projects[0].id);
    expect((await waitingRepo.listOpen()).map((x) => x.text)).toEqual(["等房东答复"]);
    expect((await eventRepo.listRecent(1)).map((e) => e.text)).toEqual(["解析层联调完了"]);
  });

  it("确认框里的新组名会建组并挂上（即使没有 projectUpdates）", async () => {
    mockPipeline(
      JSON.stringify({
        events: [],
        decisions: [],
        tasks: [{ title: "找房", project: "搬家" }],
        projectUpdates: [],
        waitings: [],
        waitingsResolved: [],
      }),
      "已记下。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("下个月要搬家，先找房");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("记到「以后」吗？"));
    await w.get(".btn-yes").trigger("click");
    // 同上：回复可能早已显示，等数据库里的落库结果
    await waitFor(async () => (await todoRepo.list()).length === 1);
    const projects = await projectRepo.list();
    expect(projects.map((p) => p.title)).toEqual(["搬家"]);
    const todos = await todoRepo.list();
    expect(todos).toHaveLength(1);
    expect(todos[0].projectId).toBe(projects[0].id);
  });

  it("冒头引导问时解析出的 task 不弹确认框", async () => {
    mockPipeline(
      JSON.stringify({
        events: [],
        decisions: [],
        tasks: [{ title: "写脚本", project: "视频" }],
        projectUpdates: [],
        waitings: [],
        waitingsResolved: [],
      }),
      "这摊事要拆成哪几步？",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("我要做一个AI视频");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("哪几步") && !(w.get("input").element as HTMLInputElement).disabled);
    expect(w.text()).not.toContain("记到「以后」吗？");
    expect(await todoRepo.list()).toEqual([]);
  });

  it("回复还在问（哪三条 / 说清）时解析出的 task 不弹确认框", async () => {
    mockPipeline(
      JSON.stringify({
        events: [],
        decisions: [],
        tasks: [{ title: "摸清第一条链路" }, { title: "摸清第二条链路" }, { title: "摸清第三条链路" }],
        projectUpdates: [],
        waitings: [],
        waitingsResolved: [],
      }),
      "三条链路具体是哪三条？说清我再一起提议。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    debugLog.clear();
    await w.get("input").setValue("三条链路都要摸清楚，三个事情");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("哪三条") && !(w.get("input").element as HTMLInputElement).disabled);
    expect(w.text()).not.toContain("记到「以后」吗？");
    expect(await todoRepo.list()).toEqual([]);
    const parsed = debugLog.entries.find((e) => e.event === "parse_ok");
    expect(parsed?.detail).toContain("摸清第一条链路");
    const held = debugLog.entries.find((e) => e.event === "todo_rejected" && e.tool === "parse");
    expect(held?.detail).toContain("还在问，不弹");
    expect(held?.detail).toContain("摸清第一条链路");
  });

  it("清单里已有标题被新候选包含时不弹确认框", async () => {
    await todoRepo.add({
      id: "exist",
      title: "摸清第一条链路",
      status: "open",
      sourceDate: localDate(),
      createdAt: "2026-09-06T01:00:00.000Z",
      when: "later",
    });
    mockPipeline(
      JSON.stringify({
        events: [],
        decisions: [],
        tasks: [{ title: "摸清第一条链路：夸克网盘取素材" }],
        projectUpdates: [],
        waitings: [],
        waitingsResolved: [],
      }),
      "好。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("第一条是夸克取素材");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("好。"));
    expect(w.text()).not.toContain("记到「以后」吗？");
    expect(await todoRepo.list()).toHaveLength(1);
  });

  it("没点名的组从解析候选里剥掉", async () => {
    mockPipeline(
      JSON.stringify({
        events: [],
        decisions: [],
        tasks: [{ title: "买瓷砖", project: "装修" }],
        projectUpdates: [],
        waitings: [],
        waitingsResolved: [],
      }),
      "记下了。",
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("买瓷砖");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("记到「以后」吗？"));
    expect(w.text()).toContain("买瓷砖");
    expect(w.text()).not.toContain("装修");
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

  it("解析调用带最近对话上下文（承接秘书的引导提问）", async () => {
    let parseUser = "";
    vi.mocked(chatCompletions).mockImplementation(
      async (args: { request: ChatCompletionRequest }): Promise<ChatCompletionResponse> => {
        if (args.request.tools.length === 0) {
          parseUser = String(args.request.messages[1]?.content ?? "");
          return { content: "{}", tool_calls: [] };
        }
        return { content: "好。", tool_calls: [] };
      },
    );
    vi.mocked(chatCompletionsStream).mockImplementation(
      async (args: {
        request: ChatCompletionStreamRequest;
        onText: (accumulated: string) => void;
      }): Promise<ChatCompletionResponse> => {
        args.onText("好。");
        return { content: "好。", tool_calls: [] };
      },
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("装修那摊");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("好。"));
    // 并行后回复可能先于解析返回，等解析调用真正发出再断言它的入参
    await waitFor(() => parseUser.length > 0);
    expect(parseUser).toContain("最近对话");
    expect(parseUser).toContain("用户：早");
    expect(parseUser).toContain("用户刚说：「装修那摊」");
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

describe("解析与回复并行", () => {
  beforeEach(async () => {
    await deleteDb();
    localStorage.clear();
    debugLog.clear();
    // 垫一条消息，让 shouldGreet 为假，避免主动开场与用例抢 awaiting。
    await chatRepo.append(localDate(), {
      id: "seed",
      role: "user",
      content: "早",
      createdAt: "2026-09-06T00:30:00.000Z",
      mode: "chat",
    });
  });

  it("回复卡住时解析框也不抢先弹出，但两边调用都已发出", async () => {
    // 回复永远 pending。解析框必须等回复结束，所以此时不应出现确认框。
    vi.mocked(chatCompletions).mockImplementation(
      async (args: { request: ChatCompletionRequest }): Promise<ChatCompletionResponse> => {
        if (args.request.tools.length === 0) {
          return {
            content: JSON.stringify({
              events: [],
              decisions: [],
              tasks: [{ title: "买牛奶" }],
              projectUpdates: [],
              waitings: [],
              waitingsResolved: [],
            }),
            tool_calls: [],
          };
        }
        return { content: "好。", tool_calls: [] };
      },
    );
    vi.mocked(chatCompletionsStream).mockImplementation(() => new Promise<ChatCompletionResponse>(() => {}));
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("提醒我明早买牛奶");
    await w.get("button.send").trigger("click");
    await waitFor(() => vi.mocked(chatCompletionsStream).mock.calls.length > 0);
    await waitFor(() => vi.mocked(chatCompletions).mock.calls.length > 0);
    expect(w.text()).not.toContain("记到「以后」吗？");
  });

  it("解析不等回复：解析迟迟不返回，回复照常出字", async () => {
    // 解析永远 pending。串行实现里回复循环排在解析后面，回复气泡永远不会出现。
    vi.mocked(chatCompletions).mockImplementation(
      (args: { request: ChatCompletionRequest }): Promise<ChatCompletionResponse> => {
        if (args.request.tools.length === 0) return new Promise<ChatCompletionResponse>(() => {});
        return Promise.resolve({ content: "好。", tool_calls: [] });
      },
    );
    vi.mocked(chatCompletionsStream).mockImplementation(
      async (args: {
        request: ChatCompletionStreamRequest;
        onText: (accumulated: string) => void;
      }): Promise<ChatCompletionResponse> => {
        args.onText("先回着。");
        return { content: "先回着。", tool_calls: [] };
      },
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("今天天气真好");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("先回着。"));
    // 解析确实启动了，只是还没返回
    expect(vi.mocked(chatCompletions)).toHaveBeenCalled();
  });

  it("解析调用 reject：回复照常完成，记 parse_fail", async () => {
    vi.mocked(chatCompletions).mockImplementation(
      async (args: { request: ChatCompletionRequest }): Promise<ChatCompletionResponse> => {
        if (args.request.tools.length === 0) throw new Error("网络挂了");
        return { content: "好。", tool_calls: [] };
      },
    );
    vi.mocked(chatCompletionsStream).mockImplementation(
      async (args: {
        request: ChatCompletionStreamRequest;
        onText: (accumulated: string) => void;
      }): Promise<ChatCompletionResponse> => {
        args.onText("我在。");
        return { content: "我在。", tool_calls: [] };
      },
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("随便说点啥");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.text().includes("我在。"));
    await waitFor(() =>
      debugLog.entries.some((e) => e.event === "parse_fail" && e.detail.includes("网络挂了")),
    );
    expect(await todoRepo.list()).toEqual([]);
  });

  it("流式期间不弹解析框，回复落定后才弹且可确认", async () => {
    let finishReply: ((res: ChatCompletionResponse) => void) | undefined;
    vi.mocked(chatCompletions).mockImplementation(
      async (args: { request: ChatCompletionRequest }): Promise<ChatCompletionResponse> => {
        if (args.request.tools.length === 0) {
          return {
            content: JSON.stringify({
              events: [],
              decisions: [],
              tasks: [{ title: "买牛奶" }],
              projectUpdates: [],
              waitings: [],
              waitingsResolved: [],
            }),
            tool_calls: [],
          };
        }
        return { content: "好。", tool_calls: [] };
      },
    );
    vi.mocked(chatCompletionsStream).mockImplementation(
      (args: {
        request: ChatCompletionStreamRequest;
        onText: (accumulated: string) => void;
      }): Promise<ChatCompletionResponse> => {
        args.onText("正在回…");
        return new Promise((resolve) => {
          finishReply = resolve;
        });
      },
    );
    const w = mount(App);
    await waitFor(() => w.find("input").exists());
    await w.get("input").setValue("提醒我明早买牛奶");
    await w.get("button.send").trigger("click");
    await waitFor(() => w.find('[data-testid="streaming"]').exists());
    expect(w.text()).not.toContain("记到「以后」吗？");
    finishReply?.({ content: "回完了。", tool_calls: [] });
    await waitFor(() => w.text().includes("记到「以后」吗？"));
    await w.get(".btn-yes").trigger("click");
    await waitFor(async () => (await todoRepo.list()).length === 1);
    expect((await todoRepo.list()).map((t) => t.title)).toEqual(["买牛奶"]);
  });
});
