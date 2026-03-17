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
let socket, player, bullets, enemyBullets, walls, bushes;
let otherPlayers = {};
let ammo = 3, isReloading = false, respawnText, isAttackingLocked = false;
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

    respawnText = this.add.text(400, 300, '', { fontSize: '48px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(200).setScrollFactor(0);
    setupVirtualJoysticks(this);

    socket.on('currentPlayers', (ps) => {
        Object.keys(ps).forEach(id => {
            if (id === socket.id && !player) {
                addPlayer(this, ps[id]);
                this.cameras.main.startFollow(player, true, 0.1, 0.1);
            } else if (id !== socket.id && !otherPlayers[id]) addOtherPlayers(this, ps[id]);
        });
    });

    socket.on('enemyShoot', data => createBullet(this, data.x, data.y, data.angle, data.charType, false, data.id));
    socket.on('playerMoved', info => { if(otherPlayers[info.id]) { otherPlayers[info.id].setPosition(info.x, info.y); otherPlayers[info.id].isInBush = info.isInBush; otherPlayers[info.id].bushId = info.bushId; }});
    socket.on('hpUpdate', data => {
        let t = (data.id === socket.id) ? player : otherPlayers[data.id];
        if (t) { t.hp = data.hp; if (data.reveal) t.revealTimer = 60; if (t.hp <= 0 && t.visible) { t.setVisible(false); if (data.id === socket.id) startRespawnSequence(this); } }
    });
    socket.on('playerRespawned', info => {
        let t = (info.id === socket.id) ? player : otherPlayers[info.id];
        if (t) { t.hp = 100; t.setPosition(info.x, info.y); t.setVisible(true); if (info.id === socket.id) { respawnText.setText(''); ammo = 3; isAttackingLocked = false; } }
    });
    socket.on('playerDisconnected', id => { if(otherPlayers[id]) { if(otherPlayers[id].pinContainer) otherPlayers[id].pinContainer.destroy(); otherPlayers[id].ui.destroy(); otherPlayers[id].nameTag.destroy(); otherPlayers[id].destroy(); delete otherPlayers[id]; }});
    socket.on('updateRanking', data => {
        const list = document.getElementById('rankingList');
        const sorted = Object.values(data).sort((a,b) => b.kills - a.kills);
        list.innerHTML = sorted.map(p => `<div>${p.userName}: ${p.kills}</div>`).join('');
    });
    socket.on('showPin', data => { let t = (data.id === socket.id) ? player : otherPlayers[data.id]; if(t) displayPin(this, t, data.emoji); });
}

function update() {
    if (player && player.visible) {
        player.body.setVelocity(0);
        let speeds = { shelly: 220, spike: 220, edgar: 270, frank: 160 };
        let speed = speeds[player.charType] || 220;

        // フランケンの攻撃中硬直チェック
        if (isMoving && !isAttackingLocked) {
            player.body.setVelocity(moveData.x * speed, moveData.y * speed);
        }

        let bId = null;
        this.physics.overlap(player, bushes, (p, b) => bId = b.bushId);
        player.isInBush = !!bId; player.bushId = bId;
        player.setAlpha(player.isInBush ? 0.6 : 1);
        if (player.revealTimer > 0) player.revealTimer--;

        socket.emit('playerMovement', { x: player.x, y: player.y, isInBush: player.isInBush, bushId: player.bushId });
        updateUI(player);
        if (player.pinContainer) player.pinContainer.setPosition(player.x, player.y - 75);
    }
    Object.values(otherPlayers).forEach(op => { if(op.revealTimer > 0) op.revealTimer--; updateUI(op); if(op.pinContainer) op.pinContainer.setPosition(op.x, op.y - 75); });
}

function addPlayer(s, info) {
    let colors = { shelly: 0x3498db, spike: 0x2ecc71, edgar: 0x9b59b6, frank: 0x795548 };
    player = s.add.circle(info.x, info.y, 20, colors[info.charType]);
    s.physics.add.existing(player);
    player.charType = info.charType; player.hp = 100; player.revealTimer = 0;
    player.ui = s.add.graphics().setDepth(10);
    player.nameTag = s.add.text(info.x, info.y - 55, info.userName, { fontSize: '14px', fill: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    player.body.setCollideWorldBounds(true);
    s.physics.add.collider(player, walls);
    s.physics.add.overlap(player, enemyBullets, (p, b) => {
        if(p.visible && p.hp > 0) { 
            let dmgs = { shelly: 25, spike: 20, edgar: 15, frank: 35 };
            let d = dmgs[b.charType] || 15; b.destroy();
            socket.emit('updateHP', { id: socket.id, hp: Math.max(0, p.hp - d), reveal: true, attackerId: b.shooterId }); 
        }
    });
}

function addOtherPlayers(s, info) {
    let colors = { shelly: 0x3498db, spike: 0x2ecc71, edgar: 0x9b59b6, frank: 0x795548 };
    let op = s.add.circle(info.x, info.y, 20, colors[info.charType]);
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

function createBullet(s, x, y, angle, charType, isMine, shooterId) {
    let group = isMine ? bullets : enemyBullets;
    let createB = (sx, sy, ang, spd, life, size, color, isRect) => {
        let b = isRect ? s.add.rectangle(sx, sy, size, size, color) : s.add.circle(sx, sy, size, color);
        group.add(b); s.physics.add.existing(b);
        s.physics.velocityFromRotation(ang, spd, b.body.velocity);
        // 壁衝突時に即座に消去する設定
        s.physics.add.collider(b, walls, () => b.destroy());
        s.time.delayedCall(life, () => { if(b.active) b.destroy(); });
        b.charType = charType; b.shooterId = shooterId;
        return b;
    };

    if (charType === 'frank') {
        for(let i = -2; i <= 2; i++) createB(x, y, angle + (i * 0.2), 400, 350, 25, 0x795548, true);
    } else if (charType === 'shelly') {
        [-0.2, 0, 0.2].forEach(off => createB(x, y, angle + off, 450, 450, 5, 0xf1c40f, false));
    } else if (charType === 'spike') {
        let b = createB(x, y, angle, 280, 700, 9, 0x2ecc71, false);
        s.physics.add.collider(b, walls, () => { explode(s, b.x, b.y, 0x2ecc71, group, shooterId); b.destroy(); });
        s.time.delayedCall(700, () => { if (b.active) { explode(s, b.x, b.y, 0x2ecc71, group, shooterId); b.destroy(); } });
    } else if (charType === 'edgar') {
        createB(x + Math.cos(angle)*35, y + Math.sin(angle)*35, angle, 0, 120, 45, 0xffffff, true);
    }
}

function handleAttack(s, angle) {
    if (player.charType === 'frank') {
        isAttackingLocked = true;
        s.time.delayedCall(400, () => isAttackingLocked = false); // 0.4秒間足が止まる
    }
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
            let a = Phaser.Math.Angle.Between(moveJoy.x, moveJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(moveJoy.x, moveJoy.y, p.x, p.y), r);
            moveThumb.setPosition(moveJoy.x + Math.cos(a)*d, moveJoy.y + Math.sin(a)*d);
            moveData = { x: Math.cos(a)*(d/r), y: Math.sin(a)*(d/r) }; isMoving = true;
        } else {
            let a = Phaser.Math.Angle.Between(shootJoy.x, shootJoy.y, p.x, p.y);
            let d = Math.min(Phaser.Math.Distance.Between(shootJoy.x, shootJoy.y, p.x, p.y), r);
            shootThumb.setPosition(shootJoy.x + Math.cos(a)*d, shootJoy.y + Math.sin(a)*d);
            shootData = { angle: a, dist: d }; isAiming = true;
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

function updateUI(t) {
    t.ui.clear(); let vis = true;
    if (t !== player && t.isInBush) {
        vis = false;
        if (player.isInBush && player.bushId === t.bushId) vis = true;
        if (t.revealTimer > 0) vis = true;
        if (Phaser.Math.Distance.Between(player.x, player.y, t.x, t.y) < 80) vis = true;
    }
    t.setVisible(vis); t.nameTag.setVisible(vis);
    if (!vis || !t.visible) return;
    t.nameTag.setPosition(t.x, t.y - 55);
    t.ui.fillStyle(0xc0392b); t.ui.fillRect(t.x-20, t.y-35, 40, 6);
    t.ui.fillStyle(0x2ecc71); t.ui.fillRect(t.x-20, t.y-35, (t.hp/100)*40, 6);
    if (t === player) { for (let i=0; i<3; i++) { t.ui.fillStyle(i < ammo ? 0xf1c40f : 0x555555); t.ui.fillRect(t.x-20+(i*14), t.y-25, 12, 4); } }
}

function startReload(s) { isReloading = true; s.time.addEvent({ delay: 1200, callback: () => { ammo++; updateUI(player); if (ammo < 3) startReload(s); else isReloading = false; }}); }
function startRespawnSequence(s) {
    let c = 3; respawnText.setText(`復活まで: ${c}`);
    let i = setInterval(() => { c--; if (c>0) respawnText.setText(`復活まで: ${c}`); else { clearInterval(i); socket.emit('respawnRequest'); } }, 1000);
}
function explode(s, x, y, col, grp, sid) { for(let i=0; i<6; i++) { let sb = s.add.circle(x, y, 5, col); grp.add(sb); s.physics.add.existing(sb); s.physics.velocityFromRotation((Math.PI*2/6)*i, 300, sb.body.velocity); s.physics.add.collider(sb, walls, ()=>sb.destroy()); s.time.delayedCall(350, ()=>sb.active && sb.destroy()); sb.charType='spike'; sb.shooterId=sid; } }
function displayPin(s, t, e) { if(t.pinContainer) t.pinContainer.destroy(); let bg = s.add.graphics().fillStyle(0xffffff, 0.9).fillRoundedRect(-20, -20, 40, 40, 10); let txt = s.add.text(0,0,e,{fontSize:'24px'}).setOrigin(0.5); t.pinContainer = s.add.container(t.x, t.y-75, [bg, txt]).setDepth(100); s.time.delayedCall(2000, ()=>t.pinContainer && t.pinContainer.destroy()); }
window.launchGame = type => { document.getElementById('overlay').style.display = 'none'; socket.emit('joinGame', { charType: type, userName: document.getElementById('nameInput').value || 'No Name' }); };
window.sendPin = e => { if(socket && player && player.visible) socket.emit('sendPin', { id: socket.id, emoji: e }); };
