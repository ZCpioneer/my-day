---
name: deploy-phone
description: Use when 要把 AI 日程秘书的最新构建推送或安装到用户的小米手机（推送到手机、打包发过去、装到手机、无线调试、adb install、assembleDebug、侧载 APK）
---

# 推送到手机（AI 日程秘书 APK → 小米手机）

## 环境事实（这台 Mac + 用户的小米手机）

- adb **不在 PATH**：一律用全路径 `"$HOME/Library/Android/sdk/platform-tools/adb"`。
- 系统**没有独立 JDK**：跑 gradlew 必须显式带 `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`（Android Studio 内置 JBR），否则报 `Unable to locate a Java Runtime`。
- 手机开着无线调试、与电脑同一 WiFi 时，adb 走 mDNS 自动连接，`adb devices` 里形如 `adb-xxxx._adb-tls-connect._tcp device`。看不到设备：让用户重开「开发者选项 → 无线调试」，再 `adb connect <手机IP>:<端口>`（端口在该页面里看，每次重开都会变）。

## 标准流程（2026-09-06 验证通过）

```bash
# 1. 构建 web（vue-tsc + vite）并把 dist 同步进安卓工程
npm run cap:sync

# 2. 打 debug APK（必须带 JAVA_HOME）
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug

# 3. 无线安装到手机（仓库根目录下执行）
"$HOME/Library/Android/sdk/platform-tools/adb" install -r android/app/build/outputs/apk/debug/app-debug.apk
```

- 三步可以串成一条后台命令一次跑完；第 2 步看到 `BUILD SUCCESSFUL`、第 3 步看到 `Performing Streamed Install` + `Success` 即成功。
- 改名后 appId 已从 `com.zhaomu.app` 换成 `com.aisecretary.app`：手机上新旧两个应用会并存，旧「朝暮」的数据不互通；确认新应用没问题后可 `adb uninstall com.zhaomu.app` 删掉旧应用。
- APK 产物：`android/app/build/outputs/apk/debug/app-debug.apk`（已被 .gitignore 忽略，不用管）。
- 有多台设备时第 3 步加 `-s <设备名>`。

## 验证与回报（做完必须给用户可核对的信息）

```bash
# 确认包装上
"$HOME/Library/Android/sdk/platform-tools/adb" shell pm list packages | grep aisecretary
# → package:com.aisecretary.app

# 取本次构建时间戳（构建时由 vite define 注入，见 src/build-info.ts）
grep -oE '"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z"' android/app/src/main/assets/public/assets/index-*.js | head -1
```

把这个 UTC 时间戳换算成本地时间告诉用户，让他在手机「设置」页底部核对「版本 x.y.z · 构建时间 …」——对得上就是最新包。

## 常见失败

| 现象 | 处理 |
|---|---|
| `Unable to locate a Java Runtime` | 忘了带 JAVA_HOME，用上面的 JBR 路径 |
| `adb devices` 为空 | 无线调试被关掉或换过网；让用户重开，再 `adb connect IP:端口` |
| `more than one device` | install 加 `-s <设备名>` |
| cap:sync 失败 | 先单独跑 `npm run build` 看类型错误 |
