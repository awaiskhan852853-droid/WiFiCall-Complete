const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET = process.env.TOKEN_SECRET || 'change-this-secret-before-public-launch-wificall';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
const readUsers = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; } };
const writeUsers = users => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
const makeToken = id => `${id}.${crypto.createHmac('sha256', SECRET).update(id).digest('hex')}`;
const tokenUser = token => {
  if (!token || typeof token !== 'string') return null;
  const [id, sig] = token.split('.');
  if (!id || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(id).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
};
const cleanName = s => String(s || '').trim().replace(/[<>]/g, '').slice(0, 24);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', (req, res) => {
  const name = cleanName(req.body.name);
  const password = String(req.body.password || '');
  if (name.length < 2 || password.length < 6) return res.status(400).json({ error: 'نام کم از کم 2 حروف اور پاس ورڈ کم از کم 6 حروف کا ہو۔' });
  const users = readUsers();
  const id = 'WC' + crypto.randomInt(100000, 999999);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  users[id] = { id, name, salt, hash, createdAt: Date.now() };
  writeUsers(users);
  res.json({ token: makeToken(id), user: { id, name } });
});

app.post('/api/login', (req, res) => {
  const id = String(req.body.id || '').trim().toUpperCase();
  const password = String(req.body.password || '');
  const user = readUsers()[id];
  if (!user) return res.status(401).json({ error: 'User ID نہیں ملا۔' });
  const hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
  if (hash !== user.hash) return res.status(401).json({ error: 'پاس ورڈ درست نہیں۔' });
  res.json({ token: makeToken(id), user: { id, name: user.name } });
});

app.get('/api/me', (req, res) => {
  const id = tokenUser((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const user = id && readUsers()[id];
  if (!user) return res.status(401).json({ error: 'لاگ اِن دوبارہ کریں۔' });
  res.json({ user: { id, name: user.name } });
});

const online = new Map();
const activeCalls = new Map();
io.use((socket, next) => {
  const id = tokenUser(socket.handshake.auth && socket.handshake.auth.token);
  if (!id || !readUsers()[id]) return next(new Error('براہ کرم دوبارہ لاگ اِن کریں۔'));
  socket.userId = id; next();
});
io.on('connection', socket => {
  online.set(socket.userId, socket.id);
  socket.emit('online-ready', { id: socket.userId });
  socket.on('call-user', ({ to, mode }) => {
    to = String(to || '').trim().toUpperCase();
    const users = readUsers();
    if (!users[to]) return socket.emit('call-error', 'یہ User ID موجود نہیں۔');
    if (to === socket.userId) return socket.emit('call-error', 'آپ خود کو کال نہیں کر سکتے۔');
    const target = online.get(to);
    if (!target) return socket.emit('call-error', 'یہ صارف اس وقت آن لائن نہیں ہے۔');
    const callId = crypto.randomUUID();
    activeCalls.set(callId, { from: socket.userId, to, fromSocket: socket.id, toSocket: target });
    io.to(target).emit('incoming-call', { callId, from: socket.userId, name: users[socket.userId]?.name || socket.userId, mode: mode === 'video' ? 'video' : 'audio' });
    socket.emit('calling', { callId, to, name: users[to].name });
  });
  socket.on('accept-call', ({ callId }) => {
    const c = activeCalls.get(callId);
    if (!c || c.to !== socket.userId) return;
    io.to(c.fromSocket).emit('call-accepted', { callId });
  });
  for (const event of ['webrtc-offer', 'webrtc-answer', 'ice-candidate']) {
    socket.on(event, data => {
      const c = activeCalls.get(data && data.callId);
      if (!c || (socket.userId !== c.from && socket.userId !== c.to)) return;
      const target = socket.userId === c.from ? c.toSocket : c.fromSocket;
      io.to(target).emit(event, { ...data, from: socket.userId });
    });
  }
  socket.on('reject-call', ({ callId }) => {
    const c = activeCalls.get(callId); if (!c) return;
    const target = socket.userId === c.from ? c.toSocket : c.fromSocket;
    io.to(target).emit('call-ended', { callId, reason: 'کال مسترد کر دی گئی۔' }); activeCalls.delete(callId);
  });
  socket.on('end-call', ({ callId }) => {
    const c = activeCalls.get(callId); if (!c) return;
    const target = socket.userId === c.from ? c.toSocket : c.fromSocket;
    io.to(target).emit('call-ended', { callId, reason: 'دوسرے صارف نے کال بند کر دی۔' }); activeCalls.delete(callId);
  });
  socket.on('disconnect', () => { if (online.get(socket.userId) === socket.id) online.delete(socket.userId); });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, '0.0.0.0', () => console.log(`WiFiCall running on port ${PORT}`));
