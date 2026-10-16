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

export const BITree: React.FC<biTreeProps> = ({open}) => {

    const [treeData, setTreeData] = useState<treeNode[]>([]);

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
            defaultExpandAll
            fieldNames={{key: "ID", title: "BIName", children: "Children"}}
            treeData={treeData}
            onDoubleClick={handleDoubleClick}
            blockNode
            style={{userSelect: "none"}}
        />
    );
}

export default BITree;