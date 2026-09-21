# Screen recording automation

The installed macOS Shortcut `Compress Screen Recording to MP4` passes a new
screen-recording MOV to the native `BeyondFinderMedia` helper in headless mode.
The helper creates an MP4 no larger than 25% of the source size, fully decodes
the result as a validation step, and only then permanently removes the MOV and
places the completed MP4 file reference on the macOS clipboard.

Its single `Run Shell Script` action uses `zsh`, receives `Shortcut Input`,
passes input `as arguments`, and runs:

```zsh
helper='/Applications/Beyond Media Suite.app/Contents/Resources/finder-tools/BeyondFinderMedia.app/Contents/MacOS/BeyondFinderMedia'
"$helper" --headless --format mp4 --ratio 25 --speed 1 --delete-source --copy-output "$@"
```

The per-user LaunchAgent watches the configured macOS screen-recording folder
and invokes the Shortcut. Its installation timestamp prevents older recordings
from being processed when the automation is first enabled. A 30-second fallback
scan safely retries incomplete or failed captures.
