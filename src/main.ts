import { mount } from "svelte";
import App from "./App.svelte";
import { installGlobalErrorHandlers } from "./lib/services/error-reporting";
import "@xterm/xterm/css/xterm.css";

installGlobalErrorHandlers();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
