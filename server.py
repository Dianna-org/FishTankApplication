import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / 'fishtank.db'
DEVICE_ID = 'fishtank-01'
VALID_WATER_LEVELS = {'OK', 'LOW'}
VALID_TURBIDITY = {'SENSOR_OUT_OF_WATER_OR_UNSTABLE', 'LOW_CLARITY', 'CLEAR_WATER', 'POSSIBLY_DIRTY_OR_NOISY'}
MIN_TEMPERATURE_C = -10.0
MAX_TEMPERATURE_C = 60.0

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')
CORS(app)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def connect_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def add_column_if_missing(con, table, column, definition):
    columns = [row['name'] for row in con.execute(f'PRAGMA table_info({table})').fetchall()]
    if column not in columns:
        con.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')


def init_db():
    with connect_db() as con:
        con.execute('CREATE TABLE IF NOT EXISTS readings (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, water_level TEXT NOT NULL, turbidity TEXT NOT NULL, temperature_c REAL, source TEXT NOT NULL, timestamp TEXT NOT NULL)')
        add_column_if_missing(con, 'readings', 'temperature_c', 'REAL')
        con.execute('CREATE TABLE IF NOT EXISTS commands (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, command TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, timestamp TEXT NOT NULL)')
        existing = con.execute('SELECT COUNT(*) AS c FROM readings').fetchone()['c']
        if existing == 0:
            con.execute('INSERT INTO readings (device_id, water_level, turbidity, temperature_c, source, timestamp) VALUES (?, ?, ?, ?, ?, ?)', (DEVICE_ID, 'OK', 'CLEAR_WATER', 24.0, 'server-startup', now_iso()))


def row_to_dict(row):
    return dict(row) if row else None


def clean_value(value):
    return str(value or '').strip().upper()


def clean_temperature(value):
    if value is None or value == '':
        return None
    try:
        temperature = float(value)
    except (TypeError, ValueError):
        return None
    if temperature < MIN_TEMPERATURE_C or temperature > MAX_TEMPERATURE_C:
        return None
    return round(temperature, 2)


@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    target = BASE_DIR / path
    if target.exists() and target.is_file():
        return send_from_directory(BASE_DIR, path)
    return send_from_directory(BASE_DIR, 'index.html')


@app.get('/api/health')
def health():
    return jsonify({'ok': True, 'timestamp': now_iso()})


@app.get('/api/latest/<device_id>')
def latest(device_id):
    with connect_db() as con:
        row = con.execute('SELECT device_id, water_level, turbidity, temperature_c, source, timestamp FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT 1', (device_id,)).fetchone()
    if not row:
        return jsonify({'error': 'no data'}), 404
    return jsonify(row_to_dict(row))


@app.get('/api/history/<device_id>')
def history(device_id):
    limit = min(int(request.args.get('limit', 50)), 500)
    with connect_db() as con:
        rows = con.execute('SELECT device_id, water_level, turbidity, temperature_c, source, timestamp FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT ?', (device_id, limit)).fetchall()
    return jsonify([row_to_dict(row) for row in rows])


@app.post('/api/reading')
def reading():
    data = request.get_json(silent=True) or {}
    device_id = str(data.get('device_id') or DEVICE_ID).strip()
    sensors = data.get('sensors') if isinstance(data.get('sensors'), dict) else {}
    water_level = clean_value(data.get('water_level') or sensors.get('water_level'))
    turbidity = clean_value(data.get('turbidity') or sensors.get('turbidity'))
    temperature_c = clean_temperature(data.get('temperature_c') if data.get('temperature_c') is not None else sensors.get('temperature_c'))
    source = str(data.get('source') or 'sensor').strip()[:80]
    if water_level not in VALID_WATER_LEVELS:
        return jsonify({'error': 'invalid water_level', 'accepted': sorted(VALID_WATER_LEVELS)}), 400
    if turbidity not in VALID_TURBIDITY:
        return jsonify({'error': 'invalid turbidity', 'accepted': sorted(VALID_TURBIDITY)}), 400
    if temperature_c is None:
        return jsonify({'error': 'invalid temperature_c', 'accepted': f'number between {MIN_TEMPERATURE_C} and {MAX_TEMPERATURE_C}'}), 400
    timestamp = now_iso()
    with connect_db() as con:
        con.execute('INSERT INTO readings (device_id, water_level, turbidity, temperature_c, source, timestamp) VALUES (?, ?, ?, ?, ?, ?)', (device_id, water_level, turbidity, temperature_c, source, timestamp))
    return jsonify({'ok': True, 'device_id': device_id, 'water_level': water_level, 'turbidity': turbidity, 'temperature_c': temperature_c, 'source': source, 'timestamp': timestamp}), 201


@app.post('/api/command')
def command():
    data = request.get_json(silent=True) or {}
    device_id = str(data.get('device_id') or DEVICE_ID).strip()
    command_text = clean_value(data.get('command'))
    if command_text not in {'FEED_NOW'}:
        return jsonify({'error': 'invalid command', 'accepted': ['FEED_NOW']}), 400
    with connect_db() as con:
        con.execute('INSERT INTO commands (device_id, command, timestamp) VALUES (?, ?, ?)', (device_id, command_text, now_iso()))
    return jsonify({'ok': True, 'device_id': device_id, 'command': command_text}), 201


@app.get('/api/command/<device_id>')
def next_command(device_id):
    with connect_db() as con:
        row = con.execute('SELECT id, command, timestamp FROM commands WHERE device_id = ? AND consumed = 0 ORDER BY id ASC LIMIT 1', (device_id,)).fetchone()
        if row:
            con.execute('UPDATE commands SET consumed = 1 WHERE id = ?', (row['id'],))
    if not row:
        return jsonify({'command': None})
    return jsonify({'command': row['command'], 'timestamp': row['timestamp']})


@app.post('/api/simulate')
def simulate():
    return reading()


if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', '3000'))
    app.run(host='127.0.0.1', port=port, debug=True)
else:
    init_db()
