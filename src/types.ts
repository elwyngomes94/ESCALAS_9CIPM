export interface Policeman {
  id?: string;
  nomeCompleto: string;
  nomeGuerra: string;
  graduacaoPosto: string;
  matricula: string;
  numeral: string;
  antiguidade: number;
  telefone: string;
  isMotorista?: boolean;
  situacao: string;
  createdAt?: any;
}

export interface ServiceType {
  id?: string;
  nome: string;
  tipo: 'PJES' | 'OPS';
  cidade: string;
  horarioInicio: string;
  horarioTermino: string;
  diasOperacao?: number[];
  observacoes?: string;
  createdAt?: any;
}

export interface Volunteer {
  id?: string;
  policemanId: string;
  type: 'PJES' | 'OPS';
  cotas: number;
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
