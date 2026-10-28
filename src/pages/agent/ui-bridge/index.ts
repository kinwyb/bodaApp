/**
 * 界面桥出口。
 *
 * 五条使用路径：
 * - 工作台：`useWorkbenchBridge({ currentView, navigation, openView })`（在 MainLayout 里，常驻）
 * - 业务页面：`useUIBridgeHost(view, { snapshot, handlers, ready })` 把自己交给 agent
 * - 弹窗：`useUIBridgeDialog(view, { snapshot, actions, handlers }, open)` 打开时顶掉页面那层
 * - 表格的读写：`createTableBridge({ columns, readTable })` —— 列目录、行数、排序、按行号取数据
 *   都在这一层（页面只给列定义与 ref）
 * - 表单弹窗的读写：`createFormWriter` + `createFormWriteActions` / `createFormWriteHandlers`
 *   （批量字段、锁判断、类型转换、回执都在这一层，弹窗只给字段表与锁规则）
 * - 传输层装配：`transport.onUIRequest(createUIRequestHandler())`
 * - 协议结构：见 ../protocol/ui.ts
 */

export { createUIRequestHandler } from './handler';
export { currentRev } from './store';
export { bridgedViewPaths, isBridgedView } from './bridged';
export { createTableBridge } from './table';
export type { TableBridge, TableBridgeOptions } from './table';
export {
  createFormWriteActions,
  createFormWriteHandlers,
  createFormWriter,
  normalizeFieldValue,
  resolveFieldEntries,
  summarizeLabels,
  toAgentValue,
  toArrayParam,
} from './form';
export type {
  FieldEntry,
  FieldOutcome,
  FormFieldSpec,
  FormWriter,
  FormWriterOptions,
  SequencedFieldSpec,
} from './form';
export type { UIBridgeHandler, UIBridgeHost, UIDialogHost, UIWorkbenchHost } from './types';
export { useUIBridgeDialog, useUIBridgeHost, useWorkbenchBridge } from './use-ui-bridge-host';
