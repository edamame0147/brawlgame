const MAP_SIZE = 1200;
const TILE_SIZE = 60;
const MAP_DESIGN = [
    [1,1,1,0,0,0,0,1,0,0,0,0,1,1,1], [1,0,0,0,2,2,0,1,0,2,2,0,0,0,1],
    [1,0,1,0,2,2,0,0,0,2,2,0,1,0,1], [0,0,1,0,0,0,1,1,1,0,0,0,1,0,0],
    [0,2,2,0,0,0,0,0,0,0,0,0,2,2,0], [0,2,2,0,1,1,0,1,0,1,1,0,2,2,0],
    [0,0,0,0,1,0,0,0,0,0,1,0,0,0,0], [1,1,0,0,0,0,2,2,2,0,0,0,0,1,1],
    [0,0,0,0,1,0,0,0,0,0,1,0,0,0,0], [0,2,2,0,1,1,0,1,0,1,1,0,2,2,0],
    [0,2,2,0,0,0,0,0,0,0,0,0,2,2,0], [0,0,1,0,0,0,1,1,1,0,0,0,1,0,0],
    [1,0,1,0,2,2,0,0,0,2,2,0,1,0,1], [1,0,0,0,2,2,0,1,0,2,2,0,0,0,1],
    [1,1,1,0,0,0,0,1,0,0,0,0,1,1,1],
];

const config = {
    type: Phaser.AUTO,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 800, height: 600 },
    backgroundColor: '#34495e',
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    scene: { preload, create, update }
};

const game = new Phaser.Game(config);
let socket, player, bullets, enemyBullets, walls, bushes, aimGuide;
let otherPlayers = {};
let ammo = 3, isReloading = false, ultGage = 0, isStunned = false, isActionLocked = false, respawnText;
let moveJoy, shootJoy, moveThumb, shootThumb, ultBtn, ultGageGraphics, ultGageMask;
let isMoving = false, isAiming = false, isUltAiming = false, moveData = { x: 0, y: 0 }, shootData = { angle: 0, dist: 0, power: 0 };

function preload() {}

function create() {
    socket = io();
    this.physics.world.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
    this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
    this.add.grid(MAP_SIZE/2, MAP_SIZE/2, MAP_SIZE, MAP_SIZE, TILE_SIZE, TILE_SIZE, 0x34495e).setOutlineStyle(0x2c3e50);

    bullets = this.physics.add.group();
    enemyBullets = this.physics.add.group();
    walls = this.physics.add.staticGroup();
    bushes = this.physics.add.staticGroup();
    aimGuide = this.add.graphics().setDepth(5);

    const offsetX = (MAP_SIZE - (MAP_DESIGN[0].length * TILE_SIZE)) / 2;
    const offsetY = (MAP_SIZE - (MAP_DESIGN.length * TILE_SIZE)) / 2;
    for (let r = 0; r < MAP_DESIGN.length; r++) {
        for (let c = 0; c < MAP_DESIGN[r].length; c++) {
            let x = offsetX + c * TILE_SIZE + TILE_SIZE/2;
            let y = offsetY + r * TILE_SIZE + TILE_SIZE/2;
            if (MAP_DESIGN[r][c] === 1) {
                walls.create(x, y, null).setSize(TILE_SIZE-4, TILE_SIZE-4).setVisible(false);
                this.add.rectangle(x, y, TILE_SIZE-4, TILE_SIZE-4, 0x95a5a6);
            }
            if (MAP_DESIGN[r][c] === 2) {
                let b = bushes.create(x, y, null).setSize(TILE_SIZE, TILE_SIZE).setVisible(false);
                b.bushId = `bush_${r}_${c}`;
                this.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, 0x27ae60, 0.5);
            }
        }
    }

    respawnText = this.add.text(400, 300, '', { fontSize: '48px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(200).setScrollFactor(0);
    setupVirtualJoysticks(this);

    socket.on('currentPlayers', ps => {
        Object.keys(ps).forEach(id => {
            if (id === socket.id && !player) {
                addPlayer(this, ps[id]);
                this.cameras.main.startFollow(player, true, 0.1, 0.1);
            } else if (id !== socket.id && !otherPlayers[id]) addOtherPlayers(this, ps[id]);
        });
    });

    socket.on('enemyShoot', data => { if(otherPlayers[data.id]) otherPlayers[data.id].lastActionTime = Date.now(); createBullet(this, data.x, data.y, data.angle, data.charType, false, data.id, false); });
    socket.on('enemyUlt', data => { if(otherPlayers[data.id]) otherPlayers[data.id].lastActionTime = Date.now(); createBullet(this, data.x, data.y, data.angle, data.charType, false, data.id, true, data.power); });
    socket.on('playerMoved', info => { if(otherPlayers[info.id]) { otherPlayers[info.id].setPosition(info.x, info.y); otherPlayers[info.id].isInBush = info.isInBush; otherPlayers[info.id].bushId = info.bushId; }});
    socket.on('hpUpdate', data => {
        let t = (data.id === socket.id) ? player : otherPlayers[data.id];
        if (t) { 
            t.hp = data.hp; t.lastActionTime = Date.now(); 
            if (data.hp <= 0 && t.visible) { t.setVisible(false); if (data.id === socket.id) startRespawnSequence(this); }
            if (data.stun) { t.isStunned = true; t.setTint(0xffff00); this.time.delayedCall(1500, () => { t.isStunned = false; t.clearTint(); }); }
        }
    });
    socket.on('playerRespawned', info => {
        let t = (info.id === socket.id) ? player : otherPlayers[info.id];
        if (t) { t.hp = 100; t.setPosition(info.x, info.y); t.setVisible(true); if(info.id === socket.id) { respawnText.setText(''); ammo = 3; ultGage = 0; isStunned = false; isActionLocked = false; }}
    });
    
    socket.on('playerDisconnected', id => {
        if(otherPlayers[id]) {
            if(otherPlayers[id].ui) otherPlayers[id].ui.destroy();
            if(otherPlayers[id].nameTag) otherPlayers[id].nameTag.destroy();
            if(otherPlayers[id].pinGroup) otherPlayers[id].pinGroup.destroy();
            otherPlayers[id].destroy();
            delete otherPlayers[id];
        }
    });

    socket.on('updateRanking', ps => {
        const list = document.getElementById('rankingList');
        if(list) list.innerHTML = Object.values(ps).sort((a, b) => b.kills - a.kills).map(p => `<div>${p.userName}: ${p.kills}</div>`).join('');
    });
    socket.on('showPin', data => { let t = (data.id === socket.id) ? player : otherPlayers[data.id]; if(t && t.active) displayPin(this, t, data.emoji); });
}

function update() {
    aimGuide.clear();
    if (player && player.active && player.visible) {
        player.body.setVelocity(0);
        if (!isStunned && !isActionLocked) {
            let speed = { shelly: 220, spike: 220, edgar: 270, frank: 160 }[player.charType] || 220;
            if (isMoving) player.body.setVelocity(moveData.x * speed, moveData.y * speed);
        }
        if (isAiming || isUltAiming) drawAimGuide(player.charType, shootData.angle, isUltAiming, shootData.power);

        let bId = null;
        this.physics.overlap(player, bushes, (p, b) => bId = b.bushId);
        player.isInBush = !!bId; player.bushId = bId;
        player.setAlpha(player.isInBush ? 0.6 : 1);
        socket.emit('playerMovement', { x: player.x, y: player.y, isInBush: player.isInBush, bushId: bId });
        updateUI(player);
    }

    Object.values(otherPlayers).forEach(op => {
        let isVisible = true;
        let timeSinceAction = Date.now() - (op.lastActionTime || 0);
        if (op.isInBush && timeSinceAction > 1500) {
            if (!player || !player.isInBush || player.bushId !== op.bushId) isVisible = false;
        }
        op.setVisible(isVisible && op.hp > 0);
        updateUI(op);
    });
}

function drawAimGuide(charType, angle, isUlt, power) {
    aimGuide.lineStyle(2, 0xffffff, 0.4); aimGuide.fillStyle(0xffffff, 0.15);
    let maxRange = isUlt ? 280 : { shelly: 200, spike: 200, edgar: 80, frank: 180 }[charType];
    let currentRange = maxRange * power;

    if ((charType === 'edgar' || charType === 'spike') && isUlt) {
        let targetX = player.x + Math.cos(angle) * currentRange;
        let targetY = player.y + Math.sin(angle) * currentRange;
        aimGuide.strokeCircle(targetX, targetY, 45);
        aimGuide.fillCircle(targetX, targetY, 45);
        aimGuide.lineStyle(1, 0xffffff, 0.2);
        aimGuide.lineBetween(player.x, player.y, targetX, targetY);
    } else if (charType === 'shelly' || charType === 'frank') {
        aimGuide.beginPath(); aimGuide.moveTo(player.x, player.y);
        aimGuide.arc(player.x, player.y, maxRange, angle - 0.3, angle + 0.3);
        aimGuide.closePath(); aimGuide.fillPath(); aimGuide.strokePath();
    } else {
        let endX = player.x + Math.cos(angle) * maxRange; let endY = player.y + Math.sin(angle) * maxRange;
        aimGuide.lineBetween(player.x, player.y, endX, endY);
        if (charType === 'spike' && !isUlt) aimGuide.strokeCircle(endX, endY, 15);
    }
}

function addPlayer(s, info) {
    let colors = { shelly: 0x3498db, spike: 0x2ecc71, edgar: 0x9b59b6, frank: 0x795548 };
    player = s.add.circle(info.x, info.y, 20, colors[info.charType]);
    s.physics.add.existing(player);
    player.charType = info.charType; player.hp = 100; player.ui = s.add.graphics().setDepth(10);
    player.nameTag = s.add.text(info.x, info.y - 55, info.userName, { fontSize: '14px', fill: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    s.physics.add.collider(player, walls);
    s.physics.add.overlap(player, enemyBullets, (p, b) => {
        if(p.visible && p.hp > 0 && b.active) {
            let d = b.isUlt ? { shelly: 35, spike: 15, edgar: 15, frank: 40 }[b.charType] : { shelly: 25, spike: 20, edgar: 15, frank: 35 }[b.charType];
            b.destroy();
            socket.emit('updateHP', { id: socket.id, hp: Math.max(0, p.hp - d), attackerId: b.shooterId, stun: b.isFrankUlt });
        }
    });
}

function addOtherPlayers(s, info) {
    let colors = { shelly: 0x3498db, spike: 0x2ecc71, edgar: 0x9b59b6, frank: 0x795548 };
    let op = s.add.circle(info.x, info.y, 20, colors[info.charType]);
    s.physics.add.existing(op); op.id = info.id; op.hp = 100; op.ui = s.add.graphics().setDepth(10);
    op.nameTag = s.add.text(info.x, info.y - 55, info.userName, { fontSize: '14px', fill: '#ffffff' }).setOrigin(0.5).setDepth(10);
    otherPlayers[info.id] = op;
    
    // 自分の弾が敵に当たった時のウルト増加判定
    s.physics.add.overlap(bullets, op, (target, b) => {
        if (target.visible && b.active && b.shooterId === socket.id) {
            let gain = b.isUlt ? 0 : { shelly: 12, spike: 20, edgar: 15, frank: 25 }[player.charType];
            ultGage = Math.min(100, ultGage + gain);
            if (player.charType === 'edgar') player.hp = Math.min(100, player.hp + 3);
            b.destroy(); 
        }
    });
}

function createBullet(s, x, y, angle, charType, isMine, shooterId, isUlt, power = 1.0) {
    let group = isMine ? bullets : enemyBullets;
    let bConfig = (sx, sy, ang, spd, life, size, col, isRect) => {
        let b = isRect ? s.add.rectangle(sx, sy, size, size, col) : s.add.circle(sx, sy, size, col);
        group.add(b); s.physics.add.existing(b);
        s.physics.velocityFromRotation(ang, spd, b.body.velocity);
        
        // 壁との衝突判定（これで弾が壁をすり抜けない）
        s.physics.add.collider(b, walls, () => { 
            if(charType==='spike' && !b.isSplit) explodeSpike(s, b.x, b.y, group, shooterId); 
            b.destroy(); 
        });
        
        s.time.delayedCall(life, () => { if(b.active) { if(charType==='spike' && !b.isSplit) explodeSpike(s, b.x, b.y, group, shooterId); b.destroy(); }});
        b.charType = charType; b.shooterId = shooterId; b.isUlt = isUlt;
        return b;
    };

    if (isUlt) {
        let range = 280 * power;
        if (charType === 'shelly') { for(let i=-4; i<=4; i++) bConfig(x, y, angle + i*0.15, 600, 400, 7, 0xffff00, false); }
        else if (charType === 'spike') {
            let tx = x + Math.cos(angle) * range, ty = y + Math.sin(angle) * range;
            let zone = s.add.circle(tx, ty, 100, 0x2ecc71, 0.3).setDepth(1);
            s.physics.add.existing(zone);
            s.time.addEvent({ delay: 500, repeat: 10, callback: () => { 
                if(player && shooterId !== socket.id && s.physics.overlap(player, zone)) {
                    socket.emit('updateHP', { id: socket.id, hp: Math.max(0, player.hp - 5), attackerId: shooterId });
                }
            }});
            s.time.delayedCall(5000, () => { if(zone.active) zone.destroy(); });
        } else if (charType === 'edgar') {
            if(isMine && player) { 
                isActionLocked = true; 
                s.tweens.add({ targets: player, x: x + Math.cos(angle) * range, y: y + Math.sin(angle) * range, duration: 600, ease: 'Power2', onComplete: () => isActionLocked = false }); 
            }
        } else if (charType === 'frank') { let b = bConfig(x, y, angle, 400, 400, 80, 0xffff00, true); b.isFrankUlt = true; }
    } else {
        if (charType === 'frank') { for(let i=-2; i<=2; i++) bConfig(x, y, angle+i*0.2, 400, 350, 25, 0x795548, true); }
        else if (charType === 'shelly') { for(let i=-1; i<=1; i++) bConfig(x, y, angle+i*0.2, 450, 450, 5, 0xf1c40f, false); }
        else if (charType === 'spike') { bConfig(x, y, angle, 280, 700, 10, 0x2ecc71, false); }
        else if (charType === 'edgar') { bConfig(x + Math.cos(angle)*35, y + Math.sin(angle)*35, angle, 0, 120, 45, 0xffffff, true); }
    }
}

function explodeSpike(s, x, y, group, shooterId) {
    for(let i=0; i<6; i++) {
        let b = s.add.circle(x, y, 6, 0x2ecc71); b.isSplit = true;
        group.add(b); s.physics.add.existing(b);
        s.physics.velocityFromRotation((Math.PI*2/6)*i, 300, b.body.velocity);
        s.physics.add.collider(b, walls, () => { if(b.active) b.destroy(); });
        s.time.delayedCall(300, () => { if(b.active) b.destroy(); });
        b.charType = 'spike'; b.shooterId = shooterId;
    }
}

function setupVirtualJoysticks(scene) {
    moveJoy = scene.add.circle(130, 470, 65, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    moveThumb = scene.add.circle(130, 470, 35, 0xcccccc, 0.5).setDepth(151).setScrollFactor(0);
    shootJoy = scene.add.circle(670, 470, 65, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    shootThumb = scene.add.circle(670, 470, 35, 0xff0000, 0.5).setDepth(151).setScrollFactor(0);
    ultBtn = scene.add.circle(550, 500, 42, 0x333333, 0.8).setDepth(150).setScrollFactor(0).setInteractive();
    ultGageGraphics = scene.add.graphics().setDepth(151).setScrollFactor(0);
    
    let maskShape = scene.make.graphics();
    maskShape.fillStyle(0xffffff);
    maskShape.fillCircle(550, 500, 42);
    ultGageMask = maskShape.createGeometryMask();
    ultGageGraphics.setMask(ultGageMask);

    scene.input.addPointer(2);
    scene.input.on('pointerdown', p => { 
        if(Phaser.Math.Distance.Between(p.x, p.y, ultBtn.x, ultBtn.y) < 45 && ultGage >= 100) { 
            isUltAiming = true; shootThumb.setFillStyle(0xffff00); 
        } 
    });
    scene.input.on('pointermove', p => {
        if (!p.isDown) return;
        if (p.x < 400) {
            let a = Phaser.Math.Angle.Between(moveJoy.x, moveJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(moveJoy.x, moveJoy.y, p.x, p.y), 65);
            moveThumb.setPosition(moveJoy.x + Math.cos(a)*d, moveJoy.y + Math.sin(a)*d);
            moveData = { x: Math.cos(a)*(d/65), y: Math.sin(a)*(d/65) }; isMoving = true;
        } else {
            let a = Phaser.Math.Angle.Between(shootJoy.x, shootJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(shootJoy.x, shootJoy.y, p.x, p.y), 65);
            shootThumb.setPosition(shootJoy.x + Math.cos(a)*d, shootJoy.y + Math.sin(a)*d);
            shootData = { angle: a, dist: d, power: d/65 }; isAiming = true;
        }
    });
    scene.input.on('pointerup', p => {
        if (p.x < 400) { moveThumb.setPosition(130, 470); isMoving = false; }
        else {
            if (isUltAiming && shootData.dist > 20) {
                socket.emit('ult', { id: socket.id, x: player.x, y: player.y, angle: shootData.angle, charType: player.charType, power: shootData.power });
                createBullet(scene, player.x, player.y, shootData.angle, player.charType, true, socket.id, true, shootData.power);
                ultGage = 0; isUltAiming = false; shootThumb.setFillStyle(0xff0000);
            } else if (isAiming && shootData.dist > 20 && ammo > 0) {
                if(player.charType === 'frank') { isActionLocked = true; scene.time.delayedCall(400, () => isActionLocked = false); }
                socket.emit('shoot', { id: socket.id, x: player.x, y: player.y, angle: shootData.angle, charType: player.charType });
                createBullet(scene, player.x, player.y, shootData.angle, player.charType, true, socket.id, false);
                ammo--; startReload(scene);
            }
            shootThumb.setPosition(670, 470); isAiming = false; isUltAiming = false; shootThumb.setFillStyle(0xff0000);
        }
    });
}

function updateUI(t) {
    if (!t || !t.active) return;
    t.ui.clear(); 
    if (!t.visible) { t.nameTag.setVisible(false); if(t.pinGroup) t.pinGroup.setVisible(false); return; }
    t.nameTag.setVisible(true).setPosition(t.x, t.y - 55);
    if(t.pinGroup) { t.pinGroup.setVisible(true); t.pinGroup.setPosition(t.x, t.y - 100); }
    t.ui.fillStyle(0x000000, 0.5); t.ui.fillRect(t.x-21, t.y-36, 42, 8);
    t.ui.fillStyle(0xc0392b); t.ui.fillRect(t.x-20, t.y-35, 40, 6);
    t.ui.fillStyle(0x2ecc71); t.ui.fillRect(t.x-20, t.y-35, (t.hp/100)*40, 6);
    if (t === player) {
        for (let i=0; i<3; i++) { t.ui.fillStyle(i < ammo ? 0xf1c40f : 0x555555); t.ui.fillRect(t.x-20+(i*14), t.y-25, 12, 4); }
        ultGageGraphics.clear();
        ultGageGraphics.fillStyle(0x222222, 0.8);
        ultGageGraphics.fillCircle(ultBtn.x, ultBtn.y, 42);
        if (ultGage > 0) {
            ultGageGraphics.fillStyle(ultGage >= 100 ? 0xf1c40f : 0xe67e22, 1);
            let rectH = 84 * (ultGage / 100);
            ultGageGraphics.fillRect(ultBtn.x - 42, ultBtn.y + 42 - rectH, 84, rectH);
        }
        ultGageGraphics.lineStyle(4, ultGage >= 100 ? 0xffffff : 0x333333);
        ultGageGraphics.strokeCircle(ultBtn.x, ultBtn.y, 42);
    }
}

function startReload(s) { if(isReloading) return; isReloading = true; s.time.delayedCall(1200, () => { ammo++; isReloading = false; if(ammo < 3) startReload(s); }); }
function startRespawnSequence(s) {
    let c = 3; if(respawnText) respawnText.setText(`復活まで: ${c}`);
    let i = setInterval(() => { c--; if(c>0) { if(respawnText) respawnText.setText(`復活まで: ${c}`); } else { clearInterval(i); if(respawnText) respawnText.setText(''); socket.emit('respawnRequest'); } }, 1000);
}

function displayPin(scene, target, emoji) {
    if (!target || !target.active) return;
    if (target.pinGroup) target.pinGroup.destroy();
    let bg = scene.add.graphics();
    bg.fillStyle(0xffffff, 1); bg.fillRoundedRect(-25, -25, 50, 50, 10);
    bg.lineStyle(2, 0x000000, 1); bg.strokeRoundedRect(-25, -25, 50, 50, 10);
    bg.beginPath(); bg.moveTo(-5, 25); bg.lineTo(0, 35); bg.lineTo(5, 25); bg.closePath(); bg.fillPath(); bg.strokePath();
    let txt = scene.add.text(0, 0, emoji, { fontSize: '32px' }).setOrigin(0.5);
    target.pinGroup = scene.add.container(target.x, target.y - 100, [bg, txt]).setDepth(20);
    scene.time.delayedCall(2500, () => { if(target && target.pinGroup) { target.pinGroup.destroy(); target.pinGroup = null; } });
}

window.launchGame = type => { document.getElementById('overlay').style.display = 'none'; if(socket) socket.emit('joinGame', { charType: type, userName: document.getElementById('nameInput').value || 'No Name' }); };
window.sendPin = e => { if(socket && player && player.visible) socket.emit('sendPin', { id: socket.id, emoji: e }); };
