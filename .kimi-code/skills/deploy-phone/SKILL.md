---
name: deploy-phone
description: Use when 要把 AI 日程秘书的最新构建推送或安装到用户的小米手机（推送到手机、打包发过去、装到手机、无线调试、adb install、assembleDebug、侧载 APK）
---

# 推送到手机（AI 日程秘书 APK → 小米手机）

## 环境事实（这台 Mac + 用户的小米手机）

- adb **不在 PATH**：一律用全路径 `"$HOME/Library/Android/sdk/platform-tools/adb"`。
- 系统**没有独立 JDK**：跑 gradlew 必须显式带 `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`（Android Studio 内置 JBR），否则报 `Unable to locate a Java Runtime`。
- 手机开着无线调试、与电脑同一 WiFi 时，adb 走 mDNS 自动连接，`adb devices` 里形如 `adb-xxxx._adb-tls-connect._tcp device`。
- **每次推送都要把下面两种连法都试一遍**（换 WiFi / 证书失效时只有配对能救；旧会话还活着时 mDNS 就能连）。连上后以 `adb devices` 里实际出现的那条为准。
- 设备名和 IP 每次以 `adb mdns services` / `adb devices -l` 的实际输出为准。不要把某一次的局域网地址或无线调试设备名写进仓库。

## 两种无线连法（每次都试）

`ADB="$HOME/Library/Android/sdk/platform-tools/adb"`，建议带 `ADB_MDNS_OPENSCREEN=1`。

**方法 A（旧，mDNS / 连接端口）**

无线调试主页面上的「IP:端口」是 **连接口**（不是配对口）。mDNS 服务 `_adb-tls-connect._tcp` 也会广播这个口。

```bash
"$ADB" mdns services
# 期望看到：adb-<设备>._adb-tls-connect._tcp  <IP>:<连接口>
"$ADB" connect <IP>:<连接口>
```

**方法 B（新，配对码）**

换 WiFi、adb 证书对不上、或方法 A 报 `SSLV3_ALERT_CERTIFICATE_UNKNOWN` / `failed to connect` 时用。用户从「开发者选项 → 无线调试 → 使用配对码配对设备」给 **配对地址** 和 **6 位配对码**（配对口 ≠ 连接口，每次都不一样）。

```bash
"$ADB" pair <IP>:<配对口> <6位码>
# Successfully paired … 之后再连连接口
"$ADB" connect <IP>:<连接口>
```

连接口可从 `adb mdns services` 的 `_adb-tls-connect._tcp` 读；配对成功后 mDNS 常常已经自动挂上设备。

两种都试完再 `adb devices -l`。同一台手机可能同时出现 `IP:连接口` 和 `adb-….\_adb-tls-connect._tcp` 两条——安装必须加 `-s <其中一条>`，否则 `more than one device`。

## 标准流程（2026-09-06 验证通过）

```bash
# 1. 构建 web（vue-tsc + vite）并把 dist 同步进安卓工程
npm run cap:sync

# 2. 打 debug APK（必须带 JAVA_HOME）
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug

# 3. 先按上面方法 A、方法 B 都试一遍，确认 adb devices 有设备
# 4. 无线安装到手机（仓库根目录下执行；多条 serial 时加 -s）
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
| `adb devices` 为空 | 先方法 A（mDNS / `adb connect IP:连接口`），再方法 B（让用户给配对地址+6 位码，`adb pair`） |
| `SSLV3_ALERT_CERTIFICATE_UNKNOWN` | 换过 WiFi 或证书失效；走方法 B 重新配对 |
| `failed to connect` 到配对口 | 配对口只能 `adb pair`，不能 `adb connect`；连接口才是 connect |
| `more than one device` | install 加 `-s <设备名>` |
| cap:sync 失败 | 先单独跑 `npm run build` 看类型错误 |
