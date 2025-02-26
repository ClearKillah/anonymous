const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1) Раздаём статические файлы (index.html, css/js) из папки public
app.use(express.static(path.join(__dirname, 'public')));

// 2) Тестовый маршрут
app.get('/ping', (req, res) => {
  res.send('Server is running!');
});

// -------------------- ПОДКЛЮЧЕНИЕ К SQLite --------------------
const db = new sqlite3.Database('./chat.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к SQLite:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Создаём таблицы, если не существуют
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    socket_id TEXT PRIMARY KEY,
    nickname TEXT,
    gender TEXT,
    age INTEGER,
    interests TEXT,        -- тут храним JSON со списком интересов
    connected_at INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_socket TEXT,
    to_socket TEXT,
    message TEXT,
    timestamp INTEGER
  )
`);

// -------------------- ДАННЫЕ В ПАМЯТИ (очередь + пары) --------------------
// queue: [{ socketId, ip, interests: string[] }, ... ]
let waitingUsers = [];

// пары: { socketId: partnerSocketId }
const userPairs = {};

// -------------------- SOCKET.IO ЛОГИКА --------------------
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // При подключении создаём запись в users (минимальная)
  db.run(
    `INSERT INTO users (socket_id, connected_at) VALUES (?, ?)`,
    [socket.id, Date.now()],
    (err) => { if (err) console.error('Ошибка INSERT в users:', err); }
  );

  // Сохранение/обновление профиля (приходит от клиента)
  socket.on('setProfile', (profile) => {
    // profile = { nickname, gender, age, interests: string[] }
    const { nickname, gender, age, interests } = profile;
    const interestsJSON = JSON.stringify(interests || []);

    db.run(
      `UPDATE users
       SET nickname=?, gender=?, age=?, interests=?
       WHERE socket_id=?`,
      [nickname, gender, age, interestsJSON, socket.id],
      (err) => {
        if (err) console.error('Ошибка UPDATE профиля:', err);
      }
    );

    // Считываем IP
    const ip = socket.handshake.address;

    // Сразу добавляем в очередь (или обновляем, если уже был)
    // Но сначала получим у нас уже есть запись?
    // Проще удалить старую запись из waitingUsers
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);

    // Добавим
    waitingUsers.push({
      socketId: socket.id,
      ip,
      interests: interests || []
    });
    console.log(`setProfile -> user ${socket.id} => ${nickname}, interests=${interests}`);

    // Пытаемся найти собеседника
    matchOrWait(socket);
  });

  // Отправка текстового сообщения
  socket.on('sendMessage', (text) => {
    const partnerId = userPairs[socket.id];
    if (partnerId) {
      // Сохраним в chat_logs
      db.run(
        `INSERT INTO chat_logs (from_socket, to_socket, message, timestamp)
         VALUES (?, ?, ?, ?)`,
        [socket.id, partnerId, text, Date.now()],
        (err) => { if (err) console.error('Ошибка INSERT chat_logs:', err); }
      );

      // Отправим партнёру
      io.to(partnerId).emit('receiveMessage', { text });
    }
  });

  // Когда пользователь нажимает "следующий"
  socket.on('skip', () => {
    endChat(socket.id);
    // возвращаем в очередь
    // но user уже в waitingUsers. Просто matchOrWait заново
    matchOrWait(socket);
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Удалим из очереди
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);

    // Разорвём пару
    endChat(socket.id);

    // Удалим из users (чтобы в БД оставались только активные)
    db.run(`DELETE FROM users WHERE socket_id=?`, [socket.id], (err) => {
      if (err) console.error('Ошибка DELETE user:', err);
    });
  });
});

// -------------------- ФУНКЦИИ --------------------

// matchOrWait: проверяем, не найдём ли подходящего собеседника в очереди
// Логика: есть ли в очереди кто-то с другим IP и пересечением интересов
function matchOrWait(socket) {
  const meId = socket.id;
  // Возьмём мою запись из waitingUsers (только что обновили)
  const me = waitingUsers.find(u => u.socketId === meId);
  if (!me) {
    // если нет - значит ещё не сохранён профиль
    console.log(`User ${meId} not in waitingUsers yet.`);
    return;
  }

  let foundIndex = -1;
  for (let i = 0; i < waitingUsers.length; i++) {
    const candidate = waitingUsers[i];
    if (candidate.socketId === meId) continue; // сам себе - нет
    // IP-check
    if (candidate.ip === me.ip) continue; // не мэчим одного IP
    // пересечение интересов
    if (hasIntersection(me.interests, candidate.interests)) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex === -1) {
    // Никого не нашли - остаёмся в очереди
    console.log(`User ${meId} is waiting ( interests = ${me.interests} )`);
  } else {
    // Нашли
    const partner = waitingUsers[foundIndex];
    // Убираем партнёра из очереди
    waitingUsers.splice(foundIndex, 1);
    // Убираем и самого себя из очереди
    waitingUsers = waitingUsers.filter(u => u.socketId !== meId);

    // Формируем пару
    userPairs[meId] = partner.socketId;
    userPairs[partner.socketId] = meId;

    // Грузим профили из БД для chatReady
    db.get(`SELECT nickname, gender, age FROM users WHERE socket_id=?`, [meId], (errA, myRow) => {
      db.get(`SELECT nickname, gender, age FROM users WHERE socket_id=?`, [partner.socketId], (errB, partnerRow) => {
        io.to(meId).emit('chatReady', {
          partnerId: partner.socketId,
          partnerProfile: partnerRow || {}
        });
        io.to(partner.socketId).emit('chatReady', {
          partnerId: meId,
          partnerProfile: myRow || {}
        });
        console.log(`Matched: ${meId} <-> ${partner.socketId}`);
      });
    });
  }
}

// Разорвать пару
function endChat(userId) {
  const partnerId = userPairs[userId];
  if (partnerId) {
    io.to(partnerId).emit('partnerLeft');
    delete userPairs[partnerId];
    delete userPairs[userId];
    console.log(`Chat ended between ${userId} and ${partnerId}`);
  }
}

// Утилита: пересечение интересов
function hasIntersection(arr1, arr2) {
  return arr1.some(item => arr2.includes(item));
}

// -------------------- ЗАПУСК СЕРВЕРА --------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
