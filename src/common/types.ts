export interface RotorStatus {
  azimuth?: number;
  elevation?: number;
  raw: string;
  timestamp: number;
}

export interface SerialConnectionConfig {
  path: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  simulation?: boolean;
}

export type RotorControlCommand =
  | 'R'
  | 'L'
  | 'A'
  | 'U'
  | 'D'
  | 'E'
  | 'S';

export interface HistoryEntry extends RotorStatus {}
