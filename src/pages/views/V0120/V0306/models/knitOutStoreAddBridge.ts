import type {MisAppletsQRCodeData} from '@/api';
import type {UIBridgeHandler, UIDialogHost} from '@/pages/agent/ui-bridge';

export type KnitOutStoreAddBridgeContext = {
    billCode: string;
    billDate: string;
    createUser: string;
    barcode: string;
    rows: MisAppletsQRCodeData[];
    loading: boolean;
    setBarcode: (value: string) => void;
    addBarcode: (code: string) => Promise<void>;
    submit: () => Promise<void>;
    close: () => void;
};

function parseBarcode(params: Record<string, unknown>): string {
    if (typeof params.Barcode === 'string') return params.Barcode.trim();
    if (typeof params.barcode === 'string') return params.barcode.trim();
    const setMany = params.fields ?? params.values;
    if (setMany && typeof setMany === 'object' && !Array.isArray(setMany)) {
        const value = (setMany as Record<string, unknown>).Barcode;
        if (typeof value === 'string') return value.trim();
    }
    return '';
}

export function createKnitOutStoreAddBridge(read: () => KnitOutStoreAddBridgeContext): UIDialogHost {
    const handlers: Record<string, UIBridgeHandler> = {
        'form.set': async (params) => {
            const code = parseBarcode(params);
            if (!code) return '只支持写入 Barcode；请用 form.setMany 或 barcode.add';
            read().setBarcode(code);
            return `条码已写入：${code}`;
        },
        'form.setMany': async (params) => {
            const code = parseBarcode(params);
            if (!code) return '没有可写入的字段：请传 {Barcode:"..."}';
            read().setBarcode(code);
            return `条码已写入：${code}`;
        },
        'barcode.add': async (params) => {
            const code = typeof params.qrcode === 'string'
                ? params.qrcode.trim()
                : typeof params.code === 'string'
                    ? params.code.trim()
                    : '';
            if (!code) return '请传 qrcode';
            await read().addBarcode(code);
            return `已尝试添加条码 ${code}`;
        },
        'bill.submit': async () => {
            await read().submit();
            return '出库单已提交';
        },
        'form.cancel': () => read().close(),
    };
    return {
        snapshot: () => {
            const ctx = read();
            return {
                id: 'knitOutStoreAdd',
                title: '新增白坯出库单',
                mode: 'add',
                recordId: null,
                fields: [
                    {id: 'BillCode', label: '单据号', type: 'text', value: ctx.billCode, readOnly: true},
                    {id: 'BillDate', label: '制单日期', type: 'date', value: ctx.billDate, readOnly: true},
                    {id: 'CreateUser', label: '制单人', type: 'text', value: ctx.createUser, readOnly: true},
                    {
                        id: 'Barcode',
                        label: '条码',
                        type: 'text',
                        value: ctx.barcode,
                        hint: '输入后按回车或调用 barcode.add',
                    },
                    {
                        id: 'Rows',
                        label: '已扫描条码',
                        type: 'text',
                        value: JSON.stringify(ctx.rows),
                        readOnly: true,
                        hint: '当前扫描明细 JSON',
                    },
                ],
                errors: [],
            };
        },
        actions: () => [
            {
                id: 'barcode.add',
                label: '添加条码',
                group: 'form',
                params: [{name: 'qrcode', type: 'text', required: true, hint: '完整条码'}],
            },
            {id: 'bill.submit', label: '保存出库单', group: 'form'},
            {id: 'form.cancel', label: '关闭', group: 'form'},
        ],
        handlers,
        guide: {
            summary: '新增白坯出库单：逐条添加条码，核对扫描明细后保存',
            steps: [
                '先调用 barcode.add 传完整 qrcode；重复条码会被拒绝',
                '全部条码加载完后调用 bill.submit 保存',
                '保存成功后 BillCode 字段会显示生成的单据号',
            ],
            cautions: ['打印已按项目约定不迁。'],
        },
        ready: () => !read().loading,
    };
}
