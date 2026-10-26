/**
 * 界面桥出口。
 *
 * 四条使用路径：
 * - 工作台：`useWorkbenchBridge({ currentView, navigation, openView })`（在 MainLayout 里，常驻）
 * - 业务页面：`useUIBridgeHost(view, { snapshot, handlers, ready })` 把自己交给 agent
 * - 传输层装配：`transport.onUIRequest(createUIRequestHandler())`
 * - 协议结构：见 ../protocol/ui.ts
 */

export { createUIRequestHandler } from './handler';
export { currentRev } from './store';
export type { UIBridgeHandler, UIBridgeHost, UIWorkbenchHost } from './types';
export { useUIBridgeHost, useWorkbenchBridge } from './use-ui-bridge-host';
