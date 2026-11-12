import React from 'react';
import {misScheduleApi} from '@/api';
import type {ViewPageProps} from '@/pages/types';
import {BonusPerformancePage} from '../bonusPerformancePage';
import {createVnBonusBridge} from './bridged';

const VnBonusPerformancePage: React.FC<ViewPageProps> = (props) => (
    <BonusPerformancePage
        {...props}
        title="MIS > 绩效统计(越南)"
        exportName="绩效奖金明细"
        loadSummary={async (month) => (await misScheduleApi.bonusMonth(month)).data ?? []}
        loadDetail={async (month) => (await misScheduleApi.bonusMonthDetail(month)).data ?? []}
        loadRate={async (month, employeeNo) => (await misScheduleApi.bonusMachRate(month, employeeNo)).data ?? []}
        createBridge={createVnBonusBridge}
    />
);

export default VnBonusPerformancePage;
