import {DeleteOutlined} from '@ant-design/icons';
import {misProductionApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import type {ProduceDataCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0126");


export const deleteProduceDataCommand: ProduceDataCommandFactory = ({
    activeRow,
    isVietnam,
    clearDeletedRow,
    message,
    modal,
}) => ({
    key: 'delete',
    label: t("删除"),
    icon: <DeleteOutlined/>,
    permission: '删除',
    danger: true,
    disabled: !isVietnam || !activeRow || activeRow.Flag !== 0 || !activeRow.Barcode,
    waitConfirm: true,
    onClick: () => {
        const target = activeRow;
        if (!target) {
            void message.warning(t("请先选中一条数据"));
            return;
        }
        if (!target.Barcode) return;
        if (target.Flag === 1) {
            void message.warning(`${target.Status}不许删除`);
            return;
        }
        if (!target.ID) {
            void message.warning(t("数据ID不能为空"));
            return;
        }
        modal.confirm({
            title: t("确认删除选中数据?"),
            okText: t("确认"),
            cancelText: t("取消"),
            okButtonProps: {danger: true},
            onOk: async () => {
                try {
                    await misProductionApi.appletsDataDelete(target.ID!);
                    clearDeletedRow(target.ID!);
                    void message.success(t("删除成功"));
                } catch (error) {
                    void message.error(ErrorMessage(error, '删除失败'));
                    throw error;
                }
            },
        });
    },
});
