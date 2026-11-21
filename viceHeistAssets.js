// Vice Heist — Phaser 3 asset loader. Every frame sits on an exact grid (see atlas.json).
// Usage: in preload() call preloadViceHeist(this, 'assets/');  in create() call createViceHeistAnims(this);
export const SHEETS = {
  sheet1_hud_buttons:       { frameWidth: 512,  frameHeight: 512 },
  sheet2_map_props:         { frameWidth: 512,  frameHeight: 512 },
  sheet3_character_actions: { frameWidth: 512,  frameHeight: 512 },
  sheet4_cutscene_slides:   { frameWidth: 1024, frameHeight: 768, dir: 'sheets' }, // full-bleed, no chroma
  sheet5_menu_lobby_voting: { frameWidth: 512,  frameHeight: 512 },
  sheet6_task_minigames:    { frameWidth: 1024, frameHeight: 512 },
};

export function preloadViceHeist(scene, base = '') {
  for (const [key, cfg] of Object.entries(SHEETS)) {
    scene.load.spritesheet(key, `${base}${cfg.dir || 'transparent'}/${key}.png`, cfg);
  }
  scene.load.json('vh_atlas', `${base}atlas.json`);
}

// Registers every asset ID as a named frame, so you can write
//   this.add.image(x, y, 'sheet1_hud_buttons', 'btn_use_active')
// (also covers the 1024×1024 menu_bg_art hero block on sheet 5).
export function createViceHeistAnims(scene) {
  const atlas = scene.cache.json.get('vh_atlas');
  for (const [key, sheet] of Object.entries(atlas.sheets)) {
    const tex = scene.textures.get(key);
    for (const [id, f] of Object.entries(sheet.frames)) tex.add(id, 0, f.x, f.y, f.w, f.h);
  }
  const anim = (key, start, frameRate, repeat) => scene.anims.create({
    key, frameRate, repeat,
    frames: scene.anims.generateFrameNumbers('sheet3_character_actions', { start, end: start + 3 }),
  });
  anim('walk_up', 0, 8, -1);
  anim('walk_down', 4, 8, -1);
  anim('kill_lunge', 8, 12, 0);
  anim('ghost_float', 12, 6, -1);
}
