/**
 * V0372 织造明细弹窗的界面桥（只读明细）：打开期间顶掉页面层，关闭后自动恢复。
 * 只放常量与纯函数；弹窗组件在 `zzDetail.tsx`。
 */
import type {UIDialogHost} from '@/pages/agent/ui-bridge';
import type {ZZMonthDetailRow} from './zzDetailColumns';

export type ZZMonthDetailBridgeContext = {
    startDate: string;
    endDate: string;
    rows: ZZMonthDetailRow[];
    loading: boolean;
    reload: () => Promise<void>;
    onClose: () => void;
};

export function createZZMonthDetailBridge(read: () => ZZMonthDetailBridgeContext): UIDialogHost {
    return {
        snapshot: () => {
            const ctx = read();
            return {
                id: 'zzMonthDetail',
                title: `织造明细（${ctx.startDate} ~ ${ctx.endDate} · 越南）`,
                mode: 'view',
                recordId: `${ctx.startDate}|${ctx.endDate}`,
                fields: [
                    {id: 'StartDate', label: '开始日期', type: 'text', value: ctx.startDate, readOnly: true},
                    {id: 'EndDate', label: '结束日期', type: 'text', value: ctx.endDate, readOnly: true},
                    {
                        id: 'Rows',
                        label: '织造明细',
                        type: 'text',
                        value: JSON.stringify(ctx.rows),
                        readOnly: true,
                        hint: '只读明细 JSON：开始/结束日期、机型、机器数量、机台工时、织造产量、织造次品数量、织造次品率、产出工时、产出效率、机台利用率',
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
            summary: '织造明细：查看越南某一月按机型拆分的织造产量、次品、工时、效率与机台利用率（存储过程 Query_BJZZMachineTypeData）',
            cautions: [
                '弹窗只读；Rows 字段是当前明细的 JSON 投影，比率字段是过程原值（未做百分数换算）',
                '只有越南组织有这份明细（旧客户端双击判断里限定了 VN）',
            ],
        },
        ready: () => !read().loading,
    };
}
