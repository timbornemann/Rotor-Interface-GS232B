class HistoryLog {
  constructor(body) {
    this.body = body;
    this.entries = [];
    this.maxEntries = 100;
    // Finde den Scroll-Container (history-table-wrapper)
    this.scrollContainer = this.body.closest('.history-table-wrapper');
  }

  addEntry(status) {
    if (!status) {
      return;
    }
    const entry = { ...status };
    this.entries.unshift(entry);
    // Lösche alte Einträge, wenn das Maximum überschritten wird
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }
    this.render();
    // Scrolle zum neuesten Eintrag (oben, da neue Einträge oben eingefügt werden)
    this.scrollToTop();
  }

  scrollToTop() {
    if (this.scrollContainer) {
      // Scrolle sofort zum Anfang (neueste Einträge sind oben)
      this.scrollContainer.scrollTop = 0;
    }
  }

  clear() {
    this.entries = [];
    this.render();
  }

  exportCsv() {
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

  render() {
    this.body.innerHTML = '';
    this.entries.forEach((entry) => {
      const row = document.createElement('tr');
      // Kompakte Darstellung ohne Rohdaten
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const az = entry.azimuth ?? '--';
      const el = entry.elevation ?? '--';
      row.innerHTML = `
        <td>${time}</td>
        <td>${az}°</td>
        <td>${el}°</td>
      `;
      this.body.appendChild(row);
    });
  }
}
