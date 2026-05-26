import React, { useState, useEffect, useMemo, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import {
  Calendar,
  Clock,
  MapPin,
  Settings,
  Plus,
  Sparkles,
  X,
  ChevronLeft,
  ChevronRight,
  Navigation,
  Trash2,
  Edit2,
  Loader2,
} from "lucide-react";

// --- Firebase Initialization ---
const firebaseConfig = {
  apiKey: "AIzaSyDUk7OktFdTtrOCTBsuyiW0PeCGNb1tnjs",
  authDomain: "swim-schedule-19108.firebaseapp.com",
  projectId: "swim-schedule-19108",
  storageBucket: "swim-schedule-19108.firebasestorage.app",
  messagingSenderId: "631672673385",
  appId: "1:631672673385:web:46b0a8f7a998dab511fef8",
  measurementId: "G-XPVYJK199J",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "Swim Scheduler";

// --- Helper Functions ---
const formatTime = (timeString) => {
  if (!timeString) return "";
  const [h, m] = timeString.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
};

const getDayName = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

export default function App() {
  const [user, setUser] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [settings, setSettings] = useState({ homeAddress: "", apiKey: "" });

  // UI State
  const [currentDate, setCurrentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [view, setView] = useState("day"); // 'day' | 'week'
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Modals & Tools
  const [isEditing, setIsEditing] = useState(false);
  const [editingLesson, setEditingLesson] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMagicAddOpen, setIsMagicAddOpen] = useState(false);
  const [magicText, setMagicText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDraftingPlan, setIsDraftingPlan] = useState(false);

  // Drag & Drop State
  const [dragState, setDragState] = useState(null);
  const dragActionOccurred = useRef(false);

  // --- 0. Tailwind CSS Injection (For CodeSandbox) ---
  useEffect(() => {
    if (!document.getElementById("tailwind-cdn")) {
      const script = document.createElement("script");
      script.id = "tailwind-cdn";
      script.src = "https://cdn.tailwindcss.com";
      document.head.appendChild(script);
    }
  }, []);

  // --- 1. Authentication & Firebase Sync ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (
          typeof __initial_auth_token !== "undefined" &&
          __initial_auth_token
        ) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.warn("Firebase Auth Error caught:", error);
        if (
          error.code === "auth/configuration-not-found" ||
          error.message.includes("configuration-not-found")
        ) {
          setAuthError("auth/configuration-not-found");
        } else {
          setAuthError(error.message);
        }
        setLoading(false);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const lessonsRef = collection(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "lessons"
    );
    const unsubscribeLessons = onSnapshot(
      lessonsRef,
      (snapshot) => {
        const loaded = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setLessons(loaded);
        setLoading(false);
      },
      (error) => {
        console.error("Lessons sync error:", error);
        setLoading(false);
      }
    );

    const settingsRef = doc(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "settings",
      "userSettings"
    );
    const unsubscribeSettings = onSnapshot(
      settingsRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setSettings(docSnap.data());
        }
      },
      (error) => console.error("Settings sync error:", error)
    );

    return () => {
      unsubscribeLessons();
      unsubscribeSettings();
    };
  }, [user]);

  // --- Drag & Drop Core Logic ---
  const weekDates = useMemo(() => {
    const d = new Date(currentDate + "T00:00:00");
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));

    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      return date.toISOString().split("T")[0];
    });
  }, [currentDate]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e) => {
      setDragState((prev) =>
        prev ? { ...prev, currentY: e.clientY, currentX: e.clientX } : null
      );
    };

    const handlePointerUp = async () => {
      const currentDrag = dragState;
      setDragState(null);

      if (!user) return;
      const lesson = lessons.find((l) => l.id === currentDrag.id);
      if (!lesson) return;

      const deltaY = currentDrag.currentY - currentDrag.startY;
      const deltaX = currentDrag.currentX - currentDrag.startX;
      const deltaMins = Math.round(((deltaY / 65) * 60) / 15) * 15;

      // Flag a drag action if the pointer moved more than 5 pixels
      if (Math.abs(deltaY) > 5 || Math.abs(deltaX) > 5) {
        dragActionOccurred.current = true;
        setTimeout(() => (dragActionOccurred.current = false), 150);
      }

      let finalTime = lesson.time;
      let finalDuration = lesson.duration;
      let finalDate = lesson.date;

      if (currentDrag.type === "move") {
        // Adjust Time
        const [h, m] = lesson.time.split(":").map(Number);
        let newTotalMins = h * 60 + m + deltaMins;
        newTotalMins = Math.max(0, Math.min(23 * 60 + 45, newTotalMins));
        const newH = Math.floor(newTotalMins / 60)
          .toString()
          .padStart(2, "0");
        const newM = (newTotalMins % 60).toString().padStart(2, "0");
        finalTime = `${newH}:${newM}`;

        // Adjust Date if in Week View
        if (view === "week") {
          const containerWidth =
            document.getElementById("timeline-container")?.clientWidth || 1;
          const colWidth = (containerWidth - 80) / 7;
          let deltaDays = Math.round(deltaX / colWidth);

          // Clamp to stay within current week bounds
          const currentIndex = weekDates.indexOf(lesson.date);
          if (currentIndex !== -1) {
            deltaDays = Math.max(
              -currentIndex,
              Math.min(6 - currentIndex, deltaDays)
            );
          }

          const originalDateObj = new Date(lesson.date + "T00:00:00");
          originalDateObj.setDate(originalDateObj.getDate() + deltaDays);
          finalDate = originalDateObj.toISOString().split("T")[0];
        }
      } else if (currentDrag.type === "resize") {
        finalDuration = Math.max(15, lesson.duration + deltaMins);
      }

      // Sync changes if they occurred
      if (
        finalTime !== lesson.time ||
        finalDuration !== lesson.duration ||
        finalDate !== lesson.date
      ) {
        try {
          await updateDoc(
            doc(
              db,
              "artifacts",
              appId,
              "users",
              user.uid,
              "lessons",
              lesson.id
            ),
            {
              time: finalTime,
              duration: finalDuration,
              date: finalDate,
            }
          );
        } catch (err) {
          console.error("Failed to update drag:", err);
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, lessons, user, view, weekDates]);

  // --- 2. Database Operations ---
  const saveLesson = async (e) => {
    e.preventDefault();
    if (!user) return;

    try {
      if (editingLesson.id) {
        const { id, ...data } = editingLesson;
        await updateDoc(
          doc(db, "artifacts", appId, "users", user.uid, "lessons", id),
          data
        );
      } else {
        await addDoc(
          collection(db, "artifacts", appId, "users", user.uid, "lessons"),
          editingLesson
        );
      }
      setIsEditing(false);
      setEditingLesson(null);
    } catch (error) {
      console.error("Error saving lesson:", error);
    }
  };

  const deleteLesson = async (id) => {
    if (!user) return;
    if (window.confirm("Are you sure you want to delete this lesson?")) {
      await deleteDoc(
        doc(db, "artifacts", appId, "users", user.uid, "lessons", id)
      );
      setIsEditing(false);
      setEditingLesson(null);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    if (!user) return;
    await setDoc(
      doc(
        db,
        "artifacts",
        appId,
        "users",
        user.uid,
        "settings",
        "userSettings"
      ),
      settings
    );
    setIsSettingsOpen(false);
  };

  // --- 3. AI Integrations (Gemini API) ---
  const handleMagicAdd = async () => {
    if (!magicText.trim()) return;
    setIsAnalyzing(true);
    try {
      const apiKey = ""; // Injected by environment
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: magicText }] }],
            systemInstruction: {
              parts: [
                {
                  text: "You are a scheduling assistant. Extract details for a swim lesson. Return ONLY valid JSON with no markdown formatting. Schema: { date: 'YYYY-MM-DD' (assume current year if unspecified), time: 'HH:MM' (24hr clock string), duration: number (in minutes, default 30), name: string, address: string, notes: string }",
                },
              ],
            },
            generationConfig: { responseMimeType: "application/json" },
          }),
        }
      );
      const result = await response.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);

      setEditingLesson({
        ...data,
        driveTime: 15, // Default drive time assumption
      });
      setIsMagicAddOpen(false);
      setMagicText("");
      setIsEditing(true);
    } catch (error) {
      console.error("Gemini Error:", error);
      alert("Could not parse the message. Please try adding it manually.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDraftPlan = async () => {
    if (!editingLesson.notes && !editingLesson.name) return;
    setIsDraftingPlan(true);
    try {
      const apiKey = ""; // Injected by environment
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Draft a ${editingLesson.duration}-minute swim lesson plan for ${editingLesson.name}. Context notes: ${editingLesson.notes}. Keep it concise with bullet points and times.`,
                  },
                ],
              },
            ],
            systemInstruction: {
              parts: [
                {
                  text: "You are a swim instructor creating a practical, time-boxed lesson plan. Respond concisely with no markdown headings.",
                },
              ],
            },
          }),
        }
      );
      const result = await response.json();
      const planText = result.candidates[0].content.parts[0].text;

      setEditingLesson((prev) => ({
        ...prev,
        notes: prev.notes
          ? prev.notes + "\n\n--- AI Lesson Plan ---\n" + planText
          : "--- AI Lesson Plan ---\n" + planText,
      }));
    } catch (error) {
      console.error("Failed to draft plan:", error);
      alert("Could not draft the plan right now.");
    } finally {
      setIsDraftingPlan(false);
    }
  };

  // --- 4. Logic & Calculations ---
  const openNewLesson = () => {
    setEditingLesson({
      date: currentDate,
      time: "12:00",
      duration: 45,
      name: "",
      address: "",
      notes: "",
      driveTime: 15,
    });
    setIsEditing(true);
  };

  const changeDate = (amount) => {
    const days = view === "week" ? amount * 7 : amount;
    const d = new Date(currentDate + "T00:00:00");
    d.setDate(d.getDate() + days);
    setCurrentDate(d.toISOString().split("T")[0]);
  };

  const calculateDriveTime = () => {
    setEditingLesson((prev) => ({
      ...prev,
      driveTime: Math.floor(Math.random() * 15) + 10,
    }));
  };

  const displayLessons = useMemo(() => {
    if (view === "day") {
      return lessons
        .filter((l) => l.date === currentDate)
        .sort((a, b) => a.time.localeCompare(b.time));
    } else {
      return lessons
        .filter((l) => weekDates.includes(l.date))
        .sort((a, b) => a.time.localeCompare(b.time));
    }
  }, [lessons, currentDate, view, weekDates]);

  const getPreviousLocation = (currentLesson) => {
    const sorted = lessons
      .filter((l) => l.date === currentLesson.date)
      .sort((a, b) => a.time.localeCompare(b.time));
    const index = sorted.findIndex((l) => l.id === currentLesson.id);
    if (index > 0)
      return { type: "lesson", address: sorted[index - 1].address };
    return { type: "home", address: settings.homeAddress || "Your Location" };
  };

  const timeSlots = Array.from({ length: 13 }, (_, i) => i + 7); // 7 AM to 7 PM

  // --- Rendering Check ---
  if (authError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-red-100">
          <div className="text-red-500 mb-6 flex justify-center">
            <X className="w-16 h-16 bg-red-50 p-3 rounded-full" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">
            Almost there!
          </h2>
          <p className="text-slate-600 mb-6 text-sm leading-relaxed">
            It looks like <b>Anonymous Authentication</b> is not enabled in your
            Firebase project yet. This is exactly what the console error is
            complaining about! To fix this:
          </p>
          <ol className="text-left text-sm text-slate-700 list-decimal pl-5 mb-6 space-y-3 font-medium">
            <li>
              Go back to your{" "}
              <a
                href="https://console.firebase.google.com/"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                Firebase Console
              </a>
              .
            </li>
            <li>
              Click on <b>Authentication</b> in the left menu.
            </li>
            <li>
              Click on the <b>Sign-in method</b> tab.
            </li>
            <li>
              Click <b>Add new provider</b> and select <b>Anonymous</b>.
            </li>
            <li>
              Toggle it to <b>Enable</b> and click <b>Save</b>.
            </li>
            <li>Refresh this StackBlitz page!</li>
          </ol>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-left">
            <p className="text-xs text-slate-400 font-mono break-all">
              Console Error details: {authError}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 select-none">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="bg-blue-500 p-2 rounded-lg">
            <Calendar className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 hidden sm:block">
            Swim Schedule
          </h1>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-4">
          <div className="flex bg-slate-100 p-1 rounded-lg mr-2">
            <button
              onClick={() => setView("day")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                view === "day"
                  ? "bg-white shadow-sm text-slate-800"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setView("week")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                view === "week"
                  ? "bg-white shadow-sm text-slate-800"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Week
            </button>
          </div>
          <button
            onClick={() => setIsMagicAddOpen(true)}
            className="flex items-center px-3 py-2 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-lg text-sm font-medium transition-colors"
          >
            <Sparkles className="w-4 h-4 mr-1" />{" "}
            <span className="hidden sm:inline">Magic Add</span>
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto p-4">
        {/* Date Navigator */}
        <div className="flex items-center justify-between mb-6 bg-white p-2 rounded-xl shadow-sm border border-slate-100">
          <button
            onClick={() => changeDate(-1)}
            className="p-2 hover:bg-slate-100 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center flex-1">
            <h2 className="text-lg font-bold text-slate-800">
              {view === "day"
                ? getDayName(currentDate)
                : `${getDayName(weekDates[0])} - ${getDayName(weekDates[6])}`}
            </h2>
            <p className="text-sm text-slate-500">
              {displayLessons.length}{" "}
              {displayLessons.length === 1 ? "Lesson" : "Lessons"}{" "}
              {view === "day" ? "Today" : "This Week"}
            </p>
          </div>
          <button
            onClick={() => changeDate(1)}
            className="p-2 hover:bg-slate-100 rounded-lg"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Timeline View */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden relative">
          <div
            className="relative h-[800px] overflow-y-auto flex flex-col"
            id="timeline-container"
          >
            {/* Week View Header row */}
            {view === "week" && (
              <div className="flex shrink-0 relative border-b border-slate-200 bg-slate-50 sticky top-0 z-40">
                <div className="w-20 shrink-0 bg-slate-50"></div>
                {weekDates.map((date) => (
                  <div
                    key={date}
                    className="flex-1 text-center py-2 border-l border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                    onClick={() => {
                      setCurrentDate(date);
                      setView("day");
                    }}
                  >
                    <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">
                      {new Date(date + "T00:00:00").toLocaleDateString(
                        "en-US",
                        { weekday: "short" }
                      )}
                    </div>
                    <div
                      className={`text-sm sm:text-lg font-bold ${
                        date === currentDate
                          ? "text-blue-600"
                          : "text-slate-800"
                      }`}
                    >
                      {new Date(date + "T00:00:00").getDate()}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Grid Area Wrapper */}
            <div className="relative flex-1">
              {timeSlots.map((hour) => (
                <div
                  key={hour}
                  className="flex relative border-b border-slate-100 group h-[65px]"
                >
                  <div className="w-20 py-2 pr-4 text-right text-xs text-slate-400 font-medium shrink-0 bg-white">
                    {formatTime(`${hour}:00`)}
                  </div>
                  {view === "day" ? (
                    <div className="flex-1 relative border-l border-slate-100 bg-slate-50/30 group-hover:bg-slate-50 transition-colors"></div>
                  ) : (
                    weekDates.map((d) => (
                      <div
                        key={d}
                        className="flex-1 relative border-l border-slate-100 bg-slate-50/30 group-hover:bg-slate-50 transition-colors"
                      ></div>
                    ))
                  )}
                </div>
              ))}

              {/* Lesson Blocks */}
              {displayLessons.map((lesson) => {
                const activeDrag =
                  dragState?.id === lesson.id ? dragState : null;

                let displayTime = lesson.time;
                let displayDuration = lesson.duration;
                let displayDate = lesson.date;

                // Compute Visual Overrides during drag
                if (activeDrag) {
                  const deltaY = activeDrag.currentY - activeDrag.startY;
                  const deltaMins = Math.round(((deltaY / 65) * 60) / 15) * 15;

                  if (activeDrag.type === "move") {
                    const [h, m] = displayTime.split(":").map(Number);
                    let newTotalMins = h * 60 + m + deltaMins;
                    newTotalMins = Math.max(
                      0,
                      Math.min(23 * 60 + 45, newTotalMins)
                    );
                    const newH = Math.floor(newTotalMins / 60)
                      .toString()
                      .padStart(2, "0");
                    const newM = (newTotalMins % 60)
                      .toString()
                      .padStart(2, "0");
                    displayTime = `${newH}:${newM}`;

                    if (view === "week") {
                      const deltaX = activeDrag.currentX - activeDrag.startX;
                      const containerWidth =
                        document.getElementById("timeline-container")
                          ?.clientWidth || 1;
                      const colWidth = (containerWidth - 80) / 7;
                      let deltaDays = Math.round(deltaX / colWidth);
                      const currentIndex = weekDates.indexOf(displayDate);
                      if (currentIndex !== -1)
                        deltaDays = Math.max(
                          -currentIndex,
                          Math.min(6 - currentIndex, deltaDays)
                        );

                      const originalDateObj = new Date(
                        displayDate + "T00:00:00"
                      );
                      originalDateObj.setDate(
                        originalDateObj.getDate() + deltaDays
                      );
                      displayDate = originalDateObj.toISOString().split("T")[0];
                    }
                  } else if (activeDrag.type === "resize") {
                    displayDuration = Math.max(15, displayDuration + deltaMins);
                  }
                }

                const [h, m] = displayTime.split(":").map(Number);
                const topMinutes = (h - 7) * 60 + m;
                const topPx = (topMinutes / 60) * 65;
                const heightPx = (displayDuration / 60) * 65;
                const driveHeightPx = (lesson.driveTime / 60) * 65;

                if (topMinutes < -60) return null; // Avoid rendering way off top

                // Apply fix to properly account for the 5rem left time-column offset across relative container width
                const isWeekView = view === "week";
                const dayIndex = isWeekView
                  ? weekDates.indexOf(displayDate)
                  : 0;
                const leftOffset = isWeekView
                  ? `calc(5rem + ((100% - 5rem) * ${
                      Math.max(0, dayIndex) / 7
                    }))`
                  : "5rem";
                const blockWidth = isWeekView
                  ? `calc(((100% - 5rem) / 7) - 0.5rem)`
                  : "calc(100% - 6rem)";
                const marginLeft = isWeekView ? "0.25rem" : "1rem";
                const zIndex = activeDrag ? 30 : 10;

                return (
                  <div
                    key={lesson.id}
                    className={`absolute flex flex-col group ${
                      activeDrag ? "cursor-grabbing opacity-95" : "cursor-grab"
                    }`}
                    style={{
                      top: `${topPx - driveHeightPx}px`,
                      left: leftOffset,
                      width: blockWidth,
                      marginLeft: marginLeft,
                      zIndex,
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDragState({
                        id: lesson.id,
                        type: "move",
                        startY: e.clientY,
                        startX: e.clientX,
                        currentY: e.clientY,
                        currentX: e.clientX,
                      });
                    }}
                    onClick={() => {
                      if (dragActionOccurred.current) return;
                      setEditingLesson(lesson);
                      setIsEditing(true);
                    }}
                  >
                    {/* Drive Time Block */}
                    {lesson.driveTime > 0 && (
                      <div
                        className="bg-blue-100/50 border-2 border-dashed border-blue-300 rounded-t-lg mx-1 sm:mx-2 flex items-center justify-center text-[10px] text-blue-600 font-medium overflow-hidden transition-all group-hover:bg-blue-100 pointer-events-none"
                        style={{ height: `${driveHeightPx}px` }}
                      >
                        <span className="hidden sm:inline">
                          🚗 {lesson.driveTime}m drive
                        </span>
                        <span className="sm:hidden">
                          🚗 {lesson.driveTime}m
                        </span>
                      </div>
                    )}
                    {/* Lesson Block */}
                    <div
                      className="relative bg-blue-500 border border-blue-600 rounded-lg shadow-sm p-1.5 sm:p-2 text-white overflow-hidden hover:shadow-md transition-shadow"
                      style={{
                        height: `${heightPx}px`,
                        marginTop: lesson.driveTime > 0 ? "-2px" : "0",
                      }}
                    >
                      <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-1 pointer-events-none">
                        <h4 className="font-semibold text-xs sm:text-sm leading-tight truncate">
                          {lesson.name}
                        </h4>
                        <span className="text-[10px] sm:text-xs bg-blue-600/50 px-1 py-0.5 rounded sm:ml-2 whitespace-nowrap self-start">
                          {displayDuration}m
                        </span>
                      </div>
                      {!isWeekView && (
                        <p className="text-xs text-blue-100 mt-1 truncate flex items-center pointer-events-none">
                          <MapPin className="w-3 h-3 mr-1 inline" />{" "}
                          {lesson.address}
                        </p>
                      )}

                      {/* Resize Handle */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-3 group-hover:bg-blue-600/30 cursor-ns-resize flex items-center justify-center transition-colors touch-none"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            id: lesson.id,
                            type: "resize",
                            startY: e.clientY,
                            startX: e.clientX,
                            currentY: e.clientY,
                            currentX: e.clientX,
                          });
                        }}
                      >
                        <div className="w-8 h-1 bg-white/40 rounded-full" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Floating Add Button */}
        <button
          onClick={openNewLesson}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 hover:scale-105 transition-all focus:ring-4 ring-blue-300 z-20"
        >
          <Plus className="w-6 h-6" />
        </button>
      </main>

      {/* --- MODALS --- */}

      {/* 1. Add/Edit Lesson Modal */}
      {isEditing && editingLesson && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">
                {editingLesson.id ? "Edit Lesson" : "New Lesson"}
              </h2>
              <button
                onClick={() => setIsEditing(false)}
                className="p-1 hover:bg-slate-200 rounded-lg"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <form
              onSubmit={saveLesson}
              className="p-4 overflow-y-auto flex-1 space-y-4 select-text"
            >
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Student Name
                </label>
                <input
                  required
                  type="text"
                  value={editingLesson.name}
                  onChange={(e) =>
                    setEditingLesson({ ...editingLesson, name: e.target.value })
                  }
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. Jimmy Smith"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Date
                  </label>
                  <input
                    required
                    type="date"
                    value={editingLesson.date}
                    onChange={(e) =>
                      setEditingLesson({
                        ...editingLesson,
                        date: e.target.value,
                      })
                    }
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Time
                  </label>
                  <input
                    required
                    type="time"
                    value={editingLesson.time}
                    onChange={(e) =>
                      setEditingLesson({
                        ...editingLesson,
                        time: e.target.value,
                      })
                    }
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Duration (min)
                  </label>
                  <select
                    value={editingLesson.duration}
                    onChange={(e) =>
                      setEditingLesson({
                        ...editingLesson,
                        duration: Number(e.target.value),
                      })
                    }
                    className="w-full p-2 border rounded-lg bg-white"
                  >
                    <option value={30}>30 mins</option>
                    <option value={45}>45 mins</option>
                    <option value={60}>60 mins</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Drive Buffer
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={editingLesson.driveTime}
                      onChange={(e) =>
                        setEditingLesson({
                          ...editingLesson,
                          driveTime: Number(e.target.value),
                        })
                      }
                      className="w-full p-2 border rounded-lg"
                      min="0"
                    />
                    <button
                      type="button"
                      onClick={calculateDriveTime}
                      className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200"
                      title="Auto-Calculate (Demo)"
                    >
                      <Sparkles className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Pool Address
                </label>
                <div className="flex space-x-2">
                  <input
                    required
                    type="text"
                    value={editingLesson.address}
                    onChange={(e) =>
                      setEditingLesson({
                        ...editingLesson,
                        address: e.target.value,
                      })
                    }
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="123 Main St..."
                  />
                  {editingLesson.id && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                        getPreviousLocation(editingLesson).address
                      )}&destination=${encodeURIComponent(
                        editingLesson.address
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 flex-shrink-0 flex items-center justify-center"
                      title="Open in Maps"
                    >
                      <Navigation className="w-5 h-5" />
                    </a>
                  )}
                </div>
                {editingLesson.id && (
                  <p className="text-xs text-slate-500 mt-1">
                    Routing from:{" "}
                    {getPreviousLocation(editingLesson).type === "home"
                      ? "Home"
                      : "Previous Lesson"}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    Notes
                  </label>
                  <button
                    type="button"
                    onClick={handleDraftPlan}
                    disabled={
                      isDraftingPlan ||
                      (!editingLesson.notes && !editingLesson.name)
                    }
                    className="text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center disabled:opacity-50"
                  >
                    {isDraftingPlan ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3 mr-1" />
                    )}
                    AI Draft Plan
                  </button>
                </div>
                <textarea
                  value={editingLesson.notes}
                  onChange={(e) =>
                    setEditingLesson({
                      ...editingLesson,
                      notes: e.target.value,
                    })
                  }
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  rows="4"
                  placeholder="Child's skill level, gate code, etc."
                />
              </div>
            </form>

            <div className="p-4 border-t bg-slate-50 flex justify-between">
              {editingLesson.id ? (
                <button
                  type="button"
                  onClick={() => deleteLesson(editingLesson.id)}
                  className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium flex items-center"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </button>
              ) : (
                <div></div>
              )}
              <button
                onClick={saveLesson}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                Save Lesson
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Magic Add Modal */}
      {isMagicAddOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-purple-50">
              <h2 className="text-lg font-bold text-purple-900 flex items-center">
                <Sparkles className="w-5 h-5 mr-2 text-purple-600" /> Magic Add
              </h2>
              <button
                onClick={() => setIsMagicAddOpen(false)}
                className="p-1 hover:bg-purple-100 rounded-lg"
              >
                <X className="w-5 h-5 text-purple-700" />
              </button>
            </div>
            <div className="p-4 space-y-4 select-text">
              <p className="text-sm text-slate-600">
                Paste a text message from a parent here, and AI will
                automatically fill out the schedule form for you.
              </p>
              <textarea
                value={magicText}
                onChange={(e) => setMagicText(e.target.value)}
                placeholder='"Hey, can you teach Billy next Tuesday at 3pm for 45 mins at 123 Main St?"'
                className="w-full p-3 border rounded-xl min-h-[120px] focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <button
                onClick={handleMagicAdd}
                disabled={isAnalyzing || !magicText.trim()}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-50 flex justify-center items-center"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />{" "}
                    Analyzing...
                  </>
                ) : (
                  "Extract Details"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center">
                <Settings className="w-5 h-5 mr-2 text-slate-600" /> Settings
              </h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 hover:bg-slate-200 rounded-lg"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={saveSettings} className="p-4 space-y-4 select-text">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Home Base Address
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Used to calculate the drive time for the first lesson of the
                  day.
                </p>
                <input
                  type="text"
                  value={settings.homeAddress || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, homeAddress: e.target.value })
                  }
                  className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Your home address..."
                />
              </div>
              <div className="pt-4 mt-4 border-t">
                <p className="text-sm text-green-600 font-medium flex items-center">
                  <div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>
                  Database Connected (Firebase)
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Your data is now permanently saving securely to the cloud. You
                  are ready to connect Zapier whenever you'd like.
                </p>
              </div>
              <button
                type="submit"
                className="w-full py-3 mt-4 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-900"
              >
                Save Preferences
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
