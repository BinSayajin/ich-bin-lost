const urlParams = new URLSearchParams(window.location.search);
const initialSessionCode = (urlParams.get("session") || "").trim().toUpperCase();

const appState = {
  studentClientId: ensureClientId(),
  studentSessionCode: initialSessionCode,
  lecturerToken: sessionStorage.getItem("ibl-lecturer-token") || "",
  studentSocket: null,
  lecturerSocket: null,
  snapshot: null,
  currentView: "student",
  studentStatusTimer: null
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
const questionTypeInput = document.getElementById("questionTypeInput");
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
const endLectureBtn = document.getElementById("endLectureBtn");
const saveCourseBtn = document.getElementById("saveCourseBtn");
const courseNameInput = document.getElementById("courseNameInput");
const downloadAllLecturesBtn = document.getElementById("downloadAllLecturesBtn");
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
const lectureOverviewMount = document.getElementById("weeklyCharts");
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
  endLectureBtn?.addEventListener("click", endLecture);
  saveCourseBtn?.addEventListener("click", saveCourseName);
  courseNameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveCourseName();
    }
  });
  downloadAllLecturesBtn?.addEventListener("click", () => {
    downloadLecturesCsv();
  });
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
      document.getElementById(button.dataset.target)?.classList.remove("hidden");
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

  const categoryId = questionTypeInput?.value || "";
  if (!categoryId) {
    setStudentStatus("Bitte waehle einen Fragetyp aus.", true);
    return;
  }

  const payload = {
    categoryId,
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
  await callLecturerAction({
    button: resetSessionBtn,
    endpoint: "/api/lecturer/session/reset",
    errorMessage: "Neue Sitzung konnte nicht gestartet werden."
  });
}

async function endLecture() {
  await callLecturerAction({
    button: endLectureBtn,
    endpoint: "/api/lecturer/session/end",
    errorMessage: "Vorlesung konnte nicht beendet werden."
  });
}

async function saveCourseName() {
  if (!appState.lecturerToken || !courseNameInput) {
    return;
  }

  saveCourseBtn.disabled = true;
  try {
    const response = await fetch("/api/lecturer/session/course-name", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appState.lecturerToken}`
      },
      body: JSON.stringify({ courseName: courseNameInput.value })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error("course_save_failed");
    }

    handleSnapshot(payload.snapshot);
  } catch (_error) {
    window.alert("Vorlesungsname konnte nicht gespeichert werden.");
  } finally {
    saveCourseBtn.disabled = false;
  }
}

async function callLecturerAction({ button, endpoint, errorMessage }) {
  if (!appState.lecturerToken) {
    openLecturerLockOrView();
    return;
  }

  button.disabled = true;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appState.lecturerToken}`
      },
      body: JSON.stringify({
        courseName: courseNameInput?.value || ""
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error("lecturer_action_failed");
    }

    handleSnapshot(payload.snapshot);
  } catch (_error) {
    window.alert(errorMessage);
  } finally {
    button.disabled = false;
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
  if (courseNameInput && document.activeElement !== courseNameInput) {
    courseNameInput.value = snapshot.courseName;
  }

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
  renderLectureOverview(snapshot.lectureOverview || []);
  renderFeedbackTable(snapshot.liveFeedback);
}

function resetStudentForm(closeSheet = false) {
  if (commentInput) {
    commentInput.value = "";
  }
  if (slideInput) {
    slideInput.value = "";
  }
  if (questionTypeInput) {
    questionTypeInput.value = "concept";
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
    emptyRow.innerHTML = '<td colspan="5"><div class="emptyState">Noch keine Rueckmeldungen in dieser Sitzung.</div></td>';
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
    const typeCell = document.createElement("td");
    typeCell.textContent = item.categoryLabel;
    const slideCell = document.createElement("td");
    slideCell.textContent = item.slideLabel;
    const levelCell = document.createElement("td");
    levelCell.innerHTML = `<span class="lostLevelBadge">${item.level}/10</span>`;
    const commentCell = document.createElement("td");
    commentCell.textContent = item.commentLabel;

    row.append(timeCell, typeCell, slideCell, levelCell, commentCell);
    feedbackTableBody.appendChild(row);
  });
}

function renderLectureOverview(lectures) {
  if (!lectureOverviewMount) {
    return;
  }

  lectureOverviewMount.innerHTML = "";

  if (!lectures.length) {
    lectureOverviewMount.innerHTML = '<div class="emptyState">Noch keine abgeschlossenen Vorlesungen gespeichert.</div>';
    return;
  }

  lectures.forEach((lecture) => {
    const card = document.createElement("article");
    card.className = "historyCard";

    const header = document.createElement("div");
    header.className = "historyHeader";
    header.innerHTML = `
      <div>
        <h3 class="historyTitle">${lecture.courseName}</h3>
        <p class="historyDate">${formatDateTimeRange(lecture.startedAt, lecture.endedAt)}</p>
      </div>
      <button class="secondaryBtn historyDownloadBtn" type="button">CSV</button>
    `;

    header.querySelector(".historyDownloadBtn")?.addEventListener("click", () => {
      downloadLecturesCsv(lecture.id);
    });

    const stats = document.createElement("div");
    stats.className = "historyStats";
    stats.innerHTML = `
      <div class="historyStat"><span>Signale</span><strong>${lecture.totalSignals}</strong></div>
      <div class="historyStat"><span>Durchschnitt</span><strong>${Number(lecture.averageLost).toFixed(1)}</strong></div>
      <div class="historyStat"><span>Lost-Strom</span><strong>${lecture.threshold}</strong></div>
    `;

    const categories = document.createElement("div");
    categories.className = "historyCategories";
    (lecture.topCategories || []).forEach((entry) => {
      const chip = document.createElement("div");
      chip.className = "categoryChip";
      chip.innerHTML = `<span>${entry.label}</span><strong>${entry.count}</strong>`;
      categories.appendChild(chip);
    });

    const chartWrap = document.createElement("div");
    chartWrap.className = "historyChartWrap";
    chartWrap.appendChild(createChartCard({
      ...lecture.chart,
      title: "Verlauf"
    }));

    card.append(header, stats, categories, chartWrap);
    lectureOverviewMount.appendChild(card);
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

    tick.append(mark, label);
    xAxis.appendChild(tick);
  });

  body.append(plotFrame, xAxis);
  shell.append(yAxis, body);
  card.appendChild(shell);

  return card;
}

async function downloadLecturesCsv(lectureId = "") {
  if (!appState.lecturerToken) {
    openLecturerLockOrView();
    return;
  }

  const url = lectureId
    ? `/api/lectures/export?lectureId=${encodeURIComponent(lectureId)}`
    : "/api/lectures/export";

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${appState.lecturerToken}`
      }
    });

    if (!response.ok) {
      throw new Error("download_failed");
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = lectureId ? `vorlesung-${lectureId}.csv` : "vorlesungsuebersicht-letzte-3.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(downloadUrl);
  } catch (_error) {
    window.alert("CSV konnte nicht heruntergeladen werden.");
  }
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

function formatDateTimeRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = start.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  });
  return `${date} | ${start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} - ${end.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

function setStudentStatus(message, isError = false, isOk = false) {
  if (!studentConnectionStatus) {
    return;
  }

  if (appState.studentStatusTimer) {
    window.clearTimeout(appState.studentStatusTimer);
    appState.studentStatusTimer = null;
  }

  studentConnectionStatus.textContent = message;
  studentConnectionStatus.classList.toggle("error", Boolean(isError));
  studentConnectionStatus.classList.toggle("ok", Boolean(isOk));

  if (isOk) {
    appState.studentStatusTimer = window.setTimeout(() => {
      studentConnectionStatus.textContent = "";
      studentConnectionStatus.classList.remove("error", "ok");
      appState.studentStatusTimer = null;
    }, 1000);
  }
}
