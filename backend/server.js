const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the React build (we'll place it here after building)
app.use(express.static(path.join(__dirname, 'client/build')));

// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Cloud server on port ${PORT}`));

const wss = new WebSocket.Server({ server });

// Store connected devices and browsers
const devices = new Map();   // deviceId -> { ws, lastStatus }
const browsers = new Set();

// -------------------- AUTHENTICATION CONFIG --------------------
// Change these to match your ESP32's web credentials
const VALID_WEB_USER = 'sj ngarama';
const VALID_WEB_PASS = 'ngarama123';

// For production, store allowed device credentials in a JSON file or env variables.
// For now, we accept any device (testing). To enable strict validation, uncomment the check below.
const ALLOWED_DEVICES = {
  'esp32_001': 'secure123',
  // add more devices if needed
};

wss.on('connection', (ws) => {
  let deviceId = null;
  let isBrowser = false;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'auth') {
        // ---------- Device authentication ----------
        if (data.deviceId && data.password) {
          // Strict validation (recommended):
          // if (ALLOWED_DEVICES[data.deviceId] && ALLOWED_DEVICES[data.deviceId] === data.password) {
          //   deviceId = data.deviceId;
          // } else {
          //   ws.send(JSON.stringify({ type: 'auth_fail' }));
          //   return;
          // }
          // For testing, accept any:
          deviceId = data.deviceId;
          devices.set(deviceId, { ws, lastStatus: {} });
          ws.send(JSON.stringify({ type: 'auth_ok' }));
          console.log(`✅ Device ${deviceId} authenticated`);
          return;
        }

        // ---------- Browser authentication ----------
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

      // ---------- Device status update ----------
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

      // ---------- Schedule payload from device (response to 'get_schedule') ----------
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

      // ---------- Command from browser ----------
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
      console.error('WS error:', e);
    }
  });

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