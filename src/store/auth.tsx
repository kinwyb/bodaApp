import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface UserInfo {
  username: string;
  avatar?: string;
}

interface AuthContextType {
  user: UserInfo | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  login: async () => false,
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(() => {
    const saved = localStorage.getItem('boda_user');
    return saved ? JSON.parse(saved) : null;
  });

  const isAuthenticated = !!user;

  const login = useCallback(async (username: string, _password: string): Promise<boolean> => {
    // Mock login - accept any credentials
    await new Promise((resolve) => setTimeout(resolve, 800));
    const userInfo: UserInfo = { username };
    setUser(userInfo);
    localStorage.setItem('boda_user', JSON.stringify(userInfo));
    return true;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('boda_user');
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem('boda_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('boda_user');
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
