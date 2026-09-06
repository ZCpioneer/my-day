// 构建信息由 vite.config.ts 的 define 在打包时注入；测试 / 开发环境走回退值。
declare const __APP_VERSION__: string | undefined;
declare const __BUILD_ISO__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
export const BUILD_ISO: string = typeof __BUILD_ISO__ === "string" ? __BUILD_ISO__ : "";

/** ISO 时间戳 → 本地时间，精确到秒；无法解析时返回空串。 */
export function formatBuildTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const BUILD_LABEL = `版本 ${APP_VERSION} · 构建时间 ${formatBuildTime(BUILD_ISO) || "未知（开发模式）"}`;
