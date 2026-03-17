const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let players = {};

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            x: 400, y: 300,
            id: socket.id,
            charType: data.charType,
            hp: 100,
            isInBush: false,
            bushId: null
        };
        io.emit('currentPlayers', players);
    });

    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].isInBush = data.isInBush;
            players[socket.id].bushId = data.bushId;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('shoot', (data) => {
        socket.broadcast.emit('enemyShoot', {
            id: socket.id, x: data.x, y: data.y, angle: data.angle, charType: data.charType
        });
    });

    socket.on('updateHP', (data) => {
        if (players[data.id]) {
            players[data.id].hp = data.hp;
            // revealフラグ（ダメージを受けて姿を現す）を全員に送る
            io.emit('hpUpdate', { id: data.id, hp: data.hp, reveal: data.reveal });
        }
    });

    socket.on('respawnRequest', () => {
        if (players[socket.id]) {
            players[socket.id].hp = 100;
            players[socket.id].x = Math.floor(Math.random() * 700) + 50;
            players[socket.id].y = Math.floor(Math.random() * 500) + 50;
            io.emit('playerRespawned', players[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

server.listen(3000, () => console.log(`Server running on http://localhost:3000`));