import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  CalendarDays,
  Clock3,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CircleUserRound,
  ClipboardList,
  Copy,
  Check,
  Eye,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  Trophy,
  Goal,
  UserPlus,
  Users,
  X,
  Search,
  MapPin,
  Info,
  Download,
} from "lucide-react";
import { auth, db, firebaseMissingConfig } from "./firebase";
import { formatMoney, calculatePlayerMatchFee, calculatePlayerMatchPayment, calculatePlayerMatchFinancials, calculatePlayerBalance, getPlayerFinancials } from "./financial";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

const money = (n) => formatMoney(n);
const signedMoney = (n) => formatMoney(n);
const finiteTaka = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const dateLabel = (s) =>
  new Date(`${s}T00:00:00`)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();

const normalizeMatchSearchText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getMatchSearchValues = (item, index) => {
  const rawDate = String(item?.date || "");
  const [year = "", month = "", day = ""] = rawDate.split("-");
  const monthNumber = month ? String(Number(month)) : "";
  const dayNumber = day ? String(Number(day)) : "";
  const matchNumber = String(index + 1);
  const teamA = String(item?.teamAName || "Team A").trim();
  const teamB = String(item?.teamBName || "Team B").trim();
  const formatted = rawDate ? dateLabel(rawDate) : "";

  return [
    matchNumber,
    `match ${matchNumber}`,
    rawDate,
    formatted,
    `${day} ${month} ${year}`,
    `${dayNumber} ${monthNumber} ${year}`,
    `${monthNumber} ${dayNumber} ${year}`,
    `${year} ${month} ${day}`,
    `${year} ${monthNumber} ${dayNumber}`,
    `${day}/${month}/${year}`,
    `${dayNumber}/${monthNumber}/${year}`,
    `${day}-${month}-${year}`,
    `${dayNumber}-${monthNumber}-${year}`,
    teamA,
    teamB,
    `${teamA} ${teamB}`,
    getMatchupLabel(item),
  ].map(normalizeMatchSearchText).filter(Boolean);
};

const matchesSearchQuery = (item, index, query) => {
  const normalizedQuery = normalizeMatchSearchText(query);
  if (!normalizedQuery) return true;

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const values = getMatchSearchValues(item, index);

  return values.some(
    (value) =>
      value.includes(normalizedQuery) ||
      queryTokens.every((token) => value.includes(token)),
  );
};

const timeLabel = (s) => {
  if (!s) return "";
  const [h, m] = String(s).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(s);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const currentTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const getMatchDateTime = (match) => {
  if (!match?.date) return null;
  const [year, month, day] = String(match.date).split("-").map(Number);
  const time = String(match.startTime || match.time || "00:00");
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
};

const getDayLabel = (date) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
  });

const formatCountdown = (target, now = new Date()) => {
  if (!target) return "";
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "Starting now";
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (!days && !hours) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return `Starts in ${parts.slice(0, 2).join(" ")}`;
};

const getNextMatch = (list, now = new Date()) =>
  [...list]
    .filter((m) => {
      const start = getMatchDateTime(m);
      return start && start.getTime() > now.getTime();
    })
    .sort((a, b) => getMatchDateTime(a) - getMatchDateTime(b))[0] || null;

const getUpcomingMatches = (matches, now = new Date()) =>
  [...matches]
    .filter((match) => {
      const start = getMatchDateTime(match);
      return start?.getTime() > now.getTime();
    })
    .sort((a, b) => getMatchDateTime(a).getTime() - getMatchDateTime(b).getTime());

const fullScheduleDateLabel = (value) => {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const getUpcomingScheduleDetails = (matches, now = new Date()) =>
  getUpcomingMatches(matches, now).map((match) => {
    const participants = Array.isArray(match.participants) ? match.participants : [];
    const perPerson = participants.length
      ? Number(match.totalAmount || 0) / participants.length
      : null;
    return {
      match,
      date: fullScheduleDateLabel(match.date),
      startTime: timeLabel(match.startTime || match.time),
      endTime: match.endTime ? timeLabel(match.endTime) : "",
      location: String(match.location || "Location unavailable"),
      perPerson,
    };
  });

const buildUpcomingScheduleMessage = (matches, now = new Date()) => {
  const upcoming = getUpcomingScheduleDetails(matches, now);
  const lines = ["⚽ TURFCLUB — UPCOMING MATCHES", ""];
  upcoming.forEach(({ date, startTime, endTime, location, perPerson }, index) => {
    lines.push(date);
    lines.push(endTime ? `${startTime} to ${endTime}` : startTime);
    lines.push(`📍 ${location}`);
    lines.push(`💰 Per Person: ${perPerson == null ? "N/A" : money(perPerson)}`);
    if (index < upcoming.length - 1) lines.push("");
  });
  lines.push("", "See you on the field! ⚽");
  return { text: lines.join("\n"), matches: upcoming };
};

const copyTextToClipboard = async (text) => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      helper.setAttribute("readonly", "");
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(helper);
      return copied;
    } catch {
      return false;
    }
  }
};

const buildUpcomingScheduleImage = (matches, now = new Date()) => {
  const details = getUpcomingScheduleDetails(matches, now);
  const width = 1080;
  const padding = 72;
  const blockHeight = 190;
  const gap = 20;
  const headerHeight = 250;
  const footerHeight = 150;
  const height = Math.max(
    1350,
    headerHeight + footerHeight + details.length * blockHeight +
      Math.max(0, details.length - 1) * gap + padding * 2,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#06100b";
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, 0, 20, width / 2, 0, 620);
  glow.addColorStop(0, "#173b26");
  glow.addColorStop(1, "#06100b");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, Math.min(height, 620));

  ctx.fillStyle = "#b7ff4a";
  ctx.font = '800 24px Inter, system-ui, sans-serif';
  ctx.fillText("TURFCLUB", padding, 82);
  ctx.fillStyle = "#f4f7f4";
  ctx.font = '900 58px Inter, system-ui, sans-serif';
  ctx.fillText("UPCOMING MATCHES", padding, 155);
  ctx.fillStyle = "#91a397";
  ctx.font = '500 22px Inter, system-ui, sans-serif';
  ctx.fillText(
    `${details.length} upcoming match${details.length === 1 ? "" : "es"}`,
    padding,
    198,
  );

  details.forEach(({ date, startTime, endTime, location, perPerson }, index) => {
    const y = headerHeight + index * (blockHeight + gap);
    ctx.fillStyle = "#0d1b14";
    ctx.strokeStyle = "#20382a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(padding, y, width - padding * 2, blockHeight, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#b7ff4a";
    ctx.font = '800 30px Inter, system-ui, sans-serif';
    ctx.fillText(date.toUpperCase(), padding + 28, y + 48);

    ctx.fillStyle = "#f4f7f4";
    ctx.font = '900 38px Inter, system-ui, sans-serif';
    ctx.fillText(
      endTime ? `${startTime} to ${endTime}` : startTime,
      padding + 28,
      y + 96,
    );

    ctx.fillStyle = "#91a397";
    ctx.font = '600 24px Inter, system-ui, sans-serif';
    ctx.fillText(`📍  ${location}`, padding + 28, y + 137);

    ctx.textAlign = "right";
    ctx.fillStyle = "#91a397";
    ctx.font = '700 18px Inter, system-ui, sans-serif';
    ctx.fillText("PER PERSON", width - padding - 28, y + 48);
    ctx.fillStyle = "#b7ff4a";
    ctx.font = '900 32px Inter, system-ui, sans-serif';
    ctx.fillText(
      perPerson == null ? "N/A" : money(perPerson),
      width - padding - 28,
      y + 91,
    );
    ctx.textAlign = "left";
  });

  ctx.fillStyle = "#b7ff4a";
  ctx.font = '900 25px Inter, system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("SEE YOU ON THE FIELD ⚽", width / 2, height - 78);
  ctx.fillStyle = "#53665a";
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.fillText("TURFCLUB • UPCOMING MATCH SCHEDULE", width / 2, height - 42);
  ctx.textAlign = "left";
  return canvas;
};

const buildReminderImage = (match, now = new Date()) => {
  const reminder = buildReminderMessage(match, now);
  const width = 1080;
  const height = 1080;
  const padding = 78;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const fitText = (text, maxWidth, weight, baseSize, minSize = 26, family = 'Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif') => {
    const value = String(text || "");
    let size = baseSize;
    while (size > minSize) {
      ctx.font = `${weight} ${size}px ${family}`;
      if (ctx.measureText(value).width <= maxWidth) return { value, size, font: ctx.font };
      size -= 1;
    }
    ctx.font = `${weight} ${minSize}px ${family}`;
    return { value, size: minSize, font: ctx.font };
  };

  const cleanNote = (value) => String(value || "").trim().replace(/\s*,\s*/g, ", ");

  // Red + black match-night visual system. Layout and information hierarchy remain unchanged.
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, width, height);

  // Deep crimson stadium atmosphere.
  const topGlow = ctx.createRadialGradient(width * 0.7, 35, 10, width * 0.7, 35, 700);
  topGlow.addColorStop(0, "#6f1119");
  topGlow.addColorStop(0.35, "#2a090d");
  topGlow.addColorStop(1, "#050505");
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, width, 780);

  const bottomGlow = ctx.createRadialGradient(width * 0.15, height * 0.9, 30, width * 0.15, height * 0.9, 430);
  bottomGlow.addColorStop(0, "#451016");
  bottomGlow.addColorStop(1, "#050505");
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = bottomGlow;
  ctx.fillRect(0, 720, width, height - 720);
  ctx.globalAlpha = 1;

  // Subtle stadium floodlights.
  const lightSpots = [
    { x: 90, y: 30, r: 210, alpha: 0.13 },
    { x: width - 100, y: 20, r: 260, alpha: 0.15 },
  ];
  lightSpots.forEach(({ x, y, r, alpha }) => {
    const g = ctx.createRadialGradient(x, y, 4, x, y, r);
    g.addColorStop(0, `rgba(255,220,220,${alpha + 0.08})`);
    g.addColorStop(0.22, `rgba(255,60,72,${alpha})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, 380);
  });

  // Stadium-light bars and restrained motion streaks.
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#ff3141";
  ctx.fillRect(width - 270, 0, 184, 5);
  ctx.fillRect(width - 325, 15, 260, 2);
  ctx.fillRect(78, 16, 210, 2);
  ctx.fillStyle = "#7b1019";
  ctx.fillRect(78, 29, 150, 2);
  ctx.restore();

  // Subtle pitch-line texture in the lower field area.
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = "#7a1a23";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(width / 2, height + 70, 430, 215, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(150, 1115);
  ctx.lineTo(width - 150, 1115);
  ctx.stroke();
  for (let i = 0; i < 8; i += 1) {
    const y = 1050 + i * 34;
    ctx.beginPath();
    ctx.moveTo(120, y);
    ctx.lineTo(width - 120, y + 70);
    ctx.stroke();
  }
  ctx.restore();

  // Small premium red particles.
  const particles = [
    [118, 175, 2], [946, 182, 2], [1002, 288, 1.5], [96, 420, 1.5],
    [940, 520, 2], [175, 790, 1.5], [900, 850, 1.5], [1005, 1030, 2],
    [110, 1065, 1.5], [860, 1085, 1.5],
  ];
  ctx.save();
  particles.forEach(([x, y, r], i) => {
    ctx.globalAlpha = 0.18 + (i % 3) * 0.05;
    ctx.fillStyle = "#ff4250";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  const dateText = new Date(`${match.date}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).toUpperCase();
  const startTime = timeLabel(match.startTime || match.time);
  const endTime = match.endTime ? timeLabel(match.endTime) : "";
  const timeText = endTime ? `${startTime} — ${endTime}` : startTime;
  const location = String(match.location || "Turf field").trim() || "Turf field";
  const note = cleanNote(String(match.note || "").slice(0, 20));
  const perPerson = match.participants?.length
    ? Number(match.totalAmount || 0) / match.participants.length
    : null;
  const perPersonText = perPerson === null ? "N/A" : money(perPerson);
  const matchup = getMatchupLabel(match);

  // Brand + visual cue.
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 44px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif';
  ctx.fillText("TURFCLUB", padding, 92);

  ctx.fillStyle = "#ff3344";
  ctx.font = '800 19px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif';
  ctx.fillText("MATCH NIGHT", padding, 126);

  // Single-match hero frame: same size/placement, red-black visual treatment only.
  const heroX = padding;
  const heroY = 205;
  const heroW = width - padding * 2;
  const heroH = 650;
  const heroGradient = ctx.createLinearGradient(heroX, heroY, heroX + heroW, heroY + heroH);
  heroGradient.addColorStop(0, "#161012");
  heroGradient.addColorStop(0.48, "#0d0b0c");
  heroGradient.addColorStop(1, "#1c0c0f");
  ctx.fillStyle = heroGradient;
  ctx.strokeStyle = "#9f1e2a";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(255,42,58,0.28)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.roundRect(heroX, heroY, heroW, heroH, 34);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Red edge lighting.
  const edgeGradient = ctx.createLinearGradient(heroX, heroY, heroX, heroY + heroH);
  edgeGradient.addColorStop(0, "#ff3647");
  edgeGradient.addColorStop(0.55, "#9f1e2a");
  edgeGradient.addColorStop(1, "#4a0f16");
  ctx.fillStyle = edgeGradient;
  ctx.fillRect(heroX, heroY + 42, 7, heroH - 84);
  ctx.fillStyle = "#7e1822";
  ctx.fillRect(heroX + heroW - 7, heroY + 42, 7, heroH - 84);

  ctx.fillStyle = "#ff3c4e";
  ctx.font = '800 21px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif';
  ctx.fillText("MATCH REMINDER", heroX + 42, heroY + 64);

  // Matchup stays in the same hero position, but scales responsively and
  // keeps Bengali-capable fallbacks so long team names never clip.
  const matchupMaxWidth = heroW - 84;
  const matchupParts = matchup.split(/(\s+vs\s+)/i);
  let matchupSize = 72;
  if (matchupParts.length >= 3) {
    for (; matchupSize >= 38; matchupSize -= 1) {
      ctx.font = `950 ${matchupSize}px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif`;
      const totalWidth = matchupParts.reduce((sum, part) => sum + ctx.measureText(part).width, 0);
      if (totalWidth <= matchupMaxWidth) break;
    }
    let cursorX = heroX + 42;
    matchupParts.forEach((part) => {
      const isVs = /^\s*vs\s*$/i.test(part);
      ctx.font = `950 ${matchupSize}px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif`;
      ctx.fillStyle = isVs ? "#ff3344" : "#ffffff";
      ctx.fillText(part, cursorX, heroY + 150);
      cursorX += ctx.measureText(part).width;
    });
  } else {
    const fitted = fitText(matchup, matchupMaxWidth, 950, 72, 38);
    ctx.font = fitted.font;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fitted.value, heroX + 42, heroY + 150);
  }

  // Subtle aggressive divider accent beneath matchup.
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#67131c";
  ctx.beginPath();
  ctx.moveTo(heroX + 42, heroY + 172);
  ctx.lineTo(heroX + 300, heroY + 165);
  ctx.lineTo(heroX + 245, heroY + 178);
  ctx.lineTo(heroX + 42, heroY + 184);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#ff3a49";
  ctx.font = '950 39px Inter, system-ui, sans-serif';
  ctx.fillText(dateText, heroX + 42, heroY + 238);

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(255,52,68,0.22)";
  ctx.shadowBlur = 10;
  const fittedTime = fitText(timeText, heroW - 84, 900, 52, 34);
  ctx.font = fittedTime.font;
  ctx.fillText(fittedTime.value, heroX + 42, heroY + 322);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#f1e7e9";
  const fittedLocation = fitText(`📍  ${location}`, heroW - 84, 700, 28, 22);
  ctx.font = fittedLocation.font;
  ctx.fillText(fittedLocation.value, heroX + 42, heroY + 385);

  if (note) {
    ctx.fillStyle = "#d8c1c4";
    const fittedNote = fitText(`📝  ${note}`, heroW - 84, 600, 21, 17);
    ctx.font = fittedNote.font;
    ctx.fillText(fittedNote.value, heroX + 42, heroY + 420);
  }

  // Per-person spotlight block remains in the exact same position/size.
  const feeX = heroX + 42;
  const feeY = heroY + 430;
  const feeW = heroW - 84;
  const feeH = 150;
  const feeGradient = ctx.createLinearGradient(feeX, feeY, feeX + feeW, feeY);
  feeGradient.addColorStop(0, "#140c0f");
  feeGradient.addColorStop(1, "#220d12");
  ctx.fillStyle = feeGradient;
  ctx.strokeStyle = "#a62430";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(255,44,60,0.20)";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.roundRect(feeX, feeY, feeW, feeH, 22);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#ff3b4b";
  ctx.font = '850 20px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif';
  ctx.fillText("PER PERSON", feeX + 28, feeY + 44);

  // Red currency symbol, white amount.
  const currencySymbol = perPersonText.startsWith("৳") ? "৳" : "";
  const amountBody = currencySymbol ? perPersonText.slice(1) : perPersonText;
  ctx.fillStyle = "#ff3344";
  ctx.font = '900 58px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif';
  ctx.fillText(currencySymbol, feeX + 28, feeY + 106);
  const symbolWidth = ctx.measureText(currencySymbol).width;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(amountBody, feeX + 28 + symbolWidth + 6, feeY + 106);

  if (reminder.countdownText && !reminder.isPast) {
    ctx.fillStyle = "#f6eef0";
    const fittedCountdown = fitText(`⏱  ${reminder.countdownText}`, heroW - 84, 650, 19, 16);
    ctx.font = fittedCountdown.font;
    ctx.fillText(fittedCountdown.value, heroX + 42, heroY + heroH - 24);
  }

  // Keep the lower section clean: no large football graphic or ball-related effects.

  ctx.fillStyle = "#ffffff";
  ctx.font = '850 29px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("SEE YOU ON THE FIELD ⚽", width / 2, 930);
  ctx.fillStyle = "#a98f94";
  ctx.font = '650 15px Inter, "Noto Sans Bengali", "Noto Sans", system-ui, sans-serif';
  ctx.fillText("TURFCLUB • MATCH NIGHT REMINDER", width / 2, 966);
  ctx.textAlign = "left";

  return canvas;
};

// Option A calculation boundary: completed matches keep permanent records;
// only the first match that has not finished yet is active. Later matches are frozen.
const getActiveCalculationMatch = (list, now = new Date()) =>
  getMatchOrder(list).find((m) => !isMatchCompleted(m, now)) || null;

const getMatchupLabel = (match) =>
  `${String(match?.teamAName || "Team A").trim() || "Team A"} vs ${String(
    match?.teamBName || "Team B",
  ).trim() || "Team B"}`;

let bodyScrollLockCount = 0;
let bodyScrollLockRestore = null;

const useBodyScrollLock = (locked) => {
  useEffect(() => {
    if (!locked || typeof document === "undefined") return undefined;
    if (bodyScrollLockCount === 0) {
      bodyScrollLockRestore = {
        overflow: document.body.style.overflow,
        touchAction: document.body.style.touchAction,
        overscrollBehavior: document.documentElement.style.overscrollBehavior,
      };
      document.body.style.overflow = "hidden";
      // Do not disable touch on the document: modal inner scrollers still need
      // normal vertical gestures and iOS Safari can otherwise trap the page.
      document.documentElement.style.overscrollBehavior = "none";
    }
    bodyScrollLockCount += 1;
    return () => {
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
      if (bodyScrollLockCount === 0 && bodyScrollLockRestore) {
        document.body.style.overflow = bodyScrollLockRestore.overflow;
        document.body.style.touchAction = bodyScrollLockRestore.touchAction;
        document.documentElement.style.overscrollBehavior = bodyScrollLockRestore.overscrollBehavior;
        bodyScrollLockRestore = null;
      }
    };
  }, [locked]);
};

let escapeHandlers = new Set();
let escapeListenerAttached = false;

const ensureEscapeListener = () => {
  if (escapeListenerAttached || typeof document === "undefined") return;
  const listener = (event) => {
    if (event.key !== "Escape") return;
    const handlers = [...escapeHandlers];
    const handler = handlers[handlers.length - 1];
    if (handler) {
      event.preventDefault();
      handler();
    }
  };
  document.addEventListener("keydown", listener);
  escapeListenerAttached = true;
};

const useEscapeHandler = (enabled, onEscape) => {
  useEffect(() => {
    if (!enabled || typeof onEscape !== "function" || typeof document === "undefined") return undefined;
    ensureEscapeListener();
    escapeHandlers.add(onEscape);
    return () => escapeHandlers.delete(onEscape);
  }, [enabled, onEscape]);
};

const OverlayPortal = ({ children }) =>
  typeof document === "undefined" ? null : createPortal(children, document.body);

const addOneHour = (s) => {
  const [h, m] = String(s || "")
    .split(":")
    .map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  const total = (h * 60 + m + 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const normalizeNumericInput = (value) => {
  const raw = String(value ?? "").replace(/[^0-9.]/g, "");
  if (!raw) return "";
  const firstDot = raw.indexOf(".");
  const wholeRaw = firstDot === -1 ? raw : raw.slice(0, firstDot);
  const decimalRaw = firstDot === -1 ? "" : raw.slice(firstDot + 1).replace(/\./g, "");
  const normalizedWhole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  return decimalRaw ? `${normalizedWhole}.${decimalRaw}` : normalizedWhole;
};

const PLAYER_POSITIONS = [
  { value: "GK", label: "Goalkeeper", short: "GK" },
  { value: "CB", label: "Centre Back", short: "CB" },
  { value: "LB", label: "Left Back", short: "LB" },
  { value: "RB", label: "Right Back", short: "RB" },
  { value: "DM", label: "Defensive Midfielder", short: "DM" },
  { value: "CM", label: "Central Midfielder", short: "CM" },
  { value: "AM", label: "Attacking Midfielder", short: "AM" },
  { value: "LW", label: "Left Winger", short: "LW" },
  { value: "RW", label: "Right Winger", short: "RW" },
  { value: "CF", label: "Centre Forward", short: "CF" },
  { value: "ST", label: "Striker", short: "ST" },
];

const getPlayerPosition = (value) =>
  PLAYER_POSITIONS.find((item) => item.value === value) || null;

// Formation is derived independently from each team's assigned player count.
// There is intentionally no manual formation selector or global match formation.
const AUTO_FORMATIONS = {
  1: "1",
  2: "1-1",
  3: "1-2",
  4: "1-2-1",
  5: "1-2-2",
  6: "1-2-1-2",
  7: "1-2-1-3",
  8: "1-3-1-3",
};

const getAutoFormation = (playerCount = 0) => {
  const count = Number(playerCount);
  return Number.isInteger(count) && count >= 1 ? AUTO_FORMATIONS[count] || null : null;
};

const JERSEY_COLOR_OPTIONS = [
  { key: "lime", label: "Lime", background: "#b7ff4a", text: "#11240c", sleeve: "#86d52e" },
  { key: "red", label: "Red", background: "#ff5f6d", text: "#2b0b0f", sleeve: "#da3545" },
  { key: "blue", label: "Blue", background: "#65a9ff", text: "#071a35", sleeve: "#3d7fd1" },
  { key: "yellow", label: "Yellow", background: "#ffd84a", text: "#2e2405", sleeve: "#e5b928" },
  { key: "white", label: "White", background: "#eef4ef", text: "#153020", sleeve: "#b7c7bb" },
  { key: "orange", label: "Orange", background: "#ff9f43", text: "#351a05", sleeve: "#dc7b1f" },
  { key: "purple", label: "Purple", background: "#b98cff", text: "#20102f", sleeve: "#8a5fd2" },
  { key: "black", label: "Black", background: "#25312b", text: "#eef4ef", sleeve: "#161d19" },
];

const DEFAULT_JERSEY_COLORS = { teamA: "lime", teamB: "white" };
const getJerseyTheme = (key, fallback = "lime") =>
  JERSEY_COLOR_OPTIONS.find((item) => item.key === key) ||
  JERSEY_COLOR_OPTIONS.find((item) => item.key === fallback) ||
  JERSEY_COLOR_OPTIONS[0];

const playerPositionLabel = (player) => {
  const position = getPlayerPosition(player?.position);
  return position ? `${position.label} (${position.short})` : "Position not set";
};

const sortPlayersByName = (list) =>
  [...list].sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
      sensitivity: "base",
      numeric: true,
    }),
  );

const slugifyPlayerName = (name) =>
  String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const getPlayerAvatarCandidates = (player) => {
  const explicitRaw = String(player?.avatarFile || player?.avatar || "").trim();
  const explicit = /\.(?:png|webp)(?:$|[?#])/i.test(explicitRaw) ? explicitRaw : "";
  const name = String(player?.name || "").trim();
  const fullSlug = slugifyPlayerName(name);
  const firstSlug = slugifyPlayerName(name.split(/\s+/)[0]);
  const candidates = [];
  const addPng = (value) => {
    if (!value) return;
    const normalized = /^https?:\/\//i.test(value)
      ? value
      : value.startsWith("/")
        ? value
        : value.startsWith("players/")
          ? `/${value}`
          : `/players/${value}`;
    const optimized = /^https?:\/\//i.test(normalized)
      ? normalized
      : normalized.replace(/\.png(?=$|[?#])/i, ".webp");
    if (/\.(?:png|webp)(?:$|[?#])/i.test(optimized)) candidates.push(optimized);
  };

  addPng(explicit);
  if (fullSlug) addPng(`${fullSlug}.webp`);
  if (firstSlug && firstSlug !== fullSlug) addPng(`${firstSlug}.webp`);

  // Every player without their own artwork uses the shared WebP avatar.
  candidates.push("/players/common.webp");
  return [...new Set(candidates)];
};

const PlayerAvatar = React.memo(function PlayerAvatar({ player, size = "md", className = "", alt }) {
  const candidates = useMemo(() => getPlayerAvatarCandidates(player), [player?.id, player?.name, player?.avatarFile, player?.avatar]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const src = candidates[candidateIndex] || "";
  const initials = String(player?.name || "?").trim().slice(0, 1).toUpperCase() || "?";

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates.join("|")]);

  return (
    <div className={`player-avatar player-avatar-${size} ${className}`.trim()} title={alt || player?.name || "Player"}>
      {src ? (
        <img
          src={src}
          alt={alt || player?.name || "Player"}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (candidateIndex < candidates.length - 1) setCandidateIndex((value) => value + 1);
            else setCandidateIndex(candidates.length);
          }}
        />
      ) : (
        <span className="player-avatar-fallback">{initials}</span>
      )}
    </div>
  );
});

function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite" aria-label="Loading TurfClub">
      <div className="splash-glow splash-glow-one" />
      <div className="splash-glow splash-glow-two" />
      <div className="splash-grid" aria-hidden="true" />

      <div className="splash-core">
        <div className="splash-badge">
          <span className="splash-badge-dot" />
          MATCH MANAGEMENT
        </div>

        <div className="pitch-mini" aria-hidden="true">
          <span className="pitch-mini-box pitch-mini-box-top" />
          <span className="pitch-mini-box pitch-mini-box-bottom" />
          <span className="pitch-mini-center-line" />
          <span className="pitch-mini-center-circle" />
          <span className="pitch-mini-dot" />
          <span className="ball">⚽</span>
        </div>

        <div className="splash-brand">
          <span>TURF</span><b>CLUB</b>
        </div>
        <div className="splash-sub">FOOTBALL · MATCHES · PLAYERS · BALANCE</div>

        <div className="splash-progress" aria-hidden="true">
          <span />
        </div>
        <div className="splash-status">
          <span>Preparing your club</span>
          <i />
        </div>
      </div>

      <div className="splash-footer">TURFCLUB <span>•</span> READY FOR KICKOFF</div>
    </div>
  );
}

function Auth({ onClose, onLoggedIn, setAppError }) {
  useBodyScrollLock(true);
  useEscapeHandler(true, onClose);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const humanError = (err) => {
    const code = err?.code || "";
    const messages = {
      "auth/invalid-credential": "Admin email or password is incorrect.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/network-request-failed":
        "Network error. Check your internet connection.",
      "auth/configuration-not-found":
        "Firebase Authentication is not configured for this web app. In Firebase Console, enable Email/Password under Authentication → Sign-in method, then restart Vite.",
      "auth/operation-not-allowed":
        "Email/Password sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method.",
      "auth/user-not-found": "No Firebase account exists for this email.",
      "auth/wrong-password": "The admin password is incorrect.",
      "auth/too-many-requests":
        "Too many failed attempts. Wait a little and try again.",
    };
    return messages[code] || err?.message || "Something went wrong.";
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setAppError("");
    setBusy(true);
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      const profileSnap = await getDoc(doc(db, "users", credential.user.uid));
      if (!profileSnap.exists() || profileSnap.data().role !== "admin") {
        await signOut(auth);
        throw new Error("This account is not an administrator account.");
      }
      onLoggedIn({ id: profileSnap.id, ...profileSnap.data() });
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPortal>
      <div className="modal-backdrop">
        <div className="modal auth-modal">
          <div className="modal-head">
            <div>
              <span className="eyebrow">ADMIN ACCESS</span>
              <h2>Management login</h2>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close match dialog">
              <X />
            </button>
          </div>
          <p className="muted">
            Everyone can view live match data without an account. Only the
            administrator can sign in and edit.
          </p>
          <form onSubmit={submit}>
            <label>
              Admin email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=""
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=""
                autoComplete="current-password"
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary full" type="submit" disabled={busy}>
              <LogIn size={18} />
              {busy ? "Checking..." : "Sign in as admin"}
            </button>
          </form>
        </div>
      </div>
    </OverlayPortal>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [tab, setTab] = useState("matches");
  const [topScorersOpen, setTopScorersOpen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [resultDetailMatchId, setResultDetailMatchId] = useState(null);
  const [playerLedgerMatchId, setPlayerLedgerMatchId] = useState(null);
  const [playerDetailId, setPlayerDetailId] = useState(null);
  const [appError, setAppError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    if (firebaseMissingConfig.length) {
      setUser(null);
      setProfile(null);
      setAuthReady(true);
      return undefined;
    }

    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        setAuthReady(true);
        return;
      }
      setUser(firebaseUser);
      try {
        const profileSnap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (!profileSnap.exists() || profileSnap.data().role !== "admin") {
          await signOut(auth);
          setUser(null);
          setProfile(null);
          setAppError("Only the administrator account can sign in.");
          return;
        }
        setProfile({ id: profileSnap.id, ...profileSnap.data() });
      } catch (err) {
        setAppError(`Could not load your Firebase profile: ${err.message}`);
      } finally {
        setAuthReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (firebaseMissingConfig.length) {
      setPlayers([]);
      setMatches([]);
      setDataReady(true);
      return undefined;
    }

    let playersLoaded = false;
    let matchesLoaded = false;
    const markDataReady = () => {
      if (playersLoaded && matchesLoaded) setDataReady(true);
    };

    const unsubPlayers = onSnapshot(
      collection(db, "players"),
      (snap) => {
        setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        playersLoaded = true;
        markDataReady();
      },
      (err) => {
        setAppError(`Players read failed: ${err.message}`);
        playersLoaded = true;
        markDataReady();
      },
    );

    const unsubMatches = onSnapshot(
      collection(db, "matches"),
      (snap) => {
        setMatches(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.date).localeCompare(String(a.date))),
        );
        matchesLoaded = true;
        markDataReady();
      },
      (err) => {
        setAppError(`Matches read failed: ${err.message}`);
        matchesLoaded = true;
        markDataReady();
      },
    );

    return () => {
      unsubPlayers();
      unsubMatches();
    };
  }, []);

  const handleTabChange = (nextTab) => {
    // Navigation must always win over any open detail/overlay page.
    setTopScorersOpen(false);
    setResultDetailMatchId(null);
    setPlayerLedgerMatchId(null);
    setPlayerDetailId(null);
    setShowAdminLogin(false);
    setTab(nextTab);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  const logout = async () => {
    if (!firebaseMissingConfig.length) {
      await signOut(auth);
    }
    setUser(null);
    setProfile(null);
    handleTabChange("matches");
  };

  const publicProfile = { role: "public", name: "Guest", email: "" };
  const activeProfile = profile || publicProfile;

  if (!authReady || !dataReady) {
    return <Splash />;
  }

  if (firebaseMissingConfig.length) {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="logo-mark">
            <Trophy size={20} />
          </div>
          <span className="eyebrow">FIREBASE SETUP REQUIRED</span>
          <h1>Connect TurfClub to Firebase</h1>
          <p>
            The TurfClub project is ready, but the Firebase Web App configuration has not
            been added yet.
          </p>
          <ol>
            <li>
              Copy <code>.env.example</code> to <code>.env.local</code>.
            </li>
            <li>
              Paste your Firebase Web App values into the six{" "}
              <code>VITE_FIREBASE_*</code> fields.
            </li>
            <li>
              Restart Vite with <code>npm run dev</code>.
            </li>
          </ol>
          <div className="error">
            Missing: {firebaseMissingConfig.join(", ")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Shell
      profile={activeProfile}
      isPublic={!user}
      tab={tab}
      setTab={handleTabChange}
      logout={logout}
      onAdminLogin={() => setShowAdminLogin(true)}
    >
      {appError && (
        <div className="firebase-alert">
          {appError}
          <button onClick={() => setAppError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {topScorersOpen ? (
        <TopScorersPage
          players={players}
          matches={matches}
          onClose={() => setTopScorersOpen(false)}
        />
      ) : resultDetailMatchId ? (
        <ResultDetailModal
          match={matches.find((m) => m.id === resultDetailMatchId) || null}
          players={players}
          isAdmin={activeProfile.role === "admin"}
          onClose={() => setResultDetailMatchId(null)}
          setAppError={setAppError}
        />
      ) : playerDetailId ? (
        <PlayerPublicProfile
          player={players.find((p) => p.id === playerDetailId) || null}
          matches={matches}
          onClose={() => setPlayerDetailId(null)}
        />
      ) : playerLedgerMatchId ? (
        <PlayerLedgerPage
          match={matches.find((m) => m.id === playerLedgerMatchId) || null}
          players={players}
          matches={matches}
          isAdmin={activeProfile.role === "admin"}
          setAppError={setAppError}
          onClose={() => setPlayerLedgerMatchId(null)}
          onMatchChange={setPlayerLedgerMatchId}
        />
      ) : (
        <>
          {tab === "matches" && (
            <Matches
              players={players}
              matches={matches}
              profile={activeProfile}
              setAppError={setAppError}
              selectedMatchId={selectedMatchId}
              setSelectedMatchId={setSelectedMatchId}
              onOpenPlayerLedger={setPlayerLedgerMatchId}
            />
          )}
          {tab === "results" && (
            <Results
              players={players}
              matches={matches}
              profile={activeProfile}
              setAppError={setAppError}
              onOpenMatch={setResultDetailMatchId}
              onOpenTopScorers={() => setTopScorersOpen(true)}
            />
          )}
          {tab === "players" && (
            <Players
              players={players}
              matches={matches}
              profile={activeProfile}
              setAppError={setAppError}
              onOpenPlayer={setPlayerDetailId}
            />
          )}
          {tab === "teams" && (
            <Teams
              players={players}
              matches={matches}
              profile={activeProfile}
              selectedMatchId={selectedMatchId}
              setSelectedMatchId={setSelectedMatchId}
              setAppError={setAppError}
            />
          )}
          {tab === "account" && user && profile && (
            <Account profile={profile} players={players} matches={matches} logout={logout} />
          )}
        </>
      )}
      {showAdminLogin && (
        <Auth
          onClose={() => setShowAdminLogin(false)}
          onLoggedIn={() => setShowAdminLogin(false)}
          setAppError={setAppError}
        />
      )}
    </Shell>
  );
}

function Shell({
  profile,
  isPublic,
  tab,
  setTab,
  logout,
  onAdminLogin,
  children,
}) {
  return (
    <div className="app-shell premium-shell" data-active-tab={tab}>
      <header className="topbar">
        <div className="top-brand">
          <div className="logo-mark">
            <Trophy size={17} />
          </div>
          <div>
            <div className="brand">
              TURF<span>CLUB</span>
            </div>
            <div className="tiny">FOOTBALL CLUB</div>
          </div>
        </div>
        {isPublic ? (
          <button className="admin-access" onClick={onAdminLogin}>
            <LockKeyhole size={15} />
          </button>
        ) : (
          <button
            className="icon-btn"
            onClick={() => setTab("account")}
            aria-label="Account"
          >
            <CircleUserRound size={22} />
          </button>
        )}
      </header>
      <main>{children}</main>
      <nav className={`bottom-nav ${isPublic ? "public" : ""}`}>
        <button
          className={tab === "matches" ? "active" : ""}
          onClick={() => setTab("matches")}
        >
          <ClipboardList />
          <span>Matches</span>
        </button>
        <button
          className={tab === "results" ? "active" : ""}
          onClick={() => setTab("results")}
        >
          <Trophy />
          <span>Results</span>
        </button>
        <button
          className={tab === "teams" ? "active" : ""}
          onClick={() => setTab("teams")}
        >
          <Goal />
          <span>Teams</span>
        </button>
        <button
          className={tab === "players" ? "active" : ""}
          onClick={() => setTab("players")}
        >
          <Users />
          <span>Players</span>
        </button>
      </nav>
    </div>
  );
}

function getMatchSortKey(match) {
  const date = String(match?.date || "");
  const time = String(match?.time || "");
  return `${date} ${time || "00:00"}`;
}

function getMatchEndMs(match) {
  const date = String(match?.date || "");
  const time = String(match?.endTime || match?.startTime || match?.time || "00:00");
  if (!date) return Number.NaN;
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
}

function isMatchCompleted(match, now = Date.now()) {
  const endMs = getMatchEndMs(match);
  return Number.isFinite(endMs) ? endMs <= now : false;
}

function getHistory(matches, playerId, beforeMatch) {
  const orderedMatches = getMatchOrder(matches);
  const beforeIndex = orderedMatches.findIndex((m) => m.id === beforeMatch?.id);
  const ordered = (beforeIndex >= 0 ? orderedMatches.slice(0, beforeIndex) : orderedMatches)
    .filter((m) => isMatchCompleted(m));

  return calculatePlayerBalance(playerId, ordered);
}

function getCurrent(match, playerId, previousBalanceMinor = 0, options = {}) {
  const active = options.active !== false;
  const completed = isMatchCompleted(match);
  const financials = calculatePlayerMatchFinancials(
    { id: playerId },
    match,
    [],
    previousBalanceMinor,
  );

  // Financial engine values are MINOR UNITS (1/1000 taka).
  // This function is the UI boundary: every financial field returned here
  // is converted to NORMAL TAKA exactly once before the UI calls money().
  const toUiTaka = (minor) => Number(minor || 0) / 1000;
  const uiFinancials = {
    selected: financials.selected,
    matchFee: toUiTaka(financials.matchFee),
    cashPaid: toUiTaka(financials.cashPaid),
    previousCreditUsed: toUiTaka(financials.previousCreditUsed),
    totalApplied: toUiTaka(financials.totalApplied),
    remainingDue: toUiTaka(financials.remainingDue),
    remainingCredit: toUiTaka(financials.remainingCredit),
    balance: toUiTaka(financials.balance),
    previousBalance: toUiTaka(previousBalanceMinor),
    status: financials.status,
  };

  return {
    ...uiFinancials,
    baseFee: uiFinancials.matchFee,
    paid: uiFinancials.cashPaid,
    required: uiFinancials.remainingDue,
    balanceAfter: uiFinancials.balance,
    completed,
    active,
  };
}

function matchCreatedAtMs(match) {
  const value = match?.createdAt;
  if (!value) return Number.MAX_SAFE_INTEGER;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function getMatchOrder(matches) {
  return [...matches].sort((a, b) => {
    const keyCompare = getMatchSortKey(a).localeCompare(getMatchSortKey(b));
    if (keyCompare !== 0) return keyCompare;
    const createdCompare = matchCreatedAtMs(a) - matchCreatedAtMs(b);
    if (createdCompare !== 0) return createdCompare;
    return String(a.id).localeCompare(String(b.id));
  });
}

function Matches({
  players,
  matches,
  profile,
  setAppError,
  selectedMatchId,
  setSelectedMatchId,
  onOpenPlayerLedger,
}) {
  const isAdmin = profile.role === "admin";
  // Match numbers are permanent chronological positions: earliest match is #1,
  // and a second match on the same date comes after the first one.
  const orderedMatches = getMatchOrder(matches);
  const cashData = useMemo(() => getCashOverviewData(matches, players), [matches, players]);
  const [clock, setClock] = useState(() => new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [editMatch, setEditMatch] = useState(null);
  const [reminderMatch, setReminderMatch] = useState(null);
  const [scheduleImageOpen, setScheduleImageOpen] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [cashOverviewOpen, setCashOverviewOpen] = useState(false);
  const [matchPickerOpen, setMatchPickerOpen] = useState(false);
  const [matchSearch, setMatchSearch] = useState("");

  useBodyScrollLock(matchPickerOpen);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const nextMatch = useMemo(() => getNextMatch(matches, clock), [matches, clock]);
  // When the Matches tab is opened, always land on the nearest upcoming
  // match rather than the last previously viewed/past match. Manual
  // navigation still works normally after the page is open.
  useEffect(() => {
    if (nextMatch?.id) setSelectedMatchId(nextMatch.id);
    else if (!selectedMatchId && orderedMatches.length) {
      setSelectedMatchId(orderedMatches[orderedMatches.length - 1].id);
    }
    // Intentionally run only when this Matches page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const preferredId = selectedMatchId || nextMatch?.id || orderedMatches[orderedMatches.length - 1]?.id || null;
  const activeId = orderedMatches.some((item) => item.id === preferredId) ? preferredId : orderedMatches[orderedMatches.length - 1]?.id || null;
  const activeIndex = orderedMatches.findIndex((m) => m.id === activeId);
  const match = activeIndex >= 0 ? orderedMatches[activeIndex] : null;
  const matchStart = getMatchDateTime(match);
  const isNextMatch = !!nextMatch && match?.id === nextMatch.id;
  const isPastMatch = !!matchStart && matchStart.getTime() <= clock.getTime();

  useEscapeHandler(matchPickerOpen, () => setMatchPickerOpen(false));

  useEffect(() => {
    if (match) setMatchSearch("");
  }, [activeId, match?.id]);

  const filteredMatches = orderedMatches.filter((item, index) =>
    matchesSearchQuery(item, index, matchSearch),
  );

  const selectMatch = (id) => {
    setSelectedMatchId(id);
    setMatchPickerOpen(false);
    setMatchSearch("");
  };

  const shiftMatch = (dir) => {
    if (!orderedMatches.length) return;
    const index = orderedMatches.findIndex((m) => m.id === activeId);
    const next = orderedMatches[index + dir];
    if (next) setSelectedMatchId(next.id);
  };

  const showScheduleNotice = (message) => {
    setScheduleNotice(message);
    window.clearTimeout(showScheduleNotice.timer);
    showScheduleNotice.timer = window.setTimeout(() => setScheduleNotice(""), 2400);
  };

  const openScheduleImage = () => {
    const latest = getUpcomingMatches(matches, new Date());
    if (!latest.length) {
      showScheduleNotice("No upcoming matches to preview.");
      return;
    }
    setScheduleImageOpen(true);
  };

  const removeMatch = async (id) => {
    if (!confirm("Delete this match?")) return;
    try {
      await deleteDoc(doc(db, "matches", id));
      if (id === activeId) {
        const next =
          orderedMatches[Math.max(0, activeIndex - 1)] ||
          orderedMatches[activeIndex + 1];
        setSelectedMatchId(next?.id || null);
      }
    } catch (err) {
      setAppError(`Could not delete match: ${err.message}`);
    }
  };

  return (
    <section className="page">
      <div className="hero">
        <div>
          <div className="eyebrow">MATCH CENTRE</div>
          <h2>Every match. Every balance.</h2>
          <p>
            Live Firebase data with previous and current balance side-by-side.
          </p>
        </div>
        <div className="match-hero-actions">
          <button
            type="button"
            className="schedule-action"
            onClick={openScheduleImage}
            title="Preview upcoming schedule image"
          >
            <ClipboardList size={15} />
            <span>SCHEDULE IMAGE</span>
          </button>
          {isAdmin && (
            <button
              className="round-primary"
              onClick={() => setShowCreate(true)}
              aria-label="Create match"
              title="Create match"
            >
              <Plus size={21} />
            </button>
          )}
        </div>
      </div>
      <div className="date-strip-wrap">
        <div className="date-strip">
          <button
            aria-label="Previous match"
            title="Previous match"
            disabled={!orderedMatches.length || activeIndex <= 0}
            onClick={() => shiftMatch(-1)}
          >
            <ChevronLeft />
          </button>
          <button
            className="date-picker-trigger"
            onClick={() => setMatchPickerOpen((v) => !v)}
            aria-expanded={matchPickerOpen}
            aria-haspopup="listbox"
          >
            <span className="date-label">
              {match ? dateLabel(match.date) : "NO MATCH"}
            </span>
            <small>
              {orderedMatches.length
                ? `${isNextMatch ? "NEXT MATCH • " : ""}MATCH ${Math.max(1, activeIndex + 1)} OF ${orderedMatches.length}`
                : "SELECT MATCH DATE"}
            </small>
          </button>
          <button
            aria-label="Next match"
            title="Next match"
            disabled={
              !orderedMatches.length ||
              activeIndex < 0 ||
              activeIndex >= orderedMatches.length - 1
            }
            onClick={() => shiftMatch(1)}
          >
            <ChevronRight />
          </button>
        </div>
        {matchPickerOpen && (
          <div className="match-picker">
            <div className="match-search-wrap">
              <Search size={15} />
              <input
                autoFocus
                type="search"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                autoComplete="off"
                spellCheck="false"
                inputMode="search"
                enterKeyHint="search"
                placeholder="Search match number, team or date"
                aria-label="Search match number, team, or date"
              />
              {matchSearch && (
                <button
                  type="button"
                  className="match-search-clear"
                  onClick={() => setMatchSearch("")}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="match-picker-list" role="listbox">
              {filteredMatches.length ? (
                filteredMatches.map((item) => {
                  const index = orderedMatches.findIndex(
                    (x) => x.id === item.id,
                  );
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`match-picker-item ${item.id === activeId ? "selected" : ""} ${nextMatch?.id === item.id ? "next-item" : ""}`}
                      onClick={() => selectMatch(item.id)}
                      role="option"
                      aria-selected={item.id === activeId}
                    >
                      <span>{dateLabel(item.date)}</span>
                      <small>
                        {nextMatch?.id === item.id
                          ? "NEXT MATCH"
                          : getMatchDateTime(item)?.getTime() > clock.getTime()
                            ? "UPCOMING"
                            : `MATCH ${index + 1}`}
                      </small>
                    </button>
                  );
                })
              ) : (
                <div className="match-picker-empty">
                  No matching date found.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {!match ? (
        <div className="empty">
          <CalendarDays />
          <h3>No match on this date</h3>
          <p>
            {isAdmin
              ? "Create the first match from the + button."
              : "There is no match scheduled for this date."}
          </p>
        </div>
      ) : (
        <MatchView
          players={players}
          matches={matches}
          match={match}
          isAdmin={isAdmin}
          setAppError={setAppError}
          onEdit={() => setEditMatch(match)}
          onDelete={() => removeMatch(match.id)}
          onReminder={() => setReminderMatch(match)}
          onOpenLedger={() => onOpenPlayerLedger?.(match.id)}
          isNextMatch={isNextMatch}
          isPastMatch={isPastMatch}
          countdown={isNextMatch ? formatCountdown(matchStart, clock) : ""}
        />
      )}
      {isAdmin && (
        <button
          type="button"
          className="player-ledger-launch cash-overview-launch"
          onClick={() => setCashOverviewOpen(true)}
          aria-label="Open cash overview"
        >
          <div>
            <span className="eyebrow">CASH OVERVIEW</span>
            <b>Club cash</b>
            <small>Collections & match costs</small>
          </div>
          <ChevronRight size={19} />
        </button>
      )}
      {reminderMatch && (
        <ReminderModal
          match={reminderMatch}
          onClose={() => setReminderMatch(null)}
        />
      )}
      {scheduleImageOpen && (
        <UpcomingScheduleImageModal
          matches={matches}
          onClose={() => setScheduleImageOpen(false)}
          onNotice={showScheduleNotice}
        />
      )}
      {cashOverviewOpen && (
        <CashOverviewScreen
          data={cashData}
          onClose={() => setCashOverviewOpen(false)}
        />
      )}
      {scheduleNotice && (
        <div className="schedule-toast" role="status">{scheduleNotice}</div>
      )}
      {showCreate && (
        <MatchModal
          players={players}
          onClose={() => setShowCreate(false)}
          setAppError={setAppError}
          onDone={(saved) => {
            setSelectedMatchId(saved.id);
            setShowCreate(false);
          }}
        />
      )}
      {editMatch && (
        <MatchModal
          players={players}
          match={editMatch}
          onClose={() => setEditMatch(null)}
          setAppError={setAppError}
          onDone={(saved) => {
            setSelectedMatchId(saved.id);
            setEditMatch(null);
          }}
        />
      )}
    </section>
  );
}

function MatchView({
  players,
  matches,
  match,
  isAdmin,
  setAppError,
  onEdit,
  onDelete,
  onReminder,
  onOpenLedger,
  isNextMatch,
  isPastMatch,
  countdown,
}) {
  const per = match.participants?.length
    ? Number(match.totalAmount || 0) / match.participants.length
    : 0;
  const totalPaid = (match.participants || []).reduce(
    (s, p) => s + Number(p.paid || 0),
    0,
  );
  return (
    <div>
      <div className={`match-card ${isNextMatch ? "next-match" : ""} ${isPastMatch ? "past-match" : ""}`}>
        <div className="stadium-bg">
          <div className="pitch-lines" />
        </div>
        <div className="match-head">
          <div>
            <div className="match-badge-row">
              <span className={`pill ${isNextMatch ? "next" : isPastMatch ? "past" : "live"}`}>
                {isNextMatch ? "NEXT MATCH" : isPastMatch ? "PAST MATCH" : "MATCH DAY"}
              </span>
              {isNextMatch && <span className="countdown-chip"><Clock3 size={12} /> {countdown}</span>}
            </div>
            <h3>{dateLabel(match.date)}</h3>
            <div className="match-day-name">{getDayLabel(match.date)}</div>
            <div className="matchup-line">{getMatchupLabel(match)}</div>
            {(match.startTime || match.time) && (
              <small className="match-time">
                <CalendarDays size={14} /> Start from:{" "}
                {timeLabel(match.startTime || match.time)}
                {match.endTime ? ` to ${timeLabel(match.endTime)}` : ""}
              </small>
            )}
          </div>
          <div className="head-actions">
            <div className="head-action-buttons">
              <button className={`reminder-btn ${isNextMatch ? "featured" : ""}`} onClick={onReminder} title="Open reminders">
                <ClipboardList size={15} />
                <span>Reminder</span>
              </button>
              {isAdmin && (
                <>
                  <button className="icon-btn light" onClick={onEdit}>
                    <Pencil size={17} />
                  </button>
                  <button className="icon-btn danger" onClick={onDelete}>
                    <Trash2 size={17} />
                  </button>
                </>
              )}
            </div>
            {match.location && (
              <div className="match-location-prominent" title={match.location}>
                <MapPin size={15} />
                <strong>{match.location}</strong>
              </div>
            )}
          </div>
        </div>
        <div className="stats-grid">
          <div>
            <span>Total</span>
            <b>{money(match.totalAmount)}</b>
          </div>
          <div>
            <span>Players</span>
            <b>{match.participants?.length || 0}</b>
          </div>
          <div>
            <span>Avg / player</span>
            <b>{money(per)}</b>
          </div>
        </div>
        <div className="paid-meter">
          <div>
            <span>Collected</span>
            <b>
              {money(totalPaid)} / {money(match.totalAmount)}
            </b>
          </div>
          <div className="meter">
            <i
              style={{
                width: `${Math.min(100, (totalPaid / Number(match.totalAmount || 0)) * 100 || 0)}%`,
              }}
            />
          </div>
        </div>
      </div>
      <button
        type="button"
        className="player-ledger-launch"
        onClick={onOpenLedger}
        aria-label={`Open player ledger for ${dateLabel(match.date)}`}
      >
        <div>
          <span className="eyebrow">PLAYER LEDGER</span>
          <b>Match calculation</b>
          <small>Open the full payment and balance view</small>
        </div>
        <ChevronRight size={19} />
      </button>
    </div>
  );
}

function PlayerLedgerPage({ match, players, matches, isAdmin, setAppError, onClose, onMatchChange }) {
  useEscapeHandler(Boolean(match), onClose);
  const [matchPickerOpen, setMatchPickerOpen] = useState(false);
  const [matchQuery, setMatchQuery] = useState("");
  const [matchDateQuery, setMatchDateQuery] = useState("");
  if (!match) return null;

  const ordered = getMatchOrder(matches);
  const matchIndex = ordered.findIndex((m) => m.id === match.id);
  const matchNumber = Math.max(1, matchIndex + 1);
  const filteredMatches = ordered.filter((item, index) => {
    if (matchDateQuery && String(item?.date || "") !== matchDateQuery) return false;
    return matchesSearchQuery(item, index, matchQuery);
  });

  const chooseMatch = (id) => {
    setMatchPickerOpen(false);
    setMatchQuery("");
    setMatchDateQuery("");
    onMatchChange?.(id);
  };

  const clearMatchFinder = () => {
    setMatchQuery("");
    setMatchDateQuery("");
  };

  const activeCalculationMatch = getActiveCalculationMatch(matches, new Date());
  const isCalculationActive = activeCalculationMatch?.id === match.id || isMatchCompleted(match);
  const per = match.participants?.length ? Number(match.totalAmount || 0) / match.participants.length : 0;
  const totalPaid = (match.participants || []).reduce((sum, p) => sum + Math.max(0, finiteTaka(p.paid)), 0);
  const teamA = String(match.teamAName || "Team A").trim() || "Team A";
  const teamB = String(match.teamBName || "Team B").trim() || "Team B";
  const teamAIds = Array.isArray(match?.teams?.teamA) ? match.teams.teamA : [];
  const teamBIds = Array.isArray(match?.teams?.teamB) ? match.teams.teamB : [];
  const fallbackHalf = Math.ceil((match.participants?.length || 0) / 2);
  const teamACount = teamAIds.length || fallbackHalf;
  const teamBCount = teamBIds.length || Math.max(0, (match.participants?.length || 0) - teamACount);

  return (
    <section className="page detail-page ledger-detail-page">
      <div className="ledger-topbar simple">
        <button type="button" className="detail-back-btn" onClick={onClose} aria-label="Back to matches" title="Back">
          <ChevronLeft size={20} />
        </button>
        <div className="ledger-top-copy">
          <span className="eyebrow">MATCH CENTRE</span>
          <h2>Player calculation</h2>
          <p>{dateLabel(match.date)} · Match {matchNumber} of {ordered.length}</p>
        </div>
        <div className="ledger-match-nav-wrap simple-select-wrap">
          <button
            type="button"
            className={`ledger-match-select${matchPickerOpen ? " open" : ""}`}
            onClick={() => setMatchPickerOpen((v) => !v)}
            aria-expanded={matchPickerOpen}
            aria-haspopup="dialog"
            title="Select another match"
          >
            <Search size={14} />
            <span>
              <small>SELECT MATCH</small>
              <b>#{matchNumber} · {getMatchupLabel(match)}</b>
            </span>
            <ChevronDown size={15} />
          </button>

          {matchPickerOpen && (
            <div className="ledger-match-picker simple-picker" role="dialog" aria-label="Select a match">
              <div className="match-finder-toolbar">
                <button
                  type="button"
                  className="ledger-picker-back"
                  onClick={() => setMatchPickerOpen(false)}
                  aria-label="Close match selector"
                  title="Back"
                >
                  <ChevronLeft size={15} />
                </button>
                <div className="ledger-picker-input-wrap ledger-picker-search">
                  <Search size={15} />
                  <input
                    autoFocus
                    type="search"
                    value={matchQuery}
                    onChange={(e) => setMatchQuery(e.target.value)}
                    placeholder="Search match number, team or date"
                    aria-label="Search match number, team, or date"
                  />
                  {(matchQuery || matchDateQuery) && (
                    <button type="button" className="ledger-picker-clear" onClick={clearMatchFinder} aria-label="Clear match finder">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <label className={`ledger-picker-date${matchDateQuery ? " active" : ""}`} title="Filter by date">
                  <CalendarDays size={14} />
                  <span>{matchDateQuery ? dateLabel(matchDateQuery) : "Date"}</span>
                  <input type="date" value={matchDateQuery} onChange={(e) => setMatchDateQuery(e.target.value)} aria-label="Find matches by date" />
                </label>
              </div>
              <div className="simple-picker-actions">
                <span className="simple-picker-count">{filteredMatches.length} match{filteredMatches.length === 1 ? "" : "es"}</span>
                {(matchQuery || matchDateQuery) && <span className="simple-picker-hint">Tap X to clear filters</span>}
              </div>
              <div className="ledger-picker-list">
                {filteredMatches.length ? filteredMatches.slice(0, 30).map((item) => {
                  const current = item.id === match.id;
                  const completed = isMatchCompleted(item);
                  const active = activeCalculationMatch?.id === item.id;
                  const status = current ? "CURRENT" : completed ? "COMPLETED" : active ? "CURRENT" : "UPCOMING";
                  return (
                    <button key={item.id} type="button" className={`ledger-picker-item${current ? " current" : ""}`} onClick={() => chooseMatch(item.id)}>
                      <span className="ledger-picker-item-date">
                        <b>{new Date(`${item.date || "1970-01-01"}T00:00:00`).getDate()}</b>
                        <small>{new Date(`${item.date || "1970-01-01"}T00:00:00`).toLocaleString(undefined, { month: "short" }).toUpperCase()}</small>
                      </span>
                      <span className="ledger-picker-item-copy">
                        <b>{getMatchupLabel(item)}</b>
                        <small>{status}</small>
                      </span>
                      {current && <span className="ledger-picker-current">✓</span>}
                    </button>
                  );
                }) : <div className="ledger-picker-empty">No matches found. Try a match number, team name, or date.</div>}
              </div>
              {filteredMatches.length > 30 && <div className="ledger-picker-more">Showing the first 30 matches. Search to narrow the list.</div>}
            </div>
          )}
        </div>
      </div>

      <div className="ledger-matchup-card">
        <div className="ledger-team-side">
          <span className="eyebrow">TEAM A</span>
          <b>{teamA}</b>
          <small>{teamACount} players</small>
        </div>
        <div className="ledger-vs"><span>VS</span><small>{dateLabel(match.date)}</small></div>
        <div className="ledger-team-side right">
          <span className="eyebrow">TEAM B</span>
          <b>{teamB}</b>
          <small>{teamBCount} players</small>
        </div>
      </div>

      <div className="ledger-detail-summary ledger-core-summary">
        <div><span>TOTAL</span><b>{money(match.totalAmount)}</b></div>
        <div><span>PLAYERS</span><b>{match.participants?.length || 0}</b></div>
        <div><span>AVG / PLAYER</span><b>{money(per)}</b></div>
      </div>
      <div className="ledger-detail-collected">
        <div className="ledger-collected-head"><span>COLLECTED</span></div>
        <div className="ledger-collected-track"><span style={{ width: `${Math.min(100, Math.max(0, Number(match.totalAmount) > 0 ? (Number(totalPaid) / Number(match.totalAmount)) * 100 : 0))}%` }} /></div>
        <b className="ledger-collected-value">{money(totalPaid)} / {money(match.totalAmount)}</b>
      </div>
      <div className="section-title">
        <div><span className="eyebrow">{isCalculationActive ? "ACTIVE CALCULATION" : "FROZEN CALCULATION"}</span><h3>Player balances</h3></div>
        <span className="read-only"><Eye size={14} /> {isAdmin ? "ADMIN MODE" : "PUBLIC VIEW"}</span>
      </div>
      <div className="player-list">
        {sortPlayersByName((match.participants || []).map((p) => players.find((x) => x.id === p.playerId)).filter(Boolean)).map((player) => {
          const prev = getHistory(matches, player.id, match);
          const cur = getCurrent(match, player.id, prev, { active: isCalculationActive });
          return (
            <PlayerLedger key={player.id} player={player} prev={prev} cur={cur} total={cur.balanceAfter} isAdmin={isAdmin} setAppError={setAppError} match={match} isCalculationActive={isCalculationActive} />
          );
        })}
      </div>
    </section>
  );
}

function PlayerLedger({
  player,
  prev,
  cur,
  total,
  isAdmin,
  setAppError,
  match,
  isCalculationActive,
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(cur.paid ?? 0));
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing) setValue(String(cur.paid ?? 0));
  }, [cur.paid, editing]);

  const save = async () => {
    if (savingRef.current) return;
    const normalized = normalizeNumericInput(value);
    const numericValue = Number(normalized || 0);
    if (!Number.isFinite(numericValue) || numericValue < 0 || !/^\d+(?:\.\d{1,3})?$/.test(normalized || "0")) {
      setAppError("Enter a valid non-negative payment amount (up to 3 decimals).");
      return;
    }
    savingRef.current = true;
    setBusy(true);
    try {
      const participants = (match.participants || []).map((p) =>
        p.playerId === player.id ? { ...p, paid: numericValue } : p,
      );
      await updateDoc(doc(db, "matches", match.id), {
        participants,
        updatedAt: serverTimestamp(),
      });
      setValue(String(numericValue));
      setEditing(false);
    } catch (err) {
      setAppError(`Could not save payment: ${err.message}`);
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const priorLabel =
    prev < 0 ? "Previous due" : prev > 0 ? "Previous credit" : "Previous balance";
  const priorClass = prev < 0 ? "neg" : prev > 0 ? "pos" : "";
  const status = cur.status === "PAID"
    ? { label: "PAID", className: "paid" }
    : cur.status === "NOT PARTICIPATED"
      ? { label: "NOT PARTICIPATED", className: "not-participated" }
      : { label: "UNPAID", className: "unpaid" };
  const balanceClass = cur.balanceAfter < 0 ? "negative" : cur.balanceAfter > 0 ? "positive" : "";
  const finalBalanceAbs = Math.abs(Number(cur.balanceAfter || 0));

  let footer = "";
  if (status.className === "not-participated") {
    footer = "Not selected for this match";
  } else if (cur.balanceAfter < 0) {
    if (cur.previousBalance < 0) {
      footer = `${money(Math.abs(cur.previousBalance))} previous due + ${money(cur.matchFee)} this match`;
    } else if (cur.previousBalance > 0 && cur.previousCreditUsed > 0) {
      footer = `${money(cur.previousCreditUsed)} credit used · ${money(finalBalanceAbs)} still due`;
    } else {
      footer = `${money(cur.remainingDue)} still due`;
    }
  } else if (cur.balanceAfter > 0 && cur.previousCreditUsed > 0 && cur.cashPaid > 0) {
    footer = `${money(cur.previousCreditUsed)} credit used · Paid ${money(cur.cashPaid)} · ${money(cur.remainingCredit)} credit left`;
  } else if (cur.balanceAfter > 0 && cur.previousCreditUsed > 0) {
    footer = `${money(cur.totalApplied)} covered from previous credit · ${money(cur.remainingCredit)} credit left`;
  } else if (cur.balanceAfter > 0 && cur.cashPaid > 0) {
    footer = `Paid ${money(cur.cashPaid)} · ${money(cur.remainingCredit)} credit left`;
  } else if (cur.balanceAfter === 0) {
    footer = status.className === "paid" ? "Fully settled" : "";
  }

  const balanceLabel = cur.balanceAfter > 0 ? "CREDIT" : cur.balanceAfter < 0 ? "TOTAL DUE" : "SETTLED";

  return (
    <div className={`ledger-card ledger-player-card payment-${status.className}`}>
      <div className="ledger-player-header">
        <div className="ledger-player-identity">
          <PlayerAvatar player={player} size="sm" />
          <div className="ledger-player-copy">
            <b>{player.name}</b>
            <small>
              {isCalculationActive ? (
                <>
                  {priorLabel}: <strong className={priorClass}>{signedMoney(cur.previousBalance)}</strong>
                </>
              ) : (
                <span className="frozen-note">Calculation frozen until this match becomes next</span>
              )}
            </small>
          </div>
        </div>
        <div className="ledger-player-header-right">
          <div className={`payment-status ${status.className}`}>{status.label}</div>
          {isCalculationActive ? (
            <div className={`ledger-player-position ${balanceClass}`}>
              <b>{cur.balanceAfter === 0 ? "SETTLED" : money(finalBalanceAbs)}</b>
              {cur.balanceAfter !== 0 && <small>{balanceLabel}</small>}
            </div>
          ) : (
            <div className="ledger-player-position frozen-balance">
              <small>Balance</small>
              <b>—</b>
            </div>
          )}
          {isAdmin && isCalculationActive && (
            <button
              className="edit-paid header-edit"
              onClick={() => { setValue(String(cur.paid ?? 0)); setEditing(true); }}
              aria-label={`Edit ${player.name} payment`}
              title="Edit paid amount"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="ledger-player-payment">
        <div className="ledger-player-payment-item">
          <span>MATCH FEE</span>
          <b>{money(cur.baseFee)}</b>
        </div>
        <div className="ledger-player-payment-item paid">
          <span>PAID</span>
          {isAdmin && isCalculationActive && editing ? (
            <input
              className="ledger-player-payment-input"
              type="number"
              min="0"
              inputMode="decimal"
              value={value}
              onFocus={() => { if (value === "0") setValue(""); }}
              onChange={(e) => setValue(normalizeNumericInput(e.target.value))}
              onBlur={save}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
              autoFocus
              disabled={busy}
            />
          ) : (
            <b>{isCalculationActive ? money(cur.totalApplied) : "—"}</b>
          )}
        </div>
      </div>

      {footer && (
        <div className={`ledger-player-note ${status.className}`}>
          <span className="ledger-player-note-mark" aria-hidden="true">{status.className === "paid" ? "✓" : "!"}</span>
          <span>{footer}</span>
        </div>
      )}
    </div>
  );
}
function getReminderStatus(match, now = new Date()) {
  const matchStart = getMatchDateTime(match);
  if (!matchStart) {
    return {
      status: "invalid",
      label: "MATCH TIME UNAVAILABLE",
      icon: "⚠️",
      countdownText: "",
      messageTitle: "⚠️ Match time unavailable",
      isPast: false,
      isUpcoming: false,
    };
  }

  const diffMs = matchStart.getTime() - now.getTime();
  const totalMinutes = Math.floor(Math.max(diffMs, 0) / 60000);

  if (diffMs <= 0) {
    return {
      status: "past",
      label: "MATCH ALREADY PLAYED",
      icon: "✅",
      countdownText: "",
      messageTitle: "✅ Match already played",
      isPast: true,
      isUpcoming: false,
    };
  }

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days >= 1) {
    const parts = [`${days} day${days === 1 ? "" : "s"}`];
    if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    const countdownText = `Starts in ${parts.join(" ")}`;
    return {
      status: "days",
      label: "UPCOMING",
      icon: "⏳",
      countdownText,
      messageTitle: `⚽ Match Reminder\n\n${countdownText}`,
      isPast: false,
      isUpcoming: true,
    };
  }

  if (hours >= 1) {
    const parts = [`${hours} hour${hours === 1 ? "" : "s"}`];
    if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    const countdownText = `Starts in ${parts.join(" ")}`;
    return {
      status: "hours",
      label: "UPCOMING",
      icon: "🔥",
      countdownText,
      messageTitle: `🔥 Match starts in ${parts.join(" ")}!`,
      isPast: false,
      isUpcoming: true,
    };
  }

  if (minutes >= 1) {
    const countdownText = `Starts in ${minutes} minute${minutes === 1 ? "" : "s"}`;
    return {
      status: "minutes",
      label: "UPCOMING",
      icon: "🚨",
      countdownText,
      messageTitle: `🚨 Match starts in ${minutes} minute${minutes === 1 ? "" : "s"}!`,
      isPast: false,
      isUpcoming: true,
    };
  }

  return {
    status: "imminent",
    label: "UPCOMING",
    icon: "🚨",
    countdownText: "Starts in less than 1 minute",
    messageTitle: "🚨 Match starts in less than 1 minute!",
    isPast: false,
    isUpcoming: true,
  };
}

function buildReminderMessage(match, now = new Date()) {
  const status = getReminderStatus(match, now);
  const dateText = new Date(`${match.date}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
  });
  const timeText = timeLabel(match.startTime || match.time);
  const matchup = getMatchupLabel(match);
  const location = String(match.location || "Turf field").trim() || "Turf field";
  const perPerson = match.participants?.length
    ? Number(match.totalAmount || 0) / match.participants.length
    : null;
  const perPersonText = perPerson === null ? "N/A" : money(perPerson);

  const lines = [
    status.messageTitle,
    "",
    matchup,
    "",
    `📅 ${dateText}`,
    `🕘 ${timeText}`,
    `📍 ${location}`,
    ...(String(match.note || "").trim() ? [`📝 Note: ${String(match.note).trim()}`] : []),
    `💰 Per Person: ${perPersonText}`,
  ];
  if (status.isPast) lines.push("", "The match has already been played.");
  return {
    ...status,
    text: lines.join("\n"),
  };
}

function UpcomingScheduleImageModal({ matches, onClose, onNotice }) {
  useBodyScrollLock(true);
  useEscapeHandler(true, onClose);
  const [imageSrc, setImageSrc] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const upcoming = useMemo(() => getUpcomingMatches(matches, clock), [matches, clock]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = buildUpcomingScheduleImage(matches, clock);
    setImageSrc(canvas.toDataURL("image/png"));
  }, [matches, clock]);

  const copySchedule = async () => {
    const latest = buildUpcomingScheduleMessage(matches, new Date());
    if (!latest.matches.length) {
      onNotice("No upcoming matches to copy.");
      return;
    }
    const success = await copyTextToClipboard(latest.text);
    if (!success) {
      onNotice("Could not copy the schedule.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadImage = () => {
    const canvas = buildUpcomingScheduleImage(matches, new Date());
    canvas.toBlob((blob) => {
      if (!blob) {
        onNotice("Could not generate the image.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "turfclub-upcoming-matches.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloaded(true);
      window.setTimeout(() => setDownloaded(false), 1800);
    }, "image/png");
  };

  return (
    <OverlayPortal>
      <div className="modal-backdrop">
        <div className="modal schedule-image-modal">
          <div className="modal-head">
            <div>
              <span className="eyebrow">TURFCLUB SHARE</span>
              <h2>Upcoming Schedule</h2>
              <p className="muted reminder-subtitle">
                {upcoming.length} upcoming match{upcoming.length === 1 ? "" : "es"}
              </p>
            </div>
            <button
              className="icon-btn"
              onClick={onClose}
              aria-label="Close schedule image preview"
            >
              <X />
            </button>
          </div>
          <div className="schedule-image-preview">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt="TurfClub upcoming matches schedule preview"
              />
            ) : (
              <div className="schedule-image-loading">Preparing image…</div>
            )}
          </div>
          <div className="schedule-image-actions">
            <button
              type="button"
              className={`primary schedule-modal-action ${copied ? "copied" : ""}`}
              onClick={copySchedule}
              disabled={copied}
            >
              {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}
            </button>
            <button
              type="button"
              className={`primary schedule-modal-action ${downloaded ? "downloaded" : ""}`}
              onClick={downloadImage}
              disabled={downloaded}
            >
              {downloaded ? <><Check size={16} /> Downloaded</> : <><Download size={16} /> Download</>}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

function ReminderModal({ match, onClose }) {
  useBodyScrollLock(true);
  useEscapeHandler(true, onClose);

  const [clock, setClock] = useState(() => new Date());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const reminder = useMemo(() => buildReminderMessage(match, clock), [match, clock]);

  const copyReminder = async () => {
    const latestReminder = buildReminderMessage(match, new Date());
    const ok = await copyTextToClipboard(latestReminder.text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <OverlayPortal>
      <div className="modal-backdrop">
        <div className="modal reminder-modal">
          <div className="modal-head">
            <div>
              <span className="eyebrow">MATCH REMINDERS</span>
              <h2>Reminders</h2>
              <p className="muted reminder-subtitle">{getMatchupLabel(match)} · {dateLabel(match.date)}</p>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close reminders"><X /></button>
          </div>

          <div className={`reminder-status ${reminder.isPast ? "played" : reminder.status === "imminent" || reminder.status === "minutes" ? "urgent" : "upcoming"}`}>
            <div className="reminder-status-top">
              <span className="reminder-type">{reminder.icon} {reminder.label}</span>
              {!reminder.isPast && <strong>{reminder.countdownText}</strong>}
            </div>
          </div>

          <article className="reminder-card current-reminder-card">
            <div className="reminder-card-head">
              <span className="reminder-type">{reminder.icon} CURRENT REMINDER</span>
            </div>
            <pre>{reminder.text}</pre>
            <div className="reminder-action-row">
              <button className={`primary copy-reminder ${copied ? "copied" : ""}`} onClick={copyReminder}>
                {copied ? <><Check size={16} /> COPIED</> : <><ClipboardList size={16} /> Copy</>}
              </button>
              <button
                className="primary reminder-download"
                onClick={() => {
                  const canvas = buildReminderImage(match, new Date());
                  canvas.toBlob((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "turfclub-match-reminder.png";
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }, "image/png");
                }}
              >
                <Download size={16} /> Download
              </button>
            </div>
          </article>
        </div>
      </div>
    </OverlayPortal>
  );
}

function MatchPlayerSelector({ players, selected, onToggle, onClose }) {
  useBodyScrollLock(true);
  useEscapeHandler(true, onClose);
  const [search, setSearch] = useState("");
  const activeSelected = useMemo(() => new Set(selected), [selected]);
  const filteredPlayers = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const list = sortPlayersByName(
      (Array.isArray(players) ? players : []).filter(
        (player) => isPlayerActive(player) || activeSelected.has(player.id),
      ),
    );
    if (!normalized) return list;
    return list.filter((player) =>
      `${player.name || ""} ${playerPositionLabel(player)}`.toLowerCase().includes(normalized),
    );
  }, [players, search, activeSelected]);

  return (
    <OverlayPortal>
      <div className="modal-backdrop player-selector-backdrop">
        <section className="modal player-selector-modal" role="dialog" aria-modal="true" aria-labelledby="select-players-title">
          <div className="modal-head player-selector-head">
            <div>
              <span className="eyebrow">SELECT PLAYERS</span>
              <h2 id="select-players-title">Choose players</h2>
              <p className="muted">{selected.length} {selected.length === 1 ? "player" : "players"} selected</p>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close player selection">
              <X />
            </button>
          </div>

          <div className="player-selector-summary">
            <Users size={16} />
            <strong>{selected.length} {selected.length === 1 ? "player" : "players"} selected</strong>
          </div>

          <div className="player-search player-selector-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search player..."
              aria-label="Search player"
              autoFocus
            />
            {search && (
              <button type="button" className="search-clear" onClick={() => setSearch("")} aria-label="Clear player search">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="player-selector-list">
            {filteredPlayers.map((player) => {
              const isSelected = activeSelected.has(player.id);
              return (
                <button
                  type="button"
                  className={`player-selector-row ${isSelected ? "selected" : ""}`}
                  key={player.id}
                  onClick={() => onToggle(player.id)}
                  aria-pressed={isSelected}
                >
                  <span className={`player-selector-check ${isSelected ? "checked" : ""}`} aria-hidden="true">
                    {isSelected && <Check size={14} />}
                  </span>
                  <PlayerAvatar player={player} size="sm" />
                  <span className="player-selector-name">
                    <b>{player.name}</b>
                    <small>{playerPositionLabel(player)}</small>
                  </span>
                </button>
              );
            })}
            {!filteredPlayers.length && (
              <div className="empty player-selector-empty">
                <Search size={18} />
                <h3>No players found</h3>
                <p>Try another player name.</p>
              </div>
            )}
          </div>

          <div className="player-selector-footer">
            <button type="button" className="primary full" onClick={onClose}>
              Submit
            </button>
          </div>
        </section>
      </div>
    </OverlayPortal>
  );
}

function MatchModal({ players, match, onClose, setAppError, onDone }) {
  useBodyScrollLock(true);
  useEscapeHandler(true, onClose);

  const editing = !!match;
  const [date, setDate] = useState(match?.date || today());
  const [startTime, setStartTime] = useState(match?.startTime || match?.time || currentTime());
  const [endTime, setEndTime] = useState(match?.endTime || addOneHour(match?.startTime || match?.time || currentTime()));
  const [amount, setAmount] = useState(String(match?.totalAmount ?? 0));
  const [teamAName, setTeamAName] = useState(match?.teamAName || "Team A");
  const [teamBName, setTeamBName] = useState(match?.teamBName || "Team B");
  const [location, setLocation] = useState(match?.location || "");
  const [note, setNote] = useState(String(match?.note || "").slice(0, 20));
  const [selected, setSelected] = useState(match?.participants?.map((p) => p.playerId) || []);
  const [playerSelectorOpen, setPlayerSelectorOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (id) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const submit = async (event) => {
    event?.preventDefault?.();
    if (busy) return;
    setError("");
    const numericAmount = Number(amount);
    const validMoney = /^\d+(?:\.\d{1,3})?$/.test(String(amount).trim());
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date));
    const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
    if (!validDate || !validTime(startTime) || !validTime(endTime) || !validMoney || !Number.isFinite(numericAmount) || numericAmount <= 0 || selected.length === 0) {
      return setError("Enter a valid date, time, positive amount (up to 3 decimals), and at least one player.");
    }
    const sanitizedNote = String(note || "").trim().slice(0, 20);
    const old = Array.isArray(match?.participants) ? match.participants : [];
    const participants = [...new Set(selected)].map((id) => ({
      playerId: id,
      paid: Math.max(0, Number(old.find((p) => p.playerId === id)?.paid || 0)),
    }));
    setBusy(true);
    try {
      if (editing) {
        await updateDoc(doc(db, "matches", match.id), {
          date,
          startTime,
          endTime,
          time: startTime,
          totalAmount: numericAmount,
          teamAName: teamAName.trim() || "Team A",
          teamBName: teamBName.trim() || "Team B",
          location: location.trim(),
          note: sanitizedNote,
          participants,
          updatedAt: serverTimestamp(),
        });
        onDone({ id: match.id, date });
      } else {
        const ref = await addDoc(collection(db, "matches"), {
          date,
          startTime,
          endTime,
          time: startTime,
          totalAmount: numericAmount,
          teamAName: teamAName.trim() || "Team A",
          teamBName: teamBName.trim() || "Team B",
          location: location.trim(),
          note: sanitizedNote,
          participants,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        onDone({ id: ref.id, date });
      }
    } catch (err) {
      const message = `Could not save match: ${err.message}`;
      setError(message);
      setAppError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <OverlayPortal>
        <div className="modal-backdrop">
          <form className="modal match-modal create-match-modal" onSubmit={submit} noValidate>
            <div className="modal-head">
              <div>
                <span className="eyebrow">{editing ? "EDIT MATCH" : "NEW MATCH"}</span>
                <h2>{editing ? "Update match" : "Create match"}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close match dialog">
                <X />
              </button>
            </div>

            <label>
              Match date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>

            <div className="form-grid-two time-range-row">
              <label>
                Start time
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </label>
              <div className="time-range-separator" aria-hidden="true">TO</div>
              <label>
                End time
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>

            <label>
              Team A name
              <input type="text" value={teamAName} onChange={(e) => setTeamAName(e.target.value)} maxLength={40} placeholder="Team A" />
            </label>

            <label>
              Team B name
              <input type="text" value={teamBName} onChange={(e) => setTeamBName(e.target.value)} maxLength={40} placeholder="Team B" />
            </label>

            <label className="location-field">
              Turf / location
              <span className="input-with-icon">
                <MapPin size={15} aria-hidden="true" />
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bashundhara Turf, Dhaka" maxLength={120} autoComplete="street-address" />
              </span>
            </label>

            <div className="form-grid-two amount-row">
              <label>
                Amount
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={amount}
                  onFocus={() => { if (amount === "0") setAmount(""); }}
                  onChange={(e) => setAmount(normalizeNumericInput(e.target.value))}
                  placeholder="0"
                />
              </label>
              <label>
                Note
                <input
                  type="text"
                  value={note}
                  maxLength={20}
                  onChange={(e) => setNote(e.target.value.slice(0, 20))}
                  placeholder="Optional note"
                  autoComplete="off"
                />
                <span className="match-note-meta">Optional · {note.length}/20</span>
              </label>
            </div>

            <button type="button" className="player-selector-trigger" onClick={() => setPlayerSelectorOpen(true)} aria-haspopup="dialog" aria-expanded={playerSelectorOpen}>
              <span className="player-selector-trigger-icon"><Users size={17} /></span>
              <span className="player-selector-trigger-copy">
                <strong>Select players</strong>
                <small>{selected.length} {selected.length === 1 ? "player" : "players"} selected</small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>

            {selected.length > 0 && Number(amount) > 0 && (
              <div className="per-preview">
                Average share <b>{money(Number(amount) / selected.length)}</b>
              </div>
            )}
            {error && <div className="error">{error}</div>}
            <button className="primary full create-match-submit" type="submit" disabled={busy}>
              {busy ? "Saving..." : editing ? "Save changes" : "Create match"}
            </button>
          </form>
        </div>
      </OverlayPortal>
      {playerSelectorOpen && (
        <MatchPlayerSelector
          players={players}
          selected={selected}
          onToggle={toggle}
          onClose={() => setPlayerSelectorOpen(false)}
        />
      )}
    </>
  );
}

function resultCompletedMatches(matches, now = new Date()) {
  return getMatchOrder(matches)
    .filter((match) => isMatchCompleted(match, now))
    .sort((a, b) => getMatchSortKey(b).localeCompare(getMatchSortKey(a)));
}

function getResultScorers(match, players) {
  const scorerMap = match?.result?.scorers && typeof match.result.scorers === "object"
    ? match.result.scorers
    : {};
  const teamAIds = new Set(Array.isArray(match?.teams?.teamA) ? match.teams.teamA : []);
  const teamBIds = new Set(Array.isArray(match?.teams?.teamB) ? match.teams.teamB : []);
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const build = (ids) => [...ids]
    .map((id) => ({ player: playerMap.get(id), goals: Number(scorerMap[id] || 0) }))
    .filter((item) => item.player && item.goals > 0)
    .sort((a, b) => b.goals - a.goals || String(a.player.name).localeCompare(String(b.player.name)));
  return { teamA: build(teamAIds), teamB: build(teamBIds) };
}

function getResultScore(match) {
  const a = Number(match?.result?.teamAScore);
  const b = Number(match?.result?.teamBScore);
  return Number.isFinite(a) && Number.isFinite(b)
    ? { teamA: a, teamB: b }
    : null;
}

function resultWinner(match) {
  const score = getResultScore(match);
  if (!score || score.teamA === score.teamB) return "draw";
  return score.teamA > score.teamB ? "a" : "b";
}


function Results({ players, matches, profile, setAppError, onOpenMatch, onOpenTopScorers }) {
  const [clock, setClock] = useState(new Date());
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const completed = useMemo(() => resultCompletedMatches(matches, clock), [matches, clock]);
  const searchTerm = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!searchTerm) return completed;
    return completed.filter((match) => {
      const date = String(match.date || "");
      const [year, month, day] = date.split("-");
      const pretty = date ? dateLabel(date).toLowerCase() : "";
      const aliases = [
        String(match.teamAName || "Team A").toLowerCase(),
        String(match.teamBName || "Team B").toLowerCase(),
        date.toLowerCase(),
        pretty,
        `${day} ${month} ${year}`.toLowerCase(),
        `${day}/${month}/${year}`.toLowerCase(),
        `${year}-${month}-${day}`.toLowerCase(),
      ].filter(Boolean);
      return aliases.some((value) => value.includes(searchTerm));
    });
  }, [completed, searchTerm]);

  const allTimeScorers = useMemo(() => {
    const totals = new Map();
    completed.forEach((match) => {
      const scorers = match?.result?.scorers && typeof match.result.scorers === "object" ? match.result.scorers : {};
      Object.entries(scorers).forEach(([playerId, value]) => {
        const goals = Number(value || 0);
        if (goals <= 0) return;
        const previous = totals.get(playerId) || 0;
        totals.set(playerId, previous + goals);
      });
    });
    return [...totals.entries()]
      .map(([playerId, goals]) => ({ player: players.find((p) => p.id === playerId), goals }))
      .filter((item) => item.player && item.goals > 0)
      .sort((a, b) => b.goals - a.goals || String(a.player.name).localeCompare(String(b.player.name)));
  }, [completed, players]);


  return (
    <section className="page results-page">
      <div className="hero compact">
        <div>
          <div className="eyebrow">MATCH RESULTS</div>
          <h2>Results</h2>
          <p>All-time scorers and completed match history.</p>
        </div>
      </div>

      <section className="results-top-scorers">
        <div className="results-section-head">
          <div>
            <span className="eyebrow">ALL-TIME TOP SCORERS</span>
            <h3>Goal leaderboard</h3>
          </div>
          <span className="results-count">{allTimeScorers.length} players</span>
        </div>
        {allTimeScorers.length ? (
          <>
            <div className="top-scorer-list">
              {allTimeScorers.slice(0, 3).map(({ player, goals }, index) => (
                <div className="top-scorer-row" key={player.id}>
                  <span className={`top-scorer-rank ${index === 0 ? "first" : ""}`}>{index + 1}</span>
                  <PlayerAvatar player={player} size="sm" />
                  <div className="top-scorer-name">
                    <b>{player.name}</b>
                    {player.position && <small>{player.position}</small>}
                  </div>
                  <strong>{goals} <small>GOAL{goals === 1 ? "" : "S"}</small></strong>
                </div>
              ))}
            </div>
            {allTimeScorers.length > 3 && (
              <button type="button" className="results-see-more" onClick={onOpenTopScorers}>
                See more <ChevronRight size={15} />
              </button>
            )}
          </>
        ) : (
          <div className="results-empty-mini">No goal records have been added yet.</div>
        )}
      </section>

      <div className="results-match-head">
        <div>
          <span className="eyebrow">MATCH HISTORY</span>
          <h3>Completed matches</h3>
        </div>
        <span>{filtered.length} match{filtered.length === 1 ? "" : "es"}</span>
      </div>

      <div className="results-search">
        <Search size={16} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team name or match date..."
          aria-label="Search team name or match date"
        />
        {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
      </div>

      <div className="results-list">
        {filtered.length ? filtered.map((match) => {
          const winner = resultWinner(match);
          const score = getResultScore(match);
          const teamA = String(match.teamAName || "Team A").trim() || "Team A";
          const teamB = String(match.teamBName || "Team B").trim() || "Team B";
          return (
            <button
              type="button"
              className="result-match-row"
              key={match.id}
              onClick={() => onOpenMatch(match.id)}
            >
              <div className="result-date">
                <b>{new Date(`${match.date}T00:00:00`).getDate()}</b>
                <span>{new Date(`${match.date}T00:00:00`).toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}</span>
                <small>{new Date(`${match.date}T00:00:00`).getFullYear()}</small>
              </div>
              <div className={`result-team ${winner === "a" ? "win" : winner === "b" ? "loss" : ""}`}>
                <b>{teamA}</b>
                <small>{winner === "a" ? "WIN" : winner === "b" ? "LOSS" : "DRAW"}</small>
              </div>
              <div className={`result-score ${winner === "draw" ? "draw" : ""}`}>
                <b>{score ? score.teamA : "—"} - {score ? score.teamB : "—"}</b>
                <small>{score ? "FINAL" : "RESULT PENDING"}</small>
              </div>
              <div className={`result-team result-team-right ${winner === "b" ? "win" : winner === "a" ? "loss" : ""}`}>
                <b>{teamB}</b>
                <small>{winner === "b" ? "WIN" : winner === "a" ? "LOSS" : "DRAW"}</small>
              </div>
              <ChevronRight size={18} className="result-chevron" />
            </button>
          );
        }) : (
          <div className="results-empty">
            <Trophy size={28} />
            <b>{completed.length ? "No matches found" : "No completed matches yet"}</b>
            <p>{completed.length ? "Try another team name or date." : "Results will appear here after matches are played."}</p>
          </div>
        )}
      </div>
    </section>
  );
}


function TopScorersPage({ players, matches, onClose }) {
  useEscapeHandler(true, onClose);
  const scorers = useMemo(() => {
    const totals = new Map();
    resultCompletedMatches(matches).forEach((match) => {
      const map = match?.result?.scorers && typeof match.result.scorers === "object" ? match.result.scorers : {};
      Object.entries(map).forEach(([playerId, value]) => {
        const goals = Number(value || 0);
        if (goals <= 0) return;
        totals.set(playerId, (totals.get(playerId) || 0) + goals);
      });
    });
    return [...totals.entries()]
      .map(([playerId, goals]) => ({ player: players.find((p) => p.id === playerId), goals }))
      .filter((item) => item.player && item.goals > 0)
      .sort((a, b) => b.goals - a.goals || String(a.player.name).localeCompare(String(b.player.name)));
  }, [matches, players]);

  return (
    <section className="page detail-page scorer-list-page">
      <div className="detail-page-head">
        <button type="button" className="detail-back-btn" onClick={onClose} aria-label="Back to results" title="Back">
          <ChevronLeft size={20} />
        </button>
        <div>
          <span className="eyebrow">ALL-TIME TOP SCORERS</span>
          <h2>Goal leaderboard</h2>
          <p>{scorers.length} players with at least 1 goal.</p>
        </div>
      </div>
      <section className="results-top-scorers scorer-list-card">
        {scorers.length ? (
          <div className="top-scorer-list">
            {scorers.map(({ player, goals }, index) => (
              <div className="top-scorer-row" key={player.id}>
                <span className={`top-scorer-rank ${index === 0 ? "first" : ""}`}>{index + 1}</span>
                <PlayerAvatar player={player} size="sm" />
                <div className="top-scorer-name">
                  <b>{player.name}</b>
                  {player.position && <small>{player.position}</small>}
                </div>
                <strong>{goals} <small>GOAL{goals === 1 ? "" : "S"}</small></strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="results-empty-mini">No goal records have been added yet.</div>
        )}
      </section>
    </section>
  );
}

function ResultDetailModal({ match, players, isAdmin, onClose, setAppError }) {
  useEscapeHandler(Boolean(match), onClose);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const teamAIds = Array.isArray(match?.teams?.teamA) ? match.teams.teamA : [];
  const teamBIds = Array.isArray(match?.teams?.teamB) ? match.teams.teamB : [];
  const initialScorers = match?.result?.scorers && typeof match.result.scorers === "object" ? match.result.scorers : {};
  const [goals, setGoals] = useState(initialScorers);


  useEffect(() => {
    const scorers = match?.result?.scorers && typeof match.result.scorers === "object" ? match.result.scorers : {};
    setGoals(scorers);
    setEditing(false);
  }, [match?.id, match?.result?.updatedAt]);

  if (!match) return null;
  const score = getResultScore(match);
  const scorerData = getResultScorers(match, players);
  const winner = resultWinner(match);
  const teamA = String(match.teamAName || "Team A").trim() || "Team A";
  const teamB = String(match.teamBName || "Team B").trim() || "Team B";
  const fallbackHalf = Math.ceil((match.participants?.length || 0) / 2);
  const teamACount = teamAIds.length || fallbackHalf;
  const teamBCount = teamBIds.length || Math.max(0, (match.participants?.length || 0) - teamACount);
  const setGoal = (id, value) => setGoals((current) => ({ ...current, [id]: value === "" ? "" : Math.max(0, Math.floor(Number(value || 0))) }));
  const draftTeamAScore = teamAIds.reduce((sum, id) => sum + Number(goals[id] || 0), 0);
  const draftTeamBScore = teamBIds.reduce((sum, id) => sum + Number(goals[id] || 0), 0);

  const saveResult = async () => {
    if (busy) return;
    const allowedIds = new Set([...teamAIds, ...teamBIds]);
    const normalized = Object.fromEntries(
      Object.entries(goals)
        .filter(([id, value]) => allowedIds.has(id) && Number.isInteger(Number(value)) && Number(value) > 0)
        .map(([id, value]) => [id, Number(value)]),
    );
    if (!teamAIds.length || !teamBIds.length) {
      setAppError("Assign players to both teams before saving a result.");
      return;
    }
    setBusy(true);
    try {
      await updateDoc(doc(db, "matches", match.id), {
        result: {
          teamAScore: draftTeamAScore,
          teamBScore: draftTeamBScore,
          scorers: normalized,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: serverTimestamp(),
      });
      setEditing(false);
    } catch (err) {
      const message = `Could not save result: ${err.message}`;
      setAppError(message);
    } finally {
      setBusy(false);
    }
  };

  const renderScorers = (list) => (
    list.length ? (
      <div className="result-scorer-list">
        {list.map(({ player, goals: count }) => (
          <div className="result-scorer-line" key={player.id}>
            <span>{player.name}</span><b>{count}</b>
          </div>
        ))}
      </div>
    ) : <div className="result-no-scorers">No goals recorded</div>
  );

  return (
    <section className="page detail-page result-detail-page">
      <div className="detail-page-head">
        <button type="button" className="detail-back-btn" onClick={onClose} aria-label="Back to results" title="Back"><ChevronLeft size={20} /></button>
        <div className="result-detail-header-copy">
          <span className="eyebrow">MATCH RESULT</span>
          <h2>{dateLabel(match.date)}</h2>
          <p>{getDayLabel(match.date)} · <span>FINAL</span></p>
        </div>
      </div>
      <div className="result-detail-scoreboard" aria-label={`Final score ${teamA} ${score ? score.teamA : "unknown"} to ${teamB} ${score ? score.teamB : "unknown"}`}>
        <div className={`result-detail-team ${winner === "a" ? "winner" : winner === "b" ? "loser" : ""}`}>
          <b>{teamA}</b>
          <small>TEAM A</small>
        </div>
        <div className="result-detail-score-wrap">
          <strong>{score ? `${score.teamA} — ${score.teamB}` : "— — —"}</strong>
          <span>FINAL</span>
        </div>
        <div className={`result-detail-team ${winner === "b" ? "winner" : winner === "a" ? "loser" : ""}`}>
          <b>{teamB}</b>
          <small>TEAM B</small>
        </div>
      </div>

      {editing ? (
        <div className="result-edit-panel">
          <div className="result-edit-score derived">
            <div><span>{teamA} score</span><b>{draftTeamAScore}</b></div>
            <div><span>{teamB} score</span><b>{draftTeamBScore}</b></div>
          </div>
          <div className="result-edit-help">Mark how many goals each player scored. The final score updates automatically from the scorer totals.</div>
          <div className="result-edit-team">
            <div className="result-edit-team-head"><b>{teamA}</b><span>{teamAIds.length} players</span></div>
            {teamAIds.map((id) => {
              const player = players.find((p) => p.id === id);
              if (!player) return null;
              return <label className="goal-input-row" key={id}><span>{player.name}</span><input type="number" min="0" inputMode="numeric" value={goals[id] ?? ""} onFocus={(e) => { if (String(goals[id] ?? "") === "0") e.currentTarget.value = ""; setGoals((current) => ({ ...current, [id]: "" })); }} onChange={(e) => setGoal(id, e.target.value)} /></label>;
            })}
          </div>
          <div className="result-edit-team">
            <div className="result-edit-team-head"><b>{teamB}</b><span>{teamBIds.length} players</span></div>
            {teamBIds.map((id) => {
              const player = players.find((p) => p.id === id);
              if (!player) return null;
              return <label className="goal-input-row" key={id}><span>{player.name}</span><input type="number" min="0" inputMode="numeric" value={goals[id] ?? ""} onFocus={(e) => { if (String(goals[id] ?? "") === "0") e.currentTarget.value = ""; setGoals((current) => ({ ...current, [id]: "" })); }} onChange={(e) => setGoal(id, e.target.value)} /></label>;
            })}
          </div>
          <div className="result-edit-actions"><button className="secondary" onClick={() => setEditing(false)}>Cancel</button><button className="primary" onClick={saveResult} disabled={busy}>{busy ? "Saving..." : "Save result"}</button></div>
        </div>
      ) : (
        <>
          <section
            className={`match-scorers-card ${winner === "a" ? "match-scorers-winner-left" : winner === "b" ? "match-scorers-winner-right" : ""}`}
            aria-label="Goal scorers"
          >
            <div className="match-scorers-title">GOAL SCORERS</div>
            <div className="match-scorers-columns">
              <div className="match-scorers-team">
                <div className="match-scorers-team-head">
                  <div className="match-scorers-team-copy">
                    <span>TEAM A</span>
                    <b title={teamA}>{teamA}</b>
                  </div>
                  <strong>{score ? score.teamA : 0}<small>GOALS</small></strong>
                </div>
                {renderScorers(scorerData.teamA)}
              </div>
              <div className="match-scorers-divider" aria-hidden="true" />
              <div className="match-scorers-team">
                <div className="match-scorers-team-head">
                  <div className="match-scorers-team-copy">
                    <span>TEAM B</span>
                    <b title={teamB}>{teamB}</b>
                  </div>
                  <strong>{score ? score.teamB : 0}<small>GOALS</small></strong>
                </div>
                {renderScorers(scorerData.teamB)}
              </div>
            </div>
          </section>
          <div className="result-detail-actions">
            {isAdmin && <button type="button" className="result-detail-edit-btn" onClick={() => setEditing(true)}><Pencil size={15} /> {score ? "Edit result" : "Add result"}</button>}
          </div>
        </>
      )}
    </section>
  );
}

const isPlayerActive = (player) => player?.active !== false;


function getDuePlayerBreakdowns(players, matches, balances) {
  const orderedMatches = getMatchOrder(Array.isArray(matches) ? matches : []);
  const matchNumbers = new Map(
    orderedMatches.map((match, index) => [String(match?.id || index), index + 1]),
  );
  const matchRank = new Map(
    orderedMatches.map((match, index) => [String(match?.id || index), index]),
  );

  return (Array.isArray(players) ? players : [])
    .filter((player) => isPlayerActive(player))
    .map((player) => {
      const balance = Number(balances?.[player.id] || 0);
      if (!(balance < 0)) return null;

      const financials = getPlayerFinancials(matches, player.id, isMatchCompleted);
      const rows = [...(financials.rows || [])]
        .map((row, fallbackIndex) => ({
          ...row,
          _matchId: String(row?.match?.id || fallbackIndex),
          _rank: matchRank.get(String(row?.match?.id || fallbackIndex)) ?? Number.MAX_SAFE_INTEGER,
        }))
        .sort((a, b) => a._rank - b._rank);

      // Allocate the running negative balance into chronological debt lots.
      // This mirrors the existing balance model: match fee creates debt and
      // recorded payment reduces the running balance. Positive net rows settle
      // older outstanding lots first, without introducing a new data source.
      const debtLots = [];
      let creditMinor = 0;
      rows.forEach((row) => {
        let netMinor = Number(row?.matchBalanceMinor || 0);
        if (!Number.isFinite(netMinor) || netMinor === 0) return;

        if (netMinor < 0) {
          let newDebt = Math.abs(Math.trunc(netMinor));
          let availableCredit = creditMinor;
          if (availableCredit > 0) {
            const applied = Math.min(availableCredit, newDebt);
            availableCredit -= applied;
            newDebt -= applied;
            creditMinor = availableCredit;
          }
          if (newDebt > 0) {
            debtLots.push({
              match: row.match,
              matchId: row._matchId,
              amountMinor: newDebt,
              matchNumber: matchNumbers.get(row._matchId) || row._rank + 1,
            });
          }
          return;
        }

        let remainingCredit = Math.max(0, Math.trunc(netMinor));
        for (const lot of debtLots) {
          if (remainingCredit <= 0) break;
          const applied = Math.min(lot.amountMinor, remainingCredit);
          lot.amountMinor -= applied;
          remainingCredit -= applied;
        }
        creditMinor += remainingCredit;
      });

      let remainingDueMinor = Math.abs(Math.round(balance * 1000));
      const breakdown = debtLots
        .filter((lot) => lot.amountMinor > 0)
        .map((lot) => {
          const amountMinor = Math.min(lot.amountMinor, remainingDueMinor);
          remainingDueMinor -= amountMinor;
          return {
            match: lot.match,
            matchNumber: lot.matchNumber,
            amount: amountMinor / 1000,
          };
        })
        .filter((row) => row.amount > 0);

      // Defensive reconciliation keeps displayed source rows tied exactly to
      // the authoritative current negative balance, even with legacy rounding.
      if (remainingDueMinor > 0 && breakdown.length) {
        const last = breakdown[breakdown.length - 1];
        last.amount += remainingDueMinor / 1000;
      }

      return {
        player,
        balance,
        due: Math.abs(balance),
        breakdown,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.due - a.due || String(a.player?.name || "").localeCompare(String(b.player?.name || "")));
}

function Players({ players, matches, profile, setAppError, onOpenPlayer }) {
  const isAdmin = profile.role === "admin";
  const [newName, setNewName] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [editingPosition, setEditingPosition] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const editTriggerRef = useRef(null);

  const closeEditing = () => {
    setEditing(null);
    setEditingName("");
    setEditingPosition("");
  };

  useBodyScrollLock(Boolean(editing));
  useEscapeHandler(Boolean(editing), closeEditing);

  useEffect(() => {
    if (editing) return;
    const trigger = editTriggerRef.current;
    if (trigger && typeof trigger.focus === "function") {
      trigger.focus({ preventScroll: true });
    }
    editTriggerRef.current = null;
  }, [editing]);

  const sortedPlayers = useMemo(() => {
    const normalized = playerSearch.trim().toLowerCase();
    const list = sortPlayersByName(players.filter((player) => showArchived ? true : isPlayerActive(player)));
    if (!normalized) return list;
    return list.filter((player) => {
      const haystack = `${player.name || ""} ${playerPositionLabel(player)}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [players, playerSearch, showArchived]);

  const activePlayerCount = players.filter(isPlayerActive).length;
  const archivedPlayerCount = players.length - activePlayerCount;
  const balances = useMemo(
    () =>
      Object.fromEntries(
        (Array.isArray(players) ? players : []).map((player) => [
          player.id,
          getPlayerFinancials(matches, player.id, isMatchCompleted).balanceMinor / 1000,
        ]),
      ),
    [players, matches],
  );

  const add = async () => {
    if (!newName.trim()) return;
    try {
      await addDoc(collection(db, "players"), {
        name: newName.trim(),
        position: newPosition || null,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewName("");
      setNewPosition("");
    } catch (err) {
      setAppError(`Could not add player: ${err.message}`);
    }
  };

  const startEditing = (player) => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      editTriggerRef.current = document.activeElement;
    }
    setEditing(player.id);
    setEditingName(player.name || "");
    setEditingPosition(player.position || "");
  };

  const rename = async (id) => {
    if (!editingName.trim()) return;
    try {
      await updateDoc(doc(db, "players", id), {
        name: editingName.trim(),
        position: editingPosition || null,
        updatedAt: serverTimestamp(),
      });
      closeEditing();
    } catch (err) {
      setAppError(`Could not edit player: ${err.message}`);
    }
  };

  const remove = async (id) => {
    const player = players.find((item) => item.id === id);
    if (!player) return;
    if (!confirm(`Remove ${player.name}? Their goals, matches, payments and all historical records will be kept.`)) return;
    try {
      await updateDoc(doc(db, "players", id), {
        active: false,
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setAppError(`Could not remove player: ${err.message}`);
    }
  };

  const restore = async (id) => {
    try {
      await updateDoc(doc(db, "players", id), {
        active: true,
        archivedAt: null,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setAppError(`Could not restore player: ${err.message}`);
    }
  };

  return (
    <section className="page">
      <div className="hero compact">
        <div>
          <div className="eyebrow">SQUAD</div>
          <h2>Players</h2>
          <p>Live from Firestore. Public view; only admin can change.</p>
        </div>
        <div className="count-badge">
          {activePlayerCount}
          <small>ACTIVE</small>
        </div>
      </div>

      <div className="player-toolbar">
        <div className="player-search">
          <Search size={15} />
          <input
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Search player or position..."
            aria-label="Search player or position"
          />
          {playerSearch && (
            <button
              className="search-clear"
              type="button"
              onClick={() => setPlayerSearch("")}
              aria-label="Clear player search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>


      {isAdmin && (
        <div className="add-player">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Player name"
            aria-label="Player name"
          />
          <select
            value={newPosition}
            onChange={(e) => setNewPosition(e.target.value)}
            aria-label="Player play style"
          >
            <option value="">Play style</option>
            {PLAYER_POSITIONS.map((position) => (
              <option key={position.value} value={position.value}>
                {position.label} ({position.short})
              </option>
            ))}
          </select>
          <button className="primary" onClick={add} disabled={!newName.trim()}>
            <UserPlus size={17} /> Add
          </button>
        </div>
      )}

      {archivedPlayerCount > 0 && (
        <div className="player-archive-toggle">
          <label className={`archive-filter-switch ${showArchived ? "active" : ""}`}>
            <span className="archive-filter-copy">
              <span className="archive-filter-title">
                <Archive size={16} aria-hidden="true" />
                <strong>Show archived players</strong>
                <span className="archive-filter-count">{archivedPlayerCount} archived</span>
              </span>
              <span className="archive-filter-subtitle">View inactive or archived players</span>
            </span>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              aria-label="Show archived players"
            />
            <span className="archive-switch" aria-hidden="true">
              <span className="archive-switch-thumb" />
            </span>
          </label>
        </div>
      )}

      <div className="player-results-meta">
        <span>{sortedPlayers.length} shown{showArchived ? "" : " active"}</span>
        {playerSearch && <span>for “{playerSearch}”</span>}
      </div>

      <div className="player-directory">
        {sortedPlayers.map((p) => (
          <div
            className={`directory-row ${isPlayerActive(p) ? "" : "archived"}`}
            key={p.id}
            role="button"
            tabIndex={0}
            aria-label={`Open ${p.name} profile`}
            onClick={() => onOpenPlayer?.(p.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenPlayer?.(p.id);
              }
            }}
          >
            <PlayerAvatar player={p} size="lg" />
            <div className="dir-name">
              <b>{p.name}</b>
              <small className="player-position">{playerPositionLabel(p)}{!isPlayerActive(p) ? " • ARCHIVED" : ""}</small>
            </div>
            <div className="dir-balance-wrap">
              <span>Balance:</span>
              <strong className={`dir-balance ${balances[p.id] < 0 ? "negative" : balances[p.id] > 0 ? "positive" : ""}`}>
                {signedMoney(balances[p.id] || 0)}
              </strong>
            </div>
            <div className="row-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    className="icon-btn mini"
                    onClick={() => startEditing(p)}
                    aria-label={`Edit ${p.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  {isPlayerActive(p) ? (
                    <button type="button" className="icon-btn mini danger" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`} title={`Remove ${p.name}`}><Trash2 size={15} /></button>
                  ) : (
                    <button type="button" className="icon-btn mini restore" onClick={() => restore(p.id)} aria-label={`Restore ${p.name}`} title={`Restore ${p.name}`}><Check size={15} /></button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {!sortedPlayers.length && (
          <div className="empty player-empty">
            <Search size={20} />
            <h3>No players found</h3>
            <p>Try another player name or position.</p>
          </div>
        )}
      </div>

      {editing && (() => {
        const editingPlayer = players.find((item) => item.id === editing);
        if (!editingPlayer) return null;
        const balance = finiteTaka(balances[editingPlayer.id]);

        return (
          <OverlayPortal>
            <div
              className="player-edit-modal-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeEditing();
              }}
            >
              <div
                className="player-edit-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`player-edit-title-${editingPlayer.id}`}
                aria-describedby={`player-edit-description-${editingPlayer.id}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="player-edit-modal-head">
                  <div className="player-edit-modal-player">
                    <PlayerAvatar player={editingPlayer} size="lg" />
                    <div className="player-edit-modal-identity">
                      <span className="player-edit-modal-eyebrow" id={`player-edit-title-${editingPlayer.id}`}>EDIT PLAYER</span>
                      <strong>{editingPlayer.name || "Player"}</strong>
                      <span>{playerPositionLabel(editingPlayer)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="player-edit-modal-close"
                    onClick={closeEditing}
                    aria-label="Close edit player dialog"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className={`player-edit-modal-balance ${balance < 0 ? "negative" : balance > 0 ? "positive" : ""}`}>
                  <div>
                    <span>Current balance</span>
                    <strong>{signedMoney(balance)}</strong>
                  </div>
                  <span className="player-edit-modal-status">
                    {balance > 0 ? "CREDIT" : balance < 0 ? "DUE" : "SETTLED"}
                  </span>
                </div>

                <p id={`player-edit-description-${editingPlayer.id}`} className="player-edit-modal-description">
                  Update the player's name or play style.
                </p>

                <form
                  className="player-edit-modal-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    rename(editingPlayer.id);
                  }}
                >
                  <div className="player-edit-modal-field">
                    <label className="player-edit-modal-label" htmlFor={`player-edit-name-${editingPlayer.id}`}>
                      Player name
                    </label>
                    <input
                      id={`player-edit-name-${editingPlayer.id}`}
                      className="player-edit-modal-input"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="player-edit-modal-field">
                    <label className="player-edit-modal-label" htmlFor={`player-edit-position-${editingPlayer.id}`}>
                      Play style
                    </label>
                    <select
                      id={`player-edit-position-${editingPlayer.id}`}
                      className="player-edit-modal-select"
                      value={editingPosition}
                      onChange={(event) => setEditingPosition(event.target.value)}
                    >
                      <option value="">Play style</option>
                      {PLAYER_POSITIONS.map((position) => (
                        <option key={position.value} value={position.value}>
                          {position.label} ({position.short})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="player-edit-modal-actions">
                    <button type="button" className="player-edit-modal-cancel" onClick={closeEditing}>
                      Cancel
                    </button>
                    <button type="submit" className="player-edit-modal-save" disabled={!editingName.trim()}>
                      <Check size={16} />
                      Save changes
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </OverlayPortal>
        );
      })()}
    </section>
  );
}

function PlayerPublicProfile({ player, matches, onClose }) {
  useEscapeHandler(Boolean(player), onClose);
  const financials = useMemo(
    () => getPlayerFinancials(matches, player?.id, isMatchCompleted),
    [matches, player],
  );

  const historyRows = useMemo(
    () =>
      financials.rows.map(
        ({
          match,
          feeMinor,
          paidMinor,
          matchBalanceMinor: rowBalanceMinor,
          goals,
        }) => ({
          match,
          fee: feeMinor / 1000,
          paid: paidMinor / 1000,
          matchBalance: rowBalanceMinor / 1000,
          goals,
        }),
      ),
    [financials.rows],
  );

  if (!player) return null;

  const balance = financials.balanceMinor / 1000;
  const balanceState = balance < 0
    ? { label: "DUE", className: "due", value: Math.abs(balance), description: "Outstanding amount" }
    : balance > 0
      ? { label: "CREDIT", className: "credit", value: balance, description: "Available for future matches" }
      : { label: "SETTLED", className: "settled", value: 0, description: "Nothing outstanding" };

  const feeTotal = financials.totalFeesMinor / 1000;
  const paidTotal = financials.totalPaidMinor / 1000;
  const financialExplanation = balance > 0
    ? `Paid ${money(paidTotal)} against ${money(feeTotal)} in fees, leaving ${money(balance)} credit.`
    : balance < 0
      ? `${money(Math.abs(balance))} remains due after your recorded payments.`
      : `Paid ${money(paidTotal)} against ${money(feeTotal)} in fees. Nothing is outstanding.`;

  return (
    <section className="page detail-page player-profile-page">
      <header className="player-profile-hero premium">
        <button className="detail-back-btn player-profile-back" onClick={onClose} aria-label="Back to players" title="Back">
          <ChevronLeft size={20} />
        </button>
        <div className="player-profile-avatar-wrap">
          <PlayerAvatar player={player} size="lg" />
          {isPlayerActive(player) && <span className="player-profile-active-dot" aria-hidden="true" />}
        </div>
        <div className="player-profile-title">
          <span className="eyebrow">PLAYER PROFILE</span>
          <h2>{player.name}</h2>
          <p>{playerPositionLabel(player)}</p>
        </div>
        <span className={`player-status-chip ${isPlayerActive(player) ? "active" : "archived"}`}>
          {isPlayerActive(player) ? "ACTIVE" : "ARCHIVED"}
        </span>
      </header>

      <section className="player-profile-summary-card" aria-label="Player summary and current financial position">
        <div className={`player-profile-position ${balanceState.className}`}>
          <div>
            <span className="profile-section-label">CURRENT POSITION</span>
            {balanceState.className === "settled" ? (
              <strong className="position-amount settled-text">SETTLED</strong>
            ) : (
              <strong className="position-amount">{money(balanceState.value)}</strong>
            )}
          </div>
          <div className="position-state-label">{balanceState.label}</div>
          <span className="position-description">{balanceState.description}</span>
        </div>

        <div className="player-profile-stats-grid">
          <div className="profile-stat-cell">
            <span>MATCHES</span>
            <b>{financials.matches}</b>
          </div>
          <div className="profile-stat-cell">
            <span>GOALS</span>
            <b>{financials.goals}</b>
          </div>
          <div className="profile-stat-cell">
            <span>TOTAL FEES</span>
            <b>{money(feeTotal)}</b>
          </div>
          <div className="profile-stat-cell">
            <span>TOTAL PAID</span>
            <b>{money(paidTotal)}</b>
          </div>
        </div>

        <p className="player-profile-financial-explanation">{financialExplanation}</p>
      </section>

      <div className="player-profile-note compact" role="note">
        <Info size={14} aria-hidden="true" />
        <span>Statistics and payment history come from saved match records.</span>
      </div>

      <section className="player-history-card premium" aria-label="Match history">
        <div className="player-history-head premium">
          <div>
            <span className="eyebrow">MATCH HISTORY</span>
            <h3>Match history</h3>
          </div>
          <span>{financials.matches} match{financials.matches === 1 ? "" : "es"}</span>
        </div>

        <div className="player-history-list premium">
          {historyRows.length ? historyRows.slice().reverse().map((row, index, orderedRows) => {
            const { match, fee, paid, matchBalance, goals } = row;
            const score = getResultScore(match);
            const teamA = String(match?.teamAName || "Team A").trim() || "Team A";
            const teamB = String(match?.teamBName || "Team B").trim() || "Team B";
            const matchState = matchBalance < 0
              ? { label: "DUE", className: "due", value: Math.abs(matchBalance) }
              : matchBalance > 0
                ? { label: "CREDIT", className: "credit", value: matchBalance }
                : { label: "SETTLED", className: "settled", value: 0 };

            const playerIsTeamA = Array.isArray(match?.teams?.teamA) && match.teams.teamA.includes(player.id);
            const playerIsTeamB = Array.isArray(match?.teams?.teamB) && match.teams.teamB.includes(player.id);
            const playerTeam = playerIsTeamA
              ? teamA
              : playerIsTeamB
                ? teamB
                : "Participant";

            const matchNumber = orderedRows.length - index;
            const scoreLabel = score ? `${score.teamA}–${score.teamB}` : "—";
            const resultLabel = score && (playerIsTeamA || playerIsTeamB)
              ? (playerIsTeamA ? score.teamA : score.teamB) > (playerIsTeamA ? score.teamB : score.teamA)
                ? "WIN"
                : (playerIsTeamA ? score.teamA : score.teamB) < (playerIsTeamA ? score.teamB : score.teamA)
                  ? "LOSS"
                  : "DRAW"
              : "—";
            const resultClass = resultLabel === "WIN" ? "win" : resultLabel === "LOSS" ? "loss" : "draw";
            const dateValue = match?.date ? dateLabel(match.date) : "—";
            const explanation = matchState.className === "credit"
              ? paid > 0
                ? `Paid ${money(paid)} · ${money(matchState.value)} credit after this match`
                : `${money(matchState.value)} credit after this match`
              : matchState.className === "due"
                ? paid > 0
                  ? `Paid ${money(paid)} · ${money(matchState.value)} due after this match`
                  : `${money(matchState.value)} due after this match`
                : `Paid ${money(paid)} · fully settled`;

            return (
              <article className="player-history-row premium" key={match.id}>
                <div className="player-history-match-top">
                  <div className="player-history-match-meta">
                    <span className="player-history-match-number">MATCH {matchNumber}</span>
                    <span className="player-history-match-date">{dateValue}</span>
                  </div>
                  <div className={`history-financial-state ${matchState.className}`}>
                    <span>{matchState.label}</span>
                    {matchState.className !== "settled" && <b>{matchState.className === "credit" ? `+${money(matchState.value)}` : `-${money(matchState.value)}`}</b>}
                  </div>
                </div>

                <div className="player-history-matchup-block">
                  <div className="player-history-matchup" aria-label={`${teamA} ${scoreLabel} ${teamB}`}>
                    <span title={teamA}>{teamA}</span>
                    <strong>{scoreLabel}</strong>
                    <span title={teamB}>{teamB}</span>
                  </div>
                  <p className="player-history-team-label">Your team: <b>{playerTeam}</b></p>
                </div>

                <div className="player-history-details premium">
                  <div><span>Fee</span><b>{money(fee)}</b></div>
                  <div><span>Paid</span><b>{money(paid)}</b></div>
                  <div><span>Goals</span><b>{goals}</b></div>
                  <div className={`player-history-result ${resultClass}`}><span>Result</span><b>{resultLabel}</b></div>
                </div>

                <p className="player-history-explanation">{explanation}</p>
              </article>
            );
          }) : (
            <div className="empty player-empty compact-history-empty">
              <Users size={20} />
              <h3>No match history yet</h3>
              <p>Financial and match activity will appear here after completed matches.</p>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function getTeamAssignments(match) {
  const teamA = Array.isArray(match?.teams?.teamA) ? match.teams.teamA : [];
  const teamB = Array.isArray(match?.teams?.teamB) ? match.teams.teamB : [];
  const participating = new Set((match?.participants || []).map((p) => p.playerId));
  const cleanA = teamA.filter((id, i, arr) => participating.has(id) && arr.indexOf(id) === i);
  const cleanB = teamB.filter(
    (id, i, arr) => participating.has(id) && !cleanA.includes(id) && arr.indexOf(id) === i,
  );
  return { teamA: cleanA, teamB: cleanB };
}

const POSITION_ROW = {
  GK: 0,
  CB: 1, LB: 1, RB: 1,
  DM: 2, CM: 2,
  AM: 2, LW: 2, RW: 2,
  CF: 3, ST: 3,
};

const POSITION_PRIORITY = {
  GK: 0,
  CB: 10, LB: 11, RB: 11,
  DM: 20, CM: 21, AM: 22, LW: 23, RW: 23,
  CF: 30, ST: 31,
};

function playerRowPreference(player) {
  const code = getPlayerPosition(player?.position)?.short || player?.position;
  return Number.isInteger(POSITION_ROW[code]) ? POSITION_ROW[code] : null;
}

function sidePreference(code) {
  if (["LB", "LW"].includes(code)) return -1;
  if (["RB", "RW"].includes(code)) return 1;
  return 0;
}

function buildFormationRows(players, formation = "1-2-2", reverse = false) {
  const counts = String(formation).split("-").map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!counts.length) return players.length ? [players] : [];
  if (!players.length) return counts.map(() => []);

  const rows = counts.map((count) => Array(count).fill(null));
  const placed = new Set();
  const codeOf = (player) => getPlayerPosition(player?.position)?.short || player?.position || null;
  const rowOf = (code) => {
    if (code === "GK") return 0;
    if (["CB", "LB", "RB"].includes(code)) return Math.min(1, counts.length - 1);
    if (["DM", "CM", "AM", "LW", "RW"].includes(code)) return Math.min(2, counts.length - 1);
    if (["CF", "ST"].includes(code)) return Math.min(3, counts.length - 1);
    return null;
  };
  const sideOf = (code) => (code === "LB" || code === "LW" ? -1 : code === "RB" || code === "RW" ? 1 : 0);

  const ordered = [...players].sort((a, b) => {
    const ra = rowOf(codeOf(a));
    const rb = rowOf(codeOf(b));
    const pa = ra == null ? 99 : ra;
    const pb = rb == null ? 99 : rb;
    if (pa !== pb) return pa - pb;
    return (POSITION_PRIORITY[codeOf(a)] ?? 999) - (POSITION_PRIORITY[codeOf(b)] ?? 999);
  });

  const assign = (player, preferredRow) => {
    const code = codeOf(player);
    const side = sideOf(code);
    const candidates = counts.map((_, index) => index)
      .filter((index) => rows[index].some((slot) => !slot))
      .sort((a, b) => {
        if (preferredRow == null) {
          const aOut = a === 0 ? 1 : 0;
          const bOut = b === 0 ? 1 : 0;
          if (aOut !== bOut) return aOut - bOut;
          return a - b;
        }
        return Math.abs(a - preferredRow) - Math.abs(b - preferredRow) || a - b;
      });

    for (const row of candidates) {
      const free = rows[row].map((slot, index) => (slot ? null : index)).filter((i) => i !== null);
      if (!free.length) continue;
      const slotIndex = side < 0 ? free[0] : side > 0 ? free[free.length - 1] : free[Math.floor((free.length - 1) / 2)];
      rows[row][slotIndex] = player;
      placed.add(player.id);
      return;
    }
  };

  // Known positions first, unknown positions last.
  ordered.filter((player) => rowOf(codeOf(player)) != null).forEach((player) => assign(player, rowOf(codeOf(player))));
  players.filter((player) => !placed.has(player.id)).forEach((player) => assign(player, null));

  const compactRows = rows.map((row) => row.filter(Boolean));
  return reverse ? [...compactRows].reverse() : compactRows;
}

function TeamPlayer({ player, team, jerseyTheme, onJerseyClick, canEditColor }) {
  const position = getPlayerPosition(player?.position);
  const clickable = Boolean(canEditColor && onJerseyClick);
  const theme = jerseyTheme || getJerseyTheme(team === "a" ? "lime" : "white");
  return (
    <div className={`team-player team-player-${team}`}>
      <button
        type="button"
        className={`team-player-avatar-button ${clickable ? "clickable" : ""}`}
        style={{
          "--team-border": theme.background,
          "--team-color": theme.background,
          "--team-text": theme.text,
          "--team-sleeve": theme.sleeve,
        }}
        onClick={clickable ? () => onJerseyClick(team) : undefined}
        disabled={!clickable}
        title={clickable ? `Change ${team === "a" ? "Team A" : "Team B"} color` : `${player?.name || "Player"}`}
        aria-label={clickable ? `Change ${team === "a" ? "Team A" : "Team B"} color` : `${player?.name || "Player"}`}
      >
        <PlayerAvatar player={player} size="pitch" />
        {position?.short && <span className="team-player-position-badge">{position.short}</span>}
      </button>
      <b className="team-player-name">{player.name}</b>
    </div>
  );
}

function JerseyColorModal({ team, teamName, currentColor, onSelect, onClose }) {
  useBodyScrollLock(true);
  useEscapeHandler(true, onClose);
  return (
    <OverlayPortal>
      <div className="jersey-color-backdrop" role="dialog" aria-modal="true" aria-labelledby="jersey-color-title">
        <div className="jersey-color-modal">
          <div className="jersey-color-head">
            <div>
              <span className="eyebrow">TEAM COLOR</span>
              <h3 id="jersey-color-title">{teamName} color</h3>
              <p>Choose the border color for this team.</p>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Back"><ChevronLeft /></button>
          </div>
          <div className="jersey-color-grid">
            {JERSEY_COLOR_OPTIONS.map((option) => {
              const selected = currentColor === option.key;
              return (
                <button
                  type="button"
                  key={option.key}
                  className={`jersey-color-option ${selected ? "selected" : ""}`}
                  onClick={() => onSelect(team, option.key)}
                >
                  <span
                    className="jersey-color-swatch"
                    style={{ background: option.background }}
                    aria-hidden="true"
                  />
                  <b>{option.label}</b>
                  {selected && <Check size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

function FormationHalf({ title, team, players, formation, jerseyColor, onJerseyClick, canEditColor }) {
  const rows = buildFormationRows(players, formation, team === "b");
  const theme = getJerseyTheme(jerseyColor, team === "a" ? "lime" : "white");
  return (
    <section className={`formation-half ${team}`}>
      <div className="formation-label"><span>{title}</span><b>{players.length}</b></div>
      <div
        className="formation-rows"
        style={{ "--formation-row-count": Math.max(1, rows.length) }}
      >
        {players.length ? rows.map((row, rowIndex) => (
          <div className="formation-row" key={`${team}-${rowIndex}`}>
            {row.map((player) => (
              <TeamPlayer
                key={player.id}
                player={player}
                team={team}
                jerseyTheme={theme}
                canEditColor={canEditColor}
                onJerseyClick={onJerseyClick}
              />
            ))}
          </div>
        )) : <div className="formation-empty">No players assigned</div>}
      </div>
    </section>
  );
}

function TeamPitch({ teamA, teamB, getPlayer, teamAName, teamBName, formationA, formationB, jerseyColors, onJerseyClick, canEditColor }) {
  const aPlayers = teamA.map(getPlayer).filter(Boolean);
  const bPlayers = teamB.map(getPlayer).filter(Boolean);
  return (
    <div className="team-pitch">
      <div className="pitch-stripes" /><div className="pitch-boundary" />
      <div className="pitch-center-line" /><div className="pitch-center-circle" />
      <div className="pitch-box top" /><div className="pitch-box bottom" />
      <div className="goal-area top" /><div className="goal-area bottom" />
      <div className="penalty-dot top" /><div className="penalty-dot bottom" />
      <FormationHalf title={teamAName || "Team A"} team="a" players={aPlayers} formation={formationA} jerseyColor={jerseyColors?.teamA} onJerseyClick={onJerseyClick} canEditColor={canEditColor} />
      <div className="pitch-vs">VS</div>
      <FormationHalf title={teamBName || "Team B"} team="b" players={bPlayers} formation={formationB} jerseyColor={jerseyColors?.teamB} onJerseyClick={onJerseyClick} canEditColor={canEditColor} />
    </div>
  );
}

function Teams({ players, matches, profile, selectedMatchId, setSelectedMatchId, setAppError }) {
  const isAdmin = profile.role === "admin";
  const orderedMatches = useMemo(() => getMatchOrder(matches), [matches]);
  const [clock, setClock] = useState(() => new Date());
  const defaultTeamMatch = useMemo(() => {
    const next = getNextMatch(matches, clock);
    if (next) return next;
    const past = [...matches]
      .map((m) => ({ match: m, start: getMatchDateTime(m) }))
      .filter(({ start }) => start && start.getTime() <= clock.getTime())
      .sort((a, b) => b.start.getTime() - a.start.getTime());
    return past[0]?.match || orderedMatches[orderedMatches.length - 1] || null;
  }, [matches, clock, orderedMatches]);
  const [teamActiveId, setTeamActiveId] = useState(() => defaultTeamMatch?.id || null);
  const [matchPickerOpen, setMatchPickerOpen] = useState(false);
  const [matchSearch, setMatchSearch] = useState("");

  useBodyScrollLock(matchPickerOpen);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!teamActiveId && defaultTeamMatch?.id) {
      setTeamActiveId(defaultTeamMatch.id);
      return;
    }
    if (!teamActiveId) return;
    if (!orderedMatches.some((m) => m.id === teamActiveId)) {
      setTeamActiveId(defaultTeamMatch?.id || null);
    }
  }, [teamActiveId, defaultTeamMatch?.id, orderedMatches]);

  useEscapeHandler(matchPickerOpen, () => setMatchPickerOpen(false));

  const filteredMatches = orderedMatches.filter((item, index) =>
    matchesSearchQuery(item, index, matchSearch),
  );

  const selectTeamMatch = (id) => {
    setTeamActiveId(id);
    setSelectedMatchId?.(id);
    setMatchPickerOpen(false);
    setMatchSearch("");
  };

  const shiftMatch = (direction) => {
    if (!orderedMatches.length) return;
    const next = orderedMatches[activeIndex + direction];
    if (next) {
      setTeamActiveId(next.id);
      setSelectedMatchId?.(next.id);
    }
  };

  const activeId = teamActiveId || defaultTeamMatch?.id || selectedMatchId || orderedMatches[orderedMatches.length - 1]?.id || null;
  const activeIndex = orderedMatches.findIndex((m) => m.id === activeId);
  const match = activeIndex >= 0 ? orderedMatches[activeIndex] : null;

  useEffect(() => {
    if (match?.id) setMatchSearch("");
  }, [teamActiveId, match?.id]);
  const [editing, setEditing] = useState(false);
  const [draftA, setDraftA] = useState([]);
  const [draftB, setDraftB] = useState([]);
  const [jerseyColors, setJerseyColors] = useState(() => ({
    ...DEFAULT_JERSEY_COLORS,
    ...(match?.jerseyColors || {}),
  }));
  const [colorTeam, setColorTeam] = useState(null);
  const [busy, setBusy] = useState(false);

  const participants = useMemo(() => {
    if (!match) return [];
    const ids = new Set((match.participants || []).map((p) => p.playerId));
    return sortPlayersByName(players.filter((p) => ids.has(p.id)));
  }, [players, match]);
  const playerMap = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const assignments = useMemo(() => getTeamAssignments(match), [match]);

  useEffect(() => {
    if (!match) return;
    setEditing(false);
    setDraftA(assignments.teamA);
    setDraftB(assignments.teamB);
    setJerseyColors({ ...DEFAULT_JERSEY_COLORS, ...(match?.jerseyColors || {}) });
    setColorTeam(null);
  }, [match?.id, match?.teams?.teamA, match?.teams?.teamB, match?.jerseyColors, match?.participants?.length]);

  const beginEdit = () => { setDraftA(assignments.teamA); setDraftB(assignments.teamB); setEditing(true); };
  const assignPlayer = (id, team) => {
    setDraftA((prev) => prev.filter((x) => x !== id));
    setDraftB((prev) => prev.filter((x) => x !== id));
    if (team === "a") setDraftA((prev) => [...prev, id]);
    if (team === "b") setDraftB((prev) => [...prev, id]);
  };
  const autoDivide = () => {
    const ids = participants.map((p) => p.id);
    const half = Math.ceil(ids.length / 2);
    setDraftA(ids.slice(0, half));
    setDraftB(ids.slice(half));
  };
  const saveTeams = async () => {
    if (!match || !isAdmin) return;
    setBusy(true);
    try {
      const participantIds = new Set(participants.map((p) => p.id));
      const cleanA = draftA.filter((id, i, arr) => participantIds.has(id) && arr.indexOf(id) === i);
      const cleanB = draftB.filter((id, i, arr) => participantIds.has(id) && !cleanA.includes(id) && arr.indexOf(id) === i);
      // Formations are derived from the saved team assignments; no global formation is persisted.
      await updateDoc(doc(db, "matches", match.id), {
        teams: { teamA: cleanA, teamB: cleanB },
        updatedAt: serverTimestamp(),
      });
      setEditing(false);
    } catch (err) { setAppError(`Could not save teams: ${err.message}`); }
    finally { setBusy(false); }
  };
  const saveJerseyColor = async (team, colorKey) => {
    if (!match || !isAdmin || busy) return;
    const next = { ...jerseyColors, [team === "a" ? "teamA" : "teamB"]: colorKey };
    const previous = jerseyColors;
    setJerseyColors(next);
    setColorTeam(null);
    setBusy(true);
    try {
      await updateDoc(doc(db, "matches", match.id), { jerseyColors: next, updatedAt: serverTimestamp() });
    } catch (err) {
      setJerseyColors(previous);
      setAppError(`Could not save jersey color: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };
  const cancelEdit = () => { setEditing(false); setDraftA(assignments.teamA); setDraftB(assignments.teamB); };

  if (!match) return (
    <section className="page teams-page">
      <div className="hero compact"><div><div className="eyebrow">MATCH LINEUP</div><h2>Teams</h2><p>Select a match to create teams.</p></div></div>
      <div className="empty"><Goal /><h3>Select a match</h3><p>Select a match to create teams.</p></div>
    </section>
  );

  if (!participants.length) return (
    <section className="page teams-page">
      <div className="hero compact teams-hero">
        <div><div className="eyebrow">MATCH LINEUP</div><h2>Teams</h2><p>No players have been added to this match.</p></div>
        <div className="team-header-actions">
          <PositionGuide />
        </div>
      </div>
      <div className="date-strip-wrap team-match-selector">
        <div className={`date-strip ${getMatchDateTime(match)?.getTime() > clock.getTime() ? "upcoming" : ""}`}>
          <button aria-label="Previous match" title="Previous match" disabled={!orderedMatches.length || activeIndex <= 0} onClick={() => shiftMatch(-1)}><ChevronLeft /></button>
          <button className="date-picker-trigger" onClick={() => setMatchPickerOpen((v) => !v)} aria-expanded={matchPickerOpen} aria-haspopup="listbox">
            <span className="date-label">{match ? dateLabel(match.date) : "NO MATCH"}</span>
            <small>{orderedMatches.length ? `MATCH ${Math.max(1, activeIndex + 1)} OF ${orderedMatches.length}` : "SELECT MATCH DATE"}</small>
          </button>
          <button aria-label="Next match" title="Next match" disabled={!orderedMatches.length || activeIndex < 0 || activeIndex >= orderedMatches.length - 1} onClick={() => shiftMatch(1)}><ChevronRight /></button>
        </div>
        {matchPickerOpen && (
          <div className="match-picker">
            <div className="match-search-wrap">
              <Search size={15} />
              <input
                autoFocus
                type="search"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                autoComplete="off"
                spellCheck="false"
                inputMode="search"
                enterKeyHint="search"
                placeholder="Search match number, team or date"
                aria-label="Search match number, team, or date"
              />
              {matchSearch && <button type="button" className="match-search-clear" onClick={() => setMatchSearch("")} aria-label="Clear search"><X size={14} /></button>}
            </div>
            <div className="match-picker-list" role="listbox">
              {filteredMatches.length ? filteredMatches.map((item) => {
                const index = orderedMatches.findIndex((x) => x.id === item.id);
                const itemStart = getMatchDateTime(item);
                return (
                  <button key={item.id} type="button" className={`match-picker-item ${item.id === activeId ? "selected" : ""} ${defaultTeamMatch?.id === item.id ? "next-item" : ""}`} onClick={() => selectTeamMatch(item.id)} role="option" aria-selected={item.id === activeId}>
                    <span>{dateLabel(item.date)}</span>
                    <small>{defaultTeamMatch?.id === item.id ? "NEXT MATCH" : itemStart?.getTime() > clock.getTime() ? "UPCOMING" : `MATCH ${index + 1}`}</small>
                  </button>
                );
              }) : <div className="match-picker-empty">No matching date found.</div>}
            </div>
          </div>
        )}
      </div>
      <div className="empty"><Users /><h3>No players in this match</h3><p>No players have been added to this match.</p></div>
    </section>
  );

  const shownA = editing ? draftA : assignments.teamA;
  const shownB = editing ? draftB : assignments.teamB;
  const teamAFormation = getAutoFormation(shownA.length);
  const teamBFormation = getAutoFormation(shownB.length);
  const unassigned = participants.filter((p) => !shownA.includes(p.id) && !shownB.includes(p.id));
  const hasSavedTeams = assignments.teamA.length > 0 || assignments.teamB.length > 0;

  return (
    <section className="page teams-page">
      <div className="hero compact teams-hero">
        <div><div className="eyebrow">MATCH LINEUP</div><h2>Teams</h2><p>Build the match lineup on the pitch.</p></div>
        <div className="team-header-actions">
          <PositionGuide />
          {isAdmin && !editing && <button className="round-primary" onClick={beginEdit} aria-label="Edit teams"><Pencil size={18} /></button>}
        </div>
      </div>
      <div className="date-strip-wrap team-match-selector">
        <div className={`date-strip ${getMatchDateTime(match)?.getTime() > clock.getTime() ? "upcoming" : ""}`}>
          <button aria-label="Previous match" title="Previous match" disabled={!orderedMatches.length || activeIndex <= 0} onClick={() => shiftMatch(-1)}><ChevronLeft /></button>
          <button className="date-picker-trigger" onClick={() => setMatchPickerOpen((v) => !v)} aria-expanded={matchPickerOpen} aria-haspopup="listbox">
            <span className="date-label">{match ? dateLabel(match.date) : "NO MATCH"}</span>
            <small>{orderedMatches.length ? `MATCH ${Math.max(1, activeIndex + 1)} OF ${orderedMatches.length}` : "SELECT MATCH DATE"}</small>
          </button>
          <button aria-label="Next match" title="Next match" disabled={!orderedMatches.length || activeIndex < 0 || activeIndex >= orderedMatches.length - 1} onClick={() => shiftMatch(1)}><ChevronRight /></button>
        </div>
        {matchPickerOpen && (
          <div className="match-picker">
            <div className="match-search-wrap">
              <Search size={15} />
              <input
                autoFocus
                type="search"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                autoComplete="off"
                spellCheck="false"
                inputMode="search"
                enterKeyHint="search"
                placeholder="Search match number, team or date"
                aria-label="Search match number, team, or date"
              />
              {matchSearch && <button type="button" className="match-search-clear" onClick={() => setMatchSearch("")} aria-label="Clear search"><X size={14} /></button>}
            </div>
            <div className="match-picker-list" role="listbox">
              {filteredMatches.length ? filteredMatches.map((item) => {
                const index = orderedMatches.findIndex((x) => x.id === item.id);
                const itemStart = getMatchDateTime(item);
                return (
                  <button key={item.id} type="button" className={`match-picker-item ${item.id === activeId ? "selected" : ""} ${defaultTeamMatch?.id === item.id ? "next-item" : ""}`} onClick={() => selectTeamMatch(item.id)} role="option" aria-selected={item.id === activeId}>
                    <span>{dateLabel(item.date)}</span>
                    <small>{defaultTeamMatch?.id === item.id ? "NEXT MATCH" : itemStart?.getTime() > clock.getTime() ? "UPCOMING" : `MATCH ${index + 1}`}</small>
                  </button>
                );
              }) : <div className="match-picker-empty">No matching date found.</div>}
            </div>
          </div>
        )}
      </div>
      {!hasSavedTeams && !editing ? (
        <div className="team-empty-banner"><Goal size={17} /><span>Teams haven't been created yet.</span></div>
      ) : <TeamPitch
        teamA={shownA}
        teamB={shownB}
        teamAName={String(match?.teamAName || "Team A").trim() || "Team A"}
        teamBName={String(match?.teamBName || "Team B").trim() || "Team B"}
        getPlayer={(id) => playerMap.get(id)}
        formationA={teamAFormation}
        formationB={teamBFormation}
        jerseyColors={jerseyColors}
        onJerseyClick={isAdmin ? setColorTeam : undefined}
        canEditColor={isAdmin}
      />}
      {editing && (
        <div className="team-editor">
          <div className="team-editor-head">
            <div><span className="eyebrow">EDIT TEAMS</span><b>{participants.length} participating players</b></div>
            <div className="team-counts"><span>A {draftA.length}</span><span>B {draftB.length}</span></div>
          </div>
          <div className="formation-auto-card">
            <div>
              <span className="eyebrow">AUTO FORMATION</span>
              <b>Team A · {draftA.length} players · {teamAFormation || "No formation"}</b>
              <b>Team B · {draftB.length} players · {teamBFormation || "No formation"}</b>
            </div>
            <small>Set automatically from each team's assigned player count.</small>
          </div>
          <div className="team-editor-actions">
            <button className="secondary-btn" onClick={autoDivide}>Auto Divide</button>
            <button className="primary compact-btn" onClick={saveTeams} disabled={busy}><Check size={15} /> {busy ? "Saving..." : "Save Teams"}</button>
            <button className="ghost-btn" onClick={cancelEdit}>Cancel</button>
          </div>
          <div className="team-player-list">
            {participants.map((player) => {
              const team = draftA.includes(player.id) ? "a" : draftB.includes(player.id) ? "b" : "none";
              return (
                <div className="team-editor-row" key={player.id}>
                  <PlayerAvatar player={player} size="sm" />
                  <div className="team-editor-name"><b>{player.name}{getPlayerPosition(player.position)?.short ? ` (${getPlayerPosition(player.position).short})` : ""}</b><small>{team === "a" ? (String(match.teamAName || "Team A").trim() || "Team A") : team === "b" ? (String(match.teamBName || "Team B").trim() || "Team B") : "Unassigned"}</small></div>
                  <div className="team-choice">
                    <button className={team === "a" ? "selected" : ""} onClick={() => assignPlayer(player.id, "a")}>A</button>
                    <button className={team === "b" ? "selected" : ""} onClick={() => assignPlayer(player.id, "b")}>B</button>
                    <button className={team === "none" ? "selected muted" : ""} onClick={() => assignPlayer(player.id, "none")} aria-label={`Remove ${player.name} from teams`}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!editing && unassigned.length > 0 && hasSavedTeams && <div className="team-empty-banner warning">{unassigned.length} player{unassigned.length > 1 ? "s" : ""} still unassigned.</div>}
      {colorTeam && (
        <JerseyColorModal
          team={colorTeam}
          teamName={colorTeam === "a" ? (String(match?.teamAName || "Team A").trim() || "Team A") : (String(match?.teamBName || "Team B").trim() || "Team B")}
          currentColor={jerseyColors?.[colorTeam === "a" ? "teamA" : "teamB"]}
          onSelect={saveJerseyColor}
          onClose={() => setColorTeam(null)}
        />
      )}
    </section>
  );
}

function PositionGuide() {
  const [open, setOpen] = useState(false);
  useBodyScrollLock(open);
  useEscapeHandler(open, () => setOpen(false));

  return (
    <>
      <button
        type="button"
        className="position-guide-icon-btn"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="View player positions"
        title="View player positions"
      >
        <Eye size={17} />
      </button>

      {open && (
        <OverlayPortal>
          <div className="position-guide-backdrop" role="presentation" onClick={() => setOpen(false)}>
            <div className="position-guide-modal" role="dialog" aria-modal="true" aria-labelledby="position-guide-title" onClick={(e) => e.stopPropagation()}>
              <div className="position-guide-modal-head">
                <div>
                  <span className="eyebrow">PLAYER POSITIONS</span>
                  <h3 id="position-guide-title">Quick position guide</h3>
                  <p>Short codes shown beside player names on the pitch.</p>
                </div>
                <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Back"><ChevronLeft size={18} /></button>
              </div>
              <div className="position-table-wrap">
                <table className="position-table">
                  <thead><tr><th>Code</th><th>Position</th><th>Use</th></tr></thead>
                  <tbody>
                    {PLAYER_POSITIONS.map((position) => (
                      <tr key={position.value}>
                        <td><strong>{position.short}</strong></td>
                        <td>{position.label}</td>
                        <td className="position-use">{position.value === "GK" ? "Goal" : position.value === "ST" || position.value === "CF" ? "Attack" : position.value.includes("W") || position.value === "AM" ? "Wide / attack" : position.value === "DM" || position.value === "CM" ? "Midfield" : "Defence"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </OverlayPortal>
      )}
    </>
  );
}


function getCashOverviewData(matches, players) {
  const orderedMatches = getMatchOrder(Array.isArray(matches) ? matches : []);
  const playedMatches = [...orderedMatches]
    .filter((match) => !match?.deleted && isMatchCompleted(match))
    .reverse();

  const matchNumbers = new Map(
    orderedMatches.map((match, index) => [String(match?.id || index), index + 1]),
  );
  const playerOrder = new Map();
  (Array.isArray(players) ? players : []).forEach((player, index) => {
    playerOrder.set(String(player?.id || ""), index);
  });
  const playerMap = new Map(
    (Array.isArray(players) ? players : []).map((player) => [
      String(player?.id || ""),
      player,
    ]),
  );

  const currentBalances = Object.fromEntries(
    (Array.isArray(players) ? players : []).map((player) => {
      const financials = getPlayerFinancials(matches, player.id, isMatchCompleted);
      return [player.id, financials.balanceMinor / 1000];
    }),
  );
  const duePlayers = getDuePlayerBreakdowns(players, matches, currentBalances);

  // Single source of truth for historical club cash:
  // actual participant payments from completed matches minus those match costs.
  const collectionGroups = [];
  const costGroups = [];
  let totalCollectedMinor = 0;
  let totalCostMinor = 0;
  let paymentCount = 0;

  playedMatches.forEach((match, matchIndex) => {
    const matchId = String(match?.id || `${matchIndex}`);
    const matchNumber = matchNumbers.get(matchId) || matchIndex + 1;
    const costMinor = Math.max(
      0,
      Math.round(finiteTaka(match?.totalAmount) * 1000),
    );
    totalCostMinor += costMinor;

    costGroups.push({
      id: matchId,
      match,
      matchNumber,
      date: match?.date || "",
      amount: costMinor / 1000,
      matchup: getMatchupLabel(match),
      parity: matchNumber % 2 === 0 ? "even" : "odd",
    });

    const participants = Array.isArray(match?.participants)
      ? match.participants
      : [];
    const orderedParticipants = participants
      .map((participant, participantIndex) => ({ participant, participantIndex }))
      .filter(({ participant }) => Math.max(0, finiteTaka(participant?.paid)) > 0)
      .sort((a, b) => {
        const ai = playerOrder.has(String(a.participant?.playerId || ""))
          ? playerOrder.get(String(a.participant?.playerId || ""))
          : Number.MAX_SAFE_INTEGER;
        const bi = playerOrder.has(String(b.participant?.playerId || ""))
          ? playerOrder.get(String(b.participant?.playerId || ""))
          : Number.MAX_SAFE_INTEGER;
        return ai - bi || a.participantIndex - b.participantIndex;
      });

    const collectionSequenceStart = paymentCount;
    const payments = orderedParticipants.map(({ participant }, index) => {
      const amountMinor = Math.max(
        0,
        Math.round(finiteTaka(participant?.paid) * 1000),
      );
      totalCollectedMinor += amountMinor;
      paymentCount += 1;
      return {
        matchId,
        matchNumber,
        date: match?.date || "",
        playerId: String(participant?.playerId || ""),
        playerName: String(
          playerMap.get(String(participant?.playerId || ""))?.name ||
            "Unknown player",
        ),
        amount: amountMinor / 1000,
        sequence: collectionSequenceStart + index + 1,
      };
    });

    collectionGroups.push({
      id: matchId,
      match,
      matchNumber,
      date: match?.date || "",
      matchup: getMatchupLabel(match),
      payments,
      paymentCount: payments.length,
      parity: matchNumber % 2 === 0 ? "even" : "odd",
    });
  });

  return {
    totalCollected: totalCollectedMinor / 1000,
    totalCost: totalCostMinor / 1000,
    cashInHand: (totalCollectedMinor - totalCostMinor) / 1000,
    collectionMatchGroups: collectionGroups,
    costMatchGroups: costGroups,
    collectionPaymentCount: paymentCount,
    playedMatchCount: playedMatches.length,
    matchNumbers,
    duePlayers,
  };
}


function CashOverviewDuePlayers({ duePlayers = [] }) {
  const totalDue = duePlayers.reduce((sum, item) => sum + item.due, 0);

  return (
    <section className="due-players-card cash-overview-due" aria-labelledby="cash-due-players-title">
      <div className="due-players-head">
        <div>
          <div className="eyebrow" id="cash-due-players-title">DUE PLAYERS</div>
          <h3>Outstanding player balances</h3>
          <p>{duePlayers.length ? `${duePlayers.length} ${duePlayers.length === 1 ? "player" : "players"}` : "Everyone is settled"}</p>
        </div>
        <div className="due-players-total">
          <span>TOTAL DUE</span>
          <strong>{money(totalDue)}</strong>
        </div>
      </div>

      {duePlayers.length ? (
        <div className="due-player-list">
          {duePlayers.map(({ player, due, breakdown }) => (
            <div className="due-player-row" key={player.id}>
              <div className="due-player-main">
                <div className="due-player-name">
                  <b>{player.name}</b>
                  <span>Outstanding balance</span>
                </div>
                <strong className="due-player-amount">{money(due)}</strong>
              </div>
              <div className="due-player-sources">
                {breakdown.map((source) => (
                  <div
                    className="due-player-source"
                    key={`${player.id}-${source.match?.id || source.matchNumber}`}
                  >
                    <span>
                      Match {source.matchNumber} <i>•</i>{" "}
                      {source.match?.date ? dateLabel(source.match.date) : "—"}
                      {getMatchupLabel(source.match) ? (
                        <small>{getMatchupLabel(source.match)}</small>
                      ) : null}
                    </span>
                    <b>{money(source.amount)}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="due-players-empty">
          <Check size={17} aria-hidden="true" />
          <span>Everyone is settled</span>
        </div>
      )}
    </section>
  );
}

function CashOverviewSummary({
  data,
  onOpenCollection,
  onOpenCost,
  title = "CASH OVERVIEW",
  subtitle = "Club cash",
}) {
  const balanceState =
    data.cashInHand > 0
      ? "positive"
      : data.cashInHand < 0
        ? "negative"
        : "neutral";

  return (
    <section className="account-cash-overview" aria-labelledby="cash-overview-title">
      <div className="account-cash-heading">
        <span className="eyebrow" id="cash-overview-title">{title}</span>
        <span>{subtitle}</span>
      </div>
      <div className="account-cash-grid">
        <button
          type="button"
          className="account-cash-item account-cash-clickable"
          onClick={onOpenCollection}
          aria-haspopup="dialog"
          aria-label={`View total collected details: ${money(data.totalCollected)}`}
        >
          <span className="account-cash-label">TOTAL COLLECTED</span>
          <strong>{money(data.totalCollected)}</strong>
          <small>Recorded payments <span aria-hidden="true">›</span></small>
        </button>
        <button
          type="button"
          className="account-cash-item account-cash-clickable"
          onClick={onOpenCost}
          aria-haspopup="dialog"
          aria-label={`View total cost details: ${money(data.totalCost)}`}
        >
          <span className="account-cash-label">TOTAL COST</span>
          <strong>{money(data.totalCost)}</strong>
          <small>Played matches only <span aria-hidden="true">›</span></small>
        </button>
        <div className={`account-cash-item account-cash-hand ${balanceState}`}>
          <span className="account-cash-label">CASH IN HAND</span>
          <strong>{money(data.cashInHand)}</strong>
          <small>Available after match costs</small>
        </div>
      </div>
      <CashOverviewDuePlayers duePlayers={data.duePlayers} />
    </section>
  );
}

function CashAuditScreen({ data, auditType, onBack, backLabel = "Back to cash overview" }) {
  const isCollection = auditType === "collection";
  const auditTitle = isCollection ? "CASH COLLECTION" : "MATCH COST";
  const auditTotal = isCollection ? data.totalCollected : data.totalCost;

  useBodyScrollLock(true);
  useEscapeHandler(true, onBack);

  return (
    <OverlayPortal>
      <div className="account-cash-audit-screen">
        <header className="account-cash-audit-screen-head">
          <button
            type="button"
            className="account-cash-audit-back"
            onClick={onBack}
            aria-label={backLabel}
            title={backLabel}
          >
            <ChevronLeft size={20} />
          </button>
          <div className="account-cash-audit-screen-title">
            <span className="eyebrow">{auditTitle}</span>
            <strong>{money(auditTotal)}</strong>
            <p>
              {isCollection
                ? `${data.collectionPaymentCount} payments · ${data.playedMatchCount} played matches`
                : `${data.costMatchGroups.length} played matches`}
              <span> · Played matches only</span>
            </p>
          </div>
        </header>

        <main className="account-cash-audit-screen-content">
          {isCollection ? (
            data.collectionMatchGroups.length ? (
              data.collectionMatchGroups.map((group) => (
                <section
                  className={`account-cash-match-group ${group.parity}`}
                  key={`collection-group-${group.id}`}
                >
                  <div className="account-cash-match-group-head">
                    <div>
                      <span className="account-cash-match-label">MATCH {group.matchNumber}</span>
                      <strong>{group.date ? dateLabel(group.date) : "DATE UNAVAILABLE"}</strong>
                      <p>{group.matchup}</p>
                    </div>
                    <span className="account-cash-match-count">
                      {group.paymentCount} {group.paymentCount === 1 ? "payment" : "payments"}
                    </span>
                  </div>
                  <div className="account-cash-match-payments">
                    {group.payments.length ? group.payments.map((row, index) => (
                      <div
                        className="account-cash-payment-row"
                        key={`${row.matchId}-${row.playerId}-${index}`}
                      >
                        <span className="account-cash-audit-seq">
                          {String(row.sequence).padStart(2, "0")}
                        </span>
                        <strong>{row.playerName}</strong>
                        <span className="account-cash-payment-amount">{money(row.amount)}</span>
                      </div>
                    )) : (
                      <div className="account-cash-match-empty">No payments recorded for this match.</div>
                    )}
                  </div>
                </section>
              ))
            ) : (
              <div className="account-cash-audit-empty">
                <strong>NO COLLECTIONS</strong>
                <p>No player payments have been recorded for played matches yet.</p>
                <span>Total · {money(0)}</span>
              </div>
            )
          ) : (
            data.costMatchGroups.length ? (
              data.costMatchGroups.map((group) => (
                <section
                  className={`account-cash-match-group ${group.parity}`}
                  key={`cost-group-${group.id}`}
                >
                  <div className="account-cash-match-group-head">
                    <div>
                      <span className="account-cash-match-label">MATCH {group.matchNumber}</span>
                      <strong>{group.date ? dateLabel(group.date) : "DATE UNAVAILABLE"}</strong>
                      <p>{group.matchup}</p>
                    </div>
                    <span className="account-cash-payment-amount">{money(group.amount)}</span>
                  </div>
                </section>
              ))
            ) : (
              <div className="account-cash-audit-empty">
                <strong>NO MATCH COSTS</strong>
                <p>No played matches have been recorded yet.</p>
                <span>Total · {money(0)}</span>
              </div>
            )
          )}
        </main>

        <footer className="account-cash-audit-screen-total">
          <span>TOTAL</span>
          <strong>{money(auditTotal)}</strong>
        </footer>
      </div>
    </OverlayPortal>
  );
}

function CashOverviewScreen({ data, onClose }) {
  const [screen, setScreen] = useState("summary");

  useEscapeHandler(screen === "summary", onClose);
  useBodyScrollLock(true);

  if (screen !== "summary") {
    return (
      <CashAuditScreen
        data={data}
        auditType={screen}
        onBack={() => setScreen("summary")}
        backLabel="Back to cash overview"
      />
    );
  }

  return (
    <OverlayPortal>
      <div className="account-cash-audit-screen">
        <header className="account-cash-audit-screen-head">
          <button
            type="button"
            className="account-cash-audit-back"
            onClick={onClose}
            aria-label="Back to Match Centre"
            title="Back to Match Centre"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="account-cash-audit-screen-title">
            <span className="eyebrow">CASH OVERVIEW</span>
            <strong>Club cash</strong>
            <p>Played matches only</p>
          </div>
        </header>

        <main className="account-cash-audit-screen-content cash-overview-screen-content">
          <CashOverviewSummary
            data={data}
            onOpenCollection={() => setScreen("collection")}
            onOpenCost={() => setScreen("cost")}
            subtitle="Club cash"
          />
        </main>
      </div>
    </OverlayPortal>
  );
}

function Account({ profile, players, logout }) {
  const aliPlayer = useMemo(
    () => players.find((player) => String(player?.name || "").trim().toLowerCase() === "ali") || null,
    [players],
  );

  return (
    <section className="page account-page">
      <div className="account-hero">
        <PlayerAvatar
          player={aliPlayer || { name: "Ali" }}
          size="lg"
          className="account-profile-avatar"
          alt="Ali"
        />
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h2>WhiteSauce</h2>
          <p>{profile.email}</p>
        </div>
      </div>

      <div className="account-logout-wrap">
        <button
          type="button"
          className="leave-pitch-button"
          onClick={logout}
          aria-label="Leave the pitch and sign out"
          title="Leave the pitch"
        >
          <span className="leave-pitch-main">
            <LogOut size={17} aria-hidden="true" />
            <span>LEAVE THE PITCH</span>
          </span>
          <span className="leave-pitch-arrow" aria-hidden="true">→</span>
        </button>
        <p className="leave-pitch-microcopy">Until the next kickoff.</p>
      </div>
    </section>
  );
}

export default App;
