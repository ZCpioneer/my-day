import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aisecretary.app",
  appName: "AI 日程秘书",
  webDir: "dist",
  android: { allowMixedContent: false },
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
