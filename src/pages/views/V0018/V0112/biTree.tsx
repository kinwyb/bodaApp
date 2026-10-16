import DirectoryTree from "antd/es/tree/DirectoryTree";
import React, {useCallback, useEffect, useState} from "react";
import {biApi, type BIList} from "@/api/modules/bi.ts";
import type {BasicDataNode} from "antd/es/tree";

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

export const BITree: React.FC<biTreeProps> = ({open}) => {

    const [treeData, setTreeData] = useState<treeNode[]>([]);
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

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

    const handleDoubleClick = (e: React.MouseEvent, node: treeNode) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.QuerySQL) {
            open(node);
        }
    };

    return (
        <DirectoryTree
            fieldNames={{key: "ID", title: "BIName", children: "Children"}}
            treeData={treeData}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys)}
            onDoubleClick={handleDoubleClick}
            blockNode
            style={{userSelect: "none", padding: 10}}
        />
    );
}

export default BITree;
