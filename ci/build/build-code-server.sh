#!/usr/bin/env bash
set -euo pipefail

main() {
  cd "$(dirname "${0}")/../.."
  ./node_modules/.bin/tsc -p tsconfig.json
}

main "$@"
