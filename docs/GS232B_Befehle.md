# GS-232B Rotor Controller - Befehlsreferenz

Diese Dokumentation beschreibt alle verfügbaren Befehle für den Yaesu GS-232B kompatiblen Rotor-Controller.

## Protokoll-Format

Alle Befehle werden mit einem Carriage Return (`\r`) abgeschlossen und in Großbuchstaben gesendet.

**Beispiel:** `R\r` oder `M180\r`

---

## Bewegungsbefehle

### Azimut-Steuerung

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `R` | Azimut nach Rechts drehen | `R\r` | `R\r` |
| `L` | Azimut nach Links drehen | `L\r` | `L\r` |
| `A` | Azimut stoppen | `A\r` | `A\r` |

### Elevation-Steuerung

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `U` | Elevation nach oben | `U\r` | `U\r` |
| `D` | Elevation nach unten | `D\r` | `D\r` |
| `E` | Elevation stoppen | `E\r` | `E\r` |

### Allgemeine Steuerung

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `S` | Alles stoppen (Azimut + Elevation) | `S\r` | `S\r` |

---

## Position setzen

### Azimut setzen

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `Maaa` | Azimut auf bestimmten Wert setzen | `M` + 3-stellige Zahl (000-360 oder 000-450) | `M180\r` (180°) |

**Hinweis:** Der Wert muss 3-stellig sein (mit führenden Nullen).

### Azimut und Elevation setzen

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `Wxxx yyy` | Azimut und Elevation gleichzeitig setzen | `W` + 3-stellige Azimut + Leerzeichen + 3-stellige Elevation | `W180 045\r` (180° Az, 45° El) |

**Beispiele:**
- `W000 090\r` - Azimut 0°, Elevation 90°
- `W180 045\r` - Azimut 180°, Elevation 45°
- `W360 000\r` - Azimut 360°, Elevation 0°

---

## Status abfragen

| Befehl | Beschreibung | Format | Beispiel | Antwort-Format |
|--------|-------------|--------|----------|----------------|
| `C` | Azimut abfragen | `C\r` | `C\r` | `AZ=123` |
| `B` | Elevation abfragen | `B\r` | `B\r` | `EL=045` |
| `C2` | Azimut und Elevation abfragen | `C2\r` | `C2\r` | `AZ=123 EL=045` |

**Antwort-Format:**
- Azimut: `AZ=xxx` (3-stellig, 000-360 oder 000-450)
- Elevation: `EL=yyy` (3-stellig, 000-090)
- Kombiniert: `AZ=123 EL=045`

---

## Modus-Einstellungen

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `P36` | 360° Modus aktivieren | `P36\r` | `P36\r` |
| `P45` | 450° Modus aktivieren | `P45\r` | `P45\r` |

**Hinweis:** 
- Im 360° Modus: Azimut 0-360°
- Im 450° Modus: Azimut 0-450° (für spezielle Rotoren)

---

## Geschwindigkeits-Einstellungen

### Azimut-Geschwindigkeit

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `Sxxx` | Azimut-Geschwindigkeit setzen | `S` + 3-stellige Zahl (Grad pro Sekunde) | `S004\r` (4°/s) |

**Wertebereich:** Typisch 0.5-20 Grad pro Sekunde

### Elevation-Geschwindigkeit

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `Bxxx` | Elevation-Geschwindigkeit setzen | `B` + 3-stellige Zahl (Grad pro Sekunde) | `B002\r` (2°/s) |

**Wertebereich:** Typisch 0.5-20 Grad pro Sekunde

**Beispiele:**
- `S010\r` - Azimut-Geschwindigkeit auf 10°/s
- `B005\r` - Elevation-Geschwindigkeit auf 5°/s

---

## Zusätzliche Befehle

| Befehl | Beschreibung | Format | Beispiel |
|--------|-------------|--------|----------|
| `Z` | North/South Toggle (je nach Controller) | `Z\r` | `Z\r` |

**Hinweis:** Nicht alle Controller unterstützen diesen Befehl.

---

## Serielle Schnittstellen-Einstellungen

**Standard-Einstellungen:**
- Baudrate: 9600 (typisch, kann variieren: 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200)
- Datenbits: 8
- Stoppbits: 1
- Parität: None
- Flow Control: None

---

## Befehls-Beispiele

### Einfache Bewegung
```
R\r          # Azimut nach rechts
A\r          # Azimut stoppen
U\r          # Elevation nach oben
E\r          # Elevation stoppen
S\r          # Alles stoppen
```

### Position setzen
```
M180\r       # Azimut auf 180° setzen
W090 045\r   # Azimut 90°, Elevation 45° setzen
W000 090\r   # Azimut 0°, Elevation 90° (senkrecht nach oben)
```

### Status abfragen
```
C\r          # Nur Azimut abfragen
B\r          # Nur Elevation abfragen
C2\r         # Beide abfragen (empfohlen)
```

### Modus ändern
```
P36\r        # 360° Modus
P45\r        # 450° Modus
```

### Geschwindigkeit einstellen
```
S004\r       # Azimut 4°/s
B002\r       # Elevation 2°/s
```

---

## Fehlerbehandlung

### Häufige Probleme

1. **Keine Antwort vom Controller:**
   - Baudrate prüfen
   - Kabelverbindung prüfen
   - Controller eingeschaltet?

2. **Falsche Position:**
   - Status mit `C2\r` abfragen
   - Kalibrierung prüfen

3. **Befehle werden nicht ausgeführt:**
   - Controller im richtigen Modus? (`P36` oder `P45`)
   - Soft-Limits prüfen
   - Controller nicht blockiert?

---

## Best Practices

1. **Status regelmäßig abfragen:** Verwende `C2\r` alle 500-1000ms für Live-Updates
2. **Befehle nacheinander senden:** Warte auf Antwort vor dem nächsten Befehl (10-50ms Verzögerung)
3. **Geschwindigkeit vor Bewegung setzen:** Setze Geschwindigkeit (`Sxxx`, `Bxxx`) vor Bewegungsbefehlen
4. **Modus zuerst setzen:** Setze den Modus (`P36` oder `P45`) direkt nach dem Verbinden
5. **Stopp-Befehle verwenden:** Immer `A`, `E` oder `S` senden, bevor neue Positionen gesetzt werden

---

## Implementierungs-Hinweise

### JavaScript/Web Serial Beispiel

```javascript
// Befehl senden
async function sendCommand(command) {
  const writer = port.writable.getWriter();
  const payload = encoder.encode(command.endsWith('\r') ? command : `${command}\r`);
  await writer.write(payload);
  writer.releaseLock();
}

// Beispiele
await sendCommand('R');      // Azimut rechts
await sendCommand('M180');   // Azimut auf 180°
await sendCommand('C2');      // Status abfragen
```

### Antwort parsen

```javascript
// Antwort: "AZ=123 EL=045"
function parseStatus(line) {
  const azMatch = line.match(/AZ\s*=\s*(\d+)/i);
  const elMatch = line.match(/EL\s*=\s*(\d+)/i);
  
  return {
    azimuth: azMatch ? parseInt(azMatch[1]) : null,
    elevation: elMatch ? parseInt(elMatch[1]) : null
  };
}
```

---

## Version

**Dokumentations-Version:** 1.0  
**Protokoll:** Yaesu GS-232B kompatibel  
**Letzte Aktualisierung:** 2025

