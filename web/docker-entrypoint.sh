#!/bin/sh
set -e

# Executed automatically by the official nginx image entrypoint through /docker-entrypoint.d/*.sh before nginx starts.
# Generate runtime config.js from environment variables. Each analytics provider has an independent variable;
# unset providers remain disabled, load no scripts, and send no external requests. Multiple providers may be enabled together.

# GA4 and Baidu IDs contain only letters, numbers, and hyphens. Remove other characters
# so quotes and similar values cannot break the JavaScript strings in config.js as a defense-in-depth measure.
sanitize_id() {
    printf '%s' "$1" | tr -cd 'A-Za-z0-9-'
}

# Proxy URLs may be a same-origin path (/proxy) or an absolute http(s) URL.
# Keep only characters that belong in a URL so quotes or control characters
# cannot break the JavaScript string written into config.js.
sanitize_url() {
    printf '%s' "$1" | tr -cd 'A-Za-z0-9:/._?&=+%-'
}

GA4_ID=$(sanitize_id "${ANALYTICS_GA4_ID:-}")
BAIDU_ID=$(sanitize_id "${ANALYTICS_BAIDU_ID:-}")
# The in-image proxy is on by default; set PROXY_URL empty to leave it for the user to configure.
PROXY_URL=$(sanitize_url "${PROXY_URL-/proxy}")

cat > /usr/share/nginx/html/config.js <<EOF
window.__RUNTIME_CONFIG__ = {
  ANALYTICS_GA4_ID: "${GA4_ID}",
  ANALYTICS_BAIDU_ID: "${BAIDU_ID}",
  PROXY_URL: "${PROXY_URL}"
};
EOF
