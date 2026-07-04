# Stage 10 — Maintain, polish, distribute

Part of the [build plan](../build-plan.md) · Context to load: [privacy-and-risks](../architecture/privacy-and-risks.md) · [overview](../architecture/overview.md)

Goal: the bank stays current; the app installs, updates, and backs up cleanly.

- [ ] 10.1 Nudges: staleness banner ("last logged 3 weeks ago"), configurable OS-notification reminder, post-practice "bank that story?" prompts, and an optional launch-at-startup/tray-resident toggle so reminders reach the logger who stops opening the app.
- [ ] 10.2 JSON export/import + one-click DB backup from Settings.
- [ ] 10.3 electron-updater + GitHub Releases; final packaging pass (icon, installer, SmartScreen note in README).
- [ ] 10.4 Cost dashboard polish (spend by feature from `usage_log`); empty-state/onboarding pass (first-run: key setup → first brain dump).

**Checkpoint 10**: fresh Windows machine → install → onboard → daily use, with backups working and the **unsigned update path verified end-to-end on a real machine** (accepted fallback: manual download from Releases).
