# Battery Monitoring System for EVs 🚗⚡  

This is an **IoT-based battery monitoring system** designed to track and optimize **battery health** in **electric vehicles (EVs)**. The system continuously monitors **voltage, current, temperature, and charge status** while providing **real-time alerts and control options** through a cloud-based platform.  

---

## 🚀 Features  
- 📡 **IoT Integration:** Uses **ESP32** for wireless communication and real-time monitoring.  
- 🔋 **Battery Monitoring:** Tracks **voltage, current, and charge status** of **ICR 18650 (11.1V, 1200mAh, 10A) cells**.  
- 🌡️ **Temperature Control:** Uses a **thermistor-based sensor** to monitor battery temperature.  
- ❄️ **Cooling System:** Automatically activates a cooling system if the battery **overheats**.  
- 🌐 **Web-Based Dashboard:** Allows users to **monitor parameters and control relays** remotely.  
- 📲 **App Integration:** Integrated with **Google AppSheet** for notifications and quick access.  

---

## 🛠 Hardware & Components  
- **ESP32** (Microcontroller & IoT module)  
- **ICR 18650 Cells** (11.1V, 1200mAh, 10A)  
- **Thermistor Sensor** (For temperature measurement)  
- **Voltage & Current Sensors**  
- **Cooling System (Fan/Relay-controlled unit)**  
- **Relay Module** (For external control)  

---

## 🔧 Software & Tools  
- **Arduino IDE** (For ESP32 programming)  
- **Google AppSheet** (For cloud-based monitoring)  
- **Custom Web Dashboard** (For real-time battery stats & relay control)  

---

## 📖 How It Works  
1. 📡 **ESP32 collects data** from voltage, current, and temperature sensors.  
2. 🔄 **Data is processed** and sent to the cloud for real-time monitoring.  
3. ❄️ **Cooling system activates** if temperature exceeds a threshold.  
4. 🌍 **Web & App dashboards** allow users to track battery health & control relays.  

---


