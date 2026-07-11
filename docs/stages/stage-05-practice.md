# Stage 5 — Mode A: live practice (text)

Part of the [build plan](../build-plan.md) · Context to load: [ai-layer](../architecture/ai-layer.md) · [data-model](../architecture/data-model.md)

Goal: the interviewer engine, transport-agnostic so voice drops in next stage. Built on the Stage 1 design system: composes existing primitives, ships each screen's empty/loading/error/keyboard states, and honors the a11y + reduced-motion floor.

- [ ] 5.1 Interviewer engine (Sonnet + cached system prompt/rubric): question selection from genre/JD/bank coverage; asks "tell me about a time…"; session state machine (question → answer → feedback → follow-up | next) with a defined long-session context policy (rolling summary of old turns, trimmed cache-prefix-compatibly).
- [ ] 5.2 Feedback rubric: STAR completeness, specificity, measurable result, length; delivered after each answer.
- [ ] 5.3 Drill-down follow-ups ("what did you measure there?") triggered by vague/unquantified answers.
- [ ] 5.4 Session persistence + history view (transcript, feedback recap); link answers to the bank experiences they used; flag "you told a story that isn't banked yet — capture it?" (feeds the Maintain loop).
- [ ] 5.5 e2e (replay transport): scripted 3-question session; a deliberately vague answer must trigger a drill-down, and feedback must score all four rubric dimensions.

**Checkpoint 5**: the 5.5 e2e passes, and a live typed mock interview feels realistic — pointed questions, honest feedback, at least one sharp follow-up — with the session reviewable afterward.
