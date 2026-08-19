# Source before any npm/node work in this repo.
#   source scripts.env.sh
#
# The host default PATH carries node v16 first, but Vite 7 requires >= 20.5.
# Phase 0 hit the same thing (see its scripts/env.sh) - same fix, same reason.
export PATH="/usr/local/nvm/versions/node/v22.23.2/bin:$PATH"
