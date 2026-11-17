#!/bin/sh
# DPILS server kit: run ./start.sh to host your own Daugavpils server. Nothing to install.
cd "$(dirname "$0")" || exit 1
exec ./node launcher.mjs "$@"
