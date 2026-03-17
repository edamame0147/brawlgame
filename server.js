const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            x: 600, y: 600, id: socket.id,
            charType: data.charType, userName: data.userName,
            hp: 100, kills: 0, isInBush: false, bushId: null
        };
        io.emit('currentPlayers', players);
    });

    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            Object.assign(players[socket.id], data);
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('shoot', (data) => { socket.broadcast.emit('enemyShoot', data); });
    socket.on('ult', (data) => { socket.broadcast.emit('enemyUlt', data); });
    socket.on('sendPin', (data) => { io.emit('showPin', data); });

    socket.on('updateHP', (data) => {
        if (players[data.id]) {
            players[data.id].hp = data.hp;
            io.emit('hpUpdate', data);
            if (data.hp <= 0 && data.attackerId && players[data.attackerId]) {
                players[data.attackerId].kills++;
                io.emit('updateRanking', players);
            }
        }
    });

    socket.on('respawnRequest', () => {
        if (players[socket.id]) {
            players[socket.id].hp = 100;
            players[socket.id].x = Math.floor(Math.random() * 800) + 200;
            players[socket.id].y = Math.floor(Math.random() * 800) + 200;
            io.emit('playerRespawned', players[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

server.listen(3000, () => console.log('Server running on port 3000'));
