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
    parent: 'phaser-game',
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%'
    },
    backgroundColor: '#34495e',
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    scene: { preload, create, update }
};

const game = new Phaser.Game(config);
let socket, player, bullets, enemyBullets, walls, bushes, aimGuide;
let otherPlayers = {};
let ammo = 3, isReloading = false, ultGage = 0, isStunned = false, isActionLocked = false, respawnText;
let moveJoy, shootJoy, moveThumb, shootThumb, ultBtn, ultGageGraphics;
let isMoving = false, isAiming = false, isUltAiming = false, moveData = { x: 0, y: 0 }, shootData = { angle: 0, dist: 0, power: 0 };
let lastMoveAngle = 0, touchStartTime = 0;

function preload() {}

function create() {
    socket = io();
    this.cameras.main.setZoom(1.0);
    this.physics.world.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
    this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
    this.add.grid(MAP_SIZE/2, MAP_SIZE/2, MAP_SIZE, MAP_SIZE, TILE_SIZE, TILE_SIZE, 0x34495e).setOutlineStyle(0x2c3e50);

    bullets = this.physics.add.group();
    enemyBullets = this.physics.add.group();
    walls = this.physics.add.staticGroup();
    bushes = this.physics.add.staticGroup();
    aimGuide = this.add.graphics().setDepth(5);

    const mapW = MAP_DESIGN[0].length * TILE_SIZE;
    const mapH = MAP_DESIGN.length * TILE_SIZE;
    const offsetX = (MAP_SIZE - mapW) / 2;
    const offsetY = (MAP_SIZE - mapH) / 2;

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

    respawnText = this.add.text(window.innerWidth/2, window.innerHeight/2, '', { fontSize: '64px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(200).setScrollFactor(0);
    setupVirtualJoysticks(this);

    this.scale.on('resize', (gameSize) => {
        const { width, height } = gameSize;
        respawnText.setPosition(width / 2, height / 2);
        updateJoystickPositions(width, height);
    });

    socket.on('currentPlayers', ps => {
        Object.keys(ps).forEach(id => {
            if (id === socket.id && !player) {
                addPlayer(this, ps[id]);
                this.cameras.main.startFollow(player, true, 0.1, 0.1);
            } else if (id !== socket.id && !otherPlayers[id]) addOtherPlayers(this, ps[id]);
        });
    });
    socket.on('enemyShoot', d => { if(otherPlayers[d.id]) otherPlayers[d.id].lastActionTime = Date.now(); createBullet(this, d.x, d.y, d.angle, d.charType, false, d.id, false); });
    socket.on('enemyUlt', d => { if(otherPlayers[d.id]) otherPlayers[d.id].lastActionTime = Date.now(); createBullet(this, d.x, d.y, d.angle, d.charType, false, d.id, true, d.power); });
    socket.on('playerMoved', info => { if(otherPlayers[info.id]) { otherPlayers[info.id].setPosition(info.x, info.y); otherPlayers[info.id].isInBush = info.isInBush; otherPlayers[info.id].bushId = info.bushId; }});
    socket.on('hpUpdate', d => {
        let t = (d.id === socket.id) ? player : otherPlayers[d.id];
        if (t) { 
            t.hp = d.hp; t.lastActionTime = Date.now(); 
            if (d.hp <= 0 && t.visible) { t.setVisible(false); if (d.id === socket.id) startRespawnSequence(this); }
            if (d.stun) { t.isStunned = true; t.setTint(0xffff00); this.time.delayedCall(1500, () => { t.isStunned = false; t.clearTint(); }); }
        }
    });
    socket.on('playerRespawned', info => {
        let t = (info.id === socket.id) ? player : otherPlayers[info.id];
        if (t) { t.hp = 100; t.setPosition(info.x, info.y); t.setVisible(true); if(info.id === socket.id) { respawnText.setText(''); ammo = 3; isStunned = false; isActionLocked = false; player.lastRegenTime = Date.now(); }}
    });
    socket.on('playerDisconnected', id => { if(otherPlayers[id]) { if(otherPlayers[id].ui) otherPlayers[id].ui.destroy(); if(otherPlayers[id].nameTag) otherPlayers[id].nameTag.destroy(); if(otherPlayers[id].pinGroup) otherPlayers[id].pinGroup.destroy(); otherPlayers[id].destroy(); delete otherPlayers[id]; }});
    socket.on('updateRanking', ps => { const l = document.getElementById('rankingList'); if(l) l.innerHTML = Object.values(ps).sort((a,b)=>b.kills-a.kills).map(p=>`<div>${p.userName}: ${p.kills}</div>`).join(''); });
    socket.on('showPin', d => { let t = (d.id===socket.id)?player:otherPlayers[d.id]; if(t&&t.active) displayPin(this, t, d.emoji); });
}

function update() {
    aimGuide.clear();
    if (player && player.active && player.visible) {
        const now = Date.now();
        if (now - player.lastRegenTime > 3000 && player.hp < 100) {
            player.hp = Math.min(100, player.hp + 0.5);
            socket.emit('updateHP', { id: socket.id, hp: player.hp });
        }
        player.body.setVelocity(0);
        if (!isStunned && !isActionLocked) {
            let speed = { shelly: 220, spike: 220, edgar: 270, frank: 160 }[player.charType] || 220;
            if (isMoving) {
                player.body.setVelocity(moveData.x * speed, moveData.y * speed);
                lastMoveAngle = Math.atan2(moveData.y, moveData.x);
            }
        }
        if (isAiming || isUltAiming) drawAimGuide(player.charType, shootData.angle, isUltAiming, shootData.power);
        let bId = null;
        this.physics.overlap(player, bushes, (p, b) => bId = b.bushId);
        player.isInBush = !!bId; player.bushId = bId;
        player.setAlpha(player.isInBush ? 0.6 : 1);
        socket.emit('playerMovement', { x: player.x, y: player.y, isInBush: player.isInBush, bushId: bId });
        if (player.pinGroup && player.pinGroup.active) player.pinGroup.setPosition(player.x, player.y - 100);
        updateUI(player);
    }
    Object.values(otherPlayers).forEach(op => {
        let isVisible = true;
        let timeSinceAction = Date.now() - (op.lastActionTime || 0);
        if (op.isInBush && timeSinceAction > 1500) { if (!player || !player.isInBush || player.bushId !== op.bushId) isVisible = false; }
        op.setVisible(isVisible && op.hp > 0);
        if (op.pinGroup && op.pinGroup.active) op.pinGroup.setPosition(op.x, op.y - 100);
        updateUI(op);
    });
}

function setupVirtualJoysticks(scene) {
    const JOY_SIZE = 45;
    const THUMB_SIZE = 22;
    moveJoy = scene.add.circle(0, 0, JOY_SIZE, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    moveThumb = scene.add.circle(0, 0, THUMB_SIZE, 0xcccccc, 0.5).setDepth(151).setScrollFactor(0);
    shootJoy = scene.add.circle(0, 0, JOY_SIZE, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    shootThumb = scene.add.circle(0, 0, THUMB_SIZE, 0xff0000, 0.5).setDepth(151).setScrollFactor(0);
    ultBtn = scene.add.circle(0, 0, 30, 0x333333, 0.8).setDepth(150).setScrollFactor(0).setInteractive();
    ultGageGraphics = scene.add.graphics().setDepth(151).setScrollFactor(0);
    updateJoystickPositions(scene.scale.width, scene.scale.height);

    scene.input.addPointer(2);
    scene.input.on('pointerdown', p => { 
        touchStartTime = Date.now();
        if(Phaser.Math.Distance.Between(p.x, p.y, ultBtn.x, ultBtn.y) < 45 && ultGage >= 100) { isUltAiming = true; shootData.dist = 0; } 
        else if(p.x < scene.scale.width/2) { isMoving = true; } 
        else { isAiming = true; shootData.dist = 0; } 
    });

    scene.input.on('pointermove', p => {
        if (!p.isDown) return;
        if (p.x < scene.scale.width/2) {
            let a = Phaser.Math.Angle.Between(moveJoy.x, moveJoy.y, p.x, p.y), d = Math.min(Phaser.Math.Distance.Between(moveJoy.x, moveJoy.y, p.x, p.y), JOY_SIZE);
            moveThumb.setPosition(moveJoy.x + Math.cos(a)*d, moveJoy.y + Math.sin(a)*d);
            moveData = { x: Math.cos(a)*(d/JOY_SIZE), y: Math.sin(a)*(d/JOY_SIZE) };
        } else {
            let a = Phaser.Math.Angle.Between(shootJoy.x, shootJoy.y, p.x, p.y), d = Math.min(Phaser.Math.Distance.Between(shootJoy.x, shootJoy.y, p.x, p.y), JOY_SIZE);
            shootThumb.setPosition(shootJoy.x + Math.cos(a)*d, shootJoy.y + Math.sin(a)*d);
            shootData = { angle: a, dist: d, power: d/JOY_SIZE };
        }
    });

    scene.input.on('pointerup', p => {
        if (p.x < scene.scale.width/2) { moveThumb.setPosition(moveJoy.x, moveJoy.y); isMoving = false; }
        else {
            let duration = Date.now() - touchStartTime;
            let finalAngle = shootData.angle; let finalPower = shootData.power;
            if (duration < 500 && shootData.dist < 15) { finalAngle = getAutoAimAngle(player.charType, isUltAiming); finalPower = 1.0; }
            if (isUltAiming && ultGage >= 100) {
                player.lastRegenTime = Date.now();
                socket.emit('ult', { id: socket.id, x: player.x, y: player.y, angle: finalAngle, charType: player.charType, power: finalPower });
                createBullet(scene, player.x, player.y, finalAngle, player.charType, true, socket.id, true, finalPower);
                ultGage = 0;
            } else if (isAiming && ammo > 0) {
                player.lastRegenTime = Date.now();
                if(player.charType === 'frank') { isActionLocked = true; scene.time.delayedCall(400, () => isActionLocked = false); }
                socket.emit('shoot', { id: socket.id, x: player.x, y: player.y, angle: finalAngle, charType: player.charType });
                createBullet(scene, player.x, player.y, finalAngle, player.charType, true, socket.id, false);
                ammo--; startReload(scene);
            }
            shootThumb.setPosition(shootJoy.x, shootJoy.y); isAiming = false; isUltAiming = false; shootData.dist = 0;
        }
    });
}

function updateJoystickPositions(w, h) {
    if(!moveJoy) return;
    const OFFSET = 105; 
    moveJoy.setPosition(OFFSET, h - OFFSET);
    moveThumb.setPosition(OFFSET, h - OFFSET);
    shootJoy.setPosition(w - OFFSET, h - OFFSET);
    shootThumb.setPosition(w - OFFSET, h - OFFSET);
    ultBtn.setPosition(w - OFFSET - 80, h - OFFSET - 60);
}

function updateUI(t) {
    if (!t || !t.active) return;
    t.ui.clear(); if (!t.visible) { t.nameTag.setVisible(false); return; }
    t.nameTag.setVisible(true).setPosition(t.x, t.y - 55);
    t.ui.fillStyle(0x000000, 0.5); t.ui.fillRect(t.x-21, t.y-36, 42, 8);
    t.ui.fillStyle(0xc0392b); t.ui.fillRect(t.x-20, t.y-35, 40, 6);
    t.ui.fillStyle(0x2ecc71); t.ui.fillRect(t.x-20, t.y-35, (t.hp/100)*40, 6);
    if (t === player) {
        for (let i=0; i<3; i++) { t.ui.fillStyle(i < ammo ? 0xf1c40f : 0x555555); t.ui.fillRect(t.x-20+(i*14), t.y-25, 12, 4); }
        ultGageGraphics.clear(); 
        ultGageGraphics.fillStyle(0x222222, 0.8); ultGageGraphics.fillCircle(ultBtn.x, ultBtn.y, 30);
        if (ultGage > 0) {
            ultGageGraphics.fillStyle(ultGage >= 100 ? 0xf1c40f : 0xe67e22, 1);
            let h = 60 * (ultGage / 100); 
            ultGageGraphics.fillRect(ultBtn.x - 30, ultBtn.y + 30 - h, 60, h);
        }
        ultGageGraphics.lineStyle(4, ultGage >= 100 ? 0xffffff : 0x333333); ultGageGraphics.strokeCircle(ultBtn.x, ultBtn.y, 30);
    }
}

function displayPin(scene, target, emoji) {
    if (!target || !target.active) return;
    if (target.pinGroup) target.pinGroup.destroy();
    let txt = scene.add.text(target.x, target.y - 100, emoji, { fontSize: '32px', backgroundColor: '#ffffff', padding: { x: 5, y: 5 } }).setOrigin(0.5).setDepth(20);
    target.pinGroup = txt;
    scene.time.delayedCall(2000, () => { if(txt && txt.active) txt.destroy(); });
}

function createBullet(s, x, y, angle, charType, isMine, shooterId, isUlt, power = 1.0) {
    let group = isMine ? bullets : enemyBullets;
    let bConfig = (sx, sy, ang, spd, life, size, col, isRect) => {
        let b = isRect ? s.add.rectangle(sx, sy, size, size, col) : s.add.circle(sx, sy, size, col);
        group.add(b); s.physics.add.existing(b);
        s.physics.velocityFromRotation(ang, spd, b.body.velocity);
        s.physics.add.collider(b, walls, () => { if(b.charType==='spike'&&!b.isUlt) { splitSpike(s, b.x, b.y, shooterId, isMine); } b.destroy(); });
        s.time.delayedCall(life, () => { if(b && b.active) { if(b.charType==='spike'&&!b.isUlt) splitSpike(s, b.x, b.y, shooterId, isMine); b.destroy(); } });
        b.charType = charType; b.shooterId = shooterId; b.isUlt = isUlt;
        return b;
    };

    function splitSpike(scene, sx, sy, sid, mine) {
        for(let i=0; i<6; i++) {
            let sb = scene.add.circle(sx, sy, 5, 0x2ecc71);
            group.add(sb); scene.physics.add.existing(sb);
            scene.physics.velocityFromRotation((Math.PI*2/6)*i, 200, sb.body.velocity);
            // 分裂弾に壁との衝突判定を追加し、貫通を防止
            scene.physics.add.collider(sb, walls, () => sb.destroy());
            sb.charType = 'spike'; sb.shooterId = sid; sb.isUlt = false;
            scene.time.delayedCall(300, () => { if(sb.active) sb.destroy(); });
        }
    }

    if (isUlt) {
        let range = 280 * power;
        if (charType === 'shelly') { for(let i=-4; i<=4; i++) bConfig(x, y, angle + i*0.15, 600, 400, 7, 0xffff00, false); }
        else if (charType === 'spike') {
            let tx = x + Math.cos(angle) * range, ty = y + Math.sin(angle) * range;
            let ultArea = s.add.circle(tx, ty, 90, 0x2ecc71, 0.4);
            group.add(ultArea); s.physics.add.existing(ultArea);
            ultArea.body.setImmovable(true);
            ultArea.isUlt = true; ultArea.charType = 'spike'; ultArea.shooterId = shooterId;
            s.time.delayedCall(3500, () => { if(ultArea.active) ultArea.destroy(); });
        }
        else if (charType === 'edgar') {
            if(isMine && player) { isActionLocked = true; s.tweens.add({ targets: player, x: x + Math.cos(angle) * range, y: y + Math.sin(angle) * range, duration: 600, ease: 'Power2', onComplete: () => isActionLocked = false }); }
        }
        else if (charType === 'frank') {
            for(let i=-2; i<=2; i++) { let b = bConfig(x, y, angle + i * 0.2, 500, 400, 25, 0xffff00, false); b.isFrankUlt = true; }
        }
    } else {
        if (charType === 'shelly') { for(let i=-1; i<=1; i++) bConfig(x, y, angle+i*0.2, 450, 450, 5, 0xf1c40f, false); }
        else if (charType === 'spike') { bConfig(x, y, angle, 280, 700, 10, 0x2ecc71, false); }
        else if (charType === 'edgar') { bConfig(x + Math.cos(angle)*35, y + Math.sin(angle)*35, angle, 0, 120, 45, 0xffffff, true); }
        else if (charType === 'frank') { for(let i=-1; i<=1; i++) bConfig(x, y, angle + i * 0.15, 400, 350, 20, 0x795548, false); }
    }
}

function addPlayer(s, info) {
    let colors = { shelly: 0x3498db, spike: 0x2ecc71, edgar: 0x9b59b6, frank: 0x795548 };
    player = s.add.circle(info.x, info.y, 20, colors[info.charType]);
    s.physics.add.existing(player); 
    player.charType = info.charType; player.hp = 100; player.lastRegenTime = Date.now();
    player.ui = s.add.graphics().setDepth(10);
    player.nameTag = s.add.text(info.x, info.y - 55, info.userName, { fontSize: '14px', fill: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    player.body.setCollideWorldBounds(true);
    s.physics.add.collider(player, walls);
    
    s.physics.add.overlap(player, enemyBullets, (p, b) => {
        if(p.visible && p.hp > 0 && b.active) {
            p.lastRegenTime = Date.now();
            let d = b.isUlt ? { shelly: 35, spike: 5, edgar: 15, frank: 30 }[b.charType] : { shelly: 25, spike: 20, edgar: 15, frank: 20 }[b.charType];
            if (b.charType === 'spike' && b.isUlt) {
                if (!p.lastUltHit || Date.now() - p.lastUltHit > 500) {
                    p.lastUltHit = Date.now();
                    socket.emit('updateHP', { id: socket.id, hp: Math.max(0, p.hp - d), attackerId: b.shooterId });
                }
            } else {
                b.destroy(); 
                socket.emit('updateHP', { id: socket.id, hp: Math.max(0, p.hp - d), attackerId: b.shooterId, stun: b.isFrankUlt });
            }
        }
    });
}

function drawAimGuide(charType, angle, isUlt, power) {
    aimGuide.lineStyle(2, 0xffffff, 0.4); aimGuide.fillStyle(0xffffff, 0.15);
    let maxRange = isUlt ? 280 : { shelly: 200, spike: 200, edgar: 80, frank: 180 }[charType];
    let currentRange = maxRange * power;
    if ((charType === 'edgar' || charType === 'spike') && isUlt) {
        let tx = player.x + Math.cos(angle) * currentRange, ty = player.y + Math.sin(angle) * currentRange;
        aimGuide.strokeCircle(tx, ty, 45); aimGuide.fillCircle(tx, ty, 45);
    } else if (charType === 'shelly' || charType === 'frank') {
        aimGuide.beginPath(); aimGuide.moveTo(player.x, player.y);
        aimGuide.arc(player.x, player.y, maxRange, angle - 0.35, angle + 0.35);
        aimGuide.closePath(); aimGuide.fillPath(); aimGuide.strokePath();
    } else {
        let ex = player.x + Math.cos(angle) * maxRange, ey = player.y + Math.sin(angle) * maxRange;
        aimGuide.lineBetween(player.x, player.y, ex, ey);
    }
}

function addOtherPlayers(s, info) {
    let colors = { shelly: 0x3498db, spike: 0x2ecc71, edgar: 0x9b59b6, frank: 0x795548 };
    let op = s.add.circle(info.x, info.y, 20, colors[info.charType]);
    s.physics.add.existing(op); op.id = info.id; op.hp = 100; op.ui = s.add.graphics().setDepth(10);
    op.nameTag = s.add.text(info.x, info.y - 55, info.userName, { fontSize: '14px', fill: '#ffffff' }).setOrigin(0.5).setDepth(10);
    otherPlayers[info.id] = op;
    s.physics.add.overlap(bullets, op, (target, b) => {
        if (target.visible && b.active && b.shooterId === socket.id) {
            let gain = b.isUlt ? 0 : { shelly: 12, spike: 20, edgar: 15, frank: 25 }[player.charType];
            ultGage = Math.min(100, ultGage + gain);
            if (player.charType === 'edgar') player.hp = Math.min(100, player.hp + 3);
            if (!(b.charType === 'spike' && b.isUlt)) b.destroy(); 
        }
    });
}

function getAutoAimAngle(charType, isUlt) {
    let maxRange = 300; let nearestEnemy = null, minDist = Infinity;
    Object.values(otherPlayers).forEach(op => {
        if (!op.visible || op.hp <= 0) return;
        let d = Phaser.Math.Distance.Between(player.x, player.y, op.x, op.y);
        if (d < maxRange && d < minDist) { minDist = d; nearestEnemy = op; }
    });
    return nearestEnemy ? Phaser.Math.Angle.Between(player.x, player.y, nearestEnemy.x, nearestEnemy.y) : lastMoveAngle;
}

function startReload(s) { if(isReloading) return; isReloading = true; s.time.delayedCall(1200, () => { ammo++; isReloading = false; if(ammo < 3) startReload(s); }); }
function startRespawnSequence(s) {
    let c = 3; if(respawnText) respawnText.setText(`復活まで: ${c}`);
    let i = setInterval(() => { c--; if(c>0) { if(respawnText) respawnText.setText(`復活まで: ${c}`); } else { clearInterval(i); if(respawnText) respawnText.setText(''); socket.emit('respawnRequest'); } }, 1000);
}
window.launchGame = type => { document.getElementById('overlay').style.display = 'none'; if(socket) socket.emit('joinGame', { charType: type, userName: document.getElementById('nameInput').value || 'No Name' }); };
window.sendPin = e => { if(socket && player && player.visible) socket.emit('sendPin', { id: socket.id, emoji: e }); };
