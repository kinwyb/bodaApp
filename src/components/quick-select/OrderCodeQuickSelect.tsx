import React from 'react';
import {configApi} from '@/api';
import {QuickSelectModal} from '@/components/QuickSelectModal';
import type {AppColumnDef} from '@/components/grid-table';

type OrderCodeOption = {
    OrderCode: string;
};

const ORDER_CODE_COLUMNS: AppColumnDef[] = [
    {field: 'OrderCode', title: '订单号', width: 180},
];

export type OrderCodeQuickSelectProps = {
    open: boolean;
    onCancel: () => void;
    onSelect: (orderCode: string) => void;
    defaultKeyword?: string;
};

export const OrderCodeQuickSelect: React.FC<OrderCodeQuickSelectProps> = ({
    open,
    onCancel,
    onSelect,
    defaultKeyword,
}) => {
    return (
        <QuickSelectModal<OrderCodeOption>
            open={open}
            title="选择订单号"
            columns={ORDER_CODE_COLUMNS}
            rowKey="OrderCode"
            searchFields={['OrderCode']}
            searchPlaceholder="输入订单号"
            defaultKeyword={defaultKeyword}
            loadData={async () => {
                const result = await configApi.orderCodes();
                return (result.data ?? []).map((OrderCode) => ({OrderCode}));
            }}
            onSelect={(record) => onSelect(record.OrderCode)}
            onCancel={onCancel}
            width={520}
            height={360}
        />
    );
};
