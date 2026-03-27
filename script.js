const urlParams = new URLSearchParams(window.location.search);
const initialSessionCode = (urlParams.get("session") || "").trim().toUpperCase();

const appState = {
  studentClientId: ensureClientId(),
  studentSessionCode: initialSessionCode,
  lecturerToken: sessionStorage.getItem("ibl-lecturer-token") || "",
  studentSocket: null,
  lecturerSocket: null,
  snapshot: null,
  currentView: "student"
};

const studentView = document.getElementById("studentView");
const lecturerView = document.getElementById("lecturerView");
const studentStage = document.querySelector(".studentStage");
const studentNavBtn = document.getElementById("studentNavBtn");
const lecturerNavBtn = document.getElementById("lecturerNavBtn");
const lostBtn = document.getElementById("lostBtn");
const lostForm = document.getElementById("lostForm");
const cancelLostBtn = document.getElementById("cancelLostBtn");
const submitLostBtn = document.getElementById("submitLostBtn");
const lostSlider = document.getElementById("lostSlider");
const sliderBadge = document.getElementById("sliderBadge");
const slideInput = document.getElementById("slideInput");
const commentInput = document.getElementById("commentInput");
const studentFeedback = document.getElementById("studentFeedback");
const currentCourse = document.getElementById("currentCourse");
const sessionCodeText = document.getElementById("sessionCodeText");
const connectedStudentsCount = document.getElementById("connectedStudentsCount");
const recentLostCount = document.getElementById("recentLostCount");
const averageLostLabel = document.getElementById("averageLostLabel");
const studentConnectionStatus = document.getElementById("studentConnectionStatus");

const lecturerLock = document.getElementById("lecturerLock");
const lockPassword = document.getElementById("lockPassword");
const lockFeedback = document.getElementById("lockFeedback");
const unlockLecturerBtn = document.getElementById("unlockLecturerBtn");
const cancelLockBtn = document.getElementById("cancelLockBtn");
const resetSessionBtn = document.getElementById("resetSessionBtn");
const clockValue = document.getElementById("clockValue");
const sessionStartValue = document.getElementById("sessionStartValue");
const teacherConnectedCount = document.getElementById("teacherConnectedCount");
const teacherTotalSignals = document.getElementById("teacherTotalSignals");
const teacherAverageLost = document.getElementById("teacherAverageLost");
const teacherSessionCode = document.getElementById("teacherSessionCode");
const stormThresholdValue = document.getElementById("stormThresholdValue");
const qrCodeImage = document.getElementById("qrCodeImage");
const joinUrlLink = document.getElementById("joinUrlLink");
const liveChart = document.getElementById("liveChart");
const weeklyCharts = document.getElementById("weeklyCharts");
const feedbackTableBody = document.getElementById("feedbackTableBody");
const tabButtons = Array.from(document.querySelectorAll(".tabBtn"));

init();

function init() {
  bindEvents();
  syncSliderVisual();
  startClock();
  loadSnapshot();
  maybeRestoreLecturerAccess();
}

function bindEvents() {
  studentNavBtn?.addEventListener("click", showStudentView);
  lecturerNavBtn?.addEventListener("click", openLecturerLockOrView);
  lostBtn?.addEventListener("click", () => {
    studentStage?.classList.add("form-open");
    lostForm?.classList.remove("hidden");
    studentFeedback?.classList.add("hidden");
  });
  cancelLostBtn?.addEventListener("click", () => {
    resetStudentForm(true);
  });
  submitLostBtn?.addEventListener("click", sendLostSignal);
  lostSlider?.addEventListener("input", syncSliderVisual);
  lockPassword?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      unlockLecturer();
    }
  });
  unlockLecturerBtn?.addEventListener("click", unlockLecturer);
  cancelLockBtn?.addEventListener("click", closeLecturerLock);
  resetSessionBtn?.addEventListener("click", resetSession);
  slideInput?.addEventListener("input", () => {
    slideInput.value = slideInput.value.replace(/[^0-9]/g, "");
  });
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((entry) => entry.classList.remove("active"));
      button.classList.add("active");
      document.querySelectorAll(".lecturerSection").forEach((section) => {
        section.classList.add("hidden");
      });
      const target = document.getElementById(button.dataset.target);
      target?.classList.remove("hidden");
    });
  });
}

async function loadSnapshot() {
  try {
    const response = await fetch("/api/session");
    const snapshot = await response.json();
    handleSnapshot(snapshot);
    if (appState.studentSessionCode && snapshot.sessionCode === appState.studentSessionCode) {
      connectStudentSocket();
      return;
    }
    if (appState.studentSessionCode && snapshot.sessionCode !== appState.studentSessionCode) {
      setStudentStatus("Dieser Sitzungslink ist nicht mehr gueltig. Bitte den aktuellen QR-Code scannen.", true);
    }
  } catch (_error) {
    setStudentStatus("Verbindung zum Server fehlgeschlagen.", true);
  }
}

function maybeRestoreLecturerAccess() {
  if (!appState.lecturerToken) {
    return;
  }
  connectLecturerSocket();
  showLecturerView();
}

function ensureClientId() {
  const existing = localStorage.getItem("ibl-client-id");
  if (existing) {
    return existing;
  }
  const created = self.crypto?.randomUUID?.() || `client-${Date.now()}`;
  localStorage.setItem("ibl-client-id", created);
  return created;
}

function syncSliderVisual() {
  const value = Number(lostSlider?.value || 0);
  const fill = `${(value / 10) * 100}%`;
  document.documentElement.style.setProperty("--slider-fill", fill);
  if (sliderBadge) {
    sliderBadge.textContent = `${value} / 10`;
  }
}

function startClock() {
  const renderTime = () => {
    const now = new Date();
    if (clockValue) {
      clockValue.textContent = now.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }
  };

  renderTime();
  window.setInterval(renderTime, 1000);
}

function showStudentView() {
  appState.currentView = "student";
  studentView?.classList.remove("hidden");
  lecturerView?.classList.add("hidden");
  studentNavBtn?.classList.add("active");
  lecturerNavBtn?.classList.remove("active");
}

function showLecturerView() {
  appState.currentView = "lecturer";
  lecturerView?.classList.remove("hidden");
  studentView?.classList.add("hidden");
  lecturerNavBtn?.classList.add("active");
  studentNavBtn?.classList.remove("active");
}

function openLecturerLockOrView() {
  if (appState.lecturerToken) {
    showLecturerView();
    return;
  }
  lecturerLock?.classList.remove("hidden");
  lockFeedback?.classList.add("hidden");
  if (lockPassword) {
    lockPassword.value = "";
    lockPassword.focus();
  }
}

function closeLecturerLock() {
  lecturerLock?.classList.add("hidden");
  lockFeedback?.classList.add("hidden");
}

async function unlockLecturer() {
  const password = lockPassword?.value || "";
  if (!password) {
    return;
  }

  try {
    const response = await fetch("/api/lecturer/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error("login_failed");
    }
    appState.lecturerToken = payload.token;
    sessionStorage.setItem("ibl-lecturer-token", payload.token);
    closeLecturerLock();
    connectLecturerSocket();
    showLecturerView();
  } catch (_error) {
    lockFeedback?.classList.remove("hidden");
  }
}

function connectStudentSocket() {
  if (!appState.studentSessionCode || !window.io) {
    return;
  }

  if (appState.studentSocket) {
    appState.studentSocket.disconnect();
  }

  appState.studentSocket = window.io({
    query: {
      role: "student",
      sessionCode: appState.studentSessionCode,
      clientId: appState.studentClientId
    }
  });

  appState.studentSocket.on("connect", () => {
    setStudentStatus("Mit aktiver Sitzung verbunden.", false, true);
  });

  appState.studentSocket.on("connect_error", () => {
    setStudentStatus("Diese Sitzung ist nicht mehr aktiv. Bitte QR-Code neu scannen.", true);
  });

  appState.studentSocket.on("session:update", handleSnapshot);
  appState.studentSocket.on("session:ended", () => {
    resetStudentForm(true);
    setStudentStatus("Die Sitzung wurde neu gestartet. Bitte QR-Code erneut scannen.", true);
    appState.studentSessionCode = "";
  });
}

function connectLecturerSocket() {
  if (!appState.lecturerToken || !window.io) {
    return;
  }

  if (appState.lecturerSocket) {
    appState.lecturerSocket.disconnect();
  }

  appState.lecturerSocket = window.io({
    query: {
      role: "lecturer",
      lecturerToken: appState.lecturerToken
    }
  });

  appState.lecturerSocket.on("session:update", handleSnapshot);
  appState.lecturerSocket.on("connect_error", () => {
    appState.lecturerToken = "";
    sessionStorage.removeItem("ibl-lecturer-token");
  });
}

function sendLostSignal() {
  if (!appState.studentSocket || !appState.studentSocket.connected) {
    setStudentStatus("Noch nicht mit einer aktiven Sitzung verbunden.", true);
    return;
  }

  const payload = {
    level: Number(lostSlider?.value || 0),
    slide: slideInput?.value ? Number(slideInput.value) : null,
    comment: (commentInput?.value || "").trim()
  };

  submitLostBtn.disabled = true;
  appState.studentSocket.emit("student:submit", payload, (response) => {
    submitLostBtn.disabled = false;
    if (!response?.ok) {
      setStudentStatus("Rueckmeldung konnte nicht gesendet werden.", true);
      return;
    }

    resetStudentForm(true);
  });
}

async function resetSession() {
  if (!appState.lecturerToken) {
    openLecturerLockOrView();
    return;
  }

  resetSessionBtn.disabled = true;
  try {
    const response = await fetch("/api/lecturer/session/reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appState.lecturerToken}`
      },
      body: JSON.stringify({})
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error("reset_failed");
    }

    handleSnapshot(payload.snapshot);
  } catch (_error) {
    window.alert("Neue Sitzung konnte nicht gestartet werden.");
  } finally {
    resetSessionBtn.disabled = false;
  }
}

function handleSnapshot(snapshot) {
  appState.snapshot = snapshot;
  if (!snapshot) {
    return;
  }

  currentCourse.textContent = snapshot.courseName;
  sessionCodeText.textContent = snapshot.sessionCode;
  connectedStudentsCount.textContent = String(snapshot.connectedStudents);
  recentLostCount.textContent = String(snapshot.recentLostCount);
  averageLostLabel.textContent = snapshot.averageLost.toFixed(1);

  teacherConnectedCount.textContent = String(snapshot.connectedStudents);
  teacherTotalSignals.textContent = String(snapshot.totalSignals);
  teacherAverageLost.textContent = snapshot.averageLost.toFixed(1);
  teacherSessionCode.textContent = snapshot.sessionCode;
  stormThresholdValue.textContent = String(snapshot.stormThreshold);
  sessionStartValue.textContent = `Sitzungsstart ${formatClock(snapshot.startedAt)}`;

  if (!appState.studentSessionCode && snapshot.sessionCode) {
    setStudentStatus("Scanne den QR-Code der Vorlesung oder oeffne den Join-Link.", false);
  }

  renderJoinUrl(snapshot.joinUrl);
  renderChartMount(liveChart, snapshot.currentSessionChart, "Noch keine Zeitreihe verfuegbar.");
  renderWeeklyCharts(snapshot.weeklyCharts);
  renderFeedbackTable(snapshot.liveFeedback);
}

function resetStudentForm(closeSheet = false) {
  if (commentInput) {
    commentInput.value = "";
  }
  if (slideInput) {
    slideInput.value = "";
  }
  if (lostSlider) {
    lostSlider.value = "5";
  }
  syncSliderVisual();
  studentFeedback?.classList.add("hidden");
  if (closeSheet) {
    studentStage?.classList.remove("form-open");
    lostForm?.classList.add("hidden");
  }
}

function renderJoinUrl(url) {
  if (!joinUrlLink || !qrCodeImage || !appState.snapshot) {
    return;
  }

  joinUrlLink.href = url;
  joinUrlLink.textContent = url;
  qrCodeImage.src = `/api/session/qr.svg?session=${encodeURIComponent(appState.snapshot.sessionCode)}`;
}

function renderFeedbackTable(rows) {
  if (!feedbackTableBody) {
    return;
  }

  feedbackTableBody.innerHTML = "";

  if (!rows || rows.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = '<td colspan="4"><div class="emptyState">Noch keine Rueckmeldungen in dieser Sitzung.</div></td>';
    feedbackTableBody.appendChild(emptyRow);
    return;
  }

  rows.forEach((item) => {
    const row = document.createElement("tr");
    if (item.level >= 8) {
      row.classList.add("critical");
    }

    const timeCell = document.createElement("td");
    timeCell.textContent = item.timeLabel;
    const slideCell = document.createElement("td");
    slideCell.textContent = item.slideLabel;
    const levelCell = document.createElement("td");
    levelCell.innerHTML = `<span class="lostLevelBadge">${item.level}/10</span>`;
    const commentCell = document.createElement("td");
    commentCell.textContent = item.commentLabel;

    row.append(timeCell, slideCell, levelCell, commentCell);
    feedbackTableBody.appendChild(row);
  });
}

function renderWeeklyCharts(charts) {
  if (!weeklyCharts) {
    return;
  }

  weeklyCharts.innerHTML = "";

  if (!charts || charts.length === 0) {
    weeklyCharts.innerHTML = '<div class="emptyState">Noch keine gespeicherten Sitzungen in dieser Woche.</div>';
    return;
  }

  charts.forEach((chartData) => {
    weeklyCharts.appendChild(createChartCard(chartData));
  });
}

function renderChartMount(container, chartData, emptyMessage) {
  if (!container) {
    return;
  }

  container.innerHTML = "";
  if (!chartData) {
    container.innerHTML = `<div class="emptyState">${emptyMessage}</div>`;
    return;
  }
  container.appendChild(createChartCard(chartData));
}

function createChartCard(chartData) {
  const card = document.createElement("div");
  card.className = "chartCard";

  const title = document.createElement("h3");
  title.className = "chartTitle";
  title.textContent = chartData.title;
  card.appendChild(title);

  if (chartData.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "chartSubline";
    subtitle.textContent = chartData.subtitle;
    card.appendChild(subtitle);
  }

  const shell = document.createElement("div");
  shell.className = "chartShell";

  const yAxis = document.createElement("div");
  yAxis.className = "yAxis";
  chartData.yAxis.forEach((value) => {
    const span = document.createElement("span");
    span.textContent = String(value);
    yAxis.appendChild(span);
  });

  const body = document.createElement("div");
  body.className = "chartBody";
  const plotFrame = document.createElement("div");
  plotFrame.className = "plotFrame";

  if (chartData.threshold > 0) {
    const thresholdLine = document.createElement("div");
    thresholdLine.className = "threshold";
    const thresholdRatio = chartData.threshold / chartData.maxValue;
    if (thresholdRatio >= 0.78) {
      thresholdLine.classList.add("threshold-high");
    }
    thresholdLine.style.bottom = `${thresholdRatio * 100}%`;
    const thresholdLabel = document.createElement("span");
    thresholdLabel.textContent = `Lost-Strom ab ${chartData.threshold}`;
    thresholdLine.appendChild(thresholdLabel);
    plotFrame.appendChild(thresholdLine);
  }

  const barGrid = document.createElement("div");
  barGrid.className = "barGrid";
  barGrid.style.setProperty("--segments", chartData.segments.length);

  chartData.segments.forEach((segment) => {
    const slot = document.createElement("div");
    slot.className = "barSlot";

    const bar = document.createElement("div");
    bar.className = "bar";
    if (segment.isLive) {
      bar.classList.add("liveBar");
    }
    if (segment.isStorm) {
      bar.classList.add("stormBar");
    }
    bar.style.height = `${segment.value === 0 ? 2 : (segment.value / chartData.maxValue) * 100}%`;

    const valueBadge = document.createElement("span");
    valueBadge.className = "barValue";
    valueBadge.textContent = String(segment.value);
    bar.appendChild(valueBadge);

    if (segment.isStorm) {
      const stormBadge = document.createElement("span");
      stormBadge.className = "stormBadge";
      stormBadge.textContent = "kritisch";
      bar.appendChild(stormBadge);
    }

    slot.appendChild(bar);
    barGrid.appendChild(slot);
  });

  plotFrame.appendChild(barGrid);

  const xAxis = document.createElement("div");
  xAxis.className = "xAxis";
  xAxis.style.setProperty("--segments", chartData.segments.length);

  chartData.segments.forEach((segment) => {
    const tick = document.createElement("div");
    tick.className = "tick";
    if (segment.isLive) {
      tick.classList.add("liveTick");
    }

    const mark = document.createElement("span");
    mark.className = "tickMark";
    const label = document.createElement("span");
    label.className = "tickLabel";
    label.textContent = segment.label;

    tick.appendChild(mark);
    tick.appendChild(label);
    xAxis.appendChild(tick);
  });

  body.appendChild(plotFrame);
  body.appendChild(xAxis);
  shell.appendChild(yAxis);
  shell.appendChild(body);
  card.appendChild(shell);

  return card;
}

function formatClock(isoString) {
  if (!isoString) {
    return "--:--";
  }

  return new Date(isoString).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setStudentStatus(message, isError = false, isOk = false) {
  if (!studentConnectionStatus) {
    return;
  }
  studentConnectionStatus.textContent = message;
  studentConnectionStatus.classList.toggle("error", Boolean(isError));
  studentConnectionStatus.classList.toggle("ok", Boolean(isOk));
}
