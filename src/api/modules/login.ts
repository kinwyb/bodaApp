import { http } from '../request';

/**
 * 当前登录用户信息，字段与后端 LoginUserInfo 一一对应。
 *
 */
export interface UserInfo {
  /** 员工工号 */
  EmpID: string;
  /** 员工名称 */
  EmpName: string;
  /** 用户 IP */
  IP: string;
  /** 用户唯一 ID */
  UserID: string;
  /** 允许访问的部门数据 ID */
  RoleDepartmentIDs: string[];
  /** 允许访问的部门数据编号 */
  RoleDepartmentNos: string[];
  /** 用户所属部门 ID */
  DepartmentID: string;
}

/** 登录入参 */
export interface LoginParams {
  username: string;
  password: string;
}

export const loginApi = {
  /** 登录，成功返回 token 等凭证 */
  login: (payload: LoginParams) => http.post<string>('/login', payload),
  /** 获取当前登录用户信息，凭证由请求头 Authorization 携带 */
  userInfo: () => http.get<UserInfo>('/login/userInfo'),
  /** 退出登录 */
  logout: () => http.post<null>('/login/loginout', {}),
};
