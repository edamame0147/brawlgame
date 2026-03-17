const config = {
    type: Phaser.AUTO,
    width: 800, height: 600,
    backgroundColor: '#34495e',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    scene: { preload, create, update }
};

const game = new Phaser.Game(config);
let socket, player, bullets, enemyBullets, walls, bushes;
let otherPlayers = {};
let ammo = 3, isReloading = false, respawnText, respawnTimerInterval;

// ジョイスティック
let moveJoy, shootJoy, moveThumb, shootThumb;
let isMoving = false, isAiming = false;
let moveData = { x: 0, y: 0 }, shootData = { angle: 0, dist: 0 };

function preload() {}

function create() {
    socket = io();
    bullets = this.physics.add.group();
    enemyBullets = this.physics.add.group();
    walls = this.physics.add.staticGroup();
    bushes = this.physics.add.staticGroup();

    // マップ配置
    createWall(this, 200, 300, 40, 150);
    createWall(this, 600, 300, 40, 150);
    createBush(this, 400, 120, 240, 80, "bush_top");
    createBush(this, 400, 480, 240, 80, "bush_bottom");

    respawnText = this.add.text(400, 300, '', { fontSize: '48px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(200);

    setupVirtualJoysticks(this);

    // プレイヤー同期イベント
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id === socket.id && !player) addPlayer(this, players[id]);
            else if (id !== socket.id && !otherPlayers[id]) addOtherPlayers(this, players[id]);
        });
    });

    socket.on('playerDisconnected', (id) => {
        if (otherPlayers[id]) {
            if (otherPlayers[id].ui) otherPlayers[id].ui.destroy();
            if (otherPlayers[id].nameText) otherPlayers[id].nameText.destroy();
            otherPlayers[id].destroy();
            delete otherPlayers[id];
        }
    });

    socket.on('enemyShoot', (data) => createBullet(this, data.x, data.y, data.angle, data.charType, false));

    socket.on('playerMoved', (info) => {
        if (otherPlayers[info.id]) {
            otherPlayers[info.id].setPosition(info.x, info.y);
            otherPlayers[info.id].isInBush = info.isInBush;
            otherPlayers[info.id].bushId = info.bushId;
            updateUI(otherPlayers[info.id]);
        }
    });

    socket.on('hpUpdate', (data) => {
        let t = (data.id === socket.id) ? player : otherPlayers[data.id];
        if (t) {
            t.hp = data.hp;
            if (data.reveal) t.revealTimer = 60;
            updateUI(t);
            if (t.hp <= 0) {
                t.setVisible(false);
                if (t.nameText) t.nameText.setVisible(false);
                if (data.id === socket.id) startRespawnSequence(this);
            }
        }
    });

    socket.on('playerRespawned', (info) => {
        let t = (info.id === socket.id) ? player : otherPlayers[info.id];
        if (t) {
            t.hp = 100; t.setPosition(info.x, info.y); t.setVisible(true);
            if (info.id === socket.id) { respawnText.setText(''); ammo = 3; }
            updateUI(t);
        }
    });
}

function update() {
    if (player && player.visible) {
        player.body.setVelocity(0);
        if (isMoving) player.body.setVelocity(moveData.x * 200, moveData.y * 200);

        let bushId = null;
        this.physics.overlap(player, bushes, (p, b) => { bushId = b.bushId; });
        player.isInBush = !!bushId;
        player.bushId = bushId;
        player.setAlpha(player.isInBush ? 0.6 : 1);
        
        if (player.revealTimer > 0) player.revealTimer--;
        socket.emit('playerMovement', { x: player.x, y: player.y, isInBush: player.isInBush, bushId: player.bushId });
        updateUI(player);
    }
    Object.values(otherPlayers).forEach(op => { if(op.revealTimer > 0) op.revealTimer--; });
}

function updateUI(target) {
    target.ui.clear();
    if (!target.nameText) {
        target.nameText = target.scene.add.text(target.x, target.y - 50, target.playerName, { fontSize: '14px', fill: '#fff', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5);
    }
    target.nameText.setPosition(target.x, target.y - 50);

    let visible = true;
    if (target !== player && target.isInBush) {
        visible = false;
        if (player.isInBush && player.bushId === target.bushId) visible = true;
        if (target.revealTimer > 0) visible = true;
        if (Phaser.Math.Distance.Between(player.x, player.y, target.x, target.y) < 70) visible = true;
    }
    target.setVisible(visible);
    target.nameText.setVisible(visible);

    if (!visible || !target.visible) return;

    target.ui.fillStyle(0xc0392b); target.ui.fillRect(target.x - 20, target.y - 35, 40, 6);
    target.ui.fillStyle(0x2ecc71); target.ui.fillRect(target.x - 20, target.y - 35, (target.hp / 100) * 40, 6);
    if (target === player) {
        for (let i = 0; i < 3; i++) {
            target.ui.fillStyle(i < ammo ? 0xf1c40f : 0x555555);
            target.ui.fillRect(target.x - 20 + (i * 14), target.y - 25, 12, 4);
        }
    }
}

function setupVirtualJoysticks(scene) {
    moveJoy = scene.add.circle(120, 480, 60, 0x000, 0.2).setDepth(150);
    moveThumb = scene.add.circle(120, 480, 30, 0xccc, 0.5).setDepth(151);
    shootJoy = scene.add.circle(680, 480, 60, 0x000, 0.2).setDepth(150);
    shootThumb = scene.add.circle(680, 480, 30, 0xf00, 0.5).setDepth(151);
    scene.input.addPointer(2);
    scene.input.on('pointerdown', (p) => { 
        if(p.x < 400) moveThumb.setPosition(p.x, p.y); else shootThumb.setPosition(p.x, p.y); 
    });
    scene.input.on('pointermove', (p) => {
        if(p.x < 400 && p.isDown) {
            let a = Phaser.Math.Angle.Between(moveJoy.x, moveJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(moveJoy.x, moveJoy.y, p.x, p.y), 60);
            moveThumb.x = moveJoy.x + Math.cos(a) * d; moveThumb.y = moveJoy.y + Math.sin(a) * d;
            moveData = { x: Math.cos(a) * (d/60), y: Math.sin(a) * (d/60) }; isMoving = true;
        } else if(p.x >= 400 && p.isDown) {
            let a = Phaser.Math.Angle.Between(shootJoy.x, shootJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(shootJoy.x, shootJoy.y, p.x, p.y), 60);
            shootThumb.x = shootJoy.x + Math.cos(a) * d; shootThumb.y = shootJoy.y + Math.sin(a) * d;
            shootData = { angle: a, dist: d }; isAiming = true;
        }
    });
    scene.input.on('pointerup', (p) => {
        if(p.x < 400) { moveThumb.setPosition(120, 480); isMoving = false; }
        else {
            if(isAiming && shootData.dist > 20 && ammo > 0 && player.visible) {
                socket.emit('shoot', { id: socket.id, x: player.x, y: player.y, angle: shootData.angle, charType: player.charType });
                createBullet(scene, player.x, player.y, shootData.angle, player.charType, true);
                ammo--; startReload(scene);
            }
            shootThumb.setPosition(680, 480); isAiming = false;
        }
    });
}

function createWall(scene, x, y, w, h) {
    const wall = scene.add.rectangle(x, y, w, h, 0x95a5a6);
    walls.add(wall); scene.physics.add.existing(wall, true);
}
function createBush(scene, x, y, w, h, id) {
    const bush = scene.add.rectangle(x, y, w, h, 0x27ae60, 0.5);
    bush.bushId = id; bushes.add(bush);
}

function addPlayer(scene, info) {
    player = scene.add.circle(info.x, info.y, 20, info.charType === 'shelly' ? 0x3498db : 0x2ecc71);
    scene.physics.add.existing(player);
    // 【修正：画面外に出られないようにする】
    player.body.setCollideWorldBounds(true);
    player.charType = info.charType; player.playerName = info.name; player.hp = 100; player.revealTimer = 0;
    player.ui = scene.add.graphics().setDepth(10);
    scene.physics.add.collider(player, walls);
    scene.physics.add.overlap(player, enemyBullets, (p, b) => {
        if(p.visible) { b.destroy(); socket.emit('updateHP', { id: socket.id, hp: Math.max(0, p.hp - 15), reveal: true }); }
    });
}

function addOtherPlayers(scene, info) {
    const op = scene.add.circle(info.x, info.y, 20, info.charType === 'shelly' ? 0x3498db : 0x2ecc71);
    scene.physics.add.existing(op);
    op.id = info.id; op.playerName = info.name; op.hp = 100; op.revealTimer = 0;
    op.ui = scene.add.graphics().setDepth(10);
    otherPlayers[info.id] = op;
    scene.physics.add.overlap(bullets, op, (target, b) => { if(target.visible) b.destroy(); });
}

function createBullet(scene, x, y, angle, charType, isMine) {
    const group = isMine ? bullets : enemyBullets;
    const color = charType === 'shelly' ? 0xf1c40f : 0x2ecc71;
    if (charType === 'shelly') {
        [-0.2, 0, 0.2].forEach(off => {
            const b = scene.add.circle(x, y, 4, color);
            group.add(b); scene.physics.add.existing(b);
            scene.physics.velocityFromRotation(angle + off, 450, b.body.velocity);
            scene.physics.add.collider(b, walls, () => b.destroy());
            scene.time.delayedCall(500, () => b.destroy());
        });
    } else {
        const b = scene.add.circle(x, y, 9, color);
        group.add(b); scene.physics.add.existing(b);
        scene.physics.velocityFromRotation(angle, 280, b.body.velocity);
        scene.physics.add.collider(b, walls, () => { spawnExp(scene, b.x, b.y, color, group); b.destroy(); });
        scene.time.delayedCall(700, () => { if(b.active) spawnExp(scene, b.x, b.y, color, group); b.destroy(); });
    }
}

function spawnExp(s, x, y, c, g) {
    for(let i=0; i<6; i++) {
        let sb = s.add.circle(x, y, 4, c); g.add(sb); s.physics.add.existing(sb);
        s.physics.velocityFromRotation((Math.PI*2/6)*i, 300, sb.body.velocity);
        s.physics.add.collider(sb, walls, () => sb.destroy()); s.time.delayedCall(400, () => sb.destroy());
    }
}

function startReload(s) { if(isReloading || ammo >= 3) return; isReloading = true; s.time.addEvent({ delay: 1500, callback: () => { ammo++; isReloading = false; if(ammo < 3) startReload(s); } }); }

function startRespawnSequence(s) {
    if(respawnTimerInterval) clearInterval(respawnTimerInterval);
    let c = 3; respawnText.setText(`復活まで: ${c}`);
    respawnTimerInterval = setInterval(() => { c--; if(c > 0) respawnText.setText(`復活まで: ${c}`); else { clearInterval(respawnTimerInterval); respawnText.setText(''); socket.emit('respawnRequest'); } }, 1000);
}

window.launchGame = (type) => {
    const name = document.getElementById('username').value || "Guest";
    document.getElementById('setup').style.display = 'none';
    socket.emit('joinGame', { charType: type, name: name });
};
