# GS-232B Software Rotor Simulator

Dieses Tool simuliert einen GS-232B-kompatiblen Rotor komplett in Software.
Die eigentliche Rotor-Software muss dafuer nicht geaendert werden.

## Wichtig zu virtuellen COM-Ports

Ein Windows-COM-Port ist ein Geraetetreiber. Ein normales Python-Programm kann
nicht ohne Treiber einen neuen COM-Port im System registrieren. Fuer einen
realistischen Softwaretest wird daher ein virtuelles Nullmodem-Paar benoetigt,
zum Beispiel:

- com0com
- Null-modem emulator
- VSPE

Beispiel:

- Virtuelles Paar erstellen: `COM10 <-> COM11`
- Dieses Simulator-Programm oeffnet `COM10`
- Die unveraenderte Rotor-Software verbindet sich mit `COM11`

Danach sieht die Rotor-Software `COM11` wie einen echten Controller.

## Start

Im Projektwurzelordner:

```bat
start_software_rotor_simulator.bat
```

Oder direkt:

```bash
python software_test/gs232b_rotor_simulator.py
```

## Unterstuetzte Befehle

- `C`: Azimut abfragen, Antwort `AZ=xxx`
- `B`: Elevation abfragen, Antwort `EL=yyy`
- `C2`: Azimut und Elevation abfragen, Antwort `AZ=xxx EL=yyy`
- `R`, `L`: manuelle Azimut-Bewegung
- `U`, `D`: manuelle Elevation-Bewegung
- `A`, `E`, `S`: Achse stoppen bzw. alles stoppen
- `Mxxx`: Azimut-Ziel setzen
- `Wxxx yyy`: Azimut- und Elevation-Ziel setzen
- `P36`, `P45`: Azimut-Modus setzen
- `Sxxx`, `Bxxx`, `Xn`: Geschwindigkeit setzen
- `Z`: wird angenommen, aber als No-op behandelt

Antworten werden mit `\r` abgeschlossen, passend zur vorhandenen
Rotor-Software.

## UI

Die UI zeigt Live-Position, Statusantwort, Verbindungszustand, Log und Debug-
Snapshot. Sie kann auch Befehle direkt injizieren, um den Parser ohne externes
Programm zu testen.
