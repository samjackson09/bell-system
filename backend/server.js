const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ==================== PORT ====================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Cloud server on port ${PORT}`));

// ==================== WebSocket Server ====================
const wss = new WebSocket.Server({ server });

// Store connected devices and browsers
const devices = new Map();      // deviceId -> { ws, lastStatus }
const browsers = new Set();     // browser WebSocket connections

// ==================== AUTHENTICATION ====================
const VALID_WEB_USER = 'sj ngarama';
const VALID_WEB_PASS = 'ngarama123';

// For production, define allowed devices (uncomment and populate)
// const ALLOWED_DEVICES = {
//   'esp32_001': 'mySecure123',
//   // add more devices as needed
// };

// ==================== WebSocket Event Handler ====================
wss.on('connection', (ws) => {
  let deviceId = null;
  let isBrowser = false;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // ---------- AUTHENTICATION ----------
      if (data.type === 'auth') {
        // Device authentication
        if (data.deviceId && data.password) {
          // For testing: accept any device.
          // In production, use ALLOWED_DEVICES check:
          // if (ALLOWED_DEVICES[data.deviceId] && ALLOWED_DEVICES[data.deviceId] === data.password) {
          deviceId = data.deviceId;
          devices.set(deviceId, { ws, lastStatus: {} });
          ws.send(JSON.stringify({ type: 'auth_ok' }));
          console.log(`✅ Device ${deviceId} authenticated`);
          return;
        }

        // Browser authentication
        if (data.username && data.password) {
          if (data.username === VALID_WEB_USER && data.password === VALID_WEB_PASS) {
            isBrowser = true;
            browsers.add(ws);
            ws.send(JSON.stringify({ type: 'auth_ok' }));
            console.log('✅ Browser authenticated');
            // Send latest status of all devices to this new browser
            for (let [id, dev] of devices) {
              if (dev.lastStatus) {
                ws.send(JSON.stringify({
                  type: 'device_status',
                  deviceId: id,
                  status: dev.lastStatus
                }));
              }
            }
            return;
          }
          ws.send(JSON.stringify({ type: 'auth_fail' }));
          return;
        }
      }

      // ---------- DEVICE STATUS UPDATE ----------
      if (deviceId && data.type === 'status') {
        const dev = devices.get(deviceId);
        if (dev) {
          dev.lastStatus = data;
          // Broadcast to all browsers
          browsers.forEach(browser => {
            if (browser.readyState === WebSocket.OPEN) {
              browser.send(JSON.stringify({
                type: 'device_status',
                deviceId,
                status: data
              }));
            }
          });
        }
      }

      // ---------- SCHEDULE PAYLOAD FROM DEVICE ----------
      if (deviceId && data.type === 'schedule') {
        const dev = devices.get(deviceId);
        if (dev) {
          browsers.forEach(browser => {
            if (browser.readyState === WebSocket.OPEN) {
              browser.send(JSON.stringify({
                type: 'schedule',
                deviceId,
                schedule: data.schedule
              }));
            }
          });
        }
      }

      // ---------- COMMAND FROM BROWSER ----------
      if (isBrowser && data.type === 'command' && data.deviceId) {
        const dev = devices.get(data.deviceId);
        if (dev && dev.ws.readyState === WebSocket.OPEN) {
          dev.ws.send(JSON.stringify({
            command: data.command,
            ...data.payload
          }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Device offline' }));
        }
      }

    } catch (e) {
      console.error('WebSocket error:', e);
    }
  });

  // ---------- DISCONNECT ----------
  ws.on('close', () => {
    if (deviceId) {
      devices.delete(deviceId);
      console.log(`Device ${deviceId} disconnected`);
    } else {
      browsers.delete(ws);
      console.log('Browser disconnected');
    }
  });
});

// ==================== Health Check Endpoint (optional) ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', devices: devices.size, browsers: browsers.size });
});

console.log(`✅ WebSocket server ready on port ${PORT}`);