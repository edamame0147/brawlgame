const MAP_SIZE = 1200;
const TILE_SIZE = 60; 

const MAP_DESIGN = [
    [1,1,1,0,0,0,0,1,0,0,0,0,1,1,1],
    [1,0,0,0,2,2,0,1,0,2,2,0,0,0,1],
    [1,0,1,0,2,2,0,0,0,2,2,0,1,0,1],
    [0,0,1,0,0,0,1,1,1,0,0,0,1,0,0],
    [0,2,2,0,0,0,0,0,0,0,0,0,2,2,0],
    [0,2,2,0,1,1,0,1,0,1,1,0,2,2,0],
    [0,0,0,0,1,0,0,0,0,0,1,0,0,0,0],
    [1,1,0,0,0,0,2,2,2,0,0,0,0,1,1],
    [0,0,0,0,1,0,0,0,0,0,1,0,0,0,0],
    [0,2,2,0,1,1,0,1,0,1,1,0,2,2,0],
    [0,2,2,0,0,0,0,0,0,0,0,0,2,2,0],
    [0,0,1,0,0,0,1,1,1,0,0,0,1,0,0],
    [1,0,1,0,2,2,0,0,0,2,2,0,1,0,1],
    [1,0,0,0,2,2,0,1,0,2,2,0,0,0,1],
    [1,1,1,0,0,0,0,1,0,0,0,0,1,1,1],
];

const config = {
    type: Phaser.AUTO,
    width: 800, 
    height: 600,
    backgroundColor: '#34495e',
    parent: 'game-container',
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    scene: { preload, create, update }
};

const game = new Phaser.Game(config);
let socket, player, bullets, enemyBullets, walls, bushes;
let otherPlayers = {};
let ammo = 3, isReloading = false, respawnText, respawnTimerInterval;
let moveJoy, shootJoy, moveThumb, shootThumb;
let isMoving = false, isAiming = false, moveData = { x: 0, y: 0 }, shootData = { angle: 0, dist: 0 };

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

    const offsetX = (MAP_SIZE - (MAP_DESIGN[0].length * TILE_SIZE)) / 2;
    const offsetY = (MAP_SIZE - (MAP_DESIGN.length * TILE_SIZE)) / 2;
    for (let r = 0; r < MAP_DESIGN.length; r++) {
        for (let c = 0; c < MAP_DESIGN[r].length; c++) {
            let x = offsetX + c * TILE_SIZE + TILE_SIZE/2;
            let y = offsetY + r * TILE_SIZE + TILE_SIZE/2;
            if (MAP_DESIGN[r][c] === 1) createWall(this, x, y, TILE_SIZE-4, TILE_SIZE-4);
            if (MAP_DESIGN[r][c] === 2) createBush(this, x, y, TILE_SIZE, TILE_SIZE, `bush_${r}_${c}`);
        }
    }

    respawnText = this.add.text(400, 300, '', { fontSize: '48px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(200).setScrollFactor(0);
    setupVirtualJoysticks(this);

    // Socket Events
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id === socket.id && !player) {
                addPlayer(this, players[id]);
                this.cameras.main.startFollow(player, true, 0.1, 0.1);
            }
            else if (id !== socket.id && !otherPlayers[id]) addOtherPlayers(this, players[id]);
        });
    });

    socket.on('enemyShoot', data => createBullet(this, data.x, data.y, data.angle, data.charType, false, data.id));
    
    socket.on('playerMoved', info => {
        if (otherPlayers[info.id]) {
            otherPlayers[info.id].setPosition(info.x, info.y);
            otherPlayers[info.id].isInBush = info.isInBush;
            otherPlayers[info.id].bushId = info.bushId;
        }
    });

    socket.on('hpUpdate', data => {
        let t = (data.id === socket.id) ? player : otherPlayers[data.id];
        if (t) {
            t.hp = data.hp;
            if (data.reveal) t.revealTimer = 60;
            if (t.hp <= 0 && t.visible) {
                t.setVisible(false);
                if (data.id === socket.id) startRespawnSequence(this);
            }
        }
    });

    socket.on('playerRespawned', info => {
        let t = (info.id === socket.id) ? player : otherPlayers[info.id];
        if (t) {
            t.hp = 100; t.setPosition(info.x, info.y); t.setVisible(true);
            if (info.id === socket.id) { respawnText.setText(''); ammo = 3; }
        }
    });

    socket.on('playerDisconnected', id => {
        if (otherPlayers[id]) {
            if (otherPlayers[id].pinContainer) otherPlayers[id].pinContainer.destroy();
            otherPlayers[id].ui.destroy();
            otherPlayers[id].nameTag.destroy();
            otherPlayers[id].destroy();
            delete otherPlayers[id];
        }
    });

    socket.on('updateRanking', playersData => {
        const list = document.getElementById('rankingList');
        const sorted = Object.values(playersData).sort((a, b) => b.kills - a.kills);
        list.innerHTML = sorted.map(p => `<div>${p.userName}: ${p.kills}</div>`).join('');
    });

    socket.on('showPin', data => {
        let t = (data.id === socket.id) ? player : otherPlayers[data.id];
        if (t) displayPin(this, t, data.emoji);
    });
}

function update() {
    if (player && player.visible) {
        player.body.setVelocity(0);
        let speed = (player.charType === 'edgar') ? 270 : 220;
        if (isMoving) player.body.setVelocity(moveData.x * speed, moveData.y * speed);

        let bushId = null;
        this.physics.overlap(player, bushes, (p, b) => { bushId = b.bushId; });
        player.isInBush = !!bushId;
        player.bushId = bushId;
        player.setAlpha(player.isInBush ? 0.6 : 1);
        if (player.revealTimer > 0) player.revealTimer--;

        socket.emit('playerMovement', { x: player.x, y: player.y, isInBush: player.isInBush, bushId: player.bushId });
        updateUI(player);
        if (player.pinContainer) player.pinContainer.setPosition(player.x, player.y - 75);
    }
    Object.values(otherPlayers).forEach(op => {
        if (op.revealTimer > 0) op.revealTimer--;
        updateUI(op);
        if (op.pinContainer) op.pinContainer.setPosition(op.x, op.y - 75);
    });
}

function addPlayer(s, info) {
    let color = (info.charType === 'shelly') ? 0x3498db : (info.charType === 'spike' ? 0x2ecc71 : 0x9b59b6);
    player = s.add.circle(info.x, info.y, 20, color);
    s.physics.add.existing(player);
    player.charType = info.charType; player.hp = 100; player.revealTimer = 0;
    player.ui = s.add.graphics().setDepth(10);
    player.nameTag = s.add.text(info.x, info.y - 55, info.userName, { fontSize: '14px', fill: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    player.body.setCollideWorldBounds(true);
    s.physics.add.collider(player, walls);
    s.physics.add.overlap(player, enemyBullets, (p, b) => {
        if(p.visible && p.hp > 0) { 
            let dmg = (b.charType === 'shelly') ? 25 : (b.charType === 'spike' ? 20 : 15);
            b.destroy();
            socket.emit('updateHP', { id: socket.id, hp: Math.max(0, p.hp - dmg), reveal: true, attackerId: b.shooterId }); 
        }
    });
}

function addOtherPlayers(s, info) {
    let color = (info.charType === 'shelly') ? 0x3498db : (info.charType === 'spike' ? 0x2ecc71 : 0x9b59b6);
    let op = s.add.circle(info.x, info.y, 20, color);
    s.physics.add.existing(op); op.id = info.id; op.hp = 100; op.revealTimer = 0;
    op.ui = s.add.graphics().setDepth(10);
    op.nameTag = s.add.text(info.x, info.y - 55, info.userName, { fontSize: '14px', fill: '#ffffff' }).setOrigin(0.5).setDepth(10);
    otherPlayers[info.id] = op;
    s.physics.add.overlap(bullets, op, (target, b) => { 
        if(target.visible && player.charType === 'edgar' && target.hp > 0) { 
            player.hp = Math.min(100, player.hp + 3);
            socket.emit('updateHP', { id: socket.id, hp: player.hp, reveal: false });
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
        if (Phaser.Math.Distance.Between(player.x, player.y, target.x, target.y) < 80) vis = true;
    }
    target.setVisible(vis); target.nameTag.setVisible(vis);
    if (!vis || !target.visible) return;

    target.nameTag.setPosition(target.x, target.y - 55);
    target.ui.fillStyle(0xc0392b); target.ui.fillRect(target.x - 20, target.y - 35, 40, 6);
    target.ui.fillStyle(0x2ecc71); target.ui.fillRect(target.x - 20, target.y - 35, (target.hp / 100) * 40, 6);
    if (target === player) {
        for (let i = 0; i < 3; i++) {
            target.ui.fillStyle(i < ammo ? 0xf1c40f : 0x555555);
            target.ui.fillRect(target.x - 20 + (i * 14), target.y - 25, 12, 4);
        }
    }
}

function createBullet(s, x, y, angle, charType, isMine, shooterId) {
    let group = isMine ? bullets : enemyBullets;
    if (charType === 'shelly') {
        [-0.2, 0, 0.2].forEach(off => {
            let b = s.add.circle(x, y, 5, 0xf1c40f); b.charType = charType; b.shooterId = shooterId;
            group.add(b); s.physics.add.existing(b);
            s.physics.velocityFromRotation(angle + off, 450, b.body.velocity);
            s.physics.add.collider(b, walls, () => b.destroy());
            s.time.delayedCall(450, () => { if(b.active) b.destroy(); });
        });
    } else if (charType === 'spike') {
        let b = s.add.circle(x, y, 9, 0x2ecc71); b.charType = charType; b.shooterId = shooterId;
        group.add(b); s.physics.add.existing(b);
        s.physics.velocityFromRotation(angle, 280, b.body.velocity);
        s.physics.add.collider(b, walls, () => { explode(s, b.x, b.y, 0x2ecc71, group, shooterId); b.destroy(); });
        s.time.delayedCall(700, () => { if (b.active) { explode(s, b.x, b.y, 0x2ecc71, group, shooterId); b.destroy(); } });
    } else if (charType === 'edgar') {
        let b = s.add.rectangle(x + Math.cos(angle)*35, y + Math.sin(angle)*35, 45, 45, 0xffffff, 0.4);
        b.charType = charType; b.shooterId = shooterId;
        group.add(b); s.physics.add.existing(b);
        s.physics.add.collider(b, walls, () => b.destroy());
        s.time.delayedCall(120, () => { if(b.active) b.destroy(); });
    }
}

function explode(s, x, y, color, group, shooterId) {
    for (let i = 0; i < 6; i++) {
        let sb = s.add.circle(x, y, 5, color); sb.charType = 'spike'; sb.shooterId = shooterId;
        group.add(sb); s.physics.add.existing(sb);
        s.physics.velocityFromRotation((Math.PI * 2 / 6) * i, 300, sb.body.velocity);
        s.physics.add.collider(sb, walls, () => sb.destroy());
        s.time.delayedCall(350, () => { if(sb.active) sb.destroy(); });
    }
}

function displayPin(scene, target, emoji) {
    if (target.pinContainer) target.pinContainer.destroy();
    let bg = scene.add.graphics();
    bg.fillStyle(0xffffff, 0.9);
    bg.fillRoundedRect(-20, -20, 40, 40, 10);
    let txt = scene.add.text(0, 0, emoji, { fontSize: '24px' }).setOrigin(0.5);
    target.pinContainer = scene.add.container(target.x, target.y - 75, [bg, txt]).setDepth(100);
    scene.time.delayedCall(2000, () => { if (target.pinContainer) target.pinContainer.destroy(); });
}

function handleAttack(s, angle) {
    socket.emit('shoot', { id: socket.id, x: player.x, y: player.y, angle, charType: player.charType });
    createBullet(s, player.x, player.y, angle, player.charType, true, socket.id);
}

function setupVirtualJoysticks(scene) {
    const r = 65;
    moveJoy = scene.add.circle(130, 470, r, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    moveThumb = scene.add.circle(130, 470, 35, 0xcccccc, 0.5).setDepth(151).setScrollFactor(0);
    shootJoy = scene.add.circle(670, 470, r, 0x000000, 0.3).setDepth(150).setScrollFactor(0);
    shootThumb = scene.add.circle(670, 470, 35, 0xff0000, 0.5).setDepth(151).setScrollFactor(0);
    scene.input.addPointer(2);
    scene.input.on('pointerdown', p => { if (p.x < 400) moveThumb.setPosition(p.x, p.y); else shootThumb.setPosition(p.x, p.y); });
    scene.input.on('pointermove', p => {
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
            shootData = { angle, dist }; isAiming = true;
        }
    });
    scene.input.on('pointerup', p => {
        if (p.x < 400) { moveThumb.setPosition(130, 470); isMoving = false; }
        else {
            if (isAiming && shootData.dist > 20 && ammo > 0 && player.visible) {
                handleAttack(scene, shootData.angle); ammo--; if (!isReloading) startReload(scene);
            }
            shootThumb.setPosition(670, 470); isAiming = false;
        }
    });
}

function createWall(s, x, y, w, h) { let wall = s.add.rectangle(x, y, w, h, 0x95a5a6); walls.add(wall); s.physics.add.existing(wall, true); }
function createBush(s, x, y, w, h, id) { let bush = s.add.rectangle(x, y, w, h, 0x27ae60, 0.5); bush.bushId = id; bushes.add(bush); }
function startReload(s) {
    isReloading = true;
    s.time.addEvent({ delay: 1200, callback: () => { ammo++; updateUI(player); if (ammo < 3) startReload(s); else isReloading = false; }});
}
function startRespawnSequence(s) {
    let count = 3; respawnText.setText(`復活まで: ${count}`);
    respawnTimerInterval = setInterval(() => {
        count--; if (count > 0) respawnText.setText(`復活まで: ${count}`);
        else { clearInterval(respawnTimerInterval); respawnText.setText(''); socket.emit('respawnRequest'); }
    }, 1000);
}
window.launchGame = type => {
    const name = document.getElementById('nameInput').value || 'No Name';
    document.getElementById('overlay').style.display = 'none';
    socket.emit('joinGame', { charType: type, userName: name });
};
window.sendPin = emoji => { if (socket && player && player.visible) socket.emit('sendPin', { id: socket.id, emoji }); };
