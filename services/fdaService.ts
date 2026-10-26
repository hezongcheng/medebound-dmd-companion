import { FDADrug } from '../types';
import { API_BASE } from './apiClient';

interface ServerDrug {
  brandName: string;
  brandNameCn?: string;
  genericName?: string;
  genericNameCn?: string;
  manufacturer?: string;
  approvalDate?: string;
  approvalYear?: string;
  indication?: string;
  indicationZh?: string;
  dosage?: string;
  dosageZh?: string;
  labelUrl?: string;
  chinaStatus?: string;
  chinaStatusNote?: string;
}

const normalizeServerDrug = (drug: ServerDrug): FDADrug => ({
  brandName: drug.brandName || '',
  brandNameCn: drug.brandNameCn || drug.brandName,
  genericName: drug.genericName || '',
  genericNameCn: drug.genericNameCn || '',
  manufacturer: drug.manufacturer || '',
  approvalDate: drug.approvalDate || '',
  approvalYear: drug.approvalYear || '',
  indication: drug.indication || '',
  indicationZh: drug.indicationZh || '',
  dosage: drug.dosage || '',
  dosageZh: drug.dosageZh || '',
  labelUrl: drug.labelUrl || '',
  chinaStatus: (drug.chinaStatus as FDADrug['chinaStatus']) || 'unknown',
  chinaStatusNote: drug.chinaStatusNote || ''
});

export const fetchDmdDrugs = async (searchKeyword: string = ''): Promise<FDADrug[]> => {
  try {
    const params = new URLSearchParams();
    if (searchKeyword) params.set('search', searchKeyword);

    const query = params.toString();
    const url = `${API_BASE}/api/drugs${query ? '?' + query : ''}`;
    const response = await fetch(url);

    if (!response.ok) throw new Error('Failed to fetch drugs');
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map(normalizeServerDrug);
  } catch (error) {
    console.error('Drug Cache Error:', error);
    return [];
  }
};
