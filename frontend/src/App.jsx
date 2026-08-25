import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

// ==================== CONFIGURATION ====================
// Change this to your actual cloud WebSocket URL (e.g., wss://bell.yourdomain.com)
const CLOUD_WS = import.meta.env.VITE_CLOUD_WS || 'ws://localhost:3000';

// ==================== MAIN APP ====================
function App() {
  // ----- Authentication -----
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // ----- Connection modes -----
  const [localMode, setLocalMode] = useState(false);
  const [localIp, setLocalIp] = useState('sjbell.local');

  // ----- WebSocket (cloud) -----
  const wsRef = useRef(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [deviceId, setDeviceId] = useState('esp32_001');

  // ----- Data state -----
  const [status, setStatus] = useState({});
  const [schedule, setSchedule] = useState({ days: {} });
  const [currentDay, setCurrentDay] = useState('monday');

  // ----- UI state -----
  const [activeTab, setActiveTab] = useState('dashboard');
  const [wifiSSID, setWifiSSID] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [manualTime, setManualTime] = useState({
    year: 2024, month: 1, day: 1,
    hour: 12, minute: 0, second: 0
  });
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');

  // ----- Axios instance for local mode -----
  const localAxios = axios.create({
    baseURL: `http://${localIp}`,
    auth: { username, password }
  });

  // ----- Login handler (enforces ESP32 credentials) -----
  const handleLogin = (e) => {
    e.preventDefault();
    if (!username || !password) {
      setLoginError('Please enter username and password');
      return;
    }

    // Hard‑coded check: same as ESP32 web login
    if (username === 'sj ngarama' && password === 'ngarama123') {
      setIsAuthenticated(true);
      setLoginError('');
    } else {
      setLoginError('Invalid credentials – use the ESP32 login');
    }
  };

  // ----- Logout -----
  const logout = () => {
    setIsAuthenticated(false);
    setWsConnected(false);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // ----- WebSocket connection (cloud mode) -----
  useEffect(() => {
    if (!isAuthenticated || localMode) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    const ws = new WebSocket(CLOUD_WS);
    wsRef.current = ws;

    ws.onopen = () => {
      // Authenticate as browser with the same credentials
      ws.send(JSON.stringify({
        type: 'auth',
        username,
        password
      }));
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      switch (data.type) {
        case 'auth_ok':
          setWsConnected(true);
          setLoginError('');
          break;
        case 'auth_fail':
          setWsConnected(false);
          setLoginError('Cloud authentication failed');
          break;
        case 'device_status':
          setStatus(data.status);
          break;
        case 'schedule':
          setSchedule({ days: data.schedule.days || {} });
          break;
        case 'error':
          showNotification(data.message, 'danger');
          break;
        default:
          break;
      }
    };

    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    return () => ws.close();
  }, [isAuthenticated, localMode, username, password]);

  // ----- Send command (cloud) -----
  const sendCommand = (command, payload = {}) => {
    if (localMode) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'command',
        deviceId,
        command,
        payload
      }));
    } else {
      showNotification('Cloud not connected. Try local mode.', 'danger');
    }
  };

  // ----- Fetch schedule (local or cloud) -----
  const fetchSchedule = async () => {
    if (localMode) {
      try {
        const res = await localAxios.get('/api/schedules');
        setSchedule(res.data);
      } catch (e) {
        showNotification('Failed to fetch schedule: ' + e.message, 'danger');
      }
    } else {
      sendCommand('get_schedule');
    }
  };

  // ----- Save schedule (local or cloud) -----
  const saveSchedule = async () => {
    if (localMode) {
      try {
        await localAxios.post('/api/schedules', schedule);
        showNotification('Schedule saved!', 'success');
        fetchSchedule();
      } catch (e) {
        showNotification('Error saving: ' + e.message, 'danger');
      }
    } else {
      sendCommand('set_schedule', { schedule });
      showNotification('Schedule sent via cloud.', 'success');
    }
  };

  // ----- Ring bell (local or cloud) -----
  const ringBell = async (duration) => {
    if (localMode) {
      try {
        await localAxios.post('/api/testbell', { duration });
        showNotification(`Bell ringing for ${duration}s`, 'success');
      } catch (e) {
        showNotification('Error: ' + e.message, 'danger');
      }
    } else {
      sendCommand('ring_bell', { duration });
    }
  };

  // ----- Set manual time (local or cloud) -----
  const setManualTimeHandler = async () => {
    if (localMode) {
      try {
        await localAxios.post('/api/manualtime', manualTime);
        showNotification('Time set!', 'success');
      } catch (e) {
        showNotification('Error: ' + e.message, 'danger');
      }
    } else {
      sendCommand('set_manual_time', manualTime);
    }
  };

  // ----- Update WiFi (local or cloud) -----
  const updateWiFi = async () => {
    if (localMode) {
      try {
        await localAxios.post('/api/wifi', { ssid: wifiSSID, pass: wifiPass });
        showNotification('WiFi updated. Device will restart.', 'success');
      } catch (e) {
        showNotification('Error: ' + e.message, 'danger');
      }
    } else {
      sendCommand('set_wifi', { ssid: wifiSSID, password: wifiPass });
    }
  };

  // ----- Forget WiFi -----
  const forgetWiFi = async () => {
    if (localMode) {
      try {
        await localAxios.post('/api/forgetwifi');
        showNotification('WiFi forgotten. Device will restart.', 'success');
      } catch (e) {
        showNotification('Error: ' + e.message, 'danger');
      }
    } else {
      sendCommand('forget_wifi');
    }
  };

  // ----- System actions -----
  const systemAction = async (cmd) => {
    if (localMode) {
      try {
        await localAxios.post(`/api/${cmd}`);
        showNotification(`Command ${cmd} sent. Device will restart.`, 'success');
      } catch (e) {
        showNotification('Error: ' + e.message, 'danger');
      }
    } else {
      sendCommand(cmd);
    }
  };

  // ----- Time source -----
  const setTimeSource = (source) => {
    if (localMode) {
      showNotification('Time source change not available in local mode.', 'warning');
    } else {
      sendCommand('set_time_source', { source });
    }
  };

  // ----- OTA update trigger -----
  const triggerOTA = () => {
    if (localMode) {
      showNotification('OTA not available in local mode.', 'warning');
    } else {
      sendCommand('ota_update');
      showNotification('OTA update triggered.', 'info');
    }
  };

  // ----- Schedule editing helpers -----
  const addBell = () => {
    const newSchedule = { ...schedule };
    if (!newSchedule.days[currentDay]) newSchedule.days[currentDay] = [];
    newSchedule.days[currentDay].push({ hour: 8, minute: 0, duration: 10, enabled: true });
    setSchedule(newSchedule);
  };

  const updateBell = (index, field, value) => {
    const newSchedule = { ...schedule };
    newSchedule.days[currentDay][index][field] = parseInt(value) || 0;
    setSchedule(newSchedule);
  };

  const deleteBell = (index) => {
    const newSchedule = { ...schedule };
    newSchedule.days[currentDay].splice(index, 1);
    setSchedule(newSchedule);
  };

  const toggleBell = (index, checked) => {
    const newSchedule = { ...schedule };
    newSchedule.days[currentDay][index].enabled = checked;
    setSchedule(newSchedule);
  };

  const clearDay = () => {
    if (window.confirm(`Clear all bells for ${currentDay}?`)) {
      const newSchedule = { ...schedule };
      newSchedule.days[currentDay] = [];
      setSchedule(newSchedule);
    }
  };

  // ----- Notification system -----
  const showNotification = (message, type = 'success') => {
    const existing = document.querySelectorAll('.notification');
    existing.forEach(el => el.remove());
    const div = document.createElement('div');
    div.className = 'notification';
    div.style.background =
      type === 'success' ? 'var(--success)' :
      type === 'warning' ? 'var(--warning)' :
      type === 'danger' ? 'var(--danger)' : 'var(--primary)';
    div.style.color = 'white';
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
      if (div.parentNode) document.body.removeChild(div);
    }, 5000);
  };

  // ----- Update system status (periodic) -----
  const updateSystemStatus = async () => {
    try {
      // Time info
      const timeRes = await (localMode ? localAxios.get('/api/timeinfo') : fetch('/api/timeinfo'));
      if (timeRes.ok || localMode) {
        const data = localMode ? timeRes.data : await timeRes.json();
        setStatus(prev => ({ ...prev, ...data }));
      }
      // WiFi status
      const wifiRes = await (localMode ? localAxios.get('/api/wifistatus') : fetch('/api/wifistatus'));
      if (wifiRes.ok || localMode) {
        const data = localMode ? wifiRes.data : await wifiRes.json();
        setStatus(prev => ({ ...prev, ...data }));
      }
      // Bell status
      const bellRes = await (localMode ? localAxios.get('/api/bell') : fetch('/api/bell'));
      if (bellRes.ok || localMode) {
        const data = localMode ? bellRes.data : await bellRes.json();
        setStatus(prev => ({ ...prev, bell: data }));
      }
      // Cloud status (only in cloud mode)
      if (!localMode) {
        const cloudRes = await fetch('/api/cloudstatus');
        if (cloudRes.ok) {
          const data = await cloudRes.json();
          setStatus(prev => ({ ...prev, cloudConnected: data.connected }));
        }
      }
    } catch (e) {
      console.error('Status update error', e);
    }
  };

  // ----- Render login -----
  if (!isAuthenticated) {
    return (
      <div className="login-container" style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1d3557, #457b9d)'
      }}>
        <div style={{
          background: 'white',
          padding: '2.5rem 2rem',
          borderRadius: '12px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          width: '100%',
          maxWidth: '400px'
        }}>
          <h1 style={{ textAlign: 'center', fontSize: '2rem', marginBottom: '0.5rem' }}>🔔 Saja Bell</h1>
          <p style={{ textAlign: 'center', color: '#6c757d', marginBottom: '1.5rem' }}>System Dashboard</p>
          <form onSubmit={handleLogin}>
            <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600' }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              style={{ width: '100%', padding: '0.7rem 1rem', marginBottom: '1.2rem', border: '1px solid #ced4da', borderRadius: '6px' }}
              required
            />
            <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              style={{ width: '100%', padding: '0.7rem 1rem', marginBottom: '1.2rem', border: '1px solid #ced4da', borderRadius: '6px' }}
              required
            />
            <button type="submit" style={{
              width: '100%',
              padding: '0.8rem',
              background: '#4361ee',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '1.1rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}>Login</button>
            {loginError && <div style={{ color: '#e63946', marginTop: '1rem', textAlign: 'center' }}>{loginError}</div>}
          </form>
          <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.85rem' }}>
            <label>
              <input
                type="checkbox"
                checked={localMode}
                onChange={(e) => setLocalMode(e.target.checked)}
              /> Use Local Mode (direct IP)
            </label>
            {localMode && (
              <div style={{ marginTop: '0.5rem' }}>
                <input
                  type="text"
                  value={localIp}
                  onChange={(e) => setLocalIp(e.target.value)}
                  placeholder="e.g., sjbell.local or 192.168.4.1"
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==================== RENDER DASHBOARD ====================
  return (
    <div>
      <div className="sidebar">
        <div className="sidebar-header"><h1><i className="fas fa-bell"></i> Bell System</h1></div>
        <div className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}><i className="fas fa-tachometer-alt"></i> Dashboard</div>
        <div className={`nav-item ${activeTab === 'scheduling' ? 'active' : ''}`} onClick={() => setActiveTab('scheduling')}><i className="fas fa-clock"></i> Bell Scheduling</div>
        <div className={`nav-item ${activeTab === 'wifi' ? 'active' : ''}`} onClick={() => setActiveTab('wifi')}><i className="fas fa-wifi"></i> WiFi Settings</div>
        <div className={`nav-item ${activeTab === 'system' ? 'active' : ''}`} onClick={() => setActiveTab('system')}><i className="fas fa-tools"></i> System Tools</div>
      </div>

      <div className="main-content">
        <div className="header">
          <h2>{activeTab === 'dashboard' ? 'Dashboard Overview' : activeTab === 'scheduling' ? 'Bell Scheduling (Rwanda Time)' : activeTab === 'wifi' ? 'Network Configuration' : 'System Management'}</h2>
          <button className="logout-btn" onClick={logout}><i className="fas fa-sign-out-alt"></i> Logout</button>
        </div>

        {status.recoveryMode && <div className="recovery-banner"><i className="fas fa-exclamation-triangle"></i> RECOVERY MODE ACTIVE</div>}

        {activeTab === 'dashboard' && (
          <div className="content-section active-section">
            <div className="cloud-status-box"><i className="fas fa-cloud"></i> <strong>Cloud:</strong> {status.cloudConnected ? 'Connected' : 'Disconnected'} <button className="btn btn-secondary" style={{padding:'2px 12px', fontSize:'0.8rem'}} onClick={() => { if (!localMode) fetch('/api/reconnectcloud', {method:'POST'}).then(() => showNotification('Reconnecting...', 'info')); }}>Reconnect</button></div>
            <div className="time-source-controls">
              <h3><i className="fas fa-clock"></i> Time Sources Control</h3>
              <p style={{color:'#666'}}>System uses Rwanda Time (UTC+2)</p>
              <button className="btn btn-primary" onClick={() => setTimeSource('rtc')}><i className="fas fa-microchip"></i> Force RTC</button>
              <button className="btn btn-primary" onClick={() => setTimeSource('ntp')}><i className="fas fa-cloud"></i> Force NTP</button>
              <button className="btn btn-secondary" onClick={() => setTimeSource('auto')}><i className="fas fa-sync"></i> Auto</button>
            </div>
            <div className="manual-time-box">
              <h3><i className="fas fa-calendar-alt"></i> Manual Time Setting (Rwanda UTC+2)</h3>
              <div className="time-input-group">
                <div><label>Year</label><input type="number" value={manualTime.year} onChange={e => setManualTime({...manualTime, year: parseInt(e.target.value)})} /></div>
                <div><label>Month</label><input type="number" value={manualTime.month} onChange={e => setManualTime({...manualTime, month: parseInt(e.target.value)})} /></div>
                <div><label>Day</label><input type="number" value={manualTime.day} onChange={e => setManualTime({...manualTime, day: parseInt(e.target.value)})} /></div>
                <div><label>Hour</label><input type="number" value={manualTime.hour} onChange={e => setManualTime({...manualTime, hour: parseInt(e.target.value)})} /></div>
                <div><label>Minute</label><input type="number" value={manualTime.minute} onChange={e => setManualTime({...manualTime, minute: parseInt(e.target.value)})} /></div>
                <div><label>Second</label><input type="number" value={manualTime.second} onChange={e => setManualTime({...manualTime, second: parseInt(e.target.value)})} /></div>
              </div>
              <button className="btn btn-success" onClick={setManualTimeHandler}><i className="fas fa-save"></i> Set Manual Time</button>
              <button className="btn btn-secondary" onClick={() => { const url = localMode ? `http://${localIp}/api/timeinfo` : '/api/timeinfo'; fetch(url).then(r => r.json()).then(data => { const parts = data.rtcTime.split(':'); const now = new Date(); setManualTime({year: now.getFullYear(), month: now.getMonth()+1, day: now.getDate(), hour: parseInt(parts[0]), minute: parseInt(parts[1]), second: parseInt(parts[2])}); showNotification('Time loaded', 'success'); }); }}><i className="fas fa-download"></i> Load Current</button>
            </div>
            <div className="status-cards">
              <div className="status-card"><div><i className="fas fa-network-wired"></i></div><div className="card-value">{status.wifiStatus || 'Unknown'}</div><div className="card-label">Network Status</div></div>
              <div className="status-card success"><div><i className="fas fa-microchip"></i></div><div className="card-value">{status.rtcTime || '--:--:--'}</div><div className="card-label">{status.timeSource || 'Rwanda Time'}</div></div>
              <div className="status-card warning"><div><i className="fas fa-globe"></i></div><div className="card-value">{status.ntpTime || '--:--:--'}</div><div className="card-label">NTP Time</div></div>
              <div className="status-card"><div><i className="fas fa-bell"></i></div><div className="card-value">{status.bell?.active ? '🔔 RINGING' : '🔕 SILENT'}</div><div className="card-label">Bell Status</div></div>
            </div>
            <div>
              <button className="btn btn-primary" onClick={() => ringBell(5)}><i className="fas fa-play"></i> Manual Ring</button>
              <input type="number" id="testDuration" defaultValue="5" min="1" max="30" style={{width:'80px'}} />
              <button className="btn btn-success" onClick={() => { const dur = parseInt(document.getElementById('testDuration').value) || 5; ringBell(dur); }}><i className="fas fa-bell"></i> Ring</button>
              <button className="btn btn-success" onClick={() => { if (localMode) { localAxios.post('/api/ntpsync'); } else { sendCommand('sync_time'); } showNotification('Time sync triggered', 'info'); }}><i className="fas fa-sync"></i> Sync Time</button>
              <button className="btn btn-secondary" onClick={() => { if (localMode) { localAxios.post('/api/testbellsafety'); } else { sendCommand('test_bell_safety'); } showNotification('Safety test done', 'info'); }}><i className="fas fa-vial"></i> Safety Test</button>
            </div>
          </div>
        )}

        {activeTab === 'scheduling' && (
          <div className="content-section active-section">
            <h3>Weekly Timetable (Rwanda Time)</h3>
            <div className="memory-warning" style={{display: Object.keys(schedule.days).reduce((acc,d) => acc + schedule.days[d].length,0) > 100 ? 'block' : 'none'}}><i className="fas fa-exclamation-triangle"></i> Memory Warning</div>
            <div className="upload-progress" style={{display: uploadProgress > 0 ? 'block' : 'none'}}><div className="upload-progress-bar" style={{width: uploadProgress + '%'}}></div></div>
            <div style={{margin:'1rem 0'}}>
              {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => <button key={d} className={`btn day-button ${d === currentDay ? 'active' : ''}`} onClick={() => setCurrentDay(d)}>{d.charAt(0).toUpperCase() + d.slice(1)}</button>)}
            </div>
            <div style={{background:'white', padding:'1rem', borderRadius:'8px'}}>
              <h4>{currentDay.charAt(0).toUpperCase() + currentDay.slice(1)} Schedule</h4>
              {(schedule.days[currentDay] || []).length === 0 ? <p style={{textAlign:'center', padding:'2rem', color:'#666'}}>No bells</p> :
                schedule.days[currentDay].map((bell, idx) => (
                  <div key={idx} className="schedule-item">
                    <input type="number" value={bell.hour} min="0" max="23" style={{width:'60px'}} onChange={e => updateBell(idx, 'hour', e.target.value)} /> :
                    <input type="number" value={bell.minute} min="0" max="59" style={{width:'60px'}} onChange={e => updateBell(idx, 'minute', e.target.value)} />
                    <span>Duration:</span>
                    <input type="number" value={bell.duration} min="1" max="300" style={{width:'70px'}} onChange={e => updateBell(idx, 'duration', e.target.value)} />s
                    <label><input type="checkbox" checked={bell.enabled} onChange={e => toggleBell(idx, e.target.checked)} /> Enabled</label>
                    <button className="btn btn-danger" onClick={() => deleteBell(idx)}><i className="fas fa-trash"></i></button>
                  </div>
                ))
              }
              <div style={{marginTop:'1rem'}}>
                <button className="btn btn-success" onClick={addBell}><i className="fas fa-plus"></i> Add Bell</button>
                <button className="btn btn-danger" onClick={clearDay}><i className="fas fa-trash"></i> Clear Day</button>
                <button className="btn btn-primary" onClick={saveSchedule}><i className="fas fa-save"></i> Save All</button>
                <button className="btn btn-secondary" onClick={fetchSchedule}><i className="fas fa-sync"></i> Reload</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'wifi' && (
          <div className="content-section active-section">
            <h3>Network Configuration</h3>
            <div style={{maxWidth:'500px'}}>
              <div><label>WiFi SSID</label><input type="text" style={{width:'100%'}} placeholder="SSID" value={wifiSSID} onChange={e => setWifiSSID(e.target.value)} /></div>
              <div><label>WiFi Password</label><input type="password" style={{width:'100%'}} placeholder="Password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} /></div>
              <button className="btn btn-primary" onClick={() => { if (wifiSSID && wifiPass) { const url = localMode ? `http://${localIp}/api/testwifi` : '/api/testwifi'; fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ssid:wifiSSID, pass:wifiPass})}).then(r=>r.json()).then(data => { const resultDiv = document.getElementById('wifiTestResult'); if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.className = data.success ? 'wifi-test-result wifi-success' : 'wifi-test-result wifi-error'; resultDiv.innerHTML = data.success ? '✅ Connected' : '❌ ' + data.message; } }); } else { showNotification('Enter SSID and password', 'warning'); } }}><i className="fas fa-plug"></i> Test WiFi</button>
              <button className="btn btn-success" onClick={updateWiFi}><i className="fas fa-wifi"></i> Save & Connect</button>
              <button className="btn btn-danger" onClick={forgetWiFi}><i className="fas fa-trash"></i> Forget WiFi</button>
              <div id="wifiTestResult" className="wifi-test-result" style={{display:'none'}}></div>
            </div>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="content-section active-section">
            <h3>System Management</h3>
            <div className="status-cards">
              <div className="status-card warning" style={{cursor:'pointer'}} onClick={() => systemAction('forcerecovery')}><div><i className="fas fa-first-aid"></i></div><div>Recovery Mode</div></div>
              <div className="status-card success" style={{cursor:'pointer'}} onClick={() => systemAction('clearrecovery')}><div><i className="fas fa-check-circle"></i></div><div>Normal Mode</div></div>
              <div className="status-card" style={{cursor:'pointer'}} onClick={() => systemAction('restart')}><div><i className="fas fa-power-off"></i></div><div>Restart</div></div>
              <div className="status-card danger" style={{cursor:'pointer'}} onClick={() => { if (window.confirm('FACTORY RESET?') && window.confirm('ARE YOU SURE?')) systemAction('factoryreset'); }}><div><i className="fas fa-bomb"></i></div><div>Factory Reset</div></div>
            </div>
            <div style={{marginTop:'1rem'}}>
              <button className="btn btn-secondary" onClick={triggerOTA}><i className="fas fa-cloud-upload-alt"></i> OTA Update</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;