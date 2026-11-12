import {http} from '../request';

export const configApi = {
    orderCodes: () => http.get<string[]>('/orderCodes'),
};