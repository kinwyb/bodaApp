import {DeleteOutlined} from '@ant-design/icons';
import {misProductionMonitorApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {emitActiveUIEvent} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {rowIdFromRecord} from '../orderInfo';
import type {OrderInfoCommandFactory} from './types';

export const deleteCommand: OrderInfoCommandFactory = ({activeRow, loading, saving, modal, message, removeRow}) => ({
    key: 'delete',
    label: '删除',
    icon: <DeleteOutlined/>,
    permission: '删除',
    danger: true,
    waitConfirm: true,
    dividerBefore: true,
    disabled: !activeRow || activeRow.Flag !== 0 || activeRow.Reason !== 999 || loading || saving,
    onClick: () => {
        const target = activeRow;
        const id = rowIdFromRecord(target);
        if (!target || id === null) {
            void message.warning('请先选中一条可删除的数据');
            return;
        }
        if (target.Flag !== 0 || target.Reason !== 999) {
            void message.warning('仅未审核且原因为 999 的新增记录可删除');
            return;
        }
        modal.confirm({
            title: '确认删除选中的数据?',
            content: `订单号：${toStringOrEmpty(target.OrderCode) || '—'}；机台号：${toStringOrEmpty(target.MachCode) || '—'}`,
            okText: '确认',
            cancelText: '取消',
            okButtonProps: {danger: true},
            onCancel: () => {
                emitActiveUIEvent('action.outcome', {
                    actionId: 'delete',
                    outcome: 'cancelled',
                    rowId: String(id),
                });
            },
            onOk: async () => {
                try {
                    await misProductionMonitorApi.orderDel(id);
                    removeRow(id);
                    void message.success('删除成功');
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'delete',
                        outcome: 'confirmed',
                        rowId: String(id),
                        message: '删除成功',
                    });
                } catch (error) {
                    const text = ErrorMessage(error, '删除失败');
                    void message.error(text);
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'delete',
                        outcome: 'failed',
                        rowId: String(id),
                        message: text,
                    });
                }
            },
        });
    },
});
