import { Policeman } from '../../types';

export const graduationWeights: { [key: string]: number } = {
  'Coronel': 1,
  'Tenente Coronel': 2,
  'Major': 3,
  'Capitão': 4,
  '1º Tenente': 5,
  '2º Tenente': 6,
  'Subtenente': 7,
  '1º Sargento': 8,
  '2º Sargento': 9,
  '3º Sargento': 10,
  'Cabo': 11,
  'Soldado': 12
};

export const sortPolicemen = (policemen: Policeman[]) => {
  return [...policemen].sort((a, b) => {
    const weightA = graduationWeights[a.graduacaoPosto] || 99;
    const weightB = graduationWeights[b.graduacaoPosto] || 99;
    
    if (weightA !== weightB) return weightA - weightB;
    if (a.antiguidade !== b.antiguidade) return (a.antiguidade || 0) - (b.antiguidade || 0);
    
    const numA = parseInt(a.numeral) || 0;
    const numB = parseInt(b.numeral) || 0;
    if (numA !== numB) return numA - numB;
    
    return a.nomeGuerra.localeCompare(b.nomeGuerra);
  });
};
