export interface Fighter {
  rank?: number;
  name: string;
  flag: string;
  div?: string;
  record: string;
  note?: string;
}

export interface WeightClass {
  id: string;
  icon: string;
  label: string;
  limit: string;
  champ: Fighter;
  fighters: Fighter[];
}

export interface AppState {
  scores: Record<string, number>;
  totalVotes: number;
  totalPi: number;
  lang: string;
  theme: 'dark' | 'light';
}
