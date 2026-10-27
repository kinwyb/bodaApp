import React, {useCallback, useEffect, useState} from 'react';
import {Button, DatePicker, Divider, Input, Modal, Select} from 'antd';
import type {BIList, BIQueryArg} from "@/api/modules/bi.ts";
import {formatDate, toDayjs} from "@/utils";
import {ORGS} from "@/store/orgs.ts";
import QuickSelectModal from "@/components/QuickSelectModal.tsx";
import type {ColumnsDefine} from "@visactor/vtable";
import {sqlApi} from "@/api";
import {type AppColumnDef, buildColumns} from "@/components/grid-table/columnBuilder.ts";

export interface BIQueryParamProps {
    open: boolean;
    node?: BIList;
    onClose: () => void;
    query?: (node: BIList) => void;
}

/**
 * 通用筛选条：按列的筛选类型自动生成对应控件。
 * - enum：多选，候选项从后端返回的去重值里取
 * - date / number：区间
 * - text：包含
 */
export const BIQueryParam: React.FC<BIQueryParamProps> = ({open, node, onClose, query}) => {
    const [queryNode, setQueryNode] = useState<BIList | undefined>(node);
    const [openQuickSelect, setOpenQuickSelect] = useState<boolean>(false);
    const [quickSelectColumn, setQuickSelectColumn] = useState<ColumnsDefine>([{field: ""}]);
    const [quickSelectArg, setQuickSelectArg] = useState<BIQueryArg | undefined>(undefined);

    // 每次打开时用外部条件初始化草稿，避免未点确定也生效
    useEffect(() => {
        if (open) setQueryNode(node);
        if (!node) return;
    }, [open, node]);

    const patch = useCallback((field: string, value: string) => {
        setQueryNode((prev) => {
            if (!prev) {
                return prev;
            }
            const arg = prev.Args.find((arg) => arg.Field === field);
            if (arg) {
                arg.Val = value;
            }
            return {...prev};
        });
    }, []);

    const renderControl = (item: BIQueryArg) => {
        if (item.Name.trim() === '组织') {
            return (
                <Select
                    allowClear
                    maxTagCount="responsive"
                    style={{width: '100%'}}
                    placeholder={item.Name}
                    value={item.Val}
                    options={Object.entries(ORGS).map((k) => ({value: k[0], label: k[1]}))}
                    onChange={(value) => patch(item.Field, value)}
                />
            );
        }
        const valType = item.ValType.toLowerCase();
        if (valType === 'date') {
            return (
                <DatePicker
                    style={{width: '100%'}}
                    value={toDayjs(item.Val)}
                    placeholder={item.Name}
                    onChange={(dateVal) =>
                        patch(item.Field, formatDate(dateVal))
                    }
                />
            );
        }

        if (item.SQL?.trim()) {
            return (
                <Input.Search
                    allowClear
                    placeholder={item.Name}
                    value={item.Val}
                    onChange={(event) => patch(item.Field, event.target.value)}
                    onSearch={(_, __, info) => {
                        // 点清除按钮时 source 为 'clear'，不触发弹窗；只有点搜索按钮 / 回车才继续
                        if (info?.source === 'clear') return;
                        setQuickSelectArg(item);
                        setOpenQuickSelect(true);
                    }}
                />
            )
        }

        return (
            <Input
                allowClear
                placeholder={item.Name}
                value={item.Val}
                onChange={(event) => patch(item.Field, event.target.value)}
            />
        );
    };

    const panel = (
        <div className="table-filter-panel" style={{width: '100%'}}>
            <div className="table-filter-rows">
                {queryNode?.Args.map((item) => (
                    <div key={item.Field} className="table-filter-row">
                        <span className="table-filter-label">{item.Name}</span>
                        <div className="table-filter-control">{renderControl(item)}</div>
                    </div>
                ))}
            </div>
            <Divider style={{margin: '4px 0 12px'}}/>
            <div className="table-filter-actions">
                <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                        if (query && queryNode) {
                            query(queryNode);
                        }
                    }}
                >
                    确定
                </Button>
            </div>
        </div>
    );

    const quickDataLoad = useCallback(async (): Promise<Record<string, string>[]> => {
        if (!quickSelectArg || !quickSelectArg.SQL) {
            return [];
        }
        const result = await sqlApi.query({
            SQL: quickSelectArg.SQL
        })
        if (!result.data) {
            return [];
        }
        const columns = result.data.Headers.map((value): AppColumnDef => {
            return {field: value, title: value, width: 80}
        });
        setQuickSelectColumn(buildColumns(columns));
        return result.data.DataVals ?? [];
    }, [quickSelectArg]);

    const quickDataSelected = useCallback((data: Record<string, string>) => {
        if (!quickSelectArg || !quickSelectArg.Name) {
            return;
        }
        const value = data[quickSelectArg.Name];
        patch(quickSelectArg.Field, value);
        setOpenQuickSelect(false);
        setQuickSelectColumn([{field: "空"}])
    }, [quickSelectArg]);

    return (
        <Modal
            open={open}
            title={"查询条件"}
            destroyOnHidden
            style={{top: 24}}
            styles={{
                body: {
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                },
            }}
            centered
            footer={null}
            mask={{closable: false}}
            onCancel={onClose}
        >
            <div className="table-filter">
                {panel}
            </div>
            <QuickSelectModal open={openQuickSelect} columns={quickSelectColumn} loadData={quickDataLoad}
                              onSelect={quickDataSelected}
                              onCancel={() => {
                                  setOpenQuickSelect(false);
                                  setQuickSelectColumn([{field: ""}])
                              }}/>
        </Modal>
    );
};
