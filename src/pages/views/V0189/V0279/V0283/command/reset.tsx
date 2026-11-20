import {ExclamationCircleOutlined, UndoOutlined} from '@ant-design/icons';
import {yupaiApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {emitActiveUIEvent} from '@/pages/agent/ui-bridge';
import type {YupaiCancelledCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0189_V0279_V0283");


/** 恢复：可批量恢复选中的已取消预订单 */
export const resetCommand: YupaiCancelledCommandFactory = ({
    message,
    modal,
    getSelectedRows,
    hasSelection,
    reload,
}) => ({
    key: 'reset',
    label: t("恢复"),
    icon: <UndoOutlined/>,
    waitConfirm: true,
    disabled: !hasSelection,
    permission: '恢复',
    onClick: () => {
        const targets = getSelectedRows();
        if (targets.length === 0) {
            void message.warning(t("请先选中要恢复的数据"));
            return;
        }
        const targetIds = targets.map((row) => row.ID);
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title: `确认恢复选中的 ${targets.length} 条预排数据？`,
            content: t("恢复后这些记录会重新回到预排列表。"),
            okText: t("确认恢复"),
            cancelText: t("取消"),
            mask: {blur: true},
            onCancel: () => {
                emitActiveUIEvent('action.outcome', {
                    actionId: 'reset',
                    outcome: 'cancelled',
                    targetIds,
                });
            },
            onOk: async () => {
                try {
                    await yupaiApi.reset(targetIds);
                    void message.success(t("已恢复"));
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'reset',
                        outcome: 'confirmed',
                        targetIds,
                        message: t("已恢复"),
                    });
                    await reload();
                } catch (error) {
                    const text = ErrorMessage(error, '恢复失败');
                    void message.error(text);
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'reset',
                        outcome: 'failed',
                        targetIds,
                        message: text,
                    });
                }
            },
        });
    },
});
