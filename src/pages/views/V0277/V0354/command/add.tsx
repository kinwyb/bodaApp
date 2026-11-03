import {FileAddOutlined} from '@ant-design/icons';
import type {PackBomMatrixCommandFactory} from './types';

/** 新增：打开空白的矩阵表单 */
export const addCommand: PackBomMatrixCommandFactory = ({openForm}) => ({
    key: 'add',
    label: '新增',
    icon: <FileAddOutlined/>,
    onClick: () => openForm('add', null),
});
