/**
 * V0326 织造明细弹窗的界面桥（只读明细，参照 `V0120/MachRateModal` 的只读弹窗模式）：
 * 打开期间顶掉页面的 actions / query / tables，关闭后自动回到页面层。
 * 只放常量与纯函数；弹窗组件在 `zzDetail.tsx`。
 */
import type {UIDialogHost} from '@/pages/agent/ui-bridge';
import type {ZZDetailRow} from './zzDetailColumns';

export type ZZDetailBridgeContext = {
    startDate: string;
    endDate: string;
    orgName: string;
    rows: ZZDetailRow[];
    loading: boolean;
    reload: () => Promise<void>;
    onClose: () => void;
};

export function createZZDetailBridge(read: () => ZZDetailBridgeContext): UIDialogHost {
    return {
        snapshot: () => {
            const ctx = read();
            return {
                id: 'zzDetail',
                title: `织造明细（${ctx.startDate} ~ ${ctx.endDate} · ${ctx.orgName}）`,
                mode: 'view',
                recordId: `${ctx.startDate}|${ctx.endDate}|${ctx.orgName}`,
                fields: [
                    {id: 'StartDate', label: '开始日期', type: 'text', value: ctx.startDate, readOnly: true},
                    {id: 'EndDate', label: '结束日期', type: 'text', value: ctx.endDate, readOnly: true},
                    {id: 'Org', label: '组织', type: 'text', value: ctx.orgName, readOnly: true},
                    {
                        id: 'Rows',
                        label: '织造明细',
                        type: 'text',
                        value: JSON.stringify(ctx.rows),
                        readOnly: true,
                        hint: '只读明细 JSON：机型(MSize)、织造总数、机器工时、产出工时、机台效率、机台利用率',
                    },
                ],
                errors: [],
            };
        },
        actions: () => [
            {id: 'detail.reload', label: '重新加载明细', group: 'form'},
            {id: 'form.cancel', label: '关闭', group: 'form'},
        ],
        handlers: {
            'detail.reload': async () => {
                await read().reload();
                return '织造明细已重新加载';
            },
            'form.cancel': () => {
                read().onClose();
                return '已关闭织造明细';
            },
        },
        guide: {
            summary: '织造明细：查看某一周、某一组织按机型拆分的织造总数、工时、机台效率与利用率',
            cautions: [
                '弹窗只读；Rows 字段是当前明细的 JSON 投影，效率/利用率是接口原值（未做百分数换算）',
                '明细来自 SQL 直查 transitDB.ProductionWeekData（DataType=2），与主表同一数据源',
            ],
        },
        ready: () => !read().loading,
    };
}
