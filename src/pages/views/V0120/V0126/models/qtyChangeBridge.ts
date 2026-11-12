import type {UIBridgeHandler, UIDialogHost} from '@/pages/agent/ui-bridge';

export type QtyChangeBridgeContext = {
    date: string;
    machCode: string;
    dispatchNo: string;
    employeeName: string;
    oldQty: number;
    newQty: string;
    loading: boolean;
    error?: string;
    setNewQty: (value: string) => void;
    submit: () => Promise<void>;
    close: () => void;
};

export function createQtyChangeBridge(read: () => QtyChangeBridgeContext): UIDialogHost {
    const handlers: Record<string, UIBridgeHandler> = {
        'form.set': async (params) => {
            if (params.newQty === undefined) return '请传 newQty';
            read().setNewQty(String(params.newQty));
            return `新数量已设为 ${params.newQty}`;
        },
        'form.setMany': async (params) => {
            const source = typeof params.fields === 'string' ? JSON.parse(params.fields) as Record<string, unknown> : params.fields;
            const value = source && typeof source === 'object' ? (source as Record<string, unknown>).newQty : undefined;
            if (value === undefined) return '请传 {"newQty": 数字}';
            read().setNewQty(String(value));
            return `新数量已设为 ${value}`;
        },
        'form.submit': async () => {
            await read().submit();
            return '挡车数量已修改';
        },
        'form.cancel': () => read().close(),
    };
    return {
        snapshot: () => {
            const ctx = read();
            return {
                id: 'produceQtyChange',
                title: '修改挡车数量',
                mode: 'edit',
                recordId: null,
                fields: [
                    {id: 'date', label: '日期', type: 'text', value: ctx.date, readOnly: true},
                    {id: 'machCode', label: '机台号', type: 'text', value: ctx.machCode, readOnly: true},
                    {id: 'dispatchNo', label: '派工单号', type: 'text', value: ctx.dispatchNo, readOnly: true},
                    {id: 'employeeName', label: '挡车工', type: 'text', value: ctx.employeeName, readOnly: true},
                    {id: 'oldQty', label: '原数量', type: 'number', value: ctx.oldQty, readOnly: true},
                    {id: 'newQty', label: '新数量', type: 'number', value: ctx.newQty, errors: ctx.error ? [ctx.error] : undefined},
                ],
                errors: ctx.error ? [ctx.error] : [],
            };
        },
        actions: () => [
            {id: 'form.submit', label: '保存', group: 'form'},
            {id: 'form.cancel', label: '取消', group: 'form'},
        ],
        handlers,
        guide: {
            summary: '修改选中挡车扫描记录的产量',
            steps: ['先 form.setMany 或 form.set 写入 newQty，再 form.submit'],
            cautions: ['新数量必须是非负整数。'],
        },
        ready: () => !read().loading,
    };
}
