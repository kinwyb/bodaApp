import {z} from 'zod';
import {http} from '../request';
import {DepartmentSchema} from '../schemas/config/department';

/**
 * 部门保存入参（旧客户端 `Models/Config.cs` 的 `DepartmentSaveRequest`）。
 *
 * 新增与修改共用一个接口，靠 `ID` 是否为空区分：空 = 新增。
 */
export type DepartmentSaveRequest = {
    ID?: string | null;
    No?: string | null;
    Name?: string | null;
    ParentID?: string | null;
    ParentName?: string | null;
    Attribute?: string | null;
    ContactUser?: string | null;
    Code?: string | null;
    Visible?: boolean | null;
};

export const configApi = {
    orderCodes: () => http.get<string[]>('/orderCodes'),

    /**
     * 部门树（旧客户端 `ConfigAPI.departmentList`）。
     * @param isAll 1 = 含「不显示」的部门（部门设定页用），0 = 只回显示的部门（员工选择等用）
     */
    departments: (isAll: 0 | 1) =>
        http.getSchema('/department', DepartmentSchema.array(), {isAll}),

    /** 部门保存（旧客户端 `ConfigAPI.departmentSave`），返回体只有 code / errmsg 与一段字符串 */
    saveDepartment: (request: DepartmentSaveRequest) =>
        http.postSchema('/department/save', z.string().nullish(), request),

    /** 部门删除（旧客户端 `ConfigAPI.departmentDelete`） */
    deleteDepartment: (departmentID: string) =>
        http.deleteSchema('/department', z.string().nullish(), {departmentID}),
};
