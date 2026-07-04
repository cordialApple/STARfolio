# STARfolio — concept & user stories

Working name (earlier: SuperSTAR). A private, single-user desktop app: your
experience bank lives locally, with no account and no server to run. This is the
concept and the intended user experience only; the tech stack, the internal
architecture, and the exact stage breakdown are Fable's to choose. Build it in
stages to a working MVP first, then extend it feature by feature, tracked against
a numbered, checkable list of steps produced during planning — and if Fable has a
stronger planning or evaluation workflow, use that instead.

## Concept

STARfolio is a longitudinal journal of your accomplishments — from work,
projects, and classes — captured in STAR form (Situation, Task, Action, Result).
Over time it becomes a personal bank of experiences. When you need to talk about
yourself — a behavioral interview, a recruiter call — it finds the right
experience and shapes it into a polished, ready-to-say story on demand.

It's for undergrads and new grads preparing for interviews. Two modes of the
same person: the **logger**, quietly building the bank across a semester with no
interview pressure, and the **job seeker**, who needs the best "time you led a
project" story in under a minute. Capture has to feel effortless; pulling a story
has to be fast.

The data layer holds two things. First, your own experiences: as they're
captured, they're ingested into a connected knowledge layer — a graph of
experiences, skills, and results — that the assistant draws on to retrieve and
reshape them. Second, a reference corpus you supply — system-design, technical,
and data-engineering material — that powers the technical-interview layer's
questions and follow-ups. How that layer is stored and searched (graph,
documents, vectors, or a mix, and whatever retrieval strategy fits) is left open.

Experiences can come in from a wide range of inputs, and they split into two
kinds. Narrative inputs already carry the story — a brain dump, bullet points, an
existing resume, a blog post, a URL — and map almost directly into an experience.
Evidence inputs prove what you did but not why it mattered or how it turned out —
code files, a whole project or GitHub repo, a spreadsheet of numbers. For
evidence, the app auto-drafts what it can extract (structure, languages, README
claims, the numbers in a sheet) and then asks you for the Situation, Result, and
impact it can't infer — the same propose-then-confirm loop as the brain dump.
Accepted inputs include freeform text and bullets, .txt/.md, .docx/.pdf,
spreadsheets (.xlsx/.csv), source files and whole-project archives, GitHub repo
URLs, and arbitrary URLs. An experience keeps its sources attached, so its claims
stay backed by the artifacts they came from — and nothing gets invented.

On top of that sits a small, personal natural-language assistant — in the spirit
of a natural-language data assistant like Databricks Genie, but it outputs
interview practice and stories instead of queries and dashboards. You prompt it
with a job description, a story genre, or a discipline/specialization, and it
works in two modes:

- **(A) Live practice** — it runs a live interview: asks "tell me about a time
  when you X," listens as you answer, gives feedback, and occasionally drills
  into specifics as you talk.
- **(B) On-demand stories** — you ask for a specific genre and it hands back a
  polished STAR answer drawn from your bank.

The core idea is that one experience can become many different stories. The value
isn't storage — it's the mapping from what you did to the exact story a given
moment calls for.

## User stories

**Capture**
- As a user, I want to log an experience quickly through a guided
  Situation/Task/Action/Result form with skills and tags, so I capture it while
  it's fresh — and save a partial draft to finish later.
- As a user, I want to brain-dump a rough note in plain text and have it
  organized into the STAR shape for me to review and confirm, so capturing never
  feels like a chore.
- As a user, I want to bring experiences in from whatever I already have — pasted
  text or bullets, a resume, a spreadsheet of metrics, code files, a whole
  project or GitHub repo, or a URL — and have the app draft what it can and ask
  me for the story and impact it can't infer, so I can feed in any format and
  nothing gets invented.
- As a user, I want to attach a concrete result to an experience (a number, a
  scale, an outcome), so my stories carry measurable impact.

**Find**
- As a user, I want to browse and search my whole bank with filters by skill,
  context, and date, so I can see everything I have to work with.
- As a user, I want to ask in plain language for my best story on a theme — "a
  time I led under pressure" — and have the most relevant experiences surfaced,
  so I don't have to remember what I logged.

**Practice live (mode A)**
- As a user, I want the assistant to interview me — ask "tell me about a time
  when you X," let me answer in my own words, and give me live feedback — so I
  can rehearse under realistic conditions.
- As a user, I want it to occasionally drill into a specific detail as I talk
  ("what did you measure there?"), so I learn to handle sharp follow-ups.
- *(Bonus)* As a user, I want a technical-interview layer — drawing on the
  system-design, technical, and data-engineering material I supply — that gives
  me a system design question, has me walk through my approach, and asks
  discerning technical questions about my thinking and design decisions, so I can
  practice the technical loop too.
- As a user, I want to supply my own system-design, technical, and
  data-engineering material for that layer to draw on, so its questions match the
  domains and depth I'm targeting.

**Generate on demand (mode B)**
- As a user, I want to ask for a specific genre, or point it at a job description
  or discipline, and get a polished STAR answer drawn from my experiences, so I
  have something ready to say.
- *(Bonus)* As a user, I want it to output tailored resume bullets and a clean
  resume from a job description, so my written materials come from the same
  experience bank.

**Maintain**
- As a user, I want to be nudged to log new experiences regularly, so my bank
  stays current and doesn't go stale.
