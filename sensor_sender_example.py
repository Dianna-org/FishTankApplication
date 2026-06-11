import time
import requests

API = 'http://127.0.0.1:3000/api/reading'
DEVICE_ID = 'fishtank-01'


def read_water_level():
    return 'OK'


def read_turbidity():
    return 'CLEAR_WATER'


def read_temperature_c():
    return 24.5


while True:
    payload = {
        'device_id': DEVICE_ID,
        'water_level': read_water_level(),
        'turbidity': read_turbidity(),
        'temperature_c': read_temperature_c(),
        'source': 'raspberry-pi'
    }
    try:
        requests.post(API, json=payload, timeout=5)
    except requests.RequestException as exc:
        print(exc)
    time.sleep(3)
