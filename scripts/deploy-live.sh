#!/bin/sh
set -eu

: "${WILDCARE_SSH_KEY:?Set WILDCARE_SSH_KEY to the SSH private-key path.}"
WILDCARE_SSH_TARGET="${WILDCARE_SSH_TARGET:-root@154.223.66.180}"
WILDCARE_REMOTE_DIR="${WILDCARE_REMOTE_DIR:-/srv/wildcare/app}"

echo "Running the required deployment gate…"
npm test

echo "Tests passed. Backing up the current public frontend…"
ssh -i "$WILDCARE_SSH_KEY" "$WILDCARE_SSH_TARGET" \
  "cp '$WILDCARE_REMOTE_DIR/app.js' '$WILDCARE_REMOTE_DIR/app.js.pre-deploy' && cp '$WILDCARE_REMOTE_DIR/index.html' '$WILDCARE_REMOTE_DIR/index.html.pre-deploy' && cp '$WILDCARE_REMOTE_DIR/styles.css' '$WILDCARE_REMOTE_DIR/styles.css.pre-deploy' && mkdir -p '$WILDCARE_REMOTE_DIR/dev'"

echo "Deploying the public frontend…"
scp -i "$WILDCARE_SSH_KEY" app.js index.html styles.css "$WILDCARE_SSH_TARGET:$WILDCARE_REMOTE_DIR/"
scp -i "$WILDCARE_SSH_KEY" dev/index.html dev/dev.css dev/dev.js "$WILDCARE_SSH_TARGET:$WILDCARE_REMOTE_DIR/dev/"

echo "Testing the deployed server…"
if curl --fail --silent --show-error "https://wildcare.liuzimo.cn/api/health" >/dev/null \
  && PLAYWRIGHT_BASE_URL="https://wildcare.liuzimo.cn" npm run test:live; then
  echo "Live deployment verified."
else
  echo "Post-deployment tests failed. Restoring the previous frontend…" >&2
  ssh -i "$WILDCARE_SSH_KEY" "$WILDCARE_SSH_TARGET" \
    "cp '$WILDCARE_REMOTE_DIR/app.js.pre-deploy' '$WILDCARE_REMOTE_DIR/app.js' && cp '$WILDCARE_REMOTE_DIR/index.html.pre-deploy' '$WILDCARE_REMOTE_DIR/index.html' && cp '$WILDCARE_REMOTE_DIR/styles.css.pre-deploy' '$WILDCARE_REMOTE_DIR/styles.css'"
  echo "Previous frontend restored. Deployment failed." >&2
  exit 1
fi
