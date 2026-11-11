import { defineConfig } from "mygo-cli";
import { readFileSync } from "node:fs";

// 版本号的单一来源是项目根的 package.json，避免两处各写一份导致漂移。
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

// MyGo 以本目录（app/）作为项目根，打包相关的代码与配置全部收在这里。
// web 前端仍住在项目根，因此下面几条路径都用 ".." 指回去。
export default defineConfig({
  name: "bodaWay",
  identifier: "com.bodaway.app",
  version: pkg.version,

  // 应用图标：1024x1024 PNG，打包时由 CLI 转成 .icns 塞进 app bundle。
  // 图形构成：工业六边形（生产系统）+ 中心对话气泡里的青色三节点网络（agent）。
  // 源图是白底圆角矩形，已处理成透明四角、内容占 824/1024（macOS 规范）。
  icon: "resources/icon.png",

  // 开发：由 mygo dev 拉起 Vite dev server，并把窗口指向它。
  // 这两个脚本定义在项目根的 package.json 里。
  devUrl: "http://localhost:5173",
  devCommand: "npm --prefix .. run dev",

  // 打包：先构建前端，再把 frontendDist 内嵌进可执行文件。
  buildCommand: "npm --prefix .. run build",
  frontendDist: "../dist",
});
