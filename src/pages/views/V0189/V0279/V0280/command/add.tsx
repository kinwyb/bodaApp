import {PlusOutlined} from '@ant-design/icons';
import type {PreorderCommandFactory} from './types';

/** 新增预订单：打开空白表单 */
export const addCommand: PreorderCommandFactory = ({openForm}) => ({
    key: 'add',
    label: '新增',
    icon: <PlusOutlined/>,
    menuCode: 'A1449617-681E-4D06-9F0F-BADC138B6BFE',
    onClick: () => openForm('add', null),
});
