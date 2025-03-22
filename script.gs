/**
 * Google Apps Script for EV Battery Monitoring System
 * 
 * This script receives data from an ESP32-based battery monitoring system
 * and logs it to a Google Sheet. It also provides basic data visualization
 * and alert notifications.
 * 
 * To use:
 * 1. Create a new Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this code
 * 4. Deploy as web app (Execute as: Me, Who has access: Anyone)
 * 5. Copy the web app URL to your ESP32 code (googleScriptURL variable)
 */

// Configuration
const CONFIG = {
  SHEET_NAME: "BatteryData",
  ALERT_EMAIL: "", // Optional: Add your email to receive alerts
  ALERT_COOLDOWN_HOURS: 3, // Hours between alert emails
  MAX_ROWS: 5000 // Maximum number of data rows before clearing old data
};

/**
 * Process incoming HTTP requests from the ESP32
 */
function doGet(e) {
  try {
    // Get data from request parameters
    const params = e.parameter;
    
    // Validate required parameters
    const requiredParams = ["voltage", "current", "temperature", "soc", "soh", "alert"];
    for (const param of requiredParams) {
      if (!params[param]) {
        return ContentService.createTextOutput(`Error: Missing parameter '${param}'`);
      }
    }
    
    // Parse parameters (converting to numbers and handling optional params)
    const data = {
      timestamp: new Date(),
      voltage: parseFloat(params.voltage),
      current: parseFloat(params.current),
      temperature: parseFloat(params.temperature),
      soc: parseFloat(params.soc),
      soh: parseFloat(params.soh),
      alert: parseInt(params.alert),
      ampHours: params.ampHours ? parseFloat(params.ampHours) : 0,
      fanStatus: params.fanStatus ? (params.fanStatus === "1") : false,
      relayStatus: params.relayStatus ? (params.relayStatus === "1") : false
    };
    
    // Determine battery status
    data.batteryStatus = determineBatteryStatus(data);
    
    // Log the data
    logData(data);
    
    // Check for alerts
    if (data.alert >= 2 && CONFIG.ALERT_EMAIL) {
      sendAlertEmail(data);
    }
    
    // Return success message
    return ContentService.createTextOutput("Data logged successfully");
    
  } catch (error) {
    // Log error and return error message
    console.error("Error processing request:", error);
    return ContentService.createTextOutput("Error: " + error.message);
  }
}

/**
 * Determine battery status based on various parameters
 */
function determineBatteryStatus(data) {
  // Define status thresholds
  const thresholds = {
    // State of Charge thresholds
    criticalLowSoC: 20,
    lowSoC: 30,
    mediumSoC: 70,
    highSoC: 90,
    
    // State of Health thresholds
    poorSoH: 60,
    averageSoH: 80,
    goodSoH: 90,
    
    // Temperature thresholds
    lowTemp: 5,
    highTemp: 35,
    criticalHighTemp: 45,
    
    // Voltage thresholds (adjust based on your battery type)
    criticalLowVoltage: 10.5,  // For a 12V battery
    lowVoltage: 11.0,
    normalMinVoltage: 11.8,
    normalMaxVoltage: 12.7,
    highVoltage: 14.0,
    
    // Current thresholds
    highChargeCurrent: 10,
    highDischargeCurrent: -10
  };
  
  // Determine if charging or discharging
  const isCharging = data.current > 0.2;  // Small positive current threshold for charging
  const isDischarging = data.current < -0.2;  // Small negative current threshold for discharging
  
  // Check critical conditions first
  if (data.alert == 2) {
    return "CRITICAL";
  }
  
  if (data.temperature > thresholds.criticalHighTemp) {
    return "OVERHEATING";
  }
  
  if (data.voltage < thresholds.criticalLowVoltage) {
    return "CRITICALLY LOW";
  }
  
  if (data.soc < thresholds.criticalLowSoC) {
    return "CRITICALLY LOW";
  }
  
  // Check charging status
  if (isCharging) {
    if (data.soc > thresholds.highSoC) {
      return "ALMOST FULL";
    }
    return "CHARGING";
  }
  
  if (isDischarging) {
    if (data.soc < thresholds.lowSoC) {
      return "LOW CHARGE";
    }
    if (data.current < thresholds.highDischargeCurrent) {
      return "HIGH DISCHARGE";
    }
    return "DISCHARGING";
  }
  
  // Check SoH-based status for idle battery
  if (data.soh < thresholds.poorSoH) {
    return "DEGRADED";
  }
  
  if (data.alert == 1) {
    return "WARNING";
  }
  
  // If no specific conditions are met, determine based on SoC
  if (data.soc > thresholds.highSoC) {
    return "FULL";
  } else if (data.soc > thresholds.mediumSoC) {
    return "GOOD";
  } else if (data.soc > thresholds.lowSoC) {
    return "MODERATE";
  } else {
    return "LOW";
  }
}

/**
 * Get color code for battery status
 */
function getBatteryStatusColor(status) {
  switch (status) {
    case "CRITICALLY LOW": return "#b71c1c"; // Dark red
    case "CRITICAL": return "#b71c1c"; // Dark red
    case "OVERHEATING": return "#b71c1c"; // Dark red
    case "LOW CHARGE": return "#f44336"; // Red
    case "HIGH DISCHARGE": return "#f44336"; // Red
    case "DEGRADED": return "#f44336"; // Red
    case "WARNING": return "#ff9800"; // Orange
    case "LOW": return "#ffc107"; // Amber
    case "MODERATE": return "#ffeb3b"; // Yellow
    case "CHARGING": return "#2196f3"; // Blue
    case "DISCHARGING": return "#64b5f6"; // Light Blue
    case "GOOD": return "#4caf50"; // Green
    case "ALMOST FULL": return "#8bc34a"; // Light Green
    case "FULL": return "#388e3c"; // Dark Green
    default: return "#9e9e9e"; // Grey for unknown
  }
}

/**
 * Log data to the spreadsheet
 */
function logData(data) {
  // Get the active spreadsheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Try to get the data sheet, create it if it doesn't exist
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = createDataSheet();
  }
  
  // Format timestamp
  const formattedTimestamp = Utilities.formatDate(
    data.timestamp,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
  
  // Get alert status text
  const alertText = getAlertText(data.alert);
  
  // Add data row
  sheet.appendRow([
    formattedTimestamp,
    data.voltage,
    data.current,
    data.temperature,
    data.soc,
    data.soh,
    data.ampHours,
    alertText,
    data.fanStatus ? "ON" : "OFF",
    data.relayStatus ? "ON" : "OFF",
    data.batteryStatus
  ]);
  
  // Keep spreadsheet size manageable
  manageSheetSize(sheet);
  
  // Update dashboard indicators
  updateDashboard(data);
}

/**
 * Create a new data sheet with headers
 */
function createDataSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  
  // Add headers
  sheet.appendRow([
    "Timestamp",
    "Voltage (V)",
    "Current (A)",
    "Temperature (°C)",
    "SoC (%)",
    "SoH (%)",
    "Energy Used (Ah)",
    "Alert Status",
    "Fan Status",
    "Charging Status",
    "Battery Status"
  ]);
  
  // Format headers
  sheet.getRange("A1:K1").setFontWeight("bold");
  sheet.setFrozenRows(1);
  
  // Auto-resize columns
  sheet.autoResizeColumns(1, 11);
  
  // Create dashboard sheet
  createDashboardSheet();
  
  return sheet;
}

/**
 * Create a dashboard sheet for summary information
 */
function createDashboardSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Check if dashboard already exists
  let dashboard = ss.getSheetByName("Dashboard");
  if (dashboard) {
    return dashboard;
  }
  
  // Create new dashboard
  dashboard = ss.insertSheet("Dashboard", 0);
  
  // Set up dashboard layout
  dashboard.setColumnWidth(1, 150);
  dashboard.setColumnWidth(2, 150);
  
  // Add title
  dashboard.getRange("A1:C1").merge();
  dashboard.getRange("A1").setValue("EV BATTERY MONITORING SYSTEM");
  dashboard.getRange("A1").setFontSize(16);
  dashboard.getRange("A1").setFontWeight("bold");
  
  // Add current values section
  dashboard.getRange("A3").setValue("CURRENT STATUS");
  dashboard.getRange("A3").setFontWeight("bold");
  
  const statusLabels = [
    ["Timestamp", ""],
    ["Voltage", "V"],
    ["Current", "A"],
    ["Temperature", "°C"],
    ["State of Charge", "%"],
    ["State of Health", "%"],
    ["Energy Consumed", "Ah"],
    ["Alert Status", ""],
    ["Fan", ""],
    ["Charging", ""],
    ["Battery Status", ""]
  ];
  
  let row = 4;
  for (const label of statusLabels) {
    dashboard.getRange(`A${row}`).setValue(label[0]);
    dashboard.getRange(`B${row}`).setValue("Loading...");
    dashboard.getRange(`C${row}`).setValue(label[1]);
    row++;
  }
  
  // Add chart section
  dashboard.getRange("A16").setValue("BATTERY VOLTAGE HISTORY");
  dashboard.getRange("A16").setFontWeight("bold");
  
  // Create initial battery voltage chart
  createVoltageChart();
  
  // Create initial temperature chart
  dashboard.getRange("A31").setValue("TEMPERATURE HISTORY");
  dashboard.getRange("A31").setFontWeight("bold");
  createTemperatureChart();
  
  return dashboard;
}

/**
 * Create a voltage history chart
 */
function createVoltageChart() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashboard = ss.getSheetByName("Dashboard");
  const dataSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  // Only create chart if we have data
  if (dataSheet.getLastRow() < 2) {
    return;
  }
  
  // Create voltage chart
  const chartRange = dataSheet.getRange("A2:B" + Math.min(dataSheet.getLastRow(), 50));
  const chart = dashboard.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(chartRange)
    .setPosition(17, 1, 0, 0)
    .setOption('title', 'Battery Voltage Over Time')
    .setOption('hAxis.title', 'Time')
    .setOption('vAxis.title', 'Voltage (V)')
    .setOption('legend', {position: 'none'})
    .build();
  
  // Remove any existing charts
  const charts = dashboard.getCharts();
  for (let i = 0; i < charts.length; i++) {
    if (charts[i].getOptions().get('title') === 'Battery Voltage Over Time') {
      dashboard.removeChart(charts[i]);
    }
  }
  
  dashboard.insertChart(chart);
}

/**
 * Create a temperature history chart
 */
function createTemperatureChart() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashboard = ss.getSheetByName("Dashboard");
  const dataSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  // Only create chart if we have data
  if (dataSheet.getLastRow() < 2) {
    return;
  }
  
  // Create temperature chart
  const chartRange = dataSheet.getRange("A2:D" + Math.min(dataSheet.getLastRow(), 50));
  const chart = dashboard.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(chartRange)
    .setPosition(32, 1, 0, 0)
    .setOption('title', 'Temperature Over Time')
    .setOption('hAxis.title', 'Time')
    .setOption('vAxis.title', 'Temperature (°C)')
    .setOption('series', {
      0: {visibleInLegend: false}, // Hide timestamp series
      1: {visibleInLegend: false}, // Hide voltage series
      2: {color: '#FF6347'} // Temperature in red
    })
    .build();
  
  // Remove any existing charts
  const charts = dashboard.getCharts();
  for (let i = 0; i < charts.length; i++) {
    if (charts[i].getOptions().get('title') === 'Temperature Over Time') {
      dashboard.removeChart(charts[i]);
    }
  }
  
  dashboard.insertChart(chart);
}

/**
 * Update the dashboard with the latest data
 */
function updateDashboard(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashboard = ss.getSheetByName("Dashboard");
  
  if (!dashboard) {
    return;
  }
  
  // Format timestamp
  const formattedTimestamp = Utilities.formatDate(
    data.timestamp,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
  
  // Update values
  dashboard.getRange("B4").setValue(formattedTimestamp);
  dashboard.getRange("B5").setValue(data.voltage.toFixed(2));
  dashboard.getRange("B6").setValue(data.current.toFixed(2));
  dashboard.getRange("B7").setValue(data.temperature.toFixed(1));
  dashboard.getRange("B8").setValue(data.soc.toFixed(1));
  dashboard.getRange("B9").setValue(data.soh.toFixed(1));
  dashboard.getRange("B10").setValue(data.ampHours.toFixed(3));
  dashboard.getRange("B11").setValue(getAlertText(data.alert));
  dashboard.getRange("B12").setValue(data.fanStatus ? "ON" : "OFF");
  dashboard.getRange("B13").setValue(data.relayStatus ? "ON" : "OFF");
  dashboard.getRange("B14").setValue(data.batteryStatus);
  
  // Set conditional formatting for alert status
  if (data.alert === 0) {
    dashboard.getRange("B11").setBackground("#c8e6c9"); // Green for normal
  } else if (data.alert === 1) {
    dashboard.getRange("B11").setBackground("#fff9c4"); // Yellow for warning
  } else {
    dashboard.getRange("B11").setBackground("#ffcdd2"); // Red for critical
  }
  
  // Set background color for battery status
  dashboard.getRange("B14").setBackground(getBatteryStatusColor(data.batteryStatus));
  
  // Make text white for dark backgrounds
  const darkStatuses = ["CRITICALLY LOW", "CRITICAL", "OVERHEATING", "LOW CHARGE", "HIGH DISCHARGE", "DEGRADED"];
  if (darkStatuses.includes(data.batteryStatus)) {
    dashboard.getRange("B14").setFontColor("white");
  } else {
    dashboard.getRange("B14").setFontColor("black");
  }
  
  // Update charts periodically
  const dataSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (dataSheet.getLastRow() % 10 === 0) { // Update charts every 10 rows
    createVoltageChart();
    createTemperatureChart();
    
    // Add battery status chart
    if (dataSheet.getLastRow() >= 10) {
      createBatteryStatusChart();
    }
  }
}

/**
 * Create a chart showing state of charge over time
 */
function createBatteryStatusChart() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashboard = ss.getSheetByName("Dashboard");
  const dataSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  // Add section header if not present
  if (!dashboard.getRange("A47").getValue()) {
    dashboard.getRange("A47").setValue("STATE OF CHARGE HISTORY");
    dashboard.getRange("A47").setFontWeight("bold");
  }
  
  // Create SoC chart
  const chartRange = dataSheet.getRange("A2:E" + Math.min(dataSheet.getLastRow(), 50));
  const chart = dashboard.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(chartRange)
    .setPosition(48, 1, 0, 0)
    .setOption('title', 'State of Charge Over Time')
    .setOption('hAxis.title', 'Time')
    .setOption('vAxis.title', 'SoC (%)')
    .setOption('series', {
      0: {visibleInLegend: false}, // Hide timestamp series
      1: {visibleInLegend: false}, // Hide voltage series
      2: {visibleInLegend: false}, // Hide temperature series
      3: {color: '#4CAF50'} // SoC in green
    })
    .setOption('vAxis.viewWindow.min', 0)
    .setOption('vAxis.viewWindow.max', 100)
    .build();
  
  // Remove any existing charts
  const charts = dashboard.getCharts();
  for (let i = 0; i < charts.length; i++) {
    if (charts[i].getOptions().get('title') === 'State of Charge Over Time') {
      dashboard.removeChart(charts[i]);
    }
  }
  
  dashboard.insertChart(chart);
}

/**
 * Convert alert level to text description
 */
function getAlertText(alertLevel) {
  switch (parseInt(alertLevel)) {
    case 0: return "Normal";
    case 1: return "Warning";
    case 2: return "Critical";
    default: return "Unknown";
  }
}

/**
 * Keep the spreadsheet size manageable by removing old data
 */
function manageSheetSize(sheet) {
  const lastRow = sheet.getLastRow();
  
  // If we exceed the maximum rows, delete older data
  if (lastRow > CONFIG.MAX_ROWS) {
    const rowsToDelete = Math.floor(CONFIG.MAX_ROWS * 0.2); // Delete 20% of max rows
    sheet.deleteRows(2, rowsToDelete);
  }
}

/**
 * Send an alert email for critical conditions
 */
function sendAlertEmail(data) {
  if (!CONFIG.ALERT_EMAIL) {
    return;
  }
  
  // Check if we're within cooldown period
  const scriptProperties = PropertiesService.getScriptProperties();
  const lastAlertTime = scriptProperties.getProperty("lastAlertTime");
  
  if (lastAlertTime) {
    const lastAlert = new Date(lastAlertTime);
    const cooldownMillis = CONFIG.ALERT_COOLDOWN_HOURS * 60 * 60 * 1000;
    
    if (new Date().getTime() - lastAlert.getTime() < cooldownMillis) {
      return; // Still in cooldown period
    }
  }
  
  // Determine alert reason
  let alertReason = "Unknown issue";
  if (data.temperature > 35) {
    alertReason = "High temperature detected";
  } else if (data.voltage > 12.8) {
    alertReason = "Battery voltage too high";
  } else if (data.voltage < 10.0) {
    alertReason = "Battery voltage too low";
  } else if (data.current > 15.0) {
    alertReason = "Excessive current draw";
  }
  
  // Format email
  const subject = "⚠️ ALERT: EV Battery Monitoring System";
  const body = `
    CRITICAL ALERT: ${alertReason}
    
    Battery Details:
    - Time: ${Utilities.formatDate(data.timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")}
    - Voltage: ${data.voltage.toFixed(2)} V
    - Current: ${data.current.toFixed(2)} A
    - Temperature: ${data.temperature.toFixed(1)} °C
    - State of Charge: ${data.soc.toFixed(1)}%
    - State of Health: ${data.soh.toFixed(1)}%
    - Battery Status: ${data.batteryStatus}
    
    System Status:
    - Fan: ${data.fanStatus ? "ON" : "OFF"}
    - Charging: ${data.relayStatus ? "ON" : "OFF"}
    
    Please check your battery system immediately.
  `;
  
  // Send email
  MailApp.sendEmail(CONFIG.ALERT_EMAIL, subject, body);
  
  // Update last alert time
  scriptProperties.setProperty("lastAlertTime", new Date().toString());
}

/**
 * Create a menu to manage the spreadsheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Battery Monitoring')
    .addItem('Reset Dashboard', 'resetDashboard')
    .addItem('Generate Summary Report', 'generateSummaryReport')
    .addSeparator()
    .addItem('Configure Settings', 'showSettingsDialog')
    .addToUi();
}

/**
 * Reset and recreate the dashboard
 */
function resetDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashboard = ss.getSheetByName("Dashboard");
  
  if (dashboard) {
    ss.deleteSheet(dashboard);
  }
  
  createDashboardSheet();
  SpreadsheetApp.getUi().alert('Dashboard has been reset.');
}

/**
 * Generate a summary report of battery performance
 */
function generateSummaryReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  if (!dataSheet || dataSheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Not enough data to generate a report.');
    return;
  }
  
  // Create or get report sheet
  let reportSheet = ss.getSheetByName("Summary Report");
  if (reportSheet) {
    reportSheet.clear();
  } else {
    reportSheet = ss.insertSheet("Summary Report");
  }
  
  // Get data range
  const dataRange = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 11);
  const data = dataRange.getValues();
  
  // Calculate statistics
  let minVoltage = Number.MAX_VALUE;
  let maxVoltage = Number.MIN_VALUE;
  let minTemp = Number.MAX_VALUE;
  let maxTemp = Number.MIN_VALUE;
  let totalVoltage = 0;
  let totalTemp = 0;
  let criticalAlerts = 0;
  let warningAlerts = 0;
  let batteryStatusCount = {};
  
  data.forEach(row => {
    const voltage = row[1];
    const temp = row[3];
    const alertText = row[7];
    const batteryStatus = row[10];
    
    // Update voltage stats
    minVoltage = Math.min(minVoltage, voltage);
    maxVoltage = Math.max(maxVoltage, voltage);
    totalVoltage += voltage;
    
    // Update temperature stats
    minTemp = Math.min(minTemp, temp);
    maxTemp = Math.max(maxTemp, temp);
    totalTemp += temp;
    
    // Count alerts
    if (alertText === "Critical") {
      criticalAlerts++;
    } else if (alertText === "Warning") {
      warningAlerts++;
    }
    
    // Count battery statuses
    if (batteryStatus) {
      batteryStatusCount[batteryStatus] = (batteryStatusCount[batteryStatus] || 0) + 1;
    }
  });
  
  const avgVoltage = totalVoltage / data.length;
  const avgTemp = totalTemp / data.length;
  
  // Create report
  reportSheet.getRange("A1").setValue("BATTERY MONITORING SUMMARY REPORT");
  reportSheet.getRange("A1").setFontSize(16);
  reportSheet.getRange("A1").setFontWeight("bold");
  
  reportSheet.getRange("A3").setValue("Report Generated:");
  reportSheet.getRange("B3").setValue(new Date());
  reportSheet.getRange("A4").setValue("Data Period:");
  reportSheet.getRange("B4").setValue(`${data[0][0]} to ${data[data.length - 1][0]}`);
  reportSheet.getRange("A5").setValue("Number of Records:");
  reportSheet.getRange("B5").setValue(data.length);
  
  reportSheet.getRange("A7").setValue("BATTERY STATISTICS");
  reportSheet.getRange("A7").setFontWeight("bold");
  
  const stats = [
    ["Minimum Voltage", minVoltage.toFixed(2) + " V"],
    ["Maximum Voltage", maxVoltage.toFixed(2) + " V"],
    ["Average Voltage", avgVoltage.toFixed(2) + " V"],
    ["Voltage Range", (maxVoltage - minVoltage).toFixed(2) + " V"],
    ["Minimum Temperature", minTemp.toFixed(1) + " °C"],
    ["Maximum Temperature", maxTemp.toFixed(1) + " °C"],
    ["Average Temperature", avgTemp.toFixed(1) + " °C"],
    ["Temperature Range", (maxTemp - minTemp).toFixed(1) + " °C"],
    ["Critical Alerts", criticalAlerts],
    ["Warning Alerts", warningAlerts]
  ];
  
  let row = 8;
  for (const stat of stats) {
    reportSheet.getRange(`A${row}`).setValue(stat[0]);
    reportSheet.getRange(`B${row}`).setValue(stat[1]);
    row++;
  }
  
  // Add battery status distribution
  reportSheet.getRange("A20").setValue("BATTERY STATUS DISTRIBUTION");
  reportSheet.getRange("A20").setFontWeight("bold");
  
  reportSheet.getRange("A21").setValue("Status");
  reportSheet.getRange("B21").setValue("Count");
  reportSheet.getRange("C21").setValue("Percentage");
  
  reportSheet.getRange("A21:C21").setFontWeight("bold");
  
  let statusRow = 22;
  for (const status in batteryStatusCount) {
    reportSheet.getRange(`A${statusRow}`).setValue(status);
    reportSheet.getRange(`B${statusRow}`).setValue(batteryStatusCount[status]);
    reportSheet.getRange(`C${statusRow}`).setValue((batteryStatusCount[status] / data.length * 100).toFixed(1) + "%");
    
    // Color-code the status cells
    reportSheet.getRange(`A${statusRow}`).setBackground(getBatteryStatusColor(status));
    
    // Set text color to white for dark backgrounds
    const darkStatuses = ["CRITICALLY LOW", "CRITICAL", "OVERHEATING", "LOW CHARGE", "HIGH DISCHARGE", "DEGRADED"];
    if (darkStatuses.includes(status)) {
      reportSheet.getRange(`A${statusRow}`).setFontColor("white");
    }
    
    statusRow++;
  }
  
  // Format report
  reportSheet.autoResizeColumns(1, 3);
  
  // Create charts for the report
  createReportCharts(reportSheet, data);
  
  // Create battery status pie chart
  createBatteryStatusPieChart(reportSheet, batteryStatusCount, data.length);
  
  SpreadsheetApp.getUi().alert('Summary report has been generated.');
}

/**
 * Create a pie chart showing battery status distribution
 */
function createBatteryStatusPieChart(sheet, statusCount, totalCount) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Create a temporary sheet for the chart data
  let tempSheet = ss.getSheetByName("TempChartData");
  if (!tempSheet) {
    tempSheet = ss.insertSheet("TempChartData");
  } else {
    tempSheet.clear();
  }
  
  // Add headers
  tempSheet.getRange("A1").setValue("Status");
  tempSheet.getRange("B1").setValue("Count");
  
  // Add data
  let row = 2;
  for (const status in statusCount) {
    tempSheet.getRange(`A${row}`).setValue(status);
    tempSheet.getRange(`B${row}`).setValue(statusCount[status]);
    row++;
  }
  
  // Create pie chart
  const chartRange = tempSheet.getRange("A1:B" + (row-1));
  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(chartRange)
    .setPosition(20, 4, 0, 0)
    .setOption('title', 'Battery Status Distribution')
    .setOption('pieSliceText', 'percentage')
    .setOption('legend', {position: 'right', textStyle: {fontSize: 10}})
    .build();
  
  sheet.insertChart(chart);
  
  // Hide the temporary sheet
  tempSheet.hideSheet();
}

