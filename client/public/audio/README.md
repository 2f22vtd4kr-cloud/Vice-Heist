# Vice Heist music assets

The spatial playlist expects these browser-compatible audio files in this directory:

1. `kleiner-finger.m4a` — Bohren & der Club of Gore, supplied M4A master.
2. `rose-bianche.mp3` — supplied MP3.

The game starts the playlist from the splash-screen user gesture. In gameplay, the music is spatialized around the VIP lounge and becomes quieter and more muffled as the player moves away.

The binary files are intentionally not represented by placeholders. Add the exact supplied files here; the playlist skips unavailable files and stops if neither track exists. The M4A uses AAC audio and is supported by the target iOS Safari/WebKit runtime; test Android browser codec support before release.
