import { RotorStatus } from '../../common/types';

interface HistoryEntry extends RotorStatus {}

export class HistoryLog {
  private entries: HistoryEntry[] = [];
  private maxEntries = 300;

  constructor(private body: HTMLElement) {}

  addEntry(status: RotorStatus): void {
    const entry: HistoryEntry = { ...status };
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
    this.render();
  }

  clear(): void {
    this.entries = [];
    this.render();
  }

  exportCsv(): void {
    if (!this.entries.length) {
      return;
    }
    const header = 'timestamp_iso;azimuth_deg;elevation_deg;raw';
    const rows = this.entries
      .slice()
      .reverse()
      .map((entry) => {
        const timestamp = new Date(entry.timestamp).toISOString();
        const az = entry.azimuth ?? '';
        const el = entry.elevation ?? '';
        return `${timestamp};${az};${el};${entry.raw}`;
      });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rotor-history-${new Date().toISOString()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private render(): void {
    this.body.innerHTML = '';
    this.entries.forEach((entry) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${new Date(entry.timestamp).toLocaleTimeString()}</td>
        <td>${entry.azimuth ?? '--'}deg</td>
        <td>${entry.elevation ?? '--'}deg</td>
        <td>${entry.raw}</td>
      `;
      this.body.appendChild(row);
    });
  }
}
