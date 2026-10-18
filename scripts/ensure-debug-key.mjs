import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "src/debug/default-key.ts");
const src = join(root, "src/debug/default-key.example.ts");

if (!existsSync(src)) {
  console.error("缺少 src/debug/default-key.example.ts");
  process.exit(1);
}

if (!existsSync(dest)) {
  copyFileSync(src, dest);
  console.log("已从模板生成 src/debug/default-key.ts（空 Key，该文件已被 git 忽略）");
}
