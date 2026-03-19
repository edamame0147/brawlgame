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
let lastMoveAngle = 0, touchStartTime = 0, lastRegenTick = 0;

// バグ修正用：ポインター管理
let movePointer = null;
let shootPointer = null;

function preload() {}

function create() {
    socket = io();
    this.cameras.main.setZoom(1.5);
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
            let x = offsetX + c * TILE_SIZE + TILE_SIZE/2, y = offsetY + r * TILE_SIZE + TILE_SIZE/2;
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

    respawnText = this.add.text(window.innerWidth/2, window.innerHeight/2, '', { fontSize: '48px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(200).setScrollFactor(0);
    setupVirtualJoysticks(this);

    this.scale.on('resize', (gameSize) => {
        respawnText.setPosition(gameSize.width / 2, gameSize.height / 2);
        updateJoystickPositions(gameSize.width, gameSize.height);
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
            if (d.id === socket.id) {
                player.lastRegenTime = Date.now(); // 被弾で回復タイマーリセット
                if (d.hp <= 0 && t.visible) { t.setVisible(false); startRespawnSequence(this); }
                if (d.stun) { isStunned = true; player.setTint(0xffff00); this.time.delayedCall(1500, () => { isStunned = false; player.clearTint(); }); }
            }
        }
    });
    socket.on('playerRespawned', info => {
        let t = (info.id === socket.id) ? player : otherPlayers[info.id];
        if (t) { t.hp = 100; t.setPosition(info.x, info.y); t.setVisible(true); if(info.id === socket.id) { respawnText.setText(''); ammo = 3; isStunned = false; isActionLocked = false; player.lastRegenTime = Date.now(); }}
    });
    socket.on('playerDisconnected', id => { if(otherPlayers[id]) { if(otherPlayers[id].ui) otherPlayers[id].ui.destroy(); if(otherPlayers[id].nameTag) otherPlayers[id].nameTag.destroy(); otherPlayers[id].destroy(); delete otherPlayers[id]; }});
}

function update() {
    aimGuide.clear();
    if (player && player.active && player.visible) {
        // --- ★ 自動回復ロジック (3秒間何もしないと1秒毎に10%回復) ---
        const now = Date.now();
        if (now - player.lastRegenTime > 3000 && player.hp < 100) {
            if (now - lastRegenTick > 1000) {
                player.hp = Math.min(100, player.hp + 10);
                socket.emit('updateHP', { id: socket.id, hp: player.hp });
                lastRegenTick = now;
            }
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
        updateUI(player);
    }
    Object.values(otherPlayers).forEach(op => updateUI(op));
}

function setupVirtualJoysticks(scene) {
    // UIの小型化 (半径を約半分に調整)
    const joyRadius = 35;
    const thumbRadius = 18;

    moveJoy = scene.add.circle(0, 0, joyRadius, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    moveThumb = scene.add.circle(0, 0, thumbRadius, 0xcccccc, 0.5).setDepth(151).setScrollFactor(0);
    shootJoy = scene.add.circle(0, 0, joyRadius, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    shootThumb = scene.add.circle(0, 0, thumbRadius, 0xff0000, 0.5).setDepth(151).setScrollFactor(0);
    ultBtn = scene.add.circle(0, 0, 32, 0x333333, 0.8).setDepth(150).setScrollFactor(0).setInteractive();
    ultGageGraphics = scene.add.graphics().setDepth(151).setScrollFactor(0);
    
    updateJoystickPositions(scene.scale.width, scene.scale.height);

    scene.input.addPointer(2);

    scene.input.on('pointerdown', p => {
        // ウルトボタン判定 (中央下)
        if(Phaser.Math.Distance.Between(p.x, p.y, ultBtn.x, ultBtn.y) < 40 && ultGage >= 100) {
            isUltAiming = true;
            shootPointer = p;
            touchStartTime = Date.now();
        } 
        // 画面左側：移動
        else if(p.x < scene.scale.width / 2 && !movePointer) {
            movePointer = p;
            isMoving = true;
        }
        // 画面右側：攻撃
        else if(p.x >= scene.scale.width / 2 && !shootPointer) {
            shootPointer = p;
            isAiming = true;
            touchStartTime = Date.now();
            shootData.dist = 0;
        }
    });

    scene.input.on('pointermove', p => {
        if (p === movePointer) {
            let a = Phaser.Math.Angle.Between(moveJoy.x, moveJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(moveJoy.x, moveJoy.y, p.x, p.y), joyRadius);
            moveThumb.setPosition(moveJoy.x + Math.cos(a)*d, moveJoy.y + Math.sin(a)*d);
            moveData = { x: Math.cos(a)*(d/joyRadius), y: Math.sin(a)*(d/joyRadius) };
        } 
        else if (p === shootPointer) {
            let a = Phaser.Math.Angle.Between(shootJoy.x, shootJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(shootJoy.x, shootJoy.y, p.x, p.y), joyRadius);
            shootThumb.setPosition(shootJoy.x + Math.cos(a)*d, shootJoy.y + Math.sin(a)*d);
            shootData = { angle: a, dist: d, power: d/joyRadius };
        }
    });

    scene.input.on('pointerup', p => {
        if (p === movePointer) {
            moveThumb.setPosition(moveJoy.x, moveJoy.y);
            isMoving = false;
            movePointer = null;
            moveData = { x: 0, y: 0 };
        } 
        else if (p === shootPointer) {
            let duration = Date.now() - touchStartTime;
            let finalAngle = shootData.angle;
            if (duration < 400 && shootData.dist < 20) finalAngle = getAutoAimAngle();
            
            if (isUltAiming && ultGage >= 100) {
                player.lastRegenTime = Date.now();
                socket.emit('ult', { id: socket.id, x: player.x, y: player.y, angle: finalAngle, charType: player.charType, power: 1.0 });
                createBullet(scene, player.x, player.y, finalAngle, player.charType, true, socket.id, true);
                ultGage = 0;
            } else if (isAiming && ammo > 0) {
                player.lastRegenTime = Date.now();
                if(player.charType === 'frank') { isActionLocked = true; scene.time.delayedCall(400, () => isActionLocked = false); }
                socket.emit('shoot', { id: socket.id, x: player.x, y: player.y, angle: finalAngle, charType: player.charType });
                createBullet(scene, player.x, player.y, finalAngle, player.charType, true, socket.id, false);
                ammo--; startReload(scene);
            }
            shootThumb.setPosition(shootJoy.x, shootJoy.y);
            isAiming = false; isUltAiming = false; shootPointer = null;
        }
    });
}

function updateJoystickPositions(w, h) {
    if(!moveJoy) return;
    moveJoy.setPosition(70, h - 70);
    moveThumb.setPosition(70, h - 70);
    shootJoy.setPosition(w - 70, h - 70);
    shootThumb.setPosition(w - 70, h - 70);
    ultBtn.setPosition(w / 2, h - 60); // 下部中央
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
        ultGageGraphics.fillStyle(0x222222, 0.8); ultGageGraphics.fillCircle(ultBtn.x, ultBtn.y, 32);
        if (ultGage > 0) {
            ultGageGraphics.fillStyle(ultGage >= 100 ? 0xf1c40f : 0xe67e22);
            let h = 64 * (ultGage / 100);
            ultGageGraphics.fillRect(ultBtn.x - 32, ultBtn.y + 32 - h, 64, h);
        }
        ultGageGraphics.lineStyle(3, ultGage >= 100 ? 0xffffff : 0x000000);
        ultGageGraphics.strokeCircle(ultBtn.x, ultBtn.y, 32);
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
            let d = b.isUlt ? 35 : 20; b.destroy();
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
        if (target.visible && b.active && b.shooterId === socket.id) {
            ultGage = Math.min(100, ultGage + 15); b.destroy();
        }
    });
}

function createBullet(s, x, y, angle, charType, isMine, shooterId, isUlt, power = 1.0) {
    let group = isMine ? bullets : enemyBullets;
    let bConfig = (sx, sy, ang, spd, life, size, col) => {
        let b = s.add.circle(sx, sy, size, col);
        group.add(b); s.physics.add.existing(b);
        s.physics.velocityFromRotation(ang, spd, b.body.velocity);
        s.physics.add.collider(b, walls, () => b.destroy());
        s.time.delayedCall(life, () => { if(b.active) b.destroy(); });
        b.shooterId = shooterId; b.isUlt = isUlt;
    };

    if (isUlt) {
        if (charType === 'shelly') { for(let i=-3; i<=3; i++) bConfig(x, y, angle + i*0.15, 600, 400, 7, 0xffff00); }
        else if (charType === 'frank') { 
            let b = s.add.circle(x + Math.cos(angle)*150, y + Math.sin(angle)*150, 100, 0xffff00, 0.3);
            group.add(b); s.physics.add.existing(b); b.isFrankUlt = true; b.shooterId = shooterId;
            s.time.delayedCall(400, () => b.destroy());
        }
        else bConfig(x, y, angle, 700, 500, 12, 0xffff00);
    } else {
        bConfig(x, y, angle, 500, 500, 6, 0xffffff);
    }
}

function getAutoAimAngle() {
    let nearest = null, minDist = 400;
    Object.values(otherPlayers).forEach(op => {
        let d = Phaser.Math.Distance.Between(player.x, player.y, op.x, op.y);
        if (d < minDist && op.visible) { minDist = d; nearest = op; }
    });
    return nearest ? Phaser.Math.Angle.Between(player.x, player.y, nearest.x, nearest.y) : lastMoveAngle;
}

function drawAimGuide(charType, angle, isUlt, power) {
    aimGuide.lineStyle(2, 0xffffff, 0.3);
    let range = isUlt ? 280 : 200;
    aimGuide.lineBetween(player.x, player.y, player.x + Math.cos(angle)*range, player.y + Math.sin(angle)*range);
}

function startReload(s) { if(isReloading) return; isReloading = true; s.time.delayedCall(1200, () => { ammo = Math.min(3, ammo + 1); isReloading = false; if(ammo < 3) startReload(s); }); }

function startRespawnSequence(s) {
    let c = 3; respawnText.setText(`復活まで: ${c}`);
    let i = setInterval(() => { c--; if(c>0) respawnText.setText(`復活まで: ${c}`); else { clearInterval(i); respawnText.setText(''); socket.emit('respawnRequest'); } }, 1000);
}

window.launchGame = type => { document.getElementById('overlay').style.display = 'none'; if(socket) socket.emit('joinGame', { charType: type, userName: document.getElementById('nameInput').value || 'No Name' }); };
