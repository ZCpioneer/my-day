import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ChatScreen from "@/screens/ChatScreen.vue";
import { openMicSession } from "@/speech/listen";

vi.mock("@/speech/listen", () => ({
  ListenCancelled: class ListenCancelled extends Error {
    constructor() {
      super("listen-cancelled");
      this.name = "ListenCancelled";
    }
  },
  openMicSession: vi.fn(),
}));
vi.mock("@/speech/tts", () => ({
  warmupAudio: vi.fn(async () => {}),
  cancelSpeech: vi.fn(),
}));

function hangListen() {
  return { finish() {}, cancel() {}, result: new Promise<string>(() => {}) };
}

function mockMic(listen: () => { finish(): void; cancel(): void; result: Promise<string> }) {
  vi.mocked(openMicSession).mockResolvedValue({ listen, close: vi.fn() });
}

describe("ChatScreen 文字 / 语音模式", () => {
  beforeEach(() => {
    vi.mocked(openMicSession).mockReset();
    mockMic(hangListen);
  });

  it("默认文字模式：有输入框，没有麦克风，没有语音面板", () => {
    const w = mount(ChatScreen, { props: { messages: [], awaiting: false, pendingPropose: null } });
    expect(w.get("[data-testid=mode-text]").classes()).toContain("active");
    expect(w.find(".composer input").exists()).toBe(true);
    expect(w.find("[data-testid=voice-panel]").exists()).toBe(false);
    expect(w.find("[data-mic]").exists()).toBe(false);
  });

  it("切到语音模式：收起输入框，听完一句直接发送", async () => {
    let calls = 0;
    mockMic(() => {
      calls += 1;
      if (calls === 1) return { finish() {}, cancel() {}, result: Promise.resolve("V0FW") };
      return hangListen();
    });
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: false,
        pendingPropose: null,
        recognize: async (wav: string) => {
          expect(wav).toBe("V0FW");
          return "提醒我下午买牛奶";
        },
      },
    });
    await w.get("[data-testid=mode-voice]").trigger("click");
    await flushPromises();
    expect(w.find("[data-testid=voice-panel]").exists()).toBe(true);
    expect(w.find(".composer input").exists()).toBe(false);
    expect(w.emitted("send")?.[0]).toEqual(["提醒我下午买牛奶"]);
    w.unmount();
  });

  it("语音回复完成后朗读秘书的话", async () => {
    const speakReply = vi.fn(async (_text: string, _signal: AbortSignal) => {});
    let calls = 0;
    mockMic(() => {
      calls += 1;
      if (calls === 1) return { finish() {}, cancel() {}, result: Promise.resolve("V0FW") };
      return hangListen();
    });
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: false,
        pendingPropose: null,
        recognize: async () => "研究 AI 视频",
        speakReply,
      },
    });
    await w.get("[data-testid=mode-voice]").trigger("click");
    await flushPromises();
    expect(w.emitted("send")).toBeTruthy();
    await w.setProps({ awaiting: true });
    await flushPromises();
    await w.setProps({
      awaiting: false,
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "**研究 AI 视频**，先放以后。",
          createdAt: "2026-09-05T01:00:00.000Z",
          mode: "chat",
        },
      ],
    });
    await flushPromises();
    expect(speakReply).toHaveBeenCalled();
    expect(speakReply.mock.calls[0][0]).toContain("研究 AI 视频");
    w.unmount();
  });

  it("确认框还开着也可以朗读，关框后同一句不读第二遍", async () => {
    const speakReply = vi.fn(async (_text: string, _signal: AbortSignal) => {});
    let calls = 0;
    mockMic(() => {
      calls += 1;
      if (calls === 1) return { finish() {}, cancel() {}, result: Promise.resolve("V0FW") };
      return hangListen();
    });
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: false,
        pendingPropose: null,
        recognize: async () => "提醒我下午买牛奶",
        speakReply,
      },
    });
    await w.get("[data-testid=mode-voice]").trigger("click");
    await flushPromises();
    expect(w.emitted("send")).toBeTruthy();
    await w.setProps({ awaiting: true });
    await flushPromises();
    await w.setProps({
      awaiting: true,
      pendingPropose: [{ title: "买牛奶", when: "later" }],
      proposeKind: "later",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "先记下买牛奶。",
          createdAt: "2026-09-05T01:00:00.000Z",
          mode: "chat",
        },
      ],
    });
    await flushPromises();
    expect(speakReply).toHaveBeenCalledTimes(1);
    expect(speakReply.mock.calls[0][0]).toContain("买牛奶");
    const listensWhileSheet = calls;
    await new Promise((r) => setTimeout(r, 350));
    await flushPromises();
    expect(calls).toBe(listensWhileSheet);
    await w.setProps({ awaiting: false, pendingPropose: null });
    await flushPromises();
    expect(speakReply).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it("朗读失败不挡下一轮听，也不出识别那种红字", async () => {
    const speakReply = vi.fn(async (_text: string, _signal: AbortSignal) => {
      throw new Error("合成失败");
    });
    let calls = 0;
    mockMic(() => {
      calls += 1;
      if (calls === 1) return { finish() {}, cancel() {}, result: Promise.resolve("V0FW") };
      return hangListen();
    });
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: false,
        pendingPropose: null,
        recognize: async () => "买牛奶",
        speakReply,
      },
    });
    await w.get("[data-testid=mode-voice]").trigger("click");
    await flushPromises();
    await w.setProps({ awaiting: true });
    await flushPromises();
    await w.setProps({
      awaiting: false,
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "记下了。",
          createdAt: "2026-09-05T01:00:00.000Z",
          mode: "chat",
        },
      ],
    });
    await flushPromises();
    expect(speakReply).toHaveBeenCalled();
    expect(w.find("[data-voice-error]").exists()).toBe(false);
    await vi.waitFor(() => {
      expect(calls).toBeGreaterThan(1);
    });
    w.unmount();
  });

  it("打不开麦克风时展示真实错误，而不是一律说权限被拒绝", async () => {
    vi.mocked(openMicSession).mockRejectedValue(new Error("麦克风被占用，关掉其他录音应用后再试"));
    const w = mount(ChatScreen, {
      props: { messages: [], awaiting: false, pendingPropose: null, recognize: async () => "" },
    });
    await w.get("[data-testid=mode-voice]").trigger("click");
    await flushPromises();
    expect(w.get("[data-voice-error]").text()).toContain("被占用");
    expect(w.get("[data-voice-error]").text()).not.toContain("权限被拒绝");
    w.unmount();
  });

  it("识别失败展示错误文案", async () => {
    mockMic(() => ({
      finish() {},
      cancel() {},
      result: Promise.resolve("V0FW"),
    }));
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: false,
        pendingPropose: null,
        recognize: async () => {
          throw new Error("没听清，换个安静点的地方再说一次");
        },
      },
    });
    await w.get("[data-testid=mode-voice]").trigger("click");
    await flushPromises();
    expect(w.get("[data-voice-error]").text()).toContain("没听清");
    w.unmount();
  });
});

describe("ChatScreen", () => {
  it("explains that confirming today's plan clears this session", () => {
    const empty = mount(ChatScreen, {
      props: { messages: [], awaiting: false, pendingPropose: null },
    });
    expect(empty.text()).toContain("自动整理待办");
    expect(empty.text()).toContain("确认这次整理后这段会清掉，可以重新聊");

    const confirm = mount(ChatScreen, {
      props: {
        messages: [
          {
            id: "m1",
            role: "user",
            content: "支付宝必须今天弄完",
            createdAt: "2026-09-05T01:00:00.000Z",
          },
        ],
        awaiting: true,
        pendingPropose: [
          { title: "支付宝", when: "today" },
          { title: "周报", when: "later" },
          { title: "买机票", when: "later" },
        ],
        proposeKind: "today",
      },
    });
    expect(confirm.text()).toContain("这样排可以吗？");
    expect(confirm.text()).toContain("确认后这段对话会清空，可以重新聊");
    expect(confirm.text()).toMatch(/今天[\s\S]*支付宝/);
    expect(confirm.text()).toMatch(/以后[\s\S]*周报/);
    expect(confirm.text()).toContain("买机票");
  });

  it("later 确认框展示 急/截止/项目 徽标", () => {
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: true,
        pendingPropose: [{ title: "明天下午三点前交稿", when: "later", priority: "high", due: "2099-01-02", project: "接私活" }],
        proposeKind: "later",
      },
    });
    expect(w.text()).toContain("记到「以后」吗？");
    expect(w.text()).toContain("急");
    expect(w.text()).toContain("接私活");
  });

  it("流式气泡出现、增长、结束后被正式消息替换", async () => {
    const w = mount(ChatScreen, {
      props: { messages: [], awaiting: true, pendingPropose: null, streamingReply: "早" },
    });
    expect(w.get("[data-testid=streaming]").text()).toContain("早");
    expect(w.find(".stream-cursor").exists()).toBe(true);
    expect(w.find(".typing").exists()).toBe(false);

    await w.setProps({ streamingReply: "早。昨天还剩 2 件。" });
    expect(w.get("[data-testid=streaming]").text()).toContain("早。昨天还剩 2 件。");

    await w.setProps({
      streamingReply: null,
      awaiting: false,
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "早。昨天还剩 2 件。",
          createdAt: "2026-09-05T01:00:00.000Z",
        },
      ],
    });
    expect(w.find("[data-testid=streaming]").exists()).toBe(false);
    const agentMsgs = w.findAll(".msg.agent");
    expect(agentMsgs).toHaveLength(1);
    expect(agentMsgs[0].text()).toContain("早。昨天还剩 2 件。");
  });

  it("jumps to the bottom when opened with a long thread", async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      role: "user" as const,
      content: `第${i}句`,
      createdAt: "2026-09-05T01:00:00.000Z",
    }));
    const w = mount(ChatScreen, {
      props: { messages, awaiting: false, pendingPropose: null },
      attachTo: document.body,
    });
    const thread = w.get(".thread").element as HTMLElement;
    Object.defineProperty(thread, "scrollHeight", { configurable: true, get: () => 5000 });
    await w.setProps({ awaiting: true });
    await flushPromises();
    expect(thread.scrollTop).toBe(5000);
    w.unmount();
  });
});
