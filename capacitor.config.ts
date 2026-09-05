import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zhaomu.app",
  appName: "朝暮",
  webDir: "dist",
  android: { allowMixedContent: false },
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
