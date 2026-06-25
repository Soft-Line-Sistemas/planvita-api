#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv-python-tests"

if [[ ! -d "${VENV_DIR}" ]]; then
  python3 -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/pip" install -r "${SCRIPT_DIR}/requirements.txt"
"${VENV_DIR}/bin/python" -m unittest discover -s "${SCRIPT_DIR}" -p 'test_*.py' -v
