export interface QuotaSettings {
  id?: string;
  month: string; // YYYY-MM
  pjesMPTotal: number;
  pjesForumTotal: number;
  pjesEscolarTotal: number;
  pjesDecretoTotal: number;
  opsTotal: number;
  updatedAt?: any;
}

export interface Policeman {
  id?: string;
  nomeCompleto: string;
  nomeGuerra: string;
  graduacaoPosto: string;
  matricula: string;
  numeral: string;
  antiguidade: number;
  telefone?: string;
  isMotorista?: boolean;
  pelotao: string;
  situacao: string;
  pjesCotasMax: number;
  opsCotasMax: number;
  createdAt?: any;
}

export type PjesSubtype = 'MP' | 'FORUM' | 'ESCOLAR' | 'DECRETO';

export interface ServiceType {
  id?: string;
  nome: string;
  tipo: 'PJES' | 'OPS' | 'ORDINARIO' | 'EXTRA';
  pjesSubtype?: PjesSubtype;
  categoria: string; // Patrulha, GGI, Guarda, Operaçãao, Apoio, Supervisão, Tático, etc.
  sigla: string;
  color: string;
  month: string; // YYYY-MM
  activationType: 'ALL' | 'SPECIFIC';
  activeDates: string[]; // ['2026-05-05', '2026-05-06', ...]
  iconName?: string;
  cidade: string;
  horarioInicio: string;
  horarioTermino: string;
  diasOperacao?: number[];
  observacoes?: string;
  vagasNecessarias?: number;
  cotasPorServico: number;
  isActive: boolean;
  createdAt?: any;
}

export interface QuotaLog {
  id?: string;
  serviceTypeId: string;
  serviceName: string;
  escalaId: string;
  tipo: 'PJES' | 'OPS';
  pjesSubtype?: PjesSubtype;
  quantidade: number;
  usuarioUid: string;
  usuarioEmail: string;
  data: any; // timestamp
  month: string; // YYYY-MM
}

export interface Volunteer {
  id?: string;
  policemanId: string;
  type: 'PJES' | 'OPS';
  cotas: number;
  month: string; // YYYY-MM
  desiredService?: string;
  createdAt?: any;
}

export interface Escala {
  id?: string;
  serviceTypeId: string;
  policemenIds: string[];
  date: any;
  observations?: string;
  createdAt?: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  isAdmin: boolean;
}

export interface OrdinarySchedule {
  id?: string;
  policemanId: string;
  month: string; // YYYY-MM
  days: number[];
  createdAt?: any;
}
