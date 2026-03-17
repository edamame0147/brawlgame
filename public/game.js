const MAP_SIZE = 2000; // マップの広さ

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

// ジョイスティック用
let moveJoy, shootJoy, moveThumb, shootThumb;
let isMoving = false, isAiming = false;
let moveData = { x: 0, y: 0 }, shootData = { angle: 0, dist: 0 };

function preload() {}

function create() {
    socket = io();
    
    // 物理世界の限界を設定
    this.physics.world.setBounds(0, 0, MAP_SIZE, MAP_SIZE);

    // 地面のグリッド線を描画
    let grid = this.add.graphics();
    grid.lineStyle(2, 0x2c3e50, 0.5);
    for (let i = 0; i <= MAP_SIZE; i += 100) {
        grid.moveTo(i, 0); grid.lineTo(i, MAP_SIZE);
        grid.moveTo(0, i); grid.lineTo(MAP_SIZE, i);
    }
    grid.strokePath();

    bullets = this.physics.add.group();
    enemyBullets = this.physics.add.group();
    walls = this.physics.add.staticGroup();
    bushes = this.physics.add.staticGroup();

    // マップ配置（外壁と障害物）
    createWall(this, MAP_SIZE/2, 10, MAP_SIZE, 20); // 上壁
    createWall(this, MAP_SIZE/2, MAP_SIZE-10, MAP_SIZE, 20); // 下壁
    createWall(this, 10, MAP_SIZE/2, 20, MAP_SIZE); // 左壁
    createWall(this, MAP_SIZE-10, MAP_SIZE/2, 20, MAP_SIZE); // 右壁

    // ランダムな障害物とブッシュ
    createWall(this, 800, 1000, 40, 300);
    createWall(this, 1200, 1000, 40, 300);
    createBush(this, 1000, 800, 400, 100, "center_bush");

    // UIテキストをカメラに固定
    respawnText = this.add.text(400, 300, '', { fontSize: '48px', fill: '#fff', fontStyle: 'bold' })
        .setOrigin(0.5).setDepth(200).setScrollFactor(0);

    setupVirtualJoysticks(this);

    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id === socket.id && !player) {
                addPlayer(this, players[id]);
                // カメラをプレイヤーに追従させる
                this.cameras.main.startFollow(player, true, 0.1, 0.1);
                this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
            }
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
        let t = (data.id === socket.id) ? player : otherPlayers[data.id];
        if (t) {
            t.hp = data.hp;
            if (data.reveal) t.revealTimer = 60;
            updateUI(t);
            if (t.hp <= 0) {
                t.setVisible(false);
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
        if (isMoving) player.body.setVelocity(moveData.x * 220, moveData.y * 220);

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

function setupVirtualJoysticks(scene) {
    const r = 60;
    moveJoy = scene.add.circle(120, 480, r, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    moveThumb = scene.add.circle(120, 480, 30, 0xcccccc, 0.5).setDepth(151).setScrollFactor(0);
    shootJoy = scene.add.circle(680, 480, r, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    shootThumb = scene.add.circle(680, 480, 30, 0xff0000, 0.5).setDepth(151).setScrollFactor(0);

    scene.input.addPointer(2);
    scene.input.on('pointerdown', (p) => {
        if (p.x < 400) moveThumb.setPosition(p.x, p.y);
        else shootThumb.setPosition(p.x, p.y);
    });

    scene.input.on('pointermove', (p) => {
        if (!p.isDown) return;
        if (p.x < 400) {
            let angle = Phaser.Math.Angle.Between(moveJoy.x, moveJoy.y, p.x, p.y);
            let dist = Math.min(Phaser.Math.Distance.Between(moveJoy.x, moveJoy.y, p.x, p.y), r);
            moveThumb.setPosition(moveJoy.x + Math.cos(angle)*dist, moveJoy.y + Math.sin(angle)*dist);
            moveData = { x: Math.cos(angle)*(dist/r), y: Math.sin(angle)*(dist/r) };
            isMoving = true;
        } else {
            let angle = Phaser.Math.Angle.Between(shootJoy.x, shootJoy.y, p.x, p.y);
            let dist = Math.min(Phaser.Math.Distance.Between(shootJoy.x, shootJoy.y, p.x, p.y), r);
            shootThumb.setPosition(shootJoy.x + Math.cos(angle)*dist, shootJoy.y + Math.sin(angle)*dist);
            shootData = { angle: angle, dist: dist };
            isAiming = true;
        }
    });

    scene.input.on('pointerup', (p) => {
        if (p.x < 400) { moveThumb.setPosition(120, 480); isMoving = false; }
        else {
            if (isAiming && shootData.dist > 20 && ammo > 0 && player.visible) {
                handleAttack(scene, shootData.angle);
                ammo--; if (!isReloading) startReload(scene);
            }
            shootThumb.setPosition(680, 480); isAiming = false;
        }
    });
}

function updateUI(target) {
    target.ui.clear();
    let vis = true;
    if (target !== player && target.isInBush) {
        vis = false;
        if (player.isInBush && player.bushId === target.bushId) vis = true;
        if (target.revealTimer > 0) vis = true;
        if (Phaser.Math.Distance.Between(player.x, player.y, target.x, target.y) < 70) vis = true;
    }
    target.setVisible(vis);
    if (!vis || !target.visible) return;

    target.ui.fillStyle(0xc0392b); target.ui.fillRect(target.x - 20, target.y - 35, 40, 6);
    target.ui.fillStyle(0x2ecc71); target.ui.fillRect(target.x - 20, target.y - 35, (target.hp / 100) * 40, 6);
    if (target === player) {
        for (let i = 0; i < 3; i++) {
            target.ui.fillStyle(i < ammo ? 0xf1c40f : 0x555555);
            target.ui.fillRect(target.x - 20 + (i * 14), target.y - 25, 12, 4);
        }
    }
}

// 共通パーツ
function createWall(s, x, y, w, h) {
    let wall = s.add.rectangle(x, y, w, h, 0x95a5a6);
    walls.add(wall); s.physics.add.existing(wall, true);
}
function createBush(s, x, y, w, h, id) {
    let bush = s.add.rectangle(x, y, w, h, 0x27ae60, 0.5);
    bush.bushId = id; bushes.add(bush);
}
function addPlayer(s, info) {
    player = s.add.circle(info.x, info.y, 20, info.charType === 'shelly' ? 0x3498db : 0x2ecc71);
    s.physics.add.existing(player);
    player.charType = info.charType; player.hp = 100; player.revealTimer = 0;
    player.ui = s.add.graphics().setDepth(10);
    player.body.setCollideWorldBounds(true);
    s.physics.add.collider(player, walls);
    s.physics.add.overlap(player, enemyBullets, (p, b) => {
        if(p.visible) { b.destroy(); socket.emit('updateHP', { id: socket.id, hp: Math.max(0, p.hp - 15), reveal: true }); }
    });
}
function addOtherPlayers(s, info) {
    let op = s.add.circle(info.x, info.y, 20, info.charType === 'shelly' ? 0x3498db : 0x2ecc71);
    s.physics.add.existing(op); op.id = info.id; op.hp = 100; op.revealTimer = 0;
    op.ui = s.add.graphics().setDepth(10); otherPlayers[info.id] = op;
    s.physics.add.overlap(bullets, op, (t, b) => { if(t.visible) b.destroy(); });
}
function handleAttack(s, angle) {
    socket.emit('shoot', { id: socket.id, x: player.x, y: player.y, angle: angle, charType: player.charType });
    createBullet(s, player.x, player.y, angle, player.charType, true);
}
function createBullet(s, x, y, angle, charType, isMine) {
    let group = isMine ? bullets : enemyBullets;
    let color = charType === 'shelly' ? 0xf1c40f : 0x2ecc71;
    if (charType === 'shelly') {
        [-0.2, 0, 0.2].forEach(off => {
            let b = s.add.circle(x, y, 4, color); group.add(b); s.physics.add.existing(b);
            s.physics.velocityFromRotation(angle + off, 450, b.body.velocity);
            s.physics.add.collider(b, walls, () => b.destroy());
            s.time.delayedCall(500, () => b.destroy());
        });
    } else {
        let b = s.add.circle(x, y, 9, color); group.add(b); s.physics.add.existing(b);
        s.physics.velocityFromRotation(angle, 280, b.body.velocity);
        s.physics.add.collider(b, walls, () => { explode(s, b.x, b.y, color, group); b.destroy(); });
        s.time.delayedCall(700, () => { if (b.active) explode(s, b.x, b.y, color, group); b.destroy(); });
    }
}
function explode(s, x, y, color, group) {
    for (let i = 0; i < 6; i++) {
        let sb = s.add.circle(x, y, 4, color); group.add(sb); s.physics.add.existing(sb);
        s.physics.velocityFromRotation((Math.PI * 2 / 6) * i, 300, sb.body.velocity);
        s.physics.add.collider(sb, walls, () => sb.destroy());
        s.time.delayedCall(400, () => sb.destroy());
    }
}
function startReload(s) {
    isReloading = true;
    s.time.addEvent({ delay: 1500, callback: () => {
        ammo++; updateUI(player); if (ammo < 3) startReload(s); else isReloading = false;
    }});
}
function startRespawnSequence(s) {
    if (respawnTimerInterval) clearInterval(respawnTimerInterval);
    let count = 3; respawnText.setText(`復活まで: ${count}`);
    respawnTimerInterval = setInterval(() => {
        count--; if (count > 0) respawnText.setText(`復活まで: ${count}`);
        else { clearInterval(respawnTimerInterval); respawnTimerInterval = null; respawnText.setText(''); socket.emit('respawnRequest'); }
    }, 1000);
}
window.launchGame = (type) => socket.emit('joinGame', { charType: type });
