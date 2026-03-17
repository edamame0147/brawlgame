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
let moveJoy, shootJoy, moveThumb, shootThumb, ultBtn, ultGageGraphics;
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
    socket.on('updateRanking', ps => {
        const list = document.getElementById('rankingList');
        if(list) list.innerHTML = Object.values(ps).sort((a, b) => b.kills - a.kills).map(p => `<div>${p.userName}: ${p.kills}</div>`).join('');
    });
    socket.on('showPin', data => { let t = (data.id === socket.id) ? player : otherPlayers[data.id]; if(t) displayPin(this, t, data.emoji); });
}

function update() {
    aimGuide.clear();
    if (player && player.visible) {
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
    let currentRange = maxRange * power; // スティックの倒し具合で距離を可変に

    if ((charType === 'edgar' || charType === 'spike') && isUlt) {
        // 円形ターゲット（着地/着弾地点）を移動させる
        let targetX = player.x + Math.cos(angle) * currentRange;
        let targetY = player.y + Math.sin(angle) * currentRange;
        aimGuide.strokeCircle(targetX, targetY, 45);
        aimGuide.fillCircle(targetX, targetY, 45);
        // 自分からの軌道線も薄く引く
        aimGuide.lineStyle(1, 0xffffff, 0.2);
        aimGuide.lineBetween(player.x, player.y, targetX, targetY);
    } else if (charType === 'shelly' || charType === 'frank' || (charType === 'spike' && isUlt)) {
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
        if(p.visible && p.hp > 0) {
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
    s.physics.add.overlap(bullets, op, (target, b) => {
        if (target.visible && b.shooterId === socket.id) {
            let gain = b.isUlt ? 0 : { shelly: 12, spike: 20, edgar: 15, frank: 25 }[player.charType];
            ultGage = Math.min(100, ultGage + gain);
            if (player.charType === 'edgar') player.hp = Math.min(100, player.hp + 3);
        }
    });
}

function createBullet(s, x, y, angle, charType, isMine, shooterId, isUlt, power = 1.0) {
    let group = isMine ? bullets : enemyBullets;
    let bConfig = (sx, sy, ang, spd, life, size, col, isRect) => {
        let b = isRect ? s.add.rectangle(sx, sy, size, size, col) : s.add.circle(sx, sy, size, col);
        group.add(b); s.physics.add.existing(b);
        s.physics.velocityFromRotation(ang, spd, b.body.velocity);
        s.physics.add.collider(b, walls, () => { if(charType==='spike' && !b.isSplit) explodeSpike(s, b.x, b.y, group, shooterId); b.destroy(); });
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
            s.time.addEvent({ delay: 500, repeat: 10, callback: () => { if(s.physics.overlap(player, zone)) socket.emit('updateHP', { id: socket.id, hp: Math.max(0, player.hp - 5), attackerId: shooterId }); }});
            s.time.delayedCall(5000, () => zone.destroy());
        } else if (charType === 'edgar') {
            if(isMine) { 
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

function setupVirtualJoysticks(scene) {
    moveJoy = scene.add.circle(130, 470, 65, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    moveThumb = scene.add.circle(130, 470, 35, 0xcccccc, 0.5).setDepth(151).setScrollFactor(0);
    shootJoy = scene.add.circle(670, 470, 65, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    shootThumb = scene.add.circle(670, 470, 35, 0xff0000, 0.5).setDepth(151).setScrollFactor(0);
    ultBtn = scene.add.circle(550, 500, 42, 0x333333, 0.8).setDepth(150).setScrollFactor(0).setInteractive();
    ultGageGraphics = scene.add.graphics().setDepth(151).setScrollFactor(0);
    
    scene.input.addPointer(2);
    scene.input.on('pointerdown', p => { if(Phaser.Math.Distance.Between(p.x, p.y, ultBtn.x, ultBtn.y) < 45 && ultGage >= 100) { isUltAiming = true; shootThumb.setFillStyle(0xffff00); } });
    scene.input.on('pointermove', p => {
        if (!p.isDown) return;
        if (p.x < 400) {
            let a = Phaser.Math.Angle.Between(moveJoy.x, moveJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(moveJoy.x, moveJoy.y, p.x, p.y), 65);
            moveThumb.setPosition(moveJoy.x + Math.cos(a)*d, moveJoy.y + Math.sin(a)*d);
            moveData = { x: Math.cos(a)*(d/65), y: Math
