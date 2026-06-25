#!/bin/bash
# Shared size-based log rotation helper.
#
# rotate_log <log_file> <max_bytes> <keep>
#
# If <log_file> exists and is at or over <max_bytes>, shift the numbered
# backups up by one (.1 .. .keep), drop the oldest, and move the current log to
# <log_file>.1. Safe no-op when the file is missing or under the threshold.
# Creates the parent directory if needed. Defaults: 5 MB threshold, keep 7.
#
# Designed to be sourced (`. rotate-log.sh`) so callers get the rotate_log
# function, but works standalone too. mv-based rotation is safe for logs whose
# writer reopens the file per write (e.g. BusyBox `crond -L`): the next write
# recreates a fresh log.
rotate_log() {
  log_file="$1"
  max_bytes="$2"
  keep="$3"

  [ -z "$log_file" ] && return 0
  [ -z "$max_bytes" ] && max_bytes=5242880
  [ -z "$keep" ] && keep=7

  mkdir -p "$(dirname "$log_file")" 2>/dev/null

  [ -f "$log_file" ] || return 0
  cur_size="$(wc -c < "$log_file" 2>/dev/null | tr -d ' ')"
  [ -z "$cur_size" ] && return 0
  [ "$cur_size" -ge "$max_bytes" ] || return 0

  # Drop the oldest, then shift each backup up by one.
  rm -f "$log_file.$keep"
  i=$((keep - 1))
  while [ "$i" -ge 1 ]; do
    [ -f "$log_file.$i" ] && mv "$log_file.$i" "$log_file.$((i + 1))"
    i=$((i - 1))
  done
  mv "$log_file" "$log_file.1"
}
