const express = require("express");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const LECTURER_PASSWORD = process.env.LECTURER_PASSWORD || "prof123";
const DEFAULT_COURSE = "Mathe 1 - Lineare Algebra";
const RECENT_WINDOW_MINUTES = 10;
const SLOT_WINDOW_MINUTES = 30;
const HISTORY_FILE = path.join(__dirname, "data", "sessions.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

const persisted = loadHistory();
const state = {
  lecturerTokens: new Set(),
  history: Array.isArray(persisted.history) ? persisted.history : [],
  activeSession: createSession(DEFAULT_COURSE),
  studentConnections: new Map()
};

app.get("/", (_request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

app.get("/style.css", (_request, response) => {
  response.sendFile(path.join(__dirname, "style.css"));
});

app.get("/script.js", (_request, response) => {
  response.sendFile(path.join(__dirname, "script.js"));
});

app.get("/api/session", (request, response) => {
  response.json(buildSnapshot(request));
});

app.get("/api/session/qr.svg", async (request, response) => {
  try {
    const sessionCode = String(request.query.session || state.activeSession.code).toUpperCase();
    const joinUrl = buildJoinUrl(request, sessionCode);
    const svg = await QRCode.toString(joinUrl, {
      type: "svg",
      margin: 1,
      width: 280,
      color: {
        dark: "#1f1f1a",
        light: "#ffffff"
      }
    });

    response.type("image/svg+xml").send(svg);
  } catch (_error) {
    response.status(500).send("QR generation failed");
  }
});

app.post("/api/lecturer/login", (request, response) => {
  if (request.body?.password !== LECTURER_PASSWORD) {
    response.status(401).json({ ok: false });
    return;
  }

  const token = crypto.randomUUID();
  state.lecturerTokens.add(token);
  response.json({ ok: true, token });
});

app.post("/api/lecturer/session/reset", (request, response) => {
  if (!isLecturerAuthorized(request)) {
    response.status(401).json({ ok: false });
    return;
  }

  archiveActiveSession();
  const courseName = String(request.body?.courseName || DEFAULT_COURSE).trim() || DEFAULT_COURSE;
  state.activeSession = createSession(courseName);

  const studentSocketIds = [...state.studentConnections.keys()];
  studentSocketIds.forEach((socketId) => {
    io.to(socketId).emit("session:ended");
    io.sockets.sockets.get(socketId)?.disconnect(true);
  });
  state.studentConnections.clear();

  const snapshot = buildSnapshot(request);
  io.emit("session:update", snapshot);
  response.json({ ok: true, snapshot });
});

io.on("connection", (socket) => {
  const role = String(socket.handshake.query.role || "");

  if (role === "student") {
    handleStudentConnection(socket);
    return;
  }

  if (role === "lecturer") {
    handleLecturerConnection(socket);
    return;
  }

  socket.disconnect(true);
});

server.listen(PORT, "0.0.0.0", () => {
  const urls = buildBaseUrls(PORT);
  console.log(`Ich bin Lost laeuft auf ${urls.join(", ")}`);
});

function handleStudentConnection(socket) {
  const sessionCode = String(socket.handshake.query.sessionCode || "").toUpperCase();
  const clientId = String(socket.handshake.query.clientId || socket.id);

  if (!sessionCode || sessionCode !== state.activeSession.code) {
    socket.emit("session:ended");
    socket.disconnect(true);
    return;
  }

  state.studentConnections.set(socket.id, {
    clientId,
    joinedAt: new Date().toISOString()
  });
  updatePeakStudents();
  socket.emit("session:update", buildSnapshotFromBaseUrl(buildPreferredBaseUrl(PORT)));
  broadcastSnapshot();

  socket.on("student:submit", (payload, acknowledge) => {
    const submission = buildSubmission(clientId, payload);
    if (!submission) {
      acknowledge?.({ ok: false });
      return;
    }

    state.activeSession.submissions.push(submission);
    broadcastSnapshot();
    acknowledge?.({ ok: true, id: submission.id });
  });

  socket.on("disconnect", () => {
    state.studentConnections.delete(socket.id);
    broadcastSnapshot();
  });
}

function handleLecturerConnection(socket) {
  const lecturerToken = String(socket.handshake.query.lecturerToken || "");
  if (!state.lecturerTokens.has(lecturerToken)) {
    socket.disconnect(true);
    return;
  }

  socket.emit("session:update", buildSnapshotFromBaseUrl(buildPreferredBaseUrl(PORT)));
}

function buildSubmission(clientId, payload) {
  const level = Number(payload?.level);
  const slideValue = payload?.slide;
  const slide = Number.isInteger(slideValue) && slideValue > 0 ? slideValue : null;
  const comment = String(payload?.comment || "").trim().slice(0, 240);

  if (!Number.isFinite(level) || level < 0 || level > 10) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    clientId,
    level: Number(level.toFixed(1)),
    slide,
    comment,
    createdAt: new Date().toISOString()
  };
}

function createSession(courseName) {
  return {
    id: crypto.randomUUID(),
    code: generateSessionCode(),
    courseName,
    startedAt: new Date().toISOString(),
    submissions: [],
    peakConnectedStudents: 0
  };
}

function generateSessionCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function buildSnapshot(request) {
  return buildSnapshotFromBaseUrl(buildRequestBaseUrl(request));
}

function buildSnapshotFromBaseUrl(baseUrl) {
  const session = state.activeSession;
  const connectedStudents = getConnectedStudentCount();
  const submissions = session.submissions;
  const totalSignals = submissions.length;
  const averageLost = totalSignals === 0
    ? 0
    : roundToOneDecimal(submissions.reduce((sum, item) => sum + item.level, 0) / totalSignals);
  const recentLostCount = getRecentUniqueReporterCount();
  const stormThreshold = Math.max(3, Math.ceil(Math.max(session.peakConnectedStudents, connectedStudents, 1) * 0.35));
  const joinUrl = `${baseUrl}/?session=${session.code}`;

  return {
    courseName: session.courseName,
    sessionCode: session.code,
    startedAt: session.startedAt,
    connectedStudents,
    recentLostCount,
    totalSignals,
    averageLost,
    stormThreshold,
    joinUrl,
    liveFeedback: buildLiveFeedback(),
    currentSessionChart: buildChartData({
      title: "Live-Sitzung",
      subtitle: `${formatDate(session.startedAt)} | ${totalSignals} Signale gesamt`,
      startedAt: session.startedAt,
      endedAt: new Date().toISOString(),
      submissions,
      threshold: stormThreshold,
      liveCount: recentLostCount
    }),
    weeklyCharts: buildWeeklyCharts(stormThreshold)
  };
}

function buildLiveFeedback() {
  return [...state.activeSession.submissions]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      timeLabel: formatTime(item.createdAt),
      slideLabel: item.slide ? `Folie ${item.slide}` : "-",
      level: item.level,
      commentLabel: item.comment || "Kein Kommentar"
    }));
}

function buildWeeklyCharts(defaultThreshold) {
  const weekEntries = [...state.history]
    .filter((item) => isSameCalendarWeek(item.startedAt, new Date().toISOString()))
    .map((item) => buildChartData({
      title: item.courseName,
      subtitle: `${formatDate(item.startedAt)} | ${item.totalSignals} Signale`,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      submissions: item.submissions,
      threshold: item.threshold || defaultThreshold,
      liveCount: null
    }));

  weekEntries.unshift(buildChartData({
    title: `${state.activeSession.courseName} (laufend)`,
    subtitle: `${formatDate(state.activeSession.startedAt)} | Werte laufen live ein`,
    startedAt: state.activeSession.startedAt,
    endedAt: new Date().toISOString(),
    submissions: state.activeSession.submissions,
    threshold: defaultThreshold,
    liveCount: getRecentUniqueReporterCount()
  }));

  return weekEntries.slice(0, 6);
}

function buildChartData({ title, subtitle, startedAt, endedAt, submissions, threshold, liveCount }) {
  const slotRange = buildSlotRange(startedAt, endedAt);
  const slotValues = slotRange.map(({ start, end }) => {
    const count = submissions.filter((item) => {
      const created = new Date(item.createdAt).getTime();
      return created >= start.getTime() && created < end.getTime();
    }).length;
    return {
      label: `${formatTime(start.toISOString())}\n${formatTime(end.toISOString())}`,
      value: count,
      isStorm: count >= threshold
    };
  });

  const segments = liveCount == null
    ? slotValues
    : [
        ...slotValues,
        {
          label: "LIVE",
          value: liveCount,
          isStorm: liveCount >= threshold,
          isLive: true
        }
      ];

  const rawPeakValue = Math.max(
    threshold,
    ...segments.map((segment) => segment.value),
    1
  );
  const maxValue = buildChartCeiling(rawPeakValue);

  return {
    title,
    subtitle,
    threshold,
    maxValue,
    yAxis: buildYAxis(maxValue),
    segments
  };
}

function buildChartCeiling(value) {
  const target = Math.max(4, value + Math.max(1, Math.ceil(value * 0.2)));
  if (target <= 8) {
    return Math.ceil(target / 2) * 2;
  }
  if (target <= 20) {
    return Math.ceil(target / 5) * 5;
  }
  return Math.ceil(target / 10) * 10;
}

function buildSlotRange(startedAt, endedAt) {
  const start = floorToSlot(new Date(startedAt));
  const end = ceilToSlot(new Date(endedAt));
  const range = [];

  for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getTime() + SLOT_WINDOW_MINUTES * 60 * 1000)) {
    const next = new Date(cursor.getTime() + SLOT_WINDOW_MINUTES * 60 * 1000);
    range.push({ start: new Date(cursor), end: next });
  }

  if (range.length === 0) {
    const next = new Date(start.getTime() + SLOT_WINDOW_MINUTES * 60 * 1000);
    range.push({ start, end: next });
  }

  return range;
}

function floorToSlot(date) {
  const floored = new Date(date);
  floored.setSeconds(0, 0);
  floored.setMinutes(floored.getMinutes() < 30 ? 0 : 30);
  return floored;
}

function ceilToSlot(date) {
  const ceiled = new Date(date);
  ceiled.setSeconds(0, 0);
  const minutes = ceiled.getMinutes();
  if (minutes === 0 || minutes === 30) {
    return ceiled;
  }
  ceiled.setMinutes(minutes < 30 ? 30 : 60);
  return ceiled;
}

function buildYAxis(maxValue) {
  const top = Math.max(4, maxValue);
  return [top, Math.ceil(top * 0.66), Math.ceil(top * 0.33), 0];
}

function getConnectedStudentCount() {
  return new Set([...state.studentConnections.values()].map((item) => item.clientId)).size;
}

function getRecentUniqueReporterCount() {
  const threshold = Date.now() - RECENT_WINDOW_MINUTES * 60 * 1000;
  return new Set(
    state.activeSession.submissions
      .filter((item) => new Date(item.createdAt).getTime() >= threshold)
      .map((item) => item.clientId)
  ).size;
}

function updatePeakStudents() {
  state.activeSession.peakConnectedStudents = Math.max(
    state.activeSession.peakConnectedStudents,
    getConnectedStudentCount()
  );
}

function archiveActiveSession() {
  const active = state.activeSession;
  const durationMs = Date.now() - new Date(active.startedAt).getTime();
  if (active.submissions.length === 0 && durationMs < 60 * 1000) {
    return;
  }

  const threshold = Math.max(3, Math.ceil(Math.max(active.peakConnectedStudents, 1) * 0.35));
  state.history.unshift({
    id: active.id,
    courseName: active.courseName,
    startedAt: active.startedAt,
    endedAt: new Date().toISOString(),
    totalSignals: active.submissions.length,
    threshold,
    submissions: active.submissions
  });
  state.history = state.history.slice(0, 20);
  saveHistory();
}

function isLecturerAuthorized(request) {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return state.lecturerTokens.has(token);
}

function broadcastSnapshot() {
  updatePeakStudents();
  io.emit("session:update", buildSnapshotFromBaseUrl(buildPreferredBaseUrl(PORT)));
}

function loadHistory() {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    if (!fs.existsSync(HISTORY_FILE)) {
      return { history: [] };
    }
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch (_error) {
    return { history: [] };
  }
}

function saveHistory() {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({ history: state.history }, null, 2));
}

function buildRequestBaseUrl(request) {
  const host = request.get("host");
  if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    return `${request.protocol}://${host}`;
  }
  return buildPreferredBaseUrl(PORT);
}

function buildPreferredBaseUrl(port) {
  const localAddress = getLocalIpv4Address();
  if (localAddress) {
    return `http://${localAddress}:${port}`;
  }
  return `http://localhost:${port}`;
}

function buildBaseUrls(port) {
  const urls = new Set([`http://localhost:${port}`]);
  const localAddress = getLocalIpv4Address();
  if (localAddress) {
    urls.add(`http://${localAddress}:${port}`);
  }
  return [...urls];
}

function getLocalIpv4Address() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, networkEntries] of Object.entries(interfaces)) {
    for (const entry of networkEntries || []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateAddress(entry.address)) {
        candidates.push({
          name,
          address: entry.address,
          score: getInterfaceScore(name, entry.address)
        });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.address || null;
}

function isPrivateAddress(address) {
  return address.startsWith("192.168.") || address.startsWith("10.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
}

function getInterfaceScore(name, address) {
  const normalizedName = String(name || "").toLowerCase();

  if (normalizedName.includes("wlan") || normalizedName.includes("wi-fi") || normalizedName.includes("wifi")) {
    return 300;
  }

  if (normalizedName.includes("ethernet")) {
    return address.startsWith("192.168.") ? 260 : 220;
  }

  if (normalizedName.includes("virtual") || normalizedName.includes("hyper-v") || normalizedName.includes("wsl") || normalizedName.includes("vmware") || normalizedName.includes("bluetooth")) {
    return 40;
  }

  if (address.startsWith("192.168.")) {
    return 200;
  }

  if (address.startsWith("10.")) {
    return 160;
  }

  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) {
    return 120;
  }

  return 0;
}

function buildJoinUrl(request, sessionCode) {
  return `${buildRequestBaseUrl(request)}/?session=${sessionCode}`;
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  });
}

function isSameCalendarWeek(leftIso, rightIso) {
  const left = new Date(leftIso);
  const right = new Date(rightIso);
  const leftWeek = getWeekAnchor(left);
  const rightWeek = getWeekAnchor(right);
  return leftWeek.getTime() === rightWeek.getTime();
}

function getWeekAnchor(date) {
  const anchor = new Date(date);
  anchor.setHours(0, 0, 0, 0);
  const day = anchor.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  anchor.setDate(anchor.getDate() + delta);
  return anchor;
}
