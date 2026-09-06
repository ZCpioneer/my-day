import { describe, expect, it } from "vitest";
import { normKey } from "@/norm";

describe("normKey", () => {
  it("忽略空白与大小写", () => {
    expect(normKey(" 给房东 转水电费 ")).toBe("给房东转水电费");
    expect(normKey("Postgres DB")).toBe("postgresdb");
  });
});
