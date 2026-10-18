import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execSync("git ls-files -z", { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbidden = new Set([
  "src/debug/default-key.ts",
  ".env",
]);

const binaryExt = /\.(png|jpe?g|gif|webp|ico|jar|apk|aab|dex|so|bin|woff2?|ttf|otf|pdf|zip|gz)$/i;
const secretRes = [
  /sk-[A-Za-z0-9._-]{24,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const problems = [];

function redact(token) {
  return `${token.slice(0, 4)}…(len=${token.length})`;
}

for (const file of files) {
  const base = file.split("/").pop() ?? file;
  if (forbidden.has(file) || base === ".env" || file.endsWith(".jks") || file.endsWith(".keystore") || file.endsWith(".pem") || file.endsWith(".p12")) {
    problems.push(`${file}: 这个文件不应被 git 跟踪`);
    continue;
  }
  if (binaryExt.test(file)) continue;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;

  if (file === "src/debug/default-key.example.ts") {
    if (!text.includes('DEFAULT_DEBUG_KEY = ""') || !text.includes('DEFAULT_DEBUG_ASR_KEY = ""')) {
      problems.push(`${file}: 模板里的 Key 必须是空字符串`);
    }
  }

  for (const re of secretRes) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const line = text.slice(0, match.index).split("\n").length;
      problems.push(`${file}:${line}: 疑似密钥 ${redact(match[0])}`);
    }
  }
}

if (problems.length) {
  console.error("密钥检查没有通过。下面只显示位置和掩码，不显示全文：");
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`已检查 ${files.length} 个被跟踪文件，没有发现 API Key 或私钥。`);
