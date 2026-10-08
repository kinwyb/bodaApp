/**
 * 业务逻辑层：跨接口的数据加工、领域规则计算（纯函数为主）。
 * 接口请求一律走 @/api，这里不直接发请求。
 */
export {
  applyMenuPermission,
  buildPermissionIndex,
  isNavigableMenu,
  splitViewPath,
} from './permission';
export type {MenuActionItem, MenuPermissionResult, PermissionIndex} from './permission';
