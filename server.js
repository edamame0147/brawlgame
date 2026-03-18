const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let players = {};

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: Math.random() * 1000 + 100,
            y: Math.random() * 1000 + 100,
            charType: data.charType,
            userName: data.userName,
            hp: 100,
            kills: 0,
            isDead: false // 重複キル防止用
        };
        io.emit('currentPlayers', players);
        io.emit('updateRanking', players);
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].isInBush = movementData.isInBush;
            players[socket.id].bushId = movementData.bushId;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('shoot', (data) => { socket.broadcast.emit('enemyShoot', data); });
    socket.on('ult', (data) => { socket.broadcast.emit('enemyUlt', data); });

    socket.on('updateHP', (data) => {
        const victim = players[data.id];
        const attacker = players[data.attackerId];

        if (victim && !victim.isDead) {
            victim.hp = data.hp;
            if (victim.hp <= 0) {
                victim.isDead = true;
                victim.hp = 0;
                // 攻撃者が存在し、自分自身でない場合にキル数を加算
                if (attacker && attacker.id !== victim.id) {
                    attacker.kills++;
                }
                io.emit('updateRanking', players);
            }
            io.emit('hpUpdate', { ...data, hp: victim.hp });
        }
    });

    socket.on('respawnRequest', () => {
        if (players[socket.id]) {
            players[socket.id].hp = 100;
            players[socket.id].isDead = false;
            players[socket.id].x = Math.random() * 1000 + 100;
            players[socket.id].y = Math.random() * 1000 + 100;
            io.emit('playerRespawned', players[socket.id]);
        }
    });

    socket.on('sendPin', (data) => { io.emit('showPin', data); });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
            io.emit('updateRanking', players);
        }
    });
});

http.listen(3000, () => { console.log('Server is running on port 3000'); });
