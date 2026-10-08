import { http } from '../request';
import type { PageQuery } from '../types';

export interface EmployeeQuery extends PageQuery {
  /** 工号 / 姓名 / 部门关键字 */
  keyword?: string;
  /** 部门 id */
  departmentId?: string;
}

/** 员工记录，字段与后端 /employees 返回一致 */
export interface EmployeeRecord {
  /** 工号 */
  EmployeeNo: string;
  /** 姓名 */
  EmployeeName: string;
  /** 部门名称 */
  DepartmentName: string;
  /** 部门 id */
  DepartmentID?: string;
  /** 其余字段按原样保留 */
  [key: string]: unknown;
}

export const employeeApi = {
  list: (query: EmployeeQuery = {}) => http.get<EmployeeRecord[]>('/employees', query),
};
