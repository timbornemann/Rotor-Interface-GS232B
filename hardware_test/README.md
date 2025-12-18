# Hardware Configuration & Wiring Documentation

**Project:** Arduino Rotator Controller (GS-232B Emulation)  
**Firmware Version:** 1.0  
**Based on:** Arduino Uno / Nano Platform

---

## Contents
[1. BOM](#1-bill-of-materials-bom) • [2. Pinout](#2-pinout-map) • [3. Wiring](#3-detailed-wiring-instructions) • [4. Libraries](#4-software-libraries) • [5. Operation](#5-operation-guide) • [6. Commands](#6-serial-command-reference-gs-232b-subset) • [7. Audio](#7-audio-feedback-codes-buzzer) • [8. LCD](#8-lcd-status-layout) • [9. Simulation](#9-simulation--wokwi-configuration)
---

## 1. Bill of Materials (BOM)

To replicate this setup, the following components are required:

* **Microcontroller:** Arduino Uno, Nano, or compatible (5V logic)
* **Display:** 16x2 Character LCD (HD44780 compatible)
* **Potentiometer:** 10kΩ (Linear, for LCD contrast)
* **Stepper Motor:** 28BYJ-48 (5V)
* **Motor Driver:** ULN2003 Driver Board
* **User Input:** 2x Tactile Push Buttons (Momentary)
* **Audio:** 1x Passive Piezo Buzzer
* **Indicators:** 3x LEDs (Red, Green, Yellow recommended)
* **Resistors:** 3x 220Ω (for LEDs)

---

## 2. Pinout Map

| Arduino Pin | Type | Connected Component | Function / Description |
| :--- | :--- | :--- | :--- |
| **D2** | Digital Out | **LCD** (D7) | Data Line 7 |
| **D4** | Digital Out | **LCD** (D6) | Data Line 6 |
| **D5** | Digital Out | **LCD** (D5) | Data Line 5 |
| **D6** | Digital Out | **LCD** (D4) | Data Line 4 |
| **D7** | Digital Out | **Motor Driver** (IN1) | Stepper Coil A |
| **D8** | Digital Out | **Motor Driver** (IN2) | Stepper Coil C |
| **D9** | Digital Out | **Motor Driver** (IN3) | Stepper Coil B |
| **D10** | Digital Out | **Motor Driver** (IN4) | Stepper Coil D |
| **D11** | Digital Out | **LCD** (EN) | Enable Signal |
| **D12** | Digital Out | **LCD** (RS) | Register Select |
| **A0** | Digital Out | **LED 1** | Status: **Moving** |
| **A1** | Digital Out | **LED 2** | Status: **Mode** (360°/450°) |
| **A2** | Digital Out | **LED 3** | Status: **Error** |
| **A3** | Digital In | **Button Left** | Manual Rotation CCW |
| **A4** | Digital In | **Button Right** | Manual Rotation CW |
| **A5** | Digital Out | **Buzzer** | Audio Feedback |

---

## 3. Detailed Wiring Instructions

### A. LCD Display (16x2)
The system uses the standard 4-bit parallel interface.
* **VSS (GND):** Connect to GND.
* **VDD (VCC):** Connect to +5V.
* **V0 (Contrast):** Connect to the center pin of the 10kΩ Potentiometer (Outer pins to 5V/GND).
* **RS:** Connect to **Pin 12**.
* **RW:** Connect to **GND**.
* **E:** Connect to **Pin 11**.
* **D4:** Connect to **Pin 6**.
* **D5:** Connect to **Pin 5**.
* **D6:** Connect to **Pin 4**.
* **D7:** Connect to **Pin 2**.
* **A / K (Backlight):** Connect Anode to 5V (via resistor if needed) and Cathode to GND.

### B. Stepper Motor (28BYJ-48 & ULN2003)
**Note on Pins:** The firmware initializes the stepper with `(..., 7, 9, 8, 10)` to handle the coil sequence correctly. Wire the Arduino pins linearly to the driver board inputs:

* Arduino **Pin 7** $\rightarrow$ ULN2003 **IN1**
* Arduino **Pin 8** $\rightarrow$ ULN2003 **IN2**
* Arduino **Pin 9** $\rightarrow$ ULN2003 **IN3**
* Arduino **Pin 10** $\rightarrow$ ULN2003 **IN4**
* **Power:** Connect ULN2003 VCC to +5V and GND to GND.

### C. Control Buttons
The buttons utilize the internal pull-up resistors (`INPUT_PULLUP`).
* **Left Button (CCW):** Connect between **Pin A3** and **GND**.
* **Right Button (CW):** Connect between **Pin A4** and **GND**.

### D. Status LEDs
The LEDs are driven Active High.
* **Moving LED (A0):** Anode to **Pin A0**, Cathode via 220Ω resistor to **GND**.
* **Mode LED (A1):** Anode to **Pin A1**, Cathode via 220Ω resistor to **GND**.
* **Error LED (A2):** Anode to **Pin A2**, Cathode via 220Ω resistor to **GND**.

### E. Audio (Buzzer)
Must be a **passive** buzzer to support tone generation.
* **Signal:** Connect positive pin to **Pin A5**.
* **Ground:** Connect negative pin to **GND**.

---

## 4. Software Libraries
Ensure the following libraries are installed in your Arduino IDE:

1.  **AccelStepper** (by Mike McCauley)
2.  **LiquidCrystal** (Built-in Arduino Library)

---

## 5. Operation Guide

### PC Mode (Automatic)
* **Default State:** The controller waits for serial commands (Baud: 9600).
*   **Default State:** The controller waits for serial commands (Baud: 9600).
*   **Protocol:** GS-232B compatible (supports `C`, `C2`, `Mxxx`, `Wxxx yyy`, etc.).
*   **Virtual Elevation:** Elevation is calculated virtually over time, as the 28BYJ-48 only controls Azimuth physically in this setup.

### Manual Mode (Calibration)
*   **Activation:** Press **Left** or **Right** button.
*   **Movement:** Hold button to move the rotator manually.
*   **Zero Set:** Press **Left + Right** buttons simultaneously to reset the Azimuth to 0° (North).
*   **Exit:** The system automatically returns to PC Mode when serial commands are received or after movement stops.

---

## 6. Serial Command Reference (GS-232B Subset)

The firmware parses the following commands (terminated by `CR` or `CRLF`). Case-insensitive.

| Command | Description | Functionality in this Firmware |
| :--- | :--- | :--- |
| **C** | Query Azimuth | Returns `AZ=xxx` |
| **C2** | Query Az/El | Returns `AZ=xxx EL=xxx` |
| **B** | Query Elevation | Returns `EL=xxx` (Virtual Elevation) |
| **Mxxx** | Move Azimuth | Moves rotor to angle `xxx` |
| **Wxxx yyy** | Move Az/El | Moves Az to `xxx` and virtual El to `yyy` |
| **R** | Right | Turns Clockwise usually |
| **L** | Left | Turns Counter-Clockwise usually |
| **A** / **S** | Stop | Stops all movement immediately |
| **U** / **D** | Up/Down | Sets virtual target Elevation to 180° / 0° |
| **E** | Elev Stop | Stops virtual Elevation change |
| **P36** | 360° Mode | Limits range to 0-360° (Blue LED Off) |
| **P45** | 450° Mode | Extends range to 0-450° (Blue LED On) |
| **Xn** | Speed | Set max speed level `n` (1-4). Base 200 + n*100 steps/sec |

---

## 7. Audio Feedback Codes (Buzzer)

The system provides acoustic feedback for status changes.

*   **Startup Melody:** 3 rising tones (C-E-G) $\rightarrow$ System Ready.
*   **Short High Beep:** Command received & valid (`SND_CMD_OK`).
*   **Long Low Beep:** Unknown command or Error (`SND_ERROR`).
*   **Double Dull Beep:** Limit reached (0° or Max) (`SND_LIMIT`).
*   **Rising Tone Sequence:** Zero Set calibration successful (`SND_ZERO_SET`).
*   **Short Click:** Movement Start / Stop (`SND_MOVE_START` / `SND_MOVE_STOP`).

---

## 8. LCD Status Layout

**Row 1 (Top):**
*   Displays the last received serial command (e.g., `RX:          M180`).
*   In Manual Mode, shows Calibration status (e.g., `CALIB: >>>`).

**Row 2 (Bottom):**
*   **Format:** `Axxx Eyyy Pmm *`
    *   `Axxx`: Current Azimuth (000-450)
    *   `Eyyy`: Current Elevation (000-180)
    *   `Pmm`: Mode (`P36` or `P45`)
    *   `*`: Blinking asterisk indicates active movement.

---

## 9. Simulation & Wokwi Configuration

This project includes a [Wokwi](https://wokwi.com) project file: `Circuit_diagram_wokwi.json`.
To simulate this setup without hardware:
1.  Go to [Wokwi.com](https://wokwi.com).
2.  Start a new **Arduino Uno** project.
3.  Press **F1** and select "Upload Project File...", then choose the `.json` file.
4.  Replace the code in the editor with the content of `arduino_code.ino`.
5.  Start the simulation.