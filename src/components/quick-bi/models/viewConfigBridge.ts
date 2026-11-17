/**
 * 明细配置弹窗的界面桥（仅超管打开）：打开期间顶掉页面层，关闭后自动恢复。
 * 只放常量与纯函数；弹窗组件在 `viewConfig.tsx`。
 */
import type {UIDialogHost} from '@/pages/agent/ui-bridge';
import {ORG_NAME} from '@/store/orgs';
import type {BiViewConfig} from '../types';

export type ViewConfigBridgeContext = {
    orgId: string;
    rows: Array<BiViewConfig & {_rowKey: string}>;
    loading: boolean;
    editing: boolean;
    reload: () => Promise<void>;
    addRow: () => void;
    deleteActiveRow: () => Promise<string>;
    setEditing: (editing: boolean) => void;
    onClose: () => void;
};

export function createViewConfigBridge(read: () => ViewConfigBridgeContext): UIDialogHost {
    return {
        snapshot: () => {
            const ctx = read();
            const names = ctx.orgId.split(',').map((id) => ORG_NAME(id)).filter((name) => name !== '').join('、');
            return {
                id: 'biViewConfig',
                title: `配置明细（${names}）`,
                mode: ctx.editing ? 'edit' : 'view',
                recordId: ctx.orgId,
                fields: [
                    {id: 'OrgID', label: '组织', type: 'text', value: ctx.orgId, readOnly: true, hint: `组织名称：${names}`},
                    {
                        id: 'Editing',
                        label: '编辑态',
                        type: 'switch',
                        value: ctx.editing,
                        hint: '开启后表格单元格可双击编辑，改完即保存',
                    },
                    {
                        id: 'Rows',
                        label: '明细配置',
                        type: 'text',
                        value: JSON.stringify(ctx.rows),
                        readOnly: true,
                        hint: 'JSON 数组：BIWork 业务单元 / BIKPI 指标 / BITag 标签页名 / BISQL 存储过程 / SortNo 排序 / OrgID 组织',
                    },
                ],
                errors: [],
            };
        },
        actions: () => [
            {id: 'config.reload', label: '重新加载配置', group: 'form'},
            {id: 'config.addRow', label: '新增配置行', group: 'form'},
            {id: 'config.deleteRow', label: '删除选中配置行', group: 'form', danger: true},
            {
                id: 'config.setEditing',
                label: '切换编辑态',
                group: 'form',
                params: [{name: 'editing', type: 'switch', hint: 'true 进入编辑 / false 退出'}],
            },
            {id: 'form.cancel', label: '关闭', group: 'form'},
        ],
        handlers: {
            'config.reload': async () => {
                await read().reload();
                return '明细配置已重新加载';
            },
            'config.addRow': () => {
                read().addRow();
                return '已新增一行配置（BIGroup/OrgID 已预填）；填写业务单元/指标/标签/存储过程后逐格保存';
            },
            'config.deleteRow': async () => read().deleteActiveRow(),
            'config.setEditing': (params) => {
                const editing = params.editing === true || params.editing === 'true';
                read().setEditing(editing);
                return editing ? '已进入编辑态' : '已退出编辑态';
            },
            'form.cancel': () => {
                read().onClose();
                return '已关闭明细配置';
            },
        },
        guide: {
            summary: '配置明细：维护 BIViewConfig —— 主表某个「业务单元_指标」点开后显示哪些明细标签页、各用什么存储过程（仅超级管理员）',
            cautions: [
                '单元格编辑由用户在界面上双击完成，桥不提供逐格写入；改完一格即调 BIViewSave 保存整行',
                '删除针对当前选中行，先用界面选中再调 config.deleteRow；没有选中行时会回执原因',
                'BISQL 是存储过程名，明细取数参数固定为 year / OrgPK / EmployeeNo / kpiName / DateDecs',
            ],
        },
        ready: () => !read().loading,
    };
}
