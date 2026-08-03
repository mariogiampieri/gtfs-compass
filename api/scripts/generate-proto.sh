#!/usr/bin/env bash
# Regenerate the static protobuf module for GTFS-RT + NYCT extensions.
# Static generation (no runtime codegen) is required: Workers ban eval.
# Output is committed so builds are hermetic; re-run only when protos change.
set -euo pipefail
cd "$(dirname "$0")/.."

npx pbjs -t static-module -w es6 --no-create --no-verify --no-convert --no-delimited \
  -p proto proto/gtfs-realtime.proto proto/nyct-subway.proto \
  -o src/gen/gtfs-realtime.js
npx pbts -o src/gen/gtfs-realtime.d.ts src/gen/gtfs-realtime.js
echo "generated src/gen/gtfs-realtime.{js,d.ts}"
