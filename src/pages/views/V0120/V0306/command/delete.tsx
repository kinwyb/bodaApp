import {DeleteOutlined} from '@ant-design/icons';
import {ErrorMessage} from '@/api/request';
import {misProductionApi} from '@/api';
import type {OutStoreCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0306");


export const deleteOutStoreCommand: OutStoreCommandFactory = ({
    selected,
    reload,
    message,
    modal,
}) => ({
    key: 'delete',
    label: t("删除"),
    icon: <DeleteOutlined/>,
    danger: true,
    disabled: !selected,
    waitConfirm: true,
    onClick: () => {
        if (!selected?.BillID) {
            void message.warning(t("单据ID获取失败"));
            return;
        }
        modal.confirm({
            title: t("确定删除选中数据?"),
            okText: t("确认"),
            cancelText: t("取消"),
            okButtonProps: {danger: true},
            onOk: async () => {
                try {
                    await misProductionApi.productOutStoreBillDelete(selected.BillID);
                    void message.success(t("删除成功"));
                    await reload();
                } catch (error) {
                    void message.error(ErrorMessage(error, '删除失败'));
                    throw error;
                }
            },
        });
    },
});
