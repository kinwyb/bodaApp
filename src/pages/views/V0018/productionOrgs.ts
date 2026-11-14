/**
 * 生产报表页共用的组织 hook：`useProductionOrgs` 对应旧客户端启动时
 * `LoginAPI.UserOrgs()` 加载的 `OrgID.orgs`，三个页面（V0326/V0332/V0372）的
 * 组织下拉/多选都从这份列表取候选，模块级缓存保证多个页签只查一次；
 * `useCurrentOrg` 提供默认选中用的当前系统组织。
 */
import {useEffect, useState} from 'react';
import {App} from 'antd';
import {loginApi, type UserOrg} from '@/api';
import {ErrorMessage} from '@/api/request';
import {useAuth} from '@/store/auth-context';
import {useServiceOrg} from '@/store/service-org';
import {isExcludedOrgName} from './productionShared';

/**
 * 当前系统组织：优先 Service-Org 响应头 store（与顶栏组织标签同源），
 * 部署没带响应头时回退登录 store 的 userInfo.OrgID —— 登录后它一定有值，
 * 保证报表页默认选中的始终是「当前系统的组织」而不是写死的义乌。
 */
export function useCurrentOrg(): string {
    const serviceOrg = useServiceOrg();
    const {userInfo} = useAuth();
    return serviceOrg || userInfo?.OrgID || '';
}

let orgsPromise: Promise<UserOrg[]> | null = null;

function loadOrgs(): Promise<UserOrg[]> {
    orgsPromise ??= loginApi.userOrgs()
        // 收到组织数据后先过滤：名称含「山西」的组织不进入任何候选（需求：山西组织不需要）
        .then((res) => (res.data ?? []).filter((org) => !isExcludedOrgName(org.OrgName)))
        .catch((error: unknown) => {
            // 失败不缓存，下个页面挂载时还能重试
            orgsPromise = null;
            throw error;
        });
    return orgsPromise;
}

export function useProductionOrgs(): {orgs: UserOrg[]; loading: boolean} {
    const {message} = App.useApp();
    const [orgs, setOrgs] = useState<UserOrg[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        loadOrgs()
            .then((list) => {
                if (alive) setOrgs(list);
            })
            .catch((error: unknown) => {
                if (alive) void message.error(ErrorMessage(error, '组织信息加载失败'));
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [message]);

    return {orgs, loading};
}
