import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import TodoScreen from "@/screens/TodoScreen.vue";
import { todoRepo, deleteDb } from "@/storage/db";

beforeEach(async () => {
  await deleteDb();
  await todoRepo.add({
    id: "t1",
    title: "给房东转水电费",
    status: "open",
    sourceDate: "2026-09-05",
    createdAt: "2026-09-05T01:00:00.000Z",
  });
});

describe("TodoScreen", () => {
  it("toggles a row into 已经勾掉", async () => {
    const w = mount(TodoScreen, {
      props: {
        todos: await todoRepo.list(),
      },
    });
    expect(w.text()).toContain("给房东转水电费");
    await w.get("[data-todo=t1]").trigger("click");
    // parent handles toggle in App; for unit test, TodoScreen emits toggle
    expect(w.emitted("toggle")?.[0]).toEqual(["t1"]);
  });
});
