const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { attach } = require('./logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 20000 });

app.get('/health', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

attach(io, { file: path.join(__dirname, 'data.json') });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Nano Ball sunucusu çalışıyor, port', PORT));
