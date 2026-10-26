export enum Region {
  ASIA = '亚洲 (Asia)',
  NORTH_AMERICA = '北美 (North America)',
  EUROPE = '欧洲 (Europe)',
  OTHER = '其他 (Other)'
}

export enum InterestArea {
  MEDICATIONS = '新药与临床试验',
  DAILY_CARE = '日常护理与康复',
  HEART_LUNGS = '心脏与肺部健康',
  GENE_THERAPY = '基因疗法动态',
  BASIC_SCIENCE = '基础科学研究'
}

export enum ArticleType {
  CLINICAL_TRIAL = '临床试验',
  REVIEW = '综述',
  GUIDELINE = '指南/共识',
  RESEARCH = '研究论文',
  UNKNOWN = '文章'
}

export interface UserProfile {
  isConfigured: boolean;
  age: number;
  birthDate?: string | null;
  geneticProfile: string;
  ambulatoryStatus: 'ambulatory' | 'wheelchair' | 'mixed';
  onSteroids: 'yes' | 'no' | 'unsure';
  region: Region;
  interests: InterestArea[];
  clinicalNotes: string;
  hasJointPain?: boolean | null;
  jointPainDetails?: string;
  hasJointContracture?: boolean | null;
  jointContractureDetails?: string;
  literaturePushEnabled?: boolean;
  contentPreference?: number;
  province?: string;
  mobilityStage?: 'independent' | 'assisted' | 'wheelchair_transition' | 'wheelchair_dependent';
  respiratorySupport?: 'none' | 'night' | 'day_and_night' | 'continuous';
  ejectionFraction?: number;
  steroidStatus?: 'current' | 'stopped' | 'never' | 'unsure';
  steroidMedication?: 'prednisone' | 'deflazacort' | 'vamorolone' | 'other';
  mutationType?: 'deletion' | 'duplication' | 'nonsense' | 'splice_site' | 'indel' | 'missense' | 'other' | 'unsure';
  exonStart?: number;
  exonEnd?: number;
}

export interface Article {
  id: string;
  title: string;
  titleZh?: string;
  abstract: string;
  abstractZh?: string;
  authors: string[];
  publicationDate: string;
  journal: string;
  url: string;
  tags: ArticleType[];
  subTags?: string[];
  impactFactor?: string;
  researchStage?: string;
  aiSummary?: string;
  matchPercent?: number;
  uvCount?: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export type InquiryType = 'article' | 'trial' | 'drug';

export interface SavedInquiry {
  id: string;
  date: string;
  articleTitle: string;
  articleId: string;
  summary: string;
  chatHistory: ChatMessage[];
  type?: InquiryType;
}

export interface RehabExercise {
  name: string;
  count: number;
}

export interface RehabRecord {
  id: string;
  date: string;
  duration: number;
  level: number;
  exercises: RehabExercise[];
}

export interface RehabStatus {
  id: string;
  date: string;
  hasJointPain: boolean;
  jointPainDetails: string;
  hasJointContracture: boolean;
  jointContractureDetails: string;
}

export interface UserDatabaseEntry {
  username: string;
  profile: UserProfile | null;
  savedInquiries: SavedInquiry[];
  rehabRecords: RehabRecord[];
  rehabStatusHistory: RehabStatus[];
}

export interface ClinicalTrial {
  nctId: string;
  title: string;
  titleZh?: string;
  status: string;
  phase: string[];
  conditions: string[];
  locations: string[];
  regions: string[];
  summary: string;
  summaryZh?: string;
  eligibility: string;
  eligibilityZh?: string;
  lastUpdate: string;
  studyType?: string;
  interventionTypes?: string[];
  interventionNames?: string[];
  leadSponsor?: string;
  primaryPurpose?: string;
  observationalModel?: string;
  timePerspective?: string;
  allocation?: string;
  masking?: string;
  enrollmentCount?: number | null;
  enrollmentType?: string;
  sex?: string;
  minimumAge?: string;
  maximumAge?: string;
  healthyVolunteers?: string;
  stdAges?: string[];
  suggestedMaterials?: string[];
}

export type ChinaDrugStatus = 'not_available' | 'clinical_trial' | 'nda_review' | 'approved' | 'unknown';

export const CHINA_STATUS_LABELS: Record<ChinaDrugStatus, string> = {
  not_available: '中国暂未上市',
  clinical_trial: '中国临床试验中',
  nda_review: '中国审评中',
  approved: '中国已获批',
  unknown: '中国状态未知'
};

export const CHINA_STATUS_COLORS: Record<ChinaDrugStatus, string> = {
  not_available: 'bg-red-100 text-red-700 border-red-200',
  clinical_trial: 'bg-blue-100 text-blue-700 border-blue-200',
  nda_review: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  unknown: 'bg-gray-100 text-gray-500 border-gray-200'
};

export interface FDADrug {
  brandName: string;
  brandNameCn?: string;
  genericName: string;
  genericNameCn?: string;
  manufacturer: string;
  approvalDate: string;
  approvalYear: string;
  indication: string;
  indicationZh?: string;
  dosage: string;
  dosageZh?: string;
  labelUrl: string;
  chinaStatus?: ChinaDrugStatus;
  chinaStatusNote?: string;
}
