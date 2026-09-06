import { Capacitor } from "@capacitor/core";
import { createApp } from "vue";
import App from "./App.vue";
import { startKeyboardInset } from "./keyboard-inset";
import "./styles.css";

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("native");
}
startKeyboardInset();
createApp(App).mount("#app");
