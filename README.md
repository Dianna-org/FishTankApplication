# Smart Fish Tank Mobile Monitor

This version is functional for local demo, backend polling, database storage, browser notifications, temperature display, mobile-friendly UI, and Web Bluetooth. The interface now follows the same visual direction as `Enilesi/smart-fish-tank-web`: dark navy background, glass cards, blue/purple gradients, mint status accents, large rounded mobile-first panels, and floating aquarium bubbles.

## What the app monitors

Temperature is sent as a numeric Celsius value in `temperature_c`, for example `24.5`.

Water level accepts only:

- `OK`
- `LOW`

Turbidity accepts only:

- `SENSOR_OUT_OF_WATER_OR_UNSTABLE`
- `LOW_CLARITY`
- `CLEAR_WATER`
- `POSSIBLY_DIRTY_OR_NOISY`

The app does not use humidity or pH anymore.

## How it works

The Raspberry Pi or sensor script sends a reading every few seconds to the Flask backend. The backend stores readings in SQLite and exposes the latest reading to the web app or to a future mobile app. The web app polls every 3 seconds.

The app also has a Bluetooth button. For Bluetooth to work, the Raspberry Pi or BLE module must expose a BLE GATT service and characteristic. The characteristic should send notifications containing either JSON or a simple comma-separated line.

Recommended JSON payload:

```json
{"water_level":"LOW","turbidity":"CLEAR_WATER","temperature_c":24.5}
```

Simple payload also works:

```text
LOW,CLEAR_WATER,24.5
```

When water level stays `LOW` for 60 seconds, the web app sends a local browser notification.

## Run locally

```bash
python3 -m venv venv
source venv/bin/activate
pip install flask flask-cors
python server.py
```

Open:

```text
http://127.0.0.1:3000
```

Click `Enable notifications`, then test with `Simulate LOW`. Leave it LOW for one minute to see the notification.

## Send sensor data with curl

```bash
curl -X POST http://127.0.0.1:3000/api/reading \
  -H "Content-Type: application/json" \
  -d '{"device_id":"fishtank-01","water_level":"OK","turbidity":"CLEAR_WATER","temperature_c":24.5,"source":"curl"}'
```

```bash
curl -X POST http://127.0.0.1:3000/api/reading \
  -H "Content-Type: application/json" \
  -d '{"device_id":"fishtank-01","water_level":"LOW","turbidity":"POSSIBLY_DIRTY_OR_NOISY","temperature_c":24.5,"source":"curl"}'
```

## Raspberry Pi sender example

```python
import requests
import time

API = 'http://127.0.0.1:3000/api/reading'
DEVICE_ID = 'fishtank-01'

while True:
    payload = {
        'device_id': DEVICE_ID,
        'water_level': 'OK',
        'turbidity': 'CLEAR_WATER',
        'temperature_c': 24.5,
        'source': 'raspberry-pi'
    }
    requests.post(API, json=payload, timeout=5)
    time.sleep(3)
```

Replace the fixed values with the real values read from your sensors.

## Mobile app usage

For a real mobile app, keep this Flask backend API and call it from the mobile UI. The mobile app should read:

```text
GET /api/latest/fishtank-01
GET /api/history/fishtank-01?limit=50
```

The sensor/Raspberry Pi should send:

```json
{
  "device_id": "fishtank-01",
  "water_level": "OK",
  "turbidity": "CLEAR_WATER",
  "temperature_c": 24.5,
  "source": "raspberry-pi"
}
```

If the mobile app connects directly by Bluetooth, use the same payload format from BLE notifications. If Bluetooth is handled by the Raspberry Pi instead, the mobile app does not need direct Bluetooth; it only reads the backend API.

## Feed Now command

The app can save a `FEED_NOW` command on the backend. A Raspberry Pi script can poll it:

```bash
curl http://127.0.0.1:3000/api/command/fishtank-01
```

If Bluetooth is connected and the command characteristic exists, the app sends `FEED_NOW` directly over Bluetooth.

## Bluetooth notes

Web Bluetooth works in Chrome/Edge on Android/Desktop and requires `https://` or `localhost`/`127.0.0.1`.

Default UUIDs in the UI are placeholders:

- service: `0000fff0-0000-1000-8000-00805f9b34fb`
- data characteristic: `0000fff1-0000-1000-8000-00805f9b34fb`
- command characteristic: `0000fff2-0000-1000-8000-00805f9b34fb`

Change them to the UUIDs used by your BLE code.
