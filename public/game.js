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
let socket, player, bullets, enemyBullets, walls, bushes, effects;
let otherPlayers = {};
let ammo = 3, isReloading = false, ultGage = 0, isStunned = false, isActionLocked = false;
let moveJoy, shootJoy, moveThumb, shootThumb, ultBtn;
let isMoving = false, isAiming = false, isUltAiming = false, moveData = { x: 0, y: 0 }, shootData = { angle: 0, dist: 0 };

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
    effects = this.add.group();

    const offsetX = (MAP_SIZE - (MAP_DESIGN[0].length * TILE_SIZE)) / 2;
    const offsetY = (MAP_SIZE - (MAP_DESIGN.length * TILE_SIZE)) / 2;
    for (let r = 0; r < MAP_DESIGN.length; r++) {
        for (let c = 0; c < MAP_DESIGN[r].length; c++) {
            let x = offsetX + c * TILE_SIZE + TILE_SIZE/2;
            let y = offsetY + r * TILE_SIZE + TILE_SIZE/2;
            if (MAP_DESIGN[r][c] === 1) {
                let w = walls.create(x, y, null).setSize(TILE_SIZE-4, TILE_SIZE-4).setVisible(false);
                this.add.rectangle(x, y, TILE_SIZE-4, TILE_SIZE-4, 0x95a5a6);
            }
            if (MAP_DESIGN[r][c] === 2) {
                let b = bushes.create(x, y, null).setSize(TILE_SIZE, TILE_SIZE).setVisible(false);
                b.bushId = `bush_${r}_${c}`;
                this.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, 0x27ae60, 0.5);
            }
        }
    }

    setupVirtualJoysticks(this);

    socket.on('currentPlayers', (ps) => {
        Object.keys(ps).forEach(id => {
            if (id === socket.id && !player) {
                addPlayer(this, ps[id]);
                this.cameras.main.startFollow(player, true, 0.1, 0.1);
            } else if (id !== socket.id && !otherPlayers[id]) addOtherPlayers(this, ps[id]);
        });
    });

    socket.on('enemyShoot', data => createBullet(this, data.x, data.y, data.angle, data.charType, false, data.id, false));
    socket.on('enemyUlt', data => createBullet(this, data.x, data.y, data.angle, data.charType, false, data.id, true));
    socket.on('playerMoved', info => { if(otherPlayers[info.id]) { otherPlayers[info.id].setPosition(info.x, info.y); otherPlayers[info.id].isInBush = info.isInBush; otherPlayers[info.id].bushId = info.bushId; }});
    socket.on('hpUpdate', data => {
        let t = (data.id === socket.id) ? player : otherPlayers[data.id];
        if (t) { 
            t.hp = data.hp; 
            if (data.hp <= 0 && t.visible) {
                t.setVisible(false);
                if (data.id === socket.id) startRespawnSequence(this);
            }
            if (data.stun) { t.isStunned = true; t.setTint(0xffff00); this.time.delayedCall(1500, () => { t.isStunned = false; t.clearTint(); }); }
        }
    });
    socket.on('playerRespawned', info => {
        let t = (info.id === socket.id) ? player : otherPlayers[info.id];
        if (t) { t.hp = 100; t.setPosition(info.x, info.y); t.setVisible(true); if(info.id === socket.id) { ammo = 3; ultGage = 0; isStunned = false; isActionLocked = false; } }
    });
    socket.on('showPin', data => { let t = (data.id === socket.id) ? player : otherPlayers[data.id]; if(t) displayPin(this, t, data.emoji); });
}

function update() {
    if (player && player.visible) {
        player.body.setVelocity(0);
        if (!isStunned && !isActionLocked) {
            let speed = { shelly: 220, spike: 220, edgar: 270, frank: 160 }[player.charType] || 220;
            if (isMoving) player.body.setVelocity(moveData.x * speed, moveData.y * speed);
        }

        let bId = null;
        this.physics.overlap(player, bushes, (p, b) => bId = b.bushId);
        player.isInBush = !!bId;
        player.setAlpha(player.isInBush ? 0.6 : 1);

        socket.emit('playerMovement', { x: player.x, y: player.y, isInBush: player.isInBush, bushId: bId });
        updateUI(player);
    }
    Object.values(otherPlayers).forEach(op => updateUI(op));
}

function addPlayer(s, info) {
    let colors = { shelly: 0x3498db, spike: 0x2ecc71, edgar: 0x9b59b6, frank: 0x795548 };
    player = s.add.circle(info.x, info.y, 20, colors[info.charType]);
    s.physics.add.existing(player);
    player.charType = info.charType; player.hp = 100; player.ui = s.add.graphics().setDepth(10);
    player.nameTag = s.add.text(info.x, info.y - 55, info.userName, { fontSize: '14px', fill: '#ffffff' }).setOrigin(0.5).setDepth(10);
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
            ultGage = Math.min(100, ultGage + 15);
            if (player.charType === 'edgar') player.hp = Math.min(100, player.hp + 3);
        }
    });
}

function createBullet(s, x, y, angle, charType, isMine, shooterId, isUlt) {
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
        if (charType === 'shelly') {
            for(let i=-4; i<=4; i++) bConfig(x, y, angle + i*0.15, 600, 400, 7, 0xffff00, false);
        } else if (charType === 'spike') {
            let zone = s.add.circle(x + Math.cos(angle)*200, y + Math.sin(angle)*200, 100, 0x2ecc71, 0.3).setDepth(1);
            s.physics.add.existing(zone);
            s.time.addEvent({ delay: 500, repeat: 10, callback: () => {
                if(s.physics.overlap(player, zone)) {
                    socket.emit('updateHP', { id: socket.id, hp: Math.max(0, player.hp - 5), attackerId: shooterId });
                }
            }});
            s.time.delayedCall(5000, () => zone.destroy());
        } else if (charType === 'edgar') {
            if(isMine) {
                isActionLocked = true;
                s.tweens.add({ targets: player, x: x+Math.cos(angle)*250, y: y+Math.sin(angle)*250, duration: 600, ease: 'Power2', onComplete: () => isActionLocked = false });
            }
        } else if (charType === 'frank') {
            let b = bConfig(x, y, angle, 400, 400, 80, 0xffff00, true);
            b.isFrankUlt = true;
        }
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
        s.physics.add.collider(b, walls, () => b.destroy());
        s.time.delayedCall(300, () => b.active && b.destroy());
        b.charType = 'spike'; b.shooterId = shooterId;
    }
}

function setupVirtualJoysticks(scene) {
    moveJoy = scene.add.circle(130, 470, 65, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    moveThumb = scene.add.circle(130, 470, 35, 0xcccccc, 0.5).setDepth(151).setScrollFactor(0);
    shootJoy = scene.add.circle(670, 470, 65, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    shootThumb = scene.add.circle(670, 470, 35, 0xff0000, 0.5).setDepth(151).setScrollFactor(0);
    ultBtn = scene.add.circle(550, 500, 40, 0x555555, 0.8).setDepth(150).setScrollFactor(0).setInteractive();
    
    scene.input.addPointer(2);
    scene.input.on('pointerdown', p => {
        if(Phaser.Math.Distance.Between(p.x, p.y, ultBtn.x, ultBtn.y) < 40 && ultGage >= 100) { isUltAiming = true; ultBtn.setFillStyle(0xffff00); }
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
            shootData = { angle: a, dist: d }; isAiming = true;
        }
    });
    scene.input.on('pointerup', p => {
        if (p.x < 400) { moveThumb.setPosition(130, 470); isMoving = false; }
        else {
            if (isUltAiming) {
                socket.emit('ult', { id: socket.id, x: player.x, y: player.y, angle: shootData.angle, charType: player.charType });
                createBullet(scene, player.x, player.y, shootData.angle, player.charType, true, socket.id, true);
                ultGage = 0; isUltAiming = false; ultBtn.setFillStyle(0x555555);
            } else if (isAiming && shootData.dist > 20 && ammo > 0) {
                if(player.charType === 'frank') { isActionLocked = true; scene.time.delayedCall(400, () => isActionLocked = false); }
                socket.emit('shoot', { id: socket.id, x: player.x, y: player.y, angle: shootData.angle, charType: player.charType });
                createBullet(scene, player.x, player.y, shootData.angle, player.charType, true, socket.id, false);
                ammo--; startReload(scene);
            }
            shootThumb.setPosition(670, 470); isAiming = false;
        }
    });
}

function updateUI(t) {
    t.ui.clear();
    if (!t.visible) { t.nameTag.setVisible(false); return; }
    t.nameTag.setVisible(true).setPosition(t.x, t.y - 55);
    t.ui.fillStyle(0xc0392b); t.ui.fillRect(t.x-20, t.y-35, 40, 6);
    t.ui.fillStyle(0x2ecc71); t.ui.fillRect(t.x-20, t.y-35, (t.hp/100)*40, 6);
    if (t === player) {
        for (let i=0; i<3; i++) { t.ui.fillStyle(i < ammo ? 0xf1c40f : 0x555555); t.ui.fillRect(t.x-20+(i*14), t.y-25, 12, 4); }
        ultBtn.alpha = ultGage >= 100 ? 1 : 0.3;
        if(ultGage >= 100) ultBtn.setStrokeStyle(2, 0xffffff); else ultBtn.setStrokeStyle(0);
    }
}

function startReload(scene) { if(isReloading) return; isReloading = true; scene.time.addEvent({ delay: 1200, callback: () => { ammo++; if(ammo<3) isReloading=false, startReload(scene); else isReloading=false; updateUI(player); }}); }
function startRespawnSequence(s) { setTimeout(() => socket.emit('respawnRequest'), 3000); }
function displayPin(s, t, e) { if(t.p) t.p.destroy(); t.p = s.add.text(t.x, t.y-80, e, {fontSize:'30px'}).setOrigin(0.5); s.time.delayedCall(2000, () => t.p && t.p.destroy()); }
window.launchGame = type => { document.getElementById('overlay').style.display = 'none'; socket.emit('joinGame', { charType: type, userName: document.getElementById('nameInput').value || 'No Name' }); };
window.sendPin = e => { if(socket && player && player.visible) socket.emit('sendPin', { id: socket.id, emoji: e }); };
