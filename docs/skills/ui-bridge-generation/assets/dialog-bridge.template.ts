import type {FormInstance} from 'antd';
import type {UIField, UIForm, UIGuide} from '@/pages/agent/protocol';
import {
    createFormWriteActions,
    createFormWriteHandlers,
    createFormWriter,
    toArrayParam,
    type FormFieldSpec,
    type UIDialogHost,
} from '@/pages/agent/ui-bridge';

const GUIDE: UIGuide = {
    summary: '一句话说明这个表单弹窗要完成什么',
    steps: [
        '主信息一次用 form.setMany 设置，不要逐字段调用',
        '明细先 detail.get，修改后把整份 rows 传给 detail.set',
        '最后 form.submit；失败原因修完再提交',
    ],
};

type DetailRow = Record<string, unknown> & {rowId?: string};

export type XxxEditBridgeContext = {
    title: string;
    mode: 'add' | 'edit' | 'view' | 'copy';
    recordId: string | null;
    form: FormInstance<Record<string, unknown>>;
    fieldLock: (fieldId: string) => string | null;
    detailLock: () => string | null;
    detailRows: () => DetailRow[];
    applyDetailRows: (rows: DetailRow[]) => {count: number; total: number; errors: string[]};
    submit: () => Promise<{ok: boolean; message: string}>;
    close: () => void;
    isReady: () => boolean;
};

function fieldSpecs(): FormFieldSpec[] {
    return [
        {id: 'Code', label: '编号', type: 'text', required: true},
        {id: 'Date', label: '日期', type: 'date', required: true},
        // 隐藏的内部字段不要暴露；枚举必须给 options
    ];
}

function currentFields(ctx: XxxEditBridgeContext): UIField[] {
    const values = ctx.form.getFieldsValue();
    return fieldSpecs().map((field) => ({
        ...field,
        value: values[field.id],
        readOnly: field.readOnly || ctx.fieldLock(field.id) !== null,
    }));
}

export function createXxxEditBridge(read: () => XxxEditBridgeContext): UIDialogHost {
    const writer = createFormWriter({
        fields: fieldSpecs,
        fieldLock: (fieldId) => read().fieldLock(fieldId),
        write: (patch) => read().form.setFieldsValue(patch),
        sequenced: [
            // 需要检测/查库/带出关联字段时放这里
        ],
    });

    return {
        snapshot: (): UIForm => {
            const ctx = read();
            return {
                id: 'xxxEdit',
                title: ctx.title,
                mode: ctx.mode,
                recordId: ctx.recordId,
                fields: currentFields(ctx),
                errors: [],
            };
        },
        actions: () => [
            ...createFormWriteActions(fieldSpecs()),
            {id: 'detail.get', label: '读取明细行', group: 'form', returns: 'result'},
            {
                id: 'detail.set',
                label: '写入明细行',
                group: 'form',
                params: [{name: 'rows', type: 'text', required: true, hint: '整份明细行数组或 JSON'}],
            },
            {id: 'form.submit', label: '保存', group: 'form'},
            {id: 'form.cancel', label: '取消', group: 'form'},
        ],
        handlers: {
            ...createFormWriteHandlers(writer),
            'detail.get': () => ({rows: read().detailRows()}),
            'detail.set': (params) => {
                const rows = toArrayParam(params.rows);
                if (!rows) throw new Error('需要 rows：明细行数组，或它的 JSON 字符串');
                const lock = read().detailLock();
                if (lock) return `未写入明细：${lock}`;
                const result = read().applyDetailRows(rows as DetailRow[]);
                return `已写入 ${result.count} 行，总数量 ${result.total}`;
            },
            'form.submit': async () => {
                const result = await read().submit();
                if (!result.ok) throw new Error(result.message || '保存失败');
                return '已保存';
            },
            'form.cancel': () => {
                read().close();
                return '已关闭表单';
            },
        },
        guide: GUIDE,
        ready: () => read().isReady(),
    };
}
