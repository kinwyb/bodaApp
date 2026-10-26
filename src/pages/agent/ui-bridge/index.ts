/**
 * 界面桥出口。
 *
 * 三条使用路径：
 * - 页面：`useUIBridgeHost({ snapshot, handlers })` 把自己交给 agent
 * - 传输层装配：`transport.onUIRequest(createUIRequestHandler())`
 * - 协议结构：见 ../protocol/ui.ts
 */

export { createUIRequestHandler } from './handler';
export { currentRev } from './store';
export type { UIBridgeHandler, UIBridgeHost } from './types';
export { useUIBridgeHost } from './use-ui-bridge-host';
