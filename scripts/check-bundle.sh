#!/usr/bin/env bash
# §8: "Secrets: ANTHROPIC_API_KEY server-side only. No key ever reaches the client
# bundle. Verification: grep the built bundle in CI."
#
# Greps for things that would indicate the server module was pulled client-side:
# a key value, a read of the env var, or the server-only prompts/tool definitions.
# The literal string "ANTHROPIC_API_KEY" is NOT a failure — the UI tells the operator
# to set it — so we look for the value and for server-only code, not the name.
set -uo pipefail
DIR="${1:-.next/static}"
[ -d "$DIR" ] || { echo "no build output at $DIR — run npm run build first"; exit 1; }

fail=0
scan() {
  local label="$1" pattern="$2"
  local hits
  hits=$(grep -rlE "$pattern" "$DIR" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "FAIL  $label"
    echo "$hits" | sed 's/^/        /'
    fail=1
  else
    echo "ok    $label"
  fi
}

scan "no API key value in client bundle"      'sk-ant-[A-Za-z0-9_-]{8}'
scan "no env read of ANTHROPIC_API_KEY"       'process\.env\.ANTHROPIC_API_KEY|env\.ANTHROPIC_API_KEY'
scan "no server prompts in client bundle"     'GROUNDING RULES|GATE_SYSTEM_PROMPT'
scan "no tool definitions in client bundle"   'emit_listing|classify_image'
scan "no Anthropic SDK in client bundle"      'anthropic-version|x-api-key'

[ "$fail" -eq 0 ] && echo "bundle clean" || echo "bundle check FAILED"
exit "$fail"
