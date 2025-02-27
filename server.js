const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Инициализация Express приложения
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Настройка статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// Настройка middleware для обработки JSON-запросов
app.use(express.json());

// Настройка логирования
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logStream = fs.createWriteStream(path.join(logDir, `server-${new Date().toISOString().slice(0, 10)}.log`), { flags: 'a' });

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  logStream.write(logMessage);
}

// Тестовый маршрут
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'success', message: 'Server is running!' });
});

// Статус сервера
app.get('/status', (req, res) => {
  const status = {
    server: 'running',
    uptime: process.uptime(),
    timestamp: Date.now(),
    connections: io.engine.clientsCount,
    waitingUsers: waitingUsers.length
  };
  res.status(200).json(status);
});

// -------------------- ПОДКЛЮЧЕНИЕ К SQLite --------------------
const db = new sqlite3.Database('./chat.db', (err) => {
  if (err) {
    log(`Ошибка подключения к SQLite: ${err.message}`);
  } else {
    log('Connected to SQLite database.');
    initDatabase();
  }
});

// Инициализация базы данных
function initDatabase() {
  // Создаём таблицы, если не существуют
  db.serialize(() => {
    // Таблица пользователей
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        socket_id TEXT PRIMARY KEY,
        nickname TEXT,
        gender TEXT,
        age INTEGER,
        interests TEXT,
        connected_at INTEGER,
        ip TEXT,
        last_active INTEGER
      )
    `);

    // Таблица логов чатов
    db.run(`
      CREATE TABLE IF NOT EXISTS chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_socket TEXT,
        to_socket TEXT,
        message TEXT,
        message_type TEXT DEFAULT 'text',
        timestamp INTEGER,
        FOREIGN KEY (from_socket) REFERENCES users(socket_id),
        FOREIGN KEY (to_socket) REFERENCES users(socket_id)
      )
    `);

    // Таблица отчётов пользователей
    db.run(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_socket TEXT,
        reported_socket TEXT,
        reason TEXT,
        timestamp INTEGER,
        FOREIGN KEY (reporter_socket) REFERENCES users(socket_id),
        FOREIGN KEY (reported_socket) REFERENCES users(socket_id)
      )
    `);

    // Таблица статистики
    db.run(`
      CREATE TABLE IF NOT EXISTS stats (
        date TEXT PRIMARY KEY,
        total_connections INTEGER DEFAULT 0,
        total_messages INTEGER DEFAULT 0,
        active_users INTEGER DEFAULT 0
      )
    `);
  });
}

// Очистка старых чатов (старше 72 часов)
function cleanupOldChats() {
  const threeDaysAgo = Date.now() - (72 * 60 * 60 * 1000);
  
  db.run(`DELETE FROM chat_logs WHERE timestamp < ?`, [threeDaysAgo], function(err) {
    if (err) {
      log(`Ошибка при очистке старых чатов: ${err.message}`);
    } else if (this.changes > 0) {
      log(`Очищено ${this.changes} старых сообщений`);
    }
  });
}

// Запускаем очистку старых чатов каждые 24 часа
setInterval(cleanupOldChats, 24 * 60 * 60 * 1000);

// -------------------- ДАННЫЕ В ПАМЯТИ (очередь + пары) --------------------
// queue: [{ socketId, ip, interests: string[] }, ... ]
let waitingUsers = [];

// пары: { socketId: { partnerId, lastActive } }
const userPairs = {};

// Проверка интересов с весовыми коэффициентами
function calculateMatchScore(interests1, interests2) {
  if (!interests1.length || !interests2.length) return 0;
  
  // Считаем пересечение интересов
  const intersection = interests1.filter(interest => interests2.includes(interest));
  
  // Базовый счёт на основе количества совпадений
  const baseScore = intersection.length;
  
  // Процент совпадений относительно меньшего из списков интересов
  const percentMatch = baseScore / Math.min(interests1.length, interests2.length);
  
  // Возвращаем взвешенный счёт
  return baseScore * (0.5 + percentMatch * 0.5);
}

// -------------------- SOCKET.IO ЛОГИКА --------------------
io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  log(`New client connected: ${socket.id} from IP ${ip}`);

  // При подключении создаём запись в users
  db.run(
    `INSERT INTO users (socket_id, connected_at, ip, last_active) VALUES (?, ?, ?, ?)`,
    [socket.id, Date.now(), ip, Date.now()],
    (err) => { 
      if (err) log(`Ошибка INSERT в users: ${err.message}`); 
    }
  );

  // Сохранение/обновление профиля
  socket.on('setProfile', (profile) => {
    // profile = { nickname, gender, age, interests: string[] }
    const { nickname, gender, age, interests } = profile;
    
    // Валидация данных
    if (!nickname || !gender || !age || !interests) {
      socket.emit('error', { message: 'Неполные данные профиля' });
      return;
    }
    
    // Конвертация интересов в JSON
    const interestsJSON = JSON.stringify(interests || []);

    db.run(
      `UPDATE users
       SET nickname=?, gender=?, age=?, interests=?, last_active=?
       WHERE socket_id=?`,
      [nickname, gender, age, interestsJSON, Date.now(), socket.id],
      (err) => {
        if (err) {
          log(`Ошибка UPDATE профиля: ${err.message}`);
          socket.emit('error', { message: 'Ошибка сохранения профиля' });
          return;
        }
        
        log(`setProfile -> user ${socket.id} => ${nickname}, интересы: [${interests.join(', ')}]`);
        
        // Удаляем пользователя из очереди ожидания, если он там есть
        waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);
        
        // Добавляем пользователя в очередь ожидания
        waitingUsers.push({
          socketId: socket.id,
          ip,
          interests: interests || [],
          addedAt: Date.now()
        });
        
        // Пытаемся найти собеседника
        matchOrWait(socket);
      }
    );
  });

  // Отправка текстового сообщения
  socket.on('sendMessage', (text) => {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return;
    }
    
    // Очищаем текст от потенциально опасных элементов (XSS)
    const sanitizedText = text
      .trim()
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    const pairInfo = userPairs[socket.id];
    if (pairInfo && pairInfo.partnerId) {
      const partnerId = pairInfo.partnerId;
      const now = Date.now();
      
      // Обновляем последнюю активность
      pairInfo.lastActive = now;
      if (userPairs[partnerId]) {
        userPairs[partnerId].lastActive = now;
      }
      
      // Обновляем данные в БД
      db.run(
        `UPDATE users SET last_active = ? WHERE socket_id = ?`,
        [now, socket.id]
      );
      
      // Сохраняем сообщение в chat_logs
      db.run(
        `INSERT INTO chat_logs (from_socket, to_socket, message, timestamp)
         VALUES (?, ?, ?, ?)`,
        [socket.id, partnerId, sanitizedText, now],
        (err) => { 
          if (err) log(`Ошибка INSERT chat_logs: ${err.message}`); 
        }
      );

      // Обновляем статистику
      updateMessageStats();

      // Отправляем сообщение партнёру
      io.to(partnerId).emit('receiveMessage', { text: sanitizedText });
    }
  });

  // Уведомление о наборе текста
  socket.on('typing', (isTyping) => {
    const pairInfo = userPairs[socket.id];
    if (pairInfo && pairInfo.partnerId) {
      io.to(pairInfo.partnerId).emit('partnerTyping', isTyping);
    }
  });

  // Когда пользователь нажимает "следующий"
  socket.on('skip', () => {
    endChat(socket.id);
    
    // Проверяем, заполнен ли профиль и добавляем пользователя в очередь ожидания
    db.get(
      `SELECT nickname, gender, age, interests FROM users WHERE socket_id = ?`,
      [socket.id],
      (err, row) => {
        if (!err && row && row.nickname) {
          // Профиль заполнен, можно добавлять в очередь
          waitingUsers.push({
            socketId: socket.id,
            ip,
            interests: row.interests ? JSON.parse(row.interests) : [],
            addedAt: Date.now()
          });
          
          // Пытаемся найти нового собеседника
          matchOrWait(socket);
        }
      }
    );
  });

  // Отправка отчёта о собеседнике
  socket.on('reportUser', (data) => {
    const { reason } = data;
    const pairInfo = userPairs[socket.id];
    
    if (!pairInfo || !pairInfo.partnerId) {
      socket.emit('error', { message: 'Нет активного собеседника для отчёта' });
      return;
    }
    
    db.run(
      `INSERT INTO reports (reporter_socket, reported_socket, reason, timestamp)
       VALUES (?, ?, ?, ?)`,
      [socket.id, pairInfo.partnerId, reason, Date.now()],
      (err) => {
        if (err) {
          log(`Ошибка сохранения отчёта: ${err.message}`);
          socket.emit('error', { message: 'Не удалось отправить отчёт' });
        } else {
          socket.emit('reportSuccess');
          log(`User ${socket.id} reported user ${pairInfo.partnerId}: ${reason}`);
        }
      }
    );
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    log(`Client disconnected: ${socket.id}`);

    // Удаляем из очереди
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);

    // Разрываем пару
    endChat(socket.id);

    // Удаляем из таблицы users
    db.run(`DELETE FROM users WHERE socket_id=?`, [socket.id], (err) => {
      if (err) log(`Ошибка DELETE user: ${err.message}`);
    });
  });
});

// -------------------- ФУНКЦИИ --------------------

// matchOrWait: проверяем, не найдём ли подходящего собеседника в очереди
function matchOrWait(socket) {
  const meId = socket.id;
  
  // Проверяем, не в паре ли уже пользователь
  if (userPairs[meId]) {
    log(`User ${meId} already in a pair, skipping matching`);
    return;
  }
  
  // Находим мою запись из waitingUsers
  const me = waitingUsers.find(u => u.socketId === meId);
  if (!me) {
    log(`User ${meId} not in waitingUsers yet.`);
    return;
  }

  // Ищем наилучшего кандидата
  let bestMatch = null;
  let bestScore = -1;
  
  for (const candidate of waitingUsers) {
    // Пропускаем самого себя
    if (candidate.socketId === meId) continue;
    
    // Не мэчим с одинаковым IP
    if (candidate.ip === me.ip) continue;
    
    // Рассчитываем совместимость по интересам
    const score = calculateMatchScore(me.interests, candidate.interests);
    
    // Если счёт лучше предыдущего - запоминаем кандидата
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  // Если нашли подходящего кандидата
  if (bestMatch) {
    // Удаляем кандидата из очереди
    waitingUsers = waitingUsers.filter(u => u.socketId !== bestMatch.socketId);
    
    // Удаляем себя из очереди
    waitingUsers = waitingUsers.filter(u => u.socketId !== meId);
    
    // Формируем пару с временем последней активности
    const now = Date.now();
    userPairs[meId] = { partnerId: bestMatch.socketId, lastActive: now };
    userPairs[bestMatch.socketId] = { partnerId: meId, lastActive: now };
    
    // Обновляем статистику
    updateConnectionStats();
    
    // Загружаем профили и отправляем данные пользователям
    db.get(`SELECT nickname, gender, age FROM users WHERE socket_id=?`, [meId], (errA, myRow) => {
      db.get(`SELECT nickname, gender, age FROM users WHERE socket_id=?`, [bestMatch.socketId], (errB, partnerRow) => {
        if (errA || errB) {
          log(`Ошибка загрузки профилей: ${errA || errB}`);
          return;
        }
        
        io.to(meId).emit('chatReady', {
          partnerId: bestMatch.socketId,
          partnerProfile: partnerRow || {}
        });
        
        io.to(bestMatch.socketId).emit('chatReady', {
          partnerId: meId,
          partnerProfile: myRow || {}
        });
        
        log(`Matched: ${meId} <-> ${bestMatch.socketId} (score: ${bestScore.toFixed(2)})`);
      });
    });
  } else {
    // Никого подходящего не нашли, остаёмся в очереди
    log(`User ${meId} is waiting (interests: [${me.interests.join(', ')}])`);
    socket.emit('waitingForMatch');
  }
}

// Разорвать пару
function endChat(userId) {
  const pairInfo = userPairs[userId];
  if (pairInfo && pairInfo.partnerId) {
    const partnerId = pairInfo.partnerId;
    
    // Уведомляем партнёра
    io.to(partnerId).emit('partnerLeft');
    
    // Удаляем пары
    delete userPairs[partnerId];
    delete userPairs[userId];
    
    log(`Chat ended between ${userId} and ${partnerId}`);
  }
}

// Обновление статистики подключений
function updateConnectionStats() {
  const today = new Date().toISOString().slice(0, 10);
  
  db.run(`
    INSERT INTO stats (date, total_connections, total_messages, active_users)
    VALUES (?, 1, 0, 0)
    ON CONFLICT(date) DO UPDATE SET
    total_connections = total_connections + 1
  `, [today]);
}

// Обновление статистики сообщений
function updateMessageStats() {
  const today = new Date().toISOString().slice(0, 10);
  
  db.run(`
    INSERT INTO stats (date, total_connections, total_messages, active_users)
    VALUES (?, 0, 1, 0)
    ON CONFLICT(date) DO UPDATE SET
    total_messages = total_messages + 1
  `, [today]);
}

// Периодическое обновление статистики активных пользователей
function updateActiveUsersStats() {
  const today = new Date().toISOString().slice(0, 10);
  const activeCount = Object.keys(userPairs).length / 2; // Делим на 2, т.к. каждый пользователь входит дважды
  
  db.run(`
    INSERT INTO stats (date, total_connections, total_messages, active_users)
    VALUES (?, 0, 0, ?)
    ON CONFLICT(date) DO UPDATE SET
    active_users = ?
  `, [today, activeCount, activeCount]);
  
  log(`Active pairs: ${activeCount}`);
}

// Запускаем обновление статистики каждые 5 минут
setInterval(updateActiveUsersStats, 5 * 60 * 1000);

// Проверка неактивных пар и их разъединение
function checkInactivePairs() {
  const now = Date.now();
  const inactivityThreshold = 30 * 60 * 1000; // 30 минут неактивности
  
  // Проверяем каждую пару
  for (const [userId, pairInfo] of Object.entries(userPairs)) {
    // Проверяем только "первичные" записи (чтобы не обрабатывать каждую пару дважды)
    if (userId < pairInfo.partnerId) {
      // Если пара неактивна более 30 минут
      if (now - pairInfo.lastActive > inactivityThreshold) {
        // Уведомляем обоих пользователей
        io.to(userId).emit('inactivityDisconnect');
        io.to(pairInfo.partnerId).emit('inactivityDisconnect');
        
        // Разрываем пару
        log(`Breaking pair ${userId} <-> ${pairInfo.partnerId} due to inactivity`);
        delete userPairs[pairInfo.partnerId];
        delete userPairs[userId];
      }
    }
  }
}

// Запускаем проверку неактивных пар каждые 5 минут
setInterval(checkInactivePairs, 5 * 60 * 1000);

// -------------------- ЗАПУСК СЕРВЕРА --------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});

// Обработчик для корректного завершения при остановке сервера
process.on('SIGINT', () => {
  log('Server shutting down...');
  
  // Закрываем соединение с БД
  db.close((err) => {
    if (err) {
      log(`Error closing database: ${err.message}`);
    } else {
      log('Database connection closed');
    }
    
    // Закрываем логи
    logStream.end();
    
    process.exit(0);
  });
});
