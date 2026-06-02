import Phaser from 'phaser';

const W = 800, H = 450;
const GRAVITY = 280;
const CRATER_R = 40;
const TANK_W = 38, TANK_H = 16;
const BARREL_LEN = 22;
const MAX_HP = 100;
const MAX_CHARGE_MS = 2000;

const STATE = { PLAYER_TURN: 0, FLYING: 1, EXPLODING: 2, CPU_TURN: 3, GAME_OVER: 4 };

const C = {
  playerBody:   0x2ecc71,
  playerDark:   0x27ae60,
  cpuBody:      0xe74c3c,
  cpuDark:      0xc0392b,
  terrainTop:   0x4a7c3f,
  terrainFill:  0x3a5f2e,
  terrainEdge:  0x2e4a25,
  sky1:         0x87ceeb,
  sky2:         0x2980b9,
  bullet:       0xffe066,
  explosion:    [0xffff00, 0xff9900, 0xff4400, 0xaa2200],
};

export class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    this.state = STATE.PLAYER_TURN;
    this.playerAngle = 45;   // degrees: 0=right 90=up 180=left
    this.playerPower = 0.5;
    this.charging = false;
    this.chargeStart = 0;
    this.proj = null;

    this.drawSky();
    this.generateTerrain();
    this.drawTerrain();
    this.createTanks();
    this.createUI();
    this.createControls();
    this.flashBanner('YOUR TURN', '#2ecc71');
  }

  update(time, delta) {
    if (this.charging) {
      const pct = Math.min((time - this.chargeStart) / MAX_CHARGE_MS, 1);
      this.drawPowerBar(pct);
    }

    if (this.state !== STATE.FLYING || !this.proj) return;

    const dt = delta / 1000;
    this.proj.vy += GRAVITY * dt;
    this.proj.x  += this.proj.vx * dt;
    this.proj.y  += this.proj.vy * dt;

    // Trail dot
    this.trailGfx.fillStyle(0xffffff, 0.35);
    this.trailGfx.fillCircle(this.proj.x, this.proj.y, 2);

    // Projectile dot
    this.projGfx.clear();
    this.projGfx.fillStyle(C.bullet);
    this.projGfx.fillCircle(this.proj.x, this.proj.y, 5);

    this.checkCollision();
  }

  // ─── Sky ──────────────────────────────────────────────────────────────────

  drawSky() {
    const gfx = this.add.graphics().setDepth(0);
    // Simple two-tone sky gradient via stacked rects
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const r = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(C.sky1),
        Phaser.Display.Color.ValueToColor(C.sky2),
        steps, i
      );
      gfx.fillStyle(Phaser.Display.Color.GetColor(r.r, r.g, r.b));
      gfx.fillRect(0, (H / steps) * i, W, H / steps + 1);
    }
  }

  // ─── Terrain ──────────────────────────────────────────────────────────────

  generateTerrain() {
    const POINTS = 22;
    const raw = [];

    // Seed random heights
    for (let i = 0; i < POINTS; i++) {
      raw.push(H * 0.35 + (Math.random() - 0.5) * H * 0.38);
    }

    // Smooth 5 passes
    for (let p = 0; p < 5; p++) {
      for (let i = 1; i < POINTS - 1; i++) {
        raw[i] = (raw[i - 1] + raw[i] * 2 + raw[i + 1]) / 4;
      }
    }

    // Clamp heights
    for (let i = 0; i < POINTS; i++) {
      raw[i] = Phaser.Math.Clamp(raw[i], H * 0.22, H * 0.78);
    }

    // Interpolate to per-column height map
    this.terrain = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const t   = (x / (W - 1)) * (POINTS - 1);
      const i   = Math.min(Math.floor(t), POINTS - 2);
      const f   = t - i;
      // Smooth-step interpolation
      const sf  = f * f * (3 - 2 * f);
      this.terrain[x] = raw[i] + (raw[i + 1] - raw[i]) * sf;
    }

    // Flatten pads for each tank
    this.flattenPad(Math.floor(W * 0.10), Math.floor(W * 0.22));
    this.flattenPad(Math.floor(W * 0.78), Math.floor(W * 0.90));
  }

  flattenPad(x1, x2) {
    const mid = Math.floor((x1 + x2) / 2);
    const h   = this.terrain[mid];
    // Hard flat center, tapered blend at edges
    const pad = Math.floor((x2 - x1) * 0.35);
    for (let x = x1; x <= x2; x++) {
      const dist = Math.min(x - x1, x2 - x);
      const blend = Math.min(dist / pad, 1);
      this.terrain[x] = this.terrain[x] + (h - this.terrain[x]) * blend;
    }
  }

  drawTerrain() {
    if (this.terrainGfx) this.terrainGfx.destroy();
    this.terrainGfx = this.add.graphics().setDepth(1);

    // Filled body
    this.terrainGfx.fillStyle(C.terrainFill);
    this.terrainGfx.beginPath();
    this.terrainGfx.moveTo(0, H);
    for (let x = 0; x < W; x++) this.terrainGfx.lineTo(x, this.terrain[x]);
    this.terrainGfx.lineTo(W - 1, H);
    this.terrainGfx.closePath();
    this.terrainGfx.fillPath();

    // Bright top strip (grass)
    this.terrainGfx.lineStyle(3, C.terrainTop);
    this.terrainGfx.beginPath();
    this.terrainGfx.moveTo(0, this.terrain[0]);
    for (let x = 1; x < W; x++) this.terrainGfx.lineTo(x, this.terrain[x]);
    this.terrainGfx.strokePath();

    // Dark edge
    this.terrainGfx.lineStyle(1, C.terrainEdge, 0.6);
    this.terrainGfx.beginPath();
    this.terrainGfx.moveTo(0, this.terrain[0] + 3);
    for (let x = 1; x < W; x++) this.terrainGfx.lineTo(x, this.terrain[x] + 3);
    this.terrainGfx.strokePath();
  }

  carveCrater(cx, cy, r) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const halfChord = Math.sqrt(Math.max(0, r * r - dx * dx));
      const bottom = cy + halfChord;
      if (bottom > this.terrain[x]) {
        this.terrain[x] = Math.min(bottom, H - 8);
      }
    }
  }

  // ─── Tanks ────────────────────────────────────────────────────────────────

  createTanks() {
    const lx = Math.floor(W * 0.16);
    const rx = Math.floor(W * 0.84);

    this.player = { x: lx, y: 0, angle: 45,  hp: MAX_HP, isPlayer: true  };
    this.cpu    = { x: rx, y: 0, angle: 135, hp: MAX_HP, isPlayer: false };

    this.reseatTank(this.player);
    this.reseatTank(this.cpu);

    this.tankGfx = this.add.graphics().setDepth(2);
    this.redrawTanks();
  }

  reseatTank(tank) {
    const x = Phaser.Math.Clamp(Math.round(tank.x), 0, W - 1);
    tank.y = this.terrain[x] - TANK_H / 2;
  }

  redrawTanks() {
    this.tankGfx.clear();
    if (this.player.hp > 0) this.drawTank(this.player);
    if (this.cpu.hp    > 0) this.drawTank(this.cpu);
  }

  drawTank(tank) {
    const body = tank.isPlayer ? C.playerBody : C.cpuBody;
    const dark = tank.isPlayer ? C.playerDark : C.cpuDark;
    const tx = tank.x, ty = tank.y;

    // Tracks (dark base)
    this.tankGfx.fillStyle(0x222222);
    this.tankGfx.fillRect(tx - TANK_W / 2 - 2, ty + 2, TANK_W + 4, 8);

    // Body
    this.tankGfx.fillStyle(body);
    this.tankGfx.fillRect(tx - TANK_W / 2, ty - TANK_H / 2, TANK_W, TANK_H);

    // Turret dome
    this.tankGfx.fillStyle(dark);
    this.tankGfx.fillCircle(tx, ty - TANK_H / 2, 9);

    // Barrel
    const rad = Phaser.Math.DegToRad(tank.angle);
    const bx  = Math.cos(rad) * BARREL_LEN;
    const by  = -Math.sin(rad) * BARREL_LEN;
    this.tankGfx.lineStyle(5, 0x111111);
    this.tankGfx.beginPath();
    this.tankGfx.moveTo(tx, ty - TANK_H / 2);
    this.tankGfx.lineTo(tx + bx, ty - TANK_H / 2 + by);
    this.tankGfx.strokePath();
    this.tankGfx.lineStyle(3, dark);
    this.tankGfx.beginPath();
    this.tankGfx.moveTo(tx, ty - TANK_H / 2);
    this.tankGfx.lineTo(tx + bx, ty - TANK_H / 2 + by);
    this.tankGfx.strokePath();

    // HP bar
    const bw = TANK_W + 10, bh = 5;
    const barX = tx - bw / 2, barY = ty - TANK_H / 2 - 14;
    this.tankGfx.fillStyle(0x111111);
    this.tankGfx.fillRect(barX, barY, bw, bh);
    const hpCol = tank.hp > 60 ? 0x2ecc71 : tank.hp > 30 ? 0xf39c12 : 0xe74c3c;
    this.tankGfx.fillStyle(hpCol);
    this.tankGfx.fillRect(barX, barY, bw * (tank.hp / MAX_HP), bh);
  }

  // ─── Shooting & Physics ───────────────────────────────────────────────────

  fireShot(shooter, target, speedPxS, angleDeg) {
    this.state = STATE.FLYING;
    this.setControlsVisible(false);

    if (!this.projGfx)  this.projGfx  = this.add.graphics().setDepth(5);
    if (!this.trailGfx) this.trailGfx = this.add.graphics().setDepth(4);
    this.trailGfx.clear();

    const rad  = Phaser.Math.DegToRad(angleDeg);
    const barrelTipX = shooter.x + Math.cos(rad) * (BARREL_LEN + 4);
    const barrelTipY = (shooter.y - TANK_H / 2) - Math.sin(rad) * (BARREL_LEN + 4);

    this.proj = {
      x: barrelTipX, y: barrelTipY,
      vx: Math.cos(rad) * speedPxS,
      vy: -Math.sin(rad) * speedPxS,
      target,
    };
  }

  checkCollision() {
    const { x, y, target } = this.proj;
    const ix = Math.round(x);

    // Off bottom or sides — fizzle
    if (y > H + 40 || x < -20 || x > W + 20) {
      this.landExplosion(x, Math.min(y, H - 5), target);
      return;
    }

    // Hit terrain
    if (ix >= 0 && ix < W && y >= this.terrain[ix]) {
      this.landExplosion(x, y, target);
      return;
    }

    // Direct tank hit
    if (target.hp > 0) {
      const dx = x - target.x, dy = y - target.y;
      if (dx * dx + dy * dy < (TANK_W * 0.7) ** 2) {
        this.landExplosion(x, y, target);
      }
    }
  }

  landExplosion(ex, ey, target) {
    this.state = STATE.EXPLODING;
    this.proj = null;
    this.projGfx.clear();

    this.carveCrater(ex, ey, CRATER_R);
    this.drawTerrain();

    // Damage both tanks (splash)
    this.applyBlastDamage(ex, ey, this.player);
    this.applyBlastDamage(ex, ey, this.cpu);

    this.reseatTank(this.player);
    this.reseatTank(this.cpu);
    this.redrawTanks();

    this.playExplosionAnim(ex, ey, () => this.afterExplosion(target));
  }

  applyBlastDamage(ex, ey, tank) {
    if (tank.hp <= 0) return;
    const dx   = ex - tank.x, dy = ey - (tank.y - TANK_H / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = CRATER_R + TANK_W;
    if (dist < maxR) {
      const dmg = Math.round((1 - dist / maxR) * 60 + 5);
      tank.hp = Math.max(0, tank.hp - dmg);
      this.floatDamage(tank.x, tank.y, dmg);
    }
  }

  // ─── Explosion Anim ───────────────────────────────────────────────────────

  playExplosionAnim(ex, ey, onDone) {
    if (!this.fxGfx) this.fxGfx = this.add.graphics().setDepth(6);
    let frame = 0;
    const total = C.explosion.length * 2;
    this.time.addEvent({
      delay: 55, repeat: total - 1,
      callback: () => {
        this.fxGfx.clear();
        const ci = Math.min(Math.floor(frame / 2), C.explosion.length - 1);
        const r  = CRATER_R * (1.3 - frame / total * 0.6);
        const a  = 1 - frame / total * 0.5;
        this.fxGfx.fillStyle(C.explosion[ci], a);
        this.fxGfx.fillCircle(ex, ey, r);
        frame++;
        if (frame >= total) { this.fxGfx.clear(); onDone(); }
      },
    });
  }

  // ─── Turn Flow ────────────────────────────────────────────────────────────

  afterExplosion(lastTarget) {
    if (this.player.hp <= 0 || this.cpu.hp <= 0) {
      this.state = STATE.GAME_OVER;
      this.showGameOver(this.cpu.hp <= 0 ? 'YOU WIN!' : 'YOU LOSE!');
      return;
    }

    if (lastTarget === this.cpu) {
      // Player just fired → CPU turn
      this.state = STATE.CPU_TURN;
      this.flashBanner("ENEMY'S TURN", '#e74c3c');
      this.time.delayedCall(900, () => this.runCpuTurn());
    } else {
      // CPU just fired → Player turn
      this.state = STATE.PLAYER_TURN;
      this.flashBanner('YOUR TURN', '#2ecc71');
      this.setControlsVisible(true);
    }
  }

  // ─── CPU AI ───────────────────────────────────────────────────────────────

  runCpuTurn() {
    const { angle, power } = this.aimAt(this.player, 95, 175);

    // Add imperfection — tougher enemies will have less noise later
    const noiseDeg = (Math.random() - 0.5) * 12;
    this.cpu.angle = angle + noiseDeg;
    this.redrawTanks();

    this.time.delayedCall(500, () => {
      this.fireShot(this.cpu, this.player, power, this.cpu.angle);
    });
  }

  aimAt(target, minAngle, maxAngle) {
    let bestAngle = (minAngle + maxAngle) / 2;
    let bestPower = 300;
    let bestDist  = Infinity;

    for (let a = minAngle; a <= maxAngle; a += 4) {
      for (let spd = 150; spd <= 520; spd += 30) {
        const dist = this.simulateShot(this.cpu, a, spd, target);
        if (dist < bestDist) {
          bestDist = dist; bestAngle = a; bestPower = spd;
        }
      }
    }
    return { angle: bestAngle, power: bestPower };
  }

  simulateShot(shooter, angleDeg, speedPxS, target) {
    const rad = Phaser.Math.DegToRad(angleDeg);
    let sx = shooter.x + Math.cos(rad) * BARREL_LEN;
    let sy = (shooter.y - TANK_H / 2) - Math.sin(rad) * BARREL_LEN;
    let vx = Math.cos(rad) * speedPxS;
    let vy = -Math.sin(rad) * speedPxS;
    const dt = 0.018;
    let closest = Infinity;

    for (let i = 0; i < 500; i++) {
      vy += GRAVITY * dt;
      sx += vx * dt; sy += vy * dt;
      if (sx < 0 || sx >= W || sy > H) break;
      const ix = Math.round(sx);
      if (ix >= 0 && ix < W && sy >= this.terrain[ix]) break;
      const d = Math.hypot(sx - target.x, sy - (target.y - TANK_H / 2));
      if (d < closest) closest = d;
    }
    return closest;
  }

  // ─── Controls ─────────────────────────────────────────────────────────────

  createControls() {
    // Graphics layers for controls
    this.angleWheelGfx = this.add.graphics().setDepth(10);
    this.fireBtnGfx    = this.add.graphics().setDepth(10);
    this.powerBarGfx   = this.add.graphics().setDepth(10);

    this.drawAngleWheel();
    this.drawFireButton(false);
    this.drawPowerBar(0);

    // Labels
    this.angleLbl = this.add.text(70, H - 118, 'ANGLE', {
      fontSize: '11px', fontFamily: 'monospace', color: '#aaaaaa',
    }).setOrigin(0.5, 1).setDepth(10);

    this.angleDegLbl = this.add.text(70, H - 28, '45°', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(10);

    this.fireLbl = this.add.text(W - 70, H - 70, 'FIRE', {
      fontSize: '16px', fontFamily: 'monospace', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0.5).setDepth(10);

    this.powerLbl = this.add.text(W - 70, H - 118, 'POWER', {
      fontSize: '11px', fontFamily: 'monospace', color: '#aaaaaa',
    }).setOrigin(0.5, 1).setDepth(10);

    this.setupAngleDrag();
    this.setupFireButton();
  }

  drawAngleWheel() {
    const cx = 70, cy = H - 70, r = 38;
    this.angleWheelGfx.clear();

    this.angleWheelGfx.fillStyle(0x000000, 0.45);
    this.angleWheelGfx.fillCircle(cx, cy, r);
    this.angleWheelGfx.lineStyle(2, 0xffffff, 0.5);
    this.angleWheelGfx.strokeCircle(cx, cy, r);

    // Tick marks at 30° intervals
    for (let deg = 0; deg <= 180; deg += 30) {
      const rad = Phaser.Math.DegToRad(deg);
      const ix  = cx + Math.cos(rad) * (r - 4);
      const iy  = cy - Math.sin(rad) * (r - 4);
      const ox  = cx + Math.cos(rad) * (r - 10);
      const oy  = cy - Math.sin(rad) * (r - 10);
      this.angleWheelGfx.lineStyle(1, 0xffffff, 0.4);
      this.angleWheelGfx.beginPath();
      this.angleWheelGfx.moveTo(ox, oy);
      this.angleWheelGfx.lineTo(ix, iy);
      this.angleWheelGfx.strokePath();
    }

    // Indicator needle
    const rad = Phaser.Math.DegToRad(this.playerAngle);
    this.angleWheelGfx.lineStyle(3, C.playerBody);
    this.angleWheelGfx.beginPath();
    this.angleWheelGfx.moveTo(cx, cy);
    this.angleWheelGfx.lineTo(cx + Math.cos(rad) * (r - 6), cy - Math.sin(rad) * (r - 6));
    this.angleWheelGfx.strokePath();

    this.angleWheelGfx.fillStyle(0xffffff);
    this.angleWheelGfx.fillCircle(cx, cy, 3);
  }

  drawFireButton(active) {
    const cx = W - 70, cy = H - 70, r = 38;
    this.fireBtnGfx.clear();
    this.fireBtnGfx.fillStyle(active ? C.cpuBody : C.cpuDark, active ? 1 : 0.75);
    this.fireBtnGfx.fillCircle(cx, cy, r);
    this.fireBtnGfx.lineStyle(2, active ? 0xffffff : 0xff8888, active ? 1 : 0.6);
    this.fireBtnGfx.strokeCircle(cx, cy, r);
    if (active) {
      this.fireBtnGfx.lineStyle(2, 0xffffff, 0.3);
      this.fireBtnGfx.strokeCircle(cx, cy, r - 6);
    }
  }

  drawPowerBar(pct) {
    const bx = W - 120, by = H - 108, bw = 100, bh = 12;
    this.powerBarGfx.clear();
    this.powerBarGfx.fillStyle(0x111111, 0.7);
    this.powerBarGfx.fillRect(bx, by, bw, bh);
    this.powerBarGfx.lineStyle(1, 0x555555);
    this.powerBarGfx.strokeRect(bx, by, bw, bh);

    if (pct > 0) {
      const col = pct < 0.5 ? 0x2ecc71 : pct < 0.8 ? 0xf39c12 : 0xe74c3c;
      this.powerBarGfx.fillStyle(col, 0.9);
      this.powerBarGfx.fillRect(bx + 1, by + 1, (bw - 2) * pct, bh - 2);
    }
  }

  setupAngleDrag() {
    let dragStartY     = 0;
    let dragStartAngle = 0;
    let dragging       = false;

    this.input.on('pointerdown', (ptr) => {
      if (this.state !== STATE.PLAYER_TURN) return;
      // Only track as angle drag if on the left half
      if (ptr.x < W / 2) {
        dragging       = true;
        dragStartY     = ptr.y;
        dragStartAngle = this.playerAngle;
      }
    });

    this.input.on('pointermove', (ptr) => {
      if (!dragging || !ptr.isDown) return;
      const dy = dragStartY - ptr.y;             // up = positive
      this.playerAngle = Phaser.Math.Clamp(dragStartAngle + dy * 0.9, 5, 175);
      this.player.angle = this.playerAngle;
      this.angleDegLbl.setText(`${Math.round(this.playerAngle)}°`);
      this.drawAngleWheel();
      this.redrawTanks();
    });

    this.input.on('pointerup',   () => { dragging = false; });
    this.input.on('pointerout',  () => { dragging = false; });
  }

  setupFireButton() {
    // Interactive zone over the right button
    const zone = this.add.zone(W - 70, H - 70, 90, 90).setInteractive().setDepth(10);

    zone.on('pointerdown', () => {
      if (this.state !== STATE.PLAYER_TURN) return;
      this.charging   = true;
      this.chargeStart = this.time.now;
      this.drawFireButton(true);
    });

    // Global pointerup so release is detected even if finger drifts off button
    this.input.on('pointerup', () => {
      if (!this.charging) return;
      this.charging = false;
      this.drawFireButton(false);

      if (this.state !== STATE.PLAYER_TURN) return;

      const elapsed      = this.time.now - this.chargeStart;
      const pct          = Phaser.Math.Clamp(elapsed / MAX_CHARGE_MS, 0.04, 1.0);
      this.drawPowerBar(0);
      this.fireShot(this.player, this.cpu, pct * 520, this.playerAngle);
    });
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────

  createUI() {
    this.bannerTxt = this.add.text(W / 2, 16, '', {
      fontSize: '20px', fontFamily: 'monospace', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(10).setAlpha(0);
  }

  flashBanner(msg, color = '#ffffff') {
    this.bannerTxt.setText(msg).setColor(color).setAlpha(1);
    this.tweens.add({
      targets: this.bannerTxt, alpha: 0,
      delay: 1400, duration: 400,
    });
  }

  floatDamage(x, y, dmg) {
    const t = this.add.text(x, y - 30, `-${dmg}`, {
      fontSize: '17px', fontFamily: 'monospace', color: '#ff5555',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(7);
    this.tweens.add({
      targets: t, y: y - 75, alpha: 0,
      duration: 1100,
      onComplete: () => t.destroy(),
    });
  }

  showGameOver(msg) {
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65).setDepth(20);
    this.add.text(W / 2, H / 2 - 36, msg, {
      fontSize: '40px', fontFamily: 'monospace', color: '#ffffff',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(21);

    const btn = this.add.text(W / 2, H / 2 + 36, 'PLAY AGAIN', {
      fontSize: '22px', fontFamily: 'monospace', color: '#2ecc71',
      stroke: '#000000', strokeThickness: 3,
      backgroundColor: '#1a1a1a', padding: { x: 18, y: 10 },
    }).setOrigin(0.5).setDepth(21).setInteractive({ useHandCursor: true });

    btn.on('pointerover',  () => btn.setColor('#ffffff'));
    btn.on('pointerout',   () => btn.setColor('#2ecc71'));
    btn.on('pointerdown',  () => this.scene.restart());
  }

  setControlsVisible(v) {
    const a = v ? 1 : 0;
    [this.angleWheelGfx, this.fireBtnGfx, this.powerBarGfx].forEach(g => g?.setAlpha(a));
    [this.angleLbl, this.angleDegLbl, this.fireLbl, this.powerLbl].forEach(t => t?.setAlpha(a));
  }
}
