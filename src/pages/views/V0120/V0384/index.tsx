import React from 'react';
import {misReportApi} from '@/api';
import type {ViewPageProps} from '@/pages/types';
import {EfficiencyReportPage} from '../efficiencyReport';
import {createMechanicEfficiencyBridge} from './bridged';

const MechanicEfficiencyPage: React.FC<ViewPageProps> = (props) => (
    <EfficiencyReportPage
        {...props}
        title="MIS > 机修工效率"
        exportName="机修工效率"
        loadReport={misReportApi.mechanicRate}
        createBridge={createMechanicEfficiencyBridge}
    />
);

export default MechanicEfficiencyPage;
