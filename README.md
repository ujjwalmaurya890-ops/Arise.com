# 🚀 Arise CSE | Your Complete CSE Companion

**Arise CSE** is a student-focused platform designed to simplify the Computer Science Engineering journey by bringing learning, coding practice, academic management, career preparation, and productivity tools into one place.

Whether you're learning Data Structures and Algorithms, preparing for placements, managing your academics, or building projects, Arise CSE aims to help you stay organized, productive, and career-ready.

🌐 **Live Website:** [arisexcse.netlify.app](https://arisexcse.netlify.app)

---

## Secure Google workspace setup

Google sign-in, a **server-controlled exactly-five-account policy**, and UID-isolated Firestore progress sync are now integrated. The existing dashboard/widgets/themes remain in place. Unconfigured deployments are intentionally locked; no production Firebase project or private credentials are included.

**Start here: [Deployment, five-email configuration, migration & rollback guide](docs/SECURE-SYNC.md).**

- [Pre-implementation audit](docs/SECURE-SYNC-AUDIT.md)
- [Complete storage migration map](docs/SYNC-STORAGE-MAP.md)
- [Actual test results and remaining provider/emulator verification](docs/SECURE-SYNC-TESTS.md)
- [Exact changed-file list](docs/SECURE-SYNC-CHANGES.md)

Node 22.22+: `npm ci`, configure `.env` from `.env.example`, then `npm run dev`.
`npm test` runs the checked-in feature regression files plus the cloud/auth/sync tests. `npm run test:rules` requires a local Firestore emulator; without one, the rules test reports a skip. `npm run build` produces a safe **`dist/`** site. **Netlify must publish `dist`, never `.`.** The old shared-code `/api/sync` is retired (HTTP 410); never redeploy its unauthenticated implementation.


## Engineering audit — 2026-10-30

The [engineering report](docs/ENGINEERING-OVERHAUL-2026-10-30.md) documents the existing architecture, incremental security/reliability/UI changes, exact file inventory, executed tests, mixed performance results, and remaining work. [Recorded lab measurements](docs/ENGINEERING-OVERHAUL-MEASUREMENTS-2026-10-30.json) include every baseline and after-run summary, not just favorable results.

With the built site running, `npm run test:browser:engineering` checks route layouts, recovery, attachment safety and the real offline shell. `npm run test:performance -- measurement` repeats the local lab protocol. These use explicit test authentication fixtures; they do not verify live provider credentials or relax the production sign-in gate.

## ✨ Core Features

### 📚 Academic Management
- Organize your academic journey and learning resources.
- Track attendance, CGPA, syllabus progress, and academic goals.
- Keep important study information accessible in one place.

### 💻 DSA & Coding Practice
- Practice Data Structures and Algorithms.
- Organize coding practice and track your learning progress.
- Build consistency in problem-solving and competitive programming.

### 🎯 Placement Preparation
- Prepare for technical interviews and placement opportunities.
- Organize interview preparation and career goals.
- Develop skills relevant to software engineering roles.

### 🚀 Project & Portfolio Management
- Organize personal and academic projects.
- Track project progress and development goals.
- Support your journey toward building a stronger developer portfolio.

### 🏆 Hackathon Management
- Keep track of hackathons and project-building opportunities.
- Organize participation plans and development tasks.
- Encourage collaboration, experimentation, and practical learning.

### ⚡ Productivity & Focus Tools
- Use focus timers and productivity tools to structure study sessions.
- Track habits and learning goals.
- Organize notes, tasks, and study activities.
- Build consistent learning routines.

### 📊 Progress Tracking & Analytics
- Monitor learning activities and personal goals.
- Review progress to identify areas that need improvement.
- Stay motivated through structured tracking.

### 🎨 Modern User Experience
- Clean and student-friendly interface.
- Responsive layouts for supported screen sizes.
- Organized navigation across learning and productivity features.
- A convenient browser-based experience.

---

## 🛠️ Tech Stack

The project uses modern web technologies to deliver an interactive student-focused experience.

| Technology | Purpose |
|---|---|
| HTML5 | Webpage structure |
| CSS3 | Styling, layouts, and responsive design |
| JavaScript (ES6+) | Interactive features and application logic |
| React-based UI components | Interface and dashboard components, where used |
| Node.js & npm | Development tooling and package management |
| Firebase Authentication / Firestore | Google identity, private five-account policy, UID-isolated cloud progress |
| Browser APIs | Account-scoped cache, durable pending queue, consented legacy migration |
| Netlify | Website hosting and deployment |
| Netlify Functions | Server-side integrations, where configured |

---

## 🗂️ Repository Layout

- `src/` — application JavaScript and feature modules.
- `styles/` — global and feature-specific stylesheets.
- `tests/` — Node/jsdom feature regressions, cloud/auth/sync tests, and opt-in real Firestore rules tests.
- `scripts/` — local server, build helpers, and test runner.
- `assets/` — images, fonts, generated widget chunks, sound files, and static data.
- `docs/` — upgrade notes and project documentation.
- Root-level `index.html`, `service-worker.js`, `netlify.toml`, and package manifests remain at the site root because static hosting, service-worker scope, and Netlify publish paths rely on those entry points.

Use `npm run dev` to build and serve the site/API locally, `npm run build` for production, and `npm test` for regressions and auth/sync tests. See the secure setup guide before deployment.

---

## 🚀 Getting Started

Follow these steps to run the project locally.

### Prerequisites

- [Node.js](https://nodejs.org/)
- npm
- Git

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/ujjwalmaurya890-ops/Arise.com.git
```

**2. Navigate to the project directory**

```bash
cd Arise.com
```

**3. Install dependencies**

```bash
npm ci
```

**4. Start the development server**

Copy `.env.example` to `.env` and complete [the secure setup guide](docs/SECURE-SYNC.md). Until a real Firebase project and five-account policy are configured, the app intentionally shows a locked sign-in screen. Then run:

```bash
npm run dev
```

The dev command builds `dist/` and serves the app and same-origin API on port 8123.

**5. Open the local website**

Open the local URL printed in your terminal.

---

## 🌐 Live Demo

Existing deployed site (not automatically updated by this repository change):

👉 [https://arisexcse.netlify.app](https://arisexcse.netlify.app)

---

## 🎯 Project Goals

Arise CSE aims to:

- Make CSE learning more organized and accessible.
- Encourage consistent DSA practice and problem-solving.
- Help students manage academic responsibilities.
- Support placement preparation and career development.
- Improve productivity through structured study tools.
- Encourage practical learning through projects and hackathons.

---

## 🤝 Contributing

Contributions, suggestions, and bug reports are welcome!

1. Fork this repository.
2. Create a new branch.
3. Make your changes.
4. Test your changes.
5. Submit a pull request with a clear description.

Please ensure your changes are tested and relevant to the project's goals.

---

## 🔒 Security & Privacy

- Avoid committing API keys, passwords, tokens, or other secrets.
- Store sensitive credentials in environment variables.
- Validate external integrations and handle errors appropriately.
- Review data-storage and privacy behavior before deploying changes.

---

## 📄 License

No license has been specified yet. Add an appropriate open-source license before allowing others to reuse, modify, or distribute the project.

---

## 👨‍💻 Author

**Made by Ujjwal ❤️**

Built with curiosity, consistency, and a passion for technology.

---

⭐ **If you find Arise CSE useful, consider starring the repository and sharing it with fellow CSE students.**

*Learn consistently. Build practically. Grow relentlessly.* 🚀
