import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ChatScreen from "@/screens/ChatScreen.vue";

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

  it("memory 确认框用记忆文案并展示类别标签", () => {
    const w = mount(ChatScreen, {
      props: {
        messages: [],
        awaiting: true,
        pendingPropose: [{ title: "早上不开会", tag: "偏好" }],
        proposeKind: "memory",
      },
    });
    expect(w.text()).toContain("记进长期记忆吗？");
    expect(w.text()).toContain("记住");
    expect(w.text()).toContain("偏好");
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
