import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aisecretary.app",
  appName: "AI 日程秘书",
  webDir: "dist",
  android: { allowMixedContent: false },
  plugins: {
    // 关掉 CapacitorHttp 的 fetch patch：DeepSeek 已全量放开 CORS（原生 WebView 与浏览器
    // 都能裸 fetch 直连），不再需要它绕跨域；而 enabled 时它会 monkey-patch window.fetch、
    // 把整个响应缓冲完才返回，正好破坏 SSE 流式输出。
    CapacitorHttp: { enabled: false },
  },
};

export default config;
