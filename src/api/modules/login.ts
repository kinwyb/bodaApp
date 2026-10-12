import { http } from '../request';
import { toHexString } from '../../utils';

/**
 * 当前登录用户信息，与后端 `/login/userInfo` 返回的 data 一一对应（2026-10-12 实测）。
 *
 * 末尾的 `Tracing` / `ServerMode` / `SQLTraceID` … 是后端在每个响应里统一注入的请求上下文，
 * 不是用户资料，前端一般不关心；一并声明是为了排查问题时能直接看到。
 */
export interface UserInfo {
  /**
   * 当前会话凭证。与登录接口返回的 token 相同，只是后端回显 ——
   * 真正用于请求的是 localStorage 里那份（见 request.ts 的 TOKEN_KEY）。
   */
  Token: string;
  /** 用户唯一 ID（GUID） */
  UserID: string;
  /** 员工工号 */
  EmpID: string;
  /** 员工名称 */
  EmpName: string;
  /** 所属组织 ID */
  OrgID: string;
  /** 车间编号，未设置时是空串 */
  RoomCode: string;
  /** 用户 IP，多网卡时是逗号分隔的多个地址（如 "10.0.110.80, 192.168.9.9"） */
  IP: string;
  /** 角色 ID 列表，无角色时为 null */
  RoleIDs: string[] | null;
  /** 允许访问的部门数据 ID，无授权时为 null */
  RoleDepartmentIDs: string[] | null;
  /** 允许访问的部门数据编号，无授权时为 null */
  RoleDepartmentNos: string[] | null;
  /** 所属组织信息，实测为 null，结构未观测到 —— 真要使用前先打日志确认形状 */
  Orgs: unknown;

  // —— 以下为后端统一注入的请求上下文 ——
  Tracing: boolean;
  ServerMode: string;
  RequestUniqID: string;
  RequestSucc: boolean;
  Language: string;
  SQLTraceID: string;
}

/** 登录入参 */
export interface LoginParams {
  username: string;
  password: string;
}

export const loginApi = {
  /**
   * 登录，成功返回 token 等凭证。
   *
   * 两处后端约定（2026-10-12 实测，传错会被判成「参数缺失」而不是报格式错）：
   * - 请求体是 form 表单编码，不是 JSON：传 JSON 返回「username参数缺失」；
   * - password 必须传 hex 字符串：传明文返回「password参数缺失」。
   */
  login: (payload: LoginParams) =>
    http.post<string>(
      '/login',
      { username: payload.username, password: toHexString(payload.password) },
      { contentType: 'form' },
    ),
  /** 获取当前登录用户信息，凭证由请求头 token 携带 */
  userInfo: () => http.get<UserInfo>('/login/userInfo'),
  /** 退出登录 */
  logout: () => http.post<null>('/login/loginout', {}),
};
