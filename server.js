const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('Oyun Sunucusu (oyun-sunucunano) Aktif ve Çalışıyor!');
});

const odalar = {};
const oyuncular = {};

io.on('connection', (socket) => {
  console.log('Yeni oyuncu bağlandı:', socket.id);

  socket.on('oyuncu_giris', (data) => {
    oyuncular[socket.id] = {
      id: socket.id,
      isim: data.isim,
      tag: data.tag || '#' + Math.floor(1000 + Math.random() * 9000),
      durum: 'online'
    };
    socket.emit('giris_basarili', oyuncular[socket.id]);
  });

  socket.on('oda_olustur', () => {
    const odaKodu = Math.random().toString(36).substring(2, 7).toUpperCase();
    odalar[odaKodu] = {
      kod: odaKodu,
      kurucu: socket.id,
      oyuncular: [oyuncular[socket.id]]
    };
    socket.join(odaKodu);
    socket.emit('oda_olusturuldu', { odaKodu, oda: odalar[odaKodu] });
  });

  socket.on('odaya_katil', (odaKodu) => {
    if (odalar[odaKodu]) {
      odalar[odaKodu].oyuncular.push(oyuncular[socket.id]);
      socket.join(odaKodu);
      io.to(odaKodu).emit('oda_guncellendi', odalar[odaKodu]);
    } else {
      socket.emit('hata', 'Oda bulunamadı!');
    }
  });

  socket.on('disconnect', () => {
    delete oyuncular[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
