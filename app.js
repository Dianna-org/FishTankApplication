const DEVICE_ID = 'fishtank-01'
const API_BASE = location.origin
const LOW_ALERT_AFTER_MS = 60000
const POLL_MS = 3000
const TURBIDITY_LABELS = {
  SENSOR_OUT_OF_WATER_OR_UNSTABLE: 'Sensor unstable or out of water',
  LOW_CLARITY: 'Low clarity',
  CLEAR_WATER: 'Clear water',
  POSSIBLY_DIRTY_OR_NOISY: 'Possibly dirty or noisy'
}

const els = {
  connectionBadge: document.getElementById('connectionBadge'),
  phoneStatus: document.getElementById('phoneStatus'),
  waterLevel: document.getElementById('waterLevel'),
  waterHelp: document.getElementById('waterHelp'),
  turbidity: document.getElementById('turbidity'),
  turbidityHelp: document.getElementById('turbidityHelp'),
  temperature: document.getElementById('temperature'),
  temperatureHelp: document.getElementById('temperatureHelp'),
  deviceId: document.getElementById('deviceId'),
  lastReading: document.getElementById('lastReading'),
  lowDuration: document.getElementById('lowDuration'),
  alertState: document.getElementById('alertState'),
  statusText: document.getElementById('statusText'),
  eventLog: document.getElementById('eventLog'),
  connectBluetoothBtn: document.getElementById('connectBluetoothBtn'),
  enableNotificationsBtn: document.getElementById('enableNotificationsBtn'),
  feedNowBtn: document.getElementById('feedNowBtn'),
  simulateOkBtn: document.getElementById('simulateOkBtn'),
  simulateLowBtn: document.getElementById('simulateLowBtn'),
  simulateTurbidBtn: document.getElementById('simulateTurbidBtn'),
  simulateTempBtn: document.getElementById('simulateTempBtn'),
  serviceUuid: document.getElementById('serviceUuid'),
  dataUuid: document.getElementById('dataUuid'),
  commandUuid: document.getElementById('commandUuid')
}

let lowStartedAt = null
let lowAlertSent = false
let commandCharacteristic = null
let pollHandle = null

function setStatus(text, mode = 'offline') {
  els.statusText.textContent = text
  els.connectionBadge.textContent = mode === 'bluetooth' ? 'Bluetooth' : mode === 'online' ? 'Online' : 'Offline'
  els.connectionBadge.className = `connection-badge ${mode}`
}

function logEvent(text) {
  const item = document.createElement('li')
  item.textContent = `${new Date().toLocaleTimeString()} · ${text}`
  els.eventLog.prepend(item)
  while (els.eventLog.children.length > 12) els.eventLog.lastElementChild.remove()
}

function normalizeWaterLevel(value) {
  const text = String(value ?? '').trim().toUpperCase()
  if (text === 'OK' || text === 'LOW') return text
  return 'UNKNOWN'
}

function normalizeTurbidity(value) {
  const text = String(value ?? '').trim().toUpperCase()
  if (Object.keys(TURBIDITY_LABELS).includes(text)) return text
  return 'UNKNOWN'
}

function normalizeTemperature(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number < -10 || number > 60) return null
  return Math.round(number * 10) / 10
}

function classForTurbidity(value) {
  if (value === 'CLEAR_WATER') return 'clear'
  if (value === 'LOW_CLARITY' || value === 'POSSIBLY_DIRTY_OR_NOISY') return 'warn'
  if (value === 'SENSOR_OUT_OF_WATER_OR_UNSTABLE') return 'bad'
  return 'unknown'
}

function classForTemperature(value) {
  if (value === null) return 'unknown'
  if (value < 18 || value > 30) return 'warn'
  return 'ok'
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}

async function requestNotifications() {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.')
    return
  }
  const permission = await Notification.requestPermission()
  els.enableNotificationsBtn.textContent = permission === 'granted' ? 'Notifications enabled' : 'Enable notifications'
  els.enableNotificationsBtn.disabled = permission === 'granted'
  logEvent(permission === 'granted' ? 'Notifications enabled' : 'Notifications not enabled')
}

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  navigator.serviceWorker?.ready?.then(reg => {
    reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' })
  }).catch(() => new Notification(title, { body }))
}

function checkWaterAlert(waterLevel) {
  const now = Date.now()
  if (waterLevel === 'LOW') {
    if (!lowStartedAt) lowStartedAt = now
    const elapsed = now - lowStartedAt
    els.lowDuration.textContent = formatDuration(elapsed)
    if (elapsed >= LOW_ALERT_AFTER_MS && !lowAlertSent) {
      lowAlertSent = true
      els.alertState.textContent = 'LOW water alert sent'
      notify('Fishtank water level LOW', 'Water level has stayed LOW for one minute. Please refill the tank.')
      logEvent('LOW water persisted for one minute')
    } else if (!lowAlertSent) {
      els.alertState.textContent = 'Watching LOW water level'
    }
    return
  }
  lowStartedAt = null
  lowAlertSent = false
  els.lowDuration.textContent = '0s'
  els.alertState.textContent = 'No alert'
}

function updateUI(reading, source = 'backend') {
  const waterLevel = normalizeWaterLevel(reading.water_level ?? reading.sensors?.water_level)
  const turbidity = normalizeTurbidity(reading.turbidity ?? reading.sensors?.turbidity)
  const temperature = normalizeTemperature(reading.temperature_c ?? reading.sensors?.temperature_c)
  const timestamp = reading.timestamp ? new Date(reading.timestamp) : new Date()

  els.waterLevel.textContent = waterLevel === 'UNKNOWN' ? '—' : waterLevel
  els.waterLevel.className = `metric-value ${waterLevel === 'OK' ? 'ok' : waterLevel === 'LOW' ? 'low' : 'unknown'}`
  els.waterHelp.textContent = waterLevel === 'LOW' ? 'LOW detected. It must stay LOW for one minute before notification.' : 'Accepted values: OK, LOW'

  els.temperature.textContent = temperature === null ? '—' : `${temperature.toFixed(1)}°C`
  els.temperature.className = `metric-value ${classForTemperature(temperature)}`
  els.temperatureHelp.textContent = temperature === null ? 'Accepted temperature: numeric °C value' : 'Temperature from sensor, in °C'

  els.turbidity.textContent = turbidity === 'UNKNOWN' ? '—' : turbidity
  els.turbidity.className = `metric-value small ${classForTurbidity(turbidity)}`
  els.turbidityHelp.textContent = TURBIDITY_LABELS[turbidity] ?? 'Accepted turbidity statuses only'

  els.deviceId.textContent = reading.device_id || DEVICE_ID
  els.lastReading.textContent = timestamp.toLocaleString()
  els.phoneStatus.textContent = waterLevel === 'LOW' || turbidity !== 'CLEAR_WATER' || classForTemperature(temperature) === 'warn' ? 'Attention' : 'Stable'
  els.phoneStatus.style.color = els.phoneStatus.textContent === 'Stable' ? '#55f2c2' : '#ffb84d'
  checkWaterAlert(waterLevel)
  setStatus(`Receiving data from ${source}`, source === 'bluetooth' ? 'bluetooth' : 'online')
}

async function postReading(reading) {
  const payload = {
    device_id: reading.device_id || DEVICE_ID,
    water_level: normalizeWaterLevel(reading.water_level ?? reading.sensors?.water_level),
    turbidity: normalizeTurbidity(reading.turbidity ?? reading.sensors?.turbidity),
    temperature_c: normalizeTemperature(reading.temperature_c ?? reading.sensors?.temperature_c),
    source: reading.source || 'browser'
  }
  await fetch('/api/reading', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {})
}

async function fetchLatest() {
  try {
    const res = await fetch(`/api/latest/${DEVICE_ID}`, { cache: 'no-store' })
    if (!res.ok) throw new Error('No backend reading yet')
    const data = await res.json()
    updateUI(data, data.source || 'backend')
  } catch (err) {
    setStatus('No backend data yet. Use simulator or connect Bluetooth.', 'offline')
  }
}

function startPolling() {
  clearInterval(pollHandle)
  fetchLatest()
  pollHandle = setInterval(fetchLatest, POLL_MS)
}

function saveBluetoothSettings() {
  localStorage.setItem('fishtank.serviceUuid', els.serviceUuid.value.trim())
  localStorage.setItem('fishtank.dataUuid', els.dataUuid.value.trim())
  localStorage.setItem('fishtank.commandUuid', els.commandUuid.value.trim())
}

function loadBluetoothSettings() {
  els.serviceUuid.value = localStorage.getItem('fishtank.serviceUuid') || els.serviceUuid.value
  els.dataUuid.value = localStorage.getItem('fishtank.dataUuid') || els.dataUuid.value
  els.commandUuid.value = localStorage.getItem('fishtank.commandUuid') || els.commandUuid.value
}

function parseBlePayload(text) {
  const clean = text.trim()
  try {
    return JSON.parse(clean)
  } catch (_) {
    const parts = clean.split(/[;,|\n]/).map(p => p.trim()).filter(Boolean)
    return { water_level: parts[0], turbidity: parts[1], temperature_c: parts[2] }
  }
}

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth is available in some mobile/desktop browsers and requires HTTPS or localhost. For a native mobile app, use this backend API and a native BLE library.')
    return
  }
  saveBluetoothSettings()
  const serviceUuid = els.serviceUuid.value.trim()
  const dataUuid = els.dataUuid.value.trim()
  const commandUuid = els.commandUuid.value.trim()
  try {
    setStatus('Choosing Bluetooth device…', 'offline')
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [serviceUuid] }], optionalServices: [serviceUuid] })
    device.addEventListener('gattserverdisconnected', () => {
      setStatus('Bluetooth disconnected. Backend polling still active.', 'offline')
      logEvent('Bluetooth disconnected')
    })
    const server = await device.gatt.connect()
    const service = await server.getPrimaryService(serviceUuid)
    const dataCharacteristic = await service.getCharacteristic(dataUuid)
    commandCharacteristic = commandUuid ? await service.getCharacteristic(commandUuid).catch(() => null) : null
    await dataCharacteristic.startNotifications()
    dataCharacteristic.addEventListener('characteristicvaluechanged', async event => {
      const text = new TextDecoder().decode(event.target.value)
      const reading = parseBlePayload(text)
      reading.device_id = DEVICE_ID
      reading.source = 'bluetooth'
      updateUI(reading, 'bluetooth')
      await postReading(reading)
    })
    setStatus(`Connected to ${device.name || 'Bluetooth sensor'}`, 'bluetooth')
    logEvent(`Bluetooth connected to ${device.name || 'sensor'}`)
  } catch (err) {
    setStatus(`Bluetooth failed: ${err.message}`, 'offline')
    logEvent(`Bluetooth failed: ${err.message}`)
  }
}

async function sendFeedNow() {
  if (commandCharacteristic) {
    await commandCharacteristic.writeValue(new TextEncoder().encode('FEED_NOW'))
    logEvent('Feed Now sent by Bluetooth')
    return
  }
  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: DEVICE_ID, command: 'FEED_NOW' })
  })
  logEvent(res.ok ? 'Feed Now command saved on backend' : 'Feed Now failed')
}

async function simulate(waterLevel, turbidity, temperatureC = 24.0) {
  const reading = { device_id: DEVICE_ID, water_level: waterLevel, turbidity, temperature_c: temperatureC, source: 'simulator' }
  await postReading(reading)
  updateUI(reading, 'simulator')
  logEvent(`Simulated ${waterLevel} / ${turbidity} / ${temperatureC}°C`)
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/sw.js')
  } catch (_) {}
}

loadBluetoothSettings()
els.enableNotificationsBtn.addEventListener('click', requestNotifications)
els.connectBluetoothBtn.addEventListener('click', connectBluetooth)
els.feedNowBtn.addEventListener('click', sendFeedNow)
els.simulateOkBtn.addEventListener('click', () => simulate('OK', 'CLEAR_WATER', 24.0))
els.simulateLowBtn.addEventListener('click', () => simulate('LOW', 'CLEAR_WATER', 24.0))
els.simulateTurbidBtn.addEventListener('click', () => simulate('OK', 'POSSIBLY_DIRTY_OR_NOISY', 24.0))
els.simulateTempBtn.addEventListener('click', () => simulate('OK', 'CLEAR_WATER', 28.0))

if ('Notification' in window && Notification.permission === 'granted') {
  els.enableNotificationsBtn.textContent = 'Notifications enabled'
  els.enableNotificationsBtn.disabled = true
}

registerServiceWorker()
startPolling()
setInterval(() => {
  if (lowStartedAt) checkWaterAlert('LOW')
}, 1000)
