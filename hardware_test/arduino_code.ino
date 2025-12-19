#include <Arduino.h>
#include <LiquidCrystal.h>
#include <AccelStepper.h>

// =================== KONFIGURATION ===================
static const uint32_t PROTO_BAUD = 9600;

// Motor-Kalibrierung: 28BYJ-48 im Halbschritt-Modus
static const float STEPS_PER_DEG = 4096.0 / 360.0; 
static const int MAX_AZ_LIMIT = 450;
static const int MAX_EL_LIMIT = 180; 

static const float CALIB_SPEED = 400.0; 
static const float VIRT_EL_SPEED_DEFAULT = 5.0; // Grad pro Sekunde

// =================== PINS ============================
LiquidCrystal lcd(12, 11, 6, 5, 4, 2);

const uint8_t LED_MOVING = A0;
const uint8_t LED_MODE   = A1;
const uint8_t LED_ERROR  = A2;

const uint8_t PIN_BTN_LEFT  = A3; 
const uint8_t PIN_BTN_RIGHT = A4; 
const uint8_t PIN_BUZZER    = A5; // Passive Buzzer

// AZ-Stepper (IN1, IN3, IN2, IN4)
AccelStepper stepper(AccelStepper::HALF4WIRE, 7, 9, 8, 10);

// =================== SOUND DEFINITIONS ===============
enum SoundType {
  SND_STARTUP,
  SND_CMD_OK,
  SND_ERROR,
  SND_LIMIT,
  SND_ZERO_SET,
  SND_MOVE_START,
  SND_MOVE_STOP
};

// =================== STATE MANAGEMENT ================
enum class MotionMode { PC_CONTROL, MANUAL_CALIB };
static MotionMode currentMode = MotionMode::PC_CONTROL;

static int azModeMax = MAX_AZ_LIMIT;
static int speedLevel = 2;

static float curAz = 0;
static float curEl = 0; 
static float tgtAz = 0;
static float tgtEl = 0; 
static float virElSpeed = VIRT_EL_SPEED_DEFAULT;

static char lastRx[17] = "RX: (ready)     ";
static char rawCmd[14] = "(ready)";
static uint32_t lastCmdTime = 0;
static uint32_t errLedOffAt = 0;
static uint32_t c2LedOffAt = 0; // Timer für blaue LED
static uint32_t lastMicros = 0;
static bool wasMoving = false; // Für Sound-Erkennung

// =================== SOUND ENGINE ====================
static void playSound(SoundType type) {
  switch (type) {
    case SND_STARTUP:
      tone(PIN_BUZZER, 523, 100); delay(120);
      tone(PIN_BUZZER, 659, 100); delay(120);
      tone(PIN_BUZZER, 784, 200); 
      break;
    case SND_CMD_OK:
      tone(PIN_BUZZER, 2000, 50); // Kurz & Hell
      break;
    case SND_ERROR:
      tone(PIN_BUZZER, 150, 400); // Tief & Lang
      break;
    case SND_LIMIT:
      tone(PIN_BUZZER, 100, 200); // Dumpf, ohne Delay
      break;
    case SND_ZERO_SET:
      tone(PIN_BUZZER, 880, 100); delay(100);
      tone(PIN_BUZZER, 1760, 400);
      break;
    case SND_MOVE_START:
      tone(PIN_BUZZER, 800, 30); // Kurzer 'Click' Start
      break;
    case SND_MOVE_STOP:
      tone(PIN_BUZZER, 400, 30); // Kurzer 'Click' Stop
      break;
  }
}

// =================== HELPER ==========================
static float clamp(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

static String fmt3(int v) {
  char buf[4];
  snprintf(buf, sizeof(buf), "%03d", (int)clamp(v, 0, 999));
  return String(buf);
}

static void sendLine(const String& s) {
  Serial.print(s); Serial.print("\r\n");
}

static void lcdUpdateRow(uint8_t row, const char* text) {
  lcd.setCursor(0, row);
  char buf[17];
  memset(buf, ' ', 16); buf[16] = 0;
  strncpy(buf, text, strlen(text) < 16 ? strlen(text) : 16);
  lcd.print(buf);
}

static void updateTopRow() {
  uint32_t dt = (millis() - lastCmdTime) / 1000;
  int m = dt / 60;
  int s = dt % 60;
  char timeStr[8];
  if (m > 99) snprintf(timeStr, sizeof(timeStr), "99:59");
  else snprintf(timeStr, sizeof(timeStr), "%d:%02d", m, s);
  
  int timeLen = strlen(timeStr);
  int cmdLen = strlen(rawCmd);
  
  char line[17];
  // Check if we have space: "RX:"(3) + command + " "(1) + time
  if (3 + cmdLen + 1 + timeLen <= 16) {
    int spaces = 16 - (3 + cmdLen + timeLen);
    // Easier construction:
    strcpy(line, "RX:");
    strcat(line, rawCmd);
    for(int i=0; i<spaces; i++) strcat(line, " ");
    strcat(line, timeStr);
  } 
  else if (3 + cmdLen + timeLen <= 16) {
    // Fits without space
    snprintf(line, sizeof(line), "RX:%s%s", rawCmd, timeStr);
  }
  else {
    // Doesn't fit, show only command
    snprintf(line, sizeof(line), "RX:%s", rawCmd);
  }
  
  lcdUpdateRow(0, line);
  // Keep lastRx updated so other modes (CALIB) can restore it if needed
  strncpy(lastRx, line, 16); lastRx[16] = 0;
}

// =================== PROTOKOLL (PC) ==================
static void handleCommand(char* cmd) {
  if (currentMode == MotionMode::MANUAL_CALIB) return;

  // New C2 Logic: Blink LED, remove from display
  if (!strcmp(cmd, "C2")) { 
     digitalWrite(LED_MODE, HIGH);
     c2LedOffAt = millis() + 100; // 100ms blink
     sendLine("AZ=" + fmt3(curAz) + " EL=" + fmt3(curEl)); 
     return; 
  }

  strncpy(rawCmd, cmd, 13); rawCmd[13] = 0;
  lastCmdTime = millis();
  updateTopRow();

  // --- Abfragen (Stumm) ---
  if (!strcmp(cmd, "C")) { sendLine("AZ=" + fmt3(curAz)); return; }
  // C2 handled above
  if (!strcmp(cmd, "B")) { sendLine("EL=" + fmt3(curEl)); return; }

  // --- Befehle (Mit Sound) ---
  bool isCmd = true;

  if (!strcmp(cmd, "A") || !strcmp(cmd, "S")) { 
    stepper.stop(); tgtEl = curEl; Serial.write('\r'); 
  }
  else if (!strcmp(cmd, "R")) { 
    stepper.moveTo(100000); Serial.write('\r'); 
  }
  else if (!strcmp(cmd, "L")) { 
    stepper.moveTo(-100000); Serial.write('\r'); 
  }
  else if (!strcmp(cmd, "P36")) { 
    azModeMax = 360; Serial.write('\r'); 
  }
  else if (!strcmp(cmd, "P45")) { 
    azModeMax = MAX_AZ_LIMIT; Serial.write('\r'); 
  }
  else if (cmd[0] == 'X') { 
    speedLevel = cmd[1]-'0'; 
    float s = 200.0 + (speedLevel * 100.0);
    stepper.setMaxSpeed(s); Serial.write('\r'); 
  }
  else if (cmd[0] == 'M' || cmd[0] == 'W') {
    int val = atoi(cmd + 1);
    tgtAz = clamp(val, 0, azModeMax);
    stepper.moveTo(lround(tgtAz * STEPS_PER_DEG));
    if (cmd[0] == 'W' && strlen(cmd) >= 8) {
       tgtEl = clamp(atoi(cmd + 5), 0, MAX_EL_LIMIT);
    }
    Serial.write('\r'); 
  }
  else if (!strcmp(cmd, "U")) { tgtEl = 180; Serial.write('\r'); }
  else if (!strcmp(cmd, "D")) { tgtEl = 0;   Serial.write('\r'); }
  else if (!strcmp(cmd, "E")) { tgtEl = curEl; Serial.write('\r'); }
  else {
    // Unbekannt -> Error
    isCmd = false;
    digitalWrite(LED_ERROR, HIGH); errLedOffAt = millis() + 500;
    playSound(SND_ERROR);
  }

  if (isCmd) playSound(SND_CMD_OK);
}

// =================== SETUP ===========================
void setup() {
  Serial.begin(PROTO_BAUD);
  pinMode(LED_MOVING, OUTPUT); pinMode(LED_MODE, OUTPUT); pinMode(LED_ERROR, OUTPUT);
  pinMode(PIN_BTN_LEFT, INPUT_PULLUP); pinMode(PIN_BTN_RIGHT, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);

  lcd.begin(16, 2);
  lcdUpdateRow(0, "GS-232B SOUND");
  lcdUpdateRow(1, "INIT...");
  
  stepper.setMaxSpeed(400);
  stepper.setAcceleration(300);
  stepper.setCurrentPosition(0);
  
  digitalWrite(LED_MODE, LOW);
  lastMicros = micros();

  playSound(SND_STARTUP);
  lcdUpdateRow(1, "READY");
}

// =================== LOOP ============================
void loop() {
  // 1. INPUTS LESEN
  bool btnL = !digitalRead(PIN_BTN_LEFT);
  bool btnR = !digitalRead(PIN_BTN_RIGHT);

  // 2. LOGIK
  if (btnL || btnR) {
    // === CALIB MODE ===
    currentMode = MotionMode::MANUAL_CALIB;

    if (btnL && btnR) { // ZERO SET
      stepper.setSpeed(0);
      stepper.setCurrentPosition(0);
      curAz = 0;
      tgtAz = 0; tgtEl = 0; curEl = 0; // Reset alles
      
      lcdUpdateRow(0, ">> ZERO SET! <<");
      lcdUpdateRow(1, "Pos: 000 (North)");
      playSound(SND_ZERO_SET);
      delay(1000); 
      
      while(Serial.available()) Serial.read(); // Buffer leeren
      lcdUpdateRow(0, lastRx);
    }
    else if (btnR) {
      stepper.setSpeed(CALIB_SPEED); stepper.runSpeed();
      lcdUpdateRow(0, "CALIB: >>>");
    }
    else if (btnL) {
      stepper.setSpeed(-CALIB_SPEED); stepper.runSpeed();
      lcdUpdateRow(0, "CALIB: <<<");
    }
  } else {
    // === PC MODE ===
    if (currentMode == MotionMode::MANUAL_CALIB) {
      // Übergang zurück zum PC: Stoppen
      stepper.setSpeed(0); stepper.moveTo(stepper.currentPosition());
      tgtAz = curAz; // Ziel auf aktuelle Pos setzen damit er nicht wegfährt
      currentMode = MotionMode::PC_CONTROL;
      lcdUpdateRow(0, lastRx);
    }

    // Limits prüfen
    long curSteps = stepper.currentPosition();
    long maxSteps = azModeMax * STEPS_PER_DEG;
    
    // Non-blocking limit sound timer
    static uint32_t lastLimitSound = 0;

    // Check UPPER Limit
    // Logic: If current position is beyond limit AND target is BEYOND limit (or at limit)
    // trying to go further out. We force target to limit.
    // We allow target < maxSteps (escape)!
    if (curSteps > maxSteps && stepper.targetPosition() > maxSteps) {
       stepper.moveTo(maxSteps); 
       if (millis() - lastLimitSound > 500) {
         playSound(SND_LIMIT);
         lastLimitSound = millis();
       }
    }
    
    // Check LOWER Limit
    if (curSteps < 0 && stepper.targetPosition() < 0) {
       stepper.moveTo(0); 
       if (millis() - lastLimitSound > 500) {
         playSound(SND_LIMIT);
         lastLimitSound = millis();
       }
    }

    stepper.run();
  }

  // 3. ELEVATION & POS UPDATE
  curAz = stepper.currentPosition() / STEPS_PER_DEG;
  
  bool isAzMoving = stepper.isRunning();
  bool isElMoving = false;

  // Virtuelle EL Berechnung
  if (currentMode == MotionMode::PC_CONTROL) {
    uint32_t now = micros();
    float dt = (now - lastMicros) / 1000000.0;
    lastMicros = now;
    
    if (abs(tgtEl - curEl) > 0.5) {
      isElMoving = true;
      curEl += (tgtEl > curEl ? 1 : -1) * virElSpeed * dt;
      curEl = clamp(curEl, 0, MAX_EL_LIMIT);
    }
  } else { lastMicros = micros(); }

  // 4. SOUNDS BEI BEWEGUNG (AZ oder EL)
  bool isAnyMoving = isAzMoving || isElMoving;
  
  if (isAnyMoving && !wasMoving) playSound(SND_MOVE_START);
  if (!isAnyMoving && wasMoving) playSound(SND_MOVE_STOP);
  wasMoving = isAnyMoving;

  // 5. LED & LCD
  digitalWrite(LED_MOVING, isAnyMoving);

  static uint32_t lUpdate = 0;
  if (millis() - lUpdate > 200) {
    lUpdate = millis();
    if (currentMode == MotionMode::PC_CONTROL) {
      char b[17];
      snprintf(b, 17, "A%03d E%03d %s %c", 
               (int)curAz, (int)curEl, 
               (azModeMax>360?"P45":"P36"), 
               (isAnyMoving?'*':' '));
      lcdUpdateRow(1, b);
      updateTopRow();
    } else {
      char b[17];
      snprintf(b, 17, "RAW: %ld", stepper.currentPosition());
      lcdUpdateRow(1, b);
    }
  }

  // 6. SERIAL INPUT
  if (currentMode == MotionMode::PC_CONTROL) {
    static char inbuf[32]; static uint8_t idx = 0;
    while (Serial.available()) {
      char c = Serial.read();
      if (c == '\n') continue;
      if (c == '\r') { inbuf[idx] = 0; handleCommand(inbuf); idx = 0; }
      else if (idx < 31) inbuf[idx++] = toupper(c);
    }
  }
  
  if (errLedOffAt && millis() > errLedOffAt) { digitalWrite(LED_ERROR, LOW); errLedOffAt = 0; }
  if (c2LedOffAt && millis() > c2LedOffAt) { digitalWrite(LED_MODE, LOW); c2LedOffAt = 0; }
}