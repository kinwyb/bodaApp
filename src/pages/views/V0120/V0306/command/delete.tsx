import {DeleteOutlined} from '@ant-design/icons';
import {ErrorMessage} from '@/api/request';
import {misProductionApi} from '@/api';
import type {OutStoreCommandFactory} from './types';

export const deleteOutStoreCommand: OutStoreCommandFactory = ({
    selected,
    reload,
    message,
    modal,
}) => ({
    key: 'delete',
    label: '删除',
    icon: <DeleteOutlined/>,
    danger: true,
    disabled: !selected,
    waitConfirm: true,
    onClick: () => {
        if (!selected?.BillID) {
            void message.warning('单据ID获取失败');
            return;
        }
        modal.confirm({
            title: '确定删除选中数据?',
            okText: '确认',
            cancelText: '取消',
            okButtonProps: {danger: true},
            onOk: async () => {
                try {
                    await misProductionApi.productOutStoreBillDelete(selected.BillID);
                    void message.success('删除成功');
                    await reload();
                } catch (error) {
                    void message.error(ErrorMessage(error, '删除失败'));
                    throw error;
                }
            },
        });
    },
});
