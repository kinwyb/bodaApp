import DirectoryTree from "antd/es/tree/DirectoryTree";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import {biApi, type BIList} from "@/api/modules/bi.ts";
import type {BasicDataNode} from "antd/es/tree";
import {Empty, Input, theme} from "antd";
import {SearchOutlined} from "@ant-design/icons";

interface treeNode extends BIList, BasicDataNode {
}

export interface biTreeProps {
    /**
     * 打开报表
     */
    open: (node: treeNode) => void;
}

const treeNodeDictoryCheck = (node: treeNode) => {
    const hasChildren = node.Children ? node.Children.length > 0 : false;
    if (!hasChildren) {
        node.isLeaf = true;
        return
    }
    node.Children?.forEach(child => {
        treeNodeDictoryCheck(child);
    });
}

/** 收集所有节点 ID，用于数据加载后受控全展开（defaultExpandAll 对异步数据无效） */
const collectKeys = (nodes: treeNode[]): React.Key[] => {
    const keys: React.Key[] = [];
    const walk = (list: treeNode[]) => {
        list.forEach((n) => {
            keys.push(n.ID);
            if (n.Children && n.Children.length) walk(n.Children);
        });
    };
    walk(nodes);
    return keys;
};

/**
 * 递归过滤：命中关键字的节点**整枝保留**（搜到目录名时能看到它下面的全部报表）；
 * 自己没命中就看子孙有没有命中，都没有就整枝丢掉。
 * 关键字要求已转小写。
 */
const filterNodes = (nodes: treeNode[], keyword: string): treeNode[] => {
    const result: treeNode[] = [];
    nodes.forEach((node) => {
        if ((node.BIName ?? '').toLowerCase().includes(keyword)) {
            result.push(node);
            return;
        }
        const children = node.Children ? filterNodes(node.Children, keyword) : [];
        if (children.length > 0) {
            // 拷贝一层，避免把过滤后的 Children 写回原始树
            result.push({...node, Children: children});
        }
    });
    return result;
};

export const BITree: React.FC<biTreeProps> = ({open}) => {

    const {token} = theme.useToken();
    const [treeData, setTreeData] = useState<treeNode[]>([]);
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
    /** 搜索态的展开键：与手动展开分开，清空搜索后能回到原来的折叠状态 */
    const [searchExpandedKeys, setSearchExpandedKeys] = useState<React.Key[]>([]);
    const [keyword, setKeyword] = useState('');

    const loadTreeData = useCallback(async () => {
        const apiResult = await biApi.list();
        if (!apiResult.data || apiResult.data.length < 1) {
            setTreeData([]);
            return;
        }
        const nodes = apiResult.data.map((item): treeNode => {
            return {...item};
        });
        nodes.forEach((item) => {
            treeNodeDictoryCheck(item);
        })
        setTreeData(nodes);
        setExpandedKeys(collectKeys(nodes));
    }, [])

    useEffect(() => {
        void loadTreeData();
    }, [])

    const searching = keyword.trim().length > 0;
    const normalizedKeyword = keyword.trim().toLowerCase();

    const visibleData = useMemo(
        () => (normalizedKeyword ? filterNodes(treeData, normalizedKeyword) : treeData),
        [treeData, normalizedKeyword]
    );

    // 搜索时把命中的分支全部摊开，否则深层命中藏在折叠的目录里，跟没搜到一样
    useEffect(() => {
        if (normalizedKeyword) setSearchExpandedKeys(collectKeys(visibleData));
    }, [normalizedKeyword, visibleData]);

    const handleDoubleClick = (e: React.MouseEvent, node: treeNode) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.QuerySQL) {
            open(node);
        }
    };

    return (
        <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: 10,
            gap: 8,
            boxSizing: 'border-box',
        }}>
            <Input
                allowClear
                placeholder="搜索报表"
                prefix={<SearchOutlined style={{color: token.colorTextPlaceholder}}/>}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
            />
            {searching && visibleData.length === 0 ? (
                <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的报表"/>
                </div>
            ) : (
                <div style={{flex: 1, minHeight: 0, overflow: 'auto'}}>
                    <DirectoryTree
                        fieldNames={{key: "ID", title: "BIName", children: "Children"}}
                        treeData={visibleData}
                        expandedKeys={searching ? searchExpandedKeys : expandedKeys}
                        onExpand={(keys) => (searching ? setSearchExpandedKeys(keys) : setExpandedKeys(keys))}
                        onDoubleClick={handleDoubleClick}
                        blockNode
                        style={{userSelect: "none"}}
                    />
                </div>
            )}
        </div>
    );
}

export default BITree;
