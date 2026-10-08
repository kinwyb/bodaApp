import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearToken, getToken, loginApi, setToken, type UserInfo } from '../api';

/** 用户信息缓存键：刷新页面时先取它渲染，避免首屏空白 */
const USER_INFO_KEY = 'boda_user';

interface AuthContextType {
  /**
   * 当前登录用户信息，未登录时为 null。
   * 各页面统一用 `const { userInfo } = useAuth()` 获取。
   */
  userInfo: UserInfo | null;
  /** 是否已登录（以本地是否存在 token 为准） */
  isAuthenticated: boolean;
  /** 登录：成功后写入 token 并拉取用户信息 */
  login: (username: string, password: string) => Promise<boolean>;
  /** 退出登录：清 token、清缓存，服务端登出失败不阻塞本地 */
  logout: () => void;
  /** 重新拉取当前用户信息，token 变化或资料更新后可用 */
  refreshUserInfo: () => Promise<UserInfo | null>;
}

const AuthContext = createContext<AuthContextType>({
  userInfo: null,
  isAuthenticated: false,
  login: async () => false,
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [userInfo, setUserInfo] = useState<UserInfo | null>(readCachedUserInfo);

  const isAuthenticated = !!token;

  const applyUserInfo = useCallback((info: UserInfo | null) => {
    setUserInfo(info);
    writeCachedUserInfo(info);
  }, []);

  const refreshUserInfo = useCallback(async (): Promise<UserInfo | null> => {
    // 没有凭证时直接返回；userInfo 的清理由 logout 负责，
    // 这里不写同步 setState，避免 effect 首次执行时引发级联渲染
    if (!getToken()) return null;
    try {
      const res = await loginApi.userInfo();
      applyUserInfo(res.data);
      return res.data;
    } catch {
      // 拉取失败时保留已有缓存，是否登出交给调用方判断
      return null;
    }
  }, [applyUserInfo]);

  const login = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      try {
        const res = await loginApi.login({ username, password });
        const nextToken = res.data ?? '';
        if (!nextToken) return false;
        setToken(nextToken);
        setTokenState(nextToken);
        await refreshUserInfo();
        return true;
      } catch {
        return false;
      }
    },
    [refreshUserInfo],
  );

  const logout = useCallback(() => {
    void loginApi.logout().catch(() => undefined);
    clearToken();
    setTokenState(null);
    applyUserInfo(null);
  }, [applyUserInfo]);

  // 带 token 进入（含刷新页面）时补拉一次，保证信息是最新的。
  // 这里刻意不调用 refreshUserInfo：effect 内必须让 setState 落在异步回调里，
  // 否则会命中 react/set-state-in-effect（同步 setState 引发级联渲染）。
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    loginApi
      .userInfo()
      .then((res) => {
        if (!cancelled) applyUserInfo(res.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applyUserInfo]);

  const value = useMemo<AuthContextType>(
    () => ({ userInfo, isAuthenticated, login, logout, refreshUserInfo }),
    [userInfo, isAuthenticated, login, logout, refreshUserInfo],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
