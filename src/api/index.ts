/**
 * 接口层：对后端 API 的纯封装（请求 + 响应类型），不含业务逻辑。
 * 业务逻辑（跨接口加工、领域规则）放 @/services。
 */
export * from './types';
export {
  ApiError,
  clearToken,
  getToken,
  http,
  isUnauthorizedError,
  onSessionExpired,
  request,
  setToken,
} from './request';
export { powerApi } from './modules/power.ts';
export type { DesktopMenu, UserMenu } from './modules/power.ts';
export { viewApi } from './modules/view';
export type { ViewRow, ViewRowQuery, ViewRowStatus } from './modules/view';
export { yupaiApi, YupaiMachineSizeHeader } from './modules/yupai.ts';
export type { YupaiOrderQuery, YupaiOrder, YupaiOrderDto } from './modules/yupai.ts';
export { employeeApi } from './modules/employee';
export type { EmployeeQuery, EmployeeRecord } from './modules/employee';
export { loginApi } from './modules/login';
export type { UserInfo, LoginParams } from './modules/login';
export { sqlApi,S,N,B,D } from './modules/sql';
export type { SQLResult,SQLProcedure,SQLQuery } from './modules/sql';
