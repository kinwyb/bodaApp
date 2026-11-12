import {useSyncExternalStore} from 'react';
import {getServiceOrgSnapshot, subscribeServiceOrg} from '@/utils/service-org';

/**
 * 当前服务器组织的 React 绑定。状态本体在 @/utils/service-org（请求层也要用，
 * 且不能依赖 React），这里只把它接进 useSyncExternalStore。
 *
 * 与 permission-context 同样的拆分理由：本文件不导出组件，Fast Refresh 边界干净。
 */

/** 当前组织 ID；空串表示未知（此时菜单不做组织过滤） */
export function useServiceOrg(): string {
  return useSyncExternalStore(subscribeServiceOrg, () => getServiceOrgSnapshot().orgId);
}

/**
 * 组织切换计数。只在 app 设置窗口显式切换组织时 +1：
 * PermissionProvider 用它触发菜单重拉，MainLayout 用它刷新页签。
 */
export function useOrgEpoch(): number {
  return useSyncExternalStore(subscribeServiceOrg, () => getServiceOrgSnapshot().epoch);
}
