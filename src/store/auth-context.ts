import { createContext, useContext } from 'react';
import type { UserInfo } from '../api';

/**
 * 认证上下文与消费 Hook。
 *
 * 为什么不跟 AuthProvider 放一个文件：React Fast Refresh 要求「一个模块要么只导出组件，
 * 要么完全不导出组件」。useAuth 是小写函数，会被判定成非组件导出 —— 它和 AuthProvider
 * 同处一个模块时，每次改动都会让该模块的刷新边界失效（控制台报
 * "Could not Fast Refresh ("useAuth" export is incompatible)"）并退化成整页刷新。
 * 拆到本模块后这里没有任何组件导出，Vite 不会给它注入刷新边界，改这里不再报警告。
 */
export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface AuthContextType {
  /**
   * 当前登录用户信息，未登录时为 null。
   * 各页面统一用 `const { userInfo } = useAuth()` 获取。
   */
  userInfo: UserInfo | null;
  /** 登录态，路由守卫据此决定放行还是回登录页 */
  status: AuthStatus;
  /** 是否已通过后端确认（等价于 status === 'authenticated'） */
  isAuthenticated: boolean;
  /**
   * 登录：写入 token 并拉取用户信息。
   * 失败时抛出 ApiError（errmsg 可直接展示给用户）。
   */
  login: (username: string, password: string) => Promise<void>;
  /** 退出登录：清 token、清缓存，服务端登出失败不阻塞本地 */
  logout: () => void;
  /** 重新拉取当前用户信息，token 变化或资料更新后可用 */
  refreshUserInfo: () => Promise<UserInfo | null>;
}

/**
 * 登录态。
 *
 * - checking        本地有 token，正在向后端确认它是否仍然可用
 * - authenticated   后端确认通过，可以进主界面
 * - unauthenticated 没有 token，或 token 已被判定失效
 *
 * AuthStatus 的定义放在本模块（而不是 Provider 里），
 * 因为 Provider 与 Hook 都要引用它，而 Provider 需要保持「只导出组件」。
 */
export const AuthContext = createContext<AuthContextType>({
  userInfo: null,
  status: 'unauthenticated',
  isAuthenticated: false,
  login: async () => {},
  logout: () => {},
  refreshUserInfo: async () => null,
});

/** 全局用户信息的唯一入口 */
export const useAuth = () => useContext(AuthContext);
