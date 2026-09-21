#!/bin/zsh

set -u

shortcut_name="Compress Screen Recording to MP4"
capture_dir="${BMS_SCREEN_RECORDING_DIR:-$HOME/Movies/Screen Recordings}"
state_dir="$HOME/Library/Application Support/Beyond Media Suite/Screen Recording Automation"
cutoff_file="$state_dir/installed-at"
log_dir="$HOME/Library/Logs/Beyond Media Suite"
log_file="$log_dir/screen-recording-automation.log"
lock_dir="$state_dir/worker.lock"

mkdir -p "$state_dir" "$log_dir"
if ! mkdir "$lock_dir" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

log() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$log_file"
}

if [[ ! -d "$capture_dir" ]]; then
  log "Screen-recording folder is unavailable: $capture_dir"
  exit 0
fi

if [[ ! -f "$cutoff_file" ]]; then
  date +%s > "$cutoff_file"
  log "Initialized without processing existing recordings."
  exit 0
fi

cutoff="$(<"$cutoff_file")"
[[ "$cutoff" == <-> ]] || cutoff="$(date +%s)"

while IFS= read -r -d '' input; do
  modified="$(stat -f %m "$input" 2>/dev/null || print 0)"
  (( modified >= cutoff )) || continue

  if /usr/sbin/lsof "$input" >/dev/null 2>&1; then
    continue
  fi

  first_size="$(stat -f %z "$input" 2>/dev/null || print 0)"
  sleep 2
  [[ -f "$input" ]] || continue
  second_size="$(stat -f %z "$input" 2>/dev/null || print 0)"
  (( first_size > 0 && first_size == second_size )) || continue

  log "Converting: $input"
  if /usr/bin/shortcuts run "$shortcut_name" --input-path "$input" >> "$log_file" 2>&1; then
    if [[ ! -e "$input" ]]; then
      log "Converted to MP4 and permanently removed the source MOV."
    else
      log "Shortcut returned success but the source MOV still exists; leaving it untouched."
    fi
  else
    log "Conversion failed; the source MOV was preserved for retry."
  fi
done < <(/usr/bin/find "$capture_dir" -maxdepth 1 -type f -name 'Screen Recording*.mov' -print0)

