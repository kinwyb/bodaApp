import {CopyOutlined} from '@ant-design/icons';
import {misProductionMonitorApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {emitActiveUIEvent} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {copyOrderRow, rowIdFromRecord} from '../orderInfo';
import type {OrderInfoCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0121");


export const copyCommand: OrderInfoCommandFactory = ({activeRow, loading, saving, modal, message, insertCopy}) => ({
    key: 'copy',
    label: t("复制"),
    icon: <CopyOutlined/>,
    permission: '复制',
    waitConfirm: true,
    dividerBefore: true,
    disabled: !activeRow || loading || saving,
    onClick: () => {
        const target = activeRow;
        const id = rowIdFromRecord(target);
        if (!target || id === null) {
            void message.warning(t("请先选中一条数据"));
            return;
        }
        modal.confirm({
            title: t("确认复制选中的数据?"),
            content: `订单号：${toStringOrEmpty(target.OrderCode) || '—'}；机台号：${toStringOrEmpty(target.MachCode) || '—'}`,
            okText: t("确认"),
            cancelText: t("取消"),
            onCancel: () => {
                emitActiveUIEvent('action.outcome', {
                    actionId: 'copy',
                    outcome: 'cancelled',
                    rowId: String(id),
                });
            },
            onOk: async () => {
                try {
                    const result = await misProductionMonitorApi.orderCopy(id);
                    const newId = result.data;
                    if (typeof newId !== 'number' || !Number.isInteger(newId) || newId <= 0) {
                        throw new Error('复制失败：接口没有返回有效的新数据 ID');
                    }
                    insertCopy(id, copyOrderRow(target, newId));
                    void message.success(t("复制成功"));
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'copy',
                        outcome: 'confirmed',
                        rowId: String(id),
                        newRowId: String(newId),
                        message: t("复制成功"),
                    });
                } catch (error) {
                    const text = ErrorMessage(error, '复制失败');
                    void message.error(text);
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'copy',
                        outcome: 'failed',
                        rowId: String(id),
                        message: text,
                    });
                }
            },
        });
    },
});
