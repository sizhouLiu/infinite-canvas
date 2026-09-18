#!/bin/sh
set -e

# Built-in suffixes for the in-image proxy. Extra hosts come from PROXY_ALLOW_HOSTS (comma-separated).
# Leaving PROXY_ALLOW_HOSTS empty would otherwise mean "any public host", which is the local-npx
# default and not what a public deployment should do.
DEFAULT_HOSTS="openai.com,googleapis.com,tripo3d.com,tripo3d.ai"
if [ -n "${PROXY_ALLOW_HOSTS:-}" ]; then
    export PROXY_ALLOW_HOSTS="${DEFAULT_HOSTS},${PROXY_ALLOW_HOSTS}"
else
    export PROXY_ALLOW_HOSTS="${DEFAULT_HOSTS}"
fi

node /opt/canvas-proxy/index.js --host 127.0.0.1 --port 23210 &
exec /docker-entrypoint.sh nginx -g "daemon off;"
