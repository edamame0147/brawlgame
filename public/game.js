const config = {
    type: Phaser.AUTO,
    width: 800, height: 600,
    backgroundColor: '#34495e',
    scale: {
        mode: Phaser.Scale.FIT, // 画面に合わせてリサイズ
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    scene: { preload, create, update }
};

const game = new Phaser.Game(config);
let socket, player, bullets, enemyBullets, walls, bushes;
let otherPlayers = {};
let ammo = 3, isReloading = false, respawnText, respawnTimerInterval;

// スマホ操作用
let moveJoy, shootJoy; // ジョイスティックの背景
let moveThumb, shootThumb; // 動く丸
let isMoving = false, isAiming = false;
let moveData = { x: 0, y: 0 };
let shootData = { x: 0, y: 0 };

function preload() {}

function create() {
    socket = io();
    bullets = this.physics.add.group();
    enemyBullets = this.physics.add.group();
    walls = this.physics.add.staticGroup();
    bushes = this.physics.add.staticGroup();

    createWall(this, 200, 300, 40, 150);
    createWall(this, 600, 300, 40, 150);
    createBush(this, 400, 120, 240, 80, "bush_top");
    createBush(this, 400, 480, 240, 80, "bush_bottom");

    respawnText = this.add.text(400, 300, '', { fontSize: '48px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(200);

    // --- バーチャルパッド作成 ---
    setupVirtualJoysticks(this);

    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id === socket.id && !player) addPlayer(this, players[id]);
            else if (id !== socket.id && !otherPlayers[id]) addOtherPlayers(this, players[id]);
        });
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
        let target = (data.id === socket.id) ? player : otherPlayers[data.id];
        if (target) {
            target.hp = data.hp;
            if (data.reveal) target.revealTimer = 60; 
            updateUI(target);
            if (target.hp <= 0) {
                target.setVisible(false);
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
        const speed = 200;

        // スマホ移動
        if (isMoving) {
            player.body.setVelocity(moveData.x * speed, moveData.y * speed);
        }

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

// --- ジョイスティックの設定 ---
function setupVirtualJoysticks(scene) {
    const joyRadius = 60;
    const thumbRadius = 30;

    // 左：移動用
    moveJoy = scene.add.circle(120, 480, joyRadius, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    moveThumb = scene.add.circle(120, 480, thumbRadius, 0xcccccc, 0.5).setDepth(151).setScrollFactor(0);

    // 右：攻撃用
    shootJoy = scene.add.circle(680, 480, joyRadius, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    shootThumb = scene.add.circle(680, 480, thumbRadius, 0xff0000, 0.5).setDepth(151).setScrollFactor(0);

    scene.input.addPointer(2); // マルチタッチ対応（2本指まで）

    scene.input.on('pointerdown', (pointer) => {
        if (pointer.x < 400) moveThumb.setPosition(pointer.x, pointer.y); // タップした位置に移動（左）
        else shootThumb.setPosition(pointer.x, pointer.y); // タップした位置に移動（右）
    });

    scene.input.on('pointermove', (pointer) => {
        if (pointer.x < 400 && pointer.isDown) {
            // 移動計算
            let dist = Phaser.Math.Distance.Between(moveJoy.x, moveJoy.y, pointer.x, pointer.y);
            let angle = Phaser.Math.Angle.Between(moveJoy.x, moveJoy.y, pointer.x, pointer.y);
            let limit = Math.min(dist, joyRadius);
            moveThumb.x = moveJoy.x + Math.cos(angle) * limit;
            moveThumb.y = moveJoy.y + Math.sin(angle) * limit;
            moveData = { x: Math.cos(angle) * (limit/joyRadius), y: Math.sin(angle) * (limit/joyRadius) };
            isMoving = true;
        } else if (pointer.x >= 400 && pointer.isDown) {
            // 攻撃エイム
            let dist = Phaser.Math.Distance.Between(shootJoy.x, shootJoy.y, pointer.x, pointer.y);
            let angle = Phaser.Math.Angle.Between(shootJoy.x, shootJoy.y, pointer.x, pointer.y);
            let limit = Math.min(dist, joyRadius);
            shootThumb.x = shootJoy.x + Math.cos(angle) * limit;
            shootThumb.y = shootJoy.y + Math.sin(angle) * limit;
            shootData = { angle: angle, dist: dist };
            isAiming = true;
        }
    });

    scene.input.on('pointerup', (pointer) => {
        if (pointer.x < 400) {
            moveThumb.setPosition(moveJoy.x, moveJoy.y);
            isMoving = false;
        } else {
            // 指を離したときに発射（エイムがある程度動いていれば）
            if (isAiming && shootData.dist > 20 && ammo > 0 && player.visible) {
                handleAttack(scene, shootData.angle);
                ammo--;
                if (!isReloading) startReload(scene);
            }
            shootThumb.setPosition(shootJoy.x, shootJoy.y);
            isAiming = false;
        }
    });
}

// ---------------- 補助関数 ----------------

function createWall(scene, x, y, w, h) {
    const wall = scene.add.rectangle(x, y, w, h, 0x95a5a6);
    walls.add(wall);
    scene.physics.add.existing(wall, true);
}

function createBush(scene, x, y, w, h, id) {
    const bush = scene.add.rectangle(x, y, w, h, 0x27ae60, 0.5);
    bush.bushId = id;
    bushes.add(bush);
}

function addPlayer(scene, info) {
    player = scene.add.circle(info.x, info.y, 20, info.charType === 'shelly' ? 0x3498db : 0x2ecc71);
    scene.physics.add.existing(player);
    player.charType = info.charType; player.hp = 100; player.revealTimer = 0;
    player.ui = scene.add.graphics().setDepth(10);
    scene.physics.add.collider(player, walls);
    scene.physics.add.overlap(player, enemyBullets, (p, b) => {
        if(p.visible) {
            b.destroy(); 
            socket.emit('updateHP', { id: socket.id, hp: Math.max(0, p.hp - 15), reveal: true });
        }
    });
}

function addOtherPlayers(scene, info) {
    const op = scene.add.circle(info.x, info.y, 20, info.charType === 'shelly' ? 0x3498db : 0x2ecc71);
    scene.physics.add.existing(op);
    op.id = info.id; op.hp = 100; op.revealTimer = 0;
    op.ui = scene.add.graphics().setDepth(10);
    otherPlayers[info.id] = op;
    scene.physics.add.overlap(bullets, op, (target, b) => {
        if(target.visible) b.destroy();
    });
}

function updateUI(target) {
    target.ui.clear();
    let isVisible = true;
    if (target !== player && target.isInBush) {
        isVisible = false;
        if (player.isInBush && player.bushId === target.bushId) isVisible = true;
        if (target.revealTimer > 0) isVisible = true;
        if (Phaser.Math.Distance.Between(player.x, player.y, target.x, target.y) < 70) isVisible = true;
    }
    target.setVisible(isVisible);
    if (!isVisible || !target.visible) return;

    target.ui.fillStyle(0xc0392b); target.ui.fillRect(target.x - 20, target.y - 35, 40, 6);
    target.ui.fillStyle(0x2ecc71); target.ui.fillRect(target.x - 20, target.y - 35, (target.hp / 100) * 40, 6);
    if (target === player) {
        for (let i = 0; i < 3; i++) {
            target.ui.fillStyle(i < ammo ? 0xf1c40f : 0x555555);
            target.ui.fillRect(target.x - 20 + (i * 14), target.y - 25, 12, 4);
        }
    }
}

function handleAttack(scene, angle) {
    socket.emit('shoot', { id: socket.id, x: player.x, y: player.y, angle: angle, charType: player.charType });
    createBullet(scene, player.x, player.y, angle, player.charType, true);
}

function createBullet(scene, x, y, angle, charType, isMine) {
    const group = isMine ? bullets : enemyBullets;
    const color = charType === 'shelly' ? 0xf1c40f : 0x2ecc71;
    
    if (charType === 'shelly') {
        const spread = [ -0.2, 0, 0.2 ];
        spread.forEach(offset => {
            const b = scene.add.circle(x, y, 4, color);
            group.add(b); scene.physics.add.existing(b);
            scene.physics.velocityFromRotation(angle + offset, 450, b.body.velocity);
            scene.physics.add.collider(b, walls, () => b.destroy());
            scene.time.delayedCall(500, () => b.destroy());
        });
    } else {
        const b = scene.add.circle(x, y, 9, color);
        group.add(b); scene.physics.add.existing(b);
        scene.physics.velocityFromRotation(angle, 280, b.body.velocity);
        scene.physics.add.collider(b, walls, () => {
            spawnSpikeExplosion(scene, b.x, b.y, color, group);
            b.destroy();
        });
        scene.time.delayedCall(700, () => {
            if (b.active) spawnSpikeExplosion(scene, b.x, b.y, color, group);
            b.destroy();
        });
    }
}

function spawnSpikeExplosion(scene, x, y, color, group) {
    for (let i = 0; i < 6; i++) {
        const sb = scene.add.circle(x, y, 4, color);
        group.add(sb); scene.physics.add.existing(sb);
        scene.physics.velocityFromRotation((Math.PI * 2 / 6) * i, 300, sb.body.velocity);
        scene.physics.add.collider(sb, walls, () => sb.destroy());
        scene.time.delayedCall(400, () => sb.destroy());
    }
}

function startReload(scene) {
    isReloading = true;
    scene.time.addEvent({ delay: 1500, callback: () => {
        ammo++; updateUI(player);
        if (ammo < 3) startReload(scene); else isReloading = false;
    }});
}

function startRespawnSequence(scene) {
    if (respawnTimerInterval) clearInterval(respawnTimerInterval);
    let count = 3; 
    respawnText.setText(`復活まで: ${count}`);
    respawnTimerInterval = setInterval(() => {
        count--; 
        if (count > 0) respawnText.setText(`復活まで: ${count}`);
        else {
            clearInterval(respawnTimerInterval);
            respawnTimerInterval = null;
            respawnText.setText('');
            socket.emit('respawnRequest');
        }
    }, 1000);
}

window.launchGame = (type) => socket.emit('joinGame', { charType: type });