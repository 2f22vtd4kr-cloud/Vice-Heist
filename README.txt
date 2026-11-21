VICE HEIST — Ocean Drive Estate asset pack
==========================================
sheets/        6 original sheets on solid #00FF00 chroma green (sheet 4 is full-bleed art)
transparent/   sheets 1,2,3,5,6 with the green already keyed to alpha (use these in-game)
atlas.json     every asset ID -> x, y, w, h, row, col, frameIndex
viceHeistAssets.js   drop-in Phaser 3 loader (spritesheets, named frames, 4 character anims)

Grid: sheets 1,2,3,5 = 2048x2048, 4x4, 512x512 cells (x = col*512, y = row*512)
      sheet 4 = 2048x1536, 2x2, 1024x768 slides
      sheet 5 menu_bg_art = top-left 1024x1024 block
      sheet 6 = 2048x2048, 2 cols x 4 rows, 1024x512 panels (each task spans two 512 cells)
Tip: a few sheets carry a faint divider line on cell edges; inset frames ~6px if it shows.
