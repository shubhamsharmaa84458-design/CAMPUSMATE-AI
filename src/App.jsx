import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  BookOpen,
  CalendarDays,
  Sparkles,
  Brain,
  BarChart3,
  Compass,
  FileText,
  Eye,
  LogOut,
  Plus,
  X,
  Check,
  Trash2,
  Circle,
  CheckCircle2,
  Award,
  TrendingUp,
  AlertTriangle,
  GraduationCap,
  Send,
  ChevronRight,
  Target,
  Clock,
  User,
  Menu,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

import './init-fetch';

const USERS_KEY = "campusmate_users";
const SESSION_KEY = "campusmate_session";

const defaultData = {
  subjects: [
    {
      id: "sub1",
      name: "Data Structures",
      code: "KCS301",
      topics: [
        { id: "t1", name: "Arrays", mastery: 75 },
        { id: "t2", name: "Linked Lists", mastery: 55 },
        { id: "t3", name: "Stacks and Queues", mastery: 65 },
        { id: "t4", name: "Trees", mastery: 45 },
      ],
    },
    {
      id: "sub2",
      name: "DBMS",
      code: "KCS302",
      topics: [
        { id: "t5", name: "ER Model", mastery: 70 },
        { id: "t6", name: "SQL", mastery: 80 },
        { id: "t7", name: "Normalization", mastery: 50 },
      ],
    },
    {
      id: "sub3",
      name: "Computer Networks",
      code: "KCS303",
      topics: [
        { id: "t8", name: "OSI Model", mastery: 60 },
        { id: "t9", name: "TCP/IP", mastery: 72 },
        { id: "t10", name: "Routing", mastery: 48 },
      ],
    },
  ],
  tasks: [],
  attempts: [],
  chat: [],
  syllabus: null,
  notes: [],
  attendance: {},
};

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getUserData(email) {
  try {
    const data = JSON.parse(
      localStorage.getItem(`campusmate_data_${email}`)
    );

    return data || defaultData;
  } catch {
    return defaultData;
  }
}

function saveUserData(email, data) {
  localStorage.setItem(
    `campusmate_data_${email}`,
    JSON.stringify(data)
  );
}

async function readApiResponse(response, fallbackMessage) {
  const body = await response.text();
  let payload = {};
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(
      response.status === 404
        ? "The PDF service is unavailable. Please wait for the server deployment to finish and try again."
        : `${fallbackMessage} (server returned ${response.status})`
    );
  }

  if (!response.ok) throw new Error(payload.error || fallbackMessage);
  return payload;
}

function isExtractedHeading(line) {
  return /^(?:#{1,6}\s+|(?:unit|chapter|module|topic|section|subject)\s*[:.-]?\s+|\d+(?:\.\d+)*[.)]?\s+|[A-Z][A-Z0-9\s&-]{3,})/i.test(line);
}

function ExtractedText({ text }) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  if (!lines.some(Boolean)) return "No text was found.";

  return lines.map((line, index) => {
    if (!line) return <div className="extracted-text-spacer" key={`spacer-${index}`} />;
    return (
      <div
        className={isExtractedHeading(line) ? "extracted-text-heading" : "extracted-text-line"}
        key={`line-${index}`}
      >
        {line.replace(/^#{1,6}\s+/, "")}
      </div>
    );
  });
}

function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
  className = "",
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`btn btn-${variant} ${className}`.trim()}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

function Card({ children, className = "" }) {
  return <div className={`card ${className}`}>{children}</div>;
}

function ProgressBar({ value }) {
  return (
    <div className="progress">
      <div
        className="progress-fill"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* =========================================================
   AUTH
========================================================= */

function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [course, setCourse] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password || (mode === "register" && !course.trim())) {
      setError(mode === "register" ? "Please enter email, password, and course." : "Please enter email and password.");
      return;
    }

    // Server-only auth (no local fallback)
    if (mode === "register") {
      if (!name.trim()) {
        setError("Please enter your name.");
        return;
      }

      if (password.length < 4) {
        setError("Password must contain at least 4 characters.");
        return;
      }

      try {
        const form = new FormData();
        form.append("name", name.trim());
        form.append("email", cleanEmail);
        form.append("password", password);
        form.append("course", course.trim());
        const resp = await fetch("/api/register", {
          method: "POST",
          body: form,
        });

        if (!resp.ok) {
          const text = await resp.text();
          setError(text || "Registration failed on server.");
          return;
        }

        const json = await resp.json();
        if (json.token) localStorage.setItem("campusmate_token", json.token);
        if (json.user) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(json.user));
          // ensure local data exists for this user
          saveUserData(cleanEmail, { ...defaultData, subjects: json.user.subjects || [] });
          onLogin(json.user);
          return;
        }

        setError("Registration succeeded but no user info returned.");
        return;
      } catch (err) {
        console.error("Registration error:", err);
        setError("Unable to reach authentication server. Please try again later.");
        return;
      }
    }

    // LOGIN
    try {
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, password }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        setError(text || "Login failed on server.");
        return;
      }

      const json = await resp.json();
      if (json.token) localStorage.setItem("campusmate_token", json.token);
      if (json.user) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(json.user));
        onLogin(json.user);
        return;
      }

      setError("Login succeeded but no user info returned.");
      return;
    } catch (err) {
      console.error("Login error:", err);
      setError("Unable to reach authentication server. Please try again later.");
      return;
    }
  }


  return (
    <main className="auth-page">
      <div className="auth-box">
        <div className="brand center">
          <div className="brand-icon">
            <GraduationCap size={26} />
          </div>
          <div>
            <h1>CampusMate AI</h1>
            <p>Smart college companion</p>
          </div>
        </div>

        <Card>
          <div className="auth-tabs">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Login
            </button>

            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={submit}>
            {mode === "register" && (
              <>
                <label>Full name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />

                <label>Course / Branch</label>
                <input
                  required
                  value={course}
                  onChange={(e) => setCourse(e.target.value)}
                  placeholder="B.Tech CSE"
                />

              </>
            )}

            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@example.com"
            />

            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 4 characters"
            />

            {error && <div className="error">{error}</div>}

            <Button type="submit">
              {mode === "login" ? "Login" : "Create account"}
            </Button>
          </form>
        </Card>

        <p className="small muted center">
          Your account and study data are securely managed for this session.
        </p>
      </div>
    </main>
  );
}

/* =========================================================
   SIDEBAR
========================================================= */

function Sidebar({ view, setView, user, logout }) {
  const [mobile, setMobile] = useState(false);

  const items = [
    ["dashboard", "Dashboard", LayoutDashboard],
    ["subjects", "Subjects", BookOpen],
    ["notes", "Chapter Notes", FileText],
    ["attendance", "Attendance", CalendarDays],
    ["planner", "Study Planner", CalendarDays],
    ["assistant", "AI Assistant", Sparkles],
    ["quiz", "Quiz", Brain],
    ["analytics", "Analytics", BarChart3],
    ["roadmap", "Career Roadmap", Compass],
  ];

  return (
    <>
      <button
        className="mobile-menu"
        onClick={() => setMobile(!mobile)}
      >
        <Menu size={22} />
      </button>

      <aside className={`sidebar ${mobile ? "show" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-icon small-icon">
            <img src="/logo.svg" alt="CampusMate" style={{ width: 22, height: 22 }} />
          </div>
          <span>CampusMate</span>
        </div>

        <nav>
          {items.map(([id, label, Icon]) => (
            <button
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setView(id);
                setMobile(false);
              }}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="user-mini">
            <div className="avatar">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>

          <button className="logout" onClick={logout}>
            <LogOut size={15} />
            Logout
          </button>

          <div className="founder-credit">
            <strong>Founder</strong>
            <span>Shubham Sharma</span>
            <a href="mailto:shubhamsharmaa84458@gmail.com">
              shubhamsharmaa84458@gmail.com
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}

/* =========================================================
   DASHBOARD
========================================================= */

function Dashboard({ user, data, setView, updateData }) {
  const [uploading, setUploading] = useState(false);
  const [deletingSyllabus, setDeletingSyllabus] = useState(false);
  const [showSyllabus, setShowSyllabus] = useState(false);
  const [syllabusError, setSyllabusError] = useState("");
  const syllabus = data.syllabus;
  const topicCount = data.subjects.reduce(
    (total, subject) => total + subject.topics.length,
    0
  );

  const pending = data.tasks.filter((task) => !task.done).length;

  const average =
    data.attempts.length === 0
      ? 0
      : Math.round(
          data.attempts.reduce((sum, a) => sum + a.score, 0) /
            data.attempts.length
        );

  const weakTopics = data.subjects
    .flatMap((subject) =>
      subject.topics.map((topic) => ({
        ...topic,
        subject: subject.name,
      }))
    )
    .filter((topic) => topic.mastery < 60)
    .sort((a, b) => a.mastery - b.mastery);

  const hour = new Date().getHours();

  const greeting =
    hour < 12
      ? "Good morning"
      : hour < 18
      ? "Good afternoon"
      : "Good evening";

  async function uploadSyllabus(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setSyllabusError("");
    try {
      const form = new FormData();
      form.append("pdf", file);
      form.append("kind", "syllabus");
      const response = await fetch("/api/pdf-extract", { method: "POST", body: form });
      const payload = await readApiResponse(response, "Unable to read syllabus");
      const subjects = payload.subjects?.length ? payload.subjects : data.subjects;
      const nextSyllabus = {
        name: payload.name,
        text: payload.text,
        uploadedAt: new Date().toISOString(),
        subjectIds: payload.subjects?.length ? subjects.map((subject) => subject.id) : [],
      };
      const saveResponse = await fetch("/api/me/study-data", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects, notes: data.notes || [], syllabus: nextSyllabus }),
      });
      if (!saveResponse.ok) {
        const savePayload = await saveResponse.json().catch(() => ({}));
        throw new Error(savePayload.error || "Unable to save extracted subjects");
      }
      updateData({
        ...data,
        syllabus: nextSyllabus,
        subjects,
      });
    } catch (error) {
      setSyllabusError(error.message || "Unable to read syllabus");
    } finally {
      setUploading(false);
    }

  }

  async function deleteSyllabus() {
    if (!syllabus || !window.confirm("Delete the extracted syllabus and all subjects and topics created from it?")) return;
    setDeletingSyllabus(true);
    setSyllabusError("");
    try {
      const extractedSubjectIds = new Set(
        syllabus.subjectIds?.length
          ? syllabus.subjectIds
          : data.subjects.map((subject) => subject.id)
      );
      const subjects = data.subjects.filter((subject) => !extractedSubjectIds.has(subject.id));
      const response = await fetch("/api/me/study-data", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects, notes: data.notes || [], syllabus: null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to delete extracted syllabus");
      updateData({ ...data, syllabus: null, subjects });
      setShowSyllabus(false);
    } catch (error) {
      setSyllabusError(error.message || "Unable to delete extracted syllabus");
    } finally {
      setDeletingSyllabus(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            {greeting}, {user.name.split(" ")[0]} 👋
          </h1>
          <p>Here's your academic overview.</p>
        </div>

        <Button onClick={() => setView("planner")}>
          <Plus size={16} />
          Plan study
        </Button>
      </div>

      <Card className="syllabus-upload-card">
        <SectionTitle
          title="Upload your syllabus"
          action={syllabus && <span className="small muted">Last file: {syllabus.name}</span>}
        />
        <p className="muted small">Upload a text or scanned-image PDF to automatically create subjects and starter topics.</p>
        <label className="upload-button btn btn-secondary">
          <FileText size={16} /> {uploading ? "Reading PDF…" : "Choose syllabus PDF"}
          <input type="file" accept="application/pdf,.pdf" onChange={uploadSyllabus} hidden disabled={uploading} />
        </label>
        {syllabus && (
          <div className="syllabus-actions">
            <Button variant="secondary" onClick={() => setShowSyllabus(true)} aria-label="View extracted syllabus">
              <Eye size={16} /> View extracted syllabus
            </Button>
            <Button variant="danger" onClick={deleteSyllabus} disabled={deletingSyllabus} aria-label="Delete extracted syllabus">
              <Trash2 size={16} /> {deletingSyllabus ? "Deleting…" : "Delete extracted syllabus"}
            </Button>
          </div>
        )}
        {syllabusError && <div className="error">{syllabusError}</div>}
      </Card>
      {showSyllabus && syllabus && (
        <Modal title={syllabus.name || "Extracted syllabus"} close={() => setShowSyllabus(false)}>
          <div className="syllabus-modal-preview">
            <ExtractedText text={syllabus.text} />
          </div>
        </Modal>
      )}

      <div className="stats-grid">
        <StatCard
          icon={<BookOpen />}
          title="Subjects"
          value={data.subjects.length}
          text={`${topicCount} topics`}
        />

        <StatCard
          icon={<CalendarDays />}
          title="Pending tasks"
          value={pending}
          text="Study tasks"
        />

        <StatCard
          icon={<Award />}
          title="Average score"
          value={`${average}%`}
          text={`${data.attempts.length} attempts`}
        />

        <StatCard
          icon={<AlertTriangle />}
          title="Weak topics"
          value={weakTopics.length}
          text="Need attention"
        />
      </div>

      <div className="two-column">
        <Card>
          <SectionTitle
            title="My subjects"
            action={
              <button
                className="link-btn"
                onClick={() => setView("subjects")}
              >
                View all <ChevronRight size={14} />
              </button>
            }
          />

          <div className="subject-list">
            {data.subjects.map((subject) => {
              const mastery =
                subject.topics.length === 0
                  ? 0
                  : Math.round(
                      subject.topics.reduce(
                        (sum, t) => sum + t.mastery,
                        0
                      ) / subject.topics.length
                    );

              return (
                <div className="subject-row" key={subject.id}>
                  <div className="subject-icon">
                    <BookOpen size={17} />
                  </div>

                  <div className="subject-info">
                    <strong>{subject.name}</strong>
                    <span>{subject.code}</span>
                    <ProgressBar value={mastery} />
                  </div>

                  <b>{mastery}%</b>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionTitle
            title="Weak topics"
            action={
              <button
                className="link-btn"
                onClick={() => setView("analytics")}
              >
                Analytics <ChevronRight size={14} />
              </button>
            }
          />

          {weakTopics.length === 0 ? (
            <Empty
              icon={<Target size={30} />}
              title="No weak topics"
              text="Great work! Keep practicing."
            />
          ) : (
            <div className="weak-list">
              {weakTopics.slice(0, 5).map((topic) => (
                <div key={topic.id} className="weak-item">
                  <div>
                    <strong>{topic.name}</strong>
                    <span>{topic.subject}</span>
                  </div>

                  <div className="weak-score">
                    {topic.mastery}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle title="Today's tasks" />

        {data.tasks.filter((task) => !task.done).length === 0 ? (
          <Empty
            icon={<CalendarDays size={30} />}
            title="No pending tasks"
            text="Your schedule is clear."
            action={
              <Button onClick={() => setView("planner")}>
                Add task
              </Button>
            }
          />
        ) : (
          <div className="task-list">
            {data.tasks
              .filter((task) => !task.done)
              .slice(0, 5)
              .map((task) => (
                <div className="task-row" key={task.id}>
                  <Circle size={18} />
                  <div>
                    <strong>{task.title}</strong>
                    <span>
                      {task.subject} · {task.date}
                    </span>
                  </div>
                  <Clock size={15} />
                  <span>{task.duration} min</span>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ icon, title, value, text }) {
  return (
    <Card>
      <div className="stat-top">
        <span>{title}</span>
        {icon}
      </div>

      <div className="stat-value">{value}</div>
      <div className="muted small">{text}</div>
    </Card>
  );
}

function SectionTitle({ title, action }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function Empty({ icon, title, text, action }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

/* =========================================================
   SUBJECTS
========================================================= */

function Subjects({ data, updateData }) {
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");

  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const subjectStats = useMemo(() => {
    const topics = data.subjects.flatMap((subject) => subject.topics);
    return {
      total: topics.length,
      confident: topics.filter((topic) => topic.mastery >= 70).length,
      needsWork: topics.filter((topic) => topic.mastery < 60).length,
    };
  }, [data.subjects]);

  const filteredSubjects = data.subjects.filter((subject) =>
    `${subject.name} ${subject.code}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );

  function addSubject(e) {
    e.preventDefault();

    if (!name.trim()) return;

    const subject = {
      id: uid(),
      name: name.trim(),
      code: code.trim() || "N/A",
      topics: [],
    };

    updateData({
      ...data,
      subjects: [...data.subjects, subject],
    });

    setName("");
    setCode("");
    setShowAdd(false);
  }

  function deleteSubject(id) {
    if (!confirm("Delete this subject?")) return;

    updateData({
      ...data,
      subjects: data.subjects.filter((s) => s.id !== id),
    });

    if (selected?.id === id) setSelected(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Subjects & Syllabus</h1>
          <p>Organize your syllabus and track mastery topic by topic.</p>
        </div>

        <Button onClick={() => setShowAdd(true)}>
          <Plus size={16} />
          Add subject
        </Button>
      </div>

      <div className="subjects-overview">
        <div>
          <span>Total topics</span>
          <strong>{subjectStats.total}</strong>
        </div>
        <div>
          <span>Confident</span>
          <strong>{subjectStats.confident}</strong>
          <small>70% mastery or higher</small>
        </div>
        <div>
          <span>Needs review</span>
          <strong>{subjectStats.needsWork}</strong>
          <small>Below 60% mastery</small>
        </div>
      </div>

      {data.subjects.length > 0 && (
        <div className="subject-toolbar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search subjects or course codes"
            aria-label="Search subjects"
          />
          <span>{filteredSubjects.length} of {data.subjects.length} subjects</span>
        </div>
      )}

      {data.subjects.length === 0 ? (
        <Card>
          <Empty
            icon={<BookOpen size={35} />}
            title="No subjects yet"
            text="Add your first subject."
            action={
              <Button onClick={() => setShowAdd(true)}>
                Add subject
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="subject-grid">
          {filteredSubjects.map((subject) => {
            const mastery =
              subject.topics.length === 0
                ? 0
                : Math.round(
                    subject.topics.reduce(
                      (sum, topic) => sum + topic.mastery,
                      0
                    ) / subject.topics.length
                  );

            return (
              <Card key={subject.id} className="subject-card">
                <div className="card-top">
                  <div className="subject-icon large">
                    <BookOpen />
                  </div>

                  <button
                    className="icon-btn danger-icon"
                    onClick={() => deleteSubject(subject.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <h2>{subject.name}</h2>
                <p className="muted">{subject.code}</p>

                <div className="mastery-label">
                  <span>Overall mastery</span>
                  <b>{mastery}%</b>
                </div>

                <ProgressBar value={mastery} />

                <p className="small muted subject-topic-count">
                  {subject.topics.length} topics in syllabus
                </p>

                <Button
                  variant="secondary"
                  className="manage-topics-btn"
                  onClick={() => setSelected(subject)}
                >
                  Manage topics
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      {data.subjects.length > 0 && filteredSubjects.length === 0 && (
        <Card>
          <Empty
            icon={<BookOpen size={35} />}
            title="No matching subjects"
            text="Try another name or course code."
            action={<Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button>}
          />
        </Card>
      )}

      {showAdd && (
        <Modal title="Add subject" close={() => setShowAdd(false)}>
          <form onSubmit={addSubject}>
            <label>Subject name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Operating Systems"
              autoFocus
            />

            <label>Subject code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="KCS401"
            />

            <div className="modal-actions">
              <Button
                variant="secondary"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Add subject</Button>
            </div>
          </form>
        </Modal>
      )}

      {selected && (
        <TopicModal
          subject={selected}
          data={data}
          updateData={updateData}
          close={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function TopicModal({ subject, data, updateData, close }) {
  const [topic, setTopic] = useState("");

  function addTopic(e) {
    e.preventDefault();

    if (!topic.trim()) return;

    const newTopic = {
      id: uid(),
      name: topic.trim(),
      mastery: 0,
    };

    const subjects = data.subjects.map((s) =>
      s.id === subject.id
        ? { ...s, topics: [...s.topics, newTopic] }
        : s
    );

    updateData({ ...data, subjects });
    setTopic("");
  }

  function updateMastery(id, mastery) {
    const subjects = data.subjects.map((s) =>
      s.id === subject.id
        ? {
            ...s,
            topics: s.topics.map((t) =>
              t.id === id ? { ...t, mastery } : t
            ),
          }
        : s
    );

    updateData({ ...data, subjects });
  }

  function deleteTopic(id) {
    const subjects = data.subjects.map((s) =>
      s.id === subject.id
        ? {
            ...s,
            topics: s.topics.filter((t) => t.id !== id),
          }
        : s
    );

    updateData({ ...data, subjects });
  }

  const currentSubject =
    data.subjects.find((s) => s.id === subject.id) || subject;

  return (
    <Modal title={`${currentSubject.name} topics`} close={close}>
      <form onSubmit={addTopic} className="add-topic">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Add topic..."
        />
        <Button type="submit">
          <Plus size={15} /> Add topic
        </Button>
      </form>

      <div className="topic-list">
        {currentSubject.topics.length === 0 && (
          <p className="muted center">No topics added yet.</p>
        )}

        {currentSubject.topics.map((t) => (
          <div className="topic-row" key={t.id}>
            <div className="topic-main">
              <strong>{t.name}</strong>

              <div className="topic-progress">
                <ProgressBar value={t.mastery} />
                <span>{t.mastery}%</span>
              </div>
            </div>

            <input
              className="mastery-input"
              type="number"
              min="0"
              max="100"
              value={t.mastery}
              onChange={(e) =>
                updateMastery(
                  t.id,
                  Math.max(
                    0,
                    Math.min(100, Number(e.target.value))
                  )
                )
              }
            />

            <button
              className="icon-btn danger-icon"
              onClick={() => deleteTopic(t.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* =========================================================
   PLANNER
========================================================= */

function Attendance({ data, updateData }) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.id || "");
  const [subjectQuery, setSubjectQuery] = useState("");
  const records = (data.attendance || {})[subjectId] || {};
  const filteredSubjects = data.subjects.filter((subject) =>
    `${subject.name} ${subject.code || ""}`.toLowerCase().includes(subjectQuery.trim().toLowerCase())
  );
  const visibleSubjects = filteredSubjects.some((subject) => subject.id === subjectId)
    ? filteredSubjects
    : data.subjects.filter((subject) => subject.id === subjectId);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const values = Object.values(records);
  const present = values.filter((value) => value === "present").length;
  const absent = values.filter((value) => value === "absent").length;
  const percentage = present + absent ? Math.round((present / (present + absent)) * 100) : 0;
  const dateKey = (day) => `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const mark = (day) => {
    const key = dateKey(day);
    const next = { ...records };
    next[key] = records[key] === "present" ? "absent" : records[key] === "absent" ? undefined : "present";
    if (!next[key]) delete next[key];
    updateData({ ...data, attendance: { ...(data.attendance || {}), [subjectId]: next } });
  };
  return (
    <div className="page">
      <div className="page-header"><div><h1>Attendance Tracker</h1><p>Mark daily attendance and track your subject-wise percentage.</p></div>
        <div className="attendance-subject-controls">
          <input
            className="attendance-search"
            value={subjectQuery}
            onChange={(event) => setSubjectQuery(event.target.value)}
            placeholder="Search subjects or course codes"
            aria-label="Search attendance subjects"
          />
          <select className="attendance-subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            {visibleSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}{subject.code ? ` (${subject.code})` : ""}</option>)}
          </select>
        </div>
      </div>
      {data.subjects.length > 0 && filteredSubjects.length === 0 && <p className="attendance-no-results">No subjects match “{subjectQuery}”. Clear the search to see all subjects.</p>}
      <div className="attendance-summary"><div><span>Attendance</span><strong>{percentage}%</strong></div><div><span>Present</span><strong>{present}</strong></div><div><span>Absent</span><strong>{absent}</strong></div></div>
      <Card><div className="attendance-month"><button className="icon-btn" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} aria-label="Previous month">‹</button><h2>{month.toLocaleString("default", { month: "long", year: "numeric" })}</h2><button className="icon-btn" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} aria-label="Next month">›</button></div>
        <div className="attendance-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="attendance-calendar">{Array.from({ length: firstDay }).map((_, index) => <span className="attendance-empty" key={`empty-${index}`} />)}{Array.from({ length: daysInMonth }, (_, index) => { const day = index + 1; const status = records[dateKey(day)]; return <button key={day} className={`attendance-day ${status || ""}`} onClick={() => mark(day)} title="Cycle present, absent, and clear"><strong>{day}</strong><small>{status === "present" ? "P" : status === "absent" ? "A" : "—"}</small></button>; })}</div>
        <p className="attendance-help"><span className="attendance-dot present" /> Present <span className="attendance-dot absent" /> Absent · Click a day to cycle status.</p>
      </Card>
    </div>
  );
}

function Planner({ data, updateData }) {
  const [show, setShow] = useState(false);
  const [filter, setFilter] = useState("all");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [duration, setDuration] = useState(60);
  const [priority, setPriority] = useState("medium");

  const today = new Date().toISOString().slice(0, 10);

  function addTask(e) {
    e.preventDefault();

    if (!title.trim()) return;

    const task = {
      id: uid(),
      title: title.trim(),
      subject: subject || "General",
      date,
      duration: Number(duration),
      priority,
      done: false,
    };

    updateData({
      ...data,
      tasks: [...data.tasks, task],
    });

    setTitle("");
    setSubject("");
    setDuration(60);
    setPriority("medium");
    setShow(false);
  }

  function toggleTask(id) {
    updateData({
      ...data,
      tasks: data.tasks.map((task) =>
        task.id === id ? { ...task, done: !task.done } : task
      ),
    });
  }

  function deleteTask(id) {
    updateData({
      ...data,
      tasks: data.tasks.filter((task) => task.id !== id),
    });
  }

  const sortedTasks = [...data.tasks].sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  const pendingTasks = sortedTasks.filter((task) => !task.done);
  const plannedMinutes = pendingTasks.reduce(
    (sum, task) => sum + Number(task.duration || 0),
    0
  );
  const todayTasks = pendingTasks.filter((task) => task.date === today);
  const overdueTasks = pendingTasks.filter((task) => task.date < today);

  const visibleTasks = sortedTasks.filter((task) => {
    if (filter === "today") return !task.done && task.date === today;
    if (filter === "upcoming") return !task.done && task.date > today;
    if (filter === "completed") return task.done;
    return true;
  });

  function createSmartPlan() {
    const weakestTopics = data.subjects
      .flatMap((currentSubject) =>
        currentSubject.topics.map((topic) => ({
          ...topic,
          subject: currentSubject.name,
        }))
      )
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 3);

    if (weakestTopics.length === 0) {
      setShow(true);
      return;
    }

    updateData({
      ...data,
      tasks: [
        ...data.tasks,
        ...weakestTopics.map((topic, index) => ({
          id: uid(),
          title: `Review ${topic.name}`,
          subject: topic.subject,
          date: today,
          duration: index === 0 ? 60 : 45,
          priority: "high",
          done: false,
        })),
      ],
    });
    setFilter("today");
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Study Planner</h1>
          <p>Turn your syllabus into focused, achievable study sessions.</p>
        </div>

        <div className="planner-actions">
          <Button variant="secondary" onClick={createSmartPlan}>
            <Sparkles size={16} />
            Build my plan
          </Button>
          <Button onClick={() => setShow(true)}>
            <Plus size={16} />
            Add task
          </Button>
        </div>
      </div>

      <div className="planner-overview">
        <div><span>Today's focus</span><strong>{todayTasks.length}</strong><small>sessions planned</small></div>
        <div><span>Study time</span><strong>{plannedMinutes} min</strong><small>remaining across your plan</small></div>
        <div><span>Completed</span><strong>{data.tasks.filter((task) => task.done).length}</strong><small>sessions finished</small></div>
        <div className={overdueTasks.length ? "planner-alert" : ""}><span>To reschedule</span><strong>{overdueTasks.length}</strong><small>{overdueTasks.length ? "past-due sessions" : "nothing overdue"}</small></div>
      </div>

      <div className="planner-toolbar">
        {["all", "today", "upcoming", "completed"].map((item) => (
          <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>
            {item === "all" ? "All tasks" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      <Card className="planner-card">
        {sortedTasks.length === 0 ? (
          <Empty
            icon={<CalendarDays size={35} />}
            title="Your planner is empty"
            text="Create a task or let CampusMate build a focus plan from weak topics."
            action={
              <Button onClick={createSmartPlan}>
                <Sparkles size={16} />
                Build my plan
              </Button>
            }
          />
        ) : visibleTasks.length === 0 ? (
          <Empty
            icon={<CalendarDays size={35} />}
            title="Nothing in this view"
            text="Choose another filter or create a new study session."
          />
        ) : (
          <div className="planner-list">
            {visibleTasks.map((task) => (
              <div
                className={`planner-task ${
                  task.done ? "completed" : ""
                }`}
                key={task.id}
              >
                <button
                  className="check-btn"
                  onClick={() => toggleTask(task.id)}
                >
                  {task.done ? (
                    <CheckCircle2 size={22} />
                  ) : (
                    <Circle size={22} />
                  )}
                </button>

                <div className="task-content">
                  <div className="task-title-row">
                    <strong>{task.title}</strong>
                    <span className={`priority ${task.priority || "medium"}`}>
                      {task.priority || "medium"}
                    </span>
                  </div>
                  <span>
                    {task.subject} · {task.date} · {task.duration} min
                  </span>
                </div>

                <button
                  className="icon-btn danger-icon"
                  onClick={() => deleteTask(task.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {show && (
        <Modal title="Create study task" close={() => setShow(false)}>
          <form onSubmit={addTask}>
            <label>Task</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Study DBMS normalization"
              autoFocus
            />

            <label>Subject</label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              <option value="">General</option>
              {data.subjects.map((s) => (
                <option value={s.name} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <label>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />

            <label>Duration (minutes)</label>
            <input
              type="number"
              min="10"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />

            <label>Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="high">High — do first</option>
              <option value="medium">Medium — planned</option>
              <option value="low">Low — if time allows</option>
            </select>

            <div className="modal-actions">
              <Button
                variant="secondary"
                onClick={() => setShow(false)}
              >
                Cancel
              </Button>

              <Button type="submit">Create task</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================
   AI ASSISTANT
========================================================= */

function Assistant({ data, updateData, user }) {
  const [message, setMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const chatRef = useRef(data.chat || []);
  const persistTimerRef = useRef(null);

  useEffect(() => {
    chatRef.current = data.chat || [];
  }, [data.chat]);

  useEffect(() => () => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
  }, []);

  const learningContext = useMemo(() => {
    const topics = data.subjects.flatMap((subject) =>
      subject.topics.map((topic) => ({ ...topic, subject: subject.name }))
    );
    const weakTopics = topics
      .filter((topic) => topic.mastery < 60)
      .sort((a, b) => a.mastery - b.mastery);

    return {
      weakTopics,
      pendingTasks: data.tasks.filter((task) => !task.done),
      totalTopics: topics.length,
    };
  }, [data]);

  const suggestions = [
    "What should I study first?",
    "Make a plan for today",
    "How is my progress?",
    "Explain DBMS normalization",
  ];

  // On mount, try to load persisted chat for this user from server
  useEffect(() => {
    (async () => {
      if (!user?.email) return;
      try {
        const token = localStorage.getItem('campusmate_token');
          const headers = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const resp = await fetch('/api/messages', { headers });
        if (resp.ok) {
          const json = await resp.json();
          if (json?.chat) {
            updateData({ ...data, chat: json.chat });
          }
        }
      } catch (e) {
        // ignore
      }
    })();
  }, [user?.email]);

  function generateReply(text) {
    const lower = text.toLowerCase();

    if (lower.includes("what is") && (lower.includes("stack") || lower.includes("lifo"))) {
      return "A stack is a linear data structure that follows LIFO: the last item added is the first item removed. Its main operations are push, pop, and peek, each typically O(1).";
    }

    if (lower.includes("binary search")) {
      return "Binary search finds an item in a sorted array by repeatedly checking the middle element and discarding half the search range. Its time complexity is O(log n), and it requires sorted data.";
    }

    if (lower.includes("normalization") || lower.includes("dbms")) {
      return "Database normalization organizes tables to reduce duplicate data and update anomalies. 1NF stores atomic values, 2NF removes partial dependencies, and 3NF removes transitive dependencies. Use functional dependencies to determine the correct normal form.";
    }

    if (lower.includes("sql") && (lower.includes("join") || lower.includes("difference"))) {
      return "An INNER JOIN returns only matching rows from both tables. A LEFT JOIN returns every row from the left table plus matching rows from the right table, using NULL when there is no match.";
    }

    if (lower.includes("osi") || lower.includes("tcp") || lower.includes("network")) {
      return "The OSI model has seven layers: Physical, Data Link, Network, Transport, Session, Presentation, and Application. TCP provides reliable, ordered delivery, while IP handles addressing and routing.";
    }

    if (lower.includes("time complexity") || lower.includes("complexity")) {
      return "Time complexity describes how an algorithm's running time grows with input size. O(1) is constant, O(log n) grows slowly, O(n) is linear, and O(n²) is quadratic. Prefer the lowest practical complexity for large inputs.";
    }

    if (
      lower.includes("study plan") ||
      lower.includes("make a plan") ||
      lower.includes("plan for today")
    ) {
      const focus = learningContext.weakTopics.slice(0, 2);
      if (focus.length === 0) {
        return "Start with a 45-minute revision session for your strongest subject, then take a short quiz to check retention.";
      }
      return `Today's focus: spend 45 minutes on ${focus[0].name} (${focus[0].mastery}%), take a 10-minute break, then study ${focus[1]?.name || "practice questions"} for 45 minutes. Finish with 20 minutes of active recall.`;
    }

    if (
      lower.includes("normalization") ||
      lower.includes("dbms")
    ) {
      return `DBMS normalization organizes database tables to reduce redundancy and improve data integrity. Important levels are 1NF, 2NF, 3NF and BCNF. For exams, focus on functional dependencies and solving normalization problems.`;
    }

    if (
      lower.includes("placement") ||
      lower.includes("career")
    ) {
      return `For placements, focus on three areas: DSA, core CS subjects and development. Practice DSA regularly, revise DBMS/OS/CN, and maintain at least one strong project on GitHub.`;
    }

    if (
      lower.includes("weak") ||
      lower.includes("topic") ||
      lower.includes("study first")
    ) {
      const weak = learningContext.weakTopics.slice(0, 3);

      if (weak.length === 0) {
        return "You currently don't have any topics below 60% mastery. Keep practicing regularly!";
      }

      return `Your priority topics are: ${weak
        .map((t) => `${t.name} in ${t.subject} (${t.mastery}%)`)
        .join(", ")}. Start with the lowest score and practice questions after reviewing the concepts.`;
    }

    if (lower.includes("progress") || lower.includes("doing")) {
      const completed = data.tasks.filter((task) => task.done).length;
      return `You have ${learningContext.totalTopics} topics tracked, ${learningContext.weakTopics.length} that need review, ${learningContext.pendingTasks.length} study sessions pending, and ${completed} completed. Your best next step is ${learningContext.weakTopics[0] ? `${learningContext.weakTopics[0].name} (${learningContext.weakTopics[0].mastery}%)` : "a short practice quiz"}.`;
    }

    const matchedTopic = learningContext.weakTopics.find((topic) =>
      lower.includes(topic.name.toLowerCase())
    );
    if (matchedTopic) {
      return `${matchedTopic.name} is currently at ${matchedTopic.mastery}% mastery. Study the core concept for 25 minutes, solve 3–5 practice questions, then write a short summary from memory. That will turn review into active recall.`;
    }

    return `Here is a practical way to approach that: define the concept, learn one small example, solve two problems without looking at the solution, and explain the answer in your own words. If you share the exact topic or question, I can give a more specific explanation.`;
  }

  // Helper: update a single chat message by id
  // Persist chat to server (debounced)
  async function persistChat(chat) {
    if (!user?.email) return;
    try {
      const token = localStorage.getItem('campusmate_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch('/api/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ chat }),
      });
    } catch (e) {
      console.warn('Persist chat failed', e);
    }
  }

  function schedulePersist(chat) {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      persistChat(chat);
    }, 400);
  }

  function updateChatMessage(id, updater) {
    const nextChat = chatRef.current.map((m) =>
      m.id === id ? { ...m, ...updater(m) } : m
    );
    chatRef.current = nextChat;
    updateData({ ...data, chat: nextChat });
    schedulePersist(nextChat);
  }

  async function send(text = message) {
    const clean = text.trim();
    if (!clean) return;

    const timestamp = new Date().toISOString();
    const userMessage = { id: uid(), role: "user", text: clean, time: timestamp };

    // Add user message (keep baseChat to avoid duplicates)
    const baseChat = [...(data.chat || []), userMessage];
    chatRef.current = baseChat;
    updateData({ ...data, chat: baseChat });
    schedulePersist(baseChat);
    setMessage("");

    setIsTyping(true);

    try {
      const token = localStorage.getItem('campusmate_token');
      const headers = { "Content-Type": "application/json" };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000);
      const resp = await fetch("/api/ai-stream-v2", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: clean, context: learningContext }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok || !resp.body) {
        // try non-streaming API as fallback
        try {
          const token = localStorage.getItem('campusmate_token');
          const h = { 'Content-Type': 'application/json' };
          if (token) h['Authorization'] = `Bearer ${token}`;
          if (token) h['Authorization'] = `Bearer ${token}`;
          const r2 = await fetch('/api/ai-v2', { method: 'POST', headers: h, body: JSON.stringify({ prompt: clean, context: learningContext }) });
          if (r2.ok) {
            const j = await r2.json();
            const aiId = uid();
            const aiMessage = { id: aiId, role: 'assistant', text: j.reply, time: new Date().toISOString() };
            const fallbackChat = [...baseChat, aiMessage];
            chatRef.current = fallbackChat;
            updateData({ ...data, chat: fallbackChat });
            schedulePersist(fallbackChat);
            return;
          }
        } catch (e) {
          console.warn('fallback ai call failed', e);
        }

        const fallback = "The AI service is unavailable. Please check the server AI configuration and try again.";
        const aiId = uid();
        const aiMessage = { id: aiId, role: "assistant", text: fallback, time: new Date().toISOString() };
        const fallbackChat = [...baseChat, aiMessage];
        chatRef.current = fallbackChat;
        updateData({ ...data, chat: fallbackChat });
        schedulePersist(fallbackChat);
        return;
      }

      // Prepare assistant message slot
      const aiId = uid();
      const aiMessage = { id: aiId, role: "assistant", text: "", time: new Date().toISOString(), streaming: true };
      const withAi = [...baseChat, aiMessage];
      chatRef.current = withAi;
      updateData({ ...data, chat: withAi });
      schedulePersist(withAi);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentText = "";
      let doneSignal = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          // SSE-like lines
          const lines = part.split('\n');
          for (const line of lines) {
            if (!line) continue;
            if (line.startsWith('data:')) {
              const dataText = line.slice(5).trim();
              // data events are JSON strings: { type: 'delta'|'done'|'meta'|'error', ... }
              try {
                const obj = JSON.parse(dataText);
                if (obj.type === 'delta' && obj.text) {
                  currentText += obj.text;
                  updateChatMessage(aiId, () => ({ text: currentText }));
                } else if (obj.type === 'done') {
                  doneSignal = true;
                  break;
                } else if (obj.type === 'error') {
                  // Keep the assistant useful when the server-side provider is unavailable.
                  currentText = `The AI service could not answer: ${obj.body || "provider unavailable"}`;
                  updateChatMessage(aiId, () => ({ text: currentText }));
                  doneSignal = true;
                  break;
                }
                // ignore meta events
              } catch (e) {
                // fallback: append raw
                currentText += dataText;
                updateChatMessage(aiId, () => ({ text: currentText }));
              }
            }
            // ignore event: done or other metadata
          }
          if (doneSignal) break;
        }
        if (doneSignal) break;
      }

      // final flush if any remaining buffer contains data
      if (buffer) {
        const leftoverLines = buffer.split('\n');
        for (const line of leftoverLines) {
          if (line.startsWith('data:')) {
            const dataText = line.slice(5).trim();
            try {
              const obj = JSON.parse(dataText);
              if (obj.type === 'delta' && obj.text) currentText += obj.text;
            } catch (e) {
              currentText += dataText;
            }
          }
        }
        updateChatMessage(aiId, () => ({ text: currentText, streaming: false }));
      }

      // ensure streaming flag cleared
      try { updateChatMessage(aiId, () => ({ streaming: false })); } catch (e) {}
      if (!currentText.trim()) {
        updateChatMessage(aiId, () => ({ text: "The AI service returned an empty response. Please try again.", streaming: false }));
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.error("Assistant error:", err);
      }
      const fallback = "The AI service is unavailable. Please check the server AI configuration and try again.";
      const aiId = uid();
      const aiMessage = { id: aiId, role: "assistant", text: fallback, time: new Date().toISOString() };
      const fallbackChat = [...baseChat, aiMessage];
      chatRef.current = fallbackChat;
      updateData({ ...data, chat: fallbackChat });
      schedulePersist(fallbackChat);
    } finally {
      setIsTyping(false);
    }
  }

  function clearChat() {
    chatRef.current = [];
    updateData({ ...data, chat: [] });
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  // Auto-scroll to bottom whenever chat updates or typing status changes
  useEffect(() => {
    const el = document.getElementById("chat-area");
    if (el) {
      // small delay to allow DOM updates
      setTimeout(() => {
        el.scrollTop = el.scrollHeight;
      }, 50);
    }
  }, [data.chat, isTyping]);

  function MessageBubble({ m }) {
    const isUser = m.role === "user";
    return (
      <div className={`msg-row ${isUser ? "msg-user" : "msg-ai"}`} key={m.id}>
        {!isUser && (
          <img className="msg-avatar" src="/ai-avatar.svg" alt="AI" />
        )}

        <div className={`bubble ${isUser ? "bubble-user" : "bubble-ai"}`}>
          <div className="bubble-text">{m.text}{m.streaming && <span className="caret" />}</div>
          <div className="bubble-meta">
            <span className="bubble-time">{formatTime(m.time)}</span>
          </div>
        </div>

        {isUser && (
          <div className="msg-avatar user-initial">{m.text ? "You" : "You"}</div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>AI Assistant</h1>
          <p>Your data-aware academic study companion.</p>
        </div>
        <div>
          {(data.chat || []).length > 0 && (
            <Button variant="secondary" onClick={clearChat}>Clear conversation</Button>
          )}
        </div>
      </div>

      <div className="assistant-insights">
        <div><span>Priority topic</span><strong>{learningContext.weakTopics[0]?.name || "All caught up"}</strong><small>{learningContext.weakTopics[0] ? `${learningContext.weakTopics[0].mastery}% mastery` : "Keep revising regularly"}</small></div>
        <div><span>Planned sessions</span><strong>{learningContext.pendingTasks.length}</strong><small>ready in your planner</small></div>
        <div><span>Topics tracked</span><strong>{learningContext.totalTopics}</strong><small>across {data.subjects.length} subjects</small></div>
      </div>

      <Card className="assistant-card chat-card">
        <div className="assistant-header">
          <div className="ai-icon">
            <Sparkles size={22} />
          </div>
          <div>
            <strong>CampusMate AI</strong>
            <span><i /> Ready to help</span>
          </div>
        </div>

        <div className="chat-area scrollable" id="chat-area">
          {(data.chat || []).length === 0 ? (
            <div className="assistant-welcome">
              <Sparkles size={40} />
              <h2>How can I help you?</h2>
              <p>
                Ask about studying, college subjects, placements or
                career planning.
              </p>

              <div className="suggestions">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-list">
              {(data.chat || []).map((m) => (
                <MessageBubble m={m} key={m.id} />
              ))}
            </div>
          )}

          {isTyping && (
            <div className="typing-row">
              <img className="msg-avatar" src="/ai-avatar.svg" alt="AI" />
              <div className="typing-dots">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
        </div>

        <form className="chat-input chat-input-row" onSubmit={(e) => {
          e.preventDefault();
          send();
        }}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask CampusMate..."
            aria-label="Ask CampusMate"
          />

          <Button type="submit" disabled={!message.trim()}>
            <Send size={16} />
          </Button>
        </form>
      </Card>
    </div>
  );
}

function Notes({ data, updateData }) {
  const [chapter, setChapter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNote, setSelectedNote] = useState(null);
  const notes = data.notes || [];

  async function uploadNote(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !chapter.trim()) {
      setError("Enter a chapter name before choosing a PDF.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("pdf", file);
      form.append("kind", "notes");
      const response = await fetch("/api/pdf-extract", { method: "POST", body: form });
      const payload = await readApiResponse(response, "Unable to read notes");
      const note = {
        id: uid(),
        chapter: chapter.trim(),
        name: payload.name,
        text: payload.text,
        uploadedAt: new Date().toISOString(),
      };
      const nextNotes = [...notes, note];
      const saveResponse = await fetch("/api/me/study-data", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects: data.subjects, notes: nextNotes, syllabus: data.syllabus || null }),
      });
      if (!saveResponse.ok) {
        const savePayload = await saveResponse.json().catch(() => ({}));
        throw new Error(savePayload.error || "Unable to save notes");
      }
      updateData({ ...data, notes: nextNotes });
      setChapter("");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to read notes");
    } finally {
      setUploading(false);
    }
  }

  async function removeNote(id) {
    const nextNotes = notes.filter((note) => note.id !== id);
    const response = await fetch("/api/me/study-data", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjects: data.subjects, notes: nextNotes, syllabus: data.syllabus || null }),
    });
    if (!response.ok) {
      setError("Unable to delete notes");
      return;
    }
    updateData({ ...data, notes: nextNotes });
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Chapter Notes</h1>
          <p>Upload chapter PDFs so AI Quiz can create questions from your study material.</p>
        </div>
      </div>
      <Card>
        <label htmlFor="note-chapter">Chapter name</label>
        <input id="note-chapter" value={chapter} onChange={(event) => setChapter(event.target.value)} placeholder="Chapter 1: Arrays" />
        <label className="upload-button btn btn-primary">
          <FileText size={16} /> {uploading ? "Reading notes…" : "Upload chapter PDF"}
          <input type="file" accept="application/pdf,.pdf" onChange={uploadNote} hidden disabled={uploading} />
        </label>
        {error && <div className="error">{error}</div>}
      </Card>
      <div className="notes-grid">
        {notes.length === 0 ? (
          <Card><Empty icon={<FileText size={35} />} title="No notes uploaded" text="Add chapter PDFs to personalize your quizzes." /></Card>
        ) : notes.map((note) => (
          <Card key={note.id} className="note-card">
            <div className="card-top">
              <div><h2>{note.chapter}</h2><p className="small muted">{note.name}</p></div>
              <button className="icon-btn danger-icon" onClick={() => removeNote(note.id)}><Trash2 size={16} /></button>
            </div>
            <Button
              variant="secondary"
              className="view-extracted-notes-btn"
              onClick={() => setSelectedNote(note)}
            >
              <Eye size={15} /> View Extracted Notes
            </Button>
          </Card>
        ))}
      </div>
      {selectedNote && (
        <Modal
          title={selectedNote.chapter || "Extracted notes"}
          close={() => setSelectedNote(null)}
        >
          <p className="small muted">{selectedNote.name}</p>
          <div className="syllabus-modal-preview">
            <ExtractedText text={selectedNote.text} />
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================
   QUIZ
========================================================= */

const quizQuestions = [
  {
    id: 1,
    topic: "DBMS",
    question: "What does SQL stand for?",
    options: [
      "Structured Query Language",
      "Simple Query Language",
      "System Query Logic",
      "Structured Question Language",
    ],
    answer: 0,
  },
  {
    id: 2,
    topic: "Data Structures",
    question: "Which data structure follows LIFO?",
    options: ["Queue", "Stack", "Array", "Graph"],
    answer: 1,
  },
  {
    id: 3,
    topic: "Computer Networks",
    question:
      "How many layers are present in the OSI model?",
    options: ["5", "6", "7", "8"],
    answer: 2,
  },
  {
    id: 4,
    topic: "DBMS",
    question: "Which normal form removes partial dependency?",
    options: ["1NF", "2NF", "3NF", "BCNF"],
    answer: 1,
  },
  {
    id: 5,
    topic: "Data Structures",
    question: "Which traversal uses a queue?",
    options: ["DFS", "BFS", "Inorder", "Postorder"],
    answer: 1,
  },
  {
    id: 6,
    topic: "DBMS",
    question: "Which SQL clause is used to filter rows?",
    options: ["WHERE", "ORDER BY", "GROUP BY", "JOIN"],
    answer: 0,
  },
  {
    id: 7,
    topic: "Data Structures",
    question: "What is the average-case lookup time in a hash table?",
    options: ["O(1)", "O(log n)", "O(n)", "O(n²)"],
    answer: 0,
  },
  {
    id: 8,
    topic: "Computer Networks",
    question: "Which protocol is commonly used to securely browse websites?",
    options: ["FTP", "HTTPS", "SMTP", "DHCP"],
    answer: 1,
  },
  {
    id: 9,
    topic: "DBMS",
    question: "A primary key must be:",
    options: ["Unique and not null", "Only numeric", "A foreign key", "Optional"],
    answer: 0,
  },
];

function Quiz({ data, updateData }) {
  const [questions, setQuestions] = useState(quizQuestions.slice(0, 5));
  const [generating, setGenerating] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [finished, setFinished] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState("all");
  const [reviewMode, setReviewMode] = useState(false);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [explanations, setExplanations] = useState({});
  const [explaining, setExplaining] = useState({});

  const question = questions[current];
  const topicOptions = data.subjects.flatMap((subject) =>
    subject.topics.map((topic) => ({
      id: `${subject.id}:${topic.id}`,
      label: `${subject.name}: ${topic.name}`,
      value: `${subject.name}: ${topic.name}`,
    }))
  );
  const noteOptions = (data.notes || []).map((note) => ({
    id: `note:${note.id}`,
    label: `Notes: ${note.chapter}`,
    value: note.chapter,
  }));
  const practiceOptions = [...topicOptions, ...noteOptions];
  const selectedTopicValue = practiceOptions.find((topic) => topic.id === selectedTopic)?.value;

  function start(nextQuestions = questions) {
    setQuestions(nextQuestions);
    setStarted(true);
    setCurrent(0);
    setSelected(null);
    setAnswers([]);
    setFinished(false);
    setReviewMode(false);
    setCurrentReviewIndex(0);
    setExplanations({});
    setExplaining({});
  }

  async function generateAiQuiz(topicOverride = selectedTopic) {
    setGenerating(true);
    setQuizError("");
    try {
      const topics = topicOverride === "all"
        ? practiceOptions.map((topic) => topic.value)
        : practiceOptions.filter((topic) => topic.id === topicOverride).map((topic) => topic.value);
      const materials = (data.notes || [])
        .filter((note) => topicOverride === "all" || topicOverride === `note:${note.id}` || !topicOverride.startsWith("note:"))
        .map((note) => ({ topic: note.chapter, text: note.text }));
      const response = await fetch("/api/quiz-generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("campusmate_token") || ""}`,
        },
        body: JSON.stringify({
          topics,
          materials,
          count: 5,
        }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Quiz service returned an invalid response.");
      }

      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.questions) || payload.questions.length === 0) throw new Error(payload.error || "Unable to generate quiz");
      start(payload.questions);
    } catch (error) {
      setQuizError(error.message || "Unable to generate quiz. Try the practice quiz instead.");
    } finally {
      setGenerating(false);
    }
  }

  async function explainQuestion(reviewQuestion, reviewIndex) {
    const key = reviewQuestion.id || String(reviewIndex);
    if (explanations[key]) return;
    setExplaining((previous) => ({ ...previous, [key]: true }));
    try {
      const response = await fetch("/api/quiz-explain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("campusmate_token") || ""}`,
        },
        body: JSON.stringify({
          question: reviewQuestion.question,
          options: reviewQuestion.options,
          correctAnswerIndex: reviewQuestion.answer,
          userAnswerIndex: answers[reviewIndex],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.explanation) {
        throw new Error(payload.error || "Unable to explain this answer");
      }
      setExplanations((previous) => ({ ...previous, [key]: payload.explanation }));
    } catch (error) {
      setQuizError(error.message || "Unable to explain this answer");
    } finally {
      setExplaining((previous) => ({ ...previous, [key]: false }));
    }
  }

  function renderTopicSelector() {
    return (
      <label className="quiz-topic-selector">
        <span>Practice topic</span>
        <select
          value={selectedTopic}
          disabled={generating}
          onChange={(event) => {
            const value = event.target.value;
            setSelectedTopic(value);
            setStarted(false);
            setFinished(false);
          }}
        >
          <option value="all">All topics</option>
          {practiceOptions.map((topic) => (
            <option key={topic.id} value={topic.id}>{topic.label}</option>
          ))}
        </select>
      </label>
    );
  }

  function next() {
    if (selected === null) return;

    const newAnswers = [...answers, selected];
    setAnswers(newAnswers);

    if (current === questions.length - 1) {
      const correct = newAnswers.reduce(
        (count, answer, index) =>
          count +
          (answer === questions[index].answer ? 1 : 0),
        0
      );

      const score = Math.round(
        (correct / questions.length) * 100
      );

      const attempt = {
        id: uid(),
        date: new Date().toISOString().slice(0, 10),
        score,
        correct,
        total: questions.length,
      };

      updateData({
        ...data,
        attempts: [...data.attempts, attempt],
      });

      setFinished(true);
      setReviewMode(false);
      setCurrentReviewIndex(0);
      return;
    }

    setCurrent(current + 1);
    setSelected(null);
  }

  if (!started) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1>Quiz Center</h1>
            <p>{selectedTopicValue ? `Practice ${selectedTopicValue}.` : "Test your Computer Science knowledge."}</p>
          </div>
          {renderTopicSelector()}
        </div>

        <Card className="quiz-start">
          <div className="quiz-icon">
            <Brain size={40} />
          </div>

          <h2>CampusMate CS Quiz</h2>

          <p>
            Test yourself with questions from DSA, DBMS and
            Computer Networks.
          </p>

          <div className="quiz-info">
            <span>
              <Brain size={16} /> 5 questions
            </span>
            <span>
              <Clock size={16} /> Practice mode
            </span>
            <span>
              <Award size={16} /> Score tracking
            </span>
          </div>

          <div className="quiz-actions">
            <Button onClick={() => start(quizQuestions.slice(0, 5))}>Start practice quiz</Button>
            <Button variant="secondary" className="generate-ai-quiz-btn" disabled={generating} onClick={() => generateAiQuiz(selectedTopic)}>
              <Sparkles size={16} /> {generating ? "Generating…" : "Generate AI quiz"}
            </Button>
          </div>
          {quizError && <div className="error">{quizError}</div>}
        </Card>
      </div>
    );
  }

  if (finished) {
    if (reviewMode) {
      const reviewQuestion = questions[currentReviewIndex];
      const reviewAnswer = answers[currentReviewIndex];
      const reviewKey = reviewQuestion.id || String(currentReviewIndex);
      const explanation = explanations[reviewKey];
      const isLastReviewQuestion = currentReviewIndex === questions.length - 1;

      return (
        <div className="page">
          <div className="page-header">
            <div>
              <h1>Review Quiz</h1>
              <p>Review your answers and understand the correct choices.</p>
            </div>
            {renderTopicSelector()}
          </div>
          <Card className="question-card quiz-review">
            <div className="question-top">
              <span>Question {currentReviewIndex + 1} / {questions.length}</span>
              <span>{reviewQuestion.topic}</span>
            </div>
            <h2>{reviewQuestion.question}</h2>
            <div className="options">
              {reviewQuestion.options.map((option, index) => {
                const isCorrect = index === reviewQuestion.answer;
                const isIncorrectSelection = index === reviewAnswer && reviewAnswer !== reviewQuestion.answer;
                return (
                  <div
                    key={option}
                    className={`option review-option${isCorrect ? " review-correct" : ""}${isIncorrectSelection ? " review-incorrect" : ""}`}
                  >
                    <span className="option-letter">{String.fromCharCode(65 + index)}</span>
                    {option}
                  </div>
                );
              })}
            </div>
            {explanation && <div className="quiz-explanation"><strong>AI explanation</strong><p>{explanation}</p></div>}
            <div className="review-actions">
              {currentReviewIndex > 0 ? (
                <Button variant="secondary" onClick={() => setCurrentReviewIndex((index) => index - 1)}>
                  ‹ Previous
                </Button>
              ) : <span />}
              <Button
                variant="secondary"
                disabled={explaining[reviewKey]}
                onClick={() => explainQuestion(reviewQuestion, currentReviewIndex)}
              >
                {explaining[reviewKey] ? "Explaining…" : "Explain"}
              </Button>
              <Button
                onClick={() => {
                  if (isLastReviewQuestion) {
                    setReviewMode(false);
                  } else {
                    setCurrentReviewIndex((index) => index + 1);
                  }
                }}
              >
                {isLastReviewQuestion ? "Close Review" : "Next ›"}
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    const last = data.attempts[data.attempts.length - 1];

    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1>Quiz Center</h1>
            <p>Choose another topic to start a fresh quiz.</p>
          </div>
          {renderTopicSelector()}
        </div>
        <Card className="quiz-result">
          <div className="result-icon">
            <Award size={45} />
          </div>

          <h1>Quiz completed!</h1>

          <div className="result-score">
            {last?.score || 0}%
          </div>

          <p>
            You answered {last?.correct || 0} out of{" "}
            {last?.total || questions.length} questions correctly.
          </p>

          <div className="quiz-result-actions">
            <Button variant="secondary" onClick={() => {
              setReviewMode(true);
              setCurrentReviewIndex(0);
              setQuizError("");
            }}>
              Review
            </Button>
            <Button disabled={generating} onClick={generateAiQuiz}>
              {generating ? "Generating…" : "Try again"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Quiz Center</h1>
          <p>Practice questions from your tracked topics.</p>
        </div>
        {renderTopicSelector()}
      </div>
      <Card className="question-card">
        <div className="question-top">
          <span>
            Question {current + 1} / {questions.length}
          </span>
          <span>{question.topic}</span>
        </div>

        <ProgressBar
          value={(current / questions.length) * 100}
        />

        <h2>{question.question}</h2>

        <div className="options">
          {question.options.map((option, index) => (
            <button
              key={option}
              className={
                selected === index ? "option selected" : "option"
              }
              onClick={() => setSelected(index)}
            >
              <span className="option-letter">
                {String.fromCharCode(65 + index)}
              </span>
              {option}
            </button>
          ))}
        </div>

        <div className="question-actions">
          <Button disabled={selected === null} onClick={next}>
            {current === questions.length - 1
              ? "Finish quiz"
              : "Next question"}
            <ChevronRight size={16} />
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* =========================================================
   ANALYTICS
========================================================= */

function Analytics({ data }) {
  const average =
    data.attempts.length === 0
      ? 0
      : Math.round(
          data.attempts.reduce((sum, a) => sum + a.score, 0) /
            data.attempts.length
        );

  const chartData = data.attempts.map((attempt, index) => ({
    name: `Quiz ${index + 1}`,
    score: attempt.score,
  }));

  const subjects = data.subjects.map((subject) => ({
    name: subject.name,
    mastery:
      subject.topics.length === 0
        ? 0
        : Math.round(
            subject.topics.reduce(
              (sum, t) => sum + t.mastery,
              0
            ) / subject.topics.length
          ),
  }));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p>Understand your academic progress.</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          icon={<TrendingUp />}
          title="Average score"
          value={`${average}%`}
          text="All quizzes"
        />

        <StatCard
          icon={<Award />}
          title="Quizzes"
          value={data.attempts.length}
          text="Attempts"
        />

        <StatCard
          icon={<Target />}
          title="Subjects"
          value={data.subjects.length}
          text="Tracked"
        />

        <StatCard
          icon={<BookOpen />}
          title="Topics"
          value={data.subjects.reduce(
            (sum, s) => sum + s.topics.length,
            0
          )}
          text="Tracked"
        />
      </div>

      <div className="two-column">
        <Card>
          <SectionTitle title="Quiz performance" />

          {chartData.length === 0 ? (
            <Empty
              icon={<BarChart3 size={30} />}
              title="No quiz data"
              text="Take a quiz to see your progress."
            />
          ) : (
            <div className="chart">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#111827"
                    strokeWidth={3}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle title="Subject mastery" />

          {subjects.length === 0 ? (
            <Empty
              icon={<BookOpen size={30} />}
              title="No subjects"
              text="Add subjects first."
            />
          ) : (
            <div className="chart">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={subjects}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="mastery" fill="#111827" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* =========================================================
   ROADMAP
========================================================= */

function Roadmap() {
  const steps = [
    {
      title: "Build programming fundamentals",
      text: "Strengthen C++, Java or Python and learn problem solving.",
      duration: "1–2 months",
    },
    {
      title: "Master DSA",
      text: "Arrays, strings, linked lists, stacks, queues, trees, graphs and DP.",
      duration: "3–5 months",
    },
    {
      title: "Learn core CS",
      text: "Focus on DBMS, OS, Computer Networks and OOP.",
      duration: "2–3 months",
    },
    {
      title: "Build projects",
      text: "Create 2–3 practical projects and publish them on GitHub.",
      duration: "2–3 months",
    },
    {
      title: "Prepare for placements",
      text: "Practice aptitude, coding interviews, resume and communication.",
      duration: "1–2 months",
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Career Roadmap</h1>
          <p>A practical roadmap for a CSE student.</p>
        </div>
      </div>

      <Card className="roadmap-intro">
        <Compass size={35} />
        <div>
          <h2>From student to software engineer</h2>
          <p>
            Follow the roadmap step-by-step. Focus on consistency
            instead of trying to learn everything at once.
          </p>
        </div>
      </Card>

      <div className="roadmap">
        {steps.map((step, index) => (
          <div className="roadmap-step" key={step.title}>
            <div className="roadmap-number">{index + 1}</div>

            <Card>
              <div className="roadmap-top">
                <h2>{step.title}</h2>
                <span>{step.duration}</span>
              </div>

              <p>{step.text}</p>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   MODAL
========================================================= */

function Modal({ title, close, children }) {
  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>

          <button className="icon-btn" onClick={close}>
            <X size={19} />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

/* =========================================================
   MAIN APP
========================================================= */

export default function App() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState(defaultData);
  const [view, setView] = useState("dashboard");

  useEffect(() => {
    (async () => {
      try {
        // Prefer server-backed session when a token is present
        const token = localStorage.getItem('campusmate_token');
        if (token) {
          try {
            const me = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
            if (me.ok) {
              const json = await me.json();
              if (json?.user) {
                setUser(json.user);
                const local = getUserData(json.user.email);
                if (Array.isArray(json.user.subjects)) {
                  local.subjects = json.user.subjects;
                }
                if (Array.isArray(json.user.notes)) local.notes = json.user.notes;
                if ("syllabus" in json.user) local.syllabus = json.user.syllabus;
                setData(local);

                // fetch persisted chat from server
                try {
                  const resp = await fetch('/api/messages', { headers: { Authorization: `Bearer ${token}` } });
                  if (resp.ok) {
                    const j = await resp.json();
                    if (j?.chat) setData((prev) => ({ ...prev, chat: j.chat }));
                  }
                } catch (e) {
                  // ignore
                }

                return;
              }
            }
            if (me.status === 401) {
              localStorage.removeItem('campusmate_token');
              localStorage.removeItem(SESSION_KEY);
              setUser(null);
              return;
            }
          } catch (e) {
            // token might be invalid or server unreachable — fall back to local session
          }
        }

        // Fallback: legacy local session in absence of a valid server token
        const session = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (session) {
          setUser(session);
          const local = getUserData(session.email);
          setData(local);

          // try to fetch persisted chat from server and merge if token available
          try {
            const token2 = localStorage.getItem('campusmate_token');
            const headers = {};
            if (token2) headers['Authorization'] = `Bearer ${token2}`;
            const resp = await fetch('/api/messages', { headers });
            if (resp.ok) {
              const json = await resp.json();
              if (json?.chat) {
                setData((prev) => ({ ...prev, chat: json.chat }));
              }
            }
          } catch (e) {
            // ignore — server may be down
          }
        }
      } catch (e) {
        setUser(null);
      }
    })();
  }, []);

  function login(userData) {
    setUser(userData);
    const local = getUserData(userData.email);
    if (Array.isArray(userData.subjects) && userData.subjects.length) {
      local.subjects = userData.subjects;
    }
    setData(local);
    setView("dashboard");
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('campusmate_token');
    setUser(null);
    setData(defaultData);
  }

  function updateData(newData) {
    setData(newData);

    if (user) {
      saveUserData(user.email, newData);
    }
  }

  if (!user) {
    return <Auth onLogin={login} />;
  }

  function renderView() {
    switch (view) {
      case "subjects":
        return (
          <Subjects data={data} updateData={updateData} />
        );

      case "notes":
        return <Notes data={data} updateData={updateData} />;

      case "planner":
        return (
          <Planner data={data} updateData={updateData} />
        );

      case "attendance":
        return <Attendance data={data} updateData={updateData} />;

      case "assistant":
        return (
          <Assistant data={data} updateData={updateData} user={user} />
        );

      case "quiz":
        return <Quiz data={data} updateData={updateData} />;

      case "analytics":
        return <Analytics data={data} />;

      case "roadmap":
        return <Roadmap />;

      default:
        return (
          <Dashboard
            user={user}
            data={data}
            setView={setView}
            updateData={updateData}
          />
        );
    }
  }

  return (
    <div className="app">
      <Sidebar
        view={view}
        setView={setView}
        user={user}
        logout={logout}
      />

      <main className="main">{renderView()}</main>
    </div>
  );
}
