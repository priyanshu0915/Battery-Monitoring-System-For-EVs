#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <WebServer.h>
#include <ArduinoJson.h>  // Add JSON library for better data handling
#include <ESPmDNS.h>

// WiFi Credentials
const char* ssid = "Priyanshu's Galaxy M53 5G";
const char* password = "23022017";
const char* hostname = "evbattery";

IPAddress local_IP(192, 168, 1, 200); 
IPAddress gateway(192, 168, 1, 1);    
IPAddress subnet(255, 255, 255, 0);   

WebServer server(80); // Create a web server on port 80

// Pin Definitions
#define VOLTAGE_PIN  34
#define CURRENT_PIN  35
#define DHT_PIN      13
#define DHT_TYPE     DHT11
#define RELAY_PIN    25  // Relay connected to GPIO 25 (for charging control ONLY)
#define FAN_ENA_PIN  26  // PWM control for fan
#define FAN_IN1_PIN  27  // Direction control for fan
#define FAN_IN2_PIN  14  // Direction control for fan

// Battery Parameters (Can be calibrated for specific battery type)
#define BATTERY_FULL_VOLTAGE 12.6     // LiPo 3S Battery
#define BATTERY_EMPTY_VOLTAGE 10.5
#define RATED_CAPACITY 100.0          // Rated capacity in Ah
#define CHARGING_EFFICIENCY 0.92      // Battery charging efficiency factor

// Charging/Discharging Threshold
#define CHARGING_CURRENT_THRESHOLD 0.2  // Current above this value means charging (positive)
#define DISCHARGING_CURRENT_THRESHOLD -0.1  // Current below this value means discharging (negative)

// Alert Thresholds
#define VOLTAGE_HIGH 12.8
#define VOLTAGE_LOW 10.0
#define CURRENT_HIGH 15.0
#define TEMP_HIGH 27.0                // Increased to more realistic threshold
#define TEMP_WARNING 30.0             // Added warning level
#define TEMP_OFF 25.0                 // Turn off fan if temperature is ≤ 25°C
#define DATA_SEND_INTERVAL 30000      // 30 seconds interval
#define TEMPERATURE_CHECK_INTERVAL 2000 // Check temperature every 2 seconds

// Sensor Calibration
#define REF_VOLTAGE 3.3
#define ADC_RESOLUTION 4096.0
#define R1 30000.0
#define R2 7500.0
#define ACS712_SENSITIVITY 0.185      // 185mV per Amp for 5A module

// Global Variables
DHT dht(DHT_PIN, DHT_TYPE);
float acs712_offset = 0.0;
bool fanOn = false;
bool chargingEnabled = true;  // Changed from relayState to chargingEnabled for clarity
unsigned long fanStartTime = 0;
unsigned long lastDataSendTime = 0;
unsigned long lastTempCheckTime = 0;
float ampHours = 0.0;                 // To track battery consumption
unsigned long lastCurrentReadTime = 0;
float lastCurrent = 0.0;
int alertLevel = 0;                   // 0=normal, 1=warning, 2=critical
bool isCharging = false;              // Flag to track battery state
unsigned long lastReadingTime = 0;    // To detect random relay triggers

// Google Sheets URL
const char* googleScriptURL = "https://script.google.com/macros/s/AKfycbzd_S6Yw1ER6QjDv73sr68Jyty3Fc-iwCksPG6h2kT80y_t8Q4T3Z_dH8wokT8RTlUB/exec";

// Function prototypes
float readVoltage();
float readCurrent();
float calculateSoC(float voltage);
float calculateSoH(float capacity);
void calibrateCurrentSensor();
void controlFan(float temperature);
void controlCharging(float voltage, float current, float temperature);
String getAlertMessage(int alertLevel);
String getBatteryState(float current);
void handleRoot();
void handleRelay();
void handleGetData();
void sendDataToGoogleSheets(float voltage, float current, float temperature, float soc, float soh, int alert);

void setup() {
  Serial.begin(115200);
  
  // Initialize pins
  pinMode(FAN_ENA_PIN, OUTPUT);
  pinMode(FAN_IN1_PIN, OUTPUT);
  pinMode(FAN_IN2_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);
  
  // Ensure everything is OFF initially
  digitalWrite(FAN_IN1_PIN, LOW);
  digitalWrite(FAN_IN2_PIN, LOW);
  analogWrite(FAN_ENA_PIN, 0);
  
  // IMPORTANT: Set initial relay state - LOW for charging ON (Normally Open configuration)
  digitalWrite(RELAY_PIN, LOW);
  
  // Initialize DHT sensor
  dht.begin();
  
  // Configure ADC
  analogSetAttenuation(ADC_11db);  // For higher voltage measurement range
  
  // Calibrate current sensor
  Serial.println("Calibrating current sensor...");
  calibrateCurrentSensor();

   
  // Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  
  Serial.print("Connected to WiFi. IP address: ");
  Serial.println(WiFi.localIP());
  
  // Initialize mDNS
  if (!MDNS.begin(hostname)) {
    Serial.println("Error setting up MDNS responder!");
  } else {
    Serial.println("mDNS responder started");
    Serial.print("You can now connect to http://");
    Serial.print(hostname);
    Serial.println(".local");
  }
  
  // Set up web server routes
  server.on("/", handleRoot);
  server.on("/toggleRelay", handleRelay);
  server.on("/getData", handleGetData);  // New endpoint to get live data
  server.begin();
  Serial.println("Web server started");
  
  lastCurrentReadTime = millis();
  lastReadingTime = millis();
}

void loop() {
  server.handleClient();  // Handle web clients
  
  unsigned long currentMillis = millis();
  
  // Read sensors
  float voltage = readVoltage();
  float current = readCurrent();
  
  // Determine battery state (charging or discharging)
  if (current > CHARGING_CURRENT_THRESHOLD) {
    isCharging = true;
  } else if (current < DISCHARGING_CURRENT_THRESHOLD) {
    isCharging = false;
  }
  // If current is between thresholds, no change to isCharging state (hysteresis)
  
  // Track energy consumption (Coulomb counting)
  unsigned long currentReadInterval = currentMillis - lastCurrentReadTime;
  if (currentReadInterval > 0) {
    // Calculate amp-hours using trapezoidal rule
    ampHours += (current + lastCurrent) / 2.0 * (currentReadInterval / 3600000.0);
    lastCurrentReadTime = currentMillis;
    lastCurrent = current;
  }
  
  // Check temperature frequently for safety
  if (currentMillis - lastTempCheckTime >= TEMPERATURE_CHECK_INTERVAL) {
    lastTempCheckTime = currentMillis;
    
    float temperature = dht.readTemperature();
    if (isnan(temperature)) {
      Serial.println("Failed to read temperature!");
      temperature = 0;  // Default to safe value
    }
    
    // Update alert level
    if (temperature > TEMP_HIGH || voltage > VOLTAGE_HIGH || voltage < VOLTAGE_LOW || current > CURRENT_HIGH) {
      alertLevel = 2;  // Critical
    } else if (temperature > TEMP_WARNING) {
      alertLevel = 1;  // Warning
    } else {
      alertLevel = 0;  // Normal
    }
    
    // Control fan and charging separately
    controlFan(temperature);  // Fan control based only on temperature
    controlCharging(voltage, current, temperature);  // Charging control based on battery state
    
    // Calculate battery metrics
    float soc = calculateSoC(voltage);
    float soh = calculateSoH(90);  // Assume 90Ah measured capacity for now
    
    // Print data to serial monitor
    Serial.println("-------- Battery Monitoring Status --------");
    Serial.print("Voltage: "); Serial.print(voltage, 2); Serial.println(" V");
    Serial.print("Current: "); Serial.print(current, 2); Serial.println(" A");
    Serial.print("Battery State: "); Serial.println(getBatteryState(current));
    Serial.print("Temperature: "); Serial.print(temperature, 1); Serial.println(" °C");
    Serial.print("SoC: "); Serial.print(soc, 1); Serial.println("%");
    Serial.print("SoH: "); Serial.print(soh, 1); Serial.println("%");
    Serial.print("Energy consumed: "); Serial.print(ampHours, 3); Serial.println(" Ah");
    Serial.print("Alert: "); Serial.print(alertLevel); 
    Serial.print(" ("); Serial.print(getAlertMessage(alertLevel)); Serial.println(")");
    Serial.print("Fan: "); Serial.println(fanOn ? "ON" : "OFF");
    Serial.print("Charging: "); Serial.println(chargingEnabled ? "ENABLED" : "DISABLED");
    Serial.print("Relay: "); Serial.println(digitalRead(RELAY_PIN) == HIGH ? "ON (Charging Disabled)" : "OFF (Charging Enabled)");
    Serial.println("-------------------------------------------");
    
    // Send data to Google Sheets periodically
    if (currentMillis - lastDataSendTime >= DATA_SEND_INTERVAL) {
      lastDataSendTime = currentMillis;
      sendDataToGoogleSheets(voltage, current, temperature, soc, soh, alertLevel);
    }
  }
  
  // Monitor for random relay triggers
  // Add a check if relay state doesn't match our intended charging state
  if (currentMillis - lastReadingTime >= 1000) { // Check every second
    lastReadingTime = currentMillis;
    
    bool relayPhysicalState = digitalRead(RELAY_PIN);
    bool intendedRelayState = !chargingEnabled; // Inverted logic: chargingEnabled = LOW on relay
    
    if (relayPhysicalState != intendedRelayState) {
      Serial.println("WARNING: Relay state mismatch detected!");
      Serial.print("Expected: "); 
      Serial.println(intendedRelayState ? "HIGH (Charging OFF)" : "LOW (Charging ON)");
      Serial.print("Actual: "); 
      Serial.println(relayPhysicalState ? "HIGH (Charging OFF)" : "LOW (Charging ON)");
      
      // Correct the relay state
      digitalWrite(RELAY_PIN, intendedRelayState);
      Serial.println("Corrected relay state");
    }
  }
}

// Function to calibrate ACS712 at startup
void calibrateCurrentSensor() {
  float sum = 0;
  for (int i = 0; i < 500; i++) {  // More samples for better accuracy
    sum += analogRead(CURRENT_PIN);
    delay(2);
  }
  acs712_offset = sum / 500;
  Serial.print("Current sensor offset: ");
  Serial.println(acs712_offset);
}

// Function to measure current with improved accuracy
float readCurrent() {
  float sum = 0;
  for (int i = 0; i < 50; i++) {
    sum += analogRead(CURRENT_PIN);
    delay(1);
  }
  float adc_value = sum / 50;
  float voltage = (adc_value * REF_VOLTAGE) / ADC_RESOLUTION;
  float offset_voltage = (acs712_offset * REF_VOLTAGE) / ADC_RESOLUTION;
  
  // Convert to amperes - middle point of ACS712 is 2.5V for 0A
  float current = (voltage - offset_voltage) / ACS712_SENSITIVITY;
  
  // Apply a small deadband to eliminate noise
  return (abs(current) < 0.15) ? 0.0 : current;
}

// Function to measure voltage with filtering
float readVoltage() {
  float sum = 0;
  for (int i = 0; i < 20; i++) {  // Multiple readings for stability
    sum += analogRead(VOLTAGE_PIN);
    delay(1);
  }
  float adc_value = sum / 20;
  float voltage_adc = ((float)adc_value * REF_VOLTAGE) / ADC_RESOLUTION;
  return voltage_adc * (R1 + R2) / R2;
}

// Improved SoC calculation with temperature compensation
float calculateSoC(float voltage) {
  // Apply a simple temperature compensation (can be refined with actual battery data)
  float temperature = dht.readTemperature();
  float temp_compensation = (temperature > 25) ? (temperature - 25) * -0.005 : 0;
  
  // Account for current draw impact on voltage
  float current = readCurrent();
  float ir_drop_compensation = (current > 0) ? current * 0.01 : 0;  // Simple IR drop model
  
  // Apply compensations to measured voltage
  float adjusted_voltage = voltage + ir_drop_compensation + temp_compensation;
  
  // Convert voltage to SoC (basic linear model)
  float soc = (adjusted_voltage - BATTERY_EMPTY_VOLTAGE) / (BATTERY_FULL_VOLTAGE - BATTERY_EMPTY_VOLTAGE) * 100;
  return constrain(soc, 0, 100);
}

// Calculate State of Health based on capacity
float calculateSoH(float measured_capacity) {
  return (measured_capacity / RATED_CAPACITY) * 100;
}

// Function to get text description of alert level
String getAlertMessage(int level) {
  switch (level) {
    case 0: return "Normal";
    case 1: return "Warning";
    case 2: return "Critical";
    default: return "Unknown";
  }
}

// Function to get battery state text
String getBatteryState(float current) {
  if (current > CHARGING_CURRENT_THRESHOLD) {
    return "Charging";
  } else if (current < DISCHARGING_CURRENT_THRESHOLD) {
    return "Discharging";
  } else {
    return "Idle";
  }
}

// Function to control only the fan based on temperature
void controlFan(float temperature) {
  // Safety check - if temperature reading failed, turn on fan as precaution
  if (isnan(temperature)) {
    digitalWrite(FAN_IN1_PIN, HIGH);
    digitalWrite(FAN_IN2_PIN, LOW);
    analogWrite(FAN_ENA_PIN, 200);  // Medium speed
    fanOn = true;
    return;
  }
  
  // Progressive fan speed control
  int dutyCycle = 0;
  
  if (temperature > TEMP_HIGH) {
    // Critical temperature - maximum cooling
    dutyCycle = 170;  // Full speed
    if (!fanOn) {
      fanOn = true;
      fanStartTime = millis();
    }
  } 
  else if (temperature > TEMP_WARNING) {
    // Warning temperature - proportional cooling
    dutyCycle = map(temperature, TEMP_WARNING, TEMP_HIGH, 150, 255);
    if (!fanOn) {
      fanOn = true;
      fanStartTime = millis();
    }
  }
  else if (fanOn && temperature <= TEMP_OFF) {
    // Temperature is now acceptable, turn off fan
    fanOn = false;
    dutyCycle = 0;
  }
  else if (fanOn) {
    // Temperature is dropping but still above TEMP_OFF, reduce fan speed
    dutyCycle = map(temperature, TEMP_OFF, TEMP_WARNING, 100, 150);
  }
  
  // Apply the calculated duty cycle
  if (dutyCycle > 0) {
    digitalWrite(FAN_IN1_PIN, HIGH);
    digitalWrite(FAN_IN2_PIN, LOW);
    analogWrite(FAN_ENA_PIN, dutyCycle);
    Serial.print("Fan ON | Speed: ");
    Serial.println(dutyCycle);
  } else {
    digitalWrite(FAN_IN1_PIN, LOW);
    digitalWrite(FAN_IN2_PIN, LOW);
    analogWrite(FAN_ENA_PIN, 0);
    Serial.println("Fan OFF");
  }
}

// Function to control only the charging relay based on battery state
// INVERTED LOGIC: Relay LOW = Charging ON, Relay HIGH = Charging OFF
void controlCharging(float voltage, float current, float temperature) {
  // Only apply auto-control if manual control is not in effect
  if (chargingEnabled) {  // We want charging to be ON
    // Disconnect charging if:
    // - Battery is full
    // - Temperature is too high
    // - Already charging and voltage exceeds threshold
    if (voltage >= BATTERY_FULL_VOLTAGE || 
        temperature > TEMP_HIGH || 
        (isCharging && voltage > VOLTAGE_HIGH)) {
      //digitalWrite(RELAY_PIN, HIGH);  // Set relay HIGH to disable charging
      Serial.println("Relay set HIGH: Auto-disabled charging (battery full or temperature critical)");
      chargingEnabled = false;  // Update our tracking variable
    }
  } 
  else {  // Charging is currently disabled
    // Enable charging if:
    // - Battery is not full
    // - Temperature is safe
    // - In load/discharging state and voltage drops below optimal
    if (voltage < BATTERY_FULL_VOLTAGE && 
        temperature < TEMP_HIGH && 
        !isCharging && 
        voltage < (BATTERY_FULL_VOLTAGE - 0.3)) {
      //digitalWrite(RELAY_PIN, LOW);  // Set relay LOW to enable charging
      Serial.println("Relay set LOW: Auto-enabled charging (battery needs charging)");
      chargingEnabled = true;  // Update our tracking variable
    }
  }
}

// Handle relay toggle request from the web interface
void handleRelay() {
  if (server.hasArg("state")) {
    int state = server.arg("state").toInt();
    chargingEnabled = (state == 1);
    digitalWrite(RELAY_PIN, chargingEnabled ? LOW : HIGH);  // INVERTED LOGIC
    server.send(200, "text/plain", chargingEnabled ? "Charging ON" : "Charging OFF");
    Serial.print("Charging manually set to: ");
    Serial.println(chargingEnabled ? "ON" : "OFF");
  } else {
    chargingEnabled = !chargingEnabled;
    digitalWrite(RELAY_PIN, chargingEnabled ? LOW : HIGH);  // INVERTED LOGIC
    server.send(200, "text/plain", chargingEnabled ? "Charging ON" : "Charging OFF");
    Serial.print("Charging toggled to: ");
    Serial.println(chargingEnabled ? "ON" : "OFF");
  }
}

// Handle data request from the web interface
void handleGetData() {
  float voltage = readVoltage();
  float current = readCurrent();
  float temperature = dht.readTemperature();
  float soc = calculateSoC(voltage);
  float soh = calculateSoH(90);
  
  // Create JSON response
  StaticJsonDocument<256> doc;
  doc["voltage"] = voltage;
  doc["current"] = current;
  doc["temperature"] = temperature;
  doc["soc"] = soc;
  doc["soh"] = soh;
  doc["ampHours"] = ampHours;
  doc["alert"] = alertLevel;
  doc["alertText"] = getAlertMessage(alertLevel);
  doc["fan"] = fanOn;
  doc["relay"] = chargingEnabled;  // Changed from relayState to chargingEnabled
  doc["batteryState"] = getBatteryState(current);
  
  String response;
  serializeJson(doc, response);
  
  server.send(200, "application/json", response);
}

// Send data to Google Sheets
void sendDataToGoogleSheets(float voltage, float current, float temperature, float soc, float soh, int alert) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = String(googleScriptURL) + 
                "?voltage=" + String(voltage, 2) +
                "&current=" + String(current, 2) + 
                "&temperature=" + String(temperature, 1) +
                "&soc=" + String(soc, 1) + 
                "&soh=" + String(soh, 1) + 
                "&alert=" + String(alert) +
                "&ampHours=" + String(ampHours, 3) +
                "&fanStatus=" + String(fanOn ? 1 : 0) +
                "&chargingStatus=" + String(chargingEnabled ? 1 : 0) +  // Updated to use chargingEnabled
                "&batteryState=" + String(isCharging ? "Charging" : "Discharging");
    
    http.begin(url);
    int httpResponseCode = http.GET();
    
    if (httpResponseCode > 0) {
      Serial.print("Data sent to Google Sheets. Response: ");
      Serial.println(http.getString());
    } else {
      Serial.print("Error sending data to Google Sheets: ");
      Serial.println(httpResponseCode);
    }
    
    http.end();
  } else {
    Serial.println("WiFi not connected. Data not sent to Google Sheets.");
  }
}

// Serve the enhanced web interface
void handleRoot() {
  String page = R"rawliteral(
  <!DOCTYPE html>
  <html>
  <head>
      <title>EV Battery Monitoring System</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
          body {
              font-family: Arial, sans-serif;
              text-align: center;
              margin: 0;
              padding: 20px;
              background-color: #f0f8ff;
          }
          .container {
              max-width: 800px;
              margin: 0 auto;
              background-color: white;
              border-radius: 10px;
              padding: 20px;
              box-shadow: 0 0 10px rgba(0,0,0,0.1);
          }
          h1 {
              color: #0066cc;
          }
          .grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 15px;
              margin-bottom: 20px;
          }
          .card {
              background-color: #f8f9fa;
              border-radius: 8px;
              padding: 15px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.05);
          }
          .value {
              font-size: 24px;
              font-weight: bold;
              margin: 10px 0;
          }
          .label {
              color: #666;
              font-size: 14px;
          }
          .button {
              font-size: 18px;
              padding: 12px 24px;
              background-color: #28a745;
              color: white;
              border: none;
              border-radius: 5px;
              cursor: pointer;
              transition: background-color 0.3s;
          }
          .button.off {
              background-color: #dc3545;
          }
          .status {
              margin-top: 10px;
              padding: 10px;
              border-radius: 5px;
              font-weight: bold;
          }
          .status.normal {
              background-color: #d4edda;
              color: #155724;
          }
          .status.warning {
              background-color: #fff3cd;
              color: #856404;
          }
          .status.critical {
              background-color: #f8d7da;
              color: #721c24;
          }
          @media (max-width: 600px) {
              .grid {
                  grid-template-columns: 1fr;
              }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <h1>EV Battery Monitoring System</h1>
          
          <div class="grid">
              <div class="card">
                  <div class="label">Voltage</div>
                  <div class="value" id="voltage">-- V</div>
              </div>
              <div class="card">
                  <div class="label">Current</div>
                  <div class="value" id="current">-- A</div>
              </div>
              <div class="card">
                  <div class="label">Temperature</div>
                  <div class="value" id="temperature">-- °C</div>
              </div>
              <div class="card">
                  <div class="label">State of Charge</div>
                  <div class="value" id="soc">--%</div>
              </div>
              <div class="card">
                  <div class="label">Battery State</div>
                  <div class="value" id="batteryState">--</div>
              </div>
              <div class="card">
                  <div class="label">Energy Used</div>
                  <div class="value" id="ampHours">-- Ah</div>
              </div>
          </div>
          
          <div class="status" id="alertStatus">System Status: Unknown</div>
          
          <div style="margin: 20px 0;">
              <div style="margin-bottom: 10px;">Fan Status: <span id="fanStatus">Unknown</span></div>
              <button id="relayButton" class="button" onclick="toggleRelay()">Loading...</button>
          </div>
      </div>
      
      <script>
          let chargingEnabled = true;
          
          // Fetch initial data when page loads
          window.onload = function() {
              fetchData();
              // Update data every 5 seconds
              setInterval(fetchData, 5000);
          };
          
          function fetchData() {
              fetch('/getData')
                  .then(response => response.json())
                  .then(data => {
                      document.getElementById("voltage").innerText = data.voltage.toFixed(2) + " V";
                      document.getElementById("current").innerText = data.current.toFixed(2) + " A";
                      document.getElementById("temperature").innerText = data.temperature.toFixed(1) + " °C";
                      document.getElementById("soc").innerText = data.soc.toFixed(1) + "%";
                      document.getElementById("ampHours").innerText = data.ampHours.toFixed(2) + " Ah";
                      document.getElementById("batteryState").innerText = data.batteryState;
                      
                      // Update status message and style
                      const alertStatus = document.getElementById("alertStatus");
                      alertStatus.innerText = "System Status: " + data.alertText;
                      alertStatus.className = "status " + 
                          (data.alert === 0 ? "normal" : data.alert === 1 ? "warning" : "critical");
                      
                      // Update fan status
                      document.getElementById("fanStatus").innerText = data.fan ? "Running" : "Off";
                      
                      // Update relay button
                      chargingEnabled = data.relay;
                      const btn = document.getElementById("relayButton");
                      btn.innerText = chargingEnabled ? "Stop Charging" : "Start Charging";
                      btn.className = "button " + (chargingEnabled ? "off" : "");
                  })
                  .catch(error => console.error('Error fetching data:', error));
          }
          
          function toggleRelay() {
              chargingEnabled = !chargingEnabled;
              fetch(`/toggleRelay?state=${chargingEnabled ? 1 : 0}`)
                  .then(response => response.text())
                  .then(data => {
                      const btn = document.getElementById("relayButton");
                      btn.innerText = chargingEnabled ? "Stop Charging" : "Start Charging";
                      btn.className = "button " + (chargingEnabled ? "off" : "");
                  })
                  .catch(error => {
                      console.error('Error toggling relay:', error);
                      chargingEnabled = !chargingEnabled; // Revert on failure
                  });
          }
      </script>
  </body>
  </html>
  )rawliteral";

  server.send(200, "text/html", page);
}
