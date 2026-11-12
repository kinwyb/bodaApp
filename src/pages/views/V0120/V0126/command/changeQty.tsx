import {EditOutlined} from '@ant-design/icons';
import type {ProduceDataCommandFactory} from './types';

export const changeQtyCommand: ProduceDataCommandFactory = ({activeRow, isVietnam, openQtyChange, message}) => ({
    key: 'changeQty',
    label: '修改挡车数量',
    icon: <EditOutlined/>,
    permission: '修改挡车数量',
    disabled: !isVietnam || !activeRow?.Barcode,
    onClick: () => {
        if (!activeRow) {
            void message.warning('请先选中一条数据');
            return;
        }
        openQtyChange(activeRow);
    },
});
