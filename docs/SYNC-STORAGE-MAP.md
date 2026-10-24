# Audited sync & migration key mapping

Schema version **1**, **174 explicit local keys**, dynamic widget navigation, and the two actual attachment stores. Generated from audited source references; no database is inferred from a filename alone. Runtime/server allowlist: `src/cloud/storage-schema.js`.

Each local key maps to `users/{uid}/records/{sha256(key)}` and immutable payload versions, preserving its exact string/JSON structure. Ordered arrays keep their positions; original IDs/dates stay inside the payload. References are not necessarily sole writers: shared widgets also read these stores. Keys retained from the old manifest with no current source reference are legacy compatibility, not invented new features.

| Legacy key | Existing source reference / ownership context |
|---|---|
| `achievements` | `src/ai-career-mentor-widget.js`, `src/career-command-center-widget.js`, `src/premium-productivity-features.js` |
| `appSettings` | `src/career-command-center-widget.js`, `assets/app-bundle.js` |
| `arise-ai-career-mentor-ai-cache-v1` | `src/ai-real-insights-widget.js`, `src/storage-keys.js` — Cached AI-generated career insights. |
| `arise-ai-career-mentor-snapshots-v1` | `src/ai-career-mentor-widget.js`, `src/storage-keys.js` — AI Career Mentor: saved readiness snapshots. |
| `arise-ai-connect-v2` | `src/ai-connect-shared.js`, `src/storage-keys.js` — Shared AI-provider connection settings used by the AI-powered widgets. |
| `arise-aptitude-log-v1` | `src/aptitude-practice-widget.js`, `src/storage-keys.js` — Aptitude practice sets (section/topic/attempted/correct/time) plus target accuracy and weekly-set goal. |
| `arise-aptitude-summary-v1` | `src/aptitude-practice-widget.js`, `src/readiness-engine.js`, `src/storage-keys.js` — Write-through aptitude score (60-day accuracy) read by src/readiness-engine.js. |
| `arise-attendance-ai-insight-v1` | `src/attendance-tracker-widget.js` |
| `arise-attendance-tracker-v1` | `src/ai-career-mentor-widget.js`, `src/attendance-tracker-widget.js`, `src/features/placement-tracker/placement-calculations.js` — Attendance Tracker: subjects, daily log, timetable. |
| `arise-career-readiness-history-v1` | `src/premium-productivity-features.js`, `src/readiness-50lpa-widget.js`, `src/readiness-path-planner-widget.js` — Historical readiness-score snapshots over time. |
| `arise-cert-goals-v1` | `src/features/certificates/certificates-widget.js` |
| `arise-certificates-collapsed-categories-v1` | `src/features/certificates/certificates-widget.js` |
| `arise-cgpa` | `src/career-command-center-widget.js` |
| `arise-cgpa-tracker-v1` | `src/attendance-tracker-widget.js`, `src/cgpa-tracker-widget.js`, `src/features/semester-risk/cse-syllabus-plus-widget.js` — CGPA Tracker: semester grades, full 56-subject/8-semester syllabus config. |
| `arise-cp-ac-upcoming-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-atcoder-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-cc-upcoming-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-cf-upcoming-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-codechef-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-codeforces-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-codewars-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-custom-platform-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-gfg-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-github-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-leetcode-cache-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-studyplan-v1` | `src/competitive-programming-widget.js` |
| `arise-cp-tracker-v1` | `src/career-command-center-widget.js`, `src/competitive-programming-widget.js`, `src/features/certificates/certificates-widget.js` — Competitive Programming: platforms, ratings, problems, contests, activity log. |
| `arise-daily-learning-tasks-v1` | `src/daily-learning-tasks-widget.js` |
| `arise-dashboard-accent-override` | `src/storage-keys.js`, `src/theme-system.js` — Accent-color override. |
| `arise-dashboard-custom-themes` | `src/storage-keys.js`, `src/theme-system.js` — User-defined custom themes. |
| `arise-dashboard-theme` | `src/premium-productivity-features.js`, `src/storage-keys.js`, `src/theme-system.js` — Selected color theme. |
| `arise-dashboard-theme-mode` | `src/premium-productivity-features.js`, `src/storage-keys.js`, `src/theme-system.js` — Light/dark mode override. |
| `arise-dashboard-theme-schedule` | `src/storage-keys.js`, `src/theme-system.js` — Scheduled light/dark auto-switch config. |
| `arise-expenses-ai-insights-v1` | `src/expenses.js` |
| `arise-expenses-alert-thresholds-v1` | `src/expenses.js` |
| `arise-expenses-budgets-v1` | `src/expenses.js`, `src/storage-keys.js` — Per-category budgets. |
| `arise-expenses-custom-categories-v1` | `src/expenses.js` |
| `arise-expenses-debt-plan-v1` | `src/expenses.js` |
| `arise-expenses-fee-reserves-v1` | `src/expenses.js`, `src/storage-keys.js` — College Fee Reserve: fee obligations (tuition/hostel/exam/etc.) with total required + manually-allocated reserved amount. |
| `arise-expenses-goals-v1` | `src/expenses.js`, `src/storage-keys.js` — Savings/spending goals. |
| `arise-expenses-ie-view-v1` | `src/expenses.js` |
| `arise-expenses-investments-v1` | `src/expenses.js`, `src/storage-keys.js` — Investments/savings tracker: SIP/FD/RD/stocks/PPF/gold/other entries with invested amount vs current value. |
| `arise-expenses-iou-v1` | `src/expenses.js` |
| `arise-expenses-loan-categories-v1` | `src/expenses.js` |
| `arise-expenses-loans-v1` | `src/expenses.js` |
| `arise-expenses-month-seen-v1` | `src/expenses.js`, `src/storage-keys.js` — Last locally-observed calendar month (YYYY-MM); used only to detect a month rollover so the widget can auto-select the new current month. |
| `arise-expenses-monthly-budget-v1` | `src/expenses.js` |
| `arise-expenses-net-worth-v1` | `src/expenses.js` |
| `arise-expenses-networth-history-v1` | `src/expenses.js` |
| `arise-expenses-next-inflow-v1` | `src/expenses.js` |
| `arise-expenses-notify-enabled-v1` | `src/expenses.js` |
| `arise-expenses-pdf-prefs-v1` | `src/expenses.js` |
| `arise-expenses-recurring-v1` | `src/expenses.js`, `src/storage-keys.js` — Recurring-expense templates. |
| `arise-expenses-scenario-v1` | `src/expenses.js` |
| `arise-expenses-semester-v1` | `src/expenses.js` |
| `arise-expenses-v1` | `src/expenses.js`, `src/storage-keys.js` — Expense entries. |
| `arise-expenses-weekly-budget-v1` | `src/expenses.js`, `src/storage-keys.js` — Weekly spending budget. |
| `arise-focus-mode-v1` | `src/focus-mode-widget.js`, `src/storage-keys.js` — Focus Mode on/off flag — raw '1'/'0' string, not JSON, so schema versioning doesn't apply. |
| `arise-la-config-v1` | `src/learning-session-analytics-widget.js`, `src/readiness-path-planner-widget.js`, `src/storage-keys.js` — Session Analytics v153 settings: per-category weekly hour targets, placement season date, DSA hours-needed target. |
| `arise-mc-backfill-dismissed-v1` | `src/learning-mastery-correlation-widget.js` |
| `arise-mc-backfill-info-v1` | `src/learning-mastery-correlation-widget.js` |
| `arise-mc-lag-mode-v1` | `src/learning-mastery-correlation-widget.js` |
| `arise-mc-weeks-window-v1` | `src/learning-mastery-correlation-widget.js` |
| `arise-nav-groups-collapsed` | `assets/app-bundle.js` |
| `arise-notes-app-v1` | `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/notes-app-widget.js`, `src/premium-productivity-features.js` — Notes App: folders, tags, full note bodies. |
| `arise-personal-wiki-v1` | `src/personal-wiki-widget.js`, `src/premium-productivity-features.js`, `src/storage-keys.js` — Personal Wiki pages. |
| `arise-quick-toggle-last-theme-v1` | `src/theme-quick-toggle.js` |
| `arise-resume-linkedin-readiness-v1` | `src/placement-engine.js`, `src/premium-productivity-features.js`, `src/storage-keys.js` — Resume/LinkedIn readiness checklist state. |
| `arise-semester-mastery-trend-v1` | `src/storage-keys.js` — Append-only weekly snapshots of completion % + priority score per semester, used by the Semester Trend sparkline block inside the Semester Mastery Heatmap widget. Cap: 24 entries per semester (≈6 months). |
| `arise-sessions` | `src/career-command-center-widget.js` |
| `arise-sidebar-collapsed` | `src/premium-productivity-features.js`, `assets/app-bundle.js` |
| `arise-skills-timeline-v1` | `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/premium-productivity-features.js`, `src/skills-timeline-widget.js` — Skills Timeline entries (Timeline + Roadmap views). |
| `arise-social-media-v1` | `src/social-media-widget.js`, `src/storage-keys.js` — Social Media widget: per-platform handles/links + custom platforms. |
| `arise-today-revision-v1` | `src/premium-productivity-features.js`, `src/storage-keys.js` — Today's revision-due cache for the command palette. |
| `arise-ui-density-v1` | `src/premium-productivity-features.js`, `src/saas-widget-enhancer.js` |
| `arise-water-reminder-log-v1` | `src/water-reminder-widget.js` |
| `arise-water-reminder-settings-v1` | `src/storage-keys.js`, `src/water-reminder-widget.js` — Water Reminder settings. |
| `arise-water-reminder-weather-v1` | `src/water-reminder-widget.js` |
| `arise-weekly-ai-report-v1` | `src/premium-productivity-features.js`, `src/storage-keys.js`, `src/weekly-ai-report-widget.js` — Generated weekly AI report content. |
| `arise-weekly-summary-snapshots-v1` | `src/premium-productivity-features.js`, `src/storage-keys.js`, `src/weekly-ai-report-widget.js` — Weekly summary snapshots feeding the AI report. |
| `arise-widget-nav-attendance` | `src/attendance-tracker-widget.js`, `src/storage-keys.js` — Last-active tab, one key per widget using AriseWidgetNav (pattern: 'arise-widget-nav-<widget>'). |
| `ariseAmbientSound:v1` | `index.html` |
| `ariseWhatILearnedLog` | `src/ai-smart-learning-path-widget.js` |
| `arise_certificates_readiness_signal_v1` | `src/features/certificates/certificates-widget.js` |
| `arise_certificates_v1` | `src/features/certificates/certificates-storage.js`, `src/skills-timeline-widget.js`, `src/storage-keys.js` — Certificates list + tags/pins/verification metadata. |
| `arise_exam_tracker_v1` | `src/ai-career-mentor-widget.js`, `src/features/exam-tracker/exam-tracker-storage.js`, `src/features/semester-risk/cse-syllabus-plus-widget.js` — Exam Tracker v2: exams, syllabus topics, revision, results, topic PYQ practice, study-hours preference, per-day plan state. |
| `arise_placement_tracker_v1` | `src/features/placement-tracker/placement-storage.js`, `src/placement-engine.js`, `src/storage-keys.js` — Placement Tracker: applications, offers, internships. |
| `cdn_streak_checkins_v1` | `assets/app-bundle.js` |
| `cdn_streak_freezes_v1` | `assets/app-bundle.js` |
| `cdn_streak_v1` | `assets/app-bundle.js` |
| `cdn_streak_xp_v1` | `assets/app-bundle.js` |
| `cgpa` | `src/career-command-center-widget.js`, `src/cgpa-tracker-widget.js`, `src/premium-productivity-features.js` |
| `cse-syllabus-ai-insights-v1` | `src/features/semester-risk/cse-syllabus-plus-v144-patch.js` |
| `cse-syllabus-completion-timestamps-v1` | `src/features/semester-risk/cse-syllabus-plus-v144-patch.js`, `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js` |
| `cse-syllabus-custom-v1` | `src/features/semester-risk/cse-syllabus-plus-v144-patch.js`, `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js` |
| `cse-syllabus-difficulty-v1` | `src/features/semester-risk/cse-syllabus-plus-v144-patch.js`, `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js` |
| `cse-syllabus-exam-dates-v1` | `src/features/semester-risk/cse-syllabus-plus-v144-patch.js`, `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` — CSE Syllabus Plus: per-subject exam date overrides. Merged at read-time with arise_exam_tracker_v1 (ET default when no override); only written when user explicitly diverges from the ET date. |
| `cse-syllabus-gate-mode-v1` | `src/features/semester-risk/cse-syllabus-plus-v144-patch.js`, `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `cse-syllabus-ia-settings-v1` | `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `cse-syllabus-ia-tracker-v1` | `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `cse-syllabus-internal-marks-v1` | `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `cse-syllabus-notes-v1` | `assets/app-bundle.js` |
| `cse-syllabus-notif-seen-v1` | `src/features/semester-risk/cse-syllabus-plus-v144-patch.js` |
| `cse-syllabus-portfolio-suggested-v1` | `src/features/semester-risk/cse-syllabus-plus-widget.js` |
| `cse-syllabus-progress-v1` | `src/ai-smart-learning-path-widget.js`, `src/battle-plan-widget.js`, `src/career-command-center-widget.js` |
| `cse-syllabus-pyq-custom-v1` | `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js` |
| `cse-syllabus-resources-v1` | `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js` |
| `cse-syllabus-revision-v1` | `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js`, `assets/app-bundle.js` |
| `cse-syllabus-score-mode-v1` | `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `cse-syllabus-tab-state-v1` | `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js` |
| `cse-syllabus-topic-progress-v1` | `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `cse-syllabus-undo-stack-v1` | `src/features/semester-risk/cse-syllabus-plus-v144-patch.js` |
| `cse-syllabus-xp-awarded-v1` | `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `cseSyllabusCompletionLog-v1` | `src/learning-mastery-correlation-widget.js`, `src/storage-keys.js` — CSE syllabus completion log for the same correlation chart. |
| `csu-rs-goal-v1` | `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `csu-rs-history-v3` | `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `csu-rs-level-seen-v3` | `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `csu-rs-mode-v2` | `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `csu-rs-open-v2` | `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `csu-unified-tab-v1` | `src/features/semester-risk/cse-syllabus-unified-widget.js` |
| `devGithubProjects-v1` | `src/dev-mastery-premium-widget.js`, `src/placement-engine.js` |
| `devInterviewPrep-v1` | `src/dev-mastery-premium-widget.js`, `src/placement-engine.js` |
| `devMasteryActivity-v1` | `src/dev-mastery-heatmap-widget.js`, `src/dev-mastery-premium-widget.js`, `src/dev-milestone-badges-widget.js` — Dev daily-activity heatmap data, shared by the streak/pace/solve-speed dev-track widgets. |
| `devMasteryJDCheck-v1` | `src/dev-mastery-premium-widget.js` |
| `devMasteryOpenings-v1` | `src/dev-mastery-premium-widget.js` |
| `devMasterySnapshots` | `src/dev-mastery-trend-widget.js` |
| `devPortfolioStarred-v1` | `src/dev-portfolio-flags-widget.js` |
| `devRevisionSRS` | `src/dev-revision-scheduler-widget.js`, `src/storage-keys.js` — Dev Mastery companion: SM-2 spaced-repetition schedule for revision-flagged tasks. |
| `devTaskInsights` | `src/dev-mastery-premium-widget.js`, `src/dev-portfolio-flags-widget.js`, `src/dev-quality-trend-widget.js` — Dev Mastery companion: per-task stack tags + build-quality rating. |
| `devTaskTimestamps-v1` | `src/dev-pace-projection-widget.js`, `src/dev-quality-trend-widget.js`, `src/dev-revision-scheduler-widget.js` — Completion timestamps for devTasks (React state has no dates of its own). |
| `devTasks` | `src/ai-career-mentor-widget.js`, `src/ai-smart-learning-path-widget.js`, `src/battle-plan-widget.js` — Dev Mastery task list — React-owned state; many dev-track bolt-ons read it, none write it. |
| `devTasksCompletionLog-v1` | `src/learning-mastery-correlation-widget.js`, `src/storage-keys.js` — Dev task completion log used for the study-time-vs-mastery correlation chart. |
| `dsaDailyGoal` | `src/dsa-daily-goal-widget.js`, `src/storage-keys.js` — DSA Daily Goal: per-day solve target (1-10). |
| `dsaMasterySnapshots` | `src/dsa-mastery-trend-widget.js` |
| `dsaMockOAActive` | `src/dsa-mock-oa-widget.js`, `src/storage-keys.js` — DSA Mock OA: the running or just-finished timed mock session (cleared once saved or abandoned). |
| `dsaMockOAHistory` | `src/dsa-mock-oa-widget.js`, `src/dsa-proof-pack-widget.js`, `src/storage-keys.js` — DSA Mock OA: last 40 finished mocks with per-problem miss reasons. |
| `dsaMockOASettings` | `src/dsa-mock-oa-widget.js`, `src/storage-keys.js` — DSA Mock OA: chosen preset and topic scope. |
| `dsaProblemInsights` | `src/dsa-pattern-playbook-widget.js`, `src/dsa-problem-insights-widget.js`, `src/dsa-proof-pack-widget.js` — DSA companion: per-question company tags + solve pattern. |
| `dsaProgress` | `src/competitive-programming-widget.js` |
| `dsaQuestions` | `src/ai-career-mentor-widget.js`, `src/ai-smart-learning-path-widget.js`, `src/battle-plan-widget.js` — DSA question list — React-owned state; many DSA-track bolt-ons read it, none write it. |
| `dsaRevisionSRS` | `src/dsa-revision-scheduler-widget.js`, `src/placement-engine.js`, `src/storage-keys.js` — DSA companion: SM-2 spaced-repetition schedule for solved questions. |
| `examLiveTimers-v1` | `assets/app-bundle.js` |
| `exams` | `src/ai-career-mentor-widget.js`, `src/ai-smart-learning-path-widget.js`, `src/battle-plan-widget.js` |
| `exw-filter-mode` | `src/expenses.js` |
| `exw-month-filter` | `src/expenses.js` |
| `exw-sort-mode` | `src/expenses.js` |
| `focusSessionsV2` | `src/features/semester-risk/cse-syllabus-plus-widget.js`, `src/features/semester-risk/cse-syllabus-tabs-v150-patch.js`, `src/features/semester-risk/cse-syllabus-unified-widget.js` — Focus Timer session records (v2 shape) read by learning-session-analytics and the semester-risk widget. |
| `hackathonExpenseTrackerV1` | `src/hackathon-expense-tracker-widget.js` |
| `hackathonExpenseTrackerV2` | `src/hackathon-expense-tracker-widget.js`, `src/storage-keys.js` — Hackathon Expense Tracker entries (v2 shape; v1 kept only as a migration source). |
| `hackathonPipelineNotifyV1` | `src/hackathon-pipeline-widget.js`, `src/storage-keys.js` — Pipeline deadline-notification state. |
| `hackathonPipelineV1` | `src/hackathon-funnel-widget.js`, `src/hackathon-pipeline-widget.js`, `src/hackathon-team-directory-widget.js` — Hackathon Pipeline entries + deliverables checklists. |
| `hackathonTeamDirectoryV1` | `src/hackathon-team-directory-widget.js`, `src/storage-keys.js` — Hackathon team member directory. |
| `hackathonTimelineV1` | `src/hackathon-timeline-widget.js`, `src/storage-keys.js` — Hackathon timeline/milestone entries. |
| `hackathonTrackerV1` | `src/hackathon-expense-tracker-widget.js`, `src/hackathon-prize-wall-widget.js`, `src/hackathon-tracker-widget.js` — Hackathon entries — Pipeline/Prize Wall/Team Directory/Expense/Timeline sub-widgets all key off this. |
| `interviewSheetsProgress` | `src/career-command-center-widget.js`, `src/dsa-mastery-premium-widget.js`, `src/dsa-milestone-badges-widget.js` — Per-question solved/unsolved map for the bundled interview sheets (Blind75/NeetCode150/etc). |
| `notes` | `src/ai-career-mentor-widget.js`, `src/ai-smart-learning-path-widget.js`, `src/battle-plan-widget.js` — Legacy/simple notes array — separate from arise-notes-app-v1 (the full Notes App widget). |
| `pjw-sort-mode` | `src/projects-widget.js` |
| `placement90DayPlan-v1` | `src/placement-engine.js`, `src/storage-keys.js` — Placement intelligence: 90-day plan start date + recalculation history (missed-day redistributions). |
| `placementDefense-v1` | `src/placement-engine.js`, `src/storage-keys.js` — Placement intelligence: per-project Defense Simulator sessions (self-scored answers 0-4, weak categories). |
| `placementJD-v1` | `src/dev-placement-engine-widget.js`, `src/storage-keys.js` — Placement intelligence: last pasted job description for the JD -> Skill Gap engine (plain text). |
| `placementPatternTransfer-v1` | `src/placement-engine.js`, `src/storage-keys.js` — Placement intelligence: Pattern Transfer Test history + in-progress test state (pattern, problem, timing, quality self-ratings). |
| `placementSprintLog-v1` | `src/placement-engine.js`, `src/storage-keys.js` — Placement intelligence: weekly sprint completion checks per ISO week (drives next week's auto-adjusted targets; ~12 weeks kept). |
| `projects` | `src/ai-career-mentor-widget.js`, `src/career-command-center-widget.js`, `src/dev-mastery-heatmap-widget.js` — Projects tracker entries. |
| `revisionSystemProgress` | `src/ai-smart-learning-path-widget.js`, `src/learning-heatmap-widget.js`, `src/revision-system-widget.js` — Forgetting-curve revision engine progress map (stage/lastActionAt/history/stability per topic). |
| `revisionSystemProgress__migrated_v2` | Legacy compatibility (no active reference outside old manifest) |
| `revisionSystemProgress__migration_backup_v2` | `src/revision-system-widget.js` — backup suffix built dynamically from `revisionSystemProgress`. |
| `showLanding` | `index.html`, `assets/app-bundle.js` |
| `smartLearningPathProgress` | `src/ai-smart-learning-path-widget.js`, `src/learning-heatmap-widget.js`, `src/storage-keys.js` — AI Smart Learning Path progress state. |
| `stopwatchSessions` | `assets/app-bundle.js` |
| `streak` | `src/ai-career-mentor-widget.js`, `src/ai-smart-learning-path-widget.js`, `src/battle-plan-widget.js` |
| `studySessions` | `src/ai-career-mentor-widget.js`, `src/burnout-detector-widget.js`, `src/career-command-center-widget.js` — Focus Timer session log — read by streak/heatmap/analytics widgets. |
| `tasks` | `src/ai-career-mentor-widget.js`, `src/battle-plan-widget.js`, `src/burnout-detector-widget.js` — Legacy generic task list read by several widgets (weekly report, command palette, battle plan). |
| `xp` | `src/ai-career-mentor-widget.js`, `assets/app-bundle.js` |
| `xpEngineDailyLog` | `src/storage-keys.js`, `src/xp-engine.js` — Daily XP award log (used for diminishing-returns + per-day caps like hydrationXP). |

## Dynamic / binary mapping

- `arise-widget-nav-<widget>`: per-widget preference from `src/widget-nav.js`; same versioned record mapping, bounded lowercase key pattern.
- IndexedDB `arise-local-files-db-v1` / `files`: shared project, note, certificate and internship attachments.
- IndexedDB `arise-certificates-files-db-v1` / `certFiles`: certificate attachment metadata/bodies.
- Each binary record maps to `idb:<database>:<typed-ID-base64url>` with immutable chunks and a versioned manifest. Original IDs, names, owner links and upload dates remain unmodified.

The two generic dynamic reads reported by `npm run audit:storage` are reviewed explicitly: `src/storage-watch-bus.js` reads a registered observer key (not a new store), and `src/theme-quick-toggle.js` reads the original theme system’s `modeStorageKey` (`arise-dashboard-theme-mode`, already listed above). CP’s constant-return `La()` key helper is resolved automatically by the guard. Static discovery is a regression aid, not a proof about arbitrary future computed keys.

## Deliberate exclusions

- Firebase provider/session storage; Google passwords/access tokens; Gist PAT/pairing credentials; pseudo-auth `userSession` / `cloudSyncState`; unknown/provider databases.
- `backupCenter:*`, runtime probes, `arise-perf-mode`, `arise-chunks`, browser permissions, active audio playback, running intervals and unsaved forms.
- Unknown noncredential keys: source retained, exported under `unsupportedLocalStorage`, never automatically uploaded. New unsupported writes display a local-only warning. Audit, extend the shared schema and test before adding a new store.
- Derived panels with no independent persistence recompute from these stores. Cached analytics with actual keys remain supported, not replaced with invented collections.

Full schema, ordering policy, conflict granularity, ownership, limits and recovery: [SECURE-SYNC.md](SECURE-SYNC.md).
