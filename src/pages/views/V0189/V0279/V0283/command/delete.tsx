import {DeleteOutlined, ExclamationCircleOutlined} from '@ant-design/icons';
import {yupaiApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {emitActiveUIEvent} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import type {YupaiCancelledCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0189_V0279_V0283");


/** 彻底删除：只处理当前激活行，删除后无法恢复 */
export const deleteCommand: YupaiCancelledCommandFactory = ({
    message,
    modal,
    activeRow,
    reload,
}) => ({
    key: 'delete',
    label: t("删除"),
    icon: <DeleteOutlined/>,
    danger: true,
    dividerBefore: true,
    waitConfirm: true,
    disabled: !activeRow,
    permission: '删除',
    onClick: () => {
        if (!activeRow?.ID) {
            void message.warning(t("请先选中要删除的数据"));
            return;
        }
        const id = toStringOrEmpty(activeRow.ID);
        modal.confirm({
            icon: <ExclamationCircleOutlined/>,
            title: t("确认彻底删除该数据？"),
            content: (
                <div>
                    <div>{t("订单号：")}{toStringOrEmpty(activeRow.OrderCode) || '—'}</div>
                    <div>{t("款号：")}{toStringOrEmpty(activeRow.StyleCode) || '—'}</div>
                    <div style={{marginTop: 8, color: 'rgba(0, 0, 0, 0.45)'}}>{t("删除后无法恢复")}</div>
                </div>
            ),
            okText: t("确认删除"),
            cancelText: t("取消"),
            okButtonProps: {danger: true},
            mask: {blur: true},
            onCancel: () => {
                emitActiveUIEvent('action.outcome', {
                    actionId: 'delete',
                    outcome: 'cancelled',
                    targetIds: [id],
                });
            },
            onOk: async () => {
                try {
                    await yupaiApi.remove(id);
                    void message.success(t("已删除"));
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'delete',
                        outcome: 'confirmed',
                        targetIds: [id],
                        message: t("已删除"),
                    });
                    await reload();
                } catch (error) {
                    const text = ErrorMessage(error, '删除失败');
                    void message.error(text);
                    emitActiveUIEvent('action.outcome', {
                        actionId: 'delete',
                        outcome: 'failed',
                        targetIds: [id],
                        message: text,
                    });
                }
            },
        });
    },
});
