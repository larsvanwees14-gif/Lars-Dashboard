#!/bin/bash
cd "$(dirname "$0")"
export PYTHONPATH="."
exec python3 -m flask --app "backend.server:create_app" run --host 127.0.0.1 --port 5050
