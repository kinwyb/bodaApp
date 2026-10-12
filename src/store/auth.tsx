import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  clearToken,
  getToken,
  loginApi,
  onSessionExpired,
  setToken,
  type ApiResponse,
  type UserInfo,
} from '../api';

/**
 * 用户信息缓存键：凭据有效时先用它渲染，避免首屏空白。
 *
 * 注意它只是「渲染用的缓存」，不是登录态的依据 ——
 * 登录态一律以「后端确认过的 token」为准（见 AuthStatus）。
 */
const USER_INFO_KEY = 'boda_user';

/**
 * 登录态。
 *
 * - checking        本地有 token，正在向后端确认它是否仍然可用
 * - authenticated   后端确认通过，可以进主界面
 * - unauthenticated 没有 token，或 token 已被判定失效
 */
export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthContextType {
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

const AuthContext = createContext<AuthContextType>({
  userInfo: null,
  status: 'unauthenticated',
  isAuthenticated: false,
  login: async () => {},
  logout: () => {},
  refreshUserInfo: async () => null,
});

/** 全局用户信息的唯一入口 */
export const useAuth = () => useContext(AuthContext);

function readCachedUserInfo(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_INFO_KEY);
    return raw ? (JSON.parse(raw) as UserInfo) : null;
  } catch {
    // 缓存被写坏时直接丢弃，不影响登录流程
    return null;
  }
}

function writeCachedUserInfo(info: UserInfo | null): void {
  if (info) {
    localStorage.setItem(USER_INFO_KEY, JSON.stringify(info));
  } else {
    localStorage.removeItem(USER_INFO_KEY);
  }
}

/**
 * 启动校验用的用户信息请求。
 *
 * 放在模块级是为了让 StrictMode 下挂载期跑两遍的 effect 复用同一个请求：
 * 少打一次接口，且两次执行拿到的是同一份结果。
 */
let bootstrapUserInfoRequest: Promise<ApiResponse<UserInfo>> | null = null;

function fetchUserInfoOnce(): Promise<ApiResponse<UserInfo>> {
  bootstrapUserInfoRequest ??= loginApi.userInfo();
  return bootstrapUserInfoRequest;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 初始态：没有 token 直接就是未登录；有 token 则先挂起，等后端确认后再放行。
  // 这样「重启后带着失效 token」不会先闪进主界面再被接口错误淹没。
  const [status, setStatus] = useState<AuthStatus>(() =>
    getToken() ? 'checking' : 'unauthenticated',
  );
  const [userInfo, setUserInfo] = useState<UserInfo | null>(readCachedUserInfo);

  const applyUserInfo = useCallback((info: UserInfo | null) => {
    setUserInfo(info);
    writeCachedUserInfo(info);
  }, []);

  /** 判定登录态作废：清凭证与缓存。所有「token 不可用」的路径都收敛到这里。 */
  const clearSession = useCallback(() => {
    clearToken();
    applyUserInfo(null);
    setStatus('unauthenticated');
  }, [applyUserInfo]);

  // 其它接口若返回未授权，请求层会广播过来 —— 不必等下次启动校验
  // （例如 token 在页面停留期间过期，下一次查询就会把用户带回登录页）。
  useEffect(() => onSessionExpired(clearSession), [clearSession]);

  const refreshUserInfo = useCallback(async (): Promise<UserInfo | null> => {
    // 没有凭证时直接返回；userInfo 的清理由 clearSession 负责，
    // 这里不写同步 setState，避免 effect 首次执行时引发级联渲染
    if (!getToken()) return null;
    try {
      const res = await loginApi.userInfo();
      applyUserInfo(res.data ?? null);
      return res.data ?? null;
    } catch {
      // 拉取失败时保留已有缓存，是否登出交给调用方判断
      return null;
    }
  }, [applyUserInfo]);

  const login = useCallback(
    async (username: string, password: string): Promise<void> => {
      const res = await loginApi.login({ username, password });
      const nextToken = res.data ?? '';
      if (!nextToken) {
        throw new ApiError(-1, '登录接口未返回凭证');
      }
      setToken(nextToken);
      // 换了凭证就要拿新用户的资料，作废旧缓存
      bootstrapUserInfoRequest = null;
      try {
        const info = await fetchUserInfoOnce();
        applyUserInfo(info.data ?? null);
      } catch (error) {
        // 拿到 token 却取不到用户信息，等于没登录成功
        clearSession();
        throw error;
      }
      setStatus('authenticated');
    },
    [applyUserInfo, clearSession],
  );

  const logout = useCallback(() => {
    // 先发登出请求：request 内部同步读取 token，因此必须早于 clearToken();
    void loginApi.logout().catch(() => undefined);
    bootstrapUserInfoRequest = null;
    clearSession();
  }, [clearSession]);

  /**
   * 启动校验（含重启、刷新页面）。
   *
   * 本地有 token 时向后端换一次用户信息：
   *   - 成功 → 直接进主界面，无需再登录；
   *   - 抛异常 → 按约定视为「token 已失效」，清掉凭据退回登录页。
   */
  useEffect(() => {
    if (status !== 'checking') return;
    let cancelled = false;
    fetchUserInfoOnce()
      .then((res) => {
        if (cancelled) return;
        applyUserInfo(res.data ?? null);
        setStatus('authenticated');
      })
      .catch(() => {
        // 同理：失败即失效，不保留疑似无用的 token，避免下次启动重复失败一轮
        bootstrapUserInfoRequest = null;
        if (cancelled) return;
        clearSession();
      });
    return () => {
      cancelled = true;
    };
  }, [status, applyUserInfo, clearSession]);

  const isAuthenticated = status === 'authenticated';

  const value = useMemo<AuthContextType>(
    () => ({ userInfo, status, isAuthenticated, login, logout, refreshUserInfo }),
    [userInfo, status, isAuthenticated, login, logout, refreshUserInfo],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
